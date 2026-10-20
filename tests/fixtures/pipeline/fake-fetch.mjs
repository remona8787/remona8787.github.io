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
  return { entities, categories, files, thumbs, wikis, search: read('commons/search.json'), links: read('links.json'), overpass: read('overpass.json'), gdelt: read('web/gdelt.json'), feed: readFileSync(path.join(DIR, 'web/feed.xml'), 'utf8'), properties: classes.properties }
}

const FIX = loadFixtures()
export const FIXTURES = FIX

// The web rules of a fixture run: the English GDELT group and the Dezeen feed (the others need no new code paths).
export const FIXTURE_OVERRIDES = {
  pipeline: {
    sources: { web: { rules: [SEED_RULES.find((r) => r.kind === 'gdelt' && r.language === 'en'), SEED_RULES.find((r) => r.kind === 'rss' && r.name === 'Dezeen')] } },
  },
}

const jsonRes = (v, { status = 200, type = 'application/json; charset=utf-8', headers = {} } = {}) => new Response(JSON.stringify(v), { status, headers: { 'content-type': type, ...headers } })
const normTitle = (t) => String(t || '').replace(/_/g, ' ').trim()
const TEMPLATE_PAGE = 12 // templates per response (the real API: 500); small so continuation is exercised

function sparql(body) {
  const query = new URLSearchParams(body).get('query') || ''
  const kind = /#aol:([a-z-]+)(?: (Q\d+))?/.exec(query)
  if (!kind) return jsonRes({ head: { vars: [] }, results: { bindings: [] } }, { type: 'application/sparql-results+json' })
  const [, k, q] = kind
  if (k === 'class-count' || k === 'class-instances') {
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
  return jsonRes({ entities: out, success: 1 })
}

const catPage = (title, props) => {
  const c = FIX.categories.get(title)
  if (!c) return { ns: 14, title, missing: true }
  const pg = { pageid: c.page.pageid, ns: 14, title }
  if (props.includes('pageprops') && c.page.pageprops) pg.pageprops = c.page.pageprops
  if (props.includes('categoryinfo')) pg.categoryinfo = c.page.categoryinfo
  if (props.includes('coordinates') && c.page.coordinates) pg.coordinates = c.page.coordinates
  return pg
}

function commons(p, state) {
  const props = (p.get('prop') || '').split('|')
  if (p.get('list') === 'search') {
    const term = /intitle:"(.+)"/.exec(p.get('srsearch') || '')?.[1] || ''
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
    const pages = (c?.members || []).filter((m) => types.includes(m.type)).map((m) => (m.ns === 14 ? catPage(m.title, props) : { ns: m.ns, title: m.title }))
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
    if (u.host === 'commons.wikimedia.org' && u.pathname === '/w/api.php') return commons(p, state)
    if (/^[a-z-]+\.wikipedia\.org$/.test(u.host) && u.pathname === '/w/api.php') return wikipedia(u.host.split('.')[0], p)
    if (u.host === 'upload.wikimedia.org') {
      const base = url.replace(/\/\d+px-([^/]+)$/, '/330px-$1')
      const thumb = FIX.thumbs.get(base)
      return thumb ? new Response(readFileSync(path.join(DIR, thumb)), { status: 200, headers: { 'content-type': 'image/jpeg' } }) : new Response('not found', { status: 404 })
    }
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
