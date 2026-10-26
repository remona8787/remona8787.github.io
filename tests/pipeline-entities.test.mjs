// Pipeline: entity resolution, dedupe/merge rules, project typing, eligibility, Wikipedia acceptance and the Commons
// category decisions (docs/STATIC_ARCHIVE.md "Project eligibility", "Sources").
import test from 'node:test'
import assert from 'node:assert/strict'
import { clusterObservations, mergeByNameAndUrl, buildProject, eligibility, projectType, newId, MERGE_DISTANCE_M } from '../pipeline/lib/entities.mjs'
import { acceptEntity, scoreHit, termPattern } from '../pipeline/lib/wikipedia.mjs'
import { classifyCategory, categoryRules, nightParent, isNightCategory, discoverCategories } from '../pipeline/lib/commons.mjs'
import { createClient } from '../pipeline/lib/net.mjs'
import { loadConfig } from '../pipeline/run.mjs'
import { fixtureEnvironment } from './fixtures/pipeline/fake-fetch.mjs'

const cfg = loadConfig()
const rules = cfg.pipeline.entity_rules

const facts = (o) => ({ qid: null, name_en: null, name_ko: null, name_original: null, any_label: null, country_iso2: null, city: null, latitude: null, longitude: null, architects: [], creators: [], operators: [], official_url: null, commons_category: null, images: [], p31: [], p31_labels: [], sitelinks: {}, inception: null, start: null, end: null, ...o })
const groupsOf = (cl) => [...cl.groups().values()].map((keys) => keys.filter((k) => k.startsWith('obs:')).map((k) => Number(k.slice(4))).sort((a, b) => a - b)).filter((g) => g.length).sort((a, b) => a[0] - b[0])

test('rule 1: observations with the same QID merge, and a curated place keeps its id', () => {
  const obs = [
    { origin: 'curated', curated_id: 'SEOUL018', qid: 'Q494895', qid_match: 'host', name: { ko: '롯데월드타워 미디어파사드', en: 'Lotte World Tower Media Facade' }, country_iso2: 'KR', city: 'Seoul', project_type: 'media_facade', sources: [{ id: 'curated:source', kind: 'official', url: 'https://example.org/lwt' }] },
    { origin: 'wikipedia', qid: 'Q494895', sources: [], evidence: [{ kind: 'wikipedia', lang: 'ko', title: '롯데월드타워', url: 'https://ko.wikipedia.org/wiki/x', accepted: true }] },
    { origin: 'wikidata_class', qid: 'Q7715933', class_types: [{ qid: 'Q1823448', project_type: 'light_art', publish: true }], sources: [] },
  ]
  const f = new Map([['Q494895', facts({ qid: 'Q494895', name_en: 'Lotte World Tower', country_iso2: 'KR' })]])
  const cl = clusterObservations(obs, f)
  assert.deepEqual(groupsOf(cl), [[0, 1], [2]])
  const p = buildProject([obs[0], obs[1]], f.get('Q494895'))
  assert.equal(newId(p), 'SEOUL018')
  assert.equal(p.name_en, 'Lotte World Tower Media Facade', 'a host match never renames the project after the building')
  assert.equal(p.building_name, 'Lotte World Tower')
  assert.ok(p.sources.some((s) => s.kind === 'wikipedia'), 'the article that states the media facade stays attached')
})

test("rule 2: a Commons category joins the item whose P373 names it; two QIDs are never joined by it", () => {
  const obs = [
    { origin: 'wikidata_class', qid: 'Q7715933', class_types: [], sources: [] },
    { origin: 'commons', category: 'Category:The Bay Lights', qid: null, sources: [] },
    { origin: 'commons', category: 'Category:Signal Festival', qid: 'Q18391691', sources: [] },
    { origin: 'wikidata_class', qid: 'Q15140473', class_types: [], sources: [] },
  ]
  const f = new Map([
    ['Q7715933', facts({ qid: 'Q7715933', commons_category: 'Category:The Bay Lights' })],
    ['Q15140473', facts({ qid: 'Q15140473', commons_category: 'Category:Signal Festival' })],
  ])
  const cl = clusterObservations(obs, f)
  assert.deepEqual(groupsOf(cl), [[0, 1], [2], [3]])
  assert.equal(cl.conflicts.length, 1, 'the second QID behind the same category is reported, not merged')
  assert.deepEqual(cl.conflicts[0].qids, ['Q15140473', 'Q18391691'])
})

test('rule 3: the same normalised name within 300 m merges; farther apart or two QIDs does not', () => {
  const mk = (i, name, lat, lng, qid = null) => ({ _root: 'r' + i, name_en: name, name_ko: null, name_original: null, latitude: lat, longitude: lng, official_url: null, qid })
  const obs = [0, 1, 2, 3, 4].map((i) => ({ origin: 'commons', category: 'Category:C' + i }))
  const cl = clusterObservations(obs, new Map())
  const roots = obs.map((o) => cl.find(o._key))
  const projects = [
    mk(0, 'Light Garden', 37.5, 127.0), mk(1, 'light-garden', 37.5015, 127.0), // ~170 m
    mk(2, 'Light Garden', 37.6, 127.0), // ~11 km
  ].map((p, i) => ({ ...p, _root: roots[i] }))
  const made = mergeByNameAndUrl(cl, projects)
  assert.equal(made.length, 1)
  assert.equal(made[0].rule, 'name_within_300m')
  assert.ok(made[0].distance_m <= MERGE_DISTANCE_M)
  assert.equal(cl.find(roots[0]), cl.find(roots[1]))
  assert.notEqual(cl.find(roots[0]), cl.find(roots[2]))
  // Two different QIDs with the same name next to each other: a suspected duplicate, not a merge.
  const cl2 = clusterObservations([{ origin: 'wikidata_class', qid: 'Q1' }, { origin: 'wikidata_class', qid: 'Q2' }], new Map())
  const r2 = [cl2.find('q:Q1'), cl2.find('q:Q2')]
  mergeByNameAndUrl(cl2, [mk(0, 'Signal Festival', 50.087, 14.4208, 'Q1'), mk(1, 'Signal Festival', 50.0872, 14.421, 'Q2')].map((p, i) => ({ ...p, _root: r2[i] })))
  assert.notEqual(cl2.find(r2[0]), cl2.find(r2[1]))
  assert.equal(cl2.conflicts[0].reason, 'name_within_300m')
})

test('rule 4: the same official URL merges, but not shared portal hosts', () => {
  const obs = [0, 1, 2, 3].map((i) => ({ origin: 'commons', category: 'Category:U' + i }))
  const cl = clusterObservations(obs, new Map())
  const roots = obs.map((o) => cl.find(o._key))
  const p = (i, url, name) => ({ _root: roots[i], name_en: name, latitude: null, longitude: null, official_url: url })
  const made = mergeByNameAndUrl(cl, [p(0, 'https://www.lightfest.example/?utm_source=x', 'A'), p(1, 'https://lightfest.example/', 'B'), p(2, 'https://www.facebook.com/somepage', 'C'), p(3, 'https://www.facebook.com/somepage', 'D')])
  assert.deepEqual(made.map((m) => m.rule), ['same_official_url'])
  assert.equal(cl.find(roots[0]), cl.find(roots[1]))
  assert.notEqual(cl.find(roots[2]), cl.find(roots[3]))
})

test('typing: a class that is the item\'s own P31 wins over a broader one reached through P279*', () => {
  const t = projectType({ classTypes: [{ qid: 'Q1421557', project_type: 'light_art' }, { qid: 'Q1136999', project_type: 'festival_program', direct: true }], commonsTypes: [] })
  assert.equal(t.project_type, 'festival_program')
  const t2 = projectType({ classTypes: [{ qid: 'Q1421557', project_type: 'light_art' }, { qid: 'Q1136999', project_type: 'festival_program' }], commonsTypes: [] })
  assert.equal(t2.project_type, 'light_art', 'without a direct class the most specific type wins')
  assert.equal(projectType({ classTypes: [], wikipedia: true, commonsTypes: [] }).project_type, 'media_facade')
  assert.equal(projectType({ classTypes: [], wikipedia: true, wikipediaType: 'festival_program', commonsTypes: [] }).project_type, 'festival_program')
  assert.deepEqual(projectType({ classTypes: [], commonsTypes: ['projection_mapping'] }), { project_type: 'projection_mapping', source: 'commons_category', low_confidence: true })
})

const eligibleProject = (o = {}) => ({
  qid: 'Q7715933', commons_category: null, curated_id: null, editorial_id: null, name_en: 'The Bay Lights', name_ko: null, name_original: null,
  country_iso2: 'US', latitude: 37.79, longitude: -122.37, city: 'San Francisco', project_type: 'light_art', blocked_by: [],
  sources: [{ kind: 'wikidata', url: 'https://www.wikidata.org/wiki/Q7715933' }], origins: ['wikidata_class'], class_publish: true, evidence: [], editorial: {}, ...o,
})

test('eligibility: identity, name, country, place, type, blocklist and a public source are all required', () => {
  assert.deepEqual(eligibility(eligibleProject()), { eligible: true, reasons: [] })
  const reasons = (o) => eligibility(eligibleProject(o)).reasons
  assert.deepEqual(reasons({ qid: null }), ['no_stable_identity'])
  assert.deepEqual(reasons({ name_en: null }), ['no_name'])
  assert.deepEqual(reasons({ country_iso2: null }), ['no_country'])
  assert.deepEqual(reasons({ latitude: null, city: null }), ['no_coordinates_or_city'])
  assert.deepEqual(reasons({ latitude: null }), [], 'a city is enough without coordinates')
  assert.deepEqual(reasons({ project_type: 'billboard' }), ['no_project_type'])
  assert.deepEqual(reasons({ blocked_by: ['Q623149'] }), ['blocklist:Q623149'])
  assert.deepEqual(reasons({ sources: [{ kind: 'news', url: 'https://news.example/x' }] }), ['no_public_source'])
  assert.deepEqual(reasons({ class_publish: false }), ['unverified_class_only'], 'a class that is not verified never publishes on its own')
  assert.deepEqual(reasons({ require_coordinates: true, latitude: null }), ['class_requires_coordinates'])
  assert.deepEqual(reasons({ editorial: { hidden: true } }), ['hidden_by_editor'])
  assert.deepEqual(reasons({ origins: ['wikipedia'], evidence: [{ kind: 'wikipedia', accepted: false }] }), ['wikipedia_relevance_low'])
  // An editor's approval lifts the source gates (blocklist, unverified class) but not missing facts.
  assert.deepEqual(reasons({ class_publish: false, blocked_by: ['Q623149'], editorial: { approved: true } }), [])
  assert.deepEqual(reasons({ country_iso2: null, editorial: { approved: true } }), ['no_country'])
})

test('Wikipedia media-facade hits: scored by where the term appears, accepted only for places', () => {
  assert.ok(termPattern('media facade').test('its glass media façade of LEDs'))
  assert.ok(termPattern('media facade').test('Media-Facades in Europe'))
  assert.ok(!termPattern('media facade').test('multimedia facades'.replace('multimedia facades', 'multimediafacade')))
  assert.ok(termPattern('미디어파사드').test('외벽에 미디어 파사드가 설치'))
  const lead = 'The Uniqa Tower is a 75 m office building in Vienna. Its glass skin carries a media facade of 40,000 LEDs.'
  const good = scoreHit({ title: 'Uniqa Tower', snippet: '' }, { extract: lead, coordinates: [{ lat: 48.2, lon: 16.38 }], wikibase_item: 'Q1' }, 'media facade')
  assert.ok(good.score >= 50, JSON.stringify(good))
  assert.deepEqual(good.reasons, ['term_in_lead', 'building_context', 'page_has_coordinates'])
  const company = scoreHit({ title: 'ExampleLED', snippet: '' }, { extract: 'ExampleLED is a company that manufactures media facade systems.', wikibase_item: 'Q2' }, 'media facade')
  assert.ok(company.reasons.includes('lead_describes_non_place') && company.score < 50)
  const snippetOnly = scoreHit({ title: 'List of towers', snippet: 'several towers carry a <span class="searchmatch">media</span> <span class="searchmatch">facade</span>' }, { extract: 'This list ranks towers.', wikibase_item: 'Q3' }, 'media facade')
  assert.ok(snippetOnly.score < 50)
  const ok = (labels, o = {}) => acceptEntity({ p31_labels: labels, latitude: 1, country_iso2: 'KR', ...o }, rules)
  assert.equal(ok(['skyscraper']).ok, true)
  assert.equal(ok(['shopping center']).ok, true)
  assert.deepEqual(ok(['business']).reasons, ['excluded_class:business'])
  assert.deepEqual(ok(['human']).reasons, ['excluded_class:human'])
  assert.deepEqual(ok(['city']).reasons, ['area_not_project'])
  assert.deepEqual(ok(['technology']).reasons, ['excluded_class:technology'])
  assert.deepEqual(ok(['research institute']).reasons, ['organisation_without_place_class'])
  assert.deepEqual(ok(['museum', 'research institute']).reasons, [], 'an institution in its own building is a place')
  assert.ok(ok(['skyscraper'], { latitude: null, country_iso2: null }).reasons.includes('no_coordinates_or_country'))
})

test('Commons categories: aggregates, editions, blocklisted and specific categories, with reasons', () => {
  const r = categoryRules(cfg.categories)
  const root = { mode: 'candidates' }
  const d = (title, info = { subcats: 0, files: 10 }) => classifyCategory(title, info, root, r)
  assert.deepEqual(d('Category:Projection mapping in Poland'), { decision: 'aggregate', reason: 'aggregate_topic_in_place' })
  assert.deepEqual(d('Category:Illuminated buildings by country'), { decision: 'aggregate', reason: 'aggregate_by' })
  assert.deepEqual(d('Category:Light art in Mannheim'), { decision: 'aggregate', reason: 'aggregate_topic_in_place' })
  assert.deepEqual(d('Category:Festivals of lights in Germany'), { decision: 'aggregate', reason: 'aggregate_topic_in_place' })
  assert.deepEqual(d('Category:Featured pictures of light art'), { decision: 'aggregate', reason: 'aggregate_quality_set' })
  assert.deepEqual(d('Category:Light art by Molitor & Kuzmin'), { decision: 'aggregate', reason: 'aggregate_works_of_artist' })
  assert.deepEqual(d('Category:Festival of Lights (Berlin, 2013)'), { decision: 'edition', reason: 'edition_year_in_parentheses' })
  assert.deepEqual(d('Category:2013 Light Festival, Jerusalem'), { decision: 'edition', reason: 'edition_year_first' })
  assert.deepEqual(d('Category:Light artists'), { decision: 'rejected', reason: 'blocklist_people' })
  assert.deepEqual(d('Category:Laser light shows'), { decision: 'rejected', reason: 'blocklist_product_or_advertising' })
  assert.deepEqual(d('Category:Christmas lights in Vienna'), { decision: 'rejected', reason: 'blocklist_unrelated_light_topic' })
  assert.deepEqual(d('Category:Some festival', { subcats: 60, files: 2 }), { decision: 'aggregate', reason: 'many_subcategories_few_files' })
  assert.deepEqual(d('Category:Empty', { subcats: 0, files: 0 }), { decision: 'rejected', reason: 'empty_category' })
  assert.deepEqual(d('Category:Schlosslichtspiele Karlsruhe'), { decision: 'candidate', reason: 'specific_category' })
  assert.deepEqual(classifyCategory('Category:Lotte World Tower at night', { subcats: 0, files: 3 }, { mode: 'evidence' }, r), { decision: 'evidence', reason: 'evidence_root' })
  assert.equal(nightParent('Category:Lotte World Tower at night'), 'Category:Lotte World Tower')
  assert.equal(nightParent('Category:Kölner Dom bei Nacht'), 'Category:Kölner Dom')
  assert.ok(isNightCategory('Category:The Bay Lights at night', r))
  assert.ok(!isNightCategory('Category:Interior of the tower', r))
})

test('Commons discovery over the fixtures: walk, search hits, decisions and place hints', async () => {
  const env = fixtureEnvironment()
  const client = createClient({ fetch: env.fetch, clock: env.clock, sleep: env.sleep })
  const out = await discoverCategories(client, cfg.categories, {})
  const get = (t) => out.categories.get(t)
  assert.equal(get('Category:Facades').decision, 'rejected')
  assert.equal(get('Category:Facades').reason, 'term_not_in_name', 'a loose search hit is never a project')
  assert.equal(get('Category:Signal Festival').decision, 'candidate', 'members of a searched aggregate are walked')
  assert.deepEqual(get('Category:Signal Festival').place_hint, { country_iso2: 'CZ', city: 'Prague', from: 'Category:Projection mapping in Prague' })
  assert.equal(get('Category:Lotte World Tower at night').decision, 'evidence')
  assert.equal(get('Category:Light artists').decision, 'rejected')
  assert.deepEqual(get('Category:Fête des Lumières').parts, ['Category:Fête des Lumières 2015'])
  assert.deepEqual(get('Category:Festival of Lights (Berlin)').editions, ['Category:Festival of Lights (Berlin, 2013)'])
  assert.ok(out.warnings.some((w) => w.root === 'Category:Light installations'), 'a configured root that does not exist is a warning')
  assert.deepEqual(out.errors, [])
  for (const [, c] of out.categories) assert.ok(c.reason, 'every decision carries its reason: ' + c.title)
})

test('kind, dates and status only from sourced facts (TourAPI festival dates, Wikidata P580/P582/P585, P5817, P2257)', async () => {
  const { scheduleOf, statusFromDates, dateBounds } = await import('../pipeline/lib/entities.mjs')
  const today = '2026-10-20'
  assert.deepEqual(dateBounds('2026'), ['2026-01-01', '2026-12-31'])
  assert.deepEqual(dateBounds('2024-02'), ['2024-02-01', '2024-02-29'])
  assert.equal(statusFromDates('2026-10-15', '2026-11-20', today), 'running')
  assert.equal(statusFromDates('2026-12-01', null, today), 'upcoming')
  assert.equal(statusFromDates(null, '2025', today), 'ended')
  assert.equal(statusFromDates('2020', null, today), null, 'a start alone is not "running"')
  const tour = (start, end) => ({ tourapi: { contenttypeid: '15', eventstartdate: start, eventenddate: end } })
  assert.deepEqual(scheduleOf({ tour: tour('2026-10-15', '2026-11-20'), today }), { kind: 'festival', start_date: '2026-10-15', end_date: '2026-11-20', status: 'running', status_source: 'tourapi' })
  assert.equal(scheduleOf({ tour: tour('2026-10-01', '2026-10-15'), today }).status, 'ended')
  assert.deepEqual(scheduleOf({ facts: { p31_labels: ['building'] }, today }), { kind: 'facility', start_date: null, end_date: null, status: 'unknown', status_source: null }, 'nothing sourced: unknown')
  assert.equal(scheduleOf({ facts: { p31_labels: ['building'], state_of_use: ['demolished'] }, today }).status, 'ended')
  assert.equal(scheduleOf({ facts: { p31_labels: ['building'], state_of_use: ['in use'] }, today }).status, 'running')
  assert.equal(scheduleOf({ facts: { p31_labels: ['art exhibition'], start_date: '2026-09-01', end_date: '2027-01-31' }, today }).kind, 'exhibition')
  assert.equal(scheduleOf({ facts: { p31_labels: ['light show'], point_in_time: '2026-10-20' }, today }).kind, 'program')
  assert.deepEqual(scheduleOf({ facts: { p31_labels: ['lights festival'], recurring: true }, projectType: 'festival_program', today }), { kind: 'festival', start_date: null, end_date: null, status: 'seasonal', status_source: 'wikidata' })
  assert.equal(scheduleOf({ facts: { p31_labels: ['festival'], recurring: true, start_date: '2026-12-20', end_date: '2027-01-10' }, projectType: 'festival_program', today }).status, 'upcoming', 'a dated edition wins over seasonal')
})

test('field confidence: each state from the field source; an older record is read the same way', async () => {
  const { fieldConfidence, confidenceOf, upgradeRecord } = await import('../pipeline/lib/output.mjs')
  assert.deepEqual(['wikidata', 'wikipedia:ko', 'tourapi', 'commons', 'curated:source', 'curated', 'editorial', 'derived:gazetteer', null].map((s) => confidenceOf(s)), ['sourced', 'sourced', 'sourced', 'sourced', 'editorial', 'editorial', 'editorial', 'inferred', 'inferred'])
  assert.equal(confidenceOf('wikidata', false), 'unknown', 'no value')
  const base = { project_type: 'media_facade', country_iso2: 'KR', kr_region: 'seoul', lat: 37.5, lng: 127, location_precision: 'exact', credits: [], start_date: null, end_date: null }
  assert.deepEqual(fieldConfidence({ ...base, field_sources: { project_type: 'wikidata', kr_region: 'derived:gazetteer', lat: 'wikidata', credits: 'wikidata', year_completed: 'wikidata' }, year_completed: 2016, credits: [{ role: 'architect', name: 'A' }, { role: 'operator', name: 'B' }] }),
    { project_type: 'sourced', region: 'inferred', dates: 'sourced', artist: 'unknown', architect: 'sourced', coordinates: 'sourced' })
  assert.equal(fieldConfidence({ ...base, field_sources: { project_type: 'wikidata' } }, { typeInferred: true }).project_type, 'inferred', 'a low-confidence class')
  assert.equal(fieldConfidence({ ...base, field_sources: { project_type: 'editorial' } }, { typeInferred: true }).project_type, 'editorial', 'an edit wins')
  assert.equal(fieldConfidence({ ...base, location_precision: 'approximate', field_sources: { lat: 'commons' } }).coordinates, 'inferred', 'approximate coordinates')
  assert.equal(fieldConfidence({ ...base, country_iso2: 'FR', kr_region: null, field_sources: { country_iso2: 'derived:coordinates_in_borders' } }).region, 'inferred', 'outside Korea: the country')
  assert.equal(fieldConfidence({ ...base, kr_region: null, field_sources: {} }).region, 'unknown')
  assert.equal(fieldConfidence({ ...base, start_date: '2026-10-01', status_source: 'tourapi', field_sources: {} }).dates, 'sourced', 'an earlier record: dates from status_source')
  const old = { ...base, field_sources: { project_type: 'wikidata', lat: 'wikidata' }, images: [] }
  assert.deepEqual(upgradeRecord(old).field_confidence, fieldConfidence(old))
  const kept = { ...old, field_confidence: { project_type: 'editorial', region: 'unknown', dates: 'unknown', artist: 'unknown', architect: 'unknown', coordinates: 'sourced' } }
  assert.deepEqual(upgradeRecord(kept).field_confidence, kept.field_confidence, 'a record that has states keeps them')
})

test('never a project: date categories and Wikimedia events by name (live leaks of 2026-10-26)', async () => {
  const { notProjectName, dateNameReason } = await import('../pipeline/lib/not-projects.mjs')
  const dated = ['April 2017 in Daegu', 'April 2017', '2017 in Seoul', '2010s in Seoul', 'Seoul in April 2017', 'Daegu in 2017', 'Events in Seoul in the 2010s',
    'Seoul in the 2010s', '5 April 2017 in Seoul', 'April 5, 2017', 'Gwanghwamun on 5 April 2017', '2017 events in South Korea', 'Category:April 2017 in South Korea']
  for (const n of dated) assert.ok(dateNameReason(n), n)
  for (const n of ['Festival of Lights (Berlin, 2013)', '2013 Light Festival, Jerusalem', 'Lumiere Durham', 'Seoul Lantern Festival', 'Vivid Sydney', 'Night at Gwanghwamun', '진주남강유등축제', 'Signal Festival'])
    assert.equal(dateNameReason(n), null, n)
  for (const n of ['Akeneo Wikimedia Editathon - Mallorca, October 2022', 'Wiki Loves Monuments 2019 in South Korea', 'Wikimedia Hackathon 2024', 'Art+Feminism edit-a-thon', '위키백과 에디터톤'])
    assert.equal(notProjectName(n), 'wikimedia_event', n)
  assert.equal(notProjectName('April 2017 in Daegu'), 'date_category:month_year')
  assert.equal(notProjectName('Seoul Lantern Festival'), null)
  // In the Commons walk: rejected before any other rule (never walked); a dated light-work name is an edition.
  const r = categoryRules(cfg.categories)
  const d = (title) => classifyCategory(title, { subcats: 0, files: 6 }, { mode: 'candidates', korea: true }, r)
  assert.deepEqual(d('Category:April 2017 in Daegu'), { decision: 'rejected', reason: 'date_category_month_year' })
  assert.deepEqual(d('Category:Events in Seoul in the 2010s'), { decision: 'rejected', reason: 'date_category_place_in_date' })
  assert.deepEqual(d('Category:2017 in Daegu'), { decision: 'rejected', reason: 'date_category_year_in_place' })
  assert.deepEqual(d('Category:Akeneo Wikimedia Editathon - Mallorca, October 2022'), { decision: 'rejected', reason: 'wikimedia_event' })
  assert.deepEqual(d('Category:Seoul Lantern Festival in 2013'), { decision: 'edition', reason: 'edition_date_place_in_date' })
})

test('never a project: items of settlement, administrative-area and Wikimedia-event classes, through P31/P279*', async () => {
  const { neverProject } = await import('../pipeline/lib/entities.mjs')
  const blocks = [{ qid: 'Q56061', unless_work_or_event: true }, { qid: 'Q515', unless_work_or_event: true }, { qid: 'Q486972', unless_work_or_event: true }, { qid: 'Q16022392' }]
  const workPattern = new RegExp(cfg.pipeline.entity_rules.work_or_event_class_pattern, 'i')
  const ctx = (o) => ({ blocks, workClasses: new Set(['Q1823448']), workPattern, ...o })
  // Namwon: P31 city of South Korea, which reaches city and human settlement only through P279.
  assert.deepEqual(neverProject({ name_en: 'Namwon', p31_labels: ['city of South Korea'] }, ctx({ p31: ['Q29045252'], member: ['Q515', 'Q486972'] })), ['Q515', 'Q486972'])
  // A festival organised as a community, a light installation in an amusement park: kept.
  assert.deepEqual(neverProject({ name_en: 'Pixelache Helsinki', p31_labels: ['community', 'new media arts festival'] }, ctx({ p31: ['Q177634', 'Q126682969'], member: ['Q486972'] })), [])
  assert.deepEqual(neverProject({ name_en: 'Lumina Park', p31_labels: ['light installation'] }, ctx({ p31: ['Q1823448'], member: ['Q486972'] })), [])
  // An edit-a-thon has no exception; neither has a date or Wikimedia name.
  assert.deepEqual(neverProject({ name_en: 'Akeneo, Majorque 2022', p31_labels: ['edit-a-thon', 'event'] }, ctx({ p31: ['Q16022392'], member: ['Q16022392'] })), ['Q16022392'])
  assert.deepEqual(neverProject({ name_en: 'April 2017 in Daegu', commons_category: 'Category:April 2017 in Daegu' }, ctx({})), ['name:date_category:month_year'])
  assert.deepEqual(neverProject({ name_en: 'Akeneo Wikimedia Editathon - Mallorca, October 2022' }, ctx({})), ['name:wikimedia_event'])
  assert.deepEqual(neverProject({ name_en: 'Seoul Lantern Festival', p31_labels: ['lantern festival'] }, ctx({ p31: ['Q124414048'] })), [])
  assert.deepEqual(neverProject({ qid: 'Q96756894', name_en: '2026', p31_labels: ['time-based media'] }, ctx({})), [], 'a work titled with a year (a video by Maha Maamoun)')
  assert.deepEqual(neverProject({ name_en: '2026', commons_category: 'Category:2026' }, ctx({})), ['name:date_category:bare_year'], 'a category named after a year')
})
