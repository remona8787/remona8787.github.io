// Country and location recovery (docs/PIPELINE.md "Country recovery"). A project that is excluded only because its
// country (and, for a Commons category, its location) is missing gets them from evidence, never from a guess.
//
// Evidence, strong (each a vote for one country):
//   - wikidata_location: the item's administrative area (P131) or location (P276) leads to a country (P17), walking
//     P131 up; a country item without an ISO code takes its own P17's (Q55 Netherlands → Q29999 → NL). This one is
//     applied in wikidata.mjs factsOf for every item (no request).
//   - coordinates: the item's P625 lies inside one country's borders (bundled borders, @rapideditor/country-coder).
//   - parent_category: a parent category of the project's Commons category names a country or a city ("Light
//     festivals in South Korea", "Giza") or a Korean place of the gazetteer (lib/korea.mjs), or is linked to a
//     Wikidata item whose country is known (Category:Uxmal → Uxmal → Mexico).
//   - file_geotags: the camera locations of the category's files; a vote when at least `min_geotags` files are
//     geotagged and at least `country_share` of them lie in one country.
// Evidence, weak: the language of the item's only Wikipedia articles (ko → KR …). It is recorded and never decides.
// Strong votes for two countries, or geotags with `other_country_share` or more in another country (a work shown in
// many cities, such as Global Rainbow), leave the project excluded (outcome "conflict"). A recovered Commons project
// without coordinates or a city takes the city its parents name, else the centre of its tight geotag cluster
// (location_precision "approximate"). Every decision and its evidence goes to review/places.json.
import { detectLocation } from '../../edge-functions/_shared/archive/normalize.mjs'
import { api } from './commons.mjs'
import { dateNameReason } from './not-projects.mjs'
import { fetchAux, auxNext, countryOfPlace } from './wikidata.mjs'
import { regionFromText } from './korea.mjs'
import { HOUR } from './cache.mjs'
import { chunk, uniq, haversine, validLat, validLng, compareStrings } from './util.mjs'

let ccPromise = null
/** The bundled country borders (null when the package is not installed: recovery then uses no coordinates). */
export function loadCountryCoder() {
  ccPromise ??= import('@rapideditor/country-coder').then((m) => m.default?.iso1A2Code ? m.default : m, () => null)
  return ccPromise
}
/** ISO 3166-1 alpha-2 code of the country whose borders contain the point, or null (open sea, Antarctica). */
export function countryAt(cc, lat, lng) {
  if (!cc || !validLat(lat) || !validLng(lng)) return null
  const code = cc.iso1A2Code([Number(lng), Number(lat)])
  return /^[A-Z]{2}$/.test(code || '') ? code : null
}

export { isoOfCountry, countryOfPlace } from './wikidata.mjs'

// ---------------------------------------------------------------- Commons requests (cached)

/** Parent categories (visible ones) and the linked Wikidata item of categories, 50 per request. Map(title → {parents, item}). */
export async function categoryParents(client, titles, { cache, ttlHours = 720, stage = 'places' } = {}) {
  const out = new Map()
  const want = []
  for (const t of uniq(titles)) { const hit = cache?.fresh('commons-parents', t); if (hit !== undefined) out.set(t, hit); else want.push(t) }
  for (const group of chunk(want, 50)) {
    const got = new Map(group.map((t) => [t, { parents: [], item: null }]))
    let cont = {}
    for (let round = 0; round < 10; round++) {
      const json = await client.json(api({ action: 'query', prop: 'categories|pageprops', ppprop: 'wikibase_item', clshow: '!hidden', cllimit: 'max', titles: group.join('|'), ...cont }), { stage })
      const norm = new Map((json?.query?.normalized || []).map((n) => [n.to, n.from]))
      for (const pg of json?.query?.pages || []) {
        const e = got.get(norm.get(pg.title) || pg.title)
        if (!e) continue
        for (const c of pg.categories || []) if (!e.parents.includes(c.title)) e.parents.push(c.title)
        if (pg.pageprops?.wikibase_item) e.item = pg.pageprops.wikibase_item
      }
      if (!json?.continue) break
      cont = { ...json.continue }
    }
    for (const [t, e] of got) { e.parents.sort(compareStrings); out.set(t, e); cache?.set('commons-parents', t, e, { ttlMs: ttlHours * HOUR }) }
  }
  return out
}

/** Wikidata items linked to categories (pageprops), 50 per request. Map(title → qid|null). */
export async function categoryItems(client, titles, { cache, ttlHours = 720, stage = 'places' } = {}) {
  const out = new Map()
  const want = []
  for (const t of uniq(titles)) { const hit = cache?.fresh('commons-category-item', t); if (hit !== undefined) out.set(t, hit); else want.push(t) }
  for (const group of chunk(want, 50)) {
    const json = await client.json(api({ action: 'query', prop: 'pageprops', ppprop: 'wikibase_item', titles: group.join('|') }), { stage })
    const norm = new Map((json?.query?.normalized || []).map((n) => [n.to, n.from]))
    const got = new Map(group.map((t) => [t, null]))
    for (const pg of json?.query?.pages || []) { const t = norm.get(pg.title) || pg.title; if (got.has(t)) got.set(t, pg.pageprops?.wikibase_item || null) }
    for (const [t, q] of got) { out.set(t, q); cache?.set('commons-category-item', t, q, { ttlMs: ttlHours * HOUR }) }
  }
  return out
}

/** Camera locations (GeoData primary coordinates) of up to `limit` files of a category: [{file, lat, lng}]. */
export async function categoryGeotags(client, title, { cache, ttlHours = 720, limit = 100, stage = 'places' } = {}) {
  const json = await client.json(api({ action: 'query', generator: 'categorymembers', gcmtitle: title, gcmtype: 'file', gcmlimit: String(Math.min(500, limit)), prop: 'coordinates', colimit: 'max' }), { stage, cache: cache ? { ns: 'commons-geotags', key: title, ttlMs: ttlHours * HOUR } : null })
  const out = []
  for (const pg of json?.query?.pages || []) {
    const c = (pg.coordinates || []).find((x) => validLat(x.lat) && validLng(x.lon) && (x.globe || 'earth') === 'earth')
    if (c) out.push({ file: String(pg.title || '').replace(/^File:/, ''), lat: c.lat, lng: c.lon })
  }
  return out.sort((a, b) => compareStrings(a.file, b.file))
}

// ---------------------------------------------------------------- evidence and the decision

/**
 * Countries of geotagged files: {n, countries: {iso: count}, top, share, center, cluster} where center is the medoid
 * of the top country's points when at least half of all points lie within `clusterKm` of it.
 */
export function geotagSummary(points, cc, { clusterKm = 5, clusterShare = 0.5 } = {}) {
  const located = points.map((p) => ({ ...p, iso: countryAt(cc, p.lat, p.lng) })).filter((p) => p.iso)
  const countries = {}
  for (const p of located) countries[p.iso] = (countries[p.iso] || 0) + 1
  const ranked = Object.entries(countries).sort((a, b) => b[1] - a[1] || compareStrings(a[0], b[0]))
  const n = located.length
  const top = ranked[0]?.[0] || null
  const share = n ? (ranked[0][1] / n) : 0
  let center = null, cluster = 0
  if (top) {
    const pts = located.filter((p) => p.iso === top)
    let best = null
    for (const a of pts) {
      const near = pts.filter((b) => haversine(a, b) <= clusterKm * 1000).length
      const sum = pts.reduce((s, b) => s + haversine(a, b), 0)
      if (!best || near > best.near || (near === best.near && sum < best.sum)) best = { p: a, near, sum }
    }
    cluster = best.near
    if (cluster >= 2 && cluster / n >= clusterShare) center = { lat: Math.round(best.p.lat * 1e6) / 1e6, lng: Math.round(best.p.lng * 1e6) / 1e6, file: best.p.file }
  }
  return { n, countries, top, share: Math.round(share * 100) / 100, center, cluster }
}

/**
 * The decision from the evidence: {country, city, center, outcome: recovered|conflict|no_evidence, rule, votes}.
 * @param {{kind: string, country: string|null, strength: 'strong'|'weak', city?: string|null, detail?: any}[]} evidence
 * @param {any} geo geotagSummary or null @param {any} o thresholds
 */
export function decideCountry(evidence, geo, o = {}) {
  const strong = evidence.filter((e) => e.strength === 'strong' && e.country)
  const countries = uniq(strong.map((e) => e.country)).sort()
  // Photos taken in several countries and nothing else: a travelling work, never one country.
  if (!countries.length && geo?.n >= (o.min_geotags ?? 2) && geo.share < (o.country_share ?? 0.7)) return { country: null, outcome: 'conflict', votes: {}, reason: `geotags in several countries: ${JSON.stringify(geo.countries)}` }
  if (!countries.length) return { country: null, outcome: 'no_evidence', votes: {} }
  const votes = Object.fromEntries(countries.map((c) => [c, strong.filter((e) => e.country === c).map((e) => e.kind)]))
  if (countries.length > 1) return { country: null, outcome: 'conflict', votes, reason: 'strong evidence names ' + countries.join(' and ') }
  const country = countries[0]
  // A work shown in several countries: its files say so.
  if (geo?.n) {
    const other = geo.n - (geo.countries[country] || 0)
    if (other / geo.n >= (o.other_country_share ?? 0.3) && other >= 1) return { country: null, outcome: 'conflict', votes, reason: `geotags: ${JSON.stringify(geo.countries)}` }
  }
  const city = strong.find((e) => e.country === country && e.city)?.city || null
  const center = geo?.center && geo.top === country ? geo.center : null
  return { country, city, center, outcome: 'recovered', rule: votes[country][0], votes }
}

/** Single-country Wikipedia languages (weak evidence only). */
export const LANGUAGE_COUNTRY = { ko: 'KR', ja: 'JP', fi: 'FI', pl: 'PL', cs: 'CZ', sk: 'SK', hu: 'HU', et: 'EE', lv: 'LV', lt: 'LT', sl: 'SI', is: 'IS', da: 'DK', nb: 'NO', nn: 'NO', no: 'NO', he: 'IL', th: 'TH', vi: 'VN', uk: 'UA', bg: 'BG', ka: 'GE', hy: 'AM', tr: 'TR', id: 'ID', el: 'GR' }
export function sitelinkEvidence(sitelinks) {
  const langs = uniq(Object.keys(sitelinks || {}).filter((k) => /wiki$/.test(k) && !['commonswiki', 'specieswiki', 'metawiki', 'wikidatawiki', 'mediawikiwiki', 'sourceswiki'].includes(k)).map((k) => k.replace(/wiki$/, '').replace(/_/g, '-')))
  const cs = uniq(langs.map((l) => LANGUAGE_COUNTRY[l]).filter(Boolean))
  return langs.length && cs.length === 1 && langs.every((l) => LANGUAGE_COUNTRY[l] === cs[0]) ? { kind: 'sitelink_language', country: cs[0], strength: 'weak', detail: langs } : null
}

/** Strong evidence from the names of parent categories (country or city of the gazetteer, Korean places). */
export function parentNameEvidence(parents, gaz) {
  const out = []
  for (const t of parents) {
    const n = t.replace(/^Category:/, '')
    const loc = detectLocation(n)
    if (loc.country_iso2) { out.push({ kind: 'parent_category', country: loc.country_iso2, city: loc.city || null, strength: 'strong', detail: { category: t, matched: loc.matched } }); continue }
    if (gaz) {
      const kr = regionFromText([n], gaz)
      if (kr.region && !kr.conflict) out.push({ kind: 'parent_category', country: 'KR', city: null, kr_region: kr.region, strength: 'strong', detail: { category: t, matched: kr.matches, rule: 'kr_gazetteer' } })
    }
  }
  return out
}

/**
 * Recovery for the projects whose only eligibility failures are no_country / no_coordinates_or_city.
 * Fills p.country_iso2 (+ region via regionOf), p.city or the coordinates, field_sources, p.place_texts and
 * p.place_recovery; returns {decisions, stats}.
 */
const foldName = (t) => ' ' + String(t || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' '
// Words that do not make a name distinctive on their own ("Light Festival", "Festival of Lights").
const GENERIC_WORDS = new Set(['light', 'lights', 'festival', 'festivals', 'of', 'the', 'and', 'in', 'at', 'de', 'des', 'du', 'la', 'le', 'les', 'der', 'die', 'das', 'international', 'art', 'arts', 'media', 'show', 'shows', 'night', 'nights', 'city'])
/**
 * A project whose name holds another located project's whole, distinctive name ("Cathédrale Saint-Jean de Lyon lors
 * de la Fête des Lumières" ⊃ "Fête des Lumières") is part of it. A name of generic words only never counts.
 */
export function partOf(p, known) {
  const own = foldName(p.name_en || p.name_ko || p.name_original || (p.commons_category || '').replace(/^Category:/, ''))
  for (const k of known) {
    if (k === p || k.id === p.id) continue
    for (const n of [k.name_en, k.name_ko, k.name_original].filter(Boolean)) {
      const c = foldName(n)
      const distinctive = c.trim().split(' ').filter((w) => w && !GENERIC_WORDS.has(w))
      if (c !== own && distinctive.join('').length >= 4 && c.trim().length >= 8 && own.includes(c)) return k.id
    }
  }
  return null
}

export async function recoverPlaces(client, projects, { cache, cfg = {}, ttl = {}, cc, auxMap, facts, gaz, regionOf, err = () => {}, regionProjects = [], known = [] }) {
  const stats = { candidates: projects.length, region_candidates: regionProjects.length, recovered: 0, conflict: 0, no_evidence: 0, capped: 0, geotag_requests: 0, by_rule: {} }
  const decisions = []
  if (cfg.enabled === false || (!projects.length && !regionProjects.length)) return { decisions, stats }
  const catOf = (p) => p.commons_category || null
  const withCat = [...projects, ...regionProjects].filter(catOf)
  // Parents of every category (cheap: 50 per request), then the items of the parents.
  let parents = new Map(), parentItems = new Map()
  try {
    parents = await categoryParents(client, withCat.map(catOf), { cache, ttlHours: ttl.commons_parents ?? 720 })
    const all = uniq([...parents.values()].flatMap((e) => e.parents))
    parentItems = await categoryItems(client, all, { cache, ttlHours: ttl.commons_parents ?? 720 })
    const qids = uniq([...[...parents.values()].map((e) => e.item), ...parentItems.values()].filter(Boolean)).filter((q) => !auxMap.has(q))
    if (qids.length) {
      const r = await fetchAux(client, qids, { cache, ttlHours: ttl.entities_aux ?? 720, stage: 'places' })
      for (const [k, v] of r.aux) auxMap.set(k, v)
      for (let round = 0; round < 3; round++) {
        const next = auxNext(auxMap, qids.filter((q) => auxMap.has(q)).flatMap((q) => [q, ...(auxMap.get(q).p131 || []), ...(auxMap.get(q).p17 || [])]))
        if (!next.length) break
        const r2 = await fetchAux(client, next, { cache, ttlHours: ttl.entities_aux ?? 720, stage: 'places' })
        for (const [k, v] of r2.aux) auxMap.set(k, v)
        if (!r2.aux.size) break
      }
    }
  } catch (x) { if (x?.code === 'budget') stats.partial = true; else err('places_parents', x) }

  // Korean projects without a region: the names of their category and its parents for the gazetteer (lib/korea.mjs).
  for (const p of regionProjects) { const par = parents.get(catOf(p)); if (par) p.place_texts = [catOf(p), ...par.parents].map((t) => t.replace(/^Category:/, '')) }
  let geotagBudget = cfg.max_geotag_categories_per_run ?? 150
  // Korean-looking projects first (a Korean search, Hangul or a Korean parent), then by id.
  const krFirst = (p) => (p.korea || /\p{Script=Hangul}/u.test(p.name_ko || '') || (parents.get(catOf(p))?.parents || []).some((t) => regionFromText([t.replace(/^Category:/, '')], gaz).region) ? 0 : 1)
  for (const p of [...projects].sort((a, b) => krFirst(a) - krFirst(b) || compareStrings(a.id, b.id))) {
    const evidence = []
    const before = { country: p.country_iso2 || null, located: p.latitude !== null || !!p.city }
    const f = p.qid ? facts.get(p.qid) : null
    const cat = catOf(p)
    const par = cat ? parents.get(cat) : null
    if (par) {
      evidence.push(...parentNameEvidence(par.parents, gaz))
      for (const q of [par.item, ...par.parents.map((t) => parentItems.get(t))].filter(Boolean)) {
        const r = countryOfPlace(q, auxMap)
        if (r) evidence.push({ kind: 'parent_item', country: r.iso, strength: 'strong', detail: { item: q, via: r.via } })
      }
      p.place_texts = [cat, ...par.parents].map((t) => t.replace(/^Category:/, ''))
    }
    const own = cat ? detectLocation(cat.replace(/^Category:/, '')) : null
    if (own?.country_iso2) evidence.push({ kind: 'category_name', country: own.country_iso2, city: own.city || null, strength: 'strong', detail: { category: cat, matched: own.matched } })
    if (f && validLat(f.latitude)) { const iso = countryAt(cc, f.latitude, f.longitude); if (iso) evidence.push({ kind: 'coordinates', country: iso, strength: 'strong', detail: { lat: f.latitude, lng: f.longitude } }) }
    let geo = null
    if (cat && cc) {
      const cached = cache?.fresh('commons-geotags', cat) !== undefined
      if (cached || geotagBudget > 0) {
        if (!cached) { geotagBudget--; stats.geotag_requests++ }
        try {
          const pts = await categoryGeotags(client, cat, { cache, ttlHours: ttl.commons_geotags ?? 720, limit: cfg.geotag_files ?? 100 })
          geo = geotagSummary(pts, cc, { clusterKm: cfg.cluster_km ?? 5, clusterShare: cfg.cluster_share ?? 0.5 })
          if (geo.n >= (cfg.min_geotags ?? 2) && geo.share >= (cfg.country_share ?? 0.7)) evidence.push({ kind: 'file_geotags', country: geo.top, strength: 'strong', detail: { files: geo.n, countries: geo.countries } })
        } catch (x) { if (x?.code === 'budget') { stats.partial = true; break } err('places_geotags', x, { category: cat }) }
      } else stats.capped++
    }
    const weak = f ? sitelinkEvidence(f.sitelinks) : null
    if (weak) evidence.push(weak)
    let d = decideCountry(evidence, geo, cfg)
    // "Illuminated trees in Finland", "Sports venues in Russia", "culture of the Netherlands": a category of things
    // in a country is an aggregate, not a project; no country is recovered for it.
    if (d.outcome === 'recovered' && own?.country_iso2 && !own.city && / (in|of|from) [\p{L}\p{M} .'’-]+$/u.test(String(cat || '').replace(/^Category:/, ''))) d = { ...d, country: null, outcome: 'aggregate_name', reason: 'a category of things in a country' }
    // "April 2017 in Daegu", "2017 in Seoul", "Seoul in April 2017", "Events in Seoul in the 2010s": a date category.
    const dated = [cat, p.name_en, p.name_original].map(dateNameReason).find(Boolean)
    if (d.outcome === 'recovered' && dated) d = { ...d, country: null, outcome: 'aggregate_name', reason: 'a date category (' + dated + ')' }
    // An edition or a work of a known project is that project's, not a new one (its photos stay in that project).
    const parent = d.outcome === 'recovered' ? partOf(p, known) : null
    if (parent) d = { ...d, country: null, outcome: 'part_of_project', reason: 'part of ' + parent }
    const entry = { id: p.id, qid: p.qid || null, name: p.name_en || p.name_ko || p.name_original, category: cat, before, outcome: d.outcome, country: d.country || null, rule: d.rule || null, votes: d.votes, reason: d.reason || null, geotags: geo ? { n: geo.n, countries: geo.countries, center: geo.center } : null, evidence, corroborated: !!(weak && d.country && weak.country === d.country) }
    if (d.outcome === 'recovered') {
      const src = { parent_category: 'derived:commons_parent_category', parent_item: 'derived:commons_parent_category', category_name: 'derived:commons_category_name', file_geotags: 'derived:commons_file_geotags', coordinates: 'derived:coordinates_in_borders' }[d.rule] || 'derived:commons_parent_category'
      p.field_sources = { ...(p.field_sources || {}) }
      if (!p.country_iso2) { p.country_iso2 = d.country; p.region = regionOf ? regionOf(d.country) : p.region; p.field_sources.country_iso2 = src }
      if (p.latitude === null && !p.city) {
        if (d.city) { p.city = d.city; p.field_sources.city = src; p.location_precision = 'city'; entry.city = d.city }
        else if (d.center) { p.latitude = d.center.lat; p.longitude = d.center.lng; p.location_precision = 'approximate'; p.field_sources.latitude = p.field_sources.longitude = 'derived:commons_file_geotags'; entry.center = d.center }
      }
      p.place_recovery = { rule: d.rule, evidence: uniq(evidence.map((e) => e.kind)) }
      entry.located_after = p.latitude !== null || !!p.city
      stats.recovered++
      stats.by_rule[d.rule] = (stats.by_rule[d.rule] || 0) + 1
    } else stats[d.outcome] = (stats[d.outcome] || 0) + 1
    decisions.push(entry)
  }
  return { decisions, stats }
}
