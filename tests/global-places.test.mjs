// Nationwide/worldwide Wikidata place sync: query building, parsing, merging, failure isolation and image rights.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import {
  BRANCHES, NEVER_QUERY_QIDS, NEVER_SHOW_QIDS, CITY_CLASSES, KOREA_CITY_CLASSES, CATEGORY_PRIORITY, KOREA_QID, buildBranchQuery, branchIdOf, parseWktPoint,
  parseBranch, mergeItems, primaryCategory, kindsOf, syncGlobal, carryOver, compactPlaces, expandPlaces, packPlaces, checkImages,
  curatedNameKeys, curatedIndex, isCuratedDuplicate, nameKey, httpsURL, cityName, KOREA_SEEDS,
  STATE_OF_USE, RECORD_VERSION, RECORD_LENGTH, yearOf, peopleOf, operatingStatus,
} from '../edge-functions/_shared/global-places.mjs'
import { assessRights, commonsInfoParams, fetchCommonsPages, foreignNoFop, syncLive, DEFAULT_POLICY, WDQS_URL, COMMONS_API } from '../edge-functions/_shared/live-media.mjs'
import { wdqsBranch, commonsPage, commonsResponse, KOREA, WORLD, JAPAN, FILES } from './fixtures/global-places-fixtures.mjs'

const require = createRequire(import.meta.url)
const X = require('../site-public-cleared/catalog.js')
const C = require('../site-public-cleared/core.js')
// The real curated catalogue (site-public-cleared/assets/seed.js).
const seedContext = { window: {} }
vm.runInNewContext(readFileSync(new URL('../site-public-cleared/assets/seed.js', import.meta.url), 'utf8'), seedContext)
const CURATED = seedContext.window.AOL_SEED.places

// Verified on wikidata.org (research-qids.json "verified" and "example_instances"). Every QID a query uses must be one of these.
const VERIFIED_CLASSES = ['Q17158007', 'Q4287692', 'Q1823448', 'Q1421557', 'Q1798004', 'Q131627422', 'Q29885984', 'Q776483', 'Q860372', 'Q378604', 'Q1386571', 'Q63442021', 'Q110409771', 'Q106561607', 'Q124414048', 'Q126682969', 'Q1658880', 'Q1653073', 'Q718636', 'Q132241', 'Q380051', 'Q1136999', 'Q926949', 'Q18088097', 'Q177305', 'Q1440300', 'Q6485102', 'Q557141', 'Q884']
// City-level unit classes, each checked on wikidata.org (item pages found by search, see CITY_CLASSES notes).
const VERIFIED_CITY_CLASSES = ['Q7574799', 'Q29045219', 'Q482821', 'Q16181672', 'Q29045252', 'Q12624746', 'Q515', 'Q1549591', 'Q200250', 'Q15284', 'Q494721', 'Q5327704', 'Q484170', 'Q1093829', 'Q262166']
const VERIFIED_INSTANCES = ['Q12859650', 'Q12618343', 'Q625724', 'Q5295847', 'Q255506', 'Q704504', 'Q494895', 'Q31179486', 'Q69134', 'Q485443', 'Q30275918', 'Q5001265', 'Q862790', 'Q136488464', 'Q7937834', 'Q4167', 'Q26156861', 'Q22087183', 'Q60749353', 'Q597137', 'Q796012', 'Q97613610', 'Q104235671', 'Q56255196', 'Q97366760', 'Q191212', 'Q7899954', 'Q125715', 'Q1636567', 'Q4923257', 'Q5977922', 'Q1068874', 'Q11235643', 'Q7676551', 'Q351126', 'Q1916349', 'Q135116725']
const LOOK_ALIKES = ['Q10957', 'Q1189512', 'Q7765824', 'Q24875628', 'Q19706461', 'Q12906101', 'Q7094057', 'Q210064', 'Q682010', 'Q496218', 'Q7937831', 'Q55736992', 'Q104383619', 'Q109905495']
// Curated places linked to Wikidata in the seed, each QID checked on wikidata.org ('host': the building the project is on).
const VERIFIED_CURATED = { SEOUL006: 'Q5295847', SEOUL018: 'Q494895 host', SEOUL022: 'Q494407 host', SEOUL025: 'Q27207690', SEOUL027: 'Q487498', SEOUL033: 'Q65248886 host', SEOUL035: 'Q7451676', SEOUL043: 'Q69134', SEOUL044: 'Q7451660', SEOUL045: 'Q255506 host', SEOUL046: 'Q30275918 host', SEOUL048: 'Q71829204' }
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
    for (const v of ['?label_ko', '?label_en', '?label_other', '?desc_ko', '?desc_en', '?coord', '?image', '?country', '?city', '?district', '?site', '?kind', '?sitelinks']) assert.ok(q.includes(v), `${b.id} selects ${v}`)
    for (const l of ['mul', 'ja', 'zh', 'de', 'fr', 'es']) assert.ok(q.includes(`FILTER(LANG(?l_${l}) = "${l}")`), `${b.id} falls back to ${l} labels`)
    assert.match(q, /wdt:P625/); assert.match(q, /wdt:P276/); assert.match(q, /wdt:P18/); assert.match(q, /wdt:P131/); assert.match(q, /wdt:P856/)
  }
})

test('queries use verified QIDs only, never a rejected look-alike', () => {
  const allowed = new Set([...VERIFIED_CLASSES, ...VERIFIED_INSTANCES, ...VERIFIED_CITY_CLASSES])
  const used = new Set()
  for (const b of BRANCHES) for (const q of qidsIn(buildBranchQuery(b))) { used.add(q); assert.ok(allowed.has(q), `${b.id} uses unverified ${q}`) }
  for (const q of LOOK_ALIKES) { assert.ok(!used.has(q), 'look-alike ' + q); assert.ok(NEVER_QUERY_QIDS.includes(q), 'listed as never-query: ' + q) }
  for (const q of ['Q17158007', 'Q4287692', 'Q1823448', 'Q1421557', 'Q776483', 'Q124414048', 'Q1658880', 'Q4167', 'Q7937834', 'Q60749353']) assert.ok(used.has(q), 'uses ' + q)
  assert.deepEqual(CITY_CLASSES.map(([q]) => q).sort(), [...VERIFIED_CITY_CLASSES].sort())
  for (const q of KOREA_CITY_CLASSES) assert.ok(CITY_CLASSES.some(([c]) => c === q), 'Korean city class ' + q + ' is a city class')
  for (const [q] of CITY_CLASSES) assert.ok(used.has(q), 'the city walk uses ' + q)
})

test('never-query and never-show are separate lists: only true look-alikes and duplicates are hidden', () => {
  assert.ok(NEVER_SHOW_QIDS.length <= 5, 'the never-show list stays short')
  for (const q of NEVER_SHOW_QIDS) assert.ok(NEVER_QUERY_QIDS.includes(q), q + ' is never queried either')
  assert.ok(NEVER_SHOW_QIDS.includes('Q104383619'), 'the unlabeled teamLab Borderless duplicate')
  for (const q of ['Q109905495', 'Q496218', 'Q7937831', 'Q55736992']) assert.ok(!NEVER_SHOW_QIDS.includes(q), q + ' is shown when a query returns it')
  const row = { coord: 'Point(129.16 35.16)', country: 'Q884|대한민국', kind: 'Nightscape', en: 'x' }
  const { items, dropped } = parseBranch(wdqsBranch([{ ...row, qid: 'Q109905495', en: 'BUSAN X the SKY' }, { ...row, qid: 'Q104383619' }, { ...row, qid: 'Q10957' }]), 'korea:classes')
  assert.deepEqual(items.map(i => i.qid), ['Q109905495']); assert.equal(dropped, 2)
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
    WORLD.vivid, KOREA.gwangan, WORLD.xss, WORLD.jaOnly,
    { qid: 'Q1', ko: '좌표 없음', kind: 'Festival' },
    { qid: 'Q2', ko: '분류 없음', coord: 'Point(1 2)', kind: 'Something else' },
    { qid: 'Q10957', en: 'Lumière Festival (film)', coord: 'Point(4.8 45.7)', kind: 'Festival' },
    WORLD.noLabel,
  ])
  const { items, dropped } = parseBranch(json, 'world:seeds')
  assert.equal(dropped, 4)
  const [vivid, gwangan, xss, ja] = items
  assert.deepEqual(vivid.coord, { lat: -33.8688, lon: 151.2093 })
  assert.equal(vivid.image, 'Vivid Sydney 2019.jpg')
  assert.equal(vivid.countryQid, 'Q408'); assert.equal(vivid.countryLabel, '오스트레일리아')
  assert.equal(vivid.website, 'https://www.vividsydney.com/')
  assert.equal(gwangan.website, '', 'http websites are dropped')
  assert.equal(gwangan.countryLabel, '대한민국')
  assert.deepEqual([gwangan.city, gwangan.cityQid, gwangan.district], ['부산', 'Q16520', '수영구'], 'city-level unit and the district below it')
  assert.deepEqual([vivid.city, vivid.cityQid, vivid.district], ['시드니', 'Q3130', ''])
  assert.deepEqual([ja.labelOther, ja.city, ja.cityQid, ja.district], ['光のアート回廊', '오사카시', '', ''], 'no city-level unit: the admin unit stands in')
  // ?city/?district carry the walk's rank and the city QID; a district that does not belong to the city is not used.
  const raw = wdqsBranch([KOREA.lantern]).results.bindings[0]
  const lone = parseBranch({ results: { bindings: [{ ...raw, city: { type: 'literal', value: '5Q8684|서울특별시' }, district: { type: 'literal', value: '5Q16520|수영구' } }] } }, 'korea:seeds').items[0]
  assert.deepEqual([lone.city, lone.cityQid, lone.district], ['서울', 'Q8684', ''])
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
  const [ja] = mergeItems([parseBranch(wdqsBranch([WORLD.jaOnly]), 'world:classes-art').items])
  assert.equal(ja.name_kr, '光のアート回廊', 'another language when there is neither'); assert.equal(ja.name_en, '')
  assert.deepEqual(X.search([ja], { q: '光のアート' }, '2026-10-13').map(p => p.wikidata), ['Q99200001'], 'and name search finds it')
})

test('city: Korean special/metropolitan cities get their short name; Seoul places group under 서울 with the curated ones', () => {
  assert.equal(cityName('Q8684', '서울특별시'), '서울'); assert.equal(cityName('Q8684', 'Seoul'), '서울')
  assert.equal(cityName('Q16520', '부산광역시'), '부산'); assert.equal(cityName('Q20929', '세종특별자치시'), '세종')
  assert.equal(cityName('Q42144', '진주시'), '진주시'); assert.equal(cityName('Q3130', '시드니'), '시드니')
  const places = mergeItems([parseBranch(wdqsBranch([KOREA.lantern, KOREA.gwangan, KOREA.busanSky, KOREA.jinju]), 'korea:classes').items])
  const regions = new Map()
  for (const p of [...CURATED, ...places]) { const r = X.region(p), k = r.country + ' ' + r.city; regions.set(k, (regions.get(k) || 0) + 1) }
  assert.equal(regions.get('대한민국 서울'), CURATED.length + 1, 'the synced Seoul festival counts with the curated Seoul places')
  assert.equal(regions.get('대한민국 부산'), 2, 'two districts of Busan, one city')
  assert.ok(![...regions.keys()].some(k => /중구|수영구|해운대구/.test(k)), 'districts are not cities')
  const lantern = places.find(p => p.wikidata === 'Q12859650')
  assert.deepEqual([lantern.city, lantern.district, lantern.city_qid], ['서울', '중구', 'Q8684'])
  assert.deepEqual(X.search(places, { q: '수영구' }, '2026-10-13').map(p => p.wikidata), ['Q485443'], 'the district is searchable')
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
  const places = mergeItems([
    parseBranch(wdqsBranch([WORLD.vivid, KOREA.jinju, KOREA.gwangan, WORLD.graz, WORLD.jaOnly, ...JAPAN]), 'world:seeds').items,
    parseBranch(wdqsBranch([{ ...KOREA.gwangan, kind: 'Nightscape' }]), 'korea:classes').items,
  ])
  const rows = compactPlaces(places)
  const back = expandPlaces(JSON.parse(JSON.stringify(rows)))
  assert.deepEqual(back, places)
  assert.deepEqual(back.find(p => p.wikidata === 'Q485443').branches, ['world:seeds', 'korea:classes'], 'branch ids survive as indexes')
  assert.ok(JSON.stringify(rows).length / places.length < 200, 'well under 200 characters a place')
  assert.deepEqual(expandPlaces([['Q104383619', 'x', '', '', '1', '', '', '', 1, 1, '', '', 0, ''], ['Q5', '', '', '', '1', '', '', '', 1, 1, '', '', 0, ''], 'junk', ['bad']]), [], 'never-show QIDs, nameless rows and junk never come back from storage')
})

// v0.16: the archive facts Wikidata states (docs/ARCHIVE_SPEC.md §6), each with field state source_reported.
test('archive facts are parsed from the query columns, merged across branches and labelled source_reported', () => {
  const [vivid] = parseBranch(wdqsBranch([WORLD.vivid]), 'world:seeds').items
  assert.equal(vivid.inception, 2009)
  assert.equal(vivid.countryIso, 'AU')
  assert.deepEqual(vivid.operators, [{ qid: 'Q99500010', name: 'Destination NSW' }])
  assert.deepEqual(vivid.stateOfUse, ['Q55654238'])
  const [p] = mergeItems([[vivid]])
  assert.equal(p.year_completed, 2009)
  assert.equal(p.country_iso2, 'AU')
  assert.deepEqual(p.credits, [{ role: 'operator', name: 'Destination NSW', qid: 'Q99500010' }])
  assert.equal(p.operating_status, 'operating')
  assert.equal(p.official_url, 'https://www.vividsydney.com/')
  assert.deepEqual(p.field_status, { year_completed: { state: 'source_reported' }, country_iso2: { state: 'source_reported' }, credits: { state: 'source_reported' }, operating_status: { state: 'source_reported' }, official_url: { state: 'source_reported' } })
  // The ISO code must belong to the item's reported country, never to a second P17 value.
  const [two] = parseBranch(wdqsBranch([{ ...WORLD.graz, iso: 'Q183|DE Q40|AT' }]), 'world:seeds').items
  assert.equal(two.countryIso, 'AT')
  const [other] = parseBranch(wdqsBranch([{ ...WORLD.graz, iso: 'Q183|DE' }]), 'world:seeds').items
  assert.equal(other.countryIso, '', 'no code for the reported country: none')
  // Nothing stated, nothing filled: no guessed year, status or people.
  const [plain] = mergeItems([parseBranch(wdqsBranch([KOREA.jinju]), 'korea:seeds').items])
  assert.deepEqual([plain.year_completed, plain.country_iso2, plain.credits, plain.operating_status, plain.official_url, plain.field_status], [null, null, [], null, null, {}])
  // Merging: the first non-empty value wins; states of use are unioned; a Korean branch pins the Korean code.
  const merged = mergeItems([
    parseBranch(wdqsBranch([{ ...WORLD.graz, stateOfUse: ['Q55654238'] }]), 'world:seeds').items,
    parseBranch(wdqsBranch([{ ...WORLD.graz, inception: '1999-01-01T00:00:00Z', architects: ['Q1|Someone else'], stateOfUse: ['Q104664889'] }]), 'world:parts').items,
  ])[0]
  assert.equal(merged.year_completed, 2003)
  assert.deepEqual(merged.credits.map(c => c.name), ['Peter Cook', 'Colin Fournier'])
  assert.deepEqual(merged.state_of_use, ['Q55654238', 'Q104664889'])
  assert.equal(merged.operating_status, null, 'in use and permanently closed disagree')
  const korean = mergeItems([
    parseBranch(wdqsBranch([{ ...KOREA.gwangan, country: 'Q17|일본', iso: 'Q17|JP' }]), 'world:classes-art').items,
    parseBranch(wdqsBranch([{ ...KOREA.gwangan, iso: 'Q884|KR' }]), 'korea:classes').items,
  ])[0]
  assert.deepEqual([korean.country, korean.country_iso2], ['대한민국', 'KR'])
})

test('archive fact helpers: years, people and the verified state-of-use map', () => {
  assert.equal(yearOf('2014-03-21T00:00:00Z'), 2014)
  assert.equal(yearOf('+2014-03-21T00:00:00Z'), 2014)
  assert.equal(yearOf('-0500-01-01T00:00:00Z'), -500)
  for (const bad of ['', null, 'soon', '2014', 'http://x/2014-01-01']) assert.equal(yearOf(bad), null, String(bad))
  assert.deepEqual(peopleOf('Q1|A\tQ2|\tbad|B\tQ1|A again\tQ3|<b>C</b>'), [{ qid: 'Q1', name: 'A' }, { qid: 'Q3', name: 'C' }])
  assert.deepEqual(Object.keys(STATE_OF_USE).sort(), ['Q104664889', 'Q55570821', 'Q55653430', 'Q55654238', 'Q56556915'], 'only values checked on wikidata.org')
  const allowed = new Set(require('../site-public-cleared/archive-taxonomy.js').keys('operating_status'))
  for (const v of Object.values(STATE_OF_USE)) assert.ok(allowed.has(v), v)
  assert.equal(operatingStatus(['Q55570340']), null, 'closed to the public is not mapped')
  assert.equal(operatingStatus(['Q55654238', 'Q55570821']), 'operating', 'two values with the same status')
  assert.equal(operatingStatus([]), null)
})

test('the compact record is versioned: v2 round-trips the archive facts, v1 records from v0.15 still load', () => {
  const places = mergeItems([parseBranch(wdqsBranch([WORLD.vivid, WORLD.graz, KOREA.jinju]), 'world:seeds').items])
  const rows = compactPlaces(places)
  assert.equal(RECORD_VERSION, 2)
  assert.ok(rows.every(r => r.length === RECORD_LENGTH[2]))
  assert.deepEqual(expandPlaces(JSON.parse(JSON.stringify(rows))), places)
  // A v0.15 record (16 fields), as stored in browsers and in discovered_places before this version.
  const v1 = rows.map(r => r.slice(0, RECORD_LENGTH[1]))
  const old = expandPlaces(v1)
  assert.deepEqual(old.map(p => p.wikidata), places.map(p => p.wikidata))
  assert.deepEqual(old.map(p => [p.name_kr, p.country, p.city, p.latitude, p.longitude, p.website]), places.map(p => [p.name_kr, p.country, p.city, p.latitude, p.longitude, p.website]))
  for (const p of old) assert.deepEqual([p.year_completed, p.country_iso2, p.credits, p.operating_status], [null, null, [], null])
  assert.equal(old.find(p => p.wikidata === 'Q7937834').official_url, 'https://www.vividsydney.com/', 'the website was already stored')
  // Junk in the new positions is ignored, never shown.
  const junk = [...rows[0].slice(0, 16), 'x', 'korea', [['bad', 'A'], ['Q1', '']], 'no', null, 'Q1 bad']
  const [j] = expandPlaces([junk])
  assert.deepEqual([j.year_completed, j.country_iso2, j.credits, j.state_of_use], [null, null, [], ['Q1']])
})

test('storage packing keeps every Korean and every saved place, shortening descriptions before dropping anything', () => {
  const desc = '세계 여러 도시의 빛 축제와 미디어파사드, 라이트아트 설치 작품에 대한 꽤 긴 설명 문장입니다. '.repeat(3)
  const world = Array.from({ length: 300 }, (_, i) => ({ qid: 'Q9930' + String(i).padStart(4, '0'), ko: '세계의 빛 ' + i, en: 'World light place number ' + i, dko: desc, coord: 'Point(10 10)', image: `World light ${i}.jpg`, country: 'Q142|프랑스', city: 'Q90|파리', site: 'https://example.org/' + i, kind: 'Light Art', sitelinks: 10 + (i % 50) }))
  const korea = Array.from({ length: 40 }, (_, i) => ({ qid: 'Q9940' + String(i).padStart(4, '0'), ko: '어느 지역 빛 축제 ' + i, dko: desc, coord: 'Point(127 36)', country: 'Q884|대한민국', city: 'Q42144|진주시', kind: 'Festival', sitelinks: 0 }))
  const places = mergeItems([parseBranch(wdqsBranch([...world, ...korea]), 'world:classes-art').items])
  const saved = 'WD-' + world[0].qid // sitelinks 10: among the least linked abroad
  const size = rows => rows.reduce((n, r) => n + JSON.stringify(r).length + 1, 0)
  const full = packPlaces(places, { maxChars: 1e7 })
  assert.equal(full.truncated, false); assert.equal(full.shortened, false); assert.equal(full.rows.length, places.length)
  const fullSize = size(full.rows)
  // Tight enough that descriptions must be shortened, roomy enough that every place still fits.
  const shortened = packPlaces(places, { maxChars: Math.floor(fullSize * 0.6) })
  assert.equal(shortened.truncated, false); assert.equal(shortened.shortened, true); assert.equal(shortened.rows.length, places.length)
  assert.ok(shortened.rows.every(r => r[3].length <= 60))
  // Too tight even without descriptions: places are dropped, the least linked abroad first.
  const budget = Math.floor(fullSize * 0.2)
  const cut = packPlaces(places, { maxChars: budget, keepIds: new Set([saved]) })
  assert.equal(cut.truncated, true)
  assert.ok(size(cut.rows) <= budget)
  const back = expandPlaces(cut.rows, cut.branchIds)
  assert.equal(back.filter(p => p.scope === 'korea').length, korea.length, 'every Korean place is kept')
  assert.ok(back.some(p => p.place_id === saved), 'the saved place is kept although few places abroad are linked less')
  assert.ok(back.length < places.length)
  const keptWorld = back.filter(p => p.scope === 'world' && p.place_id !== saved).map(p => p.sitelinks)
  const droppedWorld = places.filter(p => p.scope === 'world' && !back.some(b => b.place_id === p.place_id)).map(p => p.sitelinks)
  assert.ok(droppedWorld.length > 0 && Math.min(...keptWorld) >= Math.max(...droppedWorld), 'abroad, the most-linked places are kept')
})

// A stand-in for the Commons API (action=query, prop=imageinfo|templates, formatversion=2) that honours what the real
// one does with the request: tltemplates ("only these names"), tlnamespace, a page size for templates, continuation.
function commonsApi(files, { pageSize = 4, neverEnds = false } = {}) {
  const requests = []
  const fetchJSON = async url => {
    const u = new URL(url)
    assert.equal(u.origin + u.pathname, COMMONS_API)
    const q = u.searchParams
    requests.push(q)
    const titles = q.get('titles').split('|')
    const only = q.get('tltemplates') ? new Set(q.get('tltemplates').split('|')) : null
    const ns = q.get('tlnamespace')
    const lists = titles.map(t => (files[t.replace(/^File:/, '')]?.templates || []).filter(x => (!only || only.has(x)) && (!ns || ns === '10')))
    const offset = Number(q.get('tlcontinue') || 0)
    const slice = lists.flatMap((l, i) => l.map(title => [i, title])).slice(offset, offset + pageSize)
    const total = lists.reduce((n, l) => n + l.length, 0)
    const pages = titles.map((t, i) => {
      const f = files[t.replace(/^File:/, '')]
      if (!f) return { title: t, missing: true }
      return { title: t, ...(offset ? {} : { imageinfo: commonsPage(f).imageinfo }), templates: slice.filter(([j]) => j === i).map(([, title]) => ({ ns: 10, title })) }
    })
    const more = neverEnds || offset + pageSize < total
    return { ...(more ? { continue: { tlcontinue: String(offset + pageSize), continue: '||imageinfo' } } : { batchcomplete: true }), query: { pages } }
  }
  return { fetchJSON, requests }
}

test('image rights: the Commons request asks for every template, so any foreign no-FoP tag blocks', async () => {
  const params = commonsInfoParams(['A.jpg'])
  assert.equal(params.get('tltemplates'), null, 'no exact-name filter: it would hide every tag not on a list')
  assert.equal(params.get('tlnamespace'), '10'); assert.equal(params.get('tllimit'), 'max')
  const filler = Array.from({ length: 9 }, (_, i) => 'Template:Information/helper ' + i)
  const files = {
    // A country tag that is on no list anywhere in the code, at the end of a long template list (after continuation).
    'Thai temple at night.jpg': { artist: 'A', license: 'CC BY-SA 4.0', templates: [...filler, 'Template:Self', 'Template:NoFoP-Thailand'] },
    'Cairo tower.jpg': { artist: 'B', license: 'CC BY 4.0', templates: ['Template:NoFoP-Egypt/layout', 'Template:NoFoP-Egypt'] },
    // South Korea's own tag and its layout/translation subpages follow the display policy; they are not foreign.
    'Seoul tower.jpg': { artist: 'C', license: 'CC BY 2.0', templates: ['Template:NoFoP-South Korea', 'Template:NoFoP-South Korea/layout', 'Template:NoFoP-South Korea/en', ...filler] },
    'Free bridge.jpg': { artist: 'D', license: 'CC0', templates: filler },
  }
  const api = commonsApi(files)
  const items = Object.keys(files).map((image, i) => ({ place_id: 'WD-Q' + (900 + i), wikidata: 'Q' + (900 + i), image }))
  const v = await checkImages(items, { fetchJSON: api.fetchJSON, now: '2026-10-13T00:00:00.000Z' })
  assert.ok(api.requests.length > 3, 'the template list spans several responses and every one is followed')
  assert.ok(api.requests.every(q => !q.has('tltemplates')))
  assert.deepEqual(v.get('Thai temple at night.jpg').reasons, ['foreign_no_freedom_of_panorama'])
  assert.deepEqual(v.get('Cairo tower.jpg').reasons, ['foreign_no_freedom_of_panorama'])
  assert.equal(v.get('Seoul tower.jpg').ok, true); assert.equal(v.get('Seoul tower.jpg').row.rights_basis, 'kr_copyright_act_35_2_display')
  assert.equal(v.get('Free bridge.jpg').ok, true)
  const off = await checkImages(items.slice(2, 3), { fetchJSON: commonsApi(files).fetchJSON, policy: { ...DEFAULT_POLICY, krFopDisplay: false } })
  assert.deepEqual(off.get('Seoul tower.jpg').reasons, ['kr_freedom_of_panorama_disabled'])
  // The curated-place photo sync goes through the same request and the same check.
  const live = await syncLive({
    places: [{ place_id: 'SEOUL900', name_kr: '태국 사원', wikidata: 'Q900' }],
    now: 'n',
    fetchJSON: async (url, init) => url === WDQS_URL
      ? { results: { bindings: [{ item: { type: 'uri', value: 'http://www.wikidata.org/entity/Q900' }, image: { type: 'uri', value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Thai%20temple%20at%20night.jpg' } }] } }
      : api.fetchJSON(url, init),
  })
  assert.equal(live.media.length, 0)
  assert.deepEqual(live.stats.rejected.map(x => x.reasons), [['foreign_no_freedom_of_panorama']])
  assert.equal(foreignNoFop(['Template:NoFoP-South Korea/ko']), false); assert.equal(foreignNoFop(['Template:NoFoP-Atlantis']), true)
})

test('image rights: a template list that never completes blocks the photo instead of guessing', async () => {
  const files = { 'Endless.jpg': { artist: 'E', license: 'CC0', templates: ['Template:Self', 'Template:Information'] } }
  const api = commonsApi(files, { pageSize: 1, neverEnds: true })
  const pages = await fetchCommonsPages(['Endless.jpg'], api.fetchJSON, { maxRounds: 3 })
  assert.equal(api.requests.length, 3)
  assert.equal(pages.get('Endless.jpg').templatesComplete, false)
  const v = await checkImages([{ place_id: 'WD-Q1', wikidata: 'Q1', image: 'Endless.jpg' }], { fetchJSON: commonsApi(files, { pageSize: 1, neverEnds: true }).fetchJSON })
  assert.deepEqual(v.get('Endless.jpg').reasons, ['commons_templates_incomplete'])
})

test('image rights: licenses, deletion tags, missing files, attribution and batches of 50', async () => {
  assert.equal(assessRights({ license: 'CC BY-SA 4.0', mime: 'image/jpeg', templates: ['Template:NoFoP-France'] }).ok, false)
  assert.equal(assessRights({ license: 'CC BY-SA 4.0', mime: 'image/jpeg', templates: ['Template:NoFoP-South Korea'] }).ok, true)
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

test('curated places carry verified Wikidata QIDs; synced duplicates of the real catalogue are hidden', () => {
  const linked = Object.fromEntries(CURATED.filter(p => p.wikidata).map(p => [p.place_id, p.wikidata + (p.wikidata_match === 'host' ? ' host' : '')]))
  assert.deepEqual(linked, VERIFIED_CURATED, 'only QIDs checked on wikidata.org')
  for (const p of CURATED) if (p.wikidata_match) assert.equal(p.wikidata_match, 'host')
  const index = curatedIndex(CURATED)
  const synced = rows => mergeItems([parseBranch(wdqsBranch(rows), 'korea:seeds').items])
  // The Korean seed items that are curated places, with the labels Wikidata gives them: hidden by QID.
  const dups = synced([KOREA.ddp, KOREA.lotteTower, KOREA.nTower, KOREA.banpo, KOREA.seoullo])
  assert.equal(dups.length, 5)
  for (const p of dups) assert.ok(isCuratedDuplicate(p, index), p.name_kr)
  const curatedQids = new Set(Object.values(VERIFIED_CURATED).map(v => v.split(' ')[0]))
  assert.deepEqual(KOREA_SEEDS.map(([q]) => q).filter(q => curatedQids.has(q)).sort(), ['Q255506', 'Q30275918', 'Q494895', 'Q5295847', 'Q69134'])
  // Name rules still cover curated places without a QID (exact name, host building).
  const named = synced([{ ...KOREA.lantern, qid: 'Q99500001', ko: '아뜰리에 노들', en: '' }, { ...KOREA.lantern, qid: 'Q99500002', ko: '갤러리아 명품관 WEST', en: '' }])
  for (const p of named) assert.ok(isCuratedDuplicate(p, index), p.name_kr)
  // Different places stay: other Korean seeds and similar but different names.
  const others = synced([KOREA.jinju, KOREA.gwangan, KOREA.lantern, KOREA.busanSky,
    { ...KOREA.lantern, qid: 'Q31179486', ko: '서울스카이', en: 'Seoul Sky' }, { ...KOREA.lantern, qid: 'Q704504', ko: '잠수교', en: 'Jamsu Bridge' }])
  assert.equal(others.length, 6)
  for (const p of others) assert.ok(!isCuratedDuplicate(p, index), p.name_kr)
  assert.ok(!isCuratedDuplicate({ ...others[0], scope: 'world', name_kr: '아뜰리에 노들' }, index), 'names only hide Korean places')
  const keys = curatedNameKeys(CURATED)
  for (const n of ['롯데월드타워', 'Lotte World Tower', '동대문디자인플라자', 'N서울타워', 'N Seoul Tower']) assert.ok(keys.has(nameKey(n)), n)
  for (const n of ['진주남강유등축제', '광안대교', '서울']) assert.ok(!keys.has(nameKey(n)), n)
})

test('a saved synced place survives validation of stored data; sources are rebuilt from the QID', () => {
  const stored = { ...C.empty(), saved: ['WD-Q7937834'], routes: [{ id: 'r1', name: '코스', stops: ['WD-Q7937834'] }], candidates: [{
    place_id: 'WD-Q7937834', name_kr: '비비드 시드니', name_en: 'Vivid Sydney', short_description: '축제', origin: 'wikidata-sync', primary_category: 'Festival',
    categories: ['Festival', '<script>'], country: '오스트레일리아', city: '시드니', scope: 'world', latitude: -33.8688, longitude: 151.2093,
    website: 'javascript:alert(1)', image: 'Vivid Sydney 2019.jpg', sitelinks: 25, source_url: 'https://evil.example/', coordinate_source_url: 'https://evil.example/',
    district: '<b>', city_qid: 'Q3130 OR 1',
  }] }
  const out = C.validate(JSON.parse(JSON.stringify(stored)), [])
  assert.deepEqual(out.saved, ['WD-Q7937834']); assert.deepEqual(out.routes[0].stops, ['WD-Q7937834'])
  const c = out.candidates[0]
  assert.equal(c.origin, 'wikidata-sync'); assert.equal(c.wikidata, 'Q7937834'); assert.deepEqual(c.categories, ['Festival'])
  assert.equal(c.website, ''); assert.equal(c.source_url, 'https://www.wikidata.org/wiki/Q7937834'); assert.equal(c.coordinate_source_url, c.source_url)
  assert.equal(c.district, '<b>', 'kept as text (escaped when shown)'); assert.equal(c.city_qid, '', 'not a QID')
  assert.equal(X.mappable(c), true)
  assert.equal(C.freshness(c).label, 'Wikidata 공동 편집 데이터')
})
