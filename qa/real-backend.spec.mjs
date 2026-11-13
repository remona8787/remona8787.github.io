// v2.0 member site and operator console on a REAL Supabase backend, no mocks (docs/PLATFORM.md "9. 검증 상태"):
// sign-up in the site, the link in the real confirmation e-mail, a review, the automatic check, a staff member who
// enrols a TOTP factor in the console and approves the review, and the review on the public community page; at a phone
// and a desktop width. Skipped unless a backend is named:
//   AOL_REAL_SUPABASE_URL, AOL_REAL_PUBLISHABLE_KEY, AOL_REAL_SECRET_KEY (staff test user and clean-up),
//   AOL_REAL_CRON_SECRET (moderate-queue), AOL_REAL_MAILPIT_URL (the local stack's mail catcher),
//   AOL_TEST_URL (the site, with data/, at the Auth site_url so the confirmation link comes back to it).
// The site's Content-Security-Policy allows https://*.supabase.co; for a local backend (http://127.0.0.1) this test
// widens it in the pages it serves to itself, never in the build.
import { test, expect } from './fixtures.mjs'
import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { totp } from '../scripts/lib/totp.mjs'

const URL_ = process.env.AOL_REAL_SUPABASE_URL, PUB = process.env.AOL_REAL_PUBLISHABLE_KEY, SECRET = process.env.AOL_REAL_SECRET_KEY
const CRON = process.env.AOL_REAL_CRON_SECRET, MAILPIT = process.env.AOL_REAL_MAILPIT_URL
test.skip(!URL_ || !PUB || !SECRET || !CRON || !MAILPIT, 'no real backend configured (AOL_REAL_*)')
test.describe.configure({ mode: 'serial', timeout: 120000 })
// A local backend is a loopback address on another port, which Chromium's Local Network Access check refuses to a page;
// a real project (https://<ref>.supabase.co) is public and needs no flag.
test.use({ launchOptions: { executablePath: '/opt/pw-browsers/chromium', args: ['--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessRespectPreflightResults'] } })

const service = URL_ ? createClient(URL_, SECRET, { auth: { persistSession: false, autoRefreshToken: false } }) : null
const PASSWORD = 'Real!' + randomBytes(12).toString('base64url')
const users = []

async function wire(page) {
  const cfg = `window.AOL_CONFIG=Object.assign(window.AOL_CONFIG||{},{SUPABASE_URL:${JSON.stringify(URL_)},SUPABASE_PUBLISHABLE_KEY:${JSON.stringify(PUB)},PUBLIC_URL:location.origin});`
  await page.route('**/config.js', (r) => r.request().url().includes('/admin/') ? r.fulfill({ contentType: 'text/javascript', body: `window.AOL_ADMIN_CONFIG={SUPABASE_URL:${JSON.stringify(URL_)},SUPABASE_PUBLISHABLE_KEY:${JSON.stringify(PUB)}};` }) : r.fulfill({ contentType: 'text/javascript', body: cfg }))
  if (/^http:\/\//.test(URL_)) {
    const origin = new URL(URL_).origin, ws = origin.replace(/^http/, 'ws')
    await page.route('**/*', async (r) => {
      // Only the site's own pages: the Auth server's confirmation link must reach the browser as it is (a redirect).
      if (r.request().resourceType() !== 'document' || new URL(r.request().url()).origin === origin) return r.fallback()
      const res = await r.fetch(); const body = (await res.text()).replace("connect-src 'self'", `connect-src 'self' ${origin} ${ws}`).replace("img-src 'self' data: https:", `img-src 'self' data: https: ${origin}`)
      return r.fulfill({ response: res, body })
    })
  }
}
async function confirmationLink(email) {
  for (let i = 0; i < 30; i++) {
    const s = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent('to:' + email)}`)).json()
    const id = s.messages?.[0]?.ID
    if (id) { const m = await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json(); const l = (String(m.HTML || m.Text).match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/) || [])[0]; if (l) return l.replace(/&amp;/g, '&') }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw Error('no confirmation e-mail for ' + email)
}

for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
  test(`${label}: sign up, confirm by e-mail, write a review, staff enrols TOTP and approves it, the review is public`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await wire(page)
    const run = `${label}-${Date.now().toString(36)}`, email = `real-${run}@example.com`, title = `실서버 시험 후기 ${run}`
    // 1. Sign up in the site.
    await page.goto('/#account')
    await expect(page.locator('#cloudStatus')).toContainText('로그인 필요')
    const form = page.locator('#authForm')
    await form.getByLabel('이메일').fill(email)
    await form.getByLabel('비밀번호 (12자 이상)').fill(PASSWORD)
    await form.getByRole('button', { name: '회원가입' }).click()
    // The account appears on the server (the page shows a short notice; the server is the proof).
    let me = null
    await expect.poll(async () => { const { data } = await service.auth.admin.listUsers({ page: 1, perPage: 200 }); me = data.users.find((u) => u.email === email) || null; return !!me }, { timeout: 15000, message: 'sign-up reached the server: ' + (await page.locator('#accountMessage').textContent().catch(() => '')) }).toBe(true)
    expect(me, 'the account exists').toBeTruthy()
    users.push(me.id)
    expect(me.email_confirmed_at, 'not confirmed before the e-mail link').toBeFalsy()
    // 2. The link in the real confirmation e-mail.
    await page.goto(await confirmationLink(email))
    await page.waitForLoadState('networkidle')
    const { data: after } = await service.auth.admin.getUserById(me.id)
    expect(after.user.email_confirmed_at, 'confirmed by the e-mail link').toBeTruthy()
    // 3. Sign in (the link may already have signed in).
    await page.goto('/#account')
    // Wait until the page knows whether a session exists (signed out, or signed in and syncing).
    await expect(page.locator('#cloudStatus')).toHaveText(/로그인 필요|동기화|업로드 대기/)
    if (await page.locator('#authForm').count()) {
      await page.locator('#authForm').getByLabel('이메일').fill(email)
      await page.locator('#authForm').getByLabel('비밀번호 (12자 이상)').fill(PASSWORD)
      await page.locator('#authForm').getByRole('button', { name: '로그인' }).click()
    }
    await expect(page.locator('#cloudStatus, .account-hero h2').first()).toContainText(/@|동기화|연결/)
    // 4. A review in the community.
    await page.goto('/#community/write/SEOUL006')
    const w = page.locator('#pfWrite')
    await expect(w).toBeVisible()
    await w.locator('[name=title]').fill(title)
    await w.locator('[name=body]').fill('외벽 영상이 밤마다 바뀌어서 여러 번 가 봐도 좋았어요. 주말 저녁은 붐벼요.')
    await w.locator('button[value=pending]').click()
    await expect(page.locator('.form-message, #pfMsg').first()).toContainText(/검수|검토|review/i)
    const { data: post } = await service.from('community_posts').select('id,status').eq('title', title).single()
    expect(post.status).toBe('pending')
    // 5. The automatic check (what pg_cron calls every few minutes).
    const mq = await fetch(`${URL_}/functions/v1/moderate-queue`, { method: 'POST', headers: { 'x-aol-cron-secret': CRON, 'content-type': 'application/json' }, body: '{}' })
    expect(mq.status).toBe(200)
    expect((await service.from('community_posts').select('status').eq('id', post.id).single()).data.status).toBe('needs_review')
    // 6. A staff member enrols a TOTP factor in the console and approves the review.
    const staffEmail = `real-staff-${run}@example.com`
    const { data: su } = await service.auth.admin.createUser({ email: staffEmail, password: PASSWORD, email_confirm: true })
    users.push(su.user.id)
    await service.from('app_admins').upsert({ user_id: su.user.id, role: 'editor' })
    await page.goto('/admin/')
    await page.getByLabel('이메일').fill(staffEmail)
    await page.getByLabel('비밀번호').fill(PASSWORD)
    await page.getByRole('button', { name: '로그인' }).click()
    await expect(page.locator('#mfaView')).toBeVisible()
    await expect(page.locator('#mfaSecret')).toHaveText(/^[A-Z2-7]{16,}$/)
    const secret = (await page.locator('#mfaSecret').textContent()).trim()
    await page.getByLabel('인증 앱의 6자리 코드').fill(totp(secret))
    await page.getByRole('button', { name: '확인' }).click()
    await expect(page.locator('#nav')).toBeVisible()
    await page.goto('/admin/#platform')
    await page.locator('#platformBox').getByRole('button', { name: '글', exact: true }).click()
    const item = page.locator('.pf-item', { hasText: title })
    await expect(item).toBeVisible()
    await item.locator('[data-act="pf-mod"][data-d="approved"]').click()
    await expect.poll(async () => (await service.from('community_posts').select('status').eq('id', post.id).single()).data.status).toBe('approved')
    // 7. The review on the public community page.
    await page.goto('/#community')
    await expect(page.locator('.pf-card', { hasText: title })).toBeVisible()
  })
}

test.afterAll(async () => {
  if (!service) return
  for (const id of users) { await service.from('app_admins').delete().eq('user_id', id); await service.auth.admin.deleteUser(id).catch(() => {}) }
})
