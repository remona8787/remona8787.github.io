// Images per project (docs/STATIC_ARCHIVE.md "Images (per-surface rules)" and the v0.18 "Image rules").
// Candidates: the item's P18, the project's Commons category, its night/illuminated/event subcategories and the
// categories found as parts or editions of it, plus the providers of lib/providers.mjs (identity-proven, lib/identity.mjs).
// Each Commons candidate is
//  - rights-checked with live-media.mjs assessRights (licence allowlist, deletion and permission templates, NoFoP of
//    other countries, the Korean FoP policy) and attributed like live-media.mjs toMediaRow;
//  - scored: night (keywords in many languages, the "at night" subcategory), media (media/light keywords, the
//    work's own category for light works), visual (visual.mjs on a 320 px thumbnail), relevance (own entity, not a
//    map/plan/logo/diagram/portrait/signature, not an unrelated interior, usable size and format);
//  - given a tier (the brief's priority list): 1 a media facade running, high resolution; 2 architectural media art at
//    night; 3 LED or projection technology and content visible; 4 an exhibition or public-art installation scene; 5 an
//    architectural photo of the same project; 6 none (the designed placeholder);
//  - measured for quality on a ~1024 px rendition (lib/quality.mjs: sharpness, blockiness, perceptual hash).
// Surfaces and widths of the original: hero ≥ 2400 px (1920 only when the project has nothing larger, flagged),
// featured ≥ 1600, card ≥ 1200 (a smaller card only when nothing larger exists, flagged); never shown wider than the
// original. A home image must show active media in a dark frame (never a daytime photo, never darkness alone); a hero
// additionally needs night and media evidence, a high visual score, the quality gates and a reviewed approval
// (editorial/hero.json, set_hero, or approve_image); a featured image from a provider other than Commons needs an
// approval too (the contact sheets).
import { createHash } from 'node:crypto'
import { assessRights, toMediaRow, DEFAULT_POLICY } from '../../edge-functions/_shared/live-media.mjs'
import { fold } from './util.mjs'
import { hamming, qualityScore } from './quality.mjs'
import { nameIn as nameInText } from './identity.mjs'

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
// Relevance: a file whose title, description or categories name a different subject than the project and its
// building (people, a political event, an animal or an object, a show) is not a photo of the work, however colourful
// its frame. Found on the live site: "Nanta Cooking Teddy Bears" on N Seoul Tower, a G-20 summit photo on an immersive
// gallery, a neon sign on an LED-facade arena, a lion sculpture on a light column.
export const PEOPLE_EVENT = /\b(portraits?|politicians?|presidents?|prime minister|ministers?|chancellors?|mayors?|kings?|queens?|princes?|princess|ambassadors?|delegations?|summits?|g-?20|g-?7|g-?8|apec|conferences?|press conference|state visit|official visit|weddings?|ceremon(?:y|ies)|reenactments?|re-enactments?|selfies?|celebrities|actors?|actresses|footballers?)\b|대통령|정상회의|총리|장관|기자회견|초상|혼례|결혼식|재현행사|기념식|시상식|개막식/i
export const OBJECT_ANIMAL = /\b(teddy ?bears?|bears?|lions?|l[öo]we|loewe|tigers?|dogs?|cats?|birds?|pigeons?|horses?|animals?|cooking|food|meals?|menus?|restaurants?|toys?|dolls?|figurines?|mascots?|costumes?|statues?|neon signs?|signboards?|shop signs?|street signs?|road signs?|posters?|tickets?|souvenirs?|merchandise|t-shirts?)\b|곰인형|테디베어|사자상|호랑이|강아지|고양이|음식|요리|인형|동상|간판|포스터/i
// People (fifth brief, P0): a photo of people is not a photo of the work. Strong signs (a portrait, a people or
// portrait category, structured data saying it depicts a human) always count; weak words (visitors, a couple, a
// family, a selfie) count when the file names neither night nor media. A photo naming one of the project's creators
// (P170, P50, P84, P112) is that artist's portrait: shown in the creator section only, never in the gallery.
export const PERSON_STRONG = /\b(portraits?|headshots?|selfies?|posing|poses? for)\b|인물 ?사진|초상|셀카|기념사진|인증샷/i
export const PERSON_WEAK = /\b(people|persons?|woman|women|man|men|girls?|boys?|children|kids|brides?|grooms?|couples?|famil(?:y|ies)|friends|faces?|smil(?:e|es|ing)|visitors?|tourists?|guests?|audience)\b|사람들?|여자|남자|소녀|소년|어린이|아이들|커플|가족|친구들?|얼굴|관람객|방문객|관광객/i
// Categories that are about people themselves ("People of …", "Portraits of …"), not categories of photos with
// people in them ("People with motion blur", "Crowds in Japan", "People with fireworks": those are scenes).
export const PERSON_CATEGORY = /^(?:Category:)?(?:(?:People|Men|Women|Children|Girls|Boys|Couples|Families) of\b|Portraits?\b|Portrait photographs\b|Selfies\b|(?:Politicians|Celebrities|Actors|Actresses|Musicians|Singers|Models) (?:of|from)\b)/i
/**
 * Person evidence of a candidate: {strong, weak} (the matched sign or null). texts: title, object name, description
 * (and tags for providers) for the strong signs; titles: the title-level texts (file name, object name, tags) for the
 * weak words — a description saying "visitors walk through the installation" describes the work.
 */
export function personEvidence(texts, categories = [], { depictsHuman = false, titles = null } = {}) {
  const t = [texts].flat().filter(Boolean).join(' · ')
  const m = PERSON_STRONG.exec(t)
  const cat = (categories || []).find((c) => PERSON_CATEGORY.test(c))
  const strong = depictsHuman ? 'depicts_human' : cat ? 'category:' + cat.replace(/^Category:/, '').slice(0, 60) : m ? m[0].toLowerCase() : null
  const w = PERSON_WEAK.exec(titles ? [titles].flat().filter(Boolean).join(' · ') : t)
  return { strong, weak: w ? w[0].toLowerCase() : null }
}
/** Whether the text names one of the creators (whole names: two words or more, or Hangul of 2+ characters). */
export function namesCreator(text, creators = []) {
  return creatorMention(text, creators)?.name ?? null
}
// "by Leo Villareal", "von …", "Leo Villareal's …", "… 작가의 작품": the creator as the author of what is shown.
const ATTRIBUTION_BEFORE = /\b(by|von|par|di|de|des|del|work of|works of|artwork of)\s*$/
/**
 * A creator named in the text: {name, attribution}. attribution: the name credits what is shown ("The Bay Lights by Leo
 * Villareal"), so the photo shows the work; otherwise the photo shows the person ("Leo Villareal at the opening").
 */
export function creatorMention(text, creators = []) {
  const f = ' ' + fold(String(text || '')).replace(/[^\p{L}\p{N}']+/gu, ' ') + ' '
  for (const raw of creators) {
    const n = fold(String(raw || '')).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (!n) continue
    if (/\p{Script=Hangul}/u.test(n)) {
      const c = f.replace(/ /g, ''), k = n.replace(/ /g, '')
      if (k.length < 2 || !c.includes(k)) continue
      return { name: raw, attribution: new RegExp(k + "(작가)?(의)?(작품|작|展|전시)").test(c), subject: new RegExp(k + '(작가)?(의)?(초상|인물|인터뷰|강연|기자간담회)').test(c) }
    }
    if (n.split(' ').length < 2) continue
    const at = f.indexOf(' ' + n + ' ')
    if (at < 0) continue
    const possessive = new RegExp(String(raw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "['’]s\\b", 'i').test(String(text || ''))
    const after = f.slice(at + n.length + 2)
    // The person as the subject: "<name> at / with / in front of / speaking …", or a title that is only the name
    // (and a year or a number). Anything else names the artist as the author of what is shown.
    const first = ' ' + fold(String(text || '').split(' · ')[0]).replace(/[^\p{L}\p{N}]+/gu, ' ') + ' '
    const onlyName = first.includes(' ' + n + ' ') && /^\s*(\d+\s*)*(cropped\s*)?(\d+\s*)*$/.test(first.replace(' ' + n + ' ', ' '))
    const subject = SUBJECT_AFTER.test(after) || onlyName
    const attribution = ATTRIBUTION_BEFORE.test(f.slice(0, at)) || possessive
    return { name: raw, attribution, subject: subject && !attribution }
  }
  return null
}
const SUBJECT_AFTER = /^(at|with|in front of|speaking|speaks|during|giving|gives|talks?|interviewed|interview|receiv(?:es|ing)|pos(?:es|ing)|and (?:his|her)|portrait|photographed)\b/
// Technical documentation (construction, modules, mock-ups, renderings) and event documentation (openings,
// ceremonies, press previews, audiences) are kept apart from the photos of the work (image kind).
export const TECH_DOC = /\b(under construction|construction|installation work|installing|assembly|mock-?ups?|prototypes?|testing|led modules?|pixel pitch|controllers?|wiring|cabling|scaffold(?:ing)?|maintenance|renderings?|renders?|simulations?|visuali[sz]ations?)\b|공사|시공|설치 ?작업|목업|시험 ?운영|테스트|LED ?모듈|유지 ?보수|렌더링|조감도|시뮬레이션/i
export const EVENT_DOC = /\b(opening|ceremon(?:y|ies)|press (?:preview|conference|day)|launch event|unveiling|visitors?|audience|crowds?|queues?)\b|개막|개장|점등식|기념식|관람객|인파/i
/** The kinds of a published image (docs/PIPELINE.md "Image kinds"); 'unverified' is never published. */
export const IMAGE_KINDS = ['project_media', 'project_installation', 'architecture_context', 'technical_documentation', 'event_documentation', 'artist_portrait', 'unverified']
/** Kind of a scored candidate s ({a, t, identity, cand}) of a project type. */
export function kindOf(s, projectType) {
  const a = s.a || {}
  if (a.portrait) return 'artist_portrait'
  if (s.cand?.provider && s.cand.provider !== 'commons' && s.identity?.ok !== true) return 'unverified'
  const text = a.title_text || ''
  const ev = a.evidence || []
  if (ev.includes('host_building_only')) return 'architecture_context'
  if (TECH_DOC.test(text)) return 'technical_documentation'
  const tier = s.t?.tier ?? 5
  if (EVENT_DOC.test(text) && (projectType === 'festival_program' ? tier >= 4 : tier >= 3)) return 'event_documentation'
  return tier <= 3 ? 'project_media' : tier === 4 ? 'project_installation' : 'architecture_context'
}
/** Kind of a published image without one (v0.17 and early v0.18 records): from its tier. */
export const kindOfTier = (tier) => (tier <= 3 ? 'project_media' : tier === 4 ? 'project_installation' : 'architecture_context')
const CARD_KINDS = new Set(['project_media', 'project_installation', 'architecture_context'])

// Event words that belong to a festival's own photos.
const FESTIVAL_OK = /\b(ceremon(y|ies)|weddings?)\b|개막식|기념식/i
/**
 * Whether a candidate's text names a different subject than the project. A word that is part of the project's own
 * names ("Teddy Bear Museum", a neon work) never counts.
 * @returns {string|null} the rejection reason
 */
export function otherSubject(text, ctx = {}) {
  const own = [ctx.names].flat().filter(Boolean).join(' ').toLowerCase()
  const t = String(text || '')
  const hit = (re) => { const m = re.exec(t); return m && !own.includes(m[0].toLowerCase().replace(/s$/, '')) ? m[0] : null }
  const people = hit(PEOPLE_EVENT)
  if (people && !(ctx.project_type === 'festival_program' && FESTIVAL_OK.test(people))) return 'subject:people_or_event:' + people.toLowerCase()
  // In a light work's own Commons category, animals and objects are the work's motifs (a tiger lantern, "The Baby Birds
  // of Norman McLaren" projected at a festival); anywhere else they are another subject.
  const thing = ctx.ownWorkCategory ? null : hit(OBJECT_ANIMAL)
  if (thing && !(/neon/i.test(thing) && ['light_art', 'other'].includes(ctx.project_type) && /neon/i.test(own))) return 'subject:object_or_animal:' + thing.toLowerCase()
  return null
}

// Project types whose work is on the outside of a building or in public space: interior photos are unrelated.
const EXTERIOR_TYPES = new Set(['media_facade', 'projection_mapping', 'urban_screen', 'festival_program'])
// Types whose own category is about the light work itself (a photo in it shows the work): media evidence.
const WORK_TYPES = new Set(['light_art', 'projection_mapping', 'festival_program', 'interactive_installation'])
// Types whose work is shown on the outside of its structure after dark: a night photo of the structure shows the work.
const NIGHT_SHOWS_WORK = new Set(['media_facade', 'media_wall', 'urban_screen', 'projection_mapping'])
const OWN_CATEGORY_SOURCES = new Set(['category', 'part_category', 'event_category'])
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
  const title = cand.file.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ')
  const text = [title, info.object_name, info.description, ...(info.categories || []), cand.category ? cand.category.replace(/^Category:/, '') : ''].filter(Boolean).join(' · ')
  if (EXTERIOR_TYPES.has(ctx.project_type) && INTERIOR.test(text)) reasons.push('interior_unrelated_to_work')
  // From the item's P18, depicts or category while the item is an institution, building, tower or district (or a
  // host building) rather than the work: entities.mjs item_institution, image-stage.mjs commonsFiles.
  const institution = cand.institution === true || (!!ctx.host && ['p18', 'category', 'depicts', 'event_category', 'night_category'].includes(cand.source))
  const ownWorkCategory = !institution && OWN_CATEGORY_SOURCES.has(cand.source) && WORK_TYPES.has(ctx.project_type)
  // The title and description decide the subject (categories also name the place, events held there, etc.).
  const subject = otherSubject([title, info.object_name, info.description, ...(info.categories || []).filter((c) => PEOPLE_EVENT.test(c))].filter(Boolean).join(' · '), { ...ctx, ownWorkCategory })
  if (subject) reasons.push(subject)
  const titleText = [title, info.object_name, info.description].filter(Boolean).join(' · ')
  const w = info.width || 0, h = info.height || 0
  if (w < (ctx.minWidth ?? 640) || h < (ctx.minHeight ?? 400)) reasons.push('too_small')
  if (w && h && (w / h > 3 || w / h < 0.4)) reasons.push('extreme_aspect')
  const night = keywordScore(text, NIGHT)
  const media = keywordScore(text, MEDIA)
  let nightScore = night.score, mediaScore = media.score
  // An exhibition or installation scene named by the file's own title or description (tier 4 for scene types).
  const evidence = SCENE_TERMS.test([title, info.object_name, info.description].filter(Boolean).join(' · ')) ? ['scene_terms'] : []
  if (cand.source === 'night_category') { nightScore = Math.max(nightScore, 40); evidence.push('night_subcategory') }
  if (institution) {
    // An institution's file shows the institution, its other rooms and the events held there, not the work: it is
    // context at most (tier 5, never card, hero, featured or gallery) unless its title or description names the work,
    // its text names media, or, for a work shown on the outside of its structure after dark (a facade, a projection,
    // the lighting of the item itself), it is a night photo. Its event subcategories (a summit, a royal-wedding
    // reenactment) are not the work's editions.
    const namesWork = ctx.workNames?.length ? nameInText([title, info.object_name, info.description].filter(Boolean).join(' · '), ctx.workNames) : null
    const nightShows = NIGHT_SHOWS_WORK.has(ctx.project_type) || (ctx.project_type === 'light_art' && !ctx.host)
    const rescued = !!namesWork || media.score >= 30 || (nightShows && (night.score >= 30 || cand.source === 'night_category'))
    evidence.push(rescued ? 'institution_file:' + (namesWork ? 'names_work' : media.score >= 30 ? 'media_terms' : 'night_view') : 'host_building_only')
  } else {
    if (cand.source === 'event_category') { mediaScore = Math.min(100, mediaScore + 20); evidence.push('event_subcategory') }
    if (ownWorkCategory) { mediaScore = Math.min(100, mediaScore + 40); evidence.push('own_category_of_light_work') }
  }
  const person = personPass(personEvidence([title, info.object_name, info.description], info.categories, { depictsHuman: !!ctx.depictsHuman?.(cand.file), titles: [title, info.object_name] }), titleText, ctx, night.score, media.score)
  if (person.reason) reasons.push(person.reason)
  if (person.people_in_frame) evidence.push('people_in_frame')
  return {
    ok: reasons.length === 0, reasons, rights, kr_fop: rights.krFop,
    night: nightScore, media: mediaScore, night_terms: night.terms, media_terms: media.terms, evidence,
    title_text: titleText.slice(0, 400), ...(person.portrait ? { portrait: person.portrait } : {}),
  }
}

/** The person rule: {reason} to reject, {portrait: creator name} for a creator's portrait, or {people_in_frame}. */
function personPass(pe, text, ctx, night, media) {
  // A creator named as the subject ("Leo Villareal at the opening"), or named in a photo with person signs, makes the
  // photo his portrait; a creator named as the author of what is shown ("Lust for Life by Giny Vos") does not.
  const cm = creatorMention(text, ctx.creators || [])
  if (cm && !cm.attribution && (cm.subject || pe.strong || pe.weak)) return { portrait: cm.name }
  if (!pe.strong && !pe.weak) return {}
  if (pe.strong) return { reason: 'subject:person:' + pe.strong }
  if (night < 30 && media < 30) return { reason: 'subject:person:' + pe.weak }
  return { people_in_frame: true }
}


/** Name evidence of a file before its metadata is read (used to choose which candidates to read). */
export function nameEvidence(text) {
  const t = String(text || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ')
  return { night: keywordScore(t, NIGHT).score, media: keywordScore(t, MEDIA).score }
}

const FACADE_TYPES = new Set(['media_facade', 'media_wall', 'urban_screen', 'projection_mapping'])
const SCENE_TYPES = new Set(['media_architecture', 'interactive_installation', 'light_art', 'festival_program', 'other'])
const SCENE_TERMS = /\b(exhibition|exhibit|installation|immersive|gallery|museum|artwork|public art|sculpture|ausstellung|exposition|mostra)\b|전시|설치|몰입|작품|조형물|展示|展覧/i

/** Keyword evidence of a provider candidate (title, tags, description), like assessCandidate does for Commons files. */
export function assessText(c, ctx = {}) {
  const text = [c.title, ...(c.tags || []), c.description].filter(Boolean).join(' · ')
  const night = keywordScore(text, NIGHT), media = keywordScore(text, MEDIA)
  const reasons = []
  if (BAD_NAME.test(c.title || '')) reasons.push('name:map_plan_logo_diagram_portrait_signature')
  if (EXTERIOR_TYPES.has(ctx.project_type) && INTERIOR.test(text)) reasons.push('interior_unrelated_to_work')
  const subject = otherSubject([c.title, c.description].filter(Boolean).join(' · '), ctx)
  if (subject) reasons.push(subject)
  const evidence = [...(SCENE_TERMS.test(text) ? ['scene_terms'] : []), ...(c.editorial ? ['editorial_review'] : [])]
  // Tags count for people too (providers tag portraits "portrait", "people", "woman"…); an editor's image is reviewed.
  const person = c.editorial ? {} : personPass(personEvidence([c.title, ...(c.tags || []), c.description], [], { titles: [c.title, ...(c.tags || [])] }), [c.title, c.description].filter(Boolean).join(' · '), ctx, night.score, media.score)
  if (person.reason) reasons.push(person.reason)
  if (person.people_in_frame) evidence.push('people_in_frame')
  return { ok: reasons.length === 0, reasons, night: night.score, media: media.score, night_terms: night.terms, media_terms: media.terms, evidence, kr_fop: false, text, title_text: [c.title, c.description].filter(Boolean).join(' · ').slice(0, 400), ...(person.portrait ? { portrait: person.portrait } : {}) }
}

/**
 * Tier (1–5) and the home flag of an assessed, measured candidate (6, the placeholder, is a project without images).
 * @param {{night: number, media: number, evidence?: string[], text?: string}} a @param {any} m visual metrics or null
 * @param {any} th thresholds @param {{project_type?: string, width?: number|null}} [ctx]
 */
export function tierOf(a, m, th = {}, ctx = {}) {
  const v = m?.visual ?? null
  const mediaThreshold = th.visual_media_threshold ?? 40
  // A colourful dark frame alone never makes tiers 1–3: the file must name night or media, or come from a night,
  // event or light-work category (keyword evidence), and never be only a host building's photo.
  const ev = a.evidence || []
  const evidence = a.night >= 30 || a.media >= 30 || ev.includes('night_subcategory') || ev.includes('event_subcategory') || ev.includes('own_category_of_light_work') || ev.includes('editorial_review')
  const hostOnly = ev.includes('host_building_only')
  const running = !hostOnly && evidence && v !== null && v >= mediaThreshold && (a.night >= 30 || m.mean_luminance <= 0.3) && (a.media >= 30 || v >= 60)
  let tier
  if (running) tier = FACADE_TYPES.has(ctx.project_type) && (ctx.width ?? 0) >= (th.tier1_min_width ?? 1600) ? 1 : 2
  else if (hostOnly) tier = 5
  else if ((a.media >= 50 && ((v !== null && v >= 20) || ev.includes('event_subcategory'))) || a.media >= 30 || a.night >= 50 || (evidence && v !== null && v >= 25)) tier = 3
  else if (SCENE_TYPES.has(ctx.project_type) && (a.evidence?.includes('own_category_of_light_work') || a.evidence?.includes('scene_terms') || SCENE_TERMS.test(a.text || ''))) tier = 4
  else tier = 5
  // Home: active media in a dark frame. A bright (daytime) frame or a frame without saturated light never qualifies.
  const homeOk = !!m && tier <= 3 && m.mean_luminance <= (th.home_max_mean_luminance ?? 0.4) && m.saturated_bright >= (th.home_min_saturated_bright ?? 0.02) &&
    m.colourfulness >= (th.home_min_colourfulness ?? 20) && (a.night >= 30 || a.media >= 30 || v >= 50)
  return { tier, home_ok: homeOk }
}

/** media_active (0–100) with its reasons: the visual score of the frame and the night and media evidence. */
export function mediaActive(a, m) {
  const v = m?.visual ?? 0
  const reasons = []
  if (m) {
    reasons.push('visual:' + v)
    if (m.mean_luminance <= 0.3) reasons.push('dark_frame')
    if (m.saturated_bright >= 0.02) reasons.push('saturated_light')
  } else reasons.push('not_measured')
  if (a.night_terms?.length) reasons.push('night_terms:' + a.night_terms.slice(0, 3).join('|'))
  if (a.media_terms?.length) reasons.push('media_terms:' + a.media_terms.slice(0, 3).join('|'))
  for (const e of a.evidence || []) reasons.push(e)
  const score = Math.round(Math.min(100, 0.6 * v + 0.2 * Math.min(100, a.night || 0) + 0.2 * Math.min(100, a.media || 0)))
  return { score: m ? score : Math.min(score, 40), reasons }
}

/** Whether a candidate may be the home hero; the approval (reviewed allowlist) is checked by chooseImages. */
export function heroEligible(a, m, info, t, th = {}, q = null, { fallbackWidth = false } = {}) {
  const reasons = []
  if (t.tier > 2) reasons.push('tier_' + t.tier)
  if (!t.home_ok) reasons.push('not_home_ok')
  if (a.night < 30 && !(m && m.mean_luminance <= 0.3)) reasons.push('no_night_evidence')
  if (a.media < 30) reasons.push('no_media_evidence')
  if (!m || m.visual < (th.hero_visual_threshold ?? 45)) reasons.push('visual_below_threshold')
  const w = info?.width || 0
  if (w < (fallbackWidth ? th.hero_fallback_min_width ?? 1920 : th.hero_min_width ?? 2400)) reasons.push('original_too_small')
  const Q = th.quality || {}
  if (!q) reasons.push('quality_not_measured')
  else {
    if (q.sharpness < (Q.hero_min_sharpness ?? 35)) reasons.push('not_sharp_enough')
    if (q.blockiness > (Q.hero_max_blockiness ?? 20)) reasons.push('compression_artefacts')
  }
  return { ok: reasons.length === 0, reasons }
}

/** Whether a candidate may be a featured image of the home page (approval checked by chooseImages for non-Commons). */
export function featuredEligible(s, th = {}) {
  const reasons = []
  if (s.t.tier > 3) reasons.push('tier_' + s.t.tier)
  if (!s.t.home_ok) reasons.push('not_home_ok')
  if ((s.width || 0) < (th.featured_min_width ?? 1600)) reasons.push('original_too_small')
  const Q = th.quality || {}
  if (!s.q) reasons.push('quality_not_measured')
  else {
    if (s.q.sharpness < (Q.featured_min_sharpness ?? 25)) reasons.push('not_sharp_enough')
    if (s.q.blockiness > (Q.featured_max_blockiness ?? 30)) reasons.push('compression_artefacts')
  }
  return { ok: reasons.length === 0, reasons }
}

// ---------------------------------------------------------------- Commons URLs

// The standard Wikimedia thumbnail widths: since the 2025/2026 thumbnail standardisation the CDN refuses any other
// width requested directly (mediawiki.org "Common thumbnail sizes"). Display URLs use only these.
export const THUMB_STEPS = [120, 250, 330, 500, 960, 1280, 1920, 3840]
/** A media URL without analytics parameters (Wikimedia adds utm_* to API thumbnail URLs, $wgTrackMediaRequestProvenance). */
export function cleanMediaUrl(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k)
    return u.href
  } catch { return null }
}
/** Thumbnail URL of another standard width from a Commons thumburl ("…/330px-Name.jpg"), on the host the API named. */
export function thumbAt(thumburl, width) {
  const clean = cleanMediaUrl(thumburl)
  return clean ? clean.replace(/\/(\d+)px-([^/?#]+)$/, `/${width}px-$2`) : null
}
/** The sizes Wikimedia serves for a file: standard steps below the original's width, and the original when it is not too heavy. */
export function commonsDisplay(info, { maxOriginalBytes = 8e6 } = {}) {
  const w = info.width || 0
  const out = []
  if (info.thumburl) for (const step of THUMB_STEPS) if (step >= 330 && step < w) out.push([step, thumbAt(info.thumburl, step)])
  const original = cleanMediaUrl(info.url)
  if (original && w && w <= 4000 && (info.size ?? Infinity) <= maxOriginalBytes && /^image\/(jpeg|png|webp)$/.test(info.mime || 'image/jpeg')) out.push([w, original])
  return out
}

/** A Commons file (fileRecord) as a provider-neutral candidate. */
export function commonsCandidate(info, a) {
  const row = toMediaRow('x', info.file, { imageinfo: [{ url: info.url, thumburl: info.thumburl, extmetadata: { Artist: { value: info.artist || '' }, Credit: { value: info.credit || '' }, LicenseShortName: { value: info.license || '' }, LicenseUrl: { value: info.license_url || '' }, DateTimeOriginal: { value: info.date || '' } } }] }, { qid: null, krFop: !!a?.kr_fop, now: null })
  const w = info.width || null
  return {
    provider: 'commons', source_id: info.file, file: info.file, src: cleanMediaUrl(info.url), page: info.page || row.source_url, sizes: commonsDisplay(info),
    width: w, height: info.height ?? null, bytes: info.size ?? null, format: (info.mime || '').replace(/^image\//, '') || null,
    thumb: info.thumburl ? thumbAt(info.thumburl, w && w <= 500 ? 330 : 500) : cleanMediaUrl(info.url),
    visual_url: info.thumburl ? thumbAt(info.thumburl, 330) : null,
    measure_url: info.thumburl && w > 960 ? thumbAt(info.thumburl, 960) : cleanMediaUrl(info.url), measure_width: w > 960 ? 960 : w,
    author: row.creator, rights_holder: row.creator, license: row.license_code, license_url: info.license_url || null, attribution: row.attribution_text,
    usage: 'cache', no_derivatives: false, sha1: info.sha1 || null, date: info.date || null,
  }
}

// ---------------------------------------------------------------- roles and the image object

export const stableImageId = (provider, sourceId) => 'img-' + createHash('sha256').update(provider + '|' + sourceId).digest('hex').slice(0, 12)
const rankOf = (s) => [s.t.tier, -(s.q?.score ?? -1), -(s.m?.visual ?? -1), -(s.a.night + s.a.media), s.source === 'p18' ? 0 : 1, -(s.width || 0), s.key]
const cmp = (x, y) => { const a = rankOf(x), b = rankOf(y); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0 }

/**
 * Hero, featured, card and gallery from scored candidates. Each s: {key, file?, cand, source, a, m, q, t, width,
 * approved: true|false|null, identity}. Near-duplicates (perceptual hash) keep the larger and sharper copy.
 * @param {{heroAllow: Set<string>, blocked: Set<string>, galleryMax?: number, th?: any}} o heroAllow holds "project|key" (and "project|file" for Commons)
 */
export function chooseImages(project, scored, { heroAllow, blocked, galleryMax = 12, th = {} }) {
  for (const s of scored) s.kind ??= kindOf(s, project.project_type)
  const candidates = scored.filter((s) => s.a.ok && !blocked.has(s.key) && !(s.file && blocked.has(s.file)) && s.approved !== false && s.kind !== 'unverified')
  // A creator's portrait goes to the creator section, never to the gallery.
  const portraits = candidates.filter((s) => s.kind === 'artist_portrait').sort(cmp)
  const usable = candidates.filter((s) => s.kind !== 'artist_portrait')
  usable.sort(cmp)
  // Near-duplicates: the same photo from two providers or two sizes. A reviewed copy (allowlisted or approved) stays,
  // otherwise the larger, then sharper one.
  const duplicates = []
  const kept = []
  const hamMax = th.near_duplicate_hamming ?? 8
  const allowed = (s) => heroAllow.has(`${project.id}|${s.key}`) || (s.file ? heroAllow.has(`${project.id}|${s.file}`) : false)
  const reviewed = (s) => (allowed(s) || s.approved === true ? 1 : 0)
  for (const s of [...usable].sort((x, y) => reviewed(y) - reviewed(x) || (y.width || 0) - (x.width || 0) || (y.q?.sharpness ?? -1) - (x.q?.sharpness ?? -1) || cmp(x, y))) {
    const twin = s.q?.phash ? kept.find((k) => k.q?.phash && hamming(k.q.phash, s.q.phash) <= hamMax) : null
    if (twin) duplicates.push({ key: s.key, kept: twin.key, distance: hamming(twin.q.phash, s.q.phash) }); else kept.push(s)
  }
  const list = usable.filter((s) => kept.includes(s))
  const hasLarge = list.some((s) => (s.width || 0) >= (th.hero_min_width ?? 2400) && s.t.tier <= 2)
  const decisions = []
  let hero = null
  for (const s of list) {
    const ok = allowed(s) || (s.approved === true && s.t.tier <= 2)
    if (s.kind !== 'project_media' && !ok) continue
    // Only a photo of the work in action is a hero, whatever was allowlisted.
    const he0 = heroEligible(s.a, s.m, { width: s.width }, s.t, th, s.q, { fallbackWidth: !hasLarge })
    const he = s.kind === 'project_media' ? he0 : { ok: false, reasons: [...he0.reasons, 'kind:' + s.kind] }
    if (ok && he.ok && !hero) hero = s
    if (ok || he.ok || s.t.tier <= 2) decisions.push({ key: s.key, file: s.file || null, provider: s.cand.provider, hero_candidate: he.ok, allowlisted: ok, reasons: he.reasons, below_target: he.ok && (s.width || 0) < (th.hero_min_width ?? 2400) })
  }
  // Featured: the best home image ≥ 1600 px; from a provider other than Commons only after an approval.
  let featured = null
  const featuredDecisions = []
  for (const s of list) {
    if (s.kind !== 'project_media') continue
    const fe = featuredEligible(s, th)
    const needsReview = s.cand.provider !== 'commons' && s.approved !== true
    if (fe.ok && !needsReview && !featured) featured = s
    if (s.t.tier <= 3) featuredDecisions.push({ key: s.key, provider: s.cand.provider, featured_candidate: fe.ok, awaiting_review: fe.ok && needsReview, reasons: fe.reasons })
  }
  // Card: the best image whose original is at least card_min_width; a smaller one only when nothing larger exists.
  const cardMin = th.card_min_width ?? 1200
  // An institution's file without the work (host_building_only) is never the card: context only.
  // Documentation of construction or of an event is never the card either.
  const cardable = list.filter((s) => CARD_KINDS.has(s.kind) && !(s.a.evidence || []).includes('host_building_only'))
  const card = cardable.find((s) => (s.width || 0) >= cardMin) || cardable[0] || null
  const ordered = [...new Set([hero, featured, card, ...list].filter(Boolean))].slice(0, galleryMax)
  const roleOf = (s) => (s === hero ? 'hero' : s === featured ? 'featured' : s === card ? 'card' : s.t.tier >= 5 ? 'context' : 'gallery')
  return { ordered: ordered.map((s) => ({ s, role: roleOf(s) })), hero, featured, card, decisions, featuredDecisions, duplicates, usable: list, portraits }
}

/**
 * The public image object (docs/STATIC_ARCHIVE.md v0.18 "Data fields"), plus thumb and attribution, which the v0.17
 * app reads, and identity for every provider other than Commons (the proof that it shows the project).
 */
export function imageObject(s, role, { project, checkedAt = null, th = {} } = {}) {
  const c = s.cand
  const width = s.width ?? c.width ?? null, height = s.height ?? c.height ?? null
  const display = (c.sizes || []).filter(([w]) => !width || w <= width)
  const thumbOf = () => {
    if (c.thumb) return c.thumb
    const small = display.find(([w]) => w >= 500) || display[display.length - 1]
    return small ? small[1] : c.src
  }
  const name = PROVIDER_LABELS[c.provider] || c.provider
  return {
    id: stableImageId(c.provider, c.source_id), project: project.id, provider: c.provider,
    src: c.src, page: c.page, display, thumb: thumbOf(),
    author: c.author ?? null, rights_holder: c.rights_holder ?? c.author ?? null, license: c.license, license_url: c.license_url ?? null,
    attribution: c.attribution || [c.author, c.license, name].filter(Boolean).join(' · '),
    usage: c.usage || 'hotlink', ...(c.no_derivatives ? { no_derivatives: true } : {}), ...rightsUse(c.license), ...(c.permission_note ? { permission_note: c.permission_note } : {}),
    width, height, bytes: s.q?.decoded && s.q.decoded.width === width ? s.q.decoded.bytes : c.bytes ?? null, format: c.format ?? s.q?.decoded?.format ?? null,
    quality: s.q ? { sharpness: s.q.sharpness, blockiness: s.q.blockiness, score: qualityScore(s.q, width) } : null,
    media_active: mediaActive(s.a, s.m), tier: s.t.tier, role, kind: s.kind ?? kindOf(s, project.project_type),
    title: imageTitle(c), description: c.provider === 'commons' ? snippet(s.info?.description) : snippet(c.description),
    ...(c.provider !== 'commons' ? { identity: s.identity } : {}),
    ...(role === 'hero' && width && width < (th.hero_min_width ?? 2400) ? { below_target: true } : {}),
    ...(role === 'card' && width && width < (th.card_min_width ?? 1200) ? { below_target: true } : {}),
    checked_at: checkedAt, approved: s.approved ?? null,
  }
}
/**
 * What a licence allows, recorded per image so a later commercial mode can filter: {commercial_use, kogl_type?}.
 * KOGL (공공누리) types 1 and 3 allow commercial use (3 forbids derivatives), 2 and 4 forbid it (never accepted).
 */
export function rightsUse(license) {
  const l = String(license || '')
  const k = /KOGL Type ([1-4])/i.exec(l)
  if (k) return { kogl_type: Number(k[1]), commercial_use: k[1] === '1' || k[1] === '3' }
  if (/\bNC\b|non-?commercial/i.test(l)) return { commercial_use: false }
  if (/^(CC0|PD|public domain|CC BY(-SA)?\b)/i.test(l) || /^(cc-?zero|pdm)/i.test(l)) return { commercial_use: true }
  return { commercial_use: null }
}
/** The source's title of an image (a Commons file name without the extension, a provider's title), for audits. */
export function imageTitle(c) {
  if (c.provider === 'commons') return String(c.file || c.source_id || '').replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ').slice(0, 200) || null
  return String(c.title || '').trim().slice(0, 200) || `${PROVIDER_LABELS[c.provider] || c.provider} ${c.source_id}`.slice(0, 200)
}
/** A plain-text snippet (≤ 240 characters) of a description. */
export const snippet = (t) => { const x = String(t || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(); return x ? (x.length > 240 ? x.slice(0, 239).replace(/\s+\S*$/, '') + '…' : x) : null }
export const PROVIDER_LABELS = { commons: 'Wikimedia Commons', openverse: 'Openverse', flickr: 'Flickr', tourapi: '한국관광공사', kto_photo: '한국관광공사 관광사진', unsplash: 'Unsplash', pexels: 'Pexels', official: 'official site', editor: 'editor' }

/** visual_rank for the index: the card image's tier (1 media facade running … 5 architectural), null without an image. */
export function visualRank(card) {
  return card ? card.t.tier : null
}
