import { authorizedSecret } from "../_shared/auth.mjs"
import { createClient } from "npm:@supabase/supabase-js@2"
import { fetchCommonsInfo } from "../_shared/commons.ts"
import { cacheCommonsAsset, getAdminKey } from "../_shared/media.ts"

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405)

  const expected = Deno.env.get("MEDIA_CRON_SECRET")
  const supplied = req.headers.get("x-aol-cron-secret")
  if (!authorizedSecret([[expected, supplied]])) return json({ error: "unauthorized" }, 401)

  try {
    const body = await req.json().catch(() => ({}))
    const limit = Math.min(Math.max(Number(body.limit || 25), 1), 100)
    const forceCacheCheck = !!body.force_cache_check
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      getAdminKey(),
      { auth: { persistSession: false } },
    )

    const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
    let query = supabase
      .from("media_assets")
      .select("*,places!inner(place_code)")
      .eq("source_provider", "wikimedia_commons")
      .in("sync_status", ["active", "pending_review"])
      .order("last_rights_sync_at", { ascending: true, nullsFirst: true })
      .limit(limit)

    if (!forceCacheCheck) {
      query = query.or(`last_rights_sync_at.is.null,last_rights_sync_at.lt.${cutoff}`)
    }

    const { data: assets, error } = await query
    if (error) throw error

    const report: any[] = []

    for (const asset of assets || []) {
      const file = asset.provider_asset_id
      const placeCode = asset.places?.place_code
      if (!file || !placeCode) continue

      try {
        const info = await fetchCommonsInfo(file)
        const rightsChanged = asset.rights_fingerprint !== info.rightsFingerprint
        const sourceChanged = asset.source_sha1 !== info.sha1
        const stillAllowed = info.commercialAllowed && info.derivativesAllowed

        if (!stillAllowed) {
          // Removing the DB URL alone would leave the old public Storage URL accessible.
          if(asset.storage_path){
            const {error:removeError}=await supabase.storage.from('place-media-cache').remove([asset.storage_path]);
            if(removeError)throw removeError;
          }
          await supabase
            .from("media_assets")
            .update({
              clearance_status: "expired",
              cached_public_url: null,
              storage_path: null,
              sync_status: "pending_review",
              review_required: true,
              last_rights_sync_at: new Date().toISOString(),
              checked_at: new Date().toISOString(),
              source_metadata: {
                ...(asset.source_metadata || {}),
                last_refresh: info.rawMetadata,
              },
            })
            .eq("id", asset.id)

          await supabase.from("editorial_review_queue").insert({
            place_id: asset.place_id,
            provider: "wikimedia_commons",
            reason: "media_license_no_longer_auto_allowed",
            priority: "urgent",
            proposed_changes: {
              media_asset_id: asset.id,
              file,
              old_license: asset.license_code,
              new_license: info.licenseCode,
              source_url: info.filePage,
            },
          })

          await supabase.from("media_sync_log").insert({
            media_asset_id: asset.id,
            place_id: asset.place_id,
            provider: "wikimedia_commons",
            action: "rights_refresh",
            result: "expired_removed_from_public_view",
            old_fingerprint: asset.rights_fingerprint,
            new_fingerprint: info.rightsFingerprint,
            old_sha1: asset.source_sha1,
            new_sha1: info.sha1,
          })

          report.push({ id: asset.id, status: "expired" })
          continue
        }

        if (sourceChanged || rightsChanged || forceCacheCheck) {
          const recached = await cacheCommonsAsset(supabase, {
            placeCode,
            commonsFile: file,
            relevanceScore: asset.relevance_score,
            isCover: asset.is_cover,
            displayOrder: asset.display_order,
            allowPendingCache: true,
            reason: sourceChanged ? "source_revision_changed" : rightsChanged ? "rights_metadata_changed" : "scheduled_cache_refresh",
          })
          report.push({ id: asset.id, status: "recached", sourceChanged, rightsChanged, recached: recached.cached })
        } else {
          await supabase
            .from("media_assets")
            .update({
              last_rights_sync_at: new Date().toISOString(),
              checked_at: new Date().toISOString(),
            })
            .eq("id", asset.id)

          await supabase.from("media_sync_log").insert({
            media_asset_id: asset.id,
            place_id: asset.place_id,
            provider: "wikimedia_commons",
            action: "rights_refresh",
            result: "unchanged",
            old_fingerprint: asset.rights_fingerprint,
            new_fingerprint: info.rightsFingerprint,
            old_sha1: asset.source_sha1,
            new_sha1: info.sha1,
          })
          report.push({ id: asset.id, status: "unchanged" })
        }
      } catch (itemError) {
        await supabase
          .from("media_assets")
          .update({ sync_status: "error", review_required: true })
          .eq("id", asset.id)

        await supabase.from("media_sync_log").insert({
          media_asset_id: asset.id,
          place_id: asset.place_id,
          provider: "wikimedia_commons",
          action: "rights_refresh",
          result: "error",
          detail: { error: String((itemError as {message?: string} | null)?.message || itemError) },
        })

        report.push({ id: asset.id, status: "error", error: String((itemError as {message?: string} | null)?.message || itemError) })
      }
    }

    return json({ ok: true, checked: report.length, report })
  } catch (error) {
    return json({ ok: false, error: String((error as {message?: string} | null)?.message || error) }, 500)
  }
})
