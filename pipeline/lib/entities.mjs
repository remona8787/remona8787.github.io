// Entity resolution, dedupe/merge, project typing and eligibility (docs/STATIC_ARCHIVE.md "Project eligibility").
// Observations from every source become projects. Duplicates merge by, in order:
//   1. the same Wikidata QID;
//   2. a Commons category linked to the same QID (the category's pageprops item, or the item's P373);
//   3. the same normalised name within 300 m;
//   4. the same official URL.
// Rules 2–4 never join two different QIDs: such a pair is reported as a suspected duplicate for an editor (who can
// merge it with an editorial decision). All sources of merged observations stay attached.
import T from '../../site-public-cleared/archive-taxonomy.js'
import { canonicalUrl } from '../../edge-functions/_shared/archive/normalize.mjs'
import { normalizedName, haversine, validLat, validLng, isQid, uniq, wikidataPage, commonsPage, fnv1a } from './util.mjs'

export const MERGE_DISTANCE_M = 300
export const PROJECT_TYPES = T.keys('project_type')
// When several configured classes give different types, the most specific wins.
const TYPE_PRIORITY = ['media_facade', 'projection_mapping', 'media_wall', 'urban_screen', 'interactive_installation', 'media_architecture', 'light_art', 'festival_program', 'other']
// URL hosts that are shared by many unrelated projects (portals, social networks): rule 4 does not use them.
const SHARED_HOSTS = /(^|\.)(facebook|instagram|twitter|x|youtube|linkedin|tiktok|weibo|naver|daum|google|wikipedia|wikimedia|wikidata|visitseoul|seoul\.go|blogspot|wordpress|tistory)\./i

export class Clusters {
  constructor() { this.parent = new Map(); this.qids = new Map(); this.merges = []; this.conflicts = [] }
  add(key, qid = null) {
    if (!this.parent.has(key)) { this.parent.set(key, key); this.qids.set(key, new Set()) }
    if (qid) this.qids.get(this.find(key)).add(qid)
    return key
  }
  find(k) {
    let r = k
    while (this.parent.get(r) !== r) r = this.parent.get(r)
    let x = k
    while (this.parent.get(x) !== r) { const n = this.parent.get(x); this.parent.set(x, r); x = n }
    return r
  }
  /** Joins two keys. Refused (and recorded as a conflict) when it would join two different QIDs, unless forced. */
  union(a, b, reason, { force = false, detail = null } = {}) {
    this.add(a); this.add(b)
    const ra = this.find(a), rb = this.find(b)
    if (ra === rb) return true
    const qs = new Set([...this.qids.get(ra), ...this.qids.get(rb)])
    if (qs.size > 1 && !force) { this.conflicts.push({ a, b, reason, qids: [...qs].sort(), detail }); return false }
    const [root, child] = ra < rb ? [ra, rb] : [rb, ra]
    this.parent.set(child, root)
    this.qids.set(root, qs)
    this.qids.delete(child)
    if (reason !== 'identity') this.merges.push({ a, b, reason, detail })
    return true
  }
  groups() {
    const out = new Map()
    for (const k of [...this.parent.keys()].sort()) { const r = this.find(k); if (!out.has(r)) out.set(r, []); out.get(r).push(k) }
    return out
  }
}

/**
 * Clusters observations by rules 1–2. facts: Map(qid → wikidata facts). Returns the Clusters and obs keys.
 * @param {any[]} observations
 */
export function clusterObservations(observations, facts) {
  const cl = new Clusters()
  observations.forEach((o, i) => {
    const k = cl.add('obs:' + String(i).padStart(6, '0'))
    o._key = k
    if (o.qid) cl.union(k, cl.add('q:' + o.qid, o.qid), 'identity', { force: true })
    if (o.category) cl.union(k, cl.add('c:' + o.category), o.qid ? 'identity' : 'commons_category', { force: !!o.qid && !o.qid_from_category_conflict })
    if (o.curated_id) cl.union(k, cl.add('cur:' + o.curated_id), 'identity', { force: true })
    if (o.editorial_id) cl.union(k, cl.add('ed:' + o.editorial_id), 'identity', { force: true })
    if (o.tourapi_id) cl.union(k, cl.add('t:' + o.tourapi_id), 'identity', { force: true })
  })
  // Rule 2: the item's own Commons category (P373) is the same project as that category.
  for (const [qid, f] of facts) {
    if (!f?.commons_category || !cl.parent.has('q:' + qid)) continue
    if (cl.parent.has('c:' + f.commons_category)) cl.union('q:' + qid, 'c:' + f.commons_category, 'commons_category_p373', { detail: f.commons_category })
  }
  return cl
}

const nameKeys = (p) => uniq([p.name_en, p.name_ko, p.name_original].map(normalizedName)).filter((k) => k.length >= 3)

/** Rules 3–4 on built projects (they need names, coordinates and URLs). Mutates clusters; returns the merges made. */
export function mergeByNameAndUrl(cl, projects) {
  const byName = new Map(), byUrl = new Map()
  for (const p of projects) {
    for (const k of nameKeys(p)) { if (!byName.has(k)) byName.set(k, []); byName.get(k).push(p) }
    const u = canonicalUrl(p.official_url)
    if (u) { let host = ''; try { host = new URL(u).hostname } catch {} if (!SHARED_HOSTS.test(host + '.')) { if (!byUrl.has(u)) byUrl.set(u, []); byUrl.get(u).push(p) } }
  }
  const made = []
  for (const [k, list] of byName) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j]
      if (!validLat(a.latitude) || !validLat(b.latitude)) continue
      const d = haversine({ lat: a.latitude, lng: a.longitude }, { lat: b.latitude, lng: b.longitude })
      if (d <= MERGE_DISTANCE_M && cl.union(a._root, b._root, 'name_within_300m', { detail: { name: k, distance_m: Math.round(d) } })) made.push({ rule: 'name_within_300m', a: a._root, b: b._root, distance_m: Math.round(d) })
    }
  }
  for (const [u, list] of byUrl) {
    if (list.length < 2 || list.length > 3) continue
    for (let i = 1; i < list.length; i++) if (cl.union(list[0]._root, list[i]._root, 'same_official_url', { detail: u })) made.push({ rule: 'same_official_url', a: list[0]._root, b: list[i]._root, url: u })
  }
  // A TourAPI place (an attraction, a cultural facility) and a project named after it within 300 m: TourAPI titles
  // name the place ("롯데월드타워"), the archive the work on it ("롯데월드타워 미디어파사드"), so one name containing the
  // other is enough. Never between two TourAPI items, never across two QIDs.
  const tour = projects.filter((p) => p.tourapi_id && validLat(p.latitude))
  for (const t of tour) {
    const tk = nameKeys(t)
    for (const p of projects) {
      if (p === t || p.tourapi_id || !validLat(p.latitude)) continue
      const d = haversine({ lat: t.latitude, lng: t.longitude }, { lat: p.latitude, lng: p.longitude })
      if (d > MERGE_DISTANCE_M) continue
      const pk = nameKeys(p)
      const hit = tk.find((a) => pk.some((b) => a.length >= 3 && b.length >= 3 && (a.includes(b) || b.includes(a))))
      if (hit && cl.union(p._root, t._root, 'tourapi_name_within_300m', { detail: { name: hit, distance_m: Math.round(d) } })) { made.push({ rule: 'tourapi_name_within_300m', a: p._root, b: t._root, distance_m: Math.round(d) }); break }
    }
  }
  return made
}

const first = (...v) => v.find((x) => x !== null && x !== undefined && x !== '') ?? null
const typeRank = (t) => { const i = TYPE_PRIORITY.indexOf(t); return i < 0 ? 99 : i }
// Types whose work is the building's own surface: the building item is the work's carrier, not an institution.
const FACADE_CARRIERS = new Set(['media_facade', 'media_wall', 'urban_screen'])

/** Project type with its source and confidence. */
export function projectType({ editorial, curated, classTypes, wikipedia, wikipediaType = null, commonsTypes, tourType = null }) {
  if (editorial && PROJECT_TYPES.includes(editorial)) return { project_type: editorial, source: 'editorial', low_confidence: false }
  if (curated?.project_type) return { project_type: curated.project_type, source: curated.type_source, low_confidence: !!curated.type_low_confidence }
  // A class that is the item's own P31 says more than one reached through P279*; then the most specific type.
  const classes = classTypes.filter((c) => PROJECT_TYPES.includes(c.project_type)).sort((a, b) => (b.direct ? 1 : 0) - (a.direct ? 1 : 0) || typeRank(a.project_type) - typeRank(b.project_type))
  if (classes.length) return { project_type: classes[0].project_type, source: 'class:' + classes[0].qid, low_confidence: !!classes[0].low_confidence && classes.every((c) => c.low_confidence) }
  // An article that states a media facade: the item is the building (or, for a festival item, the festival).
  if (wikipedia) return { project_type: PROJECT_TYPES.includes(wikipediaType) ? wikipediaType : 'media_facade', source: 'wikipedia_media_facade', low_confidence: false }
  const ct = commonsTypes.filter((t) => PROJECT_TYPES.includes(t)).sort((a, b) => typeRank(a) - typeRank(b))
  if (ct.length) return { project_type: ct[0], source: 'commons_category', low_confidence: true }
  // A TourAPI item whose title or overview names the term and that the keyword classifier accepted.
  if (tourType && PROJECT_TYPES.includes(tourType)) return { project_type: tourType, source: 'tourapi_term', low_confidence: true }
  return { project_type: null, source: null, low_confidence: true }
}

/** Year fields by what the item is: a work's inception is its installation, a building's its completion. */
export function yearsOf(f, projectType, itemIsWork) {
  if (!f) return {}
  if (projectType === 'festival_program') return { year_operating_since: first(f.start, f.inception), year_ended: f.end }
  if (itemIsWork) return { year_installed: f.inception, year_operating_since: f.start, year_ended: f.end }
  return { year_completed: f.inception, year_operating_since: f.start, year_ended: f.end }
}

/** The first administrative name of a Korean address that is a city ("서울특별시 중구 …" → 서울특별시, "경기도 수원시 …" → 수원시). */
export function koreanCityOf(address) {
  const tokens = String(address || '').trim().split(/\s+/)
  if (/(특별시|광역시|특별자치시)$/.test(tokens[0] || '')) return tokens[0]
  if (/(도)$/.test(tokens[0] || '') && /(시|군)$/.test(tokens[1] || '')) return tokens[1]
  if (/^(서울|부산|대구|인천|광주|대전|울산|세종)$/.test(tokens[0] || '')) return tokens[0]
  return null
}

const cleanCategoryName = (t) => String(t || '').replace(/^Category:/, '').replace(/\s*\([^)]*\)\s*$/, '').trim() || null

/**
 * One project from its cluster's observations and the Wikidata facts of its QID.
 * @param {any[]} obs @param {any} facts @param {{qidFacts?: Map}} ctx
 */
export function buildProject(obs, facts, ctx = {}) {
  const curated = obs.find((o) => o.origin === 'curated') || null
  const editorialObs = obs.find((o) => o.origin === 'editorial') || null
  const tour = obs.find((o) => o.origin === 'tourapi') || null
  const cats = obs.filter((o) => o.category)
  const wiki = obs.flatMap((o) => o.evidence || []).filter((e) => e.kind === 'wikipedia' && e.accepted)
  const classTypes = obs.flatMap((o) => o.class_types || [])
  const f = facts || null
  const fs = {}
  const set = (field, value, source) => { if (value !== null && value !== undefined && value !== '') { fs[field] = source; return value } return null }
  const hint = cats.map((c) => c.place_hint).find((h) => h?.country_iso2) || null
  const catCoord = cats.find((c) => validLat(c.lat) && validLng(c.lng)) || null
  const catName = cleanCategoryName(cats[0]?.category)
  const wikiTitle = (lang) => wiki.find((w) => w.lang === lang)?.title || null

  const p = {
    qid: curated?.qid || f?.qid || obs.find((o) => o.qid)?.qid || null,
    qid_match: curated?.qid_match || (f ? 'exact' : null),
    curated_id: curated?.curated_id || null,
    editorial_id: editorialObs?.editorial_id || null,
    tourapi_id: tour?.tourapi_id || null,
    origins: uniq(obs.map((o) => o.origin)).sort(),
  }
  p.tourapi = tour?.tourapi || null
  p.korea = obs.some((o) => o.korea)
  const host = p.qid_match === 'host'
  p.name_ko = set('name_ko', first(editorialObs?.name?.ko, curated?.name?.ko, host ? null : f?.name_ko, wikiTitle('ko'), tour?.name?.ko), curated?.name?.ko ? 'curated' : editorialObs?.name?.ko ? 'editorial' : f?.name_ko && !host ? 'wikidata' : wikiTitle('ko') ? 'wikipedia:ko' : 'tourapi')
  p.name_en = set('name_en', first(editorialObs?.name?.en, curated?.name?.en, host ? null : f?.name_en, wikiTitle('en'), /^[\p{Script=Latin}\d\s\p{P}]+$/u.test(catName || '') ? catName : null), curated?.name?.en ? 'curated' : editorialObs?.name?.en ? 'editorial' : f?.name_en && !host ? 'wikidata' : wikiTitle('en') ? 'wikipedia:en' : 'commons')
  p.name_original = set('name_original', first(editorialObs?.name?.original, curated?.name?.original, host ? null : f?.name_original, tour?.name?.original), curated ? 'curated' : editorialObs?.name?.original ? 'editorial' : f?.name_original && !host ? 'wikidata' : 'tourapi')
  p.name_original_lang = p.name_original ? first(editorialObs?.name?.original_lang, curated?.name?.original_lang, f?.name_original_lang) : null
  if (!p.name_en && !p.name_ko && !p.name_original) {
    const any = first(f?.any_label, catName, wiki[0]?.title)
    p.name_en = set('name_en', any, f?.any_label ? 'wikidata' : catName ? 'commons' : 'wikipedia')
  }
  p.building_name = host ? first(f?.name_ko, f?.name_en) : null
  p.country_iso2 = set('country_iso2', first(editorialObs?.country_iso2, curated?.country_iso2, f?.country_iso2, tour?.country_iso2, hint?.country_iso2), editorialObs?.country_iso2 ? 'editorial' : curated?.country_iso2 ? 'curated' : f?.country_iso2 ? 'wikidata' : tour ? 'tourapi' : 'derived:commons_parent_category')
  p.region = p.country_iso2 ? T.regionOf(p.country_iso2) : null
  p.city = set('city', first(editorialObs?.city, curated?.city, f?.city, hint?.city), editorialObs?.city ? 'editorial' : curated?.city ? 'curated' : f?.city ? 'wikidata' : 'derived:commons_parent_category')
  p.city_ko = first(editorialObs?.city_ko, curated?.city_ko, f?.city_ko)
  p.district = curated?.district || null
  p.address = curated?.address || tour?.address || null
  if (p.address && !curated?.address) fs.address = 'tourapi'
  // A TourAPI-only place: the city is the address's first administrative name (서울특별시, 수원시…).
  if (!p.city && !p.city_ko && tour?.address) { const c = koreanCityOf(tour.address); if (c) { p.city_ko = c; fs.city_ko = 'tourapi' } }
  const lat = first(editorialObs?.lat, curated?.lat, f?.latitude, tour?.lat, catCoord?.lat), lng = first(editorialObs?.lng, curated?.lng, f?.longitude, tour?.lng, catCoord?.lng)
  const coordSource = editorialObs?.lat != null ? 'editorial' : curated?.lat != null ? 'curated' : f?.latitude != null ? 'wikidata' : tour?.lat != null ? 'tourapi' : 'commons'
  p.latitude = validLat(lat) && validLng(lng) ? set('latitude', lat, coordSource) : null
  p.longitude = p.latitude !== null ? set('longitude', lng, coordSource) : null
  p.location_precision = p.latitude !== null ? 'exact' : p.city ? 'city' : 'unknown'

  const typed = projectType({ editorial: editorialObs?.project_type, curated, classTypes, wikipedia: wiki.length > 0, wikipediaType: wiki.find((w) => w.type)?.type ?? null, commonsTypes: cats.map((c) => c.project_type).filter(Boolean), tourType: tour?.project_type ?? null })
  p.project_type = typed.project_type
  if (typed.source) fs.project_type = typed.source === 'editorial' ? 'editorial' : typed.source.startsWith('curated') ? 'curated' : typed.source.startsWith('class:') || typed.source.startsWith('wikipedia') ? (typed.source.startsWith('class:') ? 'wikidata' : 'wikipedia') : typed.source === 'tourapi_term' ? 'derived:tourapi' : 'derived:commons_category'
  p.type_source = typed.source
  p.type_low_confidence = typed.low_confidence
  const itemIsWork = classTypes.length > 0 && !host
  Object.assign(p, { year_installed: null, year_completed: null, year_operating_since: null, year_ended: null }, yearsOf(host ? null : f, p.project_type, itemIsWork))
  for (const k of ['year_installed', 'year_completed', 'year_operating_since', 'year_ended']) if (p[k] != null) fs[k] = 'wikidata'
  p.operating_status = curated?.visit?.status && curated.visit.status !== 'unknown' ? curated.visit.status : p.year_ended && p.year_ended <= (ctx.year ?? 9999) ? 'ended' : null
  if (p.operating_status) fs.operating_status = curated?.visit?.status ? 'curated' : 'wikidata'

  const credits = []
  if (f && !host) {
    for (const a of f.architects) credits.push({ role: 'architect', name: a.name || a.name_en, name_en: a.name_en, wikidata_qid: a.qid })
    for (const a of f.creators) credits.push({ role: 'media_artist', name: a.name || a.name_en, name_en: a.name_en, wikidata_qid: a.qid })
    for (const a of f.operators) credits.push({ role: 'operator', name: a.name || a.name_en, name_en: a.name_en, wikidata_qid: a.qid })
  }
  p.credits = credits
  if (credits.length) fs.credits = 'wikidata'
  p.official_url = set('official_url', first(editorialObs?.official_url, curated?.official_url, host ? null : f?.official_url, tour?.official_url), editorialObs?.official_url ? 'editorial' : curated?.official_url ? 'curated' : f?.official_url && !host ? 'wikidata' : 'tourapi')
  p.description_ko = set('description_ko', first(editorialObs?.description_ko, curated?.description_ko, host ? null : f?.description_ko), editorialObs?.description_ko ? 'editorial' : curated?.description_ko ? 'curated' : 'wikidata')
  p.description_en = set('description_en', first(editorialObs?.description_en, host ? null : f?.description_en), editorialObs?.description_en ? 'editorial' : 'wikidata')
  p.commons_category = first(f?.commons_category, cats[0]?.category)
  p.visit = curated?.visit || null
  if (p.visit) fs.visit = 'curated'
  p.record_origin = curated ? 'curated' : editorialObs ? 'editor_created' : 'auto_collected'

  // Sources (each has an id that field_sources refers to).
  const sources = []
  const add = (s) => { if (s.url && !sources.some((x) => x.url === s.url)) sources.push(s) }
  for (const o of obs) for (const s of o.sources || []) add(s)
  if (p.qid) add({ id: 'wikidata', kind: 'wikidata', title: host ? `Wikidata ${p.qid} (building)` : `Wikidata ${p.qid}`, url: wikidataPage(p.qid), publisher: 'Wikidata' })
  if (f && !host) {
    // Fixed order (Korean, English, then by code): cached entities come back with sorted keys, fresh ones do not.
    const rank = (w) => { const i = ['kowiki', 'enwiki'].indexOf(w); return i < 0 ? 9 : i }
    for (const [wiki, s] of Object.entries(f.sitelinks || {}).sort(([a], [b]) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0))) {
      if (wiki === 'commonswiki' || !s.url) continue
      const lang = wiki.replace(/wiki$/, '')
      if (['ko', 'en', p.name_original_lang].includes(lang)) add({ id: 'wikipedia:' + lang, kind: 'wikipedia', title: s.title, url: s.url, publisher: `Wikipedia (${lang})` })
    }
  }
  for (const w of wiki) add({ id: 'wikipedia:' + w.lang, kind: 'wikipedia', title: w.title, url: w.url, publisher: `Wikipedia (${w.lang})`, supports: ['project_type'] })
  if (p.commons_category) add({ id: 'commons', kind: 'commons', title: p.commons_category, url: commonsPage(p.commons_category), publisher: 'Wikimedia Commons' })
  if (p.official_url) add({ id: 'official', kind: 'official', title: (() => { try { return new URL(p.official_url).hostname.replace(/^www\./, '') } catch { return null } })(), url: p.official_url, publisher: null })
  p.sources = sources.map((s) => ({ id: s.id, kind: s.kind, title: s.title ?? null, url: s.url, publisher: s.publisher ?? null, ...(s.supports ? { supports: s.supports } : {}) }))
  // field_sources point to a source id; a value from a source that is not attached is not cited.
  const ids = new Set(p.sources.map((s) => s.id))
  for (const [k, v] of Object.entries(fs)) {
    if (v === 'curated') fs[k] = ids.has('curated:source') ? 'curated:source' : [...ids].find((x) => x.startsWith('curated')) || 'curated'
    else if (v.startsWith('wikipedia') && !ids.has(v)) fs[k] = [...ids].find((x) => x.startsWith('wikipedia')) || v
    else if (v === 'commons' && !ids.has('commons')) fs[k] = 'derived:commons_category'
  }
  p.field_sources = fs

  // Image inputs.
  p.p18 = host ? [] : f?.images || []
  // The item is an institution, building, tower or district rather than the work itself (a host building, or a
  // curated place whose item is not of a light-work class): its P18, depicts files and Commons category show the
  // institution and the events held there, not the work, unless a file names the work or media (images.mjs). A media
  // facade, media wall or urban screen is the building's own surface, so its building item is not an institution.
  // Only a curated place's item can be the institution: the other sources found their item as the work itself (a
  // class instance, a light-work category, an article about it). A curated item of a light-work class is the work.
  p.item_is_work = itemIsWork || (!!f && !host && (f.p31 || []).some((q) => ctx.workClasses?.has(q)))
  p.item_institution = !!f && (host || (!!curated && !p.item_is_work && !FACADE_CARRIERS.has(p.project_type)))
  p.item_names = f ? uniq([f.name_ko, f.name_en, f.name_original, f.any_label].filter(Boolean)) : []
  const ownCats = new Set(cats.map((c) => c.category))
  p.image_categories = uniq([
    ...(p.commons_category ? [p.commons_category] : []),
    ...cats.map((c) => c.category),
  ]).map((title) => ({ title, source: 'category', ...(p.item_institution && !ownCats.has(title) ? { institution: true } : {}) }))
  for (const c of cats) {
    for (const t of c.parts || []) p.image_categories.push({ title: t, source: 'part_category' })
    for (const t of c.editions || []) p.image_categories.push({ title: t, source: 'event_category' })
    for (const t of c.night_subcats || []) p.image_categories.push({ title: t, source: 'night_category' })
  }
  p.classes = uniq(classTypes.map((c) => c.qid)).sort()
  p.class_publish = classTypes.some((c) => c.publish)
  p.evidence = obs.flatMap((o) => o.evidence || [])
  p.p31_labels = f?.p31_labels || []
  p.facts_found = !!f
  return p
}

/**
 * Whether a project is public, with every reason it is not (docs/STATIC_ARCHIVE.md "Project eligibility").
 * @param {any} p @param {{blockQids?: Set<string>, blockPattern?: RegExp|null}} ctx
 */
export function eligibility(p, ctx = {}) {
  const reasons = []
  const approved = !!p.editorial?.approved
  if (p.editorial?.hidden) reasons.push('hidden_by_editor')
  if (!(p.qid || p.commons_category || p.curated_id || p.editorial_id || p.tourapi_id || approved)) reasons.push('no_stable_identity')
  if (!(p.name_en || p.name_ko || p.name_original)) reasons.push('no_name')
  if (!p.country_iso2) reasons.push('no_country')
  if (p.latitude === null && !p.city) reasons.push('no_coordinates_or_city')
  if (!p.project_type || !PROJECT_TYPES.includes(p.project_type)) reasons.push('no_project_type')
  const blocked = (p.blocked_by || [])
  if (blocked.length && !approved) reasons.push(...blocked.map((b) => 'blocklist:' + b))
  if (!p.sources.some((s) => ['wikidata', 'wikipedia', 'commons', 'official'].includes(s.kind) || (p.curated_id && s.url))) reasons.push('no_public_source')
  // What the sources alone do not establish: curated and approved records skip these gates.
  if (!p.curated_id && !approved) {
    const origins = p.origins.filter((o) => o !== 'evidence')
    if (origins.length === 1 && origins[0] === 'wikidata_class' && !p.class_publish) reasons.push('unverified_class_only')
    if (p.origins.includes('wikidata_class') && !p.class_publish && !p.origins.some((o) => o === 'wikipedia' || o === 'commons')) { if (!reasons.includes('unverified_class_only')) reasons.push('unverified_class_only') }
    if (p.require_coordinates && p.latitude === null) reasons.push('class_requires_coordinates')
    const wikiOnly = p.origins.every((o) => o === 'wikipedia')
    if (wikiOnly && !p.evidence.some((e) => e.kind === 'wikipedia' && e.accepted)) reasons.push('wikipedia_relevance_low')
    if (p.origins.includes('web')) reasons.push('web_candidate_not_approved')
  }
  return { eligible: reasons.length === 0, reasons }
}

/** A stable id for a new project: the curated id, else the QID, else a hash of its Commons category or editor id. */
export function newId(p) {
  if (p.curated_id) return p.curated_id
  if (p.editorial_id) return 'ED-' + p.editorial_id
  if (isQid(p.qid)) return p.qid
  if (p.commons_category) return 'CAT-' + fnv1a(p.commons_category).toString(36).toUpperCase().padStart(7, '0')
  if (p.tourapi_id && /^\d{1,12}$/.test(p.tourapi_id)) return 'KTO-' + p.tourapi_id
  return 'X-' + fnv1a(JSON.stringify([p.name_en, p.name_ko, p.country_iso2])).toString(36).toUpperCase()
}
