// Visual evidence of active media in a photo, computed from a 320 px thumbnail with sharp:
//  - mean luminance (Rec. 709 luma of the sRGB values, 0..1);
//  - colourfulness (Hasler & Süsstrunk 2003: σ_rgyb + 0.3·μ_rgyb on rg = R − G, yb = (R + G)/2 − B, 0..~150);
//  - the share of saturated bright pixels (HSV saturation ≥ 0.5 and value ≥ 0.6) — emissive coloured light;
//  - the share of dark pixels (luma < 0.2).
// A dark frame with saturated bright regions suggests a lit media facade, projection or light work. Darkness
// alone never qualifies: without saturated bright pixels the score is 0, and a bright (daytime) frame scores 0.
import { clamp, round } from './util.mjs'

let sharpModule = null
async function sharp() {
  if (!sharpModule) {
    try { sharpModule = (await import('sharp')).default } catch (e) {
      throw Error('sharp is not installed: run "npm ci" in pipeline/ (' + String(e?.message || e).slice(0, 120) + ')')
    }
  }
  return sharpModule
}
export const loadSharp = sharp

/** Metrics of raw interleaved RGB(A) pixels. */
export function metricsFromRaw(data, { width, height, channels }) {
  const n = width * height
  if (!n || data.length < n * channels) throw Error('raw buffer too small')
  let sumY = 0, sumRg = 0, sumYb = 0, sumRg2 = 0, sumYb2 = 0, satBright = 0, dark = 0, bright = 0
  for (let i = 0; i < n; i++) {
    const o = i * channels
    const r = data[o], g = data[o + 1], b = data[o + 2]
    const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    sumY += y
    const rg = r - g, yb = 0.5 * (r + g) - b
    sumRg += rg; sumYb += yb; sumRg2 += rg * rg; sumYb2 += yb * yb
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const s = max === 0 ? 0 : (max - min) / max, v = max / 255
    if (s >= 0.5 && v >= 0.6) satBright++
    if (y < 0.2) dark++
    if (y > 0.7) bright++
  }
  const mRg = sumRg / n, mYb = sumYb / n
  const sdRg = Math.sqrt(Math.max(0, sumRg2 / n - mRg * mRg)), sdYb = Math.sqrt(Math.max(0, sumYb2 / n - mYb * mYb))
  const colourfulness = Math.sqrt(sdRg ** 2 + sdYb ** 2) + 0.3 * Math.sqrt(mRg ** 2 + mYb ** 2)
  return {
    width, height,
    mean_luminance: round(sumY / n, 4),
    colourfulness: round(colourfulness, 2),
    saturated_bright: round(satBright / n, 4),
    dark_share: round(dark / n, 4),
    bright_share: round(bright / n, 4),
  }
}

/** 0..100: night frame × (emissive saturated light, colourfulness). Zero for darkness alone and for bright frames. */
export function visualScore(m) {
  if (!m) return null
  if (m.saturated_bright < 0.01) return 0
  const night = clamp((0.45 - m.mean_luminance) / 0.3)
  const emissive = clamp(m.saturated_bright / 0.1)
  const colour = clamp(m.colourfulness / 70)
  return Math.round(100 * night * (0.55 * emissive + 0.45 * colour))
}

/** Decodes an image (any format sharp reads), resizes it to `width` px wide and measures it. */
export async function measureImage(buffer, width = 320) {
  const s = await sharp()
  const { data, info } = await s(buffer, { failOn: 'error' }).rotate().resize({ width, withoutEnlargement: false }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  const m = metricsFromRaw(data, { width: info.width, height: info.height, channels: info.channels })
  return { ...m, visual: visualScore(m) }
}
