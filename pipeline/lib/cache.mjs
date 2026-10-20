// Response and entity caches kept in state/cache/<namespace>.json on the data branch, so a run asks the sources only
// for what is new or expired. Every entry has its own time-to-live (with a deterministic ±20 % spread per key, so
// entries cached in the same run do not all expire in the same later run) and, when the server sent one, an ETag
// for a conditional request after it expires.
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fnv1a, stableStringify } from './util.mjs'
import { writeFileAtomic } from './io.mjs'

export const HOUR = 3600e3
export const DAY = 24 * HOUR

export class Cache {
  /** @param {{dir?: string|null, clock?: () => number, keepExpiredFor?: number}} [o] */
  constructor({ dir = null, clock = Date.now, keepExpiredFor = 30 * DAY } = {}) {
    this.dir = dir
    this.clock = clock
    this.keepExpiredFor = keepExpiredFor
    /** @type {Map<string, Record<string, {at: number, ttl: number, etag?: string|null, v: any}>>} */
    this.spaces = new Map()
    this.dirty = new Set()
    this.stats = { hits: 0, misses: 0, stale: 0, writes: 0 }
  }

  space(ns) {
    if (!/^[a-z0-9-]+$/.test(ns)) throw Error('bad cache namespace ' + ns)
    let s = this.spaces.get(ns)
    if (s) return s
    s = {}
    if (this.dir) {
      const file = path.join(this.dir, ns + '.json')
      if (existsSync(file)) {
        try {
          const json = JSON.parse(readFileSync(file, 'utf8'))
          if (json && json.schema === 1 && json.entries && typeof json.entries === 'object') s = json.entries
        } catch { s = {} }
      }
    }
    this.spaces.set(ns, s)
    return s
  }

  /** The raw entry (fresh or not). */
  entry(ns, key) { return this.space(ns)[key] || null }

  /** The value when it has not expired, else undefined. */
  fresh(ns, key) {
    const e = this.entry(ns, key)
    if (e && this.clock() - e.at < e.ttl) { this.stats.hits++; return e.v }
    if (e) this.stats.stale++
    else this.stats.misses++
    return undefined
  }

  /** The value even when it has expired (stale-on-error), else undefined. */
  any(ns, key) { const e = this.entry(ns, key); return e ? e.v : undefined }

  set(ns, key, value, { ttlMs = DAY, etag = null } = {}) {
    const spread = 0.8 + 0.4 * ((fnv1a(ns + '|' + key) % 1000) / 1000)
    this.space(ns)[key] = { at: this.clock(), ttl: Math.round(ttlMs * spread), ...(etag ? { etag } : {}), v: value }
    this.dirty.add(ns)
    this.stats.writes++
  }

  /** Extends an expired entry after a 304 Not Modified. */
  touch(ns, key) {
    const e = this.entry(ns, key)
    if (!e) return
    e.at = this.clock()
    this.dirty.add(ns)
  }

  delete(ns, key) { const s = this.space(ns); if (key in s) { delete s[key]; this.dirty.add(ns) } }

  /** Removes entries that expired more than keepExpiredFor ago (they are no use even as stale fallbacks). */
  prune() {
    const now = this.clock()
    for (const [ns, s] of this.spaces) {
      for (const [k, e] of Object.entries(s)) if (now - e.at > e.ttl + this.keepExpiredFor) { delete s[k]; this.dirty.add(ns) }
    }
  }

  async save() {
    if (!this.dir) return []
    this.prune()
    const written = []
    for (const ns of [...this.dirty].sort()) {
      const file = path.join(this.dir, ns + '.json')
      await writeFileAtomic(file, stableStringify({ schema: 1, ns, entries: this.spaces.get(ns) || {} }))
      written.push(file)
    }
    this.dirty.clear()
    return written
  }

  sizes() {
    const out = {}
    for (const [ns, s] of this.spaces) out[ns] = Object.keys(s).length
    return out
  }
}
