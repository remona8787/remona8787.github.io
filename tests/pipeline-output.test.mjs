// Pipeline output (docs/STATIC_ARCHIVE.md "Output"): stable shards, the manifest, the compact index (under 1 MB for
// 5,000 projects), the home picks (never a daytime image), stats, and the schema checks of every file.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shardCount, shardOf, publicRecord, buildIndex, buildHome, buildStats, buildManifest, INDEX_FIELDS, periodText, THUMB_TEMPLATE, expandThumb } from '../pipeline/lib/output.mjs'
import { checkDataset, checkRecord, checkIndex, checkHome, checkManifest } from '../pipeline/lib/schema.mjs'

// Realistic Commons names (about 45 characters) under their md5 directories.
const fname = (n) => `Media_facade_of_the_tower_${String(n).padStart(4, '0')}_at_night_2019.jpg`
const thumb = (n) => `https://upload.wikimedia.org/wikipedia/commons/thumb/${'abcdef'[n % 6]}/${'abcdef'[n % 6]}${n % 10}/${fname(n)}/500px-${fname(n)}`
const img = (n, role, tier) => ({ thumb: thumb(n), src: thumb(n).replace('500px', '1280px'), page: `https://commons.wikimedia.org/wiki/File:${fname(n)}`, license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0', author: 'Photographer ' + n, attribution: `Photographer ${n} · CC BY-SA 4.0 · Wikimedia Commons`, role, tier, width: 4000, height: 3000 })
const ISO = ['KR', 'JP', 'DE', 'FR', 'US', 'GB', 'NL', 'AU', 'BR', 'AE']
const TYPES = ['media_facade', 'projection_mapping', 'light_art', 'festival_program', 'media_architecture']

function project(i, o = {}) {
  return {
    id: 'Q' + (1000000 + i), qid: 'Q' + (1000000 + i), curated_id: null, name_en: `Media facade project number ${i}`, name_ko: i % 3 ? null : `미디어파사드 프로젝트 ${i}`, name_original: i % 4 ? null : `Projekt ${i}`, name_original_lang: i % 4 ? null : 'de',
    country_iso2: ISO[i % ISO.length], region: null, city: 'City ' + (i % 300), latitude: 10 + (i % 70) * 0.981234, longitude: -170 + (i % 340) * 0.987654, location_precision: 'exact',
    project_type: TYPES[i % TYPES.length], year_installed: 1990 + (i % 36), credits: [], official_url: null, commons_category: null, description_en: 'A light work.', description_ko: null,
    sources: [{ id: 'wikidata', kind: 'wikidata', title: 'Wikidata', url: 'https://www.wikidata.org/wiki/Q' + (1000000 + i), publisher: 'Wikidata' }], field_sources: { name_en: 'wikidata' },
    images: i % 5 < 2 ? [] : [img(i, i % 7 === 0 ? 'hero' : 'card', i % 7 === 0 ? 1 : 1 + (i % 4)), img(i + 1, 'detail', 4)], visit: null, record_origin: 'auto_collected', ...o,
  }
}
import T from '../site-public-cleared/archive-taxonomy.js'
const records = (n) => {
  const count = shardCount(n)
  return Array.from({ length: n }, (_, i) => { const p = project(i); p.region = T.regionOf(p.country_iso2); return publicRecord(p, { shard: shardOf(p.id, count), addedAt: '2026-10-20T06:17:00.000Z' }) })
}

test('shards: a power of two of about 200 projects each, stable per id', () => {
  assert.equal(shardCount(1), 1)
  assert.equal(shardCount(200), 1)
  assert.equal(shardCount(201), 2)
  assert.equal(shardCount(5000), 32)
  assert.equal(shardOf('Q7715933', 32), shardOf('Q7715933', 32))
  const rs = records(1000)
  const sizes = Object.values(rs.reduce((o, r) => ((o[r.shard] = (o[r.shard] || 0) + 1), o), {}))
  assert.equal(sizes.length, 8)
  assert.ok(Math.max(...sizes) <= 200 * 1.4, 'about 200 per shard: ' + sizes)
})

test('index.json: the contract fields first, under 1 MB raw for 5,000 projects, lazily loadable', () => {
  const rs = records(5000)
  const ix = buildIndex(rs)
  assert.deepEqual(ix.fields.slice(0, 13), ['id', 'name_ko', 'name_en', 'name_original', 'country_iso2', 'city', 'lat', 'lng', 'project_type', 'year', 'thumb', 'visual_rank', 'shard'])
  assert.deepEqual(ix.fields, INDEX_FIELDS)
  const bytes = Buffer.byteLength(JSON.stringify(ix))
  assert.ok(bytes < 1024 * 1024, `index of 5,000 rows is ${bytes} bytes`)
  assert.deepEqual(checkIndex(ix), [])
  // Large indexes name the thumbnail URL pattern once; the reader rule restores the exact URL.
  assert.equal(ix.thumb_template, THUMB_TEMPLATE)
  const t = ix.fields.indexOf('thumb')
  const withThumb = ix.rows.findIndex((r) => r[t])
  assert.match(ix.rows[withThumb][t], /^[0-9a-f]\/[0-9a-f]{2}\/[^/]+\.jpg$/)
  assert.equal(expandThumb(ix.rows[withThumb][t], ix.thumb_template), rs[withThumb].images.find((i) => i.role === 'card' || i.role === 'hero').thumb)
  const row = Object.fromEntries(ix.fields.map((f, i) => [f, ix.rows[2][i]]))
  assert.equal(row.visual_rank, 3, 'visual_rank is the card image tier: 1 media active at night … 4 context')
  assert.equal(ix.rows[0][t], null, 'no image → no thumb and no rank (the designed placeholder)')
  assert.equal(ix.rows[0][ix.fields.indexOf('visual_rank')], null)
  // A small archive keeps full https URLs (what the current app reads).
  const small = buildIndex(rs.slice(0, 300))
  assert.equal(small.thumb_template, undefined)
  assert.match(small.rows[2][t], /^https:\/\/upload\.wikimedia\.org\//)
})

test('home.json: hero only tier-1 allowlisted images; no image outside the home rule; every named project included', () => {
  const rs = records(60)
  const picks = new Map()
  for (const r of rs) {
    const hero = r.images.find((i) => i.role === 'hero') || null
    const card = r.images.find((i) => i.role === 'card') || null
    // Pretend only tier ≤ 3 dark-frame cards passed the home rule; tier 4 never does.
    picks.set(r.id, { hero, home: hero || (card && card.tier <= 3 ? card : null), score: card ? 5 - card.tier : 0 })
  }
  const home = buildHome(rs, picks, { buildId: 'b1', generatedAt: '2026-10-20T06:17:00.000Z' })
  assert.deepEqual(checkHome(home), [])
  assert.ok(home.hero.length >= 1 && home.hero.length <= 6)
  for (const h of home.hero) assert.equal(h.image.tier, 1)
  const imagesOnHome = [...home.hero.map((h) => h.image), ...home.regions.map((g) => g.image), ...home.types.map((g) => g.image), ...Object.values(home.projects).map((p) => p.image)].filter(Boolean)
  assert.ok(imagesOnHome.length > 0)
  for (const i of imagesOnHome) assert.ok(i.tier <= 3, 'a daytime (tier 4) image never reaches the home page')
  assert.ok(home.featured.length <= 12)
  const perCountry = {}
  for (const id of home.featured) { const c = home.projects[id].country_iso2; perCountry[c] = (perCountry[c] || 0) + 1 }
  assert.ok(Object.values(perCountry).every((n) => n <= 2), 'featured shows range: at most two per country')
  for (const id of [...home.featured, ...home.recent, ...home.hero.map((h) => h.project)]) assert.ok(home.projects[id], id)
  assert.ok(Buffer.byteLength(JSON.stringify(home)) < 100 * 1024, 'the home page needs only this small file')
})

test('records: public fields only, schema-valid; internal vocabulary is refused by the checks', () => {
  const r = records(3)[1]
  const errors = []
  checkRecord(r, 'r', (ok, p, problem) => { if (!ok) errors.push(p + ': ' + problem); return ok })
  assert.deepEqual(errors, [])
  for (const k of ['review_status', 'eligibility', 'evidence', 'score', 'field_status']) assert.ok(!(k in r), k)
  const bad = { ...r, review_status: 'unreviewed', images: [{ ...r.images[0], license: '' }] }
  const e2 = []
  checkRecord(bad, 'r', (ok, p, problem) => { if (!ok) e2.push(p + ': ' + problem); return ok })
  assert.ok(e2.some((e) => e.includes('review_status')))
  assert.ok(e2.some((e) => e.includes('license')), 'an image without a licence is never published')
  assert.equal(periodText({ start: '2026-09-01', end: '2026-10-31' }), '2026-09-01 – 2026-10-31')
})

test('manifest, stats and the whole dataset check together', () => {
  const rs = records(450)
  const shards = [...new Set(rs.map((r) => r.shard))].sort()
  const files = {
    manifest: buildManifest({ buildId: 'b2', generatedAt: '2026-10-20T06:17:00.000Z', records: rs, shards, sources: { wikidata: { status: 'ok', last_success: '2026-10-20T06:17:00.000Z', items: 450 } } }),
    index: buildIndex(rs),
    home: buildHome(rs, new Map(), { buildId: 'b2', generatedAt: '2026-10-20T06:17:00.000Z' }),
    stats: buildStats(rs, { buildId: 'b2', generatedAt: '2026-10-20T06:17:00.000Z' }),
    shards: Object.fromEntries(shards.map((s) => [s, { schema: 1, shard: s, build_id: 'b2', projects: rs.filter((r) => r.shard === s) }])),
  }
  assert.deepEqual(checkDataset(files), [])
  assert.equal(files.manifest.counts.projects, 450)
  assert.equal(Object.values(files.manifest.counts.by_type).reduce((a, b) => a + b, 0), 450)
  assert.deepEqual(files.manifest.files.shards, shards.map((s) => `projects/${s}.json`))
  assert.equal(files.stats.counts.projects, 450)
  assert.ok(files.stats.by_decade['2000s'] > 0)
  // Cross-file consistency is checked: a project missing from its shard is an error.
  const broken = { ...files, shards: { ...files.shards, [shards[0]]: { ...files.shards[shards[0]], projects: files.shards[shards[0]].projects.slice(1) } } }
  assert.ok(checkDataset(broken).some((e) => e.includes('not in shard')))
  assert.ok(checkManifest({ ...files.manifest, sources: { wikidata: { status: 'weird' } } }).length > 0)
})
