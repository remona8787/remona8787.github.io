// Seoul cultural events (pipeline/lib/seoul-events.mjs, 서울 열린데이터광장 OA-15486): the answer's shape, swapped
// coordinates, status from the dates, the media-art relevance gate, the sample-key probe that never publishes, no
// redirect with the key in the URL, the key never in a log, and the link of an event to its place within 300 m.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { parseAnswer, coordsOf, eventStatus, eventOf, classifyEvent, discoverSeoulEvents, linkEvents, eventOut, seoulUrl, SAMPLE_KEY } from '../pipeline/lib/seoul-events.mjs'
import { createClient } from '../pipeline/lib/net.mjs'
import { redactKeys } from '../pipeline/lib/util.mjs'
import { fixtureEnvironment, FIXTURE_ENV } from './fixtures/pipeline/fake-fetch.mjs'

const ROWS = JSON.parse(readFileSync(path.join(import.meta.dirname, 'fixtures/pipeline/seoul/culturalEventInfo.json'), 'utf8')).rows
const TODAY = '2026-10-20'
const client = () => { const env = fixtureEnvironment({ start: Date.parse('2026-10-20T06:17:00Z') }); return { env, c: createClient({ fetch: env.fetch, clock: env.clock, sleep: env.sleep }) } }

test('answer shape, coordinates, dates and fields', () => {
  assert.deepEqual(parseAnswer({ RESULT: { CODE: 'INFO-100', MESSAGE: '인증키가 유효하지 않습니다.' } }), { code: 'INFO-100', message: '인증키가 유효하지 않습니다.', total: null, rows: [] })
  const ok = parseAnswer({ culturalEventInfo: { list_total_count: 2, RESULT: { CODE: 'INFO-000' }, row: [{}, {}] } })
  assert.equal(ok.total, 2); assert.equal(ok.rows.length, 2)
  assert.deepEqual(coordsOf({ LAT: '127.0094', LOT: '37.5667' }), { lat: 37.5667, lng: 127.0094, swapped: true })
  assert.deepEqual(coordsOf({ LAT: '37.5176', LOT: '126.9585' }), { lat: 37.5176, lng: 126.9585, swapped: false })
  assert.deepEqual(coordsOf({ LAT: '0', LOT: '0' }), { lat: null, lng: null, swapped: false })
  assert.equal(eventStatus('2026-12-19', '2027-01-04', TODAY), 'upcoming')
  assert.equal(eventStatus('2026-10-01', '2026-11-30', TODAY), 'running')
  assert.equal(eventStatus('2025-11-01', '2025-12-31', TODAY), 'ended')
  assert.equal(eventStatus(null, null, TODAY), 'unknown')
  const ev = eventOf(ROWS[0], TODAY)
  assert.equal(ev.kind, 'exhibition')
  assert.equal(ev.start, '2026-12-19'); assert.equal(ev.end, '2027-01-04')
  assert.equal(ev.district, '중구'); assert.equal(ev.is_free, true)
  assert.match(ev.id, /^SEV-[0-9A-Z]{7,}$/)
  assert.equal(eventOf(ROWS[0], TODAY).id, ev.id, 'stable ids')
  assert.equal(seoulUrl('k e/y', 1, 5), 'http://openapi.seoul.go.kr:8088/k%20e%2Fy/json/culturalEventInfo/1/5/')
})

test('relevance: media terms and the classifier; light alone is not media art', () => {
  const d = (i) => classifyEvent(eventOf(ROWS[i], TODAY))
  assert.equal(d(0).relevant, true, 'a media facade at DDP')
  assert.equal(d(0).project_type, 'media_facade')
  assert.equal(d(1).relevant, true, 'projection mapping and media art on Nodeul island')
  assert.deepEqual(d(2).reasons, ['no_media_term'], 'a concert')
  assert.equal(d(3).relevant, false, '"빛나는" photo exhibition: a weak word only')
  assert.equal(d(5).relevant, true, 'an immersive media art exhibition (two strong terms)')
  assert.equal(d(5).project_type, 'media_architecture')
})

test('with the key: every row, the relevant current events; ended ones are kept out', async () => {
  const { c } = client()
  const out = await discoverSeoulEvents(c, {}, { key: FIXTURE_ENV.SEOUL_OPEN_DATA_KEY, today: TODAY })
  assert.equal(out.status, 'ok')
  assert.equal(out.received, ROWS.length)
  assert.ok(out.fields.includes('TITLE') && out.fields.includes('STRTDATE') && out.fields.includes('LOT'))
  assert.deepEqual(out.relevant.map((e) => e.title).sort(), [ROWS[0].TITLE, ROWS[1].TITLE, ROWS[5].TITLE].sort())
  assert.ok(out.events.find((e) => e.title === ROWS[4].TITLE).decision.relevant, 'the ended festival is relevant but not current')
  const wrong = await discoverSeoulEvents(client().c, {}, { key: 'not-a-key', today: TODAY })
  assert.equal(wrong.status, 'error')
  assert.equal(wrong.errors[0].code, 'INFO-100')
})

test('without the key: one probe with the sample key (≤ 5 rows) for reachability and field names, never published', async () => {
  const { c, env } = client()
  const out = await discoverSeoulEvents(c, {}, { key: null, today: TODAY })
  assert.equal(out.status, 'skipped')
  assert.equal(out.probe, true)
  assert.equal(out.requested, 1)
  assert.equal(out.received, 5)
  assert.equal(out.probe_result.code, 'INFO-000')
  assert.ok(out.fields.includes('GUNAME'))
  assert.deepEqual(out.relevant, [], 'nothing from the probe is ever published')
  assert.ok(env.requests.some((q) => q.url.includes('/' + SAMPLE_KEY + '/json/culturalEventInfo/1/5/')))
  assert.equal((await discoverSeoulEvents(c, { probe: false }, { key: null, today: TODAY })).requested, 0)
  let t = 0
  const down = await discoverSeoulEvents(createClient({ fetch: async () => { throw new TypeError('fetch failed') }, clock: () => t, sleep: async (ms) => { t += ms } }), {}, { key: null, today: TODAY })
  assert.equal(down.status, 'skipped', 'a failed probe is reported, not a source failure')
  assert.ok(down.errors.length)
})

test('the key in the URL path: no redirect is followed and logs never show it', async () => {
  const hosts = []
  const fetch = async (url) => { hosts.push(new URL(url).host); return new Response('', { status: 302, headers: { location: 'https://elsewhere.example/collect' } }) }
  const logs = []
  const c = createClient({ fetch, clock: () => 0, sleep: async () => {}, log: (l) => logs.push(l) })
  const out = await discoverSeoulEvents(c, {}, { key: 'SECRET-KEY-123', today: TODAY })
  assert.equal(out.status, 'error')
  assert.deepEqual([...new Set(hosts)], ['openapi.seoul.go.kr:8088'], 'the redirect target is never asked')
  assert.ok(!JSON.stringify([out, logs]).includes('SECRET-KEY-123'))
  assert.equal(redactKeys('http://openapi.seoul.go.kr:8088/SECRET-KEY-123/json/culturalEventInfo/1/5/'), 'http://openapi.seoul.go.kr:8088/***/json/culturalEventInfo/1/5/')
})

test('links: an event names its place within 300 m (or in the same district without coordinates); others are candidates', () => {
  const events = ROWS.map((r) => eventOf(r, TODAY)).filter((e) => classifyEvent(e).relevant)
  const ddp = { id: 'SEOUL006', country_iso2: 'KR', name_ko: '동대문디자인플라자(DDP) / 서울라이트', name_en: 'DDP / Seoul Light', latitude: 37.5665, longitude: 127.0095, district: '중구' }
  const far = { ...ddp, id: 'FAR', latitude: 37.6, longitude: 127.1 }
  const noCoords = { ...ddp, id: 'NOC', latitude: null, longitude: null }
  const r = linkEvents(events, [ddp])
  assert.deepEqual(r.linked.map((l) => [l.event.title, l.project.id, l.by]), [[ROWS[0].TITLE, 'SEOUL006', 'name_within_300m']])
  assert.ok(r.linked[0].distance_m < 300)
  assert.equal(r.unlinked.length, events.length - 1)
  assert.equal(linkEvents(events, [far]).linked.length, 0, 'the same name 4 km away is another place')
  assert.equal(linkEvents(events, [noCoords]).linked[0]?.by, 'name_and_district')
  const pub = eventOut(r.linked[0].event, { checkedAt: TODAY })
  assert.equal(pub.source.license, 'KOGL Type 1')
  assert.equal(pub.url, 'https://www.ddp.or.kr/')
  assert.equal(eventOut(events.find((e) => e.title === ROWS[1].TITLE), { checkedAt: TODAY }).url, null, 'http links are not published')
})
