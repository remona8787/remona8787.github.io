// Image providers beyond Commons (docs/STATIC_ARCHIVE.md v0.18 "Providers"), the identity proof of their images and
// the quality metrics: every adapter against recorded-shape answers, licences from the API only, sizes never above
// the original, hotlink-only providers, NAVER as discovery only, keys never in a request log.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { openLicense, openverseCandidate, openverseSearch, openverseUrl, flickrLicenses, flickrSearch, flickrCandidate, bboxAround, unsplashCandidate, pexelsCandidate, naverImageSearch, tourapiCandidate, ktoPhotoCandidate, editorialCandidate, UNSPLASH_REFERRAL } from '../pipeline/lib/providers.mjs'
import { identityOf, projectNames, queryNames, nameIn } from '../pipeline/lib/identity.mjs'
import { measureQuality, hamming, laplacianVariance, blockiness, sharpnessScore, qualityScore, dhash } from '../pipeline/lib/quality.mjs'
import { createClient } from '../pipeline/lib/net.mjs'
import { loadSharp } from '../pipeline/lib/visual.mjs'
import { fixtureEnvironment, FIXTURE_ENV } from './fixtures/pipeline/fake-fetch.mjs'

const FIX = path.join(import.meta.dirname, 'fixtures/pipeline')
const SHARP = await loadSharp().then(() => true, () => false)
const needSharp = SHARP ? {} : { skip: 'sharp is not installed (npm ci --prefix pipeline)' }
const client = () => { const env = fixtureEnvironment(); return { env, c: createClient({ fetch: env.fetch, clock: env.clock, sleep: env.sleep }) } }
const LOTTE = { id: 'SEOUL018', name_ko: '롯데월드타워 미디어파사드', name_en: 'Lotte World Tower Media Facade', latitude: 37.5125, longitude: 127.1025, city: 'Seoul', city_ko: '서울', district: '송파구', kr_region: 'seoul' }

test('open licences: only CC0, the Public Domain Mark, CC BY and CC BY-SA, read from the API', () => {
  assert.deepEqual(openLicense({ code: 'by', version: '2.0' }), { license: 'CC BY 2.0', license_url: 'https://creativecommons.org/licenses/by/2.0/' })
  assert.equal(openLicense({ url: 'https://creativecommons.org/licenses/by-sa/4.0/' }).license, 'CC BY-SA 4.0')
  assert.equal(openLicense({ code: 'cc0' }).license, 'CC0 1.0')
  assert.equal(openLicense({ code: 'pdm' }).license, 'Public Domain Mark 1.0')
  for (const x of [{ code: 'by-nc', version: '2.0' }, { url: 'https://creativecommons.org/licenses/by-nd/4.0/' }, { url: 'https://creativecommons.org/licenses/by-nc-sa/2.0/' }, {}]) assert.equal(openLicense(x), null, JSON.stringify(x))
})

test('Openverse: the licence filter, candidates with creator, licence, page, original size; Wikimedia results skipped; rate-limit headers kept', async () => {
  const u = new URL(openverseUrl('lotte world tower'))
  assert.equal(u.searchParams.get('license'), 'cc0,pdm,by,by-sa')
  assert.equal(u.host, 'api.openverse.org')
  const { c } = client()
  const limits = {}
  const list = await openverseSearch(c, 'lotte world tower', { limits })
  assert.deepEqual(list.map((x) => x.source_id), ['ov-lotte-1', 'ov-lotte-nc', 'ov-tower'], 'the Wikimedia copy is read from Commons directly')
  const ov = list[0]
  assert.equal(ov.page, 'https://www.flickr.com/photos/fixture/1110001/')
  assert.equal(ov.src, 'https://live.staticflickr.com/65535/1110001_abc_k.jpg')
  assert.deepEqual([ov.width, ov.height, ov.license, ov.author, ov.usage], [2048, 1365, 'CC BY 2.0', 'Fixture Flickr User', 'hotlink'])
  assert.deepEqual(ov.sizes, [[2048, ov.src]])
  assert.equal(list[1].rights.ok, false, 'CC BY-NC is refused')
  assert.equal(limits['x-ratelimit-available-anon_burst'], 19)
  assert.equal(openverseCandidate({ id: 'x', url: 'https://example.org/a.jpg', foreign_landing_url: 'https://example.org/', license: 'by', license_version: '4.0', creator: 'A' }).usage, 'cache', 'outside Flickr an open licence allows copies')
})

test('Flickr: licence ids from the live licence list, a bounding box around the project, every size up to the original', async () => {
  const { env, c } = client()
  const lic = await flickrLicenses(c, FIXTURE_ENV.FLICKR_API_KEY, {})
  assert.deepEqual([...lic.keys()].sort(), ['10', '4', '5', '9'], 'only the open licences, by their URLs')
  const list = await flickrSearch(c, { text: '동대문디자인플라자', lat: 37.5665, lng: 127.0095 }, { key: FIXTURE_ENV.FLICKR_API_KEY, licenses: lic })
  const q = new URL(env.requests.find((r) => /flickr\.photos\.search/.test(r.url)).url).searchParams
  assert.equal(q.get('license'), '4,5,9,10')
  assert.deepEqual(q.get('bbox').split(',').map(Number).map((v) => Math.round(v * 100) / 100), [127, 37.56, 127.02, 37.58])
  assert.match(q.get('extras'), /url_o.*geo.*tags/)
  const ph = list[0]
  assert.deepEqual([ph.width, ph.height, ph.original_known], [5000, 3333, true])
  assert.deepEqual(ph.sizes.map(([w]) => w), [640, 1024, 2048, 5000])
  assert.equal(ph.measure_url, 'https://live.staticflickr.com/65535/2220001_aaa_b.jpg', 'quality on the ~1024 px size')
  assert.equal(ph.page, 'https://www.flickr.com/photos/12345%40N00/2220001/')
  assert.deepEqual(ph.geo, { lat: 37.5667, lng: 127.0097 })
  assert.equal(ph.usage, 'hotlink')
  // Without the original: the largest size stands for the width; an unknown licence id is refused.
  const small = flickrCandidate({ id: '1', owner: 'o', license: '0', url_l: 'https://live.staticflickr.com/1_b.jpg', width_l: 1024, height_l: 683 }, lic)
  assert.deepEqual([small.width, small.original_known, small.rights.ok], [1024, false, false])
  // A wrong key: an error, and the key never appears in the logs.
  await assert.rejects(flickrLicenses(c, 'WRONG-FLICKR-KEY', {}), /Invalid API Key/)
  const b = bboxAround(37.5, 127, 1000).split(',').map(Number)
  assert.ok(b[2] - b[0] > 0.02 && b[3] - b[1] > 0.017)
})

test('Unsplash and Pexels: hotlink only, display sizes never above the original, photographer and provider named', () => {
  const u = unsplashCandidate({ id: 'u1', width: 3000, height: 2000, description: 'Lotte World Tower at night', urls: { raw: 'https://images.unsplash.com/photo-1?ixid=a', full: 'https://images.unsplash.com/photo-1?q=85', regular: 'https://images.unsplash.com/photo-1?w=1080' }, links: { html: 'https://unsplash.com/photos/u1', download_location: 'https://api.unsplash.com/photos/u1/download' }, user: { name: 'Photo Person', links: { html: 'https://unsplash.com/@p' } } })
  assert.equal(u.usage, 'hotlink')
  assert.deepEqual(u.sizes.map(([w]) => w), [640, 1280, 1920, 2560])
  assert.ok(u.page.endsWith(UNSPLASH_REFERRAL), 'Unsplash guidelines: referral parameters on links back to Unsplash')
  assert.equal(u.license, 'Unsplash License')
  const p = pexelsCandidate({ id: 7, width: 1800, height: 1200, url: 'https://www.pexels.com/photo/x-7/', photographer: 'P', photographer_url: 'https://www.pexels.com/@p', alt: 'tower', src: { original: 'https://images.pexels.com/photos/7/x.jpeg', large: 'https://images.pexels.com/photos/7/x.jpeg?h=650' } })
  assert.deepEqual(p.sizes.map(([w]) => w), [640, 1280])
  assert.equal(p.usage, 'hotlink')
  assert.equal(p.license, 'Pexels License')
})

test('NAVER image search: API HUB or legacy keys in headers, results are review candidates only', async () => {
  const seen = []
  const fake = async (url, init) => { seen.push({ url, headers: Object.fromEntries(new Headers(init.headers)) }); return new Response(JSON.stringify({ items: [{ title: '<b>롯데월드타워</b> 야경', link: 'https://blog.example/1.jpg', thumbnail: 'https://search.pstatic.net/x', sizewidth: '1200', sizeheight: '800' }] }), { headers: { 'content-type': 'application/json' } }) }
  const env = fixtureEnvironment()
  const c = createClient({ fetch: fake, clock: env.clock, sleep: env.sleep })
  const hub = await naverImageSearch(c, '롯데월드타워', { keyId: 'id1', key: 'k1' })
  assert.match(seen[0].url, /^https:\/\/naverapihub\.apigw\.ntruss\.com\/search\/v1\/image\?/)
  assert.equal(seen[0].headers['x-ncp-apigw-api-key-id'], 'id1')
  await naverImageSearch(c, '롯데월드타워', { keyId: 'id2', key: 'k2', mode: 'legacy' })
  assert.match(seen[1].url, /^https:\/\/openapi\.naver\.com\/v1\/search\/image\.json\?/)
  assert.equal(seen[1].headers['x-naver-client-id'], 'id2')
  assert.deepEqual(hub[0], { title: '롯데월드타워 야경', link: 'https://blog.example/1.jpg', thumbnail: 'https://search.pstatic.net/x', width: 1200, height: 800 })
  assert.ok(!('license' in hub[0]), 'no licence: never a public image')
})

test('TourAPI, photo gallery and editorial candidates: licences only from the answer or the decision', () => {
  const item = { contentid: '2900001', title: '롯데월드타워', lat: 37.5126, lng: 127.1026, addr1: '서울특별시 송파구' }
  const t1 = tourapiCandidate({ original: 'https://tong.visitkorea.or.kr/a.jpg', cpyrhtDivCd: 'Type1', serialnum: '1' }, item)
  assert.deepEqual([t1.license, t1.no_derivatives, t1.rights.ok, t1.provider_place_ids[0]], ['KOGL Type 1', false, true, '2900001'])
  const t3 = tourapiCandidate({ original: 'https://tong.visitkorea.or.kr/b.jpg', cpyrhtDivCd: 'Type3', serialnum: '2' }, item)
  assert.equal(t3.no_derivatives, true, '제3유형: never cropped or changed, shown as is')
  assert.equal(tourapiCandidate({ original: 'https://tong.visitkorea.or.kr/c.jpg', cpyrhtDivCd: '' }, item).rights.ok, false)
  const ph = ktoPhotoCandidate({ id: '3000001', url: 'https://tong.visitkorea.or.kr/p.jpg', title: '롯데월드타워 야경', photographer: '한국관광공사 픽스처', copyright: null, keywords: [] })
  assert.equal(ph.rights.ok, false, 'no copyright field: a review candidate only')
  assert.equal(ktoPhotoCandidate({ id: '1', url: 'https://x/p.jpg', copyright: 'Type1' }).license, 'KOGL Type 1')
  const ed = editorialCandidate({ src: 'https://official.example/a.jpg', page: 'https://official.example/', author: 'Operator', permission_note: 'by e-mail', provider: 'official' })
  assert.deepEqual([ed.provider, ed.license, ed.usage, ed.rights.ok, ed.editorial], ['official', 'Used with permission', 'hotlink', true, true])
  assert.equal(editorialCandidate({ src: 'https://x/a.jpg', page: 'https://x/', author: 'A', license: 'CC BY 4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/' }).usage, 'cache')
})

test('identity: provider id, geotag within 300 m with the name, the exact name with the location; anything else is refused', () => {
  assert.deepEqual(queryNames(LOTTE), { ko: '롯데월드타워', en: 'lotte world tower', other: null })
  assert.ok(projectNames({ name_en: 'Seoul Light' }).length === 0, 'a name of generic words alone never proves anything')
  assert.equal(nameIn('롯데 월드 타워 야경', ['롯데월드타워']), '롯데월드타워', 'Hangul ignores spacing')
  assert.equal(identityOf({ provider: 'tourapi', provider_place_ids: ['2900001'] }, LOTTE, { placeIds: ['2900001'] }).method, 'provider_id')
  const geo = identityOf({ provider: 'flickr', title: 'Lotte World Tower at night', geo: { lat: 37.5127, lng: 127.1027 } }, LOTTE)
  assert.equal(geo.method, 'geotag_name')
  assert.ok(geo.distance_m < 300)
  assert.equal(identityOf({ provider: 'flickr', title: 'Lotte World Tower at night', geo: { lat: 37.56, lng: 127.1 } }, LOTTE).ok, false, '5 km away and only a name in the title: the location must be named')
  assert.equal(identityOf({ provider: 'openverse', title: 'Lotte World Tower', tags: ['seoul'] }, LOTTE).method, 'name_location')
  assert.deepEqual(identityOf({ provider: 'openverse', title: 'A tower at night', tags: ['seoul'] }, LOTTE).reasons, ['name_not_found', 'no_geotag'])
  assert.deepEqual(identityOf({ provider: 'openverse', title: 'Night', description: 'near Lotte World Tower', tags: [] }, LOTTE).reasons.slice(0, 1), ['name_only_in_description'])
  assert.equal(identityOf({ provider: 'official', editorial: true }, LOTTE).method, 'editorial')
})

test('quality metrics: blur lowers sharpness, heavy compression raises blockiness, a resized copy keeps its hash', needSharp, async () => {
  const r = (f) => readFileSync(path.join(FIX, 'renditions', f))
  const crisp = await measureQuality(r('night_projection-960.jpg'))
  const blurred = await measureQuality(r('blurry-960.jpg'))
  const blocky = await measureQuality(r('blocky-960.jpg'))
  assert.deepEqual([crisp.decoded.width, crisp.decoded.format], [960, 'jpeg'])
  assert.ok(crisp.sharpness >= 35, JSON.stringify(crisp))
  assert.ok(blurred.sharpness < crisp.sharpness - 20, `${blurred.sharpness} vs ${crisp.sharpness}`)
  assert.ok(blocky.blockiness > 30 && crisp.blockiness < 20, `${blocky.blockiness} vs ${crisp.blockiness}`)
  assert.ok(crisp.visual.visual >= 45, 'the same download gives the night/media metrics')
  const sharp = await loadSharp()
  const half = await measureQuality(await sharp(r('night_projection-960.jpg')).resize({ width: 480 }).jpeg({ quality: 85 }).toBuffer())
  assert.ok(hamming(crisp.phash, half.phash) <= 8, 'a smaller copy is a near-duplicate')
  assert.ok(hamming(crisp.phash, (await measureQuality(r('day-960.jpg'))).phash) > 8)
  // Pure helpers.
  assert.equal(laplacianVariance(Buffer.alloc(100, 7), 10, 10), 0)
  assert.equal(sharpnessScore(0), 0)
  assert.equal(sharpnessScore(1500), 100)
  const grid = Buffer.alloc(64 * 64)
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) grid[y * 64 + x] = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 200 : 40
  assert.equal(blockiness(grid, 64, 64), 100, 'steps only at block boundaries')
  assert.equal(blockiness(Buffer.alloc(64 * 64, 90), 64, 64), 0)
  assert.equal(dhash(Buffer.from(Array.from({ length: 72 }, (_, i) => i % 9))), 'ffffffffffffffff')
  assert.equal(hamming('ff', '00'), 8)
  assert.equal(hamming(null, 'ff'), Infinity)
  assert.equal(qualityScore({ sharpness: 100, blockiness: 0 }, 2400), 100)
  assert.ok(qualityScore({ sharpness: 100, blockiness: 60 }, 2400) < 10, 'visible blocking costs the score')
})
