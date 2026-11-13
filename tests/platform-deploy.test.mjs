// scripts/platform-deploy.mjs (the platform workflow) without a network: what it sends, what it refuses, what it reports.
// The SQL path itself (base, complete-backend.sql, platform-v2.sql, Vault, schedules, twice) was run against a local
// Supabase stack (Postgres 17); the Management API calls are checked here with a stand-in server.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { publicConfig, vaultSQL, authPatch, readiness, makeDeps, inspect, apply, summary, FUNCTIONS, INSPECT_SQL } from '../scripts/platform-deploy.mjs'
import { platformBundle, BUNDLE, PLATFORM_MIGRATIONS } from '../scripts/platform-bundle-sql.mjs'

const SECRET = 'a'.repeat(40), TOKEN = 'sbp_' + 'f'.repeat(40)
const cfg = publicConfig()

test('the project and its public key come from release/launch/public-config.js', () => {
  assert.equal(cfg.ref, 'refwrdfxbhcsguweicle')
  assert.match(cfg.publishable, /^sb_publishable_/)
  assert.throws(() => publicConfig("SUPABASE_URL:'https://evil.example',SUPABASE_PUBLISHABLE_KEY:'x'"))
})

test('platform-v2.sql is the four v2 migrations, in order, in one transaction', async () => {
  const file = readFileSync(new URL('../' + BUNDLE, import.meta.url), 'utf8')
  assert.equal(file, await platformBundle(), 'run npm run platform:bundle-sql after changing a migration')
  assert.deepEqual([...file.matchAll(/^-- SOURCE: migrations\/(.+)$/gm)].map((m) => m[1]), PLATFORM_MIGRATIONS)
  assert.equal(file.match(/^begin;$/gm).length, 1); assert.equal(file.match(/^commit;$/gm).length, 1)
})

test('Vault SQL takes only plain values: the cron secret is checked before it is placed in SQL', () => {
  for (const bad of ['', 'short', "x".repeat(31), "a'); drop table x; --" + 'a'.repeat(30), 'a'.repeat(39) + '$', 'a'.repeat(201)]) assert.throws(() => vaultSQL({ url: cfg.url, publishable: cfg.publishable, cronSecret: bad }), /MODERATION_CRON_SECRET/)
  assert.throws(() => vaultSQL({ url: "https://x.supabase.co'--", publishable: cfg.publishable, cronSecret: SECRET }))
  const sql = vaultSQL({ url: cfg.url, publishable: cfg.publishable, cronSecret: SECRET })
  assert.match(sql, /vault\.update_secret/); assert.match(sql, /if not exists\(select 1 from vault\.secrets where name='project_url'\)/)
})

test('Auth settings: only what the platform needs, never weaker than now', () => {
  const site = 'https://remona8787.github.io'
  assert.deepEqual(authPatch({ mailer_autoconfirm: true, password_min_length: 6, mfa_totp_enroll_enabled: false, mfa_totp_verify_enabled: true, site_url: 'http://localhost:3000', uri_allow_list: '' }, site),
    { mailer_autoconfirm: false, password_min_length: 12, mfa_totp_enroll_enabled: true, site_url: site, uri_allow_list: site + '/**' })
  assert.deepEqual(authPatch({ mailer_autoconfirm: false, password_min_length: 16, mfa_totp_enroll_enabled: true, mfa_totp_verify_enabled: true, site_url: site, uri_allow_list: 'https://other.example/**,' + site + '/**' }, site), {})
  assert.equal(authPatch({ site_url: 'https://own.example', uri_allow_list: 'https://own.example/**' }, site).uri_allow_list, 'https://own.example/**,' + site + '/**')
  assert.equal(authPatch({ site_url: 'https://own.example' }, site).site_url, undefined, 'an operator-set site URL is kept')
})

// A stand-in Management API: records every request; answers like the real one for a project in the v0.15 state.
function fakeApi({ db, auth, functions = [], secrets = [] }) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.authorization, body: init.body ? JSON.parse(init.body) : null })
    const p = new URL(url).pathname, ok = (j) => ({ ok: true, status: 200, text: async () => JSON.stringify(j) })
    if (p === `/v1/projects/${cfg.ref}`) return ok({ name: 'architecture-of-light', region: 'ap-northeast-2', status: 'ACTIVE_HEALTHY' })
    if (p.endsWith('/database/query')) return ok([{ report: db }])
    if (p.endsWith('/config/auth')) return ok({ ...auth, smtp_pass: 'never-shown', smtp_host: '' })
    if (p.endsWith('/functions')) return ok(functions)
    if (p.endsWith('/secrets')) return ok(secrets.map((name) => ({ name, value: 'digest' })))
    return { ok: false, status: 404, text: async () => 'not found' }
  }
  return { calls, fetchImpl }
}
const V015 = { base: true, complete_backend: false, research: false, platform: false, photo_grades: false, admin_members: false, buckets: [{ id: 'place-images', public: true }], places: { all: 50, published: 49 }, staff: {}, cron: [], vault: [] }

test('inspect only reads: four GETs and one query, with the token in the header only; the report names what is missing', async () => {
  const f = fakeApi({ db: V015, auth: { mailer_autoconfirm: true, password_min_length: 6 } })
  const d = makeDeps({ SUPABASE_ACCESS_TOKEN: TOKEN }, f.fetchImpl)
  const s = await inspect(d)
  assert.deepEqual(f.calls.map((c) => c.method).sort(), ['GET', 'GET', 'GET', 'GET', 'POST'])
  const q = f.calls.find((c) => c.method === 'POST')
  assert.equal(q.body.query, INSPECT_SQL); assert.doesNotMatch(INSPECT_SQL, /\b(insert|update|delete|drop|alter|truncate)\b/i)
  assert.ok(f.calls.every((c) => c.auth === 'Bearer ' + TOKEN && c.url.startsWith('https://api.supabase.com/v1/projects/' + cfg.ref)))
  const by = Object.fromEntries(s.checks.map((c) => [c.item, c.ok]))
  assert.equal(by['base schema (places)'], true); assert.equal(by['platform-v2.sql'], false); assert.equal(by['e-mail confirmation required'], false)
  for (const fn of FUNCTIONS) assert.equal(by['function ' + fn], false)
  const md = summary('t', s.checks)
  assert.ok(!md.includes(TOKEN) && !JSON.stringify(s).includes('never-shown'), 'no token or SMTP password in the report')
})

test('apply refuses without the typed project ref, before any request', async () => {
  const f = fakeApi({ db: V015, auth: {} })
  for (const CONFIRM_REF of [undefined, '', 'yes', 'abcdefghijklmnopqrst']) {
    const d = makeDeps({ SUPABASE_ACCESS_TOKEN: TOKEN, MODERATION_CRON_SECRET: SECRET, CONFIRM_REF }, f.fetchImpl)
    await assert.rejects(apply(d, () => {}), /confirm = refwrdfxbhcsguweicle/)
  }
  const d = makeDeps({ SUPABASE_ACCESS_TOKEN: TOKEN, MODERATION_CRON_SECRET: 'weak', CONFIRM_REF: cfg.ref }, f.fetchImpl)
  await assert.rejects(apply(d, () => {}), /MODERATION_CRON_SECRET/)
  assert.equal(f.calls.length, 0)
})

test('readiness: a fully installed project passes every required check; the classifier key stays optional', () => {
  const db = { ...V015, complete_backend: true, research: true, platform: true, photo_grades: true, admin_members: true,
    buckets: [{ id: 'community-photos', public: true }, { id: 'community-uploads', public: false }, { id: 'research-datasets', public: false }],
    cron: [{ name: 'aol-moderate-queue' }, { name: 'aol-platform-expire' }], vault: ['moderation_cron_secret', 'project_url', 'publishable_key'], staff: { admin: 1 }, settings: { require_staff_mfa: true } }
  const checks = readiness({ project: { status: 'ACTIVE_HEALTHY' }, db, auth: { mailer_autoconfirm: false, password_min_length: 12, mfa_totp_enroll_enabled: true, mfa_totp_verify_enabled: true, smtp_configured: true },
    functions: FUNCTIONS.map((slug) => ({ slug, status: 'ACTIVE', verify_jwt: false, version: 1 })), secrets: ['ALLOWED_ORIGINS', 'MODERATION_CRON_SECRET'] })
  assert.deepEqual(checks.filter((c) => c.ok === false), [])
  assert.equal(checks.find((c) => c.item.startsWith('context classifier')).ok, null)
})

test('platform.yml: run by hand only, read-only token, secrets only in the run step, the same file on source and main', async () => {
  const { createRequire } = await import('node:module')
  let YAML = null; try { YAML = createRequire(new URL('../pipeline/package.json', import.meta.url))('yaml') } catch {}
  const canonical = readFileSync(new URL('../deploy/pages-repo/.github/workflows/platform.yml', import.meta.url), 'utf8')
  assert.equal(readFileSync(new URL('../.github/workflows/platform.yml', import.meta.url), 'utf8'), canonical, 'cp deploy/pages-repo/.github/workflows/platform.yml .github/workflows/platform.yml')
  if (!YAML) return
  const w = YAML.parse(canonical)
  assert.deepEqual(Object.keys(w.on), ['workflow_dispatch'])
  assert.deepEqual(w.permissions, { contents: 'read' })
  assert.deepEqual(w.on.workflow_dispatch.inputs.action.options, ['inspect', 'apply', 'verify'])
  assert.equal(w.on.workflow_dispatch.inputs.action.default, 'inspect')
  const steps = w.jobs.platform.steps, named = steps.filter((s) => JSON.stringify(s).includes('secrets.'))
  assert.equal(named.length, 1); assert.match(named[0].run, /^node scripts\/platform-deploy\.mjs "\$ACTION"$/)
  assert.deepEqual(Object.keys(named[0].env).filter((k) => String(named[0].env[k]).includes('secrets.')).sort(), ['ANTHROPIC_API_KEY', 'MODERATION_CRON_SECRET', 'SUPABASE_ACCESS_TOKEN', 'SUPABASE_SECRET_KEY'])
  assert.ok(!steps.some((s) => /\$\{\{\s*inputs\./.test(s.run || '')), 'inputs reach the shell only through env')
})
