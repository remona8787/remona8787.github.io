// Member photo checks (v2.0, docs/PLATFORM.md "Photos"). Pure byte-level work on a Uint8Array, no decoding library:
//  * the file type comes from its signature, not its name or the browser's claim (JPEG, PNG, WebP only);
//  * size and pixel-dimension limits;
//  * metadata removal: JPEG APP1..APP15 segments (EXIF incl. GPS, XMP, ICC moved out) and comments; PNG text and eXIf
//    chunks; anything after the JPEG end-of-image marker or the PNG IEND chunk (where polyglot payloads hide);
//  * WebP with EXIF or XMP chunks is refused (the site re-encodes uploads to JPEG before sending them).
// What this does not do: decode the image, detect harmful image content, or scan for malware beyond the structure
// checks above. Every member photo is looked at by a person before it is published.

export const LIMITS = { maxBytes: 8 * 1024 * 1024, minWidth: 600, minHeight: 400, maxSide: 12000 }

export function sniff(b) {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp'
  return null
}

const u16 = (b, i) => (b[i] << 8) | b[i + 1]
const u32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]
const le32 = (b, i) => b[i] + (b[i + 1] << 8) + (b[i + 2] << 16) + ((b[i + 3] << 24) >>> 0)
const le24 = (b, i) => b[i] + (b[i + 1] << 8) + (b[i + 2] << 16)

function cleanJpeg(b) {
  const out = [b.subarray(0, 2)]
  let i = 2, width = 0, height = 0, removed = []
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw new Error('jpeg_structure')
    const m = b[i + 1]
    if (m === 0xd9) { out.push(b.subarray(i, i + 2)); i += 2; break }
    if (m === 0xda) {
      // Start of scan: copy the entropy-coded data up to the end-of-image marker (skipping stuffed bytes and restarts).
      const len = u16(b, i + 2)
      let j = i + 2 + len
      while (j + 1 < b.length && !(b[j] === 0xff && b[j + 1] === 0xd9)) j++
      if (j + 1 >= b.length) throw new Error('jpeg_truncated')
      out.push(b.subarray(i, j + 2)); i = j + 2
      break
    }
    if (m >= 0xd0 && m <= 0xd7) { out.push(b.subarray(i, i + 2)); i += 2; continue }
    const len = u16(b, i + 2)
    if (len < 2 || i + 2 + len > b.length) throw new Error('jpeg_structure')
    const seg = b.subarray(i, i + 2 + len)
    if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { height = u16(b, i + 5); width = u16(b, i + 7) }
    if ((m >= 0xe1 && m <= 0xef) || m === 0xfe) removed.push(m === 0xfe ? 'COM' : 'APP' + (m - 0xe0))
    else out.push(seg)
    i += 2 + len
  }
  const trailing = b.length - i
  if (trailing > 0) removed.push(`trailing:${trailing}`)
  return { bytes: concat(out), width, height, removed }
}

const DROP_PNG = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'])
function cleanPng(b) {
  const out = [b.subarray(0, 8)]
  let i = 8, width = 0, height = 0, removed = [], ended = false
  while (i + 12 <= b.length) {
    const len = u32(b, i), type = String.fromCharCode(...b.subarray(i + 4, i + 8))
    if (i + 12 + len > b.length) throw new Error('png_structure')
    if (type === 'IHDR') { width = u32(b, i + 8); height = u32(b, i + 12) }
    if (DROP_PNG.has(type)) removed.push(type)
    else out.push(b.subarray(i, i + 12 + len))
    i += 12 + len
    if (type === 'IEND') { ended = true; break }
  }
  if (!ended) throw new Error('png_truncated')
  if (b.length > i) removed.push(`trailing:${b.length - i}`)
  return { bytes: concat(out), width, height, removed }
}

function checkWebp(b) {
  let i = 12, width = 0, height = 0
  while (i + 8 <= b.length) {
    const type = String.fromCharCode(...b.subarray(i, i + 4)), len = le32(b, i + 4)
    if (type === 'EXIF' || type === 'XMP ') throw new Error('webp_metadata_reencode_first')
    if (type === 'VP8X') { width = le24(b, i + 12) + 1; height = le24(b, i + 15) + 1 }
    if (type === 'VP8 ' && !width) { width = (b[i + 14] | (b[i + 15] << 8)) & 0x3fff; height = (b[i + 16] | (b[i + 17] << 8)) & 0x3fff }
    if (type === 'VP8L' && !width) { const v = le32(b, i + 9); width = (v & 0x3fff) + 1; height = ((v >>> 14) & 0x3fff) + 1 }
    i += 8 + len + (len % 2)
  }
  return { bytes: b, width, height, removed: [] }
}

function concat(parts) {
  const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

/** Checks and cleans an upload. Returns {ok, mime, bytes, width, height, removed} or {ok:false, error}. */
export function checkImage(input, { claimedMime = null, limits = LIMITS } = {}) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (!b.length) return { ok: false, error: 'empty' }
  if (b.length > limits.maxBytes) return { ok: false, error: 'too_large' }
  const mime = sniff(b)
  if (!mime) return { ok: false, error: 'not_an_allowed_image' }
  if (claimedMime && claimedMime !== mime) return { ok: false, error: 'type_mismatch' }
  let r
  try { r = mime === 'image/jpeg' ? cleanJpeg(b) : mime === 'image/png' ? cleanPng(b) : checkWebp(b) } catch (e) { return { ok: false, error: String(e.message || e) } }
  if (!r.width || !r.height) return { ok: false, error: 'no_dimensions' }
  if (r.width < limits.minWidth || r.height < limits.minHeight) return { ok: false, error: 'too_small' }
  if (r.width > limits.maxSide || r.height > limits.maxSide) return { ok: false, error: 'too_big_dimensions' }
  return { ok: true, mime, bytes: r.bytes, width: r.width, height: r.height, removed: r.removed }
}

/** True when JPEG bytes still carry an EXIF block (used by tests and the publish function as a last check). */
export function hasExif(b) {
  for (let i = 2; i + 10 < b.length; ) {
    if (b[i] !== 0xff) return false
    const m = b[i + 1]
    if (m === 0xda || m === 0xd9) return false
    const len = u16(b, i + 2)
    if (m === 0xe1 && String.fromCharCode(...b.subarray(i + 4, i + 8)) === 'Exif') return true
    i += 2 + len
  }
  return false
}
