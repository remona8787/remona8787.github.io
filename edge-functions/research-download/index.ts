// Member research datasets (docs/RESEARCH_DATA.md; migration 20261026000000_research_data.sql).
// POST {"dataset": "<id>", "version": "1.0.0", "format": "csv|json|geojson|xlsx"} with Authorization: Bearer <user JWT>.
// The user is resolved from their own token; public.research_download_check (service role only) decides: an active
// 'member' dataset, an existing version and format, and a research profile with both consents. The answer is a signed
// URL to the private bucket 'research-datasets' valid for SIGNED_URL_SECONDS, with the licence, citation and checksum.
// Every request with a valid session is logged in public.research_downloads (ok or the error code); at most
// HOURLY_LIMIT successful downloads per user per hour. The secret key comes from the function's environment only.
import { createClient } from "npm:@supabase/supabase-js@2"
import { getAdminKey } from "../_shared/media.ts"

const SIGNED_URL_SECONDS = 300
const HOURLY_LIMIT = 30
const FORMATS = new Set(["csv", "json", "geojson", "xlsx"])
const ID = /^[a-z0-9][a-z0-9-]{2,63}$/
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") || "https://remona8787.github.io").split(",").map((s) => s.trim()).filter(Boolean)
  return {
    "Access-Control-Allow-Origin": origin && allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Headers": "authorization,apikey,content-type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  }
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get("origin"))
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers })
  if (req.method === "OPTIONS") return new Response(null, { headers })
  if (req.method !== "POST") return json({ error: "POST required" }, 405)
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")
  if (!token) return json({ error: "authentication_required" }, 401)
  let body: { dataset?: unknown; version?: unknown; format?: unknown }
  try { body = await req.json() } catch { return json({ error: "invalid_json" }, 400) }
  const dataset = typeof body.dataset === "string" ? body.dataset : ""
  const version = typeof body.version === "string" ? body.version : ""
  const format = typeof body.format === "string" ? body.format : ""
  if (!ID.test(dataset) || !VERSION.test(version) || !FORMATS.has(format)) return json({ error: "invalid_request" }, 400)

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, getAdminKey(), { auth: { persistSession: false } })
  const { data: who, error: authError } = await admin.auth.getUser(token)
  if (authError || !who.user) return json({ error: "invalid_session" }, 401)
  if (!who.user.email_confirmed_at) return json({ error: "email_not_confirmed" }, 403)
  const user = who.user.id
  const log = (ok: boolean, error: string | null) =>
    admin.from("research_downloads").insert({ user_id: user, dataset_id: dataset, version, format, ok, error })

  const since = new Date(Date.now() - 3600_000).toISOString()
  const { count, error: countError } = await admin.from("research_downloads").select("id", { count: "exact", head: true })
    .eq("user_id", user).eq("ok", true).gte("requested_at", since)
  if (countError) return json({ error: "temporarily_unavailable" }, 503)
  if ((count ?? 0) >= HOURLY_LIMIT) { await log(false, "rate_limited"); return json({ error: "rate_limited" }, 429) }

  const { data: check, error: checkError } = await admin.rpc("research_download_check", { p_user: user, p_dataset: dataset, p_version: version, p_format: format })
  if (checkError) return json({ error: "temporarily_unavailable" }, 503)
  if (!check?.ok) {
    await log(false, String(check?.error || "not_allowed"))
    const status = check?.error === "profile_and_consent_required" ? 403 : check?.error === "institution_agreement_required" ? 403 : 404
    return json({ error: check?.error || "not_allowed" }, status)
  }
  const fileName = `${dataset}-${version}.${format}`
  const { data: signed, error: signError } = await admin.storage.from("research-datasets").createSignedUrl(check.path, SIGNED_URL_SECONDS, { download: fileName })
  if (signError || !signed?.signedUrl) { await log(false, "file_unavailable"); return json({ error: "file_unavailable" }, 503) }
  await log(true, null)
  return json({
    url: signed.signedUrl, expires_in: SIGNED_URL_SECONDS, file_name: fileName,
    licence: check.licence, licence_url: check.licence_url, citation: check.citation, sha256: check.sha256 ?? null,
    data_as_of: check.data_as_of, record_count: check.record_count,
  })
})
