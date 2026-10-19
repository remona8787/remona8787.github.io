// GDELT DOC 2.0 API adapter (https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/). Open, keyless, free; the
// archive cites GDELT as the source of these news pointers. Parameters used:
//   query=<keywords and operators>  phrases in double quotes, OR'd alternatives inside parentheses, operators such
//                                   as sourcelang:korean (the article's original language) appended with a space
//   mode=ArtList&format=json        a list of articles: url, url_mobile, title, seendate, socialimage, domain,
//                                   language, sourcecountry
//   maxrecords=250                  the API's maximum per request
//   timespan=6h|3d|3m …             rolling window back from now (the API covers about the last 3 months)
//   sort=DateDesc                   newest first
// GDELT matches queries against English machine translations of the 65 languages it monitors, which is why every
// seed group asks English phrases and filters with sourcelang (seed-rules.mjs). It answers malformed queries with
// a plain-text message (HTTP 200) instead of JSON; that becomes a parse error with the message. GDELT asks clients
// to send at most one request every 5 seconds (GDELT_INTERVAL_MS, enforced by the caller's rate limiter).

import { stripHtml } from '../text.mjs'
import { languageCode } from '../normalize.mjs'

export const GDELT_DOC_API = 'https://api.gdeltproject.org/api/v2/doc/doc'
export const GDELT_HOST = 'api.gdeltproject.org'
export const GDELT_INTERVAL_MS = 5000
export const GDELT_MAX_RECORDS = 250
// The window of a first run (no last_run_at): the whole rolling archive the API offers.
export const GDELT_FIRST_TIMESPAN = '3m'

/**
 * @typedef {import('./rss.mjs').RawRecord} RawRecord
 * @typedef {{url: string, url_mobile?: string, title: string, seendate: string, socialimage?: string, domain?: string, language?: string, sourcecountry?: string}} GdeltArticle
 */

/**
 * The timespan since the previous run, with 2 hours of overlap (the hourly scheduler may start a rule late), at least
 * 6 hours and at most 90 days; "3m" for a first run.
 * @param {string|null|undefined} lastRunAt @param {number} now
 */
export function gdeltTimespan(lastRunAt, now) {
  const last = Date.parse(String(lastRunAt || ''))
  if (!Number.isFinite(last)) return GDELT_FIRST_TIMESPAN
  const hours = Math.min(90 * 24, Math.max(6, Math.ceil((now - last) / 3600e3) + 2))
  return hours <= 72 ? `${hours}h` : `${Math.ceil(hours / 24)}d`
}

/** @param {string} query @param {{maxrecords?: number, timespan?: string, sort?: string}} [o] */
export function gdeltUrl(query, { maxrecords = GDELT_MAX_RECORDS, timespan = GDELT_FIRST_TIMESPAN, sort = 'DateDesc' } = {}) {
  const params = new URLSearchParams({
    query: String(query),
    mode: 'ArtList',
    format: 'json',
    maxrecords: String(Math.max(1, Math.min(GDELT_MAX_RECORDS, Math.floor(maxrecords)))),
    timespan,
    sort,
  })
  return `${GDELT_DOC_API}?${params}`
}

/** "20261015T083000Z" → "2026-10-15T08:30:00.000Z" (GDELT's seendate is UTC). @param {unknown} value */
export function parseSeenDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/.exec(String(value || '').trim())
  if (!m) return null
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/**
 * The body of an ArtList answer. An empty result is "{}" (no articles key); a refused query is plain text.
 * @param {string|null} text @returns {{articles: GdeltArticle[], error: string|null}}
 */
export function parseGdelt(text) {
  const body = String(text ?? '').trim()
  if (!body) return { articles: [], error: null }
  let json
  try { json = JSON.parse(body) } catch { return { articles: [], error: 'GDELT answered without JSON: ' + body.slice(0, 200) } }
  if (!json || typeof json !== 'object') return { articles: [], error: 'GDELT answered an unexpected JSON value' }
  const list = Array.isArray(json.articles) ? json.articles : []
  return { articles: list.filter((a) => a && typeof a.url === 'string' && typeof a.title === 'string'), error: null }
}

/** @param {GdeltArticle[]} articles @returns {RawRecord[]} */
export function gdeltRecords(articles) {
  return articles.map((a) => ({
    provider: /** @type {const} */ ('gdelt'),
    external_id: null,
    url: a.url,
    title: stripHtml(a.title),
    excerpt: null,
    publisher: a.domain ? String(a.domain) : null,
    language: languageCode(a.language),
    published_at: parseSeenDate(a.seendate),
    // API fields only. sourcecountry is the PUBLISHER's country, kept for the record, never used as the location.
    raw: { domain: a.domain ?? null, language: a.language ?? null, sourcecountry: a.sourcecountry ?? null, seendate: a.seendate ?? null },
  }))
}
