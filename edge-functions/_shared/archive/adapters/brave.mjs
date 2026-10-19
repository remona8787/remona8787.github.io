// Brave Search API web search (docs/ARCHIVE_SPEC.md §2). Metered: about $5 per 1,000 requests with a $5 monthly
// credit, and a card is required even for the credit, so it is OFF unless BRAVE_API_KEY is set (and the rule is
// enabled by an admin). One request per run.
// GET https://api.search.brave.com/res/v1/web/search?q=…&count=20&freshness=pw with X-Subscription-Token.
// The answer's web.results[] carry title, url, description (with <strong> highlights), page_age, age, language,
// profile.name and meta_url.hostname.

import { stripHtml } from '../text.mjs'
import { languageCode } from '../normalize.mjs'

export const BRAVE_WEB_API = 'https://api.search.brave.com/res/v1/web/search'
export const BRAVE_MAX_COUNT = 20

/** @typedef {import('./rss.mjs').RawRecord} RawRecord */

/** The key, or null when Brave is not configured (the default: Brave is off). @param {(name: string) => string|undefined|null} getEnv */
export function braveKey(getEnv) {
  const key = String(getEnv('BRAVE_API_KEY') || '').trim()
  return key || null
}

/**
 * @param {string} query @param {string} key
 * @param {{count?: number, offset?: number, freshness?: string, searchLang?: string|null, country?: string|null}} [o]
 */
export function braveRequest(query, key, { count = BRAVE_MAX_COUNT, offset = 0, freshness = 'pw', searchLang = null, country = null } = {}) {
  const params = new URLSearchParams({ q: String(query), count: String(Math.max(1, Math.min(BRAVE_MAX_COUNT, Math.floor(count)))), offset: String(Math.max(0, Math.min(9, Math.floor(offset)))), freshness })
  if (searchLang) params.set('search_lang', searchLang)
  if (country) params.set('country', country)
  return { url: `${BRAVE_WEB_API}?${params}`, headers: { 'X-Subscription-Token': key, accept: 'application/json' } }
}

/** "2026-10-12T08:30:00" (no zone; taken as UTC) or ISO → ISO. @param {unknown} value */
function pageAge(value) {
  const s = String(value || '').trim()
  if (!s) return null
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + 'Z')
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/** @param {unknown} json @returns {RawRecord[]} */
export function parseBrave(json) {
  const body = /** @type {any} */ (json)
  if (!body || typeof body !== 'object') throw new Error('brave: unexpected answer')
  if (body.type === 'ErrorResponse' || body.error) throw new Error('brave: ' + String(body.error?.detail || body.error?.code || 'error').slice(0, 200))
  const results = Array.isArray(body.web?.results) ? body.web.results : []
  /** @type {RawRecord[]} */
  const out = []
  for (const r of results) {
    if (!r || typeof r.url !== 'string' || !/^https?:\/\//i.test(r.url) || !r.title) continue
    out.push({
      provider: 'brave', external_id: null, url: r.url, title: stripHtml(r.title), excerpt: stripHtml(r.description) || null,
      publisher: r.profile?.name ? stripHtml(r.profile.name) : r.meta_url?.hostname || null,
      language: languageCode(r.language), published_at: pageAge(r.page_age),
      raw: { hostname: r.meta_url?.hostname ?? null, page_age: r.page_age ?? null, age: r.age ?? null, language: r.language ?? null, subtype: r.subtype ?? null },
    })
  }
  return out
}
