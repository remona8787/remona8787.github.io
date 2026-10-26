// Deploy readiness for a static host without custom headers (GitHub Pages, https://remona8787.github.io/):
// scripts/build.mjs with SITE_URL (and without it), into temporary directories so dist/ is left alone. Checks the site
// URL in config, robots, sitemap and the canonical/og: URLs (never the Supabase keys), the Content-Security-Policy
// meta tag of every page (= _headers minus frame-ancestors, and = vercel.json), .nojekyll, 404.html and sw.js at the site
// root, and one version number everywhere.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import vm from 'node:vm'

const run = promisify(execFile)
const root = path.resolve(import.meta.dirname, '..')
const read = (/** @type {string} */ f) => readFile(path.join(root, f), 'utf8')
const SITE = 'https://remona8787.github.io'
/** @type {string[]} */
const temp = []
async function build(/** @type {Record<string, string>} */ env = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'aol-build-'))
  temp.push(dir)
  const out = path.join(dir, 'dist')
  const { SITE_URL: _drop, ...base } = process.env
  await run(process.execPath, [path.join(root, 'scripts/build.mjs'), '--out=' + out], { cwd: root, env: { ...base, ...env } })
  return out
}
const config = (/** @type {string} */ js) => { const ctx = { window: /** @type {any} */ ({}) }; vm.runInNewContext(js, ctx); return ctx.window.AOL_CONFIG }
const pages = async (/** @type {string} */ dir) => (await readdir(dir, { recursive: true })).filter((f) => f.endsWith('.html')).sort()
const headerPolicy = async () => {
  const headers = await read('site-public-cleared/_headers')
  const block = headers.split(/\n(?=\S)/).find((b) => b.startsWith('/*\n'))
  return /** @type {string} */ (block?.match(/^\s+Content-Security-Policy:\s*(.+)$/m)?.[1].trim())
}

/** @type {string} */
let out
test.before(async () => { out = await build({ SITE_URL: SITE + '/' }) })
test.after(async () => { for (const d of temp) await rm(d, { recursive: true, force: true }) })

test('SITE_URL goes into config.js PUBLIC_URL, config.example.js, robots.txt, sitemap.xml and the canonical/og: URLs; the Supabase keys stay', async () => {
  for (const name of ['config.js', 'config.example.js']) {
    const source = config(await read('site-public-cleared/' + name)), built = config(await readFile(path.join(out, name), 'utf8'))
    assert.equal(built.PUBLIC_URL, SITE, name + ': a trailing slash is dropped')
    assert.deepEqual({ ...built, PUBLIC_URL: null }, { ...source, PUBLIC_URL: null }, name + ': nothing else changes')
    assert.deepEqual([built.SUPABASE_URL, built.SUPABASE_PUBLISHABLE_KEY], [source.SUPABASE_URL, source.SUPABASE_PUBLISHABLE_KEY])
  }
  const robots = await readFile(path.join(out, 'robots.txt'), 'utf8')
  assert.match(robots, new RegExp(`^Sitemap: ${SITE}/sitemap\\.xml$`, 'm'))
  assert.match(robots, /^Disallow: \/admin\/$/m)
  const locs = [...(await readFile(path.join(out, 'sitemap.xml'), 'utf8')).matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1])
  assert.deepEqual(locs, ['/', '/about.html', '/privacy.html', '/terms.html', '/support.html', '/delete-account.html', '/partner.html'].map((p) => SITE + p))
  for (const p of locs.slice(1)) assert.ok((await stat(path.join(out, new URL(p).pathname))).isFile(), p)
  const index = await readFile(path.join(out, 'index.html'), 'utf8')
  assert.match(index, new RegExp(`<link rel="canonical" href="${SITE}/">`))
  assert.match(index, new RegExp(`<meta property="og:url" content="${SITE}/">`))
  assert.match(index, new RegExp(`<meta property="og:image" content="${SITE}/assets/og-image.png">`))
  // The previous host is gone from every text file.
  const old = new URL(config(await read('site-public-cleared/config.js')).PUBLIC_URL).host
  for (const f of (await readdir(out, { recursive: true })).filter((f) => /\.(html|js|css|txt|xml|json|webmanifest|md)$/.test(f))) {
    assert.ok(!(await readFile(path.join(out, f), 'utf8')).includes(old), f)
  }
})

test('without SITE_URL the build keeps the current PUBLIC_URL; SITE_URL must be an https site root', async () => {
  const dflt = await build()
  const current = config(await read('site-public-cleared/config.js')).PUBLIC_URL
  assert.equal(config(await readFile(path.join(dflt, 'config.js'), 'utf8')).PUBLIC_URL, current)
  assert.match(await readFile(path.join(dflt, 'robots.txt'), 'utf8'), new RegExp(`Sitemap: ${current}/sitemap.xml`))
  for (const bad of ['http://remona8787.github.io', 'https://remona8787.github.io/app', 'https://remona8787.github.io/?x=1', 'remona8787.github.io']) {
    await assert.rejects(build({ SITE_URL: bad }), /SITE_URL/, bad)
  }
})

test('every built page carries the _headers Content-Security-Policy (minus frame-ancestors) right after <meta charset>', async () => {
  const policy = await headerPolicy()
  assert.ok(policy, '_headers has a CSP for /*')
  const directives = policy.split(';').map((d) => d.trim()).filter(Boolean)
  assert.ok(directives.some((d) => d === "frame-ancestors 'self'"))
  const expected = directives.filter((d) => !d.startsWith('frame-ancestors')).join('; ')
  // /data/*.json of the static archive is same-origin: connect-src 'self' covers it.
  assert.ok(directives.find((d) => d.startsWith('connect-src '))?.split(/\s+/).includes("'self'"))
  const list = await pages(out)
  assert.deepEqual(list, ['404.html', 'about.html', 'admin/index.html', 'delete-account.html', 'index.html', 'partner.html', 'privacy.html', 'support.html', 'terms.html'])
  for (const f of list) {
    const html = await readFile(path.join(out, f), 'utf8')
    const metas = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g)]
    assert.equal(metas.length, 1, f)
    assert.equal(metas[0][1], expected, f)
    assert.ok(html.includes(`<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${expected}">`), f + ': right after <meta charset>')
    assert.ok(html.indexOf('http-equiv="Content-Security-Policy"') < Math.min(...['<script', '<link', '<style'].map((t) => html.indexOf(t)).filter((i) => i >= 0)), f + ': before any resource')
    // A meta policy cannot allow what the page needs inline: no inline scripts or handlers.
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, f + ': inline script')
    assert.doesNotMatch(html, /\son[a-z]+="/i, f + ': inline event handler')
  }
  // The other host configuration says the same.
  const vercel = JSON.parse(await read('site-public-cleared/vercel.json'))
  const csp = vercel.headers.find((/** @type {any} */ h) => h.source === '/(.*)').headers.find((/** @type {any} */ h) => h.key === 'Content-Security-Policy').value
  assert.equal(csp, policy, 'vercel.json = _headers')
})

test('GitHub Pages: .nojekyll; 404.html works at any depth and sw.js at the site root', async () => {
  assert.equal((await stat(path.join(out, '.nojekyll'))).size, 0)
  const notFound = await readFile(path.join(out, '404.html'), 'utf8')
  const refs = [...notFound.matchAll(/\s(?:href|src)="([^"]*)"/g)].map((m) => m[1])
  assert.ok(refs.length > 10)
  for (const r of refs) assert.match(r, /^(\/|#|https:\/\/)/, `404.html: ${r} must be root-absolute (GitHub Pages serves it for any missing path)`)
  for (const r of refs.filter((r) => r.startsWith('/') && !r.startsWith('//'))) {
    const p = r.replace(/[#?].*$/, '')
    assert.ok((await stat(path.join(out, p.endsWith('/') ? p + 'index.html' : p))).isFile(), r)
  }
  const index = await readFile(path.join(out, 'index.html'), 'utf8')
  // The root page loads its scripts page-relative, so they resolve at the site root.
  for (const [, src] of index.matchAll(/<script[^>]*\ssrc="([^"]*)"/g)) { assert.match(src, /^\.\//, src); assert.ok((await stat(path.join(out, src))).isFile(), src) }
  assert.match(await readFile(path.join(out, 'app.js'), 'utf8'), /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/, 'registered from the root page: scope /')
  const sw = await readFile(path.join(out, 'sw.js'), 'utf8')
  assert.match(sw, /const CACHE='aol-[0-9a-f]{12}';/)
  const assets = JSON.parse(/** @type {string} */ (sw.match(/const ASSETS=(\[[^\]]*\]);/)?.[1]).replace(/'/g, '"'))
  for (const a of assets) {
    assert.match(a, /^\.\//, 'scope-relative')
    assert.ok((await stat(path.join(out, a))).isFile(), a)
  }
  assert.match(sw, /new URL\('index\.html',scopeURL\)/, 'offline navigation falls back to the root page')
})

test('one version number: package.json, package-lock.json, VERSION.json, the shell label and the legal pages', async () => {
  const pkg = JSON.parse(await read('package.json')), lock = JSON.parse(await read('package-lock.json')), version = JSON.parse(await read('VERSION.json'))
  const v = pkg.version
  assert.equal(v, '0.18.0')
  assert.deepEqual([lock.version, lock.packages[''].version, version.version], [v, v, v])
  assert.ok((await read('site-public-cleared/index.html')).includes(`<span class="version" data-i18n="shell.version">빛의 건축 v${v}</span>`))
  for (const page of ['privacy.html', 'terms.html', 'support.html', 'delete-account.html']) assert.match(await read('site-public-cleared/' + page), new RegExp(`버전 ${v.replace(/\./g, '\\.')}\\b`), page)
  // The app reads the label; no other copy of the number.
  assert.doesNotMatch(await read('site-public-cleared/app.js'), /['"]0\.1\d\.\d['"]/)
  assert.match(await read('README.md'), new RegExp(`^# 최신 버전: v${v.replace(/\./g, '\\.')}$`, 'm'))
})
