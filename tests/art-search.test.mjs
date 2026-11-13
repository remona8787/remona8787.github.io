// v0.22 modules: the art photo policy (site-public-cleared/art-photo-policy.js), the search state in the address
// (site-public-cleared/search-state.js), and how the dataset reader uses the policy and the index metadata the
// pipeline writes (client/dataset-rows.mjs, pipeline/lib/output.mjs buildIndex).
import test from 'node:test'
import assert from 'node:assert/strict'
import ART from '../site-public-cleared/art-photo-policy.js'
import Q from '../site-public-cleared/search-state.js'
import * as R from '../client/dataset-rows.mjs'

// A reviewed Commons photo of the work, as the pipeline writes it.
const photo = (o = {}) => ({
  kind: 'project_media', project: 'Q1', page: 'https://commons.wikimedia.org/wiki/File:A.jpg', src: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/A.jpg',
  thumb: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/500px-A.jpg', license: 'CC BY-SA 4.0', author: 'Kim', width: 4000,
  quality: { sharpness: 80, blockiness: 5, score: 85 }, media_active: { score: 72, reasons: ['visual:72', 'dark_frame', 'saturated_light'] }, approved: null, role: 'card', ...o,
})

test('art photo policy: a photo represents the work only with rights, size, identity and visual evidence', () => {
  assert.equal(ART.isRepresentative(photo()), true)
  assert.equal(ART.isRepresentative(photo({ approved: true, media_active: { score: 10, reasons: [] } })), true, 'an editor-reviewed photo needs no score')
  assert.equal(ART.classify(photo({ license: 'CC BY-NC 2.0' })).reason, 'rights', 'non-commercial licences are never representative')
  assert.equal(ART.classify(photo({ author: '' })).reason, 'rights')
  assert.equal(ART.classify(photo({ width: 600 })).reason, 'quality', 'below the B floor of 640 px')
  assert.equal(ART.classify(photo({ quality: { sharpness: 10, blockiness: 5 } })).reason, 'quality')
  assert.equal(ART.classify(photo({ media_active: { score: 72, reasons: ['visual:72'] } })).reason, 'identity', 'a score without a visual reason is no evidence')
  assert.equal(ART.classify(photo({ kind: 'architecture_context' })).reason, 'visual', 'the building is context, not the work')
  assert.equal(ART.classify(photo({ media_active: { score: 72, reasons: ['visual:72', 'institution_file:museum'] } })).reason, 'institution_context')
  assert.equal(ART.classify(photo({ approved: false })).reason, 'not_cleared')
  assert.equal(ART.classify(photo({ art_representative: false })).reason, 'source_rejected')
  assert.equal(ART.kindOf({ role: 'portrait' }), 'artist_portrait')
  assert.equal(ART.kindOf({ context: true }), 'architecture_context')
  assert.equal(ART.kindOf({}), 'unverified')
  // The record's representative: card, then featured, then hero, then any representative photo.
  const card = photo({ role: 'card', thumb: 'c' }), hero = photo({ role: 'hero', thumb: 'h' }), ctx = photo({ role: 'card', kind: 'architecture_context', thumb: 'x' })
  assert.equal(ART.representativeOf({ images: [hero, card] }), card)
  assert.equal(ART.representativeOf({ images: [ctx, hero] }), hero)
  assert.equal(ART.representativeOf({ images: [ctx] }), null)
})

test('art photo policy (v0.26.2): a photo the collector tied to the work and classed as the work needs no score of 40', () => {
  const low = { media_active: { score: 12, reasons: ['visual:20', 'media_terms:lichtkunst'] } }
  assert.equal(ART.classify(photo({ ...low, tier: 3 })).reason, 'identity', 'without the collector\'s identity a low score is not enough')
  const tied = photo({ ...low, tier: 3, identity: { ok: true, method: 'commons_category' } })
  assert.equal(ART.isRepresentative(tied), true)
  assert.equal(ART.classify(tied).visual.collector_verified, true)
  assert.equal(ART.isRepresentative(photo({ ...low, kind: 'project_installation', tier: 4, identity: { ok: true, method: 'commons_category' } })), true, 'the installation in its own category')
  assert.equal(ART.classify(photo({ ...low, kind: 'architecture_context', tier: 5, identity: { ok: true, method: 'commons_p18' } })).reason, 'visual', 'the building stays context')
  assert.equal(ART.classify(photo({ ...low, tier: 3, identity: { ok: false, method: 'commons_institution_file' } })).reason, 'identity', 'an institution file is no proof of the work')
  assert.equal(ART.classify(photo({ ...low, tier: 3, identity: { ok: true, method: 'commons_category' }, width: 600 })).reason, 'quality', 'size still applies')
  assert.equal(ART.classify(photo({ ...low, tier: 3, identity: { ok: true, method: 'commons_category' }, license: 'CC BY-NC 2.0' })).reason, 'rights', 'rights still apply')
  assert.equal(ART.classify(photo({ ...low, tier: 3, identity: { ok: true, method: 'commons_category' }, media_active: { score: 72, reasons: ['visual:72', 'institution_file:museum'] } })).reason, 'institution_context')
})

test('art photo policy (v2.0): grades A premium, B general, C context; rights and identity are the same for all', () => {
  const g = (o) => ART.gradeOf(photo(o))
  assert.equal(g({}), 'A', '4000 px, sharp, clean')
  assert.equal(g({ width: 1200 }), 'B', 'under 1600 px: general use only')
  assert.equal(g({ width: 800, quality: null }), 'B', 'unmeasured, 640 px or wider')
  assert.equal(g({ quality: { sharpness: 70, blockiness: 34 } }), 'B', 'blockiness 34: no visible blocking at card size (Fibonacci-Reihe sample)')
  assert.equal(g({ quality: { sharpness: 70, blockiness: 60 } }), 'B')
  assert.equal(ART.classify(photo({ quality: { sharpness: 52, blockiness: 72 } })).reason, 'quality', 'above 60 needs an editor who viewed it')
  assert.equal(ART.classify(photo({ quality: { sharpness: 23, blockiness: 10 } })).reason, 'quality', 'blur keeps the A bar in B (sharpness 17-23 samples were soft)')
  assert.equal(g({ quality: { sharpness: 52, blockiness: 72 }, editor_grade: 'B', width: 1195 }), 'B', 'an editor who viewed it may grade it B')
  assert.equal(g({ editor_grade: 'A', width: 1195 }), 'B', 'an editor grade never lifts the width floor: A needs 1600 px')
  assert.equal(ART.classify(photo({ editor_grade: 'B', width: 600 })).reason, 'quality', 'nor the B floor')
  assert.equal(ART.classify(photo({ editor_grade: 'C' })).reason, 'editor_context')
  assert.equal(g({ editor_grade: 'C' }), 'C', 'an editor may keep a photo as context')
  assert.equal(g({ kind: 'architecture_context' }), 'C', 'a building photo with its rights is context')
  assert.equal(g({ license: 'CC BY-NC 2.0' }), null, 'without rights no grade at all, context included')
  assert.equal(g({ editor_grade: 'B', license: 'CC BY-NC 2.0' }), null, 'an editor grade never replaces rights')
  assert.equal(g({ editor_grade: 'B', media_active: { score: 72, reasons: ['visual:72'] } }), 'C', 'nor identity')
  assert.equal(ART.isPremium(photo()), true)
  assert.equal(ART.isPremium(photo({ width: 1200 })), false)
  assert.equal(ART.gradeOf({ ...photo(), art_representative: true }), 'B', 'a carried verdict without a grade is general use')
  assert.equal(ART.gradeOf({ ...photo(), art_representative: true, art_grade: 'A' }), 'A')
  // Every photo the old single bar accepted (900 px, sharpness 25, blockiness 30) is still representative.
  for (const width of [900, 1200, 1600, 4000]) for (const sharpness of [25, 60, 100]) for (const blockiness of [0, 15, 30]) assert.equal(ART.isRepresentative(photo({ width, quality: { sharpness, blockiness } })), true, `${width}/${sharpness}/${blockiness}`)
})

test('search state: filters, scope and view round-trip through the address; anything else is dropped', () => {
  const hash = Q.write('explore', { filters: { q: ' 서울 ', project_type: ['media_facade', 'BAD TYPE'], has_photo: true, year_from: '2010', sort: 'newest', category: '전체' }, scope: 'korea', view: 'rows' })
  assert.equal(hash, '#explore?q=%EC%84%9C%EC%9A%B8&project_type=media_facade&has_photo=1&year_from=2010&sort=newest&scope=korea&view=rows')
  const back = Q.read(hash)
  assert.deepEqual(back, { path: 'explore', hasState: true, filters: { q: '서울', project_type: ['media_facade'], has_photo: true, year_from: '2010', sort: 'newest' }, scope: 'korea', view: 'rows' })
  assert.equal(Q.write('place/AR-x', { filters: { q: 'x' } }), '#place/AR-x', 'only explore, map and data carry a search')
  assert.equal(Q.read('#place/AR-x'), null)
  assert.equal(Q.read('#map').hasState, false)
  assert.equal(Q.write('map', {}), '#map?', 'an explicit empty search')
  assert.deepEqual(Q.clean({ year: '0999', sort: 'relevance', region: 'europe,asia', kind: 'x'.repeat(50) }), { kind: 'x'.repeat(40), region: ['europe', 'asia'] })
  // No results: keep the words, drop the photo condition or the place.
  assert.deepEqual(Q.relax({ q: 'a', has_photo: true, city: 'Seoul', kr_region: ['seoul'] }, 'photos'), { q: 'a', city: 'Seoul', kr_region: ['seoul'] })
  assert.deepEqual(Q.relax({ q: 'a', has_photo: true, city: 'Seoul', kr_region: ['seoul'] }, 'location'), { q: 'a', has_photo: true })
})

test('dataset reader: index thumbnails are work photos only when the index says so; precision and no-derivatives by id', () => {
  const fields = ['id', 'name_en', 'country_iso2', 'lat', 'lng', 'thumb', 'visual_rank', 'shard']
  const row = (id, lat = 48.2, lng = 16.4) => [id, 'Work ' + id, 'AT', lat, lng, 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/' + id + '.jpg/500px-' + id + '.jpg', 2, '000']
  const rows = [row('Q1'), row('Q2'), row('Q3')]
  const plain = R.fromIndex({ fields, rows })
  assert.deepEqual(plain.map(p => p.card_kind), [null, null, null])
  assert.equal(R.cardMedia(plain[0], null).art_representative, false, 'an index without the policy claims nothing')
  const art = R.fromIndex({ fields, rows, representative_policy: 'artwork_only', thumb_kind_default: 'project_media', thumb_installation_rows: [1], thumb_no_derivatives: ['Q3'], location_precision: { Q2: 'approximate', Q3: 'city' } })
  assert.deepEqual(art.map(p => p.card_kind), ['project_media', 'project_installation', 'project_media'])
  const m = art.map(p => R.cardMedia(p, null))
  assert.deepEqual(m.map(x => [x.kind, x.art_representative, x.no_derivatives]), [['project_media', true, false], ['project_installation', true, false], ['project_media', true, true]])
  assert.deepEqual(art.map(p => [p.location_precision, p.coordinate_review_status]), [['exact', 'source'], ['approximate', null], ['unknown', null]], 'only exact or street positions count as sourced coordinates')
  // A home card whose image is not a work photo shows no photo (not the index thumbnail either).
  const home = R.fromHome({ build_id: 'b', projects: { Q9: { name_en: 'Nine', country_iso2: 'AT', image: { ...photo({ kind: 'architecture_context' }), tier: 4 } } }, featured: ['Q9'] })
  assert.equal(home.media.length, 0)
  assert.equal(R.fromHome({ build_id: 'b', counts: { with_images: 9, with_art_representative: 4 } }).counts.with_images, 4)
})
