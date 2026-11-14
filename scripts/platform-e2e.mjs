#!/usr/bin/env node
// v2.0 platform end-to-end check against a real Supabase project (docs/PLATFORM.md "9. 검증 상태"): the brief's P0
// completion conditions, run through the real Auth, PostgREST, Storage and Edge Functions, as members, a researcher and
// a staff member with a TOTP second factor would. Everything it creates is named e2e-<run id> and removed at the end
// (users, posts, photos and their files, the test dataset), also when a step fails.
//
// Environment (never pass keys on the command line; GitHub Actions passes them from Secrets):
//   SUPABASE_URL                 https://<ref>.supabase.co (or the local stack)
//   SUPABASE_PUBLISHABLE_KEY     the public client key (what config.js carries)
//   SUPABASE_SECRET_KEY          the service (secret) key: creates the staff test user and the test dataset, cleans up
//   MODERATION_CRON_SECRET       the secret moderate-queue expects
//   E2E_ORIGIN                   an origin listed in the functions' ALLOWED_ORIGINS (default https://remona8787.github.io)
//   MAILPIT_URL                  optional: the local stack's mail catcher. With it, sign-up is confirmed by the link in
//                                the real confirmation e-mail; without it (a real project), the test user is confirmed
//                                by the service key and the report says the e-mail itself was not checked.
//   E2E_REPORT                   optional: write the JSON report to this path
//
// Exit code 0 only when every check passed. Usage: node scripts/platform-e2e.mjs
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { totp } from './lib/totp.mjs'
import { writeFileSync } from 'node:fs'

const env = (k, d = null) => process.env[k] || d
const URL_ = env('SUPABASE_URL'), PUB = env('SUPABASE_PUBLISHABLE_KEY'), SECRET = env('SUPABASE_SECRET_KEY'), CRON = env('MODERATION_CRON_SECRET')
const ORIGIN = env('E2E_ORIGIN', 'https://remona8787.github.io'), MAILPIT = env('MAILPIT_URL')
if (!URL_ || !PUB || !SECRET || !CRON) { console.error('SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY and MODERATION_CRON_SECRET are required'); process.exit(2) }

const RUN = 'e2e-' + Date.now().toString(36) + '-' + randomBytes(3).toString('hex')
const PASSWORD = 'E2e!' + randomBytes(12).toString('base64url')
const mail = (who) => `${RUN}-${who}@example.com`
const results = []
const check = (step, ok, detail = '') => { results.push({ step, ok: !!ok, detail: String(detail ?? '').slice(0, 300) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? '  — ' + String(detail).slice(0, 160) : ''}`); return !!ok }
const note = (step, detail) => { results.push({ step, ok: null, detail }); console.log(`NOTE  ${step}  — ${detail}`) }
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
const service = createClient(URL_, SECRET, opts)
const anon = createClient(URL_, PUB, opts)
const created = { users: [], dataset: null, files: [] }


async function fn(name, body, token, { secret = null } = {}) {
  const r = await fetch(`${URL_}/functions/v1/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, apikey: PUB, ...(token ? { authorization: 'Bearer ' + token } : {}), ...(secret ? { 'x-aol-cron-secret': secret } : {}) }, body: JSON.stringify(body) })
  let j = null; try { j = await r.json() } catch {}
  return { status: r.status, body: j }
}
// With the mail catcher the members sign up through Auth and get the real confirmation e-mail. On a real project no
// e-mail is sent: the test addresses (example.com) cannot receive mail, and bounced test mail can get a project's
// sending restricted. There the members are created unconfirmed with the service key, and the report says that the
// sign-up endpoint and e-mail delivery were not checked.
async function member(who) {
  const c = createClient(URL_, PUB, opts)
  if (!MAILPIT) {
    const { data, error } = await service.auth.admin.createUser({ email: mail(who), password: PASSWORD, email_confirm: false })
    if (error) throw Error(`create ${who}: ${error.message}`)
    created.users.push(data.user.id)
    return { c, id: data.user.id, email: mail(who), signedUpWithoutSession: null }
  }
  const { data, error } = await c.auth.signUp({ email: mail(who), password: PASSWORD })
  if (error) throw Error(`sign-up ${who}: ${error.message}`)
  created.users.push(data.user.id)
  return { c, id: data.user.id, email: mail(who), signedUpWithoutSession: !data.session }
}
async function confirm(m) {
  if (MAILPIT) {
    let link = null
    for (let i = 0; i < 20 && !link; i++) {
      const s = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent('to:' + m.email)}`)).json()
      const id = s.messages?.[0]?.ID
      if (id) { const msg = await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json(); link = (String(msg.HTML || msg.Text).match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/) || [])[0]?.replace(/&amp;/g, '&') || null }
      if (!link) await new Promise((r) => setTimeout(r, 500))
    }
    if (!link) return { ok: false, how: 'no confirmation e-mail arrived' }
    const r = await fetch(link, { redirect: 'manual' })
    return { ok: r.status >= 300 && r.status < 400, how: 'link in the confirmation e-mail (HTTP ' + r.status + ')' }
  }
  const { error } = await service.auth.admin.updateUserById(m.id, { email_confirm: true })
  return { ok: !error, how: 'confirmed with the service key (real e-mail delivery not checked by this run)' }
}
async function signIn(m) { const { data, error } = await m.c.auth.signInWithPassword({ email: m.email, password: PASSWORD }); if (error) throw error; m.token = data.session.access_token; return data.session }
const rpcErr = async (c, name, args) => { const { error } = await c.rpc(name, args); return error?.message || null }
const tinyJpeg = async (seed) => {
  const { loadSharp } = await import('../pipeline/lib/visual.mjs')
  const sharp = await loadSharp()
  const jpg = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 20 + seed, g: 30, b: 120 } } }).jpeg({ quality: 80 }).toBuffer()
  // An APP1 Exif segment with a fake GPS-like payload, so the test sees publish-photo strip it.
  const payload = Buffer.concat([Buffer.from('Exif\0\0MM\0*\0\0\0\x08'), Buffer.from('GPS-E2E-' + RUN)])
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(payload.length + 2) >> 8, (payload.length + 2) & 255]), payload])
  return Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)])
}

async function main() {
  // ---- 1. Sign-up, e-mail confirmation, sign-in --------------------------------------------------------------------
  const a = await member('alice'), b = await member('bob')
  if (MAILPIT) check('sign-up creates the account without a session (e-mail confirmation required)', a.signedUpWithoutSession && b.signedUpWithoutSession)
  else note('sign-up endpoint', 'not called on a real project (it would e-mail a test address): sign up once with a real address (docs/PLATFORM.md)')
  const early = await a.c.auth.signInWithPassword({ email: a.email, password: PASSWORD })
  check('sign-in is refused before the e-mail is confirmed', !!early.error, early.error?.message)
  for (const m of [a, b]) { const r = await confirm(m); check(`e-mail confirmation (${m === a ? 'alice' : 'bob'})`, r.ok, r.how) }
  await signIn(a); await signIn(b)
  check('sign-in after confirmation', !!a.token && !!b.token)
  const out = createClient(URL_, PUB, opts); await out.auth.signInWithPassword({ email: b.email, password: PASSWORD }); const so = await out.auth.signOut()
  check('sign-out', !so.error, so.error?.message)
  // A sign-out ends every session of the user on the server (Edge Functions refuse the old token at once; PostgREST
  // accepts a signed JWT until it expires, at most an hour): bob signs in again.
  await signIn(b)
  const stale = await fn('research-download', { dataset: 'x-none', version: '1.0.0', format: 'csv' }, (await (async () => { const o = createClient(URL_, PUB, opts); const s = await o.auth.signInWithPassword({ email: b.email, password: PASSWORD }); const t = s.data.session.access_token; await o.auth.signOut(); return t })()))
  check('a signed-out token is refused by the server functions', stale.status === 401, JSON.stringify(stale.body))
  await signIn(b)
  if (MAILPIT) {
    const reset = await anon.auth.resetPasswordForEmail(a.email, { redirectTo: ORIGIN })
    check('password reset e-mail can be requested', !reset.error, reset.error?.message)
  } else {
    // A recovery link issued with the service key: the flow is configured, and no e-mail is sent.
    const reset = await service.auth.admin.generateLink({ type: 'recovery', email: a.email, options: { redirectTo: ORIGIN } })
    check('password reset link can be issued (no e-mail sent)', !reset.error && !!reset.data?.properties?.action_link, reset.error?.message)
  }

  // ---- 2. Profile, and no way to raise one's own role --------------------------------------------------------------
  const up = await a.c.from('member_profiles').upsert({ user_id: a.id, display_name: 'E2E 앨리스', bio: '테스트 계정' })
  check('member edits their profile', !up.error, up.error?.message)
  const fake = await a.c.from('member_profiles').upsert({ user_id: a.id, display_name: '빛의건축 운영자' })
  check('a profile name that reads as staff is refused', /profile_name_reserved/.test(fake.error?.message || ''), fake.error?.message)
  const contact = await a.c.from('member_profiles').upsert({ user_id: a.id, display_name: 'E2E 앨리스', bio: '연락 주세요 010-1234-5678' })
  check('a phone number in the profile text is refused', /profile_bio_rules/.test(contact.error?.message || ''), contact.error?.message)
  const mine = await a.c.rpc('my_account')
  check('my_account answers for the member', !mine.error && mine.data, mine.error?.message)
  const selfAdmin = await a.c.from('app_admins').insert({ user_id: a.id, role: 'admin' })
  check('a member cannot make themselves admin (app_admins)', !!selfAdmin.error, selfAdmin.error?.message)
  check('a member cannot call the role function', !!(await rpcErr(a.c, 'platform_set_role', { p_user: a.id, p_role: 'admin' })))
  check('a member cannot read the staff queue', !!(await rpcErr(a.c, 'platform_admin_queue', { p_type: 'post', p_status: 'pending', p_limit: 5 })))

  // ---- 3. Staff member with a TOTP second factor -------------------------------------------------------------------
  const staffEmail = mail('staff')
  const { data: su, error: suErr } = await service.auth.admin.createUser({ email: staffEmail, password: PASSWORD, email_confirm: true })
  if (suErr) throw suErr
  created.users.push(su.user.id)
  await service.from('app_admins').upsert({ user_id: su.user.id, role: 'admin' })
  const st = { c: createClient(URL_, PUB, opts), id: su.user.id, email: staffEmail }
  await signIn(st)
  check('a staff action without the second factor is refused (mfa_required)', /mfa_required/.test(await rpcErr(st.c, 'platform_admin_queue', { p_type: 'post', p_status: 'pending', p_limit: 5 }) || ''))
  const en = await st.c.auth.mfa.enroll({ factorType: 'totp', friendlyName: RUN })
  if (en.error) throw en.error
  const ch = await st.c.auth.mfa.challenge({ factorId: en.data.id })
  const ver = await st.c.auth.mfa.verify({ factorId: en.data.id, challengeId: ch.data.id, code: totp(en.data.totp.secret) })
  check('staff enrols and verifies a TOTP factor (aal2)', !ver.error, ver.error?.message)
  st.token = ver.data?.access_token || st.token

  // ---- 4. Review: pending, automatic check, staff approval, public view without user ids ---------------------------
  const post = await a.c.from('community_posts').insert({ kind: 'review', project_id: 'SEOUL006', title: `${RUN} 동대문 야경 후기`, body: '밤에 본 외벽 영상이 인상적이었어요. 사람이 많아 조금 일찍 가면 좋아요.', status: 'pending' }).select('id,status').single()
  check('a member writes a review (pending until checked)', !post.error && post.data.status === 'pending', post.error?.message)
  const pubBefore = await anon.from('community_public_posts').select('id').eq('id', post.data.id)
  check('a pending review is not public', !pubBefore.error && pubBefore.data.length === 0, pubBefore.error?.message)
  const baseTable = await anon.from('community_posts').select('id').limit(1)
  check('visitors cannot read the posts table itself', !!baseTable.error || baseTable.data.length === 0, baseTable.error?.message)
  const spam = await b.c.from('community_posts').insert({ kind: 'info', title: `${RUN} 홍보`, body: '지금 가입하면 무료 쿠폰 http://bit.ly/x1 http://bit.ly/x2 http://bit.ly/x3 http://bit.ly/x4 텔레그램 @spam_e2e', status: 'pending' }).select('id').single()
  if (spam.error) check('a spam post with many links is refused when it is written', /link|spam|rule|check/i.test(spam.error.message), spam.error.message)
  const mq = await fn('moderate-queue', {}, null, { secret: CRON })
  check('the automatic check runs (moderate-queue)', mq.status === 200 && mq.body?.ok, JSON.stringify(mq.body))
  const wrongCron = await fn('moderate-queue', {}, null, { secret: 'wrong' })
  check('the automatic check refuses a wrong secret', wrongCron.status === 401)
  const afterCheck = await service.from('community_posts').select('id,status,moderation').in('id', [post.data.id, spam.data?.id].filter(Boolean))
  const ok1 = afterCheck.data?.find((x) => x.id === post.data.id), sp = afterCheck.data?.find((x) => x.id === spam.data?.id)
  check('a normal review goes to a person (needs_review), never published by the rules alone', ok1?.status === 'needs_review', ok1?.status)
  if (!spam.error) check('a spam post with many links is held or rejected by the rules', sp && ['needs_review', 'rejected'].includes(sp.status) && sp.moderation, `${sp?.status} ${JSON.stringify(sp?.moderation?.categories || sp?.moderation || '')}`)
  check('staff approves the review', !(await rpcErr(st.c, 'platform_moderate', { p_type: 'post', p_id: post.data.id, p_decision: 'approved', p_reason: 'e2e' })))
  const pubAfter = await anon.from('community_public_posts').select('*').eq('id', post.data.id)
  check('the approved review is public', pubAfter.data?.length === 1, pubAfter.error?.message)
  check('the public view carries no user id', pubAfter.data?.[0] && !('user_id' in pubAfter.data[0]))

  // ---- 5. Comment and like ------------------------------------------------------------------------------------------
  const cm = await b.c.from('community_comments').insert({ post_id: post.data.id, body: '좋은 정보 감사합니다. 저도 주말에 가 볼게요.' }).select('id,status').single()
  check('a member comments (pending)', !cm.error && ['pending', 'draft'].includes(cm.data.status), cm.error?.message)
  const lk = await b.c.from('community_likes').insert({ post_id: post.data.id, user_id: b.id })
  check('a member likes a review', !lk.error, lk.error?.message)
  const lk2 = await b.c.from('community_likes').insert({ post_id: post.data.id, user_id: a.id })
  check('a member cannot like in someone else\'s name', !!lk2.error, lk2.error?.message)
  const cmOther = await a.c.from('community_comments').delete().eq('id', cm.data?.id).select('id')
  check('a member cannot delete someone else\'s comment', !cmOther.error && cmOther.data.length === 0, cmOther.error?.message)
  const cm2 = await b.c.from('community_comments').insert({ post_id: post.data.id, body: '지울 댓글입니다. 시험용이에요.' }).select('id').single()
  const cmDel = await b.c.from('community_comments').delete().eq('id', cm2.data?.id).select('id')
  check('a member deletes their own comment', !cmDel.error && cmDel.data.length === 1, cmDel.error?.message)

  // ---- 6. Own content: edit and delete -----------------------------------------------------------------------------
  const own = await a.c.from('community_posts').insert({ kind: 'question', title: `${RUN} 질문`, body: '주차는 어디에 하면 되나요? 대중교통이 더 나을까요?', status: 'pending' }).select('id').single()
  const ed = await a.c.from('community_posts').update({ body: '주차는 어디에 하나요? 지하철역에서 걸어갈 만한가요?' }).eq('id', own.data.id).select('id')
  check('a member edits their own post', !ed.error && ed.data.length === 1, ed.error?.message)
  const other = await b.c.from('community_posts').update({ body: 'hijack' }).eq('id', own.data.id).select('id')
  check('a member cannot edit someone else\'s post', !other.error && other.data.length === 0, other.error?.message)
  const del = await a.c.from('community_posts').delete().eq('id', own.data.id).select('id')
  check('a member deletes their own post', !del.error && del.data.length === 1, del.error?.message)

  // ---- 7. Photo: private upload, staff grade, metadata removed, duplicate refused ----------------------------------
  const jpg = await tinyJpeg(1)
  const upPath = `${a.id}/${RUN}-ddp.jpg`
  const upl = await a.c.storage.from('community-uploads').upload(upPath, jpg, { contentType: 'image/jpeg' })
  check('a member uploads a photo to the private bucket', !upl.error, upl.error?.message)
  const peek = await b.c.storage.from('community-uploads').download(upPath)
  check('another member cannot read the private upload', !!peek.error)
  const peekAnon = await anon.storage.from('community-uploads').download(upPath)
  check('visitors cannot read the private upload', !!peekAnon.error)
  const photo = await a.c.from('community_photos').insert({ project_id: 'SEOUL006', upload_path: upPath, mime: 'image/jpeg', bytes: jpg.length, width: 1200, height: 800, caption: 'DDP 외벽', credit_name: 'E2E 앨리스', licence: 'cc-by-4.0', offer_official: true, own_photo: true, can_license: true, people_ok: true, artwork_rights_notice: true }).select('id,status').single()
  check('the photo record waits for staff', !photo.error && photo.data.status === 'pending', photo.error?.message)
  const noGrade = await fn('publish-photo', { photo_id: photo.data?.id }, st.token)
  check('publishing without a grade is refused', noGrade.status === 400 && noGrade.body?.error === 'grade_required', JSON.stringify(noGrade.body))
  const notStaff = await fn('publish-photo', { photo_id: photo.data?.id, grade: 'B' }, a.token)
  check('a member cannot publish photos', notStaff.status === 401 || notStaff.status === 403, notStaff.status)
  const pub = await fn('publish-photo', { photo_id: photo.data?.id, grade: 'B' }, st.token)
  check('staff publishes the photo with grade B', pub.status === 200 && pub.body?.ok, JSON.stringify(pub.body))
  if (pub.body?.public_path) created.files.push(['community-photos', pub.body.public_path])
  const pubFile = pub.body?.public_path ? await fetch(`${URL_}/storage/v1/object/public/community-photos/${pub.body.public_path}`) : null
  const pubBytes = pubFile?.ok ? Buffer.from(await pubFile.arrayBuffer()) : Buffer.alloc(0)
  check('the published file is public and its metadata is gone', pubFile?.ok && !pubBytes.includes(Buffer.from('GPS-E2E-')) && !pubBytes.includes(Buffer.from('Exif\0\0')), `HTTP ${pubFile?.status}, ${pubBytes.length} bytes`)
  const gone = await service.storage.from('community-uploads').download(upPath)
  check('the private original is deleted after publication', !!gone.error)
  const pubPhoto = await anon.from('community_public_photos').select('*').eq('id', photo.data?.id)
  check('the public photo list shows credit and grade, no user id', pubPhoto.data?.[0]?.credit === 'E2E 앨리스' && pubPhoto.data?.[0]?.grade === 'B' && !('user_id' in (pubPhoto.data?.[0] || {})), JSON.stringify(pubPhoto.data?.[0] || pubPhoto.error))
  const upPath2 = `${a.id}/${RUN}-copy.jpg`
  await a.c.storage.from('community-uploads').upload(upPath2, jpg, { contentType: 'image/jpeg' })
  const photo2 = await a.c.from('community_photos').insert({ project_id: 'SEOUL006', upload_path: upPath2, mime: 'image/jpeg', bytes: jpg.length, width: 1200, height: 800, licence: 'display', own_photo: true, can_license: true, people_ok: true, artwork_rights_notice: true }).select('id').single()
  const dup = await fn('publish-photo', { photo_id: photo2.data?.id, grade: 'B' }, st.token)
  check('the same file is never published twice', dup.status === 409 && dup.body?.error === 'duplicate_photo', JSON.stringify(dup.body))
  created.files.push(['community-uploads', upPath2])
  const steal = await fn('publish-photo', { photo_id: photo2.data?.id, action: 'withdraw' }, b.token)
  check('a member cannot withdraw someone else\'s photo', steal.status === 404, JSON.stringify(steal.body))
  const wd = await fn('publish-photo', { photo_id: photo2.data?.id, action: 'withdraw' }, a.token)
  const wdRow = await service.from('community_photos').select('id').eq('id', photo2.data?.id)
  const wdFile = await service.storage.from('community-uploads').download(upPath2)
  check('a member withdraws their own photo (record and upload removed)', wd.status === 200 && wdRow.data?.length === 0 && !!wdFile.error, `${wd.status} ${JSON.stringify(wd.body)}`)
  const takedown = await fn('publish-photo', { photo_id: photo.data?.id, action: 'remove', reason: 'e2e: 저작권 신고 확인' }, st.token)
  const afterTake = pub.body?.public_path ? await fetch(`${URL_}/storage/v1/object/public/community-photos/${pub.body.public_path}?t=${Date.now()}`) : null
  check('a copyright takedown removes the public file', takedown.status === 200 && afterTake && afterTake.status >= 400, `${takedown.status} ${afterTake?.status}`)

  // ---- 8. New project submission: draft, required fields, automatic checks, staff approval -------------------------
  const draft = await a.c.from('community_submissions').insert({ kind: 'new_project', name: `${RUN} 테스트 미디어파사드`, status: 'draft' }).select('id,status').single()
  check('a member saves an incomplete draft', !draft.error && draft.data.status === 'draft', draft.error?.message)
  const early2 = await a.c.from('community_submissions').update({ status: 'pending' }).eq('id', draft.data.id).select('id')
  check('submitting it without the required fields is refused', !!early2.error, early2.error?.message)
  const full = await a.c.from('community_submissions').update({ country_iso2: 'KR', city: '서울', project_type: 'media_facade', description: '테스트용 신규 사례 설명입니다. 건물 외벽에 매일 밤 영상이 상영됩니다.', official_url: 'https://example.org/e2e', status: 'pending' }).eq('id', draft.data.id).select('id,status').single()
  check('the completed submission is accepted for review', !full.error && full.data.status === 'pending', full.error?.message)
  const mq2 = await fn('moderate-queue', {}, null, { secret: CRON })
  const subAfter = await service.from('community_submissions').select('status,checks').eq('id', draft.data.id).single()
  check('the submission gets duplicate and link checks and waits for a person', mq2.status === 200 && subAfter.data?.status === 'needs_review' && subAfter.data?.checks?.links, `${subAfter.data?.status} ${JSON.stringify(subAfter.data?.checks || {}).slice(0, 120)}`)
  // v2.0: staff ask for more information; the author gets a draft back, completes it and submits again.
  check('staff ask for more information (the submission returns to the author as a draft)', !(await rpcErr(st.c, 'platform_moderate', { p_type: 'submission', p_id: draft.data.id, p_decision: 'needs_info', p_reason: 'e2e: 공식 출처를 하나 더 붙여 주세요' })))
  const back = await a.c.from('community_submissions').select('status,decision_reason').eq('id', draft.data.id).single()
  check('the author sees the request on their draft', back.data?.status === 'draft' && /공식 출처/.test(back.data?.decision_reason || ''), JSON.stringify(back.data))
  const again = await a.c.from('community_submissions').update({ source_urls: ['https://example.org/e2e-press'], status: 'pending' }).eq('id', draft.data.id).select('status').single()
  await fn('moderate-queue', {}, null, { secret: CRON })
  const reviewed = await service.from('community_submissions').select('status').eq('id', draft.data.id).single()
  check('the completed draft is submitted again and goes back to review', !again.error && reviewed.data?.status === 'needs_review', again.error?.message || reviewed.data?.status)
  // A photo sent with the new-project submission: private, no project id, cannot be published before approval.
  const subJpg = await tinyJpeg(77), subPath = `${a.id}/${RUN}-sub.jpg`
  await a.c.storage.from('community-uploads').upload(subPath, subJpg, { contentType: 'image/jpeg' })
  created.files.push(['community-uploads', subPath])
  const subPhoto = await a.c.from('community_photos').insert({ submission_id: draft.data.id, upload_path: subPath, mime: 'image/jpeg', bytes: subJpg.length, width: 1200, height: 800, licence: 'display', own_photo: true, can_license: true, people_ok: true, artwork_rights_notice: true }).select('id,project_id,status').single()
  check('a member attaches a photo to their submission (no project id yet)', !subPhoto.error && subPhoto.data.project_id === null, subPhoto.error?.message)
  const tooEarly = await fn('publish-photo', { photo_id: subPhoto.data?.id, grade: 'B' }, st.token)
  check('a new project\'s photo cannot be published before the submission is approved', tooEarly.status === 409 && tooEarly.body?.error === 'submission_not_approved', JSON.stringify(tooEarly.body))
  check('approving a new project needs a project id', /project/i.test(await rpcErr(st.c, 'platform_moderate', { p_type: 'submission', p_id: draft.data.id, p_decision: 'approved', p_reason: 'e2e' }) || ''))
  check('staff approves it with a project id', !(await rpcErr(st.c, 'platform_moderate', { p_type: 'submission', p_id: draft.data.id, p_decision: 'approved', p_reason: 'e2e', p_project: 'REG-CM-9999' })))
  const tied = await service.from('community_photos').select('project_id,status').eq('id', subPhoto.data?.id).single()
  check('on approval the submission\'s photo takes the new project id and still waits for a grade', tied.data?.project_id === 'REG-CM-9999' && tied.data?.status !== 'approved', JSON.stringify(tied.data))
  const subPub = await fn('publish-photo', { photo_id: subPhoto.data?.id, grade: 'B' }, st.token)
  if (subPub.body?.public_path) created.files.push(['community-photos', subPub.body.public_path])
  check('staff then publish it with a grade', subPub.status === 200 && /^REG-CM-9999\//.test(subPub.body?.public_path || ''), JSON.stringify(subPub.body))
  const subPublic = await anon.from('community_submissions').select('id').eq('id', draft.data.id)
  check('submissions are never public (not in search or the sitemap)', !!subPublic.error || subPublic.data.length === 0)

  // ---- 9. Report and appeal ----------------------------------------------------------------------------------------
  // Members file reports but never read them back (no RETURNING: the site's API inserts the same way).
  const fl = await b.c.from('content_flags').insert({ target_type: 'post', target_id: post.data.id, reason: 'spam', message: 'e2e 신고', reporter: b.id })
  check('a member reports content', !fl.error, fl.error?.message)
  const flRow = await service.from('content_flags').select('id').eq('target_type', 'post').eq('target_id', post.data.id).eq('reporter', b.id).single()
  const peekFlags = await b.c.from('content_flags').select('id')
  check('members cannot read reports', !!peekFlags.error || peekFlags.data.length === 0)
  check('staff handles the report', !(await rpcErr(st.c, 'flag_handle', { p_id: flRow.data?.id, p_action: 'dismissed', p_note: 'e2e' })))
  await rpcErr(st.c, 'platform_moderate', { p_type: 'comment', p_id: cm.data?.id, p_decision: 'rejected', p_reason: 'e2e: 반려 시험' })
  const ap = await b.c.from('moderation_appeals').insert({ target_type: 'comment', target_id: cm.data?.id, message: '반려 사유를 다시 봐 주세요. 광고가 아니라 후기였어요.' }).select('id').single()
  check('the author appeals a rejection', !ap.error, ap.error?.message)
  check('staff decides the appeal', !(await rpcErr(st.c, 'appeal_decide', { p_id: ap.data?.id, p_decision: 'reversed', p_note: 'e2e' })))

  // ---- 10. Researcher: apply, refused before approval, approved, download, revoke -----------------------------------
  const ds = `${RUN}-data`.toLowerCase().slice(0, 60)
  created.dataset = ds
  const must = (r, what) => { if (r.error) throw Error(`${what}: ${r.error.message}`); return r }
  must(await service.from('research_datasets').insert({ id: ds, title_ko: 'E2E 시험 데이터', tier: 'member', licence: 'CC BY 4.0', active: true }), 'test dataset')
  must(await service.from('research_dataset_versions').insert({ dataset_id: ds, version: '1.0.0', data_as_of: new Date().toISOString().slice(0, 10), record_count: 1, formats: ['csv'], storage_prefix: ds, citation: 'E2E test dataset' }), 'test dataset version')
  const csvPath = `${ds}/${ds}-1.0.0.csv`
  must(await service.storage.from('research-datasets').upload(csvPath, Buffer.from('id,name\nE2E,test\n'), { contentType: 'text/csv', upsert: true }), 'test file')
  created.files.push(['research-datasets', csvPath])
  const terms = (await service.from('platform_settings').select('value').eq('key', 'research_terms_version').single()).data?.value
  const before = await fn('research-download', { dataset: ds, version: '1.0.0', format: 'csv' }, a.token)
  check('signing in alone does not allow a research download', before.status === 403 && before.body?.error === 'researcher_approval_required', JSON.stringify(before.body))
  const app = await a.c.from('researcher_applications').insert({ full_name: 'E2E 앨리스', applicant_type: 'independent', research_field: '미디어 건축', purpose: '서울의 미디어파사드 분포를 연구하기 위한 데이터 이용 신청입니다.', requested_datasets: [ds], terms_version: terms, privacy_version: terms }).select('id,status').single()
  check('a member applies as a researcher', !app.error && app.data.status === 'submitted', app.error?.message)
  const selfApprove = await a.c.from('researcher_applications').update({ status: 'approved' }).eq('id', app.data?.id).select('status').single()
  check('the applicant cannot approve themselves', !!selfApprove.error || selfApprove.data?.status !== 'approved', selfApprove.error?.message || selfApprove.data?.status)
  check('staff approves the application for the dataset', !(await rpcErr(st.c, 'research_application_decide', { p_id: app.data?.id, p_decision: 'approved', p_reason: 'e2e', p_datasets: [ds] })))
  const dl = await fn('research-download', { dataset: ds, version: '1.0.0', format: 'csv' }, a.token)
  // On the local stack the functions see the API as http://kong:8000; on a real project the URL is already public.
  const file = dl.body?.url ? await fetch(String(dl.body.url).replace(/^http:\/\/kong:8000/, URL_)).catch((e) => ({ ok: false, text: async () => e.message })) : null
  check('the approved researcher gets a short signed URL to the private file', dl.status === 200 && file?.ok && (await file.text()).includes('E2E'), JSON.stringify(dl.body).slice(0, 160))
  const bobDl = await fn('research-download', { dataset: ds, version: '1.0.0', format: 'csv' }, b.token)
  check('a member without approval is refused', bobDl.status === 403, JSON.stringify(bobDl.body))
  const direct = await b.c.storage.from('research-datasets').download(csvPath)
  check('the private research bucket cannot be read directly', !!direct.error)
  const hist = await a.c.from('research_downloads').select('ok,dataset_id').eq('dataset_id', ds)
  check('the researcher sees their download history', !hist.error && hist.data.some((h) => h.ok), hist.error?.message || JSON.stringify(hist.data))
  // The operator's lists (admin with the second factor); filtered to this run's accounts, and only counts are reported.
  const list = await st.c.rpc('platform_member_list', { p_query: RUN, p_limit: 20 })
  check('the admin lists members (this run\'s accounts, with state and activity)', !list.error && list.data?.some((m) => m.email === a.email && m.researcher === 'approved'), list.error?.message || `${list.data?.length} rows`)
  const audit = await service.from('platform_audit_log').select('id').eq('action', 'member_list_viewed').eq('actor', st.id).contains('detail', { query: RUN })
  check('viewing the member list is written to the audit log', !audit.error && audit.data.length >= 1, audit.error?.message)
  check('a member cannot list members', !!(await rpcErr(b.c, 'platform_member_list', { p_query: RUN, p_limit: 5 })))
  const grants = await st.c.rpc('platform_research_grants', { p_limit: 50 }), dls = await st.c.rpc('platform_research_downloads', { p_limit: 50 })
  check('the admin sees research grants and the download log', !grants.error && grants.data.some((g) => g.dataset_id === ds && g.active) && !dls.error && dls.data.some((x) => x.dataset_id === ds && x.ok), grants.error?.message || dls.error?.message)
  const grant = await service.from('research_grants').select('id').eq('user_id', a.id).eq('dataset_id', ds).single()
  check('staff revokes the grant', !(await rpcErr(st.c, 'research_grant_revoke', { p_grant: grant.data?.id, p_reason: 'e2e' })))
  const afterRevoke = await fn('research-download', { dataset: ds, version: '1.0.0', format: 'csv' }, a.token)
  check('after revocation the next download is refused at once', afterRevoke.status === 403, JSON.stringify(afterRevoke.body))

  // ---- 11. Account deletion ----------------------------------------------------------------------------------------
  await signIn(a)
  const rm = await fn('delete-account', {}, a.token)
  check('a member deletes their account', rm.status === 200, JSON.stringify(rm.body))
  const ghost = await service.auth.admin.getUserById(a.id)
  check('the account is gone', !!ghost.error || !ghost.data?.user, ghost.error?.message)
  const leftovers = await service.from('community_posts').select('id').eq('user_id', a.id)
  check('their posts are gone', !leftovers.error && leftovers.data.length === 0)
  if (!ghost.error && ghost.data?.user) created.users.push(a.id); else created.users = created.users.filter((u) => u !== a.id)
  if (!MAILPIT) note('e-mail delivery', 'not checked on this project: open the inbox of a real address and confirm by its link once (docs/PLATFORM.md step 3)')
}

async function cleanup() {
  for (const [bucket, p] of created.files) await service.storage.from(bucket).remove([p]).catch(() => {})
  if (created.dataset) { await service.from('research_downloads').delete().eq('dataset_id', created.dataset); await service.from('research_grants').delete().eq('dataset_id', created.dataset); await service.from('research_dataset_versions').delete().eq('dataset_id', created.dataset); await service.from('research_datasets').delete().eq('id', created.dataset) }
  for (const id of created.users) {
    const { data } = await service.storage.from('community-uploads').list(id)
    if (data?.length) await service.storage.from('community-uploads').remove(data.map((f) => `${id}/${f.name}`))
    await service.from('app_admins').delete().eq('user_id', id)
    await service.auth.admin.deleteUser(id).catch(() => {})
  }
  await service.from('community_submissions').delete().like('name', `${RUN}%`)
}

let crashed = null
try { await main() } catch (e) { crashed = e; check('run completed without an exception', false, e?.message || String(e)) } finally { await cleanup() }
const failed = results.filter((r) => r.ok === false)
const report = { run: RUN, at: new Date().toISOString(), target: URL_.replace(/^https?:\/\//, ''), email_confirmation: MAILPIT ? 'confirmation e-mail link' : 'service key (e-mail not checked)', passed: results.filter((r) => r.ok).length, failed: failed.length, results }
if (env('E2E_REPORT')) writeFileSync(env('E2E_REPORT'), JSON.stringify(report, null, 1))
console.log(`\n${report.passed} passed, ${report.failed} failed${crashed ? ' (stopped early)' : ''} · run ${RUN}`)
process.exit(failed.length ? 1 : 0)
