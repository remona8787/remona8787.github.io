// Archive source adapters on recorded-shape fixtures (tests/fixtures/archive/): GDELT DOC 2.0 ArtList JSON, RSS 2.0
// (WordPress, Feedburner), Atom, RSS 1.0/RDF, NAVER news/blog JSON with <b> marks, Brave web results, Wikidata SPARQL.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gdeltUrl, gdeltTimespan, parseSeenDate, parseGdelt, gdeltRecords, GDELT_DOC_API } from '../edge-functions/_shared/archive/adapters/gdelt.mjs'
import { parseXml, parseFeed, feedRecords, parseFeedDate, textOf } from '../edge-functions/_shared/archive/adapters/rss.mjs'
import { naverConfig, naverRequest, parseNaver, stripNaverMarkup, NAVER_LEGACY_CUTOFF_MS } from '../edge-functions/_shared/archive/adapters/naver.mjs'
import { braveKey, braveRequest, parseBrave } from '../edge-functions/_shared/archive/adapters/brave.mjs'
import { changeQuery, parseChanges, detectWikidataChanges } from '../edge-functions/_shared/archive/adapters/wikidata.mjs'
import { gdeltQuery, SEED_RULES } from '../edge-functions/_shared/archive/seed-rules.mjs'

const fixture = (/** @type {string} */ name) => readFile(new URL('./fixtures/archive/' + name, import.meta.url), 'utf8')
const NOW = Date.parse('2026-10-18T00:00:00Z')
const env = (/** @type {Record<string, string>} */ vars) => (/** @type {string} */ name) => vars[name]

test('GDELT: DOC 2.0 ArtList query URL with the documented parameters', () => {
  const q = gdeltQuery(['media facade', 'projection mapping', 'mediagevel'], 'dutch')
  assert.equal(q, '("media facade" OR "projection mapping" OR mediagevel) sourcelang:dutch')
  const url = new URL(gdeltUrl(q, { timespan: '6h' }))
  assert.equal(url.origin + url.pathname, GDELT_DOC_API)
  assert.deepEqual(Object.fromEntries(url.searchParams), { query: q, mode: 'ArtList', format: 'json', maxrecords: '250', timespan: '6h', sort: 'DateDesc' })
  assert.equal(new URL(gdeltUrl(q, { maxrecords: 999 })).searchParams.get('maxrecords'), '250', 'never above the API maximum')
  // Every seeded GDELT rule is an OR group in parentheses with a sourcelang filter.
  for (const r of SEED_RULES.filter((x) => x.kind === 'gdelt')) assert.match(/** @type {string} */ (r.query), /^\("[^"]+"( OR "[^"]+")+\) sourcelang:[a-z]+$/)
})

test('GDELT: timespan since the previous run (with overlap, 6 h minimum, 90 days maximum) and seendate parsing', () => {
  assert.equal(gdeltTimespan(null, NOW), '3m')
  assert.equal(gdeltTimespan(new Date(NOW - 3600e3).toISOString(), NOW), '6h')
  assert.equal(gdeltTimespan(new Date(NOW - 10 * 3600e3).toISOString(), NOW), '12h')
  assert.equal(gdeltTimespan(new Date(NOW - 5 * 86400e3).toISOString(), NOW), '6d', '122 h with the overlap, rounded up to days')
  assert.equal(gdeltTimespan(new Date(NOW - 400 * 86400e3).toISOString(), NOW), '90d')
  assert.equal(parseSeenDate('20261015T083000Z'), '2026-10-15T08:30:00.000Z')
  assert.equal(parseSeenDate('2026-10-15'), null)
})

test('GDELT: ArtList JSON → records; "{}" is no result; a plain-text refusal is a parse error', async () => {
  const parsed = parseGdelt(await fixture('gdelt-artlist.json'))
  assert.equal(parsed.error, null)
  const records = gdeltRecords(parsed.articles)
  assert.equal(records.length, 7)
  assert.deepEqual(records[0], {
    provider: 'gdelt', external_id: null, url: 'https://www.yna.co.kr/view/AKR20261015123400005', title: '롯데월드타워 미디어파사드 가을 콘텐츠 첫 공개', excerpt: null,
    publisher: 'yna.co.kr', language: 'ko', published_at: '2026-10-15T08:30:00.000Z',
    raw: { domain: 'yna.co.kr', language: 'Korean', sourcecountry: 'South Korea', seendate: '20261015T083000Z' },
  })
  assert.ok(!('socialimage' in records[0].raw), 'no third-party image URLs are kept')
  assert.deepEqual(parseGdelt('{}'), { articles: [], error: null })
  assert.match(String(parseGdelt('Your search contained a phrase that was too short.').error), /without JSON: Your search contained/)
})

test('XML reader: CDATA, entities, comments, DOCTYPE, self-closing and mismatched tags', () => {
  const doc = parseXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><!-- c --><r a="1 &amp; 2"><t><![CDATA[<b>x</b> & y]]></t><s/><u>&lt;ok&gt; &#169; &#x2014; &hellip;</u><v><w></v>tail</r>')
  const r = /** @type {any} */ (doc.children[0])
  assert.equal(r.name, 'r')
  assert.equal(r.attrs.a, '1 & 2')
  assert.equal(textOf(r.children[0]), '<b>x</b> & y')
  assert.equal(r.children[1].name, 's')
  assert.equal(textOf(r.children[2]), '<ok> © — …')
  assert.equal(textOf(r), '<b>x</b> & y<ok> © — …tail')
})

test('RSS 2.0 (WordPress/Dezeen): items with excerpt from description only, never content:encoded; self link', async () => {
  const feed = parseFeed(await fixture('dezeen-rss.xml'), { now: NOW })
  assert.deepEqual([feed.format, feed.title, feed.link, feed.language, feed.self, feed.hub], ['rss', 'Dezeen', 'https://www.dezeen.com', 'en', 'https://www.dezeen.com/feed/', null])
  assert.equal(feed.items.length, 3)
  const [first] = feed.items
  assert.equal(first.title, 'Studio wraps Seoul office tower in kinetic media facade of 20,000 aluminium fins')
  assert.equal(first.link, 'https://www.dezeen.com/2026/10/15/seoul-office-tower-kinetic-media-facade/')
  assert.equal(first.published_at, '2026-10-15T15:00:31.000Z')
  assert.equal(first.guid, 'https://www.dezeen.com/?p=2112345')
  assert.deepEqual(first.categories, ['Architecture', 'Seoul', 'Media facades'])
  assert.match(String(first.description), /^A fixture studio has clad an office tower in Seoul/)
  assert.ok(!/FULL ARTICLE BODY/.test(JSON.stringify(feed)), 'content:encoded is never read')
  const records = feedRecords(feed)
  assert.equal(records[0].publisher, 'Dezeen')
  assert.equal(records[0].language, 'en')
  assert.equal(records[2].url, 'https://www.dezeen.com/2026/10/14/lisbon-cathedral-projection-mapping-lumina/?utm_source=rss&utm_medium=rss')
})

test('Feedburner RSS (ArchDaily): origLink instead of the redirector, hub and self from atom10:link, escaped HTML descriptions', async () => {
  const feed = parseFeed(await fixture('archdaily-feedburner.xml'), { now: NOW })
  assert.deepEqual([feed.hub, feed.self], ['http://pubsubhubbub.appspot.com/', 'http://feeds.feedburner.com/Archdaily'])
  assert.equal(feed.items[0].link, 'https://www.archdaily.com/1050001/media-facade-for-a-cultural-centre-in-rotterdam-fixture-architects')
  assert.match(String(feed.items[0].description), /^Text description provided by the architects\. The perforated aluminium envelope/)
  assert.equal(feed.items[0].published_at, '2026-10-15T15:00:00.000Z')
  // The HTTP Link header wins over the feed's own links (WebSub discovery order).
  const viaHeader = parseFeed(await fixture('archdaily-feedburner.xml'), { now: NOW, linkHeader: '<https://hub.example/>; rel="hub", <https://www.archdaily.com/feed>; rel="self"' })
  assert.deepEqual([viaHeader.hub, viaHeader.self], ['https://hub.example/', 'https://www.archdaily.com/feed'])
})

test('Atom (Archinect): html, text and xhtml titles, summary or content, published or updated, hub', async () => {
  const feed = parseFeed(await fixture('archinect-atom.xml'), { now: NOW })
  assert.deepEqual([feed.format, feed.title, feed.self, feed.hub, feed.link, feed.language], ['atom', 'Archinect - News', 'https://archinect.com/feed/1/news', 'https://websub.example-hub.net/', 'https://archinect.com/news', 'en'])
  assert.equal(feed.items[0].title, 'Shanghai tower\'s LED "media façade" becomes the city\'s largest screen')
  assert.equal(feed.items[0].published_at, '2026-10-15T13:30:00.000Z')
  assert.equal(feed.items[0].description, 'The 300-metre tower now carries a media facade of 60,000 LED points, programmed by a fixture studio.')
  assert.deepEqual(feed.items[0].categories, ['Media Architecture'])
  assert.equal(feed.items[1].link, 'https://archinect.com/news/article/150070002/job-of-the-week')
  assert.equal(feed.items[1].published_at, '2026-10-14T12:00:00.000Z', 'updated when there is no published')
  assert.equal(feed.items[2].title, 'Projection mapping on the Dresden opera house opens the light festival')
  assert.match(String(feed.items[2].description), /^Every night this week/)
})

test('RSS 1.0 / RDF (Japanese): items beside the channel, dc:date, dc:language, a zone-less date taken as UTC', async () => {
  const feed = parseFeed(await fixture('rdf-ja.xml'), { now: NOW })
  assert.deepEqual([feed.format, feed.title, feed.language, feed.items.length], ['rdf', 'フィクスチャ建築ニュース', 'ja', 2])
  assert.equal(feed.items[0].published_at, '2026-10-15T09:00:00.000Z')
  assert.equal(feed.items[1].published_at, '2026-10-15T09:00:00.000Z')
  assert.deepEqual(feed.items[0].categories, ['建築'])
  assert.throws(() => parseFeed('<html><body>not a feed</body></html>'), /not a feed/)
})

test('feed dates: RFC 822 with numeric and named zones, ISO 8601, implausible dates dropped', () => {
  assert.equal(parseFeedDate('Thu, 15 Oct 2026 15:00:31 +0000', NOW), '2026-10-15T15:00:31.000Z')
  assert.equal(parseFeedDate('Thu, 15 Oct 2026 18:00:00 KST', NOW), '2026-10-15T09:00:00.000Z')
  assert.equal(parseFeedDate('Thu, 15 Oct 2026 10:00:00 EDT', NOW), '2026-10-15T14:00:00.000Z')
  assert.equal(parseFeedDate('Thu, 15 Oct 2026 10:00:00 GMT', NOW), '2026-10-15T10:00:00.000Z')
  assert.equal(parseFeedDate('2026-10-15T18:00:00+09:00', NOW), '2026-10-15T09:00:00.000Z')
  assert.equal(parseFeedDate('2026-10-15 18:00:00 +09:00', NOW), '2026-10-15T09:00:00.000Z')
  assert.equal(parseFeedDate('Thu, 01 Jan 1970 00:00:00 GMT', NOW), null)
  assert.equal(parseFeedDate('2030-01-01T00:00:00Z', NOW), null)
  assert.equal(parseFeedDate('soon', NOW), null)
})

test('NAVER: API HUB endpoint and headers by default, legacy developers.naver.com mode until 2027-06-30', () => {
  assert.deepEqual(naverConfig(env({})), { ok: false, reason: 'naver_keys_not_set' })
  assert.deepEqual(naverConfig(env({ NAVER_API_KEY_ID: 'id', NAVER_API_KEY: 'k', NAVER_API_MODE: 'other' })), { ok: false, reason: 'naver_mode_invalid' })
  const hub = naverConfig(env({ NAVER_API_KEY_ID: 'id', NAVER_API_KEY: 'k' }))
  assert.ok(hub.ok)
  const req = naverRequest('news', { query: '미디어파사드', start: 101, display: 500 }, /** @type {any} */ (hub).config, NOW)
  const u = new URL(req.url)
  assert.equal(u.origin + u.pathname, 'https://naverapihub.apigw.ntruss.com/search/v1/news')
  assert.deepEqual(Object.fromEntries(u.searchParams), { query: '미디어파사드', display: '100', start: '101', sort: 'date' })
  assert.deepEqual(req.headers, { 'X-NCP-APIGW-API-KEY-ID': 'id', 'X-NCP-APIGW-API-KEY': 'k', accept: 'application/json' })
  const legacy = /** @type {any} */ (naverConfig(env({ NAVER_API_KEY_ID: 'cid', NAVER_API_KEY: 'sec', NAVER_API_MODE: 'legacy' }))).config
  const l = naverRequest('blog', { query: '미디어파사드' }, legacy, NOW)
  assert.ok(l.url.startsWith('https://openapi.naver.com/v1/search/blog.json?'))
  assert.deepEqual(l.headers, { 'X-Naver-Client-Id': 'cid', 'X-Naver-Client-Secret': 'sec', accept: 'application/json' })
  // The injected clock decides: still allowed on the last day (KST), refused from 2027-07-01 00:00 KST.
  assert.doesNotThrow(() => naverRequest('news', { query: 'x' }, legacy, Date.parse('2027-06-30T23:59:00+09:00')))
  assert.throws(() => naverRequest('news', { query: 'x' }, legacy, NAVER_LEGACY_CUTOFF_MS), /naver_legacy_expired/)
  assert.doesNotThrow(() => naverRequest('news', { query: 'x' }, /** @type {any} */ (hub).config, NAVER_LEGACY_CUTOFF_MS + 86400e3))
})

test('NAVER: news and blog answers with <b> marks and entities → records', async () => {
  assert.equal(stripNaverMarkup('롯데 <b>미디어파사드</b> &quot;가을&quot; &amp; &lt;b&gt;'), '롯데 미디어파사드 "가을" &')
  const news = parseNaver(JSON.parse(await fixture('naver-news.json')), 'news')
  assert.deepEqual([news.total, news.start, news.records.length], [1834, 1, 3])
  assert.deepEqual(news.records[0], {
    provider: 'naver_news', external_id: 'https://n.news.naver.com/mnews/article/001/0015000001?sid=103',
    url: 'https://www.yna.co.kr/view/AKR20261015123400005?input=1195m', title: '롯데월드타워 미디어파사드에 "가을"을 담았다',
    excerpt: '서울 송파구 롯데월드타워 외벽 미디어파사드에서 15일 밤 가을을 주제로 한 영상 작품이 상영되고 있다. <사진=연합뉴스>', publisher: 'yna.co.kr', language: 'ko',
    published_at: '2026-10-15T08:58:00.000Z',
    raw: { link: 'https://n.news.naver.com/mnews/article/001/0015000001?sid=103', originallink: 'https://www.yna.co.kr/view/AKR20261015123400005?input=1195m', pubDate: 'Thu, 15 Oct 2026 17:58:00 +0900' },
  })
  assert.equal(news.records[1].title, "[포토] 광화문 미디어파사드 '서울라이트' 개막")
  const blog = parseNaver(JSON.parse(await fixture('naver-blog.json')), 'blog')
  assert.deepEqual([blog.records[0].provider, blog.records[0].publisher, blog.records[0].published_at], ['naver_blog', '빛 따라 걷기', '2026-10-13T15:00:00.000Z'])
  assert.throws(() => parseNaver({ errorMessage: 'Authentication failed', errorCode: '024' }, 'news'), /Authentication failed/)
})

test('Brave: off without a key; web search request and results with <strong> marks', async () => {
  assert.equal(braveKey(env({})), null)
  assert.equal(braveKey(env({ BRAVE_API_KEY: ' key ' })), 'key')
  const req = braveRequest('"media facade" building', 'key')
  const u = new URL(req.url)
  assert.equal(u.origin + u.pathname, 'https://api.search.brave.com/res/v1/web/search')
  assert.deepEqual(Object.fromEntries(u.searchParams), { q: '"media facade" building', count: '20', offset: '0', freshness: 'pw' })
  assert.deepEqual(req.headers, { 'X-Subscription-Token': 'key', accept: 'application/json' })
  const records = parseBrave(JSON.parse(await fixture('brave-web.json')))
  assert.equal(records.length, 3)
  assert.deepEqual([records[0].title, records[0].publisher, records[0].language, records[0].published_at], ['Kinetic media facade for a Seoul office building | Dezeen', 'Dezeen', 'en', '2026-10-15T15:00:31.000Z'])
  assert.match(String(records[0].excerpt), /^A fixture studio has clad/)
  assert.equal(records[1].published_at, null)
  assert.throws(() => parseBrave({ type: 'ErrorResponse', error: { code: 'SUBSCRIPTION_TOKEN_INVALID', detail: 'The provided subscription token is invalid.' } }), /subscription token is invalid/)
})

test('Wikidata: one small SPARQL query per batch; changes after the previous run are reported, a first run is a baseline', async () => {
  const q = changeQuery(['Q1000001', 'Q1000002', 'bad'])
  assert.match(q, /VALUES \?item \{ wd:Q1000001 wd:Q1000002 \}/)
  assert.match(q, /schema:dateModified \?modified/)
  for (const p of ['P571', 'P17', 'P625', 'P856', 'P5817']) assert.match(q, new RegExp(`wdt:${p} `))
  const answer = await fixture('wikidata-changes.json')
  const parsed = parseChanges(JSON.parse(answer))
  assert.deepEqual(parsed.get('Q1000001'), { modified: '2026-10-16T09:12:44Z', values: { inception: ['2017-04-03T00:00:00Z'], country: ['Q884'], coordinates: ['Point(127.1025 37.5126)'], official_website: ['https://fixture-tower.example/'] } })
  /** @type {string[]} */
  const bodies = []
  const fetch = async (/** @type {string} */ _url, /** @type {RequestInit} */ init = {}) => { bodies.push(String(init.body)); return new Response(answer, { headers: { 'content-type': 'application/sparql-results+json' } }) }
  const projects = [
    { project_id: 'p1', wikidata_qid: 'Q1000001' }, { project_id: 'p2', wikidata_qid: 'Q1000002' }, { project_id: 'p3', wikidata_qid: 'Q1000003' }, { project_id: 'p4', wikidata_qid: null },
  ]
  const out = await detectWikidataChanges({ projects, since: '2026-10-10T00:00:00Z', policy: { fetch } })
  assert.equal(out.checked, 3)
  assert.deepEqual(out.changes.map((c) => [c.project_id, c.qid]), [['p1', 'Q1000001'], ['p3', 'Q1000003']])
  assert.deepEqual(out.changes[1].values, { state_of_use: ['Q30108381'] })
  assert.equal(bodies.length, 1)
  const first = await detectWikidataChanges({ projects, since: null, policy: { fetch } })
  assert.deepEqual([first.baseline, first.changes.length, first.checked], [true, 0, 3])
  const failing = await detectWikidataChanges({ projects, since: '2026-10-10T00:00:00Z', policy: { fetch: async () => new Response('', { status: 500 }), sleep: async () => {} } })
  assert.deepEqual([failing.checked, failing.errors.length, failing.errors[0].http_status], [0, 1, 500])
})
