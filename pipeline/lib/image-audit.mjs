// Full-database image audit (fifth brief, P0-b): review/image-audit.json and a section of the step summary. Every
// number is counted from this run's records, the previous published dataset and this run's image decisions — nothing
// is estimated:
//  - totals: images in the published records (images[] plus the creators' portraits), by kind, role, provider, tier;
//  - verified: images whose relevance was assessed this run (scored) and images kept from the previous dataset after
//    the file-name recheck (kept);
//  - removed: images of the previous dataset that are not in this one, each with the reason this run gave
//    (person, mislinked, duplicate, low_res, rights, identity, not_selected, project_removed, not_rechecked);
//  - candidates rejected this run by reason group (person, mislinked, low_res, rights, identity, other);
//  - added: images in this dataset that were not in the previous one;
//  - cards: the share of projects with a valid card (a card, featured or hero image of a card kind), overall, Korean,
//    world and per Korean region, and per project.
import { upgradeImage } from './output.mjs'
import { compareStrings } from './util.mjs'

const CARD_KINDS = new Set(['project_media', 'project_installation', 'architecture_context'])
const CARD_ROLES = new Set(['card', 'featured', 'hero'])

/** The reason group of a candidate rejection or a removal. */
export function reasonGroup(reasons = []) {
  const r = reasons.join(' ')
  if (/subject:person|subject:people_or_event|name:map_plan_logo_diagram_portrait/.test(r) && /subject:person|subject:people_or_event|portrait/.test(r)) return 'person'
  if (/subject:object_or_animal|interior_unrelated_to_work|host_building_only|kept_dropped_irrelevant/.test(r)) return 'mislinked'
  if (/too_small|extreme_aspect/.test(r)) return 'low_res'
  if (/^rights:|\brights:/.test(r)) return 'rights'
  if (/identity_unproven|awaiting_review|unverified/.test(r)) return 'identity'
  if (/duplicate/.test(r)) return 'duplicate'
  return 'other'
}
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null)
const fileOfPage = (page) => { try { return String(page || '').includes('File:') ? decodeURIComponent(String(page).split('File:')[1]).replace(/_/g, ' ') : null } catch { return null } }

/** A valid card: the record's card (or featured, or hero) image, of a kind a card may show. */
export function validCard(r) {
  const img = (r.images || []).find((i) => i.role === 'card') || (r.images || []).find((i) => i.role === 'featured') || (r.images || []).find((i) => i.role === 'hero')
  return img && CARD_ROLES.has(img.role) && CARD_KINDS.has(img.kind) ? img : null
}

/**
 * @param {{records: any[], prevRecords: Map<string, any>, imageReview: any[], imageResults: Map<string, any>, keptDrops: any[], at: string, examples?: number}} o
 */
export function imageAudit({ records, prevRecords, imageReview, imageResults, keptDrops = [], at, examples = 40 }) {
  const count = (o, k, n = 1) => { o[k] = (o[k] || 0) + n }
  const totals = { images: 0, portraits: 0, by_kind: {}, by_role: {}, by_provider: {}, by_tier: {} }
  const verified = { scored: 0, kept: 0 }
  const now = new Map() // id → {project, title}
  for (const r of records) {
    const status = imageResults.get(r.id)?.status || 'carried_over'
    for (const i of r.images || []) {
      totals.images++
      count(totals.by_kind, i.kind || 'none'); count(totals.by_role, i.role); count(totals.by_provider, i.provider); count(totals.by_tier, String(i.tier))
      if (status === 'scored') verified.scored++; else verified.kept++
      now.set(r.id + '|' + i.id, { project: r.id, id: i.id, title: i.title })
    }
    for (const c of r.credits || []) if (c.portrait) totals.portraits++
  }
  // Decisions of this run: candidate reasons per project and image key (Commons file or provider id), duplicates.
  const decision = new Map(), rejected = {}, rejectedExamples = {}
  for (const p of imageReview) {
    for (const c of p.candidates || []) {
      decision.set(p.project + '|' + c.key, { ok: c.ok, reasons: c.reasons || [], kind: c.kind })
      if (!c.ok) { const g = reasonGroup(c.reasons); count(rejected, g); (rejectedExamples[g] ||= []).length < examples && rejectedExamples[g].push({ project: p.project, key: c.key, reasons: (c.reasons || []).slice(0, 3) }) }
    }
    for (const prov of p.providers || []) if (!prov.ok) {
      decision.set(p.project + '|' + prov.id, { ok: false, reasons: prov.reasons || [] })
      const g = reasonGroup(prov.reasons); count(rejected, g)
      ;(rejectedExamples[g] ||= []).length < examples && rejectedExamples[g].push({ project: p.project, key: prov.id, reasons: (prov.reasons || []).slice(0, 3) })
    }
    for (const d of p.duplicates || []) decision.set(p.project + '|' + d.key, { ok: true, reasons: ['duplicate_of:' + d.kept] })
  }
  const kept = new Map(keptDrops.map((d) => [d.project + '|' + d.id, d]))
  // Removed: previous images not in this dataset, with the reason of this run.
  const removed = {}, removedExamples = {}
  const publishedIds = new Set(records.map((r) => r.id))
  let previousImages = 0
  for (const [pid, old] of prevRecords) {
    for (const raw of old.images || []) {
      const i = upgradeImage(raw, pid)
      previousImages++
      if (now.has(pid + '|' + i.id)) continue
      const file = i.provider === 'commons' ? fileOfPage(i.page) : null
      let group
      if (!publishedIds.has(pid)) group = 'project_removed'
      else if (kept.has(pid + '|' + i.id)) group = kept.get(pid + '|' + i.id).reason
      else {
        const d = decision.get(pid + '|' + (file || i.id)) || decision.get(pid + '|' + i.id)
        group = !d ? (imageResults.get(pid)?.status === 'scored' ? 'not_a_candidate_this_run' : 'not_rechecked') : d.reasons.some((x) => x.startsWith('duplicate_of:')) ? 'duplicate' : d.ok ? 'not_selected' : reasonGroup(d.reasons)
      }
      count(removed, group)
      ;(removedExamples[group] ||= []).length < examples && removedExamples[group].push({ project: pid, id: i.id, title: i.title ?? file ?? null })
    }
  }
  const prevIds = new Set()
  for (const [pid, old] of prevRecords) for (const raw of old.images || []) prevIds.add(pid + '|' + upgradeImage(raw, pid).id)
  const added = [...now.keys()].filter((k) => !prevIds.has(k))
  // Cards.
  const isKr = (r) => r.country_iso2 === 'KR'
  const rate = (list) => ({ projects: list.length, with_valid_card: list.filter(validCard).length, rate_pct: pct(list.filter(validCard).length, list.length) })
  const byRegion = {}
  for (const r of records.filter(isKr)) (byRegion[r.kr_region || 'unknown'] ||= []).push(r)
  const perProject = records.map((r) => {
    const card = validCard(r)
    const prev = prevRecords.get(r.id)
    const prevN = (prev?.images || []).length
    return { id: r.id, name: r.name_ko || r.name_en || r.name_original, kr: isKr(r), kr_region: r.kr_region ?? null, images: (r.images || []).length, previous_images: prevN, valid_card: !!card, card_kind: card?.kind ?? null, card_tier: card?.tier ?? null, card_title: card?.title ?? null, status: imageResults.get(r.id)?.status || 'carried_over' }
  }).sort((a, b) => (b.kr ? 1 : 0) - (a.kr ? 1 : 0) || compareStrings(a.id, b.id))
  const removedTotal = Object.values(removed).reduce((s, v) => s + v, 0)
  const summary = {
    images: totals.images, portraits: totals.portraits, previous_images: previousImages,
    relevance_verified: verified.scored, rechecked_kept: verified.kept,
    person_removed: (removed.person || 0), person_rejected: (rejected.person || 0),
    mislinked_removed: (removed.mislinked || 0), mislinked_rejected: (rejected.mislinked || 0),
    duplicates_removed: (removed.duplicate || 0), duplicates_this_run: imageReview.reduce((s, p) => s + (p.duplicates || []).length, 0),
    low_res_rejected: (rejected.low_res || 0),
    removed_total: removedTotal, newly_added_valid: added.length,
    cards: { all: rate(records), korea: rate(records.filter(isKr)), world: rate(records.filter((r) => !isKr(r))) },
  }
  return {
    summary,
    file: {
      schema: 1, at,
      about: 'Image audit of the published dataset: counted from this run\'s records, the previous published dataset and this run\'s image decisions (review/images.json). removed: previous images that are not published any more, with this run\'s reason; rejected: this run\'s candidates by reason group; cards: the share of projects with a valid card (card, featured or hero of kind project_media, project_installation or architecture_context).',
      summary, totals, removed, removed_examples: removedExamples, rejected, rejected_examples: rejectedExamples,
      added: { count: added.length, examples: added.slice(0, examples).map((k) => now.get(k)) },
      cards: { ...summary.cards, by_kr_region: Object.fromEntries(Object.entries(byRegion).sort(([a], [b]) => compareStrings(a, b)).map(([k, v]) => [k, rate(v)])) },
      projects: perProject,
    },
  }
}

/** Markdown lines of the audit for the step summary. */
export function auditSummary(s) {
  if (!s) return []
  const c = (x) => `${x.with_valid_card}/${x.projects}${x.rate_pct === null ? '' : ` (${x.rate_pct} %)`}`
  return [
    '#### Image audit', '',
    `- images published: ${s.images} (+ ${s.portraits} creator portraits); previous dataset: ${s.previous_images}`,
    `- relevance verified this run: ${s.relevance_verified}; kept from the previous dataset after the file-name recheck: ${s.rechecked_kept}`,
    `- removed from the previous dataset: ${s.removed_total} — people ${s.person_removed}, mislinked ${s.mislinked_removed}, duplicates ${s.duplicates_removed}`,
    `- rejected candidates this run: people ${s.person_rejected}, mislinked ${s.mislinked_rejected}, low resolution ${s.low_res_rejected}; near-duplicates ${s.duplicates_this_run}`,
    `- newly added valid images: ${s.newly_added_valid}`,
    `- valid cards: all ${c(s.cards.all)}, Korea ${c(s.cards.korea)}, world ${c(s.cards.world)}`,
    '',
  ]
}
