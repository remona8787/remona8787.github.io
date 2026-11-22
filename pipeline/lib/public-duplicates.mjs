// A new record whose Commons category already belongs to another public record is that record seen without the
// link that normally merges them (v0.26.7). On 2026-11-20 one run did not join Category:Origin (Vendel & De Wolf) to
// its Wikidata item Q136219703, and the category was published beside it as CAT-0MJOWPH for 18 hours, until three
// runs without it took it down. Such a record waits in the review queue instead (duplicate_of_public_record).

/**
 * @param {any[]} published eligible projects of this run
 * @param {Map<string, any>} previous the last public records by id
 * @param {Map<string, string>} aliases old id → new id (merges of this run)
 * @returns {{p: any, of: string}[]} the new projects to hold back, with the public record each one repeats
 */
export function duplicatesOfPublic(published, previous, aliases = new Map()) {
  const owner = new Map()
  for (const [id, r] of previous) if (r.commons_category && !owner.has(r.commons_category)) owner.set(r.commons_category, id)
  const wasPublic = new Set(previous.keys())
  for (const [from, to] of aliases) if (previous.has(from)) wasPublic.add(to)
  const out = []
  for (const p of published) {
    if (wasPublic.has(p.id) || !p.commons_category) continue
    const of = owner.get(p.commons_category)
    // The public record under its new id this run (a category record that gained its Wikidata item) is no duplicate.
    if (!of || of === p.id || aliases.get(of) === p.id) continue
    out.push({ p, of })
  }
  return out
}
