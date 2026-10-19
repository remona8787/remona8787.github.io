// Rows of public.public_archive_projects (docs/ARCHIVE_SPEC.md §4, the published media facade archive) → the app's
// places (§6: origin 'archive', place_id 'AR-' + slug, flat optional fields, null = 미확인). Pure: no DOM and no
// network, shared by the browser loader (client/archive.js) and the Node tests.
// Every value is checked against the controlled vocabularies of site-public-cleared/archive-taxonomy.js: anything
// unknown, malformed or unsafe becomes null (never a guess), and a row without a usable slug or any name is dropped.
import T from '../site-public-cleared/archive-taxonomy.js'

export const ARCHIVE_VIEW = 'public_archive_projects'
// Columns the app reads (PostgREST select). visibility is not read: the view returns published projects only.
export const ARCHIVE_COLUMN_LIST = [
  'slug', 'name_original', 'name_original_lang', 'name_en', 'name_ko', 'aliases',
  'country_iso2', 'region', 'city', 'district', 'address', 'latitude', 'longitude', 'location_precision',
  'year_installed', 'year_completed', 'year_operating_since', 'year_ended', 'operating_status',
  'building_name', 'project_type', 'installation_method', 'envelope_type', 'technology', 'display_area_m2', 'resolution_text', 'pixel_pitch_mm', 'content_type', 'interactive',
  'viewing_points', 'spatial_context', 'urban_context', 'summary_ko', 'summary_en',
  'wikidata_qid', 'official_url', 'discovered_qid', 'curated_place_id', 'record_origin', 'review_status', 'update_status', 'field_status',
  'first_collected_at', 'last_collected_at', 'last_verified_at', 'created_at', 'updated_at',
  'credits', 'sources', 'media', 'assessments',
]
export const ARCHIVE_COLUMNS = ARCHIVE_COLUMN_LIST.join(',')
// PostgREST returns at most "max rows" (1000 on Supabase) per request; the app reads at most this many projects.
export const ARCHIVE_PAGE = 1000
export const ARCHIVE_MAX_ROWS = 5000
export const WIKIDATA_ITEM = 'https://www.wikidata.org/wiki/'

// The app's broad light categories (catalog.js) for project types that clearly belong to one, so the home category
// tiles and chips include archive projects. Other types have no category; their type label is shown instead.
export const CATEGORY_OF_TYPE = { media_facade: 'Media Facade', urban_screen: 'Media Facade', light_art: 'Light Art', projection_mapping: 'Media Art', festival_program: 'Festival' }

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
/** @param {any} v @param {number} [max] @returns {string|null} */
export function text(v, max = 300) {
  if (typeof v !== 'string') return null
  const s = v.replace(CONTROL, '').replace(/\s+/g, ' ').trim()
  return s ? (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s) : null
}
/** @param {any} v @returns {string|null} http(s) URLs only */
export function safeURL(v) {
  try { const u = new URL(String(v || '')); return ['https:', 'http:'].includes(u.protocol) ? u.href : null } catch { return null }
}
const https = (/** @type {any} */ v) => { const u = safeURL(v); return u && u.startsWith('https:') ? u : null }
/** @param {string} name @param {any} v */
const vocab = (name, v) => typeof v === 'string' && T.valid(name, v) ? v : null
/** @param {string} name @param {any} v @returns {string[]} */
const vocabList = (name, v) => Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string' && T.valid(name, x)))] : []
/** @param {any} v @returns {number|null} a plausible year */
const year = v => { const n = typeof v === 'string' && /^\d{4}$/.test(v) ? Number(v) : v; return Number.isInteger(n) && n >= 1000 && n <= 2100 ? n : null }
/** @param {any} v @returns {number|null} PostgREST sends numeric as a number (or a string for very long values) */
const positive = v => { const n = typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1e7 ? n : null }
/** @param {any} v @returns {string|null} ISO timestamp */
const time = v => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null
const qid = (/** @type {any} */ v) => typeof v === 'string' && /^Q[1-9]\d*$/.test(v) ? v : null
const coord = (/** @type {any} */ v, /** @type {number} */ max) => { const n = typeof v === 'string' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max ? n : null }

/** @param {any} v @returns {Record<string, {state: string, source_id?: string, at?: string}>} */
function fieldStatus(v) {
  /** @type {Record<string, {state: string, source_id?: string, at?: string}>} */
  const out = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out
  for (const [k, s] of Object.entries(v)) {
    if (!/^[a-z0-9_]{1,40}$/.test(k) || !s || typeof s !== 'object') continue
    const state = vocab('field_state', s.state)
    if (!state) continue
    out[k] = { state, ...(text(s.source_id, 80) ? { source_id: /** @type {string} */ (text(s.source_id, 80)) } : {}), ...(time(s.at) ? { at: /** @type {string} */ (time(s.at)) } : {}) }
  }
  return out
}

/** @param {any} v */
function credits(v) {
  if (!Array.isArray(v)) return []
  const out = []
  for (const c of v.slice(0, 40)) {
    const name = text(c?.name, 200)
    if (!name) continue
    out.push({ role: vocab('credit_role', c.role) || 'other', name, name_en: text(c.name_en, 200), qid: qid(c.wikidata_qid) })
  }
  return out
}

/** @param {any} v */
function sources(v) {
  if (!Array.isArray(v)) return []
  const out = []
  for (const s of v.slice(0, 60)) {
    const url = safeURL(s?.url)
    const title = text(s?.title, 300), publisher = text(s?.publisher, 200)
    if (!url && !title && !publisher) continue
    const r = Number(s?.reliability)
    out.push({
      title, url, publisher, kind: vocab('source_kind', s?.kind), language: text(s?.language, 20),
      published_at: time(s?.published_at), retrieved_at: time(s?.retrieved_at), last_checked_at: time(s?.last_checked_at),
      link_state: vocab('link_state', s?.link_state) || 'unknown',
      reliability: Number.isInteger(r) && r >= 0 && r <= 100 ? r : null,
      license: text(s?.license, 120),
      supports: Array.isArray(s?.supports) ? [...new Set(s.supports.filter((/** @type {any} */ x) => typeof x === 'string' && /^[a-z0-9_]{1,40}$/.test(x)))].slice(0, 40) : [],
    })
  }
  return out
}

/** @param {any} v */
function assessments(v) {
  if (!Array.isArray(v)) return []
  const out = []
  for (const a of v.slice(0, 40)) {
    const attribute = text(a?.attribute, 80)
    if (!attribute || a?.value === undefined || a?.value === null) continue
    const value = typeof a.value === 'string' ? text(a.value, 500) : typeof a.value === 'number' || typeof a.value === 'boolean' ? a.value : text(JSON.stringify(a.value), 500)
    if (value === null || value === '') continue
    out.push({ attribute, value, confidence: ['low', 'medium', 'high'].includes(a.confidence) ? a.confidence : null, method: text(a.method, 300), note: text(a.note, 1000), created_at: time(a.created_at) })
  }
  return out
}

const COORD_FIELDS = ['latitude', 'longitude', 'coordinates']
// The archive's coordinate rule (shown in the map legend). A project is put on the map only with exact or street
// precision: a city-level point would pin it to the city centre. Its coordinates count as verified when an editor
// or a researcher confirmed them (field_status of latitude/longitude); any other coordinates are shown apart, as
// source coordinates, and only with the link of a source that reports them. Everything else stays off the map
// (the project is still listed).
/** @param {any} row @param {ReturnType<typeof sources>} list @param {string} recordURL */
export function archiveCoords(row, list, recordURL) {
  const lat = coord(row?.latitude, 90), lon = coord(row?.longitude, 180)
  const precision = ['exact', 'street', 'city', 'unknown'].includes(row?.location_precision) ? row.location_precision : 'unknown'
  const none = { latitude: null, longitude: null, coordinate_review_status: null, coordinate_source: null, coordinate_source_url: null, location_precision: precision }
  if (lat === null || lon === null || (lat === 0 && lon === 0) || !['exact', 'street'].includes(precision)) return none
  const fs = fieldStatus(row?.field_status)
  const states = COORD_FIELDS.map(k => fs[k]?.state).filter(Boolean)
  const verified = states.length > 0 && states.every(s => s === 'editor_verified' || s === 'researcher_assessed')
  const backing = list.find(s => s.url && s.link_state !== 'broken' && s.supports.some(f => COORD_FIELDS.includes(f)))
  const wd = qid(row?.wikidata_qid)
  if (verified) return { latitude: lat, longitude: lon, coordinate_review_status: 'verified', coordinate_source: 'archive', coordinate_source_url: https(backing?.url) || https(row?.official_url) || (wd ? WIKIDATA_ITEM + wd : null) || recordURL, location_precision: precision }
  const url = https(backing?.url)
  return url ? { latitude: lat, longitude: lon, coordinate_review_status: 'source', coordinate_source: 'archive', coordinate_source_url: url, location_precision: precision } : none
}

// Cleared images (the view only returns those, without broken links) → media rows the app's photo index reads, with
// the same fields as the Commons photos: https only, and never without a licence and a creator or attribution.
/** @param {string} placeId @param {any} list */
export function archiveMedia(placeId, list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const m of [...list].sort((a, b) => Number(!!b?.is_primary) - Number(!!a?.is_primary)).slice(0, 12)) {
    const url = https(m?.url), license = text(m?.license, 120), creator = text(m?.author, 200) || text(m?.attribution, 300)
    if (!url || !license || !creator) continue
    out.push({
      place_code: placeId, provider: 'archive', provider_asset_id: 'archive:' + url, display_url: url, original_file_url: url,
      clearance_status: 'cleared', review_required: false, creator, license_code: license, license_url: https(m?.license_url) || '',
      source_url: https(m?.page_url) || url, caption: text(m?.attribution, 300) || '', is_primary: !!m?.is_primary,
    })
  }
  return out
}

/** @param {any} row @param {{publicURL?: string}} [o] */
export function rowToPlace(row, { publicURL = '' } = {}) {
  const slug = typeof row?.slug === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(row.slug) ? row.slug : null
  if (!slug) return null
  const nameKo = text(row.name_ko), nameEn = text(row.name_en), nameOriginal = text(row.name_original)
  const name = nameKo || nameOriginal || nameEn
  if (!name) return null
  const id = 'AR-' + slug
  const code = typeof row.country_iso2 === 'string' ? row.country_iso2.toUpperCase() : '', iso = T.regionOf(code) ? code : null
  const projectType = vocab('project_type', row.project_type)
  const list = sources(row.sources)
  const record = String(publicURL || '').replace(/\/+$/, '')
  const coords = archiveCoords(row, list, record.startsWith('https:') ? record + '/#place/' + id : null)
  const wd = qid(row.wikidata_qid)
  const summaryKo = text(row.summary_ko, 2000), summaryEn = text(row.summary_en, 2000)
  const official = safeURL(row.official_url)
  return {
    place_id: id, origin: 'archive', archive_slug: slug,
    name_kr: name, name_en: nameEn || '', name_ko: nameKo, name_original: nameOriginal, name_original_lang: text(row.name_original_lang, 20),
    aliases: Array.isArray(row.aliases) ? [...new Set(row.aliases.map((/** @type {any} */ a) => text(a, 200)).filter(Boolean))].slice(0, 30) : [],
    short_description: summaryKo || summaryEn || '', summary_ko: summaryKo, summary_en: summaryEn,
    primary_category: projectType ? CATEGORY_OF_TYPE[/** @type {keyof typeof CATEGORY_OF_TYPE} */ (projectType)] || null : null,
    project_type: projectType,
    region: vocab('region', row.region) || T.regionOf(iso),
    country_iso2: iso, country: iso ? T.countryName(iso, 'ko') : '',
    city: text(row.city, 120) || '', district: text(row.district, 120) || '', address: text(row.address, 300) || '',
    ...coords,
    year_installed: year(row.year_installed), year_completed: year(row.year_completed), year_operating_since: year(row.year_operating_since), year_ended: year(row.year_ended),
    operating_status: vocab('operating_status', row.operating_status),
    building_name: text(row.building_name, 200),
    installation_method: vocab('installation_method', row.installation_method),
    envelope_type: vocab('envelope_type', row.envelope_type),
    technologies: vocabList('technology', row.technology),
    content_types: vocabList('content_type', row.content_type),
    display_area_m2: positive(row.display_area_m2), resolution_text: text(row.resolution_text, 120), pixel_pitch_mm: positive(row.pixel_pitch_mm),
    interactive: typeof row.interactive === 'boolean' ? row.interactive : null,
    spatial_context: vocabList('spatial_context', row.spatial_context),
    viewing_points: text(row.viewing_points, 1000), urban_context: text(row.urban_context, 1000),
    credits: credits(row.credits), sources: list, assessments: assessments(row.assessments),
    record_origin: vocab('record_origin', row.record_origin),
    review_status: vocab('review_status', row.review_status) || 'unreviewed',
    update_status: vocab('update_status', row.update_status),
    field_status: fieldStatus(row.field_status),
    first_collected_at: time(row.first_collected_at), last_collected_at: time(row.last_collected_at), last_verified_at: time(row.last_verified_at),
    created_at: time(row.created_at), updated_at: time(row.updated_at),
    wikidata: wd, discovered_qid: qid(row.discovered_qid),
    curated_place_id: typeof row.curated_place_id === 'string' && /^[A-Z]{2,12}\d{1,6}$/.test(row.curated_place_id) ? row.curated_place_id : null,
    website: official || '', official_url: official,
    source_url: wd ? WIKIDATA_ITEM + wd : list.find(s => s.url && s.link_state !== 'broken')?.url || official || '',
    scope: iso === 'KR' ? 'korea' : 'world',
  }
}

// The whole view → places (one per slug, first row wins), their media rows, and the newest collection or update time.
/** @param {any} rows @param {{publicURL?: string}} [o] */
export function fromArchiveRows(rows, o = {}) {
  if (!Array.isArray(rows)) throw Error('invalid_archive_payload')
  const seen = new Set(), projects = [], media = []
  let latest = 0
  for (const row of rows) {
    const p = rowToPlace(row, o)
    if (!p || seen.has(p.place_id)) continue
    seen.add(p.place_id)
    projects.push(p)
    media.push(...archiveMedia(p.place_id, row.media))
    for (const t of [p.last_collected_at, p.updated_at]) { const n = t ? Date.parse(t) : 0; if (n > latest) latest = n }
  }
  return { projects, media, updatedAt: latest ? new Date(latest).toISOString() : null }
}
