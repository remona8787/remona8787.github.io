import {downloadCommonsImage} from './image-download.ts'
import type { SupabaseClient } from "npm:@supabase/supabase-js@2"
import { extensionForMime, fetchCommonsInfo, safeSlug } from "./commons.ts"

export function getAdminKey(): string {
  const packed = Deno.env.get("SUPABASE_SECRET_KEYS")
  if (packed) {
    try {
      const keys = JSON.parse(packed)
      if (keys?.default) return keys.default
    } catch {}
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (legacy) return legacy
  throw new Error("Missing Supabase server-side secret key")
}

export async function cacheCommonsAsset(
  supabase: SupabaseClient,
  args: {
    placeCode: string
    commonsFile: string
    relevanceScore?: number | null
    isCover?: boolean
    displayOrder?: number
    reviewed?: boolean
    allowPendingCache?: boolean
    reason?: string
  },
) {
  const { data: place, error: placeError } = await supabase
    .from("places")
    .select("id,place_code,name_kr")
    .eq("place_code", args.placeCode)
    .single()
  if (placeError || !place) throw new Error(`Place not found: ${args.placeCode}`)

  const info = await fetchCommonsInfo(args.commonsFile)
  const isCleared = info.commercialAllowed && info.derivativesAllowed
  const { data: existing, error: existingError } = await supabase
    .from("media_assets")
    .select("*")
    .eq("place_id", place.id)
    .eq("source_provider", "wikimedia_commons")
    .eq("provider_asset_id", args.commonsFile)
    .maybeSingle()

  if(existingError)throw existingError
  const rightsChanged=!!existing?.rights_fingerprint && existing.rights_fingerprint!==info.rightsFingerprint
  const previouslyApproved=existing?.clearance_status==='cleared' && !existing?.review_required && !rightsChanged
  if(!isCleared || (!args.reviewed && !previouslyApproved)){
    // Pending/changed rights never enter a public bucket, even if allowPendingCache was supplied.
    const pending={place_id:place.id,source_provider:'wikimedia_commons',provider_asset_id:args.commonsFile,
      source_url:info.filePage,original_file_url:info.originalUrl,creator:info.creator,license_code:info.licenseCode,
      license_url:info.licenseUrl,attribution_text:info.attributionText,rights_fingerprint:info.rightsFingerprint,
      source_sha1:info.sha1,source_modified_at:info.modifiedAt,last_rights_sync_at:new Date().toISOString(),
      clearance_status:'pending',sync_status:'pending_review',review_required:true,cached_public_url:null,storage_path:null}
    const result=existing?.id?await supabase.from('media_assets').update(pending).eq('id',existing.id):await supabase.from('media_assets').insert(pending)
    if(result.error)throw result.error
    if(existing?.storage_path){const {error}=await supabase.storage.from('place-media-cache').remove([existing.storage_path]);if(error)throw error}
    return {cached:false,clearanceStatus:'pending',reason:'editorial-review-required',info}
  }
  const ext = extensionForMime(info.mime)
  const path = `places/${place.place_code}/${info.sha1 || Date.now()}-${safeSlug(args.commonsFile)}.${ext}`
  const body = await downloadCommonsImage(info.cacheSourceUrl,info.mime)

  const { error: uploadError } = await supabase.storage
    .from("place-media-cache")
    .upload(path, body, {
      contentType: info.mime,
      cacheControl: "21600",
      upsert: false,
    })
  if (uploadError && !String(uploadError.message || "").toLowerCase().includes("already exists")) {
    throw uploadError
  }

  const { data: publicUrlData } = supabase.storage
    .from("place-media-cache")
    .getPublicUrl(path)
  const publicUrl = publicUrlData.publicUrl

  const sourceChanged = !!existing?.source_sha1
    && existing.source_sha1 !== info.sha1

  if (rightsChanged) {
    await supabase.from("editorial_review_queue").insert({
      place_id: place.id,
      provider: "wikimedia_commons",
      reason: "media_rights_metadata_changed",
      priority: "high",
      proposed_changes: {
        media_asset_id: existing?.id,
        file: args.commonsFile,
        old_fingerprint: existing?.rights_fingerprint,
        new_fingerprint: info.rightsFingerprint,
        old_license: existing?.license_code,
        new_license: info.licenseCode,
        source_url: info.filePage,
      },
    })
  }

  const row = {
    place_id: place.id,
    asset_kind: "image",
    storage_path: path,
    cached_public_url: publicUrl,
    cached_at: new Date().toISOString(),
    source_provider: "wikimedia_commons",
    provider_asset_id: args.commonsFile,
    source_file_name: args.commonsFile,
    source_url: info.filePage,
    original_file_url: info.originalUrl,
    creator: info.creator,
    copyright_holder: info.creator,
    license_code: info.licenseCode,
    license_url: info.licenseUrl,
    rights_statement: info.rightsStatement,
    attribution_text: info.attributionText,
    commercial_use_allowed: info.commercialAllowed,
    derivatives_allowed: info.derivativesAllowed,
    clearance_status: isCleared ? "cleared" : "pending",
    checked_at: new Date().toISOString(),
    last_rights_sync_at: new Date().toISOString(),
    source_sha1: info.sha1,
    source_modified_at: info.modifiedAt,
    source_metadata: {
      commons_file: args.commonsFile,
      cache_source_url: info.cacheSourceUrl,
      raw: info.rawMetadata,
      reason: args.reason || null,
    },
    rights_fingerprint: info.rightsFingerprint,
    sync_status: isCleared ? "active" : "pending_review",
    review_required: false,
    relevance_score: args.relevanceScore ?? existing?.relevance_score ?? null,
    is_cover: args.isCover ?? existing?.is_cover ?? false,
    display_order: args.displayOrder ?? existing?.display_order ?? 0,
    cache_version: (existing?.cache_version ?? 0) + (sourceChanged ? 1 : existing ? 0 : 1),
  }

  let saved: any
  if (existing?.id) {
    const result = await supabase
      .from("media_assets")
      .update(row)
      .eq("id", existing.id)
      .select()
      .single()
    if (result.error) throw result.error
    saved = result.data
  } else {
    const result = await supabase
      .from("media_assets")
      .insert(row)
      .select()
      .single()
    if (result.error) throw result.error
    saved = result.data
  }

  if (sourceChanged && existing?.storage_path && existing.storage_path !== path) {
    try {
      await supabase.storage.from("place-media-cache").remove([existing.storage_path])
    } catch {}
  }

  await supabase.from("media_sync_log").insert({
    media_asset_id: saved.id,
    place_id: place.id,
    provider: "wikimedia_commons",
    action: existing ? "recache" : "initial_cache",
    result: isCleared ? "cached_cleared" : "cached_pending",
    old_fingerprint: existing?.rights_fingerprint ?? null,
    new_fingerprint: info.rightsFingerprint,
    old_sha1: existing?.source_sha1 ?? null,
    new_sha1: info.sha1,
    detail: {
      file: args.commonsFile,
      rights_changed: rightsChanged,
      source_changed: sourceChanged,
      storage_path: path,
    },
  })

  return {
    cached: true,
    mediaAsset: saved,
    info,
    rightsChanged,
    sourceChanged,
    clearanceStatus: row.clearance_status,
  }
}
