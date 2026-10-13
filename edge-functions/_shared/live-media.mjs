// Live place photo + info sync from Wikidata and Wikimedia Commons, with attribution.
// Shared by the browser (client/live-media.js, no backend needed) and the server (sync-place-media).
// Pure ESM with injected fetch so it runs unchanged in browsers, Deno and Node tests.
//
// Matching is deliberately strict. A curated place that carries an explicit, verified Wikidata QID in the seed data
// ("wikidata", with "wikidata_match": "host" when the item is the building the project is installed on) is linked
// to that item directly. Any other place is linked only when the item's Korean or English label/alias equals the
// place name exactly AND the item lies in Seoul (P131* Q8684), and only when that link is unambiguous. Free-text
// Commons search is never used here, so a photo of a different place cannot be published automatically.

export const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000
export const SEOUL_QID = 'Q8684'
export const WDQS_URL = 'https://query.wikidata.org/sparql'
export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'

// Commons templates that mean the file itself may be removed or is not freely licensed.
export const BLOCKING_TEMPLATES = [
  'Template:Delete', 'Template:Copyvio', 'Template:Speedydelete', 'Template:Speedy delete',
  'Template:No permission since', 'Template:No license since', 'Template:No source since',
  'Template:Dw no source since', 'Template:Npd', 'Template:Nsd', 'Template:Fair use',
]
// South Korea has freedom of panorama only for non-sale uses (Copyright Act Art. 35(2)), so Commons tags
// such photos. A free service that displays them does not sell copies; the operator can switch this off.
export const KR_FOP_TEMPLATES = ['Template:NoFoP-South Korea', 'Template:FoP-South Korea']
// Other countries' "no freedom of panorama" tags BLOCK automatic display: the photo may be free, but the building
// or artwork in it is not, and the Korean non-sale exception does not apply abroad. There is no fixed list of such
// tags: commonsInfoParams asks Commons for EVERY template a file transcludes (namespace 10, no tltemplates filter,
// continuation followed by fetchCommonsPages), and foreignNoFop() blocks any Template:NoFoP-* (or a subpage of one,
// e.g. ".../layout") other than South Korea's. Limits: only tags on the file page itself are seen (a tag placed only
// on a category is not), and a file whose template list could not be read completely is blocked, not guessed.
const MAX_COMMONS_ROUNDS = 40
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

export const DEFAULT_POLICY = { krFopDisplay: true, maxImagesPerPlace: 3 }

export function stripHtml(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim()
}

// "동대문디자인플라자(DDP) / 서울라이트" → ["동대문디자인플라자(DDP) / 서울라이트", "동대문디자인플라자(DDP)", "동대문디자인플라자", "서울라이트"]
export function nameVariants(name) {
  const base = String(name || '').normalize('NFC').trim()
  if (!base) return []
  const out = new Set([base])
  for (const part of base.split(/\s+[\/·|]\s+/)) {
    const p = part.trim()
    if (p.length >= 2) out.add(p)
    const noParen = p.replace(/\s*[(（][^)）]*[)）]\s*/g, ' ').replace(/\s+/g, ' ').trim()
    if (noParen.length >= 2) out.add(noParen)
  }
  return [...out]
}

// Projects installed on a building ("롯데월드타워 미디어파사드") → the host building's name ("롯데월드타워").
// A match through these is labelled as a photo of the host building, not of the project itself.
const HOST_SUFFIX = /\s*(미디어\s?파사드|미디어\s?월|미디어\s?캔버스|옥외\s?전광판|야간\s?조명|디지털 실감 영상관|Media Facade|Media Wall|Media Canvas|Outdoor Media Display|Digital Display|Night Lighting|Immersive Digital Gallery)$/i
export function hostVariants(name) {
  const out = new Set()
  for (const v of nameVariants(name)) {
    const host = v.replace(HOST_SUFFIX, '').trim()
    if (host !== v && host.length >= 2) for (const h of nameVariants(host)) out.add(h)
  }
  for (const v of nameVariants(name)) out.delete(v)
  return [...out]
}

const sparqlString = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ') + '"'

const QID = /^Q[1-9]\d*$/
/** @param {{wikidata?: string}} p @returns {string|null} the place's explicit, verified Wikidata QID (seed data) */
export const placeQid = p => QID.test(String(p?.wikidata || '')) ? String(p.wikidata) : null

// One query for every place: name matches restricted to Seoul, plus (UNION) the explicit QIDs of curated places,
// whose rows carry no ?name and bring the item's Korean label (used when the QID is the project's host building).
/** @param {{name_kr?: string, name_en?: string, wikidata?: string}[]} places */
export function buildPlaceQuery(places) {
  const values = []
  for (const p of places) {
    for (const n of [...nameVariants(p.name_kr), ...hostVariants(p.name_kr)]) values.push(`${sparqlString(n)}@ko`)
    for (const n of [...nameVariants(p.name_en), ...hostVariants(p.name_en)]) values.push(`${sparqlString(n)}@en`)
  }
  const qids = [...new Set(places.map(placeQid).filter(Boolean))]
  return `SELECT ?name ?item ?label ?image ?cat ?site ?coord WHERE {
  {
    VALUES ?name { ${[...new Set(values)].join(' ')} }
    ?item rdfs:label|skos:altLabel ?name .
    ?item wdt:P131* wd:${SEOUL_QID} .
  }${qids.length ? `
  UNION
  {
    VALUES ?item { ${qids.map(q => 'wd:' + q).join(' ')} }
    OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label) = "ko") }
  }` : ''}
  OPTIONAL { ?item wdt:P18 ?image }
  OPTIONAL { ?item wdt:P373 ?cat }
  OPTIONAL { ?item wdt:P856 ?site }
  OPTIONAL { ?item wdt:P625 ?coord }
}`
}

const qidOf = uri => (String(uri || '').match(/\/entity\/(Q\d+)$/) || [])[1] || null
export function fileFromFilePath(uri) {
  const m = String(uri || '').match(/Special:FilePath\/(.+)$/)
  if (!m) return null
  try { return decodeURIComponent(m[1]).replace(/_/g, ' ') } catch { return null }
}
function parsePoint(wkt) {
  const m = String(wkt || '').match(/^Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/)
  if (!m) return null
  const lon = Number(m[1]), lat = Number(m[2])
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
}

// Returns Map(place_id → {qid, images[], commonsCategory, website, coord, matchedName, matchKind}). A place with an
// explicit QID is matched to that item first ('host' when the seed marks the item as the host building); every other
// place by exact name, and ambiguous names are omitted.
/** @param {any} json @param {{place_id: string, name_kr?: string, name_en?: string, wikidata?: string, wikidata_match?: string}[]} places @returns {Map<string, {qid: string, images: string[], commonsCategory: string|null, website: string|null, coord: {lat: number, lon: number}|null, matchedName: string, matchKind: string}>} */
export function parsePlaceQuery(json, places) {
  const rows = json?.results?.bindings
  if (!Array.isArray(rows)) throw Error('invalid_wdqs_payload')
  const items = new Map(), byName = new Map(), direct = new Map()
  for (const r of rows) {
    const qid = qidOf(r.item?.value)
    if (!qid) continue
    const it = items.get(qid) || { qid, images: [], commonsCategory: null, website: null, coord: null }
    const file = fileFromFilePath(r.image?.value)
    if (file && !it.images.includes(file)) it.images.push(file)
    it.commonsCategory ||= r.cat?.value || null
    it.website ||= /^https?:\/\//.test(r.site?.value || '') ? r.site.value : null
    it.coord ||= parsePoint(r.coord?.value)
    items.set(qid, it)
    const name = r.name?.value
    if (!name) { if (!direct.has(qid) || r.label?.value) direct.set(qid, stripHtml(r.label?.value || '')); continue }
    const key = (r.name['xml:lang'] || '') + '|' + name
    if (!byName.has(key)) byName.set(key, new Set())
    byName.get(key).add(qid)
  }
  const out = new Map()
  for (const p of places) {
    const q = placeQid(p)
    if (q && direct.has(q)) {
      const host = p.wikidata_match === 'host'
      out.set(p.place_id, { ...items.get(q), matchedName: direct.get(q) || (host ? hostVariants(p.name_kr)[0] : '') || p.name_kr || q, matchKind: host ? 'host' : 'exact' })
      continue
    }
    // Most specific first: the project's own names (Korean, then English), then its host building.
    const keys = [
      ...nameVariants(p.name_kr).map(n => ['ko|' + n, 'exact']), ...nameVariants(p.name_en).map(n => ['en|' + n, 'exact']),
      ...hostVariants(p.name_kr).map(n => ['ko|' + n, 'host']), ...hostVariants(p.name_en).map(n => ['en|' + n, 'host']),
    ]
    for (const [key, matchKind] of keys) {
      const qids = byName.get(key)
      if (!qids) continue
      if (qids.size !== 1) break // same name, several Seoul items: do not guess
      const [qid] = qids
      out.set(p.place_id, { ...items.get(qid), matchedName: key.slice(3), matchKind })
      break
    }
  }
  return out
}

export function licenseAllowed(license) {
  const n = String(license || '').trim().toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ')
  return /^(cc by(?: sa)? (?:1\.0|2\.0|2\.5|3\.0|4\.0)(?: [a-z]{2})?|cc0(?: 1\.0)?|public domain|pd)$/.test(n)
}

// The tag a template page belongs to: "Template:NoFoP-South Korea/layout" → "Template:NoFoP-South Korea". The full
// template list includes what a tag transcludes itself (its /layout, its /en translation …), so subpages count as the tag.
const baseTemplate = t => String(t || '').replace(/\/.*$/, '')
/** @param {string[]} templates @returns {boolean} true when any template is a no-FoP tag of a country other than South Korea */
export function foreignNoFop(templates = []) {
  return templates.some(t => { const b = baseTemplate(t); return /^Template:NoFoP-/i.test(b) && !KR_FOP_TEMPLATES.includes(b) })
}

// Decide whether a Commons file may be shown automatically. Returns {ok, krFop, reasons}.
// templatesComplete: false when Commons did not return the file's whole template list (then nothing is assumed).
/** @param {{license?: string, mime?: string, templates?: string[], templatesComplete?: boolean}} file @param {{krFopDisplay: boolean}} [policy] */
export function assessRights({ license, mime, templates = [], templatesComplete = true }, policy = DEFAULT_POLICY) {
  const reasons = []
  if (!licenseAllowed(license)) reasons.push('license_not_allowed')
  if (mime && !ALLOWED_MIME.has(mime)) reasons.push('unsupported_type')
  const t = new Set(templates.map(baseTemplate))
  if (BLOCKING_TEMPLATES.some(x => t.has(x))) reasons.push('commons_deletion_or_permission_issue')
  const krFop = KR_FOP_TEMPLATES.some(x => t.has(x))
  if (krFop && !policy.krFopDisplay) reasons.push('kr_freedom_of_panorama_disabled')
  if (foreignNoFop(templates)) reasons.push('foreign_no_freedom_of_panorama')
  if (!templatesComplete) reasons.push('commons_templates_incomplete')
  return { ok: reasons.length === 0, krFop, reasons }
}

export function commonsInfoParams(files) {
  return new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*',
    prop: 'imageinfo|templates',
    iiprop: 'url|extmetadata|mime',
    iiurlwidth: '960',
    iiextmetadatafilter: 'Artist|Credit|LicenseShortName|LicenseUrl|UsageTerms|DateTimeOriginal',
    // Every template in the Template namespace (no tltemplates filter: that parameter means "only these names").
    tlnamespace: '10',
    tllimit: 'max',
    titles: files.map(f => 'File:' + f).join('|'),
  })
}

const normTitle = t => String(t || '').replace(/^File:/i, '').replace(/_/g, ' ').trim()

// Fetches Commons metadata for files in batches of 50, following continuation (a file transcludes dozens of
// templates, so the template list of a batch usually spans several responses). Returns Map(file → page); a page whose
// template list was still incomplete when the round limit was reached carries templatesComplete: false.
/** @param {string[]} files @param {(url: string, init?: RequestInit) => Promise<any>} fetchJSON */
export async function fetchCommonsPages(files, fetchJSON, { maxRounds = MAX_COMMONS_ROUNDS } = {}) {
  const pages = new Map()
  const unique = [...new Set(files.map(normTitle))]
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50)
    let cont = {}, done = false
    for (let round = 0; round < maxRounds; round++) {
      const params = commonsInfoParams(batch)
      for (const [k, v] of Object.entries(cont)) params.set(k, String(v))
      const json = await fetchJSON(`${COMMONS_API}?${params}`)
      if (!Array.isArray(json?.query?.pages)) throw Error('invalid_commons_payload')
      for (const pg of json.query.pages) {
        const key = normTitle(pg.title)
        const prev = pages.get(key) || { title: pg.title, templates: [], templatesComplete: true }
        if (pg.missing) prev.missing = true
        if (pg.imageinfo) prev.imageinfo = pg.imageinfo
        for (const t of pg.templates || []) if (!prev.templates.includes(t.title)) prev.templates.push(t.title)
        pages.set(key, prev)
      }
      if (!json.continue) { done = true; break }
      cont = json.continue
    }
    if (!done) for (const f of batch) { const pg = pages.get(f); if (pg) pg.templatesComplete = false }
  }
  return pages
}

function isoDate(v) {
  const m = stripHtml(v).match(/(\d{4})[-:](\d{2})[-:](\d{2})/)
  if (!m) return null
  const d = `${m[1]}-${m[2]}-${m[3]}`
  return !isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d ? d : null
}

export function toMediaRow(placeId, file, page, { qid, krFop, now, matchKind = 'exact', matchedName = '' }) {
  const ii = page.imageinfo?.[0] || {}, m = ii.extmetadata || {}
  const license = stripHtml(m.LicenseShortName?.value || m.UsageTerms?.value)
  const filePage = 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file.replace(/ /g, '_'))
  const creator = (stripHtml(m.Artist?.value) || stripHtml(m.Credit?.value) || 'Wikimedia Commons 기여자').slice(0, 160)
  const licenseUrl = /^https?:\/\//.test(m.LicenseUrl?.value || '') ? m.LicenseUrl.value : filePage
  return {
    place_code: placeId,
    provider_asset_id: file,
    display_url: ii.thumburl || ii.url,
    original_file_url: ii.url,
    creator,
    license_code: license,
    license_url: licenseUrl,
    captured_at: isoDate(m.DateTimeOriginal?.value),
    source_url: filePage,
    attribution_text: `${creator} · ${license} · Wikimedia Commons`,
    clearance_status: 'cleared',
    review_required: false,
    source_provider: 'wikimedia_commons',
    delivery: 'commons_live',
    wikidata: qid,
    rights_basis: krFop ? 'kr_copyright_act_35_2_display' : null,
    last_rights_sync_at: now,
    match_kind: matchKind,
    caption: matchKind === 'host'
      ? `프로젝트가 있는 건물(${matchedName})의 사진 · 촬영 당시 모습이며 현재 전시와 다를 수 있습니다`
      : '위키데이터에 연결된 장소 사진 · 촬영 당시 모습이며 현재 전시와 다를 수 있습니다',
    changes: '원본 변경 없음 · 화면 크기에 맞춰 축소 표시',
  }
}

// One full sync. fetchJSON(url, init?) must return parsed JSON or throw.
// Returns {media:[rows], info:{place_id: {...}}, stats}. Throws only when nothing could be fetched.
export async function syncLive({ places, fetchJSON, now = new Date().toISOString(), policy = DEFAULT_POLICY }) {
  const active = places.filter(p => p.is_published !== false && (p.name_kr || p.name_en))
  const wd = await fetchJSON(WDQS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json' },
    body: new URLSearchParams({ query: buildPlaceQuery(active), format: 'json' }).toString(),
  })
  const matches = parsePlaceQuery(wd, active)
  const wanted = []
  for (const [, m] of matches) wanted.push(...m.images.slice(0, policy.maxImagesPerPlace))
  const pages = wanted.length ? await fetchCommonsPages(wanted, fetchJSON) : new Map()
  const media = [], info = {}, rejected = []
  for (const [placeId, m] of matches) {
    info[placeId] = { qid: m.qid, website: m.website, coord: m.coord, commonsCategory: m.commonsCategory, matchedName: m.matchedName, matchKind: m.matchKind, synced_at: now }
    for (const file of m.images.slice(0, policy.maxImagesPerPlace)) {
      const page = pages.get(normTitle(file))
      const ii = page?.imageinfo?.[0]
      if (!page || page.missing || !ii?.url) { rejected.push({ placeId, file, reasons: ['missing'] }); continue }
      const license = stripHtml(ii.extmetadata?.LicenseShortName?.value || ii.extmetadata?.UsageTerms?.value)
      const verdict = assessRights({ license, mime: ii.mime, templates: page.templates, templatesComplete: page.templatesComplete !== false }, policy)
      if (!verdict.ok) { rejected.push({ placeId, file, reasons: verdict.reasons }); continue }
      media.push(toMediaRow(placeId, normTitle(file), page, { qid: m.qid, krFop: verdict.krFop, now, matchKind: m.matchKind, matchedName: m.matchedName }))
    }
  }
  return { media, info, stats: { places: active.length, matched: matches.size, images: media.length, rejected } }
}
