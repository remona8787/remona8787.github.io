// The static archive dataset (docs/STATIC_ARCHIVE.md "Output"): sharded JSON that the GitHub Actions pipeline
// publishes at /data/ next to the site. It is read in pieces, only when a screen needs them:
//   home            → data/home.json (about 30 pre-picked projects; never the index or a shard)
//   explore, map,
//   the Korean and
//   world sections,
//   research data   → data/index.json (compact rows of every project, for list, search and map)
//   a project page  → data/projects/<shard>.json (full records), found through home.json, the pipeline's shard rule
//                     (manifest + one shard) or, failing those, the index
// The service worker (sw.js) keeps what was read (stale-while-revalidate, one cache per build_id).
// When /data/ does not exist (local development, previews, hosts without the pipeline) the app works as before:
// curated places plus the browser's own Wikidata sync (client/global-places.js, client/live-media.js wait for this).
// Publishes window.AOL_DATASET (projects, photos, home picks, status) and window.AOLDataset (the loader).
import { fromHome, fromIndex, fromShard, cardMedia, shardFor } from './dataset-rows.mjs'

const cfg = window.AOL_CONFIG || {}
const publicURL = String(cfg.PUBLIC_URL || '')
const base = new URL('data/', document.baseURI)
const TIMEOUT_MS = 20000
let events = null, eventsRun = null, runStatus = null, runStatusRun = null
// Ids merged into another project (index.json moved), filled with the index.
let moved = new Map()
const ID_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,156}$/
let buildId = null, home = null, indexState = 'idle', indexRun = null, manifest = null, manifestRun = null, indexRetryAt = 0
/** @type {Map<string, any>} compact places by app id (home cards, index rows) */
const compact = new Map()
/** @type {Map<string, any>} full records by app id ({place, media, videos}) */
const full = new Map()
/** @type {Map<string, Promise<any>>} shard loads in flight or done */
const shards = new Map()
/** @type {Map<string, any>} card photos by app id */
const cards = new Map()

async function get(path) {
  const url = new URL(path, base)
  if (buildId && !path.endsWith('manifest.json') && !path.endsWith('home.json')) url.searchParams.set('v', buildId)
  // A file of another build than the one this page started from (a cache or CDN that still has the old one) is asked
  // once more past the HTTP cache; a second mismatch is an error rather than a mix of two builds.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(TIMEOUT_MS), ...(attempt ? { cache: 'reload' } : {}) })
    if (!res.ok) { const e = Error('HTTP ' + res.status); e.status = res.status; throw e }
    const type = res.headers.get('content-type') || ''
    // A host that answers every path with its HTML 404 or app page has no dataset.
    if (type && !/json/i.test(type)) { const e = Error('not_json'); e.status = 404; throw e }
    const json = await res.json()
    if (!buildId || !json?.build_id || json.build_id === buildId || path === 'home.json') return json
    if (attempt) throw Error('dataset_version_mismatch')
  }
}

let version = 0
function publish(status) {
  const projects = [...compact.values()].map(p => { const f = full.get(p.place_id); return f ? { ...p, ...f.place, thumb: p.thumb, card_tier: p.card_tier } : p })
  for (const [id, f] of full) if (!compact.has(id)) projects.push(f.place)
  const media = []
  for (const p of projects) {
    const f = full.get(p.place_id)
    if (f?.media.length) media.push(...f.media)
    else { const c = cards.get(p.place_id); if (c) media.push(c) }
  }
  window.AOL_DATASET = { status, buildId, generatedAt: manifest?.generated_at || home?.generated_at || null, home, projects, media, index: indexState, count: projects.length, version: ++version, events, runStatus }
  window.AOL_DATASET_MEDIA = media
  const app = window.AOLApp
  ;(app?.softRender || app?.render)?.()
}

function addCompact(list, mediaRows = []) {
  for (const p of list) {
    const old = compact.get(p.place_id)
    compact.set(p.place_id, old ? { ...old, ...p, thumb: p.thumb || old.thumb, card_tier: p.card_tier ?? old.card_tier, shard: p.shard || old.shard } : p)
  }
  for (const m of mediaRows) if (!cards.has(m.place_code) || (cards.get(m.place_code).credit_pending && !m.credit_pending)) cards.set(m.place_code, m)
}

let status = 'probing'
let homeStatusFile = false
async function loadHome() {
  const json = await get('home.json')
  // A home.json that names status.json (v0.26) says the collector writes it; an older one is never asked for it.
  homeStatusFile = json?.status_file === 'status.json'
  home = fromHome(json, { publicURL })
  buildId = home.build_id || buildId
  addCompact(home.places, home.media)
}

/** The index of every project (explore, map, research data, similar projects). */
export function ensureIndex() {
  if (status !== 'ok') return Promise.resolve(false)
  if (indexRun) return indexRun
  // After a failed read the index is not asked again for 15 s (each render would otherwise ask at once).
  if (Date.now() < indexRetryAt) return Promise.resolve(false)
  indexState = 'loading'
  indexRun = (async () => {
    try {
      const json = await get('index.json')
      const list = fromIndex(json, { publicURL })
      // Ids merged into another project (pipeline output moved): an old link is sent on to the project.
      moved = json && typeof json.moved === 'object' && !Array.isArray(json.moved) ? new Map(Object.entries(json.moved).filter(([a, b]) => ID_OK.test(a) && ID_OK.test(String(b)))) : new Map()
      addCompact(list, list.map(p => cardMedia(p, null)).filter(Boolean))
      indexState = 'ok'
    } catch { indexState = 'error'; indexRun = null; indexRetryAt = Date.now() + 15000 }
    publish(status)
    return indexState === 'ok'
  })()
  // Published only once the run is stored: publishing renders the screen, and a screen that asks for the index again
  // (a curated place page asks for its archive record, which asks for the index) must get this run, not start a new
  // one (that recursion never ended).
  publish(status)
  return indexRun
}

function loadShard(name) {
  if (!shards.has(name)) shards.set(name, (async () => {
    try {
      const map = fromShard(await get(`projects/${encodeURIComponent(name)}.json`), { publicURL })
      for (const [id, x] of map) full.set(id, x)
      publish(status)
      return true
    } catch { shards.delete(name); return false }
  })())
  return shards.get(name)
}

// The pipeline's shard of an id (pipeline/lib/output.mjs shardOf): FNV-1a of its UTF-8 bytes modulo the number of
// shards the manifest lists. A link straight to a project page reads the small manifest and that one shard instead of
// the whole index; when the record is not there (another shard rule), the index says where it is.
function getManifest() {
  if (manifest) return Promise.resolve(manifest)
  if (!manifestRun) manifestRun = get('manifest.json').then(m => { manifest = m && typeof m === 'object' && m.files ? m : null; return manifest }, () => { manifestRun = null; return null })
  return manifestRun
}

/** A project page: its full record (photos, videos, sources, visit facts), then the index for similar projects. */
export async function ensureRecord(placeId) {
  if (status !== 'ok' || typeof placeId !== 'string') return false
  const id = /^AR-/.test(placeId) ? placeId : 'AR-' + placeId
  if (full.has(id)) { ensureIndex(); return true }
  let p = compact.get(id)
  if (!p?.shard && indexState !== 'ok') {
    const m = await getManifest(), guess = m && shardFor(id.slice(3), m.files.shards)
    if (guess && await loadShard(guess) && full.has(id)) { ensureIndex(); return true }
  }
  if (!p?.shard) { await ensureIndex(); p = compact.get(id) }
  if (!p?.shard) return false
  const ok = await loadShard(p.shard)
  ensureIndex()
  return ok && full.has(id)
}

// Events (v0.26, events.json: festival and exhibition series with dated editions) and the collector's status
// (status.json: when it last checked its sources and when the data last changed). Both are read only by the screens
// that show them; a missing file leaves them null and the screens say nothing about them.
export function ensureEvents() {
  if (status !== 'ok') return Promise.resolve(false)
  // Only when the manifest names events.json (a dataset before v0.26 has none, and is never asked for it).
  if (!eventsRun) eventsRun = getManifest().then(m => m?.files?.events === 'events.json' ? get('events.json') : null)
    .then(j => { events = j && Array.isArray(j.series) ? j : { series: [], none: true }; publish(status); return Array.isArray(j?.series) }, () => { events = null; publish(status); return false })
  return eventsRun
}
export function ensureRunStatus() {
  if (status !== 'ok') return Promise.resolve(false)
  if (!runStatusRun) runStatusRun = fetch(new URL('status.json', base), { credentials: 'omit', cache: 'no-cache', signal: AbortSignal.timeout(TIMEOUT_MS) })
    .then(r => r.ok && /json/i.test(r.headers.get('content-type') || 'json') ? r.json() : null)
    .then(j => { runStatus = j && j.schema === 1 ? j : null; publish(status); return !!runStatus }, () => { runStatus = null; return false })
  return runStatusRun
}

export const record = placeId => full.get(placeId) || null
export const videos = placeId => full.get(placeId)?.videos || []
export const loading = placeId => { const p = compact.get(placeId); return !!p?.shard && shards.has(p.shard) && !full.has(placeId) }

// What the screen at the current address needs.
function need() {
  if (status !== 'ok') return
  let page = 'home', id = ''
  // A search address carries its filters after "?" (site-public-cleared/search-state.js): "#explore?q=…".
  try { [page = 'home', id = ''] = decodeURIComponent((location.hash.slice(1) || 'home').split('?')[0]).split('/') } catch {}
  if (page === 'calendar') ensureEvents()
  if (page === 'home' && home && homeStatusFile) ensureRunStatus()
  // The data page shows the collection status (v1.0.1): the same file, asked for only when home.json names it.
  if (page === 'data') (home ? Promise.resolve() : loadHome().then(() => publish(status))).then(() => { if (homeStatusFile) ensureRunStatus() }, () => {})
  if (page === 'home' && !home) loadHome().then(() => { publish(status); if (homeStatusFile) ensureRunStatus() }, () => {})
  else if (['explore', 'map', 'data', 'korea', 'programs', 'world'].includes(page)) ensureIndex()
  else if (page === 'place' && id) ensureRecord(id)
}

// Probe: the file the first screen needs anyway (home.json on the home page, the small manifest elsewhere).
const first = (() => { try { return (decodeURIComponent(location.hash.slice(1).split('?')[0]).split('/')[0] || 'home') === 'home' } catch { return true } })()
export const ready = (async () => {
  try {
    if (first) await loadHome()
    else { const m = await get('manifest.json'); if (!m || typeof m !== 'object' || !m.files) throw Error('invalid_manifest'); manifest = m; buildId = typeof m.build_id === 'string' && m.build_id.length <= 80 ? m.build_id : null }
    status = 'ok'
  } catch { status = 'missing' }
  publish(status)
  if (status === 'ok') need()
  return status === 'ok'
})()

/** The project an old, merged id now belongs to (or null). @param {string} id */
const movedTo = (id) => moved.get(String(id || '').replace(/^AR-/, '')) || null
window.AOLDataset = { ready, ensureIndex, movedTo, ensureRecord, ensureEvents, ensureRunStatus, record, videos, loading, get status() { return status } }
window.AOL_DATASET = { status: 'probing', buildId: null, home: null, projects: [], media: [], index: 'idle', count: 0, version: 0 }
window.AOL_DATASET_MEDIA = []
addEventListener('hashchange', need)
