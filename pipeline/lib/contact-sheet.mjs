// Contact sheets for human (or Claude) visual verification: a JPEG grid of thumbnails, each labelled with ASCII ids
// drawn from a built-in 5×7 bitmap font (no system fonts needed on the runner), plus an index of what each tile is.
import { loadSharp } from './visual.mjs'

// 5×7 glyphs, one 5-bit row per entry (MSB = leftmost pixel).
const G = {
  '0': [14, 17, 19, 21, 25, 17, 14], '1': [4, 12, 4, 4, 4, 4, 14], '2': [14, 17, 1, 2, 4, 8, 31], '3': [31, 2, 4, 2, 1, 17, 14],
  '4': [2, 6, 10, 18, 31, 2, 2], '5': [31, 16, 30, 1, 1, 17, 14], '6': [6, 8, 16, 30, 17, 17, 14], '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14], '9': [14, 17, 17, 15, 1, 2, 12],
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14], D: [28, 18, 17, 17, 17, 18, 28],
  E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16], G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 17, 25, 21, 19, 17, 17], O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17], S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 21, 10], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 17, 10, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  '-': [0, 0, 0, 31, 0, 0, 0], _: [0, 0, 0, 0, 0, 0, 31], '.': [0, 0, 0, 0, 0, 12, 12], ':': [0, 12, 12, 0, 12, 12, 0],
  '#': [10, 10, 31, 10, 31, 10, 10], '?': [14, 17, 1, 2, 4, 0, 4], '|': [4, 4, 4, 4, 4, 4, 4], '+': [0, 4, 4, 31, 4, 4, 0], '(': [2, 4, 8, 8, 8, 4, 2], ')': [8, 4, 2, 2, 2, 4, 8], '/': [1, 2, 2, 4, 8, 8, 16], '=': [0, 0, 31, 0, 31, 0, 0], ' ': [0, 0, 0, 0, 0, 0, 0],
}
const UNKNOWN = [31, 17, 21, 21, 21, 17, 31]

/** Draws ASCII text into an RGB raw buffer. Unknown characters become a box. */
export function drawText(buf, bufWidth, x0, y0, text, { scale = 2, color = [255, 255, 255] } = {}) {
  let x = x0
  for (const ch of String(text).toUpperCase()) {
    const rows = G[ch] || UNKNOWN
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (!((rows[r] >> (4 - c)) & 1)) continue
        for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
          const px = x + c * scale + dx, py = y0 + r * scale + dy
          if (px < 0 || py < 0 || px >= bufWidth) continue
          const o = (py * bufWidth + px) * 3
          if (o + 2 >= buf.length) continue
          buf[o] = color[0]; buf[o + 1] = color[1]; buf[o + 2] = color[2]
        }
      }
    }
    x += 6 * scale
  }
  return x
}

export const TILE_W = 220, TILE_H = 165, LABEL_H = 36, COLUMNS = 6

/**
 * Builds one contact sheet. tiles: [{buffer|null, lines: [string, string]}]. Returns a JPEG buffer.
 * A tile without an image (download failed) is drawn as a grey box with its labels.
 */
export async function contactSheet(tiles, { columns = COLUMNS, quality = 70 } = {}) {
  const sharp = await loadSharp()
  const rows = Math.max(1, Math.ceil(tiles.length / columns))
  const width = columns * TILE_W, cellH = TILE_H + LABEL_H, height = rows * cellH
  const canvas = Buffer.alloc(width * height * 3, 18)
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]
    const x0 = (i % columns) * TILE_W, y0 = Math.floor(i / columns) * cellH
    let raw = null
    if (t.buffer) {
      try {
        raw = await sharp(t.buffer).rotate().resize(TILE_W - 4, TILE_H - 4, { fit: 'contain', background: { r: 18, g: 18, b: 18 } }).removeAlpha().toColourspace('srgb').raw().toBuffer()
      } catch { raw = null }
    }
    for (let y = 0; y < TILE_H - 4; y++) {
      for (let x = 0; x < TILE_W - 4; x++) {
        const o = ((y0 + 2 + y) * width + (x0 + 2 + x)) * 3
        if (raw) { const s = (y * (TILE_W - 4) + x) * 3; canvas[o] = raw[s]; canvas[o + 1] = raw[s + 1]; canvas[o + 2] = raw[s + 2] } else { canvas[o] = canvas[o + 1] = canvas[o + 2] = 70 }
      }
    }
    const lines = (t.lines || []).slice(0, 2)
    lines.forEach((line, k) => drawText(canvas, width, x0 + 4, y0 + TILE_H + 2 + k * 17, String(line).slice(0, 17), { scale: 2, color: k === 0 ? [255, 230, 120] : [235, 235, 235] }))
  }
  return sharp(canvas, { raw: { width, height, channels: 3 } }).jpeg({ quality, mozjpeg: true }).toBuffer()
}
