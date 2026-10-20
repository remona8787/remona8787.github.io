// Small helpers shared by the pipeline stages: deterministic JSON, hashing, geometry, time and text.
import { createHash } from 'node:crypto'
import { fold } from '../../edge-functions/_shared/archive/text.mjs'
import { normalizedName } from '../../edge-functions/_shared/archive/dedupe.mjs'

export { fold, normalizedName }

export const QID_RE = /^Q[1-9]\d*$/
export const PID_RE = /^P[1-9]\d*$/
export const isQid = (v) => typeof v === 'string' && QID_RE.test(v)

/** JSON with object keys sorted (stable output, so an unchanged run writes byte-identical files). */
export function stableStringify(value, indent = 0) {
  const seen = new WeakSet()
  const norm = (v) => {
    if (v === undefined) return undefined
    if (v === null || typeof v !== 'object') return typeof v === 'number' && !Number.isFinite(v) ? null : v
    if (seen.has(v)) throw Error('circular structure')
    seen.add(v)
    let out
    if (Array.isArray(v)) out = v.map((x) => { const n = norm(x); return n === undefined ? null : n })
    else {
      out = {}
      for (const k of Object.keys(v).sort()) { const n = norm(v[k]); if (n !== undefined) out[k] = n }
    }
    seen.delete(v)
    return out
  }
  return JSON.stringify(norm(value), null, indent)
}

export const sha256 = (text) => createHash('sha256').update(text).digest('hex')
export const md5 = (text) => createHash('md5').update(text).digest('hex')

/** 32-bit FNV-1a (shard assignment: stable across runtimes and runs). */
export function fnv1a(text) {
  let h = 0x811c9dc5
  for (const b of new TextEncoder().encode(String(text))) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}

export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))
export const round = (x, digits = 0) => { const f = 10 ** digits; return Math.round(x * f) / f }

/** Great-circle distance in metres. */
export function haversine(a, b) {
  const R = 6371008.8, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lng - a.lng) * rad
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

export const validLat = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 90
export const validLng = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 180

/** "Category:Foo_bar" / "foo bar" → "Category:Foo bar" (MediaWiki title normalisation, first letter upper case). */
export function categoryTitle(name) {
  let t = String(name || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().replace(/^category:/i, '')
  if (!t) return null
  t = t[0].toUpperCase() + t.slice(1)
  return 'Category:' + t
}
export function fileTitle(name) {
  let t = String(name || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(file|image):/i, '')
  if (!t) return null
  return 'File:' + t[0].toUpperCase() + t.slice(1)
}
export const bareFile = (t) => String(t || '').replace(/^(file|image):/i, '').replace(/_/g, ' ').trim()
export const commonsPage = (title) => 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(String(title).replace(/ /g, '_')).replace(/%3A/gi, ':').replace(/%2F/gi, '/')
export const wikidataPage = (qid) => 'https://www.wikidata.org/wiki/' + qid

/** ISO timestamp → compact build id part "20261019T121700Z". */
export const compactTime = (iso) => String(iso).replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

export function chunk(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export const uniq = (list) => [...new Set(list.filter((x) => x !== null && x !== undefined && x !== ''))]

/** Strip HTML (search snippets, extmetadata) to text. */
export function stripTags(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim()
}

export const clip = (value, max) => {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim()
  if (!s) return null
  const chars = [...s]
  return chars.length <= max ? s : chars.slice(0, max - 1).join('').trimEnd() + '…'
}

/** Slug for editor-created ids: ASCII letters, digits and dashes. */
export function slugify(text) {
  const s = fold(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return s || 'x' + fnv1a(text).toString(36)
}

export const byKey = (key) => (a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0)
export const compareStrings = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
