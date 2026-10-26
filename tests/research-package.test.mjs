// The public research dataset (scripts/research-package.mjs) built from the pipeline's fixture dataset
// (tests/fixtures/pipeline/site-data): files, row counts, the data dictionary, checksums, determinism, the CSV formula
// guard, what is left out, and the change log against a previous dataset.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { researchPackage, PROJECT_FIELDS } from '../scripts/research-package.mjs'

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
  for (const f of ['projects.csv', 'projects.json', 'projects.geojson', 'sources.csv', 'images.csv', 'datapackage.json', 'README.md', 'CITATION.txt']) assert.ok(out.has(base + f), f)
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
