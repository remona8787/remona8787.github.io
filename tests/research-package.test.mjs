// The public research dataset (scripts/research-package.mjs) built from the pipeline's fixture dataset
// (tests/fixtures/pipeline/site-data): files, row counts, the data dictionary, checksums, determinism, the CSV formula
// guard, what is left out, and the change log against a previous dataset.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { researchPackage, PROJECT_FIELDS, RELATION_FIELDS, EVENT_FIELDS, AGENT_FIELDS } from '../scripts/research-package.mjs'

const DIR = path.join(import.meta.dirname, 'fixtures/pipeline/site-data')
async function dataset() {
  const files = new Map()
  for (const f of ['manifest.json', 'index.json']) files.set(f, await readFile(path.join(DIR, f), 'utf8'))
  for (const f of await readdir(path.join(DIR, 'projects'))) files.set('projects/' + f, await readFile(path.join(DIR, 'projects', f), 'utf8'))
  return files
}
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
// Minimal RFC 4180 reader for the checks.
function parseCSV(text) {
  const rows = [], row = [], push = () => { rows.push(row.splice(0)) }
  let cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c; continue }
    if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = '' } else if (c === '\r') continue; else if (c === '\n') { row.push(cur); cur = ''; push() } else cur += c
  }
  return rows
}

test('research package: every file under data/research/<build id>/ with a latest.json that names them with checksums', async () => {
  const files = await dataset(), manifest = JSON.parse(files.get('manifest.json')), index = JSON.parse(files.get('index.json'))
  const out = researchPackage(files)
  const base = `data/research/${manifest.build_id}/`
  for (const f of ['projects.csv', 'projects.json', 'projects.geojson', 'sources.csv', 'images.csv', 'relations.csv', 'events.csv', 'agents.csv', 'datapackage.json', 'README.md', 'CITATION.txt']) assert.ok(out.has(base + f), f)
  assert.ok(!out.has(base + 'CHANGELOG.md'), 'no change log without a previous dataset')
  const latest = JSON.parse(out.get('data/research/latest.json'))
  assert.equal(latest.version, manifest.build_id)
  assert.equal(latest.path, base)
  for (const [f, meta] of Object.entries(latest.files)) { assert.equal(meta.sha256, sha(out.get(base + f)), f); assert.equal(meta.bytes, Buffer.byteLength(out.get(base + f)), f) }
  const csv = parseCSV(out.get(base + 'projects.csv'))
  assert.deepEqual(csv[0], PROJECT_FIELDS.map((f) => f[0]))
  assert.equal(csv.length - 1, index.rows.length, 'one row per published project')
  assert.equal(latest.counts.projects, index.rows.length)
  // The data dictionary in datapackage.json is the CSV header, and every resource checksum matches.
  const dp = JSON.parse(out.get(base + 'datapackage.json'))
  assert.equal(dp.version, manifest.build_id)
  assert.equal(dp.data_as_of, manifest.generated_at.slice(0, 10))
  assert.deepEqual(dp.resources.find((r) => r.name === 'projects').schema.fields.map((f) => f.name), csv[0])
  for (const r of dp.resources) assert.equal(r.hash, 'sha256:' + sha(out.get(base + r.path)), r.path)
  assert.equal(dp.counts.projects, index.rows.length)
  assert.match(out.get(base + 'CITATION.txt'), new RegExp(manifest.build_id))
})

test('research package: facts only — no editorial summaries, no image files, images listed with their licence', async () => {
  const files = await dataset(), out = researchPackage(files), base = [...out.keys()][0].replace(/[^/]+$/, '')
  const json = JSON.parse(out.get(base + 'projects.json'))
  assert.ok(json.projects.every((p) => !('summary_ko' in p) && !('summary_en' in p)))
  const images = parseCSV(out.get(base + 'images.csv'))
  const head = images[0], at = (k) => head.indexOf(k)
  assert.ok(images.length > 1)
  for (const r of images.slice(1)) { assert.ok(r[at('license')], 'licence on every image row'); assert.ok(r[at('author')] || r[at('provider')]); assert.match(r[at('page')], /^https:\/\//) }
  assert.ok(![...out.keys()].some((k) => /\.(jpe?g|png|webp|avif)$/i.test(k)))
  const geo = JSON.parse(out.get(base + 'projects.geojson'))
  assert.equal(geo.type, 'FeatureCollection')
  for (const f of geo.features) { const [lng, lat] = f.geometry.coordinates; assert.ok(Math.abs(lat) <= 90 && Math.abs(lng) <= 180) }
  assert.equal(geo.features.length, json.projects.filter((p) => p.lat != null && p.lng != null).length)
})

test('research package: the same dataset gives byte-identical files; text a spreadsheet would run is neutralised', async () => {
  const a = researchPackage(await dataset()), b = researchPackage(await dataset())
  assert.deepEqual([...a.keys()], [...b.keys()])
  for (const [k, v] of a) assert.equal(b.get(k), v, k)
  const files = await dataset(), shardKey = [...files.keys()].find((k) => k.startsWith('projects/'))
  const shard = JSON.parse(files.get(shardKey)), id = shard.projects[0].id
  shard.projects[0].name_en = '=HYPERLINK("https://evil.example","x")'
  shard.projects[0].address = 'line one\nline "two", three'
  files.set(shardKey, JSON.stringify(shard))
  const out = researchPackage(files), base = [...out.keys()][0].replace(/[^/]+$/, '')
  const rows = parseCSV(out.get(base + 'projects.csv')), head = rows[0], row = rows.find((r) => r[0] === id)
  assert.equal(row[head.indexOf('name_en')], `'=HYPERLINK("https://evil.example","x")`)
  assert.equal(row[head.indexOf('address')], 'line one\nline "two", three')
  assert.ok(rows.slice(1).every((r) => r.length === head.length), 'quoted newlines and commas keep every row whole')
})

test('research package: a change log against the previous dataset; a dataset without a build id is refused', async () => {
  const prev = await dataset(), now = await dataset()
  const pm = JSON.parse(prev.get('manifest.json')); pm.build_id = '20261001T000000Z-00000000'; prev.set('manifest.json', JSON.stringify(pm))
  const pi = JSON.parse(prev.get('index.json')), gone = pi.rows.pop()[pi.fields.indexOf('id')]; prev.set('index.json', JSON.stringify(pi))
  const out = researchPackage(now, { previous: prev })
  const base = [...out.keys()][0].replace(/[^/]+$/, ''), log = out.get(base + 'CHANGELOG.md')
  assert.match(log, /이전 버전 20261001T000000Z-00000000/)
  assert.match(log, new RegExp(`추가 1건: ${gone}`))
  assert.equal(JSON.parse(out.get(base + 'datapackage.json')).changes.added, 1)
  const bad = await dataset(), m = JSON.parse(bad.get('manifest.json')); delete m.build_id; bad.set('manifest.json', JSON.stringify(m))
  assert.throws(() => researchPackage(bad), /build_id/)
  assert.throws(() => researchPackage(new Map()), /manifest\.json: missing/)
})

test('research package: record kind, status with its source, field confidence, relations and events with their licence', async () => {
  const files = await dataset(), out = researchPackage(files), base = [...out.keys()][0].replace(/[^/]+$/, '')
  const records = [...files].filter(([k]) => k.startsWith('projects/')).flatMap(([, v]) => JSON.parse(v).projects)
  const byId = new Map(records.map((p) => [p.id, p]))
  const rows = parseCSV(out.get(base + 'projects.csv')), head = rows[0], col = (r, k) => r[head.indexOf(k)]
  for (const r of rows.slice(1)) {
    const p = byId.get(r[0])
    assert.equal(col(r, 'kind'), p.kind, r[0])
    assert.equal(col(r, 'status'), p.status, r[0])
    assert.equal(col(r, 'status_source'), p.status === 'unknown' ? '' : p.status_source, r[0])
    for (const k of Object.keys(p.field_confidence)) assert.equal(col(r, 'confidence_' + k), p.field_confidence[k], `${r[0]} ${k}`)
    assert.equal(Number(col(r, 'relation_count')), p.relations.length, r[0])
    assert.equal(Number(col(r, 'event_count')), (p.events || []).length, r[0])
  }
  // Every relation of every record, one row each, and every target is a published project.
  const rel = parseCSV(out.get(base + 'relations.csv'))
  assert.deepEqual(rel[0], RELATION_FIELDS.map((f) => f[0]))
  assert.equal(rel.length - 1, records.reduce((n, p) => n + p.relations.length, 0))
  assert.ok(rel.length > 1)
  for (const r of rel.slice(1)) assert.ok(byId.has(r[rel[0].indexOf('target')]), r.join(','))
  const seoul = rel.find((r) => r[0] === 'SEOUL006' && r[1] === 'exhibition_at')
  assert.ok(seoul && seoul[rel[0].indexOf('subject_event')].startsWith('SEV-'), 'an event of a place keeps its event id')
  // Events carry the dataset and licence of the public data they came from.
  const ev = parseCSV(out.get(base + 'events.csv'))
  assert.deepEqual(ev[0], EVENT_FIELDS.map((f) => f[0]))
  assert.equal(ev.length - 1, records.reduce((n, p) => n + (p.events || []).length, 0))
  for (const r of ev.slice(1)) { assert.ok(r[ev[0].indexOf('license')], 'licence on every event'); assert.match(r[ev[0].indexOf('source_url')], /^https:\/\//) }
  const dp = JSON.parse(out.get(base + 'datapackage.json'))
  assert.equal(dp.counts.relations, rel.length - 1)
  assert.equal(dp.counts.events, ev.length - 1)
  assert.equal(Object.values(dp.counts.by_kind).reduce((a, b) => a + b, 0), rows.length - 1)
  for (const name of ['relations', 'events']) assert.ok(dp.resources.find((r) => r.name === name)?.schema.fields.length, name)
  const readme = out.get(base + 'README.md')
  assert.match(readme, /### relations\.csv/)
  assert.match(readme, /### events\.csv/)
  assert.match(readme, /confidence_/)
})

test('research package: agents from credits and event organisers, merged only by QID or the exact name', async () => {
  const files = await dataset(), shardKey = [...files.keys()].find((k) => k.startsWith('projects/'))
  const shard = JSON.parse(files.get(shardKey)), [a, b] = shard.projects
  // The same artist (same QID) credited on two projects; a namesake without a QID stays a separate agent.
  a.credits = [{ name: 'Fixture Artist', name_en: 'Fixture Artist', role: 'media_artist', wikidata_qid: 'Q99000999' }, { name: '픽스처 운영 재단', role: 'operator' }]
  b.credits = [{ name: 'Fixture Artist', role: 'media_artist', wikidata_qid: 'Q99000999' }, { name: 'Fixture  Artist', role: 'lighting_designer' }]
  files.set(shardKey, JSON.stringify(shard))
  const out = researchPackage(files), base = [...out.keys()][0].replace(/[^/]+$/, '')
  const rows = parseCSV(out.get(base + 'agents.csv')), head = rows[0], col = (r, k) => r[head.indexOf(k)]
  assert.deepEqual(head, AGENT_FIELDS.map((f) => f[0]))
  const byId = new Map(rows.slice(1).map((r) => [r[0], r]))
  const artist = byId.get('Q99000999')
  assert.equal(col(artist, 'project_count'), '2')
  assert.equal(col(artist, 'project_ids'), [a.id, b.id].sort().join(';'))
  assert.equal(col(artist, 'entity_type'), 'artist')
  const namesake = byId.get('name:fixture artist')
  assert.ok(namesake, 'no QID: keyed by the normalised exact name, never merged into the QID agent')
  assert.equal(col(namesake, 'roles'), 'lighting_designer')
  assert.equal(col(byId.get('name:픽스처 운영 재단'), 'entity_type'), 'organization')
  // An event organiser (events[].org) is an organisation of the place's record.
  assert.equal(col(byId.get('name:서울디자인재단'), 'roles'), 'event_organizer')
  assert.equal(col(byId.get('name:서울디자인재단'), 'project_ids'), 'SEOUL006')
  const dp = JSON.parse(out.get(base + 'datapackage.json'))
  assert.equal(dp.counts.agents, rows.length - 1)
  assert.match(out.get(base + 'README.md'), /## 엔터티 모델/)
})
