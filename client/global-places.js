// Nationwide (South Korea) and worldwide discovery of light places from Wikidata, every 6 hours.
// With the Supabase backend configured (SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY) the list comes from the server, which
// runs the Wikidata queries and the photo rights checks once per 6 hours for everyone (Edge Function sync-global-places,
// view public_discovered_places): one REST request instead of a dozen Wikidata queries per browser. When the server has
// no rows or cannot be reached, the browser runs the same queries itself, exactly as on a static host with no backend.
// Results are cached per browser (compactly) and a failed refresh keeps the last good result for at most 72 hours.
// Photos are rights-checked lazily: only the Wikidata places currently on screen are checked (the server's verdict
// first, Commons otherwise: license, deletion and freedom-of-panorama tags), and nothing is shown before that check passes.
import { syncGlobal, packPlaces, expandPlaces, carryOver, checkImages, curatedIndex, isCuratedDuplicate, GLOBAL_SYNC_INTERVAL_MS } from '../edge-functions/_shared/global-places.mjs'
import { DEFAULT_POLICY } from '../edge-functions/_shared/live-media.mjs'
import { fromServerRows, verdictsFromServerRows, SERVER_VIEW, SERVER_COLUMNS, SERVER_MEDIA_COLUMNS } from '../edge-functions/_shared/global-places-server.mjs'

// Storage format 2: rows from packPlaces with a branch-id table (format 1 copies are discarded on first read).
const KEY = 'aol_global_v1', MEDIA_KEY = 'aol_global_media_v1', STORE_VERSION = 2
// Stay well inside the ~5 MB localStorage budget the user's own records share; the rest stays in memory.
const MAX_STORE_CHARS = 1_000_000, MAX_MEDIA_ENTRIES = 400
// A place list older than this is not shown any more, even when every refresh since has failed: it is dropped and the
// screen says the list is unavailable (the user's own saved, planned or recorded places are kept with their records).
const MAX_STALE_MS = 72 * 60 * 60 * 1000
const cfg = window.AOL_CONFIG || {}
const policy = { ...DEFAULT_POLICY, krFopDisplay: cfg.MEDIA_KR_FOP_DISPLAY !== false }
// The server's list (public_discovered_places), read with the publishable key only (no user session needed).
const SERVER = cfg.SUPABASE_URL && cfg.SUPABASE_PUBLISHABLE_KEY ? { base: String(cfg.SUPABASE_URL).replace(/\/+$/, '') + '/rest/v1/' + SERVER_VIEW, key: String(cfg.SUPABASE_PUBLISHABLE_KEY) } : null
// PostgREST returns at most "max rows" (1000 by default on Supabase) per request: larger lists take a few pages.
const SERVER_PAGE = 1000, SERVER_MAX_PAGES = 20
// The server syncs every 6 hours. A server copy is kept for 6 hours, but once the server's own data is 6 hours old a
// newer run is due, so the app asks again (at most every 30 minutes) instead of waiting out its full 6 hours.
const SERVER_RECHECK_MS = 30 * 60 * 1000
let running = null, memory = null, storeDisabled = false
// Closing or leaving the page stops the sync: no requests or re-renders from a page that is going away.
// A page restored from the back/forward cache starts again.
let life = new AbortController()
addEventListener('pagehide', () => life.abort())
addEventListener('pageshow', e => { if (e.persisted && life.signal.aborted) { life = new AbortController(); running = null; refresh() } })

const ageOf = v => Date.now() - Date.parse(v.fetchedAt)
// Fresh enough not to refresh. fetchedAt is the time of the data itself (the server's latest sync for a server copy);
// checkedAt is when this browser last asked the server.
function isFresh(v) {
  if (!v || v.incomplete) return false
  if (v.source !== 'server' || !SERVER) return ageOf(v) < GLOBAL_SYNC_INTERVAL_MS
  const checked = Date.now() - Date.parse(v.checkedAt)
  return checked < GLOBAL_SYNC_INTERVAL_MS && (ageOf(v) < GLOBAL_SYNC_INTERVAL_MS || checked < SERVER_RECHECK_MS)
}

function read() {
  if (memory) return memory
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!v) return null
    if (v.version !== STORE_VERSION || !Array.isArray(v.rows) || v.krFopDisplay !== policy.krFopDisplay || isNaN(Date.parse(v.fetchedAt)) || !(ageOf(v) < MAX_STALE_MS)) {
      localStorage.removeItem(KEY)
      return null
    }
    // A copy that had to be cut to fit is complete only in the tab that ran the sync: elsewhere it stands in until the
    // next sync, and it is never treated as fresh.
    v.incomplete = !!v.truncated
    memory = v
  } catch {}
  return memory
}

// The place list is too old to show (a long-lived tab whose refreshes kept failing): forget it everywhere.
function expire() {
  memory = null
  try { localStorage.removeItem(KEY) } catch {}
  return null
}

// Places the user has saved, planned or recorded: always stored first (their own records keep a copy as well).
function usedIds() {
  const db = window.AOLApp?.getDB?.()
  if (!db) return new Set()
  return new Set([...(db.saved || []), ...(db.visits || []).map(v => v.placeId), ...(db.routes || []).flatMap(r => r.stops || [])])
}

// Stores what fits (packPlaces: the user's places and every Korean place first, descriptions shortened before any
// place is dropped); the full result always stays in memory.
function write(v) {
  memory = v
  const packed = packPlaces(v.places, { maxChars: MAX_STORE_CHARS, keepIds: usedIds() })
  v.truncated = packed.truncated
  if (storeDisabled) return
  const stored = { version: STORE_VERSION, source: v.source || 'browser', fetchedAt: v.fetchedAt, checkedAt: v.checkedAt, krFopDisplay: policy.krFopDisplay, branches: v.branches, branchIds: packed.branchIds, truncated: packed.truncated, rows: packed.rows }
  // Quota exceeded or storage blocked: drop the old copy (never crowd out the user's own records) and keep memory.
  try { localStorage.setItem(KEY, JSON.stringify(stored)) } catch { try { localStorage.removeItem(KEY) } catch {} }
}

async function fetchJSON(url, init = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 65000), onAbort = () => controller.abort()
  if (init.signal?.aborted) controller.abort()
  init.signal?.addEventListener?.('abort', onAbort, { once: true })
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, credentials: 'omit' })
    if (!res.ok) throw Error('HTTP ' + res.status)
    return await res.json()
  } finally { clearTimeout(timer); init.signal?.removeEventListener?.('abort', onAbort) }
}

const placesOf = v => v ? (v.places || (v.places = expandPlaces(v.rows, v.branchIds))) : []

// GET from the server's view with the publishable key. Returns [rows, total|null] (total from Content-Range).
async function serverGet(query, signal, count = false) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000), onAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener?.('abort', onAbort, { once: true })
  try {
    const headers = { apikey: SERVER.key, Accept: 'application/json', ...(count ? { Prefer: 'count=exact' } : {}) }
    const res = await fetch(SERVER.base + '?' + query, { headers, signal: controller.signal, credentials: 'omit' })
    if (!res.ok) throw Error('HTTP ' + res.status)
    const rows = await res.json()
    if (!Array.isArray(rows)) throw Error('invalid_server_payload')
    const total = /\/(\d+)\s*$/.exec(res.headers.get('content-range') || '')
    return [rows, total ? Number(total[1]) : null]
  } finally { clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort) }
}

// The whole server list: one request unless it is longer than a page. null when the server has no rows yet.
async function fromServer(signal) {
  const rows = []
  for (let page = 0; page < SERVER_MAX_PAGES; page++) {
    const [list, total] = await serverGet(`select=${SERVER_COLUMNS}&order=qid.asc&limit=${SERVER_PAGE}&offset=${rows.length}`, signal, true)
    rows.push(...list)
    if (!list.length || (total !== null ? rows.length >= total : list.length < SERVER_PAGE)) break
  }
  const { places, verdicts: found, fetchedAt } = fromServerRows(rows, { policy })
  if (!places.length || !fetchedAt) return null
  useServerVerdicts(found)
  return { version: STORE_VERSION, source: 'server', fetchedAt, checkedAt: new Date().toISOString(), branches: [], places }
}

function apply(v, status, attempt) {
  const places = placesOf(v)
  window.AOL_GLOBAL = { places, fetchedAt: v?.fetchedAt || null, status, branches: attempt || v?.branches || [], truncated: !!v?.truncated }
  indexImages()
  const app = window.AOLApp
  ;(app?.softRender || app?.render)?.()
}

export async function refresh(force = false) {
  let cached = read()
  if (cached && !(ageOf(cached) < MAX_STALE_MS)) cached = expire()
  if (isFresh(cached) && !force) return cached
  if (running) return running
  const signal = life.signal
  const run = (async () => {
    if (!cached) apply(null, 'loading')
    if (SERVER) {
      // The server's list first; without rows (sync not installed yet) or on any error, the browser syncs itself.
      try {
        const next = await fromServer(signal)
        if (signal.aborted) return cached
        if (next) {
          write(next); apply(next, ageOf(next) < GLOBAL_SYNC_INTERVAL_MS + SERVER_RECHECK_MS ? 'ok' : 'stale')
          return next
        }
      } catch { if (signal.aborted) return cached }
    }
    try {
      const result = await syncGlobal({ fetchJSON, signal })
      if (signal.aborted) return cached
      const failed = result.branches.filter(b => !b.ok).map(b => b.id)
      // A branch that failed this time keeps its places from the last good result (stale-on-error per branch).
      const places = carryOver(placesOf(cached), result.places, failed)
      const next = { version: STORE_VERSION, source: 'browser', fetchedAt: new Date().toISOString(), branches: result.branches, places }
      write(next); apply(next, failed.length ? 'partial' : 'ok')
      return next
    } catch (e) {
      if (signal.aborted) return cached
      apply(cached, cached ? 'stale' : 'unavailable', e?.branches)
      return cached
    } finally { if (running === run) running = null }
  })()
  running = run
  return run
}

// The app calls this when the user's own records no longer fit in localStorage: these caches give way (for the rest
// of this page's life the sync keeps its results in memory only). Returns true when something was freed.
export function dropCache() {
  storeDisabled = true
  let freed = false
  for (const k of [KEY, MEDIA_KEY]) try { if (localStorage.getItem(k) !== null) { localStorage.removeItem(k); freed = true } } catch {}
  return freed
}

// ---- lazy image rights checks -------------------------------------------------------------------------------
const verdicts = new Map() // file → {at, ok, reasons, row}
const inflight = new Set(), failedAt = new Map(), imageOf = new Map(), wanted = new Set()
let flushTimer = null

function loadVerdicts() {
  try {
    const v = JSON.parse(localStorage.getItem(MEDIA_KEY) || 'null')
    if (v?.version !== 1 || v.krFopDisplay !== policy.krFopDisplay || typeof v.files !== 'object') return
    for (const [file, x] of Object.entries(v.files)) if (x && typeof x.at === 'number' && (!x.ok || x.row)) verdicts.set(file, x)
  } catch {}
}
function saveVerdicts() {
  if (storeDisabled) return
  const keep = [...verdicts].filter(([, x]) => Date.now() - x.at < MAX_VERDICT_AGE_MS).sort((a, b) => b[1].at - a[1].at).slice(0, MAX_MEDIA_ENTRIES)
  try { localStorage.setItem(MEDIA_KEY, JSON.stringify({ version: 1, krFopDisplay: policy.krFopDisplay, files: Object.fromEntries(keep) })) } catch {}
}

// Cleared files become media rows with the same shape (and attribution) as the live photo sync. A verdict older
// than 6 hours is re-checked as soon as its place is on screen; until that succeeds (e.g. while offline) it is used
// for at most 24 hours, after which the photo counts as unchecked and is not shown. (The place list has its own,
// longer limit: MAX_STALE_MS, 72 hours.) A verdict from the server (src 'server') is not re-checked by the browser
// while it is valid: the server re-checks every photo within 24 hours and the next list brings the new verdicts.
const MAX_VERDICT_AGE_MS = 4 * GLOBAL_SYNC_INTERVAL_MS
const recheckAfter = v => v.src === 'server' ? MAX_VERDICT_AGE_MS : GLOBAL_SYNC_INTERVAL_MS

// Verdicts made by the server (made under the app's own KR FoP policy, see verdictsFromServerRows). A newer verdict
// this browser made itself is kept.
function useServerVerdicts(list) {
  let changed = false
  for (const v of list) {
    if (!(Date.now() - v.at < MAX_VERDICT_AGE_MS)) continue
    const prev = verdicts.get(v.file)
    if (prev && prev.at >= v.at) continue
    verdicts.set(v.file, { at: v.at, ok: v.ok, reasons: v.reasons, row: v.ok ? v.row : null, src: 'server' })
    changed = true
  }
  if (changed) saveVerdicts()
  return changed
}
function rebuildMedia() {
  const rows = []
  for (const [placeId, it] of imageOf) {
    const v = verdicts.get(it.image)
    if (v?.ok && v.row && Date.now() - v.at < MAX_VERDICT_AGE_MS) rows.push({ ...v.row, place_code: placeId, wikidata: it.wikidata })
  }
  window.AOL_GLOBAL_MEDIA = rows
}
function indexImages() {
  for (const p of window.AOL_GLOBAL?.places || []) if (p.image) imageOf.set(p.place_id, { image: p.image, wikidata: p.wikidata })
  rebuildMedia()
}

async function flush() {
  flushTimer = null
  const signal = life.signal
  if (signal.aborted) return
  const items = []
  for (const id of wanted) {
    const it = imageOf.get(id)
    if (!it) continue
    const v = verdicts.get(it.image)
    if (v && Date.now() - v.at < recheckAfter(v)) continue
    if (inflight.has(it.image) || Date.now() - (failedAt.get(it.image) || 0) < 5 * 60 * 1000) continue
    if (!items.some(x => x.image === it.image)) items.push({ place_id: id, ...it })
  }
  wanted.clear()
  let changed = false
  for (let i = 0; i < items.length; i += 50) {
    let batch = items.slice(i, i + 50) // one Commons request per 50 files
    batch.forEach(x => inflight.add(x.image))
    if (SERVER && memory?.source === 'server') {
      // The server has usually checked these already (e.g. its verdicts did not all fit in this browser's storage).
      try {
        const qids = [...new Set(batch.map(x => x.wikidata).filter(q => /^Q\d+$/.test(q || '')))]
        const [rows] = qids.length ? await serverGet(`select=${SERVER_MEDIA_COLUMNS}&qid=in.(${qids.join(',')})`, signal) : [[]]
        if (!signal.aborted && useServerVerdicts(verdictsFromServerRows(rows, { policy }))) changed = true
      } catch {}
      if (signal.aborted) { batch.forEach(x => inflight.delete(x.image)); return }
      const done = batch.filter(x => { const v = verdicts.get(x.image); return v && Date.now() - v.at < recheckAfter(v) })
      done.forEach(x => inflight.delete(x.image))
      batch = batch.filter(x => !done.includes(x))
      if (!batch.length) continue
    }
    try {
      const result = await checkImages(batch, { fetchJSON: (url, init = {}) => fetchJSON(url, { ...init, signal }), policy })
      if (signal.aborted) return
      for (const [file, v] of result) {
        const { place_code, wikidata, ...row } = v.row || {}
        verdicts.set(file, { at: Date.now(), ok: v.ok, reasons: v.reasons, row: v.ok ? row : null })
      }
      changed = true
    } catch { if (!signal.aborted) batch.forEach(x => failedAt.set(x.image, Date.now())) } finally { batch.forEach(x => inflight.delete(x.image)) }
  }
  if (!changed) return
  saveVerdicts(); rebuildMedia()
  const app = window.AOLApp
  ;(app?.refreshMedia || app?.render)?.()
}

// What the app may say about a place's photo: 'cleared', 'blocked' (with the reasons) or 'pending' (not checked yet).
export function imageStatus(placeId) {
  const it = imageOf.get(placeId)
  if (!it) return null
  const v = verdicts.get(it.image)
  if (!v || Date.now() - v.at >= MAX_VERDICT_AGE_MS) return { state: 'pending', reasons: [] }
  return { state: v.ok ? 'cleared' : 'blocked', reasons: v.reasons || [] }
}

// The app calls this after each render with the WD- places on screen.
export function wantImages(placeIds) {
  for (const id of placeIds || []) {
    if (!/^WD-Q\d+$/.test(id)) continue
    if (!imageOf.has(id)) {
      // Saved places can be outside the current sync result (offline, expired, removed from Wikidata).
      const p = window.AOLApp?.lookup?.(id)
      if (p?.image && /^Q\d+$/.test(p.wikidata || '')) { imageOf.set(id, { image: p.image, wikidata: p.wikidata }); rebuildMedia() }
    }
    if (imageOf.has(id)) wanted.add(id)
  }
  if (wanted.size && !flushTimer) flushTimer = setTimeout(flush, 60)
}

// A synced place that is the same as a curated one (same QID, or for Korean places the same name or host building)
// is hidden from discovery. The app passes its curated list; the index is rebuilt only when that list changes.
let lastCurated = null, curated = curatedIndex([])
export function curatedMatch(p, list = window.AOLApp?.places?.() || []) {
  if (list !== lastCurated) { lastCurated = list; curated = curatedIndex(list) }
  return isCuratedDuplicate(p, curated)
}

loadVerdicts()
if (cfg.PLACE_GLOBAL_SYNC !== false) {
  window.AOLGlobal = { refresh, wantImages, curatedMatch, dropCache, imageStatus }
  const cached = read()
  if (cached) apply(cached, 'cached')
  refresh()
  // Long-lived tabs: re-check when the tab becomes visible and every 30 minutes; refresh() is a no-op until 6h pass.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh() })
  setInterval(refresh, 30 * 60 * 1000)
} else {
  window.AOLGlobal = { refresh: async () => null, wantImages, curatedMatch, dropCache, imageStatus }
  window.AOL_GLOBAL = { places: [], fetchedAt: null, status: 'disabled', branches: [] }
  window.AOL_GLOBAL_MEDIA = []
}
