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
import { fixtureEnvironment, FIXTURE_OVERRIDES } from './fixtures/pipeline/fake-fetch.mjs'

const FIX = path.join(import.meta.dirname, 'fixtures/pipeline')
const EDITORIAL = path.join(FIX, 'editorial')
const START = Date.parse('2026-10-20T06:17:00Z')
const HOUR = 3600e3
const SHARP = await loadSharp().then(() => true, () => false)
const needSharp = SHARP ? {} : { skip: 'sharp is not installed (npm ci --prefix pipeline)' }

async function run(dataDir, { start = START, fail = null, pipeline = {} } = {}) {
  const env = fixtureEnvironment({ start, fail })
  const overrides = { ...FIXTURE_OVERRIDES, pipeline: { ...FIXTURE_OVERRIDES.pipeline, ...pipeline } }
  const r = await runPipeline({ dataDir, editorialDir: EDITORIAL, fetch: env.fetch, clock: env.clock, sleep: env.sleep, overrides, log: () => {} })
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
  for (const f of ['classes.json', 'properties.json', 'categories.json', 'wikipedia.json', 'images.json', 'web.json', 'http-log.json', 'contact-sheets/index.json', 'contact-sheets/hero-candidates-01.jpg', 'contact-sheets/cards-01.jpg']) assert.ok(existsSync(path.join(dir, 'review', f)), f)
  for (const f of ['runs.json', 'tracker.json', 'failures.json', 'web-rules.json', 'candidates.json', 'image-picks.json', 'cache/entities.json', 'cache/sparql.json', 'cache/commons-files.json', 'cache/visual.json', 'cache/links.json']) assert.ok(existsSync(path.join(dir, 'state', f)), f)
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
  const bay = r('Q7715933')
  assert.equal(bay.images[0].role, 'hero')
  assert.equal(bay.images[0].tier, 1)
  assert.match(bay.images[0].src, /1920px-The_Bay_Lights_at_night_2013\.jpg$/)
  assert.ok(!bay.images.some((i) => /Embarcadero_daytime/.test(i.page)), 'block_image applied')
  assert.ok(!bay.images.some((i) => /map\.png/.test(i.page)), 'a map is never a project image')
  // Rights: NoFoP of another country and a non-free licence are rejected; the Korean FoP policy allows display.
  assert.ok(!r('Q4167').images.some((i) => /Terreaux|crowd/.test(i.page)))
  assert.equal(r('Q4167').images[0].role, 'hero', 'set_hero decision on a reviewed night projection')
  assert.ok(r('SEOUL018').images.some((i) => i.role === 'hero' && /media_facade_at_night/.test(i.page)))
  assert.ok(!r('SEOUL018').images.some((i) => /interior/.test(i.page)), 'an interior photo is unrelated to a media facade')
  // A daytime photo may be a card below the media tiers, never on the home page; darkness alone never qualifies.
  assert.equal(r('Q7899954').images[0].tier, 4)
  assert.equal(r('Q2001578').images[0].tier, 4)
  const homeImages = [...data.home.hero.map((h) => h.image), ...data.home.regions.map((g) => g.image), ...data.home.types.map((g) => g.image), ...Object.values(data.home.projects).map((p) => p.image)].filter(Boolean)
  assert.ok(homeImages.length >= 5)
  for (const i of homeImages) {
    assert.ok(i.tier <= 3, i.page)
    assert.ok(!/daytime|Tribute_in_Light|colourful_day/.test(i.page), 'never a daytime or dark-only photo on the home page: ' + i.page)
  }
  assert.ok(data.home.hero.length >= 2)
  for (const h of data.home.hero) assert.equal(h.image.tier, 1)
  assert.equal(data.home.projects.Q7899954?.image ?? null, null)
  // P180 depicts: a building without P18 or a Commons category gets images through structured data, scored like any
  // other candidate: the media facade at night is the card, the daytime exterior only a tier-4 detail image.
  const ddp = r('SEOUL006')
  assert.equal(ddp.images[0].role, 'card')
  assert.equal(ddp.images[0].tier, 1)
  assert.match(ddp.images[0].page, /Seoul_Light_DDP_2019_media_facade_night\.jpg$/)
  assert.deepEqual(ddp.images.filter((i) => /exterior_daytime/.test(i.page)).map((i) => [i.role, i.tier]), [['detail', 4]])
  assert.match(data.home.projects.SEOUL006?.image?.page || '', /media_facade_night/)
  // Every published image names its licence and its author.
  for (const rec of data.records.values()) for (const i of rec.images) assert.ok(i.license && (i.author || i.attribution) && i.page.startsWith('https://commons.wikimedia.org/'), rec.id)
  // An allowlisted daytime photo is refused by the visual gates and reported.
  const report = first.result.report
  assert.equal(report.hero_list.find((h) => h.project === 'Q7899954').status, 'not_eligible')
  assert.ok(report.images.rejected['rights:foreign_no_freedom_of_panorama'] >= 1)
  assert.ok(report.images.rejected['rights:license_not_allowed'] >= 1)
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
  // The next run continues with the items not asked yet; the answers of the first three come from the cache.
  const next = await run(dir, { start: START + 6 * HOUR, pipeline: { images: { depicts_max_per_run: 3 } } })
  assert.deepEqual(depicts(next.env), all.slice(3, 6))
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

test('without sharp or any thumbnail the run still publishes, with no home images', async () => {
  const dir = await tmp()
  const r = await run(dir, { fail: (url) => (url.startsWith('https://upload.wikimedia.org/') ? new Response('gone', { status: 404 }) : null) })
  const d = await site(dir)
  assert.deepEqual(checkDataset(d), [])
  assert.equal(d.home.hero.length, 0, 'no measured image → no hero')
  assert.ok(Object.values(d.home.projects).every((p) => p.image === null), 'nothing unmeasured reaches the home page')
  assert.ok(r.report.images.measure_errors > 0 || !SHARP)
})

test('fixtures generator and site-data writer exist and are documented', async () => {
  for (const f of ['README.md', 'make-fixtures.mjs', 'make-site-data.mjs', 'fake-fetch.mjs']) assert.ok(existsSync(path.join(FIX, f)), f)
})
