// Keys the database's dedupe rules use (docs/ARCHIVE_SPEC.md §3 "Dedupe and match", §8 item.keys), and the
// in-batch news-story clustering of rule 6: titles whose token sets have Jaccard similarity ≥ 0.6 and that were
// published within 14 days of each other are one story (syndicated or duplicate articles). Every member of a
// cluster carries the story_key of its earliest item, so archive_ingest attaches them to one candidate.

import { fold, hash64 } from './text.mjs'

export const JACCARD_THRESHOLD = 0.6
export const STORY_WINDOW_MS = 14 * 24 * 3600 * 1000
// Pairwise comparison is O(n²); a batch is at most a few hundred items (GDELT: 250 per request).
export const MAX_CLUSTER_ITEMS = 2000

const STOP = new Set([
  'the', 'a', 'an', 'of', 'and', 'in', 'on', 'for', 'to', 'with', 'at', 'by', 'from', 'is', 'are', 'its', 'new', 'how', 'as',
  'der', 'die', 'das', 'und', 'mit', 'von', 'im', 'ein', 'eine', 'le', 'la', 'les', 'des', 'du', 'de', 'et', 'en', 'un', 'une',
  'el', 'los', 'las', 'del', 'y', 'con', 'il', 'lo', 'gli', 'della', 'di', 'e', 'o', 'os', 'as', 'do', 'da', 'em', 'het', 'een', 'van',
  'w', 'z', 'i', 've', 'bir', 'ile', 'и', 'в', 'на', 'с',
])
// Korean particles glued to the end of a word ("미디어파사드를" and "미디어파사드가" are the same word).
const KO_PARTICLE = /(으로|에서|에게|까지|부터|이다|이며|하고|와|과|을|를|이|가|은|는|의|에|로|도|만)$/
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{2,}/u

/**
 * Title tokens for story comparison: folded words without stop words and one-letter Latin tokens, Korean words
 * without particles, and character bigrams for Han/kana runs (Chinese and Japanese titles have no spaces).
 * @param {unknown} title @returns {Set<string>}
 */
export function titleTokens(title) {
  const out = new Set()
  for (const word of fold(title).split(' ')) {
    if (!word || STOP.has(word)) continue
    if (CJK_RUN.test(word)) {
      const chars = [...word]
      for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1])
      continue
    }
    if (/^\p{Script=Hangul}+$/u.test(word)) {
      const base = word.length > 2 ? word.replace(KO_PARTICLE, '') : word
      if (base) out.add(base)
      continue
    }
    if (/^[a-z]$/.test(word)) continue
    out.add(word)
  }
  return out
}

/** @param {Set<string>} a @param {Set<string>} b */
export function jaccard(a, b) {
  if (!a.size && !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

/**
 * A stable key of a title's token set (same tokens → same key, in every run and runtime). It carries no date: the
 * 14-day window is applied by clusterStories here and by the SQL, which knows when each story was seen.
 * @param {unknown} title
 */
export function storyKey(title) {
  return 'st:' + hash64([...titleTokens(title)].sort().join(' '))
}

// Generic words that name the medium, not the project: "롯데월드타워 미디어파사드" and "롯데월드타워" are one name.
const GENERIC_TAIL = /\s*(media\s?fa[cç]ade|led\s?fa[cç]ade|projection\s?mapping|medienfassade|fa[cç]ade\s?m[eé]dia\w*|미디어\s?파사드|미디어\s?월|프로젝션\s?매핑|メディアファサード|プロジェクションマッピング|媒体立面|媒体幕墙|灯光秀)$/i

/**
 * Normalized project name for dedupe rule 4 (same normalized name, country and city): folded, generic medium words
 * at the end removed, spaces removed. Null when nothing is left.
 * @param {unknown} name @returns {string|null}
 */
export function normalizedName(name) {
  if (name == null) return null
  const base = String(name).normalize('NFKC').trim().replace(GENERIC_TAIL, '')
  const key = fold(base).replace(/ /g, '')
  return key ? key.slice(0, 200) : null
}

/**
 * @template {{title: string, published_at?: string|null, fetched_at?: string|null}} T
 * @param {T[]} items
 * @param {{threshold?: number, windowMs?: number, now?: number}} [o]
 * @returns {{story_keys: string[], clusters: {story_key: string, members: number[]}[]}}
 *   story_keys[i] is item i's key; clusters lists the member indexes of every cluster with more than one item.
 */
export function clusterStories(items, { threshold = JACCARD_THRESHOLD, windowMs = STORY_WINDOW_MS, now = Date.now() } = {}) {
  const n = Math.min(items.length, MAX_CLUSTER_ITEMS)
  const toks = items.map((it) => titleTokens(it.title))
  const times = items.map((it) => {
    const t = Date.parse(it.published_at || it.fetched_at || '')
    return Number.isFinite(t) ? t : now
  })
  const parent = items.map((_, i) => i)
  const find = (/** @type {number} */ i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] } return i }
  for (let i = 0; i < n; i++) {
    if (!toks[i].size) continue
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(times[i] - times[j]) > windowMs) continue
      if (jaccard(toks[i], toks[j]) >= threshold) {
        const a = find(i), b = find(j)
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b)
      }
    }
  }
  /** @type {Map<number, number[]>} */
  const groups = new Map()
  items.forEach((_, i) => { const r = find(i); groups.set(r, [...(groups.get(r) || []), i]) })
  const story_keys = new Array(items.length)
  const clusters = []
  for (const members of groups.values()) {
    // The earliest item names the story (ties: the first in the batch).
    const rep = members.reduce((best, i) => times[i] < times[best] ? i : best, members[0])
    const key = storyKey(items[rep].title)
    for (const i of members) story_keys[i] = key
    if (members.length > 1) clusters.push({ story_key: key, members })
  }
  return { story_keys, clusters }
}
