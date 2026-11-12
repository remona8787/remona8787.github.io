// v2.0 Edge Function logic that runs in Node too: photo checks (edge-functions/_shared/platform/image-check.mjs) on
// real JPEG/PNG/WebP files made with sharp (EXIF with GPS, PNG text chunks, trailing bytes, wrong types, sizes), and
// submission checks (submissions.mjs): duplicates against the committed fixture index and the link policy.
// The Deno handlers themselves (moderate-queue, publish-photo, research-download, delete-account) are not run here.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import zlib from 'node:zlib'
import path from 'node:path'
import { checkImage, hasExif, sniff } from '../edge-functions/_shared/platform/image-check.mjs'
import { duplicates, urlPolicy, normName } from '../edge-functions/_shared/platform/submissions.mjs'

const root = path.resolve(import.meta.dirname, '..')
let sharp = null
try { sharp = createRequire(path.join(root, 'pipeline/package.json'))('sharp') } catch {}
const needSharp = { skip: sharp ? false : 'sharp is not installed (npm ci --prefix pipeline)' }
const img = (w, h, fmt, meta) => { let s = sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 30, b: 160 } } }); if (meta) s = s.withExif(meta); return s[fmt]().toBuffer() }

test('JPEG: EXIF with GPS is removed, the picture is kept, trailing bytes are cut', needSharp, async () => {
  const withGps = await img(1600, 900, 'jpeg', { IFD0: { Copyright: 'someone', ImageDescription: 'home address' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '37/1 33/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '127/1 0/1 0/1' } })
  assert.ok(hasExif(new Uint8Array(withGps)), 'the test file carries EXIF')
  const payload = Buffer.from('<?php system($_GET["c"]); ?>')
  const r = checkImage(Buffer.concat([withGps, payload]), { claimedMime: 'image/jpeg' })
  assert.equal(r.ok, true, r.error)
  assert.equal(hasExif(r.bytes), false)
  assert.ok(r.removed.includes('APP1'))
  assert.ok(r.removed.some((x) => x.startsWith('trailing:')))
  assert.ok(!Buffer.from(r.bytes).includes('home address') && !Buffer.from(r.bytes).includes('<?php'))
  const meta = await sharp(Buffer.from(r.bytes)).metadata()
  assert.deepEqual([meta.format, meta.width, meta.height, meta.exif], ['jpeg', 1600, 900, undefined], 'still a valid JPEG of the same size, without EXIF')
})

test('PNG: text chunks and trailing data removed; WebP metadata refused', needSharp, async () => {
  const png = await img(800, 600, 'png')
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0); return Buffer.concat([len, body, crc]) }
  const iend = png.length - 12
  const tagged = Buffer.concat([png.subarray(0, iend), chunk('tEXt', Buffer.from('Comment\0secret location')), png.subarray(iend), Buffer.from('junk')])
  const r = checkImage(tagged)
  assert.equal(r.ok, true, r.error)
  assert.deepEqual(r.removed, ['tEXt', 'trailing:4'])
  assert.ok(!Buffer.from(r.bytes).includes('secret location'))
  assert.equal((await sharp(Buffer.from(r.bytes)).metadata()).width, 800)
  const webp = await img(900, 600, 'webp')
  assert.equal(checkImage(webp).ok, true)
  const webpExif = await img(900, 600, 'webp', { IFD0: { Copyright: 'x' } })
  assert.equal(checkImage(webpExif).error, 'webp_metadata_reencode_first')
})

test('types, sizes and dimensions', needSharp, async () => {
  assert.equal(checkImage(Buffer.from('GIF89a......')).error, 'not_an_allowed_image')
  assert.equal(checkImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')).error, 'not_an_allowed_image')
  assert.equal(checkImage(Buffer.from('%PDF-1.7 ...')).error, 'not_an_allowed_image')
  const jpg = await img(1200, 800, 'jpeg')
  assert.equal(checkImage(jpg, { claimedMime: 'image/png' }).error, 'type_mismatch', 'the browser\'s claim must match the bytes')
  assert.equal(checkImage(await img(500, 300, 'jpeg')).error, 'too_small')
  assert.equal(checkImage(jpg, { limits: { maxBytes: 1000, minWidth: 600, minHeight: 400, maxSide: 12000 } }).error, 'too_large')
  assert.equal(checkImage(jpg.subarray(0, 400)).ok, false, 'a truncated file is refused')
  assert.equal(sniff(new Uint8Array(jpg)), 'image/jpeg')
})

test('duplicates: a resubmitted archive project is found; a new one is not', async () => {
  const index = JSON.parse(await readFile(path.join(root, 'tests/fixtures/pipeline/site-data/index.json'), 'utf8'))
  const f = Object.fromEntries(index.fields.map((k, i) => [k, i]))
  const row = index.rows.find((r) => r[f.name_ko] && r[f.country_iso2] === 'KR') || index.rows[0]
  const name = row[f.name_ko] || row[f.name_en]
  const same = duplicates({ name, country_iso2: row[f.country_iso2], city: row[f.city_ko] || row[f.city] }, index)
  assert.equal(same[0]?.id, row[f.id], `"${name}" is found as ${row[f.id]}`)
  const spaced = duplicates({ name: name.split('').join(' ').replace(/\s+/g, ' '), country_iso2: row[f.country_iso2] }, index)
  assert.ok(spaced.length === 0 || spaced[0].id === row[f.id])
  assert.deepEqual(duplicates({ name: '완전히 새로운 가상의 프로젝트 이름 XYZ', country_iso2: 'KR' }, index), [])
  assert.deepEqual(duplicates({}, index), [])
  assert.equal(normName('  DDP / 서울라이트 (2026) '), 'ddp 서울라이트 2026')
})

test('link policy: only public http(s) hosts, no credentials, no odd ports', () => {
  assert.equal(urlPolicy('https://www.example.org/work').ok, true)
  for (const [u, why] of [['javascript:alert(1)', 'scheme'], ['ftp://example.org/x', 'scheme'], ['http://localhost:8080/admin', 'private_host'], ['http://192.168.0.10/', 'private_host'], ['http://10.1.2.3/', 'private_host'], ['http://169.254.169.254/latest/meta-data', 'private_host'], ['https://user:pass@example.org/', 'credentials_in_url'], ['https://example.org:2375/', 'port'], ['not a url', 'malformed']])
    assert.equal(urlPolicy(u).reason, why, u)
  assert.equal(urlPolicy('https://xn--80ak6aa92e.example/').note, 'punycode_host')
})
