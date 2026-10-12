import { authorizedSecret } from "../_shared/auth.mjs"
import { createClient } from "npm:@supabase/supabase-js@2"
import { getAdminKey } from "../_shared/media.ts"

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405)

  const expected = Deno.env.get("MEDIA_ADMIN_SECRET")
  const supplied = req.headers.get("x-aol-media-admin-secret")
  if (!authorizedSecret([[expected, supplied]])) return json({ error: "unauthorized" }, 401)

  try {
    const body = await req.json()
    const candidateId = String(body.candidate_id || "")
    const placeCode = body.place_code ? String(body.place_code) : null
    if (!candidateId) return json({ error: "candidate_id is required" }, 400)

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      getAdminKey(),
      { auth: { persistSession: false } },
    )

    const { data, error } = await supabase.rpc("promote_candidate_to_place", {
      p_candidate_id: candidateId,
      p_place_code: placeCode,
    })
    if (error) throw error

    return json({ ok: true, place_id: data })
  } catch (error) {
    return json({ ok: false, error: String((error as {message?: string} | null)?.message || error) }, 500)
  }
})
