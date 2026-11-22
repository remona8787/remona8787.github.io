// pipeline/lib/public-duplicates.mjs: a new record repeating a public record's Commons category is held back.
// Replays 2026-11-20: Category:Origin (Vendel & De Wolf) published as CAT-0MJOWPH beside Q136219703.
import test from 'node:test'
import assert from 'node:assert/strict'
import { duplicatesOfPublic } from '../pipeline/lib/public-duplicates.mjs'

const CAT = 'Category:Origin (Vendel & De Wolf)'
const previous = new Map([['Q136219703', { id: 'Q136219703', commons_category: CAT }], ['CAT-OTHER', { id: 'CAT-OTHER', commons_category: 'Category:Other' }]])

test('public duplicates: a new category record beside the public Wikidata record that has its category is held back', () => {
  const out = duplicatesOfPublic([{ id: 'CAT-0MJOWPH', commons_category: CAT }, { id: 'CAT-NEW', commons_category: 'Category:Something new' }], previous)
  assert.deepEqual(out.map((x) => [x.p.id, x.of]), [['CAT-0MJOWPH', 'Q136219703']])
})

test('public duplicates: the public record itself, records without a category and a record under its new id pass', () => {
  assert.deepEqual(duplicatesOfPublic([{ id: 'Q136219703', commons_category: CAT }, { id: 'Q1', commons_category: null }], previous), [])
  // A category record that gained its Wikidata item this run: CAT-OTHER → Q2 is the same record under a new id.
  assert.deepEqual(duplicatesOfPublic([{ id: 'Q2', commons_category: 'Category:Other' }], previous, new Map([['CAT-OTHER', 'Q2']])), [])
  // Already public before (even with a category another record also has): never held back.
  const both = new Map([...previous, ['CAT-0MJOWPH', { id: 'CAT-0MJOWPH', commons_category: CAT }]])
  assert.deepEqual(duplicatesOfPublic([{ id: 'CAT-0MJOWPH', commons_category: CAT }], both), [])
})
