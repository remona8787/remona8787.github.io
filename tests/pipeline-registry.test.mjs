// v0.26 research registry (pipeline/lib/registry.mjs): validation rules, the 17 divisions, edition status in the
// event's own time zone, and the committed registry files of the repository (editorial/registry/*.json).
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { validateRecord, editionStatus, localDay, currentEdition, recordStatus, divisionOfText, registryObservations, buildEvents, loadRegistry, KR_DIVISIONS } from '../pipeline/lib/registry.mjs'
import { PROJECT_TYPES } from '../pipeline/lib/entities.mjs'

const base = (o = {}) => ({ id: 'REG-KR-0001', kind: 'festival', project_type: 'festival_program', name_ko: '가', country_iso2: 'KR', kr_division: 'busan', city: 'Busan', confidence: 'A', sources: [{ url: 'https://korean.visitkorea.or.kr/x', kind: 'public_agency', checked_at: '2026-11-11' }], ...o })
const v = (o) => validateRecord(base(o), { types: PROJECT_TYPES })

test('registry: 17 divisions with ISO codes, each in one of the 8 archive regions', () => {
  assert.equal(KR_DIVISIONS.length, 17)
  assert.equal(new Set(KR_DIVISIONS.map((d) => d.iso)).size, 17)
  const regions = new Set(KR_DIVISIONS.map((d) => d.region))
  assert.equal(regions.size, 8)
  assert.equal(divisionOfText('부산광역시 해운대구 해운대해변로 280'), 'busan')
  assert.equal(divisionOfText('경기도 수원시 장안구'), 'gyeonggi')
  assert.equal(divisionOfText('전남광주특별시 동구'), null, 'the merged city names two survey units')
  assert.equal(divisionOfText('해운대구'), null, 'a district alone decides nothing')
  assert.equal(divisionOfText('서울특별시 중구', '부산광역시'), null, 'conflicting texts')
})

test('registry: validation — sources make the confidence, a Korean record needs its division', () => {
  assert.deepEqual(v(), [])
  assert.ok(v({ kr_division: null }).some((x) => x.includes('kr_division')))
  assert.ok(v({ sources: [{ url: 'https://news.example.com/a', kind: 'news', checked_at: '2026-11-11' }] }).some((x) => x.includes('confidence A')))
  assert.deepEqual(v({ confidence: 'B', sources: [{ url: 'https://a.example.com/x', kind: 'news', checked_at: '2026-11-11' }, { url: 'https://b.example.org/y', kind: 'news', checked_at: '2026-11-11' }] }), [])
  assert.ok(v({ confidence: 'B', sources: [{ url: 'https://a.example.com/x', kind: 'news', checked_at: '2026-11-11' }, { url: 'https://a.example.com/y', kind: 'news', checked_at: '2026-11-11' }] }).some((x) => x.includes('two independent')))
  assert.ok(v({ sources: [{ url: 'http://insecure.example/x', kind: 'official', checked_at: '2026-11-11' }] }).some((x) => x.includes('https')))
  assert.ok(v({ lat: 35.1 }).some((x) => x.includes('together')))
  assert.ok(v({ editions: [{ id: '2026', start: '2026-12-02', end: '2026-12-01', source: 'https://a.example/x', checked_at: '2026-11-11' }] }).some((x) => x.includes('start <= end')))
  assert.ok(v({ id: 'KR-1' }).some((x) => x.includes('id')))
  assert.ok(v({ project_type: 'billboard' }).some((x) => x.includes('project_type')))
})

test('registry: edition status in the place\'s own time zone; stated cancellations win; no dates, unconfirmed', () => {
  const e = { start: '2026-12-11', end: '2027-01-31' }
  // 2026-12-10 15:30 UTC is already 2026-12-11 00:30 in Seoul.
  assert.equal(localDay(Date.parse('2026-12-10T15:30:00Z'), 'Asia/Seoul'), '2026-12-11')
  assert.equal(localDay(Date.parse('2026-12-10T15:30:00Z'), 'Europe/Paris'), '2026-12-10')
  assert.equal(editionStatus(e, localDay(Date.parse('2026-12-10T15:30:00Z'), 'Asia/Seoul')), 'ongoing')
  assert.equal(editionStatus(e, localDay(Date.parse('2026-12-10T15:30:00Z'), 'Europe/Paris')), 'upcoming')
  assert.equal(editionStatus(e, '2027-02-01'), 'ended')
  assert.equal(editionStatus({ ...e, state: 'cancelled' }, '2026-12-20'), 'cancelled')
  assert.equal(editionStatus({ start: '2026-12-11', end: null }, '2026-12-20'), 'unconfirmed')
  const r = { recurrence: 'annual', editions: [{ id: 'a', start: '2025-12-12', end: '2026-01-18' }, { id: 'b', start: '2026-12-11', end: '2027-01-31' }] }
  assert.equal(currentEdition(r, '2026-11-11').id, 'b', 'the next upcoming before the latest ended')
  assert.deepEqual(recordStatus(r, currentEdition(r, '2026-11-11')), { status: 'upcoming', status_source: 'curated' })
  assert.deepEqual(recordStatus(r, currentEdition(r, '2027-03-01')), { status: 'seasonal', status_source: 'curated' }, 'an annual series between editions is seasonal')
  assert.deepEqual(recordStatus({ editions: [] }, null), { status: 'unknown', status_source: null })
})

test('registry: only A and B become observations and events; an event links to its published record', () => {
  const recs = [base({ editions: [{ id: '2026', start: '2026-12-11', end: '2027-01-31', source: 'https://a.example/x', checked_at: '2026-11-11' }] }), base({ id: 'REG-KR-0002', confidence: 'C', editions: [{ id: '2026', start: '2026-12-11', end: '2027-01-31', source: 'https://a.example/x', checked_at: '2026-11-11' }] })]
  const obs = registryObservations(recs, { now: Date.parse('2026-11-11T00:00:00Z') })
  assert.equal(obs.length, 1)
  assert.equal(obs[0].curated_id, 'REG-KR-0001')
  assert.equal(obs[0].kr_region, 'busan_ulsan_gyeongnam')
  assert.equal(obs[0].schedule.status, 'upcoming')
  const ev = buildEvents(recs, { now: Date.parse('2026-11-11T00:00:00Z'), published: new Set(['REG-KR-0001']), generatedAt: 'x', buildId: 'b' })
  assert.equal(ev.series.length, 1)
  assert.equal(ev.series[0].project_id, 'REG-KR-0001')
  assert.equal(ev.counts.upcoming, 1)
  assert.equal(buildEvents(recs, { now: 0, published: new Set(), generatedAt: 'x', buildId: 'b' }).series[0].project_id, null)
})

test('registry: the committed files of the repository are valid, unique and cite their sources', async () => {
  const dir = path.join(import.meta.dirname, '../editorial/registry')
  const r = await loadRegistry(dir, { types: PROJECT_TYPES })
  assert.deepEqual(r.problems, [], JSON.stringify(r.problems.slice(0, 5)))
  for (const x of r.records) {
    assert.ok(x.sources.every((s) => s.checked_at <= '2026-12-31'), x.id)
    if (x.country_iso2 === 'KR') assert.ok(x.kr_division, x.id)
  }
})
