// RSS 2.0, Atom 1.0 and RSS 1.0 (RDF) feeds, parsed without dependencies (no DOMParser in the Edge runtime).
// A small tolerant XML reader: elements, attributes, CDATA, comments, processing instructions, DOCTYPE (with an
// internal subset), the five XML entities plus numeric and common HTML entities, and mismatched end tags (real feeds
// have them). Namespaces are kept as prefixes; elements are matched by local name, so atom:link, atom10:link
// (Feedburner) and a default-namespace Atom link are the same thing.
// From each item we keep only what the archive stores: title, link, id, a ≤300-character excerpt (summary or
// description; content:encoded is never read), date, author and categories. Hub and self links (atom:link
// rel=hub/self in the feed, or the HTTP Link header) are reported for WebSub discovery.

import { decodeEntities, stripHtml, collapse } from '../text.mjs'
import { languageCode } from '../normalize.mjs'
import { parseLinkHeader } from '../websub.mjs'

/**
 * @typedef {object} RawRecord  an adapter's item before classification and normalization
 * @property {'gdelt'|'rss'|'websub'|'naver_news'|'naver_blog'|'brave'|'wikidata'} provider
 * @property {string|null} external_id
 * @property {string} url
 * @property {string} title
 * @property {string|null} excerpt
 * @property {string|null} publisher
 * @property {string|null} language
 * @property {string|null} published_at
 * @property {Record<string, unknown>} raw
 *
 * @typedef {{name: string, attrs: Record<string, string>, children: (XmlNode|string)[]}} XmlNode
 * @typedef {{guid: string|null, title: string, link: string|null, description: string|null, published_at: string|null, author: string|null, categories: string[]}} FeedItem
 * @typedef {{format: 'rss'|'atom'|'rdf', title: string|null, link: string|null, language: string|null, hub: string|null, self: string|null, items: FeedItem[]}} Feed
 */

// ---- XML ----

/** @param {string} s */
function parseAttrs(s) {
  /** @type {Record<string, string>} */
  const attrs = {}
  const re = /([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  let m
  while ((m = re.exec(s))) attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  return attrs
}

/**
 * Parses XML into a tree under a synthetic #document node. Never throws on malformed markup: unclosed elements
 * close at the end, a stray end tag closes back to its nearest open match (or is ignored).
 * @param {string} text @returns {XmlNode}
 */
export function parseXml(text) {
  const src = String(text ?? '').replace(/^\ufeff/, '')
  /** @type {XmlNode} */
  const root = { name: '#document', attrs: {}, children: [] }
  /** @type {XmlNode[]} */
  const stack = [root]
  const top = () => stack[stack.length - 1]
  let i = 0
  const n = src.length
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) { pushText(src.slice(i)); break }
    if (lt > i) pushText(src.slice(i, lt))
    if (src.startsWith('<!--', lt)) { const end = src.indexOf('-->', lt + 4); i = end < 0 ? n : end + 3; continue }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9)
      top().children.push(src.slice(lt + 9, end < 0 ? n : end))
      i = end < 0 ? n : end + 3
      continue
    }
    if (src.startsWith('<?', lt)) { const end = src.indexOf('?>', lt + 2); i = end < 0 ? n : end + 2; continue }
    if (src.startsWith('<!', lt)) {
      // DOCTYPE, possibly with an internal subset in [...].
      let j = lt + 2, depth = 0
      for (; j < n; j++) { const c = src[j]; if (c === '[') depth++; else if (c === ']') depth--; else if (c === '>' && depth <= 0) break }
      i = j + 1
      continue
    }
    // A tag: find its end, skipping quoted attribute values.
    let j = lt + 1, quote = ''
    for (; j < n; j++) {
      const c = src[j]
      if (quote) { if (c === quote) quote = '' }
      else if (c === '"' || c === "'") quote = c
      else if (c === '>') break
    }
    const body = src.slice(lt + 1, j)
    i = j + 1
    if (body.startsWith('/')) {
      const name = body.slice(1).trim()
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].name === name) { stack.length = k; break }
      continue
    }
    const selfClosing = body.endsWith('/')
    const inner = selfClosing ? body.slice(0, -1) : body
    const m = /^([^\s/>]+)([\s\S]*)$/.exec(inner)
    if (!m) { pushText('<' + body + '>'); continue }
    /** @type {XmlNode} */
    const node = { name: m[1], attrs: parseAttrs(m[2]), children: [] }
    top().children.push(node)
    if (!selfClosing) stack.push(node)
  }
  return root
  /** @param {string} s */
  function pushText(s) { if (s) top().children.push(decodeEntities(s)) }
}

/** @param {XmlNode} node */
const local = (node) => node.name.replace(/^.*:/, '').toLowerCase()
/** @param {XmlNode|undefined|null} node @param {string} name @returns {XmlNode[]} */
const kids = (node, name) => node ? /** @type {XmlNode[]} */ (node.children.filter((c) => typeof c !== 'string' && local(c) === name)) : []
/** @param {XmlNode|undefined|null} node @param {string} name */
const kid = (node, name) => kids(node, name)[0] || null
/** Text content (descendants concatenated). @param {XmlNode|string|null|undefined} node @returns {string} */
export function textOf(node) {
  if (node == null) return ''
  if (typeof node === 'string') return node
  return node.children.map(textOf).join('')
}
/** @param {XmlNode|null} node */
const textOrNull = (node) => { const t = collapse(textOf(node)); return t || null }

// ---- dates ----

// Zone abbreviations Date.parse does not know (RFC 822 only defines UT/GMT and the US zones).
const ZONES = /** @type {Record<string, string>} */ ({ KST: '+0900', JST: '+0900', HKT: '+0800', SGT: '+0800', CET: '+0100', CEST: '+0200', MEZ: '+0100', MESZ: '+0200', BST: '+0100', IST: '+0530', AEST: '+1000', AEDT: '+1100', MSK: '+0300', EET: '+0200', EEST: '+0300', WET: '+0000', WEST: '+0100', UTC: '+0000', Z: '+0000' })
// Dates outside this window are feed errors ("Thu, 01 Jan 1970"), not publication dates.
const EARLIEST = Date.UTC(1995, 0, 1)

/**
 * RFC 822/2822 (RSS pubDate), ISO 8601 (Atom, dc:date) and "YYYY-MM-DD hh:mm:ss" (taken as UTC: the feed gave no
 * zone, and guessing the server's would make results depend on where the code runs). Null when unparseable or
 * implausible (before 1995 or more than 2 days ahead of now).
 * @param {unknown} value @param {number} [now]
 */
export function parseFeedDate(value, now = Date.now()) {
  let s = collapse(value)
  if (!s) return null
  s = s.replace(/\b([A-Z]{1,4}T?\d?)$/, (z) => ZONES[z] ?? z)
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s = s.replace(' ', 'T') + 'Z'
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z'
  else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?\s*[+-]\d{2}:?\d{2}$/.test(s)) s = s.replace(' ', 'T').replace(/\s+/, '')
  const t = Date.parse(s)
  if (!Number.isFinite(t) || t < EARLIEST || t > now + 2 * 86400e3) return null
  return new Date(t).toISOString()
}

// ---- feeds ----

/** The href of the first link with this rel among an element's children (Atom style links in any namespace). @param {XmlNode|null} node @param {string} rel */
function linkRel(node, rel) {
  for (const l of kids(node, 'link')) {
    const r = (l.attrs.rel || (rel === 'alternate' ? 'alternate' : '')).toLowerCase().split(/\s+/)
    if (l.attrs.href && r.includes(rel)) return l.attrs.href.trim()
  }
  return null
}

/** Atom text constructs: type="html" holds escaped HTML, "xhtml" a div of markup, "text" plain text. @param {XmlNode|null} node */
const atomText = (node) => node ? stripHtml(textOf(node)) || null : null

/**
 * @param {string} text the feed document
 * @param {{now?: number, linkHeader?: string|null}} [o]
 * @returns {Feed}
 */
export function parseFeed(text, { now = Date.now(), linkHeader = null } = {}) {
  const doc = parseXml(text)
  const rootEl = /** @type {XmlNode|undefined} */ (doc.children.find((c) => typeof c !== 'string'))
  if (!rootEl) throw new Error('not a feed: no root element')
  const header = parseLinkHeader(linkHeader)
  const rootName = local(rootEl)
  if (rootName === 'feed') {
    const items = kids(rootEl, 'entry').map((e) => ({
      guid: textOrNull(kid(e, 'id')),
      title: atomText(kid(e, 'title')) || '',
      link: linkRel(e, 'alternate') || kids(e, 'link').map((l) => l.attrs.href).find(Boolean) || null,
      description: atomText(kid(e, 'summary')) || atomText(kid(e, 'content')),
      published_at: parseFeedDate(textOf(kid(e, 'published')), now) || parseFeedDate(textOf(kid(e, 'updated')), now),
      author: textOrNull(kid(kid(e, 'author'), 'name')),
      categories: kids(e, 'category').map((c) => c.attrs.term || c.attrs.label || '').filter(Boolean).slice(0, 10),
    }))
    return {
      format: 'atom', title: atomText(kid(rootEl, 'title')), link: linkRel(rootEl, 'alternate'),
      language: languageCode(rootEl.attrs['xml:lang']),
      hub: header.hub || linkRel(rootEl, 'hub'), self: header.self || linkRel(rootEl, 'self'), items,
    }
  }
  if (rootName === 'rss' || rootName === 'rdf') {
    const channel = kid(rootEl, 'channel')
    // RSS 1.0 puts the items next to the channel; RSS 2.0 inside it.
    const itemNodes = rootName === 'rdf' ? kids(rootEl, 'item') : kids(channel, 'item')
    const items = itemNodes.map((it) => {
      const guidNode = kid(it, 'guid')
      const guid = textOrNull(guidNode) || it.attrs['rdf:about'] || null
      // Feedburner points <link> at its redirector and keeps the article in feedburner:origLink.
      const link = textOrNull(kid(it, 'origlink')) || textOrNull(kid(it, 'link')) || linkRel(it, 'alternate') || (guid && /^https?:\/\//.test(guid) && guidNode?.attrs.isPermaLink !== 'false' ? guid : null)
      return {
        guid,
        title: stripHtml(textOf(kid(it, 'title'))),
        link,
        description: stripHtml(textOf(kid(it, 'description'))) || null,
        published_at: parseFeedDate(textOf(kid(it, 'pubdate')), now) || parseFeedDate(textOf(kid(it, 'date')), now),
        author: textOrNull(kid(it, 'creator')) || textOrNull(kid(it, 'author')),
        categories: [...kids(it, 'category'), ...kids(it, 'subject')].map((c) => collapse(textOf(c))).filter(Boolean).slice(0, 10),
      }
    })
    // <link> in an RSS channel is text; Atom-style links (atom:link, atom10:link) carry href.
    const channelLink = kids(channel, 'link').map((l) => l.attrs.href ? '' : collapse(textOf(l))).find(Boolean) || null
    return {
      format: rootName === 'rdf' ? 'rdf' : 'rss', title: stripHtml(textOf(kid(channel, 'title'))) || null, link: channelLink,
      language: languageCode(textOf(kid(channel, 'language'))),
      hub: header.hub || linkRel(channel, 'hub'), self: header.self || linkRel(channel, 'self'), items,
    }
  }
  throw new Error(`not a feed: root element <${rootEl.name}>`)
}

/**
 * Feed items as adapter records. Items without an http(s) link or a title are dropped (nothing to point to).
 * @param {Feed} feed @param {{provider?: 'rss'|'websub', feedUrl?: string|null}} [o] @returns {RawRecord[]}
 */
export function feedRecords(feed, { provider = 'rss', feedUrl = null } = {}) {
  /** @type {RawRecord[]} */
  const out = []
  for (const it of feed.items) {
    let url = null
    try { if (it.link) url = new URL(it.link, feed.link || feedUrl || undefined).href } catch { url = null }
    if (!url || !/^https?:/i.test(url) || !it.title) continue
    out.push({
      provider,
      external_id: it.guid ? it.guid.slice(0, 500) : null,
      url,
      title: it.title,
      excerpt: it.description,
      publisher: feed.title,
      language: feed.language,
      published_at: it.published_at,
      raw: { guid: it.guid, author: it.author, categories: it.categories, feed: feed.self || feedUrl, format: feed.format },
    })
  }
  return out
}
