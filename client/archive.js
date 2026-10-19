// The published media facade archive (docs/ARCHIVE_SPEC.md §6): public.public_archive_projects, read with the
// publishable key when the Supabase backend is configured (SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY). Without a backend
// there is no archive list (status 'disabled'): the app shows the curated places and the Wikidata sync as before.
// The list is read in pages of 1000 (Range headers, at most 5000 projects), kept per browser for 6 hours, and a failed
// refresh keeps the last good list for at most 72 hours (the same rules as the server mode of client/global-places.js).
// What the archive publishes was collected automatically and reviewed by editors on the server; this file only reads.
import { ARCHIVE_VIEW, ARCHIVE_COLUMNS, ARCHIVE_PAGE, ARCHIVE_MAX_ROWS, fromArchiveRows } from './archive-rows.mjs'

const KEY = 'aol_archive_v1', STORE_VERSION = 1
export const ARCHIVE_INTERVAL_MS = 6 * 60 * 60 * 1000
const MAX_STALE_MS = 72 * 60 * 60 * 1000
// Shares the ~5 MB localStorage budget with the user's own records and the Wikidata cache: the rest stays in memory.
const MAX_STORE_CHARS = 1_500_000
const cfg = window.AOL_CONFIG || {}
const SERVER = cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY ? { base: String(cfg.SUPABASE_URL).replace(/\/+$/, '') + '/rest/v1/' + ARCHIVE_VIEW, key: String(cfg.SUPABASE_PUBLISHABLE_KEY) } : null
const publicURL = String(cfg.PUBLIC_URL || '')
let running = null, memory = null, storeDisabled = false
let life = new AbortController()
addEventListener('pagehide', () => life.abort())
addEventListener('pageshow', e => { if (e.persisted && life.signal.aborted) { life = new AbortController(); running = null; refresh() } })

const ageOf = v => Date.now() - Date.parse(v.fetchedAt)
const isFresh = v => !!v && !v.incomplete && ageOf(v) < ARCHIVE_INTERVAL_MS

function read() {
  if (memory) return memory
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!v) return null
    if (v.version !== STORE_VERSION || !Array.isArray(v.rows) || isNaN(Date.parse(v.fetchedAt)) || !(ageOf(v) < MAX_STALE_MS)) { localStorage.removeItem(KEY); return null }
    // A copy cut to fit stands in until the next refresh and is never fresh.
    v.incomplete = !!v.truncated
    memory = v
  } catch {}
  return memory
}
function expire() { memory = null; try { localStorage.removeItem(KEY) } catch {} return null }

// Saved, planned or recorded projects first (their records also keep a copy), then the rest in list order.
function usedIds() {
  const db = window.AOLApp?.getDB?.()
  if (!db) return new Set()
  return new Set([...(db.saved || []), ...(db.visits || []).map(v => v.placeId), ...(db.routes || []).flatMap(r => r.stops || [])])
}
function write(v) {
  memory = v
  if (storeDisabled) return
  const used = usedIds(), rows = [...v.rows].sort((a, b) => Number(used.has('AR-' + b.slug)) - Number(used.has('AR-' + a.slug)))
  let keep = rows, json = JSON.stringify(rows)
  if (json.length > MAX_STORE_CHARS) {
    keep = []; let n = 2
    for (const r of rows) { const s = JSON.stringify(r).length + 1; if (n + s > MAX_STORE_CHARS) break; keep.push(r); n += s }
  }
  v.truncated = keep.length < rows.length
  try { localStorage.setItem(KEY, JSON.stringify({ version: STORE_VERSION, fetchedAt: v.fetchedAt, truncated: v.truncated, rows: keep })) } catch { try { localStorage.removeItem(KEY) } catch {} }
}

// One page with the publishable key (no user session): rows and the total from Content-Range.
async function page(from, signal) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000), onAbort = () => controller.abort()
  if (signal.aborted) controller.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    const headers = { apikey: SERVER.key, Accept: 'application/json', 'Range-Unit': 'items', Range: `${from}-${from + ARCHIVE_PAGE - 1}`, Prefer: 'count=exact' }
    const res = await fetch(`${SERVER.base}?select=${ARCHIVE_COLUMNS}&order=slug.asc`, { headers, signal: controller.signal, credentials: 'omit' })
    // 416: the range starts past the end (the list shrank between two pages).
    if (res.status === 416) return [[], from]
    if (!res.ok) throw Error('HTTP ' + res.status)
    const rows = await res.json()
    if (!Array.isArray(rows)) throw Error('invalid_archive_payload')
    const total = /\/(\d+)\s*$/.exec(res.headers.get('content-range') || '')
    return [rows, total ? Number(total[1]) : null]
  } finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort) }
}

async function fromServer(signal) {
  const rows = []
  while (rows.length < ARCHIVE_MAX_ROWS) {
    const [list, total] = await page(rows.length, signal)
    rows.push(...list.slice(0, ARCHIVE_MAX_ROWS - rows.length))
    if (!list.length || list.length < ARCHIVE_PAGE || (total !== null && rows.length >= total)) break
  }
  return { version: STORE_VERSION, fetchedAt: new Date().toISOString(), rows }
}

function apply(v, status) {
  if (v && !v.mapped) v.mapped = fromArchiveRows(v.rows, { publicURL })
  const m = v?.mapped || { projects: [], media: [], updatedAt: null }
  window.AOL_ARCHIVE = { projects: m.projects, fetchedAt: v?.fetchedAt || null, updatedAt: m.updatedAt, status, truncated: !!v?.truncated }
  window.AOL_ARCHIVE_MEDIA = m.media
  const app = window.AOLApp
  ;(app?.softRender || app?.render)?.()
}

export async function refresh(force = false) {
  if (!SERVER) return null
  let cached = read()
  if (cached && !(ageOf(cached) < MAX_STALE_MS)) cached = expire()
  if (isFresh(cached) && !force) return cached
  if (running) return running
  const signal = life.signal
  const run = (async () => {
    if (!cached) apply(null, 'loading')
    try {
      const next = await fromServer(signal)
      if (signal.aborted) return cached
      write(next); apply(next, 'ok')
      return next
    } catch {
      if (signal.aborted) return cached
      apply(cached, cached ? 'stale' : 'unavailable')
      return cached
    } finally { if (running === run) running = null }
  })()
  running = run
  return run
}

// The app calls this when the user's own records no longer fit in localStorage.
export function dropCache() {
  storeDisabled = true
  try { if (localStorage.getItem(KEY) !== null) { localStorage.removeItem(KEY); return true } } catch {}
  return false
}

if (SERVER) {
  window.AOLArchive = { refresh, dropCache, configured: true }
  const cached = read()
  if (cached) apply(cached, 'cached')
  refresh()
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh() })
  setInterval(refresh, 30 * 60 * 1000)
} else {
  window.AOLArchive = { refresh: async () => null, dropCache, configured: false }
  window.AOL_ARCHIVE = { projects: [], fetchedAt: null, updatedAt: null, status: 'disabled', truncated: false }
  window.AOL_ARCHIVE_MEDIA = []
}
