// The static archive dataset (docs/STATIC_ARCHIVE.md "Output", published at /data/ by the GitHub Actions pipeline)
// → the app's places and photos. Pure: no DOM and no network, shared by the browser loader (client/dataset.js) and
// the Node tests. docs/UI_v017.md lists every field this file reads.
//
// Every value is checked: unknown vocabulary, malformed numbers and non-https links become null (never a guess), a
// row without a usable id or any name is dropped, and an image without a licence and an author or attribution is
// never shown. Columns of index.json are read by name from its "fields" list, so the pipeline may add columns.
import T from '../site-public-cleared/archive-taxonomy.js'

export const DATA_SCHEMA = 1
// The app's broad light categories (catalog.js) for project types that clearly belong to one (the same table as
// client/archive-rows.mjs), so category filters and similar projects include dataset projects.
const CATEGORY_OF_TYPE = { media_facade: 'Media Facade', urban_screen: 'Media Facade', light_art: 'Light Art', projection_mapping: 'Media Art', festival_program: 'Festival' }

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
/** @param {any} v @param {number} [max] @returns {string|null} */
export function text(v, max = 300) {
  if (typeof v !== 'string') return null
  const s = v.replace(CONTROL, '').replace(/\s+/g, ' ').trim()
  return s ? (s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s) : null
}
/** @param {any} v @returns {string|null} https URLs only */
export function https(v) {
  try { const u = new URL(String(v || '')); return u.protocol === 'https:' && !u.username && !u.password ? u.href : null } catch { return null }
}
const vocab = (/** @type {string} */ name, /** @type {any} */ v) => typeof v === 'string' && T.valid(name, v) ? v : null
const vocabList = (/** @type {string} */ name, /** @type {any} */ v) => Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string' && T.valid(name, x)))] : []
const year = (/** @type {any} */ v) => { const n = typeof v === 'string' && /^\d{4}$/.test(v) ? Number(v) : v; return Number.isInteger(n) && n >= 1000 && n <= 2100 ? n : null }
const num = (/** @type {any} */ v, /** @type {number} */ max) => { const n = typeof v === 'string' && v.trim() ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max ? n : null }
const time = (/** @type {any} */ v) => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null
const qid = (/** @type {any} */ v) => typeof v === 'string' && /^Q[1-9]\d{0,11}$/.test(v) ? v : null
// A text in the reader's language: a plain string, or {ko, en}.
const i18n = (/** @type {any} */ v, max = 300) => typeof v === 'string' ? (text(v, max) ? { ko: text(v, max), en: text(v, max) } : null) : v && typeof v === 'object' && (text(v.ko, max) || text(v.en, max)) ? { ko: text(v.ko, max) || text(v.en, max), en: text(v.en, max) || text(v.ko, max) } : null

// Dataset ids keep their own form; curated seed places (SEOUL001…) keep theirs and fold into the curated place.
/** @param {any} v @returns {string|null} */
export function datasetId(v) {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : ''
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,156}$/.test(s) ? s : null
}
export const appId = (/** @type {string} */ id) => 'AR-' + id
// The pipeline's shard of an id (pipeline/lib/output.mjs shardOf): FNV-1a of its UTF-8 bytes modulo the number of
// shards the manifest lists (a power of two). null when the manifest names no such shard.
/** @param {string} text */
export function fnv1a(text) {
  let h = 0x811c9dc5
  for (const b of new TextEncoder().encode(String(text))) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}
/** @param {string} datasetId @param {any} shardFiles manifest.files.shards */
export function shardFor(datasetId, shardFiles) {
  const n = Array.isArray(shardFiles) ? shardFiles.length : 0
  if (!n) return null
  const name = String(fnv1a(datasetId) % n).padStart(3, '0')
  return shardFiles.includes(`projects/${name}.json`) ? name : null
}
const CURATED = /^[A-Z]{2,12}\d{1,6}$/
// Korean region (v0.18 kr_region): the pipeline's value when the field exists (null stays unknown, never guessed);
// derived from the city or address only when a dataset has no such field at all (before v0.18).
const KR_KEYS = new Set((T.krRegions || []).map((/** @type {any} */ x) => x[0]))
/** @param {any} v */
export const krKey = v => typeof v === 'string' && (KR_KEYS.has(v) || T.valid('kr_region', v)) ? v : null
const shardName = (/** @type {any} */ v) => { const s = typeof v === 'number' ? String(v).padStart(3, '0') : v; return typeof s === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : null }

// Image roles of the pipeline (docs/STATIC_ARCHIVE.md "Images") → the card tier: 1 media active at night, 2 media art
// content, 3 LED/projection/lighting characteristics, 4 an official or architectural (context) image. An explicit
// numeric tier wins; an unknown role counts as context, so it never reaches the home page by accident.
const ROLE_TIER = { hero: 1, media_active: 1, night: 1, active: 1, media_art: 2, art: 2, content: 2, lighting: 3, led: 3, projection: 3, media: 3, context: 4, architecture: 4, architectural: 4, daytime: 4, day: 4, official: 4, card: 4, gallery: 4 }
/** @param {any} m */
export function tierOf(m) {
  const t = Number(m?.tier)
  if (Number.isInteger(t) && t >= 1 && t <= 4) return t
  return ROLE_TIER[/** @type {keyof typeof ROLE_TIER} */ (String(m?.role || '').toLowerCase())] || 4
}
// v0.18 image objects (docs/STATIC_ARCHIVE.md, v0.18 addendum) carry provider, display sizes and an editorial verdict,
// and rank them in six tiers: 1 media facade running, 2 architectural media art at night, 3 LED or projection visible,
// 4 an exhibition or public-art scene, 5 an architectural photo of the project (context), 6 none. The app keeps its
// four card tiers (1–3 media active, 4 context), so 4 joins 3 and 5 becomes 4; tier 6 and rejected images are dropped.
const V18_TIER = { 1: 1, 2: 2, 3: 3, 4: 3, 5: 4 }
export const PROVIDERS = ['commons', 'openverse', 'flickr', 'tourapi', 'kto_photo', 'unsplash', 'pexels', 'official', 'editor']
// The sizes an image can be shown at, [[width, url], …] ascending, never above the original width (docs: "An image is
// never shown wider than its original"): the provider's display list, else Commons standard thumbnails derived from
// the file URL (https://www.mediawiki.org/wiki/Common_thumbnail_sizes), else the thumbnail and the original as given.
export const COMMONS_WIDTHS = [330, 500, 960, 1280, 1920, 3840]
const COMMONS = /^https:\/\/(upload|thumb)\.wikimedia\.org\/wikipedia\/([a-z-]+)\/(?:thumb\/)?([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+)(?:\/(\d+)px-([^/?#]+))?(?:\?[^#]*)?$/
/** @param {string|null} url @param {number|null} width the original's width, when known */
export function commonsSizes(url, width) {
  const m = COMMONS.exec(String(url || ''))
  if (!m || !/\.(jpe?g|png|webp|gif)$/i.test(m[5])) return null
  const [, host, wiki, a, ab, file] = m, name = m[7] && /^thumbnail\.[a-z]+$/i.test(m[7]) ? m[7] : file
  const cap = width || (m[6] ? Number(m[6]) : null)
  if (!cap) return null
  const base = `https://${host}.wikimedia.org/wikipedia/${wiki}/thumb/${a}/${ab}/${file}/`
  const list = COMMONS_WIDTHS.filter(w => width ? w < width : w <= cap).map(w => /** @type {[number, string]} */ ([w, base + w + 'px-' + name]))
  // A small original (up to 1280 px) is its own largest size: the file itself, at its own width.
  if (width && width <= 1280) list.push([width, `https://upload.wikimedia.org/wikipedia/${wiki}/${a}/${ab}/${file}`])
  return list.length ? list : null
}
/** @param {any} v @param {number|null} width */
function displayList(v, width) {
  if (!Array.isArray(v)) return []
  const out = new Map()
  for (const d of v.slice(0, 16)) {
    const w = Array.isArray(d) ? num(d[0], 2e4) : num(d?.width ?? d?.w, 2e4), url = Array.isArray(d) ? https(d[1]) : https(d?.url ?? d?.src)
    if (!url || !w || w < 16 || (width && w > width) || out.has(Math.round(w))) continue
    out.set(Math.round(w), url)
  }
  return [...out].sort((a, b) => a[0] - b[0])
}
/** @param {string|null} url */
const thumbWidth = url => { const m = /\/(\d{2,4})px-[^/]+$/.exec(String(url || '').split('?')[0]); return m ? Number(m[1]) : null }
/** @param {string|null} src @param {string|null} thumb @param {[number,string][]} display @param {number|null} width @param {number|null} thumbW */
export function renditions(src, thumb, display, width, thumbW = null) {
  if (display.length) return display
  const c = commonsSizes(src, width) || commonsSizes(thumb, width)
  if (c) return c
  /** @type {[number, string][]} */ const out = []
  const tw = thumbW || thumbWidth(thumb)
  if (thumb && thumb !== src && tw && (!width || tw <= width)) out.push([tw, thumb])
  if (src && width && !out.some(x => x[0] === width)) out.push([width, src])
  return out.sort((a, b) => a[0] - b[0])
}
const providerOf = (/** @type {any} */ m, /** @type {string|null} */ url) => typeof m.provider === 'string' && PROVIDERS.includes(m.provider) ? m.provider : /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(url || '') ? 'commons' : null
// Image roles of the fifth brief (role_v2, also accepted as kind): what the photo shows. The app's gallery takes the
// project's own media and installation photos; architecture, technical and event photos go behind 추가 자료; portraits
// only with the credits; unverified photos are never shown, so they are dropped here.
export const IMAGE_KINDS = ['project_media', 'project_installation', 'architecture_context', 'technical_documentation', 'event_documentation', 'artist_portrait', 'unverified']
const kindOf = (/** @type {any} */ m) => { const k = typeof m.role_v2 === 'string' ? m.role_v2 : m.kind; return IMAGE_KINDS.includes(k) ? k : null }
/** An image record of the dataset: https only, never without a licence and an author or attribution. @param {any} m */
export function image(m) {
  if (!m || typeof m !== 'object' || m.approved === false || kindOf(m) === 'unverified') return null
  const v18 = Array.isArray(m.display) || typeof m.provider === 'string' || m.media_active !== undefined || m.approved !== undefined
  const rawTier = Number(m.tier)
  if (v18 && rawTier === 6) return null
  const w = num(m.width, 1e5), h = num(m.height, 1e5), width = w && w > 0 ? Math.round(w) : null, height = h && h > 0 ? Math.round(h) : null
  const display = displayList(m.display, width)
  const src = https(m.src) || https(m.url), thumb = https(m.thumb) || (display[0] ? display[0][1] : null) || src
  const license = text(m.license, 120), author = text(m.author, 200), attribution = text(m.attribution, 300)
  if (!thumb || !license || !(author || attribution)) return null
  const fx = num(m.focal?.x ?? m.focus_x, 1), fy = num(m.focal?.y ?? m.focus_y, 1)
  const sizes = renditions(src, https(m.thumb), display, width, num(m.thumb_w, 1e4))
  const tier = v18 && Number.isInteger(rawTier) && V18_TIER[/** @type {1|2|3|4|5} */ (rawTier)] ? V18_TIER[/** @type {1|2|3|4|5} */ (rawTier)] : tierOf(m)
  return {
    thumb, src: src || thumb, page: https(m.page) || https(m.page_url), license, license_url: https(m.license_url), author, attribution,
    role: text(m.role, 40), tier, width, height,
    focal: fx !== null && fy !== null && fx >= 0 && fy >= 0 ? { x: fx, y: fy } : null, caption: i18n(m.caption, 300), taken: text(m.date || m.taken, 40),
    // The pipeline's verdict for the home page (a dark frame with saturated light); absent means not judged.
    home_ok: m.home_ok === true ? true : m.home_ok === false ? false : null,
    provider: providerOf(m, src || thumb), rights_holder: text(m.rights_holder, 200), usage: m.usage === 'cache' ? 'cache' : m.usage === 'hotlink' ? 'hotlink' : null,
    // Editorial review (v0.18): true reviewed, null not yet; images before v0.18 have no such field (undefined).
    approved: m.approved === true ? true : m.approved === null ? null : undefined, v18,
    context: tier === 4 || String(m.role || '') === 'context',
    sizes, maxw: sizes.length ? sizes[sizes.length - 1][0] : null,
    kind: kindOf(m), raw_tier: v18 && Number.isInteger(rawTier) ? rawTier : null,
    media_active: num(typeof m.media_active === 'object' && m.media_active ? m.media_active.score : m.media_active, 100),
    subject: text(m.subject, 200),
    // v0.18 pipeline: the file's title and description (a caption when the record gives none), and the rights facts
    // the sponsor rule reads (commercial use allowed, KOGL type).
    title: cleanTitle(m.title), description: text(m.description, 600),
    commercial_use: m.commercial_use === true ? true : m.commercial_use === false ? false : null, kogl_type: text(m.kogl_type, 20),
  }
}
// A Commons page title as a caption: no "File:" prefix, no extension.
function cleanTitle(/** @type {any} */ v) { const t = text(v, 300); return t ? t.replace(/^File:/i, '').replace(/\.(jpe?g|png|webp|tiff?|gif)$/i, '').replace(/_/g, ' ').trim() || null : null }
/** @param {any} v */
function video(v) {
  if (!v || typeof v !== 'object') return null
  const src = https(v.src) || https(v.url), license = text(v.license, 120), author = text(v.author, 200), attribution = text(v.attribution, 300)
  if (!src || !license || !(author || attribution)) return null
  return { src, poster: https(v.poster), page: https(v.page), license, license_url: https(v.license_url), author, attribution, role: text(v.role, 40), tier: tierOf(v), type: /\.webm(\?|$)/i.test(src) ? 'video/webm' : /\.(mp4|m4v)(\?|$)/i.test(src) ? 'video/mp4' : /\.ogv(\?|$)/i.test(src) ? 'video/ogg' : null }
}

/**
 * One project in its compact form (an index.json row read by field name, or a home.json card) → a place.
 * @param {Record<string, any>} r @param {{publicURL?: string}} [o]
 */
export function toPlace(r, { publicURL = '' } = {}) {
  const id = datasetId(r?.id)
  if (!id) return null
  const ko = text(r.name_ko), en = text(r.name_en), orig = text(r.name_original)
  const name = ko || en || orig
  if (!name) return null
  const code = typeof r.country_iso2 === 'string' ? r.country_iso2.toUpperCase() : '', iso = T.regionOf(code) ? code : null
  const type = vocab('project_type', r.project_type)
  const lat = num(r.lat ?? r.latitude, 90), lng = num(r.lng ?? r.longitude, 180)
  const placeId = appId(id), wd = qid(r.wikidata) || qid(r.wikidata_qid) || (/^Q\d+$/.test(id) ? qid(id) : null)
  const record = String(publicURL || '').replace(/\/+$/, '')
  const coordURL = wd ? 'https://www.wikidata.org/wiki/' + wd : record.startsWith('https:') ? record + '/#place/' + placeId : null
  const located = lat !== null && lng !== null && !(lat === 0 && lng === 0) && !!coordURL
  // visual_rank (index.json): the tier of the card image, 1 media active at night … 4 context; null = no image.
  // card_tier is accepted as another name for it.
  const kr = iso !== 'KR' ? null : Object.prototype.hasOwnProperty.call(r, 'kr_region') ? krKey(r.kr_region) : T.krRegionOf ? T.krRegionOf(r.city, r.address, r.city_ko) : null
  const thumb = https(r.thumb), tierOfRow = [r.card_tier, r.visual_rank].map(Number).find(n => Number.isInteger(n) && n >= 1 && n <= 4) || null
  const cur = typeof r.curated_place_id === 'string' && CURATED.test(r.curated_place_id) ? r.curated_place_id : CURATED.test(id) ? id : null
  return {
    place_id: placeId, origin: 'archive', dataset: true, dataset_id: id, archive_slug: id, shard: shardName(r.shard),
    name_kr: name, name_en: en || '', name_ko: ko, name_original: orig, name_original_lang: text(r.name_original_lang, 20),
    aliases: [], short_description: '', summary_ko: null, summary_en: null,
    primary_category: type ? CATEGORY_OF_TYPE[/** @type {keyof typeof CATEGORY_OF_TYPE} */ (type)] || null : null, project_type: type,
    region: T.regionOf(iso), kr_region: kr, country_iso2: iso, country: iso ? T.countryName(iso, 'ko') : '', city: text(r.city, 120) || '', city_ko: text(r.city_ko, 60), district: text(r.district, 120) || '', address: '',
    latitude: located ? lat : null, longitude: located ? lng : null,
    coordinate_review_status: located ? 'source' : null, coordinate_source: located ? 'dataset' : null, coordinate_source_url: located ? coordURL : null, location_precision: located ? 'exact' : 'unknown',
    year_installed: year(r.year ?? r.year_installed), year_completed: year(r.year_completed),
    review_status: 'unreviewed', record_origin: 'auto_collected', field_status: {}, credits: [], sources: [], assessments: [], technologies: [], content_types: [], spatial_context: [],
    curated_place_id: cur, wikidata: wd, website: '', official_url: null, source_url: wd ? 'https://www.wikidata.org/wiki/' + wd : '',
    // Without a stated tier an index thumbnail counts as context (tier 4): it never reaches the home page.
    thumb, card_tier: thumb ? tierOfRow || 4 : null, thumb_w: thumb ? num(r.thumb_w, 1e4) : null, thumb_h: thumb ? num(r.thumb_h, 1e4) : null,
    first_collected_at: time(r.added_at ?? r.added ?? r.first_seen), created_at: time(r.added_at ?? r.added ?? r.first_seen),
    scope: iso === 'KR' ? 'korea' : 'world',
    ...recordStatus(r),
  }
}
// What the record is (facility | program | festival | exhibition), its dates, and its status only with the source
// that states it (tourapi | wikidata | editorial | curated); a status without a source is not shown.
const RECORD_KINDS = new Set(['facility', 'program', 'festival', 'exhibition']), STATUS = new Set(['running', 'seasonal', 'ended', 'upcoming']), STATUS_SOURCES = new Set(['tourapi', 'wikidata', 'editorial', 'curated'])
const partialDate = (/** @type {any} */ v) => typeof v === 'string' && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(v) ? v : null
/** @param {any} r */
function recordStatus(r) {
  const src = typeof r.status_source === 'string' && STATUS_SOURCES.has(r.status_source) ? r.status_source : null
  return { record_kind: RECORD_KINDS.has(r.kind) ? r.kind : null, start_date: partialDate(r.start_date), end_date: partialDate(r.end_date), event_status: src && STATUS.has(r.status) ? r.status : null, event_status_source: src && STATUS.has(r.status) ? src : null }
}
/** Events and exhibitions held at a project (records' events[]), each with its own source. @param {any} v */
function events(v) {
  if (!Array.isArray(v)) return []
  return v.slice(0, 50).map(e => ({ id: text(e?.id, 40), kind: e?.kind === 'exhibition' ? 'exhibition' : 'event', title: text(e?.title, 200), status: ['upcoming', 'running', 'ended'].includes(e?.status) ? e.status : null, start: partialDate(e?.start), end: partialDate(e?.end), url: https(e?.url), source: e?.source && https(e.source.url) ? { url: https(e.source.url), license: text(e.source.license, 120), title: text(e.source.title || e.source.publisher, 200) } : null })).filter(e => e.title)
}

// A large index stores Commons thumbnails as "<h>/<hh>/<File.jpg>" and names the URL pattern once (thumb_template,
// e.g. https://upload.wikimedia.org/wikipedia/commons/thumb/{path}/500px-{file}); only Commons templates are accepted.
const TEMPLATE = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/\{path\}\/\d{2,4}px-\{file\}$/
const SHORT_THUMB = /^[0-9a-f]\/[0-9a-f]{2}\/[^/?#\s]{1,240}$/
/** @param {any} thumb @param {string|null} template */
export function expandThumb(thumb, template) {
  if (typeof thumb !== 'string' || !template || /^https:/.test(thumb) || !SHORT_THUMB.test(thumb)) return thumb
  return template.replace('{path}', thumb).replace('{file}', thumb.slice(thumb.lastIndexOf('/') + 1))
}

/** index.json → places (one per id, first row wins). @param {any} json @param {{publicURL?: string}} [o] */
export function fromIndex(json, o = {}) {
  if (!json || !Array.isArray(json.fields) || !Array.isArray(json.rows)) throw Error('invalid_index')
  const fields = json.fields.map((/** @type {any} */ f) => String(f)), seen = new Set(), out = []
  const template = typeof json.thumb_template === 'string' && TEMPLATE.test(json.thumb_template) ? json.thumb_template : null
  for (const row of json.rows) {
    if (!Array.isArray(row)) continue
    /** @type {Record<string, any>} */ const r = {}
    for (let i = 0; i < fields.length; i++) r[fields[i]] = row[i]
    if (template) r.thumb = expandThumb(r.thumb, template)
    const p = toPlace(r, o)
    if (!p || seen.has(p.place_id)) continue
    seen.add(p.place_id); out.push(p)
  }
  return out
}

/** A card photo of a compact row (the index thumb, credit unknown until the shard is read) or of a home card. */
export function cardMedia(/** @type {any} */ p, /** @type {any} */ img) {
  const m = img ? image(img) : null
  if (m) return mediaRow(p.place_id, m, 0)
  if (!p.thumb) return null
  // An index thumbnail: shown on explore cards (any tier there), its author and licence read with the record.
  // Its sizes: the Commons widths up to the thumbnail's own (the original's width is in the record, not the row).
  const tw = p.thumb_w || thumbWidth(p.thumb), sizes = (tw && commonsSizes(p.thumb, null)?.filter(x => x[0] <= tw)) || (tw ? [[tw, p.thumb]] : [])
  return { place_code: p.place_id, provider: 'dataset', provider_asset_id: 'dataset:' + p.thumb, display_url: p.thumb, original_file_url: '', clearance_status: 'cleared', review_required: false, creator: '', license_code: '', license_url: '', source_url: '', tier: p.card_tier || 4, home_ok: false, role: null, credit_pending: true, shard: p.shard, sizes, maxw: sizes.length ? sizes[sizes.length - 1][0] : null, width: null, height: null, ratio: p.thumb_w && p.thumb_h ? p.thumb_w / p.thumb_h : null }
}
/** An image record → the app's media row (the same fields as the Commons photos). */
export function mediaRow(/** @type {string} */ placeId, /** @type {ReturnType<typeof image>} */ m, /** @type {number} */ i) {
  if (!m) return null
  return {
    // No fallback to the original file (it may be many megabytes); the full file stays one link away (full_url).
    place_code: placeId, provider: 'dataset', provider_asset_id: 'dataset:' + m.src, display_url: m.thumb, original_file_url: '', full_url: m.src,
    clearance_status: 'cleared', review_required: false, creator: m.author || m.attribution || '', attribution: m.attribution, license_code: m.license, license_url: m.license_url || '',
    source_url: m.page || m.src, caption: '', caption_i18n: m.caption, captured_at: m.taken || '', tier: m.tier, home_ok: m.home_ok, role: m.role, width: m.width, height: m.height, focal: m.focal, order: i,
    image_provider: m.provider, rights_holder: m.rights_holder, usage: m.usage, approved: m.approved, context: m.context, sizes: m.sizes, maxw: m.maxw,
    kind: m.kind, raw_tier: m.raw_tier, media_active: m.media_active, subject: m.subject,
    title: m.title, description: m.description, commercial_use: m.commercial_use, kogl_type: m.kogl_type,
  }
}

const KIND = { official: 'official', wikidata: 'wikidata', wikipedia: 'encyclopedia', commons: 'commons', news: 'news', academic: 'academic', public_agency: 'public_agency', specialist_media: 'specialist_media', blog: 'blog' }
/** @param {any} v */
function sources(v) {
  if (!Array.isArray(v)) return []
  const out = [], seen = new Set()
  for (const s of v.slice(0, 40)) {
    const url = https(s?.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({ url, title: text(s.title, 300), publisher: text(s.publisher, 200), kind: KIND[/** @type {keyof typeof KIND} */ (s.kind)] || null, license: text(s.license, 120) })
  }
  return out
}
// A creator's portrait (credits[].portrait, kind artist_portrait) stays with the credit: shown only with the credits.
/** @param {any} v @param {string} placeId */
function credits(v, placeId = '') {
  if (!Array.isArray(v)) return []
  return v.slice(0, 40).map(c => { const ph = c?.portrait ? image(c.portrait) : null; return { role: vocab('credit_role', c?.role) || 'other', name: text(c?.name, 200), name_en: text(c?.name_en, 200), qid: qid(c?.wikidata_qid || c?.qid), ...(ph ? { portrait: mediaRow(placeId, ph, 0) } : {}) } }).filter(c => c.name)
}
const VISIT = new Set(['operating', 'seasonal', 'event_based', 'ended', 'inactive', 'demolished'])
/** Visit facts only when the source states them. @param {any} v */
function visit(v) {
  if (!v || typeof v !== 'object') return null
  const status = typeof v.status === 'string' && VISIT.has(v.status) ? v.status : null
  const note = i18n(v.note, 300), period = i18n(v.period, 120)
  return status || note || period ? { status, note, period, source: https(v.source) } : null
}

/**
 * One full record of a shard (projects/<shard>.json) → the fields that complete its place, and its photos and videos
 * in gallery order (media active first).
 * @param {any} r @param {{publicURL?: string}} [o]
 */
export function fromRecord(r, o = {}) {
  const base = toPlace({ ...r, year: r?.year_installed ?? r?.year, lat: r?.lat ?? r?.latitude, lng: r?.lng ?? r?.longitude }, o)
  if (!base) return null
  const imgs = (Array.isArray(r.images) ? r.images : []).slice(0, 24).map(image).filter(Boolean)
  // Media active first (by tier), the pipeline's own order within a tier; at most 12 (docs/STATIC_ARCHIVE.md).
  const ordered = imgs.map((m, i) => ({ m, i })).sort((a, b) => /** @type {any} */ (a.m).tier - /** @type {any} */ (b.m).tier || a.i - b.i).slice(0, 12).map(x => x.m)
  const official = https(r.official_url) || https(r.website)
  const src = sources(r.sources)
  if (official && !src.some(s => s.url === official)) src.unshift({ url: official, title: null, publisher: null, kind: 'official', license: null })
  const wd = base.wikidata
  if (wd && !src.some(s => s.url === 'https://www.wikidata.org/wiki/' + wd)) src.push({ url: 'https://www.wikidata.org/wiki/' + wd, title: 'Wikidata ' + wd, publisher: 'Wikidata', kind: 'wikidata', license: 'CC0 1.0' })
  const summaryKo = text(r.summary_ko, 2000), summaryEn = text(r.summary_en, 2000)
  const place = {
    ...base,
    aliases: Array.isArray(r.aliases) ? [...new Set(r.aliases.map((/** @type {any} */ a) => text(a, 200)).filter(Boolean))].slice(0, 30) : [],
    summary_ko: summaryKo, summary_en: summaryEn, short_description: summaryKo || summaryEn || '',
    address: text(r.address, 300) || '', district: text(r.district, 120) || '',
    year_completed: year(r.year_completed), year_ended: year(r.year_ended), year_operating_since: year(r.year_operating_since),
    operating_status: vocab('operating_status', r.operating_status),
    building_name: text(r.building_name, 200), installation_method: vocab('installation_method', r.installation_method), envelope_type: vocab('envelope_type', r.envelope_type),
    technologies: vocabList('technology', r.technologies ?? r.technology), content_types: vocabList('content_type', r.content_types ?? r.content_type),
    spatial_context: vocabList('spatial_context', r.spatial_context),
    credits: credits(r.credits, base.place_id), sources: src, official_url: official, website: official || '',
    visit: visit(r.visit), detail_loaded: true, events: events(r.events),
  }
  const media = ordered.map((m, i) => mediaRow(place.place_id, m, i))
  const videos = (Array.isArray(r.videos) ? r.videos : []).slice(0, 4).map(video).filter(Boolean)
  return { place, media, videos }
}

/** A shard file → full records by app id. Accepts {projects:[…]}, a bare array, or {id: record}. @param {any} json @param {{publicURL?: string}} [o] */
export function fromShard(json, o = {}) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.projects) ? json.projects : json && typeof json === 'object' ? Object.entries(json).filter(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) && datasetId(k)).map(([k, v]) => ({ id: k, ...v })) : null
  if (!list) throw Error('invalid_shard')
  const out = new Map()
  for (const r of list) { const x = fromRecord(r, o); if (x && !out.has(x.place.place_id)) out.set(x.place.place_id, x) }
  return out
}

// home.json. v0.18 (docs/UI_v018.md "home.json"): Korea first —
//   hero        [{project, image}]  reviewed tier-1/2 photos, Korean projects first
//   kr_regions  [{key, count, project?, image?}]  the eight Korean regions with counts
//   kr_featured [id]   Korean featured projects
//   kr_programs [id]   Korean exhibitions, festivals, media art, light festivals, nightscape
//   world       {highlights:[id], regions:[{key,count,…}], countries:[{key,count}], count} (or a plain list of ids)
//   counts      {projects, countries, with_images, kr, world}
// v0.17 (still read): featured, regions, types, themes, recent. Lists name a project by id (its compact record in
// "projects") or carry the record itself.
/** @param {any} json @param {{publicURL?: string}} [o] */
export function fromHome(json, o = {}) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw Error('invalid_home')
  /** @type {Map<string, any>} */ const places = new Map(), media = []
  const known = json.projects && typeof json.projects === 'object' ? json.projects : {}
  const take = (/** @type {any} */ x) => {
    const raw = typeof x === 'string' || typeof x === 'number' ? (known[x] ? { id: x, ...known[x] } : null) : x && typeof x === 'object' ? (x.id !== undefined ? x : null) : null
    if (!raw) return null
    const p = toPlace(raw, o)
    if (!p) return null
    if (!places.has(p.place_id)) {
      places.set(p.place_id, p)
      const m = cardMedia(p, raw.image)
      if (m) media.push(m)
    }
    return places.get(p.place_id)
  }
  const list = (/** @type {any} */ v, n = 24) => (Array.isArray(v) ? v : []).slice(0, n).map(take).filter(Boolean)
  const hero = (Array.isArray(json.hero) ? json.hero : []).slice(0, 8).map((/** @type {any} */ h) => {
    const p = take(h?.project ?? h?.id), img = image(h?.image)
    // A hero slide needs media-active evidence: v0.18 a reviewed tier-1/2 image, before that a tier-1 one (the
    // reviewed hero list). Whether it is large enough for the slot is the app's call (its width and sizes).
    return p && img && (img.v18 ? img.tier <= 2 && img.approved === true : img.tier === 1) ? { place: p, image: img } : null
  }).filter(Boolean)
  const group = (/** @type {any} */ v, /** @type {(k: any) => string|null} */ key, n = 24) => (Array.isArray(v) ? v : []).slice(0, n).map((/** @type {any} */ g) => {
    const k = key(g?.key), count = Number(g?.count)
    if (!k || !Number.isInteger(count) || count < 0) return null
    const p = g.project !== undefined ? take(g.project) : null, img = image(g.image)
    return { key: k, count, place: p, image: img && img.tier <= 3 ? img : null }
  }).filter(Boolean)
  const voc = (/** @type {string} */ name) => (/** @type {any} */ k) => vocab(name, k)
  const iso = (/** @type {any} */ k) => typeof k === 'string' && T.regionOf(k.toUpperCase()) ? k.toUpperCase() : null
  const themes = (Array.isArray(json.themes) ? json.themes : []).slice(0, 12).map((/** @type {any} */ t) => {
    const title = i18n(t?.title, 80), key = text(t?.key, 60)
    if (!title || !key) return null
    const projects = list(t.projects, 12), img = image(t.image)
    const filter = t.filter && typeof t.filter === 'object' ? Object.fromEntries(Object.entries(t.filter).filter(([k, v]) => /^[a-z_]{1,30}$/.test(k) && (typeof v === 'string' || Array.isArray(v)) ).map(([k, v]) => [k, Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 12) : v])) : null
    return { key, title, sub: i18n(t.sub ?? t.subtitle, 160), count: Number.isInteger(t.count) ? t.count : projects.length, projects, image: img && img.tier <= 3 ? img : null, filter }
  }).filter(Boolean)
  const c = json.counts && typeof json.counts === 'object' ? json.counts : {}
  const count = (/** @type {any} */ v) => Number.isInteger(v) && v >= 0 ? v : null
  const w = json.world
  const world = Array.isArray(w) ? { highlights: list(w, 12), regions: [], countries: [], count: null }
    : w && typeof w === 'object' ? { highlights: list(w.highlights ?? w.featured ?? w.projects, 12), regions: group(w.regions, voc('region')), countries: group(w.countries, iso, 40), count: count(w.count) } : null
  const v18 = ['kr_regions', 'kr_featured', 'kr_programs', 'world'].some(k => json[k] !== undefined)
  return {
    shape: v18 ? 'v18' : 'v17', build_id: text(json.build_id, 80), generated_at: time(json.generated_at),
    counts: { projects: count(c.projects), countries: count(c.countries), with_images: count(c.with_images), kr: count(c.kr ?? c.korea), world: count(c.world ?? c.foreign) },
    hero, krRegions: group(json.kr_regions, krKey, 8), krFeatured: list(json.kr_featured), krPrograms: list(json.kr_programs), world,
    featured: list(json.featured), recent: list(json.recent, 12),
    regions: group(json.regions, voc('region')), types: group(json.types, voc('project_type')), themes,
    places: [...places.values()], media,
  }
}
