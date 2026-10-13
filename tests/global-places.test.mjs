// Nationwide/worldwide Wikidata place sync: query building, parsing, merging, failure isolation and image rights.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  BRANCHES, REJECTED_QIDS, CATEGORY_PRIORITY, KOREA_QID, buildBranchQuery, branchIdOf, parseWktPoint, parseBranch, mergeItems,
  primaryCategory, kindsOf, syncGlobal, carryOver, compactPlaces, expandPlaces, checkImages, curatedNameKeys, nameKey, httpsURL,
} from '../edge-functions/_shared/global-places.mjs'
import { assessRights, commonsInfoParams, DEFAULT_POLICY, WDQS_URL } from '../edge-functions/_shared/live-media.mjs'
import { wdqsBranch, commonsPage, commonsResponse, KOREA, WORLD, JAPAN, FILES } from './fixtures/global-places-fixtures.mjs'

const require = createRequire(import.meta.url)
const X = require('../site-public-cleared/catalog.js')
const C = require('../site-public-cleared/core.js')

// Verified on wikidata.org (research-qids.json "verified" and "example_instances"). Every QID a query uses must be one of these.
const VERIFIED_CLASSES = ['Q17158007', 'Q4287692', 'Q1823448', 'Q1421557', 'Q1798004', 'Q131627422', 'Q29885984', 'Q776483', 'Q860372', 'Q378604', 'Q1386571', 'Q63442021', 'Q110409771', 'Q106561607', 'Q124414048', 'Q126682969', 'Q1658880', 'Q1653073', 'Q718636', 'Q132241', 'Q380051', 'Q1136999', 'Q926949', 'Q18088097', 'Q177305', 'Q1440300', 'Q6485102', 'Q557141', 'Q884']
const VERIFIED_INSTANCES = ['Q12859650', 'Q12618343', 'Q625724', 'Q5295847', 'Q255506', 'Q704504', 'Q494895', 'Q31179486', 'Q69134', 'Q485443', 'Q30275918', 'Q5001265', 'Q862790', 'Q136488464', 'Q7937834', 'Q4167', 'Q26156861', 'Q22087183', 'Q60749353', 'Q597137', 'Q796012', 'Q97613610', 'Q104235671', 'Q56255196', 'Q97366760', 'Q191212', 'Q7899954', 'Q125715', 'Q1636567', 'Q4923257', 'Q5977922', 'Q1068874', 'Q11235643', 'Q7676551', 'Q351126', 'Q1916349', 'Q135116725']
const LOOK_ALIKES = ['Q10957', 'Q1189512', 'Q7765824', 'Q24875628', 'Q19706461', 'Q12906101', 'Q7094057', 'Q210064', 'Q682010', 'Q496218', 'Q7937831', 'Q55736992', 'Q104383619', 'Q109905495']
const qidsIn = q => new Set([...q.matchAll(/wd:(Q\d+)/g)].map(m => m[1]))
const byId = id => BRANCHES.find(b => b.id === id)

test('queries are split into small branches, each tagged and limited', () => {
  const ids = BRANCHES.map(b => b.id)
  for (const id of ['world:seeds', 'world:classes-art', 'world:classes-events', 'world:genres', 'world:parts', 'korea:seeds', 'korea:classes', 'korea:genres', 'korea:festival-keywords', 'korea:name-keywords']) assert.ok(ids.includes(id), id)
  assert.equal(new Set(ids).size, ids.length, 'unique ids')
  for (const b of BRANCHES) {
    const q = buildBranchQuery(b)
    assert.equal(branchIdOf(q), b.id)
    assert.match(q, /\nLIMIT \d+$/)
    assert.ok(b.limit <= 1500, b.id + ' LIMIT stays small')
    assert.ok(!q.includes('wikibase:label'), b.id + ' uses no label service')
    assert.equal((q.match(/\{/g) || []).length, (q.match(/\}/g) || []).length, b.id + ' braces balance')
    for (const v of ['?label_ko', '?label_en', '?desc_ko', '?desc_en', '?coord', '?image', '?country', '?admin', '?site', '?kind', '?sitelinks']) assert.ok(q.includes(v), `${b.id} selects ${v}`)
    assert.match(q, /wdt:P625/); assert.match(q, /wdt:P276/); assert.match(q, /wdt:P18/); assert.match(q, /wdt:P131/); assert.match(q, /wdt:P856/)
  }
})

test('queries use verified QIDs only, never a rejected look-alike', () => {
  const allowed = new Set([...VERIFIED_CLASSES, ...VERIFIED_INSTANCES])
  const used = new Set()
  for (const b of BRANCHES) for (const q of qidsIn(buildBranchQuery(b))) { used.add(q); assert.ok(allowed.has(q), `${b.id} uses unverified ${q}`) }
  for (const q of LOOK_ALIKES) { assert.ok(!used.has(q), 'look-alike ' + q); assert.ok(REJECTED_QIDS.includes(q), 'listed as rejected: ' + q) }
  for (const q of ['Q17158007', 'Q4287692', 'Q1823448', 'Q1421557', 'Q776483', 'Q124414048', 'Q1658880', 'Q4167', 'Q7937834', 'Q60749353']) assert.ok(used.has(q), 'uses ' + q)
})

test('Korean branches stay in South Korea; broad classes are Korea-only; the regex branch is isolated', () => {
  for (const b of BRANCHES.filter(b => b.id.startsWith('korea:') && b.id !== 'korea:seeds')) assert.ok(buildBranchQuery(b).includes('wd:' + KOREA_QID), b.id)
  for (const b of BRANCHES.filter(b => b.id.startsWith('world:'))) {
    const q = qidsIn(buildBranchQuery(b))
    assert.ok(!q.has('Q1440300'), b.id + ': observation tower is Korea-only')
    assert.ok(!q.has('Q132241'), b.id + ': festival is Korea-only')
  }
  const expensive = BRANCHES.filter(b => b.expensive)
  assert.deepEqual(expensive.map(b => b.id), ['korea:name-keywords'])
  for (const b of BRANCHES.filter(b => !b.expensive && b.id !== 'korea:festival-keywords')) assert.ok(!buildBranchQuery(b).includes('REGEX'), b.id + ' has no label regex')
})

test('WKT points are "Point(lon lat)": longitude first', () => {
  assert.deepEqual(parseWktPoint('Point(126.9779 37.5663)'), { lat: 37.5663, lon: 126.9779 })
  assert.deepEqual(parseWktPoint('Point(151.2093 -33.8688)'), { lat: -33.8688, lon: 151.2093 })
  assert.deepEqual(parseWktPoint('Point(1.5e1 4.7e1)'), { lat: 47, lon: 15 })
  assert.equal(parseWktPoint('<http://www.wikidata.org/entity/Q405> Point(10 20)'), null, 'other globes are rejected')
  assert.equal(parseWktPoint('Point(37.5 200)'), null)
  assert.equal(parseWktPoint(''), null)
})

test('branch rows parse into compact records; unusable rows are dropped', () => {
  const json = wdqsBranch([
    WORLD.vivid, KOREA.gwangan, WORLD.xss,
    { qid: 'Q1', ko: '좌표 없음', kind: 'Festival' },
    { qid: 'Q2', ko: '분류 없음', coord: 'Point(1 2)', kind: 'Something else' },
    { qid: 'Q10957', en: 'Lumière Festival (film)', coord: 'Point(4.8 45.7)', kind: 'Festival' },
  ])
  const { items, dropped } = parseBranch(json, 'world:seeds')
  assert.equal(dropped, 3)
  const [vivid, gwangan, xss] = items
  assert.deepEqual(vivid.coord, { lat: -33.8688, lon: 151.2093 })
  assert.equal(vivid.image, 'Vivid Sydney 2019.jpg')
  assert.equal(vivid.countryQid, 'Q408'); assert.equal(vivid.countryLabel, '오스트레일리아')
  assert.equal(vivid.website, 'https://www.vividsydney.com/')
  assert.equal(gwangan.website, '', 'http websites are dropped')
  assert.equal(gwangan.countryLabel, '대한민국')
  assert.equal(xss.descKo, '굵게 설명', 'markup is stripped from descriptions')
  assert.throws(() => parseBranch({}, 'x'), /invalid_wdqs_payload/)
  assert.equal(httpsURL('javascript:alert(1)'), '')
})

test('merge by QID: kinds and branches are unioned, Korea wins, primary category by fixed priority', () => {
  const a = parseBranch(wdqsBranch([{ ...WORLD.graz, kind: 'Architectural Lighting' }, { ...KOREA.gwangan, country: 'Q17|일본', kind: 'Nightscape' }]), 'world:parts').items
  const b = parseBranch(wdqsBranch([{ ...WORLD.graz, kind: 'Media Facade|Light Art', sitelinks: 33 }, KOREA.gwangan]), 'korea:seeds').items
  const places = mergeItems([a, b])
  assert.equal(places.length, 2)
  const graz = places.find(p => p.wikidata === 'Q597137')
  assert.deepEqual(graz.categories, ['Media Facade', 'Light Art', 'Architectural Lighting'])
  assert.equal(graz.primary_category, 'Media Facade')
  assert.deepEqual(graz.branches, ['world:parts', 'korea:seeds'])
  assert.equal(graz.sitelinks, 33)
  const gw = places.find(p => p.wikidata === 'Q485443')
  assert.equal(gw.scope, 'korea'); assert.equal(gw.country, '대한민국')
  assert.equal(gw.primary_category, 'Architectural Lighting', 'architectural lighting beats nightscape')
  assert.equal(places[0].wikidata, 'Q597137', 'most-linked first')
  assert.equal(primaryCategory(['Nightscape', 'Festival']), 'Festival')
  assert.equal(primaryCategory(['Public Art', 'Media Art']), 'Media Art')
  assert.deepEqual(kindsOf('Nightscape|Media Facade|bogus'), ['Media Facade', 'Nightscape'])
  assert.equal(CATEGORY_PRIORITY[0], 'Media Facade'); assert.equal(CATEGORY_PRIORITY.at(-1), 'Nightscape')
})

test('app records carry Wikidata coordinates as their own, mappable source', () => {
  const [p] = mergeItems([parseBranch(wdqsBranch([WORLD.vivid]), 'world:seeds').items])
  assert.equal(p.place_id, 'WD-Q7937834'); assert.equal(p.name_kr, '비비드 시드니'); assert.equal(p.name_en, 'Vivid Sydney')
  assert.equal(p.latitude, -33.8688); assert.equal(p.longitude, 151.2093)
  assert.equal(p.coordinate_review_status, 'source'); assert.equal(p.coordinate_source, 'wikidata')
  assert.equal(p.coordinate_source_url, 'https://www.wikidata.org/wiki/Q7937834'); assert.equal(p.source_url, p.coordinate_source_url)
  assert.equal(p.origin, 'wikidata-sync'); assert.equal(p.source_publisher, 'Wikidata'); assert.equal(p.scope, 'world')
  assert.equal(p.country, '오스트레일리아'); assert.equal(p.city, '시드니')
  assert.equal(X.mappable(p), true); assert.equal(X.wikidataCoords(p), true)
  assert.equal(X.mappable({ ...p, coordinate_source_url: 'http://www.wikidata.org/wiki/Q7937834' }), false)
  assert.equal(X.mappable({ ...p, coordinate_review_status: 'pending' }), false)
  const [en] = mergeItems([parseBranch(wdqsBranch([{ ...WORLD.graz, ko: '' }]), 'world:seeds').items])
  assert.equal(en.name_kr, 'Kunsthaus Graz', 'English label when there is no Korean one')
})

test('Festival is an app category and search covers synced places by country, city and category', () => {
  assert.ok(X.categories.some(([k, name]) => k === 'Festival' && name === '빛 축제'))
  const places = mergeItems([parseBranch(wdqsBranch([WORLD.vivid, WORLD.lyon, KOREA.jinju, ...JAPAN.slice(0, 3)]), 'world:seeds').items])
  const today = '2026-10-13'
  assert.deepEqual(X.search(places, { category: 'Festival' }, today).map(p => p.wikidata).sort(), ['Q12618343', 'Q4167', 'Q7937834'])
  assert.equal(X.search(places, { country: '일본' }, today).length, 3)
  assert.deepEqual(X.search(places, { q: '리옹' }, today).map(p => p.wikidata), ['Q4167'])
  assert.deepEqual(X.search(places, { q: '빛 축제 진주' }, today).map(p => p.wikidata), ['Q12618343'], 'category label is searchable')
  assert.equal(X.search(places, { category: 'Global' }, today).length, 5)
})

test('syncGlobal: two branches at a time, POSTed forms, and a failing branch never takes the others down', async () => {
  const branches = [byId('korea:seeds'), byId('world:seeds'), byId('world:genres'), byId('world:lantern'), byId('world:parts'), byId('korea:name-keywords')]
  let active = 0, maxActive = 0
  const seen = []
  const fetchJSON = async (url, init) => {
    assert.equal(url, WDQS_URL); assert.equal(init.method, 'POST')
    const form = new URLSearchParams(init.body)
    assert.equal(form.get('format'), 'json')
    const id = branchIdOf(form.get('query'))
    seen.push(id)
    active++; maxActive = Math.max(maxActive, active)
    try {
      await new Promise(r => setTimeout(r, 5))
      if (id === 'world:genres') throw Error('HTTP 500')
      if (id === 'world:lantern') return {}
      if (id === 'korea:name-keywords') return await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('aborted'))))
      if (id === 'korea:seeds') return wdqsBranch([KOREA.jinju])
      if (id === 'world:seeds') return wdqsBranch([WORLD.vivid, WORLD.graz])
      return wdqsBranch([{ ...WORLD.graz, kind: 'Architectural Lighting' }])
    } finally { active-- }
  }
  const r = await syncGlobal({ fetchJSON, branches, timeoutMs: 100, now: '2026-10-13T00:00:00.000Z' })
  assert.equal(maxActive, 2)
  assert.equal(seen.at(-1), 'korea:name-keywords', 'the expensive branch runs last')
  assert.deepEqual(r.places.map(p => p.wikidata).sort(), ['Q12618343', 'Q597137', 'Q7937834'])
  const report = Object.fromEntries(r.branches.map(b => [b.id, b]))
  assert.equal(report['world:genres'].ok, false); assert.match(report['world:genres'].error, /HTTP 500/)
  assert.equal(report['world:lantern'].ok, false); assert.match(report['world:lantern'].error, /invalid_wdqs_payload/)
  assert.equal(report['korea:name-keywords'].ok, false); assert.match(report['korea:name-keywords'].error, /timeout/)
  assert.equal(report['world:seeds'].count, 2)
  assert.deepEqual([r.stats.korea, r.stats.world, r.stats.branchesOk, r.stats.branchesFailed], [1, 2, 3, 3])
  await assert.rejects(syncGlobal({ fetchJSON: async () => { throw Error('offline') }, branches, timeoutMs: 50 }), e => e.message === 'all_branches_failed' && e.branches.length === 6)
})

test('syncGlobal stops when its signal aborts (the page is closing): no new branch is started', async () => {
  const stop = new AbortController()
  const seen = []
  const fetchJSON = async (url, init) => {
    seen.push(branchIdOf(new URLSearchParams(init.body).get('query')))
    if (seen.length === 2) stop.abort()
    return await new Promise((resolve, reject) => { init.signal.addEventListener('abort', () => reject(Error('aborted'))); setTimeout(() => resolve(wdqsBranch([])), 20) })
  }
  await assert.rejects(syncGlobal({ fetchJSON, signal: stop.signal, timeoutMs: 1000 }), /all_branches_failed/)
  assert.equal(seen.length, 2, 'only the two branches already running were requested')
})

test('a failed branch keeps its places from the last good result', () => {
  const prev = mergeItems([parseBranch(wdqsBranch([WORLD.vivid]), 'world:seeds').items, parseBranch(wdqsBranch([...JAPAN.slice(0, 2)]), 'world:classes-art').items])
  const now = mergeItems([parseBranch(wdqsBranch([WORLD.lyon]), 'world:seeds').items])
  const kept = carryOver(prev, now, ['world:classes-art'])
  assert.deepEqual(kept.map(p => p.wikidata).sort(), ['Q4167', JAPAN[0].qid, JAPAN[1].qid].sort(), 'Vivid (dropped by a branch that worked) is gone')
  assert.equal(carryOver(prev, now, []), now)
})

test('compact storage round-trips the places and stays small', () => {
  const places = mergeItems([parseBranch(wdqsBranch([WORLD.vivid, KOREA.jinju, WORLD.graz, ...JAPAN]), 'world:seeds').items])
  const rows = compactPlaces(places)
  const back = expandPlaces(JSON.parse(JSON.stringify(rows)))
  assert.deepEqual(back, places)
  assert.ok(JSON.stringify(rows).length / places.length < 260, 'about 200 characters a place')
  assert.deepEqual(expandPlaces([['Q10957', 'x', '', '', '1', '', '', '', 1, 1, '', '', 0, ''], 'junk', ['bad']]), [], 'rejected QIDs and junk never come back from storage')
})

test('image rights: foreign no-FoP tags block, Korean FoP follows policy, attribution is complete', async () => {
  assert.equal(assessRights({ license: 'CC BY-SA 4.0', mime: 'image/jpeg', templates: ['Template:NoFoP-France'] }).ok, false)
  assert.deepEqual(assessRights({ license: 'CC BY-SA 4.0', mime: 'image/jpeg', templates: ['Template:NoFoP-Atlantis'] }).reasons, ['foreign_no_freedom_of_panorama'])
  assert.equal(assessRights({ license: 'CC BY-SA 4.0', mime: 'image/jpeg', templates: ['Template:NoFoP-South Korea'] }).ok, true)
  const tl = commonsInfoParams(['A.jpg']).get('tltemplates').split('|')
  assert.ok(tl.length <= 50, 'the Commons API takes at most 50 tltemplates values')
  for (const t of ['Template:NoFoP-France', 'Template:NoFoP-Italy', 'Template:NoFoP-Japan', 'Template:NoFoP-United States', 'Template:NoFoP-Russia', 'Template:NoFoP-Ukraine', 'Template:NoFoP-United Arab Emirates', 'Template:NoFoP-Belgium', 'Template:NoFoP-China', 'Template:NoFoP-Taiwan', 'Template:NoFoP-South Korea']) assert.ok(tl.includes(t), t)

  const requests = []
  const fetchJSON = async url => {
    const titles = new URL(url).searchParams.get('titles').split('|').map(t => t.replace(/^File:/, ''))
    requests.push(titles.length)
    return commonsResponse(Object.fromEntries(titles.map(t => [t, FILES[t] ? commonsPage(FILES[t]) : { missing: true }])))
  }
  const items = [
    { place_id: 'WD-Q7937834', wikidata: 'Q7937834', image: 'Vivid Sydney 2019.jpg' },
    { place_id: 'WD-Q4167', wikidata: 'Q4167', image: 'Fete des Lumieres Lyon.jpg' },
    { place_id: 'WD-Q597137', wikidata: 'Q597137', image: 'Kunsthaus Graz.jpg' },
    { place_id: 'WD-Q12618343', wikidata: 'Q12618343', image: 'Jinju lantern festival.jpg' },
    { place_id: 'WD-Q1', wikidata: 'Q1', image: 'Gone.jpg' },
    ...Array.from({ length: 55 }, (_, i) => ({ place_id: 'WD-Q' + (100 + i), wikidata: 'Q' + (100 + i), image: `Extra ${i}.jpg` })),
  ]
  const v = await checkImages(items, { fetchJSON, now: '2026-10-13T00:00:00.000Z' })
  assert.deepEqual(requests, [50, 10], 'one Commons request per 50 files')
  const vivid = v.get('Vivid Sydney 2019.jpg')
  assert.equal(vivid.ok, true)
  assert.equal(vivid.row.creator, 'Lee Photographer'); assert.equal(vivid.row.license_code, 'CC BY-SA 4.0')
  assert.equal(vivid.row.license_url, 'https://creativecommons.org/licenses/by-sa/4.0'); assert.equal(vivid.row.captured_at, '2019-05-30')
  assert.equal(vivid.row.source_url, 'https://commons.wikimedia.org/wiki/File:Vivid_Sydney_2019.jpg')
  assert.equal(vivid.row.place_code, 'WD-Q7937834'); assert.equal(vivid.row.clearance_status, 'cleared'); assert.ok(vivid.row.display_url.startsWith('https://upload.wikimedia.org/'))
  assert.deepEqual(v.get('Fete des Lumieres Lyon.jpg').reasons, ['foreign_no_freedom_of_panorama'])
  assert.deepEqual(v.get('Kunsthaus Graz.jpg').reasons, ['license_not_allowed'])
  assert.deepEqual(v.get('Gone.jpg').reasons, ['missing'])
  const jinju = v.get('Jinju lantern festival.jpg')
  assert.equal(jinju.ok, true); assert.equal(jinju.row.rights_basis, 'kr_copyright_act_35_2_display')
  const off = await checkImages(items.slice(3, 4), { fetchJSON, policy: { ...DEFAULT_POLICY, krFopDisplay: false } })
  assert.deepEqual(off.get('Jinju lantern festival.jpg').reasons, ['kr_freedom_of_panorama_disabled'])
})

test('synced places that duplicate curated ones are recognised by name or host building', () => {
  const keys = curatedNameKeys([{ name_kr: '롯데월드타워 미디어파사드', name_en: 'Lotte World Tower Media Facade' }, { name_kr: '동대문디자인플라자(DDP) / 서울라이트', name_en: 'DDP / Seoul Light' }, { name_kr: 'N서울타워', name_en: 'N Seoul Tower' }])
  for (const n of ['롯데월드타워', 'Lotte World Tower', '동대문디자인플라자', 'N서울타워', 'N Seoul Tower']) assert.ok(keys.has(nameKey(n)), n)
  for (const n of ['진주남강유등축제', '광안대교', '서울']) assert.ok(!keys.has(nameKey(n)), n)
})

test('a saved synced place survives validation of stored data; sources are rebuilt from the QID', () => {
  const stored = { ...C.empty(), saved: ['WD-Q7937834'], routes: [{ id: 'r1', name: '코스', stops: ['WD-Q7937834'] }], candidates: [{
    place_id: 'WD-Q7937834', name_kr: '비비드 시드니', name_en: 'Vivid Sydney', short_description: '축제', origin: 'wikidata-sync', primary_category: 'Festival',
    categories: ['Festival', '<script>'], country: '오스트레일리아', city: '시드니', scope: 'world', latitude: -33.8688, longitude: 151.2093,
    website: 'javascript:alert(1)', image: 'Vivid Sydney 2019.jpg', sitelinks: 25, source_url: 'https://evil.example/', coordinate_source_url: 'https://evil.example/',
  }] }
  const out = C.validate(JSON.parse(JSON.stringify(stored)), [])
  assert.deepEqual(out.saved, ['WD-Q7937834']); assert.deepEqual(out.routes[0].stops, ['WD-Q7937834'])
  const c = out.candidates[0]
  assert.equal(c.origin, 'wikidata-sync'); assert.equal(c.wikidata, 'Q7937834'); assert.deepEqual(c.categories, ['Festival'])
  assert.equal(c.website, ''); assert.equal(c.source_url, 'https://www.wikidata.org/wiki/Q7937834'); assert.equal(c.coordinate_source_url, c.source_url)
  assert.equal(X.mappable(c), true)
  assert.equal(C.freshness(c).label, 'Wikidata 공동 편집 데이터')
})
