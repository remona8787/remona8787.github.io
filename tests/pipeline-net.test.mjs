// Pipeline HTTP client (pipeline/lib/net.mjs) and caches: User-Agent, maxlag on MediaWiki APIs with wait-and-retry,
// Retry-After, strict per-host spacing, the time budget, ETag revalidation and TTLs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createClient, createStrictLimiter, USER_AGENT, BudgetError } from '../pipeline/lib/net.mjs'
import { Cache, HOUR } from '../pipeline/lib/cache.mjs'
import { fixtureEnvironment } from './fixtures/pipeline/fake-fetch.mjs'

function virtual(handler) {
  const env = fixtureEnvironment({ latencyMs: 10 })
  const calls = []
  const fetch = async (url, init = {}) => {
    const h = new Headers(init.headers || {})
    calls.push({ url: String(url), at: env.clock(), ua: h.get('user-agent'), inm: h.get('if-none-match'), method: init.method || 'GET' })
    return handler(String(url), calls.length, h)
  }
  return { env, calls, fetch }
}
const json = (v, init = {}) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' }, ...init })

test('every request carries the pipeline User-Agent; MediaWiki APIs get maxlag=5, other hosts do not', async () => {
  const v = virtual(() => json({ ok: 1 }))
  const c = createClient({ fetch: v.fetch, clock: v.env.clock, sleep: v.env.sleep })
  await c.json('https://commons.wikimedia.org/w/api.php?action=query&format=json')
  await c.json('https://ko.wikipedia.org/w/api.php?action=query&format=json')
  await c.json('https://query.wikidata.org/sparql', { method: 'POST', body: 'query=x' })
  await c.json('https://api.gdeltproject.org/api/v2/doc/doc?query=x')
  assert.ok(v.calls.every((x) => x.ua === USER_AGENT))
  assert.equal(USER_AGENT, 'LightArchitectureArchive/0.18 (+https://remona8787.github.io/; remona56@hanmail.net)')
  assert.match(v.calls[0].url, /maxlag=5/)
  assert.match(v.calls[1].url, /maxlag=5/)
  assert.doesNotMatch(v.calls[2].url, /maxlag/)
  assert.doesNotMatch(v.calls[3].url, /maxlag/)
})

test('a maxlag answer waits for Retry-After and retries; a lasting API error is an error', async () => {
  const v = virtual((url, n) => (n === 1 ? json({ error: { code: 'maxlag', info: 'Waiting for db: 7 seconds lagged', lag: 7 } }, { headers: { 'content-type': 'application/json', 'retry-after': '5' } }) : json({ entities: {} })))
  const log = []
  const c = createClient({ fetch: v.fetch, clock: v.env.clock, sleep: v.env.sleep, log: (e) => log.push(e) })
  const t0 = v.env.clock()
  assert.deepEqual(await c.json('https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q1&format=json'), { entities: {} })
  assert.equal(v.calls.length, 2)
  assert.ok(v.calls[1].at - t0 >= 5000, 'waited for Retry-After')
  assert.equal(log[0].kind, 'maxlag')
  const bad = virtual(() => json({ error: { code: 'badvalue', info: 'nope' } }))
  const c2 = createClient({ fetch: bad.fetch, clock: bad.env.clock, sleep: bad.env.sleep })
  await assert.rejects(c2.json('https://commons.wikimedia.org/w/api.php?action=query'), /badvalue/)
  assert.equal(c2.stats['commons.wikimedia.org'].errors, 1)
})

test('429 with Retry-After is honoured, 5xx is retried with backoff', async () => {
  const v = virtual((url, n) => (n === 1 ? new Response('slow down', { status: 429, headers: { 'retry-after': '3' } }) : n === 2 ? new Response('oops', { status: 503 }) : json({ ok: true })))
  const c = createClient({ fetch: v.fetch, clock: v.env.clock, sleep: v.env.sleep })
  const t0 = v.env.clock()
  assert.deepEqual(await c.json('https://api.gdeltproject.org/api/v2/doc/doc?x=1'), { ok: true })
  assert.equal(v.calls.length, 3)
  assert.ok(v.calls[1].at - t0 >= 3000)
})

test('strict per-host spacing: wikis 1 per second, GDELT 1 per 5 s, hosts independent, concurrent callers queue', async () => {
  const env = fixtureEnvironment()
  const lim = createStrictLimiter({ clock: env.clock, sleep: env.sleep, intervals: { 'api.gdeltproject.org': 5000 } })
  const times = { a: [], g: [], b: [] }
  await Promise.all([
    ...Array.from({ length: 4 }, () => lim.wait('en.wikipedia.org').then(() => times.a.push(env.clock()))),
    ...Array.from({ length: 3 }, () => lim.wait('api.gdeltproject.org').then(() => times.g.push(env.clock()))),
    ...Array.from({ length: 2 }, () => lim.wait('de.wikipedia.org').then(() => times.b.push(env.clock()))),
  ])
  const gaps = (l) => l.slice(1).map((t, i) => t - l[i])
  assert.ok(gaps(times.a).every((g) => g >= 1000), String(gaps(times.a)))
  assert.ok(gaps(times.g).every((g) => g >= 5000), String(gaps(times.g)))
  assert.ok(times.b[0] < times.a[1], 'another wiki does not wait for this one')
})

test('the time budget: no request starts after the deadline', async () => {
  const v = virtual(() => json({}))
  const c = createClient({ fetch: v.fetch, clock: v.env.clock, sleep: v.env.sleep, deadline: v.env.clock() + 1500 })
  await c.json('https://commons.wikimedia.org/w/api.php?a=1')
  await c.json('https://commons.wikimedia.org/w/api.php?a=2')
  await assert.rejects(c.json('https://commons.wikimedia.org/w/api.php?a=3'), (e) => e instanceof BudgetError && e.code === 'budget')
  assert.equal(v.calls.length, 2)
})

test('caches: TTL hits, stale entries revalidated with the ETag, 304 keeps the value, saved to state/', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aol-cache-'))
  let now = Date.parse('2026-10-20T00:00:00Z')
  const clock = () => now
  const cache = new Cache({ dir, clock })
  const v = virtual((url, n, h) => (h.get('if-none-match') === '"v1"' ? new Response(null, { status: 304, headers: { etag: '"v1"' } }) : json({ value: n }, { headers: { 'content-type': 'application/json', etag: '"v1"' } })))
  const c = createClient({ fetch: v.fetch, clock, sleep: v.env.sleep, cache })
  const opts = { cache: { ns: 'sparql', key: 'k', ttlMs: HOUR } }
  assert.deepEqual(await c.json('https://query.wikidata.org/sparql?q=1', opts), { value: 1 })
  assert.deepEqual(await c.json('https://query.wikidata.org/sparql?q=1', opts), { value: 1 })
  assert.equal(v.calls.length, 1, 'fresh: from the cache')
  now += 3 * HOUR
  assert.deepEqual(await c.json('https://query.wikidata.org/sparql?q=1', opts), { value: 1 })
  assert.equal(v.calls.length, 2)
  assert.equal(v.calls[1].inm, '"v1"', 'conditional request')
  assert.equal(c.stats['query.wikidata.org'].not_modified, 1)
  const files = await cache.save()
  assert.deepEqual(files.map((f) => path.basename(f)), ['sparql.json'])
  const again = new Cache({ dir, clock })
  assert.deepEqual(again.fresh('sparql', 'k'), { value: 1 })
  // Entries expired long ago are pruned on save; expiry times are spread so one run never expires everything.
  now += 60 * 24 * HOUR
  await again.save()
  const ttls = Array.from({ length: 50 }, (_, i) => { cache.set('x', 'k' + i, 1, { ttlMs: 100 * HOUR }); return cache.entry('x', 'k' + i).ttl })
  assert.ok(Math.min(...ttls) >= 80 * HOUR && Math.max(...ttls) <= 120 * HOUR && new Set(ttls).size > 10)
})

test('thumbnail downloads refuse private addresses and follow at most 3 redirects', async () => {
  const v = virtual(() => new Response('x', { status: 302, headers: { location: 'https://upload.wikimedia.org/next.jpg' } }))
  const c = createClient({ fetch: v.fetch, clock: v.env.clock, sleep: v.env.sleep })
  await assert.rejects(c.bytes('http://127.0.0.1/x.jpg'), /refused/)
  await assert.rejects(c.bytes('https://upload.wikimedia.org/a.jpg'), /redirects/)
})
