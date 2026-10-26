// Country and location recovery (pipeline/lib/places.mjs and wikidata.mjs factsOf): evidence from parent categories,
// their items, file geotags inside country borders and the item's location chain; the Wikipedia language only as weak
// corroboration; conflicting evidence never decides.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadCountryCoder, countryAt, isoOfCountry, countryOfPlace, geotagSummary, decideCountry, parentNameEvidence, sitelinkEvidence } from '../pipeline/lib/places.mjs'
import { compileGazetteer, loadKoreaConfig } from '../pipeline/lib/korea.mjs'
import { runPipeline } from '../pipeline/run.mjs'
import { fixtureEnvironment, FIXTURE_OVERRIDES, FIXTURE_ENV } from './fixtures/pipeline/fake-fetch.mjs'

const cc = await loadCountryCoder()
const needCc = cc ? {} : { skip: '@rapideditor/country-coder is not installed (npm ci --prefix pipeline)' }

test('borders and country items: coordinates, a country item without an ISO code, the location chain', needCc, () => {
  assert.equal(countryAt(cc, 29.9757, 31.1376), 'EG')
  assert.equal(countryAt(cc, 34.7106, 127.0806), 'KR')
  assert.equal(countryAt(cc, 30, -45), null, 'open sea')
  const aux = new Map([['Q55', { iso: null, p17: ['Q29999'], p131: [] }], ['Q29999', { iso: 'NL', p17: [], p131: [] }], ['Q9899', { iso: null, p17: ['Q55'], p131: ['Q701'] }], ['Q18125', { iso: null, p17: [], p131: ['Q21525592'] }], ['Q21525592', { iso: null, p17: ['Q145'], p131: [] }], ['Q145', { iso: 'GB', p17: [], p131: [] }]])
  assert.equal(isoOfCountry('Q55', aux), 'NL')
  assert.deepEqual(countryOfPlace('Q9899', aux), { iso: 'NL', via: 'Q55' })
  assert.deepEqual(countryOfPlace('Q18125', aux), { iso: 'GB', via: 'Q145' }, 'up the P131 chain')
  assert.equal(countryOfPlace('Q404', aux), null)
})

test('the decision: one country from strong evidence; conflicts and travelling works stay undecided; the language never decides', needCc, () => {
  const gaz = compileGazetteer(loadKoreaConfig())
  const parents = parentNameEvidence(['Category:Light festivals in South Korea', 'Category:Boseong County', 'Category:Laser art'], gaz)
  assert.deepEqual(parents.map((e) => e.country), ['KR', 'KR'])
  const one = geotagSummary([{ file: 'a', lat: 34.7106, lng: 127.0806 }, { file: 'b', lat: 34.7112, lng: 127.0811 }], cc)
  assert.equal(one.top, 'KR'); assert.equal(one.share, 1); assert.ok(one.center)
  assert.equal(decideCountry([...parents, { kind: 'file_geotags', country: 'KR', strength: 'strong' }], one).country, 'KR')
  assert.equal(decideCountry([{ kind: 'parent_category', country: 'KR', strength: 'strong' }, { kind: 'parent_item', country: 'JP', strength: 'strong' }], null).outcome, 'conflict')
  const spread = geotagSummary([{ file: 'a', lat: 40.7061, lng: -74.0087 }, { file: 'b', lat: 38.7071, lng: -9.1356 }, { file: 'c', lat: 51.0814, lng: 1.1838 }], cc)
  assert.equal(decideCountry([], spread).outcome, 'conflict', 'a work shown in three countries')
  assert.equal(decideCountry([{ kind: 'parent_category', country: 'US', strength: 'strong' }], spread).outcome, 'conflict', 'photos elsewhere outweigh one parent')
  const weak = sitelinkEvidence({ kowiki: { title: 'x' } })
  assert.deepEqual([weak.country, weak.strength], ['KR', 'weak'])
  assert.equal(decideCountry([weak], null).outcome, 'no_evidence', 'a Wikipedia language alone never decides')
  assert.equal(sitelinkEvidence({ kowiki: {}, enwiki: {} }), null)
})

test('recovery in a run: parents, parent items and geotags give country and location; Wikidata chains give the country', needCc, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aol-places-'))
  const env = fixtureEnvironment()
  await runPipeline({ dataDir: dir, editorialDir: null, fetch: env.fetch, clock: env.clock, sleep: env.sleep, overrides: FIXTURE_OVERRIDES, env: FIXTURE_ENV, log: () => {} })
  const review = JSON.parse(await readFile(path.join(dir, 'review/places.json'), 'utf8'))
  const d = Object.fromEntries(review.decisions.map((x) => [x.name, x]))
  assert.equal(d['Boseong Green Tea Plantation Light Festival'].country, 'KR')
  assert.deepEqual(d['Boseong Green Tea Plantation Light Festival'].votes.KR.sort(), ['file_geotags', 'parent_category', 'parent_category'])
  assert.equal(d['Sound and light show at Giza'].country, 'EG')
  assert.ok(d['Sound and light show at Giza'].votes.EG.includes('parent_item'))
  assert.equal(d['Global Rainbow'].outcome, 'conflict')
  const shard = JSON.parse(await readFile(path.join(dir, 'site-data/projects/000.json'), 'utf8')).projects
  const by = (name) => shard.find((r) => r.name_en === name)
  const boseong = by('Boseong Green Tea Plantation Light Festival')
  assert.deepEqual([boseong.country_iso2, boseong.kr_region, boseong.location_precision, boseong.field_sources.lat], ['KR', 'gwangju_jeolla', 'approximate', 'derived:commons_file_geotags'])
  assert.equal(by('Sound and light show at Giza').country_iso2, 'EG')
  assert.ok(!by('Global Rainbow'), 'never one country for a travelling work')
  assert.equal(by('Gwanghwamun').kr_region, 'seoul', 'the region from a parent category ("Gates in Seoul")')
  assert.equal(by('Fixture Digital Lights Festival').country_iso2, 'GB', 'P276 → a city → its P17')
  assert.equal(by('Fixture Lichtkunst Amsterdam').country_iso2, 'NL', 'Q55 without an ISO code → Q29999')
  assert.equal(by('Fixture Valo Oulu').country_iso2, 'FI', 'coordinates inside the borders')
})

test('a date category is never recovered: "April 2017 in Daegu" names a city, but it is a date, not a project', needCc, async () => {
  const { recoverPlaces } = await import('../pipeline/lib/places.mjs')
  const offline = { json: async () => { throw new Error('offline') }, text: async () => { throw new Error('offline') } }
  const mk = (name) => ({ id: 'CAT-' + name, commons_category: 'Category:' + name, name_en: name, country_iso2: null, latitude: null, longitude: null, city: null, field_sources: {} })
  const ps = ['April 2017 in Daegu', 'Seoul in April 2017', 'Events in Seoul in the 2010s', 'Fixture Lumière Daegu'].map(mk)
  const gaz = compileGazetteer(loadKoreaConfig())
  const { decisions } = await recoverPlaces(offline, ps, { cc, auxMap: new Map(), facts: new Map(), gaz, regionOf: () => 'east_asia', known: [] })
  const d = Object.fromEntries(decisions.map((x) => [x.name, x]))
  for (const n of ['April 2017 in Daegu', 'Seoul in April 2017', 'Events in Seoul in the 2010s']) {
    assert.equal(d[n].outcome, 'aggregate_name', n)
    assert.match(d[n].reason, /date category/)
  }
  assert.equal(ps[0].country_iso2, null, 'nothing is filled in')
})

test('the same thing found twice: a recovered project named like a known one in its country is kept out', needCc, async () => {
  const { recoverPlaces, sameNameAs } = await import('../pipeline/lib/places.mjs')
  const known = [{ id: 'CAT-080XNRV', name_en: 'Lotus Lantern Festival', commons_category: 'Category:Lotus Lantern Festival (Seoul)', country_iso2: 'KR' },
    { id: 'Q125715', name_en: 'Festival of Lights', country_iso2: 'DE' }]
  assert.equal(sameNameAs({ id: 'Q625724', name_en: 'Lotus Lantern Festival', name_ko: '연등회' }, known, 'KR'), 'CAT-080XNRV', 'the category name without its parenthesis')
  assert.equal(sameNameAs({ id: 'Q625724', name_en: 'Lotus Lantern Festival' }, known, 'JP'), null, 'another country')
  assert.equal(sameNameAs({ id: 'Q4167', name_en: 'Festival of Lights' }, known, 'DE'), null, 'a name of generic words never matches')
  const offline = { json: async () => { throw new Error('offline') }, text: async () => { throw new Error('offline') } }
  const p = { id: 'Q625724', qid: 'Q625724', name_en: 'Lotus Lantern Festival', name_ko: '연등회', commons_category: 'Category:Lotus Lantern Festival', country_iso2: null, latitude: null, longitude: null, city: null, field_sources: {} }
  const facts = new Map([['Q625724', { latitude: 37.5729, longitude: 126.9794, sitelinks: {} }]])
  const { decisions, stats } = await recoverPlaces(offline, [p], { cc, auxMap: new Map(), facts, gaz: compileGazetteer(loadKoreaConfig()), regionOf: () => 'east_asia', known })
  assert.deepEqual([decisions[0].outcome, decisions[0].duplicate_of], ['duplicate_of_project', 'CAT-080XNRV'])
  assert.equal(stats.duplicate_of_project, 1)
  assert.equal(p.country_iso2, null, 'nothing is filled in')
})
