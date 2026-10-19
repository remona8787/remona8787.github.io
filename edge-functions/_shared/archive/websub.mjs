// WebSub (W3C Recommendation, formerly PubSubHubbub) for feeds that advertise a hub (docs/ARCHIVE_SPEC.md §2, §5):
// subscribe/renew requests, the hub's verification of intent, and the HMAC check of pushed content.
// The callback URL carries the topic (?topic=…), so a push finds its subscription (and secret) even when the hub
// sends no Link rel=self header. Signatures are checked with crypto.subtle (Deno and Node have it) and compared in
// constant time, so the response time does not reveal how much of a forged signature was right.

import { fetchWithPolicy } from './http.mjs'

export const DEFAULT_LEASE_SECONDS = 7 * 24 * 3600
// Renew subscriptions whose lease ends within this window (archive-collect runs hourly).
export const RENEW_WITHIN_HOURS = 48
const ALGORITHMS = /** @type {Record<string, string>} */ ({ sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' })

/** The callback URL for one topic. @param {string} base WEBSUB_CALLBACK_URL @param {string} topic */
export function callbackFor(base, topic) {
  const u = new URL(base)
  u.searchParams.set('topic', topic)
  return u.href
}

/** 32 random bytes as hex: the per-subscription secret the hub signs pushes with. */
export function newSecret() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * The form POST a subscriber sends to the hub (WebSub §5.1).
 * @param {{hub: string, topic: string, callback: string, secret?: string|null, leaseSeconds?: number, mode?: 'subscribe'|'unsubscribe'}} o
 */
export function subscriptionRequest({ hub, topic, callback, secret = null, leaseSeconds = DEFAULT_LEASE_SECONDS, mode = 'subscribe' }) {
  const form = new URLSearchParams({ 'hub.mode': mode, 'hub.topic': topic, 'hub.callback': callback })
  if (mode === 'subscribe') form.set('hub.lease_seconds', String(Math.floor(leaseSeconds)))
  // The secret must be under 200 bytes and is only sent to https hubs (WebSub §5.1: SHOULD NOT over plain http).
  if (secret && mode === 'subscribe' && hub.startsWith('https:')) form.set('hub.secret', secret)
  return { url: hub, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() }
}

/**
 * Sends a (re)subscription to the hub. A hub answers 202 Accepted and then verifies the intent with a GET to the
 * callback; anything else is a failure the caller records (state failed).
 * @param {Parameters<typeof subscriptionRequest>[0]} sub @param {Parameters<typeof fetchWithPolicy>[1]} [policy]
 * @returns {Promise<{ok: boolean, status: number|null, error: string|null}>}
 */
export async function sendSubscription(sub, policy = {}) {
  const req = subscriptionRequest(sub)
  try {
    const res = await fetchWithPolicy(req.url, { ...policy, method: 'POST', headers: req.headers, body: req.body, retries: 1, maxBytes: 64 * 1024 })
    // Hubs answer 202 Accepted (some 204); verification of intent follows asynchronously.
    return { ok: res.ok, status: res.status, error: res.ok ? null : `hub answered HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, status: null, error: String(/** @type {any} */ (e)?.message || e).slice(0, 300) }
  }
}

/**
 * The hub's verification GET (WebSub §5.3): echo hub.challenge only for a known topic whose subscription is
 * pending or active and whose mode matches; a denial (hub.mode=denied) is acknowledged without a challenge.
 * @param {URLSearchParams} params
 * @param {{topic: string, state: string}|null} subscription  what archive_websub_get returned for hub.topic
 * @returns {{status: number, body: string, mode: string|null, leaseSeconds: number|null, reason: string|null}}
 */
export function verifyIntent(params, subscription) {
  const mode = params.get('hub.mode')
  const topic = params.get('hub.topic')
  const challenge = params.get('hub.challenge')
  const lease = Number(params.get('hub.lease_seconds'))
  const leaseSeconds = Number.isFinite(lease) && lease > 0 ? Math.floor(lease) : null
  if (!topic || !mode) return { status: 400, body: 'bad request', mode, leaseSeconds, reason: 'missing_parameters' }
  if (!subscription || subscription.topic !== topic) return { status: 404, body: 'unknown topic', mode, leaseSeconds, reason: 'unknown_topic' }
  if (mode === 'denied') return { status: 200, body: '', mode, leaseSeconds, reason: params.get('hub.reason') || 'denied' }
  if (mode !== 'subscribe' && mode !== 'unsubscribe') return { status: 400, body: 'bad request', mode, leaseSeconds, reason: 'unknown_mode' }
  if (!challenge) return { status: 400, body: 'bad request', mode, leaseSeconds, reason: 'missing_challenge' }
  if (subscription.state !== 'pending' && subscription.state !== 'active') return { status: 404, body: 'not subscribed', mode, leaseSeconds, reason: 'state_' + subscription.state }
  return { status: 200, body: challenge, mode, leaseSeconds, reason: null }
}

/** "sha256=ab12…" → {algorithm, hex}; null when malformed or not a known algorithm. @param {string|null|undefined} header */
export function parseSignature(header) {
  const m = /^\s*(sha1|sha256|sha384|sha512)=([0-9a-f]+)\s*$/i.exec(String(header || ''))
  if (!m) return null
  return { algorithm: m[1].toLowerCase(), hex: m[2].toLowerCase() }
}

/** The signature header a push carries: X-Hub-Signature-256 first, else X-Hub-Signature (WebSub §8). @param {Headers} headers */
export const signatureHeader = (headers) => headers.get('x-hub-signature-256') ? 'sha256=' + String(headers.get('x-hub-signature-256')).replace(/^sha256=/i, '') : headers.get('x-hub-signature')

/** Constant-time comparison of two strings (always walks the longer one). @param {string} a @param {string} b */
export function timingSafeEqual(a, b) {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

/** @param {string} algorithm @param {string} secret @param {Uint8Array} body */
export async function hmacHex(algorithm, secret, body) {
  const hash = ALGORITHMS[algorithm]
  if (!hash) throw new Error('unsupported algorithm ' + algorithm)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, body))
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Whether a pushed body is signed with the subscription's secret. A missing or malformed signature is invalid
 * (we always subscribe with a secret, WebSub §8: the subscriber MUST ignore unsigned content then).
 * @param {Uint8Array} body @param {string|null|undefined} header @param {string|null|undefined} secret
 * @returns {Promise<{ok: boolean, reason: string|null, algorithm: string|null}>}
 */
export async function verifySignature(body, header, secret) {
  if (!secret) return { ok: false, reason: 'no_secret', algorithm: null }
  const sig = parseSignature(header)
  if (!sig) return { ok: false, reason: header ? 'malformed_signature' : 'missing_signature', algorithm: null }
  const expected = await hmacHex(sig.algorithm, secret, body)
  return timingSafeEqual(expected, sig.hex) ? { ok: true, reason: null, algorithm: sig.algorithm } : { ok: false, reason: 'signature_mismatch', algorithm: sig.algorithm }
}

/** Lease end as ISO time. @param {number|null|undefined} leaseSeconds @param {number} now */
export const leaseExpiry = (leaseSeconds, now) => leaseSeconds ? new Date(now + leaseSeconds * 1000).toISOString() : null

/**
 * The topic of a push: the callback's ?topic= (we always set it), else the Link rel=self header.
 * @param {URL} url @param {Headers} headers @returns {string|null}
 */
export function pushTopic(url, headers) {
  const fromQuery = url.searchParams.get('topic')
  if (fromQuery) return fromQuery
  return parseLinkHeader(headers.get('link')).self
}

/**
 * hub and self from an HTTP Link header (RFC 8288), e.g. `<https://hub.example/>; rel="hub", <https://site/feed>; rel="self"`.
 * @param {string|null|undefined} value @returns {{hub: string|null, self: string|null}}
 */
export function parseLinkHeader(value) {
  /** @type {{hub: string|null, self: string|null}} */
  const out = { hub: null, self: null }
  for (const part of String(value || '').split(/,(?=\s*<)/)) {
    const m = /^\s*<([^>]+)>\s*;(.*)$/.exec(part)
    if (!m) continue
    const rel = /rel\s*=\s*"?([^";]+)"?/i.exec(m[2])
    if (!rel) continue
    for (const r of rel[1].trim().toLowerCase().split(/\s+/)) {
      if (r === 'hub' && !out.hub) out.hub = m[1]
      if (r === 'self' && !out.self) out.self = m[1]
    }
  }
  return out
}
