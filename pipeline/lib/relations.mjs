// Relations between records (docs/PIPELINE.md "Relations"; P1-b minimal entity model, no new record types yet).
// A record's relations[]: {type, target, source, subject?}. type is event_at | exhibition_at | part_of | edition_of;
// target is a published project id. Without subject the record itself is related to target (Wikidata P361 part of,
// P179 part of the series, P276 location of an event). With subject it describes a thing kept inside this record (an
// event of its events[], an edition or a part merged into it) and target is this record: the relation the thing will
// keep when it becomes a record of its own.
import { compareStrings, stableStringify } from './util.mjs'
import { partOf } from './places.mjs'
import { RELATION_TYPES } from './output.mjs'

export { RELATION_TYPES }
const EDITION_NAME = /\b(1[89]\d\d|20\d\d)\b|\bedition\b|\b(édition|ausgabe|edición)\b|\d{4}년|제\s*\d+\s*회/iu
const catName = (t) => String(t || '').replace(/^Category:/, '')

/**
 * Relations of the published projects. Map(id → relations[]) (only ids that have some).
 * @param {{published: any[], facts: Map, categories?: Map|null, placeDecisions?: any[], aliases?: Map}} o
 */
export function relationsOf({ published, facts, categories = null, placeDecisions = [], aliases = new Map() }) {
  const byId = new Map(published.map((p) => [p.id, p]))
  const resolve = (id) => (byId.has(id) ? id : byId.has(aliases.get(id)) ? aliases.get(id) : null)
  const byQid = new Map(), byCat = new Map()
  for (const p of published) {
    for (const q of [p.qid, ...(p.all_qids || [])].filter(Boolean)) if (!byQid.has(q)) byQid.set(q, p.id)
    if (p.commons_category && !byCat.has(p.commons_category)) byCat.set(p.commons_category, p.id)
  }
  const out = new Map()
  const add = (id, rel) => { if (!byId.has(id) || !rel.target) return; const list = out.get(id) || []; if (!list.some((r) => stableStringify(r) === stableStringify(rel))) list.push(rel); out.set(id, list) }

  for (const p of published) {
    // The record itself (its item's statements; never a host building's).
    const f = p.qid && p.qid_match !== 'host' ? facts.get(p.qid) : null
    if (f) {
      for (const q of f.part_of || []) { const t = byQid.get(q); if (t && t !== p.id) add(p.id, { type: 'part_of', target: t, source: 'wikidata:P361' }) }
      for (const q of f.series || []) { const t = byQid.get(q); if (t && t !== p.id) add(p.id, { type: 'edition_of', target: t, source: 'wikidata:P179' }) }
      if (['festival', 'program', 'exhibition'].includes(p.kind)) for (const q of f.locations || []) { const t = byQid.get(q); if (t && t !== p.id) add(p.id, { type: p.kind === 'exhibition' ? 'exhibition_at' : 'event_at', target: t, source: 'wikidata:P276' }) }
    }
    // Events of its events[] (Seoul cultural events linked to this place).
    for (const e of p.events || []) add(p.id, { type: e.kind === 'exhibition' ? 'exhibition_at' : 'event_at', target: p.id, source: 'seoul_events', subject: { event: e.id, title: e.title ?? null } })
  }

  // Editions merged into a festival: Commons edition categories (under the festival's category, or named after it),
  // and the dated subcategories of a project's own category ("Nobel Week Lights 2020"); other subcategories are views.
  for (const c of categories?.values() || []) {
    const name = catName(c.title)
    let t = null
    if (c.decision === 'edition') t = (c.parent && byCat.get(c.parent)) || partOf({ id: 'edition:' + c.title, name_en: name }, published)
    else if (c.decision === 'part' && EDITION_NAME.test(name)) t = c.parent ? byCat.get(c.parent) || null : null
    if (t) add(t, { type: 'edition_of', target: t, source: 'commons:' + (c.decision === 'edition' ? 'edition_category' : 'dated_subcategory'), subject: { name, commons_category: c.title } })
  }
  // Editions and parts of a known project that the country recovery kept out (lib/places.mjs part_of_project).
  for (const d of placeDecisions) {
    if (d.outcome !== 'part_of_project' || !d.part_of) continue
    const t = resolve(d.part_of)
    if (!t) continue
    const edition = EDITION_NAME.test(String(d.name || '')) || EDITION_NAME.test(catName(d.category))
    add(t, { type: edition ? 'edition_of' : 'part_of', target: t, source: 'commons:name_contains_project', subject: { name: d.name ?? null, ...(d.category ? { commons_category: d.category } : {}), ...(d.qid ? { wikidata: d.qid } : {}) } })
  }
  for (const [id, list] of out) out.set(id, sortRelations(list))
  return out
}

/** Fixed order: the record's own relations first, then by type, target and subject. */
export function sortRelations(list) {
  const key = (r) => [r.subject ? 1 : 0, RELATION_TYPES.indexOf(r.type), r.target, r.subject?.event || r.subject?.commons_category || r.subject?.name || '', r.source].join('\u0000')
  const seen = new Set(), res = []
  for (const r of list) { const k = stableStringify(r); if (!seen.has(k)) { seen.add(k); res.push(r) } }
  return res.sort((a, b) => compareStrings(key(a), key(b)))
}
