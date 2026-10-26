// Korea first (docs/STATIC_ARCHIVE.md v0.18 addendum): the kr_region of every Korean project and the live check of the
// first-level divisions it relies on. config/korea.json holds the eight regions, their first-level divisions (ISO
// 3166-2 codes and names), the gazetteer of city and district names in Korean and English, and the TourAPI codes.
//
// kr_region, in this order (the first rule that gives exactly one region wins; a conflict gives null):
//   1. an editorial edit (kr_region field);
//   2. the curated seed places of Seoul (SEOUL001…): seoul;
//   3. the Wikidata P131 chain up to the first-level division, using only division QIDs that this run's live query
//      (wd:Q884 p:P150, review/korea.json) returned with an ISO code or label of exactly one region;
//   4. the labels of the same P131 chain, matched with the gazetteer of first-level division names;
//   5. TourAPI codes (lDongRegnCd, then areacode), unless the address names another region;
//   6. the gazetteer over the address, district and city (Korean and English names; ambiguous names never decide);
//   7. otherwise null. Never guessed.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOUR } from './cache.mjs'
import { sparql } from './wikidata.mjs'
import { uniq } from './util.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const KR_REGIONS = ['seoul', 'gyeonggi_incheon', 'gangwon', 'daejeon_sejong_chungcheong', 'gwangju_jeolla', 'daegu_gyeongbuk', 'busan_ulsan_gyeongnam', 'jeju']

export function loadKoreaConfig(file = path.join(HERE, '../config/korea.json')) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

const KO_SUFFIX = /(특별자치시|특별자치도|특별시|광역시|자치시|자치도|시|군|구|도)$/
const norm = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * The gazetteer compiled from config/korea.json: Korean tokens (exact and with the administrative suffix removed) and
 * English phrases, each mapped to one region, plus the names that never decide alone.
 */
export function compileGazetteer(cfg) {
  const division = new Map(), place = new Map(), en = []
  const ambiguousKo = new Set((cfg.ambiguous_ko || []).map(norm))
  const ambiguousEn = new Set((cfg.ambiguous_en || []).map(norm))
  const put = (map, key, region) => { const k = norm(key); if (!k || ambiguousKo.has(k)) return; map.set(k, map.has(k) && map.get(k) !== region ? null : region) }
  for (const r of cfg.regions || []) {
    for (const d of r.divisions || []) {
      for (const n of d.ko || []) put(division, n, r.key)
      for (const n of d.en || []) if (!ambiguousEn.has(norm(n))) en.push({ name: norm(n), region: r.key, level: 'division' })
    }
    for (const n of r.places_ko || []) put(place, n, r.key)
    for (const n of r.places_en || []) if (!ambiguousEn.has(norm(n))) en.push({ name: norm(n), region: r.key, level: 'place' })
  }
  // Longest English names first, so "South Gyeongsang Province" is read before "South Gyeongsang".
  en.sort((a, b) => b.name.length - a.name.length || (a.name < b.name ? -1 : 1))
  const enRe = en.map((e) => ({ ...e, re: new RegExp('(^|[^a-z])' + e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[ -]') + '(-(si|gun|gu|do|eup|myeon))?(?=[^a-z]|$)') }))
  return { division, place, en: enRe, ambiguousKo, ambiguousEn }
}

/**
 * Regions named in location texts (address, district, city…). Returns {region, rule, matches, conflict}: region is set
 * only when the first-level division names give exactly one region, or else the city and district names do.
 * @param {(string|null|undefined)[]} texts @param {ReturnType<typeof compileGazetteer>} gaz
 */
export function regionFromText(texts, gaz) {
  const matches = { division: [], place: [] }
  for (const raw of texts) {
    if (!raw || typeof raw !== 'string') continue
    const t = norm(raw)
    // Korean: whitespace/punctuation tokens, exact or without the administrative suffix (서울특별시 → 서울, 수원시 → 수원).
    for (const tok of t.split(/[\s,·()[\]/|;:]+/).filter(Boolean)) {
      if (!/[\p{Script=Hangul}]/u.test(tok)) continue
      if (gaz.ambiguousKo.has(tok)) continue
      const stem = tok.replace(KO_SUFFIX, '')
      for (const [level, map] of [['division', gaz.division], ['place', gaz.place]]) {
        for (const k of uniq([tok, stem])) {
          if (!k || gaz.ambiguousKo.has(k) || !map.has(k)) continue
          const region = map.get(k)
          if (region) matches[level].push({ region, token: tok })
          break
        }
      }
    }
    // English: whole names with word boundaries (and the -si/-gun/-gu/-do suffixes).
    let rest = t
    for (const e of gaz.en) {
      if (!e.re.test(rest)) continue
      matches[e.level].push({ region: e.region, token: e.name })
      rest = rest.replace(e.re, '$1 ')
    }
  }
  for (const level of ['division', 'place']) {
    const regions = uniq(matches[level].map((m) => m.region))
    if (regions.length === 1) return { region: regions[0], rule: level === 'division' ? 'gazetteer_division' : 'gazetteer_place', matches: matches[level].slice(0, 6), conflict: null }
    if (regions.length > 1) return { region: null, rule: null, matches: matches[level].slice(0, 6), conflict: level + ':' + regions.sort().join('|') }
  }
  return { region: null, rule: null, matches: [], conflict: null }
}

// ---------------------------------------------------------------- first-level divisions, live

export const krDivisionsQuery = (countryQid) => `#aol:kr-divisions
SELECT ?div ?iso ?en ?ko ?end WHERE {
  wd:${countryQid} p:P150 ?st . ?st ps:P150 ?div .
  OPTIONAL { ?st pq:P582 ?end . }
  OPTIONAL { ?div wdt:P300 ?iso . }
  OPTIONAL { ?div rdfs:label ?en . FILTER(LANG(?en) = "en") }
  OPTIONAL { ?div rdfs:label ?ko . FILTER(LANG(?ko) = "ko") }
}`

/**
 * The first-level divisions of the country as Wikidata lists them now (contains the administrative territorial entity,
 * P150, with its ISO 3166-2 code P300), each mapped to a region by its ISO code, else by its labels through the
 * gazetteer's division names. Returns {divisions, confirmed: Map(qid → region), expected: [...comparison], errors}.
 * The answer is cached for a week; a failed query falls back to the last answer (stale cache), never to the config.
 */
export async function discoverKrDivisions(client, cfg, { cache = null, ttlHours = 168, gaz = compileGazetteer(cfg), properties = null } = {}) {
  const errors = []
  const isoRegion = new Map()
  for (const r of cfg.regions || []) for (const iso of r.iso || []) isoRegion.set(iso, r.key)
  const missingProps = ['P150', 'P300'].filter((p) => properties && properties.get(p) === false)
  if (missingProps.length) return { divisions: [], confirmed: new Map(), expected: [], errors: [{ stage: 'korea', message: 'properties not confirmed this run: ' + missingProps.join(', ') }], from: 'none' }
  let rows = null, from = 'live'
  try {
    rows = await sparql(client, krDivisionsQuery(cfg.country.qid), { cache: cache ? { ns: 'sparql', key: 'kr-divisions:' + cfg.country.qid, ttlMs: ttlHours * HOUR } : null, stage: 'korea' })
  } catch (e) {
    if (e?.code === 'budget') throw e
    errors.push({ stage: 'korea', message: String(e?.message || e).slice(0, 300) })
    const old = cache?.any('sparql', 'kr-divisions:' + cfg.country.qid)
    rows = old?.results?.bindings || null
    from = rows ? 'stale_cache' : 'none'
  }
  const byQid = new Map()
  for (const r of rows || []) {
    const qid = String(r.div?.value || '').replace('http://www.wikidata.org/entity/', '')
    if (!/^Q[1-9]\d*$/.test(qid)) continue
    const d = byQid.get(qid) || { qid, iso: null, en: null, ko: null, end: null }
    d.iso ||= r.iso?.value || null
    d.en ||= r.en?.value || null
    d.ko ||= r.ko?.value || null
    d.end ||= r.end?.value ? String(r.end.value).slice(0, 10) : null
    byQid.set(qid, d)
  }
  const divisions = []
  const confirmed = new Map()
  for (const d of [...byQid.values()].sort((a, b) => (a.iso || '~').localeCompare(b.iso || '~') || a.qid.localeCompare(b.qid))) {
    const byIso = d.iso ? isoRegion.get(d.iso) || null : null
    const byLabel = regionFromText([d.ko, d.en], gaz)
    const labelRegion = byLabel.rule === 'gazetteer_division' ? byLabel.region : null
    let region = null, reason
    if (byIso && labelRegion && byIso !== labelRegion) reason = `iso_and_label_disagree:${byIso}|${labelRegion}`
    else if (byIso) { region = byIso; reason = 'iso_3166_2' }
    else if (labelRegion) { region = labelRegion; reason = d.iso ? 'label (unknown ISO code ' + d.iso + ')' : 'label (no ISO code)' }
    else reason = 'no_region_for_iso_or_label'
    if (region) confirmed.set(d.qid, region)
    divisions.push({ ...d, region, reason })
  }
  // The configured expectations (from web searches) against the live answer.
  const expected = []
  for (const r of cfg.regions || []) for (const div of r.divisions || []) {
    if (!div.expected_qid) continue
    const live = byQid.get(div.expected_qid)
    expected.push({ region: r.key, name: div.en?.[0] || div.ko?.[0], expected_qid: div.expected_qid, verified_by: div.verified_by || null, live: live ? confirmed.get(div.expected_qid) === r.key ? 'confirmed' : 'region_differs' : rows ? 'not_in_live_answer' : 'not_checked' })
  }
  return { divisions, confirmed, expected, errors, from }
}

// ---------------------------------------------------------------- the region of a project

/** The P131 ancestors of an item (breadth-first through the aux entities), nearest first. */
export function p131Chain(entityP131, auxMap, maxDepth = 6) {
  const out = [], seen = new Set()
  let level = [...(entityP131 || [])]
  for (let depth = 0; depth < maxDepth && level.length; depth++) {
    const next = []
    for (const q of level) {
      if (!q || seen.has(q)) continue
      seen.add(q)
      out.push(q)
      for (const p of auxMap.get(q)?.p131 || []) next.push(p)
    }
    level = next
  }
  return out
}

/**
 * kr_region of one project with the rule that decided it (or the reason it is null).
 * @param {any} p built project (country_iso2, curated_id, address, district, city, city_ko, tourapi?, editorial edits applied)
 * @param {{facts?: any, auxMap?: Map<string, any>, confirmed?: Map<string, string>, gaz: any, cfg: any}} ctx
 */
/**
 * The Korean city (시, a 도's 군, or the 특별시/광역시 itself) and district (구, or a 광역시's 군) named by an address
 * ("서울특별시 송파구 올림픽로 300" → 서울특별시 / 송파구; "경기도 수원시 팔달구 …" → 수원시 / 팔달구; "강원특별자치도
 * 평창군 …" → 평창군 / null). Nothing is inferred from anything but the address's own administrative names.
 */
export function koreanPlaceOf(address) {
  const t = String(address || '').trim().split(/\s+/).filter(Boolean)
  const metro = /^\S+(특별시|광역시|특별자치시)$/
  const province = /^\S+(도|특별자치도)$/
  let i = 0
  if (province.test(t[0] || '') && !metro.test(t[0] || '')) i = 1
  const a = t[i] || '', b = t[i + 1] || ''
  if (metro.test(a)) return { city_ko: a, district: /^\S+(구|군)$/.test(b) ? b : null }
  if (/^\S+시$/.test(a)) return { city_ko: a, district: /^\S+구$/.test(b) ? b : null }
  if (/^\S+군$/.test(a)) return { city_ko: a, district: null }
  return { city_ko: null, district: null }
}

/**
 * City and district of a Korean project from its administrative chain (P131, or the event's P276, upwards): the
 * Korean labels of the chain's 구/군 and 시 (or 특별시/광역시). {city_ko, district, via} with nulls when unknown.
 */
export function krPlaceFromChain(entityP131, auxMap) {
  const labels = p131Chain(entityP131 || [], auxMap).map((q) => ({ q, ko: auxMap.get(q)?.ko || '' })).filter((x) => x.ko)
  const metro = labels.find((x) => /(특별시|광역시|특별자치시)$/.test(x.ko))
  const si = labels.find((x) => /시$/.test(x.ko) && !/(특별시|광역시|특별자치시)$/.test(x.ko))
  const gu = labels.find((x) => /구$/.test(x.ko))
  const gun = labels.find((x) => /군$/.test(x.ko))
  if (metro) return { city_ko: metro.ko, district: gu?.ko || gun?.ko || null, via: 'p131' }
  if (si) return { city_ko: si.ko, district: gu?.ko || null, via: 'p131' }
  if (gun) return { city_ko: gun.ko, district: null, via: 'p131' }
  return { city_ko: null, district: null, via: null }
}

export function krRegionOf(p, { facts = null, auxMap = new Map(), confirmed = new Map(), gaz, cfg }) {
  if (p.country_iso2 !== 'KR') return { region: null, rule: 'not_korea' }
  if (p.kr_region_edit !== undefined) return { region: KR_REGIONS.includes(p.kr_region_edit) ? p.kr_region_edit : null, rule: 'editorial' }
  if (p.curated_id && /^SEOUL\d+$/.test(p.curated_id)) return { region: 'seoul', rule: 'curated_seoul' }
  const chain = facts ? p131Chain(facts.p131 || [], auxMap) : []
  if (chain.length) {
    const hits = uniq(chain.map((q) => confirmed.get(q)).filter(Boolean))
    if (hits.length === 1) return { region: hits[0], rule: 'p131', via: chain.find((q) => confirmed.get(q) === hits[0]) }
    if (hits.length > 1) return { region: null, rule: 'p131_conflict', conflict: hits.sort().join('|') }
    const labels = chain.flatMap((q) => [auxMap.get(q)?.ko, auxMap.get(q)?.en]).filter(Boolean)
    const byLabel = regionFromText(labels, gaz)
    if (byLabel.rule === 'gazetteer_division') return { region: byLabel.region, rule: 'p131_labels', matches: byLabel.matches }
  }
  const address = [p.address, p.tourapi?.addr1, p.tourapi?.addr2].filter(Boolean)
  const fromAddress = regionFromText(address, gaz)
  if (p.tourapi) {
    const code = cfg.tourapi_ldong?.[String(p.tourapi.ldong ?? '')] || cfg.tourapi_areacode?.[String(p.tourapi.areacode ?? '')] || null
    if (code && (!fromAddress.region || fromAddress.region === code)) return { region: code, rule: p.tourapi.ldong && cfg.tourapi_ldong?.[String(p.tourapi.ldong)] ? 'tourapi_ldong' : 'tourapi_areacode' }
    if (code && fromAddress.region) return { region: null, rule: 'tourapi_conflict', conflict: `${code}|${fromAddress.region}` }
  }
  if (fromAddress.region) return { region: fromAddress.region, rule: 'address_' + fromAddress.rule, matches: fromAddress.matches }
  if (fromAddress.conflict) return { region: null, rule: 'address_conflict', conflict: fromAddress.conflict }
  const rest = regionFromText([p.district, p.city_ko, p.city], gaz)
  if (rest.region) return { region: rest.region, rule: 'city_' + rest.rule, matches: rest.matches }
  return { region: null, rule: rest.conflict ? 'city_conflict' : 'unknown', conflict: rest.conflict || undefined }
}
