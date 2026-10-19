// Link and image checks (docs/ARCHIVE_SPEC.md §3 "Link and image checks"; Edge Function archive-check-links).
// Each due URL (archive_links_due: {target, id, url, html, …}) gets one check: SSRF guard, robots.txt for HTML pages,
// HEAD, and GET with Range: bytes=0-0 when a server refuses HEAD; at most 3 redirects; at most 1 request per second
// per host. The result per URL is a state for archive_record_link_checks:
//   ok / redirect        reachable (redirect: the final URL differs)
//   broken               THIS check failed (404/410/5xx, timeout, network, too many redirects); the SQL turns three
//                        consecutive failures into link_state broken and opens the link/image update itself
//   robots_disallowed    robots.txt forbids the page: not fetched, not a failure
//   blocked              the SSRF guard refused it, or the server refuses automated access (401/403/429): not a failure
// A robots.txt that is unreachable (5xx or network) forbids the fetch (RFC 9309 §2.3.1.4); the server being down
// is itself the evidence, so that check counts as broken.

import { fetchWithPolicy, checkUrl, createRobotsCache, HttpError, errorText } from './http.mjs'
import { collectorLimiter } from './pipeline.mjs'

export const LINK_TIMEOUT_MS = 15000
export const LINK_CONCURRENCY = 4
// Servers that answer HEAD with these statuses often do serve GET: try a one-byte GET before judging.
const HEAD_REFUSED = new Set([400, 403, 405, 406, 409, 429, 500, 501, 502, 503])

/**
 * @typedef {{target: 'source'|'media'|'project', id: string, url: string, html?: boolean}} DueLink
 * @typedef {{target: string, id: string, url: string, state: 'ok'|'redirect'|'broken'|'robots_disallowed'|'blocked', http_status: number|null, final_url: string|null, reason: string|null}} LinkResult
 */

/** @param {number} status @returns {LinkResult['state']} */
function stateFor(status) {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 401 || status === 403 || status === 429) return 'blocked'
  return 'broken'
}

/**
 * @param {DueLink} link
 * @param {{policy: Parameters<typeof fetchWithPolicy>[1], robots: ReturnType<typeof createRobotsCache>}} ctx
 * @returns {Promise<LinkResult>}
 */
export async function checkLink(link, { policy, robots }) {
  const base = { target: link.target, id: link.id, url: link.url }
  const guard = checkUrl(link.url)
  if (!guard.ok) return { ...base, state: 'blocked', http_status: null, final_url: null, reason: guard.reason }
  if (link.html !== false) {
    const r = await robots.allowed(link.url)
    if (!r.allowed) {
      return { ...base, state: r.reason === 'robots_disallowed' ? 'robots_disallowed' : r.reason === 'robots_blocked' ? 'blocked' : 'broken', http_status: null, final_url: null, reason: r.reason }
    }
  }
  /** @param {'HEAD'|'GET'} method */
  const attempt = (method) => fetchWithPolicy(link.url, { ...policy, method, readBody: false, retries: 1, timeoutMs: LINK_TIMEOUT_MS, headers: method === 'GET' ? { range: 'bytes=0-0' } : {} })
  let res
  try {
    res = await attempt('HEAD')
    if (HEAD_REFUSED.has(res.status)) res = await attempt('GET')
  } catch (e) {
    const err = /** @type {any} */ (e)
    if (err instanceof HttpError && err.code === 'ssrf_blocked') return { ...base, state: 'blocked', http_status: null, final_url: null, reason: 'redirect_' + err.message.replace(/^.*: /, '') }
    if (err instanceof HttpError && (err.code === 'too_many_redirects' || err.code === 'bad_redirect')) return { ...base, state: 'broken', http_status: err.status, final_url: null, reason: err.code }
    // HEAD may fail at the network level on servers that mishandle it; one GET decides.
    try { res = await attempt('GET') } catch (e2) {
      return { ...base, state: 'broken', http_status: null, final_url: null, reason: errorText(e2).slice(0, 200) }
    }
  }
  let state = stateFor(res.status)
  if (state === 'ok' && res.redirects.length && res.url !== link.url) state = 'redirect'
  return { ...base, state, http_status: res.status >= 100 && res.status <= 599 ? res.status : null, final_url: res.url !== link.url ? res.url : null, reason: state === 'ok' || state === 'redirect' ? null : 'HTTP ' + res.status }
}

/**
 * Checks a batch with a few workers until the deadline; links not reached are left out (they stay due).
 * @param {DueLink[]} links
 * @param {{fetch?: (input: string, init?: RequestInit) => Promise<Response>, clock?: () => number, sleep?: (ms: number) => Promise<void>, deadline?: number, concurrency?: number}} [o]
 * @returns {Promise<{results: LinkResult[], unchecked: number}>}
 */
export async function checkLinks(links, { fetch, clock = Date.now, sleep, deadline = Infinity, concurrency = LINK_CONCURRENCY } = {}) {
  const limiter = collectorLimiter(clock, sleep)
  const policy = { fetch, clock, sleep, limiter }
  const robots = createRobotsCache({ policy, clock })
  const list = (Array.isArray(links) ? links : []).filter((l) => l && typeof l.url === 'string' && typeof l.id === 'string' && l.target)
  /** @type {LinkResult[]} */
  const results = []
  let next = 0
  const worker = async () => {
    while (next < list.length && clock() < deadline) {
      const link = list[next++]
      results.push(await checkLink(link, { policy, robots }))
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length || 1)) }, worker))
  return { results, unchecked: list.length - results.length }
}
