// The nationwide/worldwide branch queries, run for real: every query must parse as SPARQL 1.1 (sparqljs) and, executed
// by a SPARQL engine (oxigraph) over a small Wikidata-shaped graph (tests/fixtures/global-places-graph.ttl), must
// return what the parser and the app expect: the city-level unit up the P131 chain and the district below it, fallback
// labels, rows without any label dropped, and only the short never-show list hidden.
// This checks query semantics, not Wikidata's 60 s limit: that needs the live service ("real Wikidata" e2e test).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import oxigraph from 'oxigraph'
import sparqljs from 'sparqljs'
import { BRANCHES, buildBranchQuery, branchIdOf, syncGlobal } from '../edge-functions/_shared/global-places.mjs'
import { WDQS_URL } from '../edge-functions/_shared/live-media.mjs'

const store = new oxigraph.Store()
store.load(readFileSync(new URL('./fixtures/global-places-graph.ttl', import.meta.url), 'utf8'), { format: 'text/turtle' })
const run = query => JSON.parse(store.query(query, { results_format: 'application/sparql-results+json' }))

test('every branch query is valid SPARQL 1.1', () => {
  const parser = new sparqljs.Parser()
  for (const b of BRANCHES) {
    const parsed = parser.parse(buildBranchQuery(b))
    assert.equal(parsed.queryType, 'SELECT', b.id)
    assert.deepEqual(parsed.variables.map(v => v.variable?.value || v.value), ['item', 'label_ko', 'label_en', 'label_other', 'desc_ko', 'desc_en', 'coord', 'image', 'country', 'city', 'district', 'site', 'kind', 'sitelinks', 'inception', 'country_iso', 'architects', 'creators', 'operators', 'state_of_use'], b.id)
  }
})

test('the shared outer query uses no unbounded property paths (cost stays per item)', () => {
  for (const b of BRANCHES) {
    const q = buildBranchQuery(b)
    const outer = q.slice(q.indexOf('# coordinates:'))
    assert.ok(!/wdt:P\d+[*+]/.test(outer), b.id + ': the city walk and labels use fixed steps only')
    assert.ok(!outer.includes('P279'), b.id + ': city classes are matched with plain P31')
  }
})

test('branch queries run end to end: cities, districts, fallback labels and dropped rows', async () => {
  const seen = []
  const fetchJSON = async (url, init) => {
    assert.equal(url, WDQS_URL)
    const query = new URLSearchParams(init.body).get('query')
    seen.push(branchIdOf(query))
    return run(query)
  }
  const r = await syncGlobal({ fetchJSON, now: '2026-10-13T00:00:00.000Z' })
  assert.deepEqual(r.branches.filter(b => !b.ok), [], 'every branch runs')
  assert.equal(seen.length, BRANCHES.length)
  const by = Object.fromEntries(r.places.map(p => [p.wikidata, p]))
  const where = q => [by[q]?.country, by[q]?.city, by[q]?.district]

  // Seoul: item → 중구 → 서울 (two steps) and item → 을지로동 → 중구 → 서울 (three steps); the city gets its short name.
  // 중구 is also typed "big city" in the graph: the Korean special-city class further up still wins.
  assert.deepEqual(where('Q5295847'), ['대한민국', '서울', '중구'])
  assert.equal(by.Q5295847.city_qid, 'Q8684')
  assert.deepEqual(where('Q99400001'), ['대한민국', '서울', '중구'], 'the district is the unit just below the city')
  assert.equal(by.Q99400001.primary_category, 'Light Art', 'class matched through a subclass of light installation')
  // Metropolitan city, city of South Korea (no district), special autonomous city, Jeju's administrative city.
  assert.deepEqual(where('Q109905495'), ['대한민국', '부산', '수영구'])
  assert.deepEqual(where('Q99400002'), ['대한민국', '진주시', ''])
  assert.deepEqual(where('Q99400004'), ['대한민국', '세종', '보람동'])
  assert.deepEqual(where('Q99400005'), ['대한민국', '제주시', ''])
  // Abroad: location (P276) that is a commune; a special ward of Japan; a German municipality.
  assert.deepEqual(where('Q4167'), ['프랑스', '리옹', ''])
  assert.deepEqual([by.Q4167.latitude, by.Q4167.longitude], [45.758, 4.835], 'coordinates of the location')
  assert.deepEqual(where('Q99400010'), ['일본', '미나토구', ''])
  assert.deepEqual(where('Q99400011'), ['독일', 'Lichtstadt', ''])
  // No city-level unit within three steps: the item's own admin unit stands in as the city.
  assert.deepEqual(where('Q99400012'), ['일본', '어느 마을', ''])

  // Names: "mul" label, then ja/zh/de/fr/es; an item with no label at all is never shown (no bare QID as a name).
  assert.equal(by.Q99400010.name_kr, '光のトンネル')
  assert.equal(by.Q99400011.name_kr, 'Lichtkunstweg', 'de comes before fr')
  assert.equal(by.Q99400011.name_en, '')
  assert.equal(by.Q99400013, undefined)
  for (const p of r.places) assert.notEqual(p.name_kr, p.wikidata)

  // Korea-only keyword branch: the label regex keeps light festivals only.
  assert.ok(by.Q99400002.branches.includes('korea:festival-keywords'))
  assert.equal(by.Q99400003, undefined, '김치축제 is not a light festival')
  // Never-show list: hidden even though a class query returns them. Never-query is not never-show.
  assert.equal(by.Q104383619, undefined)
  assert.equal(by.Q10957, undefined)
  assert.ok(by.Q109905495, 'BUSAN X the SKY is shown when the observation-deck class returns it')
  assert.equal(by.Q109905495.name_kr, 'BUSAN X the SKY')
  // Scope follows the country; the seed row keeps its sitelinks, image and https website.
  assert.equal(by.Q5295847.scope, 'korea'); assert.equal(by.Q4167.scope, 'world')
  assert.equal(by.Q5295847.sitelinks, 30); assert.equal(by.Q5295847.image, 'DDP night.jpg'); assert.equal(by.Q5295847.website, 'https://ddp.or.kr/')
  assert.equal(by.Q5295847.short_description, '서울 중구의 복합문화공간')
})

// v0.16 archive facts, as the archive layer reads them (docs/ARCHIVE_SPEC.md §6, field state source_reported).
test('archive facts: inception year, country ISO code, people and state of use', async () => {
  const fetchJSON = async (url, init) => run(new URLSearchParams(init.body).get('query'))
  const r = await syncGlobal({ fetchJSON, now: '2026-10-18T00:00:00.000Z' })
  const by = Object.fromEntries(r.places.map(p => [p.wikidata, p]))
  // DDP (a Korean seed): inception at day precision, the country's ISO code, its architect and operator, in use.
  assert.equal(by.Q5295847.year_completed, 2014)
  assert.equal(by.Q5295847.country_iso2, 'KR')
  assert.deepEqual(by.Q5295847.credits, [{ role: 'architect', name: '자하 하디드', qid: 'Q47701' }, { role: 'operator', name: '서울디자인재단', qid: 'Q99500001' }])
  assert.equal(by.Q5295847.operating_status, 'operating')
  assert.deepEqual(by.Q5295847.state_of_use, ['Q55654238'])
  assert.equal(by.Q5295847.official_url, 'https://ddp.or.kr/')
  assert.deepEqual(Object.keys(by.Q5295847.field_status).sort(), ['country_iso2', 'credits', 'official_url', 'operating_status', 'year_completed'])
  assert.ok(Object.values(by.Q5295847.field_status).every(s => s.state === 'source_reported'))
  // A century is not a year; a deprecated statement does not count.
  assert.equal(by.Q4167.year_completed, null)
  assert.equal(by.Q4167.country_iso2, 'FR')
  assert.equal(by.Q4167.field_status.year_completed, undefined)
  // People: a "mul" label names a creator; one without any label is left out (never a bare QID).
  assert.deepEqual(by.Q99400010.credits, [{ role: 'creator', name: 'teamLab', qid: 'Q99500002' }])
  assert.equal(by.Q99400010.country_iso2, 'JP')
  // Two states of use that disagree map to nothing; the QIDs are kept.
  assert.equal(by.Q99400010.operating_status, null)
  assert.deepEqual([...by.Q99400010.state_of_use].sort(), ['Q104664889', 'Q55654238'])
  // Year precision (preferred rank); a value outside the verified list stays unmapped.
  assert.equal(by.Q99400011.year_completed, 2005)
  assert.equal(by.Q99400011.operating_status, null)
  assert.deepEqual(by.Q99400011.state_of_use, ['Q55570340'])
  assert.equal(by.Q99400011.field_status.operating_status, undefined)
  // An item in two countries: the ISO code is the one of the country it is reported in.
  assert.equal({ 프랑스: 'FR', 독일: 'DE' }[by.Q99400014.country], by.Q99400014.country_iso2)
  // Items without these statements get empty values, not guesses.
  assert.equal(by.Q99400012.year_completed, null)
  assert.deepEqual(by.Q99400012.credits, [])
  assert.equal(by.Q99400012.country_iso2, 'JP')
})
