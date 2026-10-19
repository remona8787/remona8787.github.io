// Daily link and image checks of the media facade archive (docs/ARCHIVE_SPEC.md §3 "Link and image checks", §5).
// Cron secret only (release/launch/install-six-hour-sync.sql, 03:20 KST). Takes the oldest-checked URLs
// (archive_links_due: sources, cleared media, official project URLs), checks each once (_shared/archive/linkcheck.mjs:
// SSRF guard, robots.txt for HTML pages, HEAD then GET Range: bytes=0-0, at most 3 redirects, 1 request per second per
// host) and records the results (archive_record_link_checks), which counts consecutive failures, sets link_state
// broken after three, hides broken images and opens link_broken / image_broken project updates. Under 130 s; URLs not
// reached stay due for the next run.
// Body (optional): {"limit": 1-500}
import { authorizedSecret } from "../_shared/auth.mjs"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"
import { getAdminKey } from "../_shared/media.ts"
import { checkLinks } from "../_shared/archive/linkcheck.mjs"

const BUDGET_MS = 120000
const DB_TIMEOUT_MS = 20000

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } })
}
const message = (e: unknown) => String((e as { message?: string } | null)?.message || e).slice(0, 300)
const withTimeout = (signal: AbortSignal | null | undefined, ms: number) => signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)
const dbFetch = (input: string | URL | Request, init: RequestInit = {}) => fetch(input, { ...init, signal: withTimeout(init.signal, DB_TIMEOUT_MS) })

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405)
  if (!authorizedSecret([[Deno.env.get("MEDIA_CRON_SECRET"), req.headers.get("x-aol-cron-secret")]])) return json({ error: "unauthorized" }, 401)
  const started = Date.now()
  const raw = await req.json().catch(() => ({}))
  const body: Record<string, unknown> = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
  const limit = Math.min(Math.max(Math.floor(Number(body.limit ?? 120)) || 120, 1), 500)
  try {
    const db: SupabaseClient = createClient(Deno.env.get("SUPABASE_URL")!, getAdminKey(), { auth: { persistSession: false }, global: { fetch: dbFetch } })
    const { data: due, error: dueError } = await db.rpc("archive_links_due", { p_limit: limit })
    if (dueError) throw new Error("archive_links_due: " + dueError.message)
    const { results, unchecked } = await checkLinks(due ?? [], { deadline: started + BUDGET_MS })
    let recorded: unknown = null
    if (results.length) {
      const { data, error } = await db.rpc("archive_record_link_checks", { p_results: results })
      if (error) throw new Error("archive_record_link_checks: " + error.message)
      recorded = data
    }
    const states: Record<string, number> = {}
    for (const r of results) states[r.state] = (states[r.state] || 0) + 1
    return json({ ok: true, due: (due ?? []).length, checked: results.length, unchecked, states, recorded, ms: Date.now() - started })
  } catch (error) {
    return json({ ok: false, error: message(error) }, 500)
  }
})
