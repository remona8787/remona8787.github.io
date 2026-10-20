// Editorial decisions (docs/STATIC_ARCHIVE.md "Editorial decisions"): editorial/decisions/*.json and
// editorial/hero.json on the `source` branch. Only someone with write access to the repository can add them, so
// GitHub authentication is the access control. The pipeline applies decisions in file-name order; a later decision on
// the same target wins (hide then unhide → visible). Every decision ends in report.json with its status:
//   applied | target_not_found | invalid (with the reason) | superseded (a later decision replaced it).
//
// Actions:
//   approve     target = project id      → publishes a project the source gates hold back (unverified class only,
//                                          class requires coordinates, low Wikipedia relevance, web candidate,
//                                          blocklist); never overrides a missing name, country or place.
//               target = candidate id    → creates an editor record from fields (+ the candidate's hits as sources)
//               target = "new:<slug>"    → creates an editor record from fields
//   hide/unhide target = project id
//   merge       target = project id, into = project id (the kept record; all sources stay attached)
//   edit        target = project id, fields = {name_ko, name_en, name_original, name_original_lang, country_iso2,
//               city, city_ko, lat, lng, project_type, official_url, description_ko, description_en, visit}
//   block_image target = project id or "*", image = Commons file name
//   set_hero / unset_hero  target = project id, image = Commons file name
import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import T from '../../site-public-cleared/archive-taxonomy.js'
import { bareFile, isQid, validLat, validLng, slugify, fnv1a } from './util.mjs'

export const ACTIONS = ['approve', 'hide', 'unhide', 'merge', 'edit', 'block_image', 'set_hero', 'unset_hero']
const ID_RE = /^(?:Q[1-9]\d{0,11}|[A-Z]{2,12}\d{1,6}|CAT-[0-9A-Z]{1,13}|ED-[a-z0-9-]{1,60}|X-[0-9A-Z]{1,13}|KTO-\d{1,12}|cand-[0-9a-z]{1,13}|new:[a-z0-9-]{1,60})$/
const EDIT_FIELDS = ['name_ko', 'name_en', 'name_original', 'name_original_lang', 'country_iso2', 'city', 'city_ko', 'lat', 'lng', 'project_type', 'kr_region', 'official_url', 'description_ko', 'description_en', 'visit']
const VISIT_STATUS = new Set(['operating', 'seasonal', 'event_based', 'ended', 'inactive', 'demolished', 'unknown'])

const text = (v, max = 300) => typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null
const httpsUrl = (v) => { try { const u = new URL(String(v || '')); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null } catch { return null } }

/** Validated edit fields (unknown keys and bad values are reported, never applied). */
export function cleanFields(fields) {
  const out = {}, problems = []
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return { fields: out, problems: fields == null ? [] : ['fields_not_an_object'] }
  for (const [k, v] of Object.entries(fields)) {
    if (!EDIT_FIELDS.includes(k)) { problems.push('unknown_field:' + k); continue }
    if (v === null) { out[k] = null; continue }
    switch (k) {
      case 'country_iso2': { const c = String(v).toUpperCase(); if (T.regionOf(c)) out[k] = c; else problems.push('bad_country_iso2'); break }
      case 'lat': if (validLat(Number(v))) out.lat = Number(v); else problems.push('bad_lat'); break
      case 'lng': if (validLng(Number(v))) out.lng = Number(v); else problems.push('bad_lng'); break
      case 'project_type': if (T.valid('project_type', v)) out[k] = v; else problems.push('bad_project_type'); break
      case 'kr_region': if (T.valid('kr_region', v)) out[k] = v; else problems.push('bad_kr_region'); break
      case 'official_url': { const u = httpsUrl(v); if (u) out[k] = u; else problems.push('bad_official_url'); break }
      case 'name_original_lang': if (/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(String(v))) out[k] = String(v); else problems.push('bad_language'); break
      case 'visit': {
        if (typeof v !== 'object' || Array.isArray(v)) { problems.push('bad_visit'); break }
        const status = VISIT_STATUS.has(v.status) ? v.status : null
        const source = httpsUrl(v.source)
        if (!source) { problems.push('visit_needs_source_url'); break }
        out.visit = { status, note: text(v.note, 300), period: text(v.period, 120), source }
        break
      }
      default: { const t = text(v, k.startsWith('description') ? 2000 : 300); if (t) out[k] = t; else problems.push('bad_' + k) }
    }
  }
  if ((out.lat === undefined) !== (out.lng === undefined)) { delete out.lat; delete out.lng; problems.push('lat_and_lng_go_together') }
  return { fields: out, problems }
}

/** Shape check of one decision file's content. */
export function validateDecision(d) {
  const problems = []
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['not_an_object']
  if (!ACTIONS.includes(d.action)) problems.push('unknown_action')
  if (typeof d.target !== 'string' || !(d.target === '*' ? d.action === 'block_image' : ID_RE.test(d.target))) problems.push('bad_target')
  if (d.action === 'merge' && (typeof d.into !== 'string' || !ID_RE.test(d.into) || d.into === d.target)) problems.push('bad_into')
  if (['block_image', 'set_hero', 'unset_hero'].includes(d.action) && !text(d.image, 240)) problems.push('image_required')
  if (d.action === 'edit' && (!d.fields || typeof d.fields !== 'object')) problems.push('fields_required')
  if (d.action === 'approve' && /^(cand-|new:)/.test(String(d.target || '')) && (!d.fields || typeof d.fields !== 'object')) problems.push('fields_required')
  if (!text(d.by, 120)) problems.push('by_required')
  if (typeof d.at !== 'string' || !Number.isFinite(Date.parse(d.at))) problems.push('at_required')
  return problems
}

/** Reads editorial/decisions/*.json (file-name order) and editorial/hero.json. Missing directory → empty. */
export async function loadEditorial(dir) {
  const decisions = []
  const decisionsDir = dir ? path.join(dir, 'decisions') : null
  if (decisionsDir && existsSync(decisionsDir)) {
    const names = (await readdir(decisionsDir)).filter((n) => n.endsWith('.json')).sort()
    for (const file of names) {
      let content = null, error = null
      try { content = JSON.parse(await readFile(path.join(decisionsDir, file), 'utf8')) } catch (e) { error = 'invalid_json: ' + String(e?.message || e).slice(0, 120) }
      decisions.push({ file, content, error })
    }
  }
  let hero = [], heroError = null
  const heroFile = dir ? path.join(dir, 'hero.json') : null
  if (heroFile && existsSync(heroFile)) {
    try {
      const json = JSON.parse(await readFile(heroFile, 'utf8'))
      hero = Array.isArray(json) ? json : Array.isArray(json?.hero) ? json.hero : []
    } catch (e) { heroError = 'invalid_json: ' + String(e?.message || e).slice(0, 120) }
  }
  return { decisions, hero, heroError }
}

/**
 * Compiles the decisions into what each stage applies. Statuses start as 'pending' and the stages mark them.
 * @param {{decisions: {file: string, content: any, error: string|null}[], hero: any[], heroError?: string|null}} loaded
 * @param {{candidates?: Record<string, any>}} [ctx]
 */
export function compileEditorial(loaded, { candidates = {} } = {}) {
  const log = []
  const approvals = new Map(), hidden = new Map(), edits = new Map(), merges = [], created = []
  const blockedImages = new Set(), heroAllow = new Map()
  for (const { file, content, error } of loaded.decisions) {
    const entry = { file, action: content?.action ?? null, target: content?.target ?? null, by: text(content?.by, 120), at: content?.at ?? null, note: text(content?.note, 300), status: 'pending', reasons: [] }
    log.push(entry)
    if (error) { entry.status = 'invalid'; entry.reasons.push(error); continue }
    const problems = validateDecision(content)
    if (problems.length) { entry.status = 'invalid'; entry.reasons.push(...problems); continue }
    const d = content
    const supersede = (map, key) => { const prev = map.get(key); if (prev) { prev.entry.status = 'superseded'; prev.entry.reasons.push('later_decision:' + file) } }
    switch (d.action) {
      case 'approve': {
        if (/^(cand-|new:)/.test(d.target)) {
          const { fields, problems: fp } = cleanFields(d.fields)
          if (fp.length) entry.reasons.push(...fp)
          const name = fields.name_en || fields.name_ko || fields.name_original
          if (!name || !fields.country_iso2 || !fields.project_type) { entry.status = 'invalid'; entry.reasons.push('approve_needs_name_country_and_type'); break }
          const cand = d.target.startsWith('cand-') ? candidates[d.target] : null
          if (d.target.startsWith('cand-') && !cand) { entry.status = 'target_not_found'; break }
          const slug = d.target.startsWith('new:') ? d.target.slice(4) : slugify(name) + '-' + (fnv1a(d.target).toString(36).slice(0, 4))
          const qid = isQid(d.fields?.qid) ? d.fields.qid : null
          const sources = []
          if (fields.official_url) sources.push({ id: 'official', kind: 'official', title: null, url: fields.official_url, publisher: null })
          for (const h of cand?.hits || []) if (h.url && !sources.some((s) => s.url === h.url)) sources.push({ id: 'news:' + sources.length, kind: h.source_kind === 'official' ? 'official' : 'news', title: h.title || null, url: h.url, publisher: h.publisher || null })
          for (const u of Array.isArray(d.fields?.sources) ? d.fields.sources : []) { const url = httpsUrl(u?.url ?? u); if (url && !sources.some((s) => s.url === url)) sources.push({ id: 'editorial:' + sources.length, kind: 'reference', title: text(u?.title, 300), url, publisher: text(u?.publisher, 200) }) }
          created.push({
            origin: 'editorial', editorial_id: slug, qid, category: null,
            name: { ko: fields.name_ko ?? null, en: fields.name_en ?? null, original: fields.name_original ?? null, original_lang: fields.name_original_lang ?? null },
            name_ko: fields.name_ko ?? null, country_iso2: fields.country_iso2, city: fields.city ?? null, city_ko: fields.city_ko ?? null,
            lat: fields.lat ?? null, lng: fields.lng ?? null, official_url: fields.official_url ?? null, project_type: fields.project_type,
            description_ko: fields.description_ko ?? null, description_en: fields.description_en ?? null, visit: fields.visit ?? null,
            sources, evidence: [{ kind: 'editorial', file, candidate: cand ? d.target : null }], decision: entry,
          })
          entry.created_id = 'ED-' + slug
          entry.status = 'applied'
        } else { supersede(approvals, d.target); approvals.set(d.target, { entry }) }
        break
      }
      case 'hide': case 'unhide': supersede(hidden, d.target); hidden.set(d.target, { entry, hide: d.action === 'hide' }); break
      case 'merge': merges.push({ from: d.target, into: d.into, entry }); break
      case 'edit': {
        const { fields, problems: fp } = cleanFields(d.fields)
        if (fp.length) entry.reasons.push(...fp)
        if (!Object.keys(fields).length) { entry.status = 'invalid'; entry.reasons.push('no_valid_fields'); break }
        const prev = edits.get(d.target)
        edits.set(d.target, { entries: [...(prev?.entries || []), entry], fields: { ...(prev?.fields || {}), ...fields } })
        break
      }
      case 'block_image': blockedImages.add(d.target + '|' + bareFile(d.image)); entry.status = 'applied'; break
      case 'set_hero': case 'unset_hero': {
        const key = d.target + '|' + bareFile(d.image)
        supersede(heroAllow, key)
        heroAllow.set(key, { entry, on: d.action === 'set_hero', note: entry.note })
        break
      }
    }
  }
  // hero.json: the visually reviewed allowlist (a set_hero/unset_hero decision on the same pair wins).
  const heroList = []
  if (loaded.heroError) log.push({ file: 'hero.json', action: 'hero_list', status: 'invalid', reasons: [loaded.heroError] })
  for (const h of loaded.hero || []) {
    const project = typeof h?.project === 'string' && ID_RE.test(h.project) ? h.project : null
    const image = text(h?.image, 240)
    if (!project || !image) { log.push({ file: 'hero.json', action: 'hero_list', target: h?.project ?? null, status: 'invalid', reasons: ['project_and_image_required'] }); continue }
    heroList.push({ project, image: bareFile(image), note: text(h.note, 300) })
  }
  return { log, approvals, hidden, edits, merges, created, blockedImages, heroAllow, heroList }
}

/** The effective hero allowlist: hero.json plus set_hero, minus unset_hero. Set of "project|file". */
export function heroAllowSet(ed) {
  const out = new Set(ed.heroList.map((h) => h.project + '|' + h.image))
  for (const [key, v] of ed.heroAllow) { if (v.on) out.add(key); else out.delete(key) }
  return out
}

/** Whether an image is blocked for a project ("*" blocks it everywhere). */
export const imageBlocked = (ed, projectId, file) => ed.blockedImages.has(projectId + '|' + bareFile(file)) || ed.blockedImages.has('*|' + bareFile(file))

/** Applies hide/unhide, approve and edit to a built project; marks the decisions it used. Returns the project. */
export function applyToProject(ed, p) {
  const ids = [p.id, p.qid, p.curated_id, p.editorial_id ? 'ED-' + p.editorial_id : null, ...(p.merged_ids || [])].filter(Boolean)
  p.editorial = p.editorial || {}
  for (const id of ids) {
    const a = ed.approvals.get(id)
    if (a && a.entry.status !== 'superseded') { p.editorial.approved = true; a.entry.status = 'applied'; a.entry.project = p.id }
    const h = ed.hidden.get(id)
    if (h && h.entry.status !== 'superseded') { p.editorial.hidden = h.hide; h.entry.status = 'applied'; h.entry.project = p.id }
    const e = ed.edits.get(id)
    if (e) {
      const f = e.fields
      const fs = p.field_sources || (p.field_sources = {})
      const put = (k, v) => { p[k] = v; if (v === null) delete fs[k]; else fs[k] = 'editorial' }
      for (const k of ['name_ko', 'name_en', 'name_original', 'name_original_lang', 'country_iso2', 'city', 'city_ko', 'project_type', 'official_url', 'description_ko', 'description_en']) if (k in f) put(k, f[k])
      if ('lat' in f) { put('latitude', f.lat); put('longitude', f.lng); p.location_precision = f.lat === null ? (p.city ? 'city' : 'unknown') : 'exact' }
      if ('country_iso2' in f) p.region = f.country_iso2 ? T.regionOf(f.country_iso2) : null
      // kr_region: the edit wins over every derived rule (lib/korea.mjs krRegionOf reads kr_region_edit).
      if ('kr_region' in f) p.kr_region_edit = f.kr_region
      if ('project_type' in f) { p.type_source = 'editorial'; p.type_low_confidence = false }
      if ('visit' in f) { p.visit = f.visit; if (f.visit) fs.visit = 'editorial' }
      if (f.official_url && !p.sources.some((s) => s.url === f.official_url)) p.sources.push({ id: 'official', kind: 'official', title: null, url: f.official_url, publisher: null })
      if (f.visit?.source && !p.sources.some((s) => s.url === f.visit.source)) p.sources.push({ id: 'editorial:visit', kind: 'reference', title: null, url: f.visit.source, publisher: null })
      for (const en of e.entries) { en.status = 'applied'; en.project = p.id }
    }
  }
  return p
}

/** Decisions still pending after every stage did not find their target. */
export function finishLog(ed) {
  for (const e of ed.log) if (e.status === 'pending') { e.status = 'target_not_found' }
  return ed.log.map((e) => ({ file: e.file, action: e.action, target: e.target, status: e.status, reasons: e.reasons || [], by: e.by ?? null, at: e.at ?? null, note: e.note ?? null, ...(e.project ? { project: e.project } : {}), ...(e.created_id ? { created_id: e.created_id } : {}) }))
}
