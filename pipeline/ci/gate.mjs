#!/usr/bin/env node
// The collect gate (v0.26, docs/PIPELINE.md "Schedules"). GitHub runs schedules late or not at all when it is busy
// (2026-10-26 to 11-10: 41 of about 60 six-hour slots ran; on 11-11 the 00:17 and 12:17 slots never ran). An hourly
// catch-up schedule (v0.26.4; before, one two and a half hours after each slot) runs the collector only when no collect
// ran in the last --min-hours (state/runs.json last_run.at on the data branch, which pushes with [collect] update too);
// a regular slot runs unless a collect that did not fail ran in the last three hours; pushes and dispatches always run. Writes run=true|false and reason to $GITHUB_OUTPUT. No dependencies.
//   node pipeline/ci/gate.mjs --data=data --schedule="$SCHEDULE" --catch-up='47 * * * *' --min-hours=6.5
import { readFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'

// gated (v1.0.1): a run the keeper dispatched (keeper.yml) collects only when no collect ran in the last minHours, the
// same rule as the catch-up, checked here under the archive concurrency lock so overlapping triggers collect once.
// v2.0 (2026-11-13): a regular slot GitHub starts late can land right after the catch-up or the keeper collected (19:20
// keeper, 19:48 the 18:17 slot): it skips when a collect that did not fail ran less than minRegularHours ago, so the
// six-hour rhythm stays and the same work is not done twice. A failed last run never holds a slot back.
export function decide({ schedule = '', catchUp = '', gated = false, lastRunAt = null, lastRunStatus = null, now = Date.now(), minHours = 6.5, minRegularHours = 3 }) {
  if (!schedule && !gated) return { run: true, reason: 'not_a_schedule' }
  if (!gated && schedule !== catchUp) {
    const t = Date.parse(lastRunAt || ''), hours = (now - t) / 3600e3
    if (Number.isFinite(t) && hours < minRegularHours && !/^(failed|error)$/.test(String(lastRunStatus || ''))) return { run: false, reason: `regular_schedule_skipped_last_run_${hours.toFixed(1)}h_ago` }
    return { run: true, reason: 'regular_schedule' }
  }
  const kind = gated ? 'keeper' : 'catch_up'
  const t = Date.parse(lastRunAt || '')
  if (!Number.isFinite(t)) return { run: true, reason: `${kind}_no_previous_run` }
  const hours = (now - t) / 3600e3
  return hours >= minHours ? { run: true, reason: `${kind}_last_run_${hours.toFixed(1)}h_ago` } : { run: false, reason: `${kind}_skipped_last_run_${hours.toFixed(1)}h_ago` }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d
  let lastRunAt = null, lastRunStatus = null
  try { const last = JSON.parse(readFileSync(path.join(arg('data', 'data'), 'state/runs.json'), 'utf8'))?.last_run; lastRunAt = last?.at ?? null; lastRunStatus = last?.status ?? null } catch {}
  const d = decide({ schedule: arg('schedule'), catchUp: arg('catch-up'), gated: arg('gated') === 'true', lastRunAt, lastRunStatus, minHours: Number(arg('min-hours', '6.5')) })
  console.log(`[gate] ${d.run ? 'run' : 'skip'}: ${d.reason} (last run ${lastRunAt || 'none'})`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${d.run}\nreason=${d.reason}\n`)
}
