// v2.0 member platform screens (docs/PLATFORM.md): community (reviews, questions, information), member photos, case
// submissions, my submissions with appeals, reports, the researcher application, the profile, and the photo
// contribution guide. The screens talk only to window.AOLPlatformAPI (client/platform-api.js, loaded with cloud.js
// when config.js names a Supabase project). Without it the site has no accounts: the screens say so ("준비 중") and
// show no form; the photo contribution guide then offers e-mail, which works without a server.
// Every value a member wrote is escaped; nothing is public before staff approved it (the database enforces that).
(function () {
  'use strict'
  const E = (s) => window.AOLCore?.esc ? window.AOLCore.esc(s) : String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const en = () => document.documentElement.lang === 'en'
  const L = (ko, e) => (en() ? e : ko)
  const I = (n) => `<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-${n}"/></svg>`
  const api = () => window.AOLPlatformAPI || null
  const enabled = () => !!api()?.configured
  const cfg = () => window.AOL_CONFIG || {}
  const ID = /^[A-Za-z0-9_-]{2,40}$/
  const STATUS = {
    draft: ['임시 저장', 'Draft'], pending: ['검수 대기', 'Waiting for review'], needs_review: ['운영자 검토 중', 'Under review'],
    approved: ['공개됨', 'Published'], rejected: ['반려', 'Not published'], removed: ['게시 중단', 'Taken down'],
    submitted: ['제출됨', 'Submitted'], in_review: ['검토 중', 'In review'], needs_info: ['보완 요청', 'More information needed'],
    revoked: ['승인 취소', 'Approval revoked'], expired: ['만료', 'Expired'], withdrawn: ['철회', 'Withdrawn'], open: ['접수', 'Open'], upheld: ['원결정 유지', 'Decision upheld'], reversed: ['재검토 결정', 'Reversed'],
  }
  const badge = (s) => `<span class="pf-status pf-${E(s)}">${E(L(...(STATUS[s] || [s, s])))}</span>`
  const placeName = (id) => { const p = window.AOLApp?.lookup?.(id); return p ? (en() ? p.name_en || p.name_ko : p.name_ko || p.name_en) || id : id }
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString(en() ? 'en-GB' : 'ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) }
  const head = (title, sub) => `<header class="page-head"><h1 class="large-title">${E(title)}</h1>${sub ? `<p class="page-sub">${E(sub)}</p>` : ''}</header>`
  const notReady = (title) => `${head(title)}<section class="panel pf-notready" data-platform="not-configured"><p>${E(L('회원 기능은 준비 중이에요. 서버와 보안 점검이 끝나면 이곳에서 후기와 사진을 나누고 새 사례를 제보할 수 있어요. 지금은 로그인 없이 아카이브를 그대로 이용할 수 있어요.', 'Member features are not open yet. Once the server and its security review are done you can share reviews and photos and submit new cases here. The archive itself needs no account.'))}</p><p><a class="button subtle" href="./support.html">${I('lifebuoy')}${E(L('지원 · 문의', 'Support'))}</a></p></section>`
  const signInFirst = () => `<section class="panel pf-signin"><p>${E(L('로그인한 회원만 쓸 수 있어요. 둘러보기는 로그인 없이 할 수 있어요.', 'Sign in to write. Reading needs no account.'))}</p><a class="button" href="#account">${I('sign-in')}${E(L('로그인 · 회원가입', 'Sign in or create an account'))}</a></section>`
  const msg = (id = 'pfMessage') => `<p id="${id}" class="form-message" role="alert"></p>`
  const say = (text, id = 'pfMessage') => { const m = document.getElementById(id); if (m) m.textContent = text }
  const ERR = {
    rate_limited: ['잠시 후 다시 시도해 주세요. 짧은 시간에 너무 많이 올렸어요.', 'Please wait a moment: too many posts in a short time.'],
    account_restricted: ['이메일 인증을 마치지 않았거나 이용이 제한된 계정이에요.', 'Your e-mail is not confirmed yet, or your account is restricted.'],
    too_many_links: ['링크는 3개까지 넣을 수 있어요.', 'At most three links.'],
    content_blocked: ['안전하지 않은 링크 형식이 있어 올릴 수 없어요.', 'This contains an unsafe link and cannot be posted.'],
    post_not_public: ['공개된 글에만 댓글을 달 수 있어요.', 'Comments are only possible on published posts.'],
    sign_in_required_or_copyright_notice: ['로그인 후 신고할 수 있어요. 저작권 침해 신고는 연락처를 적어 주세요.', 'Sign in to report. Copyright notices need a contact address.'],
  }
  const errText = (e) => { const m = String(e?.message || e || ''); for (const [k, v] of Object.entries(ERR)) if (m.includes(k)) return L(...v); const miss = m.match(/missing_fields: ([a-z0-9_,]+)/); if (miss) return L('빠진 항목: ', 'Missing: ') + miss[1].split(',').map((f) => FIELD_LABEL[f] ? L(...FIELD_LABEL[f]) : f).join(', '); return L('요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.', 'That did not work. Please try again later.') }
  const FIELD_LABEL = { name: ['이름', 'name'], country_iso2: ['국가', 'country'], city_or_venue: ['도시 또는 장소', 'city or venue'], project_type: ['유형', 'type'], description: ['설명(30자 이상)', 'description (30+ characters)'], source: ['출처 링크', 'a source link'], source_or_description: ['링크 또는 설명', 'a link or a description'], correction_fields: ['정정할 항목과 값', 'the field and the value'], event_starts_on: ['시작일', 'start date'] }

  // ---- community home and posts ----------------------------------------------------------------------------------
  const KIND = { review: ['방문 후기', 'Visit reviews'], question: ['질문과 정보 교환', 'Questions'], info: ['전시·축제 소식', 'News and tips'] }
  function home() {
    const a = api(), signed = !!a?.user?.()
    return `${head(L('커뮤니티', 'Community'), L('작품과 장소를 중심으로 방문 경험과 기록을 나눠요. 회원 글과 사진은 운영자 검수 후 공개되며, 공식 검증 자료와 구분해 표시해요.', 'Share visits and records around works and places. Member posts and photos are published after review and are shown apart from verified archive material.'))}
      ${signed ? `<nav class="pf-actions" aria-label="${E(L('글쓰기', 'Write'))}"><a class="button" href="#community/write">${I('note-pencil')}${E(L('후기·질문 쓰기', 'Write a post'))}</a><a class="button subtle" href="#community/submit">${I('plus')}${E(L('새 사례 제보·등록 신청', 'Submit a case'))}</a><a class="button subtle" href="#community/mine">${I('list-checks')}${E(L('내 제보·등록 내역', 'My submissions'))}</a><a class="button ghost" href="#profile">${I('user')}${E(L('프로필', 'Profile'))}</a></nav>` : signInFirst()}
      <div class="pf-tabs" role="tablist">${Object.entries(KIND).map(([k, v], i) => `<button class="button subtle small" role="tab" data-pf-kind="${k}" aria-selected="${i === 0}">${E(L(...v))}</button>`).join('')}</div>
      <section id="pfFeed" class="pf-feed" aria-live="polite"><p class="muted">${E(L('불러오는 중…', 'Loading…'))}</p></section>`
  }
  const postCard = (p) => `<article class="pf-card"><h3><a href="#community/post/${E(p.id)}">${E(p.title)}</a></h3><p class="pf-meta">${E(p.author_name || L('이용자', 'Member'))} · ${E(when(p.published_at))}${p.project_id ? ` · <a href="#place/${E(p.project_id)}">${E(placeName(p.project_id))}</a>` : ''}${p.visited_on ? ` · ${E(L('방문', 'visited'))} ${E(when(p.visited_on))}` : ''}</p><p class="pf-body">${E(String(p.body).slice(0, 280))}${String(p.body).length > 280 ? '…' : ''}</p><p class="pf-meta">${I('heart')} ${E(p.like_count ?? 0)} · ${E(L('댓글', 'comments'))} ${E(p.comment_count ?? 0)}</p></article>`
  async function loadFeed(kind = 'review') {
    const box = document.getElementById('pfFeed'); if (!box) return
    try {
      const list = await api().posts({ kind, limit: 30 })
      box.innerHTML = list.length ? list.map(postCard).join('') : `<p class="muted">${E(L('아직 공개된 글이 없어요.', 'Nothing published yet.'))}</p>`
    } catch (e) { box.innerHTML = `<p class="form-message">${E(errText(e))}</p>` }
  }
  function postPage(id) { return `<div id="pfPost" data-post="${E(id)}"><p class="muted">${E(L('불러오는 중…', 'Loading…'))}</p></div>` }
  async function loadPost(id) {
    const box = document.getElementById('pfPost'); if (!box) return
    try {
      const { post, comments } = await api().post(Number(id))
      if (!post) { box.innerHTML = `${head(L('글을 찾을 수 없어요', 'Post not found'))}<p class="muted">${E(L('공개되지 않았거나 삭제된 글이에요.', 'It is not published or was removed.'))}</p>`; return }
      const signed = !!api().user()
      box.innerHTML = `${head(post.title)}<p class="pf-meta">${E(post.author_name || L('이용자', 'Member'))} · ${E(when(post.published_at))}${post.project_id ? ` · <a href="#place/${E(post.project_id)}">${E(placeName(post.project_id))}</a>` : ''}</p>
        <p class="pf-note">${E(L('이용자가 쓴 글이에요. 방문 사실은 확인하지 않았어요.', 'Written by a member. The visit was not verified.'))}</p>
        <div class="pf-body pf-full">${E(post.body).replace(/\n/g, '<br>')}</div>
        <div class="actions">${signed ? `<button class="button subtle small" data-pf-like="${E(post.id)}">${I('heart')}${E(L('좋아요', 'Like'))} ${E(post.like_count ?? 0)}</button>` : ''}<button class="button ghost small" data-pf-report="post:${E(post.id)}">${I('flag')}${E(L('신고', 'Report'))}</button></div>
        <h2 class="group-caption">${E(L('댓글', 'Comments'))}</h2><div class="pf-comments">${comments.length ? comments.map((c) => `<div class="pf-comment"><p class="pf-meta">${E(c.author_name || L('이용자', 'Member'))} · ${E(when(c.published_at))} <button class="link-button" data-pf-report="comment:${E(c.id)}">${E(L('신고', 'Report'))}</button></p><p>${E(c.body)}</p></div>`).join('') : `<p class="muted">${E(L('아직 댓글이 없어요.', 'No comments yet.'))}</p>`}</div>
        ${signed ? `<form id="pfComment" class="form-grid"><label class="field">${E(L('댓글 (검수 후 공개)', 'Comment (published after review)'))}<textarea name="body" required minlength="2" maxlength="2000" rows="3"></textarea></label><div class="actions"><button class="button">${E(L('댓글 남기기', 'Post comment'))}</button></div></form>${msg()}` : signInFirst()}`
      const f = document.getElementById('pfComment')
      if (f) f.onsubmit = async (ev) => { ev.preventDefault(); try { await api().comment(post.id, new FormData(f).get('body')); f.reset(); say(L('댓글을 보냈어요. 검수 후 공개돼요.', 'Sent. It appears after review.')) } catch (e) { say(errText(e)) } }
    } catch (e) { box.innerHTML = `<p class="form-message">${E(errText(e))}</p>` }
  }

  function writePage(projectId) {
    if (!api().user()) return head(L('글쓰기', 'Write')) + signInFirst()
    const pid = ID.test(projectId || '') ? projectId : ''
    return `${head(L('후기·질문 쓰기', 'Write a post'), L('검수 후 공개돼요. 광고, 다른 사람의 개인정보, 비방은 올릴 수 없어요.', 'Published after review. No ads, other people\'s personal data or attacks.'))}
      <form id="pfWrite" class="form-grid">
       <label class="field">${E(L('종류', 'Type'))}<select name="kind"><option value="review">${E(L('방문 후기', 'Visit review'))}</option><option value="question">${E(L('질문', 'Question'))}</option><option value="info">${E(L('전시·축제 소식', 'News or tip'))}</option></select></label>
       <label class="field">${E(L('작품·장소 ID (후기는 필수)', 'Project ID (required for reviews)'))}<input name="project_id" value="${E(pid)}" pattern="[A-Za-z0-9_-]{2,40}" placeholder="SEOUL006">${pid ? `<span class="muted">${E(placeName(pid))}</span>` : ''}</label>
       <label class="field">${E(L('제목', 'Title'))}<input name="title" required minlength="2" maxlength="120"></label>
       <label class="field">${E(L('내용', 'Text'))}<textarea name="body" required minlength="10" maxlength="5000" rows="8"></textarea></label>
       <label class="field">${E(L('방문일 (선택)', 'Visit date (optional)'))}<input name="visited_on" type="date"></label>
       <p class="muted">${E(L('방문일은 본인이 적은 정보이며 운영자가 방문 사실을 확인하지 않아요.', 'The visit date is your own statement; it is not verified.'))}</p>
       <div class="actions"><button class="button" name="intent" value="pending">${E(L('검수 요청', 'Submit for review'))}</button><button class="button subtle" name="intent" value="draft">${E(L('임시 저장', 'Save draft'))}</button></div>
      </form>${msg()}`
  }

  // ---- photos ------------------------------------------------------------------------------------------------------
  // The photo is re-encoded to JPEG in the browser (canvas): EXIF including GPS is not carried over; the server
  // checks the file again before anything is published.
  async function reencode(file, maxSide = 3000) {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale)
    const c = document.createElement('canvas'); c.width = w; c.height = h
    c.getContext('2d').drawImage(bmp, 0, 0, w, h)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
    return { blob, width: w, height: h }
  }
  function photoPage(projectId) {
    if (!api().user()) return head(L('사진 공유', 'Share a photo')) + signInFirst()
    if (!ID.test(projectId || '')) return head(L('사진 공유', 'Share a photo')) + `<p class="muted">${E(L('작품 상세 페이지의 "사진 제공하기"에서 시작해 주세요.', 'Start from "Contribute a photo" on a project page.'))}</p>`
    return `${head(L('사진 공유', 'Share a photo'), placeName(projectId))}
      <section class="panel pf-rules"><p>${E(L('직접 찍은 작품 사진만 올려 주세요. 운영자가 사진을 보고 작품과 일치하는지, 권리 문제가 없는지 확인한 뒤 "이용자 사진"으로 공개해요. 공식 대표 이미지로 쓰는 것은 별도로 다시 검토해요.', 'Only photos you took of the work. Staff check that it shows the work and has no rights problem, then publish it as a member photo. Use as an official image is a separate review.'))}</p>
       <p class="muted">${E(L('직접 찍은 사진이라도 사진 속 작품(영상·조명 연출)에는 작가의 저작권이 따로 있을 수 있어요. 그래서 공개 범위는 이 사이트에서 저작자 표시와 함께 보여 주는 것으로 시작해요.', 'Even your own photo can show a work with its own copyright (the video or light design), so publication starts with display on this site with your credit.'))}</p></section>
      <form id="pfPhoto" class="form-grid" data-project="${E(projectId)}">
       <label class="field">${E(L('사진 (JPEG·PNG·WebP, 긴 변 900px 이상 권장)', 'Photo (JPEG, PNG or WebP; long side 900 px or more)'))}<input name="file" type="file" accept="image/jpeg,image/png,image/webp" required></label>
       <label class="field">${E(L('설명 (선택)', 'Caption (optional)'))}<input name="caption" maxlength="300"></label>
       <label class="field">${E(L('촬영일 (선택)', 'Date taken (optional)'))}<input name="taken_on" type="date"></label>
       <fieldset class="field"><legend>${E(L('이용 허락 범위', 'Licence'))}</legend>
        <label><input type="radio" name="licence" value="display" checked> ${E(L('이 사이트에서 저작자 표시와 함께 보여 주는 것만 허락', 'Display on this site with my credit only'))}</label>
        <label><input type="radio" name="licence" value="cc-by-4.0"> CC BY 4.0</label>
        <label><input type="radio" name="licence" value="cc-by-sa-4.0"> CC BY-SA 4.0</label></fieldset>
       <fieldset class="field"><legend>${E(L('확인 (모두 필요)', 'Confirm (all required)'))}</legend>
        <label><input type="checkbox" name="own_photo" required> ${E(L('제가 직접 찍은 사진이에요.', 'I took this photo.'))}</label>
        <label><input type="checkbox" name="can_license" required> ${E(L('위 범위로 이용을 허락할 권리가 저에게 있어요.', 'I have the right to grant the licence above.'))}</label>
        <label><input type="checkbox" name="people_ok" required> ${E(L('알아볼 수 있는 사람이 없거나, 그 사람의 동의를 받았어요.', 'No identifiable person, or they agreed.'))}</label>
        <label><input type="checkbox" name="artwork_rights_notice" required> ${E(L('사진 속 작품에는 작가의 권리가 따로 있을 수 있다는 점을 알아요.', 'I understand the work shown may have its own rights.'))}</label></fieldset>
       <label><input type="checkbox" name="offer_official"> ${E(L('CC 라이선스를 고른 경우, 공식 대표 이미지 후보로 검토해도 좋아요.', 'If I chose a CC licence, staff may consider it as an official image.'))}</label>
       <p class="muted">${E(L('올리기 전에 위치 정보(EXIF·GPS)는 지워져요. 검수 전에는 본인과 운영자만 볼 수 있어요.', 'Location data (EXIF, GPS) is removed before upload. Until review only you and staff can see it.'))}</p>
       <div class="actions"><button class="button">${I('upload-simple')}${E(L('검수 요청', 'Submit for review'))}</button></div>
      </form>${msg()}`
  }

  // ---- submissions ---------------------------------------------------------------------------------------------------
  const SUBKIND = { tip: ['새 사례 제보 (이름과 링크만)', 'Tip (a name and a link)'], new_project: ['미등록 프로젝트 등록 신청', 'New project'], creator_work: ['작가·제작사 작품 등록', 'My own work (artist or producer)'], correction: ['기존 사례 정보 정정', 'Correction to a project'], event: ['전시·축제 일정 제보', 'Event or exhibition'] }
  const TYPES = ['media_facade', 'media_architecture', 'projection_mapping', 'light_art', 'media_wall', 'urban_screen', 'interactive_installation', 'festival_program', 'other']
  function submitPage(arg) {
    if (!api().user()) return head(L('사례 제보·등록 신청', 'Submit a case')) + signInFirst()
    const [kind0, pid] = String(arg || '').split(':')
    const kind = SUBKIND[kind0] ? kind0 : 'new_project'
    return `${head(L('사례 제보·등록 신청', 'Submit a case'), L('부족한 정보가 있어도 임시 저장할 수 있어요. 제출하면 중복 확인과 출처 확인 뒤 운영자가 검토해요. 승인되기 전에는 공식 목록과 검색엔진에 나오지 않아요.', 'You can save an incomplete draft. After you submit, duplicates and sources are checked and staff review it. Nothing appears in the official list or in search engines before approval.'))}
      <form id="pfSubmit" class="form-grid">
       <label class="field">${E(L('종류', 'Kind'))}<select name="kind">${Object.entries(SUBKIND).map(([k, v]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${E(L(...v))}</option>`).join('')}</select></label>
       <label class="field">${E(L('기존 사례 ID (정정·일정일 때)', 'Existing project ID (corrections, events)'))}<input name="project_id" value="${E(ID.test(pid || '') ? pid : '')}" pattern="[A-Za-z0-9_-]{2,40}"></label>
       <label class="field">${E(L('프로젝트명', 'Name'))}<input name="name" maxlength="200"></label>
       <label class="field">${E(L('영문명', 'English name'))}<input name="name_en" maxlength="200"></label>
       <label class="field">${E(L('국가 (ISO 두 글자, 예: KR)', 'Country (ISO code, e.g. KR)'))}<input name="country_iso2" maxlength="2" pattern="[A-Za-z]{2}"></label>
       <label class="field">${E(L('도시', 'City'))}<input name="city" maxlength="120"></label>
       <label class="field">${E(L('장소', 'Venue'))}<input name="venue" maxlength="200"></label>
       <label class="field">${E(L('유형', 'Type'))}<select name="project_type"><option value="">—</option>${TYPES.map((t) => `<option value="${t}">${E(t)}</option>`).join('')}</select></label>
       <label class="field">${E(L('작가·제작사', 'Artists or producers'))}<input name="creators" maxlength="500"></label>
       <label class="field">${E(L('공개·설치 연도', 'Year'))}<input name="year_start" type="number" min="1850" max="2100"></label>
       <label class="field">${E(L('설명', 'Description'))}<textarea name="description" maxlength="5000" rows="5"></textarea></label>
       <label class="field">${E(L('공식 홈페이지', 'Official website'))}<input name="official_url" type="url" maxlength="500"></label>
       <label class="field">${E(L('관련 출처 링크 (한 줄에 하나, 최대 10개)', 'Source links (one per line, up to 10)'))}<textarea name="source_urls" rows="3"></textarea></label>
       <label class="field">${E(L('정정할 항목 / 새 값 (정정일 때)', 'Field / new value (corrections)'))}<input name="field_name" maxlength="60" placeholder="year_installed"><input name="proposed_value" maxlength="2000"></label>
       <label class="field">${E(L('행사 시작일 / 종료일 (일정일 때)', 'Event start / end (events)'))}<input name="event_starts_on" type="date"><input name="event_ends_on" type="date"></label>
       <label class="field">${E(L('이미지와 이미지 권리 (예: 제가 찍은 사진, 주최 측 보도자료 사진 사용 허락 있음)', 'Images and their rights'))}<textarea name="image_note" maxlength="1000" rows="2"></textarea></label>
       <label class="field">${E(L('나와 이 사례의 관계', 'Your relation to it'))}<select name="relation"><option value="visitor">${E(L('방문자', 'Visitor'))}</option><option value="artist">${E(L('작가', 'Artist'))}</option><option value="producer">${E(L('제작사', 'Producer'))}</option><option value="organizer">${E(L('주최·운영 기관', 'Organiser'))}</option><option value="researcher">${E(L('연구자', 'Researcher'))}</option><option value="other">${E(L('기타', 'Other'))}</option></select></label>
       <div class="actions"><button class="button" name="intent" value="pending">${E(L('제출', 'Submit'))}</button><button class="button subtle" name="intent" value="draft">${E(L('임시 저장', 'Save draft'))}</button></div>
      </form>${msg()}`
  }
  function readSubmission(f) {
    const fd = new FormData(f), v = (k) => { const x = String(fd.get(k) || '').trim(); return x || null }
    return {
      kind: v('kind'), project_id: v('project_id'), name: v('name'), name_en: v('name_en'), country_iso2: v('country_iso2')?.toUpperCase() || null, city: v('city'), venue: v('venue'),
      project_type: v('project_type'), creators: v('creators'), year_start: v('year_start') ? Number(v('year_start')) : null, description: v('description'), official_url: v('official_url'),
      source_urls: String(fd.get('source_urls') || '').split(/\s+/).map((s) => s.trim()).filter(Boolean).slice(0, 10), field_name: v('field_name'), proposed_value: v('proposed_value'),
      event_starts_on: v('event_starts_on'), event_ends_on: v('event_ends_on'), image_note: v('image_note'), relation: v('relation'),
    }
  }

  // ---- my submissions, appeals, reports --------------------------------------------------------------------------------
  function minePage() { return api().user() ? `${head(L('내 제보·등록 내역', 'My submissions'), L('검수 상태와 결정 사유를 볼 수 있어요. 반려나 게시 중단에는 이의신청을 할 수 있어요.', 'See the review status and reasons. You can appeal a rejection or a takedown.'))}<div id="pfMine"><p class="muted">${E(L('불러오는 중…', 'Loading…'))}</p></div>${msg()}` : head(L('내 제보·등록 내역', 'My submissions')) + signInFirst() }
  async function loadMine() {
    const box = document.getElementById('pfMine'); if (!box) return
    try {
      const m = await api().mine()
      const row = (type, x, title) => `<li class="pf-row"><span>${E(title)}</span> ${badge(x.status)}${x.decision_reason ? `<p class="pf-reason">${E(L('사유', 'Reason'))}: ${E(x.decision_reason)}</p>` : ''}${['rejected', 'removed'].includes(x.status) ? `<button class="button ghost small" data-pf-appeal="${type}:${E(x.id)}">${E(L('이의신청', 'Appeal'))}</button>` : ''}${x.approved_project_id ? ` <a href="#place/${E(x.approved_project_id)}">${E(x.approved_project_id)}</a>` : ''}</li>`
      box.innerHTML = [
        [L('글', 'Posts'), m.posts.map((x) => row('post', x, x.title))],
        [L('사진', 'Photos'), m.photos.map((x) => row('photo', x, `${placeName(x.project_id)}${x.caption ? ' · ' + x.caption : ''}`))],
        [L('제보·등록 신청', 'Submissions'), m.submissions.map((x) => row('submission', x, `${L(...(SUBKIND[x.kind] || [x.kind, x.kind]))}: ${x.name || x.project_id || ''}`))],
        [L('이의신청', 'Appeals'), m.appeals.map((x) => `<li class="pf-row"><span>${E(x.target_type)} ${E(x.target_id ?? '')}</span> ${badge(x.status)}${x.note ? `<p class="pf-reason">${E(x.note)}</p>` : ''}</li>`)],
      ].map(([t, items]) => `<h2 class="group-caption">${E(t)}</h2>${items.length ? `<ul class="pf-list">${items.join('')}</ul>` : `<p class="muted">${E(L('없음', 'None'))}</p>`}`).join('')
    } catch (e) { box.innerHTML = `<p class="form-message">${E(errText(e))}</p>` }
  }
  const REASONS = { spam: ['광고·도배', 'Spam'], harassment: ['괴롭힘·비방', 'Harassment'], hate: ['혐오·차별', 'Hate'], sexual: ['성적 콘텐츠', 'Sexual content'], violence: ['폭력·위협', 'Violence or threats'], privacy: ['개인정보 노출', 'Personal data'], child_safety: ['아동 안전', 'Child safety'], malicious_link: ['악성 링크', 'Malicious link'], copyright: ['저작권 침해', 'Copyright'], unrelated: ['작품과 무관', 'Unrelated'], false_info: ['허위 정보', 'False information'], other: ['기타', 'Other'] }
  function dialog(html, onSubmit) {
    const d = document.getElementById('modal'); if (!d) return
    d.innerHTML = `<form method="dialog" class="form-grid pf-dialog">${html}<p id="pfDialogMsg" class="form-message" role="alert"></p><div class="actions"><button class="button" value="ok">${E(L('보내기', 'Send'))}</button><button class="button ghost" value="cancel" formnovalidate>${E(L('닫기', 'Close'))}</button></div></form>`
    const f = d.querySelector('form')
    f.onsubmit = async (ev) => { if (ev.submitter?.value === 'cancel') return; ev.preventDefault(); try { await onSubmit(new FormData(f)); d.close() ; window.AOLApp?.toast?.(L('접수했어요.', 'Received.')) } catch (e) { const m = d.querySelector('#pfDialogMsg'); if (m) m.textContent = errText(e) } }
    d.showModal?.()
  }
  function report(target) {
    const [type, id] = target.split(':')
    dialog(`<h2 id="modalTitle">${E(L('신고', 'Report'))}</h2><label class="field">${E(L('사유', 'Reason'))}<select name="reason">${Object.entries(REASONS).map(([k, v]) => `<option value="${k}">${E(L(...v))}</option>`).join('')}</select></label><label class="field">${E(L('설명 (선택)', 'Details (optional)'))}<textarea name="message" maxlength="2000" rows="3"></textarea></label>${api().user() ? '' : `<label class="field">${E(L('연락받을 이메일 (저작권 신고)', 'Your e-mail (copyright notices)'))}<input name="contact_email" type="email" maxlength="254"></label>`}<p class="muted">${E(L('신고 내용은 운영자만 봐요. 같은 글에 여러 신고가 들어오면 검토할 때까지 가려져요.', 'Only staff read reports. An item with several reports is hidden until reviewed.'))}</p>`,
      (fd) => api().flag({ target_type: type, target_id: Number(id), reason: fd.get('reason'), message: fd.get('message') || null, contact_email: fd.get('contact_email') || null }))
  }
  function appeal(target) {
    const [type, id] = target.split(':')
    dialog(`<h2 id="modalTitle">${E(L('이의신청', 'Appeal'))}</h2><label class="field">${E(L('다시 검토해 주었으면 하는 이유 (10자 이상)', 'Why it should be reviewed again (10+ characters)'))}<textarea name="message" required minlength="10" maxlength="2000" rows="4"></textarea></label><p class="muted">${E(L('처음 결정에 참여하지 않은 운영자가 가능하면 다시 검토하고, 결과와 사유를 내역에 남겨요.', 'Where possible another staff member reviews it; the result and reason appear in your list.'))}</p>`,
      (fd) => api().appeal({ target_type: type, target_id: Number(id), message: fd.get('message') }))
  }

  // ---- researcher application ----------------------------------------------------------------------------------------
  function researchPage() {
    const a = api()
    if (!a) return notReady(L('연구자 인증 신청', 'Researcher application'))
    if (!a.user()) return head(L('연구자 인증 신청', 'Researcher application')) + signInFirst()
    return `${head(L('연구자 인증 신청', 'Researcher application'), L('연구용 데이터 패키지는 승인된 연구자만 내려받을 수 있어요. 로그인과 이메일 인증은 이메일 주소를 확인할 뿐, 연구자 신원이나 소속을 확인하는 것이 아니에요.', 'Research packages are for approved researchers. Signing in and confirming an e-mail only show that you can read that inbox; they do not verify who you are or your affiliation.'))}
      <div id="pfResearchStatus"><p class="muted">${E(L('불러오는 중…', 'Loading…'))}</p></div>`
  }
  async function loadResearch() {
    const box = document.getElementById('pfResearchStatus'); if (!box) return
    try {
      const me = await api().account(), app = me?.application, terms = me?.research_terms_version
      const open = !app || ['rejected', 'revoked', 'expired', 'withdrawn'].includes(app.status)
      const status = app ? `<section class="panel"><h2 class="group-caption">${E(L('내 신청', 'My application'))}</h2><p>${badge(app.status)} ${E(when(app.created_at))}</p>${app.decision_reason ? `<p class="pf-reason">${E(L('사유', 'Reason'))}: ${E(app.decision_reason)}</p>` : ''}${app.expires_at ? `<p class="muted">${E(L('이용 기간', 'Access until'))}: ${E(when(app.expires_at))}</p>` : ''}${app.status === 'approved' && terms && app.terms_version !== terms ? `<p>${E(L('연구데이터 이용조건이 바뀌었어요. 새 조건에 동의해야 다시 내려받을 수 있어요.', 'The research data terms changed. Accept them to download again.'))}</p><button class="button" data-pf-terms="${E(terms)}">${E(L('새 이용조건에 동의', 'Accept the new terms'))}</button>` : ''}${me.grants?.length ? `<ul class="pf-list">${me.grants.map((g) => `<li>${E(g.dataset_id)} · ${E(g.revoked ? L('취소됨', 'revoked') : L('~', 'until ') + when(g.expires_at))}</li>`).join('')}</ul>` : ''}${app.status === 'needs_info' ? `<p>${E(L('아래 양식으로 보완해 다시 제출해 주세요.', 'Please complete the form below and submit again.'))}</p>` : ''}</section>` : ''
      const form = open || app?.status === 'needs_info' ? `<form id="pfResearch" class="form-grid">
        <label class="field">${E(L('이름', 'Name'))}<input name="full_name" required minlength="2" maxlength="80" autocomplete="name"></label>
        <label class="field">${E(L('소속 (해당하는 경우)', 'Affiliation (if any)'))}<input name="affiliation" maxlength="160" autocomplete="organization"></label>
        <label class="field">${E(L('구분', 'Applicant type'))}<select name="applicant_type"><option value="graduate_student">${E(L('대학원생', 'Graduate student'))}</option><option value="undergraduate">${E(L('학부생', 'Undergraduate'))}</option><option value="faculty">${E(L('교원', 'Faculty'))}</option><option value="researcher">${E(L('연구원', 'Researcher'))}</option><option value="independent">${E(L('독립 연구자', 'Independent researcher'))}</option><option value="professional">${E(L('실무자', 'Practitioner'))}</option><option value="other">${E(L('기타', 'Other'))}</option></select></label>
        <label class="field">${E(L('연구 분야', 'Research field'))}<input name="research_field" required minlength="2" maxlength="120"></label>
        <label class="field">${E(L('데이터 이용 목적 (20자 이상)', 'Purpose (20+ characters)'))}<textarea name="purpose" required minlength="20" maxlength="2000" rows="4"></textarea></label>
        <label class="field">${E(L('확인할 수 있는 공개 링크 (선택: 기관 소개 페이지, ORCID, 논문 등)', 'A public link that shows your work (optional: institutional page, ORCID, a paper)'))}<input name="verification_url" type="url" pattern="https://.*" maxlength="500"></label>
        <label class="field">${E(L('그 밖의 확인 방법 (선택: 지도교수 연락처 등)', 'Other ways to verify (optional, e.g. a supervisor)'))}<input name="verification_note" maxlength="500"></label>
        <p class="muted">${E(L('재직증명서나 학생증 같은 증빙 파일은 받지 않아요. 공개 링크나 설명으로 확인이 어려우면 운영자가 보완을 요청해요.', 'We do not collect ID documents or certificates. If a link or note is not enough, staff will ask for more information.'))}</p>
        <label><input type="checkbox" name="terms" required> ${E(L(`연구데이터 이용조건(${terms || ''})과 개인정보 처리 안내를 읽고 동의해요.`, `I accept the research data terms (${terms || ''}) and the privacy notice.`))}</label>
        <input type="hidden" name="terms_version" value="${E(terms || '')}">
        <div class="actions"><button class="button">${E(L('신청', 'Apply'))}</button></div></form>${msg()}` : ''
      box.innerHTML = status + form
      const f = document.getElementById('pfResearch')
      if (f) f.onsubmit = async (ev) => { ev.preventDefault(); const fd = new FormData(f); try { await api().applyResearcher({ full_name: fd.get('full_name'), affiliation: fd.get('affiliation') || null, applicant_type: fd.get('applicant_type'), research_field: fd.get('research_field'), purpose: fd.get('purpose'), verification_url: fd.get('verification_url') || null, verification_note: fd.get('verification_note') || null, terms_version: fd.get('terms_version'), requested_datasets: ['aol-research'], update: app?.status === 'needs_info' ? app.id : null }); await loadResearch(); say(L('신청을 접수했어요. 검토 결과는 이 화면에서 볼 수 있어요.', 'Received. The result will appear on this page.')) } catch (e) { say(errText(e)) } }
      box.querySelector('[data-pf-terms]')?.addEventListener('click', async (ev) => { try { await api().acceptTerms(ev.currentTarget.dataset.pfTerms); await loadResearch() } catch (e) { say(errText(e)) } })
    } catch (e) { box.innerHTML = `<p class="form-message">${E(errText(e))}</p>` }
  }

  function profilePage() { return api().user() ? `${head(L('프로필', 'Profile'), L('공개 글에는 표시 이름만 보여요. 이메일은 공개되지 않아요.', 'Only the display name is shown with your posts. Your e-mail is never shown.'))}<form id="pfProfile" class="form-grid"><label class="field">${E(L('표시 이름 (2~40자)', 'Display name (2–40)'))}<input name="display_name" minlength="2" maxlength="40"></label><label class="field">${E(L('소개 (선택)', 'About (optional)'))}<textarea name="bio" maxlength="300" rows="3"></textarea></label><div class="actions"><button class="button">${E(L('저장', 'Save'))}</button><a class="button ghost" href="#account">${E(L('계정·탈퇴', 'Account and deletion'))}</a></div></form>${msg()}` : head(L('프로필', 'Profile')) + signInFirst() }

  // ---- photo contribution guide (works without a server) ----------------------------------------------------------------
  function contributePage(projectId) {
    const pid = ID.test(projectId || '') ? projectId : ''
    if (enabled() && api().user() && pid) return photoPage(pid)
    const name = pid ? placeName(pid) : ''
    const mail = cfg().SUPPORT_EMAIL || ''
    const subject = `[사진 제공] ${pid} ${name}`.trim()
    const body = [`작품: ${name} (${pid})`, '촬영일:', '촬영 장소:', '저작자 표시 이름:', '이용 허락 범위: (1) 빛의 건축 사이트에서 저작자 표시와 함께 게시 / (2) CC BY 4.0 / (3) CC BY-SA 4.0 중 선택', '', '확인:', '- 제가 직접 찍은 사진입니다.', '- 알아볼 수 있는 사람이 없거나 동의를 받았습니다.', '- 사진 속 작품에는 작가의 권리가 따로 있을 수 있음을 압니다.'].join('\n')
    return `${head(L('사진 제공하기', 'Contribute a photo'), name)}
      <section class="panel"><p>${E(L('이 작품의 실제 모습을 직접 찍은 사진이 있다면 보내 주세요. 운영자가 작품과 일치하는지, 권리 문제가 없는지 확인한 뒤에만 게시해요. 확인할 수 없으면 게시하지 않아요.', 'If you took a photo of this work in operation, you can send it. Staff publish it only after checking that it shows the work and has no rights problem.'))}</p>
      <ul class="pf-list"><li>${E(L('작품이 켜져 있거나 상영 중인 모습 (낮에 찍은 건물만 보이는 사진은 대표 이미지로 쓰지 않아요)', 'The work switched on or running (a daytime photo of the building is not used as the main image)'))}</li><li>${E(L('긴 변 900px 이상', 'Long side 900 px or more'))}</li><li>${E(L('알아볼 수 있는 사람이 크게 나오지 않은 사진', 'No large identifiable people'))}</li><li>${E(L('직접 찍은 사진이라도 사진 속 영상·조명 작품에는 작가의 권리가 따로 있을 수 있어요', 'The video or light work shown may have its own rights even in your own photo'))}</li></ul>
      ${enabled() ? `<p><a class="button" href="#account">${I('sign-in')}${E(L('로그인하고 올리기', 'Sign in to upload'))}</a></p>` : `<p>${E(L('회원 업로드는 준비 중이에요. 지금은 이메일로 보내 주실 수 있어요. 메일에는 사진 파일과 아래 확인 내용을 함께 적어 주세요.', 'Member uploads are not open yet. You can send the photo by e-mail with the statements below.'))}</p>${mail ? `<p><a class="button" href="mailto:${E(mail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}">${I('envelope-simple')}${E(L('이메일로 보내기', 'Send by e-mail'))}</a></p>` : ''}`}
      <p class="muted">${E(L('Wikimedia Commons에 직접 올려 주셔도 좋아요(CC BY-SA 4.0 등). 그 경우 파일 이름을 알려 주시면 확인 후 연결해요.', 'You can also upload it to Wikimedia Commons (e.g. CC BY-SA 4.0) and tell us the file name.'))}</p></section>`
  }

  // ---- detail page section (only with a server) ---------------------------------------------------------------------
  function detailSection(p) {
    if (!enabled()) return ''
    const id = E(p.id || p.place_id)
    return `<section class="dp-community" id="dpCommunity" data-project="${id}" aria-labelledby="dpCommunityTitle"><h2 id="dpCommunityTitle" class="section-title">${E(L('이용자 기록', 'Member contributions'))}</h2><p class="pf-note">${E(L('이용자가 올린 후기와 사진이에요. 공식 검증 자료와 다르며 운영자 검수 후 공개돼요.', 'Reviews and photos by members: not verified archive material, published after review.'))}</p><div id="dpCommunityPhotos" class="pf-photos"></div><div id="dpCommunityPosts"></div><div class="actions"><a class="button subtle small" href="#community/write/${id}">${I('note-pencil')}${E(L('후기 쓰기', 'Write a review'))}</a><a class="button subtle small" href="#contribute/${id}">${I('camera')}${E(L('사진 공유', 'Share a photo'))}</a><a class="button ghost small" href="#community/submit/correction:${id}">${I('pencil-simple')}${E(L('정보 정정 제보', 'Suggest a correction'))}</a></div></section>`
  }
  async function loadDetail() {
    const box = document.getElementById('dpCommunity'); if (!box) return
    const pid = box.dataset.project
    try {
      const [posts, photos] = await Promise.all([api().posts({ project: pid, kind: 'review', limit: 3 }), api().photos(pid)])
      const pb = document.getElementById('dpCommunityPosts'), ph = document.getElementById('dpCommunityPhotos')
      if (pb) pb.innerHTML = posts.length ? posts.map(postCard).join('') : `<p class="muted">${E(L('아직 공개된 후기가 없어요.', 'No published reviews yet.'))}</p>`
      if (ph) ph.innerHTML = photos.map((f) => `<figure class="pf-photo"><img src="${E(f.url)}" alt="${E(f.caption || placeName(pid))}" width="${E(f.width)}" height="${E(f.height)}" loading="lazy" decoding="async"><figcaption><span class="pf-tag">${E(L('이용자 사진', 'Member photo'))}</span> ${E(f.author_name || '')} · ${E(f.licence === 'display' ? L('이 사이트 게시 허락', 'shown with permission') : f.licence.toUpperCase())} <button class="link-button" data-pf-report="photo:${E(f.id)}">${E(L('신고', 'Report'))}</button></figcaption></figure>`).join('')
    } catch (_e) { /* the archive page stays as it is */ }
  }
  const contributeLink = (p) => `<p class="dp-contribute"><a class="button subtle small" href="#contribute/${E(p.id || p.place_id)}">${I('camera')}${E(L('사진 제공하기', 'Contribute a photo'))}</a></p>`

  // ---- routing and binding --------------------------------------------------------------------------------------------
  function page(name, id, path = []) {
    if (name === 'contribute') return contributePage(id)
    if (!enabled()) return notReady(name === 'research-apply' ? L('연구자 인증 신청', 'Researcher application') : name === 'profile' ? L('프로필', 'Profile') : L('커뮤니티', 'Community'))
    if (name === 'research-apply') return researchPage()
    if (name === 'profile') return profilePage()
    const sub = id || '', rest = path[2]
    if (sub === 'write') return writePage(rest)
    if (sub === 'photo') return photoPage(rest)
    if (sub === 'submit') return submitPage(rest)
    if (sub === 'mine') return minePage()
    if (sub === 'post') return postPage(rest)
    return home()
  }
  function bind(name) {
    if (name === 'place') { if (enabled()) loadDetail() }
    if (!enabled()) return
    if (name === 'research-apply') loadResearch()
    if (name !== 'community' && name !== 'profile' && name !== 'contribute' && name !== 'place') return
    const [, sub, rest] = (location.hash.slice(1).split('?')[0]).split('/')
    if (name === 'community' && !sub) { loadFeed('review'); document.querySelectorAll('[data-pf-kind]').forEach((b) => { b.onclick = () => { document.querySelectorAll('[data-pf-kind]').forEach((x) => x.setAttribute('aria-selected', String(x === b))); loadFeed(b.dataset.pfKind) } }) }
    if (sub === 'post') loadPost(rest)
    if (sub === 'mine') { loadMine(); document.getElementById('pfMine')?.addEventListener('click', (ev) => { const b = ev.target.closest('[data-pf-appeal]'); if (b) appeal(b.dataset.pfAppeal) }) }
    const w = document.getElementById('pfWrite')
    if (w) w.onsubmit = async (ev) => { ev.preventDefault(); const fd = new FormData(w); try { await api().createPost({ kind: fd.get('kind'), project_id: String(fd.get('project_id') || '').trim() || null, title: fd.get('title'), body: fd.get('body'), visited_on: fd.get('visited_on') || null, status: ev.submitter?.value === 'draft' ? 'draft' : 'pending' }); w.reset(); say(ev.submitter?.value === 'draft' ? L('임시 저장했어요. 내 제보·등록 내역에서 볼 수 있어요.', 'Saved as a draft.') : L('보냈어요. 검수 후 공개돼요.', 'Sent. It appears after review.')) } catch (e) { say(errText(e)) } }
    const s = document.getElementById('pfSubmit')
    if (s) s.onsubmit = async (ev) => { ev.preventDefault(); try { const r = await api().saveSubmission({ ...readSubmission(s), status: ev.submitter?.value === 'draft' ? 'draft' : 'pending', id: s.dataset.id ? Number(s.dataset.id) : null }); if (r?.id) s.dataset.id = r.id; say(ev.submitter?.value === 'draft' ? L('임시 저장했어요.', 'Draft saved.') : L('제출했어요. 중복·출처 확인 뒤 운영자가 검토해요.', 'Submitted. Duplicates and sources are checked, then staff review it.')) } catch (e) { say(errText(e)) } }
    const ph = document.getElementById('pfPhoto')
    if (ph) ph.onsubmit = async (ev) => {
      ev.preventDefault(); const fd = new FormData(ph), file = fd.get('file')
      if (!(file instanceof Blob) || !file.size) return say(L('사진을 골라 주세요.', 'Choose a photo.'))
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return say(L('JPEG, PNG, WebP만 올릴 수 있어요.', 'JPEG, PNG or WebP only.'))
      if (file.size > 25 * 1024 * 1024) return say(L('파일이 너무 커요 (25MB까지).', 'The file is too large (25 MB max).'))
      try {
        say(L('위치 정보를 지우고 올리는 중…', 'Removing location data and uploading…'))
        const { blob, width, height } = await reencode(file)
        if (width < 600 || height < 400) return say(L('사진이 너무 작아요 (최소 600×400px).', 'The photo is too small (600×400 px minimum).'))
        await api().uploadPhoto({ blob, width, height, project_id: ph.dataset.project, caption: fd.get('caption') || null, taken_on: fd.get('taken_on') || null, licence: fd.get('licence'), offer_official: fd.get('offer_official') === 'on', own_photo: fd.get('own_photo') === 'on', can_license: fd.get('can_license') === 'on', people_ok: fd.get('people_ok') === 'on', artwork_rights_notice: fd.get('artwork_rights_notice') === 'on' })
        ph.reset(); say(L('올렸어요. 운영자가 확인한 뒤 공개돼요.', 'Uploaded. It is published after review.'))
      } catch (e) { say(errText(e)) }
    }
    const pf = document.getElementById('pfProfile')
    if (pf) { api().profile().then((p) => { if (p) { pf.display_name.value = p.display_name || ''; pf.bio.value = p.bio || '' } }).catch(() => {}); pf.onsubmit = async (ev) => { ev.preventDefault(); try { await api().saveProfile({ display_name: pf.display_name.value.trim() || null, bio: pf.bio.value.trim() || null }); say(L('저장했어요.', 'Saved.')) } catch (e) { say(errText(e)) } } }
    document.querySelectorAll('[data-pf-like]').forEach((b) => { b.onclick = async () => { try { await api().like(Number(b.dataset.pfLike)); b.disabled = true } catch (e) { window.AOLApp?.toast?.(errText(e)) } } })
  }
  const ROUTES = new Set(['community', 'contribute', 'profile', 'research-apply'])
  // Report buttons appear in content loaded after the page rendered: one delegated listener serves them all.
  document.addEventListener('click', (ev) => { const b = ev.target.closest?.('[data-pf-report]'); if (b && enabled()) { ev.preventDefault(); report(b.dataset.pfReport) } })
  window.AOLPlatform = { enabled, page, bind, detailSection, contributeLink, handles: (n) => ROUTES.has(n), _reencode: reencode }
  window.addEventListener('aol:platform-ready', () => { const n = (location.hash.slice(1).split('?')[0]).split('/')[0]; if (ROUTES.has(n) || n === 'place') window.AOLApp?.render?.() })
})()
