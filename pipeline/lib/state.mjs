// Run state kept on the data branch (state/): the run counter, the last good dataset, per-source failure counters and
// the per-project tracker behind "not seen in 3 runs" and "keep the last good data on a source failure".
//
// Tracker rules (one entry per published project id):
//  - seen this run → last_seen updated, missing_runs = 0;
//  - not seen, and one of the sources it came from failed or was partial this run → carried over unchanged from the
//    previous dataset (the failure says nothing about the project), missing_runs unchanged;
//  - not seen although its sources completed → missing_runs + 1; it stays published (listed as stale in
//    quality.json) until missing_runs reaches staleAfter (3), then it is removed (report.json counts.removed);
//  - hidden by an editor or now ineligible → removed at once (that is a decision, not a gap in the sources).
import path from 'node:path'
import { readJSON, writeJSON } from './io.mjs'

export const ORIGIN_SOURCE = { wikidata_class: 'wikidata', commons: 'commons', wikipedia: 'wikipedia', tourapi: 'tourapi', curated: 'curated', editorial: 'editorial', web: 'web' }

export async function loadState(stateDir) {
  const read = (name, fallback) => readJSON(path.join(stateDir, name), fallback)
  return {
    runs: (await read('runs.json', null)) || { schema: 1, runs: 0, last_run: null, last_good: null },
    tracker: (await read('tracker.json', null)) || { schema: 1, projects: {} },
    failures: (await read('failures.json', null)) || { schema: 1, sources: {} },
    webRules: (await read('web-rules.json', null))?.rules || {},
    candidates: (await read('candidates.json', null))?.candidates || {},
    imagePicks: (await read('image-picks.json', null))?.picks || {},
  }
}

export async function saveState(stateDir, s) {
  await writeJSON(path.join(stateDir, 'runs.json'), s.runs, { pretty: true })
  await writeJSON(path.join(stateDir, 'tracker.json'), s.tracker)
  await writeJSON(path.join(stateDir, 'failures.json'), s.failures, { pretty: true })
  await writeJSON(path.join(stateDir, 'web-rules.json'), { schema: 1, rules: s.webRules }, { pretty: true })
  await writeJSON(path.join(stateDir, 'candidates.json'), { schema: 1, candidates: s.candidates })
  await writeJSON(path.join(stateDir, 'image-picks.json'), { schema: 1, picks: s.imagePicks || {} })
}

/** Failure counters per source: consecutive failures, last error, last success. */
export function updateFailures(failures, statuses, nowIso) {
  const out = { schema: 1, sources: { ...(failures.sources || {}) } }
  for (const [name, s] of Object.entries(statuses)) {
    const prev = out.sources[name] || { consecutive_failures: 0, last_error: null, last_success: null }
    if (s.status === 'ok') out.sources[name] = { consecutive_failures: 0, last_error: null, last_success: nowIso }
    else if (s.status === 'error') out.sources[name] = { ...prev, consecutive_failures: prev.consecutive_failures + 1, last_error: s.errors?.[0]?.message || 'failed' }
    else if (s.status === 'partial') out.sources[name] = { ...prev, last_error: s.errors?.[0]?.message || prev.last_error, last_partial: nowIso }
    else out.sources[name] = prev
  }
  return out
}

/**
 * Decides the fate of every previously published project that this run did not publish.
 * @param {{projects: Record<string, any>}} tracker previous tracker
 * @param {Map<string, any>} previous previous public records by id
 * @param {{published: Map<string, {origins: string[]}>, decided: Set<string>, sourceStatus: Record<string, {status: string}>, runNo: number, nowIso: string, staleAfter?: number, aliases?: Map<string, string>}} o
 *   decided: ids that were built this run but are hidden or ineligible (removed at once); aliases: old id → new id
 */
export function trackProjects(tracker, previous, { published, decided, sourceStatus, runNo, nowIso, staleAfter = 3, aliases = new Map() }) {
  const next = { schema: 1, projects: {} }
  const carried = [], removed = [], stale = []
  for (const [id, info] of published) {
    const old = tracker.projects?.[id] || [...aliases].filter(([, to]) => to === id).map(([from]) => tracker.projects?.[from]).find(Boolean) || null
    next.projects[id] = { first_seen: old?.first_seen || nowIso, last_seen: nowIso, last_seen_run: runNo, missing_runs: 0, origins: info.origins, hash: info.hash ?? null }
  }
  for (const [id, record] of previous) {
    if (published.has(id)) continue
    if (aliases.has(id) && published.has(aliases.get(id))) { removed.push({ id, reason: 'merged_into', into: aliases.get(id) }); continue }
    const old = tracker.projects?.[id] || { first_seen: record.added_at || nowIso, last_seen: null, last_seen_run: null, missing_runs: 0, origins: [] }
    if (decided.has(id)) { removed.push({ id, reason: 'hidden_or_ineligible' }); continue }
    const origins = old.origins?.length ? old.origins : ['unknown']
    const failed = origins.filter((o) => { const s = sourceStatus[ORIGIN_SOURCE[o] || o]?.status; return s === 'error' || s === 'partial' || s === 'skipped' || s === undefined })
    // Enrichment (Wikidata facts) is needed by every origin: when it did not complete, nothing unseen is "missing".
    if (sourceStatus.enrich && sourceStatus.enrich.status !== 'ok') failed.push('enrich')
    if (failed.length) {
      next.projects[id] = { ...old }
      carried.push({ id, reason: 'source_not_complete', sources: [...new Set(failed.map((o) => ORIGIN_SOURCE[o] || o))] })
      continue
    }
    const missing = (old.missing_runs || 0) + 1
    if (missing >= staleAfter) { removed.push({ id, reason: `not_seen_in_${missing}_runs`, last_seen: old.last_seen }); continue }
    next.projects[id] = { ...old, missing_runs: missing }
    carried.push({ id, reason: 'not_seen', missing_runs: missing })
    stale.push({ id, missing_runs: missing, last_seen: old.last_seen })
  }
  return { tracker: next, carried, removed, stale }
}
