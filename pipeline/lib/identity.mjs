// Identity proof of an image from a provider other than Commons (docs/STATIC_ARCHIVE.md v0.18 "Image rules"): the
// image must show the same building, installation or work. It is proven by, in this order:
//   1. provider_id: the provider's place or item id is the project's (a TourAPI contentid that belongs to the project);
//   2. geotag_name: the photo's geotag lies within 300 m of the project and its title, tags or description name it;
//   3. name_location: the exact project name is in the title or tags, and a location of the project (city, district,
//      region, or a geotag within 5 km) is named or near;
//   4. editorial: an editor set the image (set_image) or approved it (approve_image).
// Anything else is not used (reason identity_unproven). The evidence is recorded on the image. Hero and featured use
// additionally need an approval after a look at the contact sheets (lib/images.mjs), whatever the proof.
import { fold, haversine, validLat, validLng, uniq } from './util.mjs'

export const IDENTITY_RADIUS_M = 300
export const LOCATION_RADIUS_M = 5000

const norm = (s) => fold(String(s || '')).replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
const compact = (s) => norm(s).replace(/ /g, '')
// Words that make a name generic on their own (a project called "Seoul Light" is not just "Seoul").
const GENERIC = new Set(['the', 'of', 'in', 'at', 'and', 'light', 'lights', 'festival', 'media', 'facade', 'art', 'tower', 'building', 'museum', 'show', 'night', 'seoul', 'korea', 'busan'])

/**
 * The names an image text must contain to be about the project: its Korean, English and original names, without a
 * trailing type word of the archive ("롯데월드타워 미디어파사드" → also "롯데월드타워"), at least 3 characters (Hangul) or
 * two meaningful words (Latin).
 */
export function projectNames(p) {
  const out = []
  for (const raw of [p.name_ko, p.name_en, p.name_original, p.building_name, ...(p.aliases || [])]) {
    if (!raw) continue
    for (const base of String(raw).replace(/\([^)]*\)/g, ' ').split(/\s*[/·|]\s*/).filter(Boolean))
    for (const v of [base, base.replace(/\s*(미디어\s*파사드|미디어월|미디어\s*아트|media\s*fa[cç]ade|media\s*wall|light\s*show|야경|조명)\s*$/i, '')]) {
      const n = norm(v)
      if (!n) continue
      const hangul = /\p{Script=Hangul}/u.test(n)
      const words = n.split(' ').filter((w) => !GENERIC.has(w))
      if (hangul ? compact(n).length >= 3 : words.length >= 1 && n.length >= 6) out.push(n)
    }
  }
  return uniq(out)
}

/**
 * The names that make an institution's file (entities.mjs item_institution) a photo of the project: the project's own
 * names, never its host building's. A curated place whose item is the place itself (N Seoul Tower, Starfield Library,
 * Leeum) also goes by its item's names; a work in a host building (the NMK Immersive Digital Gallery in the National
 * Museum of Korea, the Lotte World Tower media facade) keeps only what is not the building's name ("롯데월드타워" is
 * the core of "롯데월드타워 미디어파사드" and is dropped).
 */
export function workNames(p) {
  const own = projectNames({ name_ko: p.name_ko, name_en: p.name_en, name_original: p.name_original, aliases: p.aliases })
  if (p.qid_match === 'host') {
    const inst = [...(p.item_names || []), p.building_name].filter(Boolean).map(compact).filter((m) => m.length >= 3)
    return own.filter((n) => !inst.some((m) => m.includes(compact(n))))
  }
  if (p.item_institution) return uniq([...own, ...projectNames({ aliases: p.item_names || [] }), ...phrases(p.item_names || [])])
  return own
}
/** Whole names as phrases ("Seoul Museum of Art"): two words or more, or one distinctive word, or Hangul of 3+. */
function phrases(list) {
  const out = []
  for (const raw of list) {
    for (const base of String(raw || '').replace(/\([^)]*\)/g, ' ').split(/\s*[/·|,]\s*/).filter(Boolean)) {
      const n = norm(base)
      if (!n) continue
      const words = n.split(' ')
      if (/\p{Script=Hangul}/u.test(n) ? compact(n).length >= 3 : (words.length >= 2 && n.length >= 8) || (words.length === 1 && n.length >= 5 && !GENERIC.has(n))) out.push(n)
    }
  }
  return out
}

/**
 * The names a provider search uses: the first core name per script, in the order of the project's names (Korean, then
 * English, then the original) and of their parts ("동대문디자인플라자(DDP) / 서울라이트" → 동대문디자인플라자), with the
 * archive's type words removed ("Lotte World Tower Media Facade" → lotte world tower).
 */
export function queryNames(p) {
  const all = projectNames(p)
  const hangul = (n) => /\p{Script=Hangul}/u.test(n)
  const cjk = (n) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(n)
  // projectNames lists, per part, the part and then its core: a core is the shorter one that the part starts with.
  const core = (list) => { const first = list[0]; if (!first) return null; const shorter = list.find((n) => n !== first && first.startsWith(n)); return shorter || first }
  return { ko: core(all.filter(hangul)), en: core(all.filter((n) => !hangul(n) && !cjk(n))), other: core(all.filter(cjk)) }
}

/** The first project name found in a text (Hangul ignores spacing; Latin needs whole words). */
export function nameIn(text, names) {
  const t = norm(text), tc = compact(text)
  for (const n of names) {
    if (/\p{Script=Hangul}/u.test(n)) { if (tc.includes(n.replace(/ /g, ''))) return n } else if ((' ' + t + ' ').includes(' ' + n + ' ')) return n
  }
  return null
}

/** Location words of a project: city, district, Korean region and country names in Korean and English. */
export function locationWords(p, { regionNames = {} } = {}) {
  const words = [p.city, p.city_ko, p.district, ...(regionNames[p.kr_region] || [])]
  if (p.address) words.push(...String(p.address).split(/\s+/).slice(0, 2))
  return uniq(words.map(norm).filter((w) => w && w.length >= 2))
}

/**
 * The identity proof of one candidate for one project, or why there is none.
 * @param {{provider: string, provider_place_ids?: string[], geo?: {lat: number, lng: number}|null, title?: string, tags?: string[], description?: string, location?: string, editorial?: boolean}} c
 * @param {any} p project (names, lat/lng as latitude/longitude, city, tourapi ids)
 */
export function identityOf(c, p, { placeIds = [], regionNames = {} } = {}) {
  if (c.provider === 'commons') return { ok: true, method: 'commons_category_or_item' }
  if (c.editorial) return { ok: true, method: 'editorial' }
  const ids = new Set(placeIds.map(String))
  const pid = (c.provider_place_ids || []).map(String).find((x) => ids.has(x))
  if (pid) return { ok: true, method: 'provider_id', provider_place_id: pid }
  const names = projectNames(p)
  const titleTags = [c.title, ...(c.tags || [])].filter(Boolean).join(' · ')
  const all = [titleTags, c.description].filter(Boolean).join(' · ')
  const located = validLat(p.latitude) && validLng(p.longitude) && c.geo && validLat(c.geo.lat) && validLng(c.geo.lng)
  const distance = located ? Math.round(haversine({ lat: p.latitude, lng: p.longitude }, c.geo)) : null
  const anyName = nameIn(all, names)
  if (distance !== null && distance <= IDENTITY_RADIUS_M && anyName) return { ok: true, method: 'geotag_name', distance_m: distance, matched_name: anyName }
  const exact = nameIn(titleTags, names)
  if (exact) {
    if (distance !== null && distance <= LOCATION_RADIUS_M) return { ok: true, method: 'name_location', matched_name: exact, distance_m: distance }
    const where = nameIn([all, c.location].filter(Boolean).join(' · '), locationWords(p, { regionNames }))
    if (where) return { ok: true, method: 'name_location', matched_name: exact, matched_location: where }
  }
  const reasons = []
  if (!anyName) reasons.push('name_not_found')
  else if (!exact) reasons.push('name_only_in_description')
  if (distance !== null && distance > IDENTITY_RADIUS_M) reasons.push(`geotag_${distance}_m_away`)
  if (distance === null) reasons.push(c.geo ? 'project_not_located' : 'no_geotag')
  if (exact) reasons.push('location_not_named')
  return { ok: false, reasons }
}
