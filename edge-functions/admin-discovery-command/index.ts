import { createClient } from "npm:@supabase/supabase-js@2"
import { getAdminKey } from "../_shared/media.ts"

function out(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, content-type, apikey",
    },
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return out({ ok: true })
  if (req.method !== "POST") return out({ error: "POST required" }, 405)

  try {
    const auth = req.headers.get("authorization") || ""
    const token = auth.replace(/^Bearer\s+/i, "")
    if (!token) return out({ error: "missing_bearer_token" }, 401)

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!
    const admin = createClient(
      supabaseUrl,
      getAdminKey(),
      { auth: { persistSession: false } },
    )

    const { data: userData, error: userErr } = await admin.auth.getUser(token)
    if (userErr || !userData?.user) return out({ error: "invalid_session" }, 401)

    const { data: adminRow, error: adminErr } = await admin
      .from("app_admins")
      .select("user_id,role,can_run_discovery")
      .eq("user_id", userData.user.id)
      .maybeSingle()

    if (adminErr || !adminRow || !adminRow.can_run_discovery) {
      return out({ error: "admin_discovery_not_allowed" }, 403)
    }

    const body = await req.json().catch(() => ({}))
    const cityCode = String(body.city_code || "").toUpperCase()
    if (!["SEOUL","TOKYO","NEWYORK"].includes(cityCode) && !body.allow_other_city) {
      return out({ error: "city_not_bootstrap_enabled" }, 400)
    }

    const mediaAdminSecret = Deno.env.get("MEDIA_ADMIN_SECRET")
    if (!mediaAdminSecret) return out({ error: "server_missing_MEDIA_ADMIN_SECRET" }, 500)

    const payload = {
      city_code: cityCode,
      limit_cities: 1,
      candidate_limit_per_city: Math.min(
        Math.max(Number(body.candidate_limit_per_city || 100), 10),
        200,
      ),
      maintenance_mode: !!body.maintenance_mode,
    }

    const r = await fetch(`${supabaseUrl}/functions/v1/discover-city-candidates`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-aol-media-admin-secret": mediaAdminSecret,
      },
      body: JSON.stringify(payload),
    })

    const result = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
    return out({
      ok: r.ok,
      city_code: cityCode,
      requested_by: userData.user.email,
      result,
    }, r.ok ? 200 : r.status)
  } catch (e) {
    return out({ ok: false, error: String(e?.message || e) }, 500)
  }
})
