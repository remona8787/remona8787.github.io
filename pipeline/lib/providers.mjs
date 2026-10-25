// Image providers beyond Wikimedia Commons (docs/STATIC_ARCHIVE.md v0.18 "Providers"). Each adapter turns a provider's
// API answer into candidates of one shape:
//   {provider, source_id, src, page, sizes: [[width, url]…], width, height, bytes, format, measure_url, author,
//    rights_holder, license, license_url, usage, no_derivatives, title, tags, description, geo, location,
//    provider_place_ids, rights: {ok, reasons}}
// Licences are read from the API, never assumed: Openverse and Flickr keep only CC0, the Public Domain Mark, CC BY and
// CC BY-SA; TourAPI images need cpyrhtDivCd Type1 or Type3 (Type3: no changes, shown as is); the photo gallery needs a
// copyright field; Unsplash and Pexels images are shown from their own URLs only (hotlink), as their API terms require,
// with the photographer and the provider named. NAVER image results are discovery only: candidates for review, never
// a public image. Keys come from the environment only and never reach a log (redactKeys).
import { HOUR } from './cache.mjs'
import { stripTags, redactKeys, validLat, validLng, uniq } from './util.mjs'
import { koglOf, itemsOf, tourUrl, serviceKey } from './tourapi.mjs'

export const PROVIDERS = ['commons', 'openverse', 'flickr', 'tourapi', 'kto_photo', 'unsplash', 'pexels', 'official', 'editor']
export const PROVIDER_NAMES = { commons: 'Wikimedia Commons', openverse: 'Openverse', flickr: 'Flickr', tourapi: '한국관광공사 TourAPI', kto_photo: '한국관광공사 관광사진', unsplash: 'Unsplash', pexels: 'Pexels', official: 'official site', editor: 'editor' }
const https = (u) => { try { const x = new URL(String(u || '')); return x.protocol === 'https:' ? x.href : x.protocol === 'http:' ? x.href.replace(/^http:/, 'https:') : null } catch { return null } }
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : null }
const bySize = (sizes, width) => uniq(sizes.filter(([w, u]) => w && u && (!width || w <= width)).sort((a, b) => a[0] - b[0]).map((s) => JSON.stringify(s))).map((s) => JSON.parse(s)).filter((s, i, a) => !a.slice(i + 1).some((t) => t[0] === s[0]))

// ---------------------------------------------------------------- licences

/** An open licence from a Creative Commons URL or code; null unless CC0, the Public Domain Mark, CC BY or CC BY-SA. */
export function openLicense({ code = null, version = null, url = null } = {}) {
  const u = String(url || '').toLowerCase()
  let m
  if (/publicdomain\/zero\//.test(u) || code === 'cc0') return { license: 'CC0 1.0', license_url: 'https://creativecommons.org/publicdomain/zero/1.0/' }
  if (/publicdomain\/mark\//.test(u) || code === 'pdm') return { license: 'Public Domain Mark 1.0', license_url: 'https://creativecommons.org/publicdomain/mark/1.0/' }
  if ((m = /creativecommons\.org\/licenses\/(by|by-sa)\/(\d\.\d)/.exec(u))) return { license: `CC ${m[1].toUpperCase()} ${m[2]}`, license_url: `https://creativecommons.org/licenses/${m[1]}/${m[2]}/` }
  if ((code === 'by' || code === 'by-sa') && /^\d\.\d$/.test(String(version || ''))) return { license: `CC ${code.toUpperCase()} ${version}`, license_url: `https://creativecommons.org/licenses/${code}/${version}/` }
  return null
}

// ---------------------------------------------------------------- Openverse (no key; optional OAuth client)

export const OPENVERSE_API = 'https://api.openverse.org/v1'
let openverseToken = null
/** An OAuth token for Openverse when OPENVERSE_CLIENT_ID and OPENVERSE_CLIENT_SECRET are set (raises the rate limit). */
export async function openverseAuth(client, env) {
  if (!env.OPENVERSE_CLIENT_ID || !env.OPENVERSE_CLIENT_SECRET) return null
  if (openverseToken && openverseToken.until > client.clock()) return openverseToken.token
  const body = new URLSearchParams({ client_id: env.OPENVERSE_CLIENT_ID, client_secret: env.OPENVERSE_CLIENT_SECRET, grant_type: 'client_credentials' }).toString()
  const json = await client.json(`${OPENVERSE_API}/auth_tokens/token/`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' }, stage: 'images', retries: 0 })
  if (!json?.access_token) return null
  openverseToken = { token: json.access_token, until: client.clock() + Math.max(60, Number(json.expires_in) || 3600) * 1000 - 60e3 }
  return openverseToken.token
}

export function openverseUrl(q, { pageSize = 20 } = {}) {
  return `${OPENVERSE_API}/images/?${new URLSearchParams({ q, license: 'cc0,pdm,by,by-sa', page_size: String(pageSize), mature: 'false' })}`
}

/** One Openverse result → a candidate (Wikimedia results are skipped: Commons is read directly). */
export function openverseCandidate(r) {
  if (!r?.id || !r.url) return null
  const lic = openLicense({ code: r.license, version: r.license_version, url: r.license_url })
  const src = https(r.url), page = https(r.foreign_landing_url)
  const width = num(r.width), height = num(r.height)
  const flickr = /(^|\.)staticflickr\.com$/.test((() => { try { return new URL(src).hostname } catch { return '' } })())
  const reasons = []
  if (!lic) reasons.push('license_not_allowed:' + (r.license || 'none'))
  if (!src || !page) reasons.push('no_https_url')
  if (!r.creator) reasons.push('no_creator')
  return {
    provider: 'openverse', source_id: String(r.id), via: r.provider || r.source || null, src, page,
    sizes: src && width ? [[width, src]] : [], width, height, bytes: num(r.filesize), format: r.filetype || null,
    measure_url: src, author: r.creator ? stripTags(r.creator) : null, author_url: https(r.creator_url), rights_holder: r.creator ? stripTags(r.creator) : null,
    license: lic?.license ?? null, license_url: lic?.license_url ?? null, usage: flickr ? 'hotlink' : 'cache', no_derivatives: false,
    title: r.title ? stripTags(r.title) : null, tags: (r.tags || []).map((t) => t?.name).filter(Boolean).slice(0, 40), description: null, geo: null, location: null,
    rights: { ok: reasons.length === 0, reasons },
  }
}

/** Openverse search (anonymous unless keyed). The answer's rate-limit headers are kept: available 0 stops the run's searches. */
export async function openverseSearch(client, q, { cache, env = {}, ttlHours = 336, limits = null } = {}) {
  const token = await openverseAuth(client, env).catch(() => null)
  const json = await client.json(openverseUrl(q), {
    stage: 'images', retries: 1, cache: cache ? { ns: 'openverse', key: q, ttlMs: ttlHours * HOUR } : null,
    headers: token ? { authorization: 'Bearer ' + token } : {},
    onHeaders: (h) => { if (!limits) return; for (const [k, v] of h) if (/^x-ratelimit-available-/i.test(k)) limits[k.toLowerCase()] = Number(v) },
  })
  return (json?.results || []).filter((r) => !/wikimedia/i.test(String(r.provider || r.source || ''))).map(openverseCandidate).filter(Boolean)
}

// ---------------------------------------------------------------- Flickr (FLICKR_API_KEY)

export const FLICKR_API = 'https://api.flickr.com/services/rest/'
const FLICKR_SIZES = [['z', 640], ['c', 800], ['l', 1024], ['h', 1600], ['k', 2048], ['3k', 3072], ['4k', 4096], ['o', null]]
const flickrUrl = (method, params, key) => `${FLICKR_API}?${new URLSearchParams({ method, api_key: key, format: 'json', nojsoncallback: '1', ...params })}`

/** The allowed licence ids of Flickr from the live flickr.photos.licenses.getInfo answer (never a fixed id list). */
export async function flickrLicenses(client, key, { cache, ttlHours = 720 } = {}) {
  const json = await client.json(flickrUrl('flickr.photos.licenses.getInfo', {}, key), { stage: 'images', redactUrl: redactKeys, cache: cache ? { ns: 'flickr', key: 'licenses', ttlMs: ttlHours * HOUR } : null })
  if (json?.stat !== 'ok') throw new Error('flickr: ' + String(json?.message || 'licenses unavailable').slice(0, 200))
  const out = new Map()
  for (const l of json.licenses?.license || []) { const lic = openLicense({ url: l.url }); if (lic) out.set(String(l.id), { ...lic, name: l.name }) }
  return out
}

/** A bounding box of about ±radius metres around a point (minimum_longitude,minimum_latitude,maximum_longitude,maximum_latitude). */
export function bboxAround(lat, lng, radiusM = 1000) {
  const dLat = radiusM / 111320, dLng = radiusM / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)))
  const r = (v) => Math.round(v * 1e5) / 1e5
  return [r(lng - dLng), r(lat - dLat), r(lng + dLng), r(lat + dLat)].join(',')
}

export function flickrCandidate(ph, licenses) {
  if (!ph?.id) return null
  const lic = licenses.get(String(ph.license)) || null
  const sizes = []
  for (const [s, nominal] of FLICKR_SIZES) {
    const url = https(ph['url_' + s]), w = num(ph['width_' + s])
    if (url && (w || nominal)) sizes.push([w || nominal, url])
  }
  const original = num(ph.width_o) ? [num(ph.width_o), num(ph.height_o)] : null
  const largest = sizes.reduce((a, b) => (b[0] > (a?.[0] || 0) ? b : a), null)
  const width = original?.[0] ?? largest?.[0] ?? null
  const height = original?.[1] ?? (largest ? num(ph['height_' + FLICKR_SIZES.find(([s]) => https(ph['url_' + s]) === largest[1])?.[0]]) : null)
  const lat = Number(ph.latitude), lng = Number(ph.longitude)
  const reasons = []
  if (!lic) reasons.push('license_not_allowed:' + ph.license)
  if (!sizes.length) reasons.push('no_sizes')
  const measure = sizes.filter(([w]) => w >= 960).sort((a, b) => a[0] - b[0])[0] || largest
  return {
    provider: 'flickr', source_id: String(ph.id), src: (original && https(ph.url_o)) || largest?.[1] || null, page: `https://www.flickr.com/photos/${encodeURIComponent(ph.owner)}/${encodeURIComponent(ph.id)}/`,
    sizes: bySize(sizes, width), width, height, bytes: null, format: ph.originalformat || 'jpg', measure_url: measure?.[1] || null, original_known: !!original,
    author: ph.ownername ? stripTags(ph.ownername) : null, author_url: `https://www.flickr.com/people/${encodeURIComponent(ph.owner)}/`, rights_holder: ph.ownername ? stripTags(ph.ownername) : null,
    license: lic?.license ?? null, license_url: lic?.license_url ?? null, usage: 'hotlink', no_derivatives: false,
    title: ph.title ? stripTags(ph.title) : null, tags: String(ph.tags || '').split(/\s+/).filter(Boolean).slice(0, 40), description: ph.description?._content ? stripTags(ph.description._content).slice(0, 600) : null,
    geo: validLat(lat) && validLng(lng) && !(lat === 0 && lng === 0) ? { lat, lng } : null, location: null,
    rights: { ok: reasons.length === 0, reasons },
  }
}

/** Flickr search: text, a bounding box around the project when it has coordinates, the allowed licences, every size. */
export async function flickrSearch(client, { text, lat = null, lng = null, radiusM = 1000 }, { key, cache, ttlHours = 336, licenses }) {
  const params = { text, license: [...licenses.keys()].join(','), extras: 'url_z,url_c,url_l,url_h,url_k,url_3k,url_4k,url_o,o_dims,owner_name,license,geo,tags,description,date_taken,original_format', content_type: '1', media: 'photos', sort: 'relevance', per_page: '30', safe_search: '1' }
  if (validLat(lat) && validLng(lng)) params.bbox = bboxAround(lat, lng, radiusM)
  const json = await client.json(flickrUrl('flickr.photos.search', params, key), { stage: 'images', redactUrl: redactKeys, cache: cache ? { ns: 'flickr', key: `search:${text}:${params.bbox || ''}`, ttlMs: ttlHours * HOUR } : null })
  if (json?.stat !== 'ok') throw new Error('flickr: ' + String(json?.message || 'search failed').slice(0, 200))
  return (json.photos?.photo || []).map((ph) => flickrCandidate(ph, licenses)).filter(Boolean)
}

// ---------------------------------------------------------------- Unsplash and Pexels (hotlink only)

export const UNSPLASH_REFERRAL = 'utm_source=light_architecture&utm_medium=referral'
export function unsplashCandidate(r) {
  if (!r?.id || !r.urls?.raw) return null
  const width = num(r.width), height = num(r.height)
  const raw = https(r.urls.raw)
  const sizes = [640, 1280, 1920, 2560, 3840].filter((w) => !width || w <= width).map((w) => [w, `${raw}${raw.includes('?') ? '&' : '?'}w=${w}&fit=max&fm=jpg&q=80`])
  // Unsplash's API guidelines ask for the referral parameters on links back to Unsplash (the only stored links with them).
  const withRef = (u) => (u ? `${u}${u.includes('?') ? '&' : '?'}${UNSPLASH_REFERRAL}` : null)
  return {
    provider: 'unsplash', source_id: String(r.id), src: https(r.urls.full) || raw, page: withRef(https(r.links?.html)), sizes, width, height, bytes: null, format: 'jpeg',
    measure_url: sizes.find(([w]) => w >= 960)?.[1] || https(r.urls.regular), download_location: https(r.links?.download_location),
    author: r.user?.name ? stripTags(r.user.name) : null, author_url: withRef(https(r.user?.links?.html)), rights_holder: r.user?.name || null,
    license: 'Unsplash License', license_url: 'https://unsplash.com/license', usage: 'hotlink', no_derivatives: false,
    title: stripTags(r.description || r.alt_description || '') || null, tags: (r.tags || []).map((t) => t?.title).filter(Boolean), description: r.alt_description ? stripTags(r.alt_description) : null,
    geo: null, location: [r.location?.name, r.location?.city, r.location?.country].filter(Boolean).join(', ') || null,
    rights: { ok: !!r.user?.name, reasons: r.user?.name ? [] : ['no_creator'] },
  }
}
export async function unsplashSearch(client, q, { key, cache, ttlHours = 336 }) {
  const json = await client.json(`https://api.unsplash.com/search/photos?${new URLSearchParams({ query: q, per_page: '10', content_filter: 'high' })}`, { stage: 'images', headers: { authorization: 'Client-ID ' + key, 'accept-version': 'v1' }, cache: cache ? { ns: 'unsplash', key: q, ttlMs: ttlHours * HOUR } : null })
  return (json?.results || []).map(unsplashCandidate).filter(Boolean)
}

export function pexelsCandidate(r) {
  if (!r?.id || !r.src?.original) return null
  const width = num(r.width), height = num(r.height)
  const orig = https(r.src.original)
  const sizes = [640, 1280, 1920, 2560, 3840].filter((w) => !width || w <= width).map((w) => [w, `${orig}?auto=compress&cs=tinysrgb&w=${w}`])
  return {
    provider: 'pexels', source_id: String(r.id), src: orig, page: https(r.url), sizes, width, height, bytes: null, format: 'jpeg', measure_url: sizes.find(([w]) => w >= 960)?.[1] || https(r.src.large),
    author: r.photographer ? stripTags(r.photographer) : null, author_url: https(r.photographer_url), rights_holder: r.photographer || null,
    license: 'Pexels License', license_url: 'https://www.pexels.com/license/', usage: 'hotlink', no_derivatives: false,
    title: r.alt ? stripTags(r.alt) : null, tags: [], description: null, geo: null, location: null,
    rights: { ok: !!r.photographer, reasons: r.photographer ? [] : ['no_creator'] },
  }
}
export async function pexelsSearch(client, q, { key, cache, ttlHours = 336 }) {
  const json = await client.json(`https://api.pexels.com/v1/search?${new URLSearchParams({ query: q, per_page: '15' })}`, { stage: 'images', headers: { authorization: key }, cache: cache ? { ns: 'pexels', key: q, ttlMs: ttlHours * HOUR } : null })
  return (json?.photos || []).map(pexelsCandidate).filter(Boolean)
}

// ---------------------------------------------------------------- NAVER image search (discovery only)

/** NAVER image search (API HUB keys, or the legacy developer keys until 2027-06-30): candidates for review only. */
export async function naverImageSearch(client, q, { keyId, key, mode = 'hub', cache, ttlHours = 336 }) {
  const params = new URLSearchParams({ query: q, display: '20', sort: 'sim', filter: 'large' })
  const req = mode === 'legacy'
    ? { url: `https://openapi.naver.com/v1/search/image.json?${params}`, headers: { 'X-Naver-Client-Id': keyId, 'X-Naver-Client-Secret': key } }
    : { url: `https://naverapihub.apigw.ntruss.com/search/v1/image?${params}`, headers: { 'X-NCP-APIGW-API-KEY-ID': keyId, 'X-NCP-APIGW-API-KEY': key } }
  const json = await client.json(req.url, { stage: 'images', headers: req.headers, cache: cache ? { ns: 'naver-image', key: q, ttlMs: ttlHours * HOUR } : null })
  return (json?.items || []).map((it) => ({ title: stripTags(it.title || ''), link: https(it.link), thumbnail: https(it.thumbnail), width: num(it.sizewidth), height: num(it.sizeheight) })).filter((x) => x.link)
}

// ---------------------------------------------------------------- TourAPI images and the photo gallery

export const TOURAPI_PAGE = 'https://www.data.go.kr/data/15101578/openapi.do'
export const PHOTO_PAGE = 'https://phoko.visitkorea.or.kr/'

/** A TourAPI image (detailImage2 or an item's firstimage) → a candidate; its licence only from its own cpyrhtDivCd. */
export function tourapiCandidate(img, item) {
  const kogl = koglOf(img.cpyrhtDivCd)
  const reasons = kogl ? [] : ['license_unknown:' + (img.cpyrhtDivCd || 'none')]
  return {
    provider: 'tourapi', source_id: `${item.contentid}:${img.serialnum || img.original}`, src: https(img.original), page: TOURAPI_PAGE, sizes: [], width: null, height: null, bytes: null, format: null,
    measure_url: https(img.original), author: '한국관광공사', author_url: null, rights_holder: '한국관광공사',
    license: kogl?.license ?? null, license_url: kogl?.license_url ?? null, usage: 'cache', no_derivatives: !!kogl?.no_derivatives,
    title: img.name || item.title, tags: [item.title].filter(Boolean), description: null, geo: validLat(item.lat) && validLng(item.lng) ? { lat: item.lat, lng: item.lng } : null, location: item.addr1 || null,
    provider_place_ids: [item.contentid], rights: { ok: !!kogl && !!https(img.original), reasons },
  }
}

/** A photo of the tourism photo gallery → a candidate (its licence from the answer's copyright field, else none). */
export function ktoPhotoCandidate(ph, { defaultLicense = null } = {}) {
  const kogl = koglOf(ph.copyright) || (defaultLicense ? koglOf(defaultLicense) : null)
  return {
    provider: 'kto_photo', source_id: ph.id, src: https(ph.url), page: PHOTO_PAGE, sizes: [], width: null, height: null, bytes: null, format: null,
    measure_url: https(ph.url), author: ph.photographer || '한국관광공사', author_url: null, rights_holder: '한국관광공사',
    license: kogl?.license ?? null, license_url: kogl?.license_url ?? null, usage: 'hotlink', no_derivatives: !!kogl?.no_derivatives, license_basis: kogl ? (ph.copyright ? 'answer' : 'config_default') : null,
    title: ph.title, tags: ph.keywords || [], description: null, geo: null, location: ph.location, month: ph.month,
    rights: { ok: !!kogl, reasons: kogl ? [] : ['license_unknown:no_copyright_field'] },
  }
}

// ---------------------------------------------------------------- editorial images (set_image)

/** An image an editor set from an official site or their own source: the licence or the permission note is the basis. */
export function editorialCandidate(d) {
  const lic = d.license ? (openLicense({ url: d.license_url || '' }) || { license: d.license, license_url: https(d.license_url) }) : null
  return {
    provider: d.provider === 'editor' ? 'editor' : 'official', source_id: d.src, src: https(d.src), page: https(d.page), sizes: d.width ? [[d.width, https(d.src)]] : [], width: num(d.width), height: num(d.height), bytes: null, format: null,
    measure_url: https(d.src), author: d.author || null, author_url: null, rights_holder: d.rights_holder || d.author || null,
    license: lic?.license ?? (d.permission_note ? 'Used with permission' : null), license_url: lic?.license_url ?? null, permission_note: d.permission_note || null,
    usage: lic && openLicense({ url: lic.license_url || '' }) ? 'cache' : 'hotlink', no_derivatives: !!d.no_derivatives,
    title: d.note || null, tags: [], description: null, geo: null, location: null, editorial: true,
    rights: { ok: !!(https(d.src) && https(d.page) && d.author && (lic || d.permission_note)), reasons: [] },
  }
}

export { serviceKey, tourUrl, itemsOf }
