// Normalization of collected items (docs/ARCHIVE_SPEC.md §3 "Normalize"): canonical URL, clean title and excerpt,
// language, location from the gazetteer, the project name a title mentions, and known-project alias matching.
// Everything here is derived from the title and excerpt the source returned; nothing is looked up or invented.

import { stripHtml, truncate, collapse, scriptCounts, prepare, compilePattern, findPattern, fold, hasCjk } from './text.mjs'
import { COUNTRY_LIST, CITY_LIST, regionOf, REGION_BY_ISO } from './gazetteer.mjs'

export { regionOf, REGION_BY_ISO }
export const MAX_TITLE = 500
export const MAX_EXCERPT = 300
export const MAX_PUBLISHER = 200
export const MAX_URL = 2000

// ---- URL ----

/**
 * Canonical URL (§3): http(s) only, lower-case host without "www.", no utm_* / fbclid / gclid parameters, no
 * fragment, no default port. Path and the order of the other parameters are kept (they can be significant).
 * @param {unknown} input @returns {string|null}
 */
export function canonicalUrl(input) {
  let u
  try { u = new URL(String(input ?? '').trim()) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  u.hash = ''
  u.username = ''; u.password = ''
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
  for (const key of [...u.searchParams.keys()]) if (/^utm_/i.test(key) || /^(fbclid|gclid)$/i.test(key)) u.searchParams.delete(key)
  let out = u.href
  if (out.endsWith('?')) out = out.slice(0, -1)
  return out.length <= MAX_URL ? out : null
}

/** Host of a URL without "www." (null when it is not a URL). @param {unknown} url */
export function hostOf(url) {
  try { return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, '') } catch { return null }
}

// ---- title / excerpt ----

// Site names that publishers append to titles ("… | Dezeen", "… - 연합뉴스"). A trailing segment is also removed
// when it names the item's publisher or its domain.
const SITE_SUFFIXES = [
  'dezeen', 'designboom', 'designboom architecture design magazine', 'architecture design magazine', 'archdaily', 'archinect', 'creativeapplications net', 'can',
  'creative applications network', 'media architecture institute', 'the architect s newspaper', 'architizer', 'world architecture community',
  'dezeen jobs', 'archdaily korea', 'archdaily mexico', 'archdaily brasil', 'archdaily china',
  '연합뉴스', '뉴시스', '뉴스1', 'ytn', 'kbs', 'kbs 뉴스', 'mbc', 'mbc 뉴스', 'sbs', 'sbs 뉴스', 'jtbc', '조선일보', '중앙일보', '동아일보', '한겨레',
  '경향신문', '한국경제', '매일경제', '서울신문', '국민일보', '세계일보', '한국일보', '아시아경제', '헤럴드경제', '머니투데이', '이데일리', '파이낸셜뉴스',
  '전자신문', 'zdnet korea', '디지털타임스', '뉴스핌', '노컷뉴스', '오마이뉴스', '조선비즈', '네이버 블로그', 'naver blog', '브런치',
  'bbc', 'bbc news', 'cnn', 'reuters', 'ap news', 'the guardian', 'the new york times', 'nyt', 'bloomberg', 'forbes', 'wired', 'the verge',
  'yahoo', 'yahoo news', 'msn', 'nhk', 'nhk news', '朝日新聞', '毎日新聞', '日本経済新聞', '新华网', '人民网', 'scmp', 'south china morning post',
  'dw', 'der spiegel', 'spiegel', 'die zeit', 'faz', 'le monde', 'le figaro', 'el pais', 'el mundo', 'la repubblica', 'corriere della sera',
  'folha de s paulo', 'nos', 'gazeta wyborcza', 'рбк', 'тасс', 'риа новости', 'al jazeera', 'الجزيرة', 'hurriyet', 'anadolu ajansi',
].map((s) => fold(s))
const SEPARATORS = /\s+(?:\||-|–|—|::|·|•|ㅣ|│|｜)\s+/

/**
 * Plain title: HTML and entities removed, whitespace collapsed, and the site-name suffix stripped (known site names,
 * or the item's publisher/domain). Never strips the only segment. ≤ 500 characters.
 * @param {unknown} title @param {{publisher?: string|null, url?: string|null}} [o]
 */
export function cleanTitle(title, { publisher = null, url = null } = {}) {
  let text = stripHtml(title)
  const own = new Set(SITE_SUFFIXES)
  if (publisher) own.add(fold(publisher))
  const host = url ? hostOf(url) : null
  if (host) { own.add(fold(host)); own.add(fold(host.split('.')[0])) }
  for (let i = 0; i < 2; i++) {
    const parts = text.split(SEPARATORS)
    if (parts.length < 2) break
    const last = fold(parts[parts.length - 1])
    const known = own.has(last) || [...own].some((s) => s.length >= 4 && (last === s || last.startsWith(s + ' ') || last.endsWith(' ' + s)))
    if (!known) break
    const m = text.match(new RegExp(`^([\\s\\S]*)${SEPARATORS.source}[^]*$`))
    text = m ? m[1].trim() : text
  }
  // Bracketed site tags that Korean outlets put first ("[포토]", "[영상]") carry no title text.
  text = text.replace(/^\[(?:포토|사진|영상|동영상|단독|속보|종합|인터뷰|기획|카드뉴스)\]\s*/, '')
  return truncate(text, MAX_TITLE)
}

/** Excerpt from a feed or API snippet: plain text, at most 300 characters. @param {unknown} text */
export function cleanExcerpt(text) {
  const plain = stripHtml(text)
  return plain ? truncate(plain, MAX_EXCERPT) : null
}

/** @param {unknown} value @param {number} max */
export const clip = (value, max) => { const t = collapse(value); return t ? truncate(t, max) : null }

// ---- language ----

// GDELT reports languages by English name.
const LANGUAGE_NAMES = {
  english: 'en', korean: 'ko', japanese: 'ja', chinese: 'zh', german: 'de', french: 'fr', spanish: 'es', italian: 'it', portuguese: 'pt',
  dutch: 'nl', polish: 'pl', russian: 'ru', arabic: 'ar', turkish: 'tr', swedish: 'sv', norwegian: 'no', danish: 'da', finnish: 'fi',
  greek: 'el', czech: 'cs', hungarian: 'hu', romanian: 'ro', ukrainian: 'uk', hebrew: 'he', persian: 'fa', hindi: 'hi', thai: 'th',
  vietnamese: 'vi', indonesian: 'id', malay: 'ms', catalan: 'ca', croatian: 'hr', serbian: 'sr', bulgarian: 'bg', slovak: 'sk', slovenian: 'sl',
}

/** ISO 639-1 code from a BCP-47 tag ("en-GB") or a language name ("Korean"). @param {unknown} value @returns {string|null} */
export function languageCode(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return null
  if (Object.prototype.hasOwnProperty.call(LANGUAGE_NAMES, text)) return LANGUAGE_NAMES[/** @type {keyof typeof LANGUAGE_NAMES} */ (text)]
  const m = /^([a-z]{2})(?:[-_][a-z0-9]+)*$/.exec(text)
  return m ? m[1] : null
}

// Function words that are frequent in one Latin-script language and rare in the others.
const STOPWORDS = /** @type {Record<string, string[]>} */ ({
  en: ['the', 'and', 'of', 'with', 'for', 'is', 'on', 'new', 'at', 'from'],
  de: ['der', 'die', 'das', 'und', 'mit', 'von', 'im', 'ist', 'auf', 'fur', 'ein', 'eine', 'neue'],
  fr: ['le', 'la', 'les', 'des', 'et', 'du', 'une', 'pour', 'sur', 'au', 'est', 'nouvelle'],
  es: ['el', 'los', 'las', 'del', 'y', 'con', 'una', 'para', 'por', 'es', 'nueva', 'se'],
  it: ['il', 'gli', 'della', 'delle', 'di', 'che', 'con', 'una', 'per', 'nel', 'nuova', 'sulla'],
  pt: ['os', 'as', 'do', 'da', 'dos', 'das', 'em', 'uma', 'com', 'para', 'nova', 'nao', 'no', 'na'],
  nl: ['het', 'een', 'van', 'en', 'met', 'op', 'voor', 'nieuwe', 'is', 'bij', 'aan'],
  pl: ['i', 'w', 'na', 'z', 'sie', 'nie', 'jest', 'do', 'oraz', 'nowa', 'dla'],
  tr: ['ve', 'bir', 'ile', 'bu', 'icin', 'da', 'de', 'yeni', 'olarak'],
})
const LETTER_HINTS = /** @type {[RegExp, string][]} */ ([
  [/[ąćęłńśźż]/i, 'pl'], [/[ğış]|İ/, 'tr'], [/ß/, 'de'], [/[ãõ]/i, 'pt'], [/[ñ¿¡]/i, 'es'], [/ij\b/i, 'nl'],
])

/**
 * Language by script (Hangul → ko, kana → ja, Han only → zh, Arabic → ar, Cyrillic → ru); for Latin script a
 * stop-word vote with letter hints, null when the vote is not clear. Used only when the source gives no language.
 * @param {unknown} text @returns {string|null}
 */
export function detectLanguage(text) {
  const s = String(text ?? '')
  const c = scriptCounts(s)
  const total = c.hangul + c.kana + c.han + c.latin + c.cyrillic + c.arabic + c.other
  if (!total) return null
  if (c.hangul >= 2 && c.hangul >= total * 0.2) return 'ko'
  if (c.kana >= 2) return 'ja'
  if (c.han >= 2 && c.han >= total * 0.2) return 'zh'
  if (c.arabic >= total * 0.3) return 'ar'
  if (c.cyrillic >= total * 0.3) return 'ru'
  if (c.latin < total * 0.5) return null
  /** @type {Record<string, number>} */
  const votes = {}
  const words = fold(s).split(' ')
  for (const [lang, list] of Object.entries(STOPWORDS)) for (const w of words) if (list.includes(w)) votes[lang] = (votes[lang] || 0) + 1
  for (const [re, lang] of LETTER_HINTS) if (re.test(s)) votes[lang] = (votes[lang] || 0) + 2
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1])
  if (!ranked.length || ranked[0][1] < 2) return null
  if (ranked[1] && ranked[1][1] >= ranked[0][1]) return null
  return ranked[0][0]
}

// ---- location ----

/** @typedef {{iso2: string, city: string|null, pattern: import('./text.mjs').Pattern, name: string}} GazetteerEntry */
/** @param {{iso2: string, names: string[], city?: string}[]} list @param {boolean} cities @returns {GazetteerEntry[]} */
function compileGazetteer(list, cities) {
  /** @type {GazetteerEntry[]} */
  const out = []
  for (const place of list) for (const name of place.names) {
    const pattern = compilePattern(name)
    if (pattern) out.push({ iso2: place.iso2, city: cities ? place.city || null : null, pattern, name })
  }
  return out
}
const COUNTRY_INDEX = compileGazetteer(COUNTRY_LIST, false)
const CITY_INDEX = compileGazetteer(CITY_LIST, true)

/**
 * Hits of a gazetteer in one prepared text; of overlapping hits of the same kind the longer (then earlier) one stays,
 * so "North Korea" is not also "Korea" and 東京都 is Tokyo, not Kyoto.
 * @param {GazetteerEntry[]} index @param {import('./text.mjs').Prepared} p
 */
function gazetteerHits(index, p) {
  /** @type {{entry: GazetteerEntry, start: number, end: number}[]} */
  const hits = []
  for (const entry of index) {
    const at = findPattern(entry.pattern, p)
    if (at) hits.push({ entry, ...at })
  }
  hits.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)
  /** @type {typeof hits} */
  const kept = []
  for (const h of hits) {
    const clash = kept.some((k) => k.entry.pattern.mode === h.entry.pattern.mode && h.start < k.end && k.start < h.end)
    if (!clash) kept.push(h)
  }
  return kept.sort((a, b) => a.start - b.start)
}

/**
 * Country and city named in the title (first) or the excerpt: a city decides the country; otherwise the first
 * country named in the title, else in the excerpt. GDELT's sourcecountry (the publisher's country) is never used.
 * @param {unknown} title @param {unknown} [excerpt]
 * @returns {{country_iso2: string|null, city: string|null, region: string|null, matched: string[]}}
 */
export function detectLocation(title, excerpt = '') {
  for (const text of [title, excerpt]) {
    const p = prepare(text)
    const cities = gazetteerHits(CITY_INDEX, p)
    if (cities.length) {
      const c = cities[0].entry
      return { country_iso2: c.iso2, city: c.city, region: regionOf(c.iso2), matched: [c.name.replace(/\*$/, '')] }
    }
    const countries = gazetteerHits(COUNTRY_INDEX, p)
    if (countries.length) {
      const c = countries[0].entry
      return { country_iso2: c.iso2, city: null, region: regionOf(c.iso2), matched: [c.name.replace(/\*$/, '')] }
    }
  }
  return { country_iso2: null, city: null, region: null, matched: [] }
}

/** Whether a name is a gazetteer place name (aliases that are only a city or country name are not project aliases). @param {string} name */
function isPlaceName(name) {
  const key = fold(name)
  return [...COUNTRY_INDEX, ...CITY_INDEX].some((e) => fold(e.name.replace(/\*$/, '')) === key)
}

// ---- known projects ----

/**
 * @typedef {{project_id: string, alias: string, name: string, pattern: import('./text.mjs').Pattern, length: number, wikidata_qid: string|null}} AliasEntry
 * @typedef {{entries: AliasEntry[], projects: Map<string, {project_id: string, name: string, wikidata_qid: string|null}>}} AliasIndex
 */

/**
 * Alias index from archive_alias_index() rows. Accepted row shapes: {project_id|id, names: string[]} and/or the
 * name columns (name_original, name_en, name_ko, aliases[]), with an optional wikidata_qid. Aliases shorter than
 * three characters, and aliases that are only a place name, are left out: they would match unrelated titles.
 * @param {any[]} rows @returns {AliasIndex}
 */
export function buildAliasIndex(rows) {
  /** @type {AliasEntry[]} */
  const entries = []
  const projects = new Map()
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = String(row?.project_id ?? row?.id ?? '')
    if (!id) continue
    const names = [...(Array.isArray(row.names) ? row.names : []), row.name_original, row.name_en, row.name_ko, ...(Array.isArray(row.aliases) ? row.aliases : [])]
      .filter((n) => typeof n === 'string' && n.trim())
    if (!names.length) continue
    const qid = typeof row.wikidata_qid === 'string' && /^Q[1-9]\d*$/.test(row.wikidata_qid) ? row.wikidata_qid : null
    projects.set(id, { project_id: id, name: String(row.name_original || row.name_en || row.name_ko || names[0]).trim(), wikidata_qid: qid })
    const seen = new Set()
    for (const alias of names) {
      const folded = fold(alias)
      const length = [...folded.replace(/ /g, '')].length
      if (length < 3 || seen.has(folded) || isPlaceName(alias)) continue
      seen.add(folded)
      const pattern = compilePattern(alias.replace(/\*/g, ''))
      if (pattern) entries.push({ project_id: id, alias: alias.trim(), name: projects.get(id).name, pattern, length, wikidata_qid: qid })
    }
  }
  return { entries, projects }
}

/**
 * The known project whose alias occurs in the title (§3 dedupe rule 3): the longest matching alias wins; two
 * projects tied on the longest alias are ambiguous and give no match.
 * @param {unknown} title @param {AliasIndex|null|undefined} index
 * @returns {{project_id: string, alias: string, name: string, wikidata_qid: string|null}|null}
 */
export function matchAlias(title, index) {
  if (!index?.entries?.length) return null
  const p = prepare(title)
  /** @type {AliasEntry|null} */
  let best = null
  let tie = false
  for (const e of index.entries) {
    if (!findPattern(e.pattern, p)) continue
    if (!best || e.length > best.length) { best = e; tie = false }
    else if (e.length === best.length && e.project_id !== best.project_id) tie = true
  }
  if (!best || tie) return null
  return { project_id: best.project_id, alias: best.alias, name: best.name, wikidata_qid: best.wikidata_qid }
}

// ---- detected project name ----

// Words that name the media rather than the project; the name is what precedes (or follows "on/at") them.
const HEAD_WORDS = ['media facade', 'media façade', 'mediafacade', 'led facade', 'digital facade', 'facade', 'façade', 'projection mapping',
  'light show', 'media wall', 'medienfassade', 'fassade', 'fachada', 'facciata', 'gevel', 'mediagevel', 'fasada', 'cephe', 'медиафасад', 'фасад']
const CJK_HEADS = ['미디어파사드', '미디어 파사드', '미디어월', '프로젝션 매핑', '프로젝션매핑', '파사드', 'メディアファサード', 'プロジェクションマッピング',
  '媒体立面', '媒体幕墙', '灯光秀', '投影秀']
const KO_STOP = new Set(['새', '신규', '대형', '초대형', '첫', '국내', '세계', '최대', '최초', '거대', '야간', '새로운', '디지털', 'led', '전면', '외벽', '미디어', '건물', '빌딩', '공개', '설치'])
const CONNECTORS = new Set(['of', 'de', 'la', 'le', 'du', 'des', 'der', 'am', 'van', 'del', 'di', 'da', '&', 'and', 'the'])
const QUOTED = /[“"'‘「『《〈]([^“”"'‘’「」『』《》〈〉]{2,40})[”"'’」』》〉]/

/**
 * A project name the title states (a detection hint for editors, never published by itself): a quoted name;
 * the capitalised words before "media facade" (or after "on/at the"); the Korean word before 미디어파사드;
 * the Han/kana run before メディアファサード or 灯光秀. Null when the title states none.
 * @param {unknown} rawTitle @returns {string|null}
 */
export function extractName(rawTitle) {
  const title = collapse(rawTitle)
  if (!title) return null
  const quoted = QUOTED.exec(title)
  if (quoted && quoted[1].trim().length >= 2 && quoted[1].trim() !== title) return quoted[1].trim()
  if (hasCjk(title)) {
    for (const head of CJK_HEADS) {
      const at = title.indexOf(head)
      if (at <= 0) continue
      const before = title.slice(0, at).replace(/[\s,·:]+$/, '')
      if (/[\p{Script=Hangul}]$/u.test(before)) {
        // The nearest word before the head that is neither a generic modifier ("새", "대형") nor a place name.
        const words = before.split(/\s+/)
        while (words.length) {
          const last = (words.pop() || '').replace(/[,·:]+$/, '').replace(/(의|에|에서|에는|서)$/, '')
          if (last.length < 2 || KO_STOP.has(last.toLowerCase())) continue
          if (isPlaceName(last)) break
          return last
        }
        continue
      }
      const run = /([\p{Script=Han}\p{Script=Katakana}ー・]{2,16})[のの的]?$/u.exec(before.replace(/[のの的]$/, ''))
      if (run) return run[1]
    }
  }
  const words = title.split(/\s+/)
  const lower = words.map((w) => fold(w))
  const capital = (/** @type {string} */ w) => /^\p{Lu}/u.test(w) && !/^(New|A|An|The|Giant|Huge|First|How|Why|What|This|Watch|See)$/.test(w)
  for (const head of HEAD_WORDS) {
    const hw = fold(head).split(' ')
    for (let i = 0; i + hw.length <= lower.length; i++) {
      if (!hw.every((h, j) => lower[i + j] === h || (lower[i + j].startsWith(h) && j === hw.length - 1))) continue
      // Backwards over capitalised words (and connectors between them): "Lotte World Tower media facade".
      /** @type {string[]} */
      const name = []
      for (let k = i - 1; k >= 0 && name.length < 6; k--) {
        const w = words[k].replace(/[’']s$/, '').replace(/[,:;]$/, '')
        if (capital(w)) name.unshift(w)
        else if (name.length && CONNECTORS.has(w.toLowerCase())) name.unshift(w)
        else break
      }
      while (name.length && CONNECTORS.has(name[0].toLowerCase())) name.shift()
      if (name.length) return name.join(' ')
      // Forwards: "media facade on/at/for (the) Burj Khalifa".
      const after = words.slice(i + hw.length)
      if (after.length && /^(on|at|for|of|des|du|de|der|am|an|del|della|na|no)$/i.test(after[0])) {
        const rest = after.slice(1)
        if (rest[0] && /^(the|la|le|el|il|die|das|o|a)$/i.test(rest[0])) rest.shift()
        /** @type {string[]} */
        const fwd = []
        for (const w of rest) { if (/^\p{Lu}/u.test(w) && fwd.length < 6) fwd.push(w.replace(/[,:;.!?]$/, '')); else break }
        if (fwd.length) return fwd.join(' ')
      }
      // The subject at the start of a sentence-case title: "Lotte World Tower unveils new media facade".
      const caps = words.filter((w) => /^\p{Lu}/u.test(w)).length
      if (caps / words.length < 0.6) {
        /** @type {string[]} */
        const lead = []
        for (const w of words.slice(0, i)) {
          const clean = w.replace(/[,:;]$/, '')
          if (capital(clean) || (lead.length && CONNECTORS.has(clean.toLowerCase()))) lead.push(clean); else break
          if (/[,:;]$/.test(w)) break
        }
        // "Seoul's Lotte World Tower …": the possessive place is not part of the name.
        if (lead.length > 1 && /[’']s$/.test(lead[0])) lead.shift()
        while (lead.length && CONNECTORS.has(lead[lead.length - 1].toLowerCase())) lead.pop()
        const text = lead.join(' ').replace(/[’']s$/, '')
        if (lead.length && !(lead.length === 1 && isPlaceName(text))) return text
      }
      return null
    }
  }
  return null
}
