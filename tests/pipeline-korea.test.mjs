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
  assert.equal(tour.items.length, 6, 'five keyword hits and one light festival from the festival list')
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

test('Korea coverage: Wikidata search of named Korean things, probes of known articles, Korean Wikipedia hits must be Korean places', async () => {
  const { fixtureEnvironment: fe, FIXTURE_OVERRIDES: FO, FIXTURE_ENV: FE } = await import('./fixtures/pipeline/fake-fetch.mjs')
  const { countryClassInstancesQuery } = await import('../pipeline/lib/wikidata.mjs')
  const q = countryClassInstancesQuery('Q1421557', 'Q884')
  for (const part of ['wdt:P17 wd:Q884', 'wdt:P131/wdt:P17 wd:Q884', 'wdt:P131/wdt:P131/wdt:P17 wd:Q884', 'wdt:P276/wdt:P17 wd:Q884']) assert.ok(q.includes(part), part)
  const dir = await mkdtemp(path.join(tmpdir(), 'aol-korea-'))
  const env = fe()
  await runPipeline({ dataDir: dir, editorialDir: null, fetch: env.fetch, clock: env.clock, sleep: env.sleep, overrides: FO, env: FE, log: () => {} })
  const k = JSON.parse(await readFile(path.join(dir, 'review/korea.json'), 'utf8'))
  assert.ok(k.class_query_example.includes('UNION'))
  assert.deepEqual(k.search.terms, { 유등축제: 1, 미디어아트: 2 })
  const dec = Object.fromEntries(k.search.decisions.map((d) => [d.qid, d]))
  assert.equal(dec.Q99000506.accepted, true, 'a lantern festival located in Korea')
  assert.equal(dec.Q99000507.accepted, false)
  assert.ok(dec.Q99000507.reasons.includes('no_place_event_or_work_class'), 'an association is not a project')
  const probes = Object.fromEntries(k.probes.map((p) => [p.title, p]))
  assert.deepEqual(probes['픽스처 경포 유등축제'].found_by, ['wikidata_search', 'published'])
  assert.equal(probes['픽스처 경포 유등축제'].located_kr, true)
  assert.deepEqual(probes['픽스처 경포 유등축제'].configured_classes, [], 'not an instance of a light-work class: why the class query cannot find it')
  assert.equal(probes['픽스처 없는 문서'].missing, true, 'a missing article is reported, never invented')
  assert.equal(probes['픽스처 없는 문서'].resolved_title, undefined, 'a hit that only starts with the name is not the article')
  // A probe title written without a space: the article under the same name exists, and only that one is used.
  assert.deepEqual([probes['픽스처미디어아트 뮤지엄 부산'].resolved_title, probes['픽스처미디어아트 뮤지엄 부산'].qid], ['픽스처 미디어아트 뮤지엄 부산', 'Q99000501'])
  // Korean compounds: the full-text search finds no "…빛축제" inside "픽스처한강빛축제"; the label scan does.
  assert.deepEqual(dec.Q99000508.terms, ['label:빛축제'])
  assert.equal(dec.Q99000508.accepted, true)
  assert.deepEqual([k.search.label_scan.new_items, k.search.label_scan.truncated, k.search.label_scan.by_term['빛축제']], [3, false, 3])
  // A station whose name contains the term is a place named after a festival park, not the festival.
  assert.deepEqual(dec.Q99000509.terms, ['label:빛축제'])
  assert.equal(dec.Q99000509.accepted, false)
  assert.deepEqual(dec.Q99000509.reasons, ['label_match_not_work_or_event'])
  assert.ok(dec.Q99000506.terms.includes('유등축제') && dec.Q99000506.terms.includes('label:유등'), 'found both ways')
  const wiki = JSON.parse(await readFile(path.join(dir, 'review/wikipedia.json'), 'utf8'))
  const tokyo = wiki.entity_decisions.find((d) => d.qid === 'Q99000604')
  assert.equal(tokyo.accepted, false)
  assert.ok(tokyo.entity_reasons.includes('not_in_korea'), 'a Korean Wikipedia hit must be in Korea')
  const index = JSON.parse(await readFile(path.join(dir, 'site-data/index.json'), 'utf8'))
  const ids = index.rows.map((r) => r[0])
  assert.ok(ids.includes('Q99000506') && !ids.includes('Q99000507') && !ids.includes('Q99000604'))
  assert.ok(ids.includes('Q99000508'), 'a festival found only by the label scan')
  assert.ok(!ids.includes('Q99000509'), 'a station named after a festival park is not published')
  // C: a Korean root that holds photos ("Projection mapping in South Korea"): the photo's other category (the gate it
  // was projected on) is a candidate; the photo shows the work, the gate's own photos are context.
  const cats = JSON.parse(await readFile(path.join(dir, 'review/categories.json'), 'utf8')).decisions
  const gate = cats.find((c) => c.title === 'Category:Gwanghwamun')
  assert.equal(gate.decision, 'candidate')
  assert.equal(gate.reason, 'category_of_a_korean_root_photo')
  assert.equal(gate.via_file, 'Gwanghwamun projection mapping 2019.jpg')
  const shard = JSON.parse(await readFile(path.join(dir, 'site-data/projects/000.json'), 'utf8')).projects
  const rec = shard.find((r) => r.name_en === 'Gwanghwamun')
  assert.equal(rec.country_iso2, 'KR')
  assert.equal(rec.project_type, 'projection_mapping')
  const roleOf = (t) => rec.images.find((i) => i.title === t)
  assert.ok(['hero', 'featured', 'card'].includes(roleOf('Gwanghwamun projection mapping 2019').role))
  assert.equal(roleOf('Gwanghwamun Gate daytime 2020').kind, 'architecture_context')
  // Live leaks of 2026-10-26 (Lantern festivals in South Korea, photos and subcategories): a root photo's date,
  // editathon, night-of-the-city and decade categories are dropped; one that names a festival is kept.
  const cat = (t) => cats.find((c) => c.title === 'Category:' + t)
  assert.deepEqual([cat('April 2017 in Daegu').decision, cat('April 2017 in Daegu').reason], ['rejected', 'date_category_month_year'])
  assert.deepEqual([cat('Akeneo Wikimedia Editathon - Mallorca, October 2022').decision, cat('Akeneo Wikimedia Editathon - Mallorca, October 2022').reason], ['rejected', 'wikimedia_event'])
  assert.deepEqual([cat('Night in Seoul').decision, cat('Night in Seoul').reason], ['rejected', 'root_photo_topic_not_a_work'])
  assert.deepEqual([cat('Events in Seoul in the 2010s').decision, cat('Events in Seoul in the 2010s').reason], ['rejected', 'date_category_place_in_date'])
  assert.equal(cat('Daegu Colorful Dalgubeol Lantern Festival').reason, 'category_of_a_korean_root_photo')
  const festival = shard.find((r) => r.name_en === 'Daegu Colorful Dalgubeol Lantern Festival')
  assert.deepEqual([festival.country_iso2, festival.kr_region, festival.project_type], ['KR', 'daegu_gyeongbuk', 'festival_program'])
  // Category:Namwon (a subcategory of the root) leads to the city item: P31 city of South Korea → P279 city → human
  // settlement. Never a project.
  const classes = JSON.parse(await readFile(path.join(dir, 'review/classes.json'), 'utf8'))
  assert.deepEqual(classes.never_project.decisions.find((x) => x.qid === 'Q42087').blocked_by, ['Q515', 'Q486972'])
  const quality = JSON.parse(await readFile(path.join(dir, 'admin-data/quality.json'), 'utf8'))
  assert.ok(quality.excluded.find((x) => x.id === 'Q42087').reasons.includes('blocklist:Q486972'))
  for (const name of ['Namwon', 'April 2017 in Daegu', 'Night in Seoul', 'Events in Seoul in the 2010s', 'Akeneo Wikimedia Editathon - Mallorca, October 2022']) assert.ok(!shard.some((r) => r.name_en === name), name)
})

test('a published record that is never a project is removed at once, not carried over as unseen (live leaks of 2026-10-26)', async () => {
  const { writeFile, readdir } = await import('node:fs/promises')
  const dir = await mkdtemp(path.join(tmpdir(), 'aol-never-'))
  const start = Date.parse('2026-10-20T06:17:00Z')
  const run = (t) => { const env = fixtureEnvironment({ start: t }); return runPipeline({ dataDir: dir, editorialDir: null, fetch: env.fetch, clock: env.clock, sleep: env.sleep, overrides: FIXTURE_OVERRIDES, env: FIXTURE_ENV, log: () => {} }) }
  await run(start)
  // What the live build 20261026T130907Z published: records of a rejected root-photo category, a date and an editathon.
  const shards = (await readdir(path.join(dir, 'site-data/projects'))).filter((f) => f.endsWith('.json'))
  const file = path.join(dir, 'site-data/projects', shards[0])
  const s = JSON.parse(await readFile(file, 'utf8'))
  const base = s.projects.find((r) => r.country_iso2 === 'KR' && !r.curated_place_id)
  const leak = (id, name, extra = {}) => ({ ...base, id, wikidata: null, name_en: name, name_ko: null, name_original: null, commons_category: 'Category:' + name, ...extra })
  s.projects.push(leak('CAT-LEAK001', 'Night in Seoul'), leak('CAT-LEAK002', 'April 2017 in Daegu'), leak('CAT-LEAK003', 'Fixture editathon', { name_en: 'Wiki Loves Lanterns 2017', commons_category: null }))
  await writeFile(file, JSON.stringify(s))
  const r2 = await run(start + 3 * 3600e3)
  const removed = r2.report.changes.removed.map((x) => x.id)
  for (const id of ['CAT-LEAK001', 'CAT-LEAK002', 'CAT-LEAK003']) assert.ok(removed.includes(id), id)
  assert.ok(!r2.report.changes.carried_over.some((x) => x.id.startsWith('CAT-LEAK')))
  const never = JSON.parse(await readFile(path.join(dir, 'review/classes.json'), 'utf8')).never_project.removed_previous
  assert.deepEqual(never.find((x) => x.id === 'CAT-LEAK001').reasons, ['category_rejected:root_photo_topic_not_a_work'])
  assert.ok(never.find((x) => x.id === 'CAT-LEAK002').reasons.includes('name:date_category:month_year'))
  assert.deepEqual(never.find((x) => x.id === 'CAT-LEAK003').reasons, ['name:wikimedia_event'])
})

test('a published record an editor hides, or that the Korean search now refuses, is removed at once (live 송도달빛축제공원역)', async () => {
  const { writeFile, readdir, mkdir } = await import('node:fs/promises')
  const dir = await mkdtemp(path.join(tmpdir(), 'aol-refused-')), editorial = await mkdtemp(path.join(tmpdir(), 'aol-refused-ed-'))
  const start = Date.parse('2026-10-20T06:17:00Z')
  const run = (t, editorialDir = null) => { const env = fixtureEnvironment({ start: t }); return runPipeline({ dataDir: dir, editorialDir, fetch: env.fetch, clock: env.clock, sleep: env.sleep, overrides: FIXTURE_OVERRIDES, env: FIXTURE_ENV, log: () => {} }) }
  await run(start)
  // What the live build 20261026T213455Z published before the label-only rule: the station, found only by the label
  // scan (tracker origin wikidata_search); and a record an editor then hides.
  const shards = (await readdir(path.join(dir, 'site-data/projects'))).filter((f) => f.endsWith('.json'))
  const file = path.join(dir, 'site-data/projects', shards[0])
  const s = JSON.parse(await readFile(file, 'utf8'))
  const base = s.projects.find((r) => r.country_iso2 === 'KR' && !r.curated_place_id)
  s.projects.push({ ...base, id: 'Q99000509', wikidata: 'Q99000509', name_ko: '픽스처빛축제공원역', name_en: 'Fixture Light Festival Park station', commons_category: null })
  s.projects.push({ ...base, id: 'CAT-HIDE001', wikidata: null, name_en: 'Fixture hidden later', name_ko: null, commons_category: 'Category:Fixture hidden later' })
  await writeFile(file, JSON.stringify(s))
  const trackerFile = path.join(dir, 'state/tracker.json'), tracker = JSON.parse(await readFile(trackerFile, 'utf8'))
  for (const [id, origins] of [['Q99000509', ['wikidata_search']], ['CAT-HIDE001', ['commons']]]) tracker.projects[id] = { first_seen: '2026-10-20T06:17:00.000Z', last_seen: '2026-10-20T06:17:00.000Z', last_seen_run: 1, missing_runs: 0, origins, hash: null }
  await writeFile(trackerFile, JSON.stringify(tracker))
  await mkdir(path.join(editorial, 'decisions'))
  await writeFile(path.join(editorial, 'decisions/2026-10-21T00-00-000-hide.json'), JSON.stringify({ action: 'hide', target: 'CAT-HIDE001', note: 'fixture', by: 'test', at: '2026-10-21T00:00:00Z' }))
  const r2 = await run(start + 3 * 3600e3, editorial)
  const removed = r2.report.changes.removed.map((x) => x.id)
  assert.ok(removed.includes('Q99000509') && removed.includes('CAT-HIDE001'), removed.join(','))
  assert.ok(!r2.report.changes.carried_over.some((x) => ['Q99000509', 'CAT-HIDE001'].includes(x.id)), 'neither is carried over as unseen')
  const never = JSON.parse(await readFile(path.join(dir, 'review/classes.json'), 'utf8')).never_project.removed_previous
  assert.deepEqual(never.find((x) => x.id === 'Q99000509').reasons, ['korea_search:label_match_not_work_or_event'])
  assert.deepEqual(never.find((x) => x.id === 'CAT-HIDE001').reasons, ['editorial_hide'])
  assert.equal(r2.report.decisions.find((d) => d.target === 'CAT-HIDE001').status, 'applied', 'the hide is applied, not target_not_found')
  const ids = JSON.parse(await readFile(path.join(dir, 'site-data/index.json'), 'utf8')).rows.map((r) => r[0])
  assert.ok(!ids.includes('Q99000509') && !ids.includes('CAT-HIDE001'))
})

test('Wikidata search pages through every result (sroffset) up to the cap; the label scan query names every term', async () => {
  const { searchItems, krLabelScanQuery } = await import('../pipeline/lib/wikidata.mjs')
  const asked = []
  const all = Array.from({ length: 120 }, (_, i) => 'Q' + (1000 + i))
  const client = { json: async (url) => {
    const p = new URL(url).searchParams
    asked.push([Number(p.get('sroffset')), Number(p.get('srlimit'))])
    const o = Number(p.get('sroffset')), l = Number(p.get('srlimit'))
    return { ...(o + l < all.length ? { continue: { sroffset: o + l } } : {}), query: { search: all.slice(o, o + l).map((title) => ({ title })) } }
  } }
  assert.equal((await searchItems(client, '빛축제', { country: 'Q884', limit: 50 })).length, 120)
  assert.deepEqual(asked, [[0, 50], [50, 50], [100, 50]])
  asked.length = 0
  assert.equal((await searchItems(client, '빛축제', { country: 'Q884', limit: 50, max: 80 })).length, 80, 'stops at the cap')
  assert.deepEqual(asked, [[0, 50], [50, 30]])
  const q = krLabelScanQuery(['유등', '빛의 벙커', 'a"b'], 'Q884', 300)
  for (const part of ['#aol:kr-label-scan', 'wdt:P17 wd:Q884', 'CONTAINS(?label, "유등")', 'CONTAINS(?label, "빛의 벙커")', 'CONTAINS(?label, "a\\"b")', 'LANG(?label) = "ko"', 'LIMIT 300']) assert.ok(q.includes(part), part)
})
