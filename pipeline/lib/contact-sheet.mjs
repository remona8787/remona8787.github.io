// Contact sheets for human (or Claude) visual verification: a JPEG grid of thumbnails, each labelled with ASCII ids
// drawn from a built-in 5×7 bitmap font (no system fonts needed on the runner), plus an index of what each tile is.
// v0.18: one set of sheets per kind (hero and featured candidates, cards) and provider, Korean projects first; each tile
// shows the image id, provider, the original's width×height, sharpness, blockiness, tier, visual score, the review
// state, and the project's name in ASCII (Korean names romanized).
import path from 'node:path'
import { loadSharp } from './visual.mjs'
import { writeFileAtomic } from './io.mjs'
import { fold } from './util.mjs'

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
// The v0.18 review sheets: larger tiles and five label lines.
export const REVIEW = { columns: 5, tileW: 320, tileH: 214, lines: 5, rows: 8 }

// The flat grey of a tile without a picture.
const GREY = 70
/** The picture area of tile i on a sheet (x, y, width, height in pixels): what a tile check reads back. */
export function tileBox(i, { columns = COLUMNS, tileW = TILE_W, tileH = TILE_H, lines = 2 } = {}) {
  const labelH = lines === 2 ? LABEL_H : lines * 17 + 4
  return { x: (i % columns) * tileW + 2, y: Math.floor(i / columns) * (tileH + labelH) + 2, width: tileW - 4, height: tileH - 4 }
}

/**
 * Pixels of tile i of a sheet JPEG read back: the share of the flat grey of a missing image and the spread of the
 * luminance. A composited picture has little grey and a spread; a missing one is grey with no spread.
 */
export async function tilePixels(jpg, i, opts) {
  const sharp = await loadSharp()
  const b = tileBox(i, opts)
  const { data } = await sharp(jpg).extract({ left: b.x + 4, top: b.y + 4, width: b.width - 8, height: b.height - 8 }).raw().toBuffer({ resolveWithObject: true })
  let grey = 0, sum = 0, sq = 0
  const n = data.length / 3
  for (let k = 0; k < data.length; k += 3) {
    if (Math.abs(data[k] - GREY) <= 8 && Math.abs(data[k + 1] - GREY) <= 8 && Math.abs(data[k + 2] - GREY) <= 8) grey++
    const l = (data[k] + data[k + 1] + data[k + 2]) / 3
    sum += l; sq += l * l
  }
  return { grey: Math.round((grey / n) * 1000) / 1000, stdev: Math.round(Math.sqrt(Math.max(0, sq / n - (sum / n) ** 2)) * 10) / 10 }
}
/** Whether a read-back tile shows a picture rather than the grey box. */
export const tileShowsPicture = (px) => px.grey < 0.5 && px.stdev > 4

/**
 * Builds one contact sheet. tiles: [{buffer|null, lines: string[]}]. Returns a JPEG buffer.
 * A tile without an image (download failed) is drawn as a grey box with its labels.
 */
export async function contactSheet(tiles, { columns = COLUMNS, quality = 70, tileW = TILE_W, tileH = TILE_H, lines: lineCount = 2 } = {}) {
  const sharp = await loadSharp()
  const labelH = lineCount === 2 ? LABEL_H : lineCount * 17 + 4
  const chars = Math.floor((tileW - 8) / 12)
  const rows = Math.max(1, Math.ceil(tiles.length / columns))
  const width = columns * tileW, cellH = tileH + labelH, height = rows * cellH
  const canvas = Buffer.alloc(width * height * 3, 18)
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i]
    const box = tileBox(i, { columns, tileW, tileH, lines: lineCount })
    const x0 = box.x - 2, y0 = box.y - 2
    let raw = null
    if (t.buffer) {
      try {
        raw = await sharp(t.buffer).rotate().resize(tileW - 4, tileH - 4, { fit: 'contain', background: { r: 18, g: 18, b: 18 } }).removeAlpha().toColourspace('srgb').raw().toBuffer()
      } catch { raw = null }
    }
    // Whether the tile shows the picture (the index's image_in_sheet): a buffer that does not decode is a grey tile.
    t.drawn = !!raw
    for (let y = 0; y < tileH - 4; y++) {
      for (let x = 0; x < tileW - 4; x++) {
        const o = ((y0 + 2 + y) * width + (x0 + 2 + x)) * 3
        if (raw) { const s = (y * (tileW - 4) + x) * 3; canvas[o] = raw[s]; canvas[o + 1] = raw[s + 1]; canvas[o + 2] = raw[s + 2] } else { canvas[o] = canvas[o + 1] = canvas[o + 2] = GREY }
      }
    }
    ;(t.lines || []).slice(0, lineCount).forEach((line, k) => drawText(canvas, width, x0 + 4, y0 + tileH + 2 + k * 17, String(line).slice(0, chars), { scale: 2, color: k === 0 ? [255, 230, 120] : k === lineCount - 1 ? [160, 220, 255] : [235, 235, 235] }))
  }
  return sharp(canvas, { raw: { width, height, channels: 3 } }).jpeg({ quality, mozjpeg: true }).toBuffer()
}

// ---------------------------------------------------------------- ASCII names

const RR_INITIAL = ['g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h']
const RR_MEDIAL = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i']
const RR_FINAL = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k', 'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't']
/** Hangul syllables in the Revised Romanization, syllable by syllable (no sound-change rules: a label, not a name). */
export function romanize(text) {
  let out = ''
  for (const ch of String(text || '')) {
    const c = ch.codePointAt(0) - 0xac00
    if (c >= 0 && c < 11172) out += RR_INITIAL[Math.floor(c / 588)] + RR_MEDIAL[Math.floor((c % 588) / 28)] + RR_FINAL[c % 28]
    else out += ch
  }
  return out
}
/** A project name in the characters the bitmap font draws. */
export function asciiName(name) {
  return fold(romanize(name)).replace(/[^a-z0-9 .:#+()/=_|?-]+/gi, ' ').replace(/\s+/g, ' ').trim().toUpperCase() || '?'
}

export const SHEET_ABOUT = 'Contact sheets per kind (hero: hero candidates and allowlisted images; featured: featured candidates; cards: the card of each project) and provider, Korean projects first. Tile lines: #n and image id; provider and the original width x height; S sharpness B blockiness T tier V visual, then OK (approved), R? (needs an approve_image after review) or H? (hero candidate, needs hero.json/set_hero); the project id; the project name in ASCII. index.json maps every tile to its project, image id, file or source URL.'

/**
 * Writes every sheet of the run and returns the index entries. Tiles: [{kind, provider, korean, project, name, id, key,
 * file, width, height, sharpness, blockiness, tier, visual, allowlisted, hero_candidate, awaiting_review, buffer, thumb}].
 * Tiles without an image buffer (measured in an earlier run) get one by fetch(url) when given (capped).
 */
export async function writeContactSheets(dir, tiles, { err = () => {}, fetchBytes = null, maxFetch = 300 } = {}) {
  const out = []
  let fetched = 0
  const per = REVIEW.columns * REVIEW.rows
  const kinds = ['hero', 'featured', 'cards']
  const sorted = [...tiles].sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind) || (b.korean ? 1 : 0) - (a.korean ? 1 : 0) || (a.project < b.project ? -1 : a.project > b.project ? 1 : 0) || (a.key < b.key ? -1 : 1))
  const groups = new Map()
  for (const t of sorted) { const g = t.kind === 'cards' ? 'cards' : `${t.kind}-${t.provider}`; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(t) }
  for (const [g, list] of groups) {
    for (let s = 0; s * per < list.length; s++) {
      const part = list.slice(s * per, (s + 1) * per)
      const name = `${g}-${String(s + 1).padStart(2, '0')}.jpg`
      for (const t of part) {
        if (t.buffer || !t.thumb || !fetchBytes || fetched >= maxFetch) continue
        try { t.buffer = (await fetchBytes(t.thumb)).bytes; fetched++ } catch (e) { if (e?.code === 'budget') break }
      }
      try {
        const drawn = part.map((t, i) => ({
          buffer: t.buffer,
          lines: [
            `#${s * per + i + 1} ${t.id}`,
            `${t.provider} ${t.width ?? '-'}X${t.height ?? '-'}`,
            `S${t.sharpness ?? '-'} B${t.blockiness ?? '-'} T${t.tier ?? '-'} V${t.visual ?? '-'} ${t.allowlisted ? 'OK' : t.awaiting_review ? 'R?' : t.hero_candidate ? 'H?' : ''}`.trim(),
            t.project,
            asciiName(t.name_ko || t.name),
          ],
        }))
        const opts = { columns: REVIEW.columns, tileW: REVIEW.tileW, tileH: REVIEW.tileH, lines: REVIEW.lines }
        const jpg = await contactSheet(drawn, opts)
        await writeFileAtomic(path.join(dir, name), jpg)
        // Read back from the written JPEG: the index says how many tiles really show a picture.
        let greyTiles = 0
        for (let i = 0; i < part.length; i++) if (!tileShowsPicture(await tilePixels(jpg, i, opts))) greyTiles++
        out.push({ sheet: name, kind: t0(part).kind, provider: t0(part).kind === 'cards' ? null : t0(part).provider, grey_tiles: greyTiles, tiles: part.map((t, i) => ({ n: s * per + i + 1, project: t.project, image: t.id, provider: t.provider, file: t.file || null, thumb: t.thumb || null, width: t.width ?? null, height: t.height ?? null, sharpness: t.sharpness ?? null, blockiness: t.blockiness ?? null, tier: t.tier ?? null, visual: t.visual ?? null, korean: !!t.korean, hero_candidate: !!t.hero_candidate, allowlisted: !!t.allowlisted, awaiting_review: !!t.awaiting_review, image_in_sheet: !!drawn[i].drawn })) })
      } catch (x) { err('contact_sheets', x, { sheet: name }) }
    }
  }
  return out
}
const t0 = (part) => part[0]
