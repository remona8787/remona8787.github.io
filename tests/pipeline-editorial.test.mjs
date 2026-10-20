// Pipeline: editorial decisions (editorial/decisions/*.json, editorial/hero.json), applied in file-name order with
// every decision's status reported.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadEditorial, compileEditorial, validateDecision, cleanFields, heroAllowSet, imageBlocked, applyToProject, finishLog } from '../pipeline/lib/editorial.mjs'

const at = '2026-10-01T00:00:00Z', by = 'editor'
const loaded = (list, hero = []) => ({ decisions: list.map((content, i) => ({ file: `2026-10-0${i + 1}-x.json`, content, error: null })), hero })
const project = (o = {}) => ({ id: 'Q1', qid: 'Q1', curated_id: null, name_en: 'A', name_ko: null, city: 'X', country_iso2: 'US', region: 'north_america', latitude: 1, longitude: 2, sources: [], field_sources: {}, merged_ids: [], ...o })

test('decision shape: actions, targets, required fields', () => {
  assert.deepEqual(validateDecision({ action: 'hide', target: 'Q1', by, at }), [])
  assert.deepEqual(validateDecision({ action: 'hide', target: 'SEOUL001', by, at }), [])
  assert.deepEqual(validateDecision({ action: 'destroy', target: 'Q1', by, at }), ['unknown_action'])
  assert.deepEqual(validateDecision({ action: 'hide', target: '../../etc', by, at }), ['bad_target'])
  assert.deepEqual(validateDecision({ action: 'merge', target: 'Q1', into: 'Q1', by, at }), ['bad_into'])
  assert.deepEqual(validateDecision({ action: 'set_hero', target: 'Q1', by, at }), ['image_required'])
  assert.deepEqual(validateDecision({ action: 'block_image', target: '*', image: 'F.jpg', by, at }), [])
  assert.deepEqual(validateDecision({ action: 'hide', target: '*', by, at }), ['bad_target'])
  assert.deepEqual(validateDecision({ action: 'approve', target: 'new:x', by, at }), ['fields_required'])
  assert.deepEqual(validateDecision({ action: 'hide', target: 'Q1' }), ['by_required', 'at_required'])
})

test('edit fields are validated against the vocabularies; bad values are reported, never applied', () => {
  const { fields, problems } = cleanFields({ name_ko: ' 이름 ', country_iso2: 'kr', project_type: 'billboard', lat: 91, lng: 10, official_url: 'javascript:alert(1)', visit: { status: 'operating' }, color: 'red' })
  assert.deepEqual(fields, { name_ko: '이름', country_iso2: 'KR' })
  assert.deepEqual(problems.sort(), ['bad_lat', 'bad_official_url', 'bad_project_type', 'lat_and_lng_go_together', 'unknown_field:color', 'visit_needs_source_url'].sort())
  const ok = cleanFields({ lat: 37.5, lng: 127, visit: { status: 'seasonal', note: '매일 밤', period: '2026-09-01 – 2026-10-31', source: 'https://example.org/p' } })
  assert.deepEqual(ok.problems, [])
  assert.equal(ok.fields.visit.source, 'https://example.org/p')
})

test('file-name order: a later decision on the same target wins and the earlier one is reported as superseded', () => {
  const ed = compileEditorial(loaded([
    { action: 'hide', target: 'Q1', by, at },
    { action: 'unhide', target: 'Q1', by, at },
    { action: 'set_hero', target: 'Q1', image: 'Night.jpg', by, at },
    { action: 'unset_hero', target: 'Q1', image: 'Night.jpg', by, at },
    { action: 'edit', target: 'Q1', fields: { name_ko: '첫째' }, by, at },
    { action: 'edit', target: 'Q1', fields: { name_ko: '둘째', city: 'Y' }, by, at },
  ], [{ project: 'Q1', image: 'Night.jpg' }, { project: 'Q2', image: 'File:Other_one.jpg' }]))
  const p = applyToProject(ed, project())
  assert.equal(p.editorial.hidden, false)
  assert.equal(p.name_ko, '둘째')
  assert.equal(p.city, 'Y')
  assert.equal(p.field_sources.name_ko, 'editorial')
  const allow = heroAllowSet(ed)
  assert.ok(!allow.has('Q1|Night.jpg'), 'unset_hero removes the hero.json entry')
  assert.ok(allow.has('Q2|Other one.jpg'), 'file names are normalised')
  const log = finishLog(ed)
  assert.deepEqual(log.map((d) => d.status), ['superseded', 'applied', 'superseded', 'pending', 'applied', 'applied'].map((s) => (s === 'pending' ? 'target_not_found' : s)))
})

test('approve: a project id lifts the source gates; new:/candidate ids create editor records with sources', () => {
  const candidates = { 'cand-abc': { id: 'cand-abc', hits: [{ url: 'https://news.example/a', title: 'New media facade', publisher: 'news.example', source_kind: 'news' }] } }
  const ed = compileEditorial(loaded([
    { action: 'approve', target: 'Q1', by, at },
    { action: 'approve', target: 'cand-abc', fields: { name_en: 'Harbour Lights', country_iso2: 'NL', city: 'Rotterdam', project_type: 'light_art', official_url: 'https://harbour.example/' }, by, at },
    { action: 'approve', target: 'new:missing-type', fields: { name_en: 'X', country_iso2: 'NL' }, by, at },
    { action: 'approve', target: 'cand-zzz', fields: { name_en: 'Y', country_iso2: 'NL', project_type: 'light_art' }, by, at },
  ]), { candidates })
  const p = applyToProject(ed, project())
  assert.equal(p.editorial.approved, true)
  assert.equal(ed.created.length, 1)
  const c = ed.created[0]
  assert.equal(c.origin, 'editorial')
  assert.match(c.editorial_id, /^harbour-lights-[0-9a-z]{1,4}$/)
  assert.deepEqual(c.sources.map((s) => s.kind), ['official', 'news'])
  const log = finishLog(ed)
  assert.deepEqual(log.map((d) => d.status), ['applied', 'applied', 'invalid', 'target_not_found'])
  assert.ok(log[2].reasons.includes('approve_needs_name_country_and_type'))
})

test('block_image for one project or everywhere', () => {
  const ed = compileEditorial(loaded([{ action: 'block_image', target: 'Q1', image: 'File:A_b.jpg', by, at }, { action: 'block_image', target: '*', image: 'C.jpg', by, at }]))
  assert.ok(imageBlocked(ed, 'Q1', 'A b.jpg'))
  assert.ok(!imageBlocked(ed, 'Q2', 'A b.jpg'))
  assert.ok(imageBlocked(ed, 'Q2', 'C.jpg'))
})

test('loading from disk: invalid JSON is reported with the file name, hero.json accepts a list or {hero: [...]}', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'aol-editorial-'))
  await mkdir(path.join(dir, 'decisions'))
  await writeFile(path.join(dir, 'decisions', '2026-10-02-b.json'), '{"action": "hide", "target": "Q2", "by": "e", "at": "2026-10-02T00:00:00Z"}')
  await writeFile(path.join(dir, 'decisions', '2026-10-01-a.json'), '{ not json')
  await writeFile(path.join(dir, 'decisions', 'README.md'), 'ignored')
  await writeFile(path.join(dir, 'hero.json'), JSON.stringify({ hero: [{ project: 'Q2', image: 'N.jpg', note: 'ok' }, { project: 'bad id', image: 'x' }] }))
  const l = await loadEditorial(dir)
  assert.deepEqual(l.decisions.map((d) => d.file), ['2026-10-01-a.json', '2026-10-02-b.json'])
  const ed = compileEditorial(l)
  assert.deepEqual(ed.heroList, [{ project: 'Q2', image: 'N.jpg', note: 'ok' }])
  const log = finishLog(ed)
  assert.equal(log[0].status, 'invalid')
  assert.match(log[0].reasons[0], /^invalid_json/)
  assert.ok(log.some((d) => d.file === 'hero.json' && d.status === 'invalid'))
  assert.deepEqual(await loadEditorial(path.join(dir, 'missing')), { decisions: [], hero: [], heroError: null })
})
