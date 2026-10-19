// Outbound HTTP for the archive collector (docs/ARCHIVE_SPEC.md §1 rule 4, §3 "Retries", "Link and image checks").
// Every request the collector, the link checker and the probe make goes through fetchWithPolicy:
//  - the descriptive User-Agent with a contact address;
//  - a 20 s timeout per attempt (AbortController), at most 2 retries on 429/5xx (and network failures) honouring
//    Retry-After, with an injected clock and sleep so tests run instantly;
//  - a 2 MB response cap, checked against Content-Length AND while the body streams (a lying or missing length
//    cannot make the function buffer more);
//  - redirects followed by hand (at most 3), with the SSRF guard applied to every hop, not just the first URL;
//  - an optional per-host rate limiter (GDELT asks for one request per 5 s; link checks 1 per second per host).
// robots.txt is fetched, parsed (RFC 9309 groups, Allow/Disallow with longest match, `*` and `$`) and cached; the
// link checker asks it before fetching an HTML page.
//
// Limit of the SSRF guard: it judges the URL (scheme, credentials, IP literals in every IPv4/IPv6 spelling the URL
// parser accepts, and local-only host names). It cannot see which address a public host name resolves to: the
// Supabase Edge runtime offers no DNS lookup to functions (and a lookup before fetch would race the fetch's own
// lookup anyway), so a public name that points at a private address is not caught here. Redirect hops are re-checked,
// which closes the common "public URL redirects to 169.254.169.254" path.

export const USER_AGENT = 'LightArchitectureArchive/0.16 (+https://github.com/ymin02/medieval_era_project; remona56@hanmail.net)'
// The product token robots.txt groups are matched against (RFC 9309 §2.2.1).
export const ROBOTS_AGENT = 'LightArchitectureArchive'
export const TIMEOUT_MS = 20000
export const MAX_BYTES = 2 * 1024 * 1024
export const MAX_RETRIES = 2
export const MAX_REDIRECTS = 3
// A Retry-After longer than this is not waited for inside a run (an Edge Function has about two minutes): the
// request fails with the server's answer and the rule backs off instead.
export const MAX_RETRY_WAIT_MS = 30000
// Without Retry-After: 1 s, then 2 s.
export const RETRY_BASE_MS = 1000
export const ROBOTS_TTL_MS = 24 * 3600 * 1000
const ROBOTS_MAX_BYTES = 512 * 1024

/**
 * @typedef {(input: string, init?: RequestInit) => Promise<Response>} FetchLike
 * @typedef {{wait: (host: string) => Promise<void>}} Limiter
 * @typedef {object} PolicyResult
 * @property {boolean} ok            2xx (a 304 is ok: false with notModified: true)
 * @property {number} status
 * @property {string} url            the final URL after redirects
 * @property {Headers} headers
 * @property {string|null} text      the decoded body (null for HEAD, a 304 or when readBody is false)
 * @property {number} bytes
 * @property {string[]} redirects    every URL that answered with a redirect, in order
 * @property {number} attempts       requests sent for the final hop
 * @property {boolean} notModified
 * @property {number|null} retryAfterMs  the server's Retry-After on a final 429/503 (for the rule's backoff)
 */

/** A failure that is not an HTTP status: timeout, network, SSRF refusal, size cap, too many redirects. */
export class HttpError extends Error {
  /** @param {string} code @param {string} message @param {{url?: string, status?: number|null, retryAfterMs?: number|null}} [extra] */
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'HttpError'
    this.code = code
    this.url = extra.url ?? null
    this.status = extra.status ?? null
    this.retryAfterMs = extra.retryAfterMs ?? null
  }
}

// ---- SSRF guard ----

/** @param {string} s @returns {number[]|null} four octets of a dotted-decimal IPv4 literal */
export function parseIPv4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s)
  if (!m) return null
  const o = m.slice(1).map(Number)
  return o.every((n) => n <= 255) ? o : null
}

/** @param {string} s @returns {number[]|null} eight 16-bit groups of an IPv6 literal (compressed and dotted tails accepted) */
export function parseIPv6(s) {
  let text = s.replace(/^\[|\]$/g, '').toLowerCase()
  const zone = text.indexOf('%'); if (zone >= 0) text = text.slice(0, zone)
  if (!/^[0-9a-f:.]+$/.test(text) || !text.includes(':')) return null
  let tail = []
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)
  if (dotted) {
    const v4 = parseIPv4(dotted[1]); if (!v4) return null
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]]
    text = text.slice(0, -dotted[1].length)
    if (text.endsWith(':') && !text.endsWith('::')) text = text.slice(0, -1)
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const part = (/** @type {string} */ p) => p === '' ? [] : p.split(':').map((g) => /^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN)
  const head = part(halves[0]), rest = halves.length === 2 ? part(halves[1]) : []
  const groups = halves.length === 2
    ? [...head, ...new Array(Math.max(0, 8 - head.length - rest.length - tail.length)).fill(0), ...rest, ...tail]
    : [...head, ...tail]
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null
}

/** @param {number[]} o @returns {string|null} why the IPv4 address is not public */
export function blockedIPv4(o) {
  const [a, b, c] = o
  if (a === 0) return 'ipv4_this_network'
  if (a === 10) return 'ipv4_private'
  if (a === 100 && b >= 64 && b <= 127) return 'ipv4_cgnat'
  if (a === 127) return 'ipv4_loopback'
  if (a === 169 && b === 254) return 'ipv4_link_local_or_metadata'
  if (a === 172 && b >= 16 && b <= 31) return 'ipv4_private'
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return 'ipv4_reserved'
  if (a === 192 && b === 168) return 'ipv4_private'
  if (a === 198 && (b === 18 || b === 19)) return 'ipv4_benchmark'
  if (a === 198 && b === 51 && c === 100) return 'ipv4_documentation'
  if (a === 203 && b === 0 && c === 113) return 'ipv4_documentation'
  if (a >= 224) return 'ipv4_multicast_or_reserved'
  return null
}

/** @param {number[]} g eight groups @returns {string|null} why the IPv6 address is not public */
export function blockedIPv6(g) {
  const v4 = (/** @type {number} */ hi, /** @type {number} */ lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255]
  const zeros = (/** @type {number} */ n) => g.slice(0, n).every((x) => x === 0)
  if (g.every((x) => x === 0)) return 'ipv6_unspecified'
  if (zeros(7) && g[7] === 1) return 'ipv6_loopback'
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d), NAT64 (64:ff9b::a.b.c.d) and 6to4 (2002:aabb:ccdd::)
  // carry an IPv4 address that decides.
  if (zeros(5) && g[5] === 0xffff) return blockedIPv4(v4(g[6], g[7])) ? 'ipv6_mapped_' + blockedIPv4(v4(g[6], g[7])) : null
  if (zeros(6)) return blockedIPv4(v4(g[6], g[7])) ? 'ipv6_compatible_' + blockedIPv4(v4(g[6], g[7])) : null
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return blockedIPv4(v4(g[6], g[7])) ? 'ipv6_nat64_' + blockedIPv4(v4(g[6], g[7])) : null
  if (g[0] === 0x2002) return blockedIPv4(v4(g[1], g[2])) ? 'ipv6_6to4_' + blockedIPv4(v4(g[1], g[2])) : null
  if (g[0] === 0x2001 && g[1] === 0) return 'ipv6_teredo'
  if (g[0] === 0x2001 && g[1] === 0x0db8) return 'ipv6_documentation'
  if (g[0] === 0x0100 && g.slice(1, 4).every((x) => x === 0)) return 'ipv6_discard'
  if ((g[0] & 0xfe00) === 0xfc00) return 'ipv6_unique_local'
  if ((g[0] & 0xffc0) === 0xfe80) return 'ipv6_link_local'
  if ((g[0] & 0xffc0) === 0xfec0) return 'ipv6_site_local'
  if ((g[0] & 0xff00) === 0xff00) return 'ipv6_multicast'
  return null
}

// Names that only ever mean "this machine" or "the local network" (RFC 6761/6762/8375 and the usual internal zones,
// including the cloud metadata names metadata.google.internal and instance-data.ec2.internal).
const LOCAL_SUFFIX = /(^|\.)(localhost|local|internal|localdomain|lan|home\.arpa|intranet|corp|home)$/

/**
 * Whether the URL may be fetched: http(s) only, no credentials, no IP literal outside public unicast space, no
 * local-only host name, no single-label host. Every redirect hop is judged again.
 * @param {string|URL} input
 * @returns {{ok: true, url: URL} | {ok: false, reason: string}}
 */
export function checkUrl(input) {
  let url
  try { url = input instanceof URL ? input : new URL(String(input)) } catch { return { ok: false, reason: 'invalid_url' } }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, reason: 'scheme_not_allowed' }
  if (url.username || url.password) return { ok: false, reason: 'credentials_in_url' }
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!host) return { ok: false, reason: 'no_host' }
  if (host.startsWith('[')) {
    const g = parseIPv6(host)
    if (!g) return { ok: false, reason: 'invalid_ipv6' }
    const why = blockedIPv6(g)
    return why ? { ok: false, reason: why } : { ok: true, url }
  }
  // The URL parser has already turned decimal, hex and octal IPv4 spellings (2130706433, 0x7f.1) into dotted form.
  const v4 = parseIPv4(host)
  if (v4) { const why = blockedIPv4(v4); return why ? { ok: false, reason: why } : { ok: true, url } }
  if (/^[\d.]+$/.test(host)) return { ok: false, reason: 'invalid_ipv4' }
  if (LOCAL_SUFFIX.test(host)) return { ok: false, reason: 'local_hostname' }
  if (!host.includes('.')) return { ok: false, reason: 'single_label_hostname' }
  return { ok: true, url }
}

// ---- rate limiting ----

/**
 * Per-host spacing: each host gets its next slot at least intervalMs after the previous one. Slots are reserved
 * synchronously, so concurrent callers queue instead of all passing at once.
 * @param {{clock?: () => number, sleep?: (ms: number) => Promise<void>, defaultIntervalMs?: number, intervals?: Record<string, number>}} [o]
 * @returns {Limiter & {nextAt: Map<string, number>}}
 */
export function createRateLimiter({ clock = Date.now, sleep = defaultSleep, defaultIntervalMs = 1000, intervals = {} } = {}) {
  /** @type {Map<string, number>} */
  const nextAt = new Map()
  return {
    nextAt,
    async wait(host) {
      const key = String(host || '').toLowerCase()
      const interval = intervals[key] ?? defaultIntervalMs
      const now = clock()
      const at = Math.max(now, nextAt.get(key) ?? 0)
      nextAt.set(key, at + interval)
      if (at > now) await sleep(at - now)
    },
  }
}

/** @param {number} ms */
export const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

// ---- retries ----

/**
 * Retry-After as milliseconds from now: delta-seconds or an HTTP date (RFC 9110 §10.2.3). Null when absent/invalid.
 * @param {string|null|undefined} value @param {number} now
 */
export function parseRetryAfter(value, now) {
  if (value == null || value === '') return null
  const text = String(value).trim()
  if (/^\d+$/.test(text)) return Number(text) * 1000
  const at = Date.parse(text)
  return Number.isFinite(at) ? Math.max(0, at - now) : null
}

/** @param {number} status */
export const retryable = (status) => status === 429 || (status >= 500 && status <= 599)

// ---- body reading ----

/** The charset of a response: Content-Type, else the XML declaration, else UTF-8. @param {string|null} contentType @param {Uint8Array} bytes */
export function charsetOf(contentType, bytes) {
  const fromHeader = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType || '')
  if (fromHeader) return fromHeader[1].toLowerCase()
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200))
  const fromXml = /^\s*<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)["']/i.exec(head)
  return fromXml ? fromXml[1].toLowerCase() : 'utf-8'
}

/** @param {Uint8Array} bytes @param {string|null} contentType */
export function decodeBody(bytes, contentType) {
  const charset = charsetOf(contentType, bytes)
  try { return new TextDecoder(charset).decode(bytes) } catch { return new TextDecoder('utf-8').decode(bytes) }
}

/**
 * Reads a body up to maxBytes, cancelling the stream as soon as it grows past the cap.
 * @param {Response} res @param {number} maxBytes @param {string} url
 * @returns {Promise<Uint8Array>}
 */
export async function readCapped(res, maxBytes, url) {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await res.body?.cancel() } catch { /* already closed */ }
    throw new HttpError('too_large', `response declares ${declared} bytes, over the ${maxBytes}-byte cap`, { url, status: res.status })
  }
  if (!res.body) return new Uint8Array(0)
  const reader = res.body.getReader()
  /** @type {Uint8Array[]} */
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      try { await reader.cancel() } catch { /* ignore */ }
      throw new HttpError('too_large', `response exceeded the ${maxBytes}-byte cap while streaming`, { url, status: res.status })
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.byteLength }
  return out
}

/** @param {Response} res */
async function discard(res) { try { await res.body?.cancel() } catch { /* ignore */ } }

// ---- the policy fetch ----

/**
 * @param {string} input
 * @param {{fetch?: FetchLike, clock?: () => number, sleep?: (ms: number) => Promise<void>, method?: string,
 *   headers?: Record<string, string>, body?: string|Uint8Array|null, timeoutMs?: number, maxBytes?: number, retries?: number,
 *   maxRedirects?: number, limiter?: Limiter|null, signal?: AbortSignal|null, readBody?: boolean, maxRetryWaitMs?: number,
 *   userAgent?: string}} [o]
 * @returns {Promise<PolicyResult>}
 */
export async function fetchWithPolicy(input, o = {}) {
  const {
    fetch: doFetch = globalThis.fetch, clock = Date.now, sleep = defaultSleep, method = 'GET', headers = {}, body = null,
    timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES, retries = MAX_RETRIES, maxRedirects = MAX_REDIRECTS, limiter = null,
    signal = null, readBody = method !== 'HEAD', maxRetryWaitMs = MAX_RETRY_WAIT_MS, userAgent = USER_AGENT,
  } = o
  /** @type {string[]} */
  const redirects = []
  let current = String(input)
  let verb = method, payload = body
  for (let hop = 0; ; hop++) {
    const check = checkUrl(current)
    if (!check.ok) throw new HttpError('ssrf_blocked', `refused ${current}: ${check.reason}`, { url: current })
    const url = check.url
    let attempts = 0
    let res
    for (;;) {
      attempts++
      if (limiter) await limiter.wait(url.host)
      if (signal?.aborted) throw new HttpError('aborted', 'aborted by caller', { url: url.href })
      const controller = new AbortController()
      const onAbort = () => controller.abort(signal?.reason)
      signal?.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => controller.abort(new HttpError('timeout', `no answer within ${timeoutMs} ms`, { url: url.href })), timeoutMs)
      try {
        const h = new Headers(headers)
        h.set('user-agent', userAgent)
        res = await doFetch(url.href, { method: verb, headers: h, body: payload ?? undefined, redirect: 'manual', signal: controller.signal })
      } catch (e) {
        const reason = controller.signal.reason
        if (reason instanceof HttpError) throw reason
        if (signal?.aborted) throw new HttpError('aborted', 'aborted by caller', { url: url.href })
        // A network failure is retried like a 5xx (it usually is one: reset, refused, DNS hiccup).
        if (attempts <= retries) { await sleep(RETRY_BASE_MS * 2 ** (attempts - 1)); continue }
        throw new HttpError('network', 'network error: ' + errorText(e), { url: url.href })
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      if (retryable(res.status) && attempts <= retries) {
        const after = parseRetryAfter(res.headers.get('retry-after'), clock())
        const wait = after ?? RETRY_BASE_MS * 2 ** (attempts - 1)
        if (wait <= maxRetryWaitMs) { await discard(res); await sleep(wait); continue }
      }
      break
    }
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && res.status !== 304 && location) {
      await discard(res)
      redirects.push(url.href)
      if (hop >= maxRedirects) throw new HttpError('too_many_redirects', `more than ${maxRedirects} redirects`, { url: url.href, status: res.status })
      let next
      try { next = new URL(location, url).href } catch { throw new HttpError('bad_redirect', 'invalid Location header', { url: url.href, status: res.status }) }
      current = next
      // 303 (and, as browsers do, 301/302 after a POST) continue as GET without a body.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && verb === 'POST')) { verb = 'GET'; payload = null }
      continue
    }
    const notModified = res.status === 304
    let text = null, bytes = 0
    if (readBody && !notModified && verb !== 'HEAD') {
      const raw = await readCapped(res, maxBytes, url.href)
      bytes = raw.byteLength
      text = decodeBody(raw, res.headers.get('content-type'))
    } else await discard(res)
    const retryAfterMs = retryable(res.status) ? parseRetryAfter(res.headers.get('retry-after'), clock()) : null
    return { ok: res.status >= 200 && res.status < 300, status: res.status, url: url.href, headers: res.headers, text, bytes, redirects, attempts, notModified, retryAfterMs }
  }
}

/** @param {unknown} e */
export const errorText = (e) => String(/** @type {any} */ (e)?.message || e).slice(0, 300)

/**
 * fetchWithPolicy for callers that need a 2xx body: anything else becomes an HttpError('http_status').
 * @param {string} url @param {Parameters<typeof fetchWithPolicy>[1]} [o]
 */
export async function fetchOk(url, o = {}) {
  const res = await fetchWithPolicy(url, o)
  if (!res.ok && !res.notModified) throw new HttpError('http_status', `HTTP ${res.status}`, { url: res.url, status: res.status, retryAfterMs: res.retryAfterMs })
  return res
}

// ---- conditional GET ----

/** Request headers for a conditional GET from a rule's stored validators. @param {{etag?: string|null, last_modified?: string|null}|null|undefined} state */
export function conditionalHeaders(state) {
  /** @type {Record<string, string>} */
  const h = {}
  if (state?.etag) h['if-none-match'] = String(state.etag)
  if (state?.last_modified) h['if-modified-since'] = String(state.last_modified)
  return h
}

/** The validators of an answer, to store on the rule (archive_finish_run p_rule_state). @param {Headers} headers */
export function validatorsOf(headers) {
  return { etag: headers.get('etag') || null, last_modified: headers.get('last-modified') || null }
}

// ---- robots.txt ----

/**
 * @typedef {{agents: string[], rules: {allow: boolean, path: string}[]}} RobotsGroup
 * @param {string} text @returns {RobotsGroup[]}
 */
export function parseRobots(text) {
  /** @type {RobotsGroup[]} */
  const groups = []
  /** @type {RobotsGroup|null} */
  let group = null
  let lastWasAgent = false
  for (const line of String(text || '').split(/\r\n|\r|\n/)) {
    const m = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/.exec(line.replace(/#.*$/, ''))
    if (!m) continue
    const key = m[1].toLowerCase(), value = m[2]
    if (key === 'user-agent') {
      // Consecutive user-agent lines share one group; a user-agent line after rules starts a new one.
      if (!group || !lastWasAgent) { group = { agents: [], rules: [] }; groups.push(group) }
      group.agents.push(value.toLowerCase())
      lastWasAgent = true
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false
      if (!group) continue
      // "Disallow:" with no path allows everything: it adds no rule.
      if (value === '') continue
      group.rules.push({ allow: key === 'allow', path: value })
    } else lastWasAgent = false
  }
  return groups
}

/** @param {string} pattern @param {string} path */
function robotsMatch(pattern, path) {
  const anchored = pattern.endsWith('$')
  const body = anchored ? pattern.slice(0, -1) : pattern
  const re = new RegExp('^' + body.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''))
  return re.test(path)
}

/** Percent-encoding normalized so "/caf%c3%a9" and "/café" compare equal. @param {string} s */
function robotsPath(s) {
  try { return decodeURIComponent(s) } catch { return s }
}

/**
 * RFC 9309: the groups naming this agent (case-insensitive product token match), else the `*` groups; the longest
 * matching rule decides, Allow winning a tie; no matching rule allows. /robots.txt itself is always allowed.
 * @param {RobotsGroup[]} groups @param {string} pathAndQuery @param {string} [agent]
 */
export function robotsAllowed(groups, pathAndQuery, agent = ROBOTS_AGENT) {
  const path = robotsPath(pathAndQuery || '/')
  if (path === '/robots.txt') return true
  const token = agent.toLowerCase()
  let chosen = groups.filter((g) => g.agents.some((a) => a !== '*' && a.replace(/\/.*$/, '').trim() === token))
  if (!chosen.length) chosen = groups.filter((g) => g.agents.includes('*'))
  let best = null
  for (const rule of chosen.flatMap((g) => g.rules)) {
    const pattern = robotsPath(rule.path)
    if (!robotsMatch(pattern, path)) continue
    const len = pattern.length
    if (!best || len > best.len || (len === best.len && rule.allow && !best.allow)) best = { len, allow: rule.allow }
  }
  return best ? best.allow : true
}

/**
 * A robots.txt cache per origin. 4xx (also 404) means no rules; 5xx or an unreachable server means "disallow
 * everything" until the entry expires (RFC 9309 §2.3.1.3/4); a redirect is followed (fetchWithPolicy, up to 3 hops).
 * @param {{fetchPolicy?: typeof fetchWithPolicy, policy?: Parameters<typeof fetchWithPolicy>[1], clock?: () => number, ttlMs?: number}} [o]
 */
export function createRobotsCache({ fetchPolicy = fetchWithPolicy, policy = {}, clock = Date.now, ttlMs = ROBOTS_TTL_MS } = {}) {
  /** @type {Map<string, {at: number, groups: RobotsGroup[]|null, status: string}>} */
  const cache = new Map()
  /** @param {string} origin */
  async function load(origin) {
    const hit = cache.get(origin)
    if (hit && clock() - hit.at < ttlMs) return hit
    let entry
    try {
      const res = await fetchPolicy(origin + '/robots.txt', { ...policy, clock, maxBytes: ROBOTS_MAX_BYTES, retries: 1 })
      if (res.ok) entry = { at: clock(), groups: parseRobots(res.text || ''), status: 'rules' }
      else if (res.status >= 400 && res.status < 500) entry = { at: clock(), groups: [], status: 'unavailable' }
      else entry = { at: clock(), groups: null, status: 'unreachable' }
    } catch (e) {
      // An SSRF refusal is not cached as "unreachable": the page itself is refused by the same guard.
      entry = { at: clock(), groups: null, status: /** @type {any} */ (e)?.code === 'ssrf_blocked' ? 'blocked' : 'unreachable' }
    }
    cache.set(origin, entry)
    return entry
  }
  return {
    cache,
    /** @param {string} url @returns {Promise<{allowed: boolean, reason: string}>} */
    async allowed(url) {
      let u
      try { u = new URL(url) } catch { return { allowed: false, reason: 'invalid_url' } }
      const entry = await load(u.origin)
      if (!entry.groups) return { allowed: false, reason: 'robots_' + entry.status }
      const ok = robotsAllowed(entry.groups, u.pathname + u.search)
      return { allowed: ok, reason: ok ? 'robots_' + entry.status : 'robots_disallowed' }
    },
  }
}
