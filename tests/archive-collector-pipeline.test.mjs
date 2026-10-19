// The archive collector pipeline (edge-functions/_shared/archive/pipeline.mjs) end to end on recorded-shape fixtures:
// rule → adapter → prefilter → classify → normalize → dedupe → §8 items, with an injected fetch and clock; the §8
// validator; rule state and backoff; the seed rules and the generated seed SQL (run twice on real Postgres, PGlite).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { collectRule, buildItems, validateItem, ruleState, backoffUntil, labelCounts, boundRaw, collectorLimiter } from '../edge-functions/_shared/archive/pipeline.mjs'
import { buildAliasIndex } from '../edge-functions/_shared/archive/normalize.mjs'
import { CLASSIFIER_VERSION } from '../edge-functions/_shared/archive/classify.mjs'
import { SEED_RULES, SEED_KEYWORDS, GDELT_LANGUAGES } from '../edge-functions/_shared/archive/seed-rules.mjs'
import { seedSql, SEED_SQL_PATH } from '../scripts/archive-seed-sql.mjs'

const fixture = (/** @type {string} */ name) => readFile(new URL('./fixtures/archive/' + name, import.meta.url), 'utf8')
const RULE_ID = '11111111-1111-4111-8111-111111111111'
const PROJECT_ID = '22222222-2222-4222-8222-222222222222'

/** A fake world: answers by URL prefix, records requests; the clock moves only when the code sleeps. */
function world(/** @type {Record<string, (req: {url: string, init: RequestInit}) => Response | Promise<Response>>} */ routes) {
  let now = Date.parse('2026-10-18T00:00:00Z')
  /** @type {{url: string, init: RequestInit}[]} */
  const calls = []
  /** @type {number[]} */
  const sleeps = []
  const fetch = async (/** @type {string} */ url, /** @type {RequestInit} */ init = {}) => {
    calls.push({ url, init })
    const key = Object.keys(routes).find((k) => url.startsWith(k))
    if (!key) throw new TypeError('fetch failed: ' + url)
    return routes[key]({ url, init })
  }
  return { calls, sleeps, fetch, clock: () => now, sleep: async (/** @type {number} */ ms) => { sleeps.push(ms); now += ms } }
}

test('GDELT rule → valid §8 items: classified, located, clustered (same story), with reliability and keys', async () => {
  const gdelt = await fixture('gdelt-artlist.json')
  const w = world({ 'https://api.gdeltproject.org/api/v2/doc/doc': () => new Response(gdelt, { headers: { 'content-type': 'application/json' } }) })
  const aliasIndex = buildAliasIndex([{ project_id: PROJECT_ID, names: ['롯데월드타워', 'Lotte World Tower'] }])
  const rule = { id: RULE_ID, kind: 'gdelt', name: 'GDELT ko', query: '("media facade") sourcelang:korean', last_run_at: '2026-10-17T18:00:00Z', cadence_hours: 6 }
  const r = await collectRule(rule, { ...w, aliasIndex })
  assert.equal(r.status, 'success')
  assert.equal(r.fetched, 7)
  const url = new URL(w.calls[0].url)
  assert.deepEqual([url.searchParams.get('query'), url.searchParams.get('timespan'), url.searchParams.get('mode'), url.searchParams.get('format')], [rule.query, '8h', 'ArtList', 'json'])
  for (const item of r.items) assert.deepEqual(validateItem(item), [], item.title)
  const by = Object.fromEntries(r.items.map((i) => [i.canonical_url, i]))
  const yna = by['https://yna.co.kr/view/AKR20261015123400005'], newsis = by['https://newsis.com/view/NISX20261015_0002999999']
  assert.equal(yna.keys.story_key, newsis.keys.story_key, 'syndicated story → one story key')
  assert.deepEqual([yna.reliability, yna.source_kind], [65, 'news'], 'news 55 + 10 for a second independent domain')
  assert.equal(yna.keys.alias_project_id, PROJECT_ID, 'known project alias in the title')
  assert.deepEqual([yna.classification.label, yna.classification.version, yna.language, yna.rule_id], ['facade_project', CLASSIFIER_VERSION, 'ko', RULE_ID])
  assert.ok(yna.classification.score >= 60)
  const shop = by['https://example-shop.co.kr/product/led-mesh-p10']
  assert.deepEqual([shop.classification.label, shop.classification.score < 35], ['product_vendor', true], 'utm_source dropped from the canonical URL too')
  assert.equal(by['https://example-music.com/news/projection-mapping-concert-tour'].classification.label, 'irrelevant')
  assert.equal(by['https://example-lokal.de/stuttgart/fassade-sanierung'].classification.label, 'irrelevant')
  const guardian = by['https://theguardian.com/artanddesign/2026/oct/14/fixture-media-facade-london']
  assert.deepEqual([guardian.classification.label, guardian.detected.city, guardian.detected.country_iso2], ['facade_project', 'London', 'GB'])
  const asahi = by['https://asahi.com/articles/ASR_FIXTURE.html']
  assert.deepEqual([asahi.detected.city, asahi.detected.name, asahi.language], ['Tokyo', '東京都庁', 'ja'])
  assert.equal(r.items.every((i) => i.detected.latitude === null && i.detected.longitude === null), true, 'no invented coordinates')
  assert.deepEqual(labelCounts(r.items), { facade_project: 3, event_program: 0, ad_screen: 0, product_vendor: 1, irrelevant: 3, uncertain: 0 })
})

test('GDELT requests from one invocation are 5 s apart (shared limiter); a plain-text refusal is a parse error', async () => {
  const w = world({ 'https://api.gdeltproject.org/': () => new Response('Your search contained a keyword that was too short.') })
  const limiter = collectorLimiter(w.clock, w.sleep)
  const a = await collectRule({ id: RULE_ID, kind: 'gdelt', name: 'a', query: 'x' }, { ...w, limiter })
  await collectRule({ id: RULE_ID, kind: 'gdelt', name: 'b', query: 'y' }, { ...w, limiter })
  assert.deepEqual(w.sleeps, [5000])
  assert.equal(a.status, 'error')
  assert.equal(a.errors[0].stage, 'parse')
  assert.match(a.errors[0].message, /too short/)
})

test('RSS rule: positive-keyword prefilter, conditional GET validators, 304, hub discovery, Feedburner origLink', async () => {
  const dezeen = await fixture('dezeen-rss.xml'), archdaily = await fixture('archdaily-feedburner.xml')
  const w = world({
    'https://www.dezeen.com/feed/': ({ init }) => new Headers(init.headers).get('if-none-match') === '"v1"'
      ? new Response(null, { status: 304 })
      : new Response(dezeen, { headers: { 'content-type': 'application/rss+xml; charset=UTF-8', etag: '"v1"', 'last-modified': 'Thu, 15 Oct 2026 16:00:12 GMT', link: '<https://pubsubhubbub.appspot.com>; rel="hub"' } }),
    'https://feeds.feedburner.com/Archdaily': () => new Response(archdaily, { headers: { 'content-type': 'text/xml' } }),
  })
  const rule = { id: RULE_ID, kind: 'rss', name: 'Dezeen', url: 'https://www.dezeen.com/feed/', cadence_hours: 6 }
  const r = await collectRule(rule, w)
  assert.deepEqual([r.status, r.fetched, r.items.length, r.dropped.prefilter], ['success', 3, 2, 1], 'the kitchen lookbook has no positive keyword')
  assert.deepEqual(r.validators, { etag: '"v1"', last_modified: 'Thu, 15 Oct 2026 16:00:12 GMT', retry_after_ms: null })
  assert.deepEqual(r.websub, { hub: 'https://pubsubhubbub.appspot.com', self: 'https://www.dezeen.com/feed/' })
  assert.match(String(new Headers(w.calls[0].init.headers).get('accept')), /application\/rss\+xml/)
  const facade = r.items.find((i) => /kinetic media facade/.test(i.title))
  assert.ok(facade)
  assert.deepEqual([facade.source_kind, facade.reliability, facade.publisher, facade.language, facade.detected.city], ['specialist_media', 70, 'Dezeen', 'en', 'Seoul'])
  assert.ok(!/FULL ARTICLE BODY/.test(JSON.stringify(r.items)), 'no article bodies')
  assert.ok(r.items.every((i) => !i.excerpt || [...i.excerpt].length <= 300))
  const lisbon = r.items.find((i) => /Lisbon/.test(i.title))
  assert.deepEqual([lisbon?.classification.label, lisbon?.canonical_url], ['event_program', 'https://dezeen.com/2026/10/14/lisbon-cathedral-projection-mapping-lumina/'])
  // The next run sends the stored validators and gets 304: nothing to ingest, success, validators kept.
  const again = await collectRule({ ...rule, etag: '"v1"', last_modified: 'Thu, 15 Oct 2026 16:00:12 GMT' }, w)
  assert.deepEqual([again.status, again.not_modified, again.items.length, again.validators.etag], ['success', true, 0, '"v1"'])
  assert.equal(new Headers(w.calls[1].init.headers).get('if-modified-since'), 'Thu, 15 Oct 2026 16:00:12 GMT')
  const fb = await collectRule({ id: RULE_ID, kind: 'rss', name: 'ArchDaily', url: 'https://feeds.feedburner.com/Archdaily' }, w)
  assert.deepEqual(fb.items.map((i) => i.url), ['https://www.archdaily.com/1050001/media-facade-for-a-cultural-centre-in-rotterdam-fixture-architects'])
  assert.deepEqual(fb.websub, { hub: 'http://pubsubhubbub.appspot.com/', self: 'http://feeds.feedburner.com/Archdaily' })
})

test('a failing feed: error with stage and HTTP status, failure count and the spec backoff; Retry-After when longer', async () => {
  const w = world({ 'https://broken.example/feed': () => new Response('gone', { status: 410 }) })
  const rule = { id: RULE_ID, kind: 'rss', name: 'Broken', url: 'https://broken.example/feed', failure_count: 2, cadence_hours: 6 }
  const r = await collectRule(rule, w)
  assert.equal(r.status, 'error')
  assert.deepEqual(r.errors.map((e) => [e.stage, e.http_status, e.url]), [['fetch', 410, 'https://broken.example/feed']])
  const now = w.clock()
  const state = ruleState(rule, r, now)
  assert.deepEqual([state.failed, state.failure_count, state.backoff_until], [true, 3, new Date(now + 4 * 3600e3).toISOString()], '1 h × 2^(3−1)')
  assert.equal(state.next_run_at, new Date(now + 6 * 3600e3).toISOString(), 'the cadence is later than the backoff here')
  assert.equal(backoffUntil(1, now), new Date(now + 3600e3).toISOString())
  assert.equal(backoffUntil(10, now), new Date(now + 48 * 3600e3).toISOString(), 'capped at 48 h')
  assert.equal(backoffUntil(1, now, 5 * 3600e3), new Date(now + 5 * 3600e3).toISOString())
  const ok = ruleState(rule, { ...r, status: 'success', errors: [] }, now)
  assert.deepEqual([ok.failed, ok.failure_count, ok.backoff_until], [false, 0, null])
  const throttled = world({ 'https://slow.example/': () => new Response('', { status: 503, headers: { 'retry-after': '7200' } }) })
  const t = await collectRule({ id: RULE_ID, kind: 'rss', name: 'Slow', url: 'https://slow.example/' }, throttled)
  assert.deepEqual([t.status, t.validators.retry_after_ms, throttled.calls.length], ['error', 7200000, 1], 'a long Retry-After is not waited for')
  assert.equal(ruleState({ failure_count: 0 }, t, now).retry_after_seconds, 7200)
})

test('NAVER rules: skipped without keys; API HUB pages with headers; vendor and real-estate posts rank low', async () => {
  const news = await fixture('naver-news.json'), blog = await fixture('naver-blog.json')
  const w = world({
    'https://naverapihub.apigw.ntruss.com/search/v1/news': () => new Response(news, { headers: { 'content-type': 'application/json' } }),
    'https://naverapihub.apigw.ntruss.com/search/v1/blog': () => new Response(blog, { headers: { 'content-type': 'application/json' } }),
  })
  const skipped = await collectRule({ id: RULE_ID, kind: 'naver_news', name: 'n', query: '미디어파사드' }, w)
  assert.deepEqual([skipped.status, skipped.reason, w.calls.length], ['skipped', 'naver_keys_not_set', 0])
  const getEnv = (/** @type {string} */ k) => /** @type {Record<string, string>} */ ({ NAVER_API_KEY_ID: 'id', NAVER_API_KEY: 'key' })[k]
  const r = await collectRule({ id: RULE_ID, kind: 'naver_news', name: 'n', query: '미디어파사드' }, { ...w, getEnv })
  assert.equal(w.calls.length, 1, 'a short last page ends paging')
  assert.deepEqual([new Headers(w.calls[0].init.headers).get('x-ncp-apigw-api-key-id'), new URL(w.calls[0].url).searchParams.get('sort')], ['id', 'date'])
  const by = Object.fromEntries(r.items.map((i) => [i.canonical_url, i]))
  assert.equal(by['https://yna.co.kr/view/AKR20261015123400005?input=1195m'].classification.label, 'facade_project')
  assert.equal(by['https://newsis.com/view/NISI20261015_0001000001'].title, "광화문 미디어파사드 '서울라이트' 개막", '[포토] dropped')
  assert.equal(by['https://newsis.com/view/NISI20261015_0001000001'].detected.name, '서울라이트')
  assert.equal(by['https://example-led.co.kr/board/view/1'].classification.label, 'product_vendor')
  const b = await collectRule({ id: RULE_ID, kind: 'naver_blog', name: 'b', query: '미디어파사드' }, { ...w, getEnv })
  const posts = Object.fromEntries(b.items.map((i) => [i.canonical_url, i]))
  const trip = posts['https://blog.naver.com/fixtureblogger/223600000001']
  assert.deepEqual([trip.source_kind, trip.reliability, trip.detected.city, trip.classification.score >= 35], ['blog', 30, 'Busan', true])
  assert.equal(posts['https://blog.naver.com/fixturehome/223600000002'].classification.label, 'irrelevant')
  assert.ok(posts['https://blog.naver.com/fixturehome/223600000002'].classification.score < 35)
})

test('Brave rule: off without a key; one metered request with the key', async () => {
  const brave = await fixture('brave-web.json')
  const w = world({ 'https://api.search.brave.com/res/v1/web/search': () => new Response(brave, { headers: { 'content-type': 'application/json' } }) })
  assert.equal((await collectRule({ id: RULE_ID, kind: 'brave', name: 'b', query: 'q' }, w)).reason, 'brave_key_not_set')
  const r = await collectRule({ id: RULE_ID, kind: 'brave', name: 'b', query: '"media facade" building' }, { ...w, getEnv: (k) => k === 'BRAVE_API_KEY' ? 'secret-key' : undefined })
  assert.equal(w.calls.length, 1)
  assert.equal(new Headers(w.calls[0].init.headers).get('x-subscription-token'), 'secret-key')
  const by = Object.fromEntries(r.items.map((i) => [i.canonical_url, i]))
  assert.deepEqual([by['https://dezeen.com/2026/10/15/seoul-office-tower-kinetic-media-facade/'].source_kind, by['https://dezeen.com/2026/10/15/seoul-office-tower-kinetic-media-facade/'].title], ['specialist_media', 'Kinetic media facade for a Seoul office building'])
  assert.equal(by['https://example-led-factory.com/products/media-facade-screen'].classification.label, 'product_vendor')
  assert.equal(by['https://en.wikipedia.org/wiki/Media_facade'].source_kind, 'search_result')
})

test('Wikidata rule reports project updates; websub and disabled rules are skipped; unknown kinds too', async () => {
  const answer = await fixture('wikidata-changes.json')
  const w = world({ 'https://query.wikidata.org/sparql': () => new Response(answer, { headers: { 'content-type': 'application/sparql-results+json' } }) })
  const r = await collectRule({ id: RULE_ID, kind: 'wikidata', name: 'w', last_run_at: '2026-10-10T00:00:00Z' }, { ...w, wikidataProjects: [{ project_id: PROJECT_ID, wikidata_qid: 'Q1000001' }] })
  assert.deepEqual([r.status, r.fetched, r.items.length, r.project_updates.map((u) => u.qid)], ['success', 1, 0, ['Q1000001']])
  assert.equal(w.calls[0].init.method, 'POST')
  assert.equal((await collectRule({ kind: 'websub', name: 'x' }, w)).status, 'skipped')
  assert.equal((await collectRule({ kind: 'rss', name: 'x', url: 'https://a.example/', enabled: false }, w)).reason, 'rule_disabled')
  assert.equal((await collectRule({ kind: 'bing', name: 'x' }, w)).reason, 'unknown_kind')
})

test('an unreachable source is an error with the network message, never a throw', async () => {
  const w = world({})
  const r = await collectRule({ id: RULE_ID, kind: 'rss', name: 'x', url: 'https://unreachable.example/feed' }, w)
  assert.equal(r.status, 'error')
  assert.match(r.errors[0].message, /network error: fetch failed/)
  const ssrf = await collectRule({ id: RULE_ID, kind: 'rss', name: 'x', url: 'http://169.254.169.254/feed' }, w)
  assert.match(ssrf.errors[0].message, /refused .*ipv4_link_local_or_metadata/)
})

test('§8 validator: exact keys, types, lengths and vocabularies', () => {
  const [item] = buildItems([{ provider: 'rss', external_id: 'g', url: 'https://www.example.org/a?utm_source=x', title: 'Media facade on the tower', excerpt: 'A tower.', publisher: 'Ex', language: 'en', published_at: '2026-10-15T00:00:00.000Z', raw: { a: 1 } }]).items
  assert.deepEqual(validateItem(item), [])
  const bad = (/** @type {(i: any) => void} */ change) => { const copy = structuredClone(item); change(copy); return validateItem(copy) }
  assert.match(bad((i) => { i.extra = 1 }).join(), /keys must be exactly/)
  assert.match(bad((i) => { i.provider = 'bing' }).join(), /provider/)
  assert.match(bad((i) => { i.rule_id = 'not-a-uuid' }).join(), /rule_id/)
  assert.match(bad((i) => { i.url = 'ftp://x' }).join(), /url/)
  assert.match(bad((i) => { i.title = 'x'.repeat(501) }).join(), /title/)
  assert.match(bad((i) => { i.title = 'a <b>bold</b> title' }).join(), /HTML/)
  assert.match(bad((i) => { i.excerpt = 'x'.repeat(301) }).join(), /excerpt/)
  assert.match(bad((i) => { i.language = 'English' }).join(), /language/)
  assert.match(bad((i) => { i.published_at = 'yesterday' }).join(), /published_at/)
  assert.match(bad((i) => { i.source_kind = 'press' }).join(), /source_kind/)
  assert.match(bad((i) => { i.reliability = 101 }).join(), /reliability/)
  assert.match(bad((i) => { i.classification.label = 'auto_ignored' }).join(), /label/)
  assert.match(bad((i) => { i.classification.reasons = new Array(21).fill('r') }).join(), /reasons/)
  assert.match(bad((i) => { i.detected.country_iso2 = 'kor' }).join(), /country_iso2/)
  assert.match(bad((i) => { delete i.detected.latitude }).join(), /detected/)
  assert.match(bad((i) => { i.keys.wikidata_qid = '1000' }).join(), /wikidata_qid/)
  assert.match(bad((i) => { i.keys.story_key = '' }).join(), /story_key/)
  assert.match(bad((i) => { i.raw = { big: 'x'.repeat(5000) } }).join(), /4 kB/)
  assert.deepEqual(validateItem(null), ['item is not an object'])
  // raw is bounded before validation.
  assert.ok(new TextEncoder().encode(JSON.stringify(boundRaw({ a: 'x'.repeat(6000), list: new Array(500).fill('y') }))).byteLength <= 4096)
})

test('buildItems drops non-http links and duplicate canonical URLs within a batch, and reports them', () => {
  const rec = (/** @type {string} */ url) => ({ provider: /** @type {const} */ ('gdelt'), external_id: null, url, title: 'Media facade', excerpt: null, publisher: null, language: 'en', published_at: null, raw: {} })
  const out = buildItems([rec('https://www.a.example/x'), rec('https://a.example/x#top'), rec('javascript:alert(1)')])
  assert.deepEqual([out.items.length, out.dropped.duplicate_url, out.dropped.invalid, out.errors[0].stage], [1, 1, 1, 'normalize'])
})

test('seed rules: 14 GDELT language groups, the 7 spec feeds unverified, NAVER and Brave off, unique (kind, name)', () => {
  const gdelt = SEED_RULES.filter((r) => r.kind === 'gdelt')
  assert.deepEqual(gdelt.map((r) => r.language).sort(), ['ar', 'de', 'en', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pl', 'pt', 'ru', 'tr', 'zh'])
  assert.equal(GDELT_LANGUAGES.length, 14)
  const rss = SEED_RULES.filter((r) => r.kind === 'rss')
  assert.deepEqual(rss.map((r) => r.name), ['Dezeen', 'designboom', 'ArchDaily', 'Archinect', 'Creative Applications Network', 'Media Architecture Institute', 'Designboom Korea'])
  for (const r of rss) assert.match(String(r.url), /^https:\/\//)
  assert.ok(SEED_RULES.every((r) => r.verified_at === null), 'nothing is verified in the seed')
  assert.ok(SEED_RULES.filter((r) => r.kind.startsWith('naver') || r.kind === 'brave').every((r) => !r.enabled))
  assert.ok(SEED_RULES.filter((r) => r.kind === 'gdelt' || r.kind === 'rss' || r.kind === 'wikidata').every((r) => r.enabled), 'free sources are on')
  assert.equal(new Set(SEED_RULES.map((r) => r.kind + '|' + r.name)).size, SEED_RULES.length)
})

test('seed SQL: the committed file is current, and it is idempotent on Postgres and keeps operator state', async () => {
  assert.equal(await readFile(SEED_SQL_PATH, 'utf8'), seedSql(), 'run npm run archive:seed-sql')
  const db = new PGlite()
  // Minimal stand-ins for the db track's tables (only the seeded columns matter here), without unique indexes:
  // the seed must not depend on them.
  await db.exec(`
    create table public.archive_collection_rules (id uuid primary key default gen_random_uuid(), kind text not null, name text not null, query text, url text,
      language text, region_hint text, enabled boolean not null default true, cadence_hours integer not null default 6, next_run_at timestamptz default now(),
      last_run_at timestamptz, failure_count integer not null default 0, terms_url text, verified_at timestamptz, notes text);
    create table public.archive_keywords (id bigserial primary key, term text not null, language text not null,
      polarity text not null check (polarity in ('positive','context','negative')), weight smallint not null, enabled boolean not null default true);`)
  const count = async (/** @type {string} */ t) => Number((await db.query(`select count(*)::int as n from ${t}`)).rows[0].n)
  await db.exec(seedSql())
  assert.deepEqual([await count('archive_collection_rules'), await count('archive_keywords')], [SEED_RULES.length, SEED_KEYWORDS.length])
  // An operator enables NAVER, verifies a feed and disables a keyword; the scheduler records a failure.
  await db.exec(`update archive_collection_rules set enabled = true, verified_at = now(), failure_count = 3, notes = 'edited' where kind = 'naver_news';
    update archive_keywords set enabled = false, weight = 1 where term = 'media facade*' and language = 'en';`)
  await db.exec(seedSql())
  assert.deepEqual([await count('archive_collection_rules'), await count('archive_keywords')], [SEED_RULES.length, SEED_KEYWORDS.length], 'no duplicates')
  const naver = (await db.query(`select enabled, verified_at is not null as verified, failure_count, notes from archive_collection_rules where kind = 'naver_news' limit 1`)).rows[0]
  assert.deepEqual([naver.enabled, naver.verified, naver.failure_count], [true, true, 3], 'operator and scheduler state kept')
  assert.notEqual(naver.notes, 'edited', 'the seeded definition is restored')
  const kw = (await db.query(`select enabled, weight from archive_keywords where term = 'media facade*' and language = 'en'`)).rows[0]
  assert.deepEqual([kw.enabled, kw.weight], [false, 45])
  const disabled = (await db.query(`select count(*)::int as n from archive_collection_rules where verified_at is null and kind <> 'naver_news'`)).rows[0]
  assert.equal(disabled.n, SEED_RULES.length - SEED_RULES.filter((r) => r.kind === 'naver_news').length)
  await db.close()
})
