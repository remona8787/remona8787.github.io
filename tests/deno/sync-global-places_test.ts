// Runs the sync-global-places Edge Function locally under Deno with every outbound request stubbed (Wikidata, Commons
// and the Supabase REST API): no network and no database. Checks authentication, the requests the function makes and
// what it writes and logs. Run from light-architecture/:
//   deno test --no-config --allow-env --allow-read tests/deno/
// The SQL behind the rpc calls is tested on real Postgres in tests/sql.test.mjs and tests/global-places-server.test.mjs.
// The stub behaves like that SQL where the function depends on it: the run lock (claim/release_discovered_sync) is a
// lease per job, and sync_runs answers a GET only through the filters the request carries.
import { BRANCHES, branchIdOf } from "../../edge-functions/_shared/global-places.mjs"
import { wdqsBranch, commonsPage, commonsResponse, BRANCH_ROWS, FAILING, FILES, KOREA, WORLD } from "../fixtures/global-places-fixtures.mjs"

type Handler = (req: Request) => Response | Promise<Response>
type Call = { url: URL; method: string; headers: Headers; body: string }
type Run = { id?: string; job_name: string; status: string; started_at: string; metadata: unknown }

function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg)
}
function assertEquals(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${msg}\n  actual:   ${a}\n  expected: ${e}`)
}

// The function registers its handler with Deno.serve when imported: capture it instead of opening a port.
let handler: Handler | null = null
Object.defineProperty(Deno, "serve", { value: (h: Handler) => { handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }, configurable: true, writable: true })

const SUPABASE = "https://stub.supabase.co"
const JOB = "sync-global-places", IMAGES_JOB = "sync-global-places-images"
Deno.env.delete("SUPABASE_SECRET_KEYS")
Deno.env.set("SUPABASE_URL", SUPABASE)
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
Deno.env.set("MEDIA_CRON_SECRET", "cron-secret")
Deno.env.set("MEDIA_ADMIN_SECRET", "admin-secret")

// ---- the stubbed outside world ----
const state = {
  calls: [] as Call[],
  failing: { ...FAILING } as Record<string, string>,
  // Run locks by job: owner and expiry (ms), as public.discovered_sync_locks.
  locks: new Map<string, { owner: string; expires: number }>(),
  // Makes one rpc function fail with this database error.
  rpcError: null as { fn: string; message: string } | null,
  places: new Map<string, { qid: string; image_file: string | null; branches: string[] }>(),
  media: [] as { qid: string; image_file: string; status: string; reasons: string[]; media: Record<string, unknown>[] }[],
  runs: [] as Run[],
  runUpdates: [] as Record<string, unknown>[],
  // Earlier sync_runs rows (any job, any status) the history GET may return.
  history: [] as Run[],
  // Commons answers each round after this many ms and always asks for another round (0: normal answers).
  commonsSlowMs: 0,
}
function reset() {
  Object.assign(state, { calls: [], failing: { ...FAILING }, locks: new Map(), rpcError: null, places: new Map(), media: [], runs: [], runUpdates: [], history: [], commonsSlowMs: 0 })
}
const calls = (host: string) => state.calls.filter((c) => c.url.host === host)
const rpcCalls = (fn: string) => state.calls.filter((c) => c.url.pathname === "/rest/v1/rpc/" + fn).map((c) => JSON.parse(c.body))
const runCalls = (method: string) => state.calls.filter((c) => c.url.pathname === "/rest/v1/sync_runs" && c.method === method)
const callIndex = (fn: string) => state.calls.findIndex((c) => c.url.pathname === "/rest/v1/rpc/" + fn)

// sync_runs GET: only the filters this function uses are understood; anything else is an error, like PostgREST's.
function historyAnswer(url: URL) {
  const known = new Set(["select", "job_name", "status", "order", "limit"])
  for (const k of url.searchParams.keys()) if (!known.has(k)) return Response.json({ message: "unexpected filter " + k }, { status: 400 })
  const job = url.searchParams.get("job_name"), status = url.searchParams.get("status"), order = url.searchParams.get("order")
  let list = state.history.filter((r) => job === "eq." + r.job_name && (status === "neq.running" ? r.status !== "running" : status === null))
  if (order === "started_at.desc") list = [...list].sort((a, b) => b.started_at.localeCompare(a.started_at))
  else if (order !== null) return Response.json({ message: "unexpected order " + order }, { status: 400 })
  const limit = Number(url.searchParams.get("limit") ?? Infinity)
  return Response.json(list.slice(0, limit).map((r) => ({ status: r.status, metadata: r.metadata })))
}

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init)
  const url = new URL(req.url)
  const body = req.method === "GET" || req.method === "HEAD" ? "" : await req.text()
  state.calls.push({ url, method: req.method, headers: req.headers, body })
  if (url.host === "query.wikidata.org") {
    const id = branchIdOf(new URLSearchParams(body).get("query") ?? "")
    if (!id) return new Response("unknown query", { status: 400 })
    if (state.failing[id] === "http500") return new Response("{}", { status: 500 })
    if (state.failing[id] === "invalid") return Response.json({})
    return Response.json(wdqsBranch((BRANCH_ROWS as Record<string, unknown[]>)[id] || []))
  }
  if (url.host === "commons.wikimedia.org") {
    if (state.commonsSlowMs) {
      return await new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(Response.json({ continue: { tlcontinue: String(state.calls.length), continue: "||" }, query: { pages: [] } })), state.commonsSlowMs)
        req.signal.addEventListener("abort", () => { clearTimeout(timer); reject(req.signal.reason) }, { once: true })
      })
    }
    const titles = (url.searchParams.get("titles") || "").split("|").map((t) => t.replace(/^File:/, ""))
    const files = FILES as Record<string, Record<string, unknown>>
    return Response.json(commonsResponse(Object.fromEntries(titles.map((t) => [t, files[t] ? commonsPage(files[t]) : { missing: true }]))))
  }
  if (url.origin === SUPABASE) {
    if (req.headers.get("apikey") !== "service-role-key") return Response.json({ message: "bad key" }, { status: 401 })
    if (url.pathname === "/rest/v1/sync_runs") {
      if (req.method === "GET") return historyAnswer(url)
      if (req.method === "POST") { state.runs.push(JSON.parse(body)); return new Response(null, { status: 201 }) }
      if (req.method === "PATCH") { state.runUpdates.push(JSON.parse(body)); return new Response(null, { status: 204 }) }
    }
    const fn = url.pathname.replace("/rest/v1/rpc/", "")
    if (state.rpcError?.fn === fn) return Response.json({ message: state.rpcError.message, code: "XX000" }, { status: 400 })
    const args = JSON.parse(body || "{}")
    if (fn === "claim_discovered_sync") {
      const held = state.locks.get(args.p_job), now = Date.now()
      if (!held || held.expires <= now || held.owner === args.p_owner || args.p_force === true) {
        state.locks.set(args.p_job, { owner: args.p_owner, expires: now + args.p_lease_seconds * 1000 })
        return Response.json({ ok: true, owner: args.p_owner })
      }
      return Response.json({ ok: false, owner: held.owner, locked_at: new Date(now - 1000).toISOString(), expires_at: new Date(held.expires).toISOString() })
    }
    if (fn === "release_discovered_sync") {
      const mine = state.locks.get(args.p_job)?.owner === args.p_owner
      if (mine) state.locks.delete(args.p_job)
      return Response.json(mine)
    }
    if (fn === "apply_discovered_places") { for (const r of args.p_rows) state.places.set(r.qid, r); return Response.json(args.p_rows.length) }
    if (fn === "prune_discovered_places") return Response.json(0)
    if (fn === "discovered_branch_counts") {
      const counts: Record<string, number> = {}
      for (const r of state.places.values()) for (const b of r.branches || []) counts[b] = (counts[b] || 0) + 1
      return Response.json(counts)
    }
    if (fn === "discovered_images_due") return Response.json([...state.places.values()].filter((r) => r.image_file).slice(0, args.p_limit).map((r) => ({ qid: r.qid, image_file: r.image_file })))
    if (fn === "set_discovered_media") { state.media.push(...args.p_rows); return Response.json(args.p_rows.length) }
  }
  return new Response("unexpected request " + req.method + " " + req.url, { status: 599 })
}

await import("../../edge-functions/sync-global-places/index.ts")
assert(handler, "the function registered a handler")
const invoke = (headers: Record<string, string> = {}, body: unknown = {}, method = "POST") =>
  handler!(new Request("http://localhost/functions/v1/sync-global-places", { method, headers: { "content-type": "application/json", ...headers }, body: method === "GET" ? undefined : JSON.stringify(body) }))
const cron = (body: unknown = {}) => invoke({ "x-aol-cron-secret": "cron-secret" }, body)
const opts = { sanitizeOps: false, sanitizeResources: false }
// Default budget 130 s + the lock's 60 s margin.
const LEASE_SECONDS = 190
const lastLog = () => state.runUpdates.at(-1)! as { status: string; error_message: string | null; metadata: Record<string, any> }

Deno.test({ name: "rejects GET, and POSTs without the right secret, before any outbound request", ...opts, fn: async () => {
  reset()
  assertEquals((await invoke({}, {}, "GET")).status, 405)
  const attempts: Record<string, string>[] = [{}, { "x-aol-cron-secret": "" }, { "x-aol-cron-secret": "wrong" }, { "x-aol-media-admin-secret": "cron-secret" }, { authorization: "Bearer service-role-key" }]
  for (const headers of attempts) {
    const res = await invoke(headers)
    assertEquals(res.status, 401, JSON.stringify(headers))
    assertEquals(await res.json(), { error: "unauthorized" })
  }
  assertEquals(state.calls.length, 0, "no request left the function")
  // A missing secret on the server never authorizes, even when the request sends an empty one.
  Deno.env.delete("MEDIA_CRON_SECRET")
  try { assertEquals((await invoke({ "x-aol-cron-secret": "" })).status, 401) } finally { Deno.env.set("MEDIA_CRON_SECRET", "cron-secret") }
  // An unknown phase is refused before anything else happens.
  const bad = await cron({ phase: "everything" })
  assertEquals([bad.status, (await bad.json()).error], [400, "invalid_phase"])
  assertEquals(state.calls.length, 0)
} })

Deno.test({ name: "a cron run takes the lock, queries each branch with a descriptive User-Agent (expensive first), stores places and verdicts, logs every branch", ...opts, fn: async () => {
  reset()
  const res = await cron()
  assertEquals(res.status, 200)
  const out = await res.json()
  const insert = JSON.parse(runCalls("POST")[0].body)
  assertEquals([out.ok, out.status, out.phase, out.run], [true, "partial", "places", insert.id])
  assert(/^[0-9a-f-]{36}$/.test(insert.id), "the run id is a UUID the function chose")
  const wdqs = calls("query.wikidata.org")
  const ids = wdqs.map((c) => branchIdOf(new URLSearchParams(c.body).get("query") ?? ""))
  assertEquals([...ids].sort(), BRANCHES.map((b) => b.id).sort())
  assertEquals(ids[0], "korea:name-keywords", "the expensive branch starts first")
  assertEquals(out.branches.map((b: { id: string }) => b.id), ids, "the report lists the branches in start order")
  for (const c of [...wdqs, ...calls("commons.wikimedia.org")]) assert(/^ArchitectureOfLight\/[\d.]+ \(https:\/\/[^)]+\) sync-global-places$/.test(c.headers.get("user-agent") || ""), "User-Agent: " + c.headers.get("user-agent"))
  assert(wdqs.every((c) => c.method === "POST" && c.headers.get("accept") === "application/sparql-results+json"))
  // The lock: claimed once for the run (owner = the run id, lease = budget + 60 s), released at the end.
  assertEquals(rpcCalls("claim_discovered_sync"), [{ p_job: JOB, p_owner: insert.id, p_lease_seconds: LEASE_SECONDS, p_force: false }])
  assertEquals(rpcCalls("release_discovered_sync"), [{ p_job: JOB, p_owner: insert.id }])
  assertEquals(state.locks.size, 0)
  assert(callIndex("claim_discovered_sync") < state.calls.findIndex((c) => c.url.host === "query.wikidata.org"), "locked before the first query")
  // The history for the alerts: this job's finished runs, newest first, two of them.
  const history = runCalls("GET")[0].url.searchParams
  assertEquals([history.get("job_name"), history.get("status"), history.get("order"), history.get("limit")], ["eq.sync-global-places", "neq.running", "started_at.desc", "2"])
  // Places: every one the branches that answered found, in one batch; stored counts read first; prune told which branches failed.
  assert(state.places.has(WORLD.vivid.qid) && state.places.has(KOREA.jinju.qid) && !state.places.has("Q104383619"), "places upserted, never-show items left out")
  assert(callIndex("discovered_branch_counts") < callIndex("apply_discovered_places"), "stored counts are read before the upsert")
  const prune = rpcCalls("prune_discovered_places")
  assertEquals(prune.length, 1)
  assertEquals(prune[0].p_failed_branches.sort(), Object.keys(FAILING).sort())
  assertEquals(prune[0].p_seen_at, rpcCalls("apply_discovered_places")[0].p_seen_at)
  assertEquals(rpcCalls("discovered_branch_counts")[0].p_seen_at, prune[0].p_seen_at)
  // Photos: one Commons request for the due files; verdicts with attribution, Korean FoP shown by default.
  assertEquals(calls("commons.wikimedia.org").length, 1)
  assertEquals(rpcCalls("discovered_images_due")[0].p_kr_fop, true)
  const media = new Map(state.media.map((m) => [m.qid, m]))
  assertEquals([media.get(WORLD.vivid.qid)?.status, media.get(WORLD.vivid.qid)?.media[0]?.creator], ["cleared", "Lee Photographer"])
  assertEquals([media.get(WORLD.lyon.qid)?.status, media.get(WORLD.lyon.qid)?.reasons], ["blocked", ["foreign_no_freedom_of_panorama"]])
  assertEquals(media.get(KOREA.jinju.qid)?.status, "cleared")
  // The run log: started as running, finished as partial with the status of each branch.
  assertEquals([insert.provider, insert.job_name, insert.status, insert.metadata.phase], ["wikidata", JOB, "running", "places"])
  const log = lastLog()
  assertEquals(log.status, "partial")
  assertEquals(log.metadata.branches.length, BRANCHES.length)
  assertEquals(log.metadata.branches.filter((b: { ok: boolean }) => !b.ok).map((b: { id: string; error: string }) => `${b.id} ${b.error}`).sort(), ["world:genres HTTP 500", "world:lantern invalid_wdqs_payload"])
  assert(/world:genres/.test(log.error_message || ""))
  assertEquals([log.metadata.images.cleared, log.metadata.images.deferred, log.metadata.alerts], [3, 0, []])
} })

Deno.test({ name: "MEDIA_KR_FOP_DISPLAY=false blocks Korean freedom-of-panorama photos; the admin secret also authorizes", ...opts, fn: async () => {
  reset()
  Deno.env.set("MEDIA_KR_FOP_DISPLAY", "false")
  try {
    const res = await invoke({ "x-aol-media-admin-secret": "admin-secret" }, { image_limit: 10 })
    assertEquals(res.status, 200)
    assertEquals(rpcCalls("discovered_images_due")[0].p_kr_fop, false)
    assertEquals(rpcCalls("discovered_images_due")[0].p_limit, 10)
    const jinju = state.media.find((m) => m.qid === KOREA.jinju.qid)
    assertEquals([jinju?.status, jinju?.reasons], ["blocked", ["kr_freedom_of_panorama_disabled"]])
    assertEquals(rpcCalls("set_discovered_media")[0].p_kr_fop, false)
  } finally { Deno.env.delete("MEDIA_KR_FOP_DISPLAY") }
} })

Deno.test({ name: "a run holding the lock blocks the next one (also the photo phase) until it expires, unless forced", ...opts, fn: async () => {
  reset()
  state.locks.set(JOB, { owner: "run-0", expires: Date.now() + 60000 })
  for (const body of [{}, { phase: "images" }]) {
    const res = await cron(body)
    assertEquals(res.status, 409, JSON.stringify(body))
    const out = await res.json()
    assertEquals([out.error, out.run], ["already_running", "run-0"])
  }
  assertEquals(rpcCalls("claim_discovered_sync").map((a) => [a.p_job, a.p_lease_seconds, a.p_force]), [[JOB, LEASE_SECONDS, false], [JOB, LEASE_SECONDS, false]], "both phases claim the same lock")
  assertEquals([calls("query.wikidata.org").length, calls("commons.wikimedia.org").length, runCalls("POST").length, runCalls("PATCH").length, rpcCalls("release_discovered_sync").length], [0, 0, 0, 0, 0], "nothing ran, nothing logged")
  assertEquals(state.locks.get(JOB)?.owner, "run-0", "the holder keeps its lock")
  // force takes it; the forced run releases its own lock at the end (the old holder's release then frees nothing).
  assertEquals((await cron({ force: true })).status, 200)
  assertEquals(rpcCalls("claim_discovered_sync").at(-1).p_force, true)
  assertEquals(state.locks.size, 0)
  // A lock that has expired (its run was stopped by the platform) does not block.
  state.locks.set(JOB, { owner: "run-crashed", expires: Date.now() - 1 })
  assertEquals((await cron()).status, 200)
  assertEquals(state.locks.size, 0)
  // A body that is not an object is treated as {} (defaults), not as an error.
  for (const body of [null, 42, ["x"], "text"]) assertEquals((await cron(body)).status, 200, JSON.stringify(body))
  // The budget is capped below Supabase's 150 s gateway limit whatever the body asks for (and so is the lease).
  await cron({ budget_ms: 380000 })
  assertEquals([rpcCalls("claim_discovered_sync").at(-1).p_lease_seconds, JSON.parse(runCalls("POST").at(-1)!.body).metadata.budget_ms], [LEASE_SECONDS, 130000])
  // Before each run, runs of the same job older than 10 minutes that never logged their end are closed as failed.
  const close = runCalls("PATCH")[0]
  assertEquals([close.url.searchParams.get("job_name"), close.url.searchParams.get("status")], ["eq.sync-global-places", "eq.running"])
  assert(/^lt\./.test(close.url.searchParams.get("started_at") || ""))
  assert(Date.now() - Date.parse(close.url.searchParams.get("started_at")!.slice(3)) >= 10 * 60 * 1000 - 5000)
  assertEquals(JSON.parse(close.body).status, "failed")
} })

Deno.test({ name: "the photo phase checks only photos, under its own job name, with the shared lock", ...opts, fn: async () => {
  reset()
  for (const [qid, image_file] of [[WORLD.vivid.qid, "Vivid Sydney 2019.jpg"], [WORLD.lyon.qid, "Fete des Lumieres Lyon.jpg"], ["Q77001", "Gone.jpg"]]) state.places.set(qid, { qid, image_file, branches: ["world:seeds"] })
  const res = await cron({ phase: "images" })
  assertEquals(res.status, 200)
  const out = await res.json()
  assertEquals([out.ok, out.phase, out.status, out.images.due, out.images.checked, out.images.cleared, out.images.blocked], [true, "images", "success", 3, 3, 1, 2])
  assertEquals([calls("query.wikidata.org").length, calls("commons.wikimedia.org").length], [0, 1])
  for (const fn of ["apply_discovered_places", "prune_discovered_places", "discovered_branch_counts"]) assertEquals(rpcCalls(fn).length, 0, fn)
  assertEquals(rpcCalls("claim_discovered_sync")[0].p_job, JOB)
  assertEquals(state.locks.size, 0)
  const insert = JSON.parse(runCalls("POST")[0].body)
  assertEquals([insert.job_name, insert.provider, insert.metadata.phase], [IMAGES_JOB, "wikimedia_commons", "images"])
  assertEquals(runCalls("GET")[0].url.searchParams.get("job_name"), "eq." + IMAGES_JOB)
  assertEquals(runCalls("PATCH")[0].url.searchParams.get("job_name"), "eq." + IMAGES_JOB)
  assertEquals([lastLog().status, lastLog().metadata.images.updated], ["success", 3])
} })

Deno.test({ name: "slow Commons continuation rounds cannot hold a run past its deadline", ...opts, fn: async () => {
  reset()
  for (let i = 0; i < 5; i++) state.places.set("Q7700" + i, { qid: "Q7700" + i, image_file: `Slow ${i}.jpg`, branches: ["world:seeds"] })
  // Every round takes 300 ms and asks for another: unbounded, one batch would take 40 rounds (12 s). With the smallest
  // budget (10 s) the deadline is 2 s after the start.
  state.commonsSlowMs = 300
  const started = Date.now()
  const res = await cron({ phase: "images", budget_ms: 10000 })
  const took = Date.now() - started
  assertEquals(res.status, 200)
  const out = await res.json()
  assert(took >= 1900 && took < 2000 + 700, `answered ${took} ms after the start (deadline 2000 ms)`)
  assertEquals([out.images.stopped, out.images.checked, out.images.deferred, out.images.error], ["deadline", 0, 5, null])
  const rounds = calls("commons.wikimedia.org").length
  assert(rounds >= 5 && rounds <= 8, `${rounds} Commons rounds before the deadline`)
  assertEquals(rpcCalls("set_discovered_media").length, 0, "the unfinished batch stores nothing")
  assertEquals([lastLog().status, lastLog().metadata.images.deferred], ["success", 5])
  assertEquals(state.locks.size, 0)
} })

Deno.test({ name: "alerts: a branch failing three runs in a row, read from this job's own history", ...opts, fn: async () => {
  reset()
  const at = (h: number) => new Date(Date.now() - h * 3600e3).toISOString()
  const ran = (job: string, started_at: string, branches: { id: string; ok: boolean }[], status = "partial") => ({ job_name: job, status, started_at, metadata: { branches, images: { deferred: 9 } } })
  state.history = [
    // Newest first once sorted: a run still "running" (not counted), then two runs where world:genres failed.
    ran(JOB, at(0.1), [], "running"),
    ran(JOB, at(6), [{ id: "world:genres", ok: false }, { id: "world:lantern", ok: true }]),
    ran(JOB, at(12), [{ id: "world:genres", ok: false }, { id: "world:lantern", ok: false }]),
    ran(JOB, at(18), [{ id: "world:genres", ok: true }, { id: "world:lantern", ok: false }]),
    // Another job's runs never count.
    ran(IMAGES_JOB, at(1), [{ id: "world:lantern", ok: false }]),
  ]
  const out = await (await cron()).json()
  assertEquals(out.alerts, ["branch_failing: world:genres failed 3 runs in a row"])
  assertEquals(lastLog().metadata.alerts, out.alerts)
  assert(/branch_failing: world:genres/.test(lastLog().error_message || ""))
} })

Deno.test({ name: "a branch answering with less than half of its stored places is kept from pruning and reported", ...opts, fn: async () => {
  reset()
  // 10 places stored for world:seeds; this run it returns 3.
  for (let i = 0; i < 10; i++) state.places.set("Q8800" + i, { qid: "Q8800" + i, image_file: null, branches: ["world:seeds"] })
  const out = await (await cron({ image_limit: 0 })).json()
  const seeds = out.branches.find((b: { id: string }) => b.id === "world:seeds")
  assertEquals([seeds.ok, seeds.suspect, seeds.stored, seeds.rows], [true, true, 10, 3])
  assertEquals(rpcCalls("prune_discovered_places")[0].p_failed_branches.sort(), [...Object.keys(FAILING), "world:seeds"].sort())
  assert(/world:seeds \(3 of 10\)/.test(lastLog().error_message || ""), lastLog().error_message || "")
  assertEquals(lastLog().status, "partial")
} })

Deno.test({ name: "every branch failing: 502, nothing written, the run is logged as failed with each branch's error", ...opts, fn: async () => {
  reset()
  state.failing = Object.fromEntries(BRANCHES.map((b) => [b.id, "http500"]))
  const res = await cron()
  assertEquals(res.status, 502)
  assertEquals((await res.json()).error, "all_branches_failed")
  for (const fn of ["apply_discovered_places", "prune_discovered_places", "discovered_images_due", "set_discovered_media"]) assertEquals(rpcCalls(fn).length, 0, fn)
  const log = lastLog()
  assertEquals(log.status, "failed")
  assertEquals(log.metadata.branches.length, BRANCHES.length)
  assert(log.metadata.branches.every((b: { ok: boolean; error: string }) => !b.ok && b.error === "HTTP 500"))
  assertEquals(state.locks.size, 0)
} })

Deno.test({ name: "a database error answers 500, marks the run failed and releases the lock", ...opts, fn: async () => {
  reset()
  state.rpcError = { fn: "apply_discovered_places", message: "permission denied for function apply_discovered_places" }
  const res = await cron()
  assertEquals(res.status, 500)
  assert(/apply_discovered_places: permission denied/.test((await res.json()).error))
  const log = lastLog()
  assertEquals(log.status, "failed")
  assert(/permission denied/.test(log.error_message || ""))
  assertEquals(state.locks.size, 0)
  // The lock itself unavailable (e.g. the migration not applied yet): 500, nothing queried or logged.
  reset()
  state.rpcError = { fn: "claim_discovered_sync", message: "Could not find the function public.claim_discovered_sync" }
  const res2 = await cron()
  assertEquals(res2.status, 500)
  assert(/claim_discovered_sync/.test((await res2.json()).error))
  assertEquals([calls("query.wikidata.org").length, runCalls("POST").length, runCalls("PATCH").length], [0, 0, 0])
} })
