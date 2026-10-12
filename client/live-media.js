// Browser-side live sync of place photos and info (Wikidata + Wikimedia Commons), every 6 hours.
// Works on a static host with no backend. Results are cached per browser; a failed refresh keeps the last result.
import { syncLive, SYNC_INTERVAL_MS, DEFAULT_POLICY } from '../edge-functions/_shared/live-media.mjs'

const KEY = 'aol_live_v1'
const cfg = window.AOL_CONFIG || {}
const policy = { ...DEFAULT_POLICY, krFopDisplay: cfg.MEDIA_KR_FOP_DISPLAY !== false }
let running = null

function read() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v?.version === 1 && Array.isArray(v.media) ? v : null } catch { return null }
}
function write(v) { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch {} }

async function fetchJSON(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw Error('HTTP ' + res.status)
  return res.json()
}

function apply(v, status) {
  window.AOL_LIVE = { media: v?.media || [], info: v?.info || {}, fetchedAt: v?.fetchedAt || null, status }
  window.AOLApp?.render?.()
}

export async function refresh(force = false) {
  const cached = read()
  const fresh = cached && Date.now() - Date.parse(cached.fetchedAt) < SYNC_INTERVAL_MS && cached.krFopDisplay === policy.krFopDisplay
  if (fresh && !force) return cached
  if (running) return running
  running = (async () => {
    try {
      const places = window.AOLApp?.places?.() || []
      if (!places.length) throw Error('no_places')
      const result = await syncLive({ places, fetchJSON, policy })
      const next = { version: 1, fetchedAt: new Date().toISOString(), krFopDisplay: policy.krFopDisplay, media: result.media, info: result.info, stats: { matched: result.stats.matched, images: result.stats.images } }
      write(next); apply(next, 'ok')
      return next
    } catch (e) {
      apply(cached, cached ? 'stale' : 'unavailable')
      return cached
    } finally { running = null }
  })()
  return running
}

if (cfg.MEDIA_LIVE_SYNC !== false) {
  const cached = read()
  if (cached) apply(cached, 'cached')
  refresh()
  // Long-lived tabs: re-check when the tab becomes visible and every 30 minutes; refresh() is a no-op until 6h pass.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh() })
  setInterval(refresh, 30 * 60 * 1000)
  window.AOLLive = { refresh }
}
