// Runs the archive-check-links Edge Function under Deno with Supabase and every checked site stubbed: the cron secret
// only, and one batch whose URLs cover each outcome (ok, redirect, HEAD refused then ranged GET, 404, robots
// disallowed, private address, bot protection, too many redirects, an image without robots) recorded through
// archive_record_link_checks in the db track's shape {target, id, url, state, http_status}.
// Run from light-architecture/: deno test --no-config --allow-env --allow-read tests/deno/
import { assert, assertEquals, captureServe, opts, setEnv, world } from "../fixtures/archive/deno-world.ts"

setEnv()
const box = captureServe()
const w = world()
await import("../../edge-functions/archive-check-links/index.ts")
assert(box.handler, "the function registered a handler")

const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`
const DUE = [
  { target: "source", id: id(1), url: "https://ok.example/article", html: true, link_state: "unknown", consecutive_failures: 0 },
  { target: "project", id: id(2), url: "https://moved.example/old", html: true, link_state: "ok", consecutive_failures: 0 },
  { target: "source", id: id(3), url: "https://nohead.example/page", html: true, link_state: "ok", consecutive_failures: 0 },
  { target: "source", id: id(4), url: "https://gone.example/page", html: true, link_state: "ok", consecutive_failures: 2 },
  { target: "source", id: id(5), url: "https://private.example/secret/page", html: true, link_state: "ok", consecutive_failures: 0 },
  { target: "source", id: id(6), url: "http://169.254.169.254/latest/meta-data/", html: true, link_state: "unknown", consecutive_failures: 0 },
  { target: "source", id: id(7), url: "https://botwall.example/page", html: true, link_state: "ok", consecutive_failures: 0 },
  { target: "media", id: id(8), url: "https://upload.example/a.jpg", html: false, link_state: "ok", consecutive_failures: 0 },
  { target: "source", id: id(9), url: "https://loop.example/a", html: true, link_state: "ok", consecutive_failures: 0 },
]

function stub() {
  w.reset()
  w.state.rpc.set("archive_links_due", () => DUE)
  w.state.rpc.set("archive_record_link_checks", (a) => ({ updated: a.p_results.length, broken: 0, recovered: 0 }))
  const robots = (text: string) => () => new Response(text, { headers: { "content-type": "text/plain" } })
  for (const host of ["ok", "moved", "nohead", "gone", "botwall", "loop"]) w.state.routes.set(`https://${host}.example/robots.txt`, robots("User-agent: *\nDisallow: /admin"))
  w.state.routes.set("https://private.example/robots.txt", robots("User-agent: *\nDisallow: /secret/\n"))
  w.state.routes.set("https://ok.example/article", () => new Response(null, { status: 200 }))
  w.state.routes.set("https://moved.example/old", () => new Response(null, { status: 301, headers: { location: "/new" } }))
  w.state.routes.set("https://moved.example/new", () => new Response(null, { status: 200 }))
  w.state.routes.set("https://nohead.example/page", (req) => req.method === "HEAD" ? new Response(null, { status: 405 }) : new Response("x", { status: 206, headers: { "content-range": "bytes 0-0/5000" } }))
  w.state.routes.set("https://gone.example/page", () => new Response(null, { status: 404 }))
  w.state.routes.set("https://botwall.example/page", () => new Response(null, { status: 403 }))
  w.state.routes.set("https://upload.example/a.jpg", () => new Response(null, { status: 200, headers: { "content-type": "image/jpeg" } }))
  w.state.routes.set("https://loop.example/", () => new Response(null, { status: 302, headers: { location: "https://loop.example/a" + Math.random() } }))
}
const invoke = (headers: Record<string, string>, body: unknown = {}) =>
  box.handler!(new Request("http://localhost/functions/v1/archive-check-links", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }))

Deno.test({ name: "cron secret only: no secret, a wrong one or the operator secret is refused before any request", ...opts, fn: async () => {
  stub()
  const attempts: Record<string, string>[] = [{}, { "x-aol-cron-secret": "wrong" }, { "x-aol-media-admin-secret": "admin-secret" }, { authorization: "Bearer service-role-key" }]
  for (const headers of attempts) assertEquals((await invoke(headers)).status, 401, JSON.stringify(headers))
  assertEquals(w.state.calls.length, 0)
  assertEquals((await box.handler!(new Request("http://localhost/functions/v1/archive-check-links"))).status, 405)
} })

Deno.test({ name: "a batch: every outcome is recorded in the db track's shape; robots and the SSRF guard prevent the requests", ...opts, fn: async () => {
  stub()
  const res = await invoke({ "x-aol-cron-secret": "cron-secret" }, { limit: 50 })
  const out = await res.json()
  assertEquals([res.status, out.ok, out.due, out.checked, out.unchecked], [200, true, DUE.length, DUE.length, 0])
  assertEquals(w.rpcArgs("archive_links_due"), [{ p_limit: 50 }])
  const results = w.rpcArgs("archive_record_link_checks")[0].p_results as { target: string; id: string; url: string; state: string; http_status: number | null }[]
  const by = Object.fromEntries(results.map((r) => [r.id, r]))
  assertEquals([by[id(1)].state, by[id(1)].http_status], ["ok", 200])
  assertEquals([by[id(2)].state, by[id(2)].target], ["redirect", "project"])
  assertEquals([by[id(3)].state, by[id(3)].http_status], ["ok", 206], "HEAD refused, GET Range: bytes=0-0 answered")
  assertEquals([by[id(4)].state, by[id(4)].http_status], ["broken", 404], "this check failed; the SQL counts it")
  assertEquals(by[id(5)].state, "robots_disallowed")
  assertEquals(by[id(6)].state, "blocked")
  assertEquals([by[id(7)].state, by[id(7)].http_status], ["blocked", 403])
  assertEquals(by[id(8)].state, "ok")
  assertEquals(by[id(9)].state, "broken")
  for (const r of results) assertEquals(Object.keys(r).filter((k) => ["target", "id", "url", "state", "http_status"].includes(k)).length, 5, "db shape")
  // Robots: the disallowed page, the metadata address and the image's robots.txt were never requested.
  const hrefs = w.outbound().map((c) => c.url.href)
  assert(!hrefs.includes("https://private.example/secret/page"), "robots honoured")
  assert(!hrefs.some((h) => h.includes("169.254.169.254")), "SSRF guard")
  assert(!hrefs.includes("https://upload.example/robots.txt"), "images are not HTML pages")
  const ranged = w.outbound().find((c) => c.url.href === "https://nohead.example/page" && c.method === "GET")!
  assertEquals(ranged.headers.get("range"), "bytes=0-0")
  assert(w.outbound().filter((c) => c.url.host === "loop.example" && c.url.pathname !== "/robots.txt").length <= 4, "at most 3 redirects followed")
  assertEquals(Object.entries(out.states).sort(), [["blocked", 2], ["broken", 2], ["ok", 3], ["redirect", 1], ["robots_disallowed", 1]])
} })
