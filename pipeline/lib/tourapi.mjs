// 한국관광공사 TourAPI 4.x (KorService2, data.go.kr; key TOURAPI_SERVICE_KEY) and the tourism photo gallery
// (PhotoGalleryService1, the same key). Korea first (docs/STATIC_ARCHIVE.md v0.18 addendum):
//
//  - searchKeyword2: the Korean term list by content type (12 attractions, 14 cultural facilities, 15 festivals). An
//    item becomes a project candidate only when a term is in its title, or in its overview (detailCommon2, read only for
//    items without the term in the title, capped per run), AND the collector's keyword classifier agrees
//    (edge-functions/_shared/archive/classify.mjs: a facade project or an event programme; for media art and light
//    art terms an "only art/lighting terms" verdict without commercial signals). Every decision is logged.
//  - Fields: contentid, contenttypeid, title, addr1/addr2, mapx (longitude) / mapy (latitude), areacode/sigungucode and
//    the legal-dong codes lDongRegnCd/lDongSignguCd (kr_region, lib/korea.mjs), firstimage/firstimage2 with
//    cpyrhtDivCd, homepage (detailCommon2).
//  - detailImage2: originimgurl, smallimageurl, imgname, serialnum and cpyrhtDivCd per image. The licence comes from
//    cpyrhtDivCd and is never assumed: Type1 = 공공누리 제1유형 (attribution; commercial use and changes allowed), Type3 =
//    공공누리 제3유형 (attribution, no changes: never cropped or edited, shown as is). Any other or missing value: not
//    published (candidates only).
//  - PhotoGalleryService1 gallerySearchList1: galContentId, galTitle, galWebImageUrl, galPhotographer,
//    galPhotographyLocation, galPhotographyMonth, galSearchKeyword. Its licence field is read when the answer has one
//    (cpyrhtDivCd or a copyright field); without it a photo is a candidate for review only (config
//    kto_photo.default_license_when_missing stays null until the first live answers have been checked).
// Keys are passed as the serviceKey query parameter (either the "encoding" or the "decoding" key of data.go.kr) and
// never logged (redactKeys).
import { classify } from '../../edge-functions/_shared/archive/classify.mjs'
import { termPattern } from './wikipedia.mjs'
import { HOUR } from './cache.mjs'
import { stripTags, redactKeys, validLat, validLng, uniq } from './util.mjs'

export const TOURAPI_BASE = 'https://apis.data.go.kr/B551011/KorService2'
export const PHOTO_BASE = 'https://apis.data.go.kr/B551011/PhotoGalleryService1'
// 공공누리 (Korea Open Government License) types of cpyrhtDivCd.
export const KOGL = {
  Type1: { license: 'KOGL Type 1', license_url: 'https://www.kogl.or.kr/info/licenseType1.do', no_derivatives: false },
  Type3: { license: 'KOGL Type 3', license_url: 'https://www.kogl.or.kr/info/licenseType3.do', no_derivatives: true },
}

/** The key as data.go.kr expects it once URL-encoded: an already percent-encoded key is decoded first. */
export function serviceKey(raw) {
  const k = String(raw || '').trim()
  if (!k) return null
  try { return /%[0-9A-Fa-f]{2}/.test(k) ? decodeURIComponent(k) : k } catch { return k }
}

export function tourUrl(op, params, { key, base = TOURAPI_BASE, app = 'LightArchitecture' }) {
  const p = new URLSearchParams({ serviceKey: serviceKey(key), MobileOS: 'ETC', MobileApp: app, _type: 'json', ...Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [k, String(v)])) })
  return `${base}/${op}?${p}`
}

/** The items of a data.go.kr JSON answer (an empty "items" is "", a single item may be an object). Throws on an error header. */
export function itemsOf(json) {
  const header = json?.response?.header
  if (!header) {
    // Gateway errors come without the response envelope (and sometimes as XML, which the client already refuses).
    const m = json?.resultMsg || json?.errMsg || json?.cmmMsgHeader?.returnAuthMsg || 'unexpected answer'
    throw Object.assign(new Error('tourapi: ' + String(m).slice(0, 200)), { code: 'tourapi_error' })
  }
  if (String(header.resultCode) !== '0000' && String(header.resultCode) !== '00') throw Object.assign(new Error(`tourapi: ${header.resultCode} ${String(header.resultMsg || '').slice(0, 200)}`), { code: 'tourapi_error' })
  const body = json.response.body || {}
  const raw = body.items && typeof body.items === 'object' ? body.items.item : null
  const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []
  return { items, total: Number(body.totalCount) || 0, page: Number(body.pageNo) || 1, rows: Number(body.numOfRows) || items.length }
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }
/** One searchKeyword2 / areaBasedList2 / detailCommon2 item → the fields the pipeline keeps. */
export function tourItem(it) {
  const lng = num(it.mapx), lat = num(it.mapy)
  const located = validLat(lat) && validLng(lng) && !(lat === 0 && lng === 0)
  return {
    contentid: String(it.contentid ?? ''),
    contenttypeid: String(it.contenttypeid ?? ''),
    title: stripTags(it.title || '') || null,
    addr1: stripTags(it.addr1 || '') || null,
    addr2: stripTags(it.addr2 || '') || null,
    lat: located ? lat : null,
    lng: located ? lng : null,
    areacode: it.areacode ? String(it.areacode) : null,
    sigungucode: it.sigungucode ? String(it.sigungucode) : null,
    ldong: it.lDongRegnCd ? String(it.lDongRegnCd) : null,
    ldong_signgu: it.lDongSignguCd ? String(it.lDongSignguCd) : null,
    firstimage: /^https?:\/\//.test(it.firstimage || '') ? String(it.firstimage) : null,
    firstimage2: /^https?:\/\//.test(it.firstimage2 || '') ? String(it.firstimage2) : null,
    cpyrhtDivCd: it.cpyrhtDivCd ? String(it.cpyrhtDivCd) : null,
    modified: it.modifiedtime ? String(it.modifiedtime) : null,
    overview: it.overview !== undefined ? stripTags(it.overview).slice(0, 4000) : undefined,
    homepage: homepageOf(it.homepage),
  }
}

/** TourAPI "homepage" is HTML ("<a href=\"https://…\">…</a>") or a bare URL. */
export function homepageOf(v) {
  if (!v) return null
  const s = String(v)
  const m = /href\s*=\s*["']?(https?:\/\/[^"'\s>]+)/i.exec(s) || /(https?:\/\/[^\s"'<>]+)/i.exec(s)
  if (!m) return null
  try { const u = new URL(m[1].replace(/&amp;/g, '&')); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null } catch { return null }
}

/** The licence of a TourAPI image from its cpyrhtDivCd; null when it is missing or unknown (never assumed). */
export function koglOf(code) {
  const k = String(code || '').trim().replace(/^type\s*/i, 'Type')
  return KOGL[k] ? { code: k, ...KOGL[k] } : null
}

const FESTIVAL_TYPES = new Set(['15'])
/**
 * The decision for one item and term: {accepted, reasons, project_type, needs_overview}.
 * @param {ReturnType<typeof tourItem>} item @param {string[]} terms @param {Record<string, {type?: string}>} termRules
 */
export function classifyTourItem(item, terms, termRules = {}) {
  const reasons = []
  const inTitle = terms.filter((t) => termPattern(t).test(item.title || ''))
  const inOverview = item.overview ? terms.filter((t) => termPattern(t).test(item.overview)) : []
  if (!inTitle.length && item.overview === undefined) return { accepted: false, needs_overview: true, reasons: ['term_not_in_title'], terms: [] }
  const found = uniq([...inTitle, ...inOverview])
  if (!found.length) return { accepted: false, needs_overview: false, reasons: ['term_not_in_title_or_overview'], terms: [] }
  reasons.push(...inTitle.map((t) => 'term_in_title:' + t), ...inOverview.filter((t) => !inTitle.includes(t)).map((t) => 'term_in_overview:' + t))
  const c = classify({ title: item.title, excerpt: item.overview || '', language: 'ko' })
  reasons.push(`classifier:${c.label}:${c.score}`)
  const types = uniq(found.map((t) => termRules[t]?.type).filter(Boolean))
  let type = FESTIVAL_TYPES.has(item.contenttypeid) ? 'festival_program' : types[0] || 'media_facade'
  const artType = ['media_architecture', 'light_art'].includes(type)
  const agrees = c.label === 'facade_project' || c.label === 'event_program' || (artType && c.label === 'uncertain' && c.score >= 35 && !c.reasons.some((r) => /^-\d+ /.test(r)))
  if (!agrees) { reasons.push('classifier_disagrees'); return { accepted: false, needs_overview: false, reasons, terms: found, classification: c } }
  if (c.label === 'event_program' && type === 'media_facade' && FESTIVAL_TYPES.has(item.contenttypeid)) type = 'festival_program'
  return { accepted: true, needs_overview: false, reasons, terms: found, project_type: type, classification: c }
}

/**
 * Keyword discovery over the configured terms and content types. Returns {items (every item seen, with its
 * decision), accepted, errors, partial, requests}.
 * @param {any} client @param {any} cfg pipeline.json "tourapi" @param {{key: string, cache: any, ttlHours?: number, termRules?: any}} o
 */
export async function discoverTourApi(client, cfg, { key, cache, ttlHours = 72, termRules = {} }) {
  const errors = [], seen = new Map()
  let partial = false, overviews = 0, requests = 0
  const ask = async (op, params, cacheKey, ttl = ttlHours) => {
    requests++
    const json = await client.json(tourUrl(op, params, { key, base: cfg.base || TOURAPI_BASE, app: cfg.mobile_app }), { stage: 'tourapi', cache: cache ? { ns: 'tourapi', key: cacheKey, ttlMs: ttl * HOUR } : null, redactUrl: redactKeys, timeoutMs: 20000 })
    return itemsOf(json)
  }
  const terms = cfg.terms || []
  outer: for (const term of terms) {
    for (const ct of Object.keys(cfg.content_types || { 12: 1, 14: 1, 15: 1 })) {
      for (let page = 1; page <= (cfg.max_pages ?? 2); page++) {
        let res
        try { res = await ask('searchKeyword2', { keyword: term, contentTypeId: ct, numOfRows: cfg.rows_per_page ?? 50, pageNo: page, arrange: 'A' }, `kw:${term}:${ct}:${page}`) } catch (e) {
          if (e?.code === 'budget') { partial = true; break outer }
          errors.push({ stage: 'tourapi_search', term, content_type: ct, message: redactKeys(String(e?.message || e)).slice(0, 300) })
          break
        }
        for (const raw of res.items) {
          const it = tourItem(raw)
          if (!it.contentid || !it.title) continue
          const prev = seen.get(it.contentid)
          if (prev) { prev.search_terms = uniq([...prev.search_terms, term]); continue }
          seen.set(it.contentid, { ...it, search_terms: [term] })
        }
        if (page * (res.rows || 1) >= res.total) break
      }
    }
  }
  // Decisions; the overview only for items whose title does not carry a term (capped per run, cached two weeks).
  const out = []
  for (const it of seen.values()) {
    let d = classifyTourItem(it, terms, termRules)
    // detailCommon2 (overview and homepage) for every item but those the title alone shows to be commercial: without
    // the term in its title the overview decides; with it, the classifier reads title and overview together; and the
    // homepage is the public source a published project needs.
    const commercial = ['ad_screen', 'product_vendor'].includes(d.classification?.label)
    if (!commercial && !partial) {
      const cached = cache?.fresh('tourapi', 'common:' + it.contentid) !== undefined
      if (cached || overviews < (cfg.overview_max_per_run ?? 120)) {
        try {
          if (!cached) overviews++
          const res = await ask('detailCommon2', { contentId: it.contentid }, 'common:' + it.contentid, 336)
          const full = res.items[0] ? tourItem(res.items[0]) : null
          if (full) { it.overview = full.overview ?? ''; it.homepage = full.homepage; d = classifyTourItem(it, terms, termRules) } else d = { ...d, reasons: [...d.reasons, 'no_detail'] }
        } catch (e) {
          if (e?.code === 'budget') partial = true
          else errors.push({ stage: 'tourapi_detail', contentid: it.contentid, message: redactKeys(String(e?.message || e)).slice(0, 300) })
          d = { ...d, reasons: [...d.reasons, 'overview_not_read'] }
        }
      } else d = { ...d, reasons: [...d.reasons, 'overview_cap_reached'] }
    }
    out.push({ ...it, overview: it.overview ? it.overview.slice(0, 300) : it.overview ?? null, decision: { accepted: !!d.accepted, reasons: d.reasons, terms: d.terms || [], project_type: d.project_type ?? null, classifier: d.classification ? { label: d.classification.label, score: d.classification.score } : null } })
  }
  out.sort((a, b) => (a.contentid < b.contentid ? -1 : 1))
  return { items: out, accepted: out.filter((x) => x.decision.accepted), errors, partial, overviews_read: overviews, requests }
}

/** Items named like a project (searchKeyword2 with the project's Korean name), for image identity and merges. */
export async function searchByName(client, cfg, name, { key, cache, ttlHours = 168 }) {
  const json = await client.json(tourUrl('searchKeyword2', { keyword: name, numOfRows: 20, pageNo: 1, arrange: 'A' }, { key, base: cfg.base || TOURAPI_BASE, app: cfg.mobile_app }), { stage: 'images', cache: cache ? { ns: 'tourapi', key: 'name:' + name, ttlMs: ttlHours * HOUR } : null, redactUrl: redactKeys, timeoutMs: 20000 })
  return itemsOf(json).items.map(tourItem).filter((x) => x.contentid && x.title)
}

/** detailImage2: every image of an item with its own cpyrhtDivCd. */
export async function detailImages(client, cfg, contentid, { key, cache, ttlHours = 336 }) {
  const json = await client.json(tourUrl('detailImage2', { contentId: contentid, imageYN: 'Y', numOfRows: 30, pageNo: 1 }, { key, base: cfg.base || TOURAPI_BASE, app: cfg.mobile_app }), { stage: 'images', cache: cache ? { ns: 'tourapi', key: 'images:' + contentid, ttlMs: ttlHours * HOUR } : null, redactUrl: redactKeys, timeoutMs: 20000 })
  return itemsOf(json).items.map((x) => ({
    contentid: String(x.contentid ?? contentid), serialnum: x.serialnum ? String(x.serialnum) : null, name: x.imgname ? stripTags(x.imgname) : null,
    original: /^https?:\/\//.test(x.originimgurl || '') ? String(x.originimgurl) : null, small: /^https?:\/\//.test(x.smallimageurl || '') ? String(x.smallimageurl) : null,
    cpyrhtDivCd: x.cpyrhtDivCd ? String(x.cpyrhtDivCd) : null,
  })).filter((x) => x.original)
}

/** PhotoGalleryService1 gallerySearchList1 for a keyword. */
export async function galleryPhotos(client, cfg, keyword, { key, cache, ttlHours = 336 }) {
  const json = await client.json(tourUrl('gallerySearchList1', { keyword, numOfRows: cfg.rows ?? 20, pageNo: 1, arrange: 'A' }, { key, base: cfg.base || PHOTO_BASE, app: cfg.mobile_app }), { stage: 'images', cache: cache ? { ns: 'kto-photo', key: 'kw:' + keyword, ttlMs: ttlHours * HOUR } : null, redactUrl: redactKeys, timeoutMs: 20000 })
  return itemsOf(json).items.map((x) => ({
    id: String(x.galContentId ?? ''), title: x.galTitle ? stripTags(x.galTitle) : null, url: /^https?:\/\//.test(x.galWebImageUrl || '') ? String(x.galWebImageUrl) : null,
    photographer: x.galPhotographer ? stripTags(x.galPhotographer) : null, location: x.galPhotographyLocation ? stripTags(x.galPhotographyLocation) : null,
    month: x.galPhotographyMonth ? String(x.galPhotographyMonth) : null, keywords: x.galSearchKeyword ? String(x.galSearchKeyword).split(/[,\s]+/).filter(Boolean).slice(0, 30) : [],
    // Per-photo copyright, under whichever name the answer uses (none is documented for this service).
    copyright: x.cpyrhtDivCd ? String(x.cpyrhtDivCd) : x.galCopyright ? String(x.galCopyright) : x.copyright ? String(x.copyright) : null,
  })).filter((x) => x.id && x.url)
}

/** A TourAPI item → an observation of the pipeline (origin "tourapi"). */
export function tourObservation(t) {
  const sources = []
  if (t.homepage) sources.push({ id: 'official', kind: 'official', title: (() => { try { return new URL(t.homepage).hostname.replace(/^www\./, '') } catch { return null } })(), url: t.homepage, publisher: null })
  return {
    origin: 'tourapi', korea: true, tourapi_id: t.contentid, qid: null, category: null,
    name: { ko: t.title, en: null, original: t.title, original_lang: 'ko' },
    country_iso2: 'KR', address: [t.addr1, t.addr2].filter(Boolean).join(' ') || null, lat: t.lat, lng: t.lng,
    official_url: t.homepage || null, project_type: t.decision?.project_type || null,
    tourapi: { contentid: t.contentid, contenttypeid: t.contenttypeid, addr1: t.addr1, addr2: t.addr2, areacode: t.areacode, ldong: t.ldong, firstimage: t.firstimage, cpyrhtDivCd: t.cpyrhtDivCd },
    sources, evidence: [{ kind: 'tourapi', contentid: t.contentid, terms: t.decision?.terms || [], reasons: t.decision?.reasons || [] }],
  }
}
