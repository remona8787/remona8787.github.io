// v2.0 image work: the inventory (pipeline/lib/image-inventory.mjs) on records built for each failure reason, and the
// permission request drafts (site-public-cleared/admin/permission-draft.js).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { imageInventory, COLUMNS } from '../pipeline/lib/image-inventory.mjs'
const require = createRequire(import.meta.url)
const { draft } = require('../site-public-cleared/admin/permission-draft.js')

const repImage = { kind: 'project_media', approved: true, identity: { ok: true }, license: 'CC BY-SA 4.0', author: 'A', page: 'https://commons.wikimedia.org/wiki/File:A.jpg', src: 'https://upload.wikimedia.org/a.jpg', width: 2000, project: 'P1', media_active: { score: 50, reasons: ['editorial_review'] } }
const ctxImage = { kind: 'architecture_context', license: 'CC BY 4.0', author: 'B', page: 'https://commons.wikimedia.org/wiki/File:B.jpg', src: 'https://upload.wikimedia.org/b.jpg', width: 2000 }
const records = [
  { id: 'P1', country_iso2: 'FR', images: [repImage] },
  { id: 'P2', country_iso2: 'FR', images: [ctxImage], official_url: 'https://example.org' },
  { id: 'P3', country_iso2: 'KR', images: [] },
  { id: 'P4', country_iso2: 'DE', images: [], wikidata: 'Q1' },
  { id: 'P5', country_iso2: 'DE', images: [] },
  { id: 'P6', country_iso2: 'JP', images: [] },
  { id: 'P7', country_iso2: 'US', images: [], official_url: 'https://example.com' },
  { id: 'P8', country_iso2: 'NL', images: [] },
]
const imageReview = [
  { project: 'P6', candidates: [{ kind: 'project_media', ok: true, approved: null, width: 1600, quality: { sharpness: 70, blockiness: 12 } }, { kind: 'project_media', ok: true, approved: false, width: 2000 }] },
  { project: 'P8', candidates: [{ kind: 'project_media', ok: true, approved: null, width: 1195, quality: { sharpness: 52, blockiness: 72 } }, { kind: 'project_media', ok: true, approved: null, width: 800 }] },
]
const missingImages = [{ id: 'P7', candidates: 3, refused: { 'rights:license_not_allowed': 3 } }, { id: 'P8', candidates: 3, refused: { 'rights:license_not_allowed': 1 } }]

test('inventory: status, failure reason and next action per project; summaries by country group', () => {
  const { json, csv } = imageInventory({ records, imageReview, missingImages, tourApiKey: false, at: '2026-11-12T00:00:00Z' })
  const by = Object.fromEntries(json.rows.map((r) => [r.project_id, r]))
  assert.deepEqual([by.P1.image_status, by.P1.failure_reason, by.P1.next_action], ['representative', null, 'none'])
  assert.deepEqual([by.P2.image_status, by.P2.failure_reason, by.P2.next_action], ['context_only', 'context_only', 'request_permission'])
  assert.deepEqual([by.P3.failure_reason, by.P3.next_action], ['api_key_missing', 'add_tourapi_key'])
  assert.deepEqual([by.P4.failure_reason, by.P4.next_action], ['no_candidate', 'search_commons'])
  assert.deepEqual([by.P5.failure_reason, by.P5.next_action], ['no_source_link', 'search_commons'])
  assert.deepEqual([by.P6.failure_reason, by.P6.next_action, by.P6.pending_review], ['pending_review', 'approve_review', 1])
  assert.deepEqual([by.P7.failure_reason, by.P7.next_action, by.P7.refused], ['rights_unclear', 'request_permission', 'rights:license_not_allowed'])
  assert.deepEqual([by.P8.failure_reason, by.P8.next_action, by.P8.pending_review], ['quality_low', 'search_commons', 0], 'blocky or narrow candidates of the work are not sent to approval (approving would not clear the quality bar), and they outrank an unrelated refused file')
  assert.equal(json.summary.all.representative, 1)
  assert.equal(json.summary.korea.projects, 1)
  assert.equal(json.summary.all.by_reason.no_candidate, 1)
  assert.equal(imageInventory({ records: [records[2]], tourApiKey: true }).json.rows[0].failure_reason, 'no_source_link', 'with the key set, a Korean project falls back to the generic reasons')
  const lines = csv.slice(1).trim().split('\r\n')
  assert.equal(lines[0], COLUMNS.join(','))
  assert.equal(lines.length, records.length + 1)
})

test('permission drafts: both languages, the scope asked, no transfer, revocable, nothing sent', () => {
  const d = draft({ project_id: 'SEOUL018', image_ref: 'https://example.org/photo.jpg', rights_holder: '롯데월드타워 홍보팀', contact_channel: 'email', contact_value: 'pr@example.org', purpose: '작품 상세 페이지 대표 이미지(저작자 표시)', requested_scope: 'display_and_thumbnail' },
    { projectName: '롯데월드타워 미디어파사드', operatorName: '김지현 (JIHYUN KIM)', operatorEmail: 'remona56@hanmail.net' })
  assert.match(d.subject, /롯데월드타워 미디어파사드/)
  assert.equal(d.to, 'pr@example.org')
  assert.match(d.body, /https:\/\/remona8787\.github\.io\/p\/SEOUL018\//)
  assert.match(d.body, /축소 이미지/)
  assert.match(d.body, /독점권이나 양도를 요청하지 않습니다/)
  assert.match(d.body, /철회/)
  assert.match(d.body, /회신 전에는 사진을 게시하지 않습니다/)
  assert.match(d.body, /Dear 롯데월드타워 홍보팀/)
  assert.ok(!/send|fetch|XMLHttpRequest/.test(draft.toString()), 'the draft function sends nothing')
  const form = draft({ project_id: 'X', image_ref: 'img', rights_holder: 'H', contact_channel: 'web_form', contact_value: 'https://example.org/contact', purpose: 'p', requested_scope: 'cc_by' }, { operatorName: 'o', operatorEmail: 'e' })
  assert.deepEqual([form.to, form.form], [null, 'https://example.org/contact'])
  assert.match(form.body, /CC BY 4\.0/)
  const injected = draft({ project_id: 'X', image_ref: 'a\r\nBcc: x@y', rights_holder: 'H\nBcc: z', contact_channel: 'email', contact_value: 'a@b.c\r\nBcc: q', purpose: 'p' }, { operatorName: 'o', operatorEmail: 'e' })
  assert.ok(!/\n\s*Bcc:/i.test(injected.body.split('---')[0].split('\n').slice(0, 1).join('\n')) && !/[\r\n]/.test(injected.to), 'line breaks are removed from header-like fields')
})
