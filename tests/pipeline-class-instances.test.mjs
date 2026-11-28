// pipeline/lib/wikidata.mjs classInstances (v0.26.8): a class whose instance query fails, or is not reached because
// the time budget ran out, is answered by its last answer in the cache. Replays 2026-11-28 03:10: the Wikidata stage
// ran out of time and every class was lost for one run, so 71 fields of public projects changed and changed back.
import test from 'node:test'
import assert from 'node:assert/strict'
import { classInstances } from '../pipeline/lib/wikidata.mjs'
import { Cache } from '../pipeline/lib/cache.mjs'
import { BudgetError } from '../pipeline/lib/net.mjs'

const review = [
  { qid: 'Q1', key: 'Q1', publish: true },
  { qid: 'Q2', key: 'Q2', publish: true },
  { qid: 'Q3', key: 'Q3:creator', route: 'creator', publish: true },
  { qid: 'Q4', key: 'Q4', publish: false },
]
const answer = (...qids) => ({ results: { bindings: qids.map((q) => ({ item: { value: 'http://www.wikidata.org/entity/' + q } })) } })
/** A cache holding the last answers of Q1, Q2 and Q3 (expired: they are only used when the live query fails). */
function lastAnswers() {
  let now = 0
  const cache = new Cache({ clock: () => now })
  cache.set('sparql', 'instances:Q1', answer('Q101', 'Q102'), { ttlMs: 1 })
  cache.set('sparql', 'instances:Q2', answer('Q201'), { ttlMs: 1 })
  cache.set('sparql', 'instances:Q3:creator', answer('Q301', 'Q101'), { ttlMs: 1 })
  now = 10 * 24 * 3600e3
  return cache
}
/** A client answering each class by the `#aol:class-instances Qn` tag of the query, or failing as told. */
const client = (plan) => {
  const asked = []
  return {
    asked,
    json: async (url, o) => {
      const q = new URLSearchParams(o.body).get('query').match(/#aol:class-instances (Q\d+)/)[1]
      asked.push(q)
      const p = plan[q]
      if (p instanceof Error) throw p
      return p
    },
  }
}

test('class instances: a class whose query fails is answered by its last answer, the others live', async () => {
  const c = client({ Q1: answer('Q101', 'Q103'), Q2: new Error('no answer within 65000 ms'), Q3: answer('Q301') })
  const out = await classInstances(c, review, { cache: lastAnswers() })
  assert.deepEqual(c.asked, ['Q1', 'Q2', 'Q3'], 'an unpublished class is not asked')
  assert.deepEqual(out.stale, ['Q2'])
  assert.deepEqual(out.perClass, { Q1: 2, Q2: 1, 'Q3:creator': 1 })
  assert.deepEqual(Object.fromEntries(out.byQid), { Q101: ['Q1'], Q103: ['Q1'], Q301: ['Q3:creator'] }, 'live answers')
  assert.deepEqual(Object.fromEntries(out.staleByQid), { Q201: ['Q2'] }, 'last answers, kept apart: they never make an item seen')
  assert.deepEqual(out.errors.map((e) => [e.class, e.message]), [['Q2', 'no answer within 65000 ms']])
})

test('class instances: out of time, the class that hit the budget and every later one come from their last answers', async () => {
  const c = client({ Q1: answer('Q101'), Q2: new BudgetError('wikidata'), Q3: answer('Q999') })
  const out = await classInstances(c, review, { cache: lastAnswers() })
  assert.deepEqual(c.asked, ['Q1', 'Q2'], 'nothing is asked after the budget ran out')
  assert.deepEqual(out.stale, ['Q2', 'Q3:creator'])
  assert.deepEqual(Object.fromEntries(out.byQid), { Q101: ['Q1'] })
  assert.deepEqual(Object.fromEntries(out.staleByQid), { Q201: ['Q2'], Q301: ['Q3:creator'], Q101: ['Q3:creator'] })
  assert.match(out.errors.at(-1).message, /time budget exhausted: 2 classes answered from their last answer/)
})

test('class instances: staleOnly asks nothing; a class never answered before has no instances', async () => {
  const c = client({})
  const cache = lastAnswers()
  const out = await classInstances(c, [...review, { qid: 'Q5', key: 'Q5', publish: true }], { cache, staleOnly: true })
  assert.deepEqual(c.asked, [])
  assert.deepEqual(out.stale, ['Q1', 'Q2', 'Q3:creator'])
  assert.equal(out.perClass.Q5, null)
  assert.deepEqual([out.byQid.size, out.staleByQid.size], [0, 4])
})
