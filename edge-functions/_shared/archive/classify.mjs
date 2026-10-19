// Deterministic, explainable relevance classifier of the archive collector (docs/ARCHIVE_SPEC.md §3 "Classify").
// No model, no network: weighted multilingual keywords (seed-rules.mjs, or the enabled rows of archive_keywords)
// in three polarities. The same title, excerpt and keyword set always give the same score, label and reasons, and
// the version string names the keyword set, so a stored candidate says exactly which rules judged it.
//
// Score (0..100) = positive terms (capped per category) + context terms (capped; almost nothing without a positive
// term) + a title bonus − negative terms. "projection mapping" and its translations score ONLY when an architectural
// context term (building, facade, tower, cathedral…) is present: a projection-mapped concert stage is not media
// architecture. The label says which kind of thing the text most likely is; the status thresholds (60 / 35) come
// from archive_settings and are applied by statusForScore and the SQL.
//
// Languages with seeded terms: ko, en, ja, zh, de, fr, es, it, pt, nl, pl, ru, ar, tr.

import { SEED_KEYWORDS } from './seed-rules.mjs'
import { compilePattern, findPattern, prepare, hash64 } from './text.mjs'

export { prepare }

export const CLASSIFIER_VERSION = 'aol-kw-2026.10.1'
export const LABELS = /** @type {const} */ (['facade_project', 'event_program', 'ad_screen', 'product_vendor', 'irrelevant', 'uncertain'])
export const REVIEW_THRESHOLD = 60
export const AUTO_IGNORE_BELOW = 35
// Per-category caps keep one repeated idea ("LED facade, media facade, digital facade") from saturating the score.
const CAPS = /** @type {Record<string, number>} */ ({ facade: 60, projection: 45, event: 45, screen: 35, art: 25, lighting: 25 })
const CONTEXT_CAP = 30
// Without any positive term, context words (tower, festival, unveiled) can never lift an item out of auto_ignored.
const CONTEXT_CAP_ALONE = 10
const TITLE_BONUS = 10
const MAX_REASONS = 20
const POSITIVE = new Set(['facade', 'projection', 'event', 'screen', 'art', 'lighting'])
const NEGATIVE = new Set(['ad', 'rental', 'vendor', 'real_estate', 'job'])

/**
 * @typedef {{term: string, language: string, polarity: 'positive'|'context'|'negative', weight: number, enabled?: boolean, category?: string}} Keyword
 * @typedef {{key: string, mode: 'sub'|'tokens', needle: string, words: {t: string, prefix: boolean}[], polarity: string,
 *   weight: number, category: string, term: string, languages: Set<string>, gated: boolean}} CompiledTerm
 * @typedef {{version: string, terms: CompiledTerm[]}} Compiled
 * @typedef {{score: number, label: typeof LABELS[number], reasons: string[], version: string}} Classification
 */

const seedCategory = new Map(SEED_KEYWORDS.map((k) => [k.term + '\u0000' + k.language, k.category]))
const defaultCategory = (/** @type {string} */ polarity) => polarity === 'positive' ? 'facade' : polarity === 'context' ? 'context' : 'other'

/** One keyword's compiled form (see compilePattern). @param {Keyword} kw @returns {CompiledTerm|null} */
function compileTerm(kw) {
  const term = String(kw.term || '').trim()
  const polarity = kw.polarity
  if (!term || (polarity !== 'positive' && polarity !== 'context' && polarity !== 'negative')) return null
  const weight = Math.max(0, Math.min(100, Math.round(Number(kw.weight) || 0)))
  const pattern = compilePattern(term)
  if (!weight || !pattern) return null
  const category = kw.category || seedCategory.get(term + '\u0000' + kw.language) || defaultCategory(polarity)
  const language = String(kw.language || '').toLowerCase()
  const latin = pattern.mode === 'tokens' && /^[a-z0-9 ]+$/.test(pattern.words.map((w) => w.t).join(' '))
  const key = (pattern.mode === 'sub' ? 'sub:' + pattern.needle : 'tok:' + pattern.words.map((w) => w.t + (w.prefix ? '*' : '')).join(' ')) + ':' + polarity
  // A Latin-script term of another language than English only counts for items in that language (or of unknown
  // language): "cena" is a price in Polish and a dinner in Spanish.
  return { ...pattern, key, polarity, weight, category, term, languages: new Set([language]), gated: latin && language !== 'en' }
}

/** @param {Keyword[]} list */
function keywordHash(list) {
  return hash64(list.filter((k) => k.enabled !== false).map((k) => [k.term, k.language, k.polarity, Math.round(Number(k.weight) || 0)].join('|')).sort().join('\n'))
}
const SEED_HASH = keywordHash(SEED_KEYWORDS)

/**
 * Compiles a keyword list (default: the seed). Terms that fold to the same pattern merge (highest weight, union of
 * languages, English making the term apply to every language). The version is CLASSIFIER_VERSION for the seed list,
 * else CLASSIFIER_VERSION+kw.<hash> of the enabled keywords.
 * @param {Keyword[]} [list] @returns {Compiled}
 */
export function compileKeywords(list = SEED_KEYWORDS) {
  /** @type {Map<string, CompiledTerm>} */
  const byKey = new Map()
  for (const kw of list) {
    if (!kw || kw.enabled === false) continue
    const c = compileTerm(kw)
    if (!c) continue
    const prev = byKey.get(c.key)
    if (!prev) { byKey.set(c.key, c); continue }
    for (const l of c.languages) prev.languages.add(l)
    prev.gated = prev.gated && c.gated
    if (c.weight > prev.weight) { prev.weight = c.weight; prev.category = c.category; prev.term = c.term }
  }
  const hash = keywordHash(list)
  return { version: hash === SEED_HASH ? CLASSIFIER_VERSION : `${CLASSIFIER_VERSION}+kw.${hash.slice(0, 8)}`, terms: [...byKey.values()] }
}

/** @type {Compiled|null} */
let seedCompiled = null
/** The seed keywords, compiled once. */
export const defaultKeywords = () => seedCompiled ??= compileKeywords(SEED_KEYWORDS)

/** @param {CompiledTerm} term @param {import('./text.mjs').Prepared} p */
const matches = (term, p) => findPattern(term, p) !== null

/** ISO 639-1 primary subtag of a language tag ("en-GB" → "en"). @param {unknown} lang */
const primary = (lang) => {
  const m = /^([a-z]{2,3})(?:[-_]|$)/i.exec(String(lang || '').trim())
  return m ? m[1].toLowerCase() : null
}

/** @param {CompiledTerm} term @param {string|null} lang */
const applies = (term, lang) => !term.gated || !lang || term.languages.has(lang)

/**
 * Whether any positive term occurs in the text (the RSS/WebSub prefilter: only matching feed items are kept).
 * @param {{title?: string|null, excerpt?: string|null, language?: string|null}} item @param {Compiled} [compiled]
 */
export function positiveMatch(item, compiled = defaultKeywords()) {
  const lang = primary(item.language)
  const p = prepare(`${item.title || ''} ${item.excerpt || ''}`)
  return compiled.terms.some((t) => t.polarity === 'positive' && applies(t, lang) && matches(t, p))
}

/**
 * @param {{title?: string|null, excerpt?: string|null, language?: string|null}} item
 * @param {Compiled} [compiled]
 * @returns {Classification}
 */
export function classify(item, compiled = defaultKeywords()) {
  const lang = primary(item.language)
  const title = prepare(item.title || ''), excerpt = prepare(item.excerpt || '')
  /** @type {{term: CompiledTerm, inTitle: boolean}[]} */
  const hits = []
  for (const term of compiled.terms) {
    if (!applies(term, lang)) continue
    const inTitle = matches(term, title)
    if (inTitle || matches(term, excerpt)) hits.push({ term, inTitle })
  }
  const archContext = hits.some((h) => h.term.polarity === 'context' && h.term.category === 'arch')
  /** @type {Record<string, number>} */
  const sum = {}
  /** @type {string[]} */
  const posReasons = [], negReasons = [], ctxReasons = [], notes = []
  let titleHit = false, ctx = 0
  const fmt = (/** @type {CompiledTerm} */ t, /** @type {boolean} */ inTitle) => `"${t.term}" (${[...t.languages].sort().join('/')}${inTitle ? ', title' : ''})`
  for (const { term, inTitle } of hits.sort((a, b) => b.term.weight - a.term.weight || a.term.key.localeCompare(b.term.key))) {
    const cat = term.category
    if (term.polarity === 'positive') {
      if (cat === 'projection' && !archContext) { notes.push(`0 projection ${fmt(term, inTitle)}: no building/facade context`); continue }
      const c = POSITIVE.has(cat) ? cat : 'facade'
      const before = sum[c] || 0
      const add = Math.max(0, Math.min(term.weight, (CAPS[c] ?? 60) - before))
      sum[c] = before + add
      if (inTitle) titleHit = true
      posReasons.push(`+${add} ${c} ${fmt(term, inTitle)}${add < term.weight ? ' (capped)' : ''}`)
    } else if (term.polarity === 'negative') {
      const c = NEGATIVE.has(cat) ? cat : 'other'
      sum['neg_' + c] = (sum['neg_' + c] || 0) + term.weight
      negReasons.push(`-${term.weight} ${c} ${fmt(term, inTitle)}`)
    } else {
      ctx += term.weight
      ctxReasons.push(`+${term.weight} ${cat === 'arch' ? 'context:arch' : 'context'} ${fmt(term, inTitle)}`)
    }
  }
  const facade = sum.facade || 0, projection = sum.projection || 0, event = sum.event || 0, screen = sum.screen || 0
  const pos = facade + projection + event + screen + (sum.art || 0) + (sum.lighting || 0)
  const negs = { vendor: (sum.neg_vendor || 0) + (sum.neg_rental || 0), ad: sum.neg_ad || 0, other: (sum.neg_real_estate || 0) + (sum.neg_job || 0) + (sum.neg_other || 0) }
  const neg = negs.vendor + negs.ad + negs.other
  const ctxScore = Math.min(ctx, pos > 0 ? CONTEXT_CAP : CONTEXT_CAP_ALONE)
  const bonus = titleHit ? TITLE_BONUS : 0
  const score = Math.max(0, Math.min(100, Math.round(pos + ctxScore + bonus - neg)))

  // The commercial label a dominant negative signal points to.
  const commercial = negs.vendor >= negs.ad && negs.vendor >= negs.other ? 'product_vendor' : negs.ad >= negs.other ? 'ad_screen' : 'irrelevant'
  /** @type {typeof LABELS[number]} */
  let label
  let why
  if (pos === 0) {
    label = neg > 0 ? commercial : 'irrelevant'
    why = neg > 0 ? `no positive term; strongest negative signal → ${label}` : 'no positive term'
  } else if (neg >= pos * 0.6) {
    label = commercial
    why = `negative ${neg} ≥ 60% of positive ${pos} → ${label}`
  } else {
    const built = facade + projection
    if (screen > built + event) { label = 'ad_screen'; why = `screen ${screen} > facade ${facade} + projection ${projection} + event ${event}` }
    // A light festival that projects onto buildings is the festival's programme, unless facade terms clearly dominate.
    else if (event > 0 && event >= facade * 0.75) { label = 'event_program'; why = `event ${event} ≥ 75% of facade ${facade}` }
    else if (built > 0) { label = 'facade_project'; why = `facade ${facade} + projection ${projection}` }
    else { label = 'uncertain'; why = 'only light-art or lighting terms' }
    if (neg >= pos * 0.3 && label !== 'uncertain') { why += `; but negative ${neg} ≥ 30% of positive ${pos} → uncertain`; label = 'uncertain' }
  }
  const head = `score ${score} = positive ${pos} + context ${ctxScore}${ctx > ctxScore ? ` (of ${ctx}, capped)` : ''} + title ${bonus} − negative ${neg}`
  const reasons = [head, `label ${label}: ${why}`, ...posReasons, ...negReasons, ...notes, ...ctxReasons].slice(0, MAX_REASONS).map((r) => r.slice(0, 200))
  return { score, label, reasons, version: compiled.version }
}

/**
 * Candidate status for a score (the SQL applies the same thresholds from archive_settings).
 * @param {number} score @param {{review_threshold?: number, auto_ignore_below?: number}} [settings]
 * @returns {'needs_review'|'uncertain'|'auto_ignored'}
 */
export function statusForScore(score, settings = {}) {
  const review = settings.review_threshold ?? REVIEW_THRESHOLD
  const ignore = settings.auto_ignore_below ?? AUTO_IGNORE_BELOW
  return score >= review ? 'needs_review' : score >= ignore ? 'uncertain' : 'auto_ignored'
}
