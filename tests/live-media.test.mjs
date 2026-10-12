// Live photo/info sync: matching precision, rights decisions, attribution and batching.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  nameVariants, hostVariants, buildPlaceQuery, parsePlaceQuery, fileFromFilePath, licenseAllowed, assessRights,
  fetchCommonsPages, syncLive, toMediaRow, DEFAULT_POLICY, WDQS_URL,
} from '../edge-functions/_shared/live-media.mjs'
import { wdqs, commonsPage, commonsResponse } from './fixtures/live-media-fixtures.mjs'

const places = [
  { place_id: 'SEOUL007', name_kr: '동대문디자인플라자(DDP) / 서울라이트', name_en: 'Dongdaemun Design Plaza (DDP) / Seoul Light' },
  { place_id: 'SEOUL031', name_kr: '문화역서울284', name_en: 'Culture Station Seoul 284' },
  { place_id: 'SEOUL040', name_kr: '광장', name_en: '' },
  { place_id: 'SEOUL041', name_kr: '없는 장소', name_en: 'Nowhere' },
]

test('name variants split composite names and drop parentheticals', () => {
  assert.deepEqual(nameVariants('동대문디자인플라자(DDP) / 서울라이트'), ['동대문디자인플라자(DDP) / 서울라이트', '동대문디자인플라자(DDP)', '동대문디자인플라자', '서울라이트'])
  assert.deepEqual(nameVariants(''), [])
})

test('query restricts to Seoul and escapes names', () => {
  const q = buildPlaceQuery([{ name_kr: '이름 "따옴표"\\', name_en: '' }])
  assert.match(q, /wdt:P131\* wd:Q8684/)
  assert.ok(q.includes('"이름 \\"따옴표\\"\\\\"@ko'))
})

test('exact unambiguous matches only; full name wins over variants', () => {
  const m = parsePlaceQuery(wdqs([
    ['동대문디자인플라자', 'ko', 'Q1000', 'DDP night.jpg', 'Point(127.0095 37.5665)'],
    ['서울라이트', 'ko', 'Q2000', 'Seoul Light.jpg'],
    ['문화역서울284', 'ko', 'Q3000', 'Old Seoul Station at night 01.JPG'],
    ['광장', 'ko', 'Q4001', 'A.jpg'],
    ['광장', 'ko', 'Q4002', 'B.jpg'],
  ]), places)
  assert.equal(m.get('SEOUL007').qid, 'Q1000')
  assert.deepEqual(m.get('SEOUL007').coord, { lat: 37.5665, lon: 127.0095 })
  assert.equal(m.get('SEOUL031').images[0], 'Old Seoul Station at night 01.JPG')
  assert.equal(m.has('SEOUL040'), false, 'two Seoul items share the name: never guess')
  assert.equal(m.has('SEOUL041'), false)
})

test('invalid WDQS payload is an error, not an empty result', () => {
  assert.throws(() => parsePlaceQuery({}, places), /invalid_wdqs_payload/)
})

test('Special:FilePath URLs decode to file names', () => {
  assert.equal(fileFromFilePath('http://commons.wikimedia.org/wiki/Special:FilePath/Seoul%20Museum%20of%20Art%20%28SeMA%29.jpg'), 'Seoul Museum of Art (SeMA).jpg')
  assert.equal(fileFromFilePath('http://example.org/x.jpg'), null)
})

test('license allowlist accepts free licenses incl. national ports, rejects NC/ND', () => {
  for (const l of ['CC BY 2.0', 'CC BY-SA 4.0', 'CC BY-SA 2.0 kr', 'CC0', 'Public domain']) assert.equal(licenseAllowed(l), true, l)
  for (const l of ['CC BY-NC 4.0', 'CC BY-ND 2.0', 'All rights reserved', '', 'CC BY 4.0 or restricted']) assert.equal(licenseAllowed(l), false, l)
})

test('rights: deletion tags block, Korean FoP follows policy, SVG excluded', () => {
  assert.equal(assessRights({ license: 'CC BY-SA 4.0', mime: 'image/jpeg', templates: ['Template:Delete'] }).ok, false)
  const kr = assessRights({ license: 'CC BY-SA 4.0', mime: 'image/jpeg', templates: ['Template:NoFoP-South Korea'] })
  assert.equal(kr.ok, true); assert.equal(kr.krFop, true)
  assert.equal(assessRights({ license: 'CC BY-SA 4.0', mime: 'image/jpeg', templates: ['Template:NoFoP-South Korea'] }, { ...DEFAULT_POLICY, krFopDisplay: false }).ok, false)
  assert.equal(assessRights({ license: 'CC0', mime: 'image/svg+xml' }).ok, false)
})

test('Commons metadata is fetched in batches of 50 and continuation merges templates', async () => {
  const files = Array.from({ length: 60 }, (_, i) => `F${i}.jpg`)
  const urls = []
  const fetchJSON = async url => {
    urls.push(url)
    const titles = new URL(url).searchParams.get('titles').split('|')
    const first = !new URL(url).searchParams.has('tlcontinue')
    const pages = titles.map(t => ({ title: t, ...(first ? commonsPage({}) : { templates: [{ ns: 10, title: 'Template:Delete' }] }) }))
    return first && titles.includes('File:F0.jpg') ? { continue: { tlcontinue: 'x', continue: '||' }, query: { pages } } : { query: { pages } }
  }
  const pages = await fetchCommonsPages(files, fetchJSON)
  assert.equal(pages.size, 60)
  assert.equal(urls.length, 3, 'two batches, one continuation')
  assert.ok(pages.get('F0.jpg').templates.includes('Template:Delete'), 'continued templates are merged')
  assert.ok(pages.get('F0.jpg').imageinfo, 'imageinfo kept across continuation')
})

test('full sync: attributed rows for cleared files, rejected files listed, WDQS called with POST', async () => {
  const calls = []
  const fetchJSON = async (url, init) => {
    calls.push({ url, init })
    if (url === WDQS_URL) return wdqs([
      ['동대문디자인플라자', 'ko', 'Q1000', 'DDP night.jpg', 'Point(127.0095 37.5665)', 'https://www.ddp.or.kr/'],
      ['문화역서울284', 'ko', 'Q3000', 'NC photo.jpg'],
    ])
    return commonsResponse({
      'DDP night.jpg': commonsPage({ artist: '<a href="//commons.wikimedia.org/wiki/User:Kim">Kim</a> &amp; Lee', license: 'CC BY-SA 4.0', date: '2019-05-04 19:20:11', templates: ['Template:NoFoP-South Korea'] }),
      'NC photo.jpg': commonsPage({ license: 'CC BY-NC 4.0' }),
    })
  }
  const r = await syncLive({ places, fetchJSON, now: '2026-10-12T00:00:00.000Z' })
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(r.stats.matched, 2)
  assert.equal(r.media.length, 1)
  const row = r.media[0]
  assert.equal(row.place_code, 'SEOUL007')
  assert.equal(row.creator, 'Kim & Lee')
  assert.equal(row.license_code, 'CC BY-SA 4.0')
  assert.equal(row.captured_at, '2019-05-04')
  assert.equal(row.source_url, 'https://commons.wikimedia.org/wiki/File:DDP_night.jpg')
  assert.equal(row.rights_basis, 'kr_copyright_act_35_2_display')
  assert.equal(row.clearance_status, 'cleared')
  assert.equal(r.info.SEOUL007.website, 'https://www.ddp.or.kr/')
  assert.deepEqual(r.stats.rejected.map(x => [x.file, x.reasons[0]]), [['NC photo.jpg', 'license_not_allowed']])
})

test('missing author falls back to a generic credit and source link', () => {
  const row = toMediaRow('SEOUL001', 'X.jpg', commonsPage({ artist: '' }), { qid: 'Q1', krFop: false, now: 'n' })
  assert.equal(row.creator, 'Wikimedia Commons 기여자')
  assert.equal(row.license_url, 'https://creativecommons.org/licenses/by-sa/4.0')
  assert.equal(row.rights_basis, null)
})

test('host-building variants strip installation suffixes only', () => {
  assert.deepEqual(hostVariants('롯데월드타워 미디어파사드'), ['롯데월드타워'])
  assert.deepEqual(hostVariants('Lotte World Tower Media Facade'), ['Lotte World Tower'])
  assert.deepEqual(hostVariants('서울로7017 야간조명'), ['서울로7017'])
  assert.deepEqual(hostVariants('리움미술관'), [])
  assert.deepEqual(hostVariants('LUUX(동아일보)'), [], 'parenthetical owners are not treated as hosts')
})

test('own name beats host building; host matches are labelled', async () => {
  const ps = [{ place_id: 'SEOUL018', name_kr: '롯데월드타워 미디어파사드', name_en: 'Lotte World Tower Media Facade' }]
  const m = parsePlaceQuery(wdqs([['롯데월드타워', 'ko', 'Q500', 'LWT.jpg']]), ps)
  assert.equal(m.get('SEOUL018').matchKind, 'host')
  const own = parsePlaceQuery(wdqs([['롯데월드타워', 'ko', 'Q500', 'LWT.jpg'], ['Lotte World Tower Media Facade', 'en', 'Q600', 'Facade.jpg']]), ps)
  assert.equal(own.get('SEOUL018').qid, 'Q600')
  assert.equal(own.get('SEOUL018').matchKind, 'exact')
  const r = await syncLive({ places: ps, now: 'n', fetchJSON: async url => url === WDQS_URL ? wdqs([['롯데월드타워', 'ko', 'Q500', 'LWT.jpg']]) : commonsResponse({ 'LWT.jpg': commonsPage({}) }) })
  assert.match(r.media[0].caption, /^프로젝트가 있는 건물\(롯데월드타워\)의 사진/)
  assert.equal(r.info.SEOUL018.matchKind, 'host')
})
