#!/usr/bin/env node
// Installs and checks the v2.0 platform on the operator's Supabase project (docs/PLATFORM.md section 6), from GitHub
// Actions (.github/workflows/platform.yml) with keys from GitHub Secrets; nothing secret is printed or written.
//
//   node scripts/platform-deploy.mjs inspect   read only: project state, schema, buckets, schedules, Vault secret
//                                              names, Auth settings, functions, function secret names
//   node scripts/platform-deploy.mjs apply     after inspect: SQL in the install order proven on Postgres 17
//                                              (a project without the base schema first gets 01, 02, 03, 05, 08, 10,
//                                              in one transaction), then release/launch/complete-backend.sql and
//                                              release/launch/platform-v2.sql (each one transaction, both safe to run
//                                              again); Vault secrets; the four platform functions and their secrets;
//                                              the schedules (release/launch/install-platform-cron.sql); the Auth
//                                              settings the platform needs. Needs CONFIRM_REF equal to the project ref.
//   node scripts/platform-deploy.mjs verify    scripts/platform-e2e.mjs against the project (test accounts named
//                                              e2e-<run>, removed at the end; no e-mail is sent)
//
// Environment:
//   SUPABASE_ACCESS_TOKEN   personal access token (Management API, Supabase CLI) - inspect, apply
//   SUPABASE_PROJECT_REF    optional; default: the project in release/launch/public-config.js
//   CONFIRM_REF             apply: must equal the project ref
//   MODERATION_CRON_SECRET  apply, verify: 32+ characters of [A-Za-z0-9._~-]
//   SUPABASE_SECRET_KEY     verify: the project's secret (service) key
//   ANTHROPIC_API_KEY, MODERATION_MODEL   apply, optional: set on moderate-queue only when present (operator's call)
//   SITE_ORIGIN             default https://remona8787.github.io
//   REPORT_DIR              optional: inspect.json, apply.json, e2e.json are written there
//   PG_URL                  local testing only: run the SQL with psql against this database instead of the
//                           Management API (Auth settings, functions and function secrets are then skipped)
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync, appendFileSync, chmodSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (f) => readFileSync(path.join(root, f), 'utf8')
export const API = 'https://api.supabase.com'
export const CLI = 'supabase@2.116.0'
export const FUNCTIONS = ['research-download', 'publish-photo', 'moderate-queue', 'delete-account']
// The state the operator project was left in at v0.15 (release/launch/STATE.md; tests/sql.test.mjs PARTIAL).
export const BASE_FILES = ['supabase/01_schema.sql', 'supabase/02_seed_seoul50.sql', 'supabase/03_storage.sql', 'supabase/05_live_data_schema.sql', 'supabase/08_hybrid_media_pipeline.sql', 'supabase/10_global_discovery_engine.sql']
export const SECRET_RE = /^[A-Za-z0-9._~-]{32,200}$/

export function publicConfig(text = read('release/launch/public-config.js')) {
  const url = (text.match(/SUPABASE_URL:\s*'([^']+)'/) || [])[1], key = (text.match(/SUPABASE_PUBLISHABLE_KEY:\s*'([^']+)'/) || [])[1]
  const ref = (url || '').match(/^https:\/\/([a-z0-9]{20})\.supabase\.co$/)?.[1]
  if (!ref || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key || '')) throw Error('release/launch/public-config.js has no project URL and publishable key')
  return { ref, url, publishable: key }
}

// One query that never fails on a missing part: it reports what exists. Names and counts only, no personal data.
export const INSPECT_SQL = `create or replace function pg_temp.aol_inspect() returns jsonb language plpgsql as $f$
declare r jsonb:='{}'; x jsonb;
begin
 r:=r||jsonb_build_object(
  'base',to_regclass('public.places') is not null,
  'complete_backend',to_regclass('public.discovered_places') is not null and to_regclass('public.archive_collection_rules') is not null and to_regclass('public.user_workspaces') is not null,
  'research',to_regclass('public.research_datasets') is not null,
  'platform',to_regclass('public.community_posts') is not null,
  'photo_grades',exists(select 1 from information_schema.columns where table_schema='public' and table_name='community_photos' and column_name='grade'),
  'admin_members',to_regprocedure('public.platform_member_list(text,integer)') is not null,
  'extensions',(select coalesce(jsonb_agg(extname order by extname),'[]') from pg_extension where extname in ('pg_cron','pg_net','supabase_vault','pgcrypto')),
  'buckets',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'public',public) order by id),'[]') from storage.buckets),
  'auth_users',(select count(*) from auth.users),
  'test_accounts',(select count(*) from auth.users where email like 'e2e-%@example.com'));
 if to_regclass('storage.objects') is not null then execute 'select count(*) from storage.objects where bucket_id=''community-photos''' into x; r:=r||jsonb_build_object('public_photos',x); end if;
 if to_regclass('public.places') is not null then execute 'select jsonb_build_object(''all'',count(*),''published'',count(*) filter (where is_published)) from public.places' into x; r:=r||jsonb_build_object('places',x); end if;
 if to_regclass('public.app_admins') is not null then execute 'select coalesce(jsonb_object_agg(role,n),''{}'') from (select role,count(*) n from public.app_admins group by role) t' into x; r:=r||jsonb_build_object('staff',x); end if;
 if to_regclass('public.platform_settings') is not null then execute 'select coalesce(jsonb_object_agg(key,value),''{}'') from public.platform_settings where key in (''require_staff_mfa'',''auto_approve_text'',''retention_application_days'',''retention_record_days'')' into x; r:=r||jsonb_build_object('settings',x); end if;
 if to_regclass('cron.job') is not null then execute 'select coalesce(jsonb_agg(jsonb_build_object(''name'',jobname,''schedule'',schedule,''active'',active) order by jobname),''[]'') from cron.job where jobname like ''aol-%''' into x; r:=r||jsonb_build_object('cron',x); end if;
 if to_regclass('vault.secrets') is not null then execute 'select coalesce(jsonb_agg(name order by name),''[]'') from vault.secrets where name in (''project_url'',''publishable_key'',''media_cron_secret'',''moderation_cron_secret'')' into x; r:=r||jsonb_build_object('vault',x); end if;
 return r;
end $f$;
select pg_temp.aol_inspect() as report;`

// Vault: the cron secret is set (created or replaced); the project URL and publishable key only when missing, so
// values install-six-hour-sync.sql relies on are never changed. Values are checked first (no quoting tricks).
export function vaultSQL({ url, publishable, cronSecret }) {
  if (!/^https?:\/\/[a-z0-9.:-]+$/i.test(url)) throw Error('project URL not as expected')
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishable)) throw Error('publishable key not as expected')
  if (!SECRET_RE.test(cronSecret || '')) throw Error('MODERATION_CRON_SECRET must be 32 to 200 characters of A-Z a-z 0-9 . _ ~ -')
  return `create extension if not exists supabase_vault with schema vault;
do $v$ begin
 if not exists(select 1 from vault.secrets where name='project_url') then perform vault.create_secret('${url}','project_url'); end if;
 if not exists(select 1 from vault.secrets where name='publishable_key') then perform vault.create_secret('${publishable}','publishable_key'); end if;
 if exists(select 1 from vault.secrets where name='moderation_cron_secret') then
  perform vault.update_secret((select id from vault.secrets where name='moderation_cron_secret'),'${cronSecret}');
 else perform vault.create_secret('${cronSecret}','moderation_cron_secret'); end if;
end $v$;`
}

// The Auth settings the platform needs (docs/PLATFORM.md step 3-4). Only these keys are sent; a value already at
// least as strict is left as it is. SMTP is the operator's (it needs their mail account).
export function authPatch(cur, site) {
  const want = {}
  if (cur.mailer_autoconfirm !== false) want.mailer_autoconfirm = false
  if (!(cur.password_min_length >= 12)) want.password_min_length = 12
  if (cur.mfa_totp_enroll_enabled !== true) want.mfa_totp_enroll_enabled = true
  if (cur.mfa_totp_verify_enabled !== true) want.mfa_totp_verify_enabled = true
  if (!cur.site_url || /localhost|127\.0\.0\.1/.test(cur.site_url)) want.site_url = site
  const allow = String(cur.uri_allow_list || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!allow.some((u) => u === site || u.startsWith(site + '/'))) want.uri_allow_list = [...allow, site + '/**'].join(',')
  return want
}
export const AUTH_FIELDS = ['site_url', 'uri_allow_list', 'mailer_autoconfirm', 'password_min_length', 'password_hibp_enabled', 'mfa_totp_enroll_enabled', 'mfa_totp_verify_enabled', 'external_email_enabled', 'disable_signup', 'rate_limit_email_sent']
export const pickAuth = (a) => Object.fromEntries([...AUTH_FIELDS.map((k) => [k, a?.[k] ?? null]), ['smtp_configured', !!a?.smtp_host]])

// The project's API keys (Settings → API Keys). Publishable keys are public by design (they go in the site's config.js),
// so their values are kept to compare with release/launch/public-config.js and to show the right one when it differs;
// of the secret and legacy keys only the names are kept, and the request never asks for secret values (reveal=false).
export function apiKeys(list) {
  const arr = Array.isArray(list) ? list : []
  return {
    publishable: arr.filter((k) => k?.type === 'publishable' && /^sb_publishable_[A-Za-z0-9_-]+$/.test(k.api_key || '')).map((k) => ({ name: String(k.name || ''), key: k.api_key })),
    secret: arr.filter((k) => k?.type === 'secret').map((k) => String(k.name || '')),
    legacy: arr.filter((k) => k?.type === 'legacy').map((k) => String(k.name || '')),
  }
}
export const keyOnProject = (keys, publishable) => !!keys && !keys.error && keys.publishable.some((k) => k.key === publishable)

// What a run found, as checks a person can read: [{item, ok, detail}].
export function readiness({ project, db, auth, functions, secrets, keys, configured }) {
  const out = [], add = (item, ok, detail = '') => out.push({ item, ok, detail })
  if (project) add('project is running', project.status === 'ACTIVE_HEALTHY', `${project.name || ''} ${project.region || ''} ${project.status || ''}`.trim())
  if (keys?.error) add('API keys (Settings → API Keys)', null, 'could not read: ' + keys.error)
  else if (keys) {
    const on = keys.publishable.find((k) => k.key === configured)
    add('publishable key in public-config.js is on the project', !!on, on ? on.name
      : keys.publishable.length ? 'the project\'s publishable keys: ' + keys.publishable.map((k) => `${k.name} ${k.key}`).join(', ')
      : 'the project has no publishable key: Settings → API Keys → Create new API keys')
    add('a secret key exists (SUPABASE_SECRET_KEY, for verify)', keys.secret.length > 0, keys.secret.join(', ') || 'none: Settings → API Keys → New secret key')
  }
  add('base schema (places)', !!db.base, db.places ? `${db.places.published} of ${db.places.all} published` : '')
  add('complete-backend.sql', !!db.complete_backend)
  add('platform-v2.sql', !!(db.research && db.platform && db.photo_grades && db.admin_members))
  const b = Object.fromEntries((db.buckets || []).map((x) => [x.id, x.public]))
  add('storage buckets', b['community-uploads'] === false && b['research-datasets'] === false && b['community-photos'] === true, 'community-uploads private, research-datasets private, community-photos public')
  const jobs = (db.cron || []).map((j) => j.name)
  add('schedules', jobs.includes('aol-moderate-queue') && jobs.includes('aol-platform-expire'), jobs.join(', ') || 'none')
  add('Vault secrets', ['project_url', 'publishable_key', 'moderation_cron_secret'].every((n) => (db.vault || []).includes(n)), (db.vault || []).join(', ') || 'none')
  add('an admin exists', (db.staff?.admin || 0) > 0, JSON.stringify(db.staff || {}))
  // verify removes its e2e-… accounts and files at the end; these show that it did (and how many member photos are public).
  if (db.test_accounts !== undefined) add('no verify test accounts left', Number(db.test_accounts) === 0, String(db.test_accounts))
  if (db.public_photos !== undefined) add('public member photos (community-photos)', null, `${db.public_photos} files`)
  if (db.platform) add('retention periods (privacy policy: 1 year, 3 years)', db.settings?.retention_record_days != null && db.settings?.retention_application_days != null,
    db.settings?.retention_record_days != null ? `applications ${db.settings.retention_application_days} days, records ${db.settings.retention_record_days} days` : 'not installed: run apply')
  add('staff need a second factor', db.settings ? db.settings.require_staff_mfa !== false && db.settings.require_staff_mfa !== 'false' : !!db.platform, JSON.stringify(db.settings || {}))
  if (auth) {
    add('e-mail confirmation required', auth.mailer_autoconfirm === false)
    add('password at least 12 characters', auth.password_min_length >= 12, String(auth.password_min_length))
    add('TOTP enrolment and sign-in on', auth.mfa_totp_enroll_enabled === true && auth.mfa_totp_verify_enabled === true)
    add('own SMTP server (operator)', auth.smtp_configured === true, auth.smtp_configured ? '' : 'Supabase\'s built-in mail is for testing only')
  }
  if (functions) {
    const live = Object.fromEntries(functions.map((f) => [f.slug, f]))
    for (const f of FUNCTIONS) add(`function ${f}`, live[f]?.status === 'ACTIVE' && live[f]?.verify_jwt === false, live[f] ? `v${live[f].version} verify_jwt=${live[f].verify_jwt}` : 'not deployed')
  }
  if (secrets) {
    for (const n of ['MODERATION_CRON_SECRET', 'ALLOWED_ORIGINS']) add(`function secret ${n}`, secrets.includes(n))
    add('context classifier key (optional, operator)', secrets.includes('ANTHROPIC_API_KEY') ? true : null, secrets.includes('ANTHROPIC_API_KEY') ? 'set' : 'not set: every item goes to people')
  }
  return out
}

export function makeDeps(env = process.env, fetchImpl = globalThis.fetch) {
  const cfg = publicConfig(), ref = env.SUPABASE_PROJECT_REF || cfg.ref
  if (!/^[a-z0-9]{20}$/.test(ref)) throw Error('SUPABASE_PROJECT_REF is not a project ref')
  const token = env.SUPABASE_ACCESS_TOKEN || null, local = env.PG_URL || null
  async function api(method, p, body) {
    if (!token) return null
    const r = await fetchImpl(API + p, { method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', accept: 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await r.text()
    if (!r.ok) throw Error(`${method} ${p.replace(ref, '<ref>')}: HTTP ${r.status} ${text.slice(0, 300)}`)
    try { return JSON.parse(text) } catch { return text }
  }
  async function sql(query) {
    if (local) {
      const r = spawnSync('psql', [local, '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-f', '-'], { input: query, encoding: 'utf8', maxBuffer: 64 << 20 })
      if (r.status !== 0) throw Error('SQL failed: ' + String(r.stderr).split('\n').filter((l) => /ERROR|DETAIL|CONTEXT/.test(l)).slice(0, 4).join(' | '))
      return String(r.stdout).trim().split('\n').filter(Boolean).map((line) => ({ report: (() => { try { return JSON.parse(line) } catch { return line } })() }))
    }
    return api('POST', `/v1/projects/${ref}/database/query`, { query })
  }
  return { ref, url: `https://${ref}.supabase.co`, publishable: cfg.publishable, token, local, api, sql, env }
}

const needAccess = (d) => { if (!d.token && !d.local) throw Error('SUPABASE_ACCESS_TOKEN (GitHub Secrets) is required for inspect and apply') }
export async function inspect(d) {
  needAccess(d)
  let db = (await d.sql(INSPECT_SQL)).at(-1)?.report || {}
  if (typeof db === 'string') db = JSON.parse(db)
  const project = d.token ? await d.api('GET', `/v1/projects/${d.ref}`) : null
  const auth = d.token ? pickAuth(await d.api('GET', `/v1/projects/${d.ref}/config/auth`)) : null
  const functions = d.token ? (await d.api('GET', `/v1/projects/${d.ref}/functions`)).map((f) => ({ slug: f.slug, version: f.version, status: f.status, verify_jwt: f.verify_jwt, updated_at: f.updated_at })) : null
  const secrets = d.token ? (await d.api('GET', `/v1/projects/${d.ref}/secrets`)).map((s) => s.name).sort() : null
  let keys = null
  if (d.token) { try { keys = apiKeys(await d.api('GET', `/v1/projects/${d.ref}/api-keys?reveal=false`)) } catch (e) { keys = { error: String(e?.message || e).slice(0, 200) } } }
  const state = { at: new Date().toISOString(), project: project && { name: project.name, region: project.region, status: project.status }, db, auth, functions, secrets, keys, configured: d.publishable }
  state.checks = readiness(state)
  return state
}

function deployFunctions(d, log) {
  const work = mkdtempSync(path.join(tmpdir(), 'aol-platform-'))
  try {
    mkdirSync(path.join(work, 'supabase/functions'), { recursive: true })
    for (const f of [...FUNCTIONS, '_shared']) cpSync(path.join(root, 'edge-functions', f), path.join(work, 'supabase/functions', f), { recursive: true })
    // Each function checks its caller itself (a user's token through auth.getUser, or the cron secret), and the new
    // sb_publishable_/sb_secret_ keys are not JWTs, so the gateway's JWT check is off (as scripts/deploy-edge-functions.sh).
    writeFileSync(path.join(work, 'supabase/config.toml'), `project_id = "${d.ref}"\n` + FUNCTIONS.map((f) => `\n[functions.${f}]\nverify_jwt = false\n`).join(''))
    const vals = { MODERATION_CRON_SECRET: d.env.MODERATION_CRON_SECRET, ALLOWED_ORIGINS: d.site, PUBLIC_SITE_URL: d.site }
    // The context classifier is used only when the operator has put its key in GitHub Secrets (a paid service).
    if (d.env.ANTHROPIC_API_KEY) vals.ANTHROPIC_API_KEY = d.env.ANTHROPIC_API_KEY
    if (d.env.MODERATION_MODEL) vals.MODERATION_MODEL = d.env.MODERATION_MODEL
    const envFile = path.join(work, 'functions.env')
    writeFileSync(envFile, Object.entries(vals).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'); chmodSync(envFile, 0o600)
    const run = (args, label) => {
      const r = spawnSync('npx', ['--yes', CLI, ...args], { cwd: work, env: { ...process.env, SUPABASE_ACCESS_TOKEN: d.token }, encoding: 'utf8', maxBuffer: 64 << 20 })
      if (r.status !== 0) throw Error(`${label}: ${String(r.stderr || r.stdout).split('\n').filter(Boolean).slice(-4).join(' | ')}`)
      log(label + ': done')
    }
    run(['secrets', 'set', '--project-ref', d.ref, '--env-file', envFile, '--workdir', work], `function secrets (${Object.keys(vals).join(', ')})`)
    for (const f of FUNCTIONS) run(['functions', 'deploy', f, '--project-ref', d.ref, '--use-api', '--no-verify-jwt', '--workdir', work], `deploy ${f}`)
  } finally { rmSync(work, { recursive: true, force: true }) }
}

export async function apply(d, log = console.log) {
  needAccess(d)
  if (d.token && d.env.CONFIRM_REF !== d.ref) throw Error(`apply changes the project: run it with confirm = ${d.ref}`)
  if (!SECRET_RE.test(d.env.MODERATION_CRON_SECRET || '')) throw Error('MODERATION_CRON_SECRET (GitHub Secrets) must be 32 to 200 characters of A-Z a-z 0-9 . _ ~ -')
  const steps = [], step = (s) => { steps.push(s); log(s) }
  const before = await inspect(d)
  // The publishable key goes into Vault (the schedules call the functions with it) and into the site's config.js: one
  // the project does not have would leave both broken, so nothing is changed until public-config.js holds a real one.
  if (before.keys && !before.keys.error && !keyOnProject(before.keys, d.publishable)) {
    throw Error('the publishable key in release/launch/public-config.js is not one of the project\'s keys (inspect lists them): update public-config.js first; nothing was changed')
  }
  if (!before.db.base) {
    await d.sql('begin;\n' + BASE_FILES.map((f) => `-- SOURCE: ${f}\n${read(f)}`).join('\n') + '\ncommit;')
    step('base schema: ' + BASE_FILES.map((f) => path.basename(f)).join(', '))
  }
  await d.sql(read('release/launch/complete-backend.sql')); step('release/launch/complete-backend.sql')
  await d.sql(read('release/launch/platform-v2.sql')); step('release/launch/platform-v2.sql')
  await d.sql(vaultSQL({ url: d.url, publishable: d.publishable, cronSecret: d.env.MODERATION_CRON_SECRET })); step('Vault: moderation_cron_secret set; project_url, publishable_key kept or added')
  let manual = []
  if (d.token) {
    (d.deployFunctions || deployFunctions)(d, step)
    await d.sql(read('release/launch/install-platform-cron.sql')); step('schedules: aol-moderate-queue, aol-platform-expire')
    manual = await authStep(d, step)
  } else {
    step('functions, function secrets and Auth settings: skipped (local database, no Management API)')
    await d.sql(read('release/launch/install-platform-cron.sql')); step('schedules: aol-moderate-queue, aol-platform-expire')
  }
  const after = await inspect(d)
  return { at: new Date().toISOString(), steps, manual, before: before.checks, after }
}

// Where each Auth setting is in the dashboard, for the operator when the token may not change them.
export const AUTH_BY_HAND = {
  mailer_autoconfirm: () => 'Authentication → Sign In / Providers → Email → Confirm email: 켜기',
  password_min_length: (v) => `Authentication → Sign In / Providers → Email → Minimum password length: ${v}`,
  mfa_totp_enroll_enabled: () => 'Authentication → Multi-Factor → TOTP (App Authenticator): Enabled',
  mfa_totp_verify_enabled: () => 'Authentication → Multi-Factor → TOTP (App Authenticator): Enabled',
  site_url: (v) => `Authentication → URL Configuration → Site URL: ${v}`,
  uri_allow_list: (v, site) => `Authentication → URL Configuration → Redirect URLs: ${site}/** 추가 (Add URL)`,
}
// The Auth settings need a token that may change project settings (project_admin_write, "Project Settings" read-write,
// a high-risk permission). Without it nothing else is held up: the run lists what to set by hand in the dashboard.
export async function authStep(d, step) {
  const cur = await d.api('GET', `/v1/projects/${d.ref}/config/auth`), patch = authPatch(cur, d.site)
  if (!Object.keys(patch).length) { step('Auth settings: already as needed'); return [] }
  try {
    await d.api('PATCH', `/v1/projects/${d.ref}/config/auth`, patch); step('Auth settings: ' + Object.keys(patch).join(', ')); return []
  } catch (e) {
    if (!/HTTP 403/.test(String(e?.message))) throw e
    const manual = [...new Set(Object.entries(patch).map(([k, v]) => AUTH_BY_HAND[k]?.(v, d.site) || `${k}: ${v}`))]
    step('Auth settings: not changed (the token may not change project settings); set them in the dashboard: ' + Object.keys(patch).join(', '))
    return manual
  }
}

export function verify(d) {
  if (!d.env.SUPABASE_SECRET_KEY) throw Error('SUPABASE_SECRET_KEY (GitHub Secrets) is required for verify')
  if (!SECRET_RE.test(d.env.MODERATION_CRON_SECRET || '')) throw Error('MODERATION_CRON_SECRET (GitHub Secrets) is required for verify')
  const report = d.env.REPORT_DIR ? path.join(d.env.REPORT_DIR, 'e2e.json') : ''
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/platform-e2e.mjs')], { stdio: 'inherit', env: { ...process.env, SUPABASE_URL: d.local ? d.env.SUPABASE_URL : d.url, SUPABASE_PUBLISHABLE_KEY: d.local ? d.env.SUPABASE_PUBLISHABLE_KEY : d.publishable, E2E_ORIGIN: d.env.E2E_ORIGIN || d.site, E2E_REPORT: report, MAILPIT_URL: '' } })
  return r.status ?? 1
}

export function summary(title, checks, extra = []) {
  const mark = (ok) => ok === true ? '✅' : ok === false ? '❌' : '➖'
  return [`## ${title}`, '', '| | 항목 | 내용 |', '|---|---|---|', ...checks.map((c) => `| ${mark(c.ok)} | ${c.item} | ${String(c.detail || '').replace(/\|/g, '/')} |`), '', ...extra, ''].join('\n')
}

async function main() {
  const action = process.argv[2]
  if (!['inspect', 'apply', 'verify'].includes(action)) { console.error('usage: node scripts/platform-deploy.mjs inspect|apply|verify'); process.exit(2) }
  // A value pasted into GitHub Secrets often carries a space or a line break at its end; none of these has one.
  for (const k of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_SECRET_KEY', 'MODERATION_CRON_SECRET', 'CONFIRM_REF', 'ANTHROPIC_API_KEY']) if (process.env[k]) process.env[k] = process.env[k].trim()
  const d = makeDeps(); d.site = (process.env.SITE_ORIGIN || 'https://remona8787.github.io').replace(/\/+$/, '')
  const out = process.env.REPORT_DIR; if (out) mkdirSync(out, { recursive: true })
  const write = (name, obj) => { if (out) writeFileSync(path.join(out, name), JSON.stringify(obj, null, 2) + '\n') }
  const sum = (md) => { console.log(md); if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n') }
  if (action === 'inspect') {
    const s = await inspect(d); write('inspect.json', s)
    sum(summary(`플랫폼 점검 (${d.ref}, 읽기 전용)`, s.checks, ['❌ 항목은 apply(설치)나 운영자 설정이 필요합니다. ➖ 는 선택 항목입니다.']))
    return
  }
  if (action === 'apply') {
    const r = await apply(d); write('apply.json', r)
    sum(summary(`플랫폼 설치 결과 (${d.ref})`, r.after.checks, ['적용한 단계:', '', ...r.steps.map((s) => '- ' + s),
      ...(r.manual.length ? ['', '운영자가 Supabase 대시보드에서 직접 바꿀 로그인 설정(이 토큰은 프로젝트 설정을 바꿀 권한이 없음):', '', ...r.manual.map((s) => '- ' + s)] : [])]))
    return
  }
  const code = verify(d)
  sum(`## 플랫폼 실제 점검 (${d.ref})\n\n${code === 0 ? '✅ 모든 항목 통과' : '❌ 실패한 항목이 있습니다 (로그와 e2e.json)'}\n`)
  process.exit(code)
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error('platform-deploy: ' + (e?.message || e)); process.exit(1) })
