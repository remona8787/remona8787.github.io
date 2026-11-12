// The image inventory (v2.0, docs/KOREA_IMAGES.md "Inventory"): every published project, whether it has a
// representative photo (art-photo-policy.js: the work itself, rights, identity, quality), what it has instead, why a
// photo is missing, and what to do next. Written by every run to admin-data/image-inventory.{json,csv} (data branch,
// never published), so the image work repeats itself and shows its progress. Pure.
//
// failure_reason (first that applies):
//   pending_review    candidates that show the work wait for an editor (review/images.json)
//   rights_unclear    candidates were refused for their licence or freedom of panorama
//   resolution_low    candidates were refused as too small
//   identity_unclear  candidates were refused as people, events, objects, or not the work
//   context_only      only building or event context photos, no photo of the work
//   api_key_missing   a Korean project with no candidate while the TourAPI key is not set
//   no_source_link    no Wikidata item and no Commons category to search from, and no candidate
//   no_candidate      linked, but no candidate found
// next_action: approve_review, search_commons, request_permission (an official site exists and no open-licence photo
// was found: a permission request may be drafted), add_tourapi_key, none.
import ART from '../../site-public-cleared/art-photo-policy.js'

const ARTWORK = new Set(['project_media', 'project_installation'])
const firstYear = (p) => [p.year_installed, p.year_completed, p.year_operating_since, p.start_date && Number(String(p.start_date).slice(0, 4))].map(Number).find((n) => Number.isFinite(n) && n > 1800) ?? null

export const COLUMNS = ['project_id', 'name_ko', 'name_en', 'name_original', 'country_iso2', 'city', 'creators', 'official_url', 'year', 'project_type',
  'image_status', 'representative', 'rep_license', 'rep_author', 'rep_page', 'image_count', 'artwork_image_count', 'candidates', 'pending_review', 'refused',
  'failure_reason', 'next_action']

export function imageInventory({ records, imageReview = [], missingImages = [], tourApiKey = false, at = null }) {
  const review = new Map(imageReview.map((r) => [r.project, r]))
  const missing = new Map(missingImages.map((m) => [m.id, m]))
  const rows = records.map((p) => {
    const imgs = Array.isArray(p.images) ? p.images : []
    const rep = ART.representativeOf(p)
    const kinds = imgs.map((i) => ART.kindOf(i))
    const rv = review.get(p.id), mi = missing.get(p.id)
    const cands = rv?.candidates || []
    const pending = cands.filter((c) => c.approved !== true && c.ok !== false && ARTWORK.has(c.kind)).length
    const refused = {}
    for (const c of cands) if (c.ok === false) for (const r of c.reasons || []) { const k = String(r).split(':').slice(0, 2).join(':'); refused[k] = (refused[k] || 0) + 1 }
    for (const [k, v] of Object.entries(mi?.refused || {})) refused[k] = Math.max(refused[k] || 0, v)
    const top = Object.entries(refused).sort((a, b) => b[1] - a[1]).map(([k]) => k)
    const status = rep ? 'representative' : !imgs.length ? 'none'
      : imgs.some((i) => { const c = ART.classify(i); return c.visual?.ok && c.identity?.ok }) ? 'artwork_below_bar'
      : kinds.every((k) => k === 'architecture_context') ? 'context_only' : 'other_only'
    const nCand = Math.max(cands.length, mi?.candidates || 0)
    let reason = null
    if (!rep) {
      if (pending) reason = 'pending_review'
      else if (top.some((k) => k.startsWith('rights:'))) reason = 'rights_unclear'
      else if (top.includes('too_small')) reason = 'resolution_low'
      else if (top.some((k) => /^(subject|identity|mislinked|interior)/.test(k))) reason = 'identity_unclear'
      else if (status === 'context_only' || status === 'other_only' || status === 'artwork_below_bar') reason = 'context_only'
      else if (!nCand && p.country_iso2 === 'KR' && !tourApiKey) reason = 'api_key_missing'
      else if (!nCand && !p.wikidata && !p.commons_category) reason = 'no_source_link'
      else reason = 'no_candidate'
    }
    const next = rep ? 'none' : pending ? 'approve_review'
      : reason === 'api_key_missing' ? 'add_tourapi_key'
      : p.official_url && ['rights_unclear', 'no_candidate', 'no_source_link', 'context_only', 'resolution_low'].includes(reason) ? 'request_permission'
      : 'search_commons'
    return {
      project_id: p.id, name_ko: p.name_ko ?? null, name_en: p.name_en ?? null, name_original: p.name_original ?? null,
      country_iso2: p.country_iso2 ?? null, city: p.city_ko || p.city || null,
      creators: (p.credits || []).map((c) => `${c.name || c.name_en}${c.role ? ` (${c.role})` : ''}`).join('; ') || null,
      official_url: p.official_url ?? null, year: firstYear(p), project_type: p.project_type ?? null,
      image_status: status, representative: !!rep, rep_license: rep?.license ?? null, rep_author: rep?.author ?? null, rep_page: rep?.page ?? null,
      image_count: imgs.length, artwork_image_count: kinds.filter((k) => ARTWORK.has(k)).length,
      candidates: nCand, pending_review: pending, refused: top.slice(0, 3).join('; ') || null,
      failure_reason: reason, next_action: next,
    }
  }).sort((a, b) => String(a.project_id).localeCompare(String(b.project_id)))
  const count = (list, key) => list.reduce((o, r) => { const k = r[key] ?? 'none'; o[k] = (o[k] || 0) + 1; return o }, {})
  const part = (list) => ({ projects: list.length, representative: list.filter((r) => r.representative).length, rate_pct: list.length ? Math.round(1000 * list.filter((r) => r.representative).length / list.length) / 10 : 0, by_status: count(list, 'image_status'), by_reason: count(list.filter((r) => !r.representative), 'failure_reason'), by_next_action: count(list.filter((r) => !r.representative), 'next_action') })
  const kr = rows.filter((r) => r.country_iso2 === 'KR')
  const summary = { all: part(rows), korea: part(kr), world: part(rows.filter((r) => r.country_iso2 !== 'KR')), tourapi_key: tourApiKey }
  const cell = (v) => { if (v === null || v === undefined) return ''; if (typeof v !== 'string') return String(v); const s = /^[=+\-@\t\r]/.test(v) ? "'" + v : v; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = '﻿' + [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n'
  return { json: { schema: 1, at, about: 'Per project: representative photo status, why it is missing, and the next action (docs/KOREA_IMAGES.md "Inventory"). Not published.', summary, rows }, csv }
}
