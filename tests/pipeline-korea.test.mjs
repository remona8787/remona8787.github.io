// Korea first (docs/STATIC_ARCHIVE.md v0.18 addendum): kr_region from the P131 chain, the gazetteer and TourAPI codes
// (never guessed), the live first-level divisions, TourAPI KorService2 discovery and its licences, Korean sources
// ahead of foreign ones in every shared queue and budget, and a working record for every Korean project.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import T from '../site-public-cleared/archive-taxonomy.js'
import { loadKoreaConfig, compileGazetteer, regionFromText, discoverKrDivisions, krRegionOf, p131Chain, KR_REGIONS } from '../pipeline/lib/korea.mjs'
import { itemsOf, tourItem, classifyTourItem, koglOf, serviceKey, homepageOf, discoverTourApi, tourUrl, detailImages, galleryPhotos } from '../pipeline/lib/tourapi.mjs'
import { createClient } from '../pipeline/lib/net.mjs'
import { Cache } from '../pipeline/lib/cache.mjs'
import { redactKeys } from '../pipeline/lib/util.mjs'
import { runPipeline, loadConfig } from '../pipeline/run.mjs'
import { loadSharp } from '../pipeline/lib/visual.mjs'
import { fixtureEnvironment, FIXTURE_OVERRIDES, FIXTURE_ENV } from './fixtures/pipeline/fake-fetch.mjs'

const KC = loadKoreaConfig()
const GAZ = compileGazetteer(KC)
const FIX = path.join(import.meta.dirname, 'fixtures/pipeline')
const SHARP = await loadSharp().then(() => true, () => false)
const needSharp = SHARP ? {} : { skip: 'sharp is not installed (npm ci --prefix pipeline)' }
const region = (...t) => regionFromText(t, GAZ).region

test('kr_region vocabulary: eight keys with Korean and English labels, the same list as the pipeline', () => {
  assert.deepEqual(T.keys('kr_region'), KR_REGIONS)
  for (const k of KR_REGIONS) assert.ok(T.label('kr_region', k, 'ko') && T.label('kr_region', k, 'en'), k)
  assert.equal(T.label('kr_region', 'daejeon_sejong_chungcheong', 'ko'), '대전·세종·충청')
  assert.deepEqual(KC.regions.map((r) => r.key), KR_REGIONS)
  // Every ISO 3166-2 code belongs to one region only.
  const iso = KC.regions.flatMap((r) => r.iso)
  assert.equal(new Set(iso).size, iso.length)
})

test('gazetteer: addresses, cities and districts in Korean and English; ambiguous names never decide', () => {
  assert.equal(region('서울특별시 송파구 올림픽로 300'), 'seoul')
  assert.equal(region('경기도 수원시 팔달구'), 'gyeonggi_incheon')
  assert.equal(region('인천광역시 연수구 송도동'), 'gyeonggi_incheon')
  assert.equal(region('강원특별자치도 강릉시'), 'gangwon')
  assert.equal(region('충남 천안시 서북구'), 'daejeon_sejong_chungcheong')
  assert.equal(region('세종특별자치시 한누리대로'), 'daejeon_sejong_chungcheong')
  assert.equal(region('전북특별자치도 전주시 완산구'), 'gwangju_jeolla')
  assert.equal(region('전남광주특별시 동구'), 'gwangju_jeolla')
  assert.equal(region('경상북도 경주시'), 'daegu_gyeongbuk')
  assert.equal(region('부산광역시 해운대구 우동'), 'busan_ulsan_gyeongnam')
  assert.equal(region('제주특별자치도 서귀포시 중문동'), 'jeju')
  assert.equal(region('Haeundae-gu, Busan'), 'busan_ulsan_gyeongnam')
  assert.equal(region('Gangnam District'), 'seoul')
  assert.equal(region('Suwon-si'), 'gyeonggi_incheon')
  assert.equal(region('South Gyeongsang Province'), 'busan_ulsan_gyeongnam')
  assert.equal(region('North Gyeongsang Province'), 'daegu_gyeongbuk')
  assert.equal(region('Jeju City'), 'jeju')
  // Never decided by an ambiguous name alone.
  assert.equal(region('중구'), null, 'a Jung-gu exists in six cities')
  assert.equal(region('광주시'), null, 'Gwangju the metropolitan city, or Gwangju in Gyeonggi')
  assert.equal(region('Gwangju'), null)
  assert.equal(region('고성군'), null, 'Goseong is in Gangwon and in Gyeongnam')
  assert.equal(region('Goseong County'), null)
  // A division name decides over a city name; a conflict between divisions gives nothing.
  assert.equal(region('경기도 광주시 퇴촌면'), 'gyeonggi_incheon')
  assert.equal(regionFromText(['서울특별시', '부산광역시'], GAZ).region, null)
  assert.match(regionFromText(['서울특별시', '부산광역시'], GAZ).conflict, /^division:busan_ulsan_gyeongnam\|seoul$/)
  // Street names are not cities: 영동대로 is a road in Seoul, not Yeongdong County.
  assert.equal(region('강남구 영동대로 513'), 'seoul')
  assert.equal(region('Seoul Light DDP'), 'seoul')
  assert.equal(region('Tokyo'), null)
})

function client(fetchImpl) {
  const env = fixtureEnvironment()
  return { env, client: createClient({ fetch: fetchImpl || env.fetch, clock: env.clock, sleep: env.sleep }) }
}

test('first-level divisions: read live, mapped by ISO 3166-2 code or by label, compared with the expectations', async () => {
  const { client: c } = client()
  const d = await discoverKrDivisions(c, KC, { cache: new Cache() })
  assert.equal(d.from, 'live')
  const by = Object.fromEntries(d.divisions.map((x) => [x.qid, x]))
  assert.equal(by.Q8684.region, 'seoul')
  assert.equal(by.Q8684.reason, 'iso_3166_2')
  assert.equal(by.Q41283.end, '2026-07-01', 'the end of a division is kept (Gwangju merged in 2026)')
  assert.equal(by.Q41283.region, 'gwangju_jeolla')
  assert.equal(by.Q99000415.region, 'gwangju_jeolla', 'the merged city has no ISO code yet: its label decides')
  assert.match(by.Q99000415.reason, /^label/)
  assert.equal(d.confirmed.get('Q16520'), 'busan_ulsan_gyeongnam')
  const exp = Object.fromEntries(d.expected.map((x) => [x.expected_qid, x.live]))
  assert.equal(exp.Q8684, 'confirmed')
  assert.equal(exp.Q20937, 'not_in_live_answer', 'an expectation the live answer does not hold is reported, never used')
  // Properties that the run could not confirm: nothing is used.
  const off = await discoverKrDivisions(c, KC, { cache: new Cache(), properties: new Map([['P150', false]]) })
  assert.equal(off.confirmed.size, 0)
  assert.match(off.errors[0].message, /P150/)
  // A failed query uses the last answer (stale cache), never the configured QIDs.
  const env = fixtureEnvironment()
  const cache = new Cache({ clock: env.clock })
  await discoverKrDivisions(createClient({ fetch: env.fetch, clock: env.clock, sleep: env.sleep, cache }), KC, { cache })
  env.advance(400 * 24 * 3600e3)
  const down = createClient({ fetch: async () => { throw new TypeError('fetch failed') }, clock: env.clock, sleep: env.sleep, cache })
  const stale = await discoverKrDivisions(down, KC, { cache })
  assert.equal(stale.from, 'stale_cache')
  assert.equal(stale.confirmed.get('Q8684'), 'seoul')
  const none = await discoverKrDivisions(down, KC, { cache: new Cache() })
  assert.equal(none.from, 'none')
  assert.equal(none.confirmed.size, 0)
})

test('kr_region rules: editorial, curated Seoul, the P131 chain, its labels, TourAPI codes, the address; otherwise null', () => {
  const aux = new Map([
    ['Q99000413', { en: 'Haeundae District', ko: '해운대구', p131: ['Q16520'], p31: [], p17: ['Q884'] }],
    ['Q16520', { en: 'Busan', ko: '부산광역시', p131: [], p31: [], p17: ['Q884'] }],
    ['Q90000001', { en: 'Some District', ko: '어느구', p131: ['Q90000002'], p31: [], p17: [] }],
    ['Q90000002', { en: 'South Jeolla', ko: '전라남도', p131: [], p31: [], p17: [] }],
  ])
  const confirmed = new Map([['Q16520', 'busan_ulsan_gyeongnam']])
  const of = (p, facts = null) => krRegionOf({ country_iso2: 'KR', ...p }, { facts, auxMap: aux, confirmed, gaz: GAZ, cfg: KC })
  assert.deepEqual(p131Chain(['Q99000413'], aux), ['Q99000413', 'Q16520'])
  assert.deepEqual(of({}, { p131: ['Q99000413'] }), { region: 'busan_ulsan_gyeongnam', rule: 'p131', via: 'Q16520' })
  assert.equal(of({}, { p131: ['Q90000001'] }).rule, 'p131_labels', 'an unconfirmed division is read by its label')
  assert.equal(of({}, { p131: ['Q90000001'] }).region, 'gwangju_jeolla')
  assert.deepEqual(of({ curated_id: 'SEOUL017' }), { region: 'seoul', rule: 'curated_seoul' })
  assert.equal(of({ curated_id: 'SEOUL017', kr_region_edit: 'gyeonggi_incheon' }).region, 'gyeonggi_incheon', 'an editorial edit wins')
  // TourAPI: the legal-dong code, then the area code; code 31 is Ulsan as lDongRegnCd but Gyeonggi as areacode.
  assert.equal(of({ tourapi: { ldong: '31' } }).region, 'busan_ulsan_gyeongnam')
  assert.equal(of({ tourapi: { areacode: '31' } }).region, 'gyeonggi_incheon')
  assert.equal(of({ tourapi: { ldong: '31' } }).rule, 'tourapi_ldong')
  assert.equal(of({ tourapi: { ldong: '11', addr1: '부산광역시 중구' } }).rule, 'tourapi_conflict', 'a code against the address: nothing')
  assert.equal(of({ tourapi: { ldong: '99', addr1: '부산광역시 중구 광복로' } }).region, 'busan_ulsan_gyeongnam', 'an unknown code: the address')
  assert.equal(of({ address: '경기도 성남시 분당구' }).region, 'gyeonggi_incheon')
  assert.equal(of({ city: 'Gangneung' }).region, 'gangwon')
  assert.deepEqual(of({ city: 'Gwangju' }), { region: null, rule: 'unknown', conflict: undefined })
  assert.equal(of({}).region, null)
  assert.equal(krRegionOf({ country_iso2: 'JP', city: 'Seoul' }, { gaz: GAZ, cfg: KC }).region, null, 'only Korean projects have a region')
})

test('TourAPI: answers, items, licences and keys', () => {
  assert.deepEqual(itemsOf({ response: { header: { resultCode: '0000', resultMsg: 'OK' }, body: { items: '', numOfRows: 10, pageNo: 1, totalCount: 0 } } }).items, [], 'no items is an empty string')
  assert.equal(itemsOf({ response: { header: { resultCode: '0000' }, body: { items: { item: { contentid: '1', title: 'x' } }, totalCount: 1 } } }).items.length, 1, 'a single item may be an object')
  assert.throws(() => itemsOf({ response: { header: { resultCode: '30', resultMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } } }), /SERVICE_KEY_IS_NOT_REGISTERED_ERROR/)
  assert.throws(() => itemsOf({ resultCode: '99', resultMsg: 'gateway' }), /gateway/)
  const it = tourItem({ contentid: 7, contenttypeid: '12', title: '<b>롯데월드타워</b>', mapx: '127.1026', mapy: '37.5126', lDongRegnCd: '11', areacode: '1', firstimage: 'https://tong.visitkorea.or.kr/a.jpg', cpyrhtDivCd: 'Type3' })
  assert.deepEqual([it.contentid, it.title, it.lat, it.lng, it.ldong, it.cpyrhtDivCd], ['7', '롯데월드타워', 37.5126, 127.1026, '11', 'Type3'])
  assert.equal(tourItem({ contentid: '1', mapx: '0', mapy: '0' }).lat, null, '0,0 is not a place')
  assert.deepEqual(koglOf('Type1'), { code: 'Type1', license: 'KOGL Type 1', license_url: 'https://www.kogl.or.kr/info/licenseType1.do', no_derivatives: false })
  assert.equal(koglOf('Type3').no_derivatives, true, '제3유형: no changes, shown as is')
  assert.equal(koglOf(''), null, 'a missing code is never assumed')
  assert.equal(koglOf('Type2'), null)
  assert.equal(homepageOf('<a href="https://www.lwt.co.kr/" target="_blank">https://www.lwt.co.kr</a>'), 'https://www.lwt.co.kr/')
  assert.equal(homepageOf('www.example.org'), null)
  // The encoding and the decoding key of data.go.kr give the same request.
  assert.equal(serviceKey('ab%2Bcd%3D%3D'), 'ab+cd==')
  assert.equal(new URL(tourUrl('searchKeyword2', { keyword: '빛축제' }, { key: 'ab%2Bcd%3D%3D' })).searchParams.get('serviceKey'), 'ab+cd==')
  assert.equal(new URL(tourUrl('searchKeyword2', { keyword: '빛축제' }, { key: 'ab+cd==' })).searchParams.get('serviceKey'), 'ab+cd==')
  assert.match(redactKeys('https://apis.data.go.kr/x?serviceKey=SECRET&keyword=1 and https://api.flickr.com/?api_key=K2'), /serviceKey=\*\*\*&keyword=1 and .*api_key=\*\*\*$/)
})

test('TourAPI items: a term in the title or overview, and the classifier agrees; every decision has reasons', () => {
  const rules = loadConfig().pipeline.wikipedia.term_rules
  const terms = ['미디어파사드', '빛축제', '미디어아트']
  const d = (o) => classifyTourItem({ contenttypeid: '12', title: '', ...o }, terms, rules)
  assert.equal(d({ title: '롯데월드타워' }).needs_overview, true)
  assert.equal(d({ title: '롯데월드타워', overview: '초고층 빌딩이다.' }).accepted, false)
  const ok = d({ title: '롯데월드타워', overview: '건물 외벽에 미디어파사드가 설치되어 영상을 상영한다.' })
  assert.equal(ok.accepted, true)
  assert.equal(ok.project_type, 'media_facade')
  assert.ok(ok.reasons.includes('term_in_overview:미디어파사드'))
  const ad = d({ title: '미디어파사드 LED 전광판 렌탈 견적' })
  assert.equal(ad.accepted, false, 'a rental advert is never a project')
  assert.ok(ad.reasons.includes('classifier_disagrees'))
  const fest = d({ contenttypeid: '15', title: '겨울 빛축제', overview: '거리에 빛 조형물을 설치하는 빛축제' })
  assert.equal(fest.accepted, true)
  assert.equal(fest.project_type, 'festival_program')
})

test('TourAPI discovery over the fixtures: searches by term and content type, overviews, decisions, no key in any log', async () => {
  const { env, client: c } = client()
  const cfg = loadConfig().pipeline.tourapi
  const r = await discoverTourApi(c, cfg, { key: FIXTURE_ENV.TOURAPI_SERVICE_KEY, cache: new Cache(), termRules: loadConfig().pipeline.wikipedia.term_rules })
  const by = Object.fromEntries(r.items.map((i) => [i.contentid, i]))
  assert.equal(by['2900001'].decision.accepted, true, 'the overview names the media facade')
  assert.equal(by['2900001'].homepage, 'https://www.lwt.co.kr/')
  assert.equal(by['2900003'].decision.accepted, false)
  assert.ok(by['2900003'].decision.reasons.includes('classifier_disagrees'))
  assert.equal(by['2900002'].decision.project_type, 'festival_program')
  const searches = env.requests.filter((q) => q.host === 'apis.data.go.kr' && /searchKeyword2/.test(q.url)).map((q) => new URL(q.url).searchParams)
  assert.ok(searches.every((p) => p.get('_type') === 'json' && p.get('MobileOS') === 'ETC' && ['12', '14', '15'].includes(p.get('contentTypeId'))))
  assert.ok(!env.requests.some((q) => /detailCommon2/.test(q.url) && new URL(q.url).searchParams.get('contentId') === '2900003'), 'no detail for a commercial title')
  // A wrong key: an error per search, nothing accepted, and the key never in a message.
  const bad = await discoverTourApi(c, cfg, { key: 'WRONG-KEY-123', cache: new Cache() })
  assert.equal(bad.accepted.length, 0)
  assert.ok(bad.errors.length > 0)
  assert.ok(!JSON.stringify(bad.errors).includes('WRONG-KEY-123'))
  // Images and the photo gallery.
  const imgs = await detailImages(c, cfg, '2900001', { key: FIXTURE_ENV.TOURAPI_SERVICE_KEY, cache: new Cache() })
  assert.deepEqual(imgs.map((i) => i.cpyrhtDivCd), ['Type1', 'Type3', null])
  const photos = await galleryPhotos(c, {}, '롯데월드타워', { key: FIXTURE_ENV.TOURAPI_SERVICE_KEY, cache: new Cache() })
  assert.equal(photos[0].photographer, '한국관광공사 픽스처')
  assert.equal(photos[0].copyright, null, 'no copyright field in the answer: never assumed')
})

test('client views: a foreign view stops at its earlier deadline while the client goes on; 429 pauses a host', async () => {
  const env = fixtureEnvironment()
  const c = createClient({ fetch: env.fetch, clock: env.clock, sleep: env.sleep })
  c.setDeadline(env.clock() + 60e3)
  const foreign = c.view(() => c.deadline - 30e3)
  assert.equal(foreign.deadline, c.deadline - 30e3)
  env.advance(31e3)
  await assert.rejects(foreign.json('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=x'), (e) => e.code === 'budget')
  await c.json('https://ko.wikipedia.org/w/api.php?action=query&list=search&srsearch=x')
  // A 429 with Retry-After: the host is paused, the next call fails at once without a request.
  let calls = 0
  const limited = createClient({ fetch: async () => { calls++; return new Response('slow down', { status: 429, headers: { 'retry-after': '3600' } }) }, clock: env.clock, sleep: env.sleep })
  await assert.rejects(limited.json('https://api.openverse.org/v1/images/?q=x', { retries: 0 }))
  const n = calls
  await assert.rejects(limited.json('https://api.openverse.org/v1/images/?q=y', { retries: 0 }), /asked to wait/)
  assert.equal(calls, n, 'no request while paused')
})

test('dry run, Korea first: regions on every Korean project, Korean sources first in every queue, a record per Korean row', needSharp, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aol-korea-'))
  const env = fixtureEnvironment()
  const r = await runPipeline({ dataDir: dir, editorialDir: path.join(FIX, 'editorial'), fetch: env.fetch, clock: env.clock, sleep: env.sleep, overrides: FIXTURE_OVERRIDES, env: FIXTURE_ENV, log: () => {} })
  assert.equal(r.publishStatus, 'published')
  const site = path.join(dir, 'site-data')
  const index = JSON.parse(await readFile(path.join(site, 'index.json'), 'utf8'))
  const manifest = JSON.parse(await readFile(path.join(site, 'manifest.json'), 'utf8'))
  const records = new Map()
  for (const f of manifest.files.shards) for (const p of JSON.parse(await readFile(path.join(site, f), 'utf8')).projects) records.set(p.id, p)
  const at = Object.fromEntries(index.fields.map((f, i) => [f, i]))
  const kr = index.rows.filter((row) => row[at.country_iso2] === 'KR')
  assert.ok(kr.length >= 54)
  for (const row of kr) {
    const rec = records.get(row[at.id])
    assert.ok(rec, row[at.id] + ' has a record')
    assert.equal(rec.shard, row[at.shard])
    assert.equal(row[at.kr_region], rec.kr_region)
    assert.ok(rec.name_ko || rec.name_en)
  }
  assert.ok(kr.every((row) => row[at.kr_region]), 'every Korean project of the fixtures has a region')
  for (const row of index.rows.filter((x) => x[at.country_iso2] !== 'KR')) assert.equal(row[at.kr_region], null)
  const rec = (id) => records.get(id)
  assert.equal(rec('Q99000501').kr_region, 'busan_ulsan_gyeongnam', 'P131 chain: Haeundae → Busan (live division)')
  assert.equal(rec('Q99000501').project_type, 'media_architecture', 'a broad Korean term with the higher score')
  assert.equal(rec('Q99000502').kr_region, 'gangwon')
  assert.equal(rec('Q99000101').kr_region, 'daejeon_sejong_chungcheong')
  assert.equal(rec('SEOUL045').project_type, 'light_art', 'the Korean instance of a korea_include class merges with the curated place')
  assert.equal(rec('KTO-2900006').kr_region, 'busan_ulsan_gyeongnam', 'TourAPI: an unknown legal-dong code, the address decides')
  assert.equal(rec('KTO-2900002').field_sources.kr_region, 'tourapi')
  assert.ok(!records.has('KTO-2900001'), 'the TourAPI place merged into the curated media facade on it')
  assert.ok(!records.has('KTO-2900003'), 'an advert never becomes a project')
  assert.ok(!records.has('KTO-2900004'), 'without a public source a TourAPI item stays out (listed with the reason)')
  assert.ok(!records.has('Q99000504') && !records.has('Q99000505'), 'an artist and a library mention are not projects')
  assert.equal(manifest.counts.korea, kr.length)
  assert.ok(manifest.counts.by_kr_region.seoul >= 49)
  // Korean requests come first on the shared hosts.
  const first = (host, f = () => true) => env.requests.find((q) => q.host === host && f(q))
  assert.equal(first('query.wikidata.org').sparql, 'kr-divisions')
  const sparqlOrder = env.requests.filter((q) => q.host === 'query.wikidata.org').map((q) => q.sparql)
  assert.ok(sparqlOrder.indexOf('kr-class-instances Q1823448') < sparqlOrder.indexOf('class-instances Q1823448'))
  assert.ok(sparqlOrder.indexOf('kr-class-instances Q1823448') < sparqlOrder.findIndex((k) => /^class-count/.test(k)))
  const commonsSearches = env.requests.filter((q) => q.host === 'commons.wikimedia.org' && /list=search/.test(q.url) && /srnamespace=14/.test(q.url)).map((q) => new URL(q.url).searchParams.get('srsearch'))
  assert.match(commonsSearches[0], /미디어파사드/)
  const review = JSON.parse(await readFile(path.join(dir, 'review/korea.json'), 'utf8'))
  assert.equal(review.country.ok, true)
  assert.ok(review.decisions.every((d) => d.rule && 'region' in d))
  const tour = JSON.parse(await readFile(path.join(dir, 'review/tourapi.json'), 'utf8'))
  assert.equal(tour.items.length, 5)
  for (const f of ['review/http-log.json', 'review/tourapi.json', 'admin-data/report.json']) assert.ok(!(await readFile(path.join(dir, f), 'utf8')).includes(FIXTURE_ENV.TOURAPI_SERVICE_KEY), f + ' never holds the key')
  // Without the key TourAPI is skipped, and the report says why.
  const dir2 = await mkdtemp(path.join(tmpdir(), 'aol-korea-'))
  const env2 = fixtureEnvironment()
  const r2 = await runPipeline({ dataDir: dir2, editorialDir: null, fetch: env2.fetch, clock: env2.clock, sleep: env2.sleep, overrides: FIXTURE_OVERRIDES, env: {}, log: () => {} })
  assert.equal(r2.report.sources.tourapi.status, 'skipped')
  assert.equal(r2.report.sources.tourapi.reason, 'TOURAPI_SERVICE_KEY not set')
})

test('시·군·구 for the drill-down: city and district from an address or the administrative chain, never guessed', async () => {
  const { koreanPlaceOf, krPlaceFromChain } = await import('../pipeline/lib/korea.mjs')
  assert.deepEqual(koreanPlaceOf('서울특별시 송파구 올림픽로 300'), { city_ko: '서울특별시', district: '송파구' })
  assert.deepEqual(koreanPlaceOf('부산광역시 기장군 기장읍 기장해안로 147'), { city_ko: '부산광역시', district: '기장군' })
  assert.deepEqual(koreanPlaceOf('경기도 수원시 팔달구 정조로 825'), { city_ko: '수원시', district: '팔달구' })
  assert.deepEqual(koreanPlaceOf('강원특별자치도 평창군 대관령면'), { city_ko: '평창군', district: null })
  assert.deepEqual(koreanPlaceOf('제주특별자치도 제주시 첨단로 1'), { city_ko: '제주시', district: null })
  assert.deepEqual(koreanPlaceOf('Seoul, Jung-gu'), { city_ko: null, district: null })
  assert.deepEqual(koreanPlaceOf(''), { city_ko: null, district: null })
  const aux = new Map([['Q1', { ko: '해운대구', p131: ['Q2'] }], ['Q2', { ko: '부산광역시', p131: ['Q3'] }], ['Q3', { ko: '대한민국', p131: [] }], ['Q4', { ko: '평창군', p131: ['Q5'] }], ['Q5', { ko: '강원특별자치도', p131: [] }], ['Q6', { ko: null, p131: [] }]])
  assert.deepEqual(krPlaceFromChain(['Q1'], aux), { city_ko: '부산광역시', district: '해운대구', via: 'p131' })
  assert.deepEqual(krPlaceFromChain(['Q4'], aux), { city_ko: '평창군', district: null, via: 'p131' })
  assert.deepEqual(krPlaceFromChain(['Q6'], aux), { city_ko: null, district: null, via: null })
})
