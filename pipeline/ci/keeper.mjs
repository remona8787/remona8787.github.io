#!/usr/bin/env node
// The collect keeper (v1.0.1, docs/PIPELINE.md "Keeper"). GitHub starts scheduled runs late or not at all (from
// 2026-11-11 19:47 to 11-12 06:20 UTC one of about eleven schedule slots ran), so the six-hourly collection needs a path
// that does not wait for GitHub's scheduler. keeper.yml runs this script; each run (a "link"):
//   1. reads when the collector last ran (state/runs.json last_run.at on the data branch, the same clock as the gate);
//   2. when that was `hours` or more ago, no archive run is queued or running, and the keeper did not dispatch one in the
//      last `retry_hours` (a collect that fails before it records itself is retried every retry_hours, not every look),
//      dispatches archive.yml with gated=true: the gate checks the time again under the archive concurrency lock, so a
//      schedule, a push and the keeper that land together collect once;
//   3. when no collect ran for `stall_hours`, opens the archive alert issue (health.mjs ISSUE_TITLE, the one the archive
//      health job opens, comments on and closes) or comments on it at most once per day; the health job of the next
//      archive run that collects closes it when all is well, so stalls and failures share one issue;
//   4. looks again until the link's time is spent, then starts the next link (a workflow_dispatch made with the run's
//      own GITHUB_TOKEN starts a new run, unlike other events) and ends, so the chain needs no schedule.
// Waiting: when the keeper-wait environment has a wait timer (an operator setting, docs/PIPELINE.md "Keeper"), GitHub
// holds each link that long without a runner, and the link looks once and starts the next one. Without the timer the
// link sleeps on its runner between looks for up to `budget_minutes`. keeper.yml's own schedule and every archive run
// (job "keeper") start a keeper when none is queued, waiting or running, so the chain recovers from a cancelled or
// failed link. No secret beyond the run's GITHUB_TOKEN (actions: write, issues: write, contents: read); no external
// service.
//   node pipeline/ci/keeper.mjs --repo=owner/name [--hours=6] [--stall-hours=13] [--retry-hours=2] [--budget-minutes=300]

import { ISSUE_TITLE } from './health.mjs'
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested'])
const H = 3600e3

/** What to do now, from the last collect time. Pure. */
export function plan({ lastRunAt = null, now = Date.now(), hours = 6, stallHours = 13, retryHours = 2, archiveBusy = false, lastDispatchAt = null }) {
  const t = Date.parse(lastRunAt || '')
  const age = Number.isFinite(t) ? (now - t) / H : null
  const due = age === null || age >= hours
  const d = Date.parse(lastDispatchAt || '')
  const sinceDispatch = Number.isFinite(d) ? (now - d) / H : null
  const retryWait = due && sinceDispatch !== null && sinceDispatch < retryHours && (age === null || d > t)
  const dispatch = due && !archiveBusy && !retryWait
  const stalled = age !== null && age >= stallHours
  const a = age === null ? '' : `${age.toFixed(1)}h`
  const reason = !due ? `not_due_${a}` : archiveBusy ? `due_${a || 'never'}_archive_busy` : retryWait ? `due_${a || 'never'}_retry_in_${(retryHours - sinceDispatch).toFixed(1)}h` : `due_${a || 'never'}`
  // Next look: when the next collect is due (plus ten minutes for the run to record itself), when the retry wait ends,
  // or in half an hour while a dispatched or running collect has not recorded itself yet; at least ten minutes away.
  const nextMs = Math.max(10 * 60e3, !due ? (hours - age) * H + 10 * 60e3 : retryWait ? (retryHours - sinceDispatch) * H + 60e3 : 30 * 60e3)
  return { age, due, dispatch, stalled, retryWait, nextMs, reason }
}

/** A tiny GitHub REST client with the run's token. */
export function github({ repo, token, fetchImpl = fetch }) {
  const call = async (method, p, body) => {
    const r = await fetchImpl(`https://api.github.com/repos/${repo}${p}`, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'architecture-of-light-keeper' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) })
    if (r.status === 404 && method === 'GET') return null
    if (!r.ok) {
      const e = new Error(`${method} ${p}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`)
      e.status = r.status
      throw e
    }
    return r.status === 204 ? {} : r.json()
  }
  return {
    async lastRunAt() {
      const f = await call('GET', '/contents/state/runs.json?ref=data')
      if (!f?.content) return null
      try { return JSON.parse(Buffer.from(f.content, 'base64').toString('utf8'))?.last_run?.at ?? null } catch { return null }
    },
    /** Whether a run of the workflow is queued, waiting or running, and when the keeper (the run's own token, actor
     *  github-actions[bot]) last dispatched one. */
    async runs(workflow) {
      const j = await call('GET', `/actions/workflows/${workflow}/runs?per_page=30`)
      const list = j?.workflow_runs || []
      // A dispatch that a later run cancelled while it waited (one pending run per concurrency group) never ran: it does
      // not hold the next one back.
      const mine = list.filter((r) => r.event === 'workflow_dispatch' && r.conclusion !== 'cancelled' && (r.triggering_actor?.login || r.actor?.login) === 'github-actions[bot]')
      return { busy: list.some((r) => ACTIVE.has(r.status)), lastDispatchAt: mine.map((r) => r.created_at).sort().pop() || null }
    },
    run: (id) => call('GET', `/actions/runs/${id}`),
    dispatch: (workflow, ref, inputs) => call('POST', `/actions/workflows/${workflow}/dispatches`, { ref, inputs }),
    async alertIssue() {
      const j = await call('GET', '/issues?state=open&per_page=100')
      return (j || []).find((i) => !i.pull_request && i.title === ISSUE_TITLE) || null
    },
    openIssue: (body) => call('POST', '/issues', { title: ISSUE_TITLE, body }),
    comment: (n, body) => call('POST', `/issues/${n}/comments`, { body }),
  }
}

/** One look: dispatch when due; open or comment on the alert issue while stalled. Returns the plan. */
export async function look(gh, { hours = 6, stallHours = 13, retryHours = 2, ref = 'main', now = Date.now(), log = console.log }) {
  const lastRunAt = await gh.lastRunAt()
  const { busy: archiveBusy, lastDispatchAt } = await gh.runs('archive.yml')
  const p = plan({ lastRunAt, now, hours, stallHours, retryHours, archiveBusy, lastDispatchAt })
  log(`[keeper] last collect ${lastRunAt || 'none'}; last keeper dispatch ${lastDispatchAt || 'none'}; ${p.reason}`)
  if (p.dispatch) {
    await gh.dispatch('archive.yml', ref, { collect: 'true', gated: 'true', min_hours: String(hours) })
    log('[keeper] dispatched archive.yml (gated)')
  }
  if (!p.stalled) return p
  const issue = await gh.alertIssue()
  const text = `## Collection stalled (keeper)\n\n- ❗ ${p.age.toFixed(1)} hours since the last collect (${lastRunAt}), more than ${stallHours}\n- ${p.dispatch ? 'the keeper dispatched a gated collect run just now' : `the keeper did not dispatch a collect run now (${p.reason})`}\n- check the latest runs of Actions → archive for a failure, and docs/PIPELINE.md "Keeper"; the health job of the next archive run that collects closes this issue when all is well\n`
  if (!issue) {
    await gh.openIssue(text)
    log('[keeper] opened the alert issue')
  } else if (now - Date.parse(issue.updated_at || 0) > 24 * H) {
    await gh.comment(issue.number, text)
    log('[keeper] commented on the alert issue')
  }
  return p
}

/** How a link spends its time: one look when GitHub already held it (the keeper-wait timer; a link that waited 15
 *  minutes or more for any reason chains on at once too), else looks on its runner for up to the budget. Pure. */
export function linkMode({ createdAt, startedAt = Date.now(), heldMinutes = 15 }) {
  const waited = (startedAt - Date.parse(createdAt || '')) / 60e3
  return Number.isFinite(waited) && waited >= heldMinutes ? { mode: 'once', waited } : { mode: 'runner', waited: Number.isFinite(waited) ? waited : null }
}

async function retry(fn, tries = 3, log = console.log) {
  for (let i = 1; ; i++) {
    try { return await fn() } catch (e) {
      if (i >= tries || e.status === 401 || e.status === 403 || e.status === 422) throw e
      log(`[keeper] ${e.message}; retrying`)
      await new Promise((r) => setTimeout(r, 30e3 * i))
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (k, d = '') => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d
  const repo = arg('repo'), token = process.env.GITHUB_TOKEN
  if (!repo || !token) { console.error('[keeper] needs --repo and GITHUB_TOKEN'); process.exit(2) }
  const opts = { hours: Number(arg('hours', '6')), stallHours: Number(arg('stall-hours', '13')), retryHours: Number(arg('retry-hours', '2')), ref: arg('ref', 'main') }
  const budget = Number(arg('budget-minutes', '300')) * 60e3
  const gh = github({ repo, token }), started = Date.now()
  let mode = { mode: 'runner', waited: null }
  if (process.env.GITHUB_RUN_ID) {
    try { mode = linkMode({ createdAt: (await gh.run(process.env.GITHUB_RUN_ID))?.created_at, startedAt: started }) } catch (e) { console.log(`::warning::[keeper] could not read this run: ${e.message}`) }
  }
  console.log(`[keeper] link mode ${mode.mode}${mode.waited === null ? '' : ` (held ${mode.waited.toFixed(0)} min before it started)`}`)
  let authFailed = false
  for (;;) {
    let p
    try { p = await look(gh, opts) } catch (e) {
      console.log(`::${e.status === 401 || e.status === 403 ? 'error' : 'warning'}::[keeper] ${e.message}`)
      if (e.status === 401 || e.status === 403) { authFailed = true; break }
      p = { nextMs: 15 * 60e3 }
    }
    if (mode.mode === 'once') break
    // Sleep within this link's budget, then look again; the link ends (and starts the next one) only when the budget is
    // spent, so a link lasts about budget-minutes however soon the next collect is due: never a tight loop.
    const left = budget - (Date.now() - started)
    if (left < 60e3) break
    const wait = Math.min(p.nextMs, left)
    console.log(`[keeper] next look in ${Math.round(wait / 60e3)} min`)
    await new Promise((r) => setTimeout(r, wait))
  }
  if (authFailed) {
    // Not worked around: the run's token lacks a permission (keeper.yml "permissions") or Actions is restricted for the
    // repository (Settings → Actions → General → Workflow permissions). The chain stops here; the archive runs and the
    // keeper schedule start it again once that is fixed.
    console.log('::error title=keeper stopped::The keeper could not use its GITHUB_TOKEN. See docs/PIPELINE.md "Keeper".')
    process.exitCode = 1
  } else {
    // The next link, dispatched from main where keeper.yml lives; the keeper concurrency group keeps one pending run.
    try { await retry(() => gh.dispatch('keeper.yml', 'main', {})); console.log('[keeper] started the next link') } catch (e) { console.log(`::error::[keeper] could not start the next link: ${e.message}`); process.exitCode = 1 }
  }
}
