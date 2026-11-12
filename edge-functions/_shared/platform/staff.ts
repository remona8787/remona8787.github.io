// Staff check for Edge Functions (v2.0): the caller's own session token, the admin or editor role in app_admins, and an
// MFA session (JWT aal2) unless the operator turned require_staff_mfa off. Mirrors public.platform_staff_role().
import type { SupabaseClient } from "npm:@supabase/supabase-js@2"

function claims(token: string): Record<string, unknown> {
  try { return JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) } catch { return {} }
}

export async function requireStaff(admin: SupabaseClient, token: string, roles = ["admin", "editor"]): Promise<{ ok: true; user: string; role: string } | { ok: false; status: number; error: string }> {
  if (!token) return { ok: false, status: 401, error: "authentication_required" }
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) return { ok: false, status: 401, error: "invalid_session" }
  const { data: row } = await admin.from("app_admins").select("role").eq("user_id", data.user.id).maybeSingle()
  if (!row || !roles.includes(row.role)) return { ok: false, status: 403, error: "staff_role_required" }
  const { data: setting } = await admin.from("platform_settings").select("value").eq("key", "require_staff_mfa").maybeSingle()
  // getUser verified the token, so its claims can be read.
  if (setting?.value !== false && claims(token).aal !== "aal2") return { ok: false, status: 403, error: "mfa_required" }
  return { ok: true, user: data.user.id, role: row.role }
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") || "https://remona8787.github.io").split(",").map((s) => s.trim()).filter(Boolean)
  return {
    "Access-Control-Allow-Origin": origin && allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Headers": "authorization,apikey,content-type,x-aol-cron-secret",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  }
}
