// Server-side nationwide/worldwide sync (Edge Function sync-global-places): the rows it writes, its run logic, the
// app's reader for the view, and one end-to-end run against the real SQL (PGlite) that the app then reads.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { BRANCHES, GLOBAL_SYNC_INTERVAL_MS, mergeItems, parseBranch, checkImages } from '../edge-functions/_shared/global-places.mjs'
import { DEFAULT_POLICY, fetchCommonsPages } from '../edge-functions/_shared/live-media.mjs'
import {
  toServerRow, toServerRows, mediaUpdates, runServerSync, runServerImages, checkDueImages, serverBranchOrder, droppedBranches, runAlerts,
  fromServerRows, verdictsFromServerRows, krFopFromEnv,
  KR_FOP_BASIS, KR_FOP_REASON, EDITORIAL_REASON, CHECK_BATCH, RECHECK_AFTER_MS, VERDICT_TTL_MS, MAX_BUDGET_MS, ALERT_STREAK, BRANCH_DROP_RATIO, SERVER_COLUMNS,
} from '../edge-functions/_shared/global-places-server.mjs'
import { wdqsBranch, BRANCH_ROWS, FAILING, KOREA, WORLD, JAPAN } from './fixtures/global-places-fixtures.mjs'
import { fakeWdqs, fakeCommons, fixtureServerRows, serverViewRows } from './fixtures/global-places-server-fixtures.mjs'

const H = 3600e3
const iso = (/** @type {number} */ ms) => new Date(ms).toISOString()
const OFF = { ...DEFAULT_POLICY, krFopDisplay: false }
// The places the browser sync builds from the same fixture answers.
const browserPlaces = () => mergeItems(BRANCHES.filter(b => !FAILING[b.id]).map(b => parseBranch(wdqsBranch(BRANCH_ROWS[b.id] || []), b.id).items))

// A Store that records every call (and answers imagesDue with the photos of the places applied so far, branchCounts
// with the places applied so far per branch).
function recordingStore() {
  const calls = { apply: [], prune: [], due: [], media: [], counts: [] }
  const applied = new Map()
  return {
    calls, applied,
    async applyPlaces(rows, seenAt) { calls.apply.push({ n: rows.length, seenAt }); for (const r of rows) applied.set(r.qid, r); return rows.length },
    async prune(seenAt, failed) { calls.prune.push({ seenAt, failed }); return 0 },
    async branchCounts(seenAt) { const c = {}; for (const r of applied.values()) for (const b of r.branches) c[b] = (c[b] || 0) + 1; calls.counts.push(c); return c },
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
  const r = await runServerSync({ fetchWdqs: fakeWdqs({ calls: wdqs }), fetchCommons: fakeCommons({ calls: commons }), store, now, chunk: 7, rotation: 5 })
  assert.equal(r.status, 'partial')
  assert.deepEqual(wdqs.map(c => c.id).sort(), BRANCHES.map(b => b.id).sort())
  // Start order: the expensive branch first, the others rotated for this run; the report follows it.
  assert.deepEqual(wdqs.map(c => c.id), serverBranchOrder(BRANCHES, 5).map(b => b.id))
  assert.equal(wdqs[0].id, 'korea:name-keywords')
  assert.deepEqual(r.branches.map(b => b.id), wdqs.map(c => c.id))
  assert.deepEqual(store.calls.counts, [{}], 'stored counts read once, before the first upsert')
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
  assert.deepEqual(store.calls, { apply: [], prune: [], due: [], media: [], counts: [] }, 'no upsert, no prune, no photo check')
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
  // Rotation 1: world:seeds is the first cheap branch, next to the expensive one (which never answers here).
  const r = await runServerSync({ fetchWdqs: slow, fetchCommons: fakeCommons(), store, clock: () => clock, wdqsDeadline: 50, deadline: 10_000, concurrency: 2, rotation: 1 })
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
  const r2 = await runServerSync({ fetchWdqs: fakeWdqs({ rows, failing: {} }), fetchCommons: async url => { t = 60_000; return fakeCommons({ calls: commonsCalls })(url) }, store: s2, clock: () => t, deadline: 60_000 })
  assert.equal(r2.images.due, 60)
  assert.deepEqual([r2.images.checked, r2.images.deferred, r2.images.stopped, commonsCalls.length], [CHECK_BATCH, 60 - CHECK_BATCH, 'deadline', 1])
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

// Slow Commons answers: each round waits `ms` (or until its request is aborted) and always asks for another round.
function slowCommons({ ms, calls = [], ignoreAbort = false }) {
  return (url, init = {}) => {
    calls.push({ url, signal: init.signal })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ continue: { tlcontinue: String(calls.length), continue: '||' }, query: { pages: [] } }), ms)
      if (!ignoreAbort) init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal.reason) }, { once: true })
    })
  }
}
const dueStore = (n, extra = {}) => {
  const store = recordingStore()
  for (let i = 0; i < n; i++) store.applied.set('Q77' + String(i).padStart(3, '0'), { qid: 'Q77' + String(i).padStart(3, '0'), branches: ['world:seeds'], image_file: `Slow ${i}.jpg` })
  return Object.assign(store, extra)
}

test('photo checks stop at the deadline even when Commons is slow inside one batch (continuation rounds, hung requests)', async () => {
  // Real time: each continuation round takes 120 ms and never ends; the deadline is 400 ms away. Without the deadline
  // signal this one batch would run MAX_COMMONS_ROUNDS (40) rounds, about 5 s.
  for (const ignoreAbort of [false, true]) {
    const calls = [], store = dueStore(3)
    const t0 = Date.now()
    const images = await checkDueImages({ fetchCommons: slowCommons({ ms: 120, calls, ignoreAbort }), store, deadline: t0 + 400 })
    const took = Date.now() - t0
    assert.ok(took < 400 + 250, `returned ${took} ms after the start, deadline 400 ms (ignoreAbort ${ignoreAbort})`)
    assert.deepEqual([images.due, images.checked, images.deferred, images.stopped, images.error], [3, 0, 3, 'deadline', null])
    assert.ok(calls.length >= 1 && calls.length <= 5, `${calls.length} rounds, not 40`)
    assert.ok(calls.every(c => c.signal instanceof AbortSignal), 'every Commons request carries the deadline signal')
    assert.ok(calls.at(-1).signal.aborted, 'the request in flight at the deadline is aborted')
    assert.deepEqual(store.calls.media, [], 'the unfinished batch stores no verdict')
  }
  // A request that never answers at all.
  const hung = await checkDueImages({ fetchCommons: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))), store: dueStore(2), deadline: Date.now() + 200 })
  assert.deepEqual([hung.stopped, hung.checked, hung.error], ['deadline', 0, null])
  // Virtual clock (the reviewer's probe): the batch starts 1 s before the deadline and every round takes 25 s. No
  // further round starts once the clock has passed the deadline: 1 request, not 6.
  let t = 121_000
  const rounds = []
  const probe = await checkDueImages({
    fetchCommons: async (url, init) => { rounds.push(url); t += 25_000; return slowCommons({ ms: 0 })(url, init) },
    store: dueStore(4), clock: () => t, deadline: 122_000,
  })
  assert.deepEqual([rounds.length, probe.stopped, probe.checked, probe.deferred], [1, 'deadline', 0, 4])
  assert.ok(t <= 122_000 + 25_000)
  // Before the deadline nothing changes: every batch is checked and stored.
  const fine = await checkDueImages({ fetchCommons: fakeCommons(), store: dueStore(CHECK_BATCH + 3), deadline: Date.now() + 10_000 })
  assert.deepEqual([fine.due, fine.checked, fine.deferred, fine.stopped, fine.blocked], [CHECK_BATCH + 3, CHECK_BATCH + 3, 0, null, CHECK_BATCH + 3])
})

test('fetchCommonsPages/checkImages with a signal: every round carries it, no round starts once it is aborted', async () => {
  const stop = new AbortController()
  const seen = []
  const fetchJSON = async (url, init) => { seen.push(init?.signal); if (seen.length === 2) stop.abort(Error('deadline')); return { continue: { tlcontinue: 'x' }, query: { pages: [] } } }
  await assert.rejects(fetchCommonsPages(['A.jpg'], fetchJSON, { signal: stop.signal }), /deadline/)
  assert.equal(seen.length, 2, 'the third round never starts')
  assert.ok(seen.every(s => s === stop.signal))
  await assert.rejects(checkImages([{ place_id: 'WD-Q1', wikidata: 'Q1', image: 'A.jpg' }], { fetchJSON, signal: stop.signal }), /deadline/)
  assert.equal(seen.length, 2, 'an aborted signal: no request at all')
  // Without a signal nothing changes (the browser sync calls it this way).
  const plain = []
  await fetchCommonsPages(['A.jpg'], async (...args) => { plain.push(args.length); return { query: { pages: [] } } })
  assert.deepEqual(plain, [1])
})

test('the photo phase: only photo checks, the whole budget; failed only when Commons fails before any check', async () => {
  const store = dueStore(CHECK_BATCH + 10)
  const commons = []
  const r = await runServerImages({ fetchCommons: fakeCommons({ calls: commons }), store, now: '2026-10-13T04:23:00.000Z' })
  assert.deepEqual([r.status, r.images.due, r.images.checked, commons.length, store.calls.apply.length, store.calls.prune.length], ['success', CHECK_BATCH + 10, CHECK_BATCH + 10, 2, 0, 0])
  assert.deepEqual(store.calls.due, [{ limit: 3000, before: iso(Date.parse('2026-10-13T04:23:00.000Z') - RECHECK_AFTER_MS), krFop: true }])
  let n = 0
  const second = await runServerImages({ fetchCommons: async url => { if (++n > 1) throw Error('HTTP 429'); return fakeCommons()(url) }, store: dueStore(CHECK_BATCH + 10) })
  assert.deepEqual([second.status, second.images.error, second.images.checked], ['partial', 'HTTP 429', CHECK_BATCH])
  const down = await runServerImages({ fetchCommons: async () => { throw Error('HTTP 503') }, store: dueStore(5) })
  assert.deepEqual([down.status, down.images.error, down.images.checked, down.images.deferred], ['failed', 'HTTP 503', 0, 5])
  const none = await runServerImages({ fetchCommons: fakeCommons(), store: dueStore(0) })
  assert.deepEqual([none.status, none.images.due], ['success', 0])
})

test('branch order: the expensive branch starts first, the others rotate so a different branch is last each run', () => {
  const cheap = BRANCHES.filter(b => !b.expensive).map(b => b.id)
  const lasts = new Set()
  for (let slot = 0; slot < cheap.length; slot++) {
    const order = serverBranchOrder(BRANCHES, slot).map(b => b.id)
    assert.equal(order[0], 'korea:name-keywords')
    assert.deepEqual([...order].sort(), BRANCHES.map(b => b.id).sort(), 'every branch once')
    assert.equal(order[1], cheap[slot])
    lasts.add(order.at(-1))
  }
  assert.equal(lasts.size, cheap.length, 'over one full rotation every cheap branch is started last once')
  assert.deepEqual(serverBranchOrder(BRANCHES, cheap.length + 2), serverBranchOrder(BRANCHES, 2))
  assert.deepEqual(serverBranchOrder(BRANCHES, -1), serverBranchOrder(BRANCHES, cheap.length - 1))
  assert.deepEqual(serverBranchOrder(BRANCHES, NaN), serverBranchOrder(BRANCHES, 0))
  // The run's 6-hour slot moves the order by one place per scheduled run.
  const slotOf = ms => Math.floor(ms / GLOBAL_SYNC_INTERVAL_MS)
  const a = Date.parse('2026-10-13T03:53:00Z'), b = a + GLOBAL_SYNC_INTERVAL_MS
  assert.equal(serverBranchOrder(BRANCHES, slotOf(b))[1].id, serverBranchOrder(BRANCHES, slotOf(a) + 1)[1].id)
})

test('a branch that answers with less than half of its stored places counts as failed for pruning', () => {
  const rows = [{ branches: ['a', 'b'] }, { branches: ['a'] }, { branches: ['c'] }]
  const report = [{ id: 'a', ok: true }, { id: 'b', ok: true }, { id: 'c', ok: true }, { id: 'd', ok: true }, { id: 'e', ok: false }, { id: 'new', ok: true }]
  assert.equal(BRANCH_DROP_RATIO, 0.5)
  assert.deepEqual(droppedBranches(report, rows, { a: 4, b: 3, c: 1, d: 5, e: 9 }), [{ id: 'b', rows: 1, stored: 3 }, { id: 'd', rows: 0, stored: 5 }],
    'a: 2 of 4 is not below half; c: 1 of 1; e failed anyway; new: nothing stored yet')
  assert.deepEqual(droppedBranches(report, rows, {}), [])
  assert.deepEqual(droppedBranches(report, rows, { a: 'x', b: -3 }), [])
})

test('alerts: the same branch failing, or photos deferred by the photo phase, three runs in a row', () => {
  assert.equal(ALERT_STREAK, 3)
  const run = (branches, deferred = 0) => ({ status: 'partial', metadata: { branches, images: { deferred } } })
  const fail = id => ({ id, ok: false }), ok = id => ({ id, ok: true }), suspect = id => ({ id, ok: true, suspect: true })
  const result = { branches: [fail('korea:name-keywords'), suspect('korea:classes'), fail('world:genres'), ok('world:seeds')] }
  const history = [run([fail('korea:name-keywords'), fail('korea:classes'), ok('world:genres')]), run([suspect('korea:name-keywords'), fail('korea:classes'), fail('world:genres')])]
  assert.deepEqual(runAlerts({ phase: 'places', result, history }), ['branch_failing: korea:name-keywords failed 3 runs in a row', 'branch_failing: korea:classes failed 3 runs in a row'])
  assert.deepEqual(runAlerts({ phase: 'places', result, history: history.slice(0, 1) }), [], 'not enough history yet')
  assert.deepEqual(runAlerts({ phase: 'places', result, history: [{ status: 'failed', metadata: null }, ...history] }), [], 'a run without a branch report breaks the streak')
  const images = d => ({ images: { deferred: d } })
  const photoRuns = [run([], 120), run([], 40)]
  assert.deepEqual(runAlerts({ phase: 'images', result: images(300), history: photoRuns }), ['photo_backlog: 300 photos deferred, 3 photo runs in a row'])
  assert.deepEqual(runAlerts({ phase: 'images', result: images(0), history: photoRuns }), [])
  assert.deepEqual(runAlerts({ phase: 'images', result: images(300), history: [run([], 0), photoRuns[0]] }), [])
  assert.deepEqual(runAlerts({ phase: 'places', result: { branches: [], images: { deferred: 999 } }, history: photoRuns }), [], 'photos left over by a place run are expected')
})

// The real SQL (PGlite) behind a Store, and the app's read of the view.
async function sqlStore() {
  const sql = async f => (await readFile(new URL('../' + f, import.meta.url), 'utf8'))
  const db = new PGlite()
  await db.exec(await sql('tests/sql/supabase-stubs.sql'))
  await db.exec(await sql('supabase/migrations/20261013000000_discovered_places.sql'))
  const call = async (q, params) => db.transaction(async tx => { await tx.exec('set local role service_role'); return (await tx.query(q, params)).rows[0].r })
  const store = {
    applyPlaces: (rows, seenAt) => call('select public.apply_discovered_places($1::jsonb,$2) r', [JSON.stringify(rows), seenAt]),
    prune: (seenAt, failed) => call('select public.prune_discovered_places($1,$2) r', [seenAt, failed]),
    branchCounts: seenAt => call('select public.discovered_branch_counts($1) r', [seenAt]),
    imagesDue: (limit, before, krFop) => call('select public.discovered_images_due($1,$2,$3) r', [limit, before, krFop]),
    setMedia: (rows, at, krFop) => call('select public.set_discovered_media($1::jsonb,$2,$3) r', [JSON.stringify(rows), at, krFop]),
  }
  const read = () => db.transaction(async tx => { await tx.exec('set local role anon'); return (await tx.query(`select ${SERVER_COLUMNS} from public.public_discovered_places`)).rows })
  return { db, store, read }
}

test('end to end on the real SQL: two runs six hours apart, the app reads the view', async () => {
  const { db, store, read } = await sqlStore()
  const t0 = Date.now() - 7 * H, t1 = t0 + GLOBAL_SYNC_INTERVAL_MS
  const commons = []
  const r1 = await runServerSync({ fetchWdqs: fakeWdqs({ failing: {} }), fetchCommons: fakeCommons({ calls: commons }), store, now: iso(t0) })
  assert.equal(r1.status, 'success')
  let app = fromServerRows(await read())
  assert.deepEqual(app.places.map(p => p.place_id).sort(), browserPlaces().map(p => p.place_id).sort())
  assert.equal(app.fetchedAt, iso(t0))
  assert.deepEqual(app.verdicts.filter(v => v.ok).map(v => v.file).sort(), ['Gwangan Bridge night.jpg', 'Jinju lantern festival.jpg', 'Vivid Sydney 2019.jpg'])
  // Six hours later: world:seeds fails and korea:classes no longer returns BUSAN X the SKY (2 of its 3: not a sharp drop).
  const rows = { ...BRANCH_ROWS, 'korea:classes': BRANCH_ROWS['korea:classes'].filter(x => x.qid !== KOREA.busanSky.qid) }
  const r2 = await runServerSync({ fetchWdqs: fakeWdqs({ rows, failing: { 'world:seeds': 'http500' } }), fetchCommons: fakeCommons({ calls: commons }), store, now: iso(t1) })
  assert.equal(r2.status, 'partial')
  assert.equal(r2.stats.pruned, 1)
  assert.equal(r2.stats.suspect, 0)
  app = fromServerRows(await read())
  const ids = new Set(app.places.map(p => p.wikidata))
  assert.ok(!ids.has(KOREA.busanSky.qid), 'gone from a branch that answered')
  for (const q of [WORLD.vivid.qid, WORLD.lyon.qid]) assert.ok(ids.has(q), 'kept: only the failed world:seeds returned ' + q)
  assert.equal(app.fetchedAt, iso(t1))
  // Vivid Sydney was not seen this time: it keeps its earlier last_seen_at, verdict and photo.
  const vivid = (await read()).find(r => r.qid === WORLD.vivid.qid)
  assert.equal(new Date(vivid.last_seen_at).toISOString(), iso(t0))
  assert.equal(vivid.image_status, 'cleared')
  assert.equal(commons.length, 1, 'six hours later no verdict was due yet (re-checked after 12 hours): one Commons request in two runs')
  // Anonymous readers cannot reach the table itself.
  await assert.rejects(db.transaction(async tx => { await tx.exec('set local role anon'); await tx.query('select qid from public.discovered_places') }), /permission denied/)
  await db.close()
})

test('end to end on the real SQL: a branch answering with almost nothing keeps its places until the drop has lasted 72 hours', async () => {
  const { db, store, read } = await sqlStore()
  const t0 = Date.now() - 7 * H, t1 = t0 + GLOBAL_SYNC_INTERVAL_MS
  await runServerSync({ fetchWdqs: fakeWdqs({ failing: {} }), fetchCommons: fakeCommons(), store, now: iso(t0) })
  const before = (await read()).length
  // korea:classes answers OK with no rows (the reviewer's probe: this used to be a "success" that pruned BUSAN X the SKY).
  const empty = { ...BRANCH_ROWS, 'korea:classes': [] }
  const r2 = await runServerSync({ fetchWdqs: fakeWdqs({ rows: empty, failing: {} }), fetchCommons: fakeCommons(), store, now: iso(t1) })
  assert.equal(r2.status, 'partial')
  const classes = r2.branches.find(b => b.id === 'korea:classes')
  assert.deepEqual([classes.ok, classes.suspect, classes.stored, classes.rows], [true, true, 3, 0])
  assert.deepEqual([r2.stats.suspect, r2.stats.pruned], [1, 0])
  const view = await read()
  assert.equal(view.length, before, 'nothing deleted')
  assert.equal(view.find(r => r.qid === KOREA.busanSky.qid)?.image_status, 'none', 'BUSAN X the SKY (found only by korea:classes) is still shown')
  // A run 74 hours after the last full answer: the old rows no longer count, so the drop is accepted and pruned.
  const r3 = await runServerSync({ fetchWdqs: fakeWdqs({ rows: empty, failing: {} }), fetchCommons: fakeCommons(), store, now: iso(t0 + 74 * H) })
  assert.deepEqual([r3.status, r3.stats.suspect, r3.stats.pruned >= 1], ['success', 0, true])
  const left = await db.query(`select count(*)::int n from public.discovered_places where qid=$1`, [KOREA.busanSky.qid])
  assert.equal(left.rows[0].n, 0)
  await db.close()
})

test('end to end on the real SQL: the photo phase keeps verdicts current; editorial blocks last and reach the app', async () => {
  const { db, store, read } = await sqlStore()
  const t0 = Date.now() - 2 * H
  // The place run has no time left for photos (imageLimit 0): the photo phase checks them all.
  const r1 = await runServerSync({ fetchWdqs: fakeWdqs({ failing: {} }), fetchCommons: fakeCommons(), store, now: iso(t0), imageLimit: 0 })
  assert.equal(r1.images.due, 0)
  assert.ok(fromServerRows(await read()).verdicts.length === 0, 'no verdicts yet')
  const commons = []
  const p1 = await runServerImages({ fetchCommons: fakeCommons({ calls: commons }), store, now: iso(t0 + 30 * 60e3) })
  assert.deepEqual([p1.status, p1.images.checked, p1.images.deferred, commons.length], ['success', 5, 0, 1])
  assert.equal(fromServerRows(await read()).verdicts.length, 5)
  // Three hours later nothing is due; 12 hours after the check everything is.
  assert.equal((await runServerImages({ fetchCommons: fakeCommons({ calls: commons }), store, now: iso(t0 + 3.5 * H) })).images.due, 0)
  // An operator blocks the Vivid Sydney photo (rights complaint) and hides Lyon altogether.
  await db.exec(`update public.discovered_places set image_block='rights complaint, ticket 12' where qid='${WORLD.vivid.qid}';
    update public.discovered_places set place_block='not a light place' where qid='${WORLD.lyon.qid}'`)
  const readAt = Date.now()
  let app = fromServerRows(await read())
  assert.ok(!app.places.some(p => p.wikidata === WORLD.lyon.qid), 'a blocked place is not in the view')
  const vivid = app.verdicts.find(v => v.file === 'Vivid Sydney 2019.jpg')
  assert.deepEqual([vivid.ok, vivid.reasons, vivid.row], [false, [EDITORIAL_REASON], null])
  assert.ok(vivid.at >= readAt - 1000, 'the block is a current verdict: it replaces any older verdict a browser holds')
  const p2 = await runServerImages({ fetchCommons: fakeCommons({ calls: commons }), store, now: iso(t0 + 13 * H) })
  assert.equal(p2.images.due, 3, 'every photo due again after 12 hours, except the blocked ones')
  assert.ok(!commons.at(-1).includes('Vivid') && !commons.at(-1).includes('Lumieres'), 'blocked photos are never re-checked')
  // A verdict for the blocked photo (e.g. from an older run) is ignored.
  assert.equal(await store.setMedia([{ qid: WORLD.vivid.qid, image_file: 'Vivid Sydney 2019.jpg', status: 'cleared', reasons: [], media: [{ provider_asset_id: 'Vivid Sydney 2019.jpg' }] }], iso(t0 + 14 * H), true), 0)
  // world:seeds stops returning Vivid Sydney (2 of 3: not a sharp drop, so it would be pruned): the block keeps it.
  const rows = { ...BRANCH_ROWS, 'world:seeds': BRANCH_ROWS['world:seeds'].filter(x => x.qid !== WORLD.vivid.qid) }
  const r2 = await runServerSync({ fetchWdqs: fakeWdqs({ rows, failing: {} }), fetchCommons: fakeCommons(), store, now: iso(t0 + 6 * H), imageLimit: 0 })
  assert.equal(r2.stats.suspect, 0)
  const kept = await db.query(`select qid,image_block,place_block from public.discovered_places where qid in ($1,$2) order by qid`, [WORLD.vivid.qid, WORLD.lyon.qid])
  assert.equal(kept.rows.length, 2, 'blocked rows are never pruned')
  app = fromServerRows(await read())
  assert.equal(app.verdicts.find(v => v.file === 'Vivid Sydney 2019.jpg')?.ok, false, 'still blocked')
  // Clearing the block: the photo's own last automatic verdict applies again while it is under 24 hours old.
  await db.exec(`update public.discovered_places set image_block=null where qid='${WORLD.vivid.qid}'`)
  assert.equal((await read()).find(r => r.qid === WORLD.vivid.qid).image_status, 'cleared', 'its own last verdict (under 24 h old) applies again')
  await db.close()
})

test('the function is deployed, scheduled (places every 6 hours, photos every 3), and finishes inside the request timeout', async () => {
  const text = async f => readFile(new URL('../' + f, import.meta.url), 'utf8')
  const deploy = await text('scripts/deploy-edge-functions.sh')
  assert.match(deploy.match(/^FUNCTIONS=\((.*)\)$/m)[1], /(^| )sync-global-places( |$)/)
  const cron = await text('release/launch/install-six-hour-sync.sql')
  const fn = await text('edge-functions/sync-global-places/index.ts')
  const migration = await text('supabase/migrations/20261013000000_discovered_places.sql')
  const jobOf = name => cron.match(new RegExp(`cron\\.schedule\\('${name}','([^']+)', \\$job\\$([\\s\\S]*?)\\$job\\$\\)`))
  const hoursOf = schedule => schedule.split(' ')[1].split(',').map(Number)
  const places = jobOf('aol-global-places-6h'), photos = jobOf('aol-global-places-images-3h')
  assert.ok(places, 'aol-global-places-6h is scheduled')
  assert.ok(photos, 'aol-global-places-images-3h is scheduled')
  assert.equal(places[1], '53 3,9,15,21 * * *', 'every 6 hours, after the other three jobs')
  assert.equal(photos[1], '23 1,4,7,10,13,16,19,22 * * *', 'every 3 hours, 30 minutes after each place run and 3 hours after that')
  for (const h of hoursOf(places[1])) assert.ok(hoursOf(photos[1]).includes((h + 1) % 24), 'a photo run 30 minutes after the place run at ' + h)
  for (const [job, phase] of [[places, 'places'], [photos, 'images']]) {
    assert.match(job[2], /\/functions\/v1\/sync-global-places'/)
    assert.match(job[2], /'x-aol-cron-secret'/)
    assert.equal(JSON.parse(job[2].match(/body := '([^']+)'::jsonb/)[1]).phase, phase)
    const budget = Number(job[2].match(/"budget_ms": (\d+)/)[1]), timeout = Number(job[2].match(/timeout_milliseconds := (\d+)/)[1])
    assert.ok(budget + 10000 <= timeout && timeout <= 150000, `budget ${budget} ms fits the ${timeout} ms request timeout and Supabase's 150 s limit`)
    assert.equal(Number(fn.match(/clamp\(body\.budget_ms, (\d+),/)[1]), budget, 'the default budget is the scheduled one')
  }
  // No request may outlive Supabase's 150 s gateway limit: the budget is capped, whatever the body asks for.
  assert.match(fn, /clamp\(body\.budget_ms, \d+, \d+, MAX_BUDGET_MS\)/)
  assert.ok(MAX_BUDGET_MS <= 130000)
  // Verdict lifetime: a photo is due 12 h after its check, photo runs are at most 3 h apart, and ALERT_STREAK deferred
  // runs in a row raise an alert before its verdict (24 h in the view) expires.
  const photoHours = hoursOf(photos[1]), gaps = photoHours.map((h, i) => ((photoHours[(i + 1) % photoHours.length] - h + 24) % 24) * H)
  assert.ok(RECHECK_AFTER_MS + ALERT_STREAK * Math.max(...gaps) <= VERDICT_TTL_MS, 'alert before the verdict expires')
  assert.equal(VERDICT_TTL_MS, 24 * H)
  assert.equal(migration.match(/media_checked_at>now\(\)-interval '(\d+) hours'/g).length, 3)
  assert.ok(migration.match(/media_checked_at>now\(\)-interval '(\d+) hours'/g).every(m => m.includes(`'${VERDICT_TTL_MS / H} hours'`)), 'the view uses the same lifetime')
  assert.match(fn, /authorizedSecret\(\[\[expected, supplied\], \[adminExpected, adminSupplied\]\]\)/)
  for (const name of ['apply_discovered_places', 'prune_discovered_places', 'discovered_branch_counts', 'discovered_images_due', 'set_discovered_media', 'claim_discovered_sync', 'release_discovered_sync']) {
    assert.match(fn, new RegExp(`rpc\\("${name}"`), name)
    assert.match(migration, new RegExp(`function public\\.${name}\\(`), name)
  }
})
