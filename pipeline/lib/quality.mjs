// Image quality from one downloaded rendition of about 1024 px (docs/STATIC_ARCHIVE.md v0.18 "Image rules"), with sharp:
//  - decoded: the decoded file's own width, height and format (verifies what the provider API said about the rendition);
//  - sharpness: the variance of the 4-neighbour Laplacian of the luma, measured at 1024 px wide (a smaller rendition at
//    its own size), normalised to 0–100 on a log scale (laplacian_var keeps the raw value);
//  - blockiness: JPEG 8×8 block-edge energy, on the file as decoded (no resampling, so the codec's grid stays where it
//    was): the mean luma step across block boundaries against the mean step inside blocks, horizontally and vertically;
//    0 is no blocking, 100 strong blocking;
//  - phash: a 64-bit difference hash (dHash) of a 9×8 luma rendition, for near-duplicates (Hamming distance);
//  - visual: the night/media metrics of lib/visual.mjs on a 320 px rendition of the same file (one download).
import { loadSharp, metricsFromRaw, visualScore } from './visual.mjs'
import { clamp, round } from './util.mjs'

export const QUALITY_WIDTH = 1024
const LAPLACIAN_REF = 1500

/** Variance of the 4-neighbour Laplacian of a single-channel image. */
export function laplacianVariance(gray, width, height) {
  if (width < 3 || height < 3) return 0
  let sum = 0, sum2 = 0, n = 0
  for (let y = 1; y < height - 1; y++) {
    const row = y * width
    for (let x = 1; x < width - 1; x++) {
      const i = row + x
      const v = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i]
      sum += v; sum2 += v * v; n++
    }
  }
  const mean = sum / n
  return Math.max(0, sum2 / n - mean * mean)
}

export const sharpnessScore = (variance) => Math.round(100 * clamp(Math.log1p(variance) / Math.log1p(LAPLACIAN_REF)))

/**
 * Blocking artefacts of an 8×8 block codec: the ratio of the mean absolute luma step across block boundaries to the
 * mean step elsewhere, horizontally and vertically, as 0–100 ((ratio − 1) × 100, clamped). Smooth or flat images give
 * about 0; heavily compressed JPEGs 10–60.
 */
export function blockiness(gray, width, height) {
  if (width < 32 || height < 32) return 0
  let hb = 0, hn = 0, hbN = 0, hnN = 0, vb = 0, vn = 0, vbN = 0, vnN = 0
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width - 1; x++) {
      const d = Math.abs(gray[row + x + 1] - gray[row + x])
      if (x % 8 === 7) { hb += d; hbN++ } else { hn += d; hnN++ }
    }
  }
  for (let y = 0; y < height - 1; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      const d = Math.abs(gray[row + width + x] - gray[row + x])
      if (y % 8 === 7) { vb += d; vbN++ } else { vn += d; vnN++ }
    }
  }
  const ratio = (b, bn, n, nn) => (bn > 0 && nn > 0 ? (b / bn) / Math.max(0.5, n / nn) : 1)
  const r = (ratio(hb, hbN, hn, hnN) + ratio(vb, vbN, vn, vnN)) / 2
  return Math.round(100 * clamp(r - 1))
}

/** 64-bit difference hash (16 hex digits) of a 9×8 luma image. */
export function dhash(gray9x8) {
  let bits = ''
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray9x8[y * 9 + x] < gray9x8[y * 9 + x + 1] ? '1' : '0'
  let hex = ''
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16)
  return hex
}

/** Hamming distance of two hex hashes (Infinity when one is missing). */
export function hamming(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity
  let d = 0
  for (let i = 0; i < a.length; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1 } }
  return d
}

/** The quality score (0–100): sharpness and the original's resolution, less a penalty for visible blocking. */
export function qualityScore({ sharpness, blockiness: block }, originalWidth, { targetWidth = 2400 } = {}) {
  const resolution = 100 * clamp((originalWidth || 0) / targetWidth)
  return Math.round(clamp((0.6 * sharpness + 0.4 * resolution - Math.max(0, block - 5) * 2) / 100) * 100)
}

/**
 * Every measurement of one rendition. Returns {decoded: {width, height, format, bytes}, sharpness, laplacian_var,
 * measured_width, blockiness, phash, visual: {...metrics, visual}}.
 * @param {Buffer} buffer
 */
export async function measureQuality(buffer, { width = QUALITY_WIDTH, visualWidth = 320 } = {}) {
  const sharp = await loadSharp()
  const meta = await sharp(buffer, { failOn: 'error' }).metadata()
  const decoded = { width: meta.width ?? null, height: meta.height ?? null, format: meta.format ?? null, bytes: buffer.length }
  // Blockiness on the file as decoded (no rotation, no resampling); at most the central 1024×1024 at a multiple of 8.
  const g = await sharp(buffer, { failOn: 'error' }).greyscale().raw().toBuffer({ resolveWithObject: true })
  let gw = g.info.width, gh = g.info.height, gray = g.data
  if (g.info.channels !== 1) { const c = g.info.channels, out = Buffer.alloc(gw * gh); for (let i = 0; i < gw * gh; i++) out[i] = g.data[i * c]; gray = out }
  const cw = Math.min(gw, 1024), ch = Math.min(gh, 1024)
  const x0 = Math.floor((gw - cw) / 16) * 8, y0 = Math.floor((gh - ch) / 16) * 8
  let crop = gray
  if (cw !== gw || ch !== gh) { crop = Buffer.alloc(cw * ch); for (let y = 0; y < ch; y++) gray.copy(crop, y * cw, (y0 + y) * gw + x0, (y0 + y) * gw + x0 + cw) }
  const block = meta.format === 'jpeg' ? blockiness(crop, cw, ch) : 0
  // Sharpness at a fixed width (never enlarged).
  const s = await sharp(buffer, { failOn: 'error' }).rotate().resize({ width, withoutEnlargement: true }).greyscale().raw().toBuffer({ resolveWithObject: true })
  const lv = laplacianVariance(s.info.channels === 1 ? s.data : s.data.filter((_, i) => i % s.info.channels === 0), s.info.width, s.info.height)
  const h = await sharp(buffer, { failOn: 'error' }).rotate().resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer()
  const v = await sharp(buffer, { failOn: 'error' }).rotate().resize({ width: visualWidth }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  const m = metricsFromRaw(v.data, { width: v.info.width, height: v.info.height, channels: v.info.channels })
  return {
    decoded, measured_width: s.info.width, laplacian_var: round(lv, 1), sharpness: sharpnessScore(lv), blockiness: block, phash: dhash(h),
    visual: { ...m, visual: visualScore(m) },
  }
}
