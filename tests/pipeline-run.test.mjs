// Pipeline integration: run.mjs over the recorded fixtures with an injected fetch and a virtual clock. It must
// produce a complete, schema-valid site-data/ (the fixture the UI track uses), admin-data/, review/ and state/,
// stay polite, keep the last good data when sources fail, track stale projects, and never publish a big drop.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, cp, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runPipeline } from '../pipeline/run.mjs'
import { USER_AGENT } from '../pipeline/lib/net.mjs'
import { loadSharp } from '../pipeline/lib/visual.mjs'
import { checkDataset, checkReport, checkQuality, checkCandidates } from '../pipeline/lib/schema.mjs'
import { fixtureEnvironment, FIXTURE_OVERRIDES, FIXTURE_ENV } from './fixtures/pipeline/fake-fetch.mjs'
import { tilePixels, tileShowsPicture, REVIEW } from '../pipeline/lib/contact-sheet.mjs'

const FIX = path.join(import.meta.dirname, 'fixtures/pipeline')
const EDITORIAL = path.join(FIX, 'editorial')
const START = Date.parse('2026-10-20T06:17:00Z')
const HOUR = 3600e3
const SHARP = await loadSharp().then(() => true, () => false)
const needSharp = SHARP ? {} : { skip: 'sharp is not installed (npm ci --prefix pipeline)' }

async function run(dataDir, { start = START, fail = null, pipeline = {}, keys = FIXTURE_ENV } = {}) {
  const env = fixtureEnvironment({ start, fail })
  const overrides = { ...FIXTURE_OVERRIDES, pipeline: { ...FIXTURE_OVERRIDES.pipeline, ...pipeline } }
  const r = await runPipeline({ dataDir, editorialDir: EDITORIAL, fetch: env.fetch, clock: env.clock, sleep: env.sleep, overrides, env: keys, log: () => {} })
  return { ...r, env }
}
const readJSON = async (f) => JSON.parse(await readFile(f, 'utf8'))
async function site(dataDir) {
  const d = path.join(dataDir, 'site-data')
  const manifest = await readJSON(path.join(d, 'manifest.json'))
  const shards = {}
  for (const f of manifest.files.shards) shards[f.replace(/^projects\/|\.json$/g, '')] = await readJSON(path.join(d, f))
  const records = new Map(Object.values(shards).flatMap((s) => s.projects).map((r) => [r.id, r]))
  return { manifest, index: await readJSON(path.join(d, 'index.json')), home: await readJSON(path.join(d, 'home.json')), stats: await readJSON(path.join(d, 'stats.json')), shards, records }
}
const tmp = () => mkdtemp(path.join(tmpdir(), 'aol-pipeline-'))

let first = null // {dir, result, data}
async function firstRun() {
  if (first) return first
  const dir = await tmp()
  const result = await run(dir)
  first = { dir, result, data: await site(dir) }
  return first
}

test('dry run: a complete, schema-valid dataset with every output file', needSharp, async () => {
  const { dir, result, data } = await firstRun()
  assert.equal(result.publishStatus, 'published')
  assert.equal(result.report.run.status, 'ok', JSON.stringify(result.report.stages))
  assert.deepEqual(checkDataset(data), [])
  const admin = path.join(dir, 'admin-data')
  assert.deepEqual(checkReport(await readJSON(path.join(admin, 'report.json'))), [])
  assert.deepEqual(checkQuality(await readJSON(path.join(admin, 'quality.json'))), [])
  assert.deepEqual(checkCandidates(await readJSON(path.join(admin, 'candidates.json'))), [])
  for (const f of ['classes.json', 'properties.json', 'categories.json', 'wikipedia.json', 'images.json', 'providers.json', 'korea.json', 'tourapi.json', 'web.json', 'http-log.json', 'contact-sheets/index.json', 'contact-sheets/hero-commons-01.jpg', 'contact-sheets/featured-commons-01.jpg', 'contact-sheets/cards-01.jpg']) assert.ok(existsSync(path.join(dir, 'review', f)), f)
  for (const f of ['runs.json', 'tracker.json', 'failures.json', 'web-rules.json', 'candidates.json', 'image-picks.json', 'cache/entities.json', 'cache/sparql.json', 'cache/commons-files.json', 'cache/visual.json', 'cache/quality.json', 'cache/tourapi.json', 'cache/openverse.json', 'cache/links.json']) assert.ok(existsSync(path.join(dir, 'state', f)), f)
  assert.equal(data.manifest.build_id, result.buildId)
  assert.ok(Object.values(data.manifest.sources).every((s) => s.status === 'ok'))
  // All 49 curated seed places are part of the dataset, with their own ids.
  const curated = [...data.records.keys()].filter((id) => /^SEOUL\d{3}$/.test(id))
  assert.equal(curated.length, 49)
})

test('dry run: sources become projects only through the rules (merges, rejections, blocklist, editorial)', needSharp, async () => {
  const { dir, data } = await firstRun()
  const r = (id) => data.records.get(id)
  // Class instances, Commons categories and Wikipedia articles of the same item are one project.
  assert.ok(r('Q7715933'))
  assert.equal(r('Q7715933').name_ko, '더 베이 라이츠', 'editorial edit applied')
  assert.ok(r('Q7715933').sources.some((s) => s.kind === 'commons'))
  // The curated place found again through a Korean Wikipedia article stays the curated record.
  assert.equal(r('SEOUL018').wikidata, 'Q494895')
  assert.equal(r('SEOUL018').building_name, '롯데월드타워', 'the host building, named from Wikidata')
  assert.ok(r('SEOUL018').sources.some((s) => s.kind === 'wikipedia' && s.url.startsWith('https://ko.wikipedia.org/')))
  assert.ok(!data.records.has('Q494895'))
  // Two Wikidata items of one festival: merged by an editorial decision, both sources kept.
  assert.ok(!data.records.has('Q18391691'))
  assert.ok(r('Q15140473').sources.some((s) => s.url === 'https://www.wikidata.org/wiki/Q18391691'))
  // Wikipedia media-facade discovery: a building whose article states it, with the article as the source.
  assert.equal(r('Q99000101').project_type, 'media_facade')
  assert.ok(r('Q99000101').sources.some((s) => s.kind === 'wikipedia' && /Galleria_Centercity/.test(s.url)))
  assert.equal(r('Q99000103').country_iso2, 'AT')
  const wiki = await readJSON(path.join(dir, 'review/wikipedia.json'))
  const decision = (q) => wiki.entity_decisions.find((d) => d.qid === q)
  assert.equal(decision('Q99000101').accepted, true)
  assert.equal(decision('Q99000301').accepted, false, 'a city article is not a project')
  assert.ok(decision('Q99000301').entity_reasons.includes('area_not_project'))
  assert.ok(!decision('Q99000104') || !decision('Q99000104').accepted, 'a company is never a project')
  assert.ok(!decision('Q99000105') || !decision('Q99000105').accepted, 'a person is never a project')
  assert.ok(!wiki.entity_decisions.some((d) => d.qid === 'Q17158007'), 'the article about the concept itself is skipped')
  assert.ok(wiki.hits.every((h) => Array.isArray(h.reasons) && typeof h.score === 'number'), 'every hit is logged with its score and reasons')
  for (const id of ['Q99000107', 'Q99000108', 'Q99000106', 'Q6703289', 'Q99000104', 'Q99000301', 'Q99000105']) assert.ok(!data.records.has(id), id)
  const quality = await readJSON(path.join(dir, 'admin-data/quality.json'))
  const excluded = Object.fromEntries(quality.excluded.map((x) => [x.id, x.reasons]))
  assert.deepEqual(excluded.Q99000107, ['blocklist:Q60744298'], 'a drone display enters through light art and is blocked')
  assert.deepEqual(excluded.Q99000108, ['hidden_by_editor'])
  assert.ok(excluded.Q99000106.includes('class_requires_coordinates'))
  assert.ok(Object.values(excluded).some((x) => x.includes('no_country')), 'a Commons category without a place is not public')
  // Editor-created record (approve new:…).
  assert.equal(r('ED-fixture-light-pavilion').record_origin, 'editor_created')
  // Unverified classes are queried for counts only, never for instances.
  const classes = await readJSON(path.join(dir, 'review/classes.json'))
  const media = classes.classes.find((c) => c.qid === 'Q110775916')
  assert.equal(media.publish, false)
  assert.equal(media.instances, 26875)
  assert.ok(media.reasons.includes('not_verified'))
  const sparqlKinds = first.result.env.requests.filter((q) => q.host === 'query.wikidata.org').map((q) => q.sparql)
  assert.ok(sparqlKinds.includes('class-count Q110775916'))
  assert.ok(!sparqlKinds.includes('class-instances Q110775916'), 'never published from: its instances are not even read')
  assert.ok(sparqlKinds.includes('class-instances Q1823448'))
  assert.equal(classes.classes.find((c) => c.qid === 'Q1823448').live_label, 'light installation')
})

test('dry run: images follow the per-surface rules', needSharp, async () => {
  const { data } = await firstRun()
  const r = (id) => data.records.get(id)
  const role = (rec, re) => rec.images.find((i) => re.test(i.page) || re.test(i.src))
  const bay = r('Q7715933')
  assert.equal(bay.images[0].role, 'hero')
  assert.equal(bay.images[0].tier, 2, 'light art running at night (tier 1 is a media facade)')
  assert.equal(bay.images[0].src, 'https://upload.wikimedia.org/wikipedia/commons/e/ed/The_Bay_Lights_at_night_2013.jpg', 'src is the original file')
  assert.deepEqual(bay.images[0].display.map(([w]) => w), [330, 500, 960, 1280, 1920, 3840, 4000], 'standard widths below the original, then the original itself (under 8 MB)')
  assert.equal(bay.images[0].display.at(-1)[1], bay.images[0].src)
  assert.ok(bay.images[0].quality.sharpness >= 35 && bay.images[0].quality.blockiness <= 20)
  assert.ok(!bay.images.some((i) => /Embarcadero_daytime/.test(i.page)), 'block_image applied')
  assert.ok(!bay.images.some((i) => /map\.png/.test(i.page)), 'a map is never a project image')
  assert.ok(!bay.images.some((i) => /small_copy/.test(i.page)), 'a smaller near-duplicate is removed')
  // Rights: NoFoP of another country and a non-free licence are rejected; the Korean FoP policy allows display.
  assert.ok(!r('Q4167').images.some((i) => /Terreaux|crowd/.test(i.page)))
  assert.equal(r('Q4167').images[0].role, 'hero', 'set_hero decision on a reviewed night projection')
  assert.ok(r('SEOUL018').images.some((i) => i.role === 'hero' && i.tier === 1 && /media_facade_at_night/.test(i.page)))
  assert.ok(!r('SEOUL018').images.some((i) => /interior/.test(i.page)), 'an interior photo is unrelated to a media facade')
  // Quality gates: a heavily compressed or blurred copy is never a hero or featured image.
  for (const [id, re] of [['Q15140473', /compressed/], ['Q125715', /blurred/]]) {
    const i = role(r(id), re)
    if (i) assert.ok(!['hero', 'featured'].includes(i.role), id)
  }
  // A daytime photo may be a card below the media tiers (tier 5), never on the home page; darkness alone never qualifies.
  assert.equal(r('Q7899954').images[0].tier, 5)
  assert.equal(r('Q2001578').images[0].tier, 5)
  const homeImages = [...data.home.hero.map((h) => h.image), ...data.home.regions.map((g) => g.image), ...data.home.types.map((g) => g.image), ...data.home.kr_regions.map((g) => g.image), ...Object.values(data.home.projects).map((p) => p.image)].filter(Boolean)
  assert.ok(homeImages.length >= 5)
  for (const i of homeImages) {
    assert.ok(i.tier <= 3, i.page)
    assert.ok(!/daytime|Tribute_in_Light|colourful_day/.test(i.page), 'never a daytime or dark-only photo on the home page: ' + i.page)
  }
  // Hero: reviewed tier-1/2 images, Korean first (3 Korean slides allow one foreign).
  assert.deepEqual(data.home.hero.map((h) => h.project), ['SEOUL018', 'Q99000501', 'SEOUL006', 'Q4167'])
  for (const h of data.home.hero) { assert.ok(h.image.tier <= 2); assert.ok(h.image.width >= 2400); assert.equal(h.image.approved, true) }
  assert.equal(data.home.projects.Q7899954?.image ?? null, null)
  // P180 depicts: the media facade at night is found through structured data; the daytime exterior is context.
  const ddp = r('SEOUL006')
  assert.equal(ddp.images[0].role, 'hero')
  assert.match(ddp.images[0].page, /Seoul_Light_DDP_2019_media_facade_night\.jpg$/)
  assert.deepEqual(ddp.images.filter((i) => /exterior_daytime/.test(i.page)).map((i) => [i.role, i.tier]), [['context', 5]])
  assert.ok(!ddp.images.some((i) => i.provider === 'flickr'), 'the Flickr copy of the reviewed Commons photo is a near-duplicate')
  // Other providers: an approved Openverse photo, TourAPI images with their KOGL licences, an official image set by an editor.
  const lotte = r('SEOUL018')
  const ov = lotte.images.find((i) => i.provider === 'openverse')
  assert.ok(ov, 'the approved Openverse photo')
  assert.equal(ov.identity.method, 'name_location')
  assert.equal(ov.license, 'CC BY 2.0')
  assert.equal(ov.usage, 'hotlink', 'a Flickr-hosted file is shown from Flickr')
  assert.equal(ov.approved, true)
  const tour = lotte.images.filter((i) => i.provider === 'tourapi')
  assert.ok(tour.length >= 1)
  for (const i of tour) { assert.equal(i.identity.method, 'provider_id'); assert.match(i.license, /^KOGL Type [13]$/); assert.equal(!!i.no_derivatives, i.license === 'KOGL Type 3') }
  assert.ok(!lotte.images.some((i) => i.id === 'img-bbcdb0f8ce01'), 'block_image by image id')
  const official = r('SEOUL001').images[0]
  assert.equal(official.provider, 'official')
  assert.equal(official.permission_note, 'Fixture: the operator allows display with credit (e-mail of 2026-10-10).')
  assert.equal(official.role, 'featured')
  assert.equal(official.width, 2048, 'the size of the decoded original')
  // Every published image names its licence and its author; display sizes never exceed the original.
  for (const rec of data.records.values()) for (const i of rec.images) {
    assert.ok(i.license && (i.author || i.attribution), rec.id)
    assert.ok(i.display.every(([w]) => !i.width || w <= i.width), rec.id + ' ' + i.id)
    assert.ok(![i.src, i.thumb, ...i.display.map((d) => d[1])].some((u) => /utm_/.test(u)), 'no analytics parameters')
  }
  const report = first.result.report
  assert.equal(report.hero_list.find((h) => h.project === 'Q7899954').status, 'not_eligible')
  assert.ok(report.images.rejected['rights:foreign_no_freedom_of_panorama'] >= 1)
  assert.ok(report.images.rejected['rights:license_not_allowed'] >= 1)
  assert.ok(report.images.by_provider.commons > 0 && report.images.by_provider.tourapi > 0)
})

test('relevance: files that name another subject never rank (regressions of the live review)', needSharp, async () => {
  const { dir, data } = await firstRun()
  const pages = (id) => (data.records.get(id)?.images || []).map((i) => decodeURIComponent(i.page))
  const mislinked = [['SEOUL043', 'Nanta Cooking Teddy Bears'], ['SEOUL022', 'G-20 Seoul 2010'], ['Q15014400', 'neon sign'], ['Q127587129', 'Bergischer Löwe']]
  for (const [id, name] of mislinked) assert.ok(!pages(id).some((p) => p.includes(name.replace(/ /g, '_'))), `${id}: ${name}`)
  // The real photos of the same projects stay.
  assert.ok(pages('SEOUL043').some((p) => /N_Seoul_Tower_at_night/.test(p)))
  assert.ok(pages('Q15014400').some((p) => /LED_facade_at_night/.test(p)))
  const review = JSON.parse(await readFile(path.join(dir, 'review/images.json'), 'utf8'))
  const reasons = (id, re) => review.projects.find((p) => p.project === id).candidates.find((c) => re.test(c.key)).reasons
  assert.ok(reasons('SEOUL043', /Teddy/).some((r) => r.startsWith('subject:object_or_animal')))
  assert.ok(reasons('SEOUL022', /G-20/).some((r) => r.startsWith('subject:people_or_event')))
  assert.ok(reasons('Q15014400', /neon sign/).some((r) => r.startsWith('subject:object_or_animal')))
  assert.ok(reasons('Q127587129', /Löwe/).some((r) => r.startsWith('subject:object_or_animal')))
})

test('institution files: a curated place never inherits its museum, tower or district category (second live review)', needSharp, async () => {
  const { dir, data } = await firstRun()
  const fileOf = (i) => decodeURIComponent(i.page).split('File:').pop().replace(/_/g, ' ')
  const roles = (id) => new Map((data.records.get(id)?.images || []).map((i) => [fileOf(i), i.role]))
  // The exact files of the live site (2026-10-25): SEOUL022 NMK Immersive Digital Gallery (host: the museum) and
  // SEOUL043 N Seoul Tower (its item is the tower, not the lighting work).
  const live = {
    SEOUL022: ['2010.11.11 G20 서울 정상회의 (7445962682).jpg', 'G-20 Seoul 2010 - Lee Myung-bak and Cristina Fernández de Kirchner (01).jpg', 'G-20 Seoul 2010 - Lee Myung-bak and Cristina Fernández de Kirchner (02).jpg',
      'KOCIS Reenactment of a royal wedding on Mar 5, 2012 (6812195536).jpg', 'KOCIS Reenactment of a royal wedding on Mar 5, 2012 (6812195870).jpg', '국립중앙박물관야간모습01.jpg'],
    SEOUL043: ['Goong Teddy Bears.JPG', 'Nanta Cooking Teddy Bears.JPG', 'Connect Terrace Seoul Station.png', 'Haebangchon (55192249973).jpg', '서울역 앞 대우빌딩 전경.jpg', 'Seoul Aerial Shot 07.jpg', 'Cable car up the Seoul Tower (33580430468).jpg'],
  }
  for (const [id, files] of Object.entries(live)) {
    const r = roles(id)
    for (const f of files) assert.ok(!r.has(f) || r.get(f) === 'context', `${id}: ${f} is ${r.get(f)}`)
    const rec = data.records.get(id)
    for (const i of rec.images) if (live[id].includes(fileOf(i))) assert.equal(i.tier, 5, fileOf(i))
    // Its card (index thumb) is never one of them.
    const row = data.index.rows.find((x) => x[data.index.fields.indexOf('id')] === id)
    const thumb = decodeURIComponent(row[data.index.fields.indexOf('thumb')] || '')
    assert.ok(thumb, id + ' has a card')
    for (const f of files) assert.ok(!thumb.includes(f.replace(/ /g, '_')), `${id} thumb ${f}`)
  }
  // People, events and objects are rejected outright; the institution's own views are context.
  const review = JSON.parse(await readFile(path.join(dir, 'review/images.json'), 'utf8'))
  const cand = (id, re) => review.projects.find((p) => p.project === id).candidates.find((c) => re.test(c.key))
  for (const re of [/^2010\.11\.11 G20/, /\(01\)\.jpg$/, /6812195536/]) assert.ok(cand('SEOUL022', re).reasons.some((x) => x.startsWith('subject:people_or_event')), String(re))
  assert.ok(cand('SEOUL043', /^Goong Teddy/).reasons.some((x) => x.startsWith('subject:object_or_animal')))
  for (const re of [/^Connect Terrace/, /^Haebangchon/, /대우빌딩/, /Aerial Shot 07/, /^Cable car/]) assert.ok(cand('SEOUL043', re).evidence.includes('host_building_only'), String(re))
  assert.ok(cand('SEOUL022', /야간모습01/).evidence.includes('host_building_only'), 'a night view of the museum is not the immersive gallery inside')
  // What shows the work stays: the gallery's own photo (it names the work) and the tower lit at night.
  assert.equal(roles('SEOUL022').get('국립중앙박물관 디지털 실감 영상관 파노라마 2021.jpg'), 'card')
  assert.ok(['card', 'featured', 'hero'].includes(roles('SEOUL043').get('N Seoul Tower at night 2019.jpg')))
  assert.ok(first.result.report.images.institution_context >= 6)
})

test('contact sheets show real pictures on every run, also when the measurements come from the cache', needSharp, async () => {
  const { dir } = await firstRun()
  const first = JSON.parse(await readFile(path.join(dir, 'review/contact-sheets/index.json'), 'utf8'))
  const tiles = (ix) => ix.sheets.flatMap((s) => s.tiles)
  assert.ok(tiles(first).length >= 5)
  assert.ok(tiles(first).every((t) => t.image_in_sheet), 'first run')
  assert.ok(first.sheets.some((s) => s.kind === 'hero' && s.provider === 'commons'))
  assert.ok(tiles(first).every((t) => /^img-[0-9a-f]{12}$/.test(t.image) && t.thumb && !/utm_/.test(t.thumb)))
  const copy = await tmp()
  await cp(dir, copy, { recursive: true })
  const r2 = await run(copy, { start: START + 6 * HOUR })
  const second = JSON.parse(await readFile(path.join(copy, 'review/contact-sheets/index.json'), 'utf8'))
  assert.equal(tiles(second).length, tiles(first).length)
  assert.ok(tiles(second).every((t) => t.image_in_sheet), 'a cached run fetches the small renditions it shows')
  // The written JPEGs read back: every tile of every sheet shows the fixture picture's pixels, not the grey box.
  for (const [d, ix] of [[dir, first], [copy, second]]) {
    for (const s of ix.sheets) {
      assert.equal(s.grey_tiles, 0, s.sheet)
      const jpg = await readFile(path.join(d, 'review/contact-sheets', s.sheet))
      for (let i = 0; i < s.tiles.length; i++) {
        const px = await tilePixels(jpg, i, REVIEW)
        assert.ok(tileShowsPicture(px), `${d === dir ? 'first' : 'cached'} run ${s.sheet} tile ${i + 1} ${s.tiles[i].image}: ${JSON.stringify(px)}`)
      }
    }
  }
  assert.ok(r2.env.requests.filter((q) => /wikimedia\.org$/.test(q.host) && /\/330px-/.test(q.url)).every((q) => !/utm_/.test(q.url)))
})

test('dry run: quality, candidates and the decision log', needSharp, async () => {
  const { dir } = await firstRun()
  const quality = await readJSON(path.join(dir, 'admin-data/quality.json'))
  assert.deepEqual(quality.broken_links.map((l) => [l.project, l.http_status]), [['Q99000101', 404]])
  assert.deepEqual(quality.robots_disallowed.map((l) => l.project), ['Q15140473'], 'robots.txt is honoured before an HTML page')
  assert.deepEqual(quality.coordinate_checks.map((c) => [c.id, c.status]), [['Q7899954', 'mismatch']])
  assert.ok(quality.missing_images.some((m) => m.id === 'Q99000101'))
  assert.ok(quality.low_confidence_types.some((m) => m.id === 'Q56089114'))
  assert.deepEqual(quality.suspected_duplicates, [], 'the Signal Festival pair was merged by the editor')
  const cand = await readJSON(path.join(dir, 'admin-data/candidates.json'))
  const byTitle = Object.fromEntries(cand.candidates.map((c) => [c.hits[0].title, c]))
  assert.equal(byTitle['Seoul unveils a new media facade on the city hall building']?.status, 'needs_review')
  assert.ok(byTitle['Projection mapping festival lights up a historic facade in Porto'])
  for (const c of cand.candidates) assert.ok(c.classification.reasons && typeof c.confidence === 'number')
  const report = first.result.report
  const status = Object.fromEntries(report.decisions.map((d) => [d.file, d.status]))
  assert.equal(status['2026-10-01T09-00-00Z-merge.json'], 'applied')
  assert.equal(status['2026-10-07T09-00-00Z-approve.json'], 'target_not_found')
  assert.equal(status['2026-10-08T09-00-00Z-delete.json'], 'invalid')
  assert.equal(status['2026-10-09T09-00-00Z-hide.json'], 'superseded')
  assert.equal(report.counts.candidates_awaiting_review, cand.candidates.filter((c) => c.status === 'needs_review' || c.status === 'uncertain').length)
  assert.ok(report.counts.hero_candidates_awaiting_review >= 1)
})

test('dry run: polite to every source (User-Agent, maxlag, per-host rate limits)', needSharp, async () => {
  const { requests } = first ? first.result.env : (await firstRun()).result.env
  assert.ok(requests.length > 50)
  for (const q of requests) assert.equal(q.ua, USER_AGENT, q.url)
  for (const q of requests.filter((x) => /\/w\/api\.php/.test(x.url))) assert.match(q.url, /[?&]maxlag=5(&|$)/, q.url)
  const byHost = {}
  for (const q of requests) (byHost[q.host] ||= []).push(q.at)
  const minGap = (host) => { const t = byHost[host] || []; let m = Infinity; for (let i = 1; i < t.length; i++) m = Math.min(m, t[i] - t[i - 1]); return m }
  for (const host of ['query.wikidata.org', 'www.wikidata.org', 'commons.wikimedia.org', 'en.wikipedia.org', 'ko.wikipedia.org']) assert.ok(minGap(host) >= 1000, `${host}: ${minGap(host)} ms`)
  assert.ok(minGap('upload.wikimedia.org') >= 200)
  assert.ok(!requests.some((q) => /class-instances/.test(q.url)), 'SPARQL queries are POSTed, not in URLs')
})

test('the committed fixture site-data is the output of this dry run', needSharp, async () => {
  const { dir } = await firstRun()
  const committed = path.join(FIX, 'site-data')
  const files = async (d) => (await readdir(d, { recursive: true, withFileTypes: true })).filter((e) => e.isFile()).map((e) => path.relative(d, path.join(e.parentPath, e.name))).sort()
  const now = await files(path.join(dir, 'site-data'))
  assert.deepEqual(await files(committed), now, 'run: node tests/fixtures/pipeline/make-site-data.mjs')
  for (const f of now) assert.equal(await readFile(path.join(committed, f), 'utf8'), await readFile(path.join(dir, 'site-data', f), 'utf8'), f + ' differs: run node tests/fixtures/pipeline/make-site-data.mjs')
})

test('an unchanged second run is idempotent: same build id, byte-identical files, answers from the caches', needSharp, async () => {
  const { dir } = await firstRun()
  const copy = await tmp()
  await cp(dir, copy, { recursive: true })
  const before = await readFile(path.join(copy, 'site-data/index.json'), 'utf8')
  const r2 = await run(copy, { start: START + 6 * HOUR })
  assert.equal(r2.publishStatus, 'unchanged')
  assert.equal(r2.buildId, first.result.buildId)
  assert.equal(await readFile(path.join(copy, 'site-data/index.json'), 'utf8'), before)
  assert.ok(r2.env.requests.length < first.result.env.requests.length / 5, `${r2.env.requests.length} requests on the second run`)
  assert.ok(!r2.env.requests.some((q) => q.host === 'query.wikidata.org'), 'class counts and instances come from the 24 h cache')
  const feed = r2.env.requests.find((q) => q.host === 'www.dezeen.com')
  assert.equal(feed?.if_none_match, '"fixture-feed-1"', 'feeds are read with a conditional GET')
  assert.equal(r2.report.run.number, 2)
})

test('when every source fails, the last good dataset stays published and the report says why', needSharp, async () => {
  const { dir, data } = await firstRun()
  const copy = await tmp()
  await cp(dir, copy, { recursive: true })
  // Ten days later (caches expired) and nothing answers.
  const r = await run(copy, { start: START + 240 * HOUR, fail: () => new TypeError('fetch failed') })
  const after = await site(copy)
  assert.deepEqual([...after.records.keys()].sort(), [...data.records.keys()].sort(), 'no project is removed by a failed run')
  for (const id of ['Q7715933', 'Q4167', 'Q99000101']) assert.deepEqual({ ...after.records.get(id), shard: null }, { ...data.records.get(id), shard: null }, id + ' is carried over unchanged')
  for (const s of ['wikidata', 'commons', 'wikipedia', 'web']) assert.equal(r.report.sources[s].status, 'error', s)
  assert.ok(r.report.counts.carried_over >= 9)
  assert.ok(r.report.changes.carried_over.every((c) => c.reason === 'source_not_complete'))
  assert.equal(r.report.run.status, 'partial')
  assert.ok(r.report.sources.wikidata.consecutive_failures >= 1)
  assert.equal(after.manifest.sources.wikidata.status, 'error')
  assert.ok(after.manifest.sources.wikidata.last_success, 'the last success time is kept')
  assert.deepEqual(checkDataset(after), [])
  assert.deepEqual(checkReport(r.report), [])
})

test('a project that disappears from complete sources is stale for two runs, then removed', needSharp, async () => {
  const { dir } = await firstRun()
  const copy = await tmp()
  await cp(dir, copy, { recursive: true })
  // Tribute in Light is no longer an instance of light installation (its Commons category is gone too).
  const without = (url, init) => {
    const body = String(init?.body || '')
    if (url.startsWith('https://query.wikidata.org/') && /class-instances(\+|%20| )Q1823448/.test(body)) return new Response(JSON.stringify({ head: { vars: ['item'] }, results: { bindings: ['Q7715933', 'Q5447104', 'Q7899954', 'Q99000108'].map((q) => ({ item: { type: 'uri', value: 'http://www.wikidata.org/entity/' + q } })) } }), { headers: { 'content-type': 'application/sparql-results+json' } })
    if (url.startsWith('https://commons.wikimedia.org/') && /gcmtitle=Category%3ALight\+art&/.test(url)) return new Response(JSON.stringify({ batchcomplete: true, query: { pages: [] } }), { headers: { 'content-type': 'application/json' } })
    return null
  }
  const runs = []
  for (let i = 1; i <= 3; i++) runs.push(await run(copy, { start: START + i * 80 * HOUR, fail: without }))
  const q = await readJSON(path.join(copy, 'admin-data/quality.json'))
  assert.deepEqual(runs.map((r) => r.report.changes.carried_over.find((c) => c.id === 'Q2001578')?.missing_runs ?? null), [1, 2, null])
  assert.ok(runs[2].report.changes.removed.some((x) => x.id === 'Q2001578' && x.reason === 'not_seen_in_3_runs'))
  assert.ok(!(await site(copy)).records.has('Q2001578'))
  assert.ok(!q.stale.some((s) => s.id === 'Q2001578'))
  assert.ok((await readJSON(path.join(dir, 'admin-data/quality.json'))).stale.length === 0)
})

test('the drop guard keeps the previous dataset when more than half would disappear at once', needSharp, async () => {
  const { dir, data } = await firstRun()
  const copy = await tmp()
  await cp(dir, copy, { recursive: true })
  // A previous dataset with 200 more projects that the tracker says were already missing twice from complete sources.
  const m = await readJSON(path.join(copy, 'site-data/manifest.json'))
  const shard = await readJSON(path.join(copy, 'site-data', m.files.shards[0]))
  const tracker = await readJSON(path.join(copy, 'state/tracker.json'))
  const base = shard.projects.find((p) => p.id === 'Q7715933')
  for (let i = 0; i < 200; i++) {
    const id = 'Q' + (99100000 + i)
    shard.projects.push({ ...base, id, wikidata: id, name_ko: null, name_en: 'Old project ' + i })
    tracker.projects[id] = { first_seen: '2026-01-01T00:00:00.000Z', last_seen: '2026-10-01T00:00:00.000Z', last_seen_run: 0, missing_runs: 2, origins: ['wikidata_class'] }
  }
  await writeFile(path.join(copy, 'site-data', m.files.shards[0]), JSON.stringify(shard))
  await writeFile(path.join(copy, 'state/tracker.json'), JSON.stringify(tracker))
  const r = await run(copy, { start: START + 30 * HOUR })
  assert.equal(r.publishStatus, 'kept_previous_drop_guard')
  assert.equal(r.report.run.status, 'kept_previous_drop_guard')
  assert.deepEqual(r.report.run.drop_guard, { previous: data.records.size + 200, now: data.records.size })
  const kept = await readJSON(path.join(copy, 'site-data', m.files.shards[0]))
  assert.equal(kept.projects.length, shard.projects.length, 'site-data is untouched')
  assert.equal((await readJSON(path.join(copy, 'state/tracker.json'))).projects.Q99100000.missing_runs, 2, 'the tracker does not advance on a kept run')
})

test('P180 depicts searches: only for projects without named night and media evidence, capped per run, then cached', needSharp, async () => {
  const depicts = (env) => env.requests.filter((q) => /haswbstatement/.test(decodeURIComponent(q.url))).map((q) => decodeURIComponent(q.url).match(/P180=(Q\d+)/)[1])
  const { result } = await firstRun()
  const all = depicts(result.env)
  assert.equal(result.report.images.depicts_searches, all.length)
  assert.ok(all.includes('Q5295847'))
  assert.ok(!all.includes('Q494895'), 'Lotte World Tower already has "media facade at night" in a file name')
  assert.equal(new Set(all).size, all.length, 'one search per item')
  const dir = await tmp()
  const capped = await run(dir, { pipeline: { images: { depicts_max_per_run: 3 } } })
  assert.deepEqual(depicts(capped.env), all.slice(0, 3), 'the cap counts new searches, in the image stage order')
  assert.equal(capped.report.images.depicts_searches, 3)
  // The next run continues with the items not asked yet (projects that got images move ahead in its order); the
  // answers of the first three come from the cache.
  const next = await run(dir, { start: START + 6 * HOUR, pipeline: { images: { depicts_max_per_run: 3 } } })
  const asked = depicts(next.env)
  assert.equal(asked.length, Math.min(3, all.length - 3))
  assert.ok(asked.every((q) => all.includes(q) && !all.slice(0, 3).includes(q)), JSON.stringify(asked))
})

test('a short time budget gives partial but consistent output', needSharp, async () => {
  const dir = await tmp()
  const r = await run(dir, { pipeline: { budget_minutes: 0.5 } })
  const d = await site(dir)
  assert.deepEqual(checkDataset(d), [])
  assert.equal(r.report.run.status, 'partial')
  assert.ok(Object.values(r.report.stages).some((s) => s.status === 'partial') || Object.values(r.report.sources).some((s) => s.status === 'partial'))
  assert.ok(d.records.size >= 49, 'the curated places are always there')
  // Over the good dataset, a short run removes nothing.
  const { dir: good, data } = await firstRun()
  const copy = await tmp()
  await cp(good, copy, { recursive: true })
  await run(copy, { start: START + 300 * HOUR, pipeline: { budget_minutes: 0.5 } })
  const after = await site(copy)
  for (const id of data.records.keys()) assert.ok(after.records.has(id), id)
  assert.deepEqual(checkDataset(after), [])
})

test('without sharp or any image file the run still publishes, with no home images', async () => {
  const dir = await tmp()
  const imageHost = /^https:\/\/(upload\.wikimedia\.org|thumb\.wikimedia\.org|tong\.visitkorea\.or\.kr|live\.staticflickr\.com|official\.fixture\.example)\//
  const r = await run(dir, { fail: (url) => (imageHost.test(url) ? new Response('gone', { status: 404 }) : null) })
  const d = await site(dir)
  assert.deepEqual(checkDataset(d), [])
  assert.equal(d.home.hero.length, 0, 'no measured image → no hero')
  assert.ok(Object.values(d.home.projects).every((p) => p.image === null), 'nothing unmeasured reaches the home page')
  assert.ok(r.report.images.measure_errors > 0 || !SHARP)
})

test('fixtures generator and site-data writer exist and are documented', async () => {
  for (const f of ['README.md', 'make-fixtures.mjs', 'make-site-data.mjs', 'fake-fetch.mjs']) assert.ok(existsSync(path.join(FIX, f)), f)
})
