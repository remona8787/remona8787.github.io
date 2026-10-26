// Seoul cultural events (서울 열린데이터광장 OA-15486 "culturalEventInfo", 공공누리 제1유형; docs/PUBLIC_DATA.md 2-2).
//
//  - Key: the GitHub secret SEOUL_OPEN_DATA_KEY (the same name as the Supabase function's). The key is part of the URL
//    path (http://openapi.seoul.go.kr:8088/{KEY}/json/culturalEventInfo/{start}/{end}/), so requests never follow a
//    redirect (it would carry the key to another address) and every log line goes through redactKeys.
//  - Without a key: one probe with the portal's documented sample key ("sample", at most 5 rows) records whether the
//    service answers from GitHub Actions and the real field names (review/seoul-events.json). Nothing from the probe is
//    ever published.
//  - Relevance: an event is kept only when its title, programme or place names media art, a media facade, projection,
//    mapping, light, lighting, LED, digital, immersive (…) and the archive's classifier agrees (as for TourAPI). Other
//    events are never registered.
//  - Output: events (kind exhibition or event, start and end dates, status from the dates) linked to an existing
//    project by name within 300 m (lib/run.mjs), else a place candidate in admin-data/candidates.json that an editor
//    must approve. Field names are read as the documented ones (GUNAME, TITLE, CODENAME, DATE, PLACE, ORG_NAME,
//    USE_TRGT, USE_FEE, PLAYER, PROGRAM, ORG_LINK, HMPG_ADDR, MAIN_IMG, STRTDATE, END_DATE, LAT, LOT, IS_FREE); the
//    probe lists the live ones so the mapping can be checked against a real answer.
import { classify } from '../../edge-functions/_shared/archive/classify.mjs'
import { HOUR } from './cache.mjs'
import { fnv1a, redactKeys, uniq, validLat, validLng, haversine, fold } from './util.mjs'
import { projectNames } from './identity.mjs'

export const SEOUL_BASE = 'http://openapi.seoul.go.kr:8088'
export const SAMPLE_KEY = 'sample'
export const DATASET = { id: 'OA-15486', service: 'culturalEventInfo', license: 'KOGL Type 1', license_url: 'https://www.kogl.or.kr/info/licenseType1.do', page: 'https://data.seoul.go.kr/dataList/OA-15486/S/1/datasetView.do', publisher: '서울특별시 (서울 열린데이터광장)' }
/** Words that make an event a candidate (title, programme or place); the classifier must agree. */
export const MEDIA_TERMS = /미디어\s?아트|미디어\s?파사드|프로젝션|맵핑|매핑|빛|라이트|조명|LED|디지털|실감|몰입/gi
// Strong words: alone (with the classifier) they make a media-art event; the weak ones (빛, 라이트, 조명, 디지털)
// need a strong one or the classifier's own media verdict.
const STRONG = /미디어\s?아트|미디어\s?파사드|프로젝션|맵핑|매핑|LED|실감|몰입/i

export const seoulUrl = (key, start, end, { base = SEOUL_BASE, service = DATASET.service } = {}) => `${base}/${encodeURIComponent(key)}/json/${service}/${start}/${end}/`

/** {code, message, total, rows} of an answer (the service object, or a top-level RESULT on errors). */
export function parseAnswer(json, service = DATASET.service) {
  const body = json?.[service]
  const result = body?.RESULT || json?.RESULT || null
  return {
    code: result?.CODE ?? null, message: result?.MESSAGE ?? null,
    total: Number.isFinite(Number(body?.list_total_count)) ? Number(body.list_total_count) : null,
    rows: Array.isArray(body?.row) ? body.row : [],
  }
}

const day = (v) => { const m = /(\d{4})-(\d{2})-(\d{2})/.exec(String(v || '')); return m ? `${m[1]}-${m[2]}-${m[3]}` : null }
const httpUrl = (v) => { const s = String(v || '').trim(); return /^https?:\/\/[^\s]+$/i.test(s) ? s : null }
const text = (v, n = 300) => { const s = String(v ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, n) : null }

/** Coordinates of a row: whichever of LAT/LOT lies in Korea's latitude range is the latitude (the fields are known to be swapped in some answers). */
export function coordsOf(row) {
  const a = Number(row?.LAT), b = Number(row?.LOT)
  if (!Number.isFinite(a) || !Number.isFinite(b) || (!a && !b)) return { lat: null, lng: null, swapped: false }
  const isLat = (x) => x >= 33 && x <= 39, isLng = (x) => x >= 124 && x <= 132
  if (isLat(a) && isLng(b)) return { lat: a, lng: b, swapped: false }
  if (isLat(b) && isLng(a)) return { lat: b, lng: a, swapped: true }
  return { lat: null, lng: null, swapped: false }
}

/** Status of an event from its dates (today: YYYY-MM-DD): upcoming, running, ended or unknown. */
export function eventStatus(start, end, today) {
  if (!start && !end) return 'unknown'
  if (end && end < today) return 'ended'
  if (start && start > today) return 'upcoming'
  return start || end ? 'running' : 'unknown'
}

/** A row as an event (the source's fields kept under source_fields for the review). */
export function eventOf(row, today) {
  const c = coordsOf(row)
  const start = day(row.STRTDATE) || day(String(row.DATE || '').split('~')[0])
  const end = day(row.END_DATE) || day(String(row.DATE || '').split('~')[1])
  const codename = text(row.CODENAME, 40)
  const kind = /전시|미술/.test(codename || '') ? 'exhibition' : 'event'
  const title = text(row.TITLE, 200)
  return {
    id: 'SEV-' + fnv1a([title, start, text(row.PLACE, 120)].join('|')).toString(36).toUpperCase().padStart(7, '0'),
    kind, title, category: codename, district: text(row.GUNAME, 20), place: text(row.PLACE, 120), org: text(row.ORG_NAME, 120),
    program: text(row.PROGRAM, 400), player: text(row.PLAYER, 200), target: text(row.USE_TRGT, 120), fee: text(row.USE_FEE, 120),
    is_free: /무료/.test(String(row.IS_FREE || '')) ? true : /유료/.test(String(row.IS_FREE || '')) ? false : null,
    url: httpUrl(row.ORG_LINK) || httpUrl(row.HMPG_ADDR), start, end, date_text: text(row.DATE, 60), status: eventStatus(start, end, today),
    lat: validLat(c.lat) ? c.lat : null, lng: validLng(c.lng) ? c.lng : null, coords_swapped: c.swapped,
  }
}

/** Relevance of an event: {relevant, terms, reasons, project_type, classification}. */
export function classifyEvent(ev) {
  const where = { title: ev.title || '', program: ev.program || '', place: ev.place || '' }
  const terms = uniq(Object.values(where).flatMap((t) => (t.match(MEDIA_TERMS) || []).map((x) => x.replace(/\s+/g, ' '))))
  const reasons = Object.entries(where).filter(([, t]) => new RegExp(MEDIA_TERMS.source, 'i').test(t)).map(([k]) => 'term_in_' + k)
  if (!terms.length) return { relevant: false, terms, reasons: ['no_media_term'] }
  const c = classify({ title: ev.title || '', excerpt: [ev.program, ev.place, ev.category].filter(Boolean).join(' · '), language: 'ko' })
  reasons.push(`classifier:${c.label}:${c.score}`)
  const strongTerms = uniq(terms.filter((t) => STRONG.test(t)).map((t) => t.replace(/\s+/g, '').toLowerCase()))
  const strong = strongTerms.length > 0
  // The classifier was trained on facades and festivals: an exhibition named by two strong terms (몰입형 미디어아트,
  // 실감 미디어) is enough when the classifier finds nothing against it.
  const negative = c.reasons.some((r) => /^-\d+ /.test(r))
  const agrees = c.label === 'facade_project' || c.label === 'event_program' || (strong && c.label === 'uncertain' && !negative && (c.score >= 35 || strongTerms.length >= 2))
  if (!agrees) return { relevant: false, terms, reasons: [...reasons, 'classifier_disagrees'], classification: c.label }
  if (!strong && c.label !== 'facade_project') return { relevant: false, terms, reasons: [...reasons, 'only_weak_terms'], classification: c.label }
  const type = /파사드|LED/i.test(terms.join(' ')) ? 'media_facade' : /프로젝션|맵핑|매핑/.test(terms.join(' ')) ? 'projection_mapping' : ev.kind === 'exhibition' ? 'media_architecture' : 'festival_program'
  return { relevant: true, terms, reasons, project_type: type, classification: c.label }
}

/**
 * The connector. Returns {status, probe, requested, received, total, fields, events (every event with its decision),
 * relevant, errors, partial}.
 * @param {any} client @param {any} cfg pipeline.json "seoul_events" @param {{key?: string|null, cache?: any, ttlHours?: number, today: string}} o
 */
export async function discoverSeoulEvents(client, cfg = {}, { key = null, cache = null, ttlHours = 20, today }) {
  const out = { status: 'ok', probe: !key, requested: 0, received: 0, total: null, fields: [], events: [], relevant: [], errors: [], partial: false }
  const ask = async (k, start, end) => {
    out.requested++
    const json = await client.json(seoulUrl(k, start, end, { base: cfg.base || SEOUL_BASE, service: cfg.service || DATASET.service }), { stage: 'seoul_events', maxRedirects: 0, redactUrl: redactKeys, timeoutMs: 30000, retries: 1, cache: cache && k !== SAMPLE_KEY ? { ns: 'seoul-events', key: `${start}-${end}`, ttlMs: ttlHours * HOUR } : null })
    return parseAnswer(json, cfg.service || DATASET.service)
  }
  try {
    if (!key) {
      if (cfg.probe === false) return { ...out, status: 'skipped' }
      // Reachability and the live field names only (the sample key answers at most 5 rows).
      const a = await ask(SAMPLE_KEY, 1, 5)
      out.status = 'skipped'
      out.probe_result = { code: a.code, message: text(a.message, 200), total: a.total, rows: a.rows.length }
      out.fields = Object.keys(a.rows[0] || {}).sort()
      out.received = a.rows.length
      for (const row of a.rows) { const ev = eventOf(row, today); out.events.push({ ...ev, decision: classifyEvent(ev), probe: true }) }
      return out
    }
    const page = Math.min(1000, cfg.page_rows ?? 1000), max = cfg.max_rows ?? 6000
    for (let start = 1; start <= max; start += page) {
      const end = Math.min(start + page - 1, max)
      const a = await ask(key, start, end)
      if (a.code && !/^INFO-000$/.test(a.code)) {
        if (a.code === 'INFO-200') break // no (more) data
        out.errors.push({ code: a.code, message: text(a.message, 200), rows: `${start}-${end}` })
        break
      }
      out.total = a.total
      if (start === 1) out.fields = Object.keys(a.rows[0] || {}).sort()
      out.received += a.rows.length
      for (const row of a.rows) {
        const ev = eventOf(row, today)
        const decision = classifyEvent(ev)
        out.events.push({ ...ev, decision })
        if (decision.relevant && ev.status !== 'ended') out.relevant.push({ ...ev, project_type: decision.project_type, terms: decision.terms })
      }
      if (a.total !== null && end >= a.total) break
      if (a.rows.length < end - start + 1) break
    }
  } catch (e) {
    if (e?.code === 'budget') { out.partial = true; out.status = 'partial'; return out }
    out.errors.push({ message: redactKeys(String(e?.message || e)).slice(0, 300) })
  }
  // Without a key the source is skipped whatever the probe found (a failed probe is reported, not a source failure).
  out.status = !key ? 'skipped' : out.partial ? 'partial' : out.errors.length ? (out.received ? 'partial' : 'error') : 'ok'
  return out
}

const compact = (s) => fold(String(s || '')).replace(/[^\p{L}\p{N}]+/gu, '')
/**
 * Links events to published projects: the event's place or title names the project (one of its names, at least 3
 * Hangul or 6 Latin characters), and the two lie within radiusM when both have coordinates; without coordinates the
 * event's district must be the project's. Returns {linked: [{event, project, distance_m, by}], unlinked: [event]}.
 */
export function linkEvents(events, projects, { radiusM = 300 } = {}) {
  const named = projects.filter((p) => p.country_iso2 === 'KR').map((p) => ({ p, names: projectNames(p).map(compact).filter((n) => n.length >= (/[\p{Script=Hangul}]/u.test(n) ? 3 : 6)) }))
  const linked = [], unlinked = []
  for (const ev of events) {
    const hay = compact([ev.place, ev.title].filter(Boolean).join(' '))
    let best = null
    for (const { p, names } of named) {
      const name = names.filter((n) => hay.includes(n)).sort((a, b) => b.length - a.length)[0]
      if (!name) continue
      const both = validLat(ev.lat) && validLat(p.latitude)
      const d = both ? Math.round(haversine({ lat: ev.lat, lng: ev.lng }, { lat: p.latitude, lng: p.longitude })) : null
      const sameDistrict = !!ev.district && !!p.district && String(p.district).split(/[/·,]/).some((x) => x.trim() && (x.trim() === ev.district || ev.district.includes(x.trim())))
      if (both ? d > radiusM : !sameDistrict) continue
      const score = name.length * 10 - (d ?? radiusM)
      if (!best || score > best.score) best = { event: ev, project: p, distance_m: d, by: both ? 'name_within_' + radiusM + 'm' : 'name_and_district', name, score }
    }
    if (best) { delete best.score; linked.push(best) } else unlinked.push(ev)
  }
  return { linked, unlinked }
}

/** The public form of an event in its place's record (shard records only). */
export function eventOut(ev, { checkedAt }) {
  return {
    id: ev.id, kind: ev.kind, title: ev.title, start: ev.start, end: ev.end, status: ev.status, date_text: ev.date_text,
    place: ev.place, district: ev.district, org: ev.org, program: ev.program, is_free: ev.is_free, fee: ev.fee, url: /^https:\/\//i.test(ev.url || '') ? ev.url : null,
    project_type: ev.project_type ?? null,
    source: { provider: 'seoul_open_data', dataset: DATASET.id, license: DATASET.license, license_url: DATASET.license_url, url: DATASET.page, publisher: DATASET.publisher },
    checked_at: checkedAt,
  }
}
