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
const SECRETS = ['TOURAPI_SERVICE_KEY', 'SEOUL_OPEN_DATA_KEY', 'FLICKR_API_KEY', 'OPENVERSE_CLIENT_ID', 'OPENVERSE_CLIENT_SECRET', 'UNSPLASH_ACCESS_KEY', 'PEXELS_API_KEY', 'NAVER_API_KEY_ID', 'NAVER_API_KEY', 'BRAVE_API_KEY']
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
  assert.deepEqual(wf.on.schedule, [{ cron: '17 */6 * * *' }])
  assert.ok('workflow_dispatch' in wf.on)
  assert.equal(wf.on.workflow_dispatch.inputs.collect.type, 'boolean')
  assert.deepEqual(wf.on.push, { branches: ['source'] })
  assert.deepEqual(Object.keys(wf.on).sort(), ['push', 'schedule', 'workflow_dispatch'], 'no pull_request trigger: never runs code from forks')
  assert.deepEqual(wf.concurrency, { group: 'archive', 'cancel-in-progress': false }, 'one run at a time; a running one is never cancelled')
  assert.deepEqual(wf.jobs.deploy.concurrency, { group: 'archive-deploy', 'cancel-in-progress': false }, 'a running deploy is never cancelled')
  assert.deepEqual(wf.permissions, { contents: 'write' })
  assert.equal(wf.env.NODE_VERSION, '22')
  assert.equal(wf.env.SITE_URL, 'https://remona8787.github.io')
  assert.deepEqual(Object.keys(wf.jobs), ['collect', 'deploy', 'verify-live'])
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
  assert.match(runs(verify), /npx playwright install --with-deps chromium/)
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
