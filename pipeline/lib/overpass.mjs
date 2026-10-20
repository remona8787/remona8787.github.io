// Optional coordinate confirmation with OpenStreetMap (Overpass API): OSM objects tagged wikidata=<QID> are compared
// with the Wikidata coordinates, and a distance over 1 km is listed in quality.json for an editor. OSM data is
// never copied into the public dataset (it would bring ODbL obligations); it only confirms. One request per run for
// at most `max` items (oldest checks first, results cached 30 days), and skipped when Overpass is unreachable,
// per the Overpass usage policy (https://dev.overpass-api.de/overpass-doc/en/preface/commons.html).
import { haversine, isQid } from './util.mjs'
import { HOUR } from './cache.mjs'

export const OVERPASS = 'https://overpass-api.de/api/interpreter'

export const overpassQuery = (qids) => `[out:json][timeout:60];
nwr["wikidata"~"^(${qids.join('|')})$"];
out center tags 200;`

export function parseOverpass(json) {
  const out = new Map()
  for (const el of json?.elements || []) {
    const q = el?.tags?.wikidata
    if (!isQid(q)) continue
    const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon
    if (typeof lat !== 'number' || typeof lng !== 'number') continue
    if (!out.has(q)) out.set(q, [])
    out.get(q).push({ type: el.type, id: el.id, lat, lng })
  }
  return out
}

/** @param {{id: string, qid: string, lat: number, lng: number}[]} items */
export async function checkCoordinates(client, items, { cache, max = 50, ttlHours = 720 }) {
  const due = items.filter((i) => isQid(i.qid) && typeof i.lat === 'number')
    .sort((a, b) => (cache.entry('overpass', a.qid)?.at ?? 0) - (cache.entry('overpass', b.qid)?.at ?? 0) || (a.qid < b.qid ? -1 : 1))
  const fresh = [], ask = []
  for (const i of due) { const hit = cache.fresh('overpass', i.qid); if (hit !== undefined) fresh.push([i, hit]); else if (ask.length < max) ask.push(i) }
  let error = null
  if (ask.length) {
    try {
      const json = await client.json(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: overpassQuery(ask.map((i) => i.qid)) }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' }, retries: 1, timeoutMs: 90000, stage: 'overpass' })
      const found = parseOverpass(json)
      for (const i of ask) { const v = found.get(i.qid) || []; cache.set('overpass', i.qid, v, { ttlMs: ttlHours * HOUR }); fresh.push([i, v]) }
    } catch (e) {
      if (e?.code === 'budget') throw e
      error = String(e?.message || e).slice(0, 300)
    }
  }
  const rows = fresh.map(([i, osm]) => {
    if (!osm.length) return { id: i.id, qid: i.qid, osm: null, distance_m: null, status: 'not_in_osm' }
    const best = osm.map((o) => ({ ...o, d: haversine({ lat: i.lat, lng: i.lng }, o) })).sort((a, b) => a.d - b.d)[0]
    return { id: i.id, qid: i.qid, osm: `${best.type}/${best.id}`, distance_m: Math.round(best.d), status: best.d > 1000 ? 'mismatch' : 'confirmed' }
  }).sort((a, b) => (a.id < b.id ? -1 : 1))
  return { rows, asked: ask.length, error }
}
