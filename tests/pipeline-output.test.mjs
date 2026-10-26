// Pipeline output (docs/STATIC_ARCHIVE.md "Output"): stable shards, the manifest, the compact index (under 1 MB for
// 5,000 projects), the home picks (never a daytime image), stats, and the schema checks of every file.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shardCount, shardOf, publicRecord, buildIndex, buildHome, buildStats, buildManifest, INDEX_FIELDS, periodText, THUMB_TEMPLATE, expandThumb, upgradeImage, upgradeRecord, thumbSize } from '../pipeline/lib/output.mjs'
import { stableImageId } from '../pipeline/lib/images.mjs'
import { KR_REGIONS } from '../pipeline/lib/korea.mjs'
import { checkDataset, checkRecord, checkIndex, checkHome, checkManifest } from '../pipeline/lib/schema.mjs'

// Realistic Commons names (about 45 characters) under their md5 directories.
const fname = (n) => `Media_facade_of_the_tower_${String(n).padStart(4, '0')}_at_night_2019.jpg`
const thumb = (n) => `https://upload.wikimedia.org/wikipedia/commons/thumb/${'abcdef'[n % 6]}/${'abcdef'[n % 6]}${n % 10}/${fname(n)}/500px-${fname(n)}`
// A v0.18 image object (lib/images.mjs imageObject) of a Commons file.
const img = (n, role, tier, project = null) => ({
  id: stableImageId('commons', fname(n)), project, provider: 'commons', src: thumb(n).replace('/thumb/', '/').replace(/\/500px-[^/]+$/, ''), page: `https://commons.wikimedia.org/wiki/File:${fname(n)}`,
  display: [330, 500, 960, 1280, 1920, 3840].map((w) => [w, thumb(n).replace('500px', w + 'px')]), thumb: thumb(n),
  author: 'Photographer ' + n, rights_holder: 'Photographer ' + n, license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0', attribution: `Photographer ${n} · CC BY-SA 4.0 · Wikimedia Commons`,
  usage: 'cache', width: 4000, height: 3000, bytes: 2400000, format: 'jpeg', quality: { sharpness: 70, blockiness: 3, score: 80 }, media_active: { score: tier <= 2 ? 80 : 20, reasons: ['visual:80'] },
  tier, role, checked_at: '2026-10-20', approved: role === 'hero' ? true : null,
})
const ISO = ['JP', 'DE', 'FR', 'KR', 'US', 'GB', 'NL', 'AU', 'BR', 'AE']
const TYPES = ['media_facade', 'projection_mapping', 'light_art', 'festival_program', 'media_architecture']

function project(i, o = {}) {
  return {
    id: 'Q' + (1000000 + i), qid: 'Q' + (1000000 + i), curated_id: null, name_en: `Media facade project number ${i}`, name_ko: i % 3 ? null : `미디어파사드 프로젝트 ${i}`, name_original: i % 4 ? null : `Projekt ${i}`, name_original_lang: i % 4 ? null : 'de',
    country_iso2: ISO[i % ISO.length], region: null, city: 'City ' + (i % 300), latitude: 10 + (i % 70) * 0.981234, longitude: -170 + (i % 340) * 0.987654, location_precision: 'exact',
    project_type: TYPES[i % TYPES.length], year_installed: 1990 + (i % 36), credits: [], official_url: null, commons_category: null, description_en: 'A light work.', description_ko: null,
    sources: [{ id: 'wikidata', kind: 'wikidata', title: 'Wikidata', url: 'https://www.wikidata.org/wiki/Q' + (1000000 + i), publisher: 'Wikidata' }], field_sources: { name_en: 'wikidata' },
    kr_region: ISO[i % ISO.length] === 'KR' ? KR_REGIONS[Math.floor(i / 10) % KR_REGIONS.length] : null,
    images: i % 5 < 2 ? [] : [img(i, i % 7 === 0 ? 'hero' : 'card', i % 7 === 0 ? 1 : 1 + (i % 4), 'Q' + (1000000 + i)), img(i + 1, 'gallery', 5, 'Q' + (1000000 + i))], visit: null, record_origin: 'auto_collected', ...o,
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
  assert.equal(row.visual_rank, 3, 'visual_rank is the card image tier: 1 media facade running … 5 architectural')
  assert.deepEqual([row.thumb_w, row.thumb_h], [500, 375], 'the thumb size for the layout')
  assert.equal(ix.rows[0][t], null, 'no image → no thumb and no rank (the designed placeholder)')
  assert.equal(ix.rows[0][ix.fields.indexOf('visual_rank')], null)
  // A small archive keeps full https URLs (what the current app reads).
  const small = buildIndex(rs.slice(0, 300))
  assert.equal(small.thumb_template, undefined)
  assert.match(small.rows[2][t], /^https:\/\/upload\.wikimedia\.org\//)
})

test('home.json v0.18: Korea first (hero ≥ 70 % Korean, eight regions, featured, programmes), world highlights, v0.17 fields kept', () => {
  const rs = records(140)
  const picks = new Map()
  for (const r of rs) {
    const hero = r.images.find((i) => i.role === 'hero') || null
    const card = r.images.find((i) => i.role === 'card') || null
    // Pretend only tier ≤ 3 dark-frame cards passed the home rule; tier 4–5 never do.
    picks.set(r.id, { hero, featured: null, home: hero || (card && card.tier <= 3 ? card : null), score: card ? 6 - card.tier : hero ? 9 : 0 })
  }
  const home = buildHome(rs, picks, { buildId: 'b1', generatedAt: '2026-10-20T06:17:00.000Z' })
  assert.deepEqual(checkHome(home), [])
  assert.ok(home.hero.length >= 1 && home.hero.length <= 6)
  for (const h of home.hero) assert.ok(h.image.tier <= 2 && h.image.role === 'hero')
  const krHero = home.hero.filter((h) => home.projects[h.project].country_iso2 === 'KR').length
  assert.ok(krHero >= 1, 'a Korean hero exists in this world')
  assert.ok(krHero / home.hero.length >= 0.7, `${krHero} of ${home.hero.length} hero slides are Korean`)
  assert.equal(home.kr_regions.length, 8)
  assert.deepEqual(home.kr_regions.map((g) => g.key), KR_REGIONS)
  assert.equal(home.kr_regions.reduce((n, g) => n + g.count, 0), rs.filter((r) => r.kr_region).length)
  for (const g of home.kr_regions) for (const id of g.projects) assert.equal(home.projects[id].kr_region, g.key)
  for (const id of [...home.kr_featured, ...home.kr_programs]) assert.equal(home.projects[id].country_iso2, 'KR')
  for (const id of home.world.highlights) assert.notEqual(home.projects[id].country_iso2, 'KR')
  assert.equal(home.counts.korea + home.counts.world, rs.length)
  // Home images carry their display sizes: up to 1920 and 3840 px when the original allows it.
  for (const h of home.hero) assert.ok(h.image.display.some(([w]) => w >= 1920) && h.image.display.every(([w]) => w <= h.image.width))
  const imagesOnHome = [...home.hero.map((h) => h.image), ...home.regions.map((g) => g.image), ...home.types.map((g) => g.image), ...home.kr_regions.map((g) => g.image), ...Object.values(home.projects).map((p) => p.image)].filter(Boolean)
  assert.ok(imagesOnHome.length > 0)
  for (const i of imagesOnHome) assert.ok(i.tier <= 3, 'an architectural (tier 4–5) image never reaches the home page')
  // v0.17 fields stay for the current app.
  assert.ok(home.featured.length <= 12)
  const perCountry = {}
  for (const id of home.featured) { const c = home.projects[id].country_iso2; if (c !== 'KR') perCountry[c] = (perCountry[c] || 0) + 1 }
  assert.ok(Object.values(perCountry).every((n) => n <= 2), 'featured shows range: at most two per foreign country')
  for (const id of [...home.featured, ...home.recent, ...home.hero.map((h) => h.project)]) assert.ok(home.projects[id], id)
  assert.ok(Array.isArray(home.regions) && Array.isArray(home.types) && Array.isArray(home.themes))
  assert.ok(Buffer.byteLength(JSON.stringify(home)) < 150 * 1024, 'the home page needs only this small file')
})

test('legacy records: a v0.17 image object and record become valid v0.18 ones', () => {
  const legacy = { thumb: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bf/Banpo.jpg/500px-Banpo.jpg?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail', src: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bf/Banpo.jpg/1920px-Banpo.jpg?utm_source=x', page: 'https://commons.wikimedia.org/wiki/File:Banpo.jpg', license: 'CC0', license_url: null, author: 'Wvdp', attribution: 'Wvdp · CC0 · Wikimedia Commons', role: 'hero', tier: 1, width: 3734, height: 2100 }
  const u = upgradeImage(legacy, 'SEOUL045')
  assert.equal(u.src, 'https://upload.wikimedia.org/wikipedia/commons/b/bf/Banpo.jpg', 'the original file, without analytics parameters')
  assert.equal(u.thumb, 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bf/Banpo.jpg/500px-Banpo.jpg')
  assert.deepEqual(u.display.map(([w]) => w), [330, 500, 960, 1280, 1920], 'standard widths below the original only')
  assert.deepEqual(thumbSize(u), [500, 281])
  assert.equal(upgradeImage({ ...legacy, role: 'detail', tier: 4 }, 'X').role, 'context')
  const rec = upgradeRecord({ ...records(1)[0], images: [legacy] })
  rec.images[0].project = rec.id
  const errors = []
  checkRecord(rec, 'r', (ok, p, problem) => { if (!ok) errors.push(p + ': ' + problem); return ok })
  assert.deepEqual(errors, [])
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
  // Relations name published records only; a record is never related to itself without a subject.
  const s0 = files.shards[shards[0]], [a, b] = s0.projects
  const withRel = (rels) => ({ ...files, shards: { ...files.shards, [shards[0]]: { ...s0, projects: [{ ...a, relations: rels }, ...s0.projects.slice(1)] } } })
  assert.deepEqual(checkDataset(withRel([{ type: 'part_of', target: b.id, source: 'wikidata:P361' }, { type: 'edition_of', target: a.id, source: 'commons:edition_category', subject: { name: 'X 2015', commons_category: 'Category:X 2015' } }])), [])
  assert.ok(checkDataset(withRel([{ type: 'part_of', target: 'Q404', source: 'wikidata:P361' }])).some((e) => e.includes('not published')))
  assert.ok(checkDataset(withRel([{ type: 'part_of', target: a.id, source: 'wikidata:P361' }])).some((e) => e.includes('not related to itself')))
  assert.ok(checkDataset(withRel([{ type: 'located_in', target: b.id, source: 'x' }])).some((e) => e.includes('relations[0].type')))
  assert.deepEqual(upgradeRecord({ ...a, relations: undefined }).relations, [], 'an earlier record has no relations')
})
