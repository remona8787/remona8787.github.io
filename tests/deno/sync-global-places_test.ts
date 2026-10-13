// Runs the sync-global-places Edge Function locally under Deno with every outbound request stubbed (Wikidata, Commons
// and the Supabase REST API): no network and no database. Checks authentication, the requests the function makes and
// what it writes and logs. Run from light-architecture/:
//   deno test --no-config --allow-env --allow-read tests/deno/
// The SQL behind the rpc calls is tested on real Postgres in tests/sql.test.mjs and tests/global-places-server.test.mjs.
import { BRANCHES, branchIdOf } from "../../edge-functions/_shared/global-places.mjs"
import { wdqsBranch, commonsPage, commonsResponse, BRANCH_ROWS, FAILING, FILES, KOREA, WORLD } from "../fixtures/global-places-fixtures.mjs"

type Handler = (req: Request) => Response | Promise<Response>
type Call = { url: URL; method: string; headers: Headers; body: string }

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
Deno.env.delete("SUPABASE_SECRET_KEYS")
Deno.env.set("SUPABASE_URL", SUPABASE)
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key")
Deno.env.set("MEDIA_CRON_SECRET", "cron-secret")
Deno.env.set("MEDIA_ADMIN_SECRET", "admin-secret")

// ---- the stubbed outside world ----
const state = {
  calls: [] as Call[],
  failing: { ...FAILING } as Record<string, string>,
  running: false,
  rpcError: null as string | null,
  places: new Map<string, { qid: string; image_file: string | null }>(),
  media: [] as { qid: string; image_file: string; status: string; reasons: string[]; media: Record<string, unknown>[] }[],
  runUpdates: [] as Record<string, unknown>[],
}
function reset() {
  Object.assign(state, { calls: [], failing: { ...FAILING }, running: false, rpcError: null, places: new Map(), media: [], runUpdates: [] })
}
const calls = (host: string) => state.calls.filter((c) => c.url.host === host)
const rpcCalls = (fn: string) => state.calls.filter((c) => c.url.pathname === "/rest/v1/rpc/" + fn).map((c) => JSON.parse(c.body))

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
    const titles = (url.searchParams.get("titles") || "").split("|").map((t) => t.replace(/^File:/, ""))
    const files = FILES as Record<string, Record<string, unknown>>
    return Response.json(commonsResponse(Object.fromEntries(titles.map((t) => [t, files[t] ? commonsPage(files[t]) : { missing: true }]))))
  }
  if (url.origin === SUPABASE) {
    if (req.headers.get("apikey") !== "service-role-key") return Response.json({ message: "bad key" }, { status: 401 })
    if (url.pathname === "/rest/v1/sync_runs") {
      if (req.method === "GET") return Response.json(state.running ? [{ id: "run-0", started_at: new Date().toISOString() }] : [])
      if (req.method === "POST") return Response.json({ id: "run-1" }, { status: 201 })
      if (req.method === "PATCH") { state.runUpdates.push(JSON.parse(body)); return new Response(null, { status: 204 }) }
    }
    const fn = url.pathname.replace("/rest/v1/rpc/", "")
    if (state.rpcError) return Response.json({ message: state.rpcError, code: "XX000" }, { status: 400 })
    const args = JSON.parse(body || "{}")
    if (fn === "apply_discovered_places") { for (const r of args.p_rows) state.places.set(r.qid, r); return Response.json(args.p_rows.length) }
    if (fn === "prune_discovered_places") return Response.json(0)
    if (fn === "discovered_images_due") return Response.json([...state.places.values()].filter((r) => r.image_file).slice(0, args.p_limit).map((r) => ({ qid: r.qid, image_file: r.image_file })))
    if (fn === "set_discovered_media") { state.media.push(...args.p_rows); return Response.json(args.p_rows.length) }
  }
  return new Response("unexpected request " + req.method + " " + req.url, { status: 599 })
}

await import("../../edge-functions/sync-global-places/index.ts")
assert(handler, "the function registered a handler")
const invoke = (headers: Record<string, string> = {}, body: unknown = {}, method = "POST") =>
  handler!(new Request("http://localhost/functions/v1/sync-global-places", { method, headers: { "content-type": "application/json", ...headers }, body: method === "GET" ? undefined : JSON.stringify(body) }))
const opts = { sanitizeOps: false, sanitizeResources: false }

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
} })

Deno.test({ name: "a cron run queries each branch with a descriptive User-Agent, stores places and photo verdicts, logs every branch", ...opts, fn: async () => {
  reset()
  const res = await invoke({ "x-aol-cron-secret": "cron-secret" })
  assertEquals(res.status, 200)
  const out = await res.json()
  assertEquals([out.ok, out.status, out.run], [true, "partial", "run-1"])
  const wdqs = calls("query.wikidata.org")
  assertEquals(wdqs.map((c) => branchIdOf(new URLSearchParams(c.body).get("query") ?? "")).sort(), BRANCHES.map((b) => b.id).sort())
  for (const c of [...wdqs, ...calls("commons.wikimedia.org")]) assert(/^ArchitectureOfLight\/[\d.]+ \(https:\/\/[^)]+\) sync-global-places$/.test(c.headers.get("user-agent") || ""), "User-Agent: " + c.headers.get("user-agent"))
  assert(wdqs.every((c) => c.method === "POST" && c.headers.get("accept") === "application/sparql-results+json"))
  // Places: every one the branches that answered found, in one batch; prune told which branches failed.
  assert(state.places.has(WORLD.vivid.qid) && state.places.has(KOREA.jinju.qid) && !state.places.has("Q104383619"), "places upserted, never-show items left out")
  const prune = rpcCalls("prune_discovered_places")
  assertEquals(prune.length, 1)
  assertEquals(prune[0].p_failed_branches.sort(), Object.keys(FAILING).sort())
  assertEquals(prune[0].p_seen_at, rpcCalls("apply_discovered_places")[0].p_seen_at)
  // Photos: one Commons request for the due files; verdicts with attribution, Korean FoP shown by default.
  assertEquals(calls("commons.wikimedia.org").length, 1)
  assertEquals(rpcCalls("discovered_images_due")[0].p_kr_fop, true)
  const media = new Map(state.media.map((m) => [m.qid, m]))
  assertEquals([media.get(WORLD.vivid.qid)?.status, media.get(WORLD.vivid.qid)?.media[0]?.creator], ["cleared", "Lee Photographer"])
  assertEquals([media.get(WORLD.lyon.qid)?.status, media.get(WORLD.lyon.qid)?.reasons], ["blocked", ["foreign_no_freedom_of_panorama"]])
  assertEquals(media.get(KOREA.jinju.qid)?.status, "cleared")
  // The run log: started as running, finished as partial with the status of each branch.
  const insert = JSON.parse(state.calls.find((c) => c.url.pathname === "/rest/v1/sync_runs" && c.method === "POST")!.body)
  assertEquals([insert.provider, insert.job_name, insert.status], ["wikidata", "sync-global-places", "running"])
  const log = state.runUpdates.at(-1)! as { status: string; error_message: string; metadata: { branches: { id: string; ok: boolean; error: string | null }[]; images: { cleared: number } } }
  assertEquals(log.status, "partial")
  assertEquals(log.metadata.branches.length, BRANCHES.length)
  assertEquals(log.metadata.branches.filter((b) => !b.ok).map((b) => `${b.id} ${b.error}`).sort(), ["world:genres HTTP 500", "world:lantern invalid_wdqs_payload"])
  assert(/world:genres/.test(log.error_message))
  assertEquals(log.metadata.images.cleared, 3)
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

Deno.test({ name: "a run already in progress is not started twice unless forced", ...opts, fn: async () => {
  reset()
  state.running = true
  const res = await invoke({ "x-aol-cron-secret": "cron-secret" })
  assertEquals(res.status, 409)
  assertEquals((await res.json()).error, "already_running")
  assertEquals(calls("query.wikidata.org").length, 0)
  assertEquals((await invoke({ "x-aol-cron-secret": "cron-secret" }, { force: true })).status, 200)
  // A body that is not an object is treated as {} (defaults), not as an error.
  state.running = false
  for (const body of [null, 42, ["x"], "text"]) assertEquals((await invoke({ "x-aol-cron-secret": "cron-secret" }, body)).status, 200, JSON.stringify(body))
  // Before each run, runs older than 10 minutes that never logged their end are closed as failed.
  const close = state.calls.find((c) => c.url.pathname === "/rest/v1/sync_runs" && c.method === "PATCH")!
  assertEquals([close.url.searchParams.get("job_name"), close.url.searchParams.get("status")], ["eq.sync-global-places", "eq.running"])
  assert(/^lt\./.test(close.url.searchParams.get("started_at") || ""))
  assertEquals(JSON.parse(close.body).status, "failed")
} })

Deno.test({ name: "every branch failing: 502, nothing written, the run is logged as failed with each branch's error", ...opts, fn: async () => {
  reset()
  state.failing = Object.fromEntries(BRANCHES.map((b) => [b.id, "http500"]))
  const res = await invoke({ "x-aol-cron-secret": "cron-secret" })
  assertEquals(res.status, 502)
  assertEquals((await res.json()).error, "all_branches_failed")
  for (const fn of ["apply_discovered_places", "prune_discovered_places", "discovered_images_due", "set_discovered_media"]) assertEquals(rpcCalls(fn).length, 0, fn)
  const log = state.runUpdates.at(-1)! as { status: string; metadata: { branches: { ok: boolean; error: string }[] } }
  assertEquals(log.status, "failed")
  assertEquals(log.metadata.branches.length, BRANCHES.length)
  assert(log.metadata.branches.every((b) => !b.ok && b.error === "HTTP 500"))
} })

Deno.test({ name: "a database error answers 500 and marks the run failed", ...opts, fn: async () => {
  reset()
  state.rpcError = "permission denied for function apply_discovered_places"
  const res = await invoke({ "x-aol-cron-secret": "cron-secret" })
  assertEquals(res.status, 500)
  assert(/apply_discovered_places: permission denied/.test((await res.json()).error))
  const log = state.runUpdates.at(-1)! as { status: string; error_message: string }
  assertEquals(log.status, "failed")
  assert(/permission denied/.test(log.error_message))
} })
