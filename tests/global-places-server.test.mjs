// Server-side nationwide/worldwide sync (Edge Function sync-global-places): the rows it writes, its run logic, the
// app's reader for the view, and one end-to-end run against the real SQL (PGlite) that the app then reads.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { BRANCHES, GLOBAL_SYNC_INTERVAL_MS, mergeItems, parseBranch, checkImages } from '../edge-functions/_shared/global-places.mjs'
import { DEFAULT_POLICY } from '../edge-functions/_shared/live-media.mjs'
import {
  toServerRow, toServerRows, mediaUpdates, runServerSync, fromServerRows, verdictsFromServerRows, krFopFromEnv,
  KR_FOP_BASIS, KR_FOP_REASON, CHECK_BATCH, RECHECK_AFTER_MS, SERVER_COLUMNS,
} from '../edge-functions/_shared/global-places-server.mjs'
import { wdqsBranch, BRANCH_ROWS, FAILING, KOREA, WORLD, JAPAN } from './fixtures/global-places-fixtures.mjs'
import { fakeWdqs, fakeCommons, fixtureServerRows, serverViewRows } from './fixtures/global-places-server-fixtures.mjs'

const H = 3600e3
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString()
const OFF = { ...DEFAULT_POLICY, krFopDisplay: false }
// The places the browser sync builds from the same fixture answers.
const browserPlaces = () => mergeItems(BRANCHES.filter(b => !FAILING[b.id]).map(b => parseBranch(wdqsBranch(BRANCH_ROWS[b.id] || []), b.id).items))

// A Store that records every call (and answers imagesDue with the photos of the places applied so far).
function recordingStore() {
  const calls = { apply: [], prune: [], due: [], media: [] }
  const applied = new Map()
  return {
    calls, applied,
    async applyPlaces(rows, seenAt) { calls.apply.push({ n: rows.length, seenAt }); for (const r of rows) applied.set(r.qid, r); return rows.length },
    async prune(seenAt, failed) { calls.prune.push({ seenAt, failed }); return 0 },
    async imagesDue(limit, before, krFop) { calls.due.push({ limit, before, krFop }); return [...applied.values()].filter(r => r.image_file).slice(0, limit).map(r => ({ qid: r.qid, image_file: r.image_file })) },
    async setMedia(rows, at, krFop) { calls.media.push({ rows, at, krFop }); return rows.length },
  }
}

test('server rows: one per QID, the compact app record, coordinates and the authoritative branch list', () => {
  const places = browserPlaces()
  const rows = toServerRows([...places, places[0]])
  assert.equal(rows.length, places.length, 'one row per QID')
  for (const r of rows) {
    const p = places.find(x => x.wikidata === r.qid)
    assert.ok(p)
    assert.equal(r.record[0], r.qid)
    assert.deepEqual([r.scope, r.primary_category, r.latitude, r.longitude, r.sitelinks], [p.scope, p.primary_category, p.latitude, p.longitude, p.sitelinks])
    assert.deepEqual(r.branches, p.branches)
    assert.equal(r.image_file, p.image || null)
  }
  const gwangan = rows.find(r => r.qid === KOREA.gwangan.qid)
  assert.deepEqual(gwangan.branches.sort(), ['korea:classes', 'korea:seeds'])
  assert.equal(gwangan.scope, 'korea')
  assert.equal(gwangan.image_file, 'Gwangan Bridge night.jpg')
  // Unusable places are never sent.
  assert.equal(toServerRow({ ...places[0], wikidata: 'X1' }), null)
  assert.equal(toServerRow({ ...places[0], latitude: NaN }), null)
  assert.equal(toServerRow({ ...places[0], primary_category: null }), null)
})

test('server rows round-trip into exactly the places the browser sync builds', () => {
  const places = browserPlaces()
  const seen = iso(Date.now())
  const rows = toServerRows(places).map(r => ({ ...r, image_status: 'pending', image_reasons: [], media: [], media_checked_at: null, last_seen_at: seen }))
  const out = fromServerRows(rows.reverse())
  assert.deepEqual(out.places, places)
  assert.equal(out.fetchedAt, seen)
  assert.deepEqual(out.verdicts, [], 'pending photos have no verdict yet')
  // The app selects exactly the columns the reader needs.
  for (const c of ['qid', 'record', 'branches', 'image_file', 'image_status', 'image_reasons', 'media', 'media_checked_at', 'last_seen_at']) assert.ok(SERVER_COLUMNS.split(',').includes(c), c)
})

test('photo verdicts: cleared rows carry the attribution for their place, blocked rows their reasons; KR FoP follows the env', async () => {
  const items = [{ qid: WORLD.vivid.qid, image_file: 'Vivid Sydney 2019.jpg' }, { qid: WORLD.lyon.qid, image_file: 'Fete des Lumieres Lyon.jpg' }, { qid: WORLD.graz.qid, image_file: 'Kunsthaus Graz.jpg' },
    { qid: KOREA.jinju.qid, image_file: 'Jinju lantern festival.jpg' }, { qid: 'Q99999999', image_file: 'Vivid Sydney 2019.jpg' }, { qid: 'Q99999998', image_file: 'Gone.jpg' }]
  const check = policy => checkImages(items.map(i => ({ place_id: 'WD-' + i.qid, wikidata: i.qid, image: i.image_file })), { fetchJSON: fakeCommons(), now: '2026-10-13T03:53:00.000Z', policy })
  const on = new Map(mediaUpdates(items, await check(DEFAULT_POLICY)).map(u => [u.qid, u]))
  const vivid = on.get(WORLD.vivid.qid)
  assert.equal(vivid.status, 'cleared')
  assert.equal(vivid.media.length, 1)
  assert.deepEqual([vivid.media[0].place_code, vivid.media[0].wikidata, vivid.media[0].creator, vivid.media[0].license_code, vivid.media[0].clearance_status, vivid.media[0].review_required],
    ['WD-' + WORLD.vivid.qid, WORLD.vivid.qid, 'Lee Photographer', 'CC BY-SA 4.0', 'cleared', false])
  assert.equal(vivid.media[0].source_url, 'https://commons.wikimedia.org/wiki/File:Vivid_Sydney_2019.jpg')
  // The same file on another place gets its own place code.
  assert.equal(on.get('Q99999999').media[0].place_code, 'WD-Q99999999')
  assert.deepEqual([on.get(WORLD.lyon.qid).status, on.get(WORLD.lyon.qid).reasons, on.get(WORLD.lyon.qid).media], ['blocked', ['foreign_no_freedom_of_panorama'], []])
  assert.deepEqual(on.get(WORLD.graz.qid).reasons, ['license_not_allowed'])
  assert.deepEqual(on.get('Q99999998').reasons, ['missing'])
  assert.equal(on.get(KOREA.jinju.qid).media[0].rights_basis, KR_FOP_BASIS)
  const off = new Map(mediaUpdates(items, await check(OFF)).map(u => [u.qid, u]))
  assert.deepEqual([off.get(KOREA.jinju.qid).status, off.get(KOREA.jinju.qid).reasons], ['blocked', [KR_FOP_REASON]])
  for (const v of [undefined, null, '', 'true', '1', 'on', 'yes']) assert.equal(krFopFromEnv(v), true, String(v))
  for (const v of ['false', 'FALSE', '0', 'off', ' no ']) assert.equal(krFopFromEnv(v), false, v)
})

test('the app reads the server verdicts under its own KR FoP policy and ignores malformed rows', async () => {
  const now = Date.now(), seenAt = iso(now - H), checkedAt = iso(now - 2 * H)
  const view = await serverViewRows({ seenAt, checkedAt })
  const { places, verdicts, fetchedAt } = fromServerRows(view)
  assert.equal(fetchedAt, seenAt)
  const byFile = new Map(verdicts.map(v => [v.file, v]))
  assert.deepEqual([...byFile.keys()].sort(), ['Fete des Lumieres Lyon.jpg', 'Gwangan Bridge night.jpg', 'Jinju lantern festival.jpg', 'Kunsthaus Graz.jpg', 'Vivid Sydney 2019.jpg'])
  const vivid = byFile.get('Vivid Sydney 2019.jpg')
  assert.equal(vivid.ok, true); assert.equal(vivid.at, Date.parse(checkedAt))
  assert.equal(vivid.row.creator, 'Lee Photographer')
  assert.equal(vivid.row.place_code, undefined, 'the app adds place_code and wikidata per place')
  assert.deepEqual(byFile.get('Fete des Lumieres Lyon.jpg').reasons, ['foreign_no_freedom_of_panorama'])
  assert.equal(byFile.get('Jinju lantern festival.jpg').ok, true)
  // The app's policy is off: a Korean-FoP photo the server cleared is blocked here.
  const strict = new Map(fromServerRows(view, { policy: OFF }).verdicts.map(v => [v.file, v]))
  assert.deepEqual([strict.get('Jinju lantern festival.jpg').ok, strict.get('Jinju lantern festival.jpg').reasons], [false, [KR_FOP_REASON]])
  // The server's policy was off but the app's is on: the app checks that photo itself (no verdict).
  const serverOff = await serverViewRows({ seenAt, checkedAt, policy: OFF })
  assert.equal(fromServerRows(serverOff).verdicts.some(v => v.file === 'Jinju lantern festival.jpg'), false)
  assert.equal(fromServerRows(serverOff, { policy: OFF }).verdicts.find(v => v.file === 'Jinju lantern festival.jpg').ok, false)
  // Malformed rows: wrong record, foreign QID, unsafe photo URL, media for another file, unknown status, no check time.
  const vividRow = view.find(r => r.qid === WORLD.vivid.qid)
  const bad = [
    { ...vividRow, qid: 'Q1', record: vividRow.record },
    { ...vividRow, qid: 'drop table' },
    { ...vividRow, media: [{ ...vividRow.media[0], display_url: 'javascript:alert(1)' }] },
    { ...vividRow, media: [{ ...vividRow.media[0], provider_asset_id: 'Other.jpg' }] },
    { ...vividRow, media: [{ ...vividRow.media[0], review_required: true }] },
    { ...vividRow, image_status: 'ok' },
    { ...vividRow, media_checked_at: null },
  ]
  assert.deepEqual(fromServerRows(bad.slice(0, 2)).places, [])
  assert.deepEqual(verdictsFromServerRows(bad.slice(2)), [])
  assert.throws(() => fromServerRows({ error: 'x' }), /invalid_server_payload/)
  assert.equal(places.length, view.length)
})

test('runServerSync: one tagged query per branch, upserts in chunks, keeps what failed branches found, checks due photos', async () => {
  const wdqs = [], commons = [], store = recordingStore()
  const now = '2026-10-13T03:53:00.000Z'
  const r = await runServerSync({ fetchWdqs: fakeWdqs({ calls: wdqs }), fetchCommons: fakeCommons({ calls: commons }), store, now, chunk: 7 })
  assert.equal(r.status, 'partial')
  assert.deepEqual(wdqs.map(c => c.id).sort(), BRANCHES.map(b => b.id).sort())
  for (const c of wdqs) { assert.equal(c.init.method, 'POST'); assert.equal(c.url, 'https://query.wikidata.org/sparql') }
  assert.deepEqual(r.branches.filter(b => !b.ok).map(b => b.id).sort(), Object.keys(FAILING).sort())
  const expected = fixtureServerRows()
  assert.equal(store.applied.size, expected.length)
  assert.ok(expected.length > 7)
  assert.deepEqual(store.calls.apply.map(c => c.n), Array.from({ length: Math.ceil(expected.length / 7) }, (_, i) => Math.min(7, expected.length - 7 * i)))
  assert.ok(store.calls.apply.every(c => c.seenAt === now))
  assert.deepEqual(store.calls.prune, [{ seenAt: now, failed: r.branches.filter(b => !b.ok).map(b => b.id) }])
  assert.deepEqual(store.calls.due, [{ limit: 3000, before: iso(Date.parse(now) - RECHECK_AFTER_MS), krFop: true }])
  const files = expected.filter(x => x.image_file).length
  assert.equal(commons.length, 1, 'one Commons request for up to 50 files')
  assert.deepEqual([r.images.due, r.images.checked, r.images.cleared, r.images.blocked, r.images.deferred, r.images.error], [files, files, 3, 2, 0, null])
  assert.ok(store.calls.media.every(c => c.at === now && c.krFop === true))
  assert.deepEqual([r.stats.rows, r.stats.upserted, r.stats.places, r.stats.korea + r.stats.world], [expected.length, expected.length, expected.length, expected.length])
  // KR FoP off: the policy goes to the due list and to every verdict.
  const off = recordingStore()
  await runServerSync({ fetchWdqs: fakeWdqs(), fetchCommons: fakeCommons(), store: off, now, policy: OFF })
  assert.equal(off.calls.due[0].krFop, false)
  assert.deepEqual(off.calls.media.flatMap(c => c.rows).find(u => u.qid === KOREA.jinju.qid).reasons, [KR_FOP_REASON])
  // Every branch answering: a successful run.
  const ok = await runServerSync({ fetchWdqs: fakeWdqs({ failing: {} }), fetchCommons: fakeCommons(), store: recordingStore(), now })
  assert.equal(ok.status, 'success')
})

test('runServerSync: nothing is written when every branch fails or no branch finds anything', async () => {
  const failAll = Object.fromEntries(BRANCHES.map(b => [b.id, 'http500']))
  const store = recordingStore()
  const r = await runServerSync({ fetchWdqs: fakeWdqs({ failing: failAll }), fetchCommons: fakeCommons(), store })
  assert.equal(r.status, 'failed')
  assert.equal(r.error, 'all_branches_failed')
  assert.equal(r.branches.length, BRANCHES.length, 'each branch is still reported')
  assert.ok(r.branches.every(b => !b.ok && b.error === 'HTTP 500'))
  const empty = await runServerSync({ fetchWdqs: fakeWdqs({ rows: {}, failing: {} }), fetchCommons: fakeCommons(), store })
  assert.deepEqual([empty.status, empty.error], ['failed', 'no_places'])
  assert.deepEqual(store.calls, { apply: [], prune: [], due: [], media: [] }, 'no upsert, no prune, no photo check')
})

test('runServerSync: the Wikidata deadline stops the queries, the deadline stops the photo checks, Commons errors stop only them', async () => {
  // Branches that never answer until aborted: the Wikidata deadline reports them as failed (and keeps their places).
  let clock = 0
  const slow = async (url, init) => {
    const id = new URLSearchParams(init.body).get('query').match(/branch=([a-z:-]+)/)[1]
    if (id === 'world:seeds') return wdqsBranch(BRANCH_ROWS['world:seeds'])
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Error('aborted'))))
  }
  const store = recordingStore()
  const r = await runServerSync({ fetchWdqs: slow, fetchCommons: fakeCommons(), store, clock: () => clock, wdqsDeadline: 50, deadline: 10_000, concurrency: 2 })
  assert.equal(r.status, 'partial')
  assert.deepEqual(r.branches.filter(b => b.ok).map(b => b.id), ['world:seeds'])
  assert.equal(r.branches.length, BRANCHES.length)
  assert.deepEqual(store.calls.prune[0].failed.sort(), BRANCHES.map(b => b.id).filter(id => id !== 'world:seeds').sort())
  // Many photos, a deadline after the first batch: the rest wait for the next run.
  const many = JAPAN.map((p, i) => ({ ...p, image: `Tokyo ${i}.jpg` }))
  const rows = { 'world:classes-art': [...many, ...many.map(p => ({ ...p, qid: 'Q9930' + p.qid.slice(-4), image: p.image.replace('Tokyo', 'Osaka') }))] }
  const s2 = recordingStore()
  let t = 0
  const commonsCalls = []
  const r2 = await runServerSync({ fetchWdqs: fakeWdqs({ rows, failing: {} }), fetchCommons: async url => { t = 100; return fakeCommons({ calls: commonsCalls })(url) }, store: s2, clock: () => t, deadline: 100 })
  assert.equal(r2.images.due, 60)
  assert.deepEqual([r2.images.checked, r2.images.deferred, commonsCalls.length], [CHECK_BATCH, 60 - CHECK_BATCH, 1])
  assert.equal(r2.images.blocked, CHECK_BATCH, 'unknown files are blocked as missing')
  assert.equal(r2.status, 'success', 'deferred photos are not an error')
  // Commons failing: the verdicts so far are kept, the run is partial, the places are written.
  const s3 = recordingStore()
  let n = 0
  const r3 = await runServerSync({ fetchWdqs: fakeWdqs({ rows, failing: {} }), fetchCommons: async url => { if (++n > 1) throw Error('HTTP 429'); return fakeCommons()(url) }, store: s3 })
  assert.deepEqual([r3.status, r3.images.error, r3.images.checked, s3.calls.media.length, s3.applied.size], ['partial', 'HTTP 429', CHECK_BATCH, 1, 60])
  // imageLimit 0: no photo check at all.
  const s4 = recordingStore()
  const r4 = await runServerSync({ fetchWdqs: fakeWdqs({ rows, failing: {} }), fetchCommons: fakeCommons(), store: s4, imageLimit: 0 })
  assert.deepEqual([r4.images.due, s4.calls.due.length], [0, 0])
})

test('end to end on the real SQL: two runs six hours apart, the app reads the view', async () => {
  const sql = async f => (await readFile(new URL('../' + f, import.meta.url), 'utf8'))
  const db = new PGlite()
  await db.exec(await sql('tests/sql/supabase-stubs.sql'))
  await db.exec(await sql('supabase/migrations/20261013000000_discovered_places.sql'))
  const call = async (q, params) => db.transaction(async tx => { await tx.exec('set local role service_role'); return (await tx.query(q, params)).rows[0].r })
  const store = {
    applyPlaces: (rows, seenAt) => call('select public.apply_discovered_places($1::jsonb,$2) r', [JSON.stringify(rows), seenAt]),
    prune: (seenAt, failed) => call('select public.prune_discovered_places($1,$2) r', [seenAt, failed]),
    imagesDue: (limit, before, krFop) => call('select public.discovered_images_due($1,$2,$3) r', [limit, before, krFop]),
    setMedia: (rows, at, krFop) => call('select public.set_discovered_media($1::jsonb,$2,$3) r', [JSON.stringify(rows), at, krFop]),
  }
  const read = () => db.transaction(async tx => { await tx.exec('set local role anon'); return (await tx.query(`select ${SERVER_COLUMNS} from public.public_discovered_places`)).rows })
  const t0 = Date.now() - 7 * H, t1 = t0 + GLOBAL_SYNC_INTERVAL_MS
  const commons = []
  const r1 = await runServerSync({ fetchWdqs: fakeWdqs({ failing: {} }), fetchCommons: fakeCommons({ calls: commons }), store, now: iso(t0) })
  assert.equal(r1.status, 'success')
  let app = fromServerRows(await read())
  assert.deepEqual(app.places.map(p => p.place_id).sort(), browserPlaces().map(p => p.place_id).sort())
  assert.equal(app.fetchedAt, iso(t0))
  assert.deepEqual(app.verdicts.filter(v => v.ok).map(v => v.file).sort(), ['Gwangan Bridge night.jpg', 'Jinju lantern festival.jpg', 'Vivid Sydney 2019.jpg'])
  // Six hours later: world:seeds fails and korea:classes no longer returns BUSAN X the SKY.
  const rows = { ...BRANCH_ROWS, 'korea:classes': BRANCH_ROWS['korea:classes'].filter(x => x.qid !== KOREA.busanSky.qid) }
  const r2 = await runServerSync({ fetchWdqs: fakeWdqs({ rows, failing: { 'world:seeds': 'http500' } }), fetchCommons: fakeCommons({ calls: commons }), store, now: iso(t1) })
  assert.equal(r2.status, 'partial')
  assert.equal(r2.stats.pruned, 1)
  app = fromServerRows(await read())
  const ids = new Set(app.places.map(p => p.wikidata))
  assert.ok(!ids.has(KOREA.busanSky.qid), 'gone from a branch that answered')
  for (const q of [WORLD.vivid.qid, WORLD.lyon.qid]) assert.ok(ids.has(q), 'kept: only the failed world:seeds returned ' + q)
  assert.equal(app.fetchedAt, iso(t1))
  // Vivid Sydney was not seen this time: it keeps its earlier last_seen_at, verdict and photo.
  const vivid = (await read()).find(r => r.qid === WORLD.vivid.qid)
  assert.equal(new Date(vivid.last_seen_at).toISOString(), iso(t0))
  assert.equal(vivid.image_status, 'cleared')
  assert.equal(commons.length, 2, 'every photo was due again after 6 hours: one Commons request per run')
  // Anonymous readers cannot reach the table itself.
  await assert.rejects(db.transaction(async tx => { await tx.exec('set local role anon'); await tx.query('select qid from public.discovered_places') }), /permission denied/)
  await db.close()
})

test('the function is deployed, scheduled every 6 hours, and finishes inside the request timeout', async () => {
  const text = async f => readFile(new URL('../' + f, import.meta.url), 'utf8')
  const deploy = await text('scripts/deploy-edge-functions.sh')
  assert.match(deploy.match(/^FUNCTIONS=\((.*)\)$/m)[1], /(^| )sync-global-places( |$)/)
  const cron = await text('release/launch/install-six-hour-sync.sql')
  const job = cron.match(/cron\.schedule\('aol-global-places-6h','([^']+)', \$job\$([\s\S]*?)\$job\$\)/)
  assert.ok(job, 'aol-global-places-6h is scheduled')
  assert.equal(job[1], '53 3,9,15,21 * * *', 'every 6 hours, after the other three jobs')
  assert.match(job[2], /\/functions\/v1\/sync-global-places'/)
  assert.match(job[2], /'x-aol-cron-secret'/)
  const budget = Number(job[2].match(/"budget_ms": (\d+)/)[1]), timeout = Number(job[2].match(/timeout_milliseconds := (\d+)/)[1])
  assert.ok(budget + 10000 <= timeout && timeout <= 150000, `budget ${budget} ms fits the ${timeout} ms request timeout and Supabase's 150 s limit`)
  const fn = await text('edge-functions/sync-global-places/index.ts')
  assert.match(fn, /authorizedSecret\(\[\[expected, supplied\], \[adminExpected, adminSupplied\]\]\)/)
  assert.equal(Number(fn.match(/clamp\(body\.budget_ms, (\d+),/)[1]), budget, 'the default budget is the scheduled one')
  for (const name of ['apply_discovered_places', 'prune_discovered_places', 'discovered_images_due', 'set_discovered_media']) {
    assert.match(fn, new RegExp(`rpc\\("${name}"`), name)
    assert.match(await text('supabase/migrations/20261013000000_discovered_places.sql'), new RegExp(`function public\\.${name}\\(`), name)
  }
})
