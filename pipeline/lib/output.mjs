// The published dataset (docs/STATIC_ARCHIVE.md "Output", served at /data/): full records sharded by a stable hash
// of the id, a compact index for list/search/map, the home picks, statistics and the manifest.
// Field names follow docs/ARCHIVE_SPEC.md §6 (client fields) plus images[], sources[] and visit; a fact without a
// source is null. docs/PIPELINE.md documents every field.
import T from '../../site-public-cleared/archive-taxonomy.js'
import { fnv1a, round, compareStrings, sha256, stableStringify } from './util.mjs'

export const DATA_SCHEMA = 1
export const INDEX_FIELDS = ['id', 'name_ko', 'name_en', 'name_original', 'country_iso2', 'city', 'lat', 'lng', 'project_type', 'year', 'thumb', 'visual_rank', 'shard', 'added_at']
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

/** The public image object (what the record, the home picks and the index use). */
export function imageOut(img) {
  if (!img) return null
  return {
    thumb: img.thumb, src: img.src, page: img.page, license: img.license, license_url: img.license_url ?? null,
    author: img.author ?? null, attribution: img.attribution ?? null, role: img.role, tier: img.tier,
    width: img.width ?? null, height: img.height ?? null,
  }
}

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
    building_name: p.building_name ?? null,
    installation_method: null,
    envelope_type: null,
    technologies: [],
    content_types: [],
    spatial_context: [],
    summary_ko: p.description_ko ?? null,
    summary_en: p.description_en ?? null,
    credits: (p.credits || []).map((c) => ({ role: c.role, name: c.name ?? c.name_en ?? null, name_en: c.name_en ?? null, wikidata_qid: c.wikidata_qid ?? null })).filter((c) => c.name),
    official_url: p.official_url ?? null,
    commons_category: p.commons_category ?? null,
    images,
    videos: [],
    sources: (p.sources || []).filter((s) => s.url && SOURCE_KINDS.has(s.kind)).map((s) => ({ id: s.id, kind: s.kind, title: s.title ?? null, url: s.url, publisher: s.publisher ?? null })),
    field_sources: p.field_sources || {},
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
const COMMONS_THUMB = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/([0-9a-f]\/[0-9a-f]{2}\/([^/]+))\/500px-([^/]+)$/
export const compactThumb = (url) => { const m = COMMONS_THUMB.exec(url || ''); return m && m[2] === m[3] ? m[1] : url }
export const expandThumb = (thumb, template) => (thumb && template && !/^https:/.test(thumb) ? template.replace('{path}', thumb).replace('{file}', thumb.slice(thumb.lastIndexOf('/') + 1)) : thumb)

/** index.json: compact rows (the card image's thumbnail and tier: 1 media active at night … 4 context). */
export function buildIndex(records, { compactAboveBytes = 512 * 1024 } = {}) {
  const rows = records.map((r) => {
    const card = r.images.find((i) => i.role === 'card') || r.images.find((i) => i.role === 'hero') || null
    return [r.id, r.name_ko, r.name_en, r.name_original && r.name_original !== r.name_en && r.name_original !== r.name_ko ? r.name_original : null,
      r.country_iso2, r.city, r.lat === null ? null : round(r.lat, 4), r.lng === null ? null : round(r.lng, 4), r.project_type, yearOf(r),
      card?.thumb ?? null, card?.tier ?? null, r.shard, r.added_at ? r.added_at.slice(0, 10) : null]
  })
  const full = { schema: DATA_SCHEMA, fields: INDEX_FIELDS, rows }
  if (Buffer.byteLength(JSON.stringify(full)) <= compactAboveBytes) return full
  const t = INDEX_FIELDS.indexOf('thumb')
  return { schema: DATA_SCHEMA, fields: INDEX_FIELDS, thumb_template: THUMB_TEMPLATE, rows: rows.map((row) => { const c = row.slice(); c[t] = compactThumb(c[t]); return c }) }
}

const compact = (r, image) => ({
  id: r.id, name_ko: r.name_ko, name_en: r.name_en, name_original: r.name_original, country_iso2: r.country_iso2, city: r.city,
  lat: r.lat, lng: r.lng, project_type: r.project_type, year: yearOf(r), shard: r.shard, ...(r.curated_place_id ? { curated_place_id: r.curated_place_id } : {}),
  ...(r.wikidata ? { wikidata: r.wikidata } : {}), added_at: r.added_at, image: image ? imageOut(image) : null,
})

/**
 * home.json: hero slides (allowlisted, media visibly running at night), featured projects, region and type collections
 * with counts and a representative image, recently added projects, and the compact record of every project named.
 * Only images that passed the home rule (homeOk: active media in a dark frame) appear here; a project without one is
 * shown with the designed placeholder (image null). A daytime photo never reaches the home page.
 * @param {any[]} records public records @param {Map<string, {hero: any|null, home: any|null, score: number}>} picks per project id
 */
export function buildHome(records, picks, { buildId, generatedAt, heroMax = 6, featuredMax = 12, recentMax = 8 }) {
  const named = new Map()
  const name = (r, image) => { if (!named.has(r.id) || (image && !named.get(r.id).image)) named.set(r.id, compact(r, image)); return r.id }
  const homeImage = (r) => picks.get(r.id)?.home || null
  const score = (r) => picks.get(r.id)?.score ?? 0
  const ranked = records.filter((r) => homeImage(r)).sort((a, b) => score(b) - score(a) || compareStrings(a.id, b.id))

  const hero = []
  for (const r of records.filter((x) => picks.get(x.id)?.hero).sort((a, b) => score(b) - score(a) || compareStrings(a.id, b.id))) {
    if (hero.length >= heroMax) break
    const img = picks.get(r.id).hero
    hero.push({ project: name(r, img), image: imageOut(img) })
  }
  const heroIds = new Set(hero.map((h) => h.project))
  // Featured: the strongest home images, at most two per country and three per type, so the home page shows range.
  const featured = [], perCountry = {}, perType = {}
  for (const r of ranked) {
    if (featured.length >= featuredMax) break
    if (heroIds.has(r.id)) continue
    if ((perCountry[r.country_iso2] || 0) >= 2 || (perType[r.project_type] || 0) >= 3) continue
    perCountry[r.country_iso2] = (perCountry[r.country_iso2] || 0) + 1
    perType[r.project_type] = (perType[r.project_type] || 0) + 1
    featured.push(name(r, homeImage(r)))
  }
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
  const recent = [...records].sort((a, b) => compareStrings(b.added_at || '', a.added_at || '') || compareStrings(a.id, b.id)).slice(0, recentMax).map((r) => name(r, homeImage(r)))
  const countries = new Set(records.map((r) => r.country_iso2).filter(Boolean))
  const projects = {}
  for (const id of [...named.keys()].sort()) { const { id: _, ...rest } = named.get(id); projects[id] = rest }
  return {
    schema: DATA_SCHEMA, build_id: buildId, generated_at: generatedAt,
    counts: { projects: records.length, countries: countries.size, with_images: records.filter((r) => r.images.length).length },
    hero, featured, regions, types, themes: [], recent, projects,
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
    },
    files: { index: 'index.json', home: 'home.json', stats: 'stats.json', shards: shards.map((s) => `projects/${s}.json`) },
    sources,
    credits: {
      data: 'Wikidata (CC0 1.0), Wikipedia (CC BY-SA 4.0, article links), Wikimedia Commons (each image carries its own licence and author), curated records of the archive.',
      images: 'Every image object names its licence and author; keep them with the image.',
    },
  }
}
