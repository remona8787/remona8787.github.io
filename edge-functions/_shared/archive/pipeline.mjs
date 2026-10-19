// The collector pipeline (docs/ARCHIVE_SPEC.md §3): rule → adapter → keyword prefilter → classify → normalize →
// dedupe/keys → ingest items exactly in the §8 shape. Pure with respect to its inputs: fetch, clock, sleep and the
// environment are injected, so the Edge Functions, the probe and the tests run the same code; nothing here talks to
// the database (the caller passes the alias index and keywords in and sends the items to archive_ingest).

import { fetchWithPolicy, fetchOk, conditionalHeaders, validatorsOf, createRateLimiter, defaultSleep, HttpError, errorText } from './http.mjs'
import { gdeltUrl, gdeltTimespan, parseGdelt, gdeltRecords, GDELT_HOST, GDELT_INTERVAL_MS } from './adapters/gdelt.mjs'
import { parseFeed, feedRecords } from './adapters/rss.mjs'
import { naverConfig, naverRequest, parseNaver, NAVER_MAX_DISPLAY } from './adapters/naver.mjs'
import { braveKey, braveRequest, parseBrave } from './adapters/brave.mjs'
import { detectWikidataChanges } from './adapters/wikidata.mjs'
import { classify, positiveMatch, defaultKeywords, LABELS } from './classify.mjs'
import { canonicalUrl, cleanTitle, cleanExcerpt, clip, languageCode, detectLanguage, detectLocation, matchAlias, extractName, hostOf, MAX_URL, MAX_TITLE, MAX_EXCERPT, MAX_PUBLISHER } from './normalize.mjs'
import { clusterStories, normalizedName } from './dedupe.mjs'
import { sourceKindFor, reliability, registrableDomain, SOURCE_KINDS } from './reliability.mjs'

export const PROVIDERS = /** @type {const} */ (['gdelt', 'rss', 'websub', 'naver_news', 'naver_blog', 'brave', 'wikidata'])
export const MAX_ITEMS_PER_RULE = 300
export const MAX_RAW_BYTES = 4096
export const NAVER_MAX_PAGES = 2
export const BACKOFF_BASE_MS = 3600e3
export const BACKOFF_MAX_MS = 48 * 3600e3
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ITEM_KEYS = ['provider', 'rule_id', 'external_id', 'url', 'canonical_url', 'title', 'excerpt', 'publisher', 'language', 'published_at', 'source_kind', 'reliability', 'classification', 'detected', 'keys', 'raw']

/**
 * @typedef {import('./adapters/rss.mjs').RawRecord} RawRecord
 * @typedef {{id?: string|null, kind: string, name?: string, query?: string|null, url?: string|null, language?: string|null,
 *   cadence_hours?: number|null, last_run_at?: string|null, failure_count?: number|null, etag?: string|null, last_modified?: string|null, enabled?: boolean}} Rule
 * @typedef {{stage: string, message: string, url: string|null, http_status: number|null}} RunError
 * @typedef {object} Item  the §8 ingest item
 * @property {string} provider
 * @property {string|null} rule_id
 * @property {string|null} external_id
 * @property {string} url
 * @property {string} canonical_url
 * @property {string} title
 * @property {string|null} excerpt
 * @property {string|null} publisher
 * @property {string|null} language
 * @property {string|null} published_at
 * @property {string} source_kind
 * @property {number} reliability
 * @property {{score: number, label: string, reasons: string[], version: string}} classification
 * @property {{name: string|null, country_iso2: string|null, city: string|null, latitude: number|null, longitude: number|null}} detected
 * @property {{normalized_name: string|null, story_key: string, wikidata_qid: string|null, alias_project_id: string|null}} keys
 * @property {Record<string, unknown>} raw
 * @typedef {object} Context
 * @property {(input: string, init?: RequestInit) => Promise<Response>} [fetch]
 * @property {() => number} [clock]
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {(name: string) => string|undefined|null} [getEnv]
 * @property {{wait: (host: string) => Promise<void>}} [limiter]
 * @property {import('./classify.mjs').Compiled} [keywords]
 * @property {import('./normalize.mjs').AliasIndex|null} [aliasIndex]
 * @property {{project_id: string, wikidata_qid: string|null}[]} [wikidataProjects]  projects with QIDs (Wikidata change detection)
 * @property {number} [timeoutMs]
 * @property {number} [deadline]  clock time after which no further request starts
 * @typedef {object} RuleResult
 * @property {string|null} rule_id
 * @property {string} kind
 * @property {string} name
 * @property {'success'|'partial'|'error'|'skipped'} status
 * @property {string|null} reason       why a rule was skipped
 * @property {number} fetched            records the source returned
 * @property {Item[]} items              valid §8 items to ingest
 * @property {RunError[]} errors
 * @property {boolean} not_modified
 * @property {{hub: string|null, self: string|null}|null} websub  hub advertised by an RSS feed
 * @property {{prefilter: number, invalid: number, duplicate_url: number}} dropped
 * @property {{project_id: string, qid: string, date_modified: string, values: Record<string, string[]>}[]} project_updates  Wikidata changes
 * @property {{etag: string|null, last_modified: string|null, retry_after_ms: number|null}} validators
 */

/** A rate limiter with GDELT's 5 s spacing and 1 request per second per other host. @param {() => number} [clock] @param {(ms: number) => Promise<void>} [sleep] */
export const collectorLimiter = (clock = Date.now, sleep = defaultSleep) => createRateLimiter({ clock, sleep, defaultIntervalMs: 1000, intervals: { [GDELT_HOST]: GDELT_INTERVAL_MS } })

/** @param {unknown} e @param {string} stage @param {string|null} [url] @returns {RunError} */
function toError(e, stage, url = null) {
  const err = /** @type {any} */ (e)
  return { stage, message: errorText(e).slice(0, 1000), url: (err instanceof HttpError ? err.url : null) || url, http_status: err instanceof HttpError ? err.status : null }
}

/** @param {string} s */
const chars = (s) => [...s].length

/** raw, cut to MAX_RAW_BYTES of JSON: long strings shortened, arrays trimmed, else replaced by a marker. @param {Record<string, unknown>} raw */
export function boundRaw(raw) {
  const size = (/** @type {unknown} */ v) => new TextEncoder().encode(JSON.stringify(v)).byteLength
  if (size(raw) <= MAX_RAW_BYTES) return raw
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k] = v.slice(0, 300)
    else if (Array.isArray(v)) out[k] = v.slice(0, 10).map((x) => typeof x === 'string' ? x.slice(0, 100) : x)
    else out[k] = v
  }
  return size(out) <= MAX_RAW_BYTES ? out : { truncated: true }
}

/**
 * Records → §8 items: prefilter (RSS/WebSub: a positive keyword in title or excerpt), classify, normalize, in-batch
 * duplicate URLs dropped, story clustering, reliability (with the independent-domain bonus of the story's cluster),
 * validation. Invalid items are reported (stage "validate") and not returned.
 * @param {RawRecord[]} records
 * @param {{rule?: Rule|null, now?: number, keywords?: import('./classify.mjs').Compiled, aliasIndex?: import('./normalize.mjs').AliasIndex|null, prefilter?: boolean}} [o]
 * @returns {{items: Item[], errors: RunError[], dropped: {prefilter: number, invalid: number, duplicate_url: number}}}
 */
export function buildItems(records, { rule = null, now = Date.now(), keywords = defaultKeywords(), aliasIndex = null, prefilter } = {}) {
  /** @type {RunError[]} */
  const errors = []
  const dropped = { prefilter: 0, invalid: 0, duplicate_url: 0 }
  const seen = new Set()
  const fetchedAt = new Date(now).toISOString()
  /** @type {(Omit<Item, 'reliability'|'keys'> & {keys: Omit<Item['keys'], 'story_key'> & {story_key?: string}, fetched_at: string, _domain: string})[]} */
  const draft = []
  for (const r of records.slice(0, MAX_ITEMS_PER_RULE * 2)) {
    const canonical = canonicalUrl(r.url)
    if (!canonical) { dropped.invalid++; errors.push({ stage: 'normalize', message: 'not an http(s) URL', url: String(r.url ?? '').slice(0, MAX_URL), http_status: null }); continue }
    if (seen.has(canonical)) { dropped.duplicate_url++; continue }
    seen.add(canonical)
    const publisher = clip(r.publisher, MAX_PUBLISHER)
    const title = cleanTitle(r.title, { publisher, url: canonical })
    const excerpt = cleanExcerpt(r.excerpt)
    const language = languageCode(r.language) || detectLanguage(`${title} ${excerpt || ''}`)
    const usePrefilter = prefilter ?? (r.provider === 'rss' || r.provider === 'websub')
    if (usePrefilter && !positiveMatch({ title, excerpt, language }, keywords)) { dropped.prefilter++; continue }
    const classification = classify({ title, excerpt, language }, keywords)
    const location = detectLocation(title, excerpt)
    const alias = matchAlias(title, aliasIndex)
    const name = clip(alias?.name ?? extractName(title), 200)
    draft.push({
      provider: r.provider,
      rule_id: rule?.id && UUID.test(rule.id) ? rule.id : null,
      external_id: r.external_id ? String(r.external_id).slice(0, 500) : null,
      url: String(r.url).slice(0, MAX_URL),
      canonical_url: canonical,
      title,
      excerpt,
      publisher,
      language,
      published_at: r.published_at || null,
      source_kind: sourceKindFor(canonical, r.provider),
      classification,
      detected: { name, country_iso2: location.country_iso2, city: location.city, latitude: null, longitude: null },
      keys: { normalized_name: normalizedName(name), wikidata_qid: null, alias_project_id: alias?.project_id && UUID.test(alias.project_id) ? alias.project_id : null },
      raw: boundRaw(r.raw || {}),
      fetched_at: fetchedAt,
      _domain: registrableDomain(hostOf(canonical)),
    })
    if (draft.length >= MAX_ITEMS_PER_RULE) break
  }
  const { story_keys } = clusterStories(draft, { now })
  // Independent domains per story: +10 reliability for each further domain (at most +20).
  /** @type {Map<string, Set<string>>} */
  const domains = new Map()
  draft.forEach((d, i) => { const k = story_keys[i]; if (!domains.has(k)) domains.set(k, new Set()); /** @type {Set<string>} */ (domains.get(k)).add(d._domain) })
  /** @type {Item[]} */
  const items = []
  draft.forEach((d, i) => {
    /** @type {Item} */
    const item = {
      provider: d.provider, rule_id: d.rule_id, external_id: d.external_id, url: d.url, canonical_url: d.canonical_url, title: d.title,
      excerpt: d.excerpt, publisher: d.publisher, language: d.language, published_at: d.published_at, source_kind: d.source_kind,
      classification: d.classification, detected: d.detected, raw: d.raw,
      reliability: reliability(/** @type {any} */ (d.source_kind), { independentDomains: domains.get(story_keys[i])?.size || 1 }),
      keys: { normalized_name: d.keys.normalized_name, story_key: story_keys[i], wikidata_qid: d.keys.wikidata_qid, alias_project_id: d.keys.alias_project_id },
    }
    const problems = validateItem(item)
    if (problems.length) { dropped.invalid++; errors.push({ stage: 'validate', message: problems.join('; ').slice(0, 1000), url: item.canonical_url, http_status: null }); return }
    items.push(item)
  })
  return { items, errors, dropped }
}

/**
 * Checks an item against the §8 contract (exact keys, types, lengths, vocabularies). Returns the problems found.
 * @param {any} item @returns {string[]}
 */
export function validateItem(item) {
  /** @type {string[]} */
  const p = []
  if (!item || typeof item !== 'object' || Array.isArray(item)) return ['item is not an object']
  const keys = Object.keys(item).sort()
  if (keys.join() !== [...ITEM_KEYS].sort().join()) p.push(`keys must be exactly ${ITEM_KEYS.join(',')} (got ${keys.join(',')})`)
  const str = (/** @type {unknown} */ v) => typeof v === 'string'
  const optStr = (/** @type {unknown} */ v, /** @type {number} */ max) => v === null || (str(v) && chars(/** @type {string} */ (v)) <= max)
  const httpUrl = (/** @type {unknown} */ v) => str(v) && /^https?:\/\/[^\s]+$/i.test(/** @type {string} */ (v)) && chars(/** @type {string} */ (v)) <= MAX_URL
  if (!PROVIDERS.includes(item.provider)) p.push('provider: unknown ' + item.provider)
  if (!(item.rule_id === null || (str(item.rule_id) && UUID.test(item.rule_id)))) p.push('rule_id: uuid or null')
  if (!(item.external_id === null || str(item.external_id))) p.push('external_id: string or null')
  if (!httpUrl(item.url)) p.push('url: http(s), ≤2000')
  if (!httpUrl(item.canonical_url)) p.push('canonical_url: http(s), ≤2000')
  if (!str(item.title) || !item.title.trim() || chars(item.title) > MAX_TITLE) p.push('title: 1..500 characters')
  else if (/<\/?[a-z][^>]*>/i.test(item.title)) p.push('title: contains HTML')
  if (!optStr(item.excerpt, MAX_EXCERPT)) p.push('excerpt: ≤300 or null')
  if (!optStr(item.publisher, MAX_PUBLISHER)) p.push('publisher: ≤200 or null')
  if (!(item.language === null || (str(item.language) && /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(item.language)))) p.push('language: BCP-47/ISO 639-1 or null')
  if (!(item.published_at === null || (str(item.published_at) && /^\d{4}-\d{2}-\d{2}T/.test(item.published_at) && Number.isFinite(Date.parse(item.published_at))))) p.push('published_at: ISO-8601 or null')
  if (!SOURCE_KINDS.includes(item.source_kind)) p.push('source_kind: unknown ' + item.source_kind)
  if (!(Number.isInteger(item.reliability) && item.reliability >= 0 && item.reliability <= 100)) p.push('reliability: integer 0..100')
  const c = item.classification
  if (!c || typeof c !== 'object') p.push('classification: object')
  else {
    if (!(Number.isInteger(c.score) && c.score >= 0 && c.score <= 100)) p.push('classification.score: integer 0..100')
    if (!LABELS.includes(c.label)) p.push('classification.label: unknown ' + c.label)
    if (!Array.isArray(c.reasons) || c.reasons.length > 20 || !c.reasons.every(str)) p.push('classification.reasons: ≤20 strings')
    if (!str(c.version) || !c.version) p.push('classification.version: string')
  }
  const d = item.detected
  if (!d || typeof d !== 'object' || Object.keys(d).sort().join() !== 'city,country_iso2,latitude,longitude,name') p.push('detected: {name,country_iso2,city,latitude,longitude}')
  else {
    if (!(d.name === null || str(d.name))) p.push('detected.name: string or null')
    if (!(d.country_iso2 === null || (str(d.country_iso2) && /^[A-Z]{2}$/.test(d.country_iso2)))) p.push('detected.country_iso2: ISO 3166-1 alpha-2 or null')
    if (!(d.city === null || str(d.city))) p.push('detected.city: string or null')
    if (!(d.latitude === null || (typeof d.latitude === 'number' && d.latitude >= -90 && d.latitude <= 90))) p.push('detected.latitude: -90..90 or null')
    if (!(d.longitude === null || (typeof d.longitude === 'number' && d.longitude >= -180 && d.longitude <= 180))) p.push('detected.longitude: -180..180 or null')
  }
  const k = item.keys
  if (!k || typeof k !== 'object' || Object.keys(k).sort().join() !== 'alias_project_id,normalized_name,story_key,wikidata_qid') p.push('keys: {normalized_name,story_key,wikidata_qid,alias_project_id}')
  else {
    if (!(k.normalized_name === null || str(k.normalized_name))) p.push('keys.normalized_name: string or null')
    if (!str(k.story_key) || !k.story_key) p.push('keys.story_key: non-empty string')
    if (!(k.wikidata_qid === null || (str(k.wikidata_qid) && /^Q[1-9]\d*$/.test(k.wikidata_qid)))) p.push('keys.wikidata_qid: QID or null')
    if (!(k.alias_project_id === null || (str(k.alias_project_id) && UUID.test(k.alias_project_id)))) p.push('keys.alias_project_id: uuid or null')
  }
  if (!item.raw || typeof item.raw !== 'object' || Array.isArray(item.raw)) p.push('raw: object')
  else if (new TextEncoder().encode(JSON.stringify(item.raw)).byteLength > MAX_RAW_BYTES) p.push('raw: ≤4 kB serialized')
  return p
}

/**
 * Runs one rule against its source and returns the items to ingest. Never throws for source failures: they are
 * returned as errors with their stage (fetch, parse, …) and the rule's status.
 * @param {Rule} rule @param {Context} [ctx] @returns {Promise<RuleResult>}
 */
export async function collectRule(rule, ctx = {}) {
  const clock = ctx.clock ?? Date.now
  const sleep = ctx.sleep ?? defaultSleep
  const getEnv = ctx.getEnv ?? (() => undefined)
  const limiter = ctx.limiter ?? collectorLimiter(clock, sleep)
  const keywords = ctx.keywords ?? defaultKeywords()
  const now = clock()
  const policy = { fetch: ctx.fetch, clock, sleep, limiter, timeoutMs: ctx.timeoutMs }
  /** @type {RuleResult} */
  const result = {
    rule_id: rule.id ?? null, kind: rule.kind, name: rule.name ?? rule.kind, status: 'success', reason: null, fetched: 0, items: [], errors: [],
    not_modified: false, websub: null, dropped: { prefilter: 0, invalid: 0, duplicate_url: 0 }, project_updates: [],
    validators: { etag: rule.etag ?? null, last_modified: rule.last_modified ?? null, retry_after_ms: null },
  }
  const skip = (/** @type {string} */ reason) => { result.status = 'skipped'; result.reason = reason; return result }
  const fail = (/** @type {unknown} */ e, /** @type {string} */ stage, /** @type {string|null} */ url) => {
    result.errors.push(toError(e, stage, url))
    const err = /** @type {any} */ (e)
    if (err instanceof HttpError && err.retryAfterMs != null) result.validators.retry_after_ms = err.retryAfterMs
  }
  if (rule.enabled === false) return skip('rule_disabled')
  /** @type {RawRecord[]} */
  let records = []
  try {
    switch (rule.kind) {
      case 'gdelt': {
        if (!rule.query) return skip('no_query')
        const url = gdeltUrl(rule.query, { timespan: gdeltTimespan(rule.last_run_at, now) })
        let res
        try { res = await fetchOk(url, policy) } catch (e) { fail(e, 'fetch', url); break }
        const parsed = parseGdelt(res.text)
        if (parsed.error) { fail(new Error(parsed.error), 'parse', url); break }
        records = gdeltRecords(parsed.articles)
        break
      }
      case 'rss': {
        if (!rule.url) return skip('no_url')
        let res
        try { res = await fetchWithPolicy(rule.url, { ...policy, headers: { accept: 'application/rss+xml, application/atom+xml, application/rdf+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1', ...conditionalHeaders(rule) } }) } catch (e) { fail(e, 'fetch', rule.url); break }
        const v = validatorsOf(res.headers)
        result.validators.etag = v.etag ?? result.validators.etag
        result.validators.last_modified = v.last_modified ?? result.validators.last_modified
        if (res.notModified) { result.not_modified = true; break }
        if (!res.ok) { fail(new HttpError('http_status', `HTTP ${res.status}`, { url: res.url, status: res.status, retryAfterMs: res.retryAfterMs }), 'fetch', rule.url); break }
        let feed
        try { feed = parseFeed(res.text || '', { now, linkHeader: res.headers.get('link') }) } catch (e) { fail(e, 'parse', res.url); break }
        if (feed.hub) result.websub = { hub: feed.hub, self: feed.self || rule.url }
        records = feedRecords(feed, { provider: 'rss', feedUrl: res.url })
        break
      }
      case 'naver_news':
      case 'naver_blog': {
        const cfg = naverConfig(getEnv)
        if (!cfg.ok) return skip(cfg.reason)
        if (!rule.query) return skip('no_query')
        const kind = rule.kind === 'naver_news' ? 'news' : 'blog'
        const since = Date.parse(String(rule.last_run_at || ''))
        for (let page = 0; page < NAVER_MAX_PAGES; page++) {
          if (ctx.deadline && clock() >= ctx.deadline) break
          let req
          try { req = naverRequest(kind, { query: rule.query, start: 1 + page * NAVER_MAX_DISPLAY, display: NAVER_MAX_DISPLAY, sort: 'date' }, cfg.config, clock()) } catch (e) { fail(e, 'config', null); break }
          let parsed
          try {
            const res = await fetchOk(req.url, { ...policy, headers: req.headers })
            parsed = parseNaver(JSON.parse(res.text || 'null'), kind)
          } catch (e) { fail(e, e instanceof HttpError ? 'fetch' : 'parse', req.url.replace(/\?.*$/, '')); break }
          records.push(...parsed.records)
          // Sorted by date: stop once a page reaches items older than the previous run, or the last page.
          const oldest = parsed.records.reduce((m, r) => Math.min(m, Date.parse(r.published_at || '') || Infinity), Infinity)
          if (parsed.records.length < NAVER_MAX_DISPLAY || (Number.isFinite(since) && oldest <= since)) break
        }
        break
      }
      case 'brave': {
        const key = braveKey(getEnv)
        if (!key) return skip('brave_key_not_set')
        if (!rule.query) return skip('no_query')
        const req = braveRequest(rule.query, key)
        try {
          const res = await fetchOk(req.url, { ...policy, headers: req.headers, retries: 1 })
          records = parseBrave(JSON.parse(res.text || 'null'))
        } catch (e) { fail(e, e instanceof HttpError ? 'fetch' : 'parse', req.url.replace(/\?.*$/, '')) }
        break
      }
      case 'wikidata': {
        const out = await detectWikidataChanges({ projects: ctx.wikidataProjects || [], since: rule.last_run_at ?? null, policy })
        result.fetched = out.checked
        result.project_updates = out.changes
        result.errors.push(...out.errors)
        result.reason = out.baseline ? 'baseline_run' : null
        result.status = out.errors.length ? (out.checked ? 'partial' : 'error') : 'success'
        return result
      }
      case 'websub':
        return skip('websub_rules_are_fed_by_pushes')
      default:
        return skip('unknown_kind')
    }
  } catch (e) {
    fail(e, 'collect', rule.url ?? null)
  }
  result.fetched = records.length
  const built = buildItems(records, { rule, now, keywords, aliasIndex: ctx.aliasIndex ?? null })
  result.items = built.items
  result.dropped = built.dropped
  result.errors.push(...built.errors)
  const sourceFailed = result.errors.some((e) => e.stage === 'fetch' || e.stage === 'parse' || e.stage === 'config' || e.stage === 'collect')
  result.status = sourceFailed ? (records.length ? 'partial' : 'error') : result.errors.length ? 'partial' : 'success'
  return result
}

/**
 * Backoff after a failed run (§3): now + min(48 h, 1 h × 2^(failures − 1)), or the server's Retry-After if longer.
 * @param {number} failureCount the count including this failure @param {number} now @param {number|null} [retryAfterMs]
 */
export function backoffUntil(failureCount, now, retryAfterMs = null) {
  const n = Math.max(1, Math.floor(failureCount))
  const wait = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (n - 1))
  return new Date(now + Math.max(wait, Math.min(BACKOFF_MAX_MS, retryAfterMs ?? 0))).toISOString()
}

/**
 * p_rule_state for archive_finish_run: conditional-GET validators, the failure count and backoff computed by the
 * spec formula, the next run time, and a hub the feed advertised.
 * @param {Rule} rule @param {RuleResult} result @param {number} now
 */
export function ruleState(rule, result, now) {
  const failed = result.status === 'error'
  const previous = Math.max(0, Math.floor(Number(rule.failure_count) || 0))
  const failure_count = failed ? previous + 1 : result.status === 'skipped' ? previous : 0
  const backoff_until = failed ? backoffUntil(failure_count, now, result.validators.retry_after_ms) : null
  const cadence = Math.max(1, Number(rule.cadence_hours) || 6) * 3600e3
  const next = new Date(now + cadence).toISOString()
  return {
    etag: result.validators.etag,
    last_modified: result.validators.last_modified,
    not_modified: result.not_modified,
    failed,
    failure_count,
    backoff_until,
    next_run_at: backoff_until && backoff_until > next ? backoff_until : next,
    retry_after_seconds: result.validators.retry_after_ms != null ? Math.ceil(result.validators.retry_after_ms / 1000) : null,
    websub_hub: result.websub?.hub ?? null,
    websub_self: result.websub?.self ?? null,
    skipped_reason: result.status === 'skipped' ? result.reason : null,
  }
}

/** Label counts of a list of items (probe and run summaries). @param {Item[]} items */
export function labelCounts(items) {
  /** @type {Record<string, number>} */
  const out = {}
  for (const l of LABELS) out[l] = 0
  for (const it of items) out[it.classification.label] = (out[it.classification.label] || 0) + 1
  return out
}
