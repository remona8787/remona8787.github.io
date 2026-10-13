// Fakes and recorded shapes for the server-side place sync (edge-functions/_shared/global-places-server.mjs), used by
// tests/global-places-server.test.mjs, tests/deno/sync-global-places_test.ts and qa/global-places-server.spec.mjs.
import { BRANCHES, branchIdOf, parseBranch, mergeItems, checkImages } from '../../edge-functions/_shared/global-places.mjs'
import { DEFAULT_POLICY } from '../../edge-functions/_shared/live-media.mjs'
import { toServerRows, mediaUpdates } from '../../edge-functions/_shared/global-places-server.mjs'
import { wdqsBranch, commonsPage, commonsResponse, BRANCH_ROWS, FAILING, FILES } from './global-places-fixtures.mjs'

// WDQS: answers each POSTed branch query from rows; failing[id] is 'http500' (throws) or 'invalid' (not SPARQL JSON).
export function fakeWdqs({ rows = BRANCH_ROWS, failing = FAILING, calls = [] } = {}) {
  return async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
    const id = branchIdOf(new URLSearchParams(String(init.body || '')).get('query'))
    calls.push({ url, id, init })
    if (failing[id] === 'http500') throw Error('HTTP 500')
    if (failing[id] === 'invalid') return {}
    return wdqsBranch(rows[id] || [])
  }
}

// Commons API: answers from files (unknown titles are missing).
export function fakeCommons({ files = FILES, calls = [] } = {}) {
  return async (/** @type {string} */ url) => {
    calls.push(url)
    const titles = (new URL(url).searchParams.get('titles') || '').split('|').map(t => t.replace(/^File:/, ''))
    return commonsResponse(Object.fromEntries(titles.map(t => [t, files[t] ? commonsPage(files[t]) : { missing: true }])))
  }
}

// The places a server run over the fixtures upserts (branches merged in BRANCHES order; failing ones return nothing).
export function fixtureServerRows({ rows = BRANCH_ROWS, failing = FAILING } = {}) {
  return toServerRows(mergeItems(BRANCHES.filter(b => !failing[b.id]).map(b => parseBranch(wdqsBranch(rows[b.id] || []), b.id).items)))
}

// What public_discovered_places returns after such a run: every photo checked at checkedAt (Vivid Sydney cleared,
// Lyon blocked by NoFoP-France, Graz blocked as NC, Jinju cleared under the Korean FoP policy, Gwangan cleared as CC0).
/** @param {{seenAt: string, checkedAt?: string, policy?: {krFopDisplay: boolean, maxImagesPerPlace: number}}} o */
export async function serverViewRows({ seenAt, checkedAt = seenAt, policy = DEFAULT_POLICY }) {
  const rows = fixtureServerRows()
  const items = rows.filter(r => r.image_file).map(r => ({ qid: r.qid, image_file: /** @type {string} */ (r.image_file) }))
  const verdicts = await checkImages(items.map(i => ({ place_id: 'WD-' + i.qid, wikidata: i.qid, image: i.image_file })), { fetchJSON: fakeCommons(), now: checkedAt, policy })
  const updates = new Map(mediaUpdates(items, verdicts).map(u => [u.qid, u]))
  return rows.map(r => {
    const u = updates.get(r.qid)
    return {
      qid: r.qid, record: r.record, branches: r.branches, image_file: r.image_file,
      image_status: !r.image_file ? 'none' : u ? u.status : 'pending',
      image_reasons: u?.status === 'blocked' ? u.reasons : [],
      media: u?.status === 'cleared' ? u.media : [],
      media_checked_at: u ? checkedAt : null,
      last_seen_at: seenAt,
    }
  })
}
