// Image permission request drafts (v2.0, docs/PLATFORM.md "Image permission requests"). Pure: builds the subject and
// body of a request in Korean and English from an image_permission_requests row. It never sends anything: the operator
// reads, edits and sends the draft from their own mail account, then sets the request's status to "sent".
// UMD: the admin console loads it as a script (window.AOLPermissionDraft); tests import it with require().
(function (root, factory) { const v = factory(); if (typeof module === 'object' && module.exports) module.exports = v; else root.AOLPermissionDraft = v })(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'
  const SCOPES = {
    display_with_credit: { ko: '빛의 건축 웹사이트의 해당 작품 상세 페이지에 저작자 표시와 함께 게시', en: 'display on the project page of the Architecture of Light website, with credit' },
    display_and_thumbnail: { ko: '해당 작품 상세 페이지 게시와, 목록·지도·검색 결과의 축소 이미지(저작자 표시 포함)', en: 'display on the project page and as a thumbnail in lists, the map and search results, with credit' },
    cc_by: { ko: 'Creative Commons 저작자표시 4.0(CC BY 4.0) 라이선스로 공개해 주시는 것', en: 'release under Creative Commons Attribution 4.0 (CC BY 4.0)' },
    cc_by_sa: { ko: 'Creative Commons 저작자표시-동일조건변경허락 4.0(CC BY-SA 4.0) 라이선스로 공개해 주시는 것', en: 'release under Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0)' },
    other: { ko: '아래에 적은 범위', en: 'the scope described below' },
  }
  const clean = (s, n = 500) => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim().slice(0, n)
  function draft(req, { projectName, projectUrl, operatorName, operatorEmail, siteUrl = 'https://remona8787.github.io' } = {}) {
    const scope = SCOPES[req.requested_scope] || SCOPES.display_with_credit
    const name = clean(projectName || req.project_id, 200), url = clean(projectUrl || `${siteUrl}/p/${req.project_id}/`)
    const holder = clean(req.rights_holder, 200), image = clean(req.image_ref, 1000), purpose = clean(req.purpose, 1000)
    const op = clean(operatorName, 100), mail = clean(operatorEmail, 254)
    const subject = `[빛의 건축] 작품 사진 사용 허락 요청 — ${name} / Permission request for a photo of ${name}`
    const body = [
      `${holder} 담당자님께,`, '',
      `안녕하세요. 공개 디지털 아카이브 「빛의 건축」(${siteUrl})을 운영하는 ${op}입니다. 「빛의 건축」은 국내외 미디어파사드, 미디어아트, 빛 축제를 출처와 함께 정리해 누구나 무료로 볼 수 있게 공개하는 사이트입니다.`, '',
      `「${name}」 작품 페이지(${url})에 실제 작품 사진이 아직 없어, 아래 사진의 사용을 허락받고 싶어 연락드립니다.`, '',
      `- 사진: ${image}`,
      `- 목적: ${purpose}`,
      `- 요청하는 범위: ${scope.ko}`,
      '- 표시: 사진 아래에 촬영자·저작권자 이름과 출처를 밝힙니다. 원하시는 표기가 있으면 알려 주세요.',
      '- 변경: 화면 크기에 맞춘 축소 외에는 사진을 고치지 않습니다.',
      '- 독점권이나 양도를 요청하지 않습니다. 허락은 언제든 철회하실 수 있고, 철회하시면 지체 없이 내립니다.',
      '- 회신 전에는 사진을 게시하지 않습니다.', '',
      '허락해 주신다면 허락 범위(위 범위 그대로인지, 조건이 있는지)와 원하시는 저작자 표기를 회신으로 알려 주세요. 허락하기 어려우시면 그렇게만 답해 주셔도 됩니다.', '',
      `감사합니다.`, `${op} · ${mail}`, '',
      '---', '',
      `Dear ${holder},`, '',
      `I run "Architecture of Light" (${siteUrl}), a free public archive of media facades, media art and light festivals with their sources. The page for "${name}" (${url}) has no photo of the work yet, and I would like to ask permission to use the photo below.`, '',
      `- Photo: ${image}`, `- Purpose: ${purpose}`, `- Scope: ${scope.en}`,
      '- Credit: your name and the source are shown with the photo; tell me if you prefer a specific credit line.',
      '- No changes other than resizing. No exclusive rights or transfer. You can withdraw permission at any time and the photo will be taken down promptly. Nothing is published before your reply.', '',
      'If you agree, please reply with the scope you allow and your preferred credit line. A simple "no" is fine too.', '',
      `Thank you,`, `${op} · ${mail}`,
    ].join('\n')
    return { subject, body, to: req.contact_channel === 'email' ? clean(req.contact_value, 254) : null, form: req.contact_channel === 'web_form' ? clean(req.contact_value) : null }
  }
  return { draft, SCOPES }
})
