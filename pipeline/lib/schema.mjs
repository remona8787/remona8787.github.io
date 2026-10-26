// Schema checks of every output file. run.mjs validates the new dataset before it replaces the previous one (an
// invalid dataset is never published: the previous site-data stays and report.json says why), and the tests run the
// same checks on the fixture output. Each validator returns a list of "path: problem" strings (empty = valid).
import T from '../../site-public-cleared/archive-taxonomy.js'
import { INDEX_FIELDS, THUMB_TEMPLATE, expandThumb, FIELD_CONFIDENCE_KEYS, CONFIDENCE_STATES } from './output.mjs'

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,156}$/
const SHARD = /^[A-Za-z0-9_-]{1,40}$/
const ISO_TIME = (v) => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v))
const https = (v) => { try { return new URL(v).protocol === 'https:' } catch { return false } }
const httpAny = (v) => { try { return ['https:', 'http:'].includes(new URL(v).protocol) } catch { return false } }
const isInt = (v) => Number.isInteger(v)
const str = (v) => typeof v === 'string' && v.trim().length > 0
const opt = (f) => (v) => v === null || v === undefined || f(v)
const counts = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((n) => isInt(n) && n >= 0)
const SOURCE_STATUS = new Set(['ok', 'partial', 'error', 'skipped', 'kept_previous', 'disabled'])
const ROLES = new Set(['hero', 'featured', 'card', 'gallery', 'context'])
const PUBLISHED_KINDS = new Set(['project_media', 'project_installation', 'architecture_context', 'technical_documentation', 'event_documentation', 'artist_portrait'])
const PROVIDERS = new Set(['commons', 'openverse', 'flickr', 'tourapi', 'kto_photo', 'unsplash', 'pexels', 'official', 'editor'])
const pct = (v) => isInt(v) && v >= 0 && v <= 100
const SOURCE_KINDS = new Set(['official', 'public_agency', 'academic', 'specialist_media', 'news', 'blog', 'wikidata', 'wikipedia', 'commons', 'reference', 'search_result'])

function make() {
  const errors = []
  const need = (ok, path, problem) => { if (!ok) errors.push(`${path}: ${problem}`); return !!ok }
  return { errors, need }
}

/**
 * An image object (docs/STATIC_ARCHIVE.md v0.18 "Data fields"): a stable id, a known provider, https links, display
 * sizes never wider than the original, a licence and an author or attribution (never shown without), the usage, the
 * measurements, a tier (1–5; 6 is "no image") and a role; an image from a provider other than Commons carries its
 * identity proof.
 */
export function checkImage(img, path, need, { maxTier = 5 } = {}) {
  if (!need(img && typeof img === 'object', path, 'not an object')) return
  need(typeof img.id === 'string' && /^img-[0-9a-f]{12}$/.test(img.id), path + '.id', 'img-<12 hex>')
  need(PROVIDERS.has(img.provider), path + '.provider', 'unknown provider ' + img.provider)
  need(https(img.thumb), path + '.thumb', 'not https')
  need(https(img.src), path + '.src', 'not https')
  need(https(img.page), path + '.page', 'not https')
  need(Array.isArray(img.display) && img.display.every((d) => Array.isArray(d) && d.length === 2 && isInt(d[0]) && d[0] > 0 && https(d[1]) && (!img.width || d[0] <= img.width)), path + '.display', '[[width, https url]…], never wider than the original')
  need(![...(img.display || []), [0, img.src], [0, img.thumb]].some((d) => /[?&]utm_/.test(String(d[1]))), path + '.display', 'no analytics parameters in stored URLs')
  need(str(img.license), path + '.license', 'missing')
  need(str(img.author) || str(img.attribution), path + '.author', 'author or attribution required')
  need(opt(httpAny)(img.license_url), path + '.license_url', 'not a URL')
  need(img.usage === 'hotlink' || img.usage === 'cache', path + '.usage', 'hotlink or cache')
  need(ROLES.has(img.role), path + '.role', 'unknown role ' + img.role)
  need(isInt(img.tier) && img.tier >= 1 && img.tier <= maxTier, path + '.tier', `tier must be 1..${maxTier}`)
  need(opt((v) => isInt(v) && v > 0)(img.width) && opt((v) => isInt(v) && v > 0)(img.height), path + '.width', 'positive integers or null')
  need(img.quality === null || img.quality === undefined || (pct(img.quality.sharpness) && pct(img.quality.blockiness) && pct(img.quality.score)), path + '.quality', '{sharpness, blockiness, score} 0..100')
  need(img.media_active && pct(img.media_active.score) && Array.isArray(img.media_active.reasons), path + '.media_active', '{score 0..100, reasons[]}')
  need(img.approved === true || img.approved === false || img.approved === null, path + '.approved', 'true, false or null')
  // Image kinds (fifth brief): every published image says what it shows; 'unverified' is never published.
  need(PUBLISHED_KINDS.has(img.kind), path + '.kind', 'unknown or unpublishable kind ' + img.kind)
  need(str(img.title) && img.title.length <= 200, path + '.title', 'the source title (≤ 200 characters)')
  need(img.description === null || img.description === undefined || (typeof img.description === 'string' && img.description.length <= 240), path + '.description', 'a snippet of ≤ 240 characters or null')
  if (img.provider && img.provider !== 'commons') need(img.identity?.ok === true && str(img.identity.method), path + '.identity', 'an identity proof is required outside Commons')
}

export function checkManifest(m) {
  const { errors, need } = make()
  if (!need(m && typeof m === 'object', 'manifest', 'not an object')) return errors
  need(m.schema === 1, 'manifest.schema', 'must be 1')
  need(str(m.build_id) && m.build_id.length <= 80, 'manifest.build_id', 'missing or too long')
  need(ISO_TIME(m.generated_at), 'manifest.generated_at', 'not a time')
  const c = m.counts || {}
  need(isInt(c.projects) && c.projects >= 0, 'manifest.counts.projects', 'not a count')
  need(isInt(c.with_images), 'manifest.counts.with_images', 'not a count')
  need(isInt(c.with_hero), 'manifest.counts.with_hero', 'not a count')
  for (const k of ['by_type', 'by_region', 'by_country']) need(counts(c[k]), 'manifest.counts.' + k, 'not a count map')
  need(m.files?.index === 'index.json' && m.files?.home === 'home.json', 'manifest.files', 'index/home names')
  need(Array.isArray(m.files?.shards) && m.files.shards.every((s) => /^projects\/[A-Za-z0-9_-]{1,40}\.json$/.test(s)), 'manifest.files.shards', 'bad shard list')
  need(m.sources && typeof m.sources === 'object', 'manifest.sources', 'missing')
  for (const [name, s] of Object.entries(m.sources || {})) {
    need(SOURCE_STATUS.has(s?.status), `manifest.sources.${name}.status`, 'unknown status ' + s?.status)
    need(opt(ISO_TIME)(s?.last_success), `manifest.sources.${name}.last_success`, 'not a time')
    need(opt(isInt)(s?.items), `manifest.sources.${name}.items`, 'not a count')
  }
  return errors
}

export function checkIndex(ix) {
  const { errors, need } = make()
  if (!need(ix && Array.isArray(ix.fields) && Array.isArray(ix.rows), 'index', 'needs fields and rows')) return errors
  need(INDEX_FIELDS.every((f, i) => ix.fields[i] === f), 'index.fields', 'must start with ' + INDEX_FIELDS.join(','))
  need(ix.thumb_template === undefined || ix.thumb_template === THUMB_TEMPLATE, 'index.thumb_template', 'unknown template')
  const at = Object.fromEntries(ix.fields.map((f, i) => [f, i]))
  const seen = new Set()
  ix.rows.forEach((row, n) => {
    const p = `index.rows[${n}]`
    if (!need(Array.isArray(row) && row.length === ix.fields.length, p, 'length differs from fields')) return
    const v = (f) => row[at[f]]
    need(ID.test(v('id')) && !seen.has(v('id')), p + '.id', 'bad or duplicate id')
    seen.add(v('id'))
    need(str(v('name_ko')) || str(v('name_en')) || str(v('name_original')), p, 'no name')
    need(T.regionOf(v('country_iso2')) !== null, p + '.country_iso2', 'unknown country')
    need((v('lat') === null) === (v('lng') === null), p + '.lat', 'lat and lng go together')
    need(v('lat') === null || (typeof v('lat') === 'number' && Math.abs(v('lat')) <= 90 && Math.abs(v('lng')) <= 180), p + '.lat', 'out of range')
    need(v('lat') !== null || str(v('city')), p, 'needs coordinates or a city')
    need(T.valid('project_type', v('project_type')), p + '.project_type', 'unknown type')
    need(opt(isInt)(v('year')), p + '.year', 'not a year')
    need(opt(https)(expandThumb(v('thumb'), ix.thumb_template)), p + '.thumb', 'not https')
    need(v('visual_rank') === null ? v('thumb') === null : isInt(v('visual_rank')) && v('visual_rank') >= 1 && v('visual_rank') <= 5, p + '.visual_rank', 'tier 1..5 with a thumb, null without')
    if ('thumb_w' in at) need((v('thumb') === null ? v('thumb_w') === null : opt(isInt)(v('thumb_w'))) && opt(isInt)(v('thumb_h')), p + '.thumb_w', 'the thumb size (integers) or null')
    need(SHARD.test(v('shard')), p + '.shard', 'bad shard')
    need(opt((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))(v('added_at')), p + '.added_at', 'not a date')
    if ('kr_region' in at) need(v('kr_region') === null || (v('country_iso2') === 'KR' && T.valid('kr_region', v('kr_region'))), p + '.kr_region', 'a Korean region of a KR project, or null')
  })
  return errors
}

export function checkRecord(r, path, need) {
  if (!need(r && typeof r === 'object', path, 'not an object')) return
  need(ID.test(r.id), path + '.id', 'bad id')
  need(str(r.name_ko) || str(r.name_en) || str(r.name_original), path, 'no name')
  need(T.regionOf(r.country_iso2) !== null, path + '.country_iso2', 'unknown country')
  need(r.region === T.regionOf(r.country_iso2), path + '.region', 'does not match the country')
  need('kr_region' in r, path + '.kr_region', 'missing (null when unknown or not Korean)')
  need(r.kr_region === null || r.kr_region === undefined || (r.country_iso2 === 'KR' && T.valid('kr_region', r.kr_region)), path + '.kr_region', 'a Korean region of a KR project, or null')
  need((r.lat === null) === (r.lng === null), path + '.lat', 'lat and lng go together')
  need(r.lat !== null || str(r.city), path, 'needs coordinates or a city')
  need(T.valid('project_type', r.project_type), path + '.project_type', 'unknown type')
  need(opt((q) => /^Q[1-9]\d*$/.test(q))(r.wikidata), path + '.wikidata', 'not a QID')
  for (const k of ['year_installed', 'year_completed', 'year_operating_since', 'year_ended']) need(opt((y) => isInt(y) && y >= 1000 && y <= 2100)(r[k]), path + '.' + k, 'not a year')
  need(opt((s) => T.valid('operating_status', s))(r.operating_status), path + '.operating_status', 'unknown status')
  need(Array.isArray(r.images) && r.images.length <= 12, path + '.images', 'array of at most 12')
  ;(r.images || []).forEach((img, i) => checkImage(img, `${path}.images[${i}]`, need))
  need(['hero', 'featured', 'card'].every((role) => (r.images || []).filter((i) => i.role === role).length <= 1), path + '.images', 'one hero, one featured and one card at most')
  need(new Set((r.images || []).map((i) => i.id)).size === (r.images || []).length, path + '.images', 'image ids are unique')
  ;(r.images || []).forEach((img, i) => need(img?.project === r.id, `${path}.images[${i}].project`, 'names its project'))
  need(Array.isArray(r.sources) && r.sources.length > 0, path + '.sources', 'at least one source')
  ;(r.sources || []).forEach((s, i) => { need(httpAny(s.url), `${path}.sources[${i}].url`, 'not a URL'); need(SOURCE_KINDS.has(s.kind), `${path}.sources[${i}].kind`, 'unknown kind ' + s.kind) })
  need(r.sources?.some((s) => ['wikidata', 'wikipedia', 'commons', 'official'].includes(s.kind)) || (r.curated_place_id && r.sources.length), path + '.sources', 'needs a public source (Wikidata, Wikipedia, Commons or official)')
  ;(r.credits || []).forEach((c, i) => {
    need(T.valid('credit_role', c.role) && str(c.name), `${path}.credits[${i}]`, 'role and name')
    if (c.portrait !== undefined) { checkImage(c.portrait, `${path}.credits[${i}].portrait`, need); need(c.portrait?.kind === 'artist_portrait', `${path}.credits[${i}].portrait.kind`, 'artist_portrait') }
  })
  ;(r.images || []).forEach((img, i) => need(img?.kind !== 'artist_portrait', `${path}.images[${i}].kind`, 'a creator portrait belongs to its credit, never to images[]'))
  need(['facility', 'program', 'festival', 'exhibition'].includes(r.kind), path + '.kind', 'facility, program, festival or exhibition')
  for (const k of ['start_date', 'end_date']) need(r[k] === null || r[k] === undefined || /^\d{4}(-\d{2}(-\d{2})?)?$/.test(r[k]), `${path}.${k}`, 'YYYY, YYYY-MM or YYYY-MM-DD')
  need(['running', 'seasonal', 'ended', 'upcoming', 'unknown'].includes(r.status), path + '.status', 'running, seasonal, ended, upcoming or unknown')
  need(r.status === 'unknown' ? !r.status_source : ['tourapi', 'wikidata', 'editorial', 'curated'].includes(r.status_source), path + '.status_source', 'the source of a known status')
  const fc = r.field_confidence
  need(!!fc && typeof fc === 'object' && Object.keys(fc).length === FIELD_CONFIDENCE_KEYS.length && FIELD_CONFIDENCE_KEYS.every((k) => CONFIDENCE_STATES.includes(fc[k])), path + '.field_confidence', FIELD_CONFIDENCE_KEYS.join(', ') + ': ' + CONFIDENCE_STATES.join(' | '))
  if (fc && typeof fc === 'object') {
    need(fc.coordinates === 'unknown' ? r.lat === null : r.lat !== null, path + '.field_confidence.coordinates', 'unknown exactly when there are no coordinates')
    need(fc.project_type !== 'unknown', path + '.field_confidence.project_type', 'a published record has a type')
  }
  if (r.events !== undefined) {
    need(Array.isArray(r.events) && r.events.length <= 50, path + '.events', 'array of at most 50')
    ;(Array.isArray(r.events) ? r.events : []).forEach((e, i) => {
      const at = `${path}.events[${i}]`
      need(/^SEV-[0-9A-Z]{7,}$/.test(e?.id || ''), at + '.id', 'SEV-<id>')
      need(['event', 'exhibition'].includes(e?.kind), at + '.kind', 'event or exhibition')
      need(str(e?.title), at + '.title', 'missing')
      need(['upcoming', 'running', 'ended', 'unknown'].includes(e?.status), at + '.status', 'upcoming, running, ended or unknown')
      for (const k of ['start', 'end']) need(e?.[k] === null || /^\d{4}-\d{2}-\d{2}$/.test(e?.[k] || ''), `${at}.${k}`, 'YYYY-MM-DD or null')
      need(e?.url === null || https(e?.url), at + '.url', 'https or null')
      need(str(e?.source?.license) && https(e?.source?.url), at + '.source', 'licence and dataset page')
    })
  }
  if (r.visit !== null) need(r.visit && typeof r.visit === 'object' && (r.visit.status === null || T.valid('operating_status', r.visit.status)), path + '.visit', 'bad visit')
  need(opt(ISO_TIME)(r.added_at), path + '.added_at', 'not a time')
  need(SHARD.test(r.shard), path + '.shard', 'bad shard')
  // Never public: review states, pipeline scores, run times.
  for (const k of ['review_status', 'update_status', 'field_status', 'visibility', 'last_collected_at', 'eligibility', 'evidence', 'score']) need(!(k in r), path + '.' + k, 'internal field in a public record')
}

export function checkShard(s, name) {
  const { errors, need } = make()
  if (!need(s && Array.isArray(s.projects), `shard ${name}`, 'needs projects[]')) return errors
  need(s.schema === 1 && s.shard === name && str(s.build_id), `shard ${name}`, 'schema, shard name, build_id')
  s.projects.forEach((r, i) => { checkRecord(r, `shard ${name}.projects[${i}]`, need); need(r?.shard === name, `shard ${name}.projects[${i}].shard`, 'in the wrong shard') })
  return errors
}

export function checkHome(h) {
  const { errors, need } = make()
  if (!need(h && typeof h === 'object', 'home', 'not an object')) return errors
  need(h.schema === 1 && str(h.build_id) && ISO_TIME(h.generated_at), 'home', 'schema, build_id, generated_at')
  const known = h.projects && typeof h.projects === 'object' ? h.projects : {}
  const ref = (id, p) => need(typeof id === 'string' && id in known, p, 'names a project missing from projects')
  ;(h.hero || []).forEach((x, i) => { ref(x.project, `home.hero[${i}].project`); checkImage(x.image, `home.hero[${i}].image`, need, { maxTier: 2 }); need(x.image?.role === 'hero', `home.hero[${i}].image.role`, 'must be hero') })
  // Korea first: at least 70 % Korean hero slides when any Korean one exists.
  const krHero = (h.hero || []).filter((x) => known[x.project]?.country_iso2 === 'KR').length
  need(!krHero || krHero / (h.hero || []).length >= 0.7 - 1e-9, 'home.hero', 'at least 70 % Korean when Korean heroes exist')
  for (const k of ['featured', 'recent', 'kr_featured', 'kr_programs']) (h[k] || []).forEach((id, i) => ref(id, `home.${k}[${i}]`))
  ;(h.kr_featured || []).forEach((id, i) => need(known[id]?.country_iso2 === 'KR', `home.kr_featured[${i}]`, 'a Korean project'))
  ;(h.kr_programs || []).forEach((id, i) => need(known[id]?.country_iso2 === 'KR', `home.kr_programs[${i}]`, 'a Korean project'))
  if (h.world) { need(Array.isArray(h.world.highlights) && isInt(h.world.count), 'home.world', 'highlights and count'); (h.world.highlights || []).forEach((id, i) => { ref(id, `home.world.highlights[${i}]`); need(known[id]?.country_iso2 !== 'KR', `home.world.highlights[${i}]`, 'not Korean') }) }
  if (h.kr_regions) {
    need(Array.isArray(h.kr_regions) && h.kr_regions.length === T.keys('kr_region').length, 'home.kr_regions', 'all eight regions')
    ;(h.kr_regions || []).forEach((g, i) => {
      need(T.valid('kr_region', g.key) && isInt(g.count) && g.count >= 0, `home.kr_regions[${i}]`, 'key and count')
      if (g.project !== null) ref(g.project, `home.kr_regions[${i}].project`)
      if (g.image !== null) checkImage(g.image, `home.kr_regions[${i}].image`, need, { maxTier: 3 })
      ;(g.projects || []).forEach((id, j) => { ref(id, `home.kr_regions[${i}].projects[${j}]`); need(known[id]?.kr_region === g.key, `home.kr_regions[${i}].projects[${j}]`, 'in the region') })
    })
  }
  for (const [k, vocab] of [['regions', 'region'], ['types', 'project_type']]) {
    ;(h[k] || []).forEach((g, i) => {
      need(T.valid(vocab, g.key) && isInt(g.count) && g.count > 0, `home.${k}[${i}]`, 'key and count')
      if (g.project !== null) ref(g.project, `home.${k}[${i}].project`)
      if (g.image !== null) checkImage(g.image, `home.${k}[${i}].image`, need, { maxTier: 3 })
    })
  }
  for (const [id, c] of Object.entries(known)) {
    need(ID.test(id) && (str(c.name_ko) || str(c.name_en) || str(c.name_original)), `home.projects.${id}`, 'id and name')
    if (c.image !== null) checkImage(c.image, `home.projects.${id}.image`, need, { maxTier: 3 })
  }
  need(isInt(h.counts?.projects), 'home.counts.projects', 'not a count')
  if (h.counts && 'korea' in h.counts) need(isInt(h.counts.korea) && isInt(h.counts.world) && h.counts.korea + h.counts.world === h.counts.projects, 'home.counts.korea', 'korea + world = projects')
  return errors
}

export function checkStats(s) {
  const { errors, need } = make()
  need(s && s.schema === 1 && str(s.build_id) && isInt(s.counts?.projects), 'stats', 'schema, build_id, counts.projects')
  for (const k of ['by_type', 'by_region', 'by_country', 'by_decade', 'by_origin']) need(counts(s?.[k]), 'stats.' + k, 'not a count map')
  return errors
}

export function checkReport(r) {
  const { errors, need } = make()
  need(r && r.schema === 1 && str(r.run?.status) && ISO_TIME(r.run?.started_at) && ISO_TIME(r.run?.finished_at), 'report.run', 'schema, status, times')
  need(r?.sources && typeof r.sources === 'object', 'report.sources', 'missing')
  for (const [name, s] of Object.entries(r?.sources || {})) need(SOURCE_STATUS.has(s?.status), `report.sources.${name}.status`, 'unknown status')
  need(Array.isArray(r?.decisions), 'report.decisions', 'missing')
  need(r?.counts && isInt(r.counts.published), 'report.counts.published', 'missing')
  return errors
}

export function checkQuality(q) {
  const { errors, need } = make()
  need(q && q.schema === 1, 'quality', 'schema')
  for (const k of ['missing_images', 'broken_links', 'suspected_duplicates', 'stale', 'low_confidence_types', 'excluded']) need(Array.isArray(q?.[k]), 'quality.' + k, 'missing list')
  return errors
}

export function checkCandidates(c) {
  const { errors, need } = make()
  need(c && c.schema === 1 && Array.isArray(c.candidates), 'candidates', 'schema and list')
  ;(c?.candidates || []).forEach((x, i) => need(str(x.id) && Array.isArray(x.hits) && x.classification && isInt(x.classification.score), `candidates[${i}]`, 'id, hits, classification'))
  return errors
}

/** Cross-file checks of a whole site-data directory's parsed files. */
export function checkDataset({ manifest, index, home, stats, shards }) {
  const errors = [...checkManifest(manifest), ...checkIndex(index), ...checkHome(home), ...checkStats(stats)]
  const inShards = new Map()
  for (const [name, s] of Object.entries(shards)) {
    errors.push(...checkShard(s, name))
    for (const r of s?.projects || []) inShards.set(r.id, name)
  }
  const at = Object.fromEntries((index?.fields || []).map((f, i) => [f, i]))
  for (const row of index?.rows || []) {
    if (inShards.get(row[at.id]) !== row[at.shard]) errors.push(`index ${row[at.id]}: not in shard ${row[at.shard]}`)
  }
  if (manifest?.counts?.projects !== index?.rows?.length) errors.push('manifest.counts.projects differs from the index')
  if (inShards.size !== index?.rows?.length) errors.push('shards and index hold different projects')
  const listed = new Set((manifest?.files?.shards || []).map((s) => s.replace(/^projects\/|\.json$/g, '')))
  for (const name of Object.keys(shards)) if (!listed.has(name)) errors.push(`shard ${name} not listed in the manifest`)
  for (const name of listed) if (!(name in shards)) errors.push(`manifest lists missing shard ${name}`)
  for (const id of Object.keys(home?.projects || {})) if (!inShards.has(id)) errors.push(`home names ${id}, which is not published`)
  for (const x of [manifest, home, stats, ...Object.values(shards)]) if (x?.build_id !== manifest?.build_id) { errors.push('files carry different build_ids'); break }
  return errors
}
