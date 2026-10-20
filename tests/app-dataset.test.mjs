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
  assert.equal(home.hero.length, raw.hero.filter(h => h.image?.tier === 1).length)
  assert.ok(home.hero.length >= 1)
  for (const h of home.hero) {
    assert.equal(h.image.tier, 1)
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
  const d = siteData(manyRecords(5000), { compact: true })
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

test('UI fixture: the hero needs a tier-1 image; daytime-only projects never reach the home picks', () => {
  const d = siteData(RECORDS), home = R.fromHome(d.home)
  assert.ok(home.hero.length >= 3)
  const dayOnly = RECORDS.filter(r => r.images.length && r.images.every(i => i.tier === 4)).map(r => 'AR-' + r.id)
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
