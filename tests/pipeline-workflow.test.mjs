// The Pages repository workflow (deploy/pages-repo/.github/workflows/archive.yml, docs/STATIC_ARCHIVE.md) and the
// scripts its jobs run: triggers, concurrency, permissions, job order and conditions, Node 22, the site URL, the
// copy of the data, the live check, the bot identity of every commit, idempotent commits and bounded history (with
// real git repositories in a temporary directory).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, rm, mkdir, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runSummary } from '../pipeline/run.mjs'

const run = promisify(execFile)
const root = path.resolve(import.meta.dirname, '..')
const pages = path.join(root, 'deploy/pages-repo')
const workflowFile = path.join(pages, '.github/workflows/archive.yml')
// The same workflow at the root of the source branch (this project's .github/): a push to source starts it.
const sourceWorkflowFile = path.join(root, '.github/workflows/archive.yml')
// Repository secrets the collect step may read (docs/PIPELINE.md "Keys"); nothing else may name a secret.
const SECRETS = ['TOURAPI_SERVICE_KEY', 'TOURAPI_PHOTO_SERVICE_KEY', 'SEOUL_OPEN_DATA_KEY', 'FLICKR_API_KEY', 'OPENVERSE_CLIENT_ID', 'OPENVERSE_CLIENT_SECRET', 'UNSPLASH_ACCESS_KEY', 'PEXELS_API_KEY', 'NAVER_API_KEY_ID', 'NAVER_API_KEY', 'BRAVE_API_KEY']
let YAML = null
try { YAML = createRequire(path.join(root, 'pipeline/package.json'))('yaml') } catch {}
const needYaml = { skip: YAML ? false : 'yaml is not installed (npm ci --prefix pipeline)' }
const text = await readFile(workflowFile, 'utf8')
const steps = (job) => job.steps || []
const runs = (job) => steps(job).map((s) => s.run || '').join('\n')

test('the Pages repository files exist: workflow, README, empty .nojekyll', async () => {
  assert.ok(existsSync(workflowFile))
  assert.equal((await stat(path.join(pages, '.nojekyll'))).size, 0)
  const readme = await readFile(path.join(pages, 'README.md'), 'utf8')
  for (const s of ['https://remona8787.github.io/', 'Deploy from a branch', 'Read and write permissions', '[collect]', 'editorial/decisions/', 'source', 'data']) assert.ok(readme.includes(s), s)
})

test('archive.yml: the copy at the source branch root is identical to the canonical copy', async () => {
  assert.ok(existsSync(sourceWorkflowFile), '.github/workflows/archive.yml on the source branch')
  assert.equal(await readFile(sourceWorkflowFile, 'utf8'), text, 'cp deploy/pages-repo/.github/workflows/archive.yml .github/workflows/archive.yml')
})

test('archive.yml: triggers, concurrency, permissions, environment', needYaml, () => {
  const wf = YAML.parse(text)
  assert.equal(wf.name, 'archive')
  assert.deepEqual(wf.on.schedule, [{ cron: '17 */6 * * *' }, { cron: '47 * * * *' }], 'every six hours, plus the gated hourly catch-up')
  assert.ok('workflow_dispatch' in wf.on)
  assert.equal(wf.on.workflow_dispatch.inputs.collect.type, 'boolean')
  assert.deepEqual(wf.on.push, { branches: ['source'] })
  assert.deepEqual(Object.keys(wf.on).sort(), ['push', 'schedule', 'workflow_dispatch'], 'no pull_request trigger: never runs code from forks')
  assert.deepEqual(wf.concurrency, { group: 'archive', 'cancel-in-progress': false }, 'one run at a time; a running one is never cancelled')
  assert.deepEqual(wf.jobs.deploy.concurrency, { group: 'archive-deploy', 'cancel-in-progress': false }, 'a running deploy is never cancelled')
  assert.deepEqual(wf.permissions, { contents: 'write', issues: 'write' })
  assert.equal(wf.env.NODE_VERSION, '22')
  assert.equal(wf.env.SITE_URL, 'https://remona8787.github.io')
  assert.deepEqual(Object.keys(wf.jobs), ['collect', 'deploy', 'verify-live', 'health', 'keeper'])
  assert.equal(wf.on.workflow_dispatch.inputs.gated.type, 'boolean')
  assert.equal(wf.on.workflow_dispatch.inputs.gated.default, false, 'a manual run collects unless told otherwise')
  assert.equal(wf.on.workflow_dispatch.inputs.min_hours.default, 6)
})

test('archive.yml (v0.26): the catch-up schedule is gated; the health job always runs and never writes data', needYaml, async () => {
  const wf = YAML.parse(text)
  const steps = wf.jobs.collect.steps
  const gate = steps.find((s) => s.id === 'gate')
  assert.ok(gate, 'a gate step')
  assert.ok(gate.run.includes(`--catch-up='47 * * * *' --gated="$GATED" --min-hours="$MIN_HOURS"`), 'the gate knows the catch-up cron, the keeper flag and the threshold')
  // Only a dispatch with gated=true is gated; every other event gets gated=false and the catch-up threshold 6.5.
  assert.equal(gate.env.GATED, "${{ github.event_name == 'workflow_dispatch' && inputs.gated }}")
  assert.equal(gate.env.MIN_HOURS, "${{ github.event_name == 'workflow_dispatch' && inputs.gated && inputs.min_hours || 6.5 }}")
  // A catch-up the gate skipped publishes and checks nothing: deploy (and so verify-live) wait for a collect that ran
  // or for no collect job at all (a push without [collect]: the output is empty, not 'false').
  assert.equal(wf.jobs.collect.outputs.ran, '${{ steps.gate.outputs.run }}')
  assert.match(wf.jobs.deploy.if, /needs\.collect\.outputs\.ran != 'false'/)
  assert.match(wf.jobs['verify-live'].if, /needs\.deploy\.result == 'success'/)
  const after = steps.slice(steps.indexOf(gate) + 1).filter((s) => s.name !== 'Commit to the data branch')
  for (const s of after) assert.equal(s.if, "steps.gate.outputs.run == 'true'", (s.name || s.uses) + ' waits for the gate')
  const h = wf.jobs.health
  assert.deepEqual(h.needs, ['collect', 'deploy', 'verify-live'])
  assert.equal(h.if, "${{ always() && needs.collect.outputs.ran != 'false' }}", 'always, except after a catch-up the gate skipped')
  assert.ok(!JSON.stringify(h).includes('commit-push'), 'the health job never commits')
  const { decide } = await import('../pipeline/ci/gate.mjs')
  const cu = '47 * * * *', now = Date.parse('2026-11-11T02:47:00Z')
  assert.equal(decide({ schedule: '17 */6 * * *', catchUp: cu, lastRunAt: '2026-11-11T02:00:00Z', now }).run, true, 'the regular schedule always runs')
  assert.equal(decide({ schedule: cu, catchUp: cu, lastRunAt: '2026-11-11T00:30:00Z', now }).run, false, 'the 00:17 run happened: skip')
  assert.equal(decide({ schedule: cu, catchUp: cu, lastRunAt: '2026-11-10T19:46:00Z', now }).run, true, 'the 00:17 slot was skipped by GitHub: catch up')
  // 6.5 hours: the catch-up 30 minutes after a slot runs only when that slot and its predecessor's lateness are covered.
  const at = (iso) => Date.parse(iso)
  assert.equal(decide({ schedule: cu, catchUp: cu, lastRunAt: '2026-11-11T06:17:00Z', now: at('2026-11-11T12:47:00Z') }).run, true, '12:17 never ran (2026-11-11): the 12:47 catch-up collects')
  assert.equal(decide({ schedule: cu, catchUp: cu, lastRunAt: '2026-11-11T06:40:00Z', now: at('2026-11-11T12:47:00Z') }).run, false, 'a late 06:17 run: wait one more hour for 12:17')
  assert.equal(decide({ schedule: cu, catchUp: cu, lastRunAt: '2026-11-11T06:40:00Z', now: at('2026-11-11T13:47:00Z') }).run, true, '... and catch up at 13:47 if it still has not run')
  assert.equal(decide({ schedule: cu, catchUp: cu, lastRunAt: '2026-11-11T12:20:00Z', now: at('2026-11-11T12:47:00Z') }).run, false, 'the 12:17 run happened: the hourly catch-ups skip')
  assert.equal(decide({ schedule: cu, catchUp: cu, lastRunAt: null, now }).run, true)
  assert.equal(decide({ schedule: '', catchUp: cu, lastRunAt: '2026-11-11T02:46:00Z', now }).run, true, 'a push or a dispatch always runs')
  // v1.0.1: a keeper dispatch (gated) collects only when the last collect is min-hours old, whatever triggered that one.
  assert.deepEqual(decide({ gated: true, lastRunAt: '2026-11-10T21:00:00Z', now, minHours: 6 }), { run: false, reason: 'keeper_skipped_last_run_5.8h_ago' })
  assert.deepEqual(decide({ gated: true, lastRunAt: '2026-11-10T20:30:00Z', now, minHours: 6 }), { run: true, reason: 'keeper_last_run_6.3h_ago' })
  assert.deepEqual(decide({ gated: true, lastRunAt: null, now, minHours: 6 }), { run: true, reason: 'keeper_no_previous_run' })
  assert.equal(decide({ schedule: '17 */6 * * *', catchUp: cu, gated: false, lastRunAt: '2026-11-11T02:46:00Z', now }).run, true, 'gated=false changes nothing')
  const { assess } = await import('../pipeline/ci/health.mjs')
  const fine = assess({ runs: { last_run: { at: '2026-11-11T00:30:00Z' }, last_good: { at: '2026-11-10T19:46:50Z' } }, status: { last_check: { outcome: 'unchanged' }, data_changed_at: '2026-11-10T19:46:50Z' }, live: { ok: true }, jobs: { collect: 'success', deploy: 'success', verify: 'success' }, now })
  assert.equal(fine.alert, false)
  const stalled = assess({ runs: { last_run: { at: '2026-11-10T07:00:00Z' } }, status: null, live: { ok: true }, jobs: { collect: 'skipped', deploy: 'success', verify: 'success' }, now })
  assert.equal(stalled.alert, true)
  assert.ok(stalled.problems[0].includes('hours ago'))
  assert.equal(assess({ runs: { last_run: { at: '2026-11-11T00:30:00Z' } }, jobs: { collect: 'failure' }, now }).alert, true)
  assert.equal(assess({ runs: { last_run: { at: '2026-11-11T00:30:00Z' } }, status: { last_check: { outcome: 'kept_previous_drop_guard' } }, now }).alert, true)
  const quiet = assess({ runs: { last_run: { at: '2026-11-11T00:30:00Z' } }, status: { last_check: { outcome: 'unchanged' }, data_changed_at: '2026-11-01T00:00:00Z' }, now })
  assert.equal(quiet.alert, true)
  assert.equal(quiet.problems.length, 0, 'unchanged data is a note, not a failure')
  // v1.0.1: sources. A refused key at once; other failures after four runs in a row; a skipped source never.
  const src = (sources) => assess({ runs: { last_run: { at: '2026-11-11T00:30:00Z' } }, status: { last_check: { outcome: 'unchanged' }, data_changed_at: '2026-11-10T19:46:50Z' }, failures: { sources }, now })
  assert.equal(src({ tourapi: { consecutive_failures: 0, last_error: null, last_success: null } }).alert, false, 'skipped for a missing key: no alert')
  const refused = src({ tourapi: { consecutive_failures: 1, last_error: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', last_success: null } })
  assert.equal(refused.alert, true)
  assert.match(refused.problems[0], /^source tourapi: access refused .*Settings → Secrets and variables → Actions/)
  assert.match(src({ wikidata: { consecutive_failures: 1, last_error: 'HTTP 403 from query.wikidata.org', last_success: '2026-11-10T19:46:50Z' } }).problems[0], /access refused/)
  assert.equal(src({ overpass: { consecutive_failures: 3, last_error: 'timeout', last_success: '2026-11-10T07:00:00Z' } }).alert, false, 'three timeouts in a row: not yet')
  assert.match(src({ overpass: { consecutive_failures: 4, last_error: 'timeout', last_success: '2026-11-10T07:00:00Z' } }).problems[0], /^source overpass: failed 4 runs in a row \(last success 2026-11-10T07:00:00Z\): timeout$/)
  const { ISSUE_TITLE } = await import('../pipeline/ci/health.mjs')
  assert.ok(text.includes(`title="${ISSUE_TITLE}"`), 'the health job and the keeper share one issue title')
})

test('archive.yml: collect → deploy → verify-live with the right conditions', needYaml, () => {
  const { collect, deploy, 'verify-live': verify } = YAML.parse(text).jobs
  // collect: every schedule, on demand unless switched off, on push only with [collect] in the commit message.
  assert.match(collect.if, /github\.event_name == 'schedule'/)
  assert.match(collect.if, /github\.event_name == 'workflow_dispatch' && inputs\.collect/)
  assert.match(collect.if, /github\.event_name == 'push' && contains\(github\.event\.head_commit\.message, '\[collect\]'\)/)
  assert.ok(collect['timeout-minutes'] >= 35, 'the 25 min budget plus setup')
  // deploy: after collect whatever its result, or alone when collect was skipped.
  assert.equal(deploy.needs, 'collect')
  assert.match(deploy.if, /!cancelled\(\)/)
  assert.doesNotMatch(deploy.if, /needs\.collect\.result == 'success'/)
  assert.equal(verify.needs, 'deploy')
  assert.match(verify.if, /needs\.deploy\.result == 'success'/)
  for (const k of ['deploy_id', 'build_id', 'changed']) assert.match(deploy.outputs[k], new RegExp(`steps\\.assemble\\.outputs\\.${k}`))
})

test('archive.yml: what each job runs', needYaml, () => {
  const { collect, deploy, 'verify-live': verify } = YAML.parse(text).jobs
  const checkout = (job, ref, p) => steps(job).find((s) => /^actions\/checkout@/.test(s.uses || '') && s.with?.ref === ref && s.with?.path === p)
  for (const job of [collect, deploy, verify]) {
    assert.ok(checkout(job, 'source', 'source'), 'source checked out')
    const node = steps(job).find((s) => /^actions\/setup-node@/.test(s.uses || ''))
    assert.equal(node.with['node-version'], '${{ env.NODE_VERSION }}')
    for (const s of steps(job)) if (s.uses) assert.match(s.uses, /^actions\/(checkout|setup-node)@v4$/, 'only official actions, pinned to a major version')
  }
  // collect: the data branch (created on the first run), npm ci in pipeline/, run.mjs, commit only after a successful run.
  assert.match(runs(collect), /use-branch\.sh data data/)
  assert.match(runs(collect), /npm ci --prefix source\/pipeline/)
  assert.match(runs(collect), /node source\/pipeline\/run\.mjs --data=data/)
  const commit = steps(collect).find((s) => /commit-push\.sh data data/.test(s.run || ''))
  assert.equal(commit.if, "steps.run.outcome == 'success'")
  // deploy: build with SITE_URL, assemble main from dist + data (site-data → data/, admin-data → data/admin/), commit when changed.
  assert.match(runs(deploy), /npm ci[^\n]*\n\s*npm run build/)
  assert.ok(checkout(deploy, 'main', 'site'))
  assert.match(runs(deploy), /node source\/pipeline\/deploy\.mjs --dist=source\/dist --data=data --site=site/)
  assert.equal(steps(deploy).find((s) => /commit-push\.sh site main/.test(s.run || '')).if, "steps.assemble.outputs.changed == 'true'")
  assert.match(runs(deploy), /cmp -s source\/deploy\/pages-repo\/\.github\/workflows\/archive\.yml site\/\.github\/workflows\/archive\.yml/)
  // verify-live: Chromium on the runner, the live URL, the deploy and build ids, review/live committed to data.
  // A pinned Ubuntu image Playwright supports: on ubuntu-latest (26.04 since Oct 2026) the Chromium install failed.
  assert.equal(verify['runs-on'], 'ubuntu-24.04')
  assert.match(runs(verify), /npx playwright install --with-deps chromium/)
  // A mirror outage must not cost the live check (2026-11-11): bounded retries, then Chromium without system packages.
  assert.match(runs(verify), /for i in 1 2; do\n\s*if timeout 360 npx playwright install --with-deps chromium; then exit 0; fi/)
  assert.match(runs(verify), /done\n\s*npx playwright install chromium\n/)
  const v = steps(verify).find((s) => s.id === 'verify')
  assert.match(v.run, /node pipeline\/verify-live\.mjs --site="\$SITE_URL\/" --out=\.\.\/data\/review\/live --build-id="\$BUILD_ID" --deploy-id="\$DEPLOY_ID"/)
  assert.equal(v.env.DEPLOY_ID, '${{ needs.deploy.outputs.deploy_id }}')
  assert.match(steps(verify).find((s) => /commit-push\.sh data data/.test(s.run || '')).if, /steps\.verify\.outcome != 'skipped'/)
})

test('archive.yml: every commit goes through commit-push.sh (bot identity); no force pushes, secrets only as the collect step\'s env, no untrusted text in scripts', needYaml, () => {
  const wf = YAML.parse(text)
  const all = Object.values(wf.jobs).flatMap(steps)
  for (const s of all.filter((x) => x.run)) {
    assert.doesNotMatch(s.run, /git (push|commit)/, 'git push/commit only inside commit-push.sh')
    assert.doesNotMatch(s.run, /--force|-f\b.*push/)
    assert.doesNotMatch(s.run, /github\.event\.(head_commit|commits|pull_request|issue)/, 'event text never reaches a shell script')
  }
  // Keys reach only the collect step, as environment variables named like the secret; never a script or another job.
  const collectStep = wf.jobs.collect.steps.find((x) => x.id === 'run')
  const named = [...text.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g)].map((m) => m[1])
  assert.deepEqual([...new Set(named)].sort(), [...SECRETS].sort())
  for (const k of SECRETS) assert.equal(collectStep.env[k], `\${{ secrets.${k} }}`, k)
  for (const x of all) if (x !== collectStep) assert.doesNotMatch(JSON.stringify(x), /secrets\./, 'only the collect step reads secrets')
  assert.doesNotMatch(collectStep.run, /secrets|\$\{\{/, 'the script reads keys from its environment')
  assert.doesNotMatch(text, /GITHUB_TOKEN\s*:/, 'no token is passed explicitly')
  for (const f of ['pipeline/ci/use-branch.sh', 'pipeline/ci/commit-push.sh', 'pipeline/run.mjs', 'pipeline/deploy.mjs', 'pipeline/verify-live.mjs', 'pipeline/package-lock.json', 'package-lock.json']) assert.ok(existsSync(path.join(root, f)), f)
})

test('the step summary of a run names the status, counts, images by provider, failures and every source', () => {
  const md = runSummary({
    run: { status: 'partial', publish: 'published', build_id: 'B1', duration_ms: 61000, budget_minutes: 25 },
    counts: { collected: 40, eligible: 30, published: 31, kr: 20, foreign: 11, kr_with_region: 19, new: 1, with_images: 2, with_hero: 1 },
    images: { by_provider: { commons: 12, openverse: 3, tourapi: 0 }, hero: 2, below_threshold: 5, awaiting_review: 4 },
    sources: { wikidata: { status: 'ok', items: 2, consecutive_failures: 0 }, commons: { status: 'error', items: 0, consecutive_failures: 2 } },
    errors: [{ stage: 'commons' }],
  })
  assert.match(md, /Collect: partial \(published\)/)
  assert.match(md, /`B1`, 61 s of a 25 min budget/)
  assert.match(md, /40 collected, 30 eligible, 31 published \(20 Korean, 11 foreign; 19 Korean with a region\)/)
  assert.match(md, /images by provider: commons 12, openverse 3$/m)
  assert.match(md, /2 hero images on the home page, 5 images below their role's width target/)
  assert.match(md, /failures: commons error \(2 in a row\); 1 errors logged/)
  assert.match(md, /\| commons \| error \| 0 \| 2 \|/)
})

// ---------------------------------------------------------------- the CI scripts with real git repositories
async function git(cwd, ...args) { return (await run('git', args, { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } })).stdout.trim() }
const sh = (script, args, cwd) => run('bash', [path.join(root, 'pipeline/ci', script), ...args], { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GITHUB_OUTPUT: '' } })

async function origin() {
  const dir = await mkdtemp(path.join(tmpdir(), 'aol-ci-'))
  const bare = path.join(dir, 'origin.git'), seed = path.join(dir, 'seed')
  await git(dir, 'init', '-q', '--bare', '-b', 'main', bare)
  await git(dir, 'init', '-q', '-b', 'main', seed)
  await mkdir(path.join(seed, '.github/workflows'), { recursive: true })
  await writeFile(path.join(seed, 'README.md'), '# site\n')
  await writeFile(path.join(seed, '.github/workflows/archive.yml'), 'name: archive\n')
  await git(seed, 'add', '-A')
  await git(seed, '-c', 'user.name=t', '-c', 'user.email=t@example.org', 'commit', '-q', '-m', 'init')
  await git(seed, 'push', '-q', bare, 'main')
  return { dir, url: 'file://' + bare, bare }
}
// actions/checkout with ref main and fetch-depth 1.
async function checkout(o, name) { const p = path.join(o.dir, name); await git(o.dir, 'clone', '-q', '--depth', '1', '--branch', 'main', o.url, p); return p }

test('use-branch.sh: a missing branch becomes an empty orphan; an existing one is checked out', async () => {
  const o = await origin()
  try {
    const d = await checkout(o, 'data')
    const first = await sh('use-branch.sh', [d, 'data'])
    assert.match(first.stdout, /exists=false/)
    assert.deepEqual((await readdir(d)).filter((f) => f !== '.git'), [], 'nothing of main stays in the data checkout')
    await mkdir(path.join(d, 'site-data'), { recursive: true })
    await writeFile(path.join(d, 'site-data/manifest.json'), '{}\n')
    await sh('commit-push.sh', [d, 'data', 'Collect B1'])
    const again = await checkout(o, 'data2')
    assert.match((await sh('use-branch.sh', [again, 'data'])).stdout, /exists=true/)
    assert.equal(await readFile(path.join(again, 'site-data/manifest.json'), 'utf8'), '{}\n')
    assert.equal(await git(again, 'rev-parse', '--abbrev-ref', 'HEAD'), 'data')
  } finally { await rm(o.dir, { recursive: true, force: true }) }
})

test('commit-push.sh: github-actions[bot] identity, no empty commits, main keeps its own files', async () => {
  const o = await origin()
  try {
    const site = await checkout(o, 'site')
    await writeFile(path.join(site, 'index.html'), '<!doctype html>\n')
    const out = await sh('commit-push.sh', [site, 'main', 'Deploy abc'])
    assert.match(out.stdout, /pushed/)
    assert.equal(await git(o.bare, 'log', '-1', '--format=%an <%ae>|%cn|%s', 'main'), 'github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>|github-actions[bot]|Deploy abc')
    const before = await git(o.bare, 'rev-parse', 'main')
    assert.match((await sh('commit-push.sh', [site, 'main', 'Deploy abc'])).stdout, /nothing to commit/)
    assert.equal(await git(o.bare, 'rev-parse', 'main'), before, 'idempotent: no change, no commit')
    assert.equal(await git(o.bare, 'show', 'main:README.md'), '# site')
  } finally { await rm(o.dir, { recursive: true, force: true }) }
})

test('commit-push.sh: history over the limit is compacted into one snapshot commit with the same tree', async () => {
  const o = await origin()
  try {
    const d = await checkout(o, 'data')
    await sh('use-branch.sh', [d, 'data'])
    for (let i = 1; i <= 3; i++) {
      // Each run starts from a fresh shallow checkout, as on Actions.
      const c = i === 1 ? d : await checkout(o, 'data-' + i)
      if (i > 1) await sh('use-branch.sh', [c, 'data'])
      await writeFile(path.join(c, `run-${i}.json`), `{"run":${i}}\n`)
      await sh('commit-push.sh', [c, 'data', `Collect ${i}`, '2'])
    }
    assert.equal(await git(o.bare, 'rev-list', '--count', 'data'), '3', 'below the limit: ordinary commits')
    const c = await checkout(o, 'data-4')
    await sh('use-branch.sh', [c, 'data'])
    await writeFile(path.join(c, 'run-4.json'), '{"run":4}\n')
    const out = await sh('commit-push.sh', [c, 'data', 'Collect 4', '2'])
    assert.match(out.stdout, /compacted/)
    assert.equal(await git(o.bare, 'rev-list', '--count', 'data'), '1')
    assert.deepEqual((await git(o.bare, 'ls-tree', '--name-only', 'data')).split('\n'), ['run-1.json', 'run-2.json', 'run-3.json', 'run-4.json'])
    assert.equal(await git(o.bare, 'log', '-1', '--format=%an|%s', 'data'), 'github-actions[bot]|Collect 4')
    assert.equal(await git(o.bare, 'rev-list', '--count', 'main'), '1', 'other branches untouched')
  } finally { await rm(o.dir, { recursive: true, force: true }) }
})

test('keeper.yml (v1.0.1): a dispatch chain with its own restart schedule; archive runs restart it; least privilege', needYaml, async () => {
  const keeperFile = path.join(pages, '.github/workflows/keeper.yml')
  const ktext = await readFile(keeperFile, 'utf8')
  assert.equal(await readFile(path.join(root, '.github/workflows/keeper.yml'), 'utf8'), ktext, 'cp deploy/pages-repo/.github/workflows/keeper.yml .github/workflows/keeper.yml')
  const k = YAML.parse(ktext)
  assert.equal(k.name, 'keeper')
  assert.deepEqual(Object.keys(k.on).sort(), ['schedule', 'workflow_dispatch'], 'no push or pull_request trigger')
  assert.deepEqual(k.on.schedule, [{ cron: '29 */4 * * *' }], 'a restart schedule off the archive minutes')
  assert.deepEqual(k.concurrency, { group: 'keeper', 'cancel-in-progress': false }, 'one link at a time, one pending')
  assert.deepEqual(k.permissions, { actions: 'write', contents: 'read', issues: 'write' }, 'dispatch runs and open issues; never write code or data')
  assert.deepEqual(Object.keys(k.jobs), ['keep'])
  const keep = k.jobs.keep
  assert.equal(keep.environment, 'keeper-wait', 'the operator can add a wait timer there')
  assert.ok(keep['timeout-minutes'] <= 340 && keep['timeout-minutes'] > 300, 'the budget plus setup, under the six-hour job limit')
  assert.ok(steps(keep).some((s) => /^actions\/checkout@/.test(s.uses || '') && s.with?.ref === 'source' && s.with?.['sparse-checkout'] === 'pipeline/ci'))
  const step = steps(keep).find((s) => /keeper\.mjs/.test(s.run || ''))
  assert.match(step.run, /^node pipeline\/ci\/keeper\.mjs --repo="\$\{\{ github\.repository \}\}" --hours="\$HOURS" --stall-hours=13 --retry-hours=2 --budget-minutes="\$BUDGET"$/)
  assert.equal(step.env.GITHUB_TOKEN, '${{ github.token }}', 'the run\'s own token, nothing else')
  assert.doesNotMatch(ktext, /secrets\./, 'no repository secret')
  // archive.yml: every run but the keeper's own (gated) starts a keeper when none is active; its token may only dispatch.
  const a = YAML.parse(text).jobs.keeper
  assert.equal(a.if, "${{ !(github.event_name == 'workflow_dispatch' && inputs.gated) }}")
  assert.deepEqual(a.permissions, { actions: 'write', contents: 'read' })
  assert.match(runs(a), /actions\/workflows\/keeper\.yml\/runs/)
  assert.match(runs(a), /gh workflow run keeper\.yml --repo "\$REPO" --ref main/)
  for (const st of ['queued', 'in_progress', 'waiting', 'pending', 'requested']) assert.ok(runs(a).includes(`"${st}"`), st)
  const tokens = Object.entries(YAML.parse(text).jobs).filter(([, j]) => JSON.stringify(j).includes('github.token')).map(([n]) => n)
  assert.deepEqual(tokens, ['health', 'keeper'], 'only the health (issues) and keeper (dispatch) jobs hand their token to gh')
  // The deploy job warns when main's keeper.yml drifts from the canonical copy.
  assert.match(runs(YAML.parse(text).jobs.deploy), /cmp -s source\/deploy\/pages-repo\/\.github\/workflows\/keeper\.yml site\/\.github\/workflows\/keeper\.yml/)
})
