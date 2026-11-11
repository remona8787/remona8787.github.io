#!/usr/bin/env node
// Archive health (v0.26, docs/PIPELINE.md "Alerts"): after every run, whether the operator needs to look. Reads the data
// branch (state/runs.json, site-data/status.json, review/live/report.json) and this run's job results; prints a Markdown
// summary and writes alert=true|false, title and a body file for the workflow's issue step. Never changes data.
//   node pipeline/ci/health.mjs --data=data --collect=success --deploy=success --verify=success --body=health.md
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import path from 'node:path'

export const LIMITS = { last_run_hours: 14, last_publish_hours: 30, data_unchanged_days: 7 }

export function assess({ runs = null, status = null, live = null, jobs = {}, now = Date.now(), limits = LIMITS }) {
  const problems = [], notes = []
  const age = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? (now - t) / 3600e3 : null }
  if (jobs.collect === 'failure') problems.push('collect: the job failed in this run (the previous dataset stays published)')
  if (jobs.deploy === 'failure') problems.push('deploy: the job failed in this run (the site keeps its previous deploy)')
  if (jobs.verify === 'failure') problems.push('verify-live: the live check failed in this run (review/live/report.json)')
  const lastRun = age(runs?.last_run?.at)
  if (lastRun === null) problems.push('no collect run is recorded on the data branch')
  else if (lastRun > limits.last_run_hours) problems.push(`the collector last ran ${lastRun.toFixed(1)} hours ago (limit ${limits.last_run_hours}): schedules were skipped or failed`)
  const outcome = status?.last_check?.outcome
  if (outcome && outcome.startsWith('kept_previous')) problems.push(`the last run kept the previous dataset (${outcome})`)
  const changed = age(status?.data_changed_at ?? runs?.last_good?.at)
  if (changed !== null && changed > limits.data_unchanged_days * 24) notes.push(`the published data has not changed for ${(changed / 24).toFixed(1)} days (runs found nothing new; check the sources)`)
  if (live && live.ok === false) problems.push('the last live check was not ok (review/live/report.json)')
  const alert = problems.length > 0 || notes.length > 0
  return { alert, problems, notes, last_run_hours: lastRun, data_changed_hours: changed }
}

export function markdown(a, { runUrl = '' } = {}) {
  const lines = ['## Archive health', '']
  if (!a.alert) lines.push('Everything checked is fine.')
  for (const p of a.problems) lines.push('- ❗ ' + p)
  for (const n of a.notes) lines.push('- ⚠️ ' + n)
  lines.push('', `- last collect: ${a.last_run_hours === null ? 'none' : a.last_run_hours.toFixed(1) + ' h ago'}`, `- data last changed: ${a.data_changed_hours === null ? 'unknown' : (a.data_changed_hours / 24).toFixed(1) + ' days ago'}`)
  if (runUrl) lines.push(`- run: ${runUrl}`)
  return lines.join('\n') + '\n'
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d
  const read = (f) => { try { return JSON.parse(readFileSync(path.join(arg('data', 'data'), f), 'utf8')) } catch { return null } }
  const a = assess({ runs: read('state/runs.json'), status: read('site-data/status.json'), live: read('review/live/report.json'), jobs: { collect: arg('collect'), deploy: arg('deploy'), verify: arg('verify') } })
  const md = markdown(a, { runUrl: arg('run-url') })
  console.log(md)
  writeFileSync(arg('body', 'health.md'), md)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `alert=${a.alert}\nproblems=${a.problems.length}\n`)
}
