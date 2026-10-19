// The stubbed outside world for the archive Edge Function tests (tests/deno/archive-*_test.ts): the Supabase auth and
// REST API (rpc calls answered by small in-memory handlers) and the outbound sources, all through globalThis.fetch.
// Nothing leaves the process. The SQL behind the rpc calls is the db track's (tests/archive-sql.test.mjs); these
// handlers only answer in its documented shapes.

export type Handler = (req: Request) => Response | Promise<Response>
export type Call = { url: URL; method: string; headers: Headers; body: string }
export type RpcHandler = (args: Record<string, any>, req: Request) => unknown

export const SUPABASE = "https://stub.supabase.co"
export const SERVICE_KEY = "service-role-key"
export const ANON_KEY = "anon-key"

export function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg)
}
export function assertEquals(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${msg}\n  actual:   ${a}\n  expected: ${e}`)
}

export function setEnv(extra: Record<string, string> = {}) {
  Deno.env.delete("SUPABASE_SECRET_KEYS")
  Deno.env.delete("SUPABASE_PUBLISHABLE_KEYS")
  Deno.env.set("SUPABASE_URL", SUPABASE)
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_KEY)
  Deno.env.set("SUPABASE_ANON_KEY", ANON_KEY)
  Deno.env.set("MEDIA_CRON_SECRET", "cron-secret")
  Deno.env.set("MEDIA_ADMIN_SECRET", "admin-secret")
  for (const [k, v] of Object.entries(extra)) Deno.env.set(k, v)
}

/** Captures the handler the function registers with Deno.serve instead of opening a port. */
export function captureServe() {
  const box: { handler: Handler | null } = { handler: null }
  Object.defineProperty(Deno, "serve", { value: (h: Handler) => { box.handler = h; return { finished: Promise.resolve(), shutdown: async () => {} } }, configurable: true, writable: true })
  return box
}

export const fixture = (name: string) => Deno.readTextFile(new URL("./" + name, import.meta.url))

export function world() {
  const state = {
    calls: [] as Call[],
    rpc: new Map<string, RpcHandler>(),
    tables: new Map<string, (url: URL) => unknown[]>(),
    users: new Map<string, { id: string; email: string }>(),
    // Outbound (non-Supabase) answers by URL prefix.
    routes: new Map<string, Handler>(),
  }
  const rpcCalls = (fn: string) => state.calls.filter((c) => c.url.origin === SUPABASE && c.url.pathname === "/rest/v1/rpc/" + fn)
  const rpcArgs = (fn: string) => rpcCalls(fn).map((c) => JSON.parse(c.body || "{}"))
  const outbound = () => state.calls.filter((c) => c.url.origin !== SUPABASE)
  const reset = () => { state.calls = []; state.rpc.clear(); state.tables.clear(); state.users.clear(); state.routes.clear() }

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    const body = req.method === "GET" || req.method === "HEAD" ? "" : await req.clone().text()
    state.calls.push({ url, method: req.method, headers: req.headers, body })
    if (url.origin === SUPABASE) {
      if (url.pathname === "/auth/v1/user") {
        const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
        const user = state.users.get(token)
        return user ? Response.json({ id: user.id, aud: "authenticated", role: "authenticated", email: user.email }) : Response.json({ code: 401, msg: "invalid JWT" }, { status: 401 })
      }
      const key = req.headers.get("apikey")
      if (key !== SERVICE_KEY && key !== ANON_KEY) return Response.json({ message: "bad key" }, { status: 401 })
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        const fn = url.pathname.slice("/rest/v1/rpc/".length)
        const h = state.rpc.get(fn)
        if (!h) return Response.json({ message: `function ${fn} not stubbed`, code: "PGRST202" }, { status: 404 })
        try {
          const out = await h(JSON.parse(body || "{}"), req)
          return out === undefined ? new Response(null, { status: 204 }) : Response.json(out)
        } catch (e) {
          return Response.json({ message: String((e as Error).message), code: "P0001" }, { status: 400 })
        }
      }
      const table = url.pathname.replace("/rest/v1/", "")
      const t = state.tables.get(table)
      if (t && req.method === "GET") return Response.json(t(url))
      return Response.json({ message: "unexpected " + req.method + " " + url.pathname }, { status: 400 })
    }
    const prefix = [...state.routes.keys()].sort((a, b) => b.length - a.length).find((p) => url.href.startsWith(p))
    if (!prefix) throw new TypeError("fetch failed: no route for " + url.href)
    return state.routes.get(prefix)!(req)
  }
  return { state, rpcCalls, rpcArgs, outbound, reset }
}

export const opts = { sanitizeOps: false, sanitizeResources: false }
