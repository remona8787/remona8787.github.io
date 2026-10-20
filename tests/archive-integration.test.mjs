// The archive end to end, inside this environment: real Postgres (PGlite with pg_trgm) built like the SQL tests
// (legacy SQL + release/launch/complete-backend.sql + release/launch/archive-seed.sql, under Supabase's default grants),
// the real collector (edge-functions/_shared/archive/service.mjs runCollect → pipeline.mjs, exactly what the
// archive-collect function runs) over the recorded GDELT, RSS, NAVER and Brave fixtures with an injected fetch and
// clock, the service RPC sequence (claim → start_run → ingest → finish_run) through a PostgREST-like rpc as
// service_role, an editor's review, the public view and archive_search as anon, and the client's mapping
// (client/archive-rows.mjs) and catalogue search (site-public-cleared/catalog.js).
// Also the contracts between the tracks: §8 item keys = what archive_ingest validates and reads; every column the client
// reads exists in the view; every archive RPC the admin console and the Edge Functions call exists with the parameter
// names they send, for the role that calls it; the cron secret is MEDIA_CRON_SECRET (x-aol-cron-secret). The
// vocabulary checks = archive-taxonomy.js keys are tested in tests/archive-sql.test.mjs.
// Fixture-tested only: no live source and no Supabase project is involved.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { runCollect } from '../edge-functions/_shared/archive/service.mjs'
import { buildItems, ITEM_KEYS } from '../edge-functions/_shared/archive/pipeline.mjs'
import { ARCHIVE_VIEW, ARCHIVE_COLUMN_LIST, ARCHIVE_COLUMNS, fromArchiveRows } from '../client/archive-rows.mjs'

const require = createRequire(import.meta.url)
const X = require('../site-public-cleared/catalog.js')
const root = new URL('../', import.meta.url)
const read = (/** @type {string} */ f) => readFile(new URL(f, root), 'utf8')
const sql = async (/** @type {string} */ f) => (await read(f)).replace(/create extension if not exists "?pgcrypto"?[^;]*;/gi, '')
const fixture = (/** @type {string} */ name) => read('tests/fixtures/archive/' + name)
const LEGACY = ['supabase/01_schema.sql', 'supabase/02_seed_seoul50.sql', 'supabase/03_storage.sql', 'supabase/04_flutterflow_rpc.sql', 'supabase/05_live_data_schema.sql',
  'supabase/07_audited_corrections.sql', 'supabase/08_hybrid_media_pipeline.sql', 'supabase/10_global_discovery_engine.sql', 'supabase/12_seed_countries_cities.sql',
  'supabase/13_admin_review_console.sql', 'supabase/15_discovery_hardening.sql', 'supabase/17_user_sync_and_operations.sql', 'supabase/18_discovery_rotation.sql',
  'supabase/migrations/20261010160920_archive_media_and_editorial.sql', 'supabase/migrations/20261013000000_discovered_places.sql']
// Supabase grants every new table, view and function in public to anon/authenticated; the migrations' revokes must hold.
const SUPABASE_DEFAULT_GRANTS = `alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;`
const PUBLIC_URL = 'https://remona8787.github.io'
const H = 3600e3

/** A request as PostgREST makes it: role and JWT subject, one transaction. */
const as = (/** @type {PGlite} */ d, /** @type {string} */ role, /** @type {string|null} */ sub, /** @type {(tx: any) => Promise<any>} */ fn) =>
  d.transaction(async (tx) => { await tx.exec(`set local role ${role}`); await tx.query(`select set_config('request.jwt.claim.sub',$1,true)`, [sub || '']); return fn(tx) })
const q = (/** @type {PGlite} */ d, /** @type {string} */ role, /** @type {string|null} */ sub, /** @type {string} */ text, /** @type {any[]} */ params = []) =>
  as(d, role, sub, (tx) => tx.query(text, params)).then((r) => /** @type {any[]} */ (r.rows))
const rows = async (/** @type {PGlite} */ d, /** @type {string} */ text, /** @type {any[]} */ params = []) => /** @type {any[]} */ ((await d.query(text, params)).rows)

/**
 * POST /rest/v1/rpc/<fn> with named arguments, as the Edge Functions' supabase-js client sends it: each argument cast to
 * the function's parameter type, a set-returning function answers an array, void answers null. Records the call order.
 * @param {PGlite} d @param {string} role @param {string[]} log
 */
function postgrestRpc(d, role, log) {
  /** @type {Map<string, any>} */
  const procs = new Map()
  return async (/** @type {string} */ fn, /** @type {Record<string, any>} */ args = {}) => {
    log.push(fn)
    if (!procs.has(fn)) {
      const found = await rows(d, `select p.proretset rs, p.prorettype::regtype::text ret, coalesce(p.proargnames, '{}') names,
        coalesce((select array_agg(format_type(t, null) order by o) from unnest(p.proargtypes) with ordinality u(t, o)), '{}') types
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`, [fn])
      if (found.length !== 1) throw Error(`${fn}: ${found.length} functions`)
      procs.set(fn, found[0])
    }
    const p = procs.get(fn)
    /** @type {any[]} */
    const params = []
    const named = Object.entries(args).map(([k, v]) => {
      const t = p.types[p.names.indexOf(k)]
      if (!t) throw Error(`${fn}: no parameter ${k}`)
      params.push(v == null ? null : t === 'jsonb' ? JSON.stringify(v) : t.endsWith('[]') ? `{${v.map((/** @type {unknown} */ x) => JSON.stringify(String(x))).join(',')}}` : v)
      return `${k} => $${params.length}::${t}`
    })
    const call = `public.${fn}(${named.join(', ')})`
    const text = p.rs ? `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) v from ${call} r` : p.ret === 'void' ? `select ${call} is null v` : `select to_jsonb(${call}) v`
    const [r] = await q(d, role, null, text, params)
    return p.ret === 'void' ? null : r.v
  }
}

/** Recorded responses by URL prefix; the clock starts at the database's now and moves only when the code sleeps. */
function world(/** @type {Record<string, (req: {url: string, init: RequestInit}) => Response>} */ routes) {
  let now = Date.now()
  /** @type {{url: string, init: RequestInit}[]} */
  const calls = []
  const fetch = async (/** @type {string} */ url, /** @type {RequestInit} */ init = {}) => {
    calls.push({ url: String(url), init })
    const key = Object.keys(routes).find((k) => String(url).startsWith(k))
    if (!key) throw new TypeError('fetch failed: ' + url)
    return routes[key]({ url: String(url), init })
  }
  return { calls, fetch, clock: () => now, sleep: async (/** @type {number} */ ms) => { now += ms } }
}

/** @type {PGlite} */
let db
/** @type {string} */
let ADMIN, EDITOR
/** @type {Record<string, string>} */
const RULES = {}
/** @type {ReturnType<typeof world>} */
let w
/** @type {string[]} */
const serviceCalls = []
/** @type {ReturnType<typeof postgrestRpc>} */
let serviceRpc
const ENV = /** @type {Record<string, string>} */ ({ NAVER_API_KEY_ID: 'fixture-id', NAVER_API_KEY: 'fixture-key', BRAVE_API_KEY: 'fixture-brave' })
const SOURCES = ['GDELT ko · media facade', 'Dezeen', 'NAVER 뉴스 · 미디어파사드', 'Brave · media facade']
// The article's canonical URL (hits, dedupe) and the URL as published (the source the public record links to).
const DEZEEN = 'https://dezeen.com/2026/10/15/seoul-office-tower-kinetic-media-facade/'
const DEZEEN_URL = 'https://www.dezeen.com/2026/10/15/seoul-office-tower-kinetic-media-facade/'
const NOTE = 'Checked against the Dezeen article and the Brave result; coordinates from the published site plan.'
/** @type {any} */
let firstRun
/** @type {string} */
let KINETIC, LONDON, SLUG

/** One archive-collect invocation (Deno.serve body → runCollect), cron trigger, for the named seed rules. */
const collect = (/** @type {string[]} */ names) => runCollect({
  rpc: serviceRpc, readRules: async () => [],
  readKeywords: () => q(db, 'service_role', null, `select term,language,polarity,weight,enabled from public.archive_keywords where enabled limit 10000`),
  fetch: w.fetch, clock: w.clock, sleep: w.sleep, getEnv: (k) => ENV[k], trigger: 'cron', ruleIds: names.map((n) => RULES[n]), owner: 'integration-test',
})
const counts = async () => (await rows(db, `select (select count(*)::int from public.archive_candidates) candidates, (select count(*)::int from public.archive_candidate_hits) hits,
  (select count(*)::int from public.archive_sources) sources, (select count(*)::int from public.archive_project_sources) links, (select count(*)::int from public.archive_projects) projects,
  (select count(*)::int from public.archive_project_updates) updates, (select count(*)::int from public.archive_credits) credits`))[0]
const publicRows = () => q(db, 'anon', null, `select ${ARCHIVE_COLUMNS} from public.${ARCHIVE_VIEW} order by slug`)

test.before(async () => {
  db = new PGlite({ extensions: { pg_trgm } })
  await db.exec(await sql('tests/sql/supabase-stubs.sql'))
  await db.exec(SUPABASE_DEFAULT_GRANTS)
  for (const f of [...LEGACY, 'release/launch/complete-backend.sql', 'release/launch/archive-seed.sql']) await db.exec(await sql(f)).catch((e) => { throw Error(`${f}: ${e.message}`) })
  ;[ADMIN, EDITOR] = (await rows(db, `insert into auth.users(email) values('admin@t'),('editor@t') returning id`)).map((r) => r.id)
  await db.query(`insert into public.app_admins(user_id,role) values($1,'admin'),($2,'editor')`, [ADMIN, EDITOR])
  for (const r of await rows(db, `select id,name from public.archive_collection_rules`)) RULES[r.name] = r.id
  // Keyed sources are off in the seed; an admin turns them on (the keys are function secrets, here fixture values).
  for (const n of ['NAVER 뉴스 · 미디어파사드', 'Brave · media facade']) await q(db, 'authenticated', ADMIN, `select public.archive_admin_upsert_rule($1::jsonb)`, [JSON.stringify({ id: RULES[n], enabled: true })])
  const [gdelt, dezeen, naver, brave] = await Promise.all(['gdelt-artlist.json', 'dezeen-rss.xml', 'naver-news.json', 'brave-web.json'].map(fixture))
  const json = (/** @type {string} */ body) => () => new Response(body, { headers: { 'content-type': 'application/json' } })
  w = world({
    'https://api.gdeltproject.org/api/v2/doc/doc': json(gdelt),
    // The feed answers 200 with an ETag even to a conditional request, so a second run ingests the same items again.
    'https://www.dezeen.com/feed/': () => new Response(dezeen, { headers: { 'content-type': 'application/rss+xml; charset=UTF-8', etag: '"v1"' } }),
    'https://naverapihub.apigw.ntruss.com/search/v1/news': json(naver),
    'https://api.search.brave.com/res/v1/web/search': json(brave),
    'https://archinect.com/': () => new Response('Service Unavailable', { status: 503, headers: { 'retry-after': '7200' } }),
  })
  serviceRpc = postgrestRpc(db, 'service_role', serviceCalls)
})
test.after(() => db?.close())

// ---- contracts between the tracks -------------------------------------------------------------------------------
test('contract: the §8 item keys the collector sends equal what archive_ingest validates and reads', async () => {
  const defs = Object.fromEntries((await rows(db, `select p.proname n, pg_get_functiondef(p.oid) d from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname in ('archive_item_problem','archive_insert_hit','archive_ingest')`)).map((r) => [r.n, r.d]))
  assert.deepEqual(Object.keys(defs).sort(), ['archive_ingest', 'archive_insert_hit', 'archive_item_problem'])
  const all = Object.values(defs).join('\n')
  const top = new Set([...all.matchAll(/\bit->>?'([a-z0-9_]+)'/g)].map((m) => m[1]))
  /** @type {Record<string, Set<string>>} */
  const nested = { classification: new Set(), detected: new Set(), keys: new Set() }
  for (const m of all.matchAll(/\bit#>>?'\{([a-z0-9_]+),([a-z0-9_]+)\}'/g)) { top.add(m[1]); nested[m[1]].add(m[2]) }
  // archive_item_problem reads the nested objects through c := classification, d := detected, k := keys.
  for (const [v, name] of [['c', 'classification'], ['d', 'detected'], ['k', 'keys']]) for (const m of defs.archive_item_problem.matchAll(new RegExp(`\\b${v}->>?'([a-z0-9_]+)'`, 'g'))) nested[name].add(m[1])
  assert.deepEqual([...top].sort(), [...ITEM_KEYS].sort(), 'top-level keys')
  const [item] = buildItems([{ provider: 'rss', external_id: 'x', url: 'https://www.example.org/a', title: 'Media facade on the tower', excerpt: null, publisher: null, language: 'en', published_at: null, raw: {} }]).items
  assert.deepEqual(Object.keys(item).sort(), [...ITEM_KEYS].sort())
  for (const k of /** @type {const} */ (['classification', 'detected', 'keys'])) assert.deepEqual([...nested[k]].sort(), Object.keys(item[k]).sort(), k)
  const [{ p }] = await q(db, 'service_role', null, `select public.archive_item_problem($1::jsonb) p`, [JSON.stringify(item)])
  assert.equal(p, null, 'a collector item passes the SQL validator')
})

test('contract: every column the client reads exists in public_archive_projects, and anon can read them', async () => {
  const cols = (await rows(db, `select column_name c from information_schema.columns where table_schema='public' and table_name=$1`, [ARCHIVE_VIEW])).map((r) => r.c)
  assert.deepEqual(ARCHIVE_COLUMN_LIST.filter((c) => !cols.includes(c)), [])
  assert.deepEqual(await publicRows(), [], 'nothing is published yet')
})

/** rpc('archive_…', {p_…}) calls in a source file: name and the parameter names sent (null when built elsewhere). */
function rpcCalls(/** @type {string} */ src) {
  const out = []
  const re = /\brpc\(\s*['"](archive_[a-z_]+)['"]\s*(,\s*)?/g
  let m
  while ((m = re.exec(src))) {
    let keys = /** @type {string[]|null} */ (m[2] ? null : [])
    const i = re.lastIndex
    if (m[2] && src[i] === '{') {
      let depth = 0, j = i
      for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break }
      keys = [...new Set([...src.slice(i, j + 1).matchAll(/\b(p_[a-z_]+)\s*:/g)].map((x) => x[1]))]
    }
    out.push({ fn: m[1], keys })
  }
  return out
}

test('contract: every archive RPC the admin console and the Edge Functions call exists, with the parameters they send, for their role', async () => {
  const procs = await rows(db, `select p.proname n, coalesce(p.proargnames,'{}') names, p.pronargs nargs, p.pronargdefaults ndef,
    has_function_privilege('authenticated', p.oid, 'execute') auth, has_function_privilege('service_role', p.oid, 'execute') svc, has_function_privilege('anon', p.oid, 'execute') anon
    from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'archive%'`)
  const sources = [['admin/app.js', 'auth']]
  for (const dir of ['edge-functions/_shared/archive/', 'edge-functions/archive-collect/', 'edge-functions/archive-check-links/', 'edge-functions/archive-websub/']) {
    for (const f of await readdir(new URL(dir, root))) if (/\.(mjs|ts)$/.test(f)) sources.push([dir + f, 'svc'])
  }
  let checked = 0
  /** @type {Set<string>} */
  const adminFns = new Set()
  for (const [file, role] of sources) {
    for (const { fn, keys } of rpcCalls(await read(file))) {
      // archive-collect checks the editor's role with the user's own token.
      const as = fn === 'archive_role' ? 'auth' : role
      const candidates = procs.filter((p) => p.n === fn)
      assert.ok(candidates.length, `${file}: ${fn} does not exist`)
      const ok = candidates.find((p) => (keys === null || (keys.every((k) => p.names.includes(k)) && p.names.slice(0, p.nargs - p.ndef).every((/** @type {string} */ k) => keys.includes(k)))) && p[as])
      assert.ok(ok, `${file}: ${fn}(${keys?.join(', ') ?? '…'}) matches no signature callable by ${as}: ${candidates.map((p) => `(${p.names.join(', ')}; ${p.nargs - p.ndef} required)`).join(' ')}`)
      if (as === 'svc') assert.equal(ok.auth || ok.anon, false, `${fn} is service-only`)
      if (file === 'admin/app.js') adminFns.add(fn)
      checked++
    }
  }
  assert.ok(checked >= 40, `${checked} calls`)
  for (const fn of ['archive_admin_remove_source', 'archive_admin_delete_keyword', 'archive_admin_list_candidates', 'archive_admin_resolve_update', 'archive_admin_dashboard', 'archive_search']) assert.ok(adminFns.has(fn), fn)
})

test('contract: the cron secret is MEDIA_CRON_SECRET in header x-aol-cron-secret, for the functions, the cron jobs and the docs', async () => {
  for (const fn of ['archive-collect', 'archive-check-links']) {
    assert.match(await read(`edge-functions/${fn}/index.ts`), /authorizedSecret\(\[\[Deno\.env\.get\("MEDIA_CRON_SECRET"\), req\.headers\.get\("x-aol-cron-secret"\)\]\]\)/, fn)
  }
  const cron = await read('release/launch/install-six-hour-sync.sql')
  for (const job of ['archive-collect', 'archive-check-links']) {
    const body = cron.slice(cron.indexOf(`functions/v1/${job}`) - 600, cron.indexOf(`functions/v1/${job}`) + 600)
    assert.match(body, /'x-aol-cron-secret',\(select decrypted_secret from vault\.decrypted_secrets where name='media_cron_secret'\)/, job)
  }
  assert.match(await read('scripts/deploy-edge-functions.sh'), /archive-collect, archive-check-links\) reuses MEDIA_CRON_SECRET/)
  assert.match(await read('docs/ARCHIVE_SPEC.md'), /`MEDIA_CRON_SECRET` sent as header `x-aol-cron-secret`/)
  // No code reads a separate archive secret.
  const code = [...(await readdir(new URL('edge-functions/', root), { recursive: true })).filter((f) => /\.(ts|mjs)$/.test(f)).map((f) => 'edge-functions/' + f), 'release/launch/install-six-hour-sync.sql', 'scripts/deploy-edge-functions.sh']
  for (const f of code) assert.doesNotMatch(await read(f), /ARCHIVE_CRON_SECRET|ARCHIVE_.*SECRET/, f)
})

// ---- one collection run ------------------------------------------------------------------------------------------
test('collect: one archive-collect run claims the rules and runs start_run → ingest → finish_run for each, over the recorded sources', async () => {
  firstRun = await collect(SOURCES)
  assert.deepEqual(firstRun.rules.map((/** @type {any} */ r) => r.name).sort(), [...SOURCES].sort())
  for (const r of firstRun.rules) assert.deepEqual([r.name, r.status, r.errors], [r.name, 'success', []])
  assert.deepEqual([firstRun.keywords.source, firstRun.aliases, firstRun.websub_enabled], ['database', 0, false])
  assert.deepEqual(serviceCalls.slice(0, 2), ['archive_claim_due_rules', 'archive_alias_index'])
  assert.deepEqual(serviceCalls.slice(2), SOURCES.flatMap(() => ['archive_start_run', 'archive_ingest', 'archive_finish_run']), 'per rule: start, ingest, finish (no errors to log)')
  const hosts = new Set(w.calls.map((c) => new URL(c.url).host))
  assert.deepEqual([...hosts].sort(), ['api.gdeltproject.org', 'api.search.brave.com', 'naverapihub.apigw.ntruss.com', 'www.dezeen.com'])
  // The runs as recorded: cron trigger, success, the collector's own counts plus what ingest counted.
  const runs = await rows(db, `select k.name,r.trigger,r.status,r.fetched,r.kept,r.new_candidates,r.duplicates,r.ignored,r.errors,r.finished_at is not null done
    from public.archive_runs r join public.archive_collection_rules k on k.id=r.rule_id order by k.name`)
  assert.equal(runs.length, 4)
  for (const r of runs) assert.deepEqual([r.trigger, r.status, r.errors, r.done], ['cron', 'success', 0, true], r.name)
  const by = Object.fromEntries(runs.map((r) => [r.name, r]))
  assert.deepEqual([by['GDELT ko · media facade'].fetched, by['GDELT ko · media facade'].kept], [7, 7])
  assert.deepEqual([by.Dezeen.fetched, by.Dezeen.kept], [3, 2], 'the kitchen lookbook has no positive keyword')
  // Rule state went through finish_run: success schedules the next run after the cadence and keeps the feed's ETag.
  const rules = await rows(db, `select name,last_status,failure_count,etag,claimed_by,next_run_at>now() later from public.archive_collection_rules where id=any($1) order by name`, [SOURCES.map((n) => RULES[n])])
  for (const r of rules) assert.deepEqual([r.last_status, r.failure_count, r.claimed_by, r.later], ['success', 0, null, true], r.name)
  assert.equal(rules.find((r) => r.name === 'Dezeen').etag, '"v1"')
})

test('collect: candidates are created, noise is auto-ignored, and the same story from several sources is one candidate', async () => {
  const cands = await rows(db, `select c.id,c.status,c.label,c.detected_city city,c.detected_country_iso2 cc,c.seen_count,
    (select array_agg(h.provider||' '||h.canonical_url order by h.provider) from public.archive_candidate_hits h where h.candidate_id=c.id) hits from public.archive_candidates c`)
  const withHit = (/** @type {string} */ url) => cands.filter((c) => c.hits.some((/** @type {string} */ h) => h.endsWith(' ' + url)))
  // The Dezeen article came from the feed and from Brave: one candidate, two hits.
  const [kinetic] = withHit(DEZEEN)
  assert.equal(withHit(DEZEEN).length, 1)
  assert.deepEqual([kinetic.hits, kinetic.seen_count, kinetic.status, kinetic.label, kinetic.city, kinetic.cc], [['brave ' + DEZEEN, 'rss ' + DEZEEN], 2, 'needs_review', 'facade_project', 'Seoul', 'KR'])
  // The syndicated Yonhap/Newsis story in one GDELT answer: one candidate, two hits.
  const yna = withHit('https://yna.co.kr/view/AKR20261015123400005')
  assert.equal(yna.length, 1)
  assert.deepEqual(yna[0].hits, ['gdelt https://yna.co.kr/view/AKR20261015123400005', 'gdelt https://newsis.com/view/NISX20261015_0002999999'])
  // Vendors and unrelated items never reach the review queue.
  for (const url of ['https://example-shop.co.kr/product/led-mesh-p10', 'https://example-led.co.kr/board/view/1', 'https://example-led-factory.com/products/media-facade-screen',
    'https://example-music.com/news/projection-mapping-concert-tour', 'https://example-lokal.de/stuttgart/fassade-sanierung']) {
    assert.deepEqual(withHit(url).map((c) => c.status), ['auto_ignored'], url)
  }
  // The admin console's queue: p_status null = needs_review + uncertain, each with its hits and suggested matches.
  const queue = (await q(db, 'authenticated', EDITOR, `select x from public.archive_admin_list_candidates(null, null, 0, 50, 0) x`)).map((r) => r.x)
  assert.deepEqual(queue.map((c) => c.id).sort(), cands.filter((c) => ['needs_review', 'uncertain'].includes(c.status)).map((c) => c.id).sort())
  assert.ok(queue.length >= 6)
  const row = queue.find((c) => c.id === kinetic.id)
  assert.deepEqual([row.hits.length, Array.isArray(row.suggested_matches), row.total_seen], [2, true, 2])
  assert.ok(row.hits.every((/** @type {any} */ h) => !('raw' in h)), 'raw payloads stay in the database')
  KINETIC = kinetic.id
  LONDON = withHit('https://theguardian.com/artanddesign/2026/oct/14/fixture-media-facade-london')[0].id
})

// ---- editorial review and the public archive -----------------------------------------------------------------------
test('review: an editor approves one candidate as a new published project, another as a draft', async () => {
  const review = (/** @type {string} */ id, /** @type {any} */ payload) => q(db, 'authenticated', EDITOR, `select public.archive_admin_review_candidate($1,'approve_new',$2::jsonb) r`, [id, JSON.stringify(payload)]).then((r) => r[0].r)
  const out = await review(KINETIC, {
    name_en: 'Seoul Office Tower Kinetic Facade', country_iso2: 'KR', city: 'Seoul', latitude: 37.5704, longitude: 126.9829, location_precision: 'exact',
    project_type: 'media_facade', installation_method: 'kinetic', envelope_type: 'louvres_fins', summary_en: 'A kinetic media facade of aluminium fins on an office tower.',
    publish: true, supports: ['name_en', 'city', 'country_iso2', 'project_type', 'installation_method', 'envelope_type'], note: NOTE,
  })
  assert.deepEqual([out.ok, out.status], [true, 'approved'])
  const draft = await review(LONDON, { name_en: 'Thames Listening Facade', country_iso2: 'GB', city: 'London', publish: false })
  assert.equal(draft.status, 'approved')
  const [p] = await rows(db, `select slug,visibility,record_origin,review_status,last_verified_at is not null verified,field_status from public.archive_projects where id=$1`, [out.project_id])
  assert.deepEqual([p.visibility, p.record_origin, p.verified], ['published', 'auto_collected', true])
  for (const f of ['latitude', 'longitude', 'name_en', 'project_type']) assert.equal(p.field_status[f].state, 'editor_verified', f)
  assert.equal((await rows(db, `select visibility from public.archive_projects where id=$1`, [draft.project_id]))[0].visibility, 'draft')
  const [audit] = await rows(db, `select actor from public.archive_audit_log where action='candidate.approve_new' and entity_id=$1`, [KINETIC])
  assert.equal(audit.actor, EDITOR)
  SLUG = p.slug
})

test('public: the project is in public_archive_projects with its sources and no reviewer data; archive_search finds it', async () => {
  const list = await publicRows()
  assert.deepEqual(list.map((r) => r.slug), [SLUG], 'the draft is not public')
  const [row] = list
  assert.deepEqual([row.name_en, row.country_iso2, row.region, row.city, row.project_type, row.latitude, row.longitude, row.location_precision], ['Seoul Office Tower Kinetic Facade', 'KR', 'east_asia', 'Seoul', 'media_facade', 37.5704, 126.9829, 'exact'])
  assert.equal(row.sources.length, 1, 'two hits of one URL are one source')
  assert.deepEqual([row.sources[0].url, row.sources[0].kind, row.sources[0].link_state], [DEZEEN_URL, 'specialist_media', 'unknown'])
  assert.ok(['name_en', 'city', 'project_type'].every((f) => row.sources[0].supports.includes(f)))
  assert.deepEqual([row.media, row.credits, row.assessments], [[], [], []])
  // No reviewer data: no user id, no review note, no internal column, whatever the client selects or not.
  const [all] = await q(db, 'anon', null, `select * from public.${ARCHIVE_VIEW} where slug=$1`, [SLUG])
  const text = JSON.stringify(all)
  for (const secret of [EDITOR, ADMIN, NOTE]) assert.ok(!text.includes(secret), 'reviewer data in the public view')
  for (const k of Object.keys(all)) assert.doesNotMatch(k, /_by$|internal_note|review_note|merged_into|claimed/, k)
  // archive_search (anon): by name, by city, with filters; the draft never.
  const search = async (/** @type {string|null} */ text, /** @type {any} */ filters = {}) => (await q(db, 'anon', null, `select slug from public.archive_search($1,$2::jsonb)`, [text, JSON.stringify(filters)])).map((r) => r.slug)
  assert.deepEqual(await search('kinetic'), [SLUG])
  assert.deepEqual(await search('seoul', { country_iso2: 'kr', project_type: 'media_facade' }), [SLUG])
  assert.deepEqual(await search(null, { region: 'europe' }), [])
  assert.deepEqual(await search('Thames'), [], 'drafts are not searchable')
  const stats = (await q(db, 'anon', null, `select public.archive_public_stats() s`))[0].s
  assert.equal(stats.total, 1)
})

test('client: the row becomes a mappable, searchable place that the catalogue search filters', async () => {
  const { projects, media } = fromArchiveRows(await publicRows(), { publicURL: PUBLIC_URL })
  assert.deepEqual([projects.length, media.length], [1, 0])
  const [place] = projects
  assert.deepEqual([place.place_id, place.origin, place.name_kr, place.country_iso2, place.city, place.project_type, place.primary_category, place.installation_method],
    ['AR-' + SLUG, 'archive', 'Seoul Office Tower Kinetic Facade', 'KR', 'Seoul', 'media_facade', 'Media Facade', 'kinetic'])
  assert.deepEqual([place.latitude, place.longitude, place.coordinate_review_status, place.coordinate_source_url], [37.5704, 126.9829, 'verified', `${PUBLIC_URL}/#place/AR-${SLUG}`], 'editor-verified coordinates without a source for them link to the record')
  assert.equal(X.mappable(place), true)
  assert.equal(X.coordKind(place), 'verified')
  assert.equal(place.sources[0].url, DEZEEN_URL)
  // Next to a curated place, the catalogue search finds and filters it like any other place.
  const curated = { place_id: 'SEOUL001', name_kr: '빛의 전당', name_en: 'Light Hall', primary_category: 'Media Art', city: '서울', district: '중구' }
  const places = [curated, place]
  const today = new Date().toISOString().slice(0, 10)
  const ids = (/** @type {any} */ f) => X.search(places, f, today).map((/** @type {any} */ p) => p.place_id)
  assert.deepEqual(ids({ q: 'kinetic' }), [place.place_id])
  assert.deepEqual(ids({ q: '서울 키네틱' }), [], 'every word must match')
  assert.deepEqual(ids({ project_type: ['media_facade'] }), [place.place_id])
  assert.deepEqual(ids({ installation_method: ['kinetic'], region: ['east_asia'] }), [place.place_id])
  assert.deepEqual(ids({ country: 'KR', city: '서울' }).sort(), ['SEOUL001', place.place_id].sort(), 'Seoul and 서울 are one city')
  assert.deepEqual(ids({ region: ['europe'] }), [])
  assert.equal(X.facetCounts(places, {}, today).project_type.media_facade, 1)
})

// ---- the next runs ---------------------------------------------------------------------------------------------
test('collect again: a second run over the same answers adds nothing; it only records that each article was seen again', async () => {
  const candidates = () => rows(db, `select c.id,c.status,c.score,c.confidence,c.matched_project_id,c.seen_count,(select count(*)::int from public.archive_candidate_hits h where h.candidate_id=c.id) hits
    from public.archive_candidates c order by c.id`)
  const before = { counts: await counts(), public: await publicRows(), candidates: await candidates() }
  const sentBefore = w.calls.length
  const second = await collect(SOURCES)
  for (const r of second.rules) assert.deepEqual([r.name, r.status, r.ingest.new_candidates, r.ingest.duplicates], [r.name, 'success', 0, r.items], r.name)
  assert.equal(second.aliases, 2, 'the approved projects are in the alias index now')
  assert.deepEqual(await counts(), before.counts)
  assert.deepEqual(await publicRows(), before.public)
  // Rule 2 (same provider, same URL) is a sighting: the candidate's seen_count grows by its hits, nothing else changes.
  assert.deepEqual(await candidates(), before.candidates.map((c) => ({ ...c, seen_count: c.seen_count + c.hits })))
  // The feed was asked conditionally with the ETag stored by the first run.
  const feed = w.calls.slice(sentBefore).find((c) => c.url === 'https://www.dezeen.com/feed/')
  assert.equal(new Headers(feed?.init.headers).get('if-none-match'), '"v1"')
  assert.equal((await rows(db, `select count(*)::int n from public.archive_runs where status='success'`))[0].n, 8)
})

test('failure: a source answering 503 is logged in archive_run_errors and its rule backs off (Retry-After honoured)', async () => {
  const before = await counts()
  const out = await collect(['Archinect'])
  const [r] = out.rules
  assert.deepEqual([r.status, r.fetched, r.errors], ['error', 0, [{ stage: 'fetch', http_status: 503, message: 'HTTP 503' }]])
  assert.equal(w.calls.filter((c) => c.url.startsWith('https://archinect.com/')).length, 1, 'a 2-hour Retry-After is not waited for')
  const [err] = await rows(db, `select e.run_id,e.rule_id,e.stage,e.http_status,e.url,r.status run_status from public.archive_run_errors e join public.archive_runs r on r.id=e.run_id`)
  assert.deepEqual([err.run_id, err.rule_id, err.stage, err.http_status, err.url, err.run_status], [r.run_id, RULES.Archinect, 'fetch', 503, 'https://archinect.com/feed/1/news', 'error'])
  const [rule] = await rows(db, `select last_status,failure_count,claimed_by,extract(epoch from backoff_until-now())/3600 b,next_run_at=backoff_until same from public.archive_collection_rules where id=$1`, [RULES.Archinect])
  assert.deepEqual([rule.last_status, rule.failure_count, rule.claimed_by, rule.same], ['error', 1, null, true])
  assert.ok(rule.b > 1.9 && rule.b <= 2, `backs off for the 2 h of Retry-After, beyond the 1 h formula (${rule.b} h)`)
  assert.deepEqual(await counts(), before, 'nothing ingested')
  // A scheduled (cron) claim skips it while it backs off; the console lists the error with its rule.
  const claimed = await serviceRpc('archive_claim_due_rules', { p_limit: 50, p_owner: 'integration-test', p_rule_ids: null })
  assert.ok(claimed.length > 0 && !claimed.some((/** @type {any} */ c) => c.id === RULES.Archinect))
  const errors = (await q(db, 'authenticated', EDITOR, `select x from public.archive_admin_list_errors(10) x`)).map((x) => x.x)
  assert.deepEqual(errors.map((e) => [e.rule_name, e.http_status]), [['Archinect', 503]])
  const dash = (await q(db, 'authenticated', EDITOR, `select public.archive_admin_dashboard() d`))[0].d
  assert.equal(dash.errors_24h, 1)
})
