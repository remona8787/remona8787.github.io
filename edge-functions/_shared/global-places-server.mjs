// Server-side nationwide/worldwide place sync (Edge Function sync-global-places, every 6 hours) and the app's reader
// for its result (public.public_discovered_places, see supabase/migrations/20261013000000_discovered_places.sql).
// The same branch queries and rights checks as the browser sync (global-places.mjs, live-media.mjs) run ONCE per run
// on the server; every visitor then reads the result with one REST request instead of querying Wikidata itself.
// Pure ESM with injected fetch and storage: runs unchanged in Deno, browsers and Node tests.

import { syncGlobal, compactPlaces, expandPlaces, checkImages, GLOBAL_SYNC_INTERVAL_MS } from './global-places.mjs'
import { DEFAULT_POLICY } from './live-media.mjs'

/** @typedef {import('./global-places.mjs').GlobalPlace} GlobalPlace */
/** @typedef {import('./global-places.mjs').BranchResult} BranchResult */
/** @typedef {(url: string, init?: RequestInit) => Promise<any>} FetchJSON */
/**
 * @typedef {object} ServerRow  one row for public.apply_discovered_places
 * @property {string} qid
 * @property {'korea'|'world'} scope
 * @property {any[]} record           compactPlaces() form of the place
 * @property {string} primary_category
 * @property {number} latitude
 * @property {number} longitude
 * @property {number} sitelinks
 * @property {string[]} branches
 * @property {string|null} image_file
 */
/**
 * @typedef {object} MediaUpdate  one row for public.set_discovered_media
 * @property {string} qid
 * @property {string} image_file
 * @property {'cleared'|'blocked'} status
 * @property {string[]} reasons
 * @property {Record<string, any>[]} media
 */
/**
 * @typedef {object} Store  the database side of a run (the Edge Function calls the SQL functions of the same names)
 * @property {(rows: ServerRow[], seenAt: string) => Promise<number>} applyPlaces
 * @property {(seenAt: string, failedBranches: string[]) => Promise<number>} prune
 * @property {(limit: number, checkedBefore: string, krFop: boolean) => Promise<{qid: string, image_file: string}[]>} imagesDue
 * @property {(rows: MediaUpdate[], checkedAt: string, krFop: boolean) => Promise<number>} setMedia
 */
/** @typedef {{file: string, at: number, ok: boolean, reasons: string[], row: Record<string, any>|null}} ServerVerdict */

export const SERVER_JOB = 'sync-global-places'
export const SERVER_VIEW = 'public_discovered_places'
// Columns the app reads: the place list (with photo verdicts) and, for a photo check, the verdict columns only.
export const SERVER_COLUMNS = 'qid,record,branches,image_file,image_status,image_reasons,media,media_checked_at,last_seen_at'
export const SERVER_MEDIA_COLUMNS = 'qid,image_file,image_status,image_reasons,media,media_checked_at'
export const KR_FOP_BASIS = 'kr_copyright_act_35_2_display'
export const KR_FOP_REASON = 'kr_freedom_of_panorama_disabled'
// Rows per apply_discovered_places call, files per Commons check (one Commons request per 50 titles).
export const APPLY_CHUNK = 500
export const CHECK_BATCH = 50
// A photo checked less than 5 hours ago is not checked again by the next run (a manual re-run soon after a scheduled
// one does not redo every photo); the view drops verdicts older than 24 hours, so every photo is re-checked by then.
export const RECHECK_AFTER_MS = GLOBAL_SYNC_INTERVAL_MS - 60 * 60 * 1000

const QID = /^Q[1-9]\d*$/
// A timestamp column: an ISO string from PostgREST (a Date from a direct database client); anything else is no time.
const timeOf = (/** @type {any} */ v) => typeof v === 'string' ? Date.parse(v) : v instanceof Date ? v.getTime() : NaN
const errorText = (/** @type {any} */ e) => String(e?.message || e).slice(0, 300)

// MEDIA_KR_FOP_DISPLAY: on unless set to false/0/off/no (same default as the app's config).
/** @param {string|undefined|null} value */
export function krFopFromEnv(value) {
  return !/^\s*(false|0|off|no)\s*$/i.test(String(value ?? ''))
}

/** @param {GlobalPlace} p @returns {ServerRow|null} */
export function toServerRow(p) {
  if (!p || !QID.test(p.wikidata) || !p.primary_category || !Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return null
  const [record] = compactPlaces([p])
  return {
    qid: p.wikidata,
    scope: p.scope === 'korea' ? 'korea' : 'world',
    record,
    primary_category: p.primary_category,
    latitude: record[8],
    longitude: record[9],
    sitelinks: Math.max(0, Math.floor(Number(p.sitelinks) || 0)),
    branches: [...new Set(p.branches || [])],
    image_file: p.image ? String(p.image).slice(0, 240) : null,
  }
}
/** @param {GlobalPlace[]} places @returns {ServerRow[]} one row per QID */
export function toServerRows(places) {
  const out = new Map()
  for (const p of places || []) { const r = toServerRow(p); if (r && !out.has(r.qid)) out.set(r.qid, r) }
  return [...out.values()]
}

// checkImages verdicts → set_discovered_media rows. A cleared file carries its attributed media row for that place.
/**
 * @param {{qid: string, image_file: string}[]} items
 * @param {Map<string, {ok: boolean, reasons: string[], row: Record<string, any>|null}>} verdicts by file
 * @returns {MediaUpdate[]}
 */
export function mediaUpdates(items, verdicts) {
  /** @type {MediaUpdate[]} */
  const out = []
  for (const it of items) {
    const v = verdicts.get(it.image_file)
    if (!v) continue
    if (v.ok && v.row) out.push({ qid: it.qid, image_file: it.image_file, status: 'cleared', reasons: [], media: [{ ...v.row, place_code: 'WD-' + it.qid, wikidata: it.qid }] })
    else out.push({ qid: it.qid, image_file: it.image_file, status: 'blocked', reasons: v.reasons?.length ? [...v.reasons] : ['missing'], media: [] })
  }
  return out
}

/**
 * One server run: the branch queries (two at a time, each with its own timeout, all stopped at wdqsDeadline), one upsert
 * per APPLY_CHUNK places, then removal of the places this run did not see unless a failed branch may have returned them
 * (stale-on-error per branch, like carryOver in the browser), then rights checks of the photos that are due, in batches
 * of CHECK_BATCH, until the deadline. Photos not reached keep their last verdict (the view stops showing it after 24 h).
 * Never throws for Wikidata or Commons failures (they are reported); a database error is thrown.
 * @param {{fetchWdqs: FetchJSON, fetchCommons: FetchJSON, store: Store, now?: string, policy?: {krFopDisplay: boolean, maxImagesPerPlace: number},
 *   clock?: () => number, deadline?: number, wdqsDeadline?: number, imageLimit?: number, branchTimeoutMs?: number, concurrency?: number,
 *   branches?: import('./global-places.mjs').Branch[], chunk?: number}} o
 */
export async function runServerSync({
  fetchWdqs, fetchCommons, store, now = new Date().toISOString(), policy = DEFAULT_POLICY, clock = Date.now,
  deadline = Infinity, wdqsDeadline = deadline, imageLimit = 3000, branchTimeoutMs = 60000, concurrency = 2, branches, chunk = APPLY_CHUNK,
}) {
  const krFop = !!policy.krFopDisplay
  const images = { due: 0, checked: 0, cleared: 0, blocked: 0, updated: 0, deferred: 0, error: /** @type {string|null} */ (null) }
  const controller = new AbortController()
  const left = wdqsDeadline - clock()
  const timer = Number.isFinite(left) ? setTimeout(() => controller.abort(), Math.max(0, left)) : null
  /** @type {Awaited<ReturnType<typeof syncGlobal>>} */
  let result
  try {
    result = await syncGlobal({ fetchJSON: fetchWdqs, now, signal: controller.signal, timeoutMs: branchTimeoutMs, concurrency, ...(branches ? { branches } : {}) })
  } catch (e) {
    // Every branch failed: nothing is written, the rows of the last good run stay (the view hides them after 72 h).
    return { status: /** @type {const} */ ('failed'), error: errorText(e), branches: /** @type {BranchResult[]} */ ((/** @type {any} */ (e))?.branches || []), stats: null, images }
  } finally { if (timer) clearTimeout(timer) }
  const failed = result.branches.filter(b => !b.ok).map(b => b.id)
  const rows = toServerRows(result.places)
  // Branches that answered but found nothing at all: never treated as "every place is gone".
  if (!rows.length) return { status: /** @type {const} */ ('failed'), error: 'no_places', branches: result.branches, stats: { ...result.stats, rows: 0, upserted: 0, pruned: 0 }, images }
  let upserted = 0
  for (let i = 0; i < rows.length; i += chunk) upserted += Number(await store.applyPlaces(rows.slice(i, i + chunk), now)) || 0
  const pruned = Number(await store.prune(now, failed)) || 0

  const due = imageLimit > 0 && clock() < deadline ? await store.imagesDue(imageLimit, new Date(Date.parse(now) - RECHECK_AFTER_MS).toISOString(), krFop) : []
  const list = (Array.isArray(due) ? due : []).filter(d => d && QID.test(d.qid) && typeof d.image_file === 'string' && d.image_file)
  images.due = list.length
  for (let i = 0; i < list.length; i += CHECK_BATCH) {
    if (clock() >= deadline) break
    const batch = list.slice(i, i + CHECK_BATCH)
    let verdicts
    try {
      verdicts = await checkImages(batch.map(d => ({ place_id: 'WD-' + d.qid, wikidata: d.qid, image: d.image_file })), { fetchJSON: fetchCommons, now, policy })
    } catch (e) {
      // Commons is failing or throttling: stop for this run; verdicts stored so far stay, the rest keep their last one.
      images.error = errorText(e)
      break
    }
    const updates = mediaUpdates(batch, verdicts)
    images.updated += Number(await store.setMedia(updates, now, krFop)) || 0
    images.checked += batch.length
    for (const u of updates) u.status === 'cleared' ? images.cleared++ : images.blocked++
  }
  images.deferred = images.due - images.checked
  return {
    status: /** @type {'success'|'partial'} */ (failed.length || images.error ? 'partial' : 'success'),
    error: null,
    branches: result.branches,
    stats: { ...result.stats, rows: rows.length, upserted, pruned },
    images,
  }
}

// ---- the app's side: reading public_discovered_places ---------------------------------------------------------

/** @param {any} m @param {string} file */
const validMediaRow = (m, file) => !!m && typeof m === 'object' && m.provider_asset_id === file && m.clearance_status === 'cleared' && m.review_required === false &&
  /^https:\/\//.test(String(m.display_url || '')) && typeof m.creator === 'string' && typeof m.license_code === 'string' && !!m.license_code

// One row's photo verdict, or null when the app should check the photo itself (none yet, or too old: the view reports
// 'pending'). policy is the APP's MEDIA_KR_FOP_DISPLAY: a Korean-FoP photo the server cleared is blocked when the app's
// policy is off, and one the server blocked only for that reason is left to the app's own check when it is on.
/** @param {any} r @param {{krFopDisplay: boolean}} policy @returns {ServerVerdict|null} */
function serverVerdict(r, policy) {
  const file = typeof r?.image_file === 'string' ? r.image_file : ''
  const at = timeOf(r?.media_checked_at)
  if (!file || !Number.isFinite(at)) return null
  const reasons = Array.isArray(r.image_reasons) ? r.image_reasons.filter((/** @type {any} */ x) => typeof x === 'string') : []
  if (r.image_status === 'blocked') {
    if (policy.krFopDisplay && reasons.length && reasons.every((/** @type {string} */ x) => x === KR_FOP_REASON)) return null
    return { file, at, ok: false, reasons, row: null }
  }
  if (r.image_status !== 'cleared') return null
  const row = (Array.isArray(r.media) ? r.media : []).find((/** @type {any} */ m) => validMediaRow(m, file))
  if (!row) return null
  if (!policy.krFopDisplay && row.rights_basis === KR_FOP_BASIS) return { file, at, ok: false, reasons: [KR_FOP_REASON], row: null }
  const { place_code, wikidata, ...rest } = row
  return { file, at, ok: true, reasons: [], row: rest }
}

/** @param {any} rows rows of public_discovered_places (SERVER_MEDIA_COLUMNS at least) @param {{policy?: {krFopDisplay: boolean}}} [o] @returns {ServerVerdict[]} */
export function verdictsFromServerRows(rows, { policy = DEFAULT_POLICY } = {}) {
  if (!Array.isArray(rows)) throw Error('invalid_server_payload')
  /** @type {ServerVerdict[]} */
  const out = []
  for (const r of rows) { const v = serverVerdict(r, policy); if (v) out.push(v) }
  return out
}

// Rows of public_discovered_places (SERVER_COLUMNS) → the app's places (most-linked first, as expandPlaces sorts them),
// the photo verdicts for the files those places use, and the time of the server's latest sync (newest last_seen_at).
/** @param {any} rows @param {{policy?: {krFopDisplay: boolean}}} [o] @returns {{places: GlobalPlace[], verdicts: ServerVerdict[], fetchedAt: string|null}} */
export function fromServerRows(rows, { policy = DEFAULT_POLICY } = {}) {
  if (!Array.isArray(rows)) throw Error('invalid_server_payload')
  const byQid = new Map()
  for (const r of rows) if (r && QID.test(r.qid) && Array.isArray(r.record) && r.record[0] === r.qid && !byQid.has(r.qid)) byQid.set(r.qid, r)
  // Branch indexes inside a record belong to the server's code version: the row's own branch ids are used instead.
  const places = expandPlaces([...byQid.values()].map(r => r.record), [])
  /** @type {ServerVerdict[]} */
  const verdicts = []
  let latest = 0
  for (const p of places) {
    const r = byQid.get(p.wikidata)
    p.branches = Array.isArray(r.branches) ? [...new Set(/** @type {any[]} */ (r.branches).filter(b => typeof b === 'string'))].slice(0, 50) : []
    const seen = timeOf(r.last_seen_at)
    if (seen > latest) latest = seen
    const v = p.image && r.image_file === p.image ? serverVerdict(r, policy) : null
    if (v) verdicts.push(v)
  }
  return { places, verdicts, fetchedAt: latest ? new Date(latest).toISOString() : null }
}
