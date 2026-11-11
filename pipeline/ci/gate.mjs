#!/usr/bin/env node
// The collect gate (v0.26, docs/PIPELINE.md "Schedules"). GitHub runs schedules late or not at all when it is busy
// (2026-10-26 to 11-10: 41 of about 60 six-hour slots ran; on 11-11 the 00:17 and 12:17 slots never ran). An hourly
// catch-up schedule (v0.26.4; before, one two and a half hours after each slot) runs the collector only when no collect
// ran in the last --min-hours (state/runs.json last_run.at on the data branch, which pushes with [collect] update too);
// every other trigger always runs. Writes run=true|false and reason to $GITHUB_OUTPUT. No dependencies.
//   node pipeline/ci/gate.mjs --data=data --schedule="$SCHEDULE" --catch-up='47 * * * *' --min-hours=6.5
import { readFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'

export function decide({ schedule = '', catchUp = '', lastRunAt = null, now = Date.now(), minHours = 6.5 }) {
  if (!schedule || schedule !== catchUp) return { run: true, reason: schedule ? 'regular_schedule' : 'not_a_schedule' }
  const t = Date.parse(lastRunAt || '')
  if (!Number.isFinite(t)) return { run: true, reason: 'catch_up_no_previous_run' }
  const hours = (now - t) / 3600e3
  return hours >= minHours ? { run: true, reason: `catch_up_last_run_${hours.toFixed(1)}h_ago` } : { run: false, reason: `catch_up_skipped_last_run_${hours.toFixed(1)}h_ago` }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d
  let lastRunAt = null
  try { lastRunAt = JSON.parse(readFileSync(path.join(arg('data', 'data'), 'state/runs.json'), 'utf8'))?.last_run?.at ?? null } catch {}
  const d = decide({ schedule: arg('schedule'), catchUp: arg('catch-up'), lastRunAt, minHours: Number(arg('min-hours', '6.5')) })
  console.log(`[gate] ${d.run ? 'run' : 'skip'}: ${d.reason} (last run ${lastRunAt || 'none'})`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${d.run}\nreason=${d.reason}\n`)
}
