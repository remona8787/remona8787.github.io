// An injected fetch that answers the pipeline's requests from the recorded-shape fixtures of this directory, the way
// the real services compose them (wbgetentities batches, SPARQL JSON bindings, MediaWiki formatversion=2 pages with
// template continuation, Wikipedia search, GDELT, RSS with ETag, Overpass, robots.txt and link checks), plus a
// virtual clock so rate limits and the time budget run instantly. Used by the tests and by `run.mjs --fixtures`.
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { SEED_RULES } from '../../../edge-functions/_shared/archive/seed-rules.mjs'

const DIR = import.meta.dirname
const read = (p) => JSON.parse(readFileSync(path.join(DIR, p), 'utf8'))
const ENTITY = 'http://www.wikidata.org/entity/'

/** Loads every fixture once. */
export function loadFixtures() {
  const entities = new Map()
  for (const f of readdirSync(path.join(DIR, 'wikidata/entities'))) { const e = read('wikidata/entities/' + f); entities.set(e.id, e) }
  const categories = new Map(read('commons/categories.json').map((c) => [c.page.title, c]))
  const files = new Map(read('commons/files.json').map((f) => [f.page.title.replace(/^File:/, ''), f]))
  const thumbs = new Map()
  for (const f of files.values()) thumbs.set(f.page.imageinfo[0].thumburl, f.thumb)
  const wikis = {}
  for (const f of readdirSync(path.join(DIR, 'wikipedia'))) wikis[f.replace(/\.json$/, '')] = read('wikipedia/' + f)
  const classes = JSON.parse(readFileSync(path.join(DIR, '../../../pipeline/config/classes.json'), 'utf8'))
  return { entities, categories, files, thumbs, wikis, search: read('commons/search.json'), links: read('links.json'), overpass: read('overpass.json'), gdelt: read('web/gdelt.json'), feed: readFileSync(path.join(DIR, 'web/feed.xml'), 'utf8'), properties: classes.properties, tourapi: read('tourapi/korservice2.json'),
    openverse: read('providers/openverse.json'), flickr: read('providers/flickr.json'), providerImages: read('providers/images.json') }
}

const FIX = loadFixtures()
export const FIXTURES = FIX

// The web rules of a fixture run: the English GDELT group and the Dezeen feed (the others need no new code paths).
export const FIXTURE_OVERRIDES = {
  // Korea: the fixture search terms and probes (the real titles are checked by the live runs only).
  korea: { search_terms: ['유등축제', '미디어아트'], probes: ['픽스처 강릉 빛축제', '픽스처 경포 유등축제', '픽스처 없는 문서'] },
  pipeline: {
    sources: { web: { rules: [SEED_RULES.find((r) => r.kind === 'gdelt' && r.language === 'en'), SEED_RULES.find((r) => r.kind === 'rss' && r.name === 'Dezeen')] } },
  },
}

// The keys of a fixture run (never real keys): the keyed sources and image providers answer from the fixtures.
export const FIXTURE_ENV = { TOURAPI_SERVICE_KEY: 'fixture-tourapi-key', FLICKR_API_KEY: 'fixture-flickr-key', SEOUL_OPEN_DATA_KEY: 'fixture-seoul-key' }

const jsonRes = (v, { status = 200, type = 'application/json; charset=utf-8', headers = {} } = {}) => new Response(JSON.stringify(v), { status, headers: { 'content-type': type, ...headers } })
const normTitle = (t) => String(t || '').replace(/_/g, ' ').trim()
const TEMPLATE_PAGE = 12 // templates per response (the real API: 500); small so continuation is exercised

function sparql(body) {
  const query = new URLSearchParams(body).get('query') || ''
  const kind = /#aol:([a-z-]+)(?: (Q\d+))?/.exec(query)
  if (!kind) return jsonRes({ head: { vars: [] }, results: { bindings: [] } }, { type: 'application/sparql-results+json' })
  const [, k, q] = kind
  if (k === 'kr-divisions') return jsonRes(read('wikidata/sparql/kr-divisions.json'), { type: 'application/sparql-results+json' })
  if (k === 'class-membership') {
    // Direct P31 only (the fixture classes have no subclass trees here).
    const vals = (name) => [...(new RegExp('VALUES \\?' + name + ' \\{([^}]*)\\}').exec(query)?.[1] || '').matchAll(/wd:(Q\d+)/g)].map((m) => m[1])
    const classes = new Set(vals('class'))
    const bindings = []
    for (const id of vals('item')) for (const c of (FIX.entities.get(id)?.claims?.P31 || []).map((x) => x.mainsnak?.datavalue?.value?.id)) if (classes.has(c)) bindings.push({ item: { type: 'uri', value: ENTITY + id }, class: { type: 'uri', value: ENTITY + c } })
    return jsonRes({ head: { vars: ['item', 'class'] }, results: { bindings } }, { type: 'application/sparql-results+json' })
  }
  if (k === 'class-count' || k === 'class-instances' || k === 'kr-class-instances') {
    const f = `wikidata/sparql/${k}-${q}.json`
    if (existsSync(path.join(DIR, f))) return jsonRes(read(f), { type: 'application/sparql-results+json' })
    return jsonRes(k === 'class-count' ? { head: { vars: ['instances', 'with_coords'] }, results: { bindings: [{ instances: { datatype: 'http://www.w3.org/2001/XMLSchema#integer', type: 'literal', value: '0' }, with_coords: { datatype: 'http://www.w3.org/2001/XMLSchema#integer', type: 'literal', value: '0' } }] } } : { head: { vars: ['item'] }, results: { bindings: [] } }, { type: 'application/sparql-results+json' })
  }
  if (k === 'aux') {
    const ids = [...query.matchAll(/wd:(Q\d+)/g)].map((m) => m[1])
    const vals = (e, pid) => (e.claims[pid] || []).map((s) => s.mainsnak?.datavalue?.value?.id).filter(Boolean)
    const bindings = []
    for (const id of ids) {
      const e = FIX.entities.get(id)
      if (!e) continue
      const b = { e: { type: 'uri', value: ENTITY + id } }
      for (const l of ['en', 'ko', 'mul']) if (e.labels[l]) b[l] = { 'xml:lang': l, type: 'literal', value: e.labels[l].value }
      const iso = e.claims.P297?.[0]?.mainsnak?.datavalue?.value
      if (iso) b.iso = { type: 'literal', value: iso }
      b.p31 = { type: 'literal', value: vals(e, 'P31').join(' ') }
      b.p131 = { type: 'literal', value: vals(e, 'P131').join(' ') }
      b.p17 = { type: 'literal', value: vals(e, 'P17').join(' ') }
      bindings.push(b)
    }
    return jsonRes({ head: { vars: ['e', 'en', 'ko', 'mul', 'iso', 'p31', 'p131', 'p17'] }, results: { bindings } }, { type: 'application/sparql-results+json' })
  }
  return jsonRes({ head: { vars: [] }, results: { bindings: [] } }, { type: 'application/sparql-results+json' })
}

function wbgetentities(p) {
  // By article title (sites=kowiki&titles=…): the items whose sitelink has that title.
  if (p.get('sites') && p.get('titles')) {
    const site = p.get('sites'), titles = p.get('titles').split('|')
    const byTitle = new Map([...FIX.entities.values()].filter((e) => e.sitelinks?.[site]).map((e) => [e.sitelinks[site].title, e.id]))
    const ids = titles.map((t) => byTitle.get(t.replace(/_/g, ' '))).filter(Boolean)
    const q = new URLSearchParams(p)
    q.delete('sites'); q.delete('titles'); q.set('ids', ids.join('|'))
    const res = ids.length ? JSON.parse(wbgetentitiesBody(q)) : { entities: {} }
    titles.filter((t) => !byTitle.has(t.replace(/_/g, ' '))).forEach((t, i) => { res.entities['-' + (i + 1)] = { site, title: t, missing: '' } })
    return jsonRes(res)
  }
  return jsonRes(JSON.parse(wbgetentitiesBody(p)))
}
function wbgetentitiesBody(p) {
  const ids = (p.get('ids') || '').split('|').filter(Boolean)
  const props = (p.get('props') || 'info|sitelinks|aliases|labels|descriptions|claims|datatype').split('|')
  const langs = p.get('languages') ? new Set(p.get('languages').split('|')) : null
  const out = {}
  for (const id of ids) {
    if (/^P\d+$/.test(id)) {
      const label = FIX.properties[id]
      out[id] = label ? { type: 'property', datatype: 'wikibase-item', id, labels: { en: { language: 'en', value: label } }, descriptions: {} } : { id, missing: '' }
      continue
    }
    const e = FIX.entities.get(id)
    if (!e) { out[id] = { id, missing: '' }; continue }
    const pick = (o) => Object.fromEntries(Object.entries(o).filter(([l]) => !langs || langs.has(l)))
    const r = { pageid: e.pageid, ns: 0, title: e.title, lastrevid: e.lastrevid, modified: e.modified, type: 'item', id }
    if (props.includes('labels')) r.labels = pick(e.labels)
    if (props.includes('descriptions')) r.descriptions = pick(e.descriptions)
    if (props.includes('claims')) r.claims = e.claims
    if (props.some((x) => x.startsWith('sitelinks'))) r.sitelinks = props.includes('sitelinks/urls') ? e.sitelinks : Object.fromEntries(Object.entries(e.sitelinks).map(([k, v]) => [k, { site: v.site, title: v.title, badges: [] }]))
    out[id] = r
  }
  return JSON.stringify({ entities: out, success: 1 })
}

/** www.wikidata.org list=search (CirrusSearch): "<term> haswbstatement:P17=Q884" → the fixture items of the term. */
function wikidataSearch(p) {
  const q = p.get('srsearch') || ''
  const term = q.replace(/\s*haswbstatement:\S+/g, '').trim()
  const country = /haswbstatement:P17=(Q\d+)/.exec(q)?.[1] || null
  const ids = (FIX.search.wikidata?.[term] || []).filter((id) => !country || (FIX.entities.get(id)?.claims?.P17 || []).some((c) => c.mainsnak?.datavalue?.value?.id === country))
  return jsonRes({ batchcomplete: true, query: { searchinfo: { totalhits: ids.length }, search: ids.map((title) => ({ ns: 0, title })) } })
}

const catPage = (title, props) => {
  const c = FIX.categories.get(title)
  if (!c) return { ns: 14, title, missing: true }
  const pg = { pageid: c.page.pageid, ns: 14, title }
  if (props.includes('pageprops') && c.page.pageprops) pg.pageprops = c.page.pageprops
  if (props.includes('categories') && c.parents?.length) pg.categories = c.parents.map((t) => ({ ns: 14, title: t }))
  if (props.includes('categoryinfo')) pg.categoryinfo = c.page.categoryinfo
  if (props.includes('coordinates') && c.page.coordinates) pg.coordinates = c.page.coordinates
  return pg
}

function commons(p, state) {
  const props = (p.get('prop') || '').split('|')
  if (p.get('action') === 'wbgetentities' && p.get('sites') === 'commonswiki') {
    // MediaInfo entities of files by title: their P180 (depicts) statements.
    const entities = {}
    for (const t of (p.get('titles') || '').split('|').map(normTitle)) {
      const f = FIX.files.get(t.replace(/^File:/, ''))
      if (!f) { entities['-' + t.length] = { missing: '', title: t }; continue }
      const id = 'M' + f.page.pageid
      const dep = FIX.search.file_depicts?.[t.replace(/^File:/, '')] || []
      entities[id] = { type: 'mediainfo', id, title: f.page.title, statements: dep.length ? { P180: dep.map((q) => ({ mainsnak: { snaktype: 'value', property: 'P180', datavalue: { type: 'wikibase-entityid', value: { 'entity-type': 'item', id: q } } }, type: 'statement', rank: 'normal' })) } : [] }
    }
    return jsonRes({ entities, success: 1 })
  }
  if (p.get('list') === 'search' && /^haswbstatement:P180=Q\d+$/.test(p.get('srsearch') || '')) {
    // Structured-data search: files that depict an item (namespace 6).
    const qid = p.get('srsearch').split('=')[1]
    const list = (FIX.search.depicts?.[qid] || []).map((title, i) => ({ ns: 6, title, pageid: FIX.files.get(title.replace(/^File:/, ''))?.page.pageid ?? 3000 + i, size: 2400000 }))
    return jsonRes({ batchcomplete: true, query: { searchinfo: { totalhits: list.length }, search: list } })
  }
  if (p.get('list') === 'search') {
    const term = [...(p.get('srsearch') || '').matchAll(/intitle:"([^"]+)"/g)].map((m) => m[1]).join(' + ')
    const list = (FIX.search.category[term] || []).map((title, i) => ({ ns: 14, title, pageid: FIX.categories.get(title)?.page.pageid ?? 1000 + i, size: 0, wordcount: 0, snippet: '', timestamp: '2025-01-01T00:00:00Z' }))
    return jsonRes({ batchcomplete: true, query: { searchinfo: { totalhits: list.length }, search: list } })
  }
  if (p.get('generator') === 'search') {
    const term = /intitle:"(.+)"/.exec(p.get('gsrsearch') || '')?.[1] || ''
    const pages = (FIX.search.file[term] || []).map((f, i) => ({ pageid: FIX.files.get(f.title.replace(/^File:/, ''))?.page.pageid ?? 2000 + i, ns: 6, title: f.title, index: i + 1, categories: f.categories.map((title) => ({ ns: 14, title })) }))
    return jsonRes({ batchcomplete: true, query: { pages } })
  }
  if (p.get('generator') === 'categorymembers') {
    const c = FIX.categories.get(normTitle(p.get('gcmtitle')))
    const types = (p.get('gcmtype') || 'page|subcat|file').split('|')
    const geo = (t) => { const g = FIX.search.file_geotags?.[t.replace(/^File:/, '')]; return props.includes('coordinates') && g ? { coordinates: [{ lat: g[0], lon: g[1], primary: true, globe: 'earth' }] } : {} }
    const pages = (c?.members || []).filter((m) => types.includes(m.type)).map((m) => (m.ns === 14 ? catPage(m.title, props) : { ns: m.ns, title: m.title, ...geo(m.title) }))
    return jsonRes({ batchcomplete: true, query: { pages } })
  }
  if (p.get('list') === 'categorymembers') {
    const c = FIX.categories.get(normTitle(p.get('cmtitle')))
    const types = (p.get('cmtype') || 'page|subcat|file').split('|')
    const all = (c?.members || []).filter((m) => types.includes(m.type)).sort((a, b) => (p.get('cmdir') === 'desc' ? b.timestamp.localeCompare(a.timestamp) : a.timestamp.localeCompare(b.timestamp)))
    const limit = Number(p.get('cmlimit') || 10), from = Number(p.get('cmcontinue')?.split('|').pop() || 0)
    const slice = all.slice(from, from + limit)
    return jsonRes({ batchcomplete: true, ...(from + limit < all.length ? { continue: { cmcontinue: `file|x|${from + limit}`, continue: '-||' } } : {}), query: { categorymembers: slice } })
  }
  if (props.includes('imageinfo')) {
    const titles = (p.get('titles') || '').split('|').map(normTitle)
    const width = Number(p.get('iiurlwidth') || 0)
    const filter = p.get('iiextmetadatafilter') ? new Set(p.get('iiextmetadatafilter').split('|')) : null
    // Templates of the batch in page order, TEMPLATE_PAGE per response (tlcontinue = "<pageid>|10|<title>").
    const all = []
    for (const t of titles) { const f = FIX.files.get(t.replace(/^File:/, '')); if (f) for (const tpl of f.page.templates) all.push([f.page.pageid, tpl.title]) }
    all.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]))
    const cont = p.get('tlcontinue')
    let start = 0
    if (cont) { const [pid, , title] = cont.split('|'); start = all.findIndex(([x, t]) => x === Number(pid) && t === title); if (start < 0) start = all.length }
    const chunk = all.slice(start, start + TEMPLATE_PAGE)
    const next = all[start + TEMPLATE_PAGE]
    const pages = titles.map((t) => {
      const f = FIX.files.get(t.replace(/^File:/, ''))
      if (!f) return { ns: 6, title: t, missing: true, known: false }
      const pg = { pageid: f.page.pageid, ns: 6, title: f.page.title }
      if (!cont) {
        const ii = { ...f.page.imageinfo[0] }
        if (width) { ii.thumburl = ii.thumburl.replace(/\/330px-/, `/${width}px-`); ii.thumbwidth = width; ii.thumbheight = Math.round(width * ii.height / ii.width) } else { delete ii.thumburl; delete ii.thumbwidth; delete ii.thumbheight }
        if (filter) ii.extmetadata = Object.fromEntries(Object.entries(ii.extmetadata).filter(([k]) => filter.has(k)))
        pg.imageinfo = [ii]
      }
      const tpls = chunk.filter(([pid]) => pid === f.page.pageid).map(([, title]) => ({ ns: 10, title }))
      if (tpls.length) pg.templates = tpls
      return pg
    })
    state.templateRounds++
    return jsonRes({ ...(next ? { continue: { tlcontinue: `${next[0]}|10|${next[1]}`, continue: '||imageinfo' } } : { batchcomplete: true }), query: { pages } })
  }
  if (p.get('titles') && props.includes('categories') && p.get('titles').split('|').every((t) => /^File:/.test(t))) {
    // The visible categories of files (from the fixture file's category list).
    const pages = p.get('titles').split('|').map(normTitle).map((t) => {
      const f = FIX.files.get(t.replace(/^File:/, ''))
      if (!f) return { ns: 6, title: t, missing: true }
      const cats = String(f.page.imageinfo[0].extmetadata.Categories?.value || '').split('|').filter(Boolean)
      return { pageid: f.page.pageid, ns: 6, title: f.page.title, categories: cats.map((c) => ({ ns: 14, title: 'Category:' + c })) }
    })
    return jsonRes({ batchcomplete: true, query: { pages } })
  }
  if (p.get('titles')) {
    const titles = p.get('titles').split('|')
    const normalized = titles.filter((t) => t !== normTitle(t)).map((from) => ({ fromencoded: false, from, to: normTitle(from) }))
    return jsonRes({ batchcomplete: true, query: { ...(normalized.length ? { normalized } : {}), pages: titles.map((t) => catPage(normTitle(t), props)) } })
  }
  return jsonRes({ error: { code: 'badparams', info: 'fixture: unsupported Commons request' } })
}

function wikipedia(lang, p) {
  const w = FIX.wikis[lang] || { search: {}, pages: [] }
  if (p.get('list') === 'search') {
    const term = (p.get('srsearch') || '').replace(/^"|"$/g, '')
    const hits = w.search[term] || []
    return jsonRes({ batchcomplete: true, query: { searchinfo: { totalhits: hits.length }, search: hits } })
  }
  const titles = (p.get('titles') || '').split('|').filter(Boolean)
  return jsonRes({ batchcomplete: true, query: { pages: titles.map((t) => w.pages.find((x) => x.title === t) || { ns: 0, title: t, missing: true }) } })
}

const goEnvelope = (items, total = items.length, page = 1, rows = 10) => jsonRes({ response: { header: { resultCode: '0000', resultMsg: 'OK' }, body: { items: items.length ? { item: items } : '', numOfRows: rows, pageNo: page, totalCount: total } } })
/**
 * openapi.seoul.go.kr:8088: /{KEY}/json/culturalEventInfo/{start}/{end}/ (the fixture key, or the sample key with rows
 * 1–5 only; a wrong key gets INFO-100 at the top level, rows past the end INFO-200).
 */
function seoulOpenApi(u) {
  const [, key, type, service, start, end] = u.pathname.split('/')
  const rows = read('seoul/culturalEventInfo.json').rows
  if (type !== 'json' || service !== 'culturalEventInfo') return jsonRes({ RESULT: { CODE: 'ERROR-310', MESSAGE: '해당하는 서비스를 찾을 수 없습니다.' } })
  if (key !== FIXTURE_ENV.SEOUL_OPEN_DATA_KEY && key !== 'sample') return jsonRes({ RESULT: { CODE: 'INFO-100', MESSAGE: '인증키가 유효하지 않습니다.' } })
  const a = Number(start), b = Math.min(Number(end), key === 'sample' ? 5 : Infinity)
  const slice = rows.slice(a - 1, b)
  if (!slice.length) return jsonRes({ RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } })
  return jsonRes({ culturalEventInfo: { list_total_count: rows.length, RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다' }, row: slice } })
}

/** apis.data.go.kr: TourAPI KorService2 and PhotoGalleryService1 (a wrong key gets the gateway's error header). */
function dataGoKr(u) {
  const p = u.searchParams, T = FIX.tourapi
  if (p.get('serviceKey') !== FIXTURE_ENV.TOURAPI_SERVICE_KEY) return jsonRes({ response: { header: { resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } } })
  if (p.get('_type') !== 'json' || !p.get('MobileOS') || !p.get('MobileApp')) return jsonRes({ response: { header: { resultCode: '10', resultMsg: 'INVALID_REQUEST_PARAMETER_ERROR' } } })
  const op = u.pathname.split('/').pop(), page = Number(p.get('pageNo') || 1), rows = Number(p.get('numOfRows') || 10)
  if (op === 'searchKeyword2') { const all = page > 1 ? [] : T.search[`${p.get('keyword')}|${p.get('contentTypeId') || ''}`] || []; return goEnvelope(all, all.length, page, rows) }
  if (op === 'searchFestival2') {
    const from = String(p.get('eventStartDate') || '')
    const all = (T.festivals || []).filter((f) => !from || String(f.eventenddate) >= from)
    return goEnvelope(all.slice((page - 1) * rows, page * rows), all.length, page, rows)
  }
  if (op === 'detailCommon2') { const it = T.common[p.get('contentId')]; return goEnvelope(it ? [it] : []) }
  if (op === 'detailImage2') return goEnvelope(T.images[p.get('contentId')] || [])
  if (op === 'gallerySearchList1') return goEnvelope(T.gallery[p.get('keyword')] || [])
  return jsonRes({ response: { header: { resultCode: '04', resultMsg: 'HTTP_ROUTING_ERROR' } } })
}

function linkCheck(u, method) {
  const host = FIX.links.hosts[u.hostname] || FIX.links.default
  if (u.pathname === '/robots.txt') return new Response(host.robots ?? '', { status: host.robots === '' ? 404 : 200, headers: { 'content-type': 'text/plain' } })
  return new Response(method === 'HEAD' ? null : 'x', { status: host.status ?? 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

/**
 * The fixture world behind one fetch. Options: start time (ms), latency per request (virtual ms), fail(url, init) →
 * Response | Error | null to inject faults (an Error is thrown like a network failure).
 */
export function fixtureEnvironment({ start = Date.parse('2026-10-20T06:17:00Z'), latencyMs = 40, fail = null } = {}) {
  // Virtual time as a discrete-event clock: sleep() registers a timer, and time advances to the next timer only from
  // setImmediate, i.e. when every task is waiting. Concurrent tasks therefore see one consistent timeline.
  let t = start, seq = 0, pumping = false
  const timers = []
  const requests = []
  const state = { templateRounds: 0 }
  const clock = () => t
  const pump = () => {
    if (pumping) return
    pumping = true
    const step = () => {
      if (!timers.length) { pumping = false; return }
      timers.sort((a, b) => a.at - b.at || a.seq - b.seq)
      const next = timers.shift()
      if (next.at > t) t = next.at
      next.resolve()
      setImmediate(step)
    }
    setImmediate(step)
  }
  const sleep = (ms) => new Promise((resolve) => { timers.push({ at: t + Math.max(0, Math.round(Number(ms) || 0)), seq: seq++, resolve }); pump() })
  async function fetch(input, init = {}) {
    const url = String(input)
    const u = new URL(url)
    const method = (init.method || 'GET').toUpperCase()
    const headers = new Headers(init.headers || {})
    const sparqlKind = u.host === 'query.wikidata.org' ? /#aol:([a-z-]+(?: Q\d+)?)/.exec(new URLSearchParams(String(init.body || '')).get('query') || '')?.[1] ?? null : null
    requests.push({ at: t, method, url, host: u.host, ua: headers.get('user-agent'), if_none_match: headers.get('if-none-match'), sparql: sparqlKind })
    await sleep(latencyMs)
    const injected = fail ? fail(url, init) : null
    if (injected instanceof Error) throw injected
    if (injected) return injected
    const p = u.searchParams
    if (u.host === 'query.wikidata.org') return sparql(String(init.body || ''))
    if (u.host === 'www.wikidata.org' && p.get('action') === 'wbgetentities') return wbgetentities(p)
    if (u.host === 'www.wikidata.org' && p.get('action') === 'query' && p.get('list') === 'search') return wikidataSearch(p)
    if (u.host === 'commons.wikimedia.org' && u.pathname === '/w/api.php') return commons(p, state)
    if (/^[a-z-]+\.wikipedia\.org$/.test(u.host) && u.pathname === '/w/api.php') return wikipedia(u.host.split('.')[0], p)
    if (u.host === 'upload.wikimedia.org' || u.host === 'thumb.wikimedia.org') {
      // Like the CDN: standard thumbnail widths only; 960 px and wider get the large rendition of the scene, the
      // original file path too (its bytes stand in for the original).
      const clean = url.replace(/\?.*$/, '')
      const w = Number(/\/(\d+)px-[^/]+$/.exec(clean)?.[1] || 0)
      if (w && ![120, 250, 330, 500, 960, 1280, 1920, 3840].includes(w)) return new Response('non-standard width', { status: 400 })
      const base = w ? clean.replace(/^https:\/\/thumb\./, 'https://upload.').replace(/\/\d+px-([^/]+)$/, '/330px-$1') : [...FIX.files.values()].find((f) => f.page.imageinfo[0].url === clean.replace(/^https:\/\/thumb\./, 'https://upload.'))?.page.imageinfo[0].thumburl
      const thumb = FIX.thumbs.get(base)
      if (!thumb) return new Response('not found', { status: 404 })
      const file = w && w < 960 ? thumb : thumb.replace(/^thumbs\/(.+)\.jpg$/, 'renditions/$1-960.jpg')
      return new Response(readFileSync(path.join(DIR, file)), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    }
    if (FIX.providerImages[url]) return new Response(readFileSync(path.join(DIR, 'renditions', FIX.providerImages[url] + '.jpg')), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    if (u.host === 'api.openverse.org' && u.pathname === '/v1/images/') {
      const results = FIX.openverse[p.get('q')] || []
      if (p.get('license') !== 'cc0,pdm,by,by-sa') return jsonRes({ detail: 'fixture: unexpected licence filter' }, { status: 400 })
      return jsonRes({ result_count: results.length, page_count: results.length ? 1 : 0, page_size: Number(p.get('page_size') || 20), page: 1, results }, { headers: { 'x-ratelimit-limit-anon_burst': '20/min', 'x-ratelimit-available-anon_burst': '19' } })
    }
    if (u.host === 'api.flickr.com') {
      if (p.get('api_key') !== FIXTURE_ENV.FLICKR_API_KEY) return jsonRes({ stat: 'fail', code: 100, message: 'Invalid API Key (Key has invalid format)' })
      if (p.get('method') === 'flickr.photos.licenses.getInfo') return jsonRes(FIX.flickr.licenses)
      if (p.get('method') === 'flickr.photos.search') {
        const allowed = new Set((p.get('license') || '').split(','))
        const photo = (FIX.flickr.search[p.get('text')] || []).filter((x) => allowed.has(String(x.license)))
        return jsonRes({ photos: { page: 1, pages: 1, perpage: 30, total: photo.length, photo }, stat: 'ok' })
      }
      return jsonRes({ stat: 'fail', code: 112, message: 'Method not found' })
    }
    if (u.host === 'apis.data.go.kr') return dataGoKr(u)
    if (u.host === 'openapi.seoul.go.kr:8088') return seoulOpenApi(u)
    if (u.host === 'api.gdeltproject.org') return jsonRes(FIX.gdelt)
    if (u.host === 'www.dezeen.com' && u.pathname === '/feed/') {
      if (headers.get('if-none-match') === '"fixture-feed-1"') return new Response(null, { status: 304, headers: { etag: '"fixture-feed-1"' } })
      return new Response(FIX.feed, { status: 200, headers: { 'content-type': 'application/rss+xml; charset=utf-8', etag: '"fixture-feed-1"' } })
    }
    if (u.host === 'overpass-api.de') {
      const q = new URLSearchParams(String(init.body || '')).get('data') || ''
      const want = new Set((/\^\(([^)]*)\)\$/.exec(q)?.[1] || '').split('|'))
      return jsonRes({ ...FIX.overpass, elements: FIX.overpass.elements.filter((e) => want.has(e.tags?.wikidata)) })
    }
    return linkCheck(u, method)
  }
  return { fetch, clock, sleep, requests, state, advance: (ms) => { t += ms } }
}
