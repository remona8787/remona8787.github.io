// The app's side of the media facade archive (docs/ARCHIVE_SPEC.md §6): rows of public_archive_projects → places,
// the coordinate rule, media, search facets, similar projects, statistics and the research export.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { ARCHIVE_COLUMN_LIST, ARCHIVE_COLUMNS, fromArchiveRows, rowToPlace, archiveCoords, archiveMedia, CATEGORY_OF_TYPE } from '../client/archive-rows.mjs'
import { ARCHIVE_ROWS } from './fixtures/archive-app-rows.mjs'

const require = createRequire(import.meta.url)
const X = require('../site-public-cleared/catalog.js')
const T = require('../site-public-cleared/archive-taxonomy.js')
const PUBLIC = 'https://light.example.org'
const { projects, media } = fromArchiveRows(ARCHIVE_ROWS, { publicURL: PUBLIC })
const by = Object.fromEntries(projects.map(p => [p.archive_slug, p]))
const today = '2026-10-18'

test('the columns read are the view columns of the spec, without editors or visibility', () => {
  assert.equal(ARCHIVE_COLUMNS, ARCHIVE_COLUMN_LIST.join(','))
  for (const c of ['slug', 'name_original', 'country_iso2', 'latitude', 'location_precision', 'project_type', 'technology', 'content_type', 'spatial_context', 'record_origin', 'review_status', 'field_status', 'credits', 'sources', 'media', 'assessments', 'curated_place_id', 'wikidata_qid', 'discovered_qid']) assert.ok(ARCHIVE_COLUMN_LIST.includes(c), c)
  for (const c of ['created_by', 'updated_by', 'visibility', 'id']) assert.ok(!ARCHIVE_COLUMN_LIST.includes(c), c)
  // Every taxonomy field the project page shows is read (technology/content_type become the client's plural fields).
  for (const f of Object.values(T.fields).flat()) assert.ok(ARCHIVE_COLUMN_LIST.includes(f), f)
})

test('rows become archive places with every §6 field; unusable rows are dropped, unknown values become null', () => {
  assert.equal(projects.length, ARCHIVE_ROWS.length - 2, 'no slug and no name are dropped')
  assert.ok(!by.nameless)
  const a = by['ars-electronica-center']
  assert.equal(a.place_id, 'AR-ars-electronica-center')
  assert.equal(a.origin, 'archive')
  assert.deepEqual([a.name_kr, a.name_en, a.name_original, a.name_original_lang], ['아르스 일렉트로니카 센터', 'Ars Electronica Center', 'Ars Electronica Center', 'de'])
  for (const f of ['project_type', 'region', 'country_iso2', 'name_original', 'year_installed', 'year_completed', 'operating_status', 'building_name', 'installation_method', 'envelope_type', 'technologies', 'content_types', 'display_area_m2', 'resolution_text', 'interactive', 'spatial_context', 'viewing_points', 'urban_context', 'credits', 'sources', 'assessments', 'record_origin', 'review_status', 'field_status', 'first_collected_at', 'last_collected_at', 'last_verified_at', 'update_status']) assert.ok(f in a, f)
  assert.deepEqual([a.project_type, a.region, a.country_iso2, a.country, a.city], ['media_facade', 'europe', 'AT', '오스트리아', 'Linz'])
  assert.deepEqual(a.technologies, ['led_rgb', 'realtime_data'])
  assert.deepEqual(a.content_types, ['artwork', 'generative'])
  assert.equal(a.primary_category, 'Media Facade')
  assert.equal(a.review_status, 'researcher_assessed')
  assert.equal(a.field_status.interactive.state, 'researcher_assessed')
  assert.equal(a.sources[0].kind, 'official')
  assert.deepEqual(a.sources[0].supports, ['latitude', 'longitude', 'year_installed', 'operating_status'])
  assert.equal(a.assessments[0].confidence, 'medium')
  assert.equal(by['crown-fountain'].assessments[0].value, '{"level":"high","basis":"water play"}', 'structured values are kept as JSON text')
  // Nothing outside the vocabularies survives, and nothing is guessed in its place.
  const bad = by['bad-values']
  assert.deepEqual([bad.country_iso2, bad.region, bad.project_type, bad.installation_method, bad.operating_status, bad.year_installed, bad.review_status, bad.official_url, bad.website], [null, null, null, null, null, null, 'unreviewed', null, ''])
  assert.deepEqual(bad.technologies, ['led_rgb'])
  assert.deepEqual(Object.keys(bad.field_status), ['project_type'], 'an unknown field state is dropped')
  assert.equal(bad.latitude, null)
  // Names: decomposed unicode is kept as given (search normalizes it), Arabic names stay intact.
  assert.equal(by['fete-des-lumieres'].name_original, 'Fête des Lumières')
  assert.equal(by['burj-khalifa-led'].name_original, 'برج خليفة')
  // A Korean name first, else English, else the original.
  assert.equal(by['greenpix-media-wall'].name_kr, 'GreenPix Zero Energy Media Wall')
  assert.equal(rowToPlace({ slug: 'x', name_original: 'برج' }).name_kr, 'برج')
  assert.equal(by['piccadilly-lights'].name_kr, '피카딜리 라이츠')
  assert.equal(by['spectra-marina-bay'].name_kr, 'Spectra – A Light & Water Show')
  assert.equal(by['vivid-sydney'].scope, 'world'); assert.equal(by['busan-cinema-center-big-roof'].scope, 'korea')
  assert.equal(rowToPlace({ slug: '../etc', name_en: 'x' }), null, 'slugs are ids, never paths')
})

test('coordinate rule: exact or street precision; verified only when an editor or researcher confirmed them; otherwise only with a source that reports them', () => {
  const kind = s => X.coordKind(by[s])
  for (const s of ['ars-electronica-center', 'kunsthaus-graz-bix', 'torre-glories-led', 'busan-cinema-center-big-roof', 'spectra-marina-bay', 'burj-khalifa-led', 'times-square-screens', 'crown-fountain']) assert.equal(kind(s), 'verified', s)
  for (const s of ['allianz-arena-skin', 'shibuya-crossing-screens', 'nelson-mandela-bridge-light', 'conjunto-nacional-sao-paulo']) assert.equal(kind(s), 'source', s)
  // City-level points, coordinates nobody reports, and missing ones stay off the map.
  for (const s of ['greenpix-media-wall', 'vivid-sydney', 'khan-shatyr-lighting', 'federation-square-screen', 'piccadilly-lights', 'sphere-exosphere', 'csmt-heritage-projection', 'bad-values']) assert.equal(kind(s), null, s)
  assert.equal(by['ars-electronica-center'].coordinate_source_url, 'https://ars.electronica.art/center/', 'the source that reports them')
  assert.equal(by['times-square-screens'].coordinate_source_url, PUBLIC + '/#place/AR-times-square-screens', 'verified without a source: the archive record')
  assert.equal(by['allianz-arena-skin'].coordinate_source_url, 'https://news.example.org/allianz-arena-led')
  // A broken source never backs coordinates; (0, 0) is a placeholder, not a place.
  const row = { latitude: 10, longitude: 10, location_precision: 'exact', field_status: {} }
  assert.equal(archiveCoords(row, [{ url: 'https://x.example/', link_state: 'broken', supports: ['latitude'] }], null).latitude, null)
  assert.equal(archiveCoords({ ...row, latitude: 0, longitude: 0, field_status: { latitude: { state: 'editor_verified' } } }, [], 'https://a/').latitude, null)
  // Both coordinates must be confirmed for the pin.
  assert.equal(archiveCoords({ ...row, field_status: { latitude: { state: 'editor_verified' }, longitude: { state: 'source_reported' } } }, [{ url: 'https://s.example/', link_state: 'ok', supports: ['latitude', 'longitude'] }], null).coordinate_review_status, 'source')
})

test('media: https images with a licence and a creator only, primary first, in the shape of the photo index', () => {
  const ars = media.filter(m => m.place_code === 'AR-ars-electronica-center')
  assert.equal(ars.length, 1)
  assert.deepEqual([ars[0].creator, ars[0].license_code, ars[0].clearance_status, ars[0].source_url], ['Kim Archive', 'CC BY-SA 4.0', 'cleared', 'https://commons.wikimedia.org/wiki/File:Ars_Electronica_Center_night.jpg'])
  assert.equal(media.filter(m => m.place_code === 'AR-shibuya-crossing-screens').length, 0, 'no licence, and http: neither shown')
  assert.equal(media.filter(m => m.place_code === 'AR-burj-khalifa-led').length, 1, 'a link that fails to load falls back in the app')
  assert.deepEqual(archiveMedia('AR-x', [{ url: 'https://a.example/1.jpg', license: 'CC0', attribution: 'Someone', is_primary: false }, { url: 'https://a.example/2.jpg', license: 'CC0', author: 'Main', is_primary: true }]).map(m => m.creator), ['Main', 'Someone'])
})

test('search: archive facets, year range, origin groups, multilingual names and cities', () => {
  const s = f => X.search(projects, f, today).map(p => p.archive_slug)
  assert.deepEqual(s({ region: ['middle_east'] }).sort(), ['al-bahr-towers', 'burj-khalifa-led'])
  assert.deepEqual(s({ region: ['oceania', 'africa'] }).length, 4, 'any of the chosen regions')
  assert.deepEqual(s({ project_type: ['urban_screen'], technology: ['realtime_data'] }), ['piccadilly-lights'], 'facets combine with and')
  assert.ok(s({ technology: ['laser_projector', 'sensors'] }).includes('greenpix-media-wall'), 'technology: any of')
  assert.deepEqual(s({ envelope_type: ['membrane_etfe'] }).sort(), ['allianz-arena-skin', 'khan-shatyr-lighting'])
  assert.deepEqual(s({ operating_status: ['inactive'] }), ['greenpix-media-wall'])
  assert.deepEqual(s({ installation_method: ['kinetic'] }), ['al-bahr-towers'])
  // Year: installed, else completed, else operating since is not used (the filing year is documented).
  const years = s({ year_from: '2010', year_to: '2012' })
  for (const slug of ['busan-cinema-center-big-roof', 'khan-shatyr-lighting', 'al-bahr-towers', 'conjunto-nacional-sao-paulo']) assert.ok(years.includes(slug), slug)
  assert.ok(!years.includes('fete-des-lumieres'), 'no installed or completed year: excluded from a year range')
  assert.deepEqual(s({ origin: ['editor_verified'] }).length, projects.filter(p => p.record_origin !== 'curated' && ['editor_verified', 'researcher_assessed'].includes(p.review_status)).length)
  assert.ok(s({ origin: ['curated'] }).includes('coex-kpop-square-wave'), 'archive records of curated places')
  assert.ok(s({ origin: ['unreviewed'] }).includes('piccadilly-lights'))
  // Names in every language and alias, credits, buildings, cities and countries in Korean and English.
  assert.deepEqual(s({ q: 'fête' }), ['fete-des-lumieres'], 'NFD names are found by NFC queries')
  assert.deepEqual(s({ q: 'برج خليفة' }), ['burj-khalifa-led'])
  assert.deepEqual(s({ q: '渋谷' }), ['shibuya-crossing-screens'])
  assert.deepEqual(s({ q: 'AEC' }), ['ars-electronica-center'])
  assert.deepEqual(s({ q: 'Plensa' }), ['crown-fountain'])
  assert.ok(s({ q: '오스트리아' }).includes('kunsthaus-graz-bix'))
  assert.ok(s({ q: 'austria' }).includes('ars-electronica-center'))
  assert.ok(s({ q: '런던' }).includes('piccadilly-lights'), 'a city in Korean')
  assert.ok(s({ q: '미디어파사드' }).includes('torre-bbva-mexico'), 'type labels')
  assert.deepEqual(s({ country: 'AE' }).length, 2)
  assert.deepEqual(s({ country: '아랍에미리트' }).length, 2, 'by name as well')
  assert.deepEqual(s({ city: '서울' }).sort(), ['coex-kpop-square-wave', 'ddp-seoul-light', 'galleria-west-facade'], 'Seoul and 서울 are one city')
  // has_photo asks the app.
  assert.deepEqual(X.search(projects, { has_photo: true }, today, { hasPhoto: p => p.archive_slug === 'crown-fountain' }).map(p => p.archive_slug), ['crown-fountain'])
})

test('sorts: newest, recently updated, year either way (unknown last), name in the current language', () => {
  const sorted = (sort, ctx) => X.search(projects, { sort }, today, ctx).map(p => p.archive_slug)
  const yd = X.search(projects, { sort: 'year_desc' }, today).map(X.yearOf)
  const known = yd.filter(y => y !== null)
  assert.deepEqual(known, [...known].sort((a, b) => b - a)); assert.ok(yd.indexOf(null) === -1 || yd.slice(yd.indexOf(null)).every(y => y === null), 'unknown years last')
  const ya = X.search(projects, { sort: 'year_asc' }, today).map(X.yearOf).filter(y => y !== null)
  assert.deepEqual(ya, [...ya].sort((a, b) => a - b))
  const rows = ARCHIVE_ROWS.map(r => ({ ...r, first_collected_at: r.slug === 'cairo-tower-show' ? '2026-10-17T00:00:00.000Z' : r.first_collected_at, updated_at: r.slug === 'piccadilly-lights' ? '2026-10-18T01:00:00.000Z' : r.updated_at }))
  const list = fromArchiveRows(rows).projects
  assert.equal(X.search(list, { sort: 'newest' }, today)[0].archive_slug, 'cairo-tower-show')
  assert.equal(X.search(list, { sort: 'updated' }, today)[0].archive_slug, 'piccadilly-lights')
  const names = sorted('name', { name: p => p.name_en || p.name_kr, lang: 'en' }).map(s => by[s].name_en || by[s].name_kr)
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'en')))
  // Relevance: an exact name beats a match in a description or a credit.
  assert.equal(X.search(projects, { q: 'crown fountain' }, today)[0].archive_slug, 'crown-fountain')
})

test('facet counts: each facet counts with every other filter applied', () => {
  const c = X.facetCounts(projects, { region: ['europe'], project_type: ['media_facade'] }, today)
  assert.equal(c.region.europe, 3, 'regions counted without the region filter: the media facades in Europe')
  assert.equal(c.region.middle_east, 1)
  assert.equal(c.project_type.media_facade, 3)
  assert.equal(c.project_type.festival_program, 1, 'types counted without the type filter, in Europe')
  assert.equal(c.country.AT, 2)
  assert.deepEqual(X.activeFacets({ region: ['europe'], technology: ['led_rgb', 'sensors'] }), [['region', 'europe'], ['technology', 'led_rgb'], ['technology', 'sensors']])
})

test('similar projects: scored by type, method, technology, envelope, region and decade, with the reasons', () => {
  const list = X.similar(by['ars-electronica-center'], projects)
  assert.ok(list.length > 0 && list.length <= 6)
  assert.deepEqual(list.map(x => x.score), [...list.map(x => x.score)].sort((a, b) => b - a))
  const top = list[0]
  assert.ok(top.reasons.some(r => r[0] === 'type'), 'the best match shares the type')
  const kh = list.find(x => x.place.archive_slug === 'kunsthaus-graz-bix')
  assert.ok(kh, 'another media facade in Europe from the 2000s')
  assert.deepEqual(kh.reasons.map(r => r[0]), ['type', 'region', 'decade'])
  assert.equal(kh.score, 5)
  const burj = list.find(x => x.place.archive_slug === 'burj-khalifa-led')
  assert.deepEqual(burj.reasons.find(r => r[0] === 'technology'), ['technology', ['led_rgb']])
  // Region or decade alone is not similarity; the project itself is never listed.
  for (const x of list) { assert.notEqual(x.place.archive_slug, 'ars-electronica-center'); assert.ok(x.reasons.some(r => !['region', 'decade'].includes(r[0]))) }
  assert.deepEqual(X.similar(by['cairo-tower-show'], projects).map(x => x.place.archive_slug).sort(), projects.filter(p => p.project_type === 'light_art' && p.archive_slug !== 'cairo-tower-show').map(p => p.archive_slug).sort())
})

test('statistics count every value with unknowns apart', () => {
  const s = X.stats(projects)
  assert.equal(s.region.total, projects.length)
  assert.equal(s.region.rows.reduce((n, [, c]) => n + c, 0) + s.region.unknown, projects.length)
  assert.deepEqual(s.region.rows.slice(0, 2), [['east_asia', 7], ['europe', 6]])
  assert.ok(s.country.rows.some(([k, n]) => k === 'US' && n === 3))
  assert.deepEqual(s.decade.rows.map(r => r[0]), [...s.decade.rows.map(r => r[0])].sort((a, b) => a - b))
  assert.ok(s.technology.rows.find(([k]) => k === 'led_rgb')[1] >= 15)
  assert.equal(s.origin.rows.reduce((n, [, c]) => n + c, 0), projects.length)
})

test('export: CSV with a BOM, the warning line and provenance columns; JSON with meta, dictionary and licences', () => {
  const csv = X.exportCSV(projects, { lang: 'ko', recordURL: p => PUBLIC + '/#place/' + p.place_id })
  assert.ok(csv.startsWith('﻿# 주의: 자동 수집·자동 분류된 값은 검증된 사실이 아닙니다.'))
  const lines = csv.slice(1).split('\r\n').filter(Boolean)
  assert.equal(lines.length, projects.length + 2, 'warning, header, one line per project')
  const header = lines[1].split(',').map(c => c.replace(/^"|"$/g, ''))
  assert.deepEqual(header, X.EXPORT_FIELDS.map(f => f[0]))
  for (const c of ['data_origin', 'review_status', 'field_states', 'source_urls', 'source_licenses', 'coordinate_source']) assert.ok(header.includes(c), c)
  const ars = lines.find(l => l.startsWith('"AR-ars-electronica-center"'))
  assert.match(ars, /"editor_verified"|"researcher_assessed"/)
  assert.match(ars, /"latitude=editor_verified; longitude=editor_verified/)
  assert.match(ars, /"verified"/)
  // Coordinates off the map are not exported as coordinates.
  const greenpix = X.exportRows(projects).find(r => r.place_id === 'AR-greenpix-media-wall')
  assert.deepEqual([greenpix.latitude, greenpix.longitude, greenpix.coordinate_source], ['', '', ''])
  // Formula-like cells are defused; quotes are doubled.
  const tricky = X.exportCSV([{ ...projects[0], name_kr: '=HYPERLINK("x")' }])
  assert.ok(tricky.includes('"\'=HYPERLINK(""x"")"'))
  const json = X.exportJSON(projects, { lang: 'en', now: '2026-10-18T00:00:00.000Z', filters: { region: ['europe'] }, version: '0.16.0' })
  assert.deepEqual(Object.keys(json), ['meta', 'projects'])
  assert.equal(json.meta.generated_at, '2026-10-18T00:00:00.000Z')
  assert.deepEqual(json.meta.filters, { region: ['europe'] })
  assert.equal(json.meta.count, projects.length)
  assert.match(json.meta.warning, /not verified facts/)
  assert.match(json.meta.licenses.wikidata, /CC0/)
  assert.match(json.meta.licenses.commons, /per file/)
  assert.match(json.meta.licenses.editorial, /운영자 확정 필요/)
  assert.deepEqual(json.meta.data_dictionary.map(d => d.field), X.EXPORT_FIELDS.map(f => f[0]))
  assert.ok(json.meta.data_dictionary.every(d => d.type && d.description))
  assert.deepEqual(json.meta.field_states.map(s => s.state), T.keys('field_state'))
  assert.equal(json.projects.length, projects.length)
  assert.equal(json.projects.find(r => r.place_id === 'AR-kunsthaus-graz-bix').source_licenses, 'CC0 1.0; Wikidata: CC0 1.0')
})

test('project types map to the broad light categories only where the type clearly belongs to one', () => {
  for (const [type, cat] of Object.entries(CATEGORY_OF_TYPE)) { assert.ok(T.valid('project_type', type), type); assert.ok(X.categories.some(c => c[0] === cat), cat) }
  assert.equal(by['al-bahr-towers'].primary_category, null)
  // Wikidata items: a type only where the category implies it, flagged as derived.
  assert.equal(X.typeOf({ origin: 'wikidata-sync', primary_category: 'Media Facade' }), 'media_facade')
  assert.equal(X.typeDerived({ origin: 'wikidata-sync', primary_category: 'Media Facade' }), true)
  assert.equal(X.typeOf({ origin: 'wikidata-sync', primary_category: 'Nightscape' }), null)
})
