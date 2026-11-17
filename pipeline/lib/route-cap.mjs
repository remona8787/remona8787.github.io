// Route diversity cap (v0.26, made stable in v0.26.5). Items found only through a material, genre or movement route
// (no light class, no other source) are limited per creator and place, so one artist's works in one collection do not
// fill the archive; the rest wait in the review queue (reason route_diversity_cap).
//
// The cap limits growth only. A record that is already public keeps its page: it is never capped, and while a run does
// not see it (a source failed, or it is waiting out "not seen in 3 runs") it still holds its slot. Before v0.26.5 the
// slots were counted over what one run happened to find, so a partial run with fewer group members let a newcomer in
// and the next complete run took it out again (SHA_RE, Q130070466, 11-15 and 11-17).

export const ROUTE_ORIGINS = new Set(['wikidata_class', 'evidence'])

/** The group a route-only item counts in: its first credited creator with a Wikidata id ('unknown' without), country, city. */
export function routeGroup(p) {
  const creator = (p.credits || []).find((c) => c.role !== 'operator' && c.wikidata_qid)?.wikidata_qid || 'unknown'
  return creator + '|' + (p.country_iso2 || '') + '|' + (p.city || '')
}

/** Found only through a route: no curated or editor-approved record, Wikidata classes only, and every class a route key. */
export function isRouteOnly(p) {
  return !p.curated_id && !p.editorial?.approved && (p.origins || []).length > 0 && p.origins.every((o) => ROUTE_ORIGINS.has(o)) &&
    (p.evidence || []).filter((e) => e.kind === 'wikidata_class').flatMap((e) => e.classes || []).every((k) => String(k).includes(':'))
}

/**
 * @param {any[]} published eligible projects of this run (route-only and others)
 * @param {{cap?: number, built?: Set<string>, previous?: Map<string, any>, tracker?: {projects?: Record<string, any>}, aliases?: Map<string, string>, compare?: (a: string, b: string) => number}} o
 *   built: ids of every project resolved this run, published or not; previous: the last public records by id;
 *   tracker: the previous run's tracker (route_group per published id since v0.26.5); aliases: old id → new id.
 * @returns {{capped: any[], groups: Map<string, string>, held: Map<string, number>}} capped: projects to move to the
 *   review queue; groups: id → group for every published route-only project (kept in the tracker); held: slots per group
 *   taken by public records this run did not see.
 */
export function routeCap(published, { cap = 6, built = new Set(), previous = new Map(), tracker = { projects: {} }, aliases = new Map(), compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0) } = {}) {
  const held = new Map()
  for (const [id, r] of previous) {
    if (built.has(id) || (aliases.has(id) && built.has(aliases.get(id)))) continue
    const t = tracker.projects?.[id]
    // The tracker says which group a public record holds; a record from before v0.26.5 counts when it came from
    // Wikidata classes only (it may be a light class, so a newcomer can wait one run longer than needed, never less).
    const key = t && 'route_group' in t ? t.route_group : (t?.origins?.length && t.origins.every((o) => ROUTE_ORIGINS.has(o)) ? routeGroup(r) : null)
    if (key) held.set(key, (held.get(key) || 0) + 1)
  }
  const groups = new Map(), members = new Map()
  for (const p of published) {
    if (!isRouteOnly(p)) continue
    const key = routeGroup(p)
    groups.set(p.id, key)
    members.set(key, [...(members.get(key) || []), p])
  }
  // Public before: under its own id, or under an id merged into it this run.
  const wasPublic = new Set(previous.keys())
  for (const [from, to] of aliases) if (previous.has(from)) wasPublic.add(to)
  const capped = []
  for (const [key, list] of members) {
    const incumbents = list.filter((p) => wasPublic.has(p.id)).length
    const newcomers = list.filter((p) => !wasPublic.has(p.id))
    const free = Math.max(0, cap - incumbents - (held.get(key) || 0))
    if (newcomers.length <= free) continue
    newcomers.sort((a, b) => (b.sitelink_count || 0) - (a.sitelink_count || 0) || (b.images?.length || 0) - (a.images?.length || 0) || compare(a.id, b.id))
    for (const p of newcomers.slice(free)) { capped.push(p); groups.delete(p.id) }
  }
  return { capped, groups, held }
}
