// Archive collector HTTP policy (edge-functions/_shared/archive/http.mjs): retries and backoff with a fake fetch and
// clock, Retry-After, timeout, the 2 MB cap while streaming, redirects with the SSRF guard on every hop, the rate
// limiter, robots.txt and conditional GET. No network: every answer comes from the fake fetch.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchWithPolicy, fetchOk, checkUrl, parseIPv6, createRateLimiter, parseRetryAfter, parseRobots, robotsAllowed, createRobotsCache,
  conditionalHeaders, validatorsOf, HttpError, USER_AGENT, MAX_BYTES,
} from '../edge-functions/_shared/archive/http.mjs'

// A clock that only moves when the code sleeps, and a fetch that answers from a script and records every request.
function harness(/** @type {(req: {url: string, init: RequestInit, n: number}) => Response | Promise<Response>} */ answer) {
  let now = Date.parse('2026-10-18T00:00:00Z')
  /** @type {number[]} */
  const sleeps = []
  /** @type {{url: string, init: RequestInit}[]} */
  const calls = []
  return {
    calls, sleeps,
    clock: () => now,
    sleep: async (/** @type {number} */ ms) => { sleeps.push(ms); now += ms },
    fetch: async (/** @type {string} */ url, /** @type {RequestInit} */ init = {}) => { calls.push({ url, init }); return answer({ url, init, n: calls.length }) },
  }
}

test('sends the descriptive User-Agent, asks for manual redirects and returns the decoded body', async () => {
  const h = harness(() => new Response('héllo', { headers: { 'content-type': 'text/plain; charset=utf-8' } }))
  const res = await fetchWithPolicy('https://example.org/a', h)
  assert.equal(res.ok, true)
  assert.equal(res.text, 'héllo')
  assert.equal(new Headers(h.calls[0].init.headers).get('user-agent'), USER_AGENT)
  assert.match(USER_AGENT, /^LightArchitectureArchive\/0\.16 \(\+https:\/\/github\.com\/ymin02\/medieval_era_project; remona56@hanmail\.net\)$/)
  assert.equal(h.calls[0].init.redirect, 'manual')
})

test('retries 503 twice honouring Retry-After (seconds), then succeeds', async () => {
  const h = harness(({ n }) => n < 3 ? new Response('busy', { status: 503, headers: { 'retry-after': '2' } }) : new Response('ok'))
  const res = await fetchWithPolicy('https://example.org/', h)
  assert.equal(res.status, 200)
  assert.equal(res.attempts, 3)
  assert.deepEqual(h.sleeps, [2000, 2000])
})

test('429 with an HTTP-date Retry-After waits until that date', async () => {
  const h = harness(({ n }) => n === 1 ? new Response('', { status: 429, headers: { 'retry-after': new Date(Date.parse('2026-10-18T00:00:07Z')).toUTCString() } }) : new Response('ok'))
  await fetchWithPolicy('https://example.org/', h)
  assert.deepEqual(h.sleeps, [7000])
})

test('without Retry-After the backoff is 1 s then 2 s; after 2 retries the last answer is returned', async () => {
  const h = harness(() => new Response('down', { status: 500 }))
  const res = await fetchWithPolicy('https://example.org/', h)
  assert.equal(res.status, 500)
  assert.equal(res.ok, false)
  assert.equal(h.calls.length, 3, 'one request and at most two retries')
  assert.deepEqual(h.sleeps, [1000, 2000])
  await assert.rejects(fetchOk('https://example.org/', harness(() => new Response('', { status: 502 }))), (e) => e instanceof HttpError && e.status === 502)
})

test('a Retry-After longer than the run can wait is not waited for (the rule backs off instead)', async () => {
  const h = harness(() => new Response('', { status: 429, headers: { 'retry-after': '3600' } }))
  const res = await fetchWithPolicy('https://example.org/', h)
  assert.equal(res.status, 429)
  assert.equal(h.calls.length, 1)
  assert.equal(res.retryAfterMs, 3600000)
  assert.deepEqual(h.sleeps, [])
})

test('4xx other than 429 is not retried; network errors are retried', async () => {
  const notFound = harness(() => new Response('', { status: 404 }))
  assert.equal((await fetchWithPolicy('https://example.org/', notFound)).status, 404)
  assert.equal(notFound.calls.length, 1)
  const flaky = harness(({ n }) => { if (n === 1) throw new TypeError('fetch failed'); return new Response('ok') })
  assert.equal((await fetchWithPolicy('https://example.org/', flaky)).text, 'ok')
  const dead = harness(() => { throw new TypeError('getaddrinfo ENOTFOUND example.org') })
  await assert.rejects(fetchWithPolicy('https://example.org/', dead), (e) => e instanceof HttpError && e.code === 'network' && /ENOTFOUND/.test(e.message))
  assert.equal(dead.calls.length, 3)
})

test('times out a request that never answers (AbortController), without retrying it', async () => {
  let calls = 0
  const fetch = (/** @type {string} */ _u, /** @type {RequestInit} */ init = {}) => { calls++; return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason))) }
  await assert.rejects(fetchWithPolicy('https://example.org/', { fetch, timeoutMs: 30 }), (e) => e instanceof HttpError && e.code === 'timeout')
  assert.equal(calls, 1)
})

test('the 2 MB cap: refused by Content-Length, and cut off while streaming when the length lies or is missing', async () => {
  const declared = harness(() => new Response('x', { headers: { 'content-length': String(MAX_BYTES + 1) } }))
  await assert.rejects(fetchWithPolicy('https://example.org/', declared), (e) => e instanceof HttpError && e.code === 'too_large')
  let pulled = 0
  const endless = harness(() => new Response(new ReadableStream({
    pull(controller) { pulled++; controller.enqueue(new Uint8Array(256 * 1024)) },
  })))
  await assert.rejects(fetchWithPolicy('https://example.org/', endless), (e) => e instanceof HttpError && e.code === 'too_large' && /streaming/.test(e.message))
  assert.ok(pulled <= 10, 'reading stopped right after the cap, ' + pulled + ' chunks pulled')
  const small = harness(() => new Response('a'.repeat(100)))
  assert.equal((await fetchWithPolicy('https://example.org/', { ...small, maxBytes: 99 }).catch((e) => e.code)), 'too_large')
})

test('SSRF guard: schemes, credentials, IPv4/IPv6 literals in every spelling, local names', () => {
  const blocked = [
    'ftp://example.org/', 'file:///etc/passwd', 'javascript:alert(1)', 'http://user:pw@example.org/',
    'http://localhost/', 'http://LOCALHOST.:8080/', 'http://app.localhost/', 'http://printer.local/', 'http://metadata.google.internal/computeMetadata/v1/',
    'http://intranet/', 'http://router.lan/', 'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/',
    'http://0.0.0.0/', 'http://10.1.2.3/', 'http://172.16.0.1/', 'http://172.31.255.255/', 'http://192.168.1.1/', 'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/', 'http://100.100.100.200/', 'http://198.18.0.1/', 'http://224.0.0.1/', 'http://255.255.255.255/',
    'http://[::1]/', 'http://[::]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:169.254.169.254]/', 'http://[::127.0.0.1]/',
    'http://[64:ff9b::a9fe:a9fe]/', 'http://[2002:c0a8:0101::1]/', 'http://[fc00::1]/', 'http://[fd00:ec2::254]/', 'http://[fe80::1%25eth0]/',
    'http://[fec0::1]/', 'http://[ff02::1]/', 'http://[2001:db8::1]/', 'http://[2001:0:4136:e378::1]/',
  ]
  for (const url of blocked) assert.equal(checkUrl(url).ok, false, url)
  const allowed = ['https://example.org/', 'http://93.184.216.34/', 'https://[2606:4700::6810:84e5]/', 'https://172.32.0.1/', 'https://100.128.0.1/', 'https://naverapihub.apigw.ntruss.com/search/v1/news']
  for (const url of allowed) assert.equal(checkUrl(url).ok, true, url)
  assert.equal(/** @type {any} */ (checkUrl('http://169.254.169.254/')).reason, 'ipv4_link_local_or_metadata')
  assert.equal(/** @type {any} */ (checkUrl('http://[::ffff:10.0.0.1]/')).reason, 'ipv6_mapped_ipv4_private')
  assert.deepEqual(parseIPv6('::ffff:1.2.3.4'), [0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304])
  assert.deepEqual(parseIPv6('2001:db8::'), [0x2001, 0xdb8, 0, 0, 0, 0, 0, 0])
  assert.equal(parseIPv6('1::2::3'), null)
})

test('redirects are followed by hand (at most 3) and every hop passes the SSRF guard', async () => {
  const hops = { 'https://a.example/': 'https://b.example/x', 'https://b.example/x': '/y', 'https://b.example/y': 'https://c.example/' }
  const h = harness(({ url }) => hops[/** @type {keyof typeof hops} */ (url)] ? new Response(null, { status: 302, headers: { location: hops[/** @type {keyof typeof hops} */ (url)] } }) : new Response('end'))
  const res = await fetchWithPolicy('https://a.example/', h)
  assert.equal(res.url, 'https://c.example/')
  assert.deepEqual(res.redirects, ['https://a.example/', 'https://b.example/x', 'https://b.example/y'])
  const loop = harness(({ url }) => new Response(null, { status: 301, headers: { location: url + 'x' } }))
  await assert.rejects(fetchWithPolicy('https://loop.example/', loop), (e) => e instanceof HttpError && e.code === 'too_many_redirects')
  assert.equal(loop.calls.length, 4, 'the original request and three redirects')
  const toMetadata = harness(() => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }))
  await assert.rejects(fetchWithPolicy('https://public.example/', toMetadata), (e) => e instanceof HttpError && e.code === 'ssrf_blocked')
  assert.equal(toMetadata.calls.length, 1, 'the metadata address was never requested')
  const first = harness(() => new Response('x'))
  await assert.rejects(fetchWithPolicy('http://10.0.0.5/', first), (e) => e.code === 'ssrf_blocked')
  assert.equal(first.calls.length, 0)
  // 303 after POST continues as GET without a body.
  const post = harness(({ n }) => n === 1 ? new Response(null, { status: 303, headers: { location: 'https://x.example/done' } }) : new Response('ok'))
  await fetchWithPolicy('https://x.example/form', { ...post, method: 'POST', body: 'a=1' })
  assert.deepEqual([post.calls[1].init.method, post.calls[1].init.body], ['GET', undefined])
})

test('the rate limiter spaces requests per host (GDELT 5 s) and leaves other hosts alone', async () => {
  const h = harness(() => new Response('ok'))
  const limiter = createRateLimiter({ clock: h.clock, sleep: h.sleep, defaultIntervalMs: 1000, intervals: { 'api.gdeltproject.org': 5000 } })
  for (let i = 0; i < 3; i++) await fetchWithPolicy('https://api.gdeltproject.org/api/v2/doc/doc?q=' + i, { ...h, limiter })
  assert.deepEqual(h.sleeps, [5000, 5000])
  await fetchWithPolicy('https://www.dezeen.com/feed/', { ...h, limiter })
  assert.deepEqual(h.sleeps, [5000, 5000], 'another host does not wait for GDELT')
  // Concurrent callers queue instead of all passing at once (a clock that stands still while they are scheduled).
  /** @type {number[]} */
  const waits = []
  const lim = createRateLimiter({ clock: () => 0, sleep: async (ms) => { waits.push(ms) }, defaultIntervalMs: 1000 })
  await Promise.all([lim.wait('h'), lim.wait('h'), lim.wait('h'), lim.wait('other')])
  assert.deepEqual(waits, [1000, 2000])
})

test('Retry-After parsing', () => {
  const now = Date.parse('2026-10-18T00:00:00Z')
  assert.equal(parseRetryAfter('120', now), 120000)
  assert.equal(parseRetryAfter('Sun, 18 Oct 2026 00:01:00 GMT', now), 60000)
  assert.equal(parseRetryAfter('soon', now), null)
  assert.equal(parseRetryAfter(null, now), null)
})

test('robots.txt: groups, longest match, Allow on ties, * and $, our agent vs *', () => {
  const groups = parseRobots([
    '# comment', 'User-agent: *', 'Disallow: /private/', 'Allow: /private/public/', 'Disallow: /*.pdf$', 'Disallow: /search',
    '', 'User-agent: BadBot', 'User-agent: OtherBot', 'Disallow: /',
    '', 'User-agent: LightArchitectureArchive', 'Disallow: /drafts', 'Allow: /drafts/ok$', 'Disallow:',
  ].join('\n'))
  assert.equal(groups.length, 3)
  assert.deepEqual(groups[1].agents, ['badbot', 'otherbot'])
  // Our own group replaces the * group entirely.
  assert.equal(robotsAllowed(groups, '/private/x'), true)
  assert.equal(robotsAllowed(groups, '/drafts/x'), false)
  assert.equal(robotsAllowed(groups, '/drafts/ok'), true)
  assert.equal(robotsAllowed(groups, '/drafts/ok/more'), false)
  // The * group for anyone else.
  assert.equal(robotsAllowed(groups, '/private/x', 'SomeBot'), false)
  assert.equal(robotsAllowed(groups, '/private/public/page', 'SomeBot'), true)
  assert.equal(robotsAllowed(groups, '/files/report.pdf', 'SomeBot'), false)
  assert.equal(robotsAllowed(groups, '/files/report.pdf?x=1', 'SomeBot'), true, '$ anchors the end')
  assert.equal(robotsAllowed(groups, '/searching', 'SomeBot'), false, 'a rule is a prefix')
  assert.equal(robotsAllowed(groups, '/anything', 'BadBot'), false)
  assert.equal(robotsAllowed(groups, '/robots.txt', 'BadBot'), true)
  // Equal length: Allow wins.
  assert.equal(robotsAllowed(parseRobots('User-agent: *\nDisallow: /a\nAllow: /a'), '/a'), true)
  assert.equal(robotsAllowed([], '/x'), true)
})

test('robots cache: rules per origin cached for 24 h; 404 allows, 5xx and unreachable disallow', async () => {
  /** @type {Record<string, () => Response>} */
  const sites = {
    'https://a.example/robots.txt': () => new Response('User-agent: *\nDisallow: /no'),
    'https://b.example/robots.txt': () => new Response('', { status: 404 }),
    'https://c.example/robots.txt': () => new Response('', { status: 503 }),
  }
  const h = harness(({ url }) => { const f = sites[url]; if (!f) throw new TypeError('unreachable'); return f() })
  const robots = createRobotsCache({ policy: { fetch: h.fetch, sleep: h.sleep }, clock: h.clock })
  assert.deepEqual(await robots.allowed('https://a.example/no/1'), { allowed: false, reason: 'robots_disallowed' })
  assert.equal((await robots.allowed('https://a.example/yes')).allowed, true)
  assert.equal(h.calls.filter((c) => c.url === 'https://a.example/robots.txt').length, 1, 'fetched once per origin')
  assert.equal((await robots.allowed('https://b.example/x')).allowed, true)
  assert.deepEqual(await robots.allowed('https://c.example/x'), { allowed: false, reason: 'robots_unreachable' })
  assert.deepEqual(await robots.allowed('https://d.example/x'), { allowed: false, reason: 'robots_unreachable' })
})

test('conditional GET: validators become If-None-Match / If-Modified-Since; a 304 is notModified without a body', async () => {
  assert.deepEqual(conditionalHeaders({ etag: '"abc"', last_modified: 'Wed, 14 Oct 2026 10:00:00 GMT' }), { 'if-none-match': '"abc"', 'if-modified-since': 'Wed, 14 Oct 2026 10:00:00 GMT' })
  assert.deepEqual(conditionalHeaders(null), {})
  const h = harness(({ init }) => new Headers(init.headers).get('if-none-match') === '"abc"' ? new Response(null, { status: 304, headers: { etag: '"abc"' } }) : new Response('<rss/>', { headers: { etag: '"new"' } }))
  const res = await fetchWithPolicy('https://feed.example/rss', { ...h, headers: conditionalHeaders({ etag: '"abc"' }) })
  assert.deepEqual([res.status, res.notModified, res.ok, res.text], [304, true, false, null])
  const fresh = await fetchWithPolicy('https://feed.example/rss', h)
  assert.deepEqual(validatorsOf(fresh.headers), { etag: '"new"', last_modified: null })
})

test('a body is decoded with the charset of Content-Type or the XML declaration', async () => {
  const eucKr = new Uint8Array([0xbc, 0xad, 0xbf, 0xef]) // "서울" in EUC-KR
  const h = harness(() => new Response(eucKr, { headers: { 'content-type': 'text/xml; charset=EUC-KR' } }))
  assert.equal((await fetchWithPolicy('https://kr.example/rss', h)).text, '서울')
  const decl = new Uint8Array([...new TextEncoder().encode('<?xml version="1.0" encoding="euc-kr"?><t>'), ...eucKr, ...new TextEncoder().encode('</t>')])
  const x = harness(() => new Response(decl, { headers: { 'content-type': 'application/xml' } }))
  assert.match(/** @type {string} */ ((await fetchWithPolicy('https://kr.example/rss', x)).text), /<t>서울<\/t>/)
})
