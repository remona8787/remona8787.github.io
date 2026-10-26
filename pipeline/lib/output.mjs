// The published dataset (docs/STATIC_ARCHIVE.md "Output", served at /data/): full records sharded by a stable hash
// of the id, a compact index for list/search/map, the home picks, statistics and the manifest.
// Field names follow docs/ARCHIVE_SPEC.md §6 (client fields) plus images[], sources[] and visit; a fact without a
// source is null. docs/PIPELINE.md documents every field.
import T from '../../site-public-cleared/archive-taxonomy.js'
import { fnv1a, round, compareStrings, sha256, stableStringify } from './util.mjs'
import { stableImageId, cleanMediaUrl, THUMB_STEPS, kindOfTier, rightsUse } from './images.mjs'

export const DATA_SCHEMA = 1
// The v0.17 fields first (readers find columns by name), then v0.18: kr_region, and the thumbnail's size.
export const INDEX_FIELDS = ['id', 'name_ko', 'name_en', 'name_original', 'country_iso2', 'city', 'lat', 'lng', 'project_type', 'year', 'thumb', 'visual_rank', 'shard', 'added_at', 'kr_region', 'thumb_w', 'thumb_h', 'city_ko', 'district']
export const SHARD_TARGET = 200

/** Number of shards: a power of two, so ids move between shards only when the archive doubles. */
export function shardCount(n, target = SHARD_TARGET) {
  let s = 1
  while (n / s > target) s *= 2
  return s
}
export const shardOf = (id, count) => String(fnv1a(id) % count).padStart(3, '0')

const coord = (v) => (typeof v === 'number' && Number.isFinite(v) ? round(v, 5) : null)
const yearOf = (r) => r.year_installed ?? r.year_completed ?? r.year_operating_since ?? null

/**
 * The public image object (docs/STATIC_ARCHIVE.md v0.18 "Data fields"; what the records, the home picks and the index
 * use), with a fixed key order. thumb and attribution are kept for the v0.17 app.
 */
export function imageOut(img) {
  if (!img) return null
  return {
    id: img.id, project: img.project ?? null, provider: img.provider, src: img.src, page: img.page, display: img.display || [], thumb: img.thumb,
    author: img.author ?? null, rights_holder: img.rights_holder ?? null, license: img.license, license_url: img.license_url ?? null, attribution: img.attribution ?? null,
    usage: img.usage, ...(img.no_derivatives ? { no_derivatives: true } : {}), ...(img.permission_note ? { permission_note: img.permission_note } : {}),
    ...(img.kogl_type ? { kogl_type: img.kogl_type } : {}), commercial_use: img.commercial_use ?? rightsUse(img.license).commercial_use,
    width: img.width ?? null, height: img.height ?? null, bytes: img.bytes ?? null, format: img.format ?? null,
    quality: img.quality ?? null, media_active: img.media_active ?? null, tier: img.tier, role: img.role,
    kind: img.kind ?? kindOfTier(img.tier), title: img.title ?? pageTitle(img.page) ?? `${img.provider} ${img.id}`, description: img.description ?? null,
    ...(img.identity ? { identity: img.identity } : {}), ...(img.below_target ? { below_target: true } : {}),
    checked_at: img.checked_at ?? null, approved: img.approved ?? null,
  }
}

/**
 * A v0.17 image object (Commons only: thumb, src, page, licence, author, attribution, role hero|card|detail, tier 1–4)
 * as a v0.18 one, so a previous record that is carried over (or whose images are kept) stays valid. The original file
 * URL is derived from the thumbnail path; tier 4 (context) becomes 5; detail becomes gallery or context.
 */
export function upgradeImage(img, projectId) {
  if (!img) return img
  // An early v0.18 image (before kinds): its kind from its tier, its title from its Commons page.
  if (img.id && img.provider) return img.kind ? img : { ...img, kind: kindOfTier(img.tier), title: img.title ?? pageTitle(img.page) ?? null, description: img.description ?? null }
  const page = String(img.page || '')
  const file = page.includes('File:') ? decodeURIComponent(page.split('File:')[1]).replace(/_/g, ' ') : img.src
  const thumb = cleanMediaUrl(img.thumb)
  const m = /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/([a-z-]+)\/thumb\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+)\//.exec(thumb || cleanMediaUrl(img.src) || '')
  const original = m ? `https://upload.wikimedia.org/wikipedia/${m[1]}/${m[2]}/${m[3]}/${m[4]}` : cleanMediaUrl(img.src)
  const w = img.width || 0
  const base = thumb && /\/\d+px-[^/?#]+$/.test(thumb) ? thumb : null
  const display = base ? THUMB_STEPS.filter((s) => s >= 330 && s < w).map((s) => [s, base.replace(/\/\d+px-([^/?#]+)$/, `/${s}px-$1`)]) : []
  const tier = img.tier === 4 ? 5 : Number.isInteger(img.tier) ? img.tier : 5
  const role = img.role === 'detail' ? (tier >= 5 ? 'context' : 'gallery') : img.role || 'gallery'
  return {
    id: stableImageId('commons', file), project: projectId, provider: 'commons', src: original, page: img.page, display, thumb: thumb || original,
    author: img.author ?? null, rights_holder: img.author ?? null, license: img.license, license_url: img.license_url ?? null, attribution: img.attribution ?? null,
    usage: 'cache', width: img.width ?? null, height: img.height ?? null, bytes: null, format: null,
    quality: null, media_active: { score: 0, reasons: ['legacy_v017'] }, tier, role, kind: kindOfTier(tier), title: pageTitle(img.page) ?? null, description: null,
    checked_at: null, approved: role === 'hero' ? true : null,
  }
}
/** "Foo bar" from a Commons file page URL (…/wiki/File:Foo_bar.jpg), or null. */
export function pageTitle(page) {
  const p = String(page || '')
  if (!p.includes('File:')) return null
  try { return decodeURIComponent(p.split('File:')[1]).replace(/_/g, ' ').replace(/\.[a-z0-9]+$/i, '').slice(0, 200) || null } catch { return null }
}

/** A previously published record in the v0.18 shape (images upgraded, kr_region present). */
export function upgradeRecord(r) {
  if (!r) return r
  return { ...r, kr_region: r.kr_region ?? null, kind: r.kind || 'facility', start_date: r.start_date ?? null, end_date: r.end_date ?? null, status: r.status || 'unknown', status_source: r.status_source ?? null, images: (r.images || []).map((i) => upgradeImage(i, r.id)) }
}

/** The width and height of an image's thumb rendition (from its display list, or the "/<w>px-" of a Commons URL). */
export function thumbSize(img) {
  if (!img?.thumb) return [null, null]
  const d = (img.display || []).find(([, u]) => u === img.thumb)
  const w = d ? d[0] : Number(/\/(\d+)px-[^/?#]+(?:[?#]|$)/.exec(img.thumb)?.[1]) || (img.thumb === img.src ? img.width : null)
  if (!w) return [null, null]
  return [w, img.width && img.height ? Math.round(w * img.height / img.width) : null]
}

// Field names of the build step → the public record's names (field_sources names the record's own fields).
const FIELD_NAME = { latitude: 'lat', longitude: 'lng', description_ko: 'summary_ko', description_en: 'summary_en' }
const SOURCE_KINDS = new Set(['official', 'public_agency', 'academic', 'specialist_media', 'news', 'blog', 'wikidata', 'wikipedia', 'commons', 'reference', 'search_result'])

/**
 * A full public record from a built project. Only public fields: nothing about review state, pipeline runs, field
 * states or scores (those live in admin-data/).
 */
export function publicRecord(p, { shard, addedAt }) {
  const images = (p.images || []).map(imageOut)
  return {
    id: p.id,
    curated_place_id: p.curated_id || null,
    wikidata: p.qid || null,
    name_ko: p.name_ko ?? null,
    name_en: p.name_en ?? null,
    name_original: p.name_original ?? null,
    name_original_lang: p.name_original_lang ?? null,
    aliases: p.aliases || [],
    country_iso2: p.country_iso2 ?? null,
    region: p.region ?? null,
    kr_region: p.country_iso2 === 'KR' ? p.kr_region ?? null : null,
    city: p.city ?? null,
    city_ko: p.city_ko ?? null,
    district: p.district ?? null,
    address: p.address ?? null,
    lat: coord(p.latitude),
    lng: coord(p.longitude),
    location_precision: p.location_precision || 'unknown',
    project_type: p.project_type,
    year_installed: p.year_installed ?? null,
    year_completed: p.year_completed ?? null,
    year_operating_since: p.year_operating_since ?? null,
    year_ended: p.year_ended ?? null,
    operating_status: p.operating_status ?? null,
    // facility | program | festival | exhibition, the dates and the status from them (sourced facts only).
    kind: p.kind || 'facility',
    start_date: p.start_date ?? null,
    end_date: p.end_date ?? null,
    status: p.status || 'unknown',
    status_source: p.status_source ?? null,
    building_name: p.building_name ?? null,
    installation_method: null,
    envelope_type: null,
    technologies: [],
    content_types: [],
    spatial_context: [],
    summary_ko: p.description_ko ?? null,
    summary_en: p.description_en ?? null,
    // Events and exhibitions at this place from public data (Seoul cultural events): their own dates, status and source.
    ...(p.events?.length ? { events: p.events } : {}),
    // A creator's portrait (image kind artist_portrait) belongs to the credit it names, never to images[].
    credits: (p.credits || []).map((c) => {
      const portrait = (p.portraits || []).find((i) => i.creator && [c.name, c.name_en].filter(Boolean).includes(i.creator))
      return { role: c.role, name: c.name ?? c.name_en ?? null, name_en: c.name_en ?? null, wikidata_qid: c.wikidata_qid ?? null, ...(portrait ? { portrait: imageOut(portrait) } : {}) }
    }).filter((c) => c.name),
    official_url: p.official_url ?? null,
    commons_category: p.commons_category ?? null,
    images,
    videos: [],
    sources: (p.sources || []).filter((s) => s.url && SOURCE_KINDS.has(s.kind)).map((s) => ({ id: s.id, kind: s.kind, title: s.title ?? null, url: s.url, publisher: s.publisher ?? null })),
    field_sources: Object.fromEntries(Object.entries(p.field_sources || {}).map(([k, v]) => [FIELD_NAME[k] || k, v]).sort(([a], [b]) => compareStrings(a, b))),
    visit: p.visit ? { status: p.visit.status ?? null, note: p.visit.note ?? null, period: periodText(p.visit.period), source: p.visit.source ?? (p.sources || []).find((s) => s.id === 'curated:source')?.url ?? null } : null,
    record_origin: p.record_origin,
    added_at: addedAt,
    shard,
  }
}

/** A period as stated by the source: {start, end} dates → "2026-09-01 – 2026-10-31"; a text stays as it is. */
export function periodText(period) {
  if (!period) return null
  if (typeof period === 'string') return period
  const { start = null, end = null } = period
  if (start && end) return `${start} – ${end}`
  if (start) return `${start} –`
  if (end) return `– ${end}`
  return null
}

// Commons thumbnails repeat the file name twice in a ~165-byte URL. Above compactAboveBytes the index stores only
// "<h>/<hh>/<File_name.jpg>" and names the URL pattern once (thumb_template), which keeps 5,000 rows under 1 MB.
// Reader rule (docs/PIPELINE.md): a thumb that is not an https URL is template.replace('{path}', thumb)
// .replace('{file}', last path segment). Below the threshold every thumb is a full https URL.
export const THUMB_TEMPLATE = 'https://upload.wikimedia.org/wikipedia/commons/thumb/{path}/500px-{file}'
// Wikimedia now names thumb.wikimedia.org for thumbnails; upload.wikimedia.org serves the same paths (the old URLs keep
// working), and the template stays on the host the v0.17 app accepts.
const COMMONS_THUMB = /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/thumb\/([0-9a-f]\/[0-9a-f]{2}\/([^/]+))\/500px-([^/]+)$/
export const compactThumb = (url) => { const m = COMMONS_THUMB.exec(url || ''); return m && m[2] === m[3] ? m[1] : url }
export const expandThumb = (thumb, template) => (thumb && template && !/^https:/.test(thumb) ? template.replace('{path}', thumb).replace('{file}', thumb.slice(thumb.lastIndexOf('/') + 1)) : thumb)

/** The card image of a record: the card, else the featured or the hero image. */
export const cardOf = (r) => r.images.find((i) => i.role === 'card') || r.images.find((i) => i.role === 'featured') || r.images.find((i) => i.role === 'hero') || null

/** index.json: compact rows (the card image's thumbnail, its size, and its tier: 1 media facade running … 5 architectural). */
export function buildIndex(records, { compactAboveBytes = 512 * 1024 } = {}) {
  const rows = records.map((r) => {
    const card = cardOf(r)
    const [tw, th] = thumbSize(card)
    return [r.id, r.name_ko, r.name_en, r.name_original && r.name_original !== r.name_en && r.name_original !== r.name_ko ? r.name_original : null,
      r.country_iso2, r.city, r.lat === null ? null : round(r.lat, 4), r.lng === null ? null : round(r.lng, 4), r.project_type, yearOf(r),
      card?.thumb ?? null, card?.tier ?? null, r.shard, r.added_at ? r.added_at.slice(0, 10) : null, r.kr_region ?? null, card ? tw : null, card ? th : null, r.city_ko ?? null, r.district ?? null]
  })
  const full = { schema: DATA_SCHEMA, fields: INDEX_FIELDS, rows }
  if (Buffer.byteLength(JSON.stringify(full)) <= compactAboveBytes) return full
  const t = INDEX_FIELDS.indexOf('thumb')
  return { schema: DATA_SCHEMA, fields: INDEX_FIELDS, thumb_template: THUMB_TEMPLATE, rows: rows.map((row) => { const c = row.slice(); c[t] = compactThumb(c[t]); return c }) }
}

const compact = (r, image) => ({
  id: r.id, name_ko: r.name_ko, name_en: r.name_en, name_original: r.name_original, country_iso2: r.country_iso2, kr_region: r.kr_region ?? null, city: r.city,
  lat: r.lat, lng: r.lng, project_type: r.project_type, year: yearOf(r), shard: r.shard, ...(r.curated_place_id ? { curated_place_id: r.curated_place_id } : {}),
  ...(r.wikidata ? { wikidata: r.wikidata } : {}), added_at: r.added_at, image: image ? imageOut(image) : null,
})

// Korean exhibitions, festivals and media art (the home section "국내 미디어아트·전시").
const PROGRAM_TYPES = new Set(['festival_program', 'media_architecture', 'interactive_installation'])
const VISIT_FIRST = { operating: 0, seasonal: 1, event_based: 2 }

/**
 * home.json (docs/STATIC_ARCHIVE.md v0.18 "Home and navigation"): Korean first.
 *  - hero: approved hero images (tier 1–2, editorial/hero.json, set_hero or approve_image); at least 70 % Korean when
 *    any Korean hero exists (foreign slides ≤ 3/7 of the Korean ones);
 *  - kr_regions: the eight Korean regions with counts, a representative image and their top projects;
 *  - kr_featured: Korean projects by the strength of their home image (then curated ones without one: the designed
 *    placeholder, never a daytime photo);
 *  - kr_programs: Korean exhibitions, festivals and media art (running ones first);
 *  - world: worldwide highlights (about a quarter of the home picks) with the world counts;
 *  - counts: projects, countries, with_images, korea, world, by_kr_region;
 *  - kept for the v0.17 app: featured (Korean first), regions, types, themes, recent and projects (the compact record of
 *    every id named, with its home image).
 * Images here passed the home rule (active media in a dark frame) and carry their display sizes (up to 1920 px and,
 * when the original allows it, 2560/3840).
 * @param {any[]} records @param {Map<string, {hero: any|null, featured?: any|null, home: any|null, score: number}>} picks
 */
export function buildHome(records, picks, { buildId, generatedAt, heroMax = 6, featuredMax = 12, recentMax = 8, krShare = 0.7, regionTop = 6, programsMax = 12, worldMax = 8 }) {
  const named = new Map()
  const name = (r, image) => { if (!named.has(r.id) || (image && !named.get(r.id).image)) named.set(r.id, compact(r, image)); return r.id }
  const homeImage = (r) => picks.get(r.id)?.home || null
  const score = (r) => picks.get(r.id)?.score ?? 0
  const byScore = (a, b) => score(b) - score(a) || compareStrings(a.id, b.id)
  const kr = (r) => r.country_iso2 === 'KR'
  const ranked = records.filter((r) => homeImage(r)).sort(byScore)

  // Hero: Korean first, at least krShare Korean when any Korean hero exists.
  const heroes = records.filter((x) => picks.get(x.id)?.hero).sort(byScore)
  const krHeroes = heroes.filter(kr), worldHeroes = heroes.filter((r) => !kr(r))
  const krN = Math.min(krHeroes.length, heroMax)
  const worldN = krN ? Math.min(worldHeroes.length, heroMax - krN, Math.floor(krN * (1 - krShare) / krShare)) : Math.min(worldHeroes.length, heroMax)
  const hero = [...krHeroes.slice(0, krN), ...worldHeroes.slice(0, worldN)].map((r) => { const img = picks.get(r.id).hero; return { project: name(r, img), image: imageOut(img) } })
  const heroIds = new Set(hero.map((h) => h.project))

  // Korean featured: the strongest home images, then curated places without one (placeholder).
  const krFeatured = []
  for (const r of ranked.filter(kr)) { if (krFeatured.length >= featuredMax) break; if (!heroIds.has(r.id)) krFeatured.push(name(r, homeImage(r))) }
  for (const r of records.filter((x) => kr(x) && !homeImage(x) && x.curated_place_id && ['media_facade', 'media_wall', 'projection_mapping'].includes(x.project_type)).sort((a, b) => compareStrings(a.id, b.id))) {
    if (krFeatured.length >= featuredMax) break
    if (!heroIds.has(r.id) && !krFeatured.includes(r.id)) krFeatured.push(name(r, null))
  }
  // Korean regions: all eight, with counts, the region's strongest home image and its top projects.
  const krRegions = T.keys('kr_region').map((key) => {
    const inRegion = records.filter((r) => r.kr_region === key)
    const top = [...inRegion].sort((a, b) => (homeImage(b) ? 1 : 0) - (homeImage(a) ? 1 : 0) || byScore(a, b)).slice(0, regionTop)
    const rep = inRegion.filter((r) => homeImage(r)).sort(byScore)[0] || null
    return { key, count: inRegion.length, project: rep ? name(rep, homeImage(rep)) : null, image: rep ? imageOut(homeImage(rep)) : null, projects: top.map((r) => name(r, homeImage(r))) }
  })
  // Korean exhibitions, festivals and media art: running ones first, then by image strength.
  const krPrograms = records.filter((r) => kr(r) && PROGRAM_TYPES.has(r.project_type))
    .sort((a, b) => (VISIT_FIRST[a.visit?.status] ?? 9) - (VISIT_FIRST[b.visit?.status] ?? 9) || (homeImage(b) ? 1 : 0) - (homeImage(a) ? 1 : 0) || byScore(a, b))
    .slice(0, programsMax).map((r) => name(r, homeImage(r)))
  // World highlights: at most two per country.
  const worldHighlights = [], perWorld = {}
  for (const r of ranked.filter((x) => !kr(x))) {
    if (worldHighlights.length >= worldMax) break
    if (heroIds.has(r.id) || (perWorld[r.country_iso2] || 0) >= 2) continue
    perWorld[r.country_iso2] = (perWorld[r.country_iso2] || 0) + 1
    worldHighlights.push(name(r, homeImage(r)))
  }
  // v0.17 featured: Korean first (about three quarters), then the world highlights; two per country and three per type.
  const featured = [], perCountry = {}, perType = {}
  const krSlots = Math.round(featuredMax * 0.75)
  const takeFeatured = (list, limit) => { for (const r of list) { if (featured.length >= limit) break; if (heroIds.has(r.id) || featured.includes(r.id)) continue; if (!kr(r) && ((perCountry[r.country_iso2] || 0) >= 2)) continue; if ((perType[r.project_type] || 0) >= (kr(r) ? 6 : 3)) continue; perCountry[r.country_iso2] = (perCountry[r.country_iso2] || 0) + 1; perType[r.project_type] = (perType[r.project_type] || 0) + 1; featured.push(name(r, homeImage(r))) } }
  takeFeatured(ranked.filter(kr), krSlots)
  takeFeatured(ranked.filter((r) => !kr(r)), featuredMax)
  takeFeatured(ranked.filter(kr), featuredMax)

  const group = (keyOf, vocab) => {
    const counts = new Map()
    for (const r of records) { const k = keyOf(r); if (k && T.valid(vocab, k)) counts.set(k, (counts.get(k) || 0) + 1) }
    return [...counts].sort((a, b) => b[1] - a[1] || compareStrings(a[0], b[0])).map(([key, count]) => {
      const rep = ranked.find((r) => keyOf(r) === key) || null
      return { key, count, project: rep ? name(rep, homeImage(rep)) : null, image: rep ? imageOut(homeImage(rep)) : null }
    })
  }
  const regions = group((r) => r.region, 'region')
  const types = group((r) => r.project_type, 'project_type')
  const recent = [...records].sort((a, b) => (kr(b) ? 1 : 0) - (kr(a) ? 1 : 0) || compareStrings(b.added_at || '', a.added_at || '') || compareStrings(a.id, b.id)).slice(0, recentMax).map((r) => name(r, homeImage(r)))
  const countries = new Set(records.map((r) => r.country_iso2).filter(Boolean))
  const korea = records.filter(kr)
  const projects = {}
  for (const id of [...named.keys()].sort()) { const { id: _, ...rest } = named.get(id); projects[id] = rest }
  return {
    schema: DATA_SCHEMA, build_id: buildId, generated_at: generatedAt,
    counts: {
      projects: records.length, countries: countries.size, with_images: records.filter((r) => r.images.length).length,
      korea: korea.length, korea_with_images: korea.filter((r) => r.images.length).length, world: records.length - korea.length, world_countries: new Set(records.filter((r) => !kr(r)).map((r) => r.country_iso2)).size,
      by_kr_region: Object.fromEntries(T.keys('kr_region').map((k) => [k, records.filter((r) => r.kr_region === k).length])),
    },
    hero, kr_regions: krRegions, kr_featured: krFeatured, kr_programs: krPrograms,
    world: { highlights: worldHighlights, count: records.length - korea.length, countries: new Set(records.filter((r) => !kr(r)).map((r) => r.country_iso2)).size },
    featured, regions, types, themes: [], recent, projects,
  }
}

const tally = (records, f) => {
  const out = {}
  for (const r of records) for (const k of [].concat(f(r) ?? [])) if (k !== null && k !== undefined && k !== '') out[k] = (out[k] || 0) + 1
  return Object.fromEntries(Object.entries(out).sort((a, b) => compareStrings(String(a[0]), String(b[0]))))
}

/** stats.json: the counts behind the research page. */
export function buildStats(records, { buildId, generatedAt }) {
  return {
    schema: DATA_SCHEMA, build_id: buildId, generated_at: generatedAt,
    counts: {
      projects: records.length,
      with_images: records.filter((r) => r.images.length).length,
      with_media_active_image: records.filter((r) => r.images.some((i) => i.tier === 1)).length,
      with_hero: records.filter((r) => r.images.some((i) => i.role === 'hero')).length,
      with_coordinates: records.filter((r) => r.lat !== null).length,
      with_wikidata: records.filter((r) => r.wikidata).length,
      countries: new Set(records.map((r) => r.country_iso2).filter(Boolean)).size,
      cities: new Set(records.map((r) => r.city && r.country_iso2 + '|' + r.city).filter(Boolean)).size,
    },
    by_type: tally(records, (r) => r.project_type),
    by_region: tally(records, (r) => r.region),
    by_kr_region: tally(records, (r) => r.kr_region),
    by_country: tally(records, (r) => r.country_iso2),
    by_decade: tally(records, (r) => { const y = yearOf(r); return y ? String(Math.floor(y / 10) * 10) + 's' : null }),
    by_year: tally(records, (r) => yearOf(r)),
    by_origin: tally(records, (r) => r.record_origin),
    by_source: tally(records, (r) => [...new Set(r.sources.map((s) => s.kind))]),
    by_credit_role: tally(records, (r) => [...new Set(r.credits.map((c) => c.role))]),
    top_cities: Object.entries(tally(records, (r) => (r.city ? `${r.country_iso2}|${r.city}` : null))).sort((a, b) => b[1] - a[1] || compareStrings(a[0], b[0])).slice(0, 50).map(([k, n]) => { const [iso, city] = k.split('|'); return { country_iso2: iso, city, count: n } }),
  }
}

/** The data part of the build id: a hash of everything published except the timestamps. */
export const contentHash = (parts) => sha256(stableStringify(parts)).slice(0, 12)

export function buildManifest({ buildId, generatedAt, records, shards, sources }) {
  return {
    schema: DATA_SCHEMA, build_id: buildId, generated_at: generatedAt,
    counts: {
      projects: records.length,
      with_images: records.filter((r) => r.images.length).length,
      with_hero: records.filter((r) => r.images.some((i) => i.role === 'hero')).length,
      by_type: tally(records, (r) => r.project_type),
      by_region: tally(records, (r) => r.region),
      by_country: tally(records, (r) => r.country_iso2),
      by_kr_region: tally(records, (r) => r.kr_region),
      korea: records.filter((r) => r.country_iso2 === 'KR').length,
      world: records.filter((r) => r.country_iso2 !== 'KR').length,
    },
    files: { index: 'index.json', home: 'home.json', stats: 'stats.json', shards: shards.map((s) => `projects/${s}.json`) },
    sources,
    credits: {
      data: 'Wikidata (CC0 1.0), Wikipedia (CC BY-SA 4.0, article links), Wikimedia Commons (each image carries its own licence and author), curated records of the archive.',
      images: 'Every image object names its licence and author; keep them with the image.',
    },
  }
}
