// The static archive dataset reader (client/dataset-rows.mjs) against what the pipeline writes (its fixture dataset)
// and against the UI's own fixture: compact rows, home picks, full records, image rules and gallery order.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import * as R from '../client/dataset-rows.mjs'
import { siteData, manyRecords, RECORDS } from '../qa/fixtures/site-data-projects.mjs'

const root = path.join(import.meta.dirname, '..')
// After the tracks merge the pipeline's own fixture lives in tests/fixtures/pipeline/site-data; until then a copy.
const PIPE = ['tests/fixtures/pipeline/site-data', 'qa/fixtures/pipeline-site-data'].map(d => path.join(root, d)).find(d => existsSync(path.join(d, 'home.json')))
const read = (dir, f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'))

test('pipeline dataset: every index row becomes a place, with coordinates, tier and shard', () => {
  const index = read(PIPE, 'index.json'), manifest = read(PIPE, 'manifest.json')
  const places = R.fromIndex(index)
  assert.equal(places.length, index.rows.length)
  assert.equal(places.length, manifest.counts.projects)
  const byId = new Map(places.map(p => [p.dataset_id, p]))
  const bay = byId.get('Q7715933')
  assert.equal(bay.place_id, 'AR-Q7715933')
  assert.equal(bay.wikidata, 'Q7715933')
  assert.equal(bay.country_iso2, 'US')
  assert.equal(bay.region, 'north_america')
  assert.equal(bay.project_type, 'light_art')
  assert.ok(Number.isFinite(bay.latitude) && Number.isFinite(bay.longitude))
  assert.equal(bay.coordinate_source_url, 'https://www.wikidata.org/wiki/Q7715933', 'coordinates name their source')
  assert.equal(bay.shard, '000')
  // visual_rank is the card image's tier (pipeline/lib/output.mjs buildIndex).
  const fields = index.fields, row = index.rows.find(r => r[0] === 'Q7715933')
  assert.equal(bay.card_tier, row[fields.indexOf('visual_rank')])
  assert.ok(places.every(p => p.card_tier === null || (p.card_tier >= 1 && p.card_tier <= 4)))
  assert.ok(places.every(p => !p.thumb === (p.card_tier === null)))
  // Curated seed places keep their id as the link to the curated record.
  const curated = places.filter(p => /^SEOUL\d+$/.test(p.dataset_id))
  assert.ok(curated.length > 10)
  assert.ok(curated.every(p => p.curated_place_id === p.dataset_id))
})

test('pipeline dataset: home picks keep only media-active hero images and name every project they use', () => {
  const home = R.fromHome(read(PIPE, 'home.json'))
  const raw = read(PIPE, 'home.json')
  // v0.18 images (provider, approved, media_active): a reviewed tier-1/2 photo; v0.17 images: tier 1 only.
  const heroOk = (/** @type {any} */ m = {}) => typeof m.provider === 'string' || m.approved !== undefined || m.media_active !== undefined || Array.isArray(m.display)
    ? m.approved === true && m.tier <= 2 : m.tier === 1
  assert.equal(home.hero.length, raw.hero.filter(h => heroOk(h.image)).length)
  assert.ok(home.hero.length >= 1)
  for (const h of home.hero) {
    assert.ok(h.image.tier <= 2)
    assert.ok(h.image.license && (h.image.author || h.image.attribution), 'credit on every hero image')
    assert.ok(h.place.name_kr)
  }
  assert.equal(home.featured.length, raw.featured.length)
  assert.ok(home.regions.every(r => r.count > 0 && (!r.image || r.image.tier <= 3)))
  assert.ok(home.types.some(t => t.key === 'media_facade'))
  assert.equal(home.counts.projects, raw.counts.projects)
  assert.ok(home.media.every(m => m.creator && m.license_code), 'home card photos carry author and licence')
})

test('pipeline dataset: a shard gives full records with sources, credits and a gallery in tier order', () => {
  const map = R.fromShard(read(PIPE, 'projects/000.json'))
  assert.equal(map.size, read(PIPE, 'projects/000.json').projects.length)
  const bay = map.get('AR-Q7715933')
  assert.ok(bay.place.detail_loaded)
  assert.equal(bay.place.official_url, 'https://thebaylights.org/')
  assert.ok(bay.place.sources.some(s => s.kind === 'encyclopedia' && /wikipedia\.org/.test(s.url)))
  assert.ok(bay.place.sources.some(s => s.kind === 'wikidata'))
  assert.deepEqual(bay.place.credits.map(c => c.name), ['Leo Villareal'])
  assert.ok(bay.media.length >= 2)
  assert.deepEqual(bay.media.map(m => m.tier), [...bay.media.map(m => m.tier)].sort((a, b) => a - b))
  for (const [, x] of map) for (const m of x.media) assert.ok(m.creator && m.license_code && /^https:/.test(m.display_url))
  // No review vocabulary travels into the place.
  for (const [, x] of map) assert.deepEqual(x.place.field_status, {})
})

test('a large index with compacted Commons thumbnails expands them; only Commons templates are accepted', () => {
  const recs = manyRecords(300), d = siteData(recs, { compact: true })
  assert.ok(d.index.thumb_template)
  assert.ok(d.index.rows.some(r => r[10] && !/^https:/.test(r[10])), 'some thumbs are compact')
  const places = R.fromIndex(d.index)
  assert.equal(places.length, 300)
  for (const p of places) if (p.thumb) assert.match(p.thumb, /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/([^/]+)\/500px-\1$/)
  const full = R.fromIndex(siteData(recs).index)
  assert.deepEqual(places.map(p => p.thumb), full.map(p => p.thumb), 'compact and full index read the same')
  // A foreign template is ignored: the short path is not an https URL, so the row has no thumbnail.
  const evil = { ...d.index, thumb_template: 'https://evil.example/{path}/500px-{file}' }
  assert.ok(R.fromIndex(evil).filter(p => p.thumb).every(p => p.thumb.startsWith('https://upload.wikimedia.org/')))
  assert.equal(R.expandThumb('a/ab/File.jpg', 'https://upload.wikimedia.org/wikipedia/commons/thumb/{path}/500px-{file}'), 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/File.jpg/500px-File.jpg')
  assert.equal(R.expandThumb('../x', 'https://upload.wikimedia.org/wikipedia/commons/thumb/{path}/500px-{file}'), '../x')
})

test('5,000 index rows read in well under a second and stay under 1 MB compacted', () => {
  const d = siteData(manyRecords(5000), { compact: true, shardTarget: 200 })
  const bytes = Buffer.byteLength(JSON.stringify(d.index))
  assert.ok(bytes < 1024 * 1024, `index ${bytes} bytes`)
  const t0 = performance.now(), places = R.fromIndex(JSON.parse(JSON.stringify(d.index))), ms = performance.now() - t0
  assert.equal(places.length, 5000)
  assert.ok(ms < 1000, `read in ${ms.toFixed(0)} ms`)
})

test('values are checked: bad ids, names, links, numbers and vocabulary become null or drop the row', () => {
  const fields = ['id', 'name_ko', 'name_en', 'name_original', 'country_iso2', 'city', 'lat', 'lng', 'project_type', 'year', 'thumb', 'visual_rank', 'shard']
  const rows = [
    ['ok-1', '이름', 'Name', null, 'fr', 'Lyon', 45.7, 4.8, 'media_facade', 2001, 'https://upload.wikimedia.org/a.jpg', 2, '000'],
    ['../bad', '이름', null, null, 'FR', null, null, null, null, null, null, null, null],
    ['no-name', null, '', null, 'FR', null, null, null, null, null, null, null, null],
    ['weird', '<b>x</b>', null, null, 'ZZ', 'X', 999, 4, 'billboard', 'abcd', 'http://insecure/a.jpg', 9, '../x'],
    ['ok-1', 'dup', null, null, 'FR', null, null, null, null, null, null, null, null],
  ]
  const p = R.fromIndex({ fields, rows })
  assert.deepEqual(p.map(x => x.dataset_id), ['ok-1', 'weird'])
  assert.equal(p[0].country_iso2, 'FR')
  assert.equal(p[0].card_tier, 2)
  const w = p[1]
  assert.equal(w.name_kr, '<b>x</b>', 'kept as text; the app escapes it')
  assert.equal(w.country_iso2, null)
  assert.equal(w.latitude, null)
  assert.equal(w.project_type, null)
  assert.equal(w.year_installed, null)
  assert.equal(w.thumb, null)
  assert.equal(w.card_tier, null)
  assert.equal(w.shard, null)
  assert.throws(() => R.fromIndex({ rows: [] }), /invalid_index/)
})

test('images: no licence or no author means no image; the tier follows the role or the stated tier', () => {
  assert.equal(R.image({ thumb: 'https://upload.wikimedia.org/a.jpg', license: 'CC BY 4.0' }), null)
  assert.equal(R.image({ thumb: 'https://upload.wikimedia.org/a.jpg', author: 'A' }), null)
  assert.equal(R.image({ thumb: 'http://upload.wikimedia.org/a.jpg', license: 'CC BY 4.0', author: 'A' }), null)
  const ok = R.image({ thumb: 'https://upload.wikimedia.org/a.jpg', license: 'CC BY 4.0', author: 'A', role: 'context' })
  assert.equal(ok.tier, 4)
  assert.equal(R.image({ ...ok, role: 'media_active', tier: undefined }).tier, 1)
  assert.equal(R.image({ ...ok, role: 'context', tier: 2 }).tier, 2, 'a stated tier wins')
  assert.equal(R.image({ ...ok, role: 'mystery', tier: undefined }).tier, 4, 'an unknown role counts as context')
})

test('UI fixture: the hero needs a reviewed media-active image; daytime-only projects never reach the home picks', () => {
  const d = siteData(RECORDS), home = R.fromHome(d.home)
  assert.ok(home.hero.length >= 3)
  // Daytime architectural context only (v0.18 tier 5, role context).
  const dayOnly = RECORDS.filter(r => r.images.length && r.images.every(i => i.role === 'context')).map(r => 'AR-' + r.id)
  assert.ok(dayOnly.length >= 1)
  assert.ok(home.hero.every(h => !dayOnly.includes(h.place.place_id)))
  // A daytime photo may come with a compact record (recently added); it stays tier 4, which the home surface skips.
  for (const m of home.media.filter(m => dayOnly.includes(m.place_code))) assert.equal(m.tier, 4)
  const bad = R.fromHome({ ...d.home, hero: [{ project: d.home.hero[0].project, image: { ...d.home.hero[0].image, tier: 4, role: 'context' } }] })
  assert.equal(bad.hero.length, 0, 'a context image never becomes a hero slide')
})

test('UI fixture: gallery order puts media-active images first, videos are read, the visit block only when stated', () => {
  const d = siteData(RECORDS), all = new Map()
  for (const s of Object.values(d.shards)) for (const [k, v] of R.fromShard(s)) all.set(k, v)
  const graz = all.get('AR-kunsthaus-graz-bix')
  assert.deepEqual(graz.media.map(m => m.tier), [1, 1, 4])
  const ars = all.get('AR-ars-electronica-center')
  assert.equal(ars.videos.length, 1)
  assert.equal(ars.place.visit.status, 'operating')
  assert.equal(graz.place.visit, null)
  const none = all.get('AR-medialab-prado')
  assert.deepEqual(none.media, [])
})

test('the shard of an id follows the pipeline rule, so a project link needs the manifest and one shard only', async () => {
  const manifest = read(PIPE, 'manifest.json'), shard = read(PIPE, 'projects/000.json')
  for (const r of shard.projects) assert.equal(R.shardFor(r.id, manifest.files.shards), r.shard, r.id)
  const d = siteData(manyRecords(800), { shardTarget: 200 })
  assert.equal(d.manifest.files.shards.length, 4)
  for (const [name, file] of Object.entries(d.shards)) for (const r of file.projects) assert.equal(R.shardFor(r.id, d.manifest.files.shards), name)
  assert.equal(R.shardFor('x', []), null)
  assert.equal(R.shardFor('x', ['projects/000.json', 'projects/009.json']), R.fnv1a('x') % 2 === 0 ? '000' : null)
  // The pipeline's own implementation, when this checkout has it.
  const out = path.join(root, 'pipeline/lib/output.mjs')
  if (existsSync(out)) {
    const P = await import(out)
    for (const id of ['Q4167', 'SEOUL001', 'ED-fixture-light-pavilion', '한글-id', 'scale-00042']) for (const n of [1, 2, 8, 32]) assert.equal(String(R.fnv1a(id) % n).padStart(3, '0'), P.shardOf(id, n))
  }
})

// ===== v0.18: images from many providers at the sizes they serve, Korean regions, the Korea-first home =====

const img18 = (o = {}) => ({ provider: 'flickr', src: 'https://live.staticflickr.com/1/2_o.jpg', page: 'https://www.flickr.com/photos/a/2', author: 'A', license: 'CC BY 2.0', width: 3000, height: 2000, tier: 1, role: 'hero', approved: true, display: [[640, 'https://live.staticflickr.com/1/2_z.jpg'], [1600, 'https://live.staticflickr.com/1/2_h.jpg'], [2048, 'https://live.staticflickr.com/1/2_k.jpg']], ...o })

test('v0.18 images: display sizes up to the original, provider, verdict, six tiers onto the four card tiers', () => {
  const m = R.image(img18())
  assert.deepEqual(m.sizes.map(x => x[0]), [640, 1600, 2048])
  assert.equal(m.maxw, 2048)
  assert.equal(m.thumb, 'https://live.staticflickr.com/1/2_z.jpg', 'without a thumb the smallest display size')
  assert.equal(m.provider, 'flickr')
  assert.equal(m.approved, true)
  assert.equal(m.v18, true)
  // Never a size above the original, never an insecure or broken entry.
  const capped = R.image(img18({ width: 1700, display: [[640, 'https://a.example/640.jpg'], [1600, 'https://a.example/1600.jpg'], [2048, 'https://a.example/2048.jpg'], [800, 'http://a.example/800.jpg'], ['x', 'https://a.example/x.jpg']] }))
  assert.deepEqual(capped.sizes.map(x => x[0]), [640, 1600])
  // Rejected and tier-6 images are dropped; tiers 4 (a scene) and 5 (context) become the app's 3 and 4.
  assert.equal(R.image(img18({ approved: false })), null)
  assert.equal(R.image(img18({ tier: 6 })), null)
  assert.deepEqual([1, 2, 3, 4, 5].map(t => R.image(img18({ tier: t })).tier), [1, 2, 3, 3, 4])
  assert.equal(R.image(img18({ tier: 5, role: 'context' })).context, true)
  assert.equal(R.image(img18({ provider: 'nope' })).provider, null)
  // A media row carries them for the app.
  const row = R.mediaRow('AR-x', m, 0)
  assert.deepEqual([row.maxw, row.image_provider, row.sizes.length], [2048, 'flickr', 3])
})

test('Commons images: standard thumbnail widths below the original, also from URLs with a query and long names', () => {
  // The live dataset's shape before v0.18: src is a 1920 px thumbnail with a tracking query, thumb a 500 px one.
  const live = R.image({ src: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/68/A%2C_B.jpg/1920px-A%2C_B.jpg?utm_source=commons.wikimedia.org&utm_content=thumbnail', thumb: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/68/A%2C_B.jpg/500px-A%2C_B.jpg?utm_source=x', license: 'CC BY 2.0', author: 'A', width: 5184, height: 3456, tier: 1, role: 'hero' })
  assert.deepEqual(live.sizes.map(x => x[0]), [330, 500, 960, 1280, 1920, 3840])
  assert.equal(live.sizes.at(-1)[1], 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/68/A%2C_B.jpg/3840px-A%2C_B.jpg')
  assert.equal(live.v18, false)
  assert.equal(live.approved, undefined)
  const long = R.commonsSizes('https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c7/Le_long.jpg/1280px-thumbnail.jpg?x=1', 2400)
  assert.deepEqual(long.map(x => x[1].split('/').at(-1)), ['330px-thumbnail.jpg', '500px-thumbnail.jpg', '960px-thumbnail.jpg', '1280px-thumbnail.jpg', '1920px-thumbnail.jpg'])
  // The original's width is the limit: a 500 px original has no larger size, and no 500 px thumbnail of itself.
  const small = R.image({ src: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/S.jpg', license: 'CC0', author: 'A', width: 500, height: 375, tier: 1 })
  assert.deepEqual(small.sizes.map(x => x[0]), [330, 500])
  assert.equal(small.sizes.at(-1)[1], 'https://upload.wikimedia.org/wikipedia/commons/a/ab/S.jpg', 'the original itself at its own width')
  assert.equal(small.maxw, 500)
  // Unknown original width: no size above the thumbnail the source gave.
  const unknown = R.image({ thumb: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/U.jpg/500px-U.jpg', license: 'CC0', author: 'A' })
  assert.equal(unknown.maxw, 500)
  // Index rows: the thumbnail's own width (thumb_w), credit pending.
  const [row] = R.fromIndex({ fields: ['id', 'name_en', 'country_iso2', 'thumb', 'visual_rank', 'thumb_w', 'thumb_h'], rows: [['t', 'T', 'FR', 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/T.jpg/500px-T.jpg', 1, 500, 333]] })
  const c = R.cardMedia(row, null)
  assert.equal(c.maxw, 500)
  assert.ok(c.credit_pending)
  assert.ok(Math.abs(c.ratio - 1.5) < .01)
})

test('kr_region: the dataset value when the field exists (null stays unknown), derived only when it is missing', () => {
  const fields = ['id', 'name_ko', 'country_iso2', 'city', 'kr_region']
  const rows = [['a', '가', 'KR', 'Busan', 'busan_ulsan_gyeongnam'], ['b', '나', 'KR', 'Busan', null], ['c', '다', 'KR', 'Busan', 'atlantis'], ['d', '라', 'FR', 'Lyon', 'seoul']]
  assert.deepEqual(R.fromIndex({ fields, rows }).map(p => p.kr_region), ['busan_ulsan_gyeongnam', null, null, null])
  // An index without the column (datasets before v0.18): from the city, then the address.
  const old = R.fromIndex({ fields: ['id', 'name_ko', 'country_iso2', 'city'], rows: [['a', '가', 'KR', 'Seoul'], ['b', '나', 'KR', 'Incheon'], ['c', '다', 'KR', '경기도 광주시'], ['d', '라', 'KR', 'Gwangju'], ['e', '마', 'KR', 'Nowhere'], ['f', '바', 'JP', 'Tokyo']] })
  assert.deepEqual(old.map(p => p.kr_region), ['seoul', 'gyeonggi_incheon', 'gyeonggi_incheon', 'gwangju_jeolla', null, null])
  // The live dataset (no field yet): every Korean row gets a region from its city.
  const live = path.join(root, 'qa/fixtures/pipeline-site-data/index.json')
  if (existsSync(live)) for (const p of R.fromIndex(JSON.parse(readFileSync(live, 'utf8'))).filter(p => p.country_iso2 === 'KR' && /seoul/i.test(p.city))) assert.equal(p.kr_region, 'seoul')
})

test('home.json v0.18: hero, Korean regions, featured and programmes, the world strip and counts; v0.17 still read', () => {
  const d = siteData(RECORDS), h = R.fromHome(d.home)
  assert.equal(h.shape, 'v18')
  assert.equal(h.krRegions.length, 8)
  assert.deepEqual(h.krRegions.map(r => r.key), ['seoul', 'gyeonggi_incheon', 'gangwon', 'daejeon_sejong_chungcheong', 'gwangju_jeolla', 'daegu_gyeongbuk', 'busan_ulsan_gyeongnam', 'jeju'])
  assert.equal(h.krRegions.reduce((a, r) => a + r.count, 0), RECORDS.filter(r => r.country_iso2 === 'KR').length)
  assert.ok(h.krFeatured.length >= 4 && h.krFeatured.every(p => p.country_iso2 === 'KR'))
  assert.ok(h.krPrograms.length >= 4 && h.krPrograms.every(p => p.country_iso2 === 'KR'))
  assert.ok(h.world.highlights.length >= 4 && h.world.highlights.every(p => p.country_iso2 !== 'KR'))
  assert.ok(h.world.regions.length && h.world.countries.length)
  assert.deepEqual([h.counts.kr, h.counts.world], [d.home.counts.kr, d.home.counts.world])
  // Korean hero slides first; each a reviewed tier-1/2 image.
  assert.equal(h.hero[0].place.country_iso2, 'KR')
  assert.ok(h.hero.every(x => x.image.tier <= 2 && x.image.approved === true))
  // A hero image without the editorial verdict is not a slide (v0.18); a v0.17 one needs tier 1.
  assert.equal(R.fromHome({ ...d.home, hero: [{ project: d.home.hero[0].project, image: { ...d.home.hero[0].image, approved: null } }] }).hero.length, 0)
  const v17 = R.fromHome(siteData(RECORDS, { home: 'v17' }).home)
  assert.equal(v17.shape, 'v17')
  assert.ok(v17.featured.length && v17.regions.length && v17.types.length)
  assert.deepEqual([v17.krRegions, v17.krFeatured, v17.world], [[], [], null])
  assert.ok(v17.hero.length >= 3 && v17.hero.every(x => x.image.tier === 1 && !x.image.v18))
  // The plain-list form of world.
  assert.equal(R.fromHome({ ...d.home, world: d.home.world.highlights }).world.highlights.length, d.home.world.highlights.length)
})
