// Link checks of official and source URLs (docs/ARCHIVE_SPEC.md §3 "Link and image checks"), reusing the
// collector's checkLink: HEAD with a one-byte GET fallback, at most 3 redirects, the SSRF guard on every hop,
// robots.txt honoured before any HTML page, 1 request per second per host — with the pipeline's User-Agent.
// Results are cached for a week (state/cache/links.json); quality.json lists broken links. Wikimedia URLs are not
// checked (they come from the APIs themselves).
import { checkLink } from '../../edge-functions/_shared/archive/linkcheck.mjs'
import { createRobotsCache } from '../../edge-functions/_shared/archive/http.mjs'
import { HOUR } from './cache.mjs'

/**
 * @param {{url: string, project: string, field: string}[]} targets
 * @param {{client: any, cache: any, ttlHours?: number, max?: number, skipHosts?: string[], deadline?: number}} o
 */
export async function checkLinks(targets, { client, cache, ttlHours = 168, max = 400, skipHosts = [], deadline = Infinity }) {
  const policy = { fetch: client.politeFetch, clock: client.clock, sleep: client.sleep, limiter: client.limiter, userAgent: client.userAgent }
  const robots = createRobotsCache({ policy, clock: client.clock })
  const byUrl = new Map()
  for (const t of targets) {
    let host
    try { host = new URL(t.url).hostname } catch { continue }
    if (skipHosts.includes(host)) continue
    if (!byUrl.has(t.url)) byUrl.set(t.url, [])
    byUrl.get(t.url).push(t)
  }
  const results = new Map()
  let checked = 0, fromCache = 0, unchecked = 0
  // Oldest results first, so every URL is eventually re-checked.
  const urls = [...byUrl.keys()].sort((a, b) => (cache.entry('links', a)?.at ?? 0) - (cache.entry('links', b)?.at ?? 0) || (a < b ? -1 : 1))
  for (const url of urls) {
    const hit = cache.fresh('links', url)
    if (hit !== undefined) { results.set(url, hit); fromCache++; continue }
    // A check needs up to three requests to its host (robots.txt, HEAD, GET) at 1 per second: leave a margin.
    if (checked >= max || client.clock() + 5000 >= deadline) { unchecked++; const old = cache.any('links', url); if (old) results.set(url, old); continue }
    const html = !/\.(pdf|jpe?g|png|webp|gif|svg|json|xml)(\?|$)/i.test(url)
    let r
    try { r = await checkLink({ target: 'project', id: url, url, html }, { policy, robots }) } catch (e) {
      r = { state: 'broken', http_status: null, final_url: null, reason: String(e?.message || e).slice(0, 200) }
    }
    // Stopped by the time budget, not by the server: that says nothing about the link.
    if (/time budget exhausted/.test(r.reason || '')) { unchecked++; const old = cache.any('links', url); if (old) results.set(url, old); continue }
    checked++
    const prev = cache.any('links', url)
    const failures = r.state === 'broken' ? (prev?.consecutive_failures || 0) + 1 : 0
    const value = { url, state: r.state, http_status: r.http_status ?? null, final_url: r.final_url ?? null, reason: r.reason ?? null, checked_at: new Date(client.clock()).toISOString(), consecutive_failures: failures }
    results.set(url, value)
    cache.set('links', url, value, { ttlMs: (r.state === 'broken' ? 24 : ttlHours) * HOUR })
  }
  const rows = []
  for (const [url, ts] of byUrl) {
    const r = results.get(url)
    for (const t of ts) rows.push({ project: t.project, field: t.field, url, state: r?.state ?? 'unknown', http_status: r?.http_status ?? null, final_url: r?.final_url ?? null, reason: r?.reason ?? null, checked_at: r?.checked_at ?? null, consecutive_failures: r?.consecutive_failures ?? 0 })
  }
  rows.sort((a, b) => (a.project < b.project ? -1 : a.project > b.project ? 1 : a.url < b.url ? -1 : 1))
  return { rows, checked, from_cache: fromCache, unchecked }
}
