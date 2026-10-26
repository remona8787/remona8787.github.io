// Pipeline images (docs/STATIC_ARCHIVE.md "Images (per-surface rules)"): rights checks reused from live-media.mjs,
// keyword evidence, visual scoring with sharp, tiers and roles. A daytime building photo never becomes a hero or a
// home image, and darkness alone never qualifies.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { metricsFromRaw, visualScore, measureImage, loadSharp } from '../pipeline/lib/visual.mjs'
import { assessCandidate, tierOf, heroEligible, chooseImages, commonsCandidate, imageObject, nameEvidence, BAD_NAME, thumbAt, cleanMediaUrl, commonsDisplay, mediaActive, stableImageId } from '../pipeline/lib/images.mjs'
import { workNames } from '../pipeline/lib/identity.mjs'
import { personEvidence, creatorMention, kindOf, rightsUse, assessText } from '../pipeline/lib/images.mjs'
import { contactSheet, drawText, tilePixels, tileShowsPicture } from '../pipeline/lib/contact-sheet.mjs'
import { loadConfig } from '../pipeline/run.mjs'
import { FIXTURES } from './fixtures/pipeline/fake-fetch.mjs'
import { fileRecord } from '../pipeline/lib/commons.mjs'

const TH = loadConfig().pipeline.images
const SHARP = await loadSharp().then(() => true, () => false)
const needSharp = SHARP ? {} : { skip: 'sharp is not installed (npm ci --prefix pipeline)' }
const thumb = (kind) => readFileSync(path.join(import.meta.dirname, 'fixtures/pipeline/thumbs', kind + '.jpg'))
// As fetchCommonsPages hands pages to fileRecord: template titles collected over every continuation round.
const info = (file) => { const pg = FIXTURES.files.get(file).page; return fileRecord(file, { ...pg, templates: pg.templates.map((t) => t.title), templatesComplete: true }) }

/** A raw RGB frame: background colour plus a share of pixels in another colour. */
function frame(bg, spot = null, share = 0) {
  const w = 40, h = 30, data = Buffer.alloc(w * h * 3)
  for (let i = 0; i < w * h; i++) { const c = spot && (i % 100) < share * 100 ? spot : bg; data[i * 3] = c[0]; data[i * 3 + 1] = c[1]; data[i * 3 + 2] = c[2] }
  return metricsFromRaw(data, { width: w, height: h, channels: 3 })
}

test('visual metrics (no sharp needed): a dark frame with saturated bright light scores; darkness alone and daylight do not', () => {
  const led = frame([8, 8, 14], [255, 30, 160], 0.15)
  const dark = frame([6, 6, 8])
  const darkWhite = frame([6, 6, 8], [200, 200, 205], 0.05) // street lights: bright but not saturated
  const day = frame([170, 200, 235], [200, 200, 200], 0.4)
  const colourfulDay = frame([245, 245, 250], [255, 40, 90], 0.4)
  assert.ok(visualScore(led) >= 60, JSON.stringify(led))
  assert.equal(visualScore(dark), 0, 'darkness alone never qualifies')
  assert.equal(visualScore(darkWhite), 0, 'dark with white light only is not media')
  assert.equal(visualScore(day), 0)
  assert.equal(visualScore(colourfulDay), 0, 'a bright frame scores 0 however colourful')
  assert.ok(led.colourfulness > 20 && led.saturated_bright >= 0.1 && led.mean_luminance < 0.2)
  // Hasler–Süsstrunk colourfulness of a grey frame is 0.
  assert.equal(frame([128, 128, 128]).colourfulness, 0)
})

test('visual scores of the fixture thumbnails (sharp, 320 px)', needSharp, async () => {
  const m = {}
  for (const k of ['night_led', 'night_projection', 'night_field', 'day', 'colourful_day', 'dark_only', 'night_dim', 'interior']) m[k] = await measureImage(thumb(k), 320)
  assert.equal(m.night_led.width, 320)
  for (const k of ['night_led', 'night_projection', 'night_field']) assert.ok(m[k].visual >= TH.hero_visual_threshold, k + ' ' + JSON.stringify(m[k]))
  for (const k of ['day', 'colourful_day', 'dark_only', 'night_dim', 'interior']) assert.equal(m[k].visual, 0, k)
  assert.ok(m.dark_only.mean_luminance < 0.1, 'the dark-only frame is really dark')
})

const assessed = (file, source, projectType = 'media_facade', category = null) => assessCandidate({ file, source, category }, info(file), { project_type: projectType, rightsPolicy: TH.rights_policy, minWidth: TH.min_width, minHeight: TH.min_height })

test('rights: licence allowlist, foreign NoFoP, the Korean FoP policy, deletion templates, formats', () => {
  assert.equal(assessed('The Bay Lights at night 2013.jpg', 'p18').ok, true)
  assert.deepEqual(assessed('Lyon Fete des lumieres crowd.jpg', 'category', 'festival_program').reasons, ['rights:license_not_allowed'], 'CC BY-NC is not free')
  assert.deepEqual(assessed('Fete des Lumieres Place des Terreaux.jpg', 'category', 'festival_program').reasons, ['rights:foreign_no_freedom_of_panorama'])
  const kr = assessed('Lotte World Tower media facade at night.jpg', 'night_category')
  assert.equal(kr.ok, true, 'South Korea: shown under the non-sale display policy')
  assert.equal(kr.kr_fop, true)
  const krOff = assessCandidate({ file: 'Lotte World Tower media facade at night.jpg', source: 'night_category' }, info('Lotte World Tower media facade at night.jpg'), { project_type: 'media_facade', rightsPolicy: { krFopDisplay: false } })
  assert.deepEqual(krOff.reasons, ['rights:kr_freedom_of_panorama_disabled'])
  const base = info('The Bay Lights at night 2013.jpg')
  const variant = (o) => assessCandidate({ file: 'x.jpg', source: 'p18' }, { ...base, ...o }, { project_type: 'light_art' }).reasons
  assert.deepEqual(variant({ templates: ['Template:Delete'] }), ['rights:commons_deletion_or_permission_issue'])
  assert.deepEqual(variant({ templatesComplete: false }), ['rights:commons_templates_incomplete'], 'an incomplete template list is never guessed')
  assert.deepEqual(variant({ mime: 'image/svg+xml' }), ['rights:unsupported_type', 'format:image/svg+xml'])
  assert.deepEqual(variant({ license: 'All rights reserved' }), ['rights:license_not_allowed'])
  assert.deepEqual(variant({ width: 300, height: 200 }), ['too_small'])
  assert.deepEqual(assessed('Lotte World Tower interior lobby.jpg', 'category').reasons, ['interior_unrelated_to_work'])
  assert.ok(assessed('The Bay Lights map.png', 'category', 'light_art').reasons.includes('name:map_plan_logo_diagram_portrait_signature'))
  for (const n of ['Site plan', 'Logo of X', 'Map of Lyon', 'Portrait of the artist', 'Signature']) assert.ok(BAD_NAME.test(n), n)
  for (const n of ['Mapping festival', 'Planetarium', 'Logotherapy center']) assert.ok(!BAD_NAME.test(n), n)
})

test('keyword evidence in many languages; the night subcategory counts as night evidence', () => {
  const night = (t) => nameEvidence(t).night
  for (const t of ['Tower at night.jpg', 'Kölner Dom bei Nacht.jpg', 'Tour Eiffel de nuit.jpg', '롯데월드타워 야경.jpg', '東京タワー夜景.jpg', 'Projection on the palace.jpg', 'Fete des Lumieres 2019.jpg']) assert.ok(night(t) >= 30, t)
  assert.equal(night('Tower in summer.jpg'), 0)
  assert.ok(nameEvidence('Medienfassade Uniqa Tower.jpg').media >= 50)
  assert.ok(nameEvidence('미디어파사드 공연.jpg').media >= 50)
  const sub = assessed('The Bay Lights reflection night.jpg', 'night_category', 'light_art')
  assert.ok(sub.evidence.includes('night_subcategory'))
  const own = assessed('Signal festival 2019 projection.jpg', 'category', 'festival_program')
  assert.ok(own.evidence.includes('own_category_of_light_work'))
})

const M = { night: { mean_luminance: 0.1, colourfulness: 63, saturated_bright: 0.09, visual: 92 }, day: { mean_luminance: 0.79, colourfulness: 38, saturated_bright: 0, visual: 0 }, dark: { mean_luminance: 0.04, colourfulness: 3, saturated_bright: 0, visual: 0 }, brightColour: { mean_luminance: 0.8, colourfulness: 150, saturated_bright: 0.43, visual: 0 } }

const Q = { good: { sharpness: 80, blockiness: 3, phash: null }, blurred: { sharpness: 20, blockiness: 3, phash: null }, blocky: { sharpness: 80, blockiness: 60, phash: null } }

test('tiers 1–5 and surfaces: a daytime photo is never a home or hero image; darkness alone never qualifies', () => {
  const a = (night, media, evidence = []) => ({ night, media, evidence })
  const facade = { project_type: 'media_facade', width: 4000 }
  // Daytime photo of a media facade building with every keyword in its name: tier 3 at best, never home/hero.
  const day = tierOf(a(60, 100), M.day, TH, facade)
  assert.equal(day.home_ok, false)
  assert.ok(day.tier >= 3)
  assert.equal(heroEligible(a(60, 100), M.day, { width: 5000 }, day, TH, Q.good).ok, false)
  assert.equal(tierOf(a(0, 50), M.brightColour, TH, facade).home_ok, false)
  // Darkness alone, even with night keywords.
  const dark = tierOf(a(70, 0), M.dark, TH, facade)
  assert.equal(dark.home_ok, false)
  assert.ok(dark.tier >= 3)
  assert.deepEqual(heroEligible(a(70, 0), M.dark, { width: 5000 }, dark, TH, Q.good).reasons, ['tier_3', 'not_home_ok', 'no_media_evidence', 'visual_below_threshold'])
  // A media facade running at night, large: tier 1; the same on a light artwork: tier 2; a small original: tier 2.
  assert.deepEqual(tierOf(a(55, 45), M.night, TH, facade), { tier: 1, home_ok: true })
  assert.equal(tierOf(a(55, 45), M.night, TH, { project_type: 'light_art', width: 4000 }).tier, 2)
  assert.equal(tierOf(a(55, 45), M.night, TH, { project_type: 'media_facade', width: 1200 }).tier, 2)
  // An exhibition scene (tier 4) and a plain architectural photo (tier 5).
  assert.equal(tierOf({ ...a(0, 0, ['scene_terms']) }, M.day, TH, { project_type: 'media_architecture' }).tier, 4)
  assert.equal(tierOf(a(0, 0), M.day, TH, { project_type: 'media_architecture' }).tier, 5)
  const n = tierOf(a(55, 45), M.night, TH, facade)
  assert.equal(heroEligible(a(55, 45), M.night, { width: 4000 }, n, TH, Q.good).ok, true)
  // Widths: 2400 for a hero; 1920 only when the project has nothing larger (then flagged by chooseImages).
  assert.deepEqual(heroEligible(a(55, 45), M.night, { width: 2000 }, n, TH, Q.good).reasons, ['original_too_small'])
  assert.equal(heroEligible(a(55, 45), M.night, { width: 2000 }, n, TH, Q.good, { fallbackWidth: true }).ok, true)
  // Quality gates: a blurred or a heavily compressed image, or one never measured, is not a hero.
  assert.deepEqual(heroEligible(a(55, 45), M.night, { width: 4000 }, n, TH, Q.blurred).reasons, ['not_sharp_enough'])
  assert.deepEqual(heroEligible(a(55, 45), M.night, { width: 4000 }, n, TH, Q.blocky).reasons, ['compression_artefacts'])
  assert.deepEqual(heroEligible(a(55, 45), M.night, { width: 4000 }, n, TH, null).reasons, ['quality_not_measured'])
  assert.equal(tierOf(a(55, 45), null, TH, facade).home_ok, false, 'no measurement: never home')
  // media_active: the frame and the evidence, with reasons.
  const ma = mediaActive({ ...a(55, 45), night_terms: ['at night'], media_terms: ['media facade'] }, M.night)
  assert.ok(ma.score >= 60)
  assert.ok(ma.reasons.includes('dark_frame') && ma.reasons.includes('saturated_light'))
  assert.equal(mediaActive(a(55, 45), null).reasons[0], 'not_measured')
})

const cand = (file, m, night, media, { width = 4000, q = Q.good, provider = 'commons', approved = null, type = 'media_facade' } = {}) => {
  const i = { ...info('The Bay Lights at night 2013.jpg'), file, width }
  const c = provider === 'commons' ? commonsCandidate(i, { kr_fop: false }) : { provider, source_id: file, src: 'https://example.org/' + file, page: 'https://example.org/p', sizes: [[width, 'https://example.org/' + file]], width, license: 'CC BY 2.0', author: 'A', usage: 'cache' }
  return { key: provider === 'commons' ? file : stableImageId(provider, file), file: provider === 'commons' ? file : null, source: 'category', cand: c, a: { ok: true, night, media, evidence: [] }, m, q, width, height: Math.round(width * 2 / 3), approved, identity: { ok: true, method: provider === 'commons' ? 'commons_category_or_item' : 'name_location' }, t: tierOf({ night, media, evidence: [] }, m, TH, { project_type: type, width }) }
}

test('roles: hero only when reviewed and through every gate; featured needs a review outside Commons; card by tier and width; gallery of 12', () => {
  const p = { id: 'Q1' }
  const scored = [cand('Day.jpg', M.day, 0, 0), cand('Night.jpg', M.night, 55, 45), cand('Dark.jpg', M.dark, 60, 0), ...Array.from({ length: 14 }, (_, i) => cand(`Extra ${String(i).padStart(2, '0')}.jpg`, M.day, 0, 0))]
  const none = chooseImages(p, scored, { heroAllow: new Set(), blocked: new Set(), galleryMax: 12, th: TH })
  assert.equal(none.hero, null, 'no hero without a review')
  assert.equal(none.featured.key, 'Night.jpg', 'a Commons image may be featured without a review')
  assert.equal(none.card.key, 'Night.jpg')
  assert.equal(none.ordered.length, 12)
  assert.deepEqual(none.ordered.filter((x) => x.role === 'featured').map((x) => x.s.key), ['Night.jpg'])
  assert.ok(none.ordered.filter((x) => x.s.t.tier === 5).every((x) => x.role === 'context'))
  const allowDay = chooseImages(p, scored, { heroAllow: new Set(['Q1|Day.jpg', 'Q1|Dark.jpg']), blocked: new Set(), th: TH })
  assert.equal(allowDay.hero, null, 'an allowlisted daytime or dark-only photo is still refused')
  const allowNight = chooseImages(p, scored, { heroAllow: new Set(['Q1|Night.jpg']), blocked: new Set(), th: TH })
  assert.equal(allowNight.hero.key, 'Night.jpg')
  assert.equal(allowNight.ordered[0].role, 'hero')
  const blocked = chooseImages(p, scored, { heroAllow: new Set(['Q1|Night.jpg']), blocked: new Set(['Night.jpg']), th: TH })
  assert.equal(blocked.hero, null)
  // approve_image (approved: true) makes a tier-1/2 image a hero without the allowlist.
  assert.equal(chooseImages(p, [cand('Night.jpg', M.night, 55, 45, { approved: true })], { heroAllow: new Set(), blocked: new Set(), th: TH }).hero.key, 'Night.jpg')
  // 1920 px only when nothing larger exists: then flagged below target.
  const mid = chooseImages(p, [cand('Mid.jpg', M.night, 55, 45, { width: 2000, approved: true })], { heroAllow: new Set(), blocked: new Set(), th: TH })
  assert.equal(mid.hero.key, 'Mid.jpg')
  assert.equal(mid.decisions[0].below_target, true)
  assert.equal(imageObject(mid.hero, 'hero', { project: p, th: TH }).below_target, true)
  assert.equal(chooseImages(p, [cand('Mid.jpg', M.night, 55, 45, { width: 2000, approved: true }), cand('Big.jpg', M.night, 55, 45, { width: 3000 })], { heroAllow: new Set(), blocked: new Set(), th: TH }).hero, null, 'a larger image exists (not reviewed): the 2000 px one waits')
  // Featured from another provider only after a review; card prefers ≥ 1200 px.
  const ov = cand('ov-1', M.night, 55, 45, { provider: 'openverse' })
  assert.equal(chooseImages(p, [ov], { heroAllow: new Set(), blocked: new Set(), th: TH }).featured, null)
  assert.ok(chooseImages(p, [ov], { heroAllow: new Set(), blocked: new Set(), th: TH }).featuredDecisions[0].awaiting_review)
  assert.equal(chooseImages(p, [{ ...ov, approved: true }], { heroAllow: new Set(), blocked: new Set(), th: TH }).featured.key, ov.key)
  const cards = chooseImages(p, [cand('Small night.jpg', M.night, 55, 45, { width: 900 }), cand('Big day.jpg', M.day, 0, 0, { width: 3000 })], { heroAllow: new Set(), blocked: new Set(), th: TH })
  assert.equal(cards.card.key, 'Big day.jpg', 'the card needs 1200 px when an image that large exists')
  assert.equal(chooseImages(p, [cand('Small night.jpg', M.night, 55, 45, { width: 900 })], { heroAllow: new Set(), blocked: new Set(), th: TH }).card.key, 'Small night.jpg', 'a smaller card only when nothing larger exists')
  // Near-duplicates: the reviewed copy stays, else the larger one.
  const twinA = { ...cand('Copy A.jpg', M.night, 55, 45, { width: 4000 }), q: { ...Q.good, phash: '0123456789abcdef' } }
  const twinB = { ...cand('Copy B.jpg', M.night, 55, 45, { width: 1500 }), q: { ...Q.good, phash: '0123456789abcdee' } }
  const d = chooseImages(p, [twinA, twinB], { heroAllow: new Set(), blocked: new Set(), th: TH })
  assert.deepEqual(d.duplicates.map((x) => [x.key, x.kept]), [['Copy B.jpg', 'Copy A.jpg']])
  assert.deepEqual(chooseImages(p, [twinA, { ...twinB, approved: true }], { heroAllow: new Set(), blocked: new Set(), th: TH }).duplicates.map((x) => x.kept), ['Copy B.jpg'])
})

test('image objects: Commons URLs at standard widths without analytics parameters; licence, author, display never wider than the original', () => {
  const i = info('The Bay Lights at night 2013.jpg')
  const live = { ...i, thumburl: i.thumburl.replace('https://upload.', 'https://thumb.') + '?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail', url: i.url + '?utm_source=x' }
  const c = commonsCandidate(live, { kr_fop: false })
  assert.match(c.thumb, /^https:\/\/thumb\.wikimedia\.org\/.+\/500px-The_Bay_Lights_at_night_2013\.jpg$/, 'the host the API names, no utm')
  assert.equal(c.src, i.url, 'the original file')
  assert.deepEqual(c.sizes.map(([w]) => w), [330, 500, 960, 1280, 1920, 3840, 4000])
  assert.ok(c.sizes.every(([, u]) => !/utm_/.test(u)))
  assert.deepEqual(commonsDisplay({ ...i, width: 900 }).map(([w]) => w), [330, 500, 900], 'a narrow original: smaller steps, then the original')
  assert.deepEqual(commonsDisplay({ ...i, width: 5000, size: 20e6 }).map(([w]) => w), [330, 500, 960, 1280, 1920, 3840], 'a heavy original is not a display size')
  assert.equal(cleanMediaUrl('https://x.org/a.jpg?utm_source=a&w=3'), 'https://x.org/a.jpg?w=3')
  assert.equal(thumbAt('https://x/thumb/a/ab/F.jpg/330px-F.jpg?utm_content=thumbnail', 960), 'https://x/thumb/a/ab/F.jpg/960px-F.jpg')
  const s = cand('The Bay Lights at night 2013.jpg', M.night, 55, 45)
  const o = imageObject(s, 'card', { project: { id: 'Q7715933' }, checkedAt: '2026-10-20', th: TH })
  assert.equal(o.id, stableImageId('commons', 'The Bay Lights at night 2013.jpg'))
  assert.equal(o.project, 'Q7715933')
  assert.equal(o.license, 'CC BY-SA 4.0')
  assert.equal(o.author, 'Fixture Photographer 1')
  assert.equal(o.attribution, 'Fixture Photographer 1 · CC BY-SA 4.0 · Wikimedia Commons')
  assert.equal(o.usage, 'cache')
  assert.deepEqual(o.quality, { sharpness: 80, blockiness: 3, score: 88 })
  assert.equal(o.tier, 1)
  assert.equal(o.approved, null)
  assert.ok(!('identity' in o), 'Commons images prove identity by their category or item')
  assert.ok(o.display.every(([w]) => w <= o.width))
  const ov = imageObject({ ...cand('ov-1', M.night, 55, 45, { provider: 'openverse', width: 2048 }), cand: { provider: 'openverse', source_id: 'ov-1', src: 'https://live.staticflickr.com/1_k.jpg', page: 'https://www.flickr.com/photos/a/1/', sizes: [[2048, 'https://live.staticflickr.com/1_k.jpg'], [4096, 'https://too.big/x.jpg']], license: 'CC BY 2.0', author: 'A', usage: 'hotlink' } }, 'gallery', { project: { id: 'Q1' } })
  assert.deepEqual(ov.display, [[2048, 'https://live.staticflickr.com/1_k.jpg']], 'never wider than the original')
  assert.equal(ov.identity.method, 'name_location')
  assert.equal(ov.attribution, 'A · CC BY 2.0 · Openverse')
})

test('contact sheets: a JPEG grid with ASCII labels, missing images drawn as grey tiles', needSharp, async () => {
  const sharp = await loadSharp()
  const tiles = [{ buffer: thumb('night_led'), lines: ['#1 Q7715933', 'T1 V92 OK'] }, { buffer: null, lines: ['#2 SEOUL018', 'T- V-'] }, { buffer: Buffer.from('not an image'), lines: ['#3 X', '?'] }, { buffer: thumb('day'), lines: ['#4 Y', 'T5'] }]
  const jpg = await contactSheet(tiles)
  const meta = await sharp(jpg).metadata()
  assert.equal(meta.format, 'jpeg')
  assert.equal(meta.width, 6 * 220)
  assert.equal(meta.height, 165 + 36)
  // The pictures are composited, not just laid out: the fixture images' pixels are in their tiles, a missing or
  // undecodable image is the flat grey box (and reported as not drawn).
  assert.deepEqual(tiles.map((t) => t.drawn), [true, false, false, true])
  for (const i of [0, 3]) { const px = await tilePixels(jpg, i); assert.ok(tileShowsPicture(px) && px.grey < 0.2 && px.stdev > 8, `tile ${i} shows the picture ${JSON.stringify(px)}`) }
  for (const i of [1, 2]) { const px = await tilePixels(jpg, i); assert.ok(!tileShowsPicture(px) && px.grey > 0.95 && px.stdev < 3, `tile ${i} is grey ${JSON.stringify(px)}`) }
  const buf = Buffer.alloc(60 * 10 * 3)
  const x = drawText(buf, 60, 0, 0, 'A?', { scale: 1 })
  assert.equal(x, 12)
  assert.ok(buf.some((b) => b === 255))
})

test('institution files: the item\'s P18, depicts and category files are context unless they name the work, media or (outside works) the night', () => {
  const base = info('Signal festival 2019 projection.jpg')
  const file = (title, description, source, o = {}) => assessCandidate({ file: title + '.jpg', source, institution: o.institution ?? true },
    { ...base, object_name: title, description, categories: o.categories || [] }, { project_type: o.type || 'media_architecture', host: o.host ?? false, names: o.names || [], workNames: o.workNames || [], rightsPolicy: TH.rights_policy })
  const only = (a) => a.evidence.includes('host_building_only')
  // The museum's other views and the tower's neighbourhood: context.
  assert.ok(only(file('Connect Terrace Seoul Station', 'Connect Terrace at Seoul Station', 'category', { type: 'light_art' })))
  assert.ok(only(file('Seoul Aerial Shot 07', 'Aerial view of Seoul', 'depicts', { type: 'light_art' })))
  // A night view of the museum is not the immersive gallery inside it; a night view of the lit tower is its lighting.
  assert.ok(only(file('국립중앙박물관야간모습01', '국립중앙박물관 야간 모습', 'category', { host: true })))
  assert.ok(!only(file('N Seoul Tower at night 2019', 'The tower lit up at night', 'category', { type: 'light_art' })))
  assert.ok(only(file('N Seoul Tower at night 2019', 'The tower lit up at night', 'category', { type: 'light_art', host: true })), 'a host building at night is not a light work on it')
  assert.ok(!only(file('Lotte World Tower at night', 'Tower at night', 'category', { type: 'media_facade', host: true })), 'a facade shows after dark')
  // Naming the work or media rescues the file.
  const p = { name_ko: '국립중앙박물관 디지털 실감 영상관', name_en: 'NMK Immersive Digital Gallery', qid_match: 'host', item_institution: true, item_names: ['국립중앙박물관', 'National Museum of Korea'], building_name: '국립중앙박물관' }
  const wn = workNames(p)
  assert.ok(wn.length >= 2 && !wn.some((n) => n === '국립중앙박물관' || n === 'national museum of korea'), JSON.stringify(wn))
  // A curated place whose item is the place itself goes by the place's names: a photo naming it is the project's.
  assert.deepEqual(workNames({ name_en: 'Leeum Museum of Art', name_ko: '리움미술관', item_institution: true, item_names: ['Leeum, Samsung Museum of Art'] }).sort(), ['leeum', 'leeum museum of art', 'leeum samsung museum of art', 'samsung museum of art', '리움미술관'])
  assert.ok(workNames({ name_en: 'SeMA Seosomun Main Building', item_institution: true, item_names: ['Seoul Museum of Art'] }).includes('seoul museum of art'), 'a whole name of generic words is still a name')
  const lotte = workNames({ name_ko: '롯데월드타워 미디어파사드', name_en: 'Lotte World Tower Media Facade', qid_match: 'host', item_institution: true, item_names: ['롯데월드타워', 'Lotte World Tower'], building_name: '롯데월드타워' })
  assert.ok(lotte.length && !lotte.includes('롯데월드타워') && !lotte.includes('lotte world tower'), JSON.stringify(lotte))
  const tower = { name_en: 'N Seoul Tower', name_ko: 'N서울타워', item_institution: true, item_names: ['N Seoul Tower', 'N서울타워'] }
  const at = (title) => assessCandidate({ file: title + '.jpg', source: 'category', institution: true }, { ...base, object_name: title, description: '', categories: [] }, { project_type: 'light_art', workNames: workNames(tower), rightsPolicy: TH.rights_policy })
  assert.ok(!only(at('N-Seoul tower from Itaewon bridge pinhole')), 'names the place')
  for (const t of ['Cable car up the Seoul Tower (33580430468)', 'Korea Namsan NTower 06 (13238790903)', 'Haebangchon (55192249973)', 'Panoramic view of Seoul, South Korea']) assert.ok(only(at(t)), t)
  const named = file('국립중앙박물관 디지털 실감 영상관 파노라마', '몰입형 영상 전시', 'category', { host: true, workNames: wn })
  assert.ok(!only(named) && named.evidence.includes('institution_file:names_work'))
  assert.ok(!only(file('Museum media art wall', 'A media art wall in the lobby', 'category', { host: true })))
  // Event subcategories of an institution are not the work's editions; outside an institution they are.
  assert.ok(!file('Event 2012', 'A crowd', 'event_category', { type: 'festival_program' }).evidence.includes('event_subcategory'))
  assert.ok(file('Event 2012', 'A crowd', 'event_category', { type: 'festival_program', institution: false }).evidence.includes('event_subcategory'))
  // Not an institution file: unchanged.
  assert.ok(!only(file('Connect Terrace Seoul Station', 'Connect Terrace', 'category', { institution: false })))
  // People and ceremonies are irrelevant anywhere outside a festival's own photos.
  assert.ok(file('KOCIS Reenactment of a royal wedding on Mar 5, 2012 (6812195536)', 'Reenactment of a royal wedding', 'event_category').reasons.some((r) => r.startsWith('subject:people_or_event')))
  assert.ok(file('2010.11.11 G20 서울 정상회의 (7445962682)', 'G20 정상회의', 'event_category').reasons.some((r) => r.startsWith('subject:people_or_event')))
})

test('a light work\'s own category may show animals and objects as its motifs; elsewhere they are another subject', () => {
  const base = info('Signal festival 2019 projection.jpg')
  const at = (source, type = 'festival_program', institution = false) => assessCandidate({ file: 'Mirai Mizue, The Baby Birds of Norman McLaren.jpg', source, institution }, { ...base, object_name: 'The Baby Birds of Norman McLaren', description: 'Animation projected at the festival', categories: [] }, { project_type: type, rightsPolicy: TH.rights_policy })
  assert.deepEqual(at('category').reasons, [], 'own category of a festival')
  assert.ok(at('p18').reasons.some((r) => r.startsWith('subject:object_or_animal')), 'through P18')
  assert.ok(at('category', 'festival_program', true).reasons.some((r) => r.startsWith('subject:object_or_animal')), 'through an institution category')
  assert.ok(at('category', 'media_facade').reasons.some((r) => r.startsWith('subject:object_or_animal')), 'a facade has no motifs of its own category')
})

test('roles: an institution file is never the card, only context; a project with nothing else has no card', () => {
  const s = (key, width, evidence = [], tier = 5) => ({ key, file: key, cand: { provider: 'commons', source_id: key }, source: 'category', a: { ok: true, night: 0, media: 0, evidence }, m: null, q: null, t: { tier, home_ok: false }, width, approved: null })
  const p = { id: 'SEOUL043' }
  const opts = { heroAllow: new Set(), blocked: new Set(), th: TH }
  const mixed = chooseImages(p, [s('aerial.jpg', 4000, ['host_building_only']), s('tower small.jpg', 1000)], opts)
  assert.equal(mixed.card.key, 'tower small.jpg')
  assert.deepEqual(mixed.ordered.map((o) => [o.s.key, o.role]), [['tower small.jpg', 'card'], ['aerial.jpg', 'context']])
  const onlyInst = chooseImages(p, [s('aerial.jpg', 4000, ['host_building_only']), s('station.png', 1920, ['host_building_only'])], opts)
  assert.equal(onlyInst.card, null)
  assert.ok(onlyInst.ordered.every((o) => o.role === 'context'))
})

test('people: strong and weak signs, a creator named as the subject or as the author, structured depicts', () => {
  assert.equal(personEvidence(['Portrait of a visitor']).strong, 'portrait')
  assert.equal(personEvidence(['Night view'], ['Category:People of Seoul']).strong, 'category:People of Seoul')
  assert.equal(personEvidence(['Night view'], ["Category:People's Square"]).strong, null, "People's Square is a place")
  assert.equal(personEvidence(['Embarcadero walk'], [], { depictsHuman: true }).strong, 'depicts_human')
  assert.equal(personEvidence(['Visitors at the museum']).weak, 'visitors')
  assert.equal(personEvidence(['관람객이 몰입형 전시를 본다']).weak, '관람객')
  assert.deepEqual(creatorMention('Leo Villareal at The Bay Lights opening', ['Leo Villareal']), { name: 'Leo Villareal', attribution: false, subject: true })
  assert.deepEqual(creatorMention('The Bay Lights by Leo Villareal at night', ['Leo Villareal']), { name: 'Leo Villareal', attribution: true, subject: false })
  assert.deepEqual(creatorMention("Leo Villareal's The Bay Lights", ['Leo Villareal']), { name: 'Leo Villareal', attribution: true, subject: false })
  assert.equal(creatorMention('Leo Villareal 2013 (cropped)', ['Leo Villareal']).subject, true, 'a title that is only the name')
  assert.equal(creatorMention('Villareal lights', ['Leo Villareal']), null)
  // Live replay regressions (2026-10-26): artworks titled with their artist are photos of the work, not portraits;
  // scene categories with people in them and descriptions mentioning visitors are not person evidence.
  for (const [t, c] of [['Giny Vos - Lust for Life - 1999', 'Giny Vos'], ['Lichtsäule (Günther Uecker), Juni 2023', 'Günther Uecker'], ['Ugo Rondinone - Breathe Walk Die - 2016 - Museum Boijmans Van Beuningen Rotterdam 01', 'Ugo Rondinone']]) assert.equal(creatorMention(t, [c]).subject, false, t)
  for (const c of ['Category:People with motion blur', 'Category:Crowds in Japan', 'Category:People with fireworks', 'Category:People with white background']) assert.equal(personEvidence(['Kobe Luminarie'], [c]).strong, null, c)
  assert.equal(personEvidence(['TeamLab Borderless Azabudai Hills', 'Visitors are immersed in the Light Sculpture'], [], { titles: ['TeamLab Borderless Azabudai Hills'] }).weak, null)
  const base = info('The Bay Lights at night 2013.jpg')
  const at = (title, o = {}) => assessCandidate({ file: title + '.jpg', source: 'category' }, { ...base, object_name: title, description: o.description || '', categories: o.categories || [] }, { project_type: 'light_art', creators: ['Leo Villareal'], depictsHuman: () => !!o.human, rightsPolicy: TH.rights_policy })
  assert.equal(at('Leo Villareal at The Bay Lights opening 2013').portrait, 'Leo Villareal')
  assert.equal(at('The Bay Lights by Leo Villareal at night').portrait, undefined)
  assert.equal(at('Leo Villareal - The Bay Lights - 2013').portrait, undefined, 'artist - title - year is the work')
  assert.deepEqual(at('Epiphyte Chamber', { description: 'Visitors and an audience in the chamber' }).reasons, [], 'people words in a description describe the work')
  assert.ok(at('Visitors on the pier').reasons.includes('subject:person:visitors'))
  assert.ok(at('Visitors watching the light show at night').evidence.includes('people_in_frame'), 'people in a frame of the work at night stay')
  assert.ok(at('Pier walk', { human: true }).reasons.includes('subject:person:depicts_human'))
  assert.ok(at('Sunset', { categories: ['Category:Portrait photographs in San Francisco'] }).reasons.some((r) => r.startsWith('subject:person:category')))
  // Providers: tags count.
  const t = assessText({ title: 'Seoul night', tags: ['portrait', 'woman'], description: '' }, { project_type: 'media_facade' })
  assert.ok(t.reasons.includes('subject:person:portrait'))
})

test('image kinds: media, installation, context, technical and event documentation, portraits; documentation never the card', () => {
  const s = (key, tier, o = {}) => ({ key, file: key, cand: { provider: o.provider || 'commons', source_id: key }, source: 'category', identity: o.identity ?? { ok: true }, a: { ok: true, night: 40, media: 40, evidence: o.evidence || [], title_text: o.title || key, ...(o.portrait ? { portrait: o.portrait } : {}) }, m: null, q: null, t: { tier, home_ok: false }, width: o.width ?? 3000, approved: null })
  assert.equal(kindOf(s('a', 2)), 'project_media')
  assert.equal(kindOf(s('a', 4)), 'project_installation')
  assert.equal(kindOf(s('a', 5)), 'architecture_context')
  assert.equal(kindOf(s('a', 3, { title: 'LED modules installation work' })), 'technical_documentation')
  assert.equal(kindOf(s('a', 3, { title: 'Opening ceremony of the facade' }), 'media_facade'), 'event_documentation')
  assert.equal(kindOf(s('a', 2, { title: 'Festival opening night' }), 'festival_program'), 'project_media', "a festival's own night is its media")
  assert.equal(kindOf(s('a', 2, { portrait: 'Leo Villareal' })), 'artist_portrait')
  assert.equal(kindOf(s('a', 2, { provider: 'flickr', identity: { ok: false } })), 'unverified')
  const p = { id: 'Q7715933', project_type: 'light_art' }
  const opts = { heroAllow: new Set(), blocked: new Set(), th: TH }
  const c = chooseImages(p, [s('tech.jpg', 3, { title: 'Installation work: LED modules', width: 4000 }), s('day.jpg', 5, { width: 1300 }), s('artist.jpg', 2, { portrait: 'Leo Villareal' }), s('flickr-1', 2, { provider: 'flickr', identity: { ok: false } })], opts)
  assert.equal(c.card.key, 'day.jpg', 'technical documentation is never the card')
  assert.deepEqual(c.portraits.map((x) => x.key), ['artist.jpg'])
  assert.ok(!c.ordered.some((o) => ['artist.jpg', 'flickr-1'].includes(o.s.key)), 'portraits and unverified images never reach images[]')
  assert.deepEqual(rightsUse('KOGL Type 3'), { kogl_type: 3, commercial_use: true })
  assert.deepEqual(rightsUse('CC BY-NC-SA 2.0'), { commercial_use: false })
})
