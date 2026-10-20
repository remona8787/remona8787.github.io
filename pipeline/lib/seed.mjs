// The curated seed places (site-public-cleared/assets/seed.js, editor reviewed): they are part of the dataset and
// merge with collected items by their QID. Only what the seed states is used; nothing is inferred beyond the
// project type of its broad category (marked as derived in the record's field_sources).
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { sourceKindFor } from '../../edge-functions/_shared/archive/reliability.mjs'
import { isQid } from './util.mjs'

const CATEGORY_TYPE = { 'Media Facade': 'media_facade', 'Light Art': 'light_art', Immersive: 'media_architecture', Architecture: 'media_architecture', Festival: 'festival_program' }
const OPERATING = { seasonal_program: 'seasonal', permanent: 'operating', event: 'event_based', ended: 'ended' }

export async function loadSeed(file) {
  const ctx = { window: {} }
  vm.runInNewContext(await readFile(file, 'utf8'), ctx, { timeout: 2000 })
  const seed = ctx.window.AOL_SEED
  if (!seed || !Array.isArray(seed.places)) throw Error('seed.js has no AOL_SEED.places')
  return seed
}

const https = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null)
const date = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : null)

/** Visit facts the seed states (programme, period, hours). */
export function seedVisit(p, today) {
  const start = date(p.program_start), end = date(p.program_end)
  const hours = p.current_hours_verified || p.typical_hours || null
  const programme = p.current_program || null
  if (!start && !end && !hours && !programme && !p.operational_mode) return null
  const ended = end && today && end < today
  return {
    status: ended ? 'unknown' : OPERATING[p.operational_mode] || (p.permanent ? 'operating' : 'unknown'),
    note: ended ? null : programme,
    period: ended ? null : (start || end ? { start, end } : null),
    hours: hours || null,
  }
}

/** Seed places → observations. */
export function seedObservations(seed, { today = null } = {}) {
  const city = seed.meta?.city || null
  const out = []
  for (const p of seed.places) {
    if (!p?.place_id || p.is_published === false) continue
    const type = p.project_type || CATEGORY_TYPE[p.primary_category] || (/(미디어\s?월|media wall)/i.test(`${p.name_kr} ${p.name_en}`) ? 'media_wall' : 'other')
    const sources = []
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return null } }
    const kindOf = (u) => {
      if (https(p.website) && host(u) === host(p.website)) return 'official'
      const k = sourceKindFor(u, 'curated')
      return k === 'search_result' ? 'reference' : k
    }
    const add = (id, url, title, publisher) => { const u = https(url); if (u && !sources.some((s) => s.url === u)) sources.push({ id, kind: kindOf(u), title: title || null, url: u, publisher: publisher || null }) }
    add('curated:source', p.source_url, p.source_publisher, p.source_publisher)
    add('curated:check1', p.verification_source_1, null, null)
    add('curated:check2', p.verification_source_2, null, null)
    const official = https(p.website)
    out.push({
      origin: 'curated',
      curated_id: p.place_id,
      qid: isQid(p.wikidata) ? p.wikidata : null,
      qid_match: p.wikidata_match === 'host' ? 'host' : isQid(p.wikidata) ? 'exact' : null,
      category: null,
      name: { ko: p.name_kr || null, en: p.name_en || null, original: p.name_kr || null, original_lang: 'ko' },
      country_iso2: p.country_iso2 || 'KR',
      city: city === 'Seoul' ? 'Seoul' : city,
      city_ko: city === 'Seoul' ? '서울' : null,
      district: p.district || null,
      address: p.address || null,
      lat: typeof p.latitude === 'number' ? p.latitude : null,
      lng: typeof p.longitude === 'number' ? p.longitude : null,
      official_url: official,
      project_type: type,
      type_source: p.project_type ? 'curated' : 'curated_category',
      type_low_confidence: !p.project_type && type === 'other',
      description_ko: p.description || p.short_description || null,
      visit: seedVisit(p, today),
      sources,
      evidence: [{ kind: 'curated', id: p.place_id }],
      image_categories: [],
    })
  }
  return out
}
