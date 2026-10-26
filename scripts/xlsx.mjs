// A minimal XLSX (Office Open XML SpreadsheetML) writer for the research dataset: one worksheet per table, text as
// inline strings (never formulas, so nothing a spreadsheet would run), numbers and booleans typed, the header row bold
// and frozen. The zip is deterministic (fixed file order and timestamps), so the same tables give the same bytes.
// No dependencies: zlib's raw deflate and a CRC-32 table.
//
// xlsx([{name, fields: [[key, type, ...]], rows: [{key: value}]}]) → Buffer
import { deflateRawSync } from 'node:zlib'

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
const crc32 = (/** @type {Buffer} */ b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

/** A zip of the given files (name → Buffer), deflated, with the DOS time 1980-01-01 00:00 on every entry. */
function zip(/** @type {[string, Buffer][]} */ files) {
  const local = [], central = []
  let offset = 0
  for (const [name, data] of files) {
    const fname = Buffer.from(name, 'utf8'), body = deflateRawSync(data, { level: 9 }), crc = crc32(data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8)
    head.writeUInt16LE(0, 10); head.writeUInt16LE(0x21, 12); head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18)
    head.writeUInt32LE(data.length, 22); head.writeUInt16LE(fname.length, 26); head.writeUInt16LE(0, 28)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10)
    dir.writeUInt16LE(0, 12); dir.writeUInt16LE(0x21, 14); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(body.length, 20); dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(fname.length, 28); dir.writeUInt32LE(offset, 42)
    local.push(head, fname, body); central.push(dir, fname)
    offset += head.length + fname.length + body.length
  }
  const size = central.reduce((n, b) => n + b.length, 0), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, ...central, end])
}

// XML text: escaped, without the control characters XML 1.0 forbids, at most the 32,767 characters an Excel cell holds.
const xml = (/** @type {any} */ v) => String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').slice(0, 32767)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const col = (/** @type {number} */ i) => { let s = ''; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
function cell(/** @type {string} */ ref, /** @type {any} */ v, /** @type {string} */ type, /** @type {boolean} */ head) {
  const s = head ? ' s="1"' : ''
  if (v == null || v === '') return ''
  if (!head && (type === 'number' || type === 'integer') && typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`
  if (!head && type === 'boolean' && typeof v === 'boolean') return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`
}
function sheet(/** @type {readonly (readonly string[])[]} */ fields, /** @type {Record<string, any>[]} */ rows) {
  const line = (/** @type {number} */ r, /** @type {string[]} */ cells) => `<row r="${r}">${cells.join('')}</row>`
  const body = [line(1, fields.map(([k], i) => cell(col(i) + 1, k, 'string', true))), ...rows.map((row, j) => line(j + 2, fields.map(([k, t], i) => cell(col(i) + (j + 2), row[k], t, false))))]
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<sheetData>${body.join('')}</sheetData></worksheet>`
}

/**
 * @param {{name: string, fields: readonly (readonly string[])[], rows: Record<string, any>[]}[]} sheets
 * @returns {Buffer}
 */
export function xlsx(sheets) {
  if (!sheets.length) throw Error('xlsx: no sheets')
  const names = sheets.map((s) => s.name)
  if (names.some((n) => !/^[A-Za-z0-9_ -]{1,31}$/.test(n)) || new Set(names).size !== names.length) throw Error('xlsx: sheet names must be unique, 1–31 plain characters')
  const NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  const files = /** @type {[string, Buffer][]} */ ([
    ['[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>'],
    ['_rels/.rels', X + `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', X + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS}"><sheets>` +
      sheets.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', X + `<Relationships xmlns="${PKG}">` + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${sheets.length + 1}" Type="${NS}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', X + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
    ...sheets.map((s, i) => /** @type {[string, string]} */ ([`xl/worksheets/sheet${i + 1}.xml`, sheet(s.fields, s.rows)])),
  ].map(([n, body]) => [n, Buffer.from(body, 'utf8')]))
  return zip(files)
}
