// Global media facade archive: automatic collection (docs/ARCHIVE_SPEC.md §2, §3, §5; docs/ARCHIVE_COLLECTOR.md).
// Called hourly by pg_cron (release/launch/install-six-hour-sync.sql, minute 17) with the cron shared secret, or by an
// editor/admin from the admin console ("지금 실행") with their own session. Each invocation claims at most 6 due rules
// (archive_claim_due_rules: each rule has its own cadence and backoff), runs them through the shared pipeline
// (_shared/archive/), ingests the items (archive_ingest), finishes every run with its rule state, subscribes to hubs
// that feeds advertise and renews WebSub leases ending within 48 hours. One invocation stays under 130 s.
// Body (all optional): {"rule_ids": [uuid…] | "rule_id": uuid, "max_rules": 1-6, "dry_run": false}
//   dry_run: reads rules, the alias index and keywords, fetches and classifies, and writes NOTHING (no claim, run,
//   ingest or subscription); the answer carries the top items per rule.
// Auth: x-aol-cron-secret = MEDIA_CRON_SECRET (cron) or x-aol-media-admin-secret = MEDIA_ADMIN_SECRET (operator),
// or Authorization: Bearer <user JWT> of an editor or admin (archive_role(), checked with the user's own token),
// which must name the rules to run. Keys of optional sources (NAVER_API_KEY_ID/NAVER_API_KEY/NAVER_API_MODE,
// BRAVE_API_KEY) and WEBSUB_CALLBACK_URL come from the function's secrets only.
import { authorizedSecret } from "../_shared/auth.mjs"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"
import { getAdminKey } from "../_shared/media.ts"
import { runCollect, MAX_RULES } from "../_shared/archive/service.mjs"

const BUDGET_MS = 130000
const DB_TIMEOUT_MS = 20000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...CORS } })
}
const message = (e: unknown) => String((e as { message?: string } | null)?.message || e).slice(0, 300)
const withTimeout = (signal: AbortSignal | null | undefined, ms: number) => signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)
// Database requests (PostgREST, auth) never wait longer than DB_TIMEOUT_MS each.
const dbFetch = (input: string | URL | Request, init: RequestInit = {}) => fetch(input, { ...init, signal: withTimeout(init.signal, DB_TIMEOUT_MS) })

// The key a user-token client is created with: the project's publishable (or legacy anon) key. The user's JWT in
// Authorization decides the database role, so archive_role() sees the user, never the service role.
function publicKey(): string {
  const packed = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")
  if (packed) {
    try { const keys = JSON.parse(packed); if (keys?.default) return keys.default } catch { /* fall through */ }
  }
  return Deno.env.get("SUPABASE_ANON_KEY") || getAdminKey()
}

function ruleIdsOf(body: Record<string, unknown>): string[] | null | "invalid" {
  const raw = body.rule_ids ?? (body.rule_id != null ? [body.rule_id] : null)
  if (raw == null) return null
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_RULES) return "invalid"
  const ids = raw.map((x) => String(x))
  return ids.every((id) => UUID.test(id)) ? [...new Set(ids)] : "invalid"
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })
  if (req.method !== "POST") return json({ error: "POST required" }, 405)
  const started = Date.now()

  const cron = authorizedSecret([[Deno.env.get("MEDIA_CRON_SECRET"), req.headers.get("x-aol-cron-secret")]])
  const operator = authorizedSecret([[Deno.env.get("MEDIA_ADMIN_SECRET"), req.headers.get("x-aol-media-admin-secret")]])
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim()
  if (!cron && !operator && !token) return json({ error: "unauthorized" }, 401)

  const raw = await req.json().catch(() => ({}))
  const body: Record<string, unknown> = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
  const ruleIds = ruleIdsOf(body)
  if (ruleIds === "invalid") return json({ error: "invalid_rule_ids", max: MAX_RULES }, 400)
  const maxRules = Math.min(Math.max(Math.floor(Number(body.max_rules ?? MAX_RULES)) || MAX_RULES, 1), MAX_RULES)
  const dryRun = body.dry_run === true

  try {
    const url = Deno.env.get("SUPABASE_URL")!
    const db: SupabaseClient = createClient(url, getAdminKey(), { auth: { persistSession: false }, global: { fetch: dbFetch } })
    let trigger: "cron" | "admin" = cron ? "cron" : "admin"
    let requestedBy: string | null = null
    if (!cron && !operator) {
      // An editor's "지금 실행": a valid session, then the archive role read with the user's own token.
      const { data: userData, error: userError } = await db.auth.getUser(token)
      if (userError || !userData?.user) return json({ error: "invalid_session" }, 401)
      const asUser = createClient(url, publicKey(), { auth: { persistSession: false }, global: { fetch: dbFetch, headers: { Authorization: `Bearer ${token}` } } })
      const { data: role, error: roleError } = await asUser.rpc("archive_role")
      if (roleError) return json({ error: "role_check_failed" }, 500)
      if (role !== "editor" && role !== "admin") return json({ error: "editor_role_required" }, 403)
      if (!ruleIds) return json({ error: "rule_ids_required" }, 400)
      requestedBy = userData.user.id
      trigger = "admin"
    }
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await db.rpc(fn, args)
      if (error) throw new Error(`${fn}: ${error.message}`)
      return data
    }
    // Dry runs read the rules without claiming them (a claim marks them running).
    const readRules = async ({ ruleIds, limit }: { ruleIds: string[] | null; limit: number }) => {
      let q = db.from("archive_collection_rules").select("*")
      q = ruleIds ? q.in("id", ruleIds) : q.eq("enabled", true).neq("kind", "websub").order("next_run_at", { ascending: true, nullsFirst: true }).limit(limit)
      const { data, error } = await q
      if (error) throw new Error("archive_collection_rules: " + error.message)
      return data ?? []
    }
    const readKeywords = async () => {
      const { data, error } = await db.from("archive_keywords").select("term,language,polarity,weight,enabled").eq("enabled", true).limit(10000)
      if (error) throw new Error("archive_keywords: " + error.message)
      return data
    }
    const result = await runCollect({
      rpc, readRules, readKeywords, trigger, ruleIds, maxRules, dryRun,
      owner: crypto.randomUUID(), deadline: started + BUDGET_MS, getEnv: (name: string) => Deno.env.get(name),
    })
    return json({ ok: true, trigger, dry_run: dryRun, requested_by: requestedBy, ms: Date.now() - started, ...result })
  } catch (error) {
    return json({ ok: false, dry_run: dryRun, error: message(error) }, 500)
  }
})
