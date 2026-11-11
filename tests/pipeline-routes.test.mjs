// v0.26 Wikidata routes (config/classes.json "route"): the material, genre and movement queries run for real on a
// SPARQL engine (oxigraph) over a small Wikidata-shaped graph. A route finds only what its statement says: works of
// art made from LEDs (not an LED product), items of the light-art genre or movement, and a work held by a museum is
// located in Korea through its collection (P195).
import test from 'node:test'
import assert from 'node:assert/strict'
import oxigraph from 'oxigraph'
import sparqljs from 'sparqljs'
import { classInstancesQuery, classCountQuery, countryClassInstancesQuery, routePattern, classKey, ROUTES } from '../pipeline/lib/wikidata.mjs'

const WD = 'http://www.wikidata.org/entity/', WDT = 'http://www.wikidata.org/prop/direct/'
const PREFIXES = `PREFIX wd: <${WD}>\nPREFIX wdt: <${WDT}>\n`
const graph = `
@prefix wd: <${WD}> . @prefix wdt: <${WDT}> .
wd:Q20437094 wdt:P279 wd:Q838948 .
wd:Q90000001 wdt:P31 wd:Q20437094 ; wdt:P186 wd:Q25504 ; wdt:P17 wd:Q30 .
wd:Q90000002 wdt:P31 wd:Q2424752 ; wdt:P186 wd:Q25504 .
wd:Q90000003 wdt:P31 wd:Q838948 ; wdt:P136 wd:Q1421557 ; wdt:P195 wd:Q90000009 .
wd:Q90000004 wdt:P31 wd:Q838948 ; wdt:P135 wd:Q1421557 .
wd:Q90000005 wdt:P31 wd:Q1823448 ; wdt:P17 wd:Q884 .
wd:Q90000009 wdt:P31 wd:Q207694 ; wdt:P17 wd:Q884 .
`
const store = new oxigraph.Store()
store.load(graph, { format: 'text/turtle' })
const items = (q) => JSON.parse(store.query(PREFIXES + q.replace(/^#.*\n/, ''), { results_format: 'application/sparql-results+json' })).results.bindings.map((b) => b.item.value.slice(WD.length)).sort()

test('routes: every route query is valid SPARQL 1.1 and names its route in the tag line', () => {
  const parser = new sparqljs.Parser({ prefixes: { wd: WD, wdt: WDT } })
  for (const route of ROUTES) {
    for (const q of [classInstancesQuery('Q1', 10, route), classCountQuery('Q1', route), countryClassInstancesQuery('Q1', 'Q884', 10, route)]) {
      assert.equal(parser.parse(q).queryType, 'SELECT', route)
      if (route !== 'class') assert.ok(q.split('\n')[0].endsWith(' ' + route), q.split('\n')[0])
    }
  }
  assert.throws(() => routePattern('Q1', 'nonsense'))
  assert.equal(classKey({ qid: 'Q1421557' }), 'Q1421557')
  assert.equal(classKey({ qid: 'Q1421557', route: 'genre' }), 'Q1421557:genre')
  assert.equal(classKey({ qid: 'Q1421557', route: 'class' }), 'Q1421557')
})

test('routes: a material finds works of art made from it, never the product itself', () => {
  assert.deepEqual(items(classInstancesQuery('Q25504', 50, 'material')), ['Q90000001'])
})

test('routes: genre and movement, and the class route is unchanged', () => {
  assert.deepEqual(items(classInstancesQuery('Q1421557', 50, 'genre')), ['Q90000003'])
  assert.deepEqual(items(classInstancesQuery('Q1421557', 50, 'movement')), ['Q90000004'])
  assert.deepEqual(items(classInstancesQuery('Q1823448', 50)), ['Q90000005'])
})

test('routes: the country query reaches a work through its collection (P195)', () => {
  assert.deepEqual(items(countryClassInstancesQuery('Q1421557', 'Q884', 50, 'genre')), ['Q90000003'])
  assert.deepEqual(items(countryClassInstancesQuery('Q1823448', 'Q884', 50)), ['Q90000005'])
})

test('routes: every route entry of config/classes.json is verified, keyed apart from its class entry and typed', async () => {
  const { readFile } = await import('node:fs/promises')
  const cfg = JSON.parse(await readFile(new URL('../pipeline/config/classes.json', import.meta.url), 'utf8'))
  const keys = cfg.classes.map(classKey)
  assert.equal(new Set(keys).size, keys.length, 'one entry per key')
  const routes = cfg.classes.filter((c) => c.route && c.route !== 'class')
  assert.ok(routes.length >= 5)
  for (const c of routes) {
    assert.ok(ROUTES.has(c.route), c.qid)
    assert.equal(c.verified, true, c.qid)
    assert.equal(c.verified_by, 'https://www.wikidata.org/wiki/' + c.qid, c.qid)
    assert.ok(c.project_type, c.qid)
  }
  for (const p of ['P186', 'P136', 'P135', 'P195']) assert.ok(cfg.properties[p], p)
})
