// Pipeline images (docs/STATIC_ARCHIVE.md "Images (per-surface rules)"): rights checks reused from live-media.mjs,
// keyword evidence, visual scoring with sharp, tiers and roles. A daytime building photo never becomes a hero or a
// home image, and darkness alone never qualifies.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { metricsFromRaw, visualScore, measureImage, loadSharp } from '../pipeline/lib/visual.mjs'
import { assessCandidate, tierOf, heroEligible, chooseImages, publicImage, nameEvidence, BAD_NAME, thumbAt } from '../pipeline/lib/images.mjs'
import { contactSheet, drawText } from '../pipeline/lib/contact-sheet.mjs'
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

test('tiers and surfaces: a daytime photo is never a home or hero image; darkness alone never qualifies', () => {
  const a = (night, media) => ({ night, media, evidence: [] })
  // Daytime photo of a media facade building with every keyword in its name: still tier 3 at best, never home/hero.
  const day = tierOf(a(60, 100), M.day, TH)
  assert.equal(day.home_ok, false)
  assert.ok(day.tier >= 2)
  assert.equal(heroEligible(a(60, 100), M.day, { width: 5000 }, day, TH).ok, false)
  // A bright colourful daytime frame.
  assert.equal(tierOf(a(0, 50), M.brightColour, TH).home_ok, false)
  // Darkness alone, even with night keywords.
  const dark = tierOf(a(70, 0), M.dark, TH)
  assert.equal(dark.home_ok, false)
  assert.notEqual(dark.tier, 1)
  assert.deepEqual(heroEligible(a(70, 0), M.dark, { width: 5000 }, dark, TH).reasons, ['not_home_ok', 'no_media_evidence', 'visual_below_threshold'])
  // Media running at night.
  const n = tierOf(a(55, 45), M.night, TH)
  assert.deepEqual(n, { tier: 1, home_ok: true })
  assert.equal(heroEligible(a(55, 45), M.night, { width: 4000 }, n, TH).ok, true)
  assert.deepEqual(heroEligible(a(55, 45), M.night, { width: 1200 }, n, TH).reasons, ['original_too_small'])
  // No measurement: never home.
  assert.equal(tierOf(a(55, 45), null, TH).home_ok, false)
})

const cand = (file, m, night, media, width = 4000) => ({ file, source: 'category', a: { ok: true, night, media, evidence: [], kr_fop: false }, m, info: { ...info('The Bay Lights at night 2013.jpg'), file, width }, t: tierOf({ night, media, evidence: [] }, m, TH) })

test('roles: hero only from the reviewed allowlist and the visual gates; card by tier; gallery of 12, hero first', () => {
  const p = { id: 'Q1' }
  const scored = [cand('Day.jpg', M.day, 0, 0), cand('Night.jpg', M.night, 55, 45), cand('Dark.jpg', M.dark, 60, 0), ...Array.from({ length: 14 }, (_, i) => cand(`Extra ${String(i).padStart(2, '0')}.jpg`, M.day, 0, 0))]
  const none = chooseImages(p, scored, { heroAllow: new Set(), blocked: new Set(), galleryMax: 12, th: TH })
  assert.equal(none.hero, null, 'no hero without the allowlist')
  assert.equal(none.card.file, 'Night.jpg')
  assert.equal(none.images.length, 12)
  assert.deepEqual(none.images.filter((i) => i.role === 'card').map((i) => i.file), ['Night.jpg'])
  const allowDay = chooseImages(p, scored, { heroAllow: new Set(['Q1|Day.jpg', 'Q1|Dark.jpg']), blocked: new Set(), th: TH })
  assert.equal(allowDay.hero, null, 'an allowlisted daytime or dark-only photo is still refused')
  const allowNight = chooseImages(p, scored, { heroAllow: new Set(['Q1|Night.jpg']), blocked: new Set(), th: TH })
  assert.equal(allowNight.hero.file, 'Night.jpg')
  assert.equal(allowNight.images[0].role, 'hero')
  assert.equal(allowNight.images[0].tier, 1)
  const blocked = chooseImages(p, scored, { heroAllow: new Set(['Q1|Night.jpg']), blocked: new Set(['Night.jpg']), th: TH })
  assert.equal(blocked.hero, null)
  // Only daytime photos: the card is tier 4 (allowed below the media tiers, never on the home page).
  const dayOnly = chooseImages(p, [cand('Day.jpg', M.day, 0, 0)], { heroAllow: new Set(), blocked: new Set(), th: TH })
  assert.equal(dayOnly.card.t.tier, 4)
  assert.equal(dayOnly.card.t.home_ok, false)
})

test('public image objects: licence and author always present, standard thumbnail steps', () => {
  const i = info('The Bay Lights at night 2013.jpg')
  const card = publicImage(i, 'card')
  assert.match(card.thumb, /\/500px-The_Bay_Lights_at_night_2013\.jpg$/)
  assert.match(card.src, /\/1280px-/)
  assert.match(publicImage(i, 'hero').src, /\/1920px-/)
  assert.equal(card.license, 'CC BY-SA 4.0')
  assert.equal(card.author, 'Fixture Photographer 1')
  assert.equal(card.attribution, 'Fixture Photographer 1 · CC BY-SA 4.0 · Wikimedia Commons')
  assert.match(card.page, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/)
  const small = publicImage({ ...i, width: 900 }, 'card')
  assert.equal(small.src, i.url, 'no upscaled thumbnail: a narrow original is used as it is')
  assert.equal(thumbAt('https://x/thumb/a/ab/F.jpg/330px-F.jpg', 500), 'https://x/thumb/a/ab/F.jpg/500px-F.jpg')
})

test('contact sheets: a JPEG grid with ASCII labels, missing images drawn as grey tiles', needSharp, async () => {
  const sharp = await loadSharp()
  const jpg = await contactSheet([{ buffer: thumb('night_led'), lines: ['#1 Q7715933', 'T1 V92 OK'] }, { buffer: null, lines: ['#2 SEOUL018', 'T- V-'] }, { buffer: Buffer.from('not an image'), lines: ['#3 X', '?'] }])
  const meta = await sharp(jpg).metadata()
  assert.equal(meta.format, 'jpeg')
  assert.equal(meta.width, 6 * 220)
  assert.equal(meta.height, 165 + 36)
  const buf = Buffer.alloc(60 * 10 * 3)
  const x = drawText(buf, 60, 0, 0, 'A?', { scale: 1 })
  assert.equal(x, 12)
  assert.ok(buf.some((b) => b === 255))
})
