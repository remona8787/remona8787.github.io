// Runs the archive-collect Edge Function under Deno with every outbound request stubbed (Supabase auth/REST, GDELT,
// the feeds, the WebSub hub): authentication (cron secret, operator secret, editor JWT checked with the user's own
// token), the rpc calls a cron run makes and their payloads, dry_run writing nothing, and WebSub subscription.
// Run from light-architecture/: deno test --no-config --allow-env --allow-read tests/deno/
import { assert, assertEquals, captureServe, fixture, opts, setEnv, world, ANON_KEY, SERVICE_KEY } from "../fixtures/archive/deno-world.ts"

setEnv({ WEBSUB_CALLBACK_URL: "https://stub.supabase.co/functions/v1/archive-websub" })
const box = captureServe()
const w = world()
await import("../../edge-functions/archive-collect/index.ts")
assert(box.handler, "the function registered a handler")

const GDELT_RULE = { id: "11111111-1111-4111-8111-111111111111", kind: "gdelt", name: "GDELT ko · media facade", query: '("media facade") sourcelang:korean', url: null, language: "ko", enabled: true, cadence_hours: 6, last_run_at: null, failure_count: 0, etag: null, last_modified: null }
const RSS_RULE = { id: "22222222-2222-4222-8222-222222222222", kind: "rss", name: "Dezeen", query: null, url: "https://www.dezeen.com/feed/", language: "en", enabled: true, cadence_hours: 6, last_run_at: "2026-10-17T00:00:00Z", failure_count: 1, etag: '"old"', last_modified: null }
const PROJECT = "33333333-3333-4333-8333-333333333333"
const gdelt = await fixture("gdelt-artlist.json"), dezeen = await fixture("dezeen-rss.xml")

function stubDatabase() {
  w.reset()
  let run = 0
  w.state.rpc.set("archive_claim_due_rules", (a) => a.p_rule_ids ? [GDELT_RULE, RSS_RULE].filter((r) => a.p_rule_ids.includes(r.id)) : [GDELT_RULE, RSS_RULE])
  w.state.rpc.set("archive_alias_index", () => [{ project_id: PROJECT, slug: "lotte-world-tower", names: ["롯데월드타워", "Lotte World Tower"], wikidata_qid: "Q1000001", country_iso2: "KR", city: "Seoul" }])
  w.state.rpc.set("archive_start_run", () => `00000000-0000-4000-8000-00000000000${++run}`)
  w.state.rpc.set("archive_ingest", (a) => ({ kept: a.p_items.length, new_candidates: a.p_items.length - 1, matched_projects: 1, duplicates: 0, ignored: 0, items: [] }))
  w.state.rpc.set("archive_finish_run", (a) => ({ run_id: a.p_run_id, status: a.p_status }))
  w.state.rpc.set("archive_log_error", () => undefined)
  w.state.rpc.set("archive_websub_get", () => null)
  w.state.rpc.set("archive_websub_upsert", () => "44444444-4444-4444-8444-444444444444")
  w.state.rpc.set("archive_websub_due", () => [{ id: "w1", topic: "https://renew.example/feed", hub: "https://hub.example/", state: "active", lease_expires_at: "2026-10-19T00:00:00Z", rule_id: null, reason: "expiring" }])
  w.state.rpc.set("archive_record_project_update", () => "55555555-5555-4555-8555-555555555555")
  w.state.rpc.set("archive_role", (_a, req) => (req.headers.get("authorization") === "Bearer editor-token" ? "editor" : req.headers.get("authorization") === "Bearer researcher-token" ? "researcher" : null))
  w.state.tables.set("archive_collection_rules", () => [GDELT_RULE, RSS_RULE])
  w.state.tables.set("archive_keywords", () => [])
  w.state.users.set("editor-token", { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "editor@example.org" })
  w.state.users.set("researcher-token", { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "researcher@example.org" })
  w.state.routes.set("https://api.gdeltproject.org/api/v2/doc/doc", () => new Response(gdelt, { headers: { "content-type": "application/json" } }))
  w.state.routes.set("https://www.dezeen.com/feed/", () => new Response(dezeen, { headers: { "content-type": "application/rss+xml; charset=UTF-8", etag: '"v2"', link: '<https://pubsubhubbub.appspot.com/>; rel="hub", <https://www.dezeen.com/feed/>; rel="self"' } }))
  w.state.routes.set("https://pubsubhubbub.appspot.com/", () => new Response(null, { status: 202 }))
  w.state.routes.set("https://hub.example/", () => new Response(null, { status: 202 }))
}
const invoke = (headers: Record<string, string> = {}, body: unknown = {}, method = "POST") =>
  box.handler!(new Request("http://localhost/functions/v1/archive-collect", { method, headers: { "content-type": "application/json", ...headers }, body: method === "GET" || method === "OPTIONS" ? undefined : JSON.stringify(body) }))
const cron = (body: unknown = {}) => invoke({ "x-aol-cron-secret": "cron-secret" }, body)

Deno.test({ name: "rejects GET and unauthenticated POSTs before any database or source request; answers CORS preflight", ...opts, fn: async () => {
  stubDatabase()
  assertEquals((await invoke({}, {}, "GET")).status, 405)
  const pre = await invoke({}, {}, "OPTIONS")
  assertEquals([pre.status, pre.headers.get("access-control-allow-origin")], [204, "*"])
  const attempts: Record<string, string>[] = [{}, { "x-aol-cron-secret": "" }, { "x-aol-cron-secret": "wrong" }, { "x-aol-media-admin-secret": "cron-secret" }]
  for (const headers of attempts) {
    const res = await invoke(headers)
    assertEquals([res.status, await res.json()], [401, { error: "unauthorized" }], JSON.stringify(headers))
  }
  assertEquals(w.state.calls.length, 0, "nothing left the function")
  Deno.env.delete("MEDIA_CRON_SECRET")
  try { assertEquals((await invoke({ "x-aol-cron-secret": "" })).status, 401, "a missing server secret never authorizes") } finally { Deno.env.set("MEDIA_CRON_SECRET", "cron-secret") }
  assertEquals((await cron({ rule_ids: ["not-a-uuid"] })).status, 400)
  assertEquals(w.state.calls.length, 0)
} })

Deno.test({ name: "editor JWT: verified through auth, role read with the user's own token; researchers and bad sessions refused", ...opts, fn: async () => {
  stubDatabase()
  assertEquals((await invoke({ authorization: "Bearer forged" }, { rule_id: GDELT_RULE.id })).status, 401)
  assertEquals(w.rpcCalls("archive_role").length, 0)
  const researcher = await invoke({ authorization: "Bearer researcher-token" }, { rule_id: GDELT_RULE.id })
  assertEquals([researcher.status, (await researcher.json()).error], [403, "editor_role_required"])
  const role = w.rpcCalls("archive_role")[0]
  assertEquals([role.headers.get("authorization"), role.headers.get("apikey")], ["Bearer researcher-token", ANON_KEY], "never with the service key")
  assertEquals(w.rpcCalls("archive_claim_due_rules").length, 0)
  const noRules = await invoke({ authorization: "Bearer editor-token" }, {})
  assertEquals([noRules.status, (await noRules.json()).error], [400, "rule_ids_required"])
  const ok = await invoke({ authorization: "Bearer editor-token" }, { rule_id: GDELT_RULE.id })
  const out = await ok.json()
  assertEquals([ok.status, out.trigger, out.requested_by, out.rules.length], [200, "admin", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 1])
  const claim = w.rpcArgs("archive_claim_due_rules").at(-1)
  assertEquals(claim.p_rule_ids, [GDELT_RULE.id])
  assertEquals(w.rpcArgs("archive_start_run").at(-1), { p_rule_id: GDELT_RULE.id, p_trigger: "admin" })
  assert(w.rpcCalls("archive_claim_due_rules").every((c) => c.headers.get("apikey") === SERVICE_KEY), "service calls use the service key")
} })

Deno.test({ name: "a cron run: claim, alias index, start/ingest/finish per rule with §8 items, errors logged, hub subscribed, lease renewed", ...opts, fn: async () => {
  stubDatabase()
  const res = await cron({ max_rules: 9 })
  const out = await res.json()
  assertEquals([res.status, out.ok, out.trigger, out.dry_run], [200, true, "cron", false])
  const claim = w.rpcArgs("archive_claim_due_rules")[0]
  assertEquals([claim.p_limit, claim.p_rule_ids, typeof claim.p_owner], [6, null, "string"], "at most 6 rules per invocation")
  assertEquals(w.rpcArgs("archive_start_run"), [{ p_rule_id: GDELT_RULE.id, p_trigger: "cron" }, { p_rule_id: RSS_RULE.id, p_trigger: "cron" }])
  const ingests = w.rpcArgs("archive_ingest")
  assertEquals(ingests.map((i) => i.p_run_id), ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"])
  const keys = ["provider", "rule_id", "external_id", "url", "canonical_url", "title", "excerpt", "publisher", "language", "published_at", "source_kind", "reliability", "classification", "detected", "keys", "raw"].sort()
  for (const item of ingests.flatMap((i) => i.p_items)) assertEquals(Object.keys(item).sort(), keys, "§8 item keys")
  const lotte = ingests[0].p_items.find((i: { canonical_url: string }) => i.canonical_url === "https://yna.co.kr/view/AKR20261015123400005")
  assertEquals([lotte.keys.alias_project_id, lotte.classification.label, lotte.rule_id], [PROJECT, "facade_project", GDELT_RULE.id])
  assert(ingests[1].p_items.every((i: { provider: string }) => i.provider === "rss"))
  // GDELT got the documented query; the feed was asked conditionally with the stored ETag.
  const g = w.outbound().find((c) => c.url.host === "api.gdeltproject.org")!
  assertEquals([g.url.searchParams.get("mode"), g.url.searchParams.get("format"), g.url.searchParams.get("maxrecords"), g.url.searchParams.get("sort"), g.url.searchParams.get("timespan")], ["ArtList", "json", "250", "DateDesc", "3m"])
  assert(/^LightArchitectureArchive\/0\.16 \(\+https:\/\/github\.com\/ymin02\/medieval_era_project; remona56@hanmail\.net\)$/.test(g.headers.get("user-agent") || ""), "descriptive User-Agent")
  assertEquals(w.outbound().find((c) => c.url.host === "www.dezeen.com")!.headers.get("if-none-match"), '"old"')
  // finish_run: the collector's counts only (ingest's accumulate in SQL) and the rule state; validators for RSS only.
  const finishes = w.rpcArgs("archive_finish_run")
  assertEquals(finishes.map((f) => f.p_status), ["success", "success"])
  assertEquals([finishes[0].p_counts.fetched, finishes[0].p_counts.errors, "kept" in finishes[0].p_counts], [7, 0, false])
  assert(!("etag" in finishes[0].p_rule_state), "no validators for GDELT")
  assertEquals([finishes[1].p_rule_state.etag, finishes[1].p_rule_state.failure_count, finishes[1].p_rule_state.backoff_until], ['"v2"', 0, null])
  assert(typeof finishes[1].p_rule_state.next_run_at === "string")
  // WebSub: the advertised hub gets a pending row first, then the subscribe request with our callback and secret.
  const upserts = w.rpcArgs("archive_websub_upsert")
  assertEquals([upserts[0].p_topic, upserts[0].p_hub, upserts[0].p_state, upserts[0].p_rule_id], ["https://www.dezeen.com/feed/", "https://pubsubhubbub.appspot.com/", "pending", RSS_RULE.id])
  assert(/^[0-9a-f]{64}$/.test(upserts[0].p_secret))
  const sub = new URLSearchParams(w.outbound().find((c) => c.url.href === "https://pubsubhubbub.appspot.com/")!.body)
  assertEquals([sub.get("hub.mode"), sub.get("hub.topic"), sub.get("hub.callback"), sub.get("hub.secret")], ["subscribe", "https://www.dezeen.com/feed/", "https://stub.supabase.co/functions/v1/archive-websub?topic=https%3A%2F%2Fwww.dezeen.com%2Ffeed%2F", upserts[0].p_secret])
  assert(w.rpcCalls("archive_websub_upsert")[0].url && w.state.calls.indexOf(w.rpcCalls("archive_websub_upsert")[0]) < w.state.calls.findIndex((c) => c.url.href === "https://pubsubhubbub.appspot.com/"), "pending before the request")
  assertEquals(w.rpcArgs("archive_websub_due"), [{ p_within_hours: 48 }])
  assert(w.outbound().some((c) => c.url.href === "https://hub.example/" && new URLSearchParams(c.body).get("hub.topic") === "https://renew.example/feed"), "lease renewed")
  assertEquals(out.websub.map((x: { action: string; ok: boolean }) => [x.action, x.ok]), [["subscribe", true], ["renew", true]])
} })

Deno.test({ name: "source failures are logged per error and the run finished as error; the next rule still runs", ...opts, fn: async () => {
  stubDatabase()
  w.state.routes.set("https://api.gdeltproject.org/api/v2/doc/doc", () => new Response("Your search contained a keyword that was too short.", { status: 200 }))
  w.state.routes.set("https://www.dezeen.com/feed/", () => new Response("gone", { status: 404 }))
  const out = await (await cron()).json()
  assertEquals(out.rules.map((r: { status: string }) => r.status), ["error", "error"])
  const logs = w.rpcArgs("archive_log_error")
  assertEquals(logs.map((l) => [l.p_stage, l.p_http, l.p_rule_id]), [["parse", null, GDELT_RULE.id], ["fetch", 404, RSS_RULE.id]])
  assertEquals(w.rpcArgs("archive_finish_run").map((f) => [f.p_status, f.p_rule_state.failure_count]), [["error", 1], ["error", 2]])
  assertEquals(w.rpcCalls("archive_ingest").length, 0)
} })

Deno.test({ name: "dry_run reads and fetches but writes nothing (no claim, run, ingest, finish or subscription) and returns samples", ...opts, fn: async () => {
  stubDatabase()
  const res = await cron({ dry_run: true, rule_ids: [GDELT_RULE.id, RSS_RULE.id] })
  const out = await res.json()
  assertEquals([res.status, out.dry_run, out.rules.length], [200, true, 2])
  for (const fn of ["archive_claim_due_rules", "archive_start_run", "archive_ingest", "archive_finish_run", "archive_log_error", "archive_websub_upsert", "archive_websub_due", "archive_record_project_update"]) {
    assertEquals(w.rpcCalls(fn).length, 0, fn + " must not be called in a dry run")
  }
  const read = w.state.calls.find((c) => c.url.pathname === "/rest/v1/archive_collection_rules")!
  assertEquals([read.method, read.url.searchParams.get("id")], ["GET", `in.(${GDELT_RULE.id},${RSS_RULE.id})`])
  assert(out.rules[0].sample.length > 0 && out.rules[0].sample[0].score >= out.rules[0].sample.at(-1).score, "samples, best first")
  assertEquals(out.rules[0].labels.facade_project >= 1, true)
  assert(!w.outbound().some((c) => c.url.host === "pubsubhubbub.appspot.com"), "no subscription in a dry run")
} })

Deno.test({ name: "a database error answers 500 with the message", ...opts, fn: async () => {
  stubDatabase()
  w.state.rpc.set("archive_claim_due_rules", () => { throw new Error("permission denied for function archive_claim_due_rules") })
  const res = await cron()
  const out = await res.json()
  assertEquals([res.status, out.ok], [500, false])
  assert(/permission denied/.test(out.error))
} })
