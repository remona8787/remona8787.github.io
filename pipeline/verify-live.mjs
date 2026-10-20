#!/usr/bin/env node
// Live verification: job "verify-live" of archive.yml (docs/STATIC_ARCHIVE.md, operations in docs/PIPELINE.md).
//  1. Waits until the live site serves this deploy: /deploy.json has the deploy id and /data/manifest.json the
//     build id (cache-busting queries; GitHub Pages usually needs a minute or two after the push).
//  2. Opens home, explore, map, a detail page, the data page and the admin page at 390×844 (mobile) and 1440×900, each
//     in a fresh browser context (cold cache, service workers blocked, so the numbers are what a first visit costs).
//  3. Records per page: HTTP status, console errors, page errors, failed requests, HTTP errors, Largest Contentful
//     Paint, navigation timings, transfer sizes (total, by resource type, the data/ files fetched), broken images and
//     any internal review vocabulary visible on a public screen; saves a JPEG screenshot.
//  4. Writes <out>/report.json and <out>/<viewport>-<page>.jpg (the job commits them to the data branch: review/live/).
//
// CLI: node pipeline/verify-live.mjs --site=https://remona8787.github.io/ --out=<dir> [--build-id=<id>] [--deploy-id=<id>]
//        [--wait-minutes=15] [--strict]
// Exit 1 when the deploy never appeared or a page did not load; with --strict also on console errors, failed
// requests or internal vocabulary.
import path from 'node:path'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
]
/** Public screens may never show these (docs/STATIC_ARCHIVE.md "Consumer UI rules"). */
export const INTERNAL_TERMS = ['재확인 시점 경과', '확인 기록 있음', '검토 목록', '편집 검수', '자동 수집·미검수', '미검수', '동기화 상태', 'needs_review', 'field_state']

export function screens(detailId) {
  return [
    { name: 'home', path: '', public: true },
    { name: 'explore', path: '#explore', public: true },
    { name: 'map', path: '#map', public: true, map: true },
    ...(detailId ? [{ name: 'detail', path: '#place/' + encodeURIComponent(detailId), public: true }] : []),
    { name: 'data', path: '#data', public: true },
    { name: 'admin', path: 'admin/', public: false },
  ]
}

/** The project shown on the detail screen: a hero project, else a featured one, else the first index row. */
export function pickDetail(home, index) {
  const hero = home?.hero?.[0]?.project
  if (typeof hero === 'string') return hero
  const featured = home?.featured?.[0]
  if (typeof featured === 'string') return featured
  const row = index?.rows?.[0]
  return Array.isArray(row) && typeof row[0] === 'string' ? row[0] : null
}

const withSlash = (site) => (String(site).endsWith('/') ? String(site) : String(site) + '/')

/**
 * Polls the live deploy.json and manifest until they name this deploy (and dataset).
 * @param {{site: string, buildId?: string|null, deployId?: string|null, fetch?: typeof fetch, sleep?: (ms: number) => Promise<void>,
 *   clock?: () => number, timeoutMs?: number, intervalMs?: number}} o
 */
export async function waitForDeploy({ site, buildId = null, deployId = null, fetch = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), clock = Date.now, timeoutMs = 15 * 60e3, intervalMs = 15e3 }) {
  const t0 = clock()
  const base = withSlash(site)
  let attempts = 0, last = { deploy: null, manifest: null, error: null }
  const get = async (rel) => {
    const res = await fetch(new URL(rel + '?t=' + clock() + '-' + attempts, base).href, { headers: { 'cache-control': 'no-cache' }, redirect: 'follow' })
    if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`)
    return res.json()
  }
  for (;;) {
    attempts++
    try {
      const deploy = deployId ? await get('deploy.json') : null
      const manifest = buildId ? await get('data/manifest.json') : await get('data/manifest.json').catch(() => null)
      last = { deploy, manifest, error: null }
      const deployOk = !deployId || deploy?.deploy_id === deployId
      const buildOk = !buildId || manifest?.build_id === buildId
      if (deployOk && buildOk) return { ok: true, waited_ms: clock() - t0, attempts, live: summarizeLive(deploy, manifest) }
      last.error = `live deploy ${deploy?.deploy_id ?? '-'} / build ${manifest?.build_id ?? '-'}, waiting for ${deployId ?? '-'} / ${buildId ?? '-'}`
    } catch (e) { last.error = String(e?.message || e).slice(0, 300) }
    if (clock() - t0 + intervalMs > timeoutMs) return { ok: false, waited_ms: clock() - t0, attempts, live: summarizeLive(last.deploy, last.manifest), error: last.error }
    await sleep(intervalMs)
  }
}

function summarizeLive(deploy, manifest) {
  return {
    deploy_id: deploy?.deploy_id ?? null, deployed_at: deploy?.at ?? null, source: deploy?.source ?? null, dataset: deploy?.dataset ?? null,
    build_id: manifest?.build_id ?? null, generated_at: manifest?.generated_at ?? null, counts: manifest?.counts ? { projects: manifest.counts.projects, with_images: manifest.counts.with_images, with_hero: manifest.counts.with_hero } : null,
  }
}

const LCP_SCRIPT = `(() => {
  window.__aolLcp = null;
  try {
    new PerformanceObserver((list) => {
      const e = list.getEntries().at(-1);
      if (e) window.__aolLcp = { ms: Math.round(e.startTime), size: e.size, element: e.element ? e.element.tagName.toLowerCase() + (e.element.className && typeof e.element.className === 'string' ? '.' + e.element.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') : null, url: e.url ? String(e.url).slice(0, 300) : null };
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
})()`

/** Opens one screen in a fresh context and measures it. */
async function measure(browser, base, screen, vp, outDir, { settleMs = 1500 } = {}) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.deviceScaleFactor, isMobile: vp.isMobile, hasTouch: vp.hasTouch, serviceWorkers: 'block', locale: 'ko-KR' })
  await context.addInitScript(LCP_SCRIPT)
  const page = await context.newPage()
  const r = { page: screen.name, viewport: vp.name, url: new URL(screen.path, base).href, status: null, ok: false, title: null, console_errors: [], page_errors: [], failed_requests: [], http_errors: [], lcp: null, timings: null, transfer: { total_bytes: 0, requests: 0, by_type: {} }, data_files: [], broken_images: 0, internal_terms: [], screenshot: null, error: null }
  page.on('console', (m) => { if (m.type() === 'error' && r.console_errors.length < 50) r.console_errors.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => { if (r.page_errors.length < 20) r.page_errors.push(String(e?.message || e).slice(0, 300)) })
  page.on('requestfailed', (q) => { if (r.failed_requests.length < 50) r.failed_requests.push({ url: q.url().slice(0, 300), type: q.resourceType(), failure: q.failure()?.errorText ?? null }) })
  page.on('response', (s) => { if (s.status() >= 400 && r.http_errors.length < 50) r.http_errors.push({ url: s.url().slice(0, 300), status: s.status() }) })
  const sizes = []
  page.on('requestfinished', (q) => {
    sizes.push((async () => {
      let bytes = 0
      try { const s = await q.sizes(); bytes = Math.max(0, s.responseBodySize) + Math.max(0, s.responseHeadersSize) } catch {}
      r.transfer.total_bytes += bytes
      r.transfer.requests++
      const t = q.resourceType()
      r.transfer.by_type[t] = (r.transfer.by_type[t] || 0) + bytes
      const u = new URL(q.url())
      if (u.origin === new URL(base).origin && /\/data\/.+\.json$/.test(u.pathname)) r.data_files.push({ path: u.pathname.slice(new URL(base).pathname.length), bytes })
    })())
  })
  try {
    const res = await page.goto(r.url, { waitUntil: 'load', timeout: 60e3 })
    r.status = res?.status() ?? null
    await page.waitForLoadState('networkidle', { timeout: 15e3 }).catch(() => {})
    await page.waitForTimeout(settleMs)
    r.lcp = await page.evaluate(() => window.__aolLcp).catch(() => null)
    r.timings = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return n ? { ttfb_ms: Math.round(n.responseStart), dom_content_loaded_ms: Math.round(n.domContentLoadedEventEnd), load_ms: Math.round(n.loadEventEnd) } : null }).catch(() => null)
    if (screen.map) {
      const button = page.locator('[data-load-map]').first()
      if (await button.count().catch(() => 0)) { await button.click({ timeout: 5000 }).catch(() => {}); await page.waitForLoadState('networkidle', { timeout: 15e3 }).catch(() => {}); await page.waitForTimeout(settleMs) }
    }
    r.title = await page.title().catch(() => null)
    r.broken_images = await page.evaluate(() => [...document.images].filter((i) => i.complete && i.currentSrc && i.naturalWidth === 0).length).catch(() => 0)
    if (screen.public) {
      const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '')
      r.internal_terms = INTERNAL_TERMS.filter((t) => text.includes(t))
    }
    const file = `${vp.name}-${screen.name}.jpg`
    await page.screenshot({ path: path.join(outDir, file), type: 'jpeg', quality: 60, fullPage: false })
    r.screenshot = file
    r.ok = r.status !== null && r.status < 400
  } catch (e) {
    r.error = String(e?.message || e).slice(0, 300)
  } finally {
    await Promise.all(sizes)
    r.data_files.sort((a, b) => (a.path < b.path ? -1 : 1))
    await context.close().catch(() => {})
  }
  return r
}

export function summarize(pages) {
  const sum = (f) => pages.reduce((n, p) => n + f(p), 0)
  const lcps = pages.filter((p) => p.lcp?.ms != null)
  return {
    pages: pages.length,
    loaded: pages.filter((p) => p.ok).length,
    console_errors: sum((p) => p.console_errors.length + p.page_errors.length),
    failed_requests: sum((p) => p.failed_requests.length),
    http_errors: sum((p) => p.http_errors.length),
    broken_images: sum((p) => p.broken_images),
    internal_terms: [...new Set(pages.flatMap((p) => p.internal_terms))],
    max_lcp_ms: lcps.length ? Math.max(...lcps.map((p) => p.lcp.ms)) : null,
    lcp_ms: Object.fromEntries(lcps.map((p) => [`${p.viewport}-${p.page}`, p.lcp.ms])),
    transfer_bytes: Object.fromEntries(pages.map((p) => [`${p.viewport}-${p.page}`, p.transfer.total_bytes])),
    // The home page's first paint needs home.json only: index.json and the shards are loaded lazily elsewhere.
    home_loads_index: pages.some((p) => p.page === 'home' && p.data_files.some((d) => /(^|\/)data\/(index\.json|projects\/)/.test(d.path))),
  }
}

/**
 * The whole verification. Returns the report (also written to <outDir>/report.json).
 * @param {{site: string, outDir: string, buildId?: string|null, deployId?: string|null, waitMinutes?: number, chromium?: any, fetch?: typeof fetch, log?: (s: string) => void}} o
 */
export async function verifyLive({ site, outDir, buildId = null, deployId = null, waitMinutes = 15, chromium = null, fetch = globalThis.fetch, log = () => {} }) {
  const base = withSlash(site)
  const startedAt = new Date().toISOString()
  await mkdir(outDir, { recursive: true })
  for (const f of await readdir(outDir)) if (/\.(jpe?g|png)$/i.test(f)) await rm(path.join(outDir, f), { force: true })
  log(`waiting for deploy ${deployId ?? '-'} / build ${buildId ?? '-'} on ${base}`)
  const wait = await waitForDeploy({ site: base, buildId, deployId, fetch, timeoutMs: waitMinutes * 60e3 })
  log(wait.ok ? `live after ${Math.round(wait.waited_ms / 1000)} s` : `not live: ${wait.error}`)
  let pages = [], detailId = null
  if (wait.ok) {
    const json = async (rel) => { try { const r = await fetch(new URL(rel + '?t=' + Date.now(), base).href); return r.ok ? await r.json() : null } catch { return null } }
    detailId = pickDetail(await json('data/home.json'), null) || pickDetail(null, await json('data/index.json'))
    if (!chromium) ({ chromium } = await import('playwright').catch(() => import('@playwright/test')))
    const browser = await chromium.launch()
    try {
      for (const vp of VIEWPORTS) for (const s of screens(detailId)) {
        const r = await measure(browser, base, s, vp, outDir)
        log(`${vp.name} ${s.name}: ${r.ok ? 'ok' : 'FAILED ' + (r.error || r.status)} lcp ${r.lcp?.ms ?? '-'} ms, ${Math.round(r.transfer.total_bytes / 1024)} KB, ${r.console_errors.length + r.page_errors.length} console errors, ${r.failed_requests.length} failed requests`)
        pages.push(r)
      }
    } finally { await browser.close().catch(() => {}) }
  }
  const summary = summarize(pages)
  const report = {
    schema: 1, site: base, started_at: startedAt, finished_at: new Date().toISOString(),
    expected: { build_id: buildId, deploy_id: deployId }, wait, detail_project: detailId,
    viewports: VIEWPORTS.map(({ name, width, height, deviceScaleFactor }) => ({ name, width, height, device_scale_factor: deviceScaleFactor })),
    summary: { ...summary, ok: wait.ok && pages.length > 0 && summary.loaded === pages.length },
    pages,
  }
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1) + '\n')
  return report
}

function args(argv) {
  const out = {}
  for (const a of argv) { const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a); if (m) out[m[1]] = m[2] ?? true }
  return out
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const a = args(process.argv.slice(2))
  if (!a.site || !a.out) { console.error('usage: node pipeline/verify-live.mjs --site=<url> --out=<dir> [--build-id=] [--deploy-id=] [--wait-minutes=15] [--strict]'); process.exit(2) }
  try {
    const r = await verifyLive({ site: a.site, outDir: path.resolve(a.out), buildId: a['build-id'] || null, deployId: a['deploy-id'] || null, waitMinutes: Number(a['wait-minutes'] || 15), log: (s) => console.log('[verify-live] ' + s) })
    const s = r.summary
    console.log(`[verify-live] ${s.ok ? 'ok' : 'FAILED'}: ${s.loaded}/${s.pages} pages, ${s.console_errors} console errors, ${s.failed_requests} failed requests, max LCP ${s.max_lcp_ms ?? '-'} ms`)
    const strictFail = a.strict && (s.console_errors || s.failed_requests || s.internal_terms.length)
    if (!s.ok || strictFail) process.exitCode = 1
  } catch (e) {
    console.error('[verify-live] failed:', e?.stack || e)
    process.exitCode = 1
  }
}
