// Browser-side nationwide (South Korea) and worldwide discovery of light places from Wikidata, every 6 hours.
// Works on a static host with no backend: results are cached per browser (compactly) and a failed refresh keeps
// the last good result. Photos are rights-checked lazily: only the Wikidata places currently on screen are checked
// against Commons (license, deletion and freedom-of-panorama tags), and nothing is shown before that check passes.
import { syncGlobal, compactPlaces, expandPlaces, carryOver, checkImages, curatedNameKeys, nameKey, GLOBAL_SYNC_INTERVAL_MS } from '../edge-functions/_shared/global-places.mjs'
import { DEFAULT_POLICY } from '../edge-functions/_shared/live-media.mjs'

const KEY = 'aol_global_v1', MEDIA_KEY = 'aol_global_media_v1'
// Stay well inside the ~5 MB localStorage budget the user's own records share; the rest stays in memory.
const MAX_STORE_CHARS = 1_000_000, MAX_MEDIA_ENTRIES = 400
const cfg = window.AOL_CONFIG || {}
const policy = { ...DEFAULT_POLICY, krFopDisplay: cfg.MEDIA_KR_FOP_DISPLAY !== false }
let running = null, memory = null, storeDisabled = false
// Closing or leaving the page stops the sync: no requests or re-renders from a page that is going away.
// A page restored from the back/forward cache starts again.
let life = new AbortController()
addEventListener('pagehide', () => life.abort())
addEventListener('pageshow', e => { if (e.persisted && life.signal.aborted) { life = new AbortController(); running = null; refresh() } })

function read() {
  if (memory) return memory
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (v?.version === 1 && Array.isArray(v.rows) && v.krFopDisplay === policy.krFopDisplay && !isNaN(Date.parse(v.fetchedAt))) memory = v
  } catch {}
  return memory
}

// Stores as many places as fit (they are sorted most-linked first); the full result always stays in memory.
function write(v) {
  memory = v
  const rows = compactPlaces(v.places)
  let rowsFit = rows, size = 0
  for (let i = 0; i < rows.length; i++) { size += JSON.stringify(rows[i]).length + 1; if (size > MAX_STORE_CHARS) { rowsFit = rows.slice(0, i); break } }
  v.truncated = rowsFit.length < rows.length
  if (storeDisabled) return
  const stored = { version: 1, fetchedAt: v.fetchedAt, krFopDisplay: policy.krFopDisplay, branches: v.branches, truncated: v.truncated, rows: rowsFit }
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

const placesOf = v => v ? (v.places || (v.places = expandPlaces(v.rows))) : []

function apply(v, status, attempt) {
  const places = placesOf(v)
  window.AOL_GLOBAL = { places, fetchedAt: v?.fetchedAt || null, status, branches: attempt || v?.branches || [], truncated: !!v?.truncated }
  indexImages()
  const app = window.AOLApp
  ;(app?.softRender || app?.render)?.()
}

export async function refresh(force = false) {
  const cached = read()
  const fresh = cached && Date.now() - Date.parse(cached.fetchedAt) < GLOBAL_SYNC_INTERVAL_MS
  if (fresh && !force) return cached
  if (running) return running
  const signal = life.signal
  const run = (async () => {
    if (!cached) apply(null, 'loading')
    try {
      const result = await syncGlobal({ fetchJSON, signal })
      if (signal.aborted) return cached
      const failed = result.branches.filter(b => !b.ok).map(b => b.id)
      // A branch that failed this time keeps its places from the last good result (stale-on-error per branch).
      const places = carryOver(placesOf(cached), result.places, failed)
      const next = { version: 1, fetchedAt: new Date().toISOString(), branches: result.branches, places }
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
// than 6 hours is re-checked as soon as its place is on screen; until then (or while offline) it is used for at most
// 24 hours, like the stale-on-error rule of the place list.
const MAX_VERDICT_AGE_MS = 4 * GLOBAL_SYNC_INTERVAL_MS
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
    if (v && Date.now() - v.at < GLOBAL_SYNC_INTERVAL_MS) continue
    if (inflight.has(it.image) || Date.now() - (failedAt.get(it.image) || 0) < 5 * 60 * 1000) continue
    if (!items.some(x => x.image === it.image)) items.push({ place_id: id, ...it })
  }
  wanted.clear()
  let changed = false
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50) // one Commons request per 50 files
    batch.forEach(x => inflight.add(x.image))
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

// A synced Korean place that is the same as a curated one (by name or host building) is hidden from discovery.
let keySig = '', keys = new Set()
export function curatedMatch(p) {
  if (p?.scope !== 'korea') return false
  const curated = window.AOLApp?.places?.() || []
  const sig = curated.length + ':' + curated.map(x => x.place_id).join(',').length
  if (sig !== keySig) { keySig = sig; keys = curatedNameKeys(curated) }
  return keys.has(nameKey(p.name_kr)) || (!!p.name_en && keys.has(nameKey(p.name_en)))
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
