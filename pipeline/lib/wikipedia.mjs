// Media-facade discovery through Wikipedia full-text search (MediaWiki list=search, phrase queries) in 14 languages.
// Real media facades are buildings that Wikidata does not class as media facades, so a class query finds almost none
// (0 instances of Q17158007 on 2026-10-19). A hit article becomes a project candidate when:
//  - it maps to a Wikidata item (pageprops.wikibase_item);
//  - the term carries enough weight in the article (title, lead or search snippet; score ≥ accept_score);
//  - the item is a building, structure or place with coordinates or a country, and not a person, company, product,
//    technology, class or area (checked on the item's P31 labels in the pipeline: acceptEntity below).
// The article URL is kept as the source that states the media facade. Every hit, its score and its reasons go to
// review/wikipedia.json. At most 1 request per second per wiki (the client's per-host limiter), maxlag=5.
import { chunk, stripTags, uniq, isQid } from './util.mjs'
import { HOUR } from './cache.mjs'

export const wikiApi = (lang, params) => `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`

/** A tolerant pattern for a term: case-insensitive, façade/facade, spaces/hyphens optional between words. */
export function termPattern(term) {
  const t = String(term).trim()
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}]/u.test(t)) {
    // Spacing varies in Korean compounds (미디어파사드 / 미디어 파사드): optional whitespace between characters.
    return new RegExp([...t.replace(/\s+/g, '')].map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'), 'u')
  }
  const body = t.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[cç]/gi, '[cç]').replace(/[aàá]/gi, '[aàá]').replace(/[eéè]/gi, '[eéè]')).join('[\\s\\-]*')
  // Up to four more letters: plurals and case endings (media facades, медиафасадом, fasadzie medialnej is not covered).
  return new RegExp('(^|[^\\p{L}])' + body + '\\p{L}{0,4}(?=$|[^\\p{L}])', 'iu')
}

const CONTEXT = /\b(building|tower|skyscraper|facade|façade|LED|installed|installation|pixels?|screen|illuminat\w*|night|Gebäude|Hochhaus|Turm|Fassade|bâtiment|tour|edificio|torre|fachada|edifício|prédio|palazzo|grattacielo|gebouw|toren|gevel|budynek|bina|kule|cephe)\b|wieżowiec|édifice|здани|башн|фасад|مبنى|برج|건물|빌딩|타워|외벽|ビル|タワー|外壁|大楼|大廈|大厦|塔|外墙/iu
const NON_PLACE = /\b(is an? (\w+ )?(company|manufacturer|firm|brand|corporation|startup|software|technology|singer|band|musician|artist|architect|designer|footballer|politician|album|film|novel|video game)|GmbH|Inc\.|Ltd\.?|S\.A\.|AG\b|Co\., Ltd|founded in \d{4} by)\b|주식회사|은\s*대한민국의\s*(기업|회사)|株式会社|有限公司/iu

/**
 * Score of one hit (0–100) with its reasons.
 * @param {{title: string, snippet?: string}} hit @param {{extract?: string|null, coordinates?: any[]}|null} page @param {string} term
 */
export function scoreHit(hit, page, term) {
  const re = termPattern(term)
  const reasons = []
  let score = 0
  const title = String(hit.title || '')
  const snippet = stripTags(hit.snippet || '')
  const lead = String(page?.extract || '').slice(0, 1500)
  if (re.test(title)) { score += 20; reasons.push('term_in_title') }
  if (lead && re.test(lead)) {
    score += 45; reasons.push('term_in_lead')
    const all = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    if ((lead.match(all) || []).length >= 2) { score += 10; reasons.push('term_repeated_in_lead') }
  } else if (re.test(snippet)) { score += 25; reasons.push('term_in_snippet') }
  if (CONTEXT.test(lead) || CONTEXT.test(snippet)) { score += 10; reasons.push('building_context') }
  if (Array.isArray(page?.coordinates) && page.coordinates.length) { score += 10; reasons.push('page_has_coordinates') }
  if (NON_PLACE.test(lead.slice(0, 400))) { score -= 40; reasons.push('lead_describes_non_place') }
  if (!page?.wikibase_item) reasons.push('no_wikidata_item')
  return { score: Math.max(0, Math.min(100, score)), reasons }
}

/** Full-text phrase search of one term in one wiki (follows sroffset up to max). */
export async function searchTerm(client, lang, term, { max = 200, cache, ttlHours = 72 } = {}) {
  const hits = []
  let offset = 0
  for (let round = 0; round < 10 && hits.length < max; round++) {
    const json = await client.json(wikiApi(lang, { action: 'query', list: 'search', srsearch: `"${term}"`, srnamespace: '0', srlimit: String(Math.min(50, max - hits.length)), sroffset: String(offset), srprop: 'snippet|titlesnippet', srwhat: 'text' }), {
      stage: 'wikipedia', cache: cache ? { ns: 'wiki-search', key: `${lang}:${term}:${offset}`, ttlMs: ttlHours * HOUR } : null,
    })
    for (const s of json?.query?.search || []) if (s.ns === 0) hits.push({ title: s.title, snippet: s.snippet || '', pageid: s.pageid })
    if (!json?.continue?.sroffset) break
    offset = json.continue.sroffset
  }
  return { hits, total: null }
}

/** Wikidata item, lead extract and coordinates of articles (20 per request, the extracts limit). */
export async function pageDetails(client, lang, titles, { cache, ttlHours = 168 } = {}) {
  const out = new Map(), want = []
  for (const t of uniq(titles)) {
    const hit = cache?.fresh('wiki-pages', `${lang}:${t}`)
    if (hit !== undefined) out.set(t, hit); else want.push(t)
  }
  for (const group of chunk(want, 20)) {
    const json = await client.json(wikiApi(lang, { action: 'query', prop: 'pageprops|extracts|coordinates', ppprop: 'wikibase_item', exintro: '1', explaintext: '1', exlimit: '20', exchars: '1500', titles: group.join('|'), redirects: '1' }), { stage: 'wikipedia' })
    const back = new Map()
    for (const n of [...(json?.query?.normalized || []), ...(json?.query?.redirects || [])]) back.set(n.to, n.from)
    for (const p of json?.query?.pages || []) {
      const d = { title: p.title, missing: !!p.missing, wikibase_item: isQid(p.pageprops?.wikibase_item) ? p.pageprops.wikibase_item : null, extract: typeof p.extract === 'string' ? p.extract.slice(0, 1500) : null, coordinates: (p.coordinates || []).map((c) => ({ lat: c.lat, lon: c.lon })) }
      let from = p.title
      const seen = new Set()
      while (back.has(from) && !seen.has(from)) { seen.add(from); from = back.get(from) }
      for (const t of new Set([p.title, from])) { out.set(t, d); cache?.set('wiki-pages', `${lang}:${t}`, d, { ttlMs: ttlHours * HOUR }) }
    }
  }
  return out
}

export const articleUrl = (lang, title) => `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}`

/**
 * Runs every configured (wiki, term). Returns {hits: [{lang, term, title, url, qid, score, reasons}], errors, partial}.
 * A hit list is kept per article (the best-scoring term wins).
 */
export async function discoverWikipedia(client, config, { cache, log = () => {} } = {}) {
  const errors = []
  const byArticle = new Map()
  let partial = false
  const wikis = Object.entries(config.wikis || {})
  for (const [lang, terms] of wikis) {
    if (partial) break
    for (const term of terms) {
      let hits
      try { ({ hits } = await searchTerm(client, lang, term, { max: config.max_results_per_term ?? 200, cache })) } catch (e) {
        if (e?.code === 'budget') { partial = true; break }
        errors.push({ stage: 'wikipedia_search', wiki: lang, term, message: String(e?.message || e).slice(0, 300) }); continue
      }
      log({ kind: 'search', wiki: lang, term, hits: hits.length })
      let details
      try { details = await pageDetails(client, lang, hits.map((h) => h.title), { cache }) } catch (e) {
        if (e?.code === 'budget') { partial = true; break }
        errors.push({ stage: 'wikipedia_pages', wiki: lang, term, message: String(e?.message || e).slice(0, 300) }); continue
      }
      for (const h of hits) {
        const page = details.get(h.title) || null
        const { score, reasons } = scoreHit(h, page, term)
        const key = `${lang}:${page?.title || h.title}`
        const entry = { lang, term, title: page?.title || h.title, url: articleUrl(lang, page?.title || h.title), qid: page?.wikibase_item || null, score, reasons, snippet: stripTags(h.snippet).slice(0, 300), lead: page?.extract ? page.extract.slice(0, 300) : null }
        const prev = byArticle.get(key)
        if (!prev || prev.score < score) byArticle.set(key, entry)
      }
    }
  }
  return { hits: [...byArticle.values()].sort((a, b) => b.score - a.score || (a.url < b.url ? -1 : 1)), errors, partial }
}

/**
 * Whether a Wikidata item may stand for a media-facade project: not a strongly excluded kind (person, company,
 * product, technology, work type…), not an organisation without a place class, not only an area (city, district),
 * and a place (a place class, or coordinates) with coordinates or a country.
 * @param {{p31_labels: string[], latitude: number|null, country_iso2: string|null, p279?: boolean}} facts
 */
export function acceptEntity(facts, rules) {
  const reasons = []
  const labels = facts.p31_labels || []
  const strong = new RegExp(rules.exclude_class_pattern, 'i')
  const weak = new RegExp(rules.weak_exclude_class_pattern || '$^', 'i')
  const place = new RegExp(rules.place_class_pattern, 'i')
  const area = new RegExp(rules.city_class_pattern, 'i')
  const hasPlaceClass = labels.some((l) => place.test(l))
  const struck = labels.filter((l) => strong.test(l))
  if (struck.length) reasons.push('excluded_class:' + struck[0])
  if (!struck.length && labels.some((l) => weak.test(l)) && !hasPlaceClass) reasons.push('organisation_without_place_class')
  if (!hasPlaceClass && labels.length && labels.every((l) => area.test(l))) reasons.push('area_not_project')
  if (!labels.length && facts.latitude == null) reasons.push('no_class_no_coordinates')
  if (facts.latitude == null && !facts.country_iso2) reasons.push('no_coordinates_or_country')
  if (!hasPlaceClass && facts.latitude == null) reasons.push('not_a_place')
  return { ok: reasons.length === 0, reasons, place_class: hasPlaceClass }
}
