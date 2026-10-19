// Runs the archive-websub Edge Function under Deno with Supabase stubbed: the hub's GET verification (challenge only
// for a known pending/active topic), POST pushes with a good or bad HMAC signature (same answer, only good ones are
// ingested), unknown topics and the 2 MB cap.
// Run from light-architecture/: deno test --no-config --allow-env --allow-read tests/deno/
import { assert, assertEquals, captureServe, fixture, opts, setEnv, world } from "../fixtures/archive/deno-world.ts"

setEnv()
const box = captureServe()
const w = world()
await import("../../edge-functions/archive-websub/index.ts")
assert(box.handler, "the function registered a handler")

const TOPIC = "https://www.dezeen.com/feed/"
const RULE = "22222222-2222-4222-8222-222222222222"
const SECRET = "f".repeat(64)
const feed = await fixture("dezeen-rss.xml")

function stubDatabase(subs: Record<string, { state: string; secret?: string }> = { [TOPIC]: { state: "active", secret: SECRET } }) {
  w.reset()
  w.state.rpc.set("archive_websub_get", (a) => {
    const s = subs[a.p_topic]
    return s ? { topic: a.p_topic, hub: "https://pubsubhubbub.appspot.com/", secret: s.secret ?? SECRET, state: s.state, lease_expires_at: null, rule_id: RULE } : null
  })
  w.state.rpc.set("archive_websub_upsert", () => "44444444-4444-4444-8444-444444444444")
  w.state.rpc.set("archive_start_run", () => "00000000-0000-4000-8000-000000000009")
  w.state.rpc.set("archive_ingest", (a) => ({ kept: a.p_items.length, new_candidates: a.p_items.length, matched_projects: 0, duplicates: 0, ignored: 0, items: [] }))
  w.state.rpc.set("archive_finish_run", (a) => ({ run_id: a.p_run_id, status: a.p_status }))
  w.state.rpc.set("archive_log_error", () => undefined)
  w.state.rpc.set("archive_alias_index", () => [])
  w.state.tables.set("archive_keywords", () => [])
}
async function hmac(algorithm: "SHA-256" | "SHA-1", secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: algorithm }, false, ["sign"])
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, "0")).join("")
}
const verify = (params: Record<string, string>) => box.handler!(new Request("http://localhost/functions/v1/archive-websub?" + new URLSearchParams(params)))
const push = (headers: Record<string, string>, body = feed, topic = TOPIC) =>
  box.handler!(new Request("http://localhost/functions/v1/archive-websub?topic=" + encodeURIComponent(topic), { method: "POST", headers: { "content-type": "application/rss+xml", ...headers }, body }))

Deno.test({ name: "GET: the challenge is echoed only for a known pending/active topic, which becomes active with the hub's lease", ...opts, fn: async () => {
  stubDatabase({ [TOPIC]: { state: "pending" } })
  const ok = await verify({ "hub.mode": "subscribe", "hub.topic": TOPIC, "hub.challenge": "challenge-123", "hub.lease_seconds": "432000" })
  assertEquals([ok.status, await ok.text()], [200, "challenge-123"])
  assertEquals(w.rpcArgs("archive_websub_upsert"), [{ p_topic: TOPIC, p_hub: null, p_secret: null, p_state: "active", p_lease_seconds: 432000, p_rule_id: null }])
  const unknown = await verify({ "hub.mode": "subscribe", "hub.topic": "https://evil.example/feed", "hub.challenge": "x" })
  const body = await unknown.text()
  assertEquals(unknown.status, 404)
  assert(!body.includes("x") || body === "unknown topic", "no challenge for an unknown topic")
  assertEquals(w.rpcCalls("archive_websub_upsert").length, 1, "an unknown topic changes nothing")
  stubDatabase({ [TOPIC]: { state: "expired" } })
  assertEquals((await verify({ "hub.mode": "subscribe", "hub.topic": TOPIC, "hub.challenge": "c" })).status, 404, "an ended subscription is not re-activated by the hub")
  assertEquals((await verify({})).status, 400)
  stubDatabase({ [TOPIC]: { state: "active" } })
  const un = await verify({ "hub.mode": "unsubscribe", "hub.topic": TOPIC, "hub.challenge": "bye" })
  assertEquals([un.status, await un.text(), w.rpcArgs("archive_websub_upsert")[0].p_state], [200, "bye", "expired"])
} })

Deno.test({ name: "POST with a valid X-Hub-Signature-256: parsed, prefiltered and ingested as a websub run of the subscription's rule", ...opts, fn: async () => {
  stubDatabase()
  const res = await push({ "x-hub-signature-256": "sha256=" + await hmac("SHA-256", SECRET, feed) })
  assertEquals([res.status, await res.json()], [202, { received: true }])
  assertEquals(w.rpcArgs("archive_start_run"), [{ p_rule_id: RULE, p_trigger: "websub" }])
  const items = w.rpcArgs("archive_ingest")[0].p_items
  assertEquals(items.length, 2, "the kitchen lookbook has no positive keyword")
  assert(items.every((i: { provider: string; rule_id: string }) => i.provider === "websub" && i.rule_id === RULE))
  assertEquals(w.rpcArgs("archive_finish_run")[0].p_status, "success")
  assertEquals(w.rpcCalls("archive_log_error").length, 0)
  // sha1 (X-Hub-Signature) is accepted too.
  stubDatabase()
  assertEquals((await push({ "x-hub-signature": "sha1=" + await hmac("SHA-1", SECRET, feed) })).status, 202)
  assertEquals(w.rpcCalls("archive_ingest").length, 1)
} })

Deno.test({ name: "POST with a bad or missing signature: the same 202, nothing ingested, the rejection logged", ...opts, fn: async () => {
  for (const headers of [{ "x-hub-signature-256": "sha256=" + await hmac("SHA-256", "wrong-secret", feed) }, { "x-hub-signature-256": "sha256=" + "0".repeat(64) }, {} as Record<string, string>]) {
    stubDatabase()
    const res = await push(headers)
    assertEquals([res.status, await res.json()], [202, { received: true }], JSON.stringify(headers))
    assertEquals([w.rpcCalls("archive_start_run").length, w.rpcCalls("archive_ingest").length], [0, 0])
    const log = w.rpcArgs("archive_log_error")
    assertEquals([log.length, log[0].p_stage, log[0].p_rule_id, log[0].p_url], [1, "websub", RULE, TOPIC])
    assert(/push ignored: (signature_mismatch|missing_signature)/.test(log[0].p_message), log[0].p_message)
  }
  // A body changed after signing fails too.
  stubDatabase()
  await push({ "x-hub-signature-256": "sha256=" + await hmac("SHA-256", SECRET, feed) }, feed.replace("Dezeen", "Forged"))
  assertEquals(w.rpcCalls("archive_ingest").length, 0)
} })

Deno.test({ name: "POST for an unknown or ended topic answers 410; bodies over 2 MB answer 413 before any database call", ...opts, fn: async () => {
  stubDatabase()
  const res = await push({ "x-hub-signature-256": "sha256=00" }, feed, "https://unknown.example/feed")
  assertEquals(res.status, 410)
  stubDatabase({ [TOPIC]: { state: "failed" } })
  assertEquals((await push({ "x-hub-signature-256": "sha256=" + await hmac("SHA-256", SECRET, feed) })).status, 410)
  stubDatabase()
  const big = "x".repeat(2 * 1024 * 1024 + 1)
  const tooBig = await push({ "x-hub-signature-256": "sha256=00" }, big)
  assertEquals(tooBig.status, 413)
  assertEquals(w.state.calls.length, 0)
  assertEquals((await box.handler!(new Request("http://localhost/functions/v1/archive-websub", { method: "PUT" }))).status, 405)
} })
