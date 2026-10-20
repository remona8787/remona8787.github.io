// Images per project (docs/STATIC_ARCHIVE.md "Images (per-surface rules)").
// Candidates: the item's P18, the project's Commons category, its night/illuminated/event subcategories and the
// categories found as parts or editions of it. Each candidate is
//  - rights-checked with live-media.mjs assessRights (licence allowlist, deletion and permission templates, NoFoP of
//    other countries, the Korean FoP policy) and attributed like live-media.mjs toMediaRow;
//  - scored: night (keywords in many languages, the "at night" subcategory), media (media/light keywords, the
//    work's own category for light works), visual (visual.mjs on a 320 px thumbnail), relevance (own entity, not a
//    map/plan/logo/diagram/portrait/signature, not an unrelated interior, usable size and format);
//  - given a tier: 1 media active at night, 2 media art content, 3 LED/projection/lighting characteristics,
//    4 an architectural image of the project. No image → the UI draws its designed placeholder.
// Surfaces: a home image must show active media in a dark frame (never a daytime photo, never darkness alone); a
// hero additionally needs night and media evidence, a high visual score, a large original and an entry in the
// visually reviewed allowlist (editorial/hero.json or a set_hero decision).
import { assessRights, toMediaRow, DEFAULT_POLICY } from '../../edge-functions/_shared/live-media.mjs'
import { fold } from './util.mjs'

const T = (weight, ...terms) => terms.map((t) => [t, weight])
// Night and illumination words (folded matching; CJK as substrings).
export const NIGHT_TERMS = [
  ...T(40, 'at night', 'by night', 'night view', 'night shot', 'nighttime', 'night time', 'de nuit', 'la nuit', 'bei nacht', 'nachtaufnahme', 'di notte', 'notturno', 'notturna', 'de noche', 'nocturna', 'nocturno', 's nachts', 'nachtfoto', 'noca', 'w nocy', 'nocą', 'ночью', 'ночной', 'gece', 'geceleyin', 'ليلا', 'في الليل', '야경', '야간', '夜景', '夜間', '夜间', '夜の', 'ライトアップ'),
  ...T(30, 'night', 'nacht', 'nuit', 'notte', 'noche', 'noc', 'ночь', 'evening', 'dusk', 'blue hour', 'twilight', 'abend', 'soir', 'sera', 'crepuscule'),
  ...T(30, 'illuminated', 'illumination', 'illuminations', 'lit up', 'light up', 'lights on', 'beleuchtet', 'beleuchtung', 'illumine', 'illuminee', 'illuminato', 'illuminata', 'iluminado', 'iluminada', 'iluminacion', 'iluminacao', 'verlicht', 'verlichting', 'iluminacja', 'oswietlon', 'подсветка', 'освещ', 'aydinlatma', 'إضاءة', '조명', '点灯', '灯光', '燈光', '亮灯', '亮燈'),
  // Shows that only happen after dark: projections, light shows and light festivals (by name), as the spec counts them.
  ...T(30, 'projection mapping', 'video mapping', 'videomapping', 'projection', 'projections', 'projektion', 'proyeccion', 'proiezione', 'projecao', 'mapping', 'light show', 'laser show', 'light festival', 'festival of lights', 'festival of light', 'lichtfestival', 'fete des lumieres', 'lumiere', 'vivid sydney', 'luminale', 'glow eindhoven', 'ilight', 'nuit blanche', 'son et lumiere', 'lichtspiele', 'luminarie', 'signal festival', 'amsterdam light festival', 'lichterfest', '빛축제', '빛 축제', '光の祭典', '灯光节', '灯光秀', 'プロジェクションマッピング', '프로젝션 매핑'),
]
export const MEDIA_TERMS = [
  ...T(50, 'media facade', 'media facades', 'mediafacade', 'medienfassade', 'facade media', 'facade mediatique', 'fachada multimedia', 'facciata mediatica', 'mediagevel', 'медиафасад', 'medya cephe', '미디어파사드', '미디어 파사드', 'メディアファサード', '媒体立面', '媒体幕墙', '媒體立面'),
  ...T(45, 'projection mapping', 'video mapping', 'videomapping', 'mapping video', '3d mapping', 'projektionsmapping', 'mapping show', 'проекционн', 'видеомэппинг', '프로젝션 매핑', '프로젝션매핑', '미디어아트', 'プロジェクションマッピング', '投影秀', '灯光秀', '光影秀'),
  ...T(40, 'light art', 'light installation', 'light sculpture', 'lichtkunst', 'lichtinstallation', 'art lumineux', 'installation lumineuse', 'arte luminica', 'instalacion luminica', 'light artwork', 'laser show', 'son et lumiere', 'sound and light', 'light show', 'lichtspiele', 'media art', 'new media art', 'digital art', 'interactive art'),
  ...T(30, 'led', 'leds', 'led facade', 'led wall', 'led screen', 'video wall', 'media wall', 'projection', 'projections', 'projektion', 'projecao', 'proyeccion', 'proiezione', 'mapping', 'pixels', 'laser', 'neon', 'installation', 'festival', 'show', 'luminale', 'glow', 'vivid', 'ilight'),
]

function compileTerms(list) {
  return list.map(([t, w]) => {
    const f = fold(t)
    const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Cyrillic}]/u.test(f)
    return { term: t, weight: w, re: cjk ? null : new RegExp('(^| )' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)'), sub: cjk ? f : null }
  })
}
const NIGHT = compileTerms(NIGHT_TERMS)
const MEDIA = compileTerms(MEDIA_TERMS)

/** Keyword score (0..100) of a text: the best two distinct matches add up, with the terms that matched. */
export function keywordScore(text, compiled) {
  const f = ' ' + fold(text) + ' '
  const hits = []
  for (const k of compiled) if (k.re ? k.re.test(f) : f.includes(k.sub)) hits.push(k)
  hits.sort((a, b) => b.weight - a.weight)
  const score = Math.min(100, (hits[0]?.weight || 0) + Math.round((hits[1]?.weight || 0) / 2))
  return { score, terms: hits.slice(0, 4).map((h) => h.term) }
}

// File names that are never project photos.
export const BAD_NAME = /(^|[^a-z])(map|maps|plan|plans|logo|logos|diagram|diagrams|portrait|portraits|signature|signatures|flag|coat of arms|seal|icon|screenshot|lageplan|grundriss|karte)([^a-z]|$)/i
const INTERIOR = /\b(interior|inside|indoors?|lobby|atrium|foyer|innenraum|innenansicht|interieur|interno|interni|wnetrze|интерьер)\b|내부|실내|内部|室内|館内/i
// Project types whose work is on the outside of a building or in public space: interior photos are unrelated.
const EXTERIOR_TYPES = new Set(['media_facade', 'projection_mapping', 'urban_screen', 'festival_program'])
// Types whose own category is about the light work itself (a photo in it shows the work): media evidence.
const WORK_TYPES = new Set(['light_art', 'projection_mapping', 'festival_program', 'interactive_installation'])
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Evidence and relevance of one candidate (before visual scoring).
 * @param {{file: string, source: string, category?: string|null}} cand @param {any} info fileRecord @param {{project_type: string, rightsPolicy?: any, minWidth?: number, minHeight?: number}} ctx
 */
export function assessCandidate(cand, info, ctx) {
  const reasons = []
  if (!info || info.missing) return { ok: false, reasons: ['missing_file'] }
  const rights = assessRights({ license: info.license, mime: info.mime, templates: info.templates || [], templatesComplete: info.templatesComplete !== false }, { ...DEFAULT_POLICY, ...(ctx.rightsPolicy || {}) })
  if (!rights.ok) reasons.push(...rights.reasons.map((r) => 'rights:' + r))
  if (!IMAGE_MIME.has(info.mime)) reasons.push('format:' + (info.mime || 'unknown'))
  if (BAD_NAME.test(cand.file.replace(/\.[a-z0-9]+$/i, ''))) reasons.push('name:map_plan_logo_diagram_portrait_signature')
  const text = [cand.file.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '), info.object_name, info.description, ...(info.categories || []), cand.category ? cand.category.replace(/^Category:/, '') : ''].filter(Boolean).join(' · ')
  if (EXTERIOR_TYPES.has(ctx.project_type) && INTERIOR.test(text)) reasons.push('interior_unrelated_to_work')
  const w = info.width || 0, h = info.height || 0
  if (w < (ctx.minWidth ?? 640) || h < (ctx.minHeight ?? 400)) reasons.push('too_small')
  if (w && h && (w / h > 3 || w / h < 0.4)) reasons.push('extreme_aspect')
  const night = keywordScore(text, NIGHT)
  const media = keywordScore(text, MEDIA)
  let nightScore = night.score, mediaScore = media.score
  const evidence = []
  if (cand.source === 'night_category') { nightScore = Math.max(nightScore, 40); evidence.push('night_subcategory') }
  if (cand.source === 'event_category') { mediaScore = Math.min(100, mediaScore + 20); evidence.push('event_subcategory') }
  if ((cand.source === 'category' || cand.source === 'part_category' || cand.source === 'event_category') && WORK_TYPES.has(ctx.project_type)) { mediaScore = Math.min(100, mediaScore + 40); evidence.push('own_category_of_light_work') }
  return {
    ok: reasons.length === 0, reasons, rights, kr_fop: rights.krFop,
    night: nightScore, media: mediaScore, night_terms: night.terms, media_terms: media.terms, evidence,
  }
}

/**
 * Tier (1–4) and surface flags of an assessed, measured candidate.
 * @param {{night: number, media: number}} a @param {{mean_luminance: number, saturated_bright: number, colourfulness: number, visual: number}|null} m
 */
export function tierOf(a, m, th = {}) {
  const v = m?.visual ?? null
  const mediaThreshold = th.visual_media_threshold ?? 40
  let tier = 4
  if (v !== null && v >= mediaThreshold && (a.night >= 30 || m.mean_luminance <= 0.3) && (a.media >= 30 || v >= 60)) tier = 1
  else if (a.media >= 50 && ((v !== null && v >= 20) || a.evidence?.includes('event_subcategory'))) tier = 2
  else if (a.media >= 30 || a.night >= 50 || (v !== null && v >= 25)) tier = 3
  // Home: active media in a dark frame. A bright (daytime) frame or a frame without saturated light never qualifies.
  const homeOk = !!m && tier <= 3 && m.mean_luminance <= (th.home_max_mean_luminance ?? 0.4) && m.saturated_bright >= (th.home_min_saturated_bright ?? 0.02) &&
    m.colourfulness >= (th.home_min_colourfulness ?? 20) && (a.night >= 30 || a.media >= 30 || v >= 50)
  return { tier, home_ok: homeOk }
}

/** Whether a candidate may be a home hero (the allowlist decides last). */
export function heroEligible(a, m, info, t, th = {}) {
  const reasons = []
  if (!t.home_ok) reasons.push('not_home_ok')
  if (a.night < 30) reasons.push('no_night_evidence')
  if (a.media < 30) reasons.push('no_media_evidence')
  if (!m || m.visual < (th.hero_visual_threshold ?? 45)) reasons.push('visual_below_threshold')
  if ((info?.width || 0) < (th.hero_min_width ?? 1600)) reasons.push('original_too_small')
  return { ok: reasons.length === 0, reasons }
}

/** Thumbnail URL of another standard width from a Commons thumburl ("…/330px-Name.jpg"). */
export function thumbAt(thumburl, width) {
  return thumburl ? thumburl.replace(/\/(\d+)px-([^/]+)$/, `/${width}px-$2`) : null
}

/** Name evidence of a file before its metadata is read (used to choose which candidates to read). */
export function nameEvidence(text) {
  const t = String(text || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ')
  return { night: keywordScore(t, NIGHT).score, media: keywordScore(t, MEDIA).score }
}

// Standard Wikimedia thumbnail steps (other widths are refused or rendered on demand more slowly).
export const THUMB_STEPS = [120, 250, 330, 500, 960, 1280, 1920, 3840]
const step = (w, width) => (width && width <= w ? null : w)

/**
 * The public image object (licence and author always present; attribution as live-media.mjs builds it): a 500 px
 * card thumbnail, a 1280 px display file (1920 px for a hero), the file page, licence, author, role and tier.
 */
export function publicImage(info, role, extra = {}) {
  const page = { imageinfo: [{ url: info.url, thumburl: info.thumburl, extmetadata: { Artist: { value: info.artist || '' }, Credit: { value: info.credit || '' }, LicenseShortName: { value: info.license || '' }, LicenseUrl: { value: info.license_url || '' }, DateTimeOriginal: { value: info.date || '' } } }] }
  const row = toMediaRow('x', info.file, page, { qid: null, krFop: !!extra.kr_fop, now: null })
  const w = info.width || 0
  const thumbW = step(extra.thumbWidth ?? 500, w), bigW = step(role === 'hero' ? 1920 : 1280, w)
  const thumb = thumbW && info.thumburl ? thumbAt(info.thumburl, thumbW) : info.thumburl || info.url
  const big = bigW && info.thumburl ? thumbAt(info.thumburl, bigW) : info.url
  return {
    file: info.file,
    thumb,
    src: big || info.url,
    page: info.page || row.source_url,
    width: info.width ?? null,
    height: info.height ?? null,
    license: row.license_code,
    license_url: info.license_url || null,
    author: row.creator,
    attribution: row.attribution_text,
    role,
    ...extra.fields,
  }
}

/**
 * Chooses card, hero and gallery from scored candidates.
 * @param {{file: string, source: string, a: any, m: any, info: any, t: any}[]} scored
 * @param {{heroAllow: Set<string>, blocked: Set<string>, galleryMax?: number, th?: any}} o
 */
export function chooseImages(project, scored, { heroAllow, blocked, galleryMax = 12, th = {} }) {
  const usable = scored.filter((s) => s.a.ok && !blocked.has(s.file))
  const rank = (s) => [s.t.tier, -(s.m?.visual ?? -1), -(s.a.night + s.a.media), s.source === 'p18' ? 0 : 1, -(s.info.width || 0), s.file]
  const cmp = (x, y) => { const a = rank(x), b = rank(y); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0 }
  usable.sort(cmp)
  const decisions = []
  let hero = null
  for (const s of usable) {
    const he = heroEligible(s.a, s.m, s.info, s.t, th)
    const allowed = heroAllow.has(`${project.id}|${s.file}`)
    if (allowed && he.ok && !hero) hero = s
    if (allowed || he.ok) decisions.push({ file: s.file, hero_candidate: he.ok, allowlisted: allowed, reasons: he.reasons })
  }
  const card = usable[0] || null
  const ordered = [...(hero ? [hero] : []), ...usable.filter((s) => s !== hero)]
  const gallery = ordered.slice(0, galleryMax)
  const fields = (s) => ({ tier: s.t.tier, home_ok: s.t.home_ok })
  const images = gallery.map((s) => publicImage(s.info, s === hero ? 'hero' : s === card ? 'card' : 'detail', { kr_fop: s.a.kr_fop, fields: fields(s) }))
  return { images, hero, card, decisions, usable }
}

/** visual_rank for the index: 0 (no image) … 100 (media active at night with a strong visual). */
export function visualRank(card) {
  if (!card) return 0
  const v = card.m?.visual ?? 0
  const base = { 1: 70, 2: 50, 3: 30, 4: 10 }[card.t.tier] ?? 0
  return Math.min(100, base + Math.round(v * 0.3))
}
