// Wikidata: class discovery (live labels and instance counts of every configured class, into review/classes.json),
// project instances of the verified classes (wdt:P31/wdt:P279*), and enrichment of project items.
//  - Projects are read with wbgetentities (labels, descriptions, the configured statements, Wikipedia sitelinks),
//    25 per request, cached per item; statements are cut to the best rank and to the configured properties.
//  - Countries, administrative areas, classes and people ("aux" entities) are read with one compact SPARQL query
//    per 150 items (English/Korean/mul labels, P297, P31, P131, P17), because their full JSON is large.
// Every query carries a "#aol:<kind>" comment so the review logs and the test fixtures can tell them apart.
import { chunk, isQid, uniq, QID_RE } from './util.mjs'
import { DAY, HOUR } from './cache.mjs'

export const WDQS = 'https://query.wikidata.org/sparql'
export const WD_API = 'https://www.wikidata.org/w/api.php'
const ENTITY = 'http://www.wikidata.org/entity/'
const EARTH = 'http://www.wikidata.org/entity/Q2'
export const PROJECT_BATCH = 25
export const AUX_BATCH = 150
export const INSTANCE_LIMIT = 5000

export const qidFromUri = (v) => { const s = String(v || ''); const q = s.startsWith(ENTITY) ? s.slice(ENTITY.length) : s; return QID_RE.test(q) ? q : null }

/** POST a SPARQL query; returns the bindings array. */
export async function sparql(client, query, { cache = null, stage = 'wikidata' } = {}) {
  const body = new URLSearchParams({ query, format: 'json' }).toString()
  const json = await client.json(WDQS, {
    method: 'POST', body, stage, retries: 1, timeoutMs: 65000,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, accept: 'application/sparql-results+json',
    cache,
  })
  const rows = json?.results?.bindings
  if (!Array.isArray(rows)) throw Error('wikidata: unexpected SPARQL answer')
  return rows
}

export const classCountQuery = (qid) => `#aol:class-count ${qid}
SELECT (COUNT(DISTINCT ?item) AS ?instances) (COUNT(DISTINCT ?located) AS ?with_coords) WHERE {
  ?item wdt:P31/wdt:P279* wd:${qid} .
  OPTIONAL { ?item wdt:P625 ?coord . BIND(?item AS ?located) }
}`

export const classInstancesQuery = (qid, limit = INSTANCE_LIMIT) => `#aol:class-instances ${qid}
SELECT DISTINCT ?item WHERE {
  ?item wdt:P31/wdt:P279* wd:${qid} .
} LIMIT ${limit}`

/**
 * Instances of a class located in one country: the Korea-first discovery (#aol:kr-class-instances). Located means the
 * item's own country (P17), or the country of its administrative area (P131, one or two levels up) or of its
 * location (P276): many Korean items have P131 but no P17.
 */
export const countryClassInstancesQuery = (qid, countryQid, limit = 2000) => `#aol:kr-class-instances ${qid}
SELECT DISTINCT ?item WHERE {
  ?item wdt:P31/wdt:P279* wd:${qid} .
  { ?item wdt:P17 wd:${countryQid} . } UNION { ?item wdt:P131/wdt:P17 wd:${countryQid} . } UNION { ?item wdt:P131/wdt:P131/wdt:P17 wd:${countryQid} . } UNION { ?item wdt:P276/wdt:P17 wd:${countryQid} . }
} LIMIT ${limit}`

/** Which of the given items are instances of which of the given classes (#aol:class-membership; probes). */
export const classMembershipQuery = (items, classes) => `#aol:class-membership
SELECT DISTINCT ?item ?class WHERE {
  VALUES ?item { ${items.map((q) => 'wd:' + q).join(' ')} }
  VALUES ?class { ${classes.map((q) => 'wd:' + q).join(' ')} }
  ?item wdt:P31/wdt:P279* ?class .
}`

/**
 * Wikidata full-text search (CirrusSearch) for a term among items of a country (haswbstatement:P17=…): labels,
 * descriptions and aliases in any language. Cached per term. Returns QIDs.
 */
export async function searchItems(client, term, { country = null, limit = 50, cache = null, ttlHours = 72, stage = 'korea' } = {}) {
  const q = [term, country ? `haswbstatement:P17=${country}` : ''].filter(Boolean).join(' ')
  const url = `${WD_API}?${new URLSearchParams({ action: 'query', list: 'search', srsearch: q, srnamespace: '0', srlimit: String(Math.min(500, limit)), srprop: '', format: 'json', formatversion: '2' })}`
  const json = await client.json(url, { stage, cache: cache ? { ns: 'wikidata-search', key: q, ttlMs: ttlHours * HOUR } : null })
  return uniq((json?.query?.search || []).map((x) => x.title).filter(isQid))
}

/** Items of Korean Wikipedia articles by title (probes): Map(title → {qid, ko, en, p31[], p17[], p131[]} | null). */
export async function itemsOfArticles(client, wiki, titles, { stage = 'korea', cache = null, ttlHours = 24 } = {}) {
  const out = new Map()
  for (const group of chunk(uniq(titles), 50)) {
    const url = `${WD_API}?${new URLSearchParams({ action: 'wbgetentities', sites: wiki, titles: group.join('|'), props: 'labels|claims|sitelinks', languages: 'ko|en', sitefilter: wiki, format: 'json', formatversion: '2' })}`
    const json = await client.json(url, { stage, cache: cache ? { ns: 'wikidata-articles', key: wiki + ':' + group.join('|'), ttlMs: ttlHours * HOUR } : null })
    for (const t of group) out.set(t, null)
    for (const e of Object.values(json?.entities || {})) {
      if (!e || e.missing !== undefined || !isQid(e.id)) continue
      const title = e.sitelinks?.[wiki]?.title
      if (!title) continue
      const ids = (pid) => (e.claims?.[pid] || []).map((s) => s?.mainsnak?.datavalue?.value?.id).filter(isQid)
      const key = group.find((t) => t.replace(/_/g, ' ') === title) || title
      out.set(key, { qid: e.id, ko: e.labels?.ko?.value || null, en: e.labels?.en?.value || null, p31: ids('P31'), p17: ids('P17'), p131: ids('P131') })
    }
  }
  return out
}

export const auxQuery = (qids) => `#aol:aux
SELECT ?e (SAMPLE(?en_) AS ?en) (SAMPLE(?ko_) AS ?ko) (SAMPLE(?mul_) AS ?mul) (SAMPLE(?iso_) AS ?iso)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?c), "/entity/"); separator=" ") AS ?p31)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?a), "/entity/"); separator=" ") AS ?p131)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?k), "/entity/"); separator=" ") AS ?p17) WHERE {
  VALUES ?e { ${qids.map((q) => 'wd:' + q).join(' ')} }
  OPTIONAL { ?e rdfs:label ?en_ . FILTER(LANG(?en_) = "en") }
  OPTIONAL { ?e rdfs:label ?ko_ . FILTER(LANG(?ko_) = "ko") }
  OPTIONAL { ?e rdfs:label ?mul_ . FILTER(LANG(?mul_) = "mul") }
  OPTIONAL { ?e wdt:P297 ?iso_ . }
  OPTIONAL { ?e wdt:P31 ?c . }
  OPTIONAL { ?e wdt:P131 ?a . }
  OPTIONAL { ?e wdt:P17 ?k . }
} GROUP BY ?e`

export function parseCount(rows) {
  const r = rows[0] || {}
  const n = (v) => { const x = Number(v?.value); return Number.isInteger(x) && x >= 0 ? x : null }
  return { instances: n(r.instances), with_coords: n(r.with_coords) }
}
export const parseInstances = (rows) => uniq(rows.map((r) => qidFromUri(r.item?.value)))

/** Aux rows → Map(qid → {en, ko, mul, iso, p31[], p131[], p17[]}). */
export function parseAux(rows) {
  const out = new Map()
  const ids = (v) => String(v?.value || '').split(/\s+/).filter((q) => QID_RE.test(q))
  for (const r of rows) {
    const q = qidFromUri(r.e?.value)
    if (!q) continue
    out.set(q, {
      en: r.en?.value || null, ko: r.ko?.value || null, mul: r.mul?.value || null,
      iso: /^[A-Z]{2}$/.test(r.iso?.value || '') ? r.iso.value : null,
      p31: ids(r.p31), p131: ids(r.p131), p17: ids(r.p17),
    })
  }
  return out
}

// ---- wbgetentities ----

/** One statement's value, simplified. */
export function snakValue(snak) {
  if (!snak || snak.snaktype !== 'value' || !snak.datavalue) return null
  const { type, value } = snak.datavalue
  switch (type) {
    case 'wikibase-entityid': return isQid(value?.id) ? { item: value.id } : null
    case 'string': return { string: String(value) }
    case 'monolingualtext': return { text: String(value?.text || ''), language: String(value?.language || '') }
    case 'time': {
      const m = /^([+-])(\d{1,16})-(\d\d)-(\d\d)T/.exec(String(value?.time || ''))
      if (!m || m[1] === '-') return null
      return { year: Number(m[2]), month: Number(m[3]) || null, day: Number(m[4]) || null, precision: Number(value.precision) }
    }
    case 'globecoordinate': {
      if (value?.globe && value.globe !== EARTH) return null
      const lat = Number(value?.latitude), lng = Number(value?.longitude)
      return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng, precision: value.precision ?? null } : null
    }
    case 'quantity': return { amount: Number(value?.amount) }
    default: return null
  }
}

/** A time value as an ISO date at its precision: YYYY (9), YYYY-MM (10), YYYY-MM-DD (11+); null otherwise. */
export function dateOf(values) {
  const v = (values || []).find((t) => t && t.year && t.precision >= 9)
  if (!v) return null
  const y = String(v.year).padStart(4, '0')
  if (v.precision >= 11 && v.month && v.day) return `${y}-${String(v.month).padStart(2, '0')}-${String(v.day).padStart(2, '0')}`
  if (v.precision >= 10 && v.month) return `${y}-${String(v.month).padStart(2, '0')}`
  return y
}

/** Best-rank values of a property (preferred if any, else normal; deprecated never). */
export function bestValues(claims, pid) {
  const list = Array.isArray(claims?.[pid]) ? claims[pid] : []
  const usable = list.filter((s) => s && s.rank !== 'deprecated')
  const preferred = usable.filter((s) => s.rank === 'preferred')
  return (preferred.length ? preferred : usable).map((s) => snakValue(s.mainsnak)).filter(Boolean)
}

/** A wbgetentities entity cut to what the pipeline reads (this is what is cached). */
export function trimEntity(e, { properties, languages, wikis }) {
  if (!e || e.missing !== undefined || !isQid(e.id)) return null
  const pick = (obj, keys) => { const o = {}; for (const k of keys) if (obj?.[k]?.value) o[k] = obj[k].value; return o }
  const claims = {}
  for (const pid of properties) {
    const vals = bestValues(e.claims, pid)
    if (vals.length) claims[pid] = vals.slice(0, 12)
  }
  const sitelinks = {}
  for (const w of wikis) {
    const s = e.sitelinks?.[w]
    if (s?.title) sitelinks[w] = { title: s.title, url: /^https:\/\//.test(s.url || '') ? s.url : null }
  }
  if (e.sitelinks?.commonswiki?.title) sitelinks.commonswiki = { title: e.sitelinks.commonswiki.title, url: e.sitelinks.commonswiki.url || null }
  return {
    id: e.id,
    labels: pick(e.labels, [...languages, 'mul']),
    descriptions: pick(e.descriptions, ['ko', 'en']),
    claims,
    sitelinks,
    modified: e.modified || null,
  }
}

export function entitiesUrl(ids, { languages, props = 'labels|descriptions|claims|sitelinks/urls' }) {
  const p = new URLSearchParams({ action: 'wbgetentities', format: 'json', ids: ids.join('|'), props, languages: [...languages, 'mul'].join('|'), redirects: 'yes' })
  return `${WD_API}?${p}`
}

/**
 * Project items by QID, cached per item ('entities'). Returns {entities: Map, redirects: Map(from → to), missing: [], errors: []}.
 */
export async function fetchEntities(client, qids, { cache, ttlHours = 72, properties, languages, wikis, stage = 'enrich', priority = null }) {
  const entities = new Map(), redirects = new Map(), missing = [], errors = []
  const want = []
  // Korea first: the priority items (from the Korean sources) are asked before the others.
  const first = (q) => (priority?.has(q) ? 0 : 1)
  for (const q of uniq(qids).filter(isQid).sort((a, b) => first(a) - first(b) || (a < b ? -1 : a > b ? 1 : 0))) {
    const hit = cache?.fresh('entities', q)
    if (hit !== undefined) {
      if (hit?.redirect) redirects.set(q, hit.redirect)
      else if (hit) entities.set(q, hit)
      else missing.push(q)
    } else want.push(q)
  }
  for (const ids of chunk(want, PROJECT_BATCH)) {
    let json
    try { json = await client.json(entitiesUrl(ids, { languages }), { stage }) } catch (e) {
      if (e?.code === 'budget') throw e
      errors.push({ stage, ids: ids.join('|'), message: String(e?.message || e).slice(0, 300) })
      // Stale cache entries stand in for a failed batch.
      for (const q of ids) { const old = cache?.any('entities', q); if (old && !old.redirect) entities.set(q, old) }
      continue
    }
    const got = json?.entities || {}
    for (const q of ids) {
      const raw = got[q]
      if (!raw || raw.missing !== undefined) { missing.push(q); cache?.set('entities', q, null, { ttlMs: ttlHours * HOUR }); continue }
      const t = trimEntity(raw, { properties, languages, wikis })
      if (!t) { missing.push(q); continue }
      if (t.id !== q) { redirects.set(q, t.id); cache?.set('entities', q, { redirect: t.id }, { ttlMs: ttlHours * HOUR }) }
      entities.set(t.id, t)
      cache?.set('entities', t.id, t, { ttlMs: ttlHours * HOUR })
    }
  }
  return { entities, redirects, missing, errors }
}

/** Aux entities by QID, cached per item ('entities-aux'). Returns Map(qid → aux). */
export async function fetchAux(client, qids, { cache, ttlHours = 720, stage = 'enrich', priority = null }) {
  const out = new Map(), errors = []
  const want = []
  const first = (q) => (priority?.has(q) ? 0 : 1)
  for (const q of uniq(qids).filter(isQid).sort((a, b) => first(a) - first(b) || (a < b ? -1 : a > b ? 1 : 0))) {
    const hit = cache?.fresh('entities-aux', q)
    if (hit !== undefined) { if (hit) out.set(q, hit) } else want.push(q)
  }
  for (const ids of chunk(want, AUX_BATCH)) {
    let rows
    try { rows = await sparql(client, auxQuery(ids), { stage }) } catch (e) {
      if (e?.code === 'budget') throw e
      errors.push({ stage, message: String(e?.message || e).slice(0, 300), count: ids.length })
      for (const q of ids) { const old = cache?.any('entities-aux', q); if (old) out.set(q, old) }
      continue
    }
    const parsed = parseAux(rows)
    for (const q of ids) {
      const a = parsed.get(q) || null
      cache?.set('entities-aux', q, a, { ttlMs: ttlHours * HOUR })
      if (a) out.set(q, a)
    }
  }
  return { aux: out, errors }
}

/** Live labels of classes and properties (review/classes.json, review/properties.json). */
export async function fetchLabels(client, ids, { stage = 'discovery' } = {}) {
  const out = new Map(), errors = []
  for (const group of chunk(uniq(ids), 50)) {
    const p = new URLSearchParams({ action: 'wbgetentities', format: 'json', ids: group.join('|'), props: 'labels|descriptions', languages: 'en|ko', redirects: 'yes' })
    try {
      const json = await client.json(`${WD_API}?${p}`, { stage })
      for (const id of group) {
        const e = json?.entities?.[id]
        if (!e || e.missing !== undefined) { out.set(id, { missing: true }); continue }
        out.set(id, { id: e.id, redirect: e.id !== id ? e.id : null, en: e.labels?.en?.value || null, ko: e.labels?.ko?.value || null, description: e.descriptions?.en?.value || null })
      }
    } catch (e) {
      if (e?.code === 'budget') throw e
      errors.push({ stage, message: String(e?.message || e).slice(0, 300) })
    }
  }
  return { labels: out, errors }
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim()

/**
 * Class discovery: live label, instance counts and the publish decision of every configured class and blocklist
 * item, and the live labels of every configured property.
 */
export async function discoverClasses(client, classesConfig, { cache, ttlHours = 24, counts = true, extraItems = [] }) {
  const classes = classesConfig.classes || []
  const block = classesConfig.blocklist || []
  const props = Object.entries(classesConfig.properties || {}).filter(([k]) => /^P\d+$/.test(k))
  const errors = []
  const { labels, errors: e1 } = await fetchLabels(client, [...classes.map((c) => c.qid), ...block.map((b) => b.qid), ...props.map(([p]) => p), ...extraItems.map((x) => x.qid)])
  errors.push(...e1)
  const review = []
  for (const c of classes) {
    const live = labels.get(c.qid) || null
    const labelOk = live && !live.missing ? norm(live.en) === norm(c.label) : null
    const reasons = []
    if (!c.verified) reasons.push('not_verified')
    if (!c.include) reasons.push('excluded_by_config')
    if (live?.missing) reasons.push('item_missing')
    if (live?.redirect) reasons.push('redirects_to_' + live.redirect)
    if (labelOk === false) reasons.push('live_label_differs')
    const usable = !!(c.verified && labelOk !== false && !live?.missing && !live?.redirect)
    const publish = !!(usable && c.include)
    review.push({
      qid: c.qid, configured_label: c.label, live_label: live?.en ?? null, live_label_ko: live?.ko ?? null, live_description: live?.description ?? null,
      label_matches: labelOk, verified: !!c.verified, include: !!c.include, korea_include: !!c.korea_include, project_type: c.project_type, publish,
      // Korea first: a verified class with a matching live label is also read for its items located in Korea (P17),
      // and published from there when it is included or korea_include (config/classes.json).
      publish_korea: !!(usable && (c.include || c.korea_include)),
      reasons, instances: null, with_coords: null, error: null,
    })
  }
  if (counts) await addClassCounts(client, review, { ttlHours, errors })
  const blocklist = block.map((b) => {
    const live = labels.get(b.qid) || null
    return { qid: b.qid, configured_label: b.label, live_label: live?.en ?? null, label_matches: live && !live.missing ? norm(live.en) === norm(b.label) : null, verified: !!b.verified, reason: b.reason }
  })
  const properties = props.map(([pid, expected]) => {
    const live = labels.get(pid) || null
    const ok = live && !live.missing ? norm(live.en).includes(norm(expected)) || norm(expected).includes(norm(live.en)) : null
    return { pid, expected, live_label: live?.en ?? null, ok }
  })
  const items = extraItems.map((x) => {
    const live = labels.get(x.qid) || null
    return { qid: x.qid, purpose: x.purpose || null, expected: x.label, live_label: live?.en ?? null, ok: live && !live.missing && !live.redirect ? norm(live.en) === norm(x.label) : null }
  })
  return { classes: review, blocklist, properties, items, errors }
}

/** Live instance counts of every class (review/classes.json); fills review entries in place. */
export async function addClassCounts(client, review, { ttlHours = 24, errors = [] } = {}) {
  for (const c of review) {
    try {
      const n = parseCount(await sparql(client, classCountQuery(c.qid), { cache: { ns: 'sparql', key: 'count:' + c.qid, ttlMs: ttlHours * HOUR }, stage: 'discovery' }))
      c.instances = n.instances; c.with_coords = n.with_coords
    } catch (e) {
      if (e?.code === 'budget') throw e
      c.error = String(e?.message || e).slice(0, 300)
      errors.push({ stage: 'discovery', class: c.qid, message: c.error })
    }
  }
  return review
}

/**
 * Korea first: items of the usable classes located in the country (P17), before any worldwide instance query.
 * Returns {byQid: Map(qid → [class qids]), perClass, errors}.
 */
export async function countryClassInstances(client, review, countryQid, { cache, ttlHours = 24, limit = 2000 }) {
  const byQid = new Map(), perClass = {}, errors = []
  for (const c of review.filter((x) => x.publish_korea)) {
    try {
      const qids = parseInstances(await sparql(client, countryClassInstancesQuery(c.qid, countryQid, limit), { cache: { ns: 'sparql', key: `country-instances:${countryQid}:${c.qid}`, ttlMs: ttlHours * HOUR }, stage: 'korea' }))
      perClass[c.qid] = qids.length
      for (const q of qids) byQid.set(q, [...(byQid.get(q) || []), c.qid])
    } catch (e) {
      if (e?.code === 'budget') throw e
      perClass[c.qid] = null
      errors.push({ stage: 'korea', class: c.qid, message: String(e?.message || e).slice(0, 300) })
    }
  }
  return { byQid, perClass, errors }
}

/** Instances of the classes that may be published from. Returns {byQid: Map(qid → [class qids]), perClass, errors}. */
export async function classInstances(client, review, { cache, ttlHours = 24, limit = INSTANCE_LIMIT }) {
  const byQid = new Map(), perClass = {}, errors = []
  for (const c of review.filter((x) => x.publish)) {
    try {
      const qids = parseInstances(await sparql(client, classInstancesQuery(c.qid, limit), { cache: { ns: 'sparql', key: 'instances:' + c.qid, ttlMs: ttlHours * HOUR }, stage: 'wikidata' }))
      perClass[c.qid] = qids.length
      for (const q of qids) byQid.set(q, [...(byQid.get(q) || []), c.qid])
    } catch (e) {
      if (e?.code === 'budget') throw e
      perClass[c.qid] = null
      errors.push({ stage: 'wikidata', class: c.qid, message: String(e?.message || e).slice(0, 300) })
    }
  }
  return { byQid, perClass, errors }
}

// ---- facts ----

export const label = (labels, langs) => { for (const l of langs) if (labels?.[l]) return labels[l]; return null }

/**
 * Walks P131 up from the item (or P276 for events) to find the city: the first ancestor one of whose P31 classes has
 * an English label matching cityPattern; else the first administrative area. Returns {qid, rule} or null.
 */
export function findCity(entity, auxMap, cityPattern) {
  const start = [...(entity.claims.P131 || []), ...(entity.claims.P276 || [])].map((v) => v.item).filter(Boolean)
  const seen = new Set()
  let level = start
  let first = null
  for (let depth = 0; depth < 4 && level.length; depth++) {
    const next = []
    for (const q of level) {
      if (seen.has(q)) continue
      seen.add(q)
      const a = auxMap.get(q)
      if (!a) continue
      first ||= q
      const classLabels = a.p31.map((c) => auxMap.get(c)?.en || '').filter(Boolean)
      if (classLabels.some((l) => cityPattern.test(l))) return { qid: q, rule: 'p131_city_class', depth }
      next.push(...a.p131)
    }
    level = next
  }
  return first ? { qid: first, rule: 'p131_first_area', depth: 0 } : null
}

/** QIDs the facts of these entities refer to (for the aux rounds). */
export function auxRefs(entities) {
  const out = new Set()
  for (const e of entities) {
    for (const p of ['P17', 'P131', 'P276', 'P31', 'P84', 'P170', 'P50', 'P112', 'P137', 'P301', 'P5817']) for (const v of e.claims[p] || []) if (v.item) out.add(v.item)
  }
  return [...out]
}
export function auxNext(auxMap, qids) {
  const out = new Set()
  for (const q of qids) { const a = auxMap.get(q); if (!a) continue; for (const x of [...a.p131, ...a.p31, ...a.p17]) if (!auxMap.has(x)) out.add(x) }
  return [...out]
}

/** ISO code of a country item, or of the country its own P17 names (Q55 Netherlands has none; Q29999 has NL). */
export function isoOfCountry(q, auxMap) {
  const a = auxMap.get(q)
  if (!a) return null
  if (a.iso) return a.iso
  for (const k of a.p17 || []) if (k !== q) { const i = auxMap.get(k)?.iso; if (i) return i }
  return null
}
/** Country of a place item: its own ISO code or its P17's, walking P131 up to `depth` levels. {iso, via} or null. */
export function countryOfPlace(q, auxMap, depth = 3) {
  const seen = new Set()
  let frontier = [q]
  for (let d = 0; d <= depth && frontier.length; d++) {
    const next = []
    for (const x of frontier) {
      if (seen.has(x)) continue
      seen.add(x)
      const a = auxMap.get(x)
      if (!a) continue
      if (a.iso) return { iso: a.iso, via: x }
      for (const k of a.p17 || []) { const iso = isoOfCountry(k, auxMap); if (iso) return { iso, via: k } }
      next.push(...(a.p131 || []))
    }
    frontier = next
  }
  return null
}

/**
 * Facts the archive keeps from a project item; every fact carries its property (field_sources) so the record can
 * cite Wikidata for it. Unknown facts are null.
 */
export function factsOf(entity, auxMap, { cityPattern, originalLanguageByCountry = {}, labelLanguages = ['ko', 'en'], countryAt = null }) {
  const c = entity.claims
  const L = entity.labels || {}
  const aux = (q) => auxMap.get(q) || null
  const auxName = (q) => { const a = aux(q); return a ? (a.en || a.mul || a.ko || null) : null }
  // Country (lib/places.mjs "Country recovery"): P17 of the item (a country item without an ISO code takes its own
  // P17's: Q55 Netherlands → NL), else the country of its administrative area (P131) or location (P276), walking
  // P131 up, else the borders its coordinates (P625) lie in.
  let country = null, countryQid = null, countryRule = null
  for (const v of c.P17 || []) { const iso = isoOfCountry(v.item, auxMap); if (iso) { country = iso; countryQid = v.item; countryRule = 'p17'; break } }
  if (!country) {
    for (const [pid, rule] of [['P131', 'p131_country'], ['P276', 'p276_country']]) {
      for (const v of c[pid] || []) { const r = countryOfPlace(v.item, auxMap); if (r) { country = r.iso; countryQid = r.via; countryRule = rule; break } }
      if (country) break
    }
  }
  const coord0 = (c.P625 || [])[0] || null
  if (!country && coord0 && countryAt) { const iso = countryAt(coord0.lat, coord0.lng); if (iso) { country = iso; countryRule = 'p625_borders' } }
  const city = findCity(entity, auxMap, cityPattern)
  const coord = (c.P625 || [])[0] || null
  const year = (pid) => { const v = (c[pid] || []).find((t) => t.year && t.precision >= 9); return v ? v.year : null }
  const people = (pid) => (c[pid] || []).map((v) => v.item).filter(Boolean).map((q) => ({ qid: q, name: aux(q)?.ko || auxName(q), name_en: aux(q)?.en || aux(q)?.mul || null })).filter((p) => p.name || p.name_en)
  const official = (c.P856 || []).map((v) => v.string).find((u) => /^https?:\/\//i.test(u || '')) || null
  const commons = (c.P373 || []).map((v) => v.string).find(Boolean) || null
  const images = (c.P18 || []).map((v) => v.string).filter(Boolean)
  const lang = originalLanguageByCountry[country] || null
  const native = [...(c.P1705 || []), ...(c.P1448 || [])].find((v) => v.text) || null
  const nameOriginal = native?.text || (lang && L[lang]) || null
  const nameOriginalLang = native?.text ? native.language : (lang && L[lang] ? lang : null)
  const sitelinks = entity.sitelinks || {}
  return {
    qid: entity.id,
    name_ko: L.ko || null,
    name_en: L.en || L.mul || null,
    name_original: nameOriginal,
    name_original_lang: nameOriginalLang,
    any_label: label(L, labelLanguages) || L.mul || null,
    description_ko: entity.descriptions?.ko || null,
    description_en: entity.descriptions?.en || null,
    country_iso2: country,
    country_qid: countryQid,
    country_rule: countryRule,
    city: city ? (aux(city.qid)?.en || aux(city.qid)?.mul || aux(city.qid)?.ko || null) : null,
    city_ko: city ? aux(city.qid)?.ko || null : null,
    city_qid: city?.qid || null,
    city_rule: city?.rule || null,
    latitude: coord ? coord.lat : null,
    longitude: coord ? coord.lng : null,
    inception: year('P571'),
    start: year('P580'),
    end: year('P582'),
    // Dates at their stated precision (YYYY, YYYY-MM or YYYY-MM-DD) for kind and status (entities.mjs scheduleOf).
    start_date: dateOf(c.P580), end_date: dateOf(c.P582), point_in_time: dateOf(c.P585),
    recurring: (c.P2257 || []).length > 0,
    architects: people('P84'),
    creators: [...people('P170'), ...people('P50').filter((x) => !(c.P170 || []).some((v) => v.item === x.qid))],
    // Founders (P112) are not credited; their names only mark a photo of them as a creator's portrait (images.mjs).
    founders: people('P112'),
    operators: people('P137'),
    official_url: official,
    commons_category: commons ? 'Category:' + commons.replace(/^Category:/i, '') : null,
    images,
    p31: (c.P31 || []).map((v) => v.item).filter(Boolean),
    // The administrative chain starts here (an event's location, P276, leads to it too): kr_region (lib/korea.mjs).
    p131: [...(c.P131 || []), ...(c.P276 || [])].map((v) => v.item).filter(Boolean),
    p31_labels: (c.P31 || []).map((v) => auxName(v.item)).filter(Boolean),
    p301: (c.P301 || []).map((v) => v.item).filter(Boolean),
    state_of_use: (c.P5817 || []).map((v) => auxName(v.item)).filter(Boolean),
    sitelinks,
  }
}

export { DAY }
