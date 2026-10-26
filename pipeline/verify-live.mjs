#!/usr/bin/env node
// Live verification: job "verify-live" of archive.yml (docs/STATIC_ARCHIVE.md, operations in docs/PIPELINE.md).
//  1. Waits until the live site serves this deploy: /deploy.json has the deploy id and /data/manifest.json the
//     build id (cache-busting queries; GitHub Pages usually needs a minute or two after the push).
//  2. Opens home, explore, map, a detail page (and the regression pages, #place/SEOUL006), the data page and the admin
//     page at 390×844 (mobile) and 1440×900, each
//     in a fresh browser context (cold cache, service workers blocked, so the numbers are what a first visit costs).
//  3. Records per page: HTTP status, console errors, page errors, failed requests, HTTP errors, Largest Contentful
//     Paint, navigation timings, transfer sizes (total, by resource type, the data/ files fetched), broken images and
//     any internal review vocabulary visible on a public screen; saves a JPEG screenshot.
//  4. Checks that the internal admin data is not on the site (/data/admin/report.json must not be served, v0.18) and
//     reads the rendition width of the home page's largest image (a hero must not be a 500 px thumbnail).
//  5. Writes <out>/report.json and <out>/<viewport>-<page>.jpg (the job commits them to the data branch: review/live/).
//
// CLI: node pipeline/verify-live.mjs --site=https://remona8787.github.io/ --out=<dir> [--build-id=<id>] [--deploy-id=<id>]
//        [--wait-minutes=15] [--strict]
// Exit 1 when the deploy never appeared or a page did not load; with --strict also on a portrait or unverified image
// in a gallery (summary.gallery_forbidden), console errors, failed
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

/** Detail pages checked on every run besides the rotating one: regressions of the live reviews (SEOUL006, DDP). */
export const REGRESSION_PAGES = ['SEOUL006']

export function screens(detailId, { regression = REGRESSION_PAGES } = {}) {
  return [
    { name: 'home', path: '', public: true },
    { name: 'explore', path: '#explore', public: true },
    { name: 'map', path: '#map', public: true, map: true },
    ...(detailId ? [{ name: 'detail', path: '#place/' + encodeURIComponent(detailId), public: true, project: detailId }] : []),
    ...regression.filter((id) => id !== detailId).map((id) => ({ name: 'place-' + id, path: '#place/' + encodeURIComponent(id), public: true, project: id })),
    { name: 'data', path: '#data', public: true },
    { name: 'admin', path: 'admin/', public: false },
  ]
}

/** A comparable key of an image URL: the Commons file name of an original or a rendition, else the URL without query. */
export function imageKey(url) {
  const s = String(url || '').split('#')[0]
  const m = /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/[a-z-]+\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/.exec(s)
  if (m) { try { return 'commons:' + decodeURIComponent(m[1]) } catch { return 'commons:' + m[1] } }
  return s.split('?')[0]
}

/**
 * Which of a record's images a page shows (from the page's image URLs): their count, providers and kinds, and any image
 * of a kind that must never be in a gallery (artist_portrait, unverified) or that the record does not have.
 */
export function galleryCheck(urls, record) {
  const byKey = new Map()
  const add = (img, where) => { for (const u of [img.src, img.thumb, ...(img.display || []).map((d) => d[1])]) if (u) byKey.set(imageKey(u), { img, where }) }
  for (const i of record?.images || []) add(i, 'images')
  for (const c of record?.credits || []) if (c.portrait) add(c.portrait, 'credit')
  const shown = new Map()
  const unknown = []
  for (const u of urls) {
    const k = imageKey(u)
    const hit = byKey.get(k)
    if (hit) shown.set(hit.img.id, hit)
    else if (/wikimedia\.org|staticflickr|openverse|visitkorea|unsplash|pexels/.test(String(u))) unknown.push(String(u).slice(0, 200))
  }
  const list = [...shown.values()]
  const tally = (f) => list.reduce((o, x) => { const k = f(x); o[k] = (o[k] || 0) + 1; return o }, {})
  return {
    project: record?.id ?? null, record_images: (record?.images || []).length, shown: list.length,
    providers: tally((x) => x.img.provider), kinds: tally((x) => x.img.kind || 'none'),
    artist_portrait_visible: list.filter((x) => x.img.kind === 'artist_portrait').map((x) => x.img.id),
    unverified_visible: list.filter((x) => x.img.kind === 'unverified' || (x.img.provider !== 'commons' && x.img.identity?.ok !== true)).map((x) => x.img.id),
    not_in_record: unknown.slice(0, 20),
  }
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
    if (screen.project) r.page_images = await page.evaluate(() => [...document.images].map((i) => i.currentSrc || i.src).filter(Boolean)).catch(() => [])
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

/** The pixel width of an image URL's rendition when the URL names it (Commons "/<w>px-", Flickr size suffixes). */
export function renditionWidth(url) {
  const s = String(url || '')
  const commons = /\/(\d{2,5})px-[^/?#]+(?:[?#]|$)/.exec(s)
  if (commons) return Number(commons[1])
  const flickr = /staticflickr\.com\/.+_([mnzcbhk]|3k|4k|5k|6k)\.jpe?g/i.exec(s)
  return flickr ? { m: 500, n: 320, z: 640, c: 800, b: 1024, h: 1600, k: 2048, '3k': 3072, '4k': 4096, '5k': 5120, '6k': 6144 }[flickr[1].toLowerCase()] : null
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
    // The rendition width of the largest image on the home page per viewport (null when the URL does not name one).
    home_lcp_image_px: Object.fromEntries(pages.filter((p) => p.page === 'home' && p.lcp?.url).map((p) => [p.viewport, renditionWidth(p.lcp.url)])),
    // Detail and regression pages: images shown, providers, and images that must never be in a gallery (should be 0).
    galleries: Object.fromEntries(pages.filter((p) => p.gallery).map((p) => [`${p.viewport}-${p.page}`, { project: p.gallery.project, shown: p.gallery.shown, providers: p.gallery.providers, kinds: p.gallery.kinds }])),
    gallery_forbidden: pages.reduce((n, p) => n + (p.gallery ? p.gallery.artist_portrait_visible.length + p.gallery.unverified_visible.length : 0), 0),
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
  let pages = [], detailId = null, adminPublic = null
  if (wait.ok) {
    const json = async (rel) => { try { const r = await fetch(new URL(rel + '?t=' + Date.now(), base).href); return r.ok ? await r.json() : null } catch { return null } }
    // Internal data must not be on the public site (it stays on the data branch).
    try { adminPublic = (await fetch(new URL('data/admin/report.json?t=' + Date.now(), base).href)).ok } catch { adminPublic = null }
    if (adminPublic) log('data/admin/report.json is served: internal data is public')
    detailId = pickDetail(await json('data/home.json'), null) || pickDetail(null, await json('data/index.json'))
    if (!chromium) ({ chromium } = await import('playwright').catch(() => import('@playwright/test')))
    // The records of the detail and regression pages (their shard, from index.json): what their galleries may show.
    const index = await json('data/index.json')
    const records = new Map()
    for (const id of [detailId, ...REGRESSION_PAGES].filter(Boolean)) {
      const row = index?.rows?.find((x) => x[index.fields.indexOf('id')] === id)
      const shard = row ? row[index.fields.indexOf('shard')] : null
      const data = shard ? await json(`data/projects/${shard}.json`) : null
      const rec = data?.projects?.find((x) => x.id === id)
      if (rec) records.set(id, rec)
    }
    const browser = await chromium.launch()
    try {
      for (const vp of VIEWPORTS) for (const s of screens(detailId)) {
        const r = await measure(browser, base, s, vp, outDir)
        if (s.project) { r.gallery = galleryCheck(r.page_images || [], records.get(s.project) || null); delete r.page_images }
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
    summary: { ...summary, admin_data_public: adminPublic, ok: wait.ok && pages.length > 0 && summary.loaded === pages.length && adminPublic !== true },
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
    const strictFail = a.strict && (s.console_errors || s.failed_requests || s.internal_terms.length || s.gallery_forbidden)
    if (!s.ok || strictFail) process.exitCode = 1
  } catch (e) {
    console.error('[verify-live] failed:', e?.stack || e)
    process.exitCode = 1
  }
}
