import { authorizedSecret } from "../_shared/auth.mjs"
import { createClient } from "npm:@supabase/supabase-js@2"
import { cacheCommonsAsset, getAdminKey } from "../_shared/media.ts"

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405)

  try {
  const expected = Deno.env.get("MEDIA_ADMIN_SECRET")
  const supplied = req.headers.get("x-aol-media-admin-secret")
  if (!authorizedSecret([[expected, supplied]])) return json({ error: "unauthorized" }, 401)

    const body = await req.json()
    const placeCode = String(body.place_code || "")
    const commonsFile = String(body.commons_file || "")
    if (!placeCode || !commonsFile) {
      return json({ error: "place_code and commons_file are required" }, 400)
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      getAdminKey(),
      { auth: { persistSession: false } },
    )

    const result = await cacheCommonsAsset(supabase, {
      placeCode,
      reviewed: body.reviewed === true,
      commonsFile,
      relevanceScore: body.relevance_score ?? null,
      isCover: body.is_cover ?? false,
      displayOrder: body.display_order ?? 0,
      allowPendingCache: body.allow_pending_cache ?? true,
      reason: body.reason ?? "manual_or_candidate_promotion",
    })

    return json({ ok: true, ...result })
  } catch (error) {
    return json({ ok: false, error: String((error as {message?: string} | null)?.message || error) }, 500)
  }
})
