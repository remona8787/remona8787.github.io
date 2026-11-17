// pipeline/lib/route-cap.mjs: the route diversity cap limits growth and never takes a public record out. Reproduces
// SHA_RE (Q130070466): let in by a partial run that found fewer of its group, taken out by the next complete run.
import test from 'node:test'
import assert from 'node:assert/strict'
import { routeCap, routeGroup, isRouteOnly } from '../pipeline/lib/route-cap.mjs'
import { trackProjects } from '../pipeline/lib/state.mjs'

// Groningen public art without a credited creator id: one group, 'unknown|NL|Groningen'. Route-only (a material class).
const work = (n, extra = {}) => ({ id: 'Q' + (130070000 + n), country_iso2: 'NL', city: 'Groningen', origins: ['wikidata_class'], evidence: [{ kind: 'wikidata_class', classes: ['Q12177156:material'] }], credits: [], sitelink_count: 0, ...extra })
const ids = (list) => list.map((p) => p.id).sort()
const prevOf = (list) => new Map(list.map((p) => [p.id, { id: p.id, country_iso2: p.country_iso2, city: p.city, credits: p.credits }]))
// What the tracker holds after a run: the group of every published route-only record (null for the others).
const trackerOf = (published, groups) => trackProjects({ projects: {} }, new Map(), { published: new Map(published.map((p) => [p.id, { origins: p.origins, route_group: groups.get(p.id) ?? null }])), decided: new Set(), sourceStatus: {}, runNo: 1, nowIso: 'x' }).tracker

test('route cap: the group, and which items count (route classes only, not curated or approved)', () => {
  assert.equal(routeGroup(work(1)), 'unknown|NL|Groningen')
  assert.equal(routeGroup(work(1, { credits: [{ role: 'operator', wikidata_qid: 'Q1' }, { role: 'artist', wikidata_qid: 'Q2' }] })), 'Q2|NL|Groningen')
  assert.equal(isRouteOnly(work(1)), true)
  assert.equal(isRouteOnly(work(1, { evidence: [{ kind: 'wikidata_class', classes: ['Q838948', 'Q12177156:material'] }] })), false, 'a light class')
  assert.equal(isRouteOnly(work(1, { origins: ['wikidata_class', 'commons'] })), false, 'another source')
  assert.equal(isRouteOnly(work(1, { curated_id: 'SEOUL001' })), false)
  assert.equal(isRouteOnly(work(1, { editorial: { approved: true } })), false)
})

test('route cap: a first run keeps the most linked six, the rest wait (as before)', () => {
  const all = Array.from({ length: 9 }, (_, i) => work(i + 1, { sitelink_count: i === 8 ? 5 : 0 }))
  const { capped, groups } = routeCap(all, { cap: 6, built: new Set(all.map((p) => p.id)) })
  assert.deepEqual(ids(capped), ['Q130070006', 'Q130070007', 'Q130070008'])
  assert.equal(groups.size, 6)
  assert.ok(groups.has('Q130070009'), 'the most linked first')
})

test('route cap: a partial run does not let a newcomer into slots held by public records it did not see (SHA_RE)', () => {
  // Complete run: six public, three waiting.
  const all = Array.from({ length: 9 }, (_, i) => work(i + 1))
  const first = routeCap(all, { cap: 6, built: new Set(all.map((p) => p.id)) })
  const public1 = all.filter((p) => !first.capped.includes(p))
  const tracker = trackerOf(public1, first.groups)
  assert.ok(Object.values(tracker.projects).every((t) => t.route_group === 'unknown|NL|Groningen'))
  // Partial run: two public ones are not found (a class query failed); one waiting item is found again.
  const seen = [...public1.slice(2), all[6]]
  const second = routeCap(seen, { cap: 6, built: new Set(seen.map((p) => p.id)), previous: prevOf(public1), tracker })
  assert.deepEqual(ids(second.capped), ['Q130070007'], 'the two unseen public records still hold their slots')
  assert.equal(second.held.get('unknown|NL|Groningen'), 2)
  // Complete run again: nothing that was public is taken out, nothing new comes in.
  const third = routeCap(all, { cap: 6, built: new Set(all.map((p) => p.id)), previous: prevOf(public1), tracker })
  assert.deepEqual(ids(third.capped), ['Q130070007', 'Q130070008', 'Q130070009'])
})

test('route cap: a public record is never capped, even when its group is over the cap', () => {
  // Seven public from before the cap was stable, plus a newcomer with many links.
  const old = Array.from({ length: 7 }, (_, i) => work(i + 1))
  const newcomer = work(20, { sitelink_count: 40 })
  const r = routeCap([...old, newcomer], { cap: 6, built: new Set([...old, newcomer].map((p) => p.id)), previous: prevOf(old) })
  assert.deepEqual(ids(r.capped), ['Q130070020'])
  assert.equal(r.groups.size, 7)
})

test('route cap: a free slot goes to a newcomer; other groups and merged ids are counted apart', () => {
  const old = Array.from({ length: 5 }, (_, i) => work(i + 1))
  const fresh = [work(10), work(11)]
  const other = Array.from({ length: 3 }, (_, i) => work(30 + i, { city: 'Assen' }))
  const r = routeCap([...old, ...fresh, ...other], { cap: 6, built: new Set([...old, ...fresh, ...other].map((p) => p.id)), previous: prevOf(old) })
  assert.deepEqual(ids(r.capped), ['Q130070011'])
  // An id merged into another this run: the record is public under its new id, and the old id holds no slot.
  const merged = work(40)
  const prev = prevOf([...old, { ...merged, id: 'Q999' }])
  const m = routeCap([...old, merged, ...fresh], { cap: 6, built: new Set([...old, merged, ...fresh].map((p) => p.id)), previous: prev, aliases: new Map([['Q999', merged.id]]) })
  assert.deepEqual(ids(m.capped), ['Q130070010', 'Q130070011'])
  assert.equal(m.held.size, 0)
})

test('route cap: a public record from before the tracker kept groups counts when it came from Wikidata classes only', () => {
  const old = Array.from({ length: 6 }, (_, i) => work(i + 1))
  const tracker = { projects: Object.fromEntries(old.map((p) => [p.id, { origins: ['wikidata_class'] }])) }
  tracker.projects[old[0].id] = { origins: ['wikidata_class', 'commons'] }
  const seen = [...old.slice(2), work(10), work(11)]
  const r = routeCap(seen, { cap: 6, built: new Set(seen.map((p) => p.id)), previous: prevOf(old), tracker })
  assert.equal(r.held.get('unknown|NL|Groningen'), 1, 'only the class-only unseen record')
  assert.deepEqual(ids(r.capped), ['Q130070011'])
})

test('tracker: a carried-over record keeps its route group', () => {
  const p = work(1)
  const t1 = trackerOf([p], new Map([[p.id, routeGroup(p)]]))
  const t2 = trackProjects(t1, prevOf([p]), { published: new Map(), decided: new Set(), sourceStatus: { wikidata: { status: 'partial' } }, runNo: 2, nowIso: 'y' })
  assert.equal(t2.tracker.projects[p.id].route_group, 'unknown|NL|Groningen')
  assert.equal(t2.carried[0].reason, 'source_not_complete')
})
