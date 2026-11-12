// The approved-researcher package (scripts/researcher-package.mjs, docs/RESEARCH_DATA.md "v2.0 researcher package") on
// the committed fixture dataset: every format is produced and readable (CSV parsed back, GeoJSON points, XLSX read by
// openpyxl when Python has it), the manifest's checksums match the files, the dictionary describes every column, text
// that would start a spreadsheet formula is neutralised, and the same input gives byte-identical files.
// The public package (scripts/research-package.mjs) has its own test (tests/research-package.test.mjs).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build, DICTIONARY, csvCell } from '../scripts/researcher-package.mjs'

const root = path.resolve(import.meta.dirname, '..')
const data = path.join(root, 'tests/fixtures/pipeline')
let dir, out, manifest
test.before(async () => { out = await mkdtemp(path.join(tmpdir(), 'aol-pkg-')); ({ dir, manifest } = await build({ data, out, version: '2.0.0' })) })
test.after(() => rm(out, { recursive: true, force: true }))

function parseCsv(text) {
  const rows = [[]]; let f = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++ } else if (c === '"') q = false; else f += c; continue }
    if (c === '"') q = true; else if (c === ',') { rows.at(-1).push(f); f = '' } else if (c === '\r') {} else if (c === '\n') { rows.at(-1).push(f); f = ''; rows.push([]) } else f += c
  }
  if (rows.at(-1).length === 0) rows.pop()
  return rows
}

test('four formats, a manifest with matching checksums, and the dictionary', async () => {
  assert.deepEqual(manifest.formats, ['csv', 'json', 'geojson', 'xlsx'])
  for (const [name, sha] of Object.entries(manifest.sha256)) assert.equal(createHash('sha256').update(await readFile(path.join(dir, name))).digest('hex'), sha, name)
  const json = JSON.parse(await readFile(path.join(dir, 'aol-research-2.0.0.json'), 'utf8'))
  assert.equal(json.records.length, manifest.record_count)
  assert.ok(manifest.record_count > 0)
  assert.deepEqual(json.columns, DICTIONARY.map((d) => d.name))
  for (const d of DICTIONARY) assert.ok(d.description_ko && ['string', 'number', 'integer', 'boolean', 'date'].includes(d.type) && d.origin, d.name)
  for (const r of json.records) assert.ok(['representative', 'artwork_below_bar', 'context_only', 'other_only', 'none'].includes(r.image_status), r.project_id)
  assert.ok(json.records.every((r) => (r.image_status === 'representative') === (r.image_missing_reason === null)))
  assert.match(manifest.catalog_sql, /^insert into public\.research_dataset_versions/)
  const md = await readFile(path.join(dir, 'data-dictionary.md'), 'utf8')
  for (const d of DICTIONARY) assert.ok(md.includes('`' + d.name + '`'), d.name)
})

test('CSV: UTF-8 with BOM, parses back to the same table; GeoJSON: one point per located record', async () => {
  const csv = await readFile(path.join(dir, 'aol-research-2.0.0.csv'), 'utf8')
  assert.ok(csv.startsWith('﻿'))
  const rows = parseCsv(csv.slice(1))
  const json = JSON.parse(await readFile(path.join(dir, 'aol-research-2.0.0.json'), 'utf8'))
  assert.equal(rows.length, json.records.length + 1)
  assert.deepEqual(rows[0], json.columns)
  assert.ok(rows.every((r) => r.length === json.columns.length))
  const idCol = json.columns.indexOf('project_id')
  assert.deepEqual(rows.slice(1).map((r) => r[idCol]), json.records.map((r) => r.project_id))
  const geo = JSON.parse(await readFile(path.join(dir, 'aol-research-2.0.0.geojson'), 'utf8'))
  assert.equal(geo.features.length, manifest.with_coordinates)
  for (const f of geo.features) { const [x, y] = f.geometry.coordinates; assert.ok(x >= -180 && x <= 180 && y >= -90 && y <= 90, f.id) }
})

test('CSV injection: text that would start a formula is quoted as text', () => {
  assert.equal(csvCell('=HYPERLINK("http://x")'), `"'=HYPERLINK(""http://x"")"`)
  assert.equal(csvCell('+1 555'), "'+1 555")
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)")
  assert.equal(csvCell(-12.5), '-12.5')
  assert.equal(csvCell(null), '')
})

test('XLSX: a valid workbook with the projects and the dictionary', async (t) => {
  try { execFileSync('python3', ['-I', '-c', 'import openpyxl'], { stdio: 'ignore' }) } catch { return t.skip('python3 with openpyxl is not available') }
  const r = JSON.parse(execFileSync('python3', ['-I', '-c', `import openpyxl,json,sys,warnings
warnings.simplefilter("ignore")
wb=openpyxl.load_workbook(sys.argv[1]);p=wb['projects'];d=wb['dictionary']
print(json.dumps({"sheets":wb.sheetnames,"rows":p.max_row,"cols":p.max_column,"head":[c.value for c in p[1]],"first":p.cell(2,1).value,"dict":d.max_row}))`, path.join(dir, 'aol-research-2.0.0.xlsx')], { encoding: 'utf8' }))
  const json = JSON.parse(await readFile(path.join(dir, 'aol-research-2.0.0.json'), 'utf8'))
  assert.deepEqual(r.sheets, ['projects', 'dictionary'])
  assert.equal(r.rows, json.records.length + 1)
  assert.equal(r.cols, json.columns.length)
  assert.deepEqual(r.head, json.columns)
  assert.equal(r.first, json.records[0].project_id)
  assert.equal(r.dict, DICTIONARY.length + 1)
})

test('the same input gives byte-identical files', async () => {
  const again = await mkdtemp(path.join(tmpdir(), 'aol-pkg2-'))
  try { assert.deepEqual((await build({ data, out: again, version: '2.0.0' })).manifest.sha256, manifest.sha256) } finally { await rm(again, { recursive: true, force: true }) }
})
