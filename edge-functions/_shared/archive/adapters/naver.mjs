// NAVER news and blog search (docs/ARCHIVE_SPEC.md §2). Off until the operator sets NAVER_API_KEY_ID and
// NAVER_API_KEY (Edge Function secrets), and the rules are enabled.
//  - NAVER API HUB (mode "hub", the default): GET https://naverapihub.apigw.ntruss.com/search/v1/{news,blog} with
//    X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY. The developers center closed new Search API registrations on
//    2026-07-31; API HUB is the path for new keys.
//  - Legacy developers.naver.com keys (mode "legacy"): GET https://openapi.naver.com/v1/search/{news,blog}.json with
//    X-Naver-Client-Id / X-Naver-Client-Secret, usable until 2027-06-30. After that day (KST) the adapter refuses
//    legacy mode, judged by the injected clock, so a forgotten setting fails loudly instead of silently.
// Both answer {lastBuildDate, total, start, display, items: [...]}; titles and descriptions mark the query terms
// with <b>…</b> and contain HTML entities. Parameters: query, display (1-100), start (1-1000), sort=date.

import { stripHtml } from '../text.mjs'

export const NAVER_HUB_BASE = 'https://naverapihub.apigw.ntruss.com/search/v1/'
export const NAVER_LEGACY_BASE = 'https://openapi.naver.com/v1/search/'
export const NAVER_LEGACY_LAST_DAY = '2027-06-30'
// Legacy keys work through 2027-06-30 in Korea: refused from 2027-07-01 00:00 KST.
export const NAVER_LEGACY_CUTOFF_MS = Date.parse('2027-07-01T00:00:00+09:00')
export const NAVER_MAX_DISPLAY = 100
export const NAVER_MAX_START = 1000

/** @typedef {import('./rss.mjs').RawRecord} RawRecord */
/** @typedef {{mode: 'hub'|'legacy', keyId: string, key: string}} NaverConfig */

/**
 * The NAVER configuration from the environment, or why there is none.
 * @param {(name: string) => string|undefined|null} getEnv
 * @returns {{ok: true, config: NaverConfig} | {ok: false, reason: string}}
 */
export function naverConfig(getEnv) {
  const keyId = String(getEnv('NAVER_API_KEY_ID') || '').trim()
  const key = String(getEnv('NAVER_API_KEY') || '').trim()
  const raw = String(getEnv('NAVER_API_MODE') || 'hub').trim().toLowerCase()
  if (!keyId || !key) return { ok: false, reason: 'naver_keys_not_set' }
  if (raw !== 'hub' && raw !== 'legacy') return { ok: false, reason: 'naver_mode_invalid' }
  return { ok: true, config: { mode: raw, keyId, key } }
}

/**
 * URL and headers of one search page.
 * @param {'news'|'blog'} kind @param {{query: string, start?: number, display?: number, sort?: 'date'|'sim'}} q
 * @param {NaverConfig} config @param {number} now
 */
export function naverRequest(kind, { query, start = 1, display = NAVER_MAX_DISPLAY, sort = 'date' }, config, now) {
  if (kind !== 'news' && kind !== 'blog') throw new Error('naver: unknown search kind ' + kind)
  if (config.mode === 'legacy' && now >= NAVER_LEGACY_CUTOFF_MS) {
    throw new Error(`naver_legacy_expired: developers.naver.com search keys work only until ${NAVER_LEGACY_LAST_DAY}; switch NAVER_API_MODE to hub with API HUB keys`)
  }
  const params = new URLSearchParams({
    query: String(query),
    display: String(Math.max(1, Math.min(NAVER_MAX_DISPLAY, Math.floor(display)))),
    start: String(Math.max(1, Math.min(NAVER_MAX_START, Math.floor(start)))),
    sort,
  })
  if (config.mode === 'legacy') {
    return { url: `${NAVER_LEGACY_BASE}${kind}.json?${params}`, headers: { 'X-Naver-Client-Id': config.keyId, 'X-Naver-Client-Secret': config.key, accept: 'application/json' } }
  }
  return { url: `${NAVER_HUB_BASE}${kind}?${params}`, headers: { 'X-NCP-APIGW-API-KEY-ID': config.keyId, 'X-NCP-APIGW-API-KEY': config.key, accept: 'application/json' } }
}

/** NAVER's highlighted text → plain text (<b> marks and entities removed). @param {unknown} value */
export const stripNaverMarkup = (value) => stripHtml(value)

/** "20261015" (blog postdate, a KST date) → ISO. @param {unknown} value */
function postdate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(value || ''))
  if (!m) return null
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}
/** RFC 822 pubDate ("Wed, 15 Oct 2026 09:30:00 +0900") → ISO. @param {unknown} value */
function pubDate(value) {
  const t = Date.parse(String(value || ''))
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/**
 * @param {unknown} json @param {'news'|'blog'} kind
 * @returns {{total: number, start: number, display: number, records: RawRecord[]}}
 */
export function parseNaver(json, kind) {
  const body = /** @type {any} */ (json)
  if (!body || typeof body !== 'object' || !Array.isArray(body.items)) {
    const message = body?.errorMessage || body?.error?.message || body?.message
    throw new Error('naver: unexpected answer' + (message ? ': ' + String(message).slice(0, 200) : ''))
  }
  /** @type {RawRecord[]} */
  const records = []
  for (const it of body.items) {
    if (!it || typeof it !== 'object') continue
    if (kind === 'news') {
      // originallink is the publisher's article; link is NAVER's copy (n.news.naver.com) when NAVER hosts one.
      const url = String(it.originallink || it.link || '')
      if (!/^https?:\/\//i.test(url)) continue
      let publisher = null
      try { publisher = new URL(url).hostname.replace(/^www\./, '') } catch { /* no host */ }
      records.push({
        provider: 'naver_news', external_id: it.link ? String(it.link) : null, url,
        title: stripNaverMarkup(it.title), excerpt: stripNaverMarkup(it.description) || null, publisher, language: 'ko',
        published_at: pubDate(it.pubDate),
        raw: { link: it.link ?? null, originallink: it.originallink ?? null, pubDate: it.pubDate ?? null },
      })
    } else {
      const url = String(it.link || '')
      if (!/^https?:\/\//i.test(url)) continue
      records.push({
        provider: 'naver_blog', external_id: url, url,
        title: stripNaverMarkup(it.title), excerpt: stripNaverMarkup(it.description) || null,
        publisher: it.bloggername ? stripNaverMarkup(it.bloggername) : null, language: 'ko',
        published_at: postdate(it.postdate),
        raw: { bloggername: it.bloggername ?? null, bloggerlink: it.bloggerlink ?? null, postdate: it.postdate ?? null },
      })
    }
  }
  return { total: Number(body.total) || 0, start: Number(body.start) || 1, display: Number(body.display) || records.length, records }
}
