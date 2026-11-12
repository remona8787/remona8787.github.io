// The collect keeper (pipeline/ci/keeper.mjs, keeper.yml, docs/PIPELINE.md "Keeper"): when it dispatches a collect,
// how it avoids duplicates and retry storms, the alert issue it opens or comments on while stalled, and the link mode.
import test from 'node:test'
import assert from 'node:assert/strict'
import { plan, look, linkMode, github } from '../pipeline/ci/keeper.mjs'
import { ISSUE_TITLE } from '../pipeline/ci/health.mjs'

const at = (iso) => Date.parse(iso)
const now = at('2026-11-12T08:00:00Z')

test('plan: a collect is due six hours after the last one, never while archive is busy', () => {
  assert.deepEqual(plan({ lastRunAt: '2026-11-12T03:00:00Z', now }), { age: 5, due: false, dispatch: false, stalled: false, retryWait: false, nextMs: (1 * 3600 + 600) * 1e3, reason: 'not_due_5.0h' })
  const due = plan({ lastRunAt: '2026-11-12T01:30:00Z', now })
  assert.equal(due.dispatch, true)
  assert.equal(due.reason, 'due_6.5h')
  assert.equal(due.nextMs, 30 * 60e3, 'look again in half an hour')
  const busy = plan({ lastRunAt: '2026-11-12T01:30:00Z', now, archiveBusy: true })
  assert.deepEqual([busy.due, busy.dispatch, busy.reason], [true, false, 'due_6.5h_archive_busy'], 'a running or queued archive run may be the collect')
  assert.equal(plan({ lastRunAt: null, now }).dispatch, true, 'no recorded collect: collect')
  assert.equal(plan({ lastRunAt: null, now }).stalled, false, 'a first run is not a stall')
  assert.ok(plan({ lastRunAt: '2026-11-12T07:59:00Z', now }).nextMs >= 10 * 60e3)
})

test('plan: a dispatched collect that has not recorded itself is retried after retry_hours, not on every look', () => {
  const last = '2026-11-11T20:00:00Z'
  const wait = plan({ lastRunAt: last, now, lastDispatchAt: '2026-11-12T07:00:00Z' })
  assert.deepEqual([wait.due, wait.dispatch, wait.retryWait, wait.reason], [true, false, true, 'due_12.0h_retry_in_1.0h'])
  assert.equal(wait.nextMs, 3600e3 + 60e3)
  assert.equal(plan({ lastRunAt: last, now, lastDispatchAt: '2026-11-12T05:30:00Z' }).dispatch, true, 'two hours on: retry')
  assert.equal(plan({ lastRunAt: last, now, lastDispatchAt: '2026-11-11T19:00:00Z' }).dispatch, true, 'a dispatch before the last collect does not hold the next one')
  assert.equal(plan({ lastRunAt: last, now, lastDispatchAt: '2026-11-12T07:00:00Z', retryHours: 0.5 }).dispatch, true)
})

test('plan: stalled after stall_hours', () => {
  assert.equal(plan({ lastRunAt: '2026-11-11T19:30:00Z', now }).stalled, false, '12.5 h')
  assert.equal(plan({ lastRunAt: '2026-11-11T18:30:00Z', now }).stalled, true, '13.5 h')
})

function fakeGitHub({ lastRunAt = null, busy = false, lastDispatchAt = null, issue = null } = {}) {
  const calls = []
  return {
    calls,
    lastRunAt: async () => lastRunAt,
    runs: async (w) => { calls.push(['runs', w]); return { busy, lastDispatchAt } },
    dispatch: async (...a) => { calls.push(['dispatch', ...a]); return {} },
    alertIssue: async () => { calls.push(['alertIssue']); return issue },
    openIssue: async (b) => { calls.push(['open', b]); return { number: 9 } },
    comment: async (n, b) => { calls.push(['comment', n, b]); return {} },
  }
}
const quiet = () => {}

test('look: dispatches one gated archive run on main when due, nothing when not', async () => {
  const gh = fakeGitHub({ lastRunAt: '2026-11-12T01:00:00Z' })
  const p = await look(gh, { now, log: quiet })
  assert.equal(p.dispatch, true)
  assert.deepEqual(gh.calls.filter((c) => c[0] === 'dispatch'), [['dispatch', 'archive.yml', 'main', { collect: 'true', gated: 'true', min_hours: '6' }]])
  const idle = fakeGitHub({ lastRunAt: '2026-11-12T05:00:00Z' })
  await look(idle, { now, log: quiet })
  assert.deepEqual(idle.calls, [['runs', 'archive.yml']], 'not due and not stalled: only reads')
  const busy = fakeGitHub({ lastRunAt: '2026-11-12T01:00:00Z', busy: true })
  await look(busy, { now, log: quiet })
  assert.ok(!busy.calls.some((c) => c[0] === 'dispatch'), 'archive busy: no second run')
})

test('look: opens the alert issue once, comments at most daily, leaves closing to the health job', async () => {
  const stalled = fakeGitHub({ lastRunAt: '2026-11-11T16:00:00Z' })
  await look(stalled, { now, log: quiet })
  const opened = stalled.calls.find((c) => c[0] === 'open')
  assert.ok(opened, 'opened')
  assert.match(opened[1], /Collection stalled/)
  assert.match(opened[1], /16\.0 hours since the last collect/)
  assert.match(opened[1], /dispatched a gated collect run/)
  const held = fakeGitHub({ lastRunAt: '2026-11-11T16:00:00Z', busy: true })
  await look(held, { now, log: quiet })
  assert.match(held.calls.find((c) => c[0] === 'open')[1], /did not dispatch a collect run now \(due_16\.0h_archive_busy\)/)
  const fresh = fakeGitHub({ lastRunAt: '2026-11-11T16:00:00Z', issue: { number: 4, updated_at: '2026-11-12T02:00:00Z' } })
  await look(fresh, { now, log: quiet })
  assert.ok(!fresh.calls.some((c) => c[0] === 'open' || c[0] === 'comment'), 'already open and updated today: no duplicate, no comment')
  const old = fakeGitHub({ lastRunAt: '2026-11-10T16:00:00Z', issue: { number: 4, updated_at: '2026-11-11T06:00:00Z' } })
  await look(old, { now, log: quiet })
  assert.deepEqual(old.calls.filter((c) => c[0] === 'comment').map((c) => c[1]), [4])
  const back = fakeGitHub({ lastRunAt: '2026-11-12T07:00:00Z', issue: { number: 4, updated_at: '2026-11-12T02:00:00Z' } })
  await look(back, { now, log: quiet })
  assert.deepEqual(back.calls, [['runs', 'archive.yml']], 'a collect ran: the health job of that run closes the issue when all is well')
})

test('linkMode: one look when GitHub held the run (wait timer), else looks on the runner', () => {
  assert.equal(linkMode({ createdAt: '2026-11-12T07:00:00Z', startedAt: now }).mode, 'once')
  assert.equal(linkMode({ createdAt: '2026-11-12T07:58:00Z', startedAt: now }).mode, 'runner')
  assert.deepEqual(linkMode({ createdAt: null, startedAt: now }), { mode: 'runner', waited: null })
})

test('github(): the REST calls, the token only in the Authorization header, the keeper\'s own dispatches', async () => {
  const seen = []
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) })
  const fetchImpl = async (url, o) => {
    seen.push([o.method, url.replace('https://api.github.com/repos/o/r', ''), o.headers.authorization, o.body ? JSON.parse(o.body) : undefined])
    if (url.includes('/contents/state/runs.json')) return reply(200, { content: Buffer.from(JSON.stringify({ last_run: { at: '2026-11-12T01:00:00Z' } })).toString('base64') })
    if (url.includes('/actions/workflows/archive.yml/runs')) return reply(200, { workflow_runs: [
      { status: 'completed', event: 'workflow_dispatch', triggering_actor: { login: 'github-actions[bot]' }, created_at: '2026-11-12T05:00:00Z' },
      { status: 'completed', conclusion: 'cancelled', event: 'workflow_dispatch', triggering_actor: { login: 'github-actions[bot]' }, created_at: '2026-11-12T05:30:00Z' },
      { status: 'completed', event: 'workflow_dispatch', triggering_actor: { login: 'someone' }, created_at: '2026-11-12T06:00:00Z' },
      { status: 'completed', event: 'schedule', triggering_actor: { login: 'someone' }, created_at: '2026-11-12T07:00:00Z' },
    ] })
    if (url.includes('/issues?')) return reply(200, [{ number: 2, title: 'other' }, { number: 3, title: ISSUE_TITLE, pull_request: {} }, { number: 5, title: ISSUE_TITLE }])
    if (url.includes('/dispatches')) return reply(204, null)
    if (url.endsWith('/issues') && o.method === 'POST') return reply(201, { number: 7 })
    return reply(404, { message: 'Not Found' })
  }
  const gh = github({ repo: 'o/r', token: 't0k', fetchImpl })
  assert.equal(await gh.lastRunAt(), '2026-11-12T01:00:00Z')
  assert.deepEqual(await gh.runs('archive.yml'), { busy: false, lastDispatchAt: '2026-11-12T05:00:00Z' }, 'only the run token\'s dispatches that were not cancelled count')
  assert.equal((await gh.alertIssue()).number, 5, 'the alert issue by its exact title; pull requests are not issues')
  await gh.openIssue('body')
  assert.deepEqual(seen.at(-1), ['POST', '/issues', 'Bearer t0k', { title: ISSUE_TITLE, body: 'body' }])
  assert.deepEqual(await gh.dispatch('archive.yml', 'main', { gated: 'true' }), {})
  assert.ok(seen.every((c) => c[2] === 'Bearer t0k'))
  assert.ok(seen.some((c) => c[1] === '/issues?state=open&per_page=100'))
  assert.deepEqual(seen.at(-1), ['POST', '/actions/workflows/archive.yml/dispatches', 'Bearer t0k', { ref: 'main', inputs: { gated: 'true' } }])
  const denied = github({ repo: 'o/r', token: 'x', fetchImpl: async () => reply(403, { message: 'Resource not accessible by integration' }) })
  await assert.rejects(denied.dispatch('archive.yml', 'main', {}), (e) => e.status === 403)
  assert.equal(await github({ repo: 'o/r', token: 'x', fetchImpl: async () => reply(404, {}) }).lastRunAt(), null, 'no data branch yet')
})
