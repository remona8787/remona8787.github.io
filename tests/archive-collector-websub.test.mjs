// WebSub (edge-functions/_shared/archive/websub.mjs): subscribe/renew requests, the hub's verification of intent,
// HMAC-SHA256/SHA1 signatures checked with crypto.subtle and a constant-time comparison, Link header discovery.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  subscriptionRequest, sendSubscription, verifyIntent, verifySignature, parseSignature, signatureHeader, timingSafeEqual, hmacHex,
  callbackFor, newSecret, parseLinkHeader, pushTopic, leaseExpiry, DEFAULT_LEASE_SECONDS,
} from '../edge-functions/_shared/archive/websub.mjs'

const body = new TextEncoder().encode('<?xml version="1.0"?><rss><channel><title>x</title></channel></rss>')
const secret = 'a'.repeat(64)
const sign = (/** @type {string} */ algo, /** @type {string} */ key = secret) => createHmac(algo, key).update(body).digest('hex')

test('HMAC: sha256 and sha1 signatures from the hub verify; a wrong secret, a changed body, or no signature do not', async () => {
  assert.deepEqual(await verifySignature(body, 'sha256=' + sign('sha256'), secret), { ok: true, reason: null, algorithm: 'sha256' })
  assert.deepEqual(await verifySignature(body, 'sha1=' + sign('sha1'), secret), { ok: true, reason: null, algorithm: 'sha1' })
  assert.deepEqual(await verifySignature(body, 'sha512=' + sign('sha512'), secret), { ok: true, reason: null, algorithm: 'sha512' })
  assert.equal((await verifySignature(body, 'SHA256=' + sign('sha256').toUpperCase(), secret)).ok, true, 'case-insensitive hex and name')
  assert.equal((await verifySignature(body, 'sha256=' + sign('sha256', 'other'), secret)).reason, 'signature_mismatch')
  assert.equal((await verifySignature(new TextEncoder().encode('tampered'), 'sha256=' + sign('sha256'), secret)).reason, 'signature_mismatch')
  assert.equal((await verifySignature(body, null, secret)).reason, 'missing_signature')
  assert.equal((await verifySignature(body, 'md5=abcd', secret)).reason, 'malformed_signature')
  assert.equal((await verifySignature(body, 'sha256=' + sign('sha256'), '')).reason, 'no_secret')
  assert.equal(await hmacHex('sha256', secret, body), sign('sha256'))
  assert.deepEqual(parseSignature(' sha256=ABCDEF '), { algorithm: 'sha256', hex: 'abcdef' })
})

test('X-Hub-Signature-256 is preferred over X-Hub-Signature', () => {
  assert.equal(signatureHeader(new Headers({ 'x-hub-signature-256': 'sha256=aa', 'x-hub-signature': 'sha1=bb' })), 'sha256=aa')
  assert.equal(signatureHeader(new Headers({ 'x-hub-signature-256': 'aa' })), 'sha256=aa')
  assert.equal(signatureHeader(new Headers({ 'x-hub-signature': 'sha1=bb' })), 'sha1=bb')
  assert.equal(signatureHeader(new Headers()), null)
})

test('constant-time comparison: equal, different, different lengths', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true)
  assert.equal(timingSafeEqual('abc', 'abd'), false)
  assert.equal(timingSafeEqual('abc', 'abcd'), false)
  assert.equal(timingSafeEqual('', ''), true)
})

test('subscribe request: form fields, lease, the secret only to https hubs; callback carries the topic', async () => {
  const callback = callbackFor('https://ref.supabase.co/functions/v1/archive-websub', 'https://www.dezeen.com/feed/')
  assert.equal(callback, 'https://ref.supabase.co/functions/v1/archive-websub?topic=https%3A%2F%2Fwww.dezeen.com%2Ffeed%2F')
  const req = subscriptionRequest({ hub: 'https://pubsubhubbub.appspot.com/', topic: 'https://www.dezeen.com/feed/', callback, secret })
  assert.deepEqual(Object.fromEntries(new URLSearchParams(req.body)), { 'hub.mode': 'subscribe', 'hub.topic': 'https://www.dezeen.com/feed/', 'hub.callback': callback, 'hub.lease_seconds': String(DEFAULT_LEASE_SECONDS), 'hub.secret': secret })
  assert.equal(req.headers['content-type'], 'application/x-www-form-urlencoded')
  const plain = subscriptionRequest({ hub: 'http://pubsubhubbub.appspot.com/', topic: 't', callback, secret })
  assert.equal(new URLSearchParams(plain.body).has('hub.secret'), false, 'never over plain http')
  assert.match(newSecret(), /^[0-9a-f]{64}$/)
  assert.notEqual(newSecret(), newSecret())
  /** @type {{url: string, init: RequestInit}[]} */
  const calls = []
  const ok = await sendSubscription({ hub: 'https://hub.example/', topic: 't', callback, secret }, { fetch: async (url, init = {}) => { calls.push({ url, init }); return new Response(null, { status: 202 }) } })
  assert.deepEqual([ok.ok, ok.status, calls[0].init.method], [true, 202, 'POST'])
  const bad = await sendSubscription({ hub: 'https://hub.example/', topic: 't', callback }, { fetch: async () => new Response('no', { status: 400 }) })
  assert.deepEqual([bad.ok, bad.status, bad.error], [false, 400, 'hub answered HTTP 400'])
  const ssrf = await sendSubscription({ hub: 'http://127.0.0.1/', topic: 't', callback }, { fetch: async () => new Response(null, { status: 202 }) })
  assert.equal(ssrf.ok, false)
})

test('verification of intent: echo the challenge only for a known pending/active topic', () => {
  const params = (/** @type {Record<string, string>} */ p) => new URLSearchParams(p)
  const q = { 'hub.mode': 'subscribe', 'hub.topic': 'https://feed.example/rss', 'hub.challenge': 'c-123', 'hub.lease_seconds': '432000' }
  assert.deepEqual(verifyIntent(params(q), { topic: 'https://feed.example/rss', state: 'pending' }), { status: 200, body: 'c-123', mode: 'subscribe', leaseSeconds: 432000, reason: null })
  assert.equal(verifyIntent(params(q), { topic: 'https://feed.example/rss', state: 'active' }).body, 'c-123')
  assert.deepEqual([verifyIntent(params(q), null).status, verifyIntent(params(q), null).body], [404, 'unknown topic'])
  assert.equal(verifyIntent(params(q), { topic: 'https://other.example/rss', state: 'active' }).status, 404)
  assert.equal(verifyIntent(params(q), { topic: 'https://feed.example/rss', state: 'expired' }).status, 404)
  assert.equal(verifyIntent(params({ ...q, 'hub.mode': 'denied', 'hub.reason': 'spam' }), { topic: 'https://feed.example/rss', state: 'pending' }).reason, 'spam')
  assert.equal(verifyIntent(params({ 'hub.mode': 'subscribe', 'hub.topic': 'https://feed.example/rss' }), { topic: 'https://feed.example/rss', state: 'pending' }).status, 400)
  assert.equal(verifyIntent(params({}), null).status, 400)
})

test('Link header discovery and the topic of a push', () => {
  assert.deepEqual(parseLinkHeader('<https://pubsubhubbub.appspot.com/>; rel="hub", <https://www.dezeen.com/feed/>; rel="self"'), { hub: 'https://pubsubhubbub.appspot.com/', self: 'https://www.dezeen.com/feed/' })
  assert.deepEqual(parseLinkHeader('<https://a.example/x,y>; rel=hub'), { hub: 'https://a.example/x,y', self: null })
  assert.deepEqual(parseLinkHeader(null), { hub: null, self: null })
  assert.equal(pushTopic(new URL('https://cb.example/?topic=https%3A%2F%2Ff.example%2Frss'), new Headers()), 'https://f.example/rss')
  assert.equal(pushTopic(new URL('https://cb.example/'), new Headers({ link: '<https://f.example/rss>; rel="self"' })), 'https://f.example/rss')
  assert.equal(leaseExpiry(60, Date.parse('2026-10-18T00:00:00Z')), '2026-10-18T00:01:00.000Z')
  assert.equal(leaseExpiry(null, 0), null)
})
