// Wikidata change detection for archive projects that carry a QID (docs/ARCHIVE_SPEC.md §2 "wikidata", §4
// archive_record_project_update). Deliberately small: one SPARQL query per 50 QIDs asks schema:dateModified and a
// few key statements (P571 inception, P17 country, P625 coordinates, P856 official website, P5817 state of use).
// An item modified after the rule's previous run is reported as a wikidata_changed update with the current values,
// for an editor to compare; nothing in the project is changed automatically. A first run (no previous run) only
// sets the baseline: every item would otherwise count as "changed".

import { fetchOk } from '../http.mjs'

export const WDQS_URL = 'https://query.wikidata.org/sparql'
export const WIKIDATA_BATCH = 50
const QID = /^Q[1-9]\d*$/
const PROPS = /** @type {const} */ ({ inception: 'P571', country: 'P17', coordinates: 'P625', official_website: 'P856', state_of_use: 'P5817' })

/** @param {string[]} qids */
export function changeQuery(qids) {
  const values = qids.filter((q) => QID.test(q)).map((q) => 'wd:' + q).join(' ')
  const optional = Object.entries(PROPS).map(([name, p]) => `  OPTIONAL { ?item wdt:${p} ?${name} . }`).join('\n')
  return `SELECT ?item ?modified ${Object.keys(PROPS).map((n) => '?' + n).join(' ')} WHERE {\n  VALUES ?item { ${values} }\n  ?item schema:dateModified ?modified .\n${optional}\n}`
}

/**
 * @param {any} json a SPARQL JSON result
 * @returns {Map<string, {modified: string|null, values: Record<string, string[]>}>}
 */
export function parseChanges(json) {
  const rows = json?.results?.bindings
  if (!Array.isArray(rows)) throw new Error('wikidata: unexpected SPARQL answer')
  /** @type {Map<string, {modified: string|null, values: Record<string, string[]>}>} */
  const out = new Map()
  for (const row of rows) {
    const qid = String(row?.item?.value || '').replace(/^.*\/entity\//, '')
    if (!QID.test(qid)) continue
    const entry = out.get(qid) || { modified: null, values: {} }
    if (row.modified?.value && (!entry.modified || row.modified.value > entry.modified)) entry.modified = row.modified.value
    for (const name of Object.keys(PROPS)) {
      let v = row[name]?.value
      if (!v) continue
      v = String(v).replace(/^http:\/\/www\.wikidata\.org\/entity\//, '')
      const list = entry.values[name] || (entry.values[name] = [])
      if (!list.includes(v) && list.length < 5) list.push(v)
    }
    out.set(qid, entry)
  }
  return out
}

/**
 * @param {{projects: {project_id: string, wikidata_qid: string|null}[], since: string|null, policy?: Parameters<typeof fetchOk>[1], batch?: number}} o
 * @returns {Promise<{checked: number, baseline: boolean, changes: {project_id: string, qid: string, date_modified: string, values: Record<string, string[]>}[], errors: {stage: string, message: string, url: string|null, http_status: number|null}[]}>}
 */
export async function detectWikidataChanges({ projects, since, policy = {}, batch = WIKIDATA_BATCH }) {
  /** @type {Map<string, string[]>} */
  const byQid = new Map()
  for (const p of projects || []) {
    if (!p || !QID.test(String(p.wikidata_qid || ''))) continue
    byQid.set(/** @type {string} */ (p.wikidata_qid), [...(byQid.get(/** @type {string} */ (p.wikidata_qid)) || []), p.project_id])
  }
  const qids = [...byQid.keys()].sort()
  const sinceMs = Date.parse(String(since || ''))
  const baseline = !Number.isFinite(sinceMs)
  const changes = []
  /** @type {{stage: string, message: string, url: string|null, http_status: number|null}[]} */
  const errors = []
  let checked = 0
  for (let i = 0; i < qids.length; i += batch) {
    const chunk = qids.slice(i, i + batch)
    const body = new URLSearchParams({ query: changeQuery(chunk) }).toString()
    try {
      const res = await fetchOk(WDQS_URL, { ...policy, method: 'POST', headers: { accept: 'application/sparql-results+json', 'content-type': 'application/x-www-form-urlencoded' }, body })
      const found = parseChanges(JSON.parse(res.text || '{}'))
      checked += chunk.length
      if (baseline) continue
      for (const qid of chunk) {
        const entry = found.get(qid)
        if (!entry?.modified || !(Date.parse(entry.modified) > sinceMs)) continue
        for (const project_id of byQid.get(qid) || []) changes.push({ project_id, qid, date_modified: entry.modified, values: entry.values })
      }
    } catch (e) {
      const err = /** @type {any} */ (e)
      errors.push({ stage: 'fetch', message: String(err?.message || e).slice(0, 1000), url: WDQS_URL, http_status: err?.status ?? null })
    }
  }
  return { checked, baseline, changes, errors }
}
