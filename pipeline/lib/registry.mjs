// The research registry (v0.26, docs/DATA_EXPANSION.md): records an editor researched from official sources — the
// regional festivals, venues and works that no open dataset lists yet — and the editions (dates) of recurring events.
// Files: editorial/registry/*.json, each {schema: 1, records: [...]}. A record is published only when it validates and
// its confidence is A (an official or public-agency source) or B (two independent sources); C waits in the review
// queue. Nothing is inferred: a missing English name, coordinate or date stays missing; an edition without both dates
// is "dates to be confirmed"; an edition's status comes from its dates in the place's own time zone, or from a
// cancellation or postponement that a source states.
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'

export const RECORD_KINDS = ['festival', 'exhibition', 'facility', 'program', 'work']
export const KINDS_TO_RECORD = { festival: 'festival', exhibition: 'exhibition', facility: 'facility', program: 'program', work: 'facility' }
export const CONFIDENCE = ['A', 'B', 'C', 'D']
export const OFFICIAL_KINDS = new Set(['official', 'public_agency'])
export const SOURCE_KINDS = new Set(['official', 'public_agency', 'academic', 'specialist_media', 'news', 'reference'])
export const EDITION_STATES = ['upcoming', 'ongoing', 'ended', 'cancelled', 'postponed', 'unconfirmed']

/** The 17 first-level divisions of South Korea the survey covers (ISO 3166-2), with the 8 archive regions they fall in. */
export const KR_DIVISIONS = [
  { key: 'seoul', iso: 'KR-11', ko: '서울특별시', en: 'Seoul', region: 'seoul', names: ['서울특별시', '서울시', '서울'] },
  { key: 'busan', iso: 'KR-26', ko: '부산광역시', en: 'Busan', region: 'busan_ulsan_gyeongnam', names: ['부산광역시', '부산시', '부산'] },
  { key: 'daegu', iso: 'KR-27', ko: '대구광역시', en: 'Daegu', region: 'daegu_gyeongbuk', names: ['대구광역시', '대구시', '대구'] },
  { key: 'incheon', iso: 'KR-28', ko: '인천광역시', en: 'Incheon', region: 'gyeonggi_incheon', names: ['인천광역시', '인천시', '인천'] },
  { key: 'gwangju', iso: 'KR-29', ko: '광주광역시', en: 'Gwangju', region: 'gwangju_jeolla', names: ['광주광역시'] },
  { key: 'daejeon', iso: 'KR-30', ko: '대전광역시', en: 'Daejeon', region: 'daejeon_sejong_chungcheong', names: ['대전광역시', '대전시', '대전'] },
  { key: 'ulsan', iso: 'KR-31', ko: '울산광역시', en: 'Ulsan', region: 'busan_ulsan_gyeongnam', names: ['울산광역시', '울산시', '울산'] },
  { key: 'sejong', iso: 'KR-50', ko: '세종특별자치시', en: 'Sejong', region: 'daejeon_sejong_chungcheong', names: ['세종특별자치시', '세종시', '세종'] },
  { key: 'gyeonggi', iso: 'KR-41', ko: '경기도', en: 'Gyeonggi', region: 'gyeonggi_incheon', names: ['경기도', '경기'] },
  { key: 'gangwon', iso: 'KR-51', ko: '강원특별자치도', en: 'Gangwon', region: 'gangwon', names: ['강원특별자치도', '강원도', '강원'] },
  { key: 'chungbuk', iso: 'KR-43', ko: '충청북도', en: 'North Chungcheong', region: 'daejeon_sejong_chungcheong', names: ['충청북도', '충북'] },
  { key: 'chungnam', iso: 'KR-44', ko: '충청남도', en: 'South Chungcheong', region: 'daejeon_sejong_chungcheong', names: ['충청남도', '충남'] },
  { key: 'jeonbuk', iso: 'KR-52', ko: '전북특별자치도', en: 'North Jeolla', region: 'gwangju_jeolla', names: ['전북특별자치도', '전라북도', '전북'] },
  { key: 'jeonnam', iso: 'KR-46', ko: '전라남도', en: 'South Jeolla', region: 'gwangju_jeolla', names: ['전라남도', '전남'] },
  { key: 'gyeongbuk', iso: 'KR-47', ko: '경상북도', en: 'North Gyeongsang', region: 'daegu_gyeongbuk', names: ['경상북도', '경북'] },
  { key: 'gyeongnam', iso: 'KR-48', ko: '경상남도', en: 'South Gyeongsang', region: 'busan_ulsan_gyeongnam', names: ['경상남도', '경남'] },
  { key: 'jeju', iso: 'KR-49', ko: '제주특별자치도', en: 'Jeju', region: 'jeju', names: ['제주특별자치도', '제주도', '제주'] },
]
export const KR_DIVISION_KEYS = KR_DIVISIONS.map((d) => d.key)
const DIVISION = new Map(KR_DIVISIONS.map((d) => [d.key, d]))
const NAME_TO_DIVISION = new Map(KR_DIVISIONS.flatMap((d) => d.names.map((n) => [n, d.key])))

/**
 * The first-level division a Korean address or place name begins with (its first token), or null. The merged
 * 전남광주특별시 (2026-07) names two survey units, so it decides nothing alone.
 */
export function divisionOfText(...texts) {
  const found = new Set()
  for (const t of texts) {
    const first = String(t || '').trim().split(/\s+/)[0] || ''
    if (NAME_TO_DIVISION.has(first)) found.add(NAME_TO_DIVISION.get(first))
  }
  return found.size === 1 ? [...found][0] : null
}

/** Today in an IANA time zone (YYYY-MM-DD). */
export function localDay(now, timeZone = 'Asia/Seoul') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now))
  const get = (t) => parts.find((p) => p.type === t)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const validDay = (d) => ISO_DAY.test(String(d || '')) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'))
const https = (u) => /^https:\/\/[^\s]+$/i.test(String(u || ''))

/** An edition's status on a local day: a stated cancellation or postponement wins; else its dates; else unconfirmed. */
export function editionStatus(e, today) {
  if (e.state === 'cancelled' || e.state === 'postponed') return e.state
  if (!validDay(e.start) || !validDay(e.end)) return 'unconfirmed'
  if (today < e.start) return 'upcoming'
  if (today > e.end) return 'ended'
  return 'ongoing'
}

/** Every problem of one record (empty when it is valid). */
export function validateRecord(r, { types }) {
  const bad = []
  const need = (ok, what) => { if (!ok) bad.push(what) }
  need(/^REG-[A-Z]{2}-\d{4}$/.test(r.id || ''), 'id REG-<CC>-<4 digits>')
  need(RECORD_KINDS.includes(r.kind), 'kind ' + RECORD_KINDS.join('|'))
  need(types.includes(r.project_type), 'project_type')
  need(!!(r.name_ko || r.name_en || r.name_original), 'a name')
  need(/^[A-Z]{2}$/.test(r.country_iso2 || ''), 'country_iso2')
  if (r.country_iso2 === 'KR') need(KR_DIVISION_KEYS.includes(r.kr_division), 'kr_division (17 divisions)')
  need(!!(r.city || r.city_ko), 'city or city_ko')
  need(CONFIDENCE.includes(r.confidence), 'confidence A|B|C|D')
  need(Array.isArray(r.sources) && r.sources.length > 0, 'sources')
  for (const s of r.sources || []) {
    need(https(s.url), 'source url https')
    need(SOURCE_KINDS.has(s.kind), 'source kind')
    need(validDay(s.checked_at), 'source checked_at')
  }
  const official = (r.sources || []).filter((s) => OFFICIAL_KINDS.has(s.kind)).length
  const hosts = new Set((r.sources || []).map((s) => { try { return new URL(s.url).hostname.replace(/^www\./, '') } catch { return null } }).filter(Boolean))
  if (r.confidence === 'A') need(official >= 1, 'confidence A needs an official or public-agency source')
  if (r.confidence === 'B') need(hosts.size >= 2, 'confidence B needs two independent sources')
  need(r.official_url == null || https(r.official_url), 'official_url https or null')
  for (const k of ['lat', 'lng']) need(r[k] == null || (typeof r[k] === 'number' && Number.isFinite(r[k])), k)
  need((r.lat == null) === (r.lng == null), 'lat and lng together')
  need(!r.timezone || (() => { try { new Intl.DateTimeFormat('en', { timeZone: r.timezone }); return true } catch { return false } })(), 'timezone (IANA)')
  need(r.admission == null || ['free', 'paid', 'mixed'].includes(r.admission), 'admission free|paid|mixed|null')
  const editions = r.editions || []
  need(Array.isArray(editions), 'editions array')
  const ids = new Set()
  for (const e of editions) {
    need(/^[0-9A-Za-z-]{1,24}$/.test(e.id || '') && !ids.has(e.id), 'edition id unique')
    ids.add(e.id)
    need(e.start == null || validDay(e.start), 'edition start YYYY-MM-DD')
    need(e.end == null || validDay(e.end), 'edition end YYYY-MM-DD')
    need(!(validDay(e.start) && validDay(e.end)) || e.start <= e.end, 'edition start <= end')
    need(https(e.source), 'edition source https')
    need(validDay(e.checked_at), 'edition checked_at')
    need(e.state == null || ['cancelled', 'postponed'].includes(e.state), 'edition state cancelled|postponed|null')
    need(e.admission == null || ['free', 'paid', 'mixed'].includes(e.admission), 'edition admission')
  }
  return bad
}

/** Loads every registry file; returns {records, problems, files}. */
export async function loadRegistry(dir, { types }) {
  const out = { records: [], problems: [], files: [] }
  if (!dir || !existsSync(dir)) return out
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort()
  const seen = new Set()
  for (const f of files) {
    const json = JSON.parse(await readFile(path.join(dir, f), 'utf8'))
    out.files.push({ file: f, records: (json.records || []).length })
    for (const r of json.records || []) {
      const bad = validateRecord(r, { types })
      if (seen.has(r.id)) bad.push('duplicate id')
      seen.add(r.id)
      if (bad.length) out.problems.push({ file: f, id: r.id || null, problems: bad })
      else out.records.push({ ...r, _file: f })
    }
  }
  return out
}

/** The edition a record shows: the ongoing one, else the next upcoming, else the latest ended; null without editions. */
export function currentEdition(r, today) {
  const eds = (r.editions || []).map((e) => ({ ...e, status: editionStatus(e, today) }))
  if (!eds.length) return null
  const by = (s) => eds.filter((e) => e.status === s)
  const ongoing = by('ongoing').sort((a, b) => a.start.localeCompare(b.start))[0]
  if (ongoing) return ongoing
  const upcoming = by('upcoming').sort((a, b) => a.start.localeCompare(b.start))[0]
  if (upcoming) return upcoming
  const dated = eds.filter((e) => validDay(e.end)).sort((a, b) => b.end.localeCompare(a.end))
  return dated[0] || eds[0]
}

/** Record status vocabulary of the archive (running | seasonal | ended | upcoming | unknown) from an edition. */
export function recordStatus(r, ed) {
  if (!ed) return { status: 'unknown', status_source: null }
  if (ed.status === 'ongoing') return { status: 'running', status_source: 'curated' }
  if (ed.status === 'upcoming') return { status: 'upcoming', status_source: 'curated' }
  if (ed.status === 'ended') return r.recurrence === 'annual' ? { status: 'seasonal', status_source: 'curated' } : { status: 'ended', status_source: 'curated' }
  return { status: 'unknown', status_source: null }
}

/** Publishable registry records (A and B) → curated observations for the entity resolution. */
export function registryObservations(records, { now = Date.now() } = {}) {
  const out = []
  for (const r of records) {
    if (!['A', 'B'].includes(r.confidence)) continue
    const tz = r.timezone || (r.country_iso2 === 'KR' ? 'Asia/Seoul' : 'UTC')
    const today = localDay(now, tz)
    const ed = currentEdition(r, today)
    const st = recordStatus(r, ed)
    const div = r.country_iso2 === 'KR' ? DIVISION.get(r.kr_division) : null
    const sources = r.sources.map((s, i) => ({ id: i === 0 ? 'curated:source' : 'curated:check' + i, kind: s.kind, title: s.title || s.publisher || null, url: s.url, publisher: s.publisher || null }))
    out.push({
      origin: 'curated',
      registry: true,
      curated_id: r.id,
      qid: /^Q\d+$/.test(r.wikidata || '') ? r.wikidata : null,
      qid_match: /^Q\d+$/.test(r.wikidata || '') ? 'exact' : null,
      category: null,
      name: { ko: r.name_ko || null, en: r.name_en || null, original: r.name_original || r.name_ko || r.name_en || null, original_lang: r.name_original_lang || (r.country_iso2 === 'KR' ? 'ko' : null) },
      country_iso2: r.country_iso2,
      city: r.city || null,
      city_ko: r.city_ko || null,
      district: r.district || null,
      address: r.address || null,
      lat: typeof r.lat === 'number' ? r.lat : null,
      lng: typeof r.lng === 'number' ? r.lng : null,
      official_url: r.official_url || null,
      project_type: r.project_type,
      type_source: 'curated',
      type_low_confidence: false,
      description_ko: r.summary_ko || null,
      kr_region: div?.region || null,
      kr_division: div?.key || null,
      schedule: {
        kind: KINDS_TO_RECORD[r.kind],
        start_date: ed && validDay(ed.start) ? ed.start : null,
        end_date: ed && validDay(ed.end) ? ed.end : null,
        ...st,
      },
      visit: null,
      sources,
      evidence: [{ kind: 'curated', id: r.id, registry: r._file || true, confidence: r.confidence }],
      image_categories: [],
    })
  }
  return out
}

/**
 * The public events file (site-data/events.json): every recurring series and dated event of the registry with its
 * editions, each edition's status computed in its own time zone at build time (the app recomputes it from the dates).
 * project_id links a series to its archive record when that record is published.
 */
export function buildEvents(records, { now = Date.now(), published = new Set(), generatedAt, buildId }) {
  const series = []
  for (const r of records) {
    if (!['A', 'B'].includes(r.confidence) || !(r.editions || []).length) continue
    const tz = r.timezone || (r.country_iso2 === 'KR' ? 'Asia/Seoul' : 'UTC')
    const today = localDay(now, tz)
    series.push({
      id: r.id,
      project_id: published.has(r.id) ? r.id : null,
      kind: r.kind,
      project_type: r.project_type,
      name_ko: r.name_ko || null,
      name_en: r.name_en || null,
      name_original: r.name_original || null,
      country_iso2: r.country_iso2,
      kr_division: r.country_iso2 === 'KR' ? r.kr_division : null,
      city: r.city || null,
      city_ko: r.city_ko || null,
      timezone: tz,
      recurrence: r.recurrence || null,
      official_url: r.official_url || null,
      admission: r.admission ?? null,
      editions: r.editions.map((e) => ({
        id: e.id,
        title: e.title || null,
        start: validDay(e.start) ? e.start : null,
        end: validDay(e.end) ? e.end : null,
        hours: e.hours || null,
        venue: e.venue || null,
        admission: e.admission ?? r.admission ?? null,
        state: e.state || null,
        status: editionStatus(e, today),
        source: e.source,
        checked_at: e.checked_at,
      })).sort((a, b) => String(b.start || '').localeCompare(String(a.start || ''))),
    })
  }
  series.sort((a, b) => (a.id < b.id ? -1 : 1))
  const all = series.flatMap((s) => s.editions)
  const count = (st) => all.filter((e) => e.status === st).length
  return {
    schema: 1,
    build_id: buildId,
    generated_at: generatedAt,
    about: 'Festivals, exhibitions and programmes of the archive with their dated editions. Status per edition: from its dates in the event\'s own time zone (timezone), or a cancellation or postponement a source states; without both dates, unconfirmed. Ended editions stay as the archive of past events. A recurring event is one series with its editions, counted once among the projects.',
    counts: { series: series.length, editions: all.length, ongoing: count('ongoing'), upcoming: count('upcoming'), ended: count('ended'), cancelled: count('cancelled'), postponed: count('postponed'), unconfirmed: count('unconfirmed') },
    series,
  }
}
