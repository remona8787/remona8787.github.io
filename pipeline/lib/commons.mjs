// Wikimedia Commons: category discovery (name search in namespace 14, breadth-first walks of configured roots),
// "media facade" file-name search, project image categories, and file metadata for the rights check.
// One generator request lists a category's subcategories together with their own size, Wikidata item
// (pageprops.wikibase_item) and coordinates, so a walk costs one request per expanded category.
// Every category decision (candidate, aggregate, edition, evidence, rejected) is recorded with its reason.
import { fetchCommonsPages, BLOCKING_TEMPLATES, KR_FOP_TEMPLATES } from '../../edge-functions/_shared/live-media.mjs'
import { detectLocation } from '../../edge-functions/_shared/archive/normalize.mjs'
import { categoryTitle, chunk, stripTags, uniq, isQid, bareFile, validLat, validLng } from './util.mjs'
import { termPattern } from './wikipedia.mjs'
import { HOUR } from './cache.mjs'

export const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
export const api = (params) => `${COMMONS_API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`
const name = (title) => String(title || '').replace(/^Category:/, '')

const compile = (list, flags = 'i') => (list || []).map((p) => ({ re: new RegExp(p.pattern ?? p, p.case_sensitive ? '' : flags), reason: p.reason || String(p) }))

/** Compiled category rules from config/categories.json. */
export function categoryRules(config) {
  return {
    aggregate: compile(config.aggregate_patterns),
    edition: compile(config.edition_patterns),
    blocklist: compile(config.blocklist_patterns),
    koreaAllow: compile(config.korea_allow_patterns),
    night: (config.night_subcategory_patterns || []).map((p) => new RegExp(p, 'i')),
    event: (config.event_subcategory_patterns || []).map((p) => new RegExp(p, 'i')),
    heuristics: config.aggregate_heuristics || { min_subcats_for_aggregate: 25, max_files_for_aggregate: 5 },
  }
}

/**
 * The decision for one category: 'rejected' (blocklist), 'edition' (a dated edition of a parent project),
 * 'aggregate' (a collection to walk through, never a project), 'evidence' (an evidence-only root) or 'candidate'.
 * @param {string} title @param {{subcats?: number, files?: number}|null} info @param {{mode?: string}} root @param {ReturnType<typeof categoryRules>} rules
 */
export function classifyCategory(title, info, root, rules) {
  const n = name(title)
  // Korean light festivals named with words the worldwide blocklist rejects (lanterns): allowed under a Korean root.
  const allowed = root?.korea && (rules.koreaAllow || []).some((r) => r.re.test(n))
  if (!allowed) for (const r of rules.blocklist) if (r.re.test(n)) return { decision: 'rejected', reason: 'blocklist_' + r.reason }
  for (const r of rules.edition) if (r.re.test(n)) return { decision: 'edition', reason: r.reason }
  for (const r of rules.aggregate) if (r.re.test(n)) return { decision: 'aggregate', reason: r.reason }
  const h = rules.heuristics
  if (info && (info.subcats ?? 0) >= h.min_subcats_for_aggregate && (info.files ?? 0) <= h.max_files_for_aggregate) return { decision: 'aggregate', reason: 'many_subcategories_few_files' }
  if (root?.mode === 'evidence') return { decision: 'evidence', reason: 'evidence_root' }
  if (info && (info.files ?? 0) === 0 && (info.subcats ?? 0) === 0) return { decision: 'rejected', reason: 'empty_category' }
  return { decision: 'candidate', reason: 'specific_category' }
}

export const isNightCategory = (title, rules) => rules.night.some((re) => re.test(name(title)))
export const isEventCategory = (title, rules) => rules.event.some((re) => re.test(name(title)))

/** The project category a night/illumination category belongs to, by name ("X at night" → "X"). */
export function nightParent(title) {
  const n = name(title)
  const base = n.replace(/\s*[(,]?\s*(at night|by night|night ?views?|illuminated|illumination|nighttime|lit up|de nuit|bei nacht|nachts|di notte|de noche)\s*\)?$/i, '').trim()
  return base && base !== n ? 'Category:' + base : null
}

function pageInfo(p) {
  const coords = (p.coordinates || []).find((c) => validLat(c.lat) && validLng(c.lon))
  return {
    title: p.title,
    exists: !p.missing,
    qid: isQid(p.pageprops?.wikibase_item) ? p.pageprops.wikibase_item : null,
    size: p.categoryinfo?.size ?? 0,
    files: p.categoryinfo?.files ?? 0,
    subcats: p.categoryinfo?.subcats ?? 0,
    hidden: !!p.categoryinfo?.hidden,
    lat: coords ? coords.lat : null,
    lng: coords ? coords.lon : null,
  }
}

/** Info (size, item, coordinates) for category titles, 50 per request. Map(title → info). */
export async function categoryInfo(client, titles, { cache, ttlHours = 72, stage = 'commons' } = {}) {
  const out = new Map(), want = []
  for (const t of uniq(titles.map(categoryTitle))) {
    const hit = cache?.fresh('commons-category', t)
    if (hit !== undefined) out.set(t, hit); else want.push(t)
  }
  for (const group of chunk(want, 50)) {
    const json = await client.json(api({ action: 'query', prop: 'pageprops|categoryinfo|coordinates', ppprop: 'wikibase_item', titles: group.join('|'), colimit: 'max' }), { stage })
    const norm = new Map((json?.query?.normalized || []).map((n) => [n.to, n.from]))
    for (const p of json?.query?.pages || []) {
      const info = pageInfo(p)
      out.set(p.title, info)
      cache?.set('commons-category', p.title, info, { ttlMs: ttlHours * HOUR })
      if (norm.has(p.title)) out.set(categoryTitle(norm.get(p.title)), info)
    }
  }
  return out
}

/** Subcategories of a category with their own info (one generator request per 500). */
export async function subcategories(client, title, { cache, ttlHours = 72, max = 500, stage = 'commons' } = {}) {
  const key = 'sub:' + title
  const hit = cache?.fresh('commons-members', key)
  if (hit !== undefined) return hit
  const out = []
  let cont = {}
  for (let round = 0; round < 10 && out.length < max; round++) {
    const json = await client.json(api({ action: 'query', generator: 'categorymembers', gcmtitle: title, gcmtype: 'subcat', gcmlimit: '500', prop: 'pageprops|categoryinfo|coordinates', ppprop: 'wikibase_item', colimit: 'max', ...cont }), { stage })
    for (const p of json?.query?.pages || []) if (p.ns === 14) out.push(pageInfo(p))
    if (!json?.continue) break
    cont = Object.fromEntries(Object.entries(json.continue).filter(([k]) => k !== 'continue'))
    cont.continue = json.continue.continue
  }
  out.sort((a, b) => (a.title < b.title ? -1 : 1))
  cache?.set('commons-members', key, out, { ttlMs: ttlHours * HOUR })
  return out
}

/** Files of a category (newest first), up to limit. */
export async function categoryFiles(client, title, { cache, ttlHours = 72, limit = 60, stage = 'images' } = {}) {
  const key = 'files:' + title + ':' + limit
  const hit = cache?.fresh('commons-members', key)
  if (hit !== undefined) return hit
  const out = []
  let cont = {}
  for (let round = 0; round < 5 && out.length < limit; round++) {
    const json = await client.json(api({ action: 'query', list: 'categorymembers', cmtitle: title, cmtype: 'file', cmlimit: String(Math.min(500, limit)), cmsort: 'timestamp', cmdir: 'desc', cmprop: 'title|type|timestamp', ...cont }), { stage })
    for (const m of json?.query?.categorymembers || []) if (m.ns === 6) out.push(bareFile(m.title))
    if (!json?.continue) break
    cont = { cmcontinue: json.continue.cmcontinue, continue: json.continue.continue }
  }
  const list = out.slice(0, limit)
  cache?.set('commons-members', key, list, { ttlMs: ttlHours * HOUR })
  return list
}

/** Files and subcategories of a category in one request (newest first): {files: [names], subcats: [titles]}. */
export async function categoryMembers(client, title, { cache, ttlHours = 72, limit = 200, stage = 'images' } = {}) {
  const key = 'members:' + title + ':' + limit
  const hit = cache?.fresh('commons-members', key)
  if (hit !== undefined) return hit
  const files = [], subcats = []
  let cont = {}
  for (let round = 0; round < 3 && files.length + subcats.length < limit; round++) {
    const json = await client.json(api({ action: 'query', list: 'categorymembers', cmtitle: title, cmtype: 'file|subcat', cmlimit: String(Math.min(500, limit)), cmsort: 'timestamp', cmdir: 'desc', cmprop: 'title|type|timestamp', ...cont }), { stage })
    for (const m of json?.query?.categorymembers || []) { if (m.ns === 6) files.push(bareFile(m.title)); else if (m.ns === 14) subcats.push(m.title) }
    if (!json?.continue) break
    cont = { cmcontinue: json.continue.cmcontinue, continue: json.continue.continue }
  }
  const out = { files: files.slice(0, limit), subcats: subcats.sort() }
  cache?.set('commons-members', key, out, { ttlMs: ttlHours * HOUR })
  return out
}

/** Category name search (namespace 14) for a phrase, or for several phrases that must all be in the name. */
export async function searchCategories(client, term, { limit = 50, cache, ttlHours = 72 } = {}) {
  const terms = [].concat(term)
  const json = await client.json(api({ action: 'query', list: 'search', srsearch: terms.map((t) => `intitle:"${t}"`).join(' '), srnamespace: '14', srlimit: String(Math.min(500, limit)), srprop: 'size' }), { stage: 'commons', cache: cache ? { ns: 'commons-search', key: 'cat:' + terms.join(' + '), ttlMs: ttlHours * HOUR } : null })
  return (json?.query?.search || []).filter((s) => s.ns === 14).map((s) => s.title)
}

/** Files whose name contains the phrase (namespace 6) and their visible categories. */
export async function searchFiles(client, term, { limit = 100, cache, ttlHours = 72 } = {}) {
  const json = await client.json(api({ action: 'query', generator: 'search', gsrsearch: `intitle:"${term}"`, gsrnamespace: '6', gsrlimit: String(Math.min(500, limit)), prop: 'categories', clshow: '!hidden', cllimit: 'max' }), { stage: 'commons', cache: cache ? { ns: 'commons-search', key: 'file:' + term, ttlMs: ttlHours * HOUR } : null })
  return (json?.query?.pages || []).filter((p) => p.ns === 6).map((p) => ({ file: bareFile(p.title), categories: (p.categories || []).map((c) => c.title) }))
}

/**
 * Files whose structured data says they depict the item (P180 "depicts"), found with one CirrusSearch query
 * (haswbstatement:P180=<QID>, namespace 6). Cached per item.
 */
export async function depictsFiles(client, qid, { limit = 30, cache, ttlHours = 336 } = {}) {
  if (!/^Q[1-9]\d*$/.test(String(qid))) return []
  const json = await client.json(api({ action: 'query', list: 'search', srsearch: `haswbstatement:P180=${qid}`, srnamespace: '6', srlimit: String(Math.min(50, limit)), srprop: 'size' }), { stage: 'images', cache: cache ? { ns: 'commons-depicts', key: qid, ttlMs: ttlHours * HOUR } : null })
  return (json?.query?.search || []).filter((s) => s.ns === 6).map((s) => bareFile(s.title))
}

/**
 * Category discovery: searches and walks. Returns {categories: Map(title → {info, decision, reason, root, parent,
 * project_type, place_hint, night_subcats[], editions[], korea}), errors, partial}.
 * Korea first: the Korean searches (config.korea_search: Korean terms, and English terms together with a Korean place
 * name) and the Korean roots (config.korea_roots) run before everything else and on `client`; the worldwide searches
 * and walks run on `foreign` (a view of the client that stops earlier when time runs short).
 */
export async function discoverCategories(client, config, { cache, ttlHours = 72, log = () => {}, classQids = [], foreign = null, korea = true } = {}) {
  const fc = foreign || client
  const rules = categoryRules(config)
  const rootTitles = new Set((config.roots || []).map((r) => categoryTitle(r.title)))
  const classSet = new Set(classQids)
  const walk = config.walk || {}
  const maxCategories = walk.max_categories ?? 2500
  const seen = new Map()
  const errors = []
  let partial = false
  const record = (info, decision, extra) => {
    const entry = { title: info.title, qid: info.qid, files: info.files, subcats: info.subcats, lat: info.lat, lng: info.lng, ...decision, ...extra }
    seen.set(info.title, entry)
    log({ kind: 'category', ...entry })
    return entry
  }
  // 0. Korean name searches (Korea first).
  const searched = []
  for (const s of korea ? config.korea_search || [] : []) {
    const terms = [].concat(s.terms || s.term)
    try {
      for (const t of await searchCategories(client, terms, { limit: config.search_limit ?? 50, cache, ttlHours })) searched.push({ title: t, terms, korea: true, root: { title: 'korea-search:' + terms.join(' + '), mode: 'candidates', project_type: s.project_type, country_iso2: 'KR', korea: true } })
    } catch (e) { if (e?.code === 'budget') { partial = true; break } errors.push({ stage: 'commons_search_korea', term: terms.join(' + '), message: String(e?.message || e).slice(0, 300) }) }
  }
  // 1. Name searches.
  for (const s of config.search_terms || []) {
    if (partial) break
    try {
      for (const t of await searchCategories(fc, s.term, { limit: config.search_limit ?? 50, cache, ttlHours })) searched.push({ title: t, terms: [s.term], root: { title: 'search:' + s.term, mode: 'candidates', project_type: s.project_type } })
    } catch (e) { if (e?.code === 'budget') break; errors.push({ stage: 'commons_search', term: s.term, message: String(e?.message || e).slice(0, 300) }) }
  }
  // 2. Files named "media facade": their categories are candidates (same rules).
  for (const term of config.file_search_terms || []) {
    if (partial) break
    try {
      for (const f of await searchFiles(fc, term, { limit: config.file_search_limit ?? 100, cache, ttlHours })) {
        for (const c of f.categories) searched.push({ title: c, root: { title: 'file-search:' + term, mode: 'candidates', project_type: 'media_facade' }, via_file: f.file })
      }
    } catch (e) { if (e?.code === 'budget') break; errors.push({ stage: 'commons_file_search', term, message: String(e?.message || e).slice(0, 300) }) }
  }
  if (searched.length && !partial) {
    try {
      const info = await categoryInfo(client, searched.map((s) => s.title), { cache, ttlHours })
      for (const s of searched) {
        const i = info.get(categoryTitle(s.title))
        if (!i || !i.exists || seen.has(i.title) || rootTitles.has(i.title)) continue
        // The category of a whole class ("Projection mapping" ↔ Q776483) is a topic, never one project.
        const hint = s.korea ? koreanHint(i.title) : null
        if (i.qid && classSet.has(i.qid)) { record(i, { decision: 'aggregate', reason: 'topic_category_of_a_class' }, { root: s.root.title, parent: null, project_type: s.root.project_type ?? null, place_hint: hint, korea: !!s.korea }); continue }
        // A name search also returns loosely related categories ("Facades" for "media facade"): the searched phrases
        // must be in the category name itself. (Categories of files named with the phrase are exempt.)
        if (!s.via_file && s.terms?.length && !s.terms.every((t) => termPattern(t).test(name(i.title)))) { record(i, { decision: 'rejected', reason: 'term_not_in_name' }, { root: s.root.title, parent: null, project_type: null, place_hint: null, korea: !!s.korea }); continue }
        const d = classifyCategory(i.title, i, s.root, rules)
        record(i, d, { root: s.root.title, parent: null, project_type: s.root.project_type, place_hint: hint, via_file: s.via_file || null, korea: !!s.korea })
      }
    } catch (e) { if (e?.code === 'budget') partial = true; else errors.push({ stage: 'commons_info', message: String(e?.message || e).slice(0, 300) }) }
  }
  // 3. Breadth-first walks of the roots, then one level below every category the name searches found (a search hit
  // such as "Projection mapping in Prague" is an aggregate whose members are the projects).
  const expanded = new Set()
  const WALK = new Set(['aggregate', 'candidate', 'evidence', 'part'])
  // A category found by a Korean search or under a Korean root: its own place name if it has one, else Korea.
  function koreanHint(title) {
    const own = detectLocation(name(title))
    return own?.country_iso2 ? { country_iso2: own.country_iso2, city: own.city, from: title } : { country_iso2: 'KR', city: null, from: 'korea_search' }
  }
  async function walkFrom(root, startInfo, maxDepth, cl = client) {
    const queue = [{ info: startInfo, depth: 0, hint: seen.get(startInfo.title)?.place_hint ?? null }]
    let count = 0
    while (queue.length && seen.size < maxCategories && count < (walk.max_per_root ?? 600)) {
      const { info, depth, hint } = queue.shift()
      const parentEntry = seen.get(info.title)
      if (depth >= maxDepth || !info.subcats || expanded.has(info.title)) continue
      expanded.add(info.title)
      let children
      try { children = await subcategories(cl, info.title, { cache, ttlHours }) } catch (e) {
        if (e?.code === 'budget') { partial = true; return }
        errors.push({ stage: 'commons_walk', category: info.title, message: String(e?.message || e).slice(0, 300) }); continue
      }
      // A place named by an aggregate ancestor ("Projection mapping in Poland") is a location hint for its members.
      const own = parentEntry?.decision === 'aggregate' ? detectLocation(name(info.title)) : null
      const placeHint = own?.country_iso2 ? { country_iso2: own.country_iso2, city: own.city, from: info.title } : hint || (root.country_iso2 ? { country_iso2: root.country_iso2, city: null, from: root.title } : null)
      for (const child of children) {
        count++
        if (seen.has(child.title)) {
          const prev = seen.get(child.title)
          if (prev.decision === 'edition' && !prev.parent && parentEntry?.decision === 'candidate') { prev.parent = info.title; parentEntry.editions = [...(parentEntry.editions || []), child.title] }
          if (!prev.place_hint && placeHint) prev.place_hint = placeHint
          if (WALK.has(prev.decision) && !expanded.has(child.title)) queue.push({ info: child, depth: depth + 1, hint: placeHint })
          continue
        }
        const d = classifyCategory(child.title, child, root, rules)
        const entry = record(child, d, { root: root.title, parent: info.title, project_type: root.project_type ?? null, place_hint: placeHint, korea: !!root.korea })
        if (d.decision === 'candidate' && parentEntry?.decision === 'candidate') {
          // A specific category inside a project category is part of that project (a work of a festival, its night views).
          entry.decision = 'part'; entry.reason = 'inside_project_category'
          parentEntry.parts = [...(parentEntry.parts || []), child.title]
        }
        if (d.decision === 'edition' && parentEntry?.decision === 'candidate') parentEntry.editions = [...(parentEntry.editions || []), child.title]
        if (WALK.has(entry.decision)) queue.push({ info: child, depth: depth + 1, hint: placeHint })
        if (seen.size >= maxCategories) break
      }
    }
  }
  const warnings = []
  // Korean roots and the aggregates the Korean searches found first (on client), then the worldwide ones (on fc).
  const rootList = [...(korea ? (config.korea_roots || []).map((r) => ({ ...r, korea: true, country_iso2: r.country_iso2 || 'KR' })) : []), ...(config.roots || [])]
  const walkSearched = async (onlyKorea) => {
    for (const s of searched) {
      if (partial) return
      if (!!s.korea !== onlyKorea) continue
      const e = seen.get(categoryTitle(s.title))
      if (!e || e.decision !== 'aggregate' || expanded.has(e.title)) continue
      try { await walkFrom({ title: s.root.title, mode: 'candidates', project_type: s.root.project_type, korea: !!s.korea, country_iso2: s.root.country_iso2 }, e, 1, onlyKorea ? client : fc) } catch (x) { if (x?.code === 'budget') return; throw x }
    }
  }
  for (const root of rootList) {
    if (partial) break
    const cl = root.korea ? client : fc
    let rootInfo
    try { rootInfo = (await categoryInfo(cl, [root.title], { cache, ttlHours })).get(categoryTitle(root.title)) } catch (e) {
      if (e?.code === 'budget') { if (root.korea) { partial = true; break } continue }
      errors.push({ stage: 'commons_root', root: root.title, message: String(e?.message || e).slice(0, 300) }); continue
    }
    // A configured root that does not exist is a configuration warning, not a source failure.
    if (!rootInfo?.exists) { log({ kind: 'root_missing', root: root.title }); warnings.push({ stage: 'commons_root', root: root.title, message: 'category does not exist' }); continue }
    record(rootInfo, { decision: 'aggregate', reason: 'configured_root' }, { root: root.title, parent: null, project_type: root.project_type ?? null, place_hint: root.country_iso2 ? { country_iso2: root.country_iso2, city: null, from: root.title } : null, korea: !!root.korea })
    await walkFrom(root, rootInfo, root.depth ?? 2, cl)
    // Right after the last Korean root: the Korean search aggregates, before any worldwide walk.
    if (root.korea && !rootList[rootList.indexOf(root) + 1]?.korea) await walkSearched(true)
  }
  if (!rootList.some((r) => r.korea)) await walkSearched(true)
  await walkSearched(false)
  // The worldwide part may stop early for the Korean sources (the foreign deadline): that is partial too.
  if (fc !== client && fc.remaining() <= 0) partial = true
  return { categories: seen, errors, warnings, partial, rules }
}

// ---- files ----

const KEEP_TEMPLATE = new RegExp('^Template:(' + ['NoFoP', 'FoP', ...BLOCKING_TEMPLATES.map((t) => t.replace(/^Template:/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))].join('|') + ')', 'i')

/** One imageinfo page → the cached file record (rights inputs, sizes, URLs, descriptive text). */
export function fileRecord(file, page) {
  const ii = page?.imageinfo?.[0]
  if (!page || page.missing || !ii?.url) return { file, missing: true }
  const m = ii.extmetadata || {}
  const v = (k) => stripTags(m[k]?.value || '')
  return {
    file,
    mime: ii.mime || null,
    width: ii.width ?? null,
    height: ii.height ?? null,
    size: ii.size ?? null,
    sha1: ii.sha1 || null,
    timestamp: ii.timestamp || null,
    url: ii.url,
    thumburl: ii.thumburl || null,
    thumbwidth: ii.thumbwidth ?? null,
    thumbheight: ii.thumbheight ?? null,
    page: ii.descriptionurl || 'https://commons.wikimedia.org/wiki/File:' + encodeURIComponent(file.replace(/ /g, '_')),
    license: v('LicenseShortName') || v('UsageTerms') || null,
    license_url: /^https?:\/\//.test(m.LicenseUrl?.value || '') ? m.LicenseUrl.value : null,
    artist: v('Artist') || null,
    credit: v('Credit') || null,
    attribution: v('Attribution') || null,
    description: v('ImageDescription').slice(0, 600) || null,
    object_name: v('ObjectName') || null,
    categories: v('Categories') ? m.Categories.value.split('|').map((s) => s.trim()).filter(Boolean).slice(0, 40) : [],
    date: v('DateTimeOriginal').slice(0, 40) || null,
    templates: (page.templates || []).filter((t) => KEEP_TEMPLATE.test(t)),
    templatesComplete: page.templatesComplete !== false,
  }
}

/**
 * File metadata for the rights check and scoring, cached per file ('commons-files'). It uses live-media.mjs
 * fetchCommonsPages (batches of 50, every template of each file with continuation, templatesComplete) with the
 * request widened to sizes, SHA-1, a 330 px thumbnail URL and the descriptive metadata.
 */
export async function fileInfo(client, files, { cache, ttlHours = 336, thumbWidth = 330, stage = 'images' } = {}) {
  const out = new Map(), want = []
  for (const f of uniq(files.map(bareFile))) {
    const hit = cache?.fresh('commons-files', f)
    if (hit !== undefined) out.set(f, hit); else want.push(f)
  }
  if (!want.length) return out
  const fetchJSON = (url) => {
    const u = new URL(url)
    u.searchParams.set('formatversion', '2')
    u.searchParams.set('iiprop', 'url|extmetadata|mime|size|sha1|timestamp')
    u.searchParams.set('iiurlwidth', String(thumbWidth))
    u.searchParams.set('iiextmetadatafilter', 'Artist|Credit|Attribution|LicenseShortName|LicenseUrl|UsageTerms|DateTimeOriginal|ImageDescription|ObjectName|Categories')
    u.searchParams.delete('origin')
    return client.json(u.href, { stage })
  }
  for (const group of chunk(want, 50)) {
    let pages
    try { pages = await fetchCommonsPages(group, fetchJSON) } catch (e) {
      if (e?.code === 'budget') throw e
      for (const f of group) { const old = cache?.any('commons-files', f); if (old) out.set(f, old) }
      continue
    }
    for (const f of group) {
      const rec = fileRecord(f, pages.get(f))
      out.set(f, rec)
      cache?.set('commons-files', f, rec, { ttlMs: ttlHours * HOUR })
    }
  }
  return out
}

export { KR_FOP_TEMPLATES }
