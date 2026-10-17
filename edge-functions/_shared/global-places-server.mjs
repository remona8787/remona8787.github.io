// Server-side nationwide/worldwide place sync (Edge Function sync-global-places) and the app's reader for its result
// (public.public_discovered_places, see supabase/migrations/20261013000000_discovered_places.sql).
// The same branch queries and rights checks as the browser sync (global-places.mjs, live-media.mjs) run ONCE per run
// on the server; every visitor then reads the result with one REST request instead of querying Wikidata itself.
// Two phases, each with its own cron job: "places" (every 6 hours: the Wikidata branches, then photo checks with the
// time left) and "images" (every 3 hours: photo checks only, with the whole budget).
// Pure ESM with injected fetch and storage: runs unchanged in Deno, browsers and Node tests.

import { syncGlobal, compactPlaces, expandPlaces, checkImages, BRANCHES, GLOBAL_SYNC_INTERVAL_MS } from './global-places.mjs'
import { DEFAULT_POLICY } from './live-media.mjs'

/** @typedef {import('./global-places.mjs').GlobalPlace} GlobalPlace */
/** @typedef {import('./global-places.mjs').Branch} Branch */
/** @typedef {import('./global-places.mjs').BranchResult & {suspect?: boolean, stored?: number, rows?: number}} ServerBranchResult
 *  suspect: the branch answered but returned less than half of the places stored for it (stored), counted over the
 *  rows this run built (rows); it is treated as failed for pruning. */
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
 * @property {(seenAt: string) => Promise<Record<string, number>>} branchCounts  places stored per branch id, seen in the 72 hours before seenAt (discovered_branch_counts)
 * @property {(limit: number, checkedBefore: string, krFop: boolean) => Promise<{qid: string, image_file: string}[]>} imagesDue
 * @property {(rows: MediaUpdate[], checkedAt: string, krFop: boolean) => Promise<number>} setMedia
 */
/**
 * @typedef {object} ImageStats  what one run's photo checks did
 * @property {number} due       photos due when the checks started (at most imageLimit)
 * @property {number} checked
 * @property {number} cleared
 * @property {number} blocked
 * @property {number} updated   verdicts stored
 * @property {number} deferred  due but not checked in this run (they keep their last verdict and come first next time)
 * @property {'deadline'|null} stopped  the deadline stopped the checks (not an error)
 * @property {string|null} error  Commons failed: the checks stopped for this run
 */
/** @typedef {{file: string, at: number, ok: boolean, reasons: string[], row: Record<string, any>|null}} ServerVerdict */

export const SERVER_JOB = 'sync-global-places'
// The photo-only phase logs to sync_runs under its own job name; both phases take the same run lock (SERVER_JOB).
export const SERVER_IMAGES_JOB = 'sync-global-places-images'
export const SERVER_PHASES = /** @type {const} */ (['places', 'images'])
export const SERVER_VIEW = 'public_discovered_places'
// Columns the app reads: the place list (with photo verdicts) and, for a photo check, the verdict columns only.
export const SERVER_COLUMNS = 'qid,record,branches,image_file,image_status,image_reasons,media,media_checked_at,last_seen_at'
export const SERVER_MEDIA_COLUMNS = 'qid,image_file,image_status,image_reasons,media,media_checked_at'
export const KR_FOP_BASIS = 'kr_copyright_act_35_2_display'
export const KR_FOP_REASON = 'kr_freedom_of_panorama_disabled'
// The reason the view reports for a photo an operator blocked (discovered_places.image_block).
export const EDITORIAL_REASON = 'editorial_block'
// Rows per apply_discovered_places call, files per Commons check (one Commons request per 50 titles).
export const APPLY_CHUNK = 500
export const CHECK_BATCH = 50
// Supabase answers any request that has not responded within 150 s with 504 (on every plan), so a run never takes
// longer than this: the caller (pg_net, curl) always gets the JSON summary. More photo capacity comes from the photo
// phase, not from a longer budget.
export const MAX_BUDGET_MS = 130000
// A photo verdict is shown for 24 hours (the view's limit, the same as the browser's). The server re-checks a photo
// once its verdict is 12 hours old: with a photo run every 3 hours (plus the time left in each place run) a photo is
// re-checked 12-15 hours after its last check, and three runs in a row can defer it before its verdict expires
// (runAlerts reports that). Capacity: at 3-6 s per batch of 50, one 120 s photo run checks about 1000-2000 photos,
// 8000-16000 a day, against 2 checks a day for each photo (about 6000 for 3000 photos).
export const VERDICT_TTL_MS = 4 * GLOBAL_SYNC_INTERVAL_MS
export const RECHECK_AFTER_MS = 2 * GLOBAL_SYNC_INTERVAL_MS
// A branch that answers but returns less than this share of the places stored for it (e.g. 0 of 44) is treated as
// failed for pruning: a partial or empty answer cannot delete what only that branch had found (or their photo verdicts).
export const BRANCH_DROP_RATIO = 0.5
// Alerts: the same branch failing, or photos deferred by the photo phase, in this many runs in a row.
export const ALERT_STREAK = 3

const QID = /^Q[1-9]\d*$/
// A timestamp column: an ISO string from PostgREST (a Date from a direct database client); anything else is no time.
const timeOf = (/** @type {any} */ v) => typeof v === 'string' ? Date.parse(v) : v instanceof Date ? v.getTime() : NaN
const errorText = (/** @type {any} */ e) => String(e?.message || e).slice(0, 300)
/** @returns {ImageStats} */
const noImages = () => ({ due: 0, checked: 0, cleared: 0, blocked: 0, updated: 0, deferred: 0, stopped: null, error: null })

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

// Start order of the server's branch queries. The expensive branch (korea:name-keywords) starts first, in a lane of
// its own, so it always gets its whole timeout before the Wikidata deadline; the other branches rotate by one place
// per run (rotation: the run's 6-hour slot), so when Wikidata is slow the deadline does not stop the same branches
// every time.
/** @param {Branch[]} branches @param {number} [rotation] @returns {Branch[]} */
export function serverBranchOrder(branches, rotation = 0) {
  const cheap = branches.filter(b => !b.expensive), expensive = branches.filter(b => b.expensive)
  const n = cheap.length
  const k = n ? ((Math.floor(Number(rotation) || 0) % n) + n) % n : 0
  return [...expensive, ...cheap.slice(k), ...cheap.slice(0, k)]
}

// Branches that answered but returned less than BRANCH_DROP_RATIO of the places stored for them (stored: rows seen in
// the 72 hours before the run whose branch list has the id; now: the same count over this run's rows).
/** @param {import('./global-places.mjs').BranchResult[]} report @param {ServerRow[]} rows @param {Record<string, number>} stored @returns {{id: string, rows: number, stored: number}[]} */
export function droppedBranches(report, rows, stored) {
  /** @type {Map<string, number>} */
  const now = new Map()
  for (const r of rows) for (const b of r.branches) now.set(b, (now.get(b) || 0) + 1)
  const out = []
  for (const b of report) {
    if (!b.ok) continue
    const before = Math.max(0, Math.floor(Number(stored?.[b.id]) || 0))
    const count = now.get(b.id) || 0
    if (before > 0 && count < before * BRANCH_DROP_RATIO) out.push({ id: b.id, rows: count, stored: before })
  }
  return out
}

// Settles with the promise, or rejects with the signal's reason as soon as it aborts (even if the promise ignores it).
/** @template T @param {Promise<T>} promise @param {AbortSignal} signal @returns {Promise<T>} */
function untilAborted(promise, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason)
    if (signal.aborted) onAbort()
    else signal.addEventListener('abort', onAbort, { once: true })
    promise.then(v => { signal.removeEventListener('abort', onAbort); resolve(v) }, e => { signal.removeEventListener('abort', onAbort); reject(e) })
  })
}

/**
 * Rights checks of the photos that are due (never checked first, then those checked under another FoP policy, then
 * the oldest verdicts), in batches of CHECK_BATCH, until the deadline. Every Commons request carries an abort signal
 * that fires at the deadline, and no request (also no continuation round inside a batch) starts once the clock has
 * passed it, so a slow Commons cannot hold the run past the deadline: the batch in progress is dropped and waits, like
 * the photos not reached, for the next run (images.stopped = 'deadline', not an error). Commons failing stops the
 * checks for this run (images.error); the verdicts stored so far stay. A database error is thrown.
 * @param {{fetchCommons: FetchJSON, store: Store, now?: string, policy?: {krFopDisplay: boolean, maxImagesPerPlace: number},
 *   clock?: () => number, deadline?: number, imageLimit?: number}} o
 * @returns {Promise<ImageStats>}
 */
export async function checkDueImages({ fetchCommons, store, now = new Date().toISOString(), policy = DEFAULT_POLICY, clock = Date.now, deadline = Infinity, imageLimit = 3000 }) {
  const krFop = !!policy.krFopDisplay
  const images = noImages()
  if (!(imageLimit > 0)) return images
  if (clock() >= deadline) { images.stopped = 'deadline'; return images }
  const due = await store.imagesDue(imageLimit, new Date(Date.parse(now) - RECHECK_AFTER_MS).toISOString(), krFop)
  const list = (Array.isArray(due) ? due : []).filter(d => d && QID.test(d.qid) && typeof d.image_file === 'string' && d.image_file)
  images.due = list.length
  const stop = new AbortController()
  const timeUp = Error('deadline')
  const left = deadline - clock()
  const timer = Number.isFinite(left) ? setTimeout(() => stop.abort(timeUp), Math.max(0, left)) : null
  const pastDeadline = () => { if (!stop.signal.aborted && clock() >= deadline) stop.abort(timeUp); return stop.signal.aborted }
  /** @type {FetchJSON} */
  const bounded = (url, init = {}) => pastDeadline() ? Promise.reject(timeUp) : untilAborted(fetchCommons(url, { ...init, signal: stop.signal }), stop.signal)
  try {
    for (let i = 0; i < list.length; i += CHECK_BATCH) {
      if (pastDeadline()) { images.stopped = 'deadline'; break }
      const batch = list.slice(i, i + CHECK_BATCH)
      let verdicts
      try {
        verdicts = await checkImages(batch.map(d => ({ place_id: 'WD-' + d.qid, wikidata: d.qid, image: d.image_file })), { fetchJSON: bounded, now, policy, signal: stop.signal })
      } catch (e) {
        if (pastDeadline()) { images.stopped = 'deadline'; break }
        // Commons is failing or throttling: stop for this run; verdicts stored so far stay, the rest keep their last one.
        images.error = errorText(e)
        break
      }
      const updates = mediaUpdates(batch, verdicts)
      images.updated += Number(await store.setMedia(updates, now, krFop)) || 0
      images.checked += batch.length
      for (const u of updates) u.status === 'cleared' ? images.cleared++ : images.blocked++
    }
  } finally { if (timer) clearTimeout(timer) }
  images.deferred = images.due - images.checked
  return images
}

/**
 * One place run: the branch queries (expensive one first, the rest rotated, see serverBranchOrder; two at a time, each
 * with its own timeout, all stopped at wdqsDeadline), one upsert per APPLY_CHUNK places, then removal of the places
 * this run did not see unless a failed branch may have returned them (stale-on-error per branch, like carryOver in the
 * browser; a branch whose count dropped below half of its stored count counts as failed here), then photo checks with
 * the time left (checkDueImages). Photos not reached keep their last verdict; the photo phase (runServerImages) does
 * the rest. Never throws for Wikidata or Commons failures (they are reported); a database error is thrown.
 * @param {{fetchWdqs: FetchJSON, fetchCommons: FetchJSON, store: Store, now?: string, policy?: {krFopDisplay: boolean, maxImagesPerPlace: number},
 *   clock?: () => number, deadline?: number, wdqsDeadline?: number, imageLimit?: number, branchTimeoutMs?: number, concurrency?: number,
 *   branches?: Branch[], rotation?: number, chunk?: number}} o
 * @returns {Promise<{status: 'success'|'partial'|'failed', error: string|null, branches: ServerBranchResult[], stats: Record<string, any>|null, images: ImageStats}>}
 */
export async function runServerSync({
  fetchWdqs, fetchCommons, store, now = new Date().toISOString(), policy = DEFAULT_POLICY, clock = Date.now,
  deadline = Infinity, wdqsDeadline = deadline, imageLimit = 3000, branchTimeoutMs = 60000, concurrency = 2, branches = BRANCHES, rotation = 0, chunk = APPLY_CHUNK,
}) {
  const controller = new AbortController()
  const left = Math.min(wdqsDeadline, deadline) - clock()
  const timer = Number.isFinite(left) ? setTimeout(() => controller.abort(), Math.max(0, left)) : null
  /** @type {Awaited<ReturnType<typeof syncGlobal>>} */
  let result
  try {
    result = await syncGlobal({ fetchJSON: fetchWdqs, now, signal: controller.signal, timeoutMs: branchTimeoutMs, concurrency, branches: serverBranchOrder(branches, rotation), keepOrder: true })
  } catch (e) {
    // Every branch failed: nothing is written, the rows of the last good run stay (the view hides them after 72 h).
    return { status: 'failed', error: errorText(e), branches: /** @type {ServerBranchResult[]} */ ((/** @type {any} */ (e))?.branches || []), stats: null, images: noImages() }
  } finally { if (timer) clearTimeout(timer) }
  const rows = toServerRows(result.places)
  // Branches that answered but found nothing at all: never treated as "every place is gone".
  if (!rows.length) return { status: 'failed', error: 'no_places', branches: result.branches, stats: { ...result.stats, rows: 0, upserted: 0, pruned: 0, suspect: 0 }, images: noImages() }
  // Read before this run's upsert replaces the branch lists.
  const drops = new Map(droppedBranches(result.branches, rows, (await store.branchCounts(now)) || {}).map(d => [d.id, d]))
  /** @type {ServerBranchResult[]} */
  const report = result.branches.map(b => { const d = drops.get(b.id); return d ? { ...b, suspect: true, stored: d.stored, rows: d.rows } : b })
  const failed = report.filter(b => !b.ok || b.suspect).map(b => b.id)
  let upserted = 0
  for (let i = 0; i < rows.length; i += chunk) upserted += Number(await store.applyPlaces(rows.slice(i, i + chunk), now)) || 0
  const pruned = Number(await store.prune(now, failed)) || 0
  const images = await checkDueImages({ fetchCommons, store, now, policy, clock, deadline, imageLimit })
  return {
    status: failed.length || images.error ? 'partial' : 'success',
    error: null,
    branches: report,
    stats: { ...result.stats, rows: rows.length, upserted, pruned, suspect: drops.size },
    images,
  }
}

/**
 * One photo run (phase "images"): only the rights checks of the photos that are due, with the whole budget.
 * 'failed' when Commons failed before any photo was checked.
 * @param {{fetchCommons: FetchJSON, store: Store, now?: string, policy?: {krFopDisplay: boolean, maxImagesPerPlace: number},
 *   clock?: () => number, deadline?: number, imageLimit?: number}} o
 * @returns {Promise<{status: 'success'|'partial'|'failed', error: string|null, images: ImageStats}>}
 */
export async function runServerImages(o) {
  const images = await checkDueImages(o)
  return { status: !images.error ? 'success' : images.checked ? 'partial' : 'failed', error: null, images }
}

/**
 * Alerts for the run log (sync_runs.metadata.alerts and error_message), from this run and the ALERT_STREAK - 1 runs
 * of the same job before it (newest first, rows with status and metadata):
 *  - places: a branch that failed (or was treated as failed after a sharp drop) in each of them;
 *  - images: photos deferred in each of them (the photo runs are not keeping up with the 24-hour verdict lifetime).
 * @param {{phase: 'places'|'images', result: {branches?: ServerBranchResult[], images?: ImageStats}, history: any}} o
 * @returns {string[]}
 */
export function runAlerts({ phase, result, history }) {
  const prev = (Array.isArray(history) ? history : []).slice(0, ALERT_STREAK - 1)
  if (prev.length < ALERT_STREAK - 1) return []
  /** @type {string[]} */
  const alerts = []
  if (phase === 'images') {
    const deferred = Number(result?.images?.deferred) || 0
    if (deferred > 0 && prev.every(r => Number(r?.metadata?.images?.deferred) > 0)) alerts.push(`photo_backlog: ${deferred} photos deferred, ${ALERT_STREAK} photo runs in a row`)
    return alerts
  }
  for (const b of result?.branches || []) {
    if (b.ok && !b.suspect) continue
    const failedIn = (/** @type {any} */ r) => Array.isArray(r?.metadata?.branches) && r.metadata.branches.some((/** @type {any} */ x) => x?.id === b.id && (!x.ok || x.suspect))
    if (prev.every(failedIn)) alerts.push(`branch_failing: ${b.id} failed ${ALERT_STREAK} runs in a row`)
  }
  return alerts
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
