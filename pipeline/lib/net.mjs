// The pipeline's polite HTTP client. Every request goes through the collector's fetchWithPolicy
// (edge-functions/_shared/archive/http.mjs: SSRF guard, timeout, size cap, retries on 429/5xx honouring Retry-After,
// manual redirects) with:
//  - the pipeline User-Agent with a contact address (Wikimedia's User-Agent policy);
//  - a per-host rate limiter: at most 1 request per second per wiki and for the query service, GDELT 1 per 5 s,
//    Overpass 1 per 10 s, thumbnails 5 per second;
//  - maxlag=5 on every MediaWiki API call, with a wait and retry when the API answers with a maxlag error;
//  - the run's time budget: no request starts after the deadline (BudgetError); a view of the client may have an earlier
//    deadline of its own (client.view), which is how the foreign sources stop before the Korean ones (Korea first);
//  - optional caching with a TTL and ETag revalidation (state/cache/);
//  - per-host counters for report.json (requests, errors, statuses, bytes, time).
import { fetchWithPolicy, checkUrl, readCapped, parseRetryAfter, retryable, HttpError, defaultSleep, errorText } from '../../edge-functions/_shared/archive/http.mjs'

/**
 * Strict per-host spacing: a caller returns only when at least the host's interval has passed since the previous
 * caller returned (measured when it actually proceeds, so a late request never lets the next one come early).
 * Concurrent callers of one host queue in order.
 */
export function createStrictLimiter({ clock = Date.now, sleep = defaultSleep, defaultIntervalMs = 1000, intervals = {} } = {}) {
  const last = new Map(), queues = new Map()
  const intervalOf = (key) => intervals[key] ?? (/\.wikipedia\.org$/.test(key) ? intervals['*.wikipedia.org'] ?? defaultIntervalMs : defaultIntervalMs)
  return {
    last,
    intervalOf,
    wait(host) {
      const key = String(host || '').toLowerCase()
      const prev = queues.get(key) || Promise.resolve()
      const turn = prev.then(async () => {
        const interval = intervalOf(key)
        for (;;) {
          const now = clock(), at = (last.get(key) ?? -Infinity) + interval
          if (now >= at) { last.set(key, now); return }
          await sleep(at - now)
        }
      })
      queues.set(key, turn.catch(() => {}))
      return turn
    },
  }
}

export const USER_AGENT = 'LightArchitectureArchive/0.18 (+https://remona8787.github.io/; remona56@hanmail.net)'
export const MAXLAG = 5
export const HOST_INTERVALS = {
  'query.wikidata.org': 1000,
  'www.wikidata.org': 1000,
  'commons.wikimedia.org': 1000,
  'upload.wikimedia.org': 200,
  'thumb.wikimedia.org': 200,
  'api.gdeltproject.org': 5000,
  'overpass-api.de': 10000,
  // Image providers and Korean public data (docs/PIPELINE.md "Sources: rate limits and terms").
  'api.openverse.org': 4000,
  'api.flickr.com': 1000,
  'live.staticflickr.com': 200,
  'apis.data.go.kr': 500,
  'openapi.seoul.go.kr:8088': 1000,
  'openapi.seoul.go.kr': 1000,
  'tong.visitkorea.or.kr': 200,
  'api.unsplash.com': 75000,
  'images.unsplash.com': 200,
  'api.pexels.com': 20000,
  'images.pexels.com': 200,
  'naverapihub.apigw.ntruss.com': 1000,
  'openapi.naver.com': 1000,
}
const MEDIAWIKI_API = /^(?:[a-z-]+\.wikipedia\.org|commons\.wikimedia\.org|www\.wikidata\.org)$/

export class BudgetError extends Error {
  constructor(stage = 'run') { super(`time budget exhausted (${stage})`); this.name = 'BudgetError'; this.code = 'budget' }
}

export const isMediaWikiApi = (url) => { try { const u = new URL(url); return MEDIAWIKI_API.test(u.hostname) && u.pathname === '/w/api.php' } catch { return false } }

/**
 * @param {{fetch?: typeof fetch, clock?: () => number, sleep?: (ms: number) => Promise<void>, userAgent?: string,
 *   intervals?: Record<string, number>, cache?: import('./cache.mjs').Cache|null, deadline?: number, log?: (e: object) => void}} [o]
 */
export function createClient({ fetch = globalThis.fetch, clock = Date.now, sleep = defaultSleep, userAgent = USER_AGENT, intervals = HOST_INTERVALS, cache = null, deadline = Infinity, log = () => {} } = {}) {
  const strict = createStrictLimiter({ clock, sleep, defaultIntervalMs: 1000, intervals })
  // The budget is checked again after the rate-limit wait, so no request starts after the deadline (the client's, or
  // the earlier one of a view).
  const limiterUntil = (callUntil) => ({ last: strict.last, intervalOf: strict.intervalOf, async wait(host) { await strict.wait(host); if (clock() >= Math.min(until, callUntil)) throw new BudgetError('rate_limit_wait') } })
  const limiter = limiterUntil(Infinity)
  // A provider that answers 429 with a long Retry-After (or reports its quota as used up) is paused until then.
  const pausedUntil = new Map()
  /** @type {Record<string, {requests: number, ok: number, errors: number, not_modified: number, cached: number, bytes: number, ms: number, statuses: Record<string, number>, last_error: string|null}>} */
  const stats = {}
  const hostStats = (host) => (stats[host] ||= { requests: 0, ok: 0, errors: 0, not_modified: 0, cached: 0, bytes: 0, ms: 0, statuses: {}, last_error: null })
  let until = deadline

  // The collector's fetchWithPolicy sets its own (v0.16) User-Agent; every request of this run carries the
  // pipeline's instead.
  const politeFetch = (url, init = {}) => {
    const headers = new Headers(init.headers || {})
    headers.set('user-agent', userAgent)
    return fetch(url, { ...init, headers })
  }

  const guard = (stage, callUntil = Infinity) => {
    if (clock() >= Math.min(until, callUntil)) throw new BudgetError(stage)
  }
  const checkPaused = (host, url) => { const t = pausedUntil.get(host); if (t && clock() < t) throw new HttpError('rate_limited', `${host} asked to wait until ${new Date(t).toISOString()}`, { url, status: 429 }) }
  const hostOf = (url) => { try { return new URL(url).host } catch { return 'invalid' } }

  /**
   * GET/POST returning parsed JSON.
   * @param {string} url
   * @param {{method?: string, headers?: Record<string,string>, body?: string|null, cache?: {ns: string, key: string, ttlMs: number}|null,
   *   retries?: number, timeoutMs?: number, maxBytes?: number, stage?: string, accept?: string}} [o]
   */
  async function json(url, o = {}) {
    const { method = 'GET', headers = {}, body = null, retries = 2, timeoutMs = 30000, maxBytes = 16 * 1024 * 1024, stage = 'fetch', accept = 'application/json', deadline: callUntil = Infinity, redactUrl = null } = o
    const c = o.cache && cache ? o.cache : null
    const host = hostOf(url)
    if (c) {
      const hit = cache.fresh(c.ns, c.key)
      if (hit !== undefined) { hostStats(host).cached++; return hit }
    }
    let target = url
    if (isMediaWikiApi(url)) { const u = new URL(url); if (!u.searchParams.has('maxlag')) u.searchParams.set('maxlag', String(MAXLAG)); target = u.href }
    // Keys in query strings (data.go.kr, Flickr) never reach the logs.
    const shown = (x) => String(redactUrl ? redactUrl(x) : x).slice(0, 300)
    const stale = c ? cache.entry(c.ns, c.key) : null
    checkPaused(host, shown(target))
    for (let attempt = 1; ; attempt++) {
      guard(stage, callUntil)
      const h = { accept, ...headers }
      if (stale?.etag) h['if-none-match'] = stale.etag
      const s = hostStats(host)
      s.requests++
      const t0 = clock()
      let res
      try {
        // maxRedirects 0: a key in the URL is never sent on to another address (Seoul OpenAPI).
        res = await fetchWithPolicy(target, { fetch: politeFetch, clock, sleep, limiter: callUntil === Infinity ? limiter : limiterUntil(callUntil), method, headers: h, body, retries, timeoutMs, maxBytes, userAgent, ...(o.maxRedirects !== undefined ? { maxRedirects: o.maxRedirects } : {}) })
      } catch (e) {
        s.errors++; s.ms += clock() - t0; s.last_error = redactUrl ? redactUrl(errorText(e)) : errorText(e)
        log({ kind: 'http_error', host, url: shown(target), message: s.last_error })
        throw e
      }
      s.ms += clock() - t0
      s.statuses[res.status] = (s.statuses[res.status] || 0) + 1
      s.bytes += res.bytes
      if (res.notModified && stale) { s.not_modified++; cache.touch(c.ns, c.key); return stale.v }
      if (!res.ok) {
        s.errors++; s.last_error = `HTTP ${res.status}`
        if (res.status === 429) {
          const wait = parseRetryAfter(res.headers.get('retry-after'), clock()) ?? 15 * 60e3
          pausedUntil.set(host, clock() + Math.min(wait, 24 * 3600e3))
          log({ kind: 'rate_limited', host, wait_ms: wait })
        }
        throw new HttpError('http_status', `HTTP ${res.status}`, { url: shown(res.url), status: res.status, retryAfterMs: res.retryAfterMs })
      }
      let data
      try { data = JSON.parse(res.text || 'null') } catch {
        s.errors++; s.last_error = 'invalid JSON'
        throw new HttpError('invalid_json', 'answer is not JSON: ' + String(res.text || '').slice(0, 160), { url: res.url, status: res.status })
      }
      if (data && data.error && isMediaWikiApi(url)) {
        if (data.error.code === 'maxlag' && attempt <= 3) {
          const wait = Math.min(30000, parseRetryAfter(res.headers.get('retry-after'), clock()) ?? 5000)
          log({ kind: 'maxlag', host, wait_ms: wait, info: String(data.error.info || '').slice(0, 200) })
          await sleep(wait)
          continue
        }
        s.errors++; s.last_error = 'api error ' + data.error.code
        throw new HttpError('api_error', `${data.error.code}: ${String(data.error.info || '').slice(0, 200)}`, { url: res.url, status: res.status })
      }
      s.ok++
      if (o.onHeaders) o.onHeaders(res.headers)
      if (c) cache.set(c.ns, c.key, data, { ttlMs: c.ttlMs, etag: res.headers.get('etag') })
      return data
    }
  }

  /** GET returning bytes (thumbnails). Same guards as fetchWithPolicy: SSRF check per hop, timeout, cap, retries. */
  async function bytes(url, { maxBytes = 4 * 1024 * 1024, timeoutMs = 30000, retries = 2, stage = 'thumb', deadline: callUntil = Infinity } = {}) {
    let current = url
    const lim = callUntil === Infinity ? limiter : limiterUntil(callUntil)
    for (let hop = 0; hop <= 3; hop++) {
      const check = checkUrl(current)
      if (!check.ok) throw new HttpError('ssrf_blocked', `refused ${current}: ${check.reason}`, { url: current })
      const host = check.url.host
      const s = hostStats(host)
      checkPaused(host, current)
      for (let attempt = 1; ; attempt++) {
        guard(stage, callUntil)
        await lim.wait(host)
        s.requests++
        const t0 = clock()
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(new HttpError('timeout', `no answer within ${timeoutMs} ms`, { url: current })), timeoutMs)
        let res
        try {
          res = await politeFetch(check.url.href, { redirect: 'manual', signal: controller.signal, headers: { accept: 'image/jpeg,image/png,image/webp,*/*;q=0.5' } })
        } catch (e) {
          clearTimeout(timer)
          s.errors++; s.ms += clock() - t0; s.last_error = errorText(e)
          if (attempt <= retries) { await sleep(1000 * 2 ** (attempt - 1)); continue }
          throw new HttpError('network', 'network error: ' + errorText(e), { url: current })
        }
        try {
          s.statuses[res.status] = (s.statuses[res.status] || 0) + 1
          if (retryable(res.status) && attempt <= retries) {
            const wait = parseRetryAfter(res.headers.get('retry-after'), clock()) ?? 1000 * 2 ** (attempt - 1)
            try { await res.body?.cancel() } catch {}
            if (wait <= 30000) { await sleep(wait); continue }
          }
          const location = res.headers.get('location')
          if (res.status >= 300 && res.status < 400 && location) {
            try { await res.body?.cancel() } catch {}
            current = new URL(location, check.url).href
            break
          }
          if (!res.ok) { s.errors++; s.last_error = `HTTP ${res.status}`; try { await res.body?.cancel() } catch {}; throw new HttpError('http_status', `HTTP ${res.status}`, { url: current, status: res.status }) }
          const raw = await readCapped(res, maxBytes, current)
          s.ok++; s.bytes += raw.byteLength
          return { bytes: Buffer.from(raw), type: res.headers.get('content-type') || null, url: current }
        } finally {
          clearTimeout(timer)
          s.ms += clock() - t0
        }
      }
    }
    throw new HttpError('too_many_redirects', 'more than 3 redirects', { url })
  }

  const client = {
    json, bytes, limiter, stats, politeFetch, userAgent, clock, sleep, pausedUntil,
    setDeadline(t) { until = t },
    get deadline() { return until },
    remaining() { return until - clock() },
    /**
     * The same client (limiter, caches, counters) with an extra deadline: deadlineFn() is read at every request, so
     * a stage can move it. The foreign sources use a view that stops before the Korean ones (Korea first).
     */
    view(deadlineFn) {
      const d = () => Math.min(until, deadlineFn())
      return {
        ...client,
        json: (u, o = {}) => json(u, { ...o, deadline: Math.min(o.deadline ?? Infinity, deadlineFn()) }),
        bytes: (u, o = {}) => bytes(u, { ...o, deadline: Math.min(o.deadline ?? Infinity, deadlineFn()) }),
        get deadline() { return d() },
        remaining() { return d() - clock() },
      }
    },
  }
  return client
}
