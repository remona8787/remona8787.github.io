#!/usr/bin/env node
// The static archive pipeline (docs/STATIC_ARCHIVE.md, operations in docs/PIPELINE.md). Runs on GitHub Actions
// (job "collect" of archive.yml) with the data branch checked out as the data directory:
//
//   sources (Wikidata classes · Commons categories · Wikipedia media-facade search · web candidates)
//     → classify/type → resolve entities → dedupe/merge → enrich (Wikidata facts) → editorial decisions
//     → eligibility → images (rights, visual scoring, roles) → contact sheets → link checks → Overpass (optional)
//     → shard → site-data/ admin-data/ review/ state/
//
// Guarantees:
//  - Polite: one User-Agent with a contact address, maxlag on every MediaWiki call, at most 1 request per second per
//    wiki and for the query service, GDELT 1 per 5 s, Overpass 1 per 10 s; retries with backoff; caches with TTLs and
//    ETags in state/cache/.
//  - Bounded: an overall time budget (25 min by default) split into stage budgets. A stage that runs out stops
//    cleanly; what it did not reach keeps its previous data, so the output is partial but consistent.
//  - Safe: the previous site-data/ is replaced only by a complete, schema-valid dataset (written to a staging
//    directory, then swapped). A failed source never removes what it found before; a big unexplained drop keeps the
//    previous dataset. report.json says what happened.
//
// CLI:  node pipeline/run.mjs --data=<data dir> [--editorial=<dir>] [--budget=<minutes>] [--fixtures] [--now=<iso>]
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdir, rm, appendFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { defaultSleep, errorText } from '../edge-functions/_shared/archive/http.mjs'
import { createClient, USER_AGENT } from './lib/net.mjs'
import { Cache, HOUR } from './lib/cache.mjs'
import { readJSON, writeJSON, writeFileAtomic, swapDir, listFiles } from './lib/io.mjs'
import { discoverClasses, addClassCounts, classInstances, countryClassInstances, fetchEntities, fetchAux, auxRefs, auxNext, factsOf } from './lib/wikidata.mjs'
import { compileGazetteer, discoverKrDivisions, krRegionOf, KR_REGIONS } from './lib/korea.mjs'
import { discoverTourApi, tourObservation } from './lib/tourapi.mjs'
import { discoverCategories, categoryRules, isNightCategory, isEventCategory, nightParent, fileInfo, categoryMembers, categoryFiles, depictsFiles } from './lib/commons.mjs'
import { discoverWikipedia, acceptEntity } from './lib/wikipedia.mjs'
import { webRules, collectWeb, mergeCandidates } from './lib/web.mjs'
import { checkCoordinates } from './lib/overpass.mjs'
import { checkLinks } from './lib/links.mjs'
import { loadSeed, seedObservations } from './lib/seed.mjs'
import { clusterObservations, mergeByNameAndUrl, buildProject, eligibility, newId } from './lib/entities.mjs'
import { assessCandidate, tierOf, heroEligible, chooseImages, nameEvidence, BAD_NAME } from './lib/images.mjs'
import { measureImage } from './lib/visual.mjs'
import { contactSheet, COLUMNS } from './lib/contact-sheet.mjs'
import { loadEditorial, compileEditorial, heroAllowSet, imageBlocked, applyToProject, finishLog } from './lib/editorial.mjs'
import { publicRecord, buildIndex, buildHome, buildStats, buildManifest, shardCount, shardOf, contentHash } from './lib/output.mjs'
import { checkDataset, checkReport, checkQuality, checkCandidates } from './lib/schema.mjs'
import { loadState, saveState, updateFailures, trackProjects, ORIGIN_SOURCE } from './lib/state.mjs'
import { compactTime, uniq, chunk, isQid, stableStringify, sha256, compareStrings, wikidataPage, bareFile, redactKeys } from './lib/util.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(HERE, '..')
const CATEGORY_ITEM = 'Q4167836'
const iso = (t) => new Date(t).toISOString()
const msg = (e) => redactKeys(String(e?.message || e)).slice(0, 300)
const isBudget = (e) => e?.code === 'budget'

export function loadConfig(overrides = {}) {
  const read = (name) => JSON.parse(readFileSync(path.join(HERE, 'config', name), 'utf8'))
  const pipeline = read('pipeline.json'), classes = read('classes.json'), categories = read('categories.json'), korea = read('korea.json')
  const merge = (a, b) => {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b
    const out = { ...(a || {}) }
    for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && a?.[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) && k !== 'wikis' ? merge(a[k], v) : v
    return out
  }
  return { pipeline: merge(pipeline, overrides.pipeline), classes: merge(classes, overrides.classes), categories: merge(categories, overrides.categories), korea: merge(korea, overrides.korea) }
}

/** Reads the previous published dataset (records by id) from site-data/. */
async function loadPrevious(siteDir) {
  const manifest = await readJSON(path.join(siteDir, 'manifest.json'), null)
  const records = new Map()
  if (manifest?.files?.shards) {
    for (const f of manifest.files.shards) {
      const s = await readJSON(path.join(siteDir, f), null)
      for (const r of s?.projects || []) records.set(r.id, r)
    }
  }
  return { manifest, records }
}

/** A stage timer and status recorder. */
function stages(clock) {
  const out = {}
  return {
    out,
    async run(name, fn) {
      const t = clock()
      out[name] = { status: 'running' }
      try { const r = await fn(); out[name] = { status: out[name].status === 'running' ? 'ok' : out[name].status, duration_ms: clock() - t }; return r } catch (e) {
        out[name] = { status: isBudget(e) ? 'partial' : 'error', duration_ms: clock() - t, error: msg(e) }
        throw e
      }
    },
    mark(name, status) { if (out[name]) out[name].status = status },
  }
}

/**
 * One pipeline run. Every external effect is injectable (fetch, clock, sleep, env), so tests run it over recorded
 * fixtures with a virtual clock.
 * @param {{dataDir: string, editorialDir?: string|null, fetch?: typeof fetch, clock?: () => number, sleep?: (ms: number) => Promise<void>,
 *   env?: Record<string, string|undefined>, overrides?: any, log?: (line: string) => void, seedFile?: string}} o
 */
export async function runPipeline(o) {
  const clock = o.clock ?? Date.now
  const sleep = o.sleep ?? defaultSleep
  const env = o.env ?? process.env
  const say = o.log ?? ((line) => process.stdout.write(line + '\n'))
  const cfg = loadConfig(o.overrides)
  const P = cfg.pipeline
  const catRulesLite = categoryRules(cfg.categories)
  const dataDir = path.resolve(o.dataDir)
  const dirs = { site: path.join(dataDir, 'site-data'), admin: path.join(dataDir, 'admin-data'), review: path.join(dataDir, 'review'), state: path.join(dataDir, 'state') }
  for (const d of Object.values(dirs)) await mkdir(d, { recursive: true })
  const t0 = clock()
  const startedAt = iso(t0)
  const budgetMs = (P.budget_minutes ?? 25) * 60e3
  const runDeadline = t0 + budgetMs
  const shares = P.stage_shares || {}
  let elapsedShare = 0
  const stageDeadline = (name) => { elapsedShare += shares[name] ?? 0; return Math.min(runDeadline, t0 + budgetMs * elapsedShare) }

  const httpLog = []
  const cache = new Cache({ dir: path.join(dirs.state, 'cache'), clock })
  const client = createClient({ fetch: o.fetch ?? globalThis.fetch, clock, sleep, cache, deadline: runDeadline, log: (e) => { if (httpLog.length < 500) httpLog.push({ at: iso(clock()), ...e }) } })
  const st = stages(clock)
  const errors = []
  const err = (stage, e, extra = {}) => { if (errors.length < 400) errors.push({ stage, message: msg(e), ...extra }) }
  const state = await loadState(dirs.state)
  const runNo = (state.runs.runs || 0) + 1
  const prev = await loadPrevious(dirs.site)
  const ttl = P.cache_ttl_hours || {}
  const sourceStatus = {}
  const status = (name, s) => { sourceStatus[name] = { ...s, last_success: s.status === 'ok' ? startedAt : state.failures.sources?.[name]?.last_success ?? prev.manifest?.sources?.[name]?.last_success ?? null } }
  say(`[pipeline] run ${runNo} started ${startedAt}, budget ${P.budget_minutes} min, data ${dataDir}`)

  // ---------------------------------------------------------------- editorial + seed
  const loadedEditorial = await loadEditorial(o.editorialDir ?? null)
  const ed = compileEditorial(loadedEditorial, { candidates: state.candidates })
  const heroAllow = heroAllowSet(ed)
  const seed = await loadSeed(o.seedFile ?? path.join(PROJECT_ROOT, 'site-public-cleared/assets/seed.js'))
  const today = startedAt.slice(0, 10)
  const observations = seedObservations(seed, { today })
  status('curated', { status: 'ok', items: observations.length, errors: [] })
  observations.push(...ed.created)
  if (ed.created.length) status('editorial', { status: 'ok', items: ed.created.length, errors: [] })

  // ---------------------------------------------------------------- sources (concurrent: different hosts)
  // Korea first: the Korean sources start first on every shared host (the per-host queues keep call order) and run
  // until the stage deadline; the foreign sources use a view of the client that stops korea.foreign_reserve_share of
  // the stage earlier, so the time budget never cuts Korean sources before foreign ones.
  client.setDeadline(stageDeadline('sources'))
  const KC = cfg.korea, gaz = compileGazetteer(KC), KO = P.korea || {}
  const sourcesMs = budgetMs * (shares.sources ?? 0.42)
  const foreign = client.view(() => client.deadline - sourcesMs * (KO.foreign_reserve_share ?? 0.2))
  let classReview = null, categories = null, wikiHits = [], webOut = null, krDiv = null, krInst = null, tourOut = null
  const S = P.sources || {}
  const koreaOn = S.korea?.enabled !== false
  await st.run('sources', async () => {
    const wikidataTask = (async () => {
      if (S.wikidata?.enabled === false) { status('wikidata', { status: 'disabled', items: 0, errors: [] }); return }
      const t = clock(), e = []
      try {
        // Live labels of every class, blocklist item, property and the country item (one or two requests).
        classReview = await discoverClasses(client, cfg.classes, { cache, ttlHours: ttl.class_counts ?? 24, counts: false, extraItems: [{ qid: KC.country.qid, label: KC.country.label, purpose: 'korea_country' }] })
        e.push(...classReview.errors)
        const props = new Map(classReview.properties.map((x) => [x.pid, x.ok]))
        const countryOk = classReview.items.find((x) => x.qid === KC.country.qid)?.ok === true
        // Korea: the first-level divisions (kr_region), then the items of the usable classes located in Korea.
        if (koreaOn && countryOk) {
          krDiv = await discoverKrDivisions(client, KC, { cache, ttlHours: ttl.kr_divisions ?? 168, gaz, properties: props })
          e.push(...krDiv.errors)
          if (props.get('P17') !== false) {
            krInst = await countryClassInstances(client, classReview.classes, KC.country.qid, { cache, ttlHours: ttl.sparql ?? 24, limit: KO.class_instance_limit ?? 2000 })
            e.push(...krInst.errors)
          }
        } else if (koreaOn) e.push({ stage: 'korea', message: `country item ${KC.country.qid} not confirmed this run (live label differs or was not read)` })
        // Discovery counts and the worldwide instances (foreign: stops first when time runs short).
        await addClassCounts(foreign, classReview.classes, { ttlHours: ttl.class_counts ?? 24, errors: e })
        const inst = await classInstances(foreign, classReview.classes, { cache, ttlHours: ttl.sparql ?? 24 })
        e.push(...inst.errors)
        classReview.instances = inst
        const n = new Set([...inst.byQid.keys(), ...(krInst?.byQid.keys() || [])]).size
        status('wikidata', { status: e.length ? (n ? 'partial' : 'error') : 'ok', items: n, korea_items: krInst?.byQid.size ?? 0, errors: e, duration_ms: clock() - t })
      } catch (x) {
        err('wikidata', x)
        const n = (classReview?.instances?.byQid.size ?? 0) + (krInst?.byQid.size ?? 0)
        status('wikidata', { status: isBudget(x) && n ? 'partial' : 'error', items: n, korea_items: krInst?.byQid.size ?? 0, errors: [...e, { message: msg(x) }], duration_ms: clock() - t })
      }
    })()
    const commonsTask = (async () => {
      if (S.commons?.enabled === false) { status('commons', { status: 'disabled', items: 0, errors: [] }); return }
      const t = clock()
      try {
        categories = await discoverCategories(client, cfg.categories, { cache, ttlHours: ttl.commons_category ?? 72, classQids: (cfg.classes.classes || []).map((c) => c.qid), foreign, korea: koreaOn })
        const n = [...categories.categories.values()].filter((c) => c.decision === 'candidate').length
        status('commons', { status: categories.partial ? 'partial' : categories.errors.length ? (n ? 'partial' : 'error') : 'ok', items: n, korea_items: [...categories.categories.values()].filter((c) => c.decision === 'candidate' && c.korea).length, errors: categories.errors, warnings: categories.warnings, duration_ms: clock() - t })
      } catch (x) { err('commons', x); status('commons', { status: 'error', items: 0, errors: [{ message: msg(x) }], duration_ms: clock() - t }) }
    })()
    const wikipediaTask = (async () => {
      if (S.wikipedia?.enabled === false) { status('wikipedia', { status: 'disabled', items: 0, errors: [] }); return }
      const t = clock()
      // One sequence per wiki (1 request per second each), the wikis in parallel; Korean Wikipedia (the wide Korean
      // term list) on the Korean deadline, the others on the foreign one.
      const runs = await Promise.all(Object.entries(P.wikipedia?.wikis || {}).map(([lang, terms]) =>
        discoverWikipedia(lang === 'ko' ? client : foreign, { ...P.wikipedia, wikis: { [lang]: terms } }, { cache }).catch((x) => ({ hits: [], errors: [{ stage: 'wikipedia', wiki: lang, message: msg(x) }], partial: isBudget(x) }))))
      wikiHits = runs.flatMap((r) => r.hits)
      const e = runs.flatMap((r) => r.errors), partial = runs.some((r) => r.partial)
      status('wikipedia', { status: partial ? 'partial' : e.length ? (wikiHits.length ? 'partial' : 'error') : 'ok', items: wikiHits.length, korea_items: wikiHits.filter((h) => h.lang === 'ko').length, errors: e, duration_ms: clock() - t })
    })()
    const tourTask = (async () => {
      if (!koreaOn || S.tourapi?.enabled === false) { status('tourapi', { status: 'disabled', items: 0, errors: [] }); return }
      const key = env.TOURAPI_SERVICE_KEY
      if (!key) { status('tourapi', { status: 'skipped', items: 0, errors: [], reason: 'TOURAPI_SERVICE_KEY not set' }); return }
      const t = clock()
      try {
        tourOut = await discoverTourApi(client, P.tourapi || {}, { key, cache, ttlHours: ttl.tourapi ?? 72, termRules: P.wikipedia?.term_rules || {} })
        status('tourapi', { status: tourOut.partial ? 'partial' : tourOut.errors.length ? (tourOut.items.length ? 'partial' : 'error') : 'ok', items: tourOut.accepted.length, seen: tourOut.items.length, errors: tourOut.errors.slice(0, 50), duration_ms: clock() - t })
      } catch (x) { err('tourapi', x); status('tourapi', { status: isBudget(x) ? 'partial' : 'error', items: 0, errors: [{ message: msg(x) }], duration_ms: clock() - t }) }
    })()
    const webTask = (async () => {
      if (S.web?.enabled === false) { status('web', { status: 'disabled', items: 0, errors: [] }); return }
      const t = clock()
      try {
        const rules = S.web?.rules || webRules({ gdelt: S.web?.gdelt !== false, rss: S.web?.rss !== false, getEnv: (k) => env[k] })
        const known = observations.filter((x) => x.origin === 'curated').map((x) => ({ id: x.curated_id, names: [x.name?.ko, x.name?.en].filter(Boolean), wikidata_qid: x.qid }))
        for (const r of prev.records.values()) known.push({ id: r.id, names: [r.name_ko, r.name_en, r.name_original].filter(Boolean), wikidata_qid: r.wikidata })
        webOut = await collectWeb({ client: foreign, rules, ruleState: state.webRules, projects: known, getEnv: (k) => env[k], deadline: foreign.deadline })
        const ok = webOut.results.filter((r) => r.status === 'success' || r.status === 'partial').length
        const failed = webOut.results.filter((r) => r.status === 'error').length
        status('web', { status: failed && !ok ? 'error' : failed || webOut.results.some((r) => r.reason === 'time_budget') ? 'partial' : 'ok', items: webOut.items.length, errors: webOut.errors.slice(0, 50), rules: webOut.results, duration_ms: clock() - t })
      } catch (x) { err('web', x); status('web', { status: 'error', items: 0, errors: [{ message: msg(x) }], duration_ms: clock() - t }) }
    })()
    await Promise.all([wikidataTask, commonsTask, wikipediaTask, tourTask, webTask])
  })
  say(`[pipeline] sources: ${Object.entries(sourceStatus).map(([k, v]) => `${k}=${v.status}(${v.items})`).join(' ')}`)

  // Observations from the sources (Korean ones first: they are enriched first).
  const classByQid = new Map((classReview?.classes || []).map((c) => [c.qid, c]))
  const classCfg = new Map((cfg.classes.classes || []).map((c) => [c.qid, c]))
  const classObservation = (qid, classQids, korea) => ({
    origin: 'wikidata_class', qid, korea,
    class_types: classQids.map((c) => ({ qid: c, project_type: classByQid.get(c)?.project_type, publish: !!(korea ? classByQid.get(c)?.publish_korea : classByQid.get(c)?.publish), low_confidence: !!classCfg.get(c)?.low_confidence, require_coordinates: !!classCfg.get(c)?.require_coordinates })),
    sources: [], evidence: [{ kind: 'wikidata_class', classes: classQids, ...(korea ? { country: KC.country.qid } : {}) }],
  })
  for (const [qid, classQids] of krInst?.byQid || []) observations.push(classObservation(qid, classQids, true))
  for (const [qid, classQids] of classReview?.instances?.byQid || []) observations.push(classObservation(qid, classQids, false))
  for (const t of tourOut?.accepted || []) observations.push(tourObservation(t))
  const evidenceCats = []
  for (const c of categories?.categories?.values() || []) {
    if (c.decision === 'evidence') evidenceCats.push(c)
    if (c.decision !== 'candidate') continue
    observations.push({
      origin: 'commons', category: c.title, qid: c.qid, lat: c.lat, lng: c.lng, place_hint: c.place_hint, project_type: c.project_type, korea: !!c.korea,
      parts: c.parts || [], editions: c.editions || [], night_subcats: [],
      sources: [], evidence: [{ kind: 'commons_category', title: c.title, root: c.root, reason: c.reason, via_file: c.via_file || null }],
    })
  }
  const accept = Number(P.wikipedia?.accept_score ?? 50)
  const configuredClassQids = new Set((cfg.classes.classes || []).map((c) => c.qid))
  // Wikipedia hits: a broad term (config wikipedia.term_rules) needs a higher score; the term names the type.
  const termRules = P.wikipedia?.term_rules || {}
  for (const h of wikiHits) {
    const rule = termRules[h.term] || {}
    h.min_score = rule.min_score ?? accept
    if (h.score < h.min_score || !h.qid || configuredClassQids.has(h.qid)) continue
    observations.push({ origin: 'wikipedia', qid: h.qid, korea: h.lang === 'ko', sources: [], evidence: [{ kind: 'wikipedia', lang: h.lang, title: h.title, url: h.url, term: h.term, score: h.score, reasons: h.reasons, accepted: false, ...(rule.type ? { type: rule.type } : {}) }] })
  }

  // ---------------------------------------------------------------- enrichment
  client.setDeadline(stageDeadline('enrich'))
  const facts = new Map(), entityP31 = new Map(), wikiDecisions = []
  let auxMap = new Map()
  const badProps = new Set((classReview?.properties || []).filter((p) => p.ok === false).map((p) => p.pid))
  const blockActive = new Set((cfg.classes.blocklist || []).filter((b) => b.verified || (classReview?.blocklist || []).find((x) => x.qid === b.qid)?.label_matches).map((b) => b.qid))
  await st.run('enrich', async () => {
    const t = clock(), e = []
    const props = Object.keys(cfg.classes.properties || {}).filter((k) => /^P\d+$/.test(k) && !badProps.has(k))
    // Korea first: items from the Korean sources and the curated places are read before the others.
    const priority = new Set(observations.filter((x) => x.korea || x.origin === 'curated' || x.origin === 'tourapi').map((x) => x.qid).filter(isQid))
    const opts = { cache, ttlHours: ttl.entities ?? 72, properties: props, languages: P.label_languages || ['ko', 'en'], wikis: P.sitelink_wikis || ['kowiki', 'enwiki'], priority }
    try {
      let { entities, redirects, errors: e1 } = await fetchEntities(client, uniq(observations.map((x) => x.qid).filter(isQid)), opts)
      e.push(...e1)
      for (const x of observations) if (x.qid && redirects.has(x.qid)) x.qid = redirects.get(x.qid)
      // A Commons category's item may be the category item: follow its main topic (P301).
      const topics = new Map()
      for (const [q, ent] of entities) if ((ent.claims.P31 || []).some((v) => v.item === CATEGORY_ITEM)) topics.set(q, (ent.claims.P301 || [])[0]?.item || null)
      if (topics.size) {
        const more = await fetchEntities(client, [...topics.values()].filter(isQid), opts)
        e.push(...more.errors)
        for (const [q, ent] of more.entities) entities.set(q, ent)
        for (const x of observations) if (x.qid && topics.has(x.qid)) { x.category_item = x.qid; x.qid = topics.get(x.qid) ? (more.redirects.get(topics.get(x.qid)) || topics.get(x.qid)) : null }
      }
      // Aux rounds: countries (ISO codes), administrative areas up to the city, class labels, people.
      const krEntities = [...entities.values()].filter((ent) => priority.has(ent.id) || (ent.claims.P17 || []).some((v) => v.item === KC.country.qid))
      const auxPriority = new Set(auxRefs(krEntities))
      const aux = await fetchAux(client, auxRefs(entities.values()), { cache, ttlHours: ttl.entities_aux ?? 720, priority: auxPriority })
      e.push(...aux.errors)
      auxMap = aux.aux
      for (let round = 0; round < 3; round++) {
        const next = auxNext(auxMap, [...auxMap.keys()])
        if (!next.length) break
        const r = await fetchAux(client, next, { cache, ttlHours: ttl.entities_aux ?? 720, priority: new Set(auxNext(auxMap, [...auxPriority])) })
        e.push(...r.errors)
        for (const [k, v] of r.aux) auxMap.set(k, v)
      }
      const cityPattern = new RegExp(P.entity_rules?.city_class_pattern || '\\bcity\\b', 'i')
      for (const [q, ent] of entities) {
        facts.set(q, factsOf(ent, auxMap, { cityPattern, originalLanguageByCountry: P.original_language_by_country || {}, labelLanguages: P.label_languages }))
        entityP31.set(q, (ent.claims.P31 || []).map((v) => v.item).filter(Boolean))
      }
      status('enrich', { status: e.length ? 'partial' : 'ok', items: facts.size, errors: e.slice(0, 50), duration_ms: clock() - t })
    } catch (x) {
      err('enrich', x)
      status('enrich', { status: isBudget(x) ? 'partial' : 'error', items: facts.size, errors: [...e.slice(0, 50), { message: msg(x) }], duration_ms: clock() - t })
    }
  })

  // Wikipedia hits: accepted only for a building/structure/place item (not a person, company, product, technology,
  // area or class), with the score already above the threshold.
  const rules = P.entity_rules || {}
  for (const x of observations.filter((y) => y.origin === 'wikipedia')) {
    const ev = x.evidence[0]
    const f = x.qid ? facts.get(x.qid) : null
    const a = f ? acceptEntity(f, rules) : { ok: false, reasons: ['no_wikidata_facts'] }
    ev.accepted = a.ok
    ev.entity_reasons = a.reasons
    if (a.ok && f.p31_labels.some((l) => /\b(festival|event|show)\b/i.test(l))) ev.type = 'festival_program'
    else if (a.ok && f.p31_labels.some((l) => /\b(museum|gallery|exhibition|art centre|art center)\b/i.test(l)) && (ev.type ?? 'media_facade') === 'media_facade' && !/파사드|facade|façade|fassade/i.test(ev.term)) ev.type = 'media_architecture'
    wikiDecisions.push({ qid: x.qid, url: ev.url, lang: ev.lang, term: ev.term, score: ev.score, reasons: ev.reasons, accepted: a.ok, entity_reasons: a.reasons, p31_labels: f?.p31_labels || [] })
  }
  const kept = observations.filter((x) => x.origin !== 'wikipedia' || x.evidence[0].accepted)
  // Class instances: typing by the item's own P31, blocklist and exclusion rules.
  const exclude = rules.exclude_class_pattern ? new RegExp(rules.exclude_class_pattern, 'i') : null
  for (const x of kept) for (const c of x.class_types || []) c.direct = (entityP31.get(x.qid) || []).includes(c.qid)

  // ---------------------------------------------------------------- entity resolution and dedupe
  let projects = [], clusters = null, merges = [], idAliases = new Map()
  await st.run('resolve', async () => {
    clusters = clusterObservations(kept, facts)
    const build = () => {
      const out = []
      for (const [root, keys] of clusters.groups()) {
        const obs = keys.filter((k) => k.startsWith('obs:')).map((k) => kept[Number(k.slice(4))])
        if (!obs.length) continue
        const qids = [...(clusters.qids.get(root) || [])].sort()
        const intoQid = obs.find((x) => x.merge_into_qid)?.merge_into_qid
        const curatedQid = obs.find((x) => x.origin === 'curated' && x.qid)?.qid
        const primary = curatedQid || (intoQid && qids.includes(intoQid) ? intoQid : null) || qids.find((q) => facts.has(q)) || qids[0] || null
        const p = buildProject(obs, primary ? facts.get(primary) || null : null, { year: Number(today.slice(0, 4)) })
        if (primary && !p.qid) p.qid = primary
        for (const q of qids) if (q !== primary && !p.sources.some((s) => s.url === wikidataPage(q))) p.sources.push({ id: 'wikidata:' + q, kind: 'wikidata', title: `Wikidata ${q}`, url: wikidataPage(q), publisher: 'Wikidata' })
        p.all_qids = qids
        p._root = root
        p.id = newId(p)
        out.push(p)
      }
      return out
    }
    let first = build()
    merges = mergeByNameAndUrl(clusters, first)
    // Editorial merges: forced unions; the kept record is the "into" project.
    const rootOf = new Map()
    for (const p of first) for (const id of [p.id, p.qid, p.curated_id, ...(p.all_qids || [])].filter(Boolean)) rootOf.set(id, p._root)
    for (const m of ed.merges) {
      const a = rootOf.get(m.from), b = rootOf.get(m.into)
      if (!a || !b) { m.entry.status = 'target_not_found'; continue }
      clusters.union(a, b, 'editorial_merge', { force: true, detail: { from: m.from, into: m.into } })
      const into = first.find((p) => p._root === b)
      if (into?.qid) kept.forEach((x, i) => { if (clusters.find('obs:' + String(i).padStart(6, '0')) === clusters.find(b)) x.merge_into_qid = into.qid })
      m.entry.status = 'applied'; m.entry.project = m.into
      idAliases.set(m.from, m.into)
    }
    projects = build()
    // Ids that changed because records merged (old id → new id): the tracker keeps first_seen.
    const finalByRoot = new Map(projects.map((p) => [clusters.find(p._root), p]))
    for (const p of first) { const f = finalByRoot.get(clusters.find(p._root)); if (f && f.id !== p.id) idAliases.set(p.id, f.id) }
    for (const p of projects) p.merged_ids = [...idAliases].filter(([, to]) => to === p.id).map(([from]) => from)
  })

  // ---------------------------------------------------------------- editorial, blocklist, eligibility
  const excluded = [], published = []
  const krDecisions = []
  for (const p of projects) {
    applyToProject(ed, p)
    // kr_region (lib/korea.mjs): every rule's outcome is logged in review/korea.json.
    const kr = krRegionOf(p, { facts: p.qid ? facts.get(p.qid) : null, auxMap, confirmed: krDiv?.confirmed || new Map(), gaz, cfg: KC })
    p.kr_region = kr.region
    if (kr.region) p.field_sources = { ...(p.field_sources || {}), kr_region: { editorial: 'editorial', curated_seoul: 'curated', p131: 'wikidata', p131_labels: 'wikidata', tourapi_ldong: 'tourapi', tourapi_areacode: 'tourapi' }[kr.rule] || 'derived:gazetteer' }
    if (p.country_iso2 === 'KR') krDecisions.push({ id: p.id, qid: p.qid || null, name: p.name_ko || p.name_en || p.name_original, ...kr })
    const p31 = uniq((p.all_qids || [p.qid]).flatMap((q) => entityP31.get(q) || []))
    const blocked = p31.filter((q) => blockActive.has(q))
    if (exclude && !p.curated_id) for (const l of p.p31_labels || []) if (exclude.test(l) && !(p.origins.includes('wikidata_class') && p.class_publish)) blocked.push('class_label:' + l)
    if (p.qid && entityP31.get(p.qid)?.includes(CATEGORY_ITEM)) blocked.push('category_item_without_topic')
    p.blocked_by = uniq(blocked)
    const ct = (p.evidence || []).filter((e) => e.kind === 'wikidata_class')
    p.require_coordinates = ct.length > 0 && !p.origins.some((x) => x !== 'wikidata_class') && kept.filter((x) => x.qid === p.qid).flatMap((x) => x.class_types || []).filter((c) => c.publish).every((c) => c.require_coordinates)
    const el = eligibility(p)
    p.eligibility = el
    if (el.eligible) published.push(p)
    else excluded.push({ id: p.id, qid: p.qid, name: p.name_en || p.name_ko || p.name_original, origins: p.origins, reasons: el.reasons })
  }
  say(`[pipeline] resolved ${projects.length} projects from ${kept.length} observations: ${published.length} eligible, ${excluded.length} excluded`)

  // ---------------------------------------------------------------- images
  client.setDeadline(stageDeadline('images'))
  const IC = P.images || {}
  const imageResults = new Map(), imageReview = [], sheetTiles = { hero: [], cards: [] }
  const evidenceByKey = new Map()
  for (const c of evidenceCats) {
    const parent = nightParent(c.title)
    for (const key of [c.qid && 'q:' + c.qid, parent && 'c:' + parent].filter(Boolean)) evidenceByKey.set(key, [...(evidenceByKey.get(key) || []), c.title])
  }
  const typeOrder = ['media_facade', 'projection_mapping', 'media_wall', 'urban_screen', 'interactive_installation', 'light_art', 'media_architecture', 'festival_program', 'other']
  // Korea first: Korean projects get their images before any foreign one, so a short budget cuts foreign images first.
  const order = [...published].sort((a, b) => (b.country_iso2 === 'KR' ? 1 : 0) - (a.country_iso2 === 'KR' ? 1 : 0) || (b.curated_id ? 1 : 0) - (a.curated_id ? 1 : 0) || (prev.records.get(b.id)?.images?.length ? 1 : 0) - (prev.records.get(a.id)?.images?.length ? 1 : 0) || typeOrder.indexOf(a.project_type) - typeOrder.indexOf(b.project_type) || (b.p18.length ? 1 : 0) - (a.p18.length ? 1 : 0) || compareStrings(a.id, b.id))
  let thumbsFetched = 0, depictsAsked = 0
  const heroOutcome = new Map()
  const imageStats = { processed: 0, kept_previous: 0, none: 0, candidates: 0, rejected: {}, measured: 0, measure_errors: 0 }
  await st.run('images', async () => {
    const groups = chunk(order, 6)
    for (let gi = 0; gi < groups.length; gi++) {
      const group = groups[gi]
      if (client.clock() >= client.deadline) { for (const p of groups.slice(gi).flat()) keepPrevImages(p); st.mark('images', 'partial'); break }
      try {
        const cands = new Map()
        for (const p of group) cands.set(p.id, await gatherCandidates(p))
        const files = uniq([...cands.values()].flat().map((c) => c.file))
        const info = files.length ? await fileInfo(client, files, { cache, ttlHours: ttl.commons_files ?? 336, thumbWidth: IC.thumb_width ?? 330 }) : new Map()
        for (const p of group) await scoreProject(p, cands.get(p.id), info)
      } catch (x) {
        if (!isBudget(x)) err('images', x, { projects: group.map((p) => p.id) })
        for (const p of group) if (!imageResults.has(p.id)) keepPrevImages(p)
        if (isBudget(x)) { for (const p of groups.slice(gi + 1).flat()) keepPrevImages(p); st.mark('images', 'partial'); break }
      }
    }
  })

  function keepPrevImages(p) {
    if (imageResults.has(p.id)) return
    const old = prev.records.get(p.id) || p.merged_ids.map((id) => prev.records.get(id)).find(Boolean)
    const images = (old?.images || []).filter((i) => !imageBlocked(ed, p.id, i.page?.split('File:')[1] ? decodeURIComponent(i.page.split('File:')[1]).replace(/_/g, ' ') : ''))
    const pick = state.imagePicks?.[p.id] || old && state.imagePicks?.[old.id] || null
    imageResults.set(p.id, { images, status: 'kept_previous', home: pick?.home ? images.find((i) => i.page === pick.home && i.tier <= 3) || null : null, hero: images.find((i) => i.role === 'hero') || null, score: pick?.score ?? 0 })
    imageStats.kept_previous++
  }

  async function gatherCandidates(p) {
    const out = []
    const add = (file, source, category = null) => {
      const f = bareFile(file)
      if (!f || out.some((c) => c.file === f)) return
      if (!/\.(jpe?g|png|webp)$/i.test(f) || BAD_NAME.test(f.replace(/\.[a-z0-9]+$/i, ''))) return
      out.push({ file: f, source, category })
    }
    for (const f of p.p18 || []) add(f, 'p18')
    const cats = [...(p.image_categories || [])]
    for (const key of [p.qid && 'q:' + p.qid, p.commons_category && 'c:' + p.commons_category].filter(Boolean)) for (const t of evidenceByKey.get(key) || []) cats.push({ title: t, source: 'night_category' })
    const seenCats = new Set()
    let subcatBudget = IC.max_subcategories ?? 3
    for (const c of cats.slice(0, IC.max_categories_per_project ?? 4)) {
      if (seenCats.has(c.title)) continue
      seenCats.add(c.title)
      const m = await categoryMembers(client, c.title, { cache, ttlHours: ttl.commons_members ?? 72, limit: IC.members_per_category ?? 200 })
      for (const f of m.files) add(f, isNightCategory(c.title, catRulesLite) && c.source === 'category' ? 'night_category' : c.source, c.title)
      if (c.source !== 'category') continue
      // The project category's own "at night" / illuminated / event subcategories.
      const subs = m.subcats.filter((s) => isNightCategory(s, catRulesLite) || isEventCategory(s, catRulesLite)).sort((a, b) => (isNightCategory(b, catRulesLite) ? 1 : 0) - (isNightCategory(a, catRulesLite) ? 1 : 0) || compareStrings(b, a))
      for (const s of subs) {
        if (subcatBudget-- <= 0 || seenCats.has(s)) break
        seenCats.add(s)
        for (const f of await categoryFiles(client, s, { cache, ttlHours: ttl.commons_members ?? 72, limit: IC.files_per_subcategory ?? 40 })) add(f, isNightCategory(s, catRulesLite) ? 'night_category' : 'event_category', s)
      }
    }
    // Files whose structured data depicts the item (P180), only for a project none of whose candidates names both
    // night and media evidence: one search per project, at most depicts_max_per_run new searches, cached two weeks.
    if (p.qid && IC.depicts !== false && !out.some((c) => { const n = nameEvidence(c.file); return n.night >= 30 && n.media >= 30 })) {
      const cached = cache.fresh('commons-depicts', p.qid) !== undefined
      if (cached || depictsAsked < (IC.depicts_max_per_run ?? 80)) {
        if (!cached) depictsAsked++
        for (const f of await depictsFiles(client, p.qid, { cache, ttlHours: ttl.commons_depicts ?? 336, limit: IC.depicts_per_project ?? 30 })) add(f, 'depicts')
      }
    }
    const bonus = { p18: 15, night_category: 40, event_category: 20, part_category: 10, depicts: 5, category: 0 }
    const ranked = out.map((c) => { const n = nameEvidence(c.file); return { ...c, pre: n.night + n.media + (bonus[c.source] ?? 0) } }).sort((a, b) => b.pre - a.pre || compareStrings(a.file, b.file))
    imageStats.candidates += ranked.length
    return ranked.slice(0, IC.max_candidates_per_project ?? 16)
  }

  async function scoreProject(p, cands, info) {
    const assessed = []
    for (const c of cands) {
      const i = info.get(c.file)
      const a = assessCandidate(c, i, { project_type: p.project_type, rightsPolicy: IC.rights_policy, minWidth: IC.min_width, minHeight: IC.min_height })
      for (const r of a.reasons) imageStats.rejected[r.split(':')[0] === 'rights' ? r : r.replace(/:.*/, '')] = (imageStats.rejected[r.split(':')[0] === 'rights' ? r : r.replace(/:.*/, '')] || 0) + 1
      assessed.push({ ...c, a, info: i })
    }
    const usable = assessed.filter((s) => s.a.ok && !imageBlocked(ed, p.id, s.file))
    // Measure the most promising few (thumbnail downloads are the costly part).
    const toMeasure = [...usable].sort((x, y) => (y.a.night + y.a.media + (y.source === 'p18' ? 10 : 0)) - (x.a.night + x.a.media + (x.source === 'p18' ? 10 : 0)) || compareStrings(x.file, y.file)).slice(0, IC.max_scored_per_project ?? 6)
    const buffers = new Map()
    for (const s of toMeasure) {
      const key = s.file + '|' + (s.info.sha1 || '')
      let m = cache.fresh('visual', key)
      if (m === undefined && thumbsFetched < (IC.max_thumbs_per_run ?? 1800) && s.info.thumburl) {
        try {
          const b = await client.bytes(s.info.thumburl, { stage: 'images' })
          thumbsFetched++
          m = await measureImage(b.bytes, IC.score_width ?? 320)
          buffers.set(s.file, b.bytes)
          cache.set('visual', key, m, { ttlMs: (ttl.visual ?? 8760) * HOUR })
          imageStats.measured++
        } catch (x) { if (isBudget(x)) throw x; imageStats.measure_errors++; m = null; err('images_thumb', x, { file: s.file }) }
      }
      s.m = m ?? null
    }
    for (const s of usable) { s.m = s.m ?? null; s.t = tierOf(s.a, s.m, IC) }
    const choice = chooseImages(p, usable.map((s) => ({ file: s.file, source: s.source, a: s.a, m: s.m, info: s.info, t: s.t })), { heroAllow, blocked: new Set(), galleryMax: IC.gallery_max ?? 12, th: IC })
    const homePick = choice.hero || choice.usable.find((s) => s.t.home_ok) || null
    const images = choice.images
    const homeImage = homePick ? images.find((i) => i.file === homePick.file) || null : null
    imageResults.set(p.id, { images, status: 'scored', hero: choice.hero ? images.find((i) => i.role === 'hero') : null, home: homeImage && homeImage.tier <= 3 ? homeImage : null, score: homePick ? (homePick.m?.visual ?? 0) + (4 - homePick.t.tier) * 20 : 0 })
    imageStats.processed++
    if (!images.length) imageStats.none++
    imageReview.push({
      project: p.id, name: p.name_en || p.name_ko, type: p.project_type, card: choice.card?.file ?? null, hero: choice.hero?.file ?? null,
      candidates: assessed.map((s) => ({ file: s.file, source: s.source, ok: s.a.ok, reasons: s.a.reasons, night: s.a.night ?? null, media: s.a.media ?? null, night_terms: s.a.night_terms, media_terms: s.a.media_terms, evidence: s.a.evidence, visual: s.m ?? null, tier: s.t?.tier ?? null, home_ok: s.t?.home_ok ?? false })),
      hero_decisions: choice.decisions,
    })
    for (const d of choice.decisions) if (d.allowlisted) heroOutcome.set(p.id + '|' + d.file, { hero: choice.hero?.file === d.file, reasons: d.reasons })
    for (const d of choice.decisions) {
      const s = usable.find((x) => x.file === d.file)
      sheetTiles.hero.push({ project: p.id, file: d.file, tier: s?.t?.tier, visual: s?.m?.visual ?? null, night: s?.a.night, media: s?.a.media, hero_candidate: d.hero_candidate, allowlisted: d.allowlisted, buffer: buffers.get(d.file) || null, thumb: s?.info?.thumburl })
    }
    if (choice.card && choice.card.t.tier <= 3) sheetTiles.cards.push({ project: p.id, file: choice.card.file, tier: choice.card.t.tier, visual: choice.card.m?.visual ?? null, night: choice.card.a.night, media: choice.card.a.media, buffer: buffers.get(choice.card.file) || null, thumb: choice.card.info.thumburl })
  }

  // Hero allowlist outcomes (hero.json entries and set_hero/unset_hero decisions).
  const publishedIds = new Set(published.map((p) => p.id))
  for (const [key, v] of ed.heroAllow) {
    const [project, file] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)]
    if (!publishedIds.has(project)) continue
    v.entry.status = 'applied'; v.entry.project = project
    const out = heroOutcome.get(key)
    if (v.on && !out?.hero) v.entry.reasons.push(out ? 'not_hero:' + out.reasons.join(',') : 'image_not_a_usable_candidate:' + file)
  }
  const heroList = ed.heroList.map((h) => {
    const out = heroOutcome.get(h.project + '|' + h.image)
    return { project: h.project, image: h.image, note: h.note, status: !publishedIds.has(h.project) ? 'project_not_published' : out?.hero ? 'hero' : out ? 'not_eligible' : imageResults.get(h.project)?.status === 'kept_previous' ? 'not_scored_this_run' : 'image_not_a_usable_candidate', reasons: out?.reasons || [] }
  })

  // ---------------------------------------------------------------- contact sheets (review/contact-sheets/)
  const sheets = []
  await st.run('contact_sheets', async () => {
    const dir = path.join(dirs.review, 'contact-sheets')
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
    const perSheet = COLUMNS * 8
    for (const [kind, tiles] of Object.entries(sheetTiles)) {
      for (let s = 0; s * perSheet < tiles.length; s++) {
        const part = tiles.slice(s * perSheet, (s + 1) * perSheet)
        const name = `${kind === 'hero' ? 'hero-candidates' : 'cards'}-${String(s + 1).padStart(2, '0')}.jpg`
        try {
          const jpg = await contactSheet(part.map((t, i) => ({ buffer: t.buffer, lines: [`#${s * perSheet + i + 1} ${t.project}`, `T${t.tier ?? '-'} V${t.visual ?? '-'} ${t.allowlisted ? 'OK' : t.hero_candidate ? 'H?' : ''}`.trim()] })))
          await writeFileAtomic(path.join(dir, name), jpg)
          sheets.push({ sheet: name, kind, tiles: part.map((t, i) => ({ n: s * perSheet + i + 1, project: t.project, file: t.file, thumb: t.thumb || null, tier: t.tier ?? null, visual: t.visual, night: t.night ?? null, media: t.media ?? null, hero_candidate: !!t.hero_candidate, allowlisted: !!t.allowlisted, image_in_sheet: !!t.buffer })) })
        } catch (x) { err('contact_sheets', x, { sheet: name }) }
      }
    }
    await writeJSON(path.join(dir, 'index.json'), { schema: 1, generated_at: startedAt, about: 'Tiles of each sheet: #n, project id, file, tier (1 media active at night … 4 context), visual score, keyword scores. "OK" = on the hero allowlist; "H?" = hero candidate awaiting review (add it to editorial/hero.json after looking at it).', sheets }, { pretty: true })
  })

  // ---------------------------------------------------------------- link checks
  client.setDeadline(stageDeadline('links'))
  let linkRows = []
  await st.run('links', async () => {
    const targets = []
    for (const p of [...published].sort((a, b) => (b.country_iso2 === 'KR' ? 1 : 0) - (a.country_iso2 === 'KR' ? 1 : 0))) {
      if (p.official_url) targets.push({ url: p.official_url, project: p.id, field: 'official_url' })
      for (const s of p.sources) if (!['wikidata', 'wikipedia', 'commons'].includes(s.kind) && s.url !== p.official_url) targets.push({ url: s.url, project: p.id, field: 'source:' + s.id })
    }
    try {
      const r = await checkLinks(targets, { client, cache, ttlHours: P.links?.ttl_hours ?? 168, max: P.links?.max_per_run ?? 400, skipHosts: P.links?.skip_hosts || [], deadline: client.deadline })
      linkRows = r.rows
      status('links', { status: r.unchecked ? 'partial' : 'ok', items: r.checked, errors: [], from_cache: r.from_cache, unchecked: r.unchecked })
    } catch (x) { err('links', x); status('links', { status: 'error', items: 0, errors: [{ message: msg(x) }] }) }
  })

  // ---------------------------------------------------------------- Overpass (optional coordinate confirmation)
  let overpassRows = []
  if (S.overpass?.enabled !== false) {
    client.setDeadline(runDeadline)
    await st.run('overpass', async () => {
      try {
        const r = await checkCoordinates(client, published.filter((p) => p.qid && p.latitude !== null).map((p) => ({ id: p.id, qid: p.qid, lat: p.latitude, lng: p.longitude })), { cache, max: S.overpass?.max_items ?? 50, ttlHours: ttl.overpass ?? 720 })
        overpassRows = r.rows
        status('overpass', { status: r.error ? 'skipped' : 'ok', items: r.asked, errors: r.error ? [{ message: r.error }] : [] })
      } catch (x) { status('overpass', { status: 'skipped', items: 0, errors: [{ message: msg(x) }] }) }
    })
  } else status('overpass', { status: 'disabled', items: 0, errors: [] })

  // ---------------------------------------------------------------- output
  const finishedAt = () => iso(clock())
  const records = []
  const decided = new Set()
  // A previously published project that is now hidden, or ineligible while every source it came from completed, is
  // removed at once; one that is ineligible because a source failed keeps its previous record (trackProjects).
  for (const x of excluded) {
    const origins = state.tracker.projects?.[x.id]?.origins || x.origins
    const complete = sourceStatus.enrich?.status === 'ok' && origins.every((o) => sourceStatus[ORIGIN_SOURCE[o] || o]?.status === 'ok')
    if (complete || x.reasons.includes('hidden_by_editor')) decided.add(x.id)
  }
  for (const x of excluded) for (const [from, to] of idAliases) if (to === x.id && decided.has(x.id)) decided.add(from)
  const publishedInfo = new Map(published.map((p) => [p.id, { origins: p.origins }]))
  const track = trackProjects(state.tracker, prev.records, { published: publishedInfo, decided, sourceStatus, runNo, nowIso: startedAt, staleAfter: P.output?.stale_after_missing_runs ?? 3, aliases: idAliases })
  const carriedIds = new Set(track.carried.map((c) => c.id))
  const count = shardCount(published.length + carriedIds.size, P.output?.shard_target ?? 200)
  for (const p of published) {
    const ir = imageResults.get(p.id) || { images: [] }
    p.images = ir.images
    const shard = shardOf(p.id, count)
    const r = publicRecord(p, { shard, addedAt: track.tracker.projects[p.id]?.first_seen || startedAt })
    records.push(r)
    track.tracker.projects[p.id].hash = sha256(stableStringify({ ...r, added_at: null, shard: null })).slice(0, 16)
  }
  for (const id of carriedIds) {
    const old = prev.records.get(id)
    if (old) records.push({ ...old, shard: shardOf(id, count) })
  }
  records.sort((a, b) => compareStrings(a.id, b.id))
  const newIds = records.filter((r) => !prev.records.has(r.id)).map((r) => r.id)
  const changed = records.filter((r) => prev.records.has(r.id) && stableStringify({ ...prev.records.get(r.id), shard: null }) !== stableStringify({ ...r, shard: null })).map((r) => r.id)
  const picks = new Map()
  for (const r of records) {
    const ir = imageResults.get(r.id)
    const hero = r.images.find((i) => i.role === 'hero' && i.tier === 1) || null
    picks.set(r.id, { hero, home: ir?.home ?? (r.images.find((i) => i.role === 'hero') || null), score: ir?.score ?? (hero ? 80 : 0) })
  }
  const sourcesManifest = Object.fromEntries(['wikidata', 'commons', 'wikipedia', 'tourapi', 'curated', 'web'].filter((k) => sourceStatus[k]).map((k) => [k, { status: sourceStatus[k].status, last_success: sourceStatus[k].last_success, items: sourceStatus[k].items ?? null }]))
  const hashParts = { records }
  const hash = contentHash(hashParts)
  const unchanged = state.runs.last_good?.content_hash === hash && prev.manifest
  const buildId = unchanged ? prev.manifest.build_id : `${compactTime(startedAt).slice(0, 15)}Z-${hash.slice(0, 8)}`
  const generatedAt = unchanged ? prev.manifest.generated_at : startedAt
  const shards = [...new Set(records.map((r) => r.shard))].sort()
  const files = {
    manifest: buildManifest({ buildId, generatedAt, records, shards, sources: unchanged ? prev.manifest.sources : sourcesManifest }),
    index: buildIndex(records),
    home: buildHome(records, picks, { buildId, generatedAt, heroMax: P.output?.home_hero_max ?? 6, featuredMax: P.output?.home_featured ?? 12 }),
    stats: buildStats(records, { buildId, generatedAt }),
    shards: Object.fromEntries(shards.map((s) => [s, { schema: 1, shard: s, build_id: buildId, projects: records.filter((r) => r.shard === s) }])),
  }
  const validation = checkDataset(files)
  const prevCount = prev.records.size
  const dropGuard = prevCount > 0 && records.length < prevCount * (1 - (P.output?.max_drop_ratio ?? 0.5))
  let publishStatus = 'published'
  if (validation.length) publishStatus = 'kept_previous_invalid_output'
  else if (dropGuard) publishStatus = 'kept_previous_drop_guard'
  else if (unchanged) publishStatus = 'unchanged'
  const anyPartial = Object.values(sourceStatus).some((s) => s.status === 'partial' || s.status === 'error') || Object.values(st.out).some((s) => s.status !== 'ok')
  if (publishStatus === 'published' || publishStatus === 'unchanged') {
    const staging = dirs.site + '.staging-' + process.pid
    await rm(staging, { recursive: true, force: true })
    await mkdir(path.join(staging, 'projects'), { recursive: true })
    await writeJSON(path.join(staging, 'manifest.json'), files.manifest, { pretty: true })
    await writeJSON(path.join(staging, 'index.json'), files.index)
    await writeJSON(path.join(staging, 'home.json'), files.home)
    await writeJSON(path.join(staging, 'stats.json'), files.stats)
    for (const [s, v] of Object.entries(files.shards)) await writeJSON(path.join(staging, 'projects', s + '.json'), v)
    await swapDir(staging, dirs.site)
  }
  const published_ = publishStatus === 'published' || publishStatus === 'unchanged'
  say(`[pipeline] output: ${publishStatus}, ${records.length} projects (${newIds.length} new, ${changed.length} changed, ${track.removed.length} removed, ${track.carried.length} carried over), build ${buildId}`)

  // ---------------------------------------------------------------- admin-data, review, state
  const decisions = finishLog(ed)
  const heroCandidates = sheetTiles.hero.filter((t) => t.hero_candidate && !t.allowlisted).length
  const candidates = mergeCandidates(state.candidates, webOut?.items || [], { now: clock() })
  const reviewQueue = Object.values(candidates).filter((c) => c.status === 'needs_review' || c.status === 'uncertain').length
  // Suspected duplicates: pairs the merge rules refused to join (two QIDs) that are still separate projects.
  const dupes = (clusters?.conflicts || []).map((c) => ({ rule: c.reason, qids: c.qids, detail: c.detail ?? null, projects: uniq(c.qids.map((q) => projects.find((p) => (p.all_qids || []).includes(q))?.id)) })).filter((d) => d.projects.length > 1)
  const quality = {
    schema: 1, build_id: buildId, generated_at: startedAt,
    missing_images: records.filter((r) => !r.images.length).map((r) => ({ id: r.id, name: r.name_en || r.name_ko, project_type: r.project_type, country_iso2: r.country_iso2 })),
    no_home_image: records.filter((r) => !picks.get(r.id)?.home && r.images.length).map((r) => ({ id: r.id, best_tier: Math.min(...r.images.map((i) => i.tier)) })),
    broken_links: linkRows.filter((l) => l.state === 'broken').map((l) => ({ project: l.project, field: l.field, url: l.url, http_status: l.http_status, reason: l.reason, consecutive_failures: l.consecutive_failures, checked_at: l.checked_at })),
    robots_disallowed: linkRows.filter((l) => l.state === 'robots_disallowed').map((l) => ({ project: l.project, url: l.url })),
    suspected_duplicates: dupes,
    stale: track.stale,
    low_confidence_types: published.filter((p) => p.type_low_confidence).map((p) => ({ id: p.id, project_type: p.project_type, type_source: p.type_source })),
    excluded: excluded.sort((a, b) => compareStrings(a.id, b.id)),
    coordinate_checks: overpassRows.filter((r) => r.status === 'mismatch'),
    image_rejections: imageStats.rejected,
  }
  const counts = {
    observations: observations.length, observations_kept: kept.length, projects_built: projects.length, published: records.length,
    new: newIds.length, changed: changed.length, merged: merges.length + ed.merges.filter((m) => m.entry.status === 'applied').length,
    removed: track.removed.length, carried_over: track.carried.length, stale: track.stale.length, excluded: excluded.length,
    with_images: records.filter((r) => r.images.length).length, with_hero: records.filter((r) => r.images.some((i) => i.role === 'hero')).length,
    hero_candidates_awaiting_review: heroCandidates, candidates_awaiting_review: reviewQueue,
  }
  const report = {
    schema: 1,
    run: {
      number: runNo, started_at: startedAt, finished_at: finishedAt(), duration_ms: clock() - t0, budget_minutes: P.budget_minutes,
      status: !published_ ? publishStatus : anyPartial ? 'partial' : 'ok', publish: publishStatus, build_id: published_ ? buildId : prev.manifest?.build_id ?? null,
      validation_errors: validation.slice(0, 50), drop_guard: dropGuard ? { previous: prevCount, now: records.length } : null, user_agent: USER_AGENT,
    },
    stages: st.out,
    sources: Object.fromEntries(Object.entries(sourceStatus).map(([k, v]) => [k, { ...v, errors: (v.errors || []).slice(0, 20), consecutive_failures: 0 }])),
    http: client.stats,
    reachability: Object.fromEntries(Object.entries(client.stats).map(([host, s]) => [host, s.ok + s.not_modified + s.cached > 0 ? 'reachable' : s.requests ? 'failed' : 'not_used'])),
    cache: { sizes: cache.sizes(), ...cache.stats },
    counts,
    images: { ...imageStats, thumbnails_fetched: thumbsFetched, depicts_searches: depictsAsked, contact_sheets: sheets.map((s) => s.sheet) },
    changes: { new: newIds.slice(0, 200), changed: changed.slice(0, 200), removed: track.removed, carried_over: track.carried, merges: [...merges, ...ed.merges.filter((m) => m.entry.status === 'applied').map((m) => ({ rule: 'editorial_merge', a: m.from, b: m.into }))] },
    decisions,
    hero_list: heroList,
    warnings: categories?.warnings ?? [],
    review_queue: { candidates: reviewQueue, hero_candidates: heroCandidates },
    errors,
  }
  state.failures = updateFailures(state.failures, sourceStatus, startedAt)
  for (const [k, v] of Object.entries(report.sources)) v.consecutive_failures = state.failures.sources?.[k]?.consecutive_failures ?? 0
  const candidatesOut = { schema: 1, generated_at: startedAt, about: 'Web-derived candidates (GDELT, RSS; NAVER/Brave when keyed). Never public until an editorial approve decision names one (editorial/decisions/*.json with target = candidate id and fields).', candidates: Object.values(candidates).sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || compareStrings(a.id, b.id)) }
  const adminErrors = [...checkReport(report), ...checkQuality(quality), ...checkCandidates(candidatesOut)]
  if (adminErrors.length) report.run.admin_validation_errors = adminErrors.slice(0, 50)
  const adminStaging = dirs.admin + '.staging-' + process.pid
  await rm(adminStaging, { recursive: true, force: true })
  await mkdir(adminStaging, { recursive: true })
  await writeJSON(path.join(adminStaging, 'report.json'), report, { pretty: true })
  await writeJSON(path.join(adminStaging, 'quality.json'), quality, { pretty: true })
  await writeJSON(path.join(adminStaging, 'candidates.json'), candidatesOut)
  await swapDir(adminStaging, dirs.admin)

  // review/: logs of every live query result and decision (not published).
  await writeJSON(path.join(dirs.review, 'classes.json'), { schema: 1, at: startedAt, classes: classReview?.classes ?? null, blocklist: classReview?.blocklist ?? null, blocklist_active: [...blockActive].sort(), instances_per_class: classReview?.instances?.perClass ?? null, errors: classReview?.errors ?? [] }, { pretty: true })
  await writeJSON(path.join(dirs.review, 'properties.json'), { schema: 1, at: startedAt, properties: classReview?.properties ?? null, not_used_this_run: [...badProps] }, { pretty: true })
  await writeJSON(path.join(dirs.review, 'categories.json'), { schema: 1, at: startedAt, partial: categories?.partial ?? null, errors: categories?.errors ?? [], decisions: [...(categories?.categories?.values() || [])].sort((a, b) => compareStrings(a.title, b.title)) }, { pretty: true })
  await writeJSON(path.join(dirs.review, 'wikipedia.json'), { schema: 1, at: startedAt, accept_score: accept, hits: wikiHits, entity_decisions: wikiDecisions }, { pretty: true })
  await writeJSON(path.join(dirs.review, 'images.json'), { schema: 1, at: startedAt, projects: imageReview }, { pretty: true })
  await writeJSON(path.join(dirs.review, 'web.json'), { schema: 1, at: startedAt, rules: webOut?.results ?? null, errors: webOut?.errors ?? [] }, { pretty: true })
  await writeJSON(path.join(dirs.review, 'http-log.json'), { schema: 1, at: startedAt, entries: httpLog }, { pretty: true })
  await writeJSON(path.join(dirs.review, 'tourapi.json'), { schema: 1, at: startedAt, about: 'TourAPI KorService2 keyword discovery: every item seen, the terms found in its title or overview, the classifier verdict and the decision. Accepted items become projects (origin tourapi) when they also have a public source (their homepage) or merge with a known project.', status: sourceStatus.tourapi ?? null, overviews_read: tourOut?.overviews_read ?? 0, items: tourOut?.items ?? [], errors: tourOut?.errors ?? [] }, { pretty: true })
  await writeJSON(path.join(dirs.review, 'korea.json'), {
    schema: 1, at: startedAt,
    about: 'Korea first: the live first-level divisions of South Korea (wd:Q884 p:P150 with ISO 3166-2 codes) and the region each maps to, the configured expectations compared with them, the Korean class instances per class, and the kr_region decision of every Korean project with the rule that made it.',
    country: classReview?.items?.find((x) => x.qid === KC.country.qid) ?? null,
    divisions: krDiv ? { from: krDiv.from, list: krDiv.divisions, expected: krDiv.expected, errors: krDiv.errors } : null,
    class_instances: krInst?.perClass ?? null,
    regions: Object.fromEntries(KR_REGIONS.map((k) => [k, krDecisions.filter((d) => d.region === k).length])),
    decisions: krDecisions.sort((a, b) => compareStrings(a.id, b.id)),
  }, { pretty: true })

  state.runs = { schema: 1, runs: runNo, last_run: { at: startedAt, status: report.run.status, build_id: report.run.build_id, duration_ms: report.run.duration_ms }, last_good: published_ ? { build_id: buildId, at: generatedAt, projects: records.length, content_hash: hash } : state.runs.last_good }
  if (published_) state.tracker = track.tracker
  state.webRules = webOut?.state ?? state.webRules
  if (published_) state.imagePicks = Object.fromEntries(records.map((r) => [r.id, { home: picks.get(r.id)?.home?.page ?? null, score: picks.get(r.id)?.score ?? 0 }]).filter(([, v]) => v.home))
  state.candidates = candidates
  await saveState(dirs.state, state)
  await cache.save()
  say(`[pipeline] done: ${report.run.status} in ${Math.round(report.run.duration_ms / 1000)} s; report admin-data/report.json`)
  return { report, quality, files: published_ ? files : null, publishStatus, buildId: report.run.build_id }
}

// ---------------------------------------------------------------- CLI
/**
 * Markdown summary of a run (GitHub Actions step summary): status, the counts (collected, eligible, published, Korean
 * and foreign), images by provider with the hero and below-threshold counts, and the failures.
 */
export function runSummary(report) {
  const c = report.counts || {}, im = report.images || {}
  const n = (v) => (Number.isFinite(v) ? v : 0)
  const providers = Object.entries(im.by_provider || {}).filter(([, v]) => v).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  const failing = Object.entries(report.sources || {}).filter(([, v]) => v.status === 'error' || v.status === 'partial')
  const lines = [
    `### Collect: ${report.run.status} (${report.run.publish})`, '',
    `- build: \`${report.run.build_id ?? '-'}\`, ${Math.round((report.run.duration_ms || 0) / 1000)} s of a ${report.run.budget_minutes} min budget`,
    `- projects: ${n(c.collected ?? c.projects_built)} collected, ${n(c.eligible)} eligible, ${n(c.published)} published (${n(c.kr)} Korean, ${n(c.foreign)} foreign; ${n(c.kr_with_region)} Korean with a region)`,
    `- changes: ${n(c.new)} new, ${n(c.changed)} changed, ${n(c.removed)} removed, ${n(c.carried_over)} carried over, ${n(c.excluded)} excluded`,
    `- images: ${n(c.with_images)} projects with images, ${n(c.with_hero)} with a hero; ${n(im.hero)} hero images on the home page, ${n(im.below_threshold)} images below their role's width target`,
    `- images by provider: ${providers.length ? providers.map(([k, v]) => `${k} ${v}`).join(', ') : 'none'}`,
    `- review: ${n(c.hero_candidates_awaiting_review)} hero candidates, ${n(im.awaiting_review)} images awaiting review, ${n(c.candidates_awaiting_review)} web candidates`,
    `- failures: ${failing.length ? failing.map(([k, v]) => `${k} ${v.status}${v.consecutive_failures ? ` (${v.consecutive_failures} in a row)` : ''}`).join(', ') : 'none'}; ${(report.errors || []).length} errors logged`,
    '', '| source | status | items | consecutive failures |', '|---|---|---|---|',
    ...Object.entries(report.sources || {}).map(([k, v]) => `| ${k} | ${v.status} | ${v.items ?? ''} | ${v.consecutive_failures ?? 0} |`),
    '',
  ]
  return lines.join('\n') + '\n'
}

function args(argv) {
  const out = {}
  for (const a of argv) { const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a); if (m) out[m[1]] = m[2] ?? true }
  return out
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const a = args(process.argv.slice(2))
  const dataDir = a.data || path.resolve(PROJECT_ROOT, '..', 'data')
  const editorialDir = a.editorial || (existsSync(path.join(PROJECT_ROOT, 'editorial')) ? path.join(PROJECT_ROOT, 'editorial') : null)
  const overrides = { pipeline: {} }
  if (a.budget) overrides.pipeline.budget_minutes = Number(a.budget)
  let fetchImpl = globalThis.fetch, clock = Date.now, sleep = defaultSleep, runEnv = process.env
  if (a.fixtures) {
    // Recorded responses only (tests/fixtures/pipeline): no network, a virtual clock.
    const fx = await import(pathToFileURL(path.join(PROJECT_ROOT, 'tests/fixtures/pipeline/fake-fetch.mjs')).href)
    const env = fx.fixtureEnvironment({ start: a.now ? Date.parse(a.now) : Date.parse('2026-10-20T06:17:00Z') })
    fetchImpl = env.fetch; clock = env.clock; sleep = env.sleep; runEnv = { ...fx.FIXTURE_ENV }
    Object.assign(overrides, fx.FIXTURE_OVERRIDES)
    overrides.pipeline = { ...fx.FIXTURE_OVERRIDES.pipeline, ...overrides.pipeline }
  }
  try {
    // A run that kept the previous dataset still exits 0: its report, review logs and state are committed.
    const r = await runPipeline({ dataDir, editorialDir, fetch: fetchImpl, clock, sleep, overrides, env: runEnv })
    console.log(`[pipeline] status ${r.report.run.status}, publish ${r.publishStatus}, build ${r.buildId}`)
    // On GitHub Actions: step outputs for the next jobs and a summary on the run page.
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `build_id=${r.buildId ?? ''}\nstatus=${r.report.run.status}\npublish=${r.publishStatus}\n`)
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, runSummary(r.report))
  } catch (e) {
    console.error('[pipeline] failed:', errorText(e), e?.stack || '')
    process.exitCode = 1
  }
}
