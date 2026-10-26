// The images stage of a run (docs/STATIC_ARCHIVE.md "Images" and the v0.18 "Image rules"; docs/PIPELINE.md §6).
// Korean projects first. For every published project:
//   1. Commons candidates (P18, the project category and its night/event subcategories, P180 depicts), their metadata
//      and rights (lib/commons.mjs, lib/images.mjs assessCandidate);
//   2. provider candidates (lib/providers.mjs) for projects that need them, Korean ones first, each provider capped per
//      run and cached: TourAPI detailImage2 and the photo gallery (Korean projects, TOURAPI_SERVICE_KEY), Openverse,
//      Flickr (FLICKR_API_KEY), Unsplash and Pexels (their keys); each needs an allowed licence and an identity proof
//      (lib/identity.mjs); NAVER image results only become review candidates;
//   3. measurements: a 330 px Commons thumbnail for the visual score, and one ~1024 px rendition for quality (sharpness,
//      blockiness, perceptual hash; lib/quality.mjs) of the strongest candidates, cached a year;
//   4. tiers, roles (hero, featured, card, gallery, context) and the public image objects (lib/images.mjs).
// What the budget did not reach keeps the previous run's images (upgraded to the v0.18 image object when needed).
import { fileInfo, categoryMembers, categoryFiles, depictsFiles, fileDepictsStatements, isNightCategory, isEventCategory } from './commons.mjs'
import { fetchAux } from './wikidata.mjs'
import { assessCandidate, assessText, tierOf, chooseImages, imageObject, nameEvidence, commonsCandidate, otherSubject, PERSON_STRONG, namesCreator, BAD_NAME, stableImageId, cleanMediaUrl } from './images.mjs'
import { measureImage } from './visual.mjs'
import { measureQuality, qualityScore } from './quality.mjs'
import { identityOf, projectNames, queryNames, nameIn, workNames } from './identity.mjs'
import { openverseSearch, flickrLicenses, flickrSearch, unsplashSearch, pexelsSearch, naverImageSearch, tourapiCandidate, ktoPhotoCandidate, editorialCandidate } from './providers.mjs'
import { searchByName, detailImages, galleryPhotos } from './tourapi.mjs'
import { naverConfig } from '../../edge-functions/_shared/archive/adapters/naver.mjs'
import { HOUR } from './cache.mjs'
import { imageBlocked } from './editorial.mjs'
import { upgradeImage } from './output.mjs'
import { chunk, uniq, compareStrings, bareFile, haversine, validLat, redactKeys } from './util.mjs'

const isBudget = (e) => e?.code === 'budget'
const msg = (e) => redactKeys(String(e?.message || e)).slice(0, 300)
// A project name in a photo's title or tags plus a place (or a geotag near the project) shows where a photo was taken,
// not what it shows: portraits, fashion shows and other events at the venue pass that test (SEOUL006, DDP). Provider
// photos proven only this way stay in the review queue until an editor approves them (approve_image).
const WEAK_IDENTITY = new Set(['name_location', 'geotag_name'])

/**
 * @param {{client: any, cache: any, P: any, env: Record<string, string|undefined>, ed: any, heroAllow: Set<string>, prev: any, state: any,
 *   published: any[], evidenceByKey: Map<string, string[]>, catRules: any, krRegionNames: Record<string, string[]>, startedAt: string, err: Function, stages: any}} ctx
 */
export async function imageStage(ctx) {
  const { client, cache, P, env, ed, heroAllow, prev, state, published, evidenceByKey, catRules, startedAt, err } = ctx
  const IC = P.images || {}, PV = IC.providers || {}, ttl = P.cache_ttl_hours || {}
  const imageResults = new Map(), imageReview = [], tiles = [], heroOutcome = new Map(), providerLog = [], imageCandidates = []
  // Images of the previous dataset dropped by the recheck of kept images: {project, id, title, reason} (lib/image-audit.mjs).
  const keptDrops = []
  const stats = { processed: 0, kept_previous: 0, none: 0, candidates: 0, rejected: {}, measured: 0, measure_errors: 0, quality_measured: 0, duplicates: 0, by_provider: {}, provider_requests: {}, provider_errors: {}, provider_rejected: {}, identity_rejected: 0, portraits: 0, depicts_errors: 0, provider_unverified: 0, kept_dropped_unverified: 0, institution_context: 0, kept_dropped_irrelevant: 0, kept_dropped_person: 0, kept_demoted_context: 0, below_threshold: 0, awaiting_review: 0 }
  const count = (o, k, n = 1) => { o[k] = (o[k] || 0) + n }
  let thumbsFetched = 0, depictsAsked = 0, qualityFetched = 0
  const used = {}
  const today = startedAt.slice(0, 10)
  const providerOn = (name) => PV[name]?.enabled !== false
  const flickrKey = env.FLICKR_API_KEY, tourKey = env.TOURAPI_SERVICE_KEY, unsplashKey = env.UNSPLASH_ACCESS_KEY, pexelsKey = env.PEXELS_API_KEY
  const naver = naverConfig((k) => env[k])
  let flickrLic = null
  const openverseLimits = {}
  // Korea first: Korean projects, then curated, then those that had images, then by type and id.
  const typeOrder = ['media_facade', 'projection_mapping', 'media_wall', 'urban_screen', 'interactive_installation', 'light_art', 'media_architecture', 'festival_program', 'other']
  const order = [...published].sort((a, b) => (b.country_iso2 === 'KR' ? 1 : 0) - (a.country_iso2 === 'KR' ? 1 : 0) || (b.curated_id ? 1 : 0) - (a.curated_id ? 1 : 0) || (prev.records.get(b.id)?.images?.length ? 1 : 0) - (prev.records.get(a.id)?.images?.length ? 1 : 0) || typeOrder.indexOf(a.project_type) - typeOrder.indexOf(b.project_type) || (b.p18.length ? 1 : 0) - (a.p18.length ? 1 : 0) || compareStrings(a.id, b.id))
  const editorialImages = ed.setImages || new Map()

  // ---------------------------------------------------------------- Commons candidates of one project
  async function commonsFiles(p) {
    const out = []
    // institution: the file comes from the item's P18, depicts or Commons category (or a subcategory of it) while the
    // item is an institution, building, tower or district rather than the work (entities.mjs item_institution).
    const add = (file, source, category = null, institution = false) => {
      const f = bareFile(file)
      if (!f || out.some((c) => c.file === f)) return
      if (!/\.(jpe?g|png|webp)$/i.test(f) || BAD_NAME.test(f.replace(/\.[a-z0-9]+$/i, ''))) return
      out.push({ file: f, source, category, ...(institution ? { institution: true } : {}) })
    }
    // The item's own P18 is its representative photo: of the place itself when the item is the place (a host
    // building has none here, entities.mjs), so it is never an institution file.
    const inst = !!p.item_institution
    for (const f of p.p18 || []) add(f, 'p18')
    // The photo that showed the work where the category was found (a Korean root's file): of the work itself.
    for (const f of p.via_files || []) add(f, 'part_category')
    const cats = [...(p.image_categories || [])]
    for (const key of [p.qid && 'q:' + p.qid, p.commons_category && 'c:' + p.commons_category].filter(Boolean)) for (const t of evidenceByKey.get(key) || []) cats.push({ title: t, source: 'night_category', ...(inst ? { institution: true } : {}) })
    const seenCats = new Set()
    let subcatBudget = IC.max_subcategories ?? 3
    for (const c of cats.slice(0, IC.max_categories_per_project ?? 4)) {
      if (seenCats.has(c.title)) continue
      seenCats.add(c.title)
      const m = await categoryMembers(client, c.title, { cache, ttlHours: ttl.commons_members ?? 72, limit: IC.members_per_category ?? 200 })
      for (const f of m.files) add(f, isNightCategory(c.title, catRules) && c.source === 'category' ? 'night_category' : c.source, c.title, !!c.institution)
      if (c.source !== 'category') continue
      const subs = m.subcats.filter((s) => isNightCategory(s, catRules) || isEventCategory(s, catRules)).sort((a, b) => (isNightCategory(b, catRules) ? 1 : 0) - (isNightCategory(a, catRules) ? 1 : 0) || compareStrings(b, a))
      for (const s of subs) {
        if (subcatBudget-- <= 0 || seenCats.has(s)) break
        seenCats.add(s)
        for (const f of await categoryFiles(client, s, { cache, ttlHours: ttl.commons_members ?? 72, limit: IC.files_per_subcategory ?? 40 })) add(f, isNightCategory(s, catRules) ? 'night_category' : 'event_category', s, !!c.institution)
      }
    }
    if (p.qid && IC.depicts !== false && !out.some((c) => { const n = nameEvidence(c.file); return n.night >= 30 && n.media >= 30 })) {
      const cached = cache.fresh('commons-depicts', p.qid) !== undefined
      if (cached || depictsAsked < (IC.depicts_max_per_run ?? 80)) {
        if (!cached) depictsAsked++
        for (const f of await depictsFiles(client, p.qid, { cache, ttlHours: ttl.commons_depicts ?? 336, limit: IC.depicts_per_project ?? 30 })) add(f, 'depicts', null, inst)
      }
    }
    const bonus = { p18: 15, night_category: 40, event_category: 20, part_category: 10, depicts: 5, category: 0 }
    // An institution's file that names neither night nor media comes last (it can only be context).
    const ranked = out.map((c) => { const n = nameEvidence(c.file); return { ...c, pre: n.night + n.media + (bonus[c.source] ?? 0) - (c.institution && !n.night && !n.media ? 30 : 0) } }).sort((a, b) => b.pre - a.pre || compareStrings(a.file, b.file))
    stats.candidates += ranked.length
    return ranked.slice(0, IC.max_candidates_per_project ?? 16)
  }

  // ---------------------------------------------------------------- provider candidates of one project
  /** Whether a provider may still make a new (uncached) request this run. */
  const budgetOf = (name) => (used[name] || 0) < (PV[name]?.max_requests_per_run ?? 60)
  const ask = async (name, cacheNs, cacheKey, fn) => {
    const cached = cacheNs && cache.fresh(cacheNs, cacheKey) !== undefined
    if (!cached && !budgetOf(name)) { providerLog.push({ provider: name, key: cacheKey, status: 'cap_reached' }); return null }
    if (!cached) used[name] = (used[name] || 0) + 1
    count(stats.provider_requests, name)
    try { return await fn() } catch (e) {
      if (isBudget(e)) throw e
      count(stats.provider_errors, name)
      providerLog.push({ provider: name, key: cacheKey, status: 'error', message: msg(e) })
      return null
    }
  }

  async function providerCandidates(p, commonsCount) {
    const out = []
    const korean = p.country_iso2 === 'KR'
    const names = projectNames(p)
    // The shortest core name per script ("롯데월드타워 미디어파사드" → "롯데월드타워", "Lotte World Tower Media Facade" →
    // "lotte world tower"): what photos are titled with.
    const qn = queryNames(p)
    const ko = qn.ko, en = qn.en
    const want = korean || commonsCount < (PV.min_commons_candidates ?? 3)
    // Editorial images (set_image) are always candidates.
    for (const d of editorialImages.get(p.id) || []) out.push({ ...editorialCandidate(d), decision: d })
    if (!want) return out
    // TourAPI: the project's own content ids (a merged TourAPI item) or items found by its Korean name within 300 m.
    if (korean && tourKey && providerOn('tourapi')) {
      const placeIds = new Set(p.tourapi_ids || (p.tourapi_id ? [p.tourapi_id] : []))
      const items = new Map()
      if (!placeIds.size && (p.name_ko || ko)) {
        const q = p.name_ko || ko
        const found = await ask('tourapi', 'tourapi', 'name:' + q, () => searchByName(client, P.tourapi || {}, q, { key: tourKey, cache }))
        for (const it of found || []) {
          const near = validLat(p.latitude) && validLat(it.lat) ? haversine({ lat: p.latitude, lng: p.longitude }, { lat: it.lat, lng: it.lng }) <= 300 : false
          const named = nameIn(it.title, names) || nameIn(names.join(' · '), [it.title])
          providerLog.push({ provider: 'tourapi', project: p.id, contentid: it.contentid, title: it.title, near, named: !!named, matched: !!(near && named) })
          if (near && named) { placeIds.add(it.contentid); items.set(it.contentid, it) }
        }
      }
      for (const id of placeIds) {
        const item = items.get(id) || { contentid: id, title: p.name_ko, lat: p.latitude, lng: p.longitude, addr1: p.address, firstimage: p.tourapi?.contentid === id ? p.tourapi.firstimage : null, cpyrhtDivCd: p.tourapi?.cpyrhtDivCd }
        const imgs = await ask('tourapi', 'tourapi', 'images:' + id, () => detailImages(client, P.tourapi || {}, id, { key: tourKey, cache })) || []
        if (item.firstimage) imgs.unshift({ contentid: id, serialnum: 'first', name: item.title, original: item.firstimage, cpyrhtDivCd: item.cpyrhtDivCd })
        for (const img of imgs) out.push({ ...tourapiCandidate(img, item), placeIds: [...placeIds] })
      }
    }
    if (korean && tourKey && providerOn('kto_photo') && (p.name_ko || ko)) {
      const q = ko || p.name_ko
      for (const ph of await ask('kto_photo', 'kto-photo', 'kw:' + q, () => galleryPhotos(client, P.kto_photo || {}, q, { key: tourKey, cache })) || []) out.push(ktoPhotoCandidate(ph, { defaultLicense: P.kto_photo?.default_license_when_missing ?? null }))
    }
    if (providerOn('openverse') && !(Object.values(openverseLimits).some((v) => v === 0))) {
      for (const q of uniq([en, korean ? ko : null, !en ? qn.other || ko : null]).slice(0, 2)) {
        const r = await ask('openverse', 'openverse', q, () => openverseSearch(client, q, { cache, env, limits: openverseLimits }))
        out.push(...(r || []))
      }
    }
    if (flickrKey && providerOn('flickr')) {
      if (!flickrLic) flickrLic = await ask('flickr', 'flickr', 'licenses', () => flickrLicenses(client, flickrKey, { cache })) || new Map()
      const text = en || ko
      if (text && flickrLic.size) out.push(...(await ask('flickr', 'flickr', `search:${text}`, () => flickrSearch(client, { text, lat: p.latitude, lng: p.longitude, radiusM: PV.flickr?.radius_m ?? 1000 }, { key: flickrKey, cache, licenses: flickrLic })) || []))
    }
    const city = p.city || p.city_ko || ''
    if (unsplashKey && providerOn('unsplash') && en) out.push(...(await ask('unsplash', 'unsplash', `${en} ${city}`.trim(), () => unsplashSearch(client, `${en} ${city}`.trim(), { key: unsplashKey, cache })) || []))
    if (pexelsKey && providerOn('pexels') && en) out.push(...(await ask('pexels', 'pexels', `${en} ${city}`.trim(), () => pexelsSearch(client, `${en} ${city}`.trim(), { key: pexelsKey, cache })) || []))
    // NAVER image search: discovery only (admin-data candidates, never a public image).
    if (naver.ok && providerOn('naver') && korean && (ko || p.name_ko)) {
      const q = ko || p.name_ko
      const r = await ask('naver', 'naver-image', q, () => naverImageSearch(client, q, { keyId: naver.config.keyId, key: naver.config.key, mode: naver.config.mode, cache }))
      for (const it of (r || []).slice(0, 10)) imageCandidates.push({ source: 'naver_image', project: p.id, query: q, title: it.title, link: it.link, thumbnail: it.thumbnail, width: it.width, height: it.height, status: 'needs_review', note: 'discovery only: find the original page, its licence or a permission, then add a set_image decision' })
    }
    return out
  }

  // ---------------------------------------------------------------- measurements
  async function visualOf(s) {
    const key = s.cand.source_id + '|' + (s.cand.sha1 || '')
    let m = cache.fresh('visual', key)
    if (m === undefined && thumbsFetched < (IC.max_thumbs_per_run ?? 1800) && s.cand.visual_url) {
      try {
        const b = await client.bytes(s.cand.visual_url, { stage: 'images' })
        thumbsFetched++
        m = await measureImage(b.bytes, IC.score_width ?? 320)
        s.buffer = b.bytes
        cache.set('visual', key, m, { ttlMs: (ttl.visual ?? 8760) * HOUR })
        stats.measured++
      } catch (x) { if (isBudget(x)) throw x; stats.measure_errors++; m = null; err('images_thumb', x, { file: s.cand.source_id }) }
    }
    return m ?? null
  }
  async function qualityOf(s) {
    const c = s.cand
    const key = `${c.provider}|${c.source_id}|${c.sha1 || cleanMediaUrl(c.measure_url) || ''}`
    let q = cache.fresh('quality', key)
    if (q === undefined && qualityFetched < (IC.max_quality_per_run ?? 600) && c.measure_url) {
      try {
        const b = await client.bytes(c.measure_url, { stage: 'images', maxBytes: IC.max_measure_bytes ?? 12e6 })
        qualityFetched++
        q = { ...(await measureQuality(b.bytes)), measured_url: cleanMediaUrl(c.measure_url), at: today }
        s.buffer = b.bytes
        cache.set('quality', key, q, { ttlMs: (ttl.quality ?? 8760) * HOUR })
        stats.quality_measured++
      } catch (x) { if (isBudget(x)) throw x; stats.measure_errors++; q = null; err('images_quality', x, { image: c.source_id, provider: c.provider }) }
    }
    return q ?? null
  }

  // ---------------------------------------------------------------- one project
  async function scoreProject(p, commons, info, providers, depictsHuman = () => false) {
    const assessed = []
    const ownNames = [p.name_ko, p.name_en, p.name_original, p.building_name, ...(p.aliases || [])].filter(Boolean)
    const ownWorkNames = workNames(p)
    const creators = p.creator_names || []
    for (const c of commons) {
      const i = info.get(c.file)
      const a = assessCandidate(c, i, { project_type: p.project_type, rightsPolicy: IC.rights_policy, minWidth: IC.min_width, minHeight: IC.min_height, names: ownNames, workNames: ownWorkNames, host: p.qid_match === 'host', creators, depictsHuman })
      for (const r of a.reasons) count(stats.rejected, r.split(':')[0] === 'rights' ? r : r.split(':')[0] === 'subject' ? r.split(':').slice(0, 2).join(':') : r.replace(/:.*/, ''))
      const approved = approvalOf(p, c.file, 'commons', c.file)
      // An editor who approved an institution's file has looked at it: it may be used beyond context.
      if (approved === true && a.evidence?.includes('host_building_only')) a.evidence = [...a.evidence.filter((e) => e !== 'host_building_only'), 'editorial_review']
      if (a.ok && a.evidence?.includes('host_building_only')) stats.institution_context++
      const cand = i && !i.missing ? commonsCandidate(i, a) : { provider: 'commons', source_id: c.file, file: c.file }
      assessed.push({ key: c.file, file: c.file, source: c.source, cand, a, info: i, width: i?.width ?? null, height: i?.height ?? null, approved, identity: { ok: true, method: 'commons_category_or_item' } })
    }
    const providerReview = []
    for (const c of providers) {
      const key = stableImageId(c.provider, c.source_id)
      const placeIds = c.placeIds || []
      const identity = identityOf(c, p, { placeIds, regionNames: ctx.krRegionNames })
      const a = assessText(c, { project_type: p.project_type, names: ownNames, creators })
      const reasons = [...(c.rights?.ok ? [] : (c.rights?.reasons || ['rights']).map((r) => 'rights:' + r)), ...(identity.ok ? [] : ['identity_unproven']), ...a.reasons]
      if (!c.src || !c.page) reasons.push('no_https_url')
      const ok = reasons.length === 0
      if (!identity.ok) stats.identity_rejected++
      if (!ok) for (const r of reasons) count(stats.provider_rejected, `${c.provider}:${r.replace(/:.*/, '')}`)
      providerReview.push({ provider: c.provider, id: key, source_id: c.source_id, title: c.title, src: c.src, page: c.page, license: c.license, identity, ok, reasons })
      if (!ok) continue
      const approved = c.editorial ? true : approvalOf(p, key, c.provider, c.source_id)
      if (WEAK_IDENTITY.has(identity.method) && approved !== true) {
        stats.provider_unverified++
        const review = providerReview[providerReview.length - 1]
        review.ok = false
        review.reasons = [...review.reasons, 'awaiting_review']
        continue
      }
      assessed.push({ key, file: null, source: c.provider, cand: c, a: { ...a, ok: true }, width: c.width, height: c.height, approved, identity })
    }
    const usable = assessed.filter((s) => s.a.ok && !imageBlocked(ed, p.id, s.key) && !(s.file && imageBlocked(ed, p.id, s.file)))
    // Visual scores: Commons from a 330 px thumbnail (the strongest few); providers from their measured rendition.
    const commonsUsable = usable.filter((s) => s.cand.provider === 'commons')
    const toMeasure = [...commonsUsable].sort((x, y) => (y.a.night + y.a.media + (y.source === 'p18' ? 10 : 0)) - (x.a.night + x.a.media + (x.source === 'p18' ? 10 : 0)) || compareStrings(x.key, y.key)).slice(0, IC.max_scored_per_project ?? 6)
    for (const s of toMeasure) s.m = await visualOf(s)
    for (const s of usable.filter((x) => x.cand.provider !== 'commons').slice(0, IC.max_provider_measured_per_project ?? 6)) {
      s.q = await qualityOf(s)
      if (s.q) {
        s.m = s.q.visual
        // Sizes the API did not give (TourAPI, the photo gallery): the decoded original's; a mismatch is recorded.
        const d = s.q.decoded
        if (s.cand.src && cleanMediaUrl(s.cand.measure_url) === cleanMediaUrl(s.cand.src)) {
          if (s.width && d.width && Math.abs(s.width - d.width) > 2) s.size_mismatch = { api: [s.width, s.height], decoded: [d.width, d.height] }
          s.width = d.width; s.height = d.height
          if (!s.cand.sizes?.length) s.cand.sizes = [[d.width, s.cand.src]]
        }
      }
    }
    for (const s of usable) { s.m = s.m ?? null; s.t = tierOf(s.a, s.m, IC, { project_type: p.project_type, width: s.width }) }
    // Quality of the strongest Commons candidates for hero, featured and card (~1024 px renditions).
    const forQuality = [...commonsUsable].filter((s) => (s.width || 0) >= (IC.min_width ?? 640)).sort((x, y) => x.t.tier - y.t.tier || (y.m?.visual ?? -1) - (x.m?.visual ?? -1) || (y.width || 0) - (x.width || 0) || compareStrings(x.key, y.key)).slice(0, IC.quality_per_project ?? 3)
    for (const s of forQuality) s.q = await qualityOf(s)
    // A width the decoded rendition contradicts is never trusted beyond the rendition.
    const choice = chooseImages(p, usable, { heroAllow, blocked: new Set(), galleryMax: IC.gallery_max ?? 12, th: IC })
    stats.duplicates += choice.duplicates.length
    const images = choice.ordered.map(({ s, role }) => imageObject(s, role, { project: p, checkedAt: s.q?.at || today, th: IC }))
    // Creators' portraits: for the creator section of the record (lib/output.mjs), never in images[].
    const portraits = choice.portraits.slice(0, 4).map((s) => ({ ...imageObject(s, 'context', { project: p, checkedAt: s.q?.at || today, th: IC }), creator: s.a.portrait }))
    stats.portraits += portraits.length
    for (const i of images) {
      count(stats.by_provider, i.provider)
      if (i.below_target) stats.below_threshold++
    }
    const pick = (s) => (s ? images.find((i) => i.id === stableImageId(s.cand.provider, s.cand.source_id)) || null : null)
    const heroImg = pick(choice.hero), featuredImg = pick(choice.featured)
    const homeS = choice.hero || choice.featured || choice.usable.find((s) => s.t.home_ok && s.cand.provider === 'commons' && s.q) || null
    const homeImg = pick(homeS)
    imageResults.set(p.id, { images, portraits, status: 'scored', hero: heroImg, featured: featuredImg, home: homeImg && homeImg.tier <= 3 ? homeImg : null, score: homeS ? (homeS.m?.visual ?? 0) + (6 - homeS.t.tier) * 15 + (homeS.q ? qualityScoreOf(homeS) / 5 : 0) : 0 })
    stats.processed++
    if (!images.length) stats.none++
    imageReview.push({
      project: p.id, name: p.name_en || p.name_ko, country_iso2: p.country_iso2, type: p.project_type, card: choice.card?.key ?? null, hero: choice.hero?.key ?? null, featured: choice.featured?.key ?? null,
      candidates: assessed.map((s) => ({ key: s.key, provider: s.cand.provider, source: s.source, ok: s.a.ok, reasons: s.a.reasons, kind: s.kind ?? null, title: s.a.title_text ? s.a.title_text.slice(0, 160) : null, night: s.a.night ?? null, media: s.a.media ?? null, night_terms: s.a.night_terms, media_terms: s.a.media_terms, evidence: s.a.evidence, visual: s.m ?? null, quality: s.q ? { sharpness: s.q.sharpness, blockiness: s.q.blockiness, laplacian_var: s.q.laplacian_var, phash: s.q.phash, decoded: s.q.decoded, measured_width: s.q.measured_width } : null, width: s.width ?? null, tier: s.t?.tier ?? null, home_ok: s.t?.home_ok ?? false, approved: s.approved ?? null, identity: s.identity, size_mismatch: s.size_mismatch ?? null })),
      providers: providerReview,
      hero_decisions: choice.decisions, featured_decisions: choice.featuredDecisions, duplicates: choice.duplicates,
    })
    for (const d of choice.decisions) if (d.allowlisted) heroOutcome.set(p.id + '|' + (d.file || d.key), { hero: choice.hero?.key === d.key, reasons: d.reasons })
    // Contact sheet tiles: hero and featured candidates (and approved ones) per provider; the card of each project.
    const byKey = new Map(usable.map((s) => [s.key, s]))
    for (const d of choice.decisions) if (d.hero_candidate || d.allowlisted) tiles.push(tile('hero', p, byKey.get(d.key), { allowlisted: d.allowlisted, hero_candidate: d.hero_candidate }))
    for (const d of choice.featuredDecisions) {
      if (!d.featured_candidate) continue
      const s = byKey.get(d.key)
      tiles.push(tile('featured', p, s, { awaiting_review: d.awaiting_review }))
      if (d.awaiting_review) {
        stats.awaiting_review++
        imageCandidates.push({ source: 'featured_review', project: p.id, image: d.key, provider: s.cand.provider, src: s.cand.src, page: s.cand.page, license: s.cand.license, author: s.cand.author, width: s.width ?? null, tier: s.t.tier, identity: s.identity, status: 'needs_review', note: 'look at the contact sheet; approve with an approve_image decision (target project, image id)' })
      }
    }
    if (choice.card && choice.card.t.tier <= 3) tiles.push(tile('cards', p, choice.card, {}))
  }
  const qualityScoreOf = (s) => (s.q ? qualityScore(s.q, s.width) : 0)
  function tile(kind, p, s, flags) {
    return { kind, project: p.id, korean: p.country_iso2 === 'KR', name: p.name_en || p.name_ko || p.name_original || p.id, name_ko: p.name_ko, key: s.key, id: stableImageId(s.cand.provider, s.cand.source_id), provider: s.cand.provider, file: s.file || null, width: s.width ?? null, height: s.height ?? null, sharpness: s.q?.sharpness ?? null, blockiness: s.q?.blockiness ?? null, tier: s.t?.tier ?? null, visual: s.m?.visual ?? null, buffer: s.buffer || null, thumb: s.cand.visual_url || s.cand.measure_url || null, ...flags }
  }
  function approvalOf(p, key, provider, sourceId) {
    const a = ed.imageApprovals?.get(p.id + '|' + key) ?? ed.imageApprovals?.get(p.id + '|' + sourceId) ?? ed.imageApprovals?.get('*|' + key)
    if (a !== undefined) return a
    if (heroAllow.has(p.id + '|' + key) || heroAllow.has(p.id + '|' + sourceId)) return true
    return null
  }

  function keepPrevImages(p) {
    if (imageResults.has(p.id)) return
    const old = prev.records.get(p.id) || (p.merged_ids || []).map((id) => prev.records.get(id)).find(Boolean)
    const fileOf = (i) => (i.page?.split('File:')[1] ? decodeURIComponent(i.page.split('File:')[1]).replace(/_/g, ' ') : '')
    // Kept images were chosen by an earlier run, maybe under older rules: the relevance and institution rules apply
    // again to their Commons file names (a mislinked file is dropped; an institution's file is context, never card).
    const ownNames = [p.name_ko, p.name_en, p.name_original, p.building_name, ...(p.aliases || [])].filter(Boolean)
    const wn = workNames(p)
    const recheck = (i) => {
      if (i.approved === true) return i
      if (i.provider !== 'commons') {
        if (!WEAK_IDENTITY.has(i.identity?.method)) return i
        stats.kept_dropped_unverified++
        keptDrops.push({ project: p.id, id: i.id, title: i.title ?? null, reason: 'identity' })
        return null
      }
      const title = fileOf(i).replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ')
      if (!title) return i
      const isP18 = (p.p18 || []).some((f) => bareFile(f) === fileOf(i))
      const subj = otherSubject(title, { names: ownNames, project_type: p.project_type })
      if (subj) { stats.kept_dropped_irrelevant++; keptDrops.push({ project: p.id, id: i.id, title, reason: subj.startsWith('subject:people_or_event') ? 'person' : 'mislinked' }); return null }
      if (PERSON_STRONG.test(title) && !namesCreator(title, p.creator_names || [])) { stats.kept_dropped_person++; keptDrops.push({ project: p.id, id: i.id, title, reason: 'person' }); return null }
      const n = nameEvidence(title)
      const nightShows = ['media_facade', 'media_wall', 'urban_screen', 'projection_mapping'].includes(p.project_type) || (p.project_type === 'light_art' && p.qid_match !== 'host')
      const institutional = (p.item_institution || p.qid_match === 'host') && !isP18 && !(wn.length && nameIn(title, wn)) && n.media < 30 && !(nightShows && n.night >= 30)
      if (!institutional || (i.role === 'context' && i.tier >= 5)) return i
      stats.kept_demoted_context++
      return { ...i, role: 'context', tier: 5, kind: 'architecture_context' }
    }
    const images = (old?.images || []).map((i) => upgradeImage(i, p.id)).filter((i) => !imageBlocked(ed, p.id, fileOf(i)) && !imageBlocked(ed, p.id, i.id)).map(recheck).filter(Boolean)
    const pick = state.imagePicks?.[p.id] || (old && state.imagePicks?.[old.id]) || null
    const home = pick?.home ? images.find((i) => (i.page === pick.home || i.id === pick.home) && i.tier <= 3) || null : null
    const portraits = (old?.credits || []).map((c) => c.portrait && { ...c.portrait, creator: c.portrait.creator || c.name }).filter(Boolean)
    imageResults.set(p.id, { images, portraits, status: 'kept_previous', home, hero: images.find((i) => i.role === 'hero') || null, featured: images.find((i) => i.role === 'featured') || null, score: pick?.score ?? 0 })
    stats.kept_previous++
  }

  // ---------------------------------------------------------------- the stage
  const groups = chunk(order, 6)
  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi]
    if (client.clock() >= client.deadline) { for (const p of groups.slice(gi).flat()) keepPrevImages(p); ctx.stages.mark('images', 'partial'); break }
    try {
      const cands = new Map()
      for (const p of group) cands.set(p.id, await commonsFiles(p))
      const files = uniq([...cands.values()].flat().map((c) => c.file))
      const info = files.length ? await fileInfo(client, files, { cache, ttlHours: ttl.commons_files ?? 336, thumbWidth: IC.thumb_width ?? 330 }) : new Map()
      // What the files depict (structured data): a file that depicts a human is a photo of a person.
      const depicts = new Map(), humans = new Set()
      if (IC.depicts_people !== false && files.length) {
        try {
          for (const [f, qs] of await fileDepictsStatements(client, files.filter((f) => info.get(f) && !info.get(f).missing), { cache, ttlHours: ttl.commons_file_depicts ?? 720 })) depicts.set(f, qs)
          const qids = uniq([...depicts.values()].flat())
          if (qids.length) { const r = await fetchAux(client, qids, { cache, ttlHours: ttl.entities_aux ?? 720, stage: 'images' }); for (const [q, a] of r.aux) if ((a.p31 || []).includes('Q5')) humans.add(q) }
        } catch (x) { if (isBudget(x)) throw x; stats.depicts_errors++; err('images_depicts_statements', x, { projects: group.map((p) => p.id) }) }
      }
      const depictsHuman = (f) => (depicts.get(f) || []).some((q) => humans.has(q))
      for (const p of group) {
        const commonsUsableCount = (cands.get(p.id) || []).filter((c) => { const i = info.get(c.file); return i && !i.missing && (i.width || 0) >= (IC.featured_min_width ?? 1600) }).length
        const providers = await providerCandidates(p, commonsUsableCount)
        await scoreProject(p, cands.get(p.id), info, providers, depictsHuman)
      }
    } catch (x) {
      if (!isBudget(x)) err('images', x, { projects: group.map((p) => p.id) })
      for (const p of group) if (!imageResults.has(p.id)) keepPrevImages(p)
      if (isBudget(x)) { for (const p of groups.slice(gi + 1).flat()) keepPrevImages(p); ctx.stages.mark('images', 'partial'); break }
    }
  }
  for (const p of published) if (!imageResults.has(p.id)) keepPrevImages(p)
  return { imageResults, imageReview, tiles, heroOutcome, providerLog, imageCandidates, keptDrops, stats: { ...stats, thumbnails_fetched: thumbsFetched, quality_fetched: qualityFetched, depicts_searches: depictsAsked, provider_new_requests: used, openverse_rate_limit: openverseLimits } }
}
