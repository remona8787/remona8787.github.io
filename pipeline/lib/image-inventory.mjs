// The image inventory (v2.0, docs/KOREA_IMAGES.md "Inventory", docs/IMAGE_GRADES.md): every published project, whether
// it has a representative photo (art-photo-policy.js: the work itself, rights, identity, quality grade A or B), what
// it has instead, why a photo is missing, what to do next, and how long it has been missing. Written by every run to
// admin-data/image-inventory.{json,csv} (data branch, never published to the site), so the image work repeats itself
// and shows its progress; the operator console's "이미지 현황" tab reads it. Pure.
//
// failure_reason (first that applies):
//   pending_review    candidates that show the work, and would clear the B bar, wait for an editor
//                     (review/images.json)
//   quality_low       candidates that show the work wait for an editor but fall below the B bar (under 640 px wide,
//                     blurred, or blocky compression): approval alone would not make them representative
//   rights_unclear    candidates were refused for their licence or freedom of panorama
//   resolution_low    candidates were refused as too small
//   identity_unclear  candidates were refused as people, events, objects, or not the work
//   context_only      only building or event context photos, no photo of the work
//   api_key_missing   a Korean project with no candidate while the TourAPI key is not set
//   no_source_link    no Wikidata item and no Commons category to search from, and no candidate
//   no_candidate      linked, but no candidate found
// next_action: approve_review, search_commons, request_permission (an official site exists and no open-licence photo
// was found: a permission request may be drafted), add_tourapi_key, retry, none.
//
// category (the v2.0 brief's nine types; one per project, the first that applies):
//   rep_a                 has a grade A photo (not one of the nine: done)
//   5_b_usable            has a grade B photo only (representative on cards and the detail page, not the home banner)
//   9_temporary_error     an image request for the project failed this run: retried next run
//   8_access_needed       a Korean project waiting on the TourAPI key (an API key or access, not a photo search)
//   3_rights_review       photos of the work exist but their rights are not cleared
//   4_quality_below       photos of the work with rights exist but fall below grade B
//   2_identity_unverified candidates exist but none is shown to be the work (or one waits for an editor's look)
//   6_context_only        only building, place or event context photos (grade C)
//   7_permission_needed   no open-licence photo, and an official site to ask for permission
//   1_no_candidate        nothing found to review
import ART from '../../site-public-cleared/art-photo-policy.js'

const ARTWORK = new Set(['project_media', 'project_installation'])
const firstYear = (p) => [p.year_installed, p.year_completed, p.year_operating_since, p.start_date && Number(String(p.start_date).slice(0, 4))].map(Number).find((n) => Number.isFinite(n) && n > 1800) ?? null

export const CATEGORIES = ['rep_a', '5_b_usable', '9_temporary_error', '8_access_needed', '3_rights_review', '4_quality_below', '2_identity_unverified', '6_context_only', '7_permission_needed', '1_no_candidate']

export const COLUMNS = ['project_id', 'name_ko', 'name_en', 'name_original', 'country_iso2', 'city', 'creators', 'official_url', 'year', 'project_type',
  'image_status', 'representative', 'best_grade', 'a_images', 'b_images', 'c_images', 'rep_license', 'rep_author', 'rep_page', 'image_count', 'artwork_image_count',
  'candidates', 'pending_review', 'refused', 'rights_status', 'identity_status', 'failure_reason', 'category', 'next_action', 'missing_since', 'checks', 'last_checked']

/**
 * @param {object} o
 * @param {object[]} o.records published records (site-data shards)
 * @param {object[]} [o.imageReview] review/images.json projects (candidates with kind, quality, approved)
 * @param {object[]} [o.missingImages] quality.json missing_images
 * @param {boolean} [o.tourApiKey] whether TOURAPI_SERVICE_KEY is set
 * @param {string|null} [o.at] this run's time
 * @param {object|null} [o.previous] the previous run's inventory json (admin-data/image-inventory.json), for the
 *   follow-up history and what this run changed
 * @param {object[]} [o.imageErrors] this run's image-stage errors ({stage, file?, project?})
 * @param {object[]} [o.decisions] this run's editorial log entries (approve_image, set_image applied)
 */
export function imageInventory({ records, imageReview = [], missingImages = [], tourApiKey = false, at = null, previous = null, imageErrors = [], decisions = [] }) {
  const review = new Map(imageReview.map((r) => [r.project, r]))
  const missing = new Map(missingImages.map((m) => [m.id, m]))
  const before = new Map((previous?.rows || []).map((r) => [r.project_id, r]))
  // A failed image request names its file (or project): the projects whose candidates it belongs to are retried.
  const failedFiles = new Set(imageErrors.map((e) => e.file).filter(Boolean))
  const failed = new Set(imageErrors.map((e) => e.project).filter(Boolean))
  for (const r of imageReview) if ((r.candidates || []).some((c) => failedFiles.has(c.key))) failed.add(r.project)
  const rows = records.map((p) => {
    const imgs = Array.isArray(p.images) ? p.images : []
    const rep = ART.representativeOf(p)
    const kinds = imgs.map((i) => ART.kindOf(i))
    const grades = imgs.map((i) => ART.gradeOf(i))
    const nA = grades.filter((g) => g === 'A').length, nB = grades.filter((g) => g === 'B').length, nC = grades.filter((g) => g === 'C').length
    const best = nA ? 'A' : nB ? 'B' : nC ? 'C' : null
    const rv = review.get(p.id), mi = missing.get(p.id)
    const cands = rv?.candidates || []
    // A waiting candidate is worth an editor's approval only if it would clear the B bar once approved (approval
    // vouches for identity, not for size, blur or compression); the rest are counted as below the bar.
    const waiting = cands.filter((c) => c.approved == null && c.ok !== false && ARTWORK.has(c.kind))
    const pending = waiting.filter((c) => ART.qualityEvidence({ width: c.width, quality: c.quality }).ok).length
    const belowBar = waiting.length - pending
    const refused = {}
    for (const c of cands) if (c.ok === false) for (const r of c.reasons || []) { const k = String(r).split(':').slice(0, 2).join(':'); refused[k] = (refused[k] || 0) + 1 }
    for (const [k, v] of Object.entries(mi?.refused || {})) refused[k] = Math.max(refused[k] || 0, v)
    const top = Object.entries(refused).sort((a, b) => b[1] - a[1]).map(([k]) => k)
    const workBelow = imgs.some((i) => { const c = ART.classify(i); return c.visual?.ok && c.identity?.ok && c.rights?.ok && !c.quality?.ok })
    const status = rep ? 'representative' : !imgs.length ? 'none'
      : imgs.some((i) => { const c = ART.classify(i); return c.visual?.ok && c.identity?.ok }) ? 'artwork_below_bar'
      : kinds.every((k) => k === 'architecture_context') ? 'context_only' : 'other_only'
    const nCand = Math.max(cands.length, mi?.candidates || 0)
    let reason = null
    if (!rep) {
      if (pending) reason = 'pending_review'
      else if (belowBar || workBelow) reason = 'quality_low'
      else if (top.some((k) => k.startsWith('rights:'))) reason = 'rights_unclear'
      else if (top.includes('too_small')) reason = 'resolution_low'
      else if (top.some((k) => /^(subject|identity|mislinked|interior)/.test(k))) reason = 'identity_unclear'
      else if (status === 'context_only' || status === 'other_only' || status === 'artwork_below_bar') reason = 'context_only'
      else if (!nCand && p.country_iso2 === 'KR' && !tourApiKey) reason = 'api_key_missing'
      else if (!nCand && !p.wikidata && !p.commons_category) reason = 'no_source_link'
      else reason = 'no_candidate'
    }
    const transient = !rep && failed.has(p.id)
    const next = rep ? 'none' : transient ? 'retry' : pending ? 'approve_review'
      : reason === 'api_key_missing' ? 'add_tourapi_key'
      : p.official_url && ['rights_unclear', 'no_candidate', 'no_source_link', 'context_only', 'resolution_low', 'quality_low'].includes(reason) ? 'request_permission'
      : 'search_commons'
    const category = rep ? (nA ? 'rep_a' : '5_b_usable')
      : transient ? '9_temporary_error'
      : reason === 'api_key_missing' ? '8_access_needed'
      : reason === 'rights_unclear' ? '3_rights_review'
      : reason === 'quality_low' || reason === 'resolution_low' ? '4_quality_below'
      : reason === 'pending_review' || reason === 'identity_unclear' ? '2_identity_unverified'
      : reason === 'context_only' ? '6_context_only'
      : p.official_url ? '7_permission_needed' : '1_no_candidate'
    const rights = rep ? 'cleared' : top.some((k) => k.startsWith('rights:')) ? 'review' : imgs.length ? 'cleared_context' : nCand ? 'review' : 'none'
    const identity = rep ? 'verified' : pending ? 'pending_review' : top.some((k) => /^(subject|identity|mislinked|interior)/.test(k)) ? 'mismatch' : imgs.length || nCand ? 'unverified' : 'none'
    // Follow-up history: when the photo went missing, how many runs have checked since, and the last check.
    const prev = before.get(p.id)
    const since = rep ? null : prev && !prev.representative ? (prev.missing_since ?? prev.last_checked ?? at) : at
    const checks = rep ? 0 : (prev && !prev.representative ? Number(prev.checks) || 0 : 0) + 1
    return {
      project_id: p.id, name_ko: p.name_ko ?? null, name_en: p.name_en ?? null, name_original: p.name_original ?? null,
      country_iso2: p.country_iso2 ?? null, city: p.city_ko || p.city || null,
      creators: (p.credits || []).map((c) => `${c.name || c.name_en}${c.role ? ` (${c.role})` : ''}`).join('; ') || null,
      official_url: p.official_url ?? null, year: firstYear(p), project_type: p.project_type ?? null,
      image_status: status, representative: !!rep, best_grade: best, a_images: nA, b_images: nB, c_images: nC,
      rep_license: rep?.license ?? null, rep_author: rep?.author ?? null, rep_page: rep?.page ?? null,
      image_count: imgs.length, artwork_image_count: kinds.filter((k) => ARTWORK.has(k)).length,
      candidates: nCand, pending_review: pending, refused: top.slice(0, 3).join('; ') || null,
      rights_status: rights, identity_status: identity, failure_reason: reason, category, next_action: next,
      missing_since: since, checks, last_checked: rep ? null : at,
    }
  }).sort((a, b) => String(a.project_id).localeCompare(String(b.project_id)))
  const count = (list, key) => list.reduce((o, r) => { const k = r[key] ?? 'none'; o[k] = (o[k] || 0) + 1; return o }, {})
  const sum = (list, key) => list.reduce((n, r) => n + (Number(r[key]) || 0), 0)
  const part = (list) => {
    const reps = list.filter((r) => r.representative).length
    return {
      projects: list.length, representative: reps, rate_pct: list.length ? Math.round(1000 * reps / list.length) / 10 : 0,
      rep_grade_a: list.filter((r) => r.category === 'rep_a').length, rep_grade_b: list.filter((r) => r.category === '5_b_usable').length,
      images: { A: sum(list, 'a_images'), B: sum(list, 'b_images'), C: sum(list, 'c_images') },
      without_images: list.filter((r) => !r.image_count).length,
      rights_review: list.filter((r) => !r.representative && r.rights_status === 'review').length,
      identity_review: list.filter((r) => !r.representative && r.identity_status === 'pending_review').length,
      permission_targets: list.filter((r) => r.next_action === 'request_permission').length,
      by_status: count(list, 'image_status'), by_category: count(list, 'category'),
      by_reason: count(list.filter((r) => !r.representative), 'failure_reason'), by_next_action: count(list.filter((r) => !r.representative), 'next_action'),
    }
  }
  const kr = rows.filter((r) => r.country_iso2 === 'KR')
  // What this run changed against the previous inventory (null on the first run): projects that gained or lost their
  // representative photo, and the editor's image decisions applied this run.
  const gained = previous ? rows.filter((r) => r.representative && before.get(r.project_id)?.representative === false).map((r) => r.project_id) : null
  const lost = previous ? rows.filter((r) => !r.representative && before.get(r.project_id)?.representative === true).map((r) => r.project_id) : null
  // Decisions stay in editorial/decisions and are applied on every run: the new ones are those the previous run did
  // not list.
  const imageDecisions = decisions.filter((d) => ['approve_image', 'set_image', 'block_image'].includes(d.action) && d.status === 'applied')
  const files = [...new Set(imageDecisions.map((d) => d.file))].sort()
  const seen = Array.isArray(previous?.summary?.changes?.image_decision_files) ? new Set(previous.summary.changes.image_decision_files) : null
  const fresh = seen ? imageDecisions.filter((d) => !seen.has(d.file)) : null
  const changes = {
    previous_at: previous?.at ?? null, previous_representative: previous?.summary?.all?.representative ?? null,
    gained, lost, net: gained && lost ? gained.length - lost.length : null,
    image_decisions_applied: imageDecisions.length, image_decision_files: files,
    new_image_decisions: fresh ? fresh.length : null, new_image_approvals: fresh ? fresh.filter((d) => d.action !== 'block_image').length : null,
  }
  const summary = {
    all: part(rows), korea: part(kr), world: part(rows.filter((r) => r.country_iso2 !== 'KR')), tourapi_key: tourApiKey, changes,
    definition: 'representative = a project with at least one photo of grade A or B (rights, identity and quality per art-photo-policy.js); rate = representative / published projects; grade C context photos never count',
  }
  const cell = (v) => { if (v === null || v === undefined) return ''; if (typeof v !== 'string') return String(v); const s = /^[=+\-@\t\r]/.test(v) ? "'" + v : v; return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = '﻿' + [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n'
  return { json: { schema: 2, at, about: 'Per project: representative photo status and grade, why it is missing, the next action and its follow-up history (docs/KOREA_IMAGES.md "Inventory", docs/IMAGE_GRADES.md). Not published to the site.', summary, rows }, csv }
}

const CATEGORY_LABELS = {
  rep_a: 'A등급 대표 이미지 있음', '5_b_usable': '5. B등급으로 사용 중', '1_no_candidate': '1. 사진 후보 없음', '2_identity_unverified': '2. 작품 일치 미확인(검토 대기 포함)',
  '3_rights_review': '3. 권리 확인 필요', '4_quality_below': '4. 권리는 있으나 품질 미달', '6_context_only': '6. 건물·장소 맥락 사진만', '7_permission_needed': '7. 공식기관 사용허가 요청 필요',
  '8_access_needed': '8. API 인증·접근 필요(TourAPI 키)', '9_temporary_error': '9. 일시 오류(다음 수집에서 재시도)',
}
/**
 * admin-data/image-status.md: the inventory summary as a page GitHub renders on the data branch, so the operator can
 * read it before the operator console has a server. Same numbers as image-inventory.json; no personal data.
 */
export function inventoryMarkdown(json) {
  const s = json.summary || {}, a = s.all || {}, k = s.korea || {}, w = s.world || {}, ch = s.changes || {}
  const p = (n, d) => (d ? `${Math.round(1000 * n / d) / 10}%` : '—')
  const n = (v) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US'))
  const lines = [
    '# 이미지 현황', '',
    `기준 ${json.at || '—'} · 판정: 대표 이미지(A 또는 B 등급)가 있는 사례 ÷ 공개 사례. C등급 맥락 사진은 세지 않습니다(docs/IMAGE_GRADES.md).`, '',
    '| 항목 | 전체 | 국내 | 해외 |', '|---|---|---|---|',
    `| 공개 사례 | ${n(a.projects)} | ${n(k.projects)} | ${n(w.projects)} |`,
    `| 대표 이미지 확보 | ${n(a.representative)} (${p(a.representative, a.projects)}) | ${n(k.representative)} (${p(k.representative, k.projects)}) | ${n(w.representative)} (${p(w.representative, w.projects)}) |`,
    `| A등급 대표 사례 | ${n(a.rep_grade_a)} | ${n(k.rep_grade_a)} | ${n(w.rep_grade_a)} |`,
    `| B등급만 있는 사례 | ${n(a.rep_grade_b)} | ${n(k.rep_grade_b)} | ${n(w.rep_grade_b)} |`,
    `| 이미지 A / B / C | ${n(a.images?.A)} / ${n(a.images?.B)} / ${n(a.images?.C)} | ${n(k.images?.A)} / ${n(k.images?.B)} / ${n(k.images?.C)} | ${n(w.images?.A)} / ${n(w.images?.B)} / ${n(w.images?.C)} |`,
    `| 이미지 없는 사례 | ${n(a.without_images)} | ${n(k.without_images)} | ${n(w.without_images)} |`,
    `| 저작권 검토 대기 | ${n(a.rights_review)} | ${n(k.rights_review)} | ${n(w.rights_review)} |`,
    `| 작품 일치 검토 대기 | ${n(a.identity_review)} | ${n(k.identity_review)} | ${n(w.identity_review)} |`,
    `| 사용허가 요청 대상 | ${n(a.permission_targets)} | ${n(k.permission_targets)} | ${n(w.permission_targets)} |`, '',
    `이번 수집: 새 대표 이미지 ${ch.gained ? ch.gained.length : '—'}건, 잃은 사례 ${ch.lost ? ch.lost.length : '—'}건, 새로 들어온 이미지 결정 ${n(ch.new_image_decisions)}건(승인·지정 ${n(ch.new_image_approvals)}건), 적용 중인 이미지 결정 전체 ${n(ch.image_decisions_applied)}건${ch.previous_at ? ` (이전 조사 ${ch.previous_at})` : ''}.`, '',
    '## 분류', '', '| 분류 | 전체 | 국내 | 해외 |', '|---|---|---|---|',
    ...CATEGORIES.map((c) => `| ${CATEGORY_LABELS[c]} | ${n(a.by_category?.[c] ?? 0)} | ${n(k.by_category?.[c] ?? 0)} | ${n(w.by_category?.[c] ?? 0)} |`), '',
    `TourAPI 키: ${s.tourapi_key ? '등록됨' : '없음(국내 사진 수집 대기)'} · 사례별 표: image-inventory.csv`, '',
  ]
  return lines.join('\n')
}
