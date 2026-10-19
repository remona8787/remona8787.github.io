// Text helpers shared by the archive collector (feeds, API answers, classifier, normalizer, dedupe).
// Pure ESM without dependencies: runs unchanged in Deno (Edge Functions) and Node (tests, probe).

// The named entities that actually occur in feed titles and API snippets (XML predefines only five; HTML-escaped
// descriptions and NAVER's answers use the rest). Unknown names are kept as written rather than guessed.
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009',
  hellip: '…', mdash: '—', ndash: '–', minus: '−', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  laquo: '«', raquo: '»', lsaquo: '‹', rsaquo: '›', middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', deg: '°',
  times: '×', divide: '÷', euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶', shy: '\u00ad', zwj: '\u200d', zwnj: '\u200c',
  aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç',
  eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï',
  ntilde: 'ñ', oacute: 'ó', ograve: 'ò', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', szlig: 'ß',
  uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü', yacute: 'ý', yuml: 'ÿ', oelig: 'œ',
  Aacute: 'Á', Agrave: 'À', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç',
  Eacute: 'É', Egrave: 'È', Ecirc: 'Ê', Euml: 'Ë', Iacute: 'Í', Igrave: 'Ì', Icirc: 'Î', Iuml: 'Ï',
  Ntilde: 'Ñ', Oacute: 'Ó', Ograve: 'Ò', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø',
  Uacute: 'Ú', Ugrave: 'Ù', Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý', OElig: 'Œ',
}

/** @param {number} cp */
const fromCodePoint = (cp) => (Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) ? String.fromCodePoint(cp) : '�'

/** Decodes numeric (&#38; &#x26;) and the named entities above; anything else stays as written. @param {unknown} value */
export function decodeEntities(value) {
  return String(value ?? '').replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,31});/gi, (m, body) => {
    if (body[0] === '#') return fromCodePoint(body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10))
    return Object.prototype.hasOwnProperty.call(NAMED, body) ? NAMED[/** @type {keyof typeof NAMED} */ (body)] : m
  })
}

/** Collapses every run of whitespace (also no-break and zero-width spaces) to one space. @param {unknown} value */
export function collapse(value) {
  return String(value ?? '').replace(/[\s\u00a0\u2000-\u200b\u2028\u2029\u202f\u205f\u3000\ufeff\u00ad]+/g, ' ').trim()
}

/**
 * Plain text from an HTML or tag-marked string (feed descriptions, NAVER's <b> highlights, Brave's <strong>).
 * Tags are removed before AND after decoding entities, so a double-escaped "&lt;b&gt;" disappears too; script and
 * style contents are dropped (they are never text a reader saw).
 * @param {unknown} value
 */
export function stripHtml(value) {
  const once = (/** @type {string} */ s) => s
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    // Inline marks (NAVER's <b>, Brave's <strong>) vanish without a space: "<b>미디어파사드</b>에서" is one word.
    .replace(/<\/?(?:a|abbr|b|bdi|bdo|cite|code|em|font|i|kbd|mark|q|s|small|span|strong|sub|sup|u|time)\b[^>]*>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, ' ')
  return collapse(once(decodeEntities(once(String(value ?? '')))))
}

/**
 * Cuts text to at most max characters (code points), at a word boundary when one is close, with an ellipsis
 * that is counted in the limit (the database checks the length).
 * @param {unknown} value @param {number} max
 */
export function truncate(value, max) {
  const text = collapse(value)
  const chars = [...text]
  if (chars.length <= max) return text
  let cut = chars.slice(0, max - 1).join('')
  const space = cut.lastIndexOf(' ')
  if (space > cut.length * 0.8) cut = cut.slice(0, space)
  return cut.replace(/[\s,.;:–—-]+$/, '') + '…'
}

// Letters that Unicode does not decompose into base + mark, mapped so that "Światła", "ışık" and "Straße" fold
// to the same keys as their ASCII spellings.
const SPECIAL = { 'ı': 'i', 'ł': 'l', 'ø': 'o', 'đ': 'd', 'ð': 'd', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'þ': 'th', 'ħ': 'h' }
const SPECIAL_RE = /[ıłøđðßæœþħ]/g

/**
 * Matching form of a text: NFKC, lower case, diacritics removed from Latin, Greek and Cyrillic letters (never from
 * kana: the voiced marks are part of the word), Arabic short vowels and letter variants unified, every run of
 * punctuation turned into one space. Hangul stays composed.
 * @param {unknown} value
 */
export function fold(value) {
  let s = String(value ?? '').normalize('NFKC').toLowerCase()
  s = s.normalize('NFD').replace(/([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])\p{M}+/gu, '$1').normalize('NFC')
  s = s.replace(SPECIAL_RE, (c) => SPECIAL[/** @type {keyof typeof SPECIAL} */ (c)])
  // Arabic: tashkeel and tatweel go, alef/hamza forms become bare alef, taa marbuta → haa, alef maqsura → yaa.
  s = s.replace(/[\u064b-\u065f\u0670ـ]/g, '').replace(/[آأإٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
  return s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

// Arabic writes the article and some prepositions as prefixes of the word ("الواجهة", "والواجهة"); matching
// strips them so a term written without the article matches the definite form.
const AR_PREFIX = /^(?:وال|بال|فال|كال|لل|ال)(?=[ء-ي]{3,})/

/** Tokens of an already folded text, with Arabic clitic prefixes removed. @param {string} folded @returns {string[]} */
export function tokens(folded) {
  if (!folded) return []
  return folded.split(' ').filter(Boolean).map((t) => AR_PREFIX.test(t) ? t.replace(AR_PREFIX, '') : t)
}

/** @param {string} s */
export const hasCjk = (s) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(s)

/**
 * Character counts per script, for language detection and term matching.
 * @param {unknown} value
 * @returns {{hangul: number, kana: number, han: number, latin: number, cyrillic: number, arabic: number, other: number}}
 */
export function scriptCounts(value) {
  const out = { hangul: 0, kana: 0, han: 0, latin: 0, cyrillic: 0, arabic: 0, other: 0 }
  for (const ch of String(value ?? '')) {
    if (/\p{Script=Hangul}/u.test(ch)) out.hangul++
    else if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) out.kana++
    else if (/\p{Script=Han}/u.test(ch)) out.han++
    else if (/\p{Script=Latin}/u.test(ch)) out.latin++
    else if (/\p{Script=Cyrillic}/u.test(ch)) out.cyrillic++
    else if (/\p{Script=Arabic}/u.test(ch)) out.arabic++
    else if (/\p{L}/u.test(ch)) out.other++
  }
  return out
}

/**
 * Deterministic 64-bit FNV-1a hash as 16 hex characters (two 32-bit halves; no BigInt, no crypto: keys must be the
 * same in Deno, Node and every run).
 * @param {string} text
 */
export function hash64(text) {
  let h1 = 0x811c9dc5, h2 = 0x050c5d1f
  for (const ch of String(text)) {
    const c = /** @type {number} */ (ch.codePointAt(0))
    h1 ^= c & 0xffff; h1 = Math.imul(h1, 0x01000193) >>> 0
    h2 ^= (c >>> 8) ^ (c & 0xff); h2 = Math.imul(h2, 0x01000193) >>> 0
    h1 = (h1 ^ (h2 >>> 7)) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

// ---- word/substring patterns (classifier keywords, gazetteer names, project aliases) ----

/**
 * @typedef {{mode: 'sub'|'tokens', needle: string, words: {t: string, prefix: boolean}[]}} Pattern
 * @typedef {{toks: string[], nospace: string}} Prepared
 */

const CJK_CLASS = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}'
// Latin letters or digits glued to CJK text ("LED파사드를", "LEDファサード") are split so word patterns still see them.
const SCRIPT_EDGE = new RegExp(`([\\p{Script=Latin}\\p{N}])(?=[${CJK_CLASS}])|([${CJK_CLASS}])(?=[\\p{Script=Latin}\\p{N}])`, 'gu')

/** A text in matching form: its folded tokens and the folded text without spaces. @param {unknown} text @returns {Prepared} */
export function prepare(text) {
  const folded = fold(text).replace(SCRIPT_EDGE, '$1$2 ')
  return { toks: tokens(folded), nospace: folded.replace(/ /g, '') }
}

/**
 * Matching form of a term: patterns with Hangul, kana or Han match inside words (Korean particles and Japanese or
 * Chinese text without spaces), others match whole folded words; a word ending in `*` matches as a prefix.
 * @param {string} term @returns {Pattern|null}
 */
export function compilePattern(term) {
  const text = String(term || '').trim()
  if (!text) return null
  if (hasCjk(text)) {
    const needle = fold(text.replace(/\*/g, '')).replace(/ /g, '')
    return needle ? { mode: 'sub', needle, words: [] } : null
  }
  /** @type {{t: string, prefix: boolean}[]} */
  const words = []
  for (const raw of text.split(/\s+/)) {
    const prefix = raw.endsWith('*')
    const parts = tokens(fold(raw.replace(/\*+$/, '')))
    parts.forEach((t, i) => words.push({ t, prefix: prefix && i === parts.length - 1 }))
  }
  return words.length ? { mode: 'tokens', needle: '', words } : null
}

/**
 * The first occurrence of a pattern: token positions for word patterns, character offsets in the space-less text
 * for substring patterns (so overlapping hits of the same kind can be compared).
 * @param {Pattern} pattern @param {Prepared} p @returns {{start: number, end: number}|null}
 */
export function findPattern(pattern, p) {
  if (pattern.mode === 'sub') {
    const at = p.nospace.indexOf(pattern.needle)
    return at < 0 ? null : { start: at, end: at + pattern.needle.length }
  }
  const w = pattern.words, t = p.toks
  outer: for (let i = 0; i + w.length <= t.length; i++) {
    for (let j = 0; j < w.length; j++) {
      const tok = t[i + j], want = w[j]
      if (want.prefix ? !tok.startsWith(want.t) : tok !== want.t) continue outer
    }
    return { start: i, end: i + w.length }
  }
  return null
}

/** @param {string} text */
export const patternKey = (text) => {
  const p = compilePattern(text)
  return p ? (p.mode === 'sub' ? 'sub:' + p.needle : 'tok:' + p.words.map((w) => w.t + (w.prefix ? '*' : '')).join(' ')) : ''
}
