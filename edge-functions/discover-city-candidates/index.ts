import { authorizedSecret } from "../_shared/auth.mjs"
import { createClient } from "npm:@supabase/supabase-js@2"
import { getAdminKey } from "../_shared/media.ts"
import {
  type RawCandidate,
  type CityRow,
  fetchOverpassCityCandidates,
  fetchWikidataCityCandidates,
  relevanceForCandidate,
} from "../_shared/discovery.ts"

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

async function upsertCandidate(supabase: any, city: CityRow, c: RawCandidate) {
  const rel = relevanceForCandidate(c)

  const row = {
    city_id: city.id,
    primary_provider: c.provider,
    external_primary_id: c.provider_id,
    name: c.name,
    name_local: c.name_local || null,
    short_description: c.short_description || null,
    candidate_type: rel.inferredType || c.candidate_type || null,
    category_tags: rel.tags || c.category_tags || [],
    lat: c.lat ?? null,
    lng: c.lng ?? null,
    address_text: c.address_text || null,
    website_url: c.website_url || null,
    opening_hours_text: c.opening_hours_text || null,
    business_status: c.business_status || null,
    discovery_stage: "scored",
    publishing_status: rel.auto ? "ready" : "draft",
    relevance_score: rel.score,
    relevance_reason: rel.reason,
    confidence_score: rel.confidence,
    auto_publish_eligible: rel.auto,
    last_seen_at: new Date().toISOString(),
    source_metadata: c.metadata || {},
    updated_at: new Date().toISOString(),
  }

  const { data: existing, error: existingError } = await supabase
    .from("external_candidates")
    .select("id,publishing_status,discovery_stage")
    .eq("primary_provider", c.provider)
    .eq("external_primary_id", c.provider_id)
    .maybeSingle()

  if(existingError)throw existingError
  let candidateId = existing?.id
  if (candidateId) {
    row.publishing_status=existing.publishing_status;
    row.discovery_stage=existing.discovery_stage;
    const { error } = await supabase.from("external_candidates").update(row).eq("id", candidateId)
    if (error) throw error
  } else {
    const { data, error } = await supabase
      .from("external_candidates")
      .insert(row)
      .select("id")
      .single()
    if (error) throw error
    candidateId = data.id
  }

  const {error: linkError}=await supabase.from("provider_links").upsert({
    external_candidate_id: candidateId,
    provider: c.provider,
    provider_place_id: c.provider_id,
    provider_url: c.website_url || null,
    provider_name: c.name,
    lat: c.lat ?? null,
    lng: c.lng ?? null,
    is_primary: true,
    metadata: c.metadata || {},
  }, { onConflict: "provider,provider_place_id" })

  if(linkError)throw linkError
  const { data: clusterId, error: clusterErr } = await supabase.rpc("assign_duplicate_cluster", {
    p_candidate_id: candidateId,
  })
  if (clusterErr) throw clusterErr

  const {error: scoreError}=await supabase.from("candidate_scores").insert([
    {
      external_candidate_id: candidateId,
      model_version: "v0.9",
      score_type: "relevance",
      score: rel.score,
      reason: rel.reason,
    },
    {
      external_candidate_id: candidateId,
      model_version: "v0.9",
      score_type: "confidence",
      score: rel.confidence,
      reason: rel.reason,
    },
  ])

  if(scoreError)throw scoreError
  return { inserted: !existing, id: candidateId, cluster_id: clusterId, relevance: rel.score, confidence: rel.confidence, auto: rel.auto }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405)

  const expected = Deno.env.get("MEDIA_CRON_SECRET")
  const supplied = req.headers.get("x-aol-cron-secret")
  const adminExpected = Deno.env.get("MEDIA_ADMIN_SECRET")
  const adminSupplied = req.headers.get("x-aol-media-admin-secret")
  if (!authorizedSecret([[expected, supplied], [adminExpected, adminSupplied]])) {
    return json({ error: "unauthorized" }, 401)
  }

  let jobId:string|null=null;let supabase:any=null;
  try {
    const body = await req.json().catch(() => ({}))
    const limitCities = Math.min(Math.max(Number(body.limit_cities || 3), 1), 20)
    const candidateLimit = Math.min(Math.max(Number(body.candidate_limit_per_city || 80), 10), 200)
    const cityCode = body.city_code ? String(body.city_code) : null
    const maintenanceMode = !!body.maintenance_mode

    supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      getAdminKey(),
      { auth: { persistSession: false } },
    )

    let q = supabase
      .from("cities")
      .select("id,city_code,name_en,name_local,country_id,centroid_lat,centroid_lng,bbox_min_lat,bbox_min_lng,bbox_max_lat,bbox_max_lng,wikidata_id")
      .eq("is_active", true)
      .order("last_discovery_at", { ascending: true, nullsFirst: true })
      .order("discovery_priority", { ascending: true })
      .limit(limitCities)

    if (cityCode) q = q.eq("city_code", cityCode)

    const { data: cities, error: citiesErr } = await q
    if (citiesErr) throw citiesErr

    const { data: job, error: jobError } = await supabase
      .from("ingestion_jobs")
      .insert({
        provider: "osm_overpass",
        job_name: "discover-city-candidates",
        scope_type: cityCode ? "city" : "bootstrap",
        scope_city_id: null,
        status: "running",
        requested_by: maintenanceMode ? "cron-maintenance" : "cron-or-manual",
        started_at: new Date().toISOString(),
        metadata: { body, city_count: cities?.length || 0 },
      })
      .select()
      .single()

    if(jobError)throw jobError;jobId=job.id;
    let fetched = 0, inserted = 0, updated = 0, flagged = 0
    const report:any[] = []

    for (const city of (cities || []) as CityRow[]) {
      const osm = await fetchOverpassCityCandidates(city, candidateLimit)
      const wiki = await fetchWikidataCityCandidates(city, Math.max(10, Math.round(candidateLimit * 0.4)))
      const mergedMap = new Map<string, RawCandidate>()
      for (const item of [...osm, ...wiki]) {
        const key = `${item.provider}:${item.provider_id}`
        const prev = mergedMap.get(key)
        if (!prev) mergedMap.set(key, item)
      }
      const merged = Array.from(mergedMap.values())
      fetched += merged.length

      const cityRows:any[] = []
      for (const c of merged) {
        const info = await upsertCandidate(supabase, city, c)
        if(info.inserted)inserted += 1;else updated += 1
        if (info.auto) flagged += 1
        cityRows.push({
          id: info.id,
          name: c.name,
          provider: c.provider,
          relevance: info.relevance,
          confidence: info.confidence,
          auto_publish_eligible: info.auto,
          cluster_id: info.cluster_id,
        })
      }

      const {error: cityUpdateError}=await supabase.from("cities").update({last_discovery_at:new Date().toISOString()}).eq("id",city.id);if(cityUpdateError)throw cityUpdateError;
      report.push({
        city_code: city.city_code,
        fetched: merged.length,
        top_ready: cityRows.filter((x) => x.auto_publish_eligible).length,
        samples: cityRows.slice(0, 10),
      })
    }

    if (job?.id) {
      const {error: completionError}=await supabase.from("ingestion_jobs").update({
        status: "success",
        finished_at: new Date().toISOString(),
        fetched_count: fetched,
        inserted_count: inserted,
        updated_count: updated,
        flagged_count: flagged,
        metadata: { report },
      }).eq("id", job.id)
      if(completionError)throw completionError
    }

    return json({
      ok: true,
      fetched,
      inserted,
      updated,
      flagged,
      report,
    })
  } catch (error) {
    if(jobId&&supabase)await supabase.from("ingestion_jobs").update({status:"error",finished_at:new Date().toISOString(),error_message:String(error?.message||error).slice(0,1500)}).eq("id",jobId);
    return json({ ok: false, error: String(error?.message || error) }, 500)
  }
})
