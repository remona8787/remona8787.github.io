// Publishes a member photo after a person approved it (v2.0, docs/PLATFORM.md "Photos").
// POST {"photo_id": 123} with the staff member's own session token (admin or editor, MFA session).
// POST {"photo_id": 123, "action": "remove", "reason": "..."} takes a published photo down (a copyright notice, a
// moderation decision): the status becomes removed and the public file is deleted. Browsers and CDNs may keep a cached
// copy for up to the cache lifetime (1 hour) after removal. Reads the upload
// from the private bucket community-uploads, checks it again (signature, size, dimensions), removes metadata (EXIF and
// GPS, text chunks, trailing bytes), writes the clean file to the public bucket community-photos as
// <project_id>/<photo_id>.<ext>, and records it (platform_photo_published). The original upload is then deleted.
import { createClient } from "npm:@supabase/supabase-js@2"
import { getAdminKey } from "../_shared/media.ts"
import { checkImage, hasExif } from "../_shared/platform/image-check.mjs"
import { requireStaff, corsHeaders } from "../_shared/platform/staff.ts"

Deno.serve(async (req) => {
  const headers = corsHeaders(req.headers.get("origin"))
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers })
  if (req.method === "OPTIONS") return new Response(null, { headers })
  if (req.method !== "POST") return json({ error: "POST required" }, 405)
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, getAdminKey(), { auth: { persistSession: false } })
  const staff = await requireStaff(admin, (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""))
  if (!staff.ok) return json({ error: staff.error }, staff.status)
  let body: { photo_id?: unknown; action?: unknown; reason?: unknown }
  try { body = await req.json() } catch { return json({ error: "invalid_json" }, 400) }
  const id = Number(body.photo_id)
  if (!Number.isSafeInteger(id) || id <= 0) return json({ error: "invalid_request" }, 400)
  if (body.action === "remove") {
    const reason = typeof body.reason === "string" ? body.reason.trim() : ""
    if (!reason) return json({ error: "reason_required" }, 400)
    const { data: p } = await admin.from("community_photos").select("public_path,upload_path").eq("id", id).single()
    if (!p) return json({ error: "not_found" }, 404)
    // The decision runs as the staff member (their token), so the audit log names them.
    const asStaff = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!, { global: { headers: { Authorization: req.headers.get("authorization")! } }, auth: { persistSession: false } })
    const { error: modError } = await asStaff.rpc("platform_moderate", { p_type: "photo", p_id: id, p_decision: "removed", p_reason: reason })
    if (modError) return json({ error: "moderation_failed" }, 409)
    if (p.public_path) await admin.storage.from("community-photos").remove([p.public_path])
    await admin.storage.from("community-uploads").remove([p.upload_path])
    return json({ ok: true, removed: true })
  }
  const { data: photo } = await admin.from("community_photos").select("id,project_id,upload_path,mime,status").eq("id", id).single()
  if (!photo || !["pending", "needs_review"].includes(photo.status)) return json({ error: "not_reviewable" }, 409)
  const { data: file, error: dlError } = await admin.storage.from("community-uploads").download(photo.upload_path)
  if (dlError || !file) return json({ error: "upload_missing" }, 404)
  const checked = checkImage(new Uint8Array(await file.arrayBuffer()), { claimedMime: photo.mime })
  if (!checked.ok) return json({ error: "image_rejected", reason: checked.error }, 422)
  if (checked.mime === "image/png") return json({ error: "image_rejected", reason: "png_must_be_reencoded" }, 422)
  if (checked.mime === "image/jpeg" && hasExif(checked.bytes)) return json({ error: "image_rejected", reason: "metadata_left" }, 422)
  const ext = checked.mime === "image/webp" ? "webp" : "jpg"
  const path = `${photo.project_id}/${photo.id}.${ext}`
  const { error: upError } = await admin.storage.from("community-photos").upload(path, checked.bytes, { contentType: checked.mime, upsert: true, cacheControl: "3600" })
  if (upError) return json({ error: "publish_failed" }, 503)
  const { error: recError } = await admin.rpc("platform_photo_published", { p_id: id, p_public_path: path, p_actor: staff.user })
  if (recError) { await admin.storage.from("community-photos").remove([path]); return json({ error: "record_failed" }, 409) }
  await admin.storage.from("community-uploads").remove([photo.upload_path])
  return json({ ok: true, public_path: path, removed: checked.removed, width: checked.width, height: checked.height })
})
