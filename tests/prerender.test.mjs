// scripts/prerender.mjs: static project pages, the list page, the sitemap and the app marker, from a published dataset.
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { prerender, prerenderSite, sitemapWith, withMarker, MARKER } from '../scripts/prerender.mjs'
import { siteData, RECORDS } from '../qa/fixtures/site-data-projects.mjs'

const SITE = 'https://remona8787.github.io'
const root = path.resolve(import.meta.dirname, '..')
const ld = (/** @type {string} */ html) => JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)[1])
const meta = (/** @type {string} */ html, /** @type {string} */ key) => (new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`).exec(html) || [])[1]

test('one page per project of index.json, a list page, and sitemap entries for all of them', () => {
  const data = siteData(RECORDS)
  const { files, entries, count } = prerender(data, { siteURL: SITE + '/' })
  assert.equal(count, RECORDS.length)
  for (const r of RECORDS) assert.ok(files.has(`p/${r.id}/index.html`), r.id)
  assert.ok(files.has('p/index.html'))
  assert.equal(entries.length, RECORDS.length + 1)
  assert.equal(entries[0].loc, SITE + '/p/')
  assert.ok(entries.every(e => e.loc.startsWith(SITE + '/p/')))
})

test('a project page: title, description, canonical, OG/Twitter, JSON-LD with credited images, a link into the app', () => {
  const data = siteData(RECORDS)
  const r = RECORDS.find(x => x.country_iso2 === 'KR' && x.images.some(i => i.tier <= 2 && i.approved !== false))
  const html = prerender(data, { siteURL: SITE }).files.get(`p/${r.id}/index.html`)
  const url = `${SITE}/p/${r.id}/`
  assert.match(html, /^<!doctype html><html lang="ko">/)
  assert.ok(html.includes(`<link rel="canonical" href="${url}">`))
  assert.equal(meta(html, 'og:url'), url)
  assert.ok(meta(html, 'description').length > 20 && meta(html, 'description').length <= 160)
  assert.match(meta(html, 'og:image'), /^https:\/\//)
  assert.equal(meta(html, 'twitter:card'), 'summary_large_image')
  assert.ok(html.includes(`href="../../#place/${r.id}"`), 'links into the app')
  assert.ok(!/<script(?! type="application\/ld\+json")/.test(html), 'no script runs on the page')
  const graph = ld(html)['@graph'], work = graph[0]
  assert.equal(work.url, url)
  assert.ok(work.image.length >= 1)
  for (const im of work.image) {
    assert.match(im.contentUrl, /^https:\/\//)
    assert.ok(im.creator.name && im.creditText, 'every photo names its creator and credit')
  }
  assert.equal(graph[1]['@type'], 'BreadcrumbList')
  // The lead photo carries its renditions and its credit with the licence.
  const fig = /<figure class="project-photo[^"]*">([\s\S]*?)<\/figure>/.exec(html)[1]
  assert.match(fig, / srcset="[^"]+ \d+w/)
  assert.match(fig, /<figcaption>© [^<]+ · /)
})

test('names and summaries are escaped; JSON-LD cannot close its script; a photo without a licence is never printed', () => {
  const evil = { ...RECORDS[0], id: 'EVIL-1', name_ko: '빛 <script>alert(1)</script> "따옴표"', summary_ko: '</script><img src=x onerror=alert(1)> & 끝', images: [{ ...RECORDS[0].images[0], license: null }] }
  const html = prerender(siteData([evil, ...RECORDS.slice(1, 4)]), { siteURL: SITE }).files.get('p/EVIL-1/index.html')
  assert.ok(!html.includes('<script>alert'), 'name escaped')
  assert.ok(!html.includes('<img src=x'), 'summary escaped')
  assert.equal((html.match(/<\/script>/g) || []).length, 1, 'only the JSON-LD block closes a script')
  assert.equal(ld(html)['@graph'][0].name, evil.name_ko)
  assert.ok(!html.includes('class="project-photo'), 'no unlicensed photo')
  assert.equal(ld(html)['@graph'][0].image.length, 0)
})

test('the list page groups Korean projects by region, then the world by country, each linking its page', () => {
  const html = prerender(siteData(RECORDS), { siteURL: SITE }).files.get('p/index.html')
  const kr = html.indexOf('<h2>국내</h2>'), world = html.indexOf('<h2>세계</h2>')
  assert.ok(kr > 0 && world > kr)
  assert.ok(html.indexOf('id="kr-seoul"') > kr && html.indexOf('id="kr-seoul"') < world)
  for (const r of RECORDS) assert.ok(html.includes(`href="./${r.id}/"`), r.id)
})

test('sitemap: the site pages stay, old project entries are replaced; the marker is added once', () => {
  const old = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${SITE}/</loc></url>\n<url><loc>${SITE}/about.html</loc></url>\n<url><loc>${SITE}/p/OLD/</loc></url>\n</urlset>\n`
  const xml = sitemapWith(old, [{ loc: SITE + '/p/A/', lastmod: '2026-10-20' }, { loc: SITE + '/p/B&C/', lastmod: null }])
  const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map(m => m[1])
  assert.deepEqual(locs, [SITE + '/', SITE + '/about.html', SITE + '/p/A/', SITE + '/p/B&amp;C/'])
  assert.ok(xml.includes('<lastmod>2026-10-20</lastmod>'))
  const html = '<html><head><title>x</title></head><body></body></html>'
  assert.equal(withMarker(withMarker(html)).split(MARKER).length, 2)
})

test('the site URL must be an https root', () => {
  assert.throws(() => prerender(siteData(RECORDS.slice(0, 2)), { siteURL: 'http://example.org' }))
  assert.throws(() => prerender(siteData(RECORDS.slice(0, 2)), { siteURL: 'https://example.org/sub/x' }))
})

test('CLI: writes p/, the sitemap and the marker into a built site; without a readable dataset it leaves the site alone', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'prerender-'))
  try {
    const dist = path.join(dir, 'dist'), data = path.join(dir, 'data')
    await mkdir(dist, { recursive: true })
    const index = `<!doctype html><html><head><link rel="canonical" href="${SITE}/"></head><body></body></html>`
    const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${SITE}/</loc></url>\n</urlset>\n`
    await writeFile(path.join(dist, 'index.html'), index)
    await writeFile(path.join(dist, 'sitemap.xml'), sitemap)
    // No dataset: nothing changes.
    execFileSync(process.execPath, [path.join(root, 'scripts/prerender.mjs'), `--dist=${dist}`, `--data=${data}`], { stdio: 'pipe' })
    assert.equal(await readFile(path.join(dist, 'index.html'), 'utf8'), index)
    assert.ok(!existsSync(path.join(dist, 'p')))
    // A dataset: pages, sitemap, marker; the site URL comes from the canonical link.
    const d = siteData(RECORDS.slice(0, 6))
    await mkdir(path.join(data, 'projects'), { recursive: true })
    for (const [f, v] of [['manifest.json', d.manifest], ['index.json', d.index], ...Object.entries(d.shards).map(([s, v]) => [`projects/${s}.json`, v])]) await writeFile(path.join(data, f), JSON.stringify(v))
    execFileSync(process.execPath, [path.join(root, 'scripts/prerender.mjs'), `--dist=${dist}`, `--data=${data}`], { stdio: 'pipe' })
    assert.equal((await readdir(path.join(dist, 'p'))).length, 7)
    assert.ok((await readFile(path.join(dist, 'index.html'), 'utf8')).includes(MARKER))
    const xml = await readFile(path.join(dist, 'sitemap.xml'), 'utf8')
    assert.ok(xml.includes(`<loc>${SITE}/</loc>`) && xml.includes(`<loc>${SITE}/p/${RECORDS[0].id}/</loc>`))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('prerenderSite: the deploy hands over its dataset files and built tree (Buffers), and gets the files to add', () => {
  const d = siteData(RECORDS.slice(0, 8))
  const datasetFiles = new Map([['manifest.json', d.manifest], ['index.json', d.index], ...Object.entries(d.shards).map(([s, v]) => [`projects/${s}.json`, v])].map(([k, v]) => [k, Buffer.from(JSON.stringify(v))]))
  const tree = new Map([
    ['index.html', Buffer.from(`<!doctype html><html><head><link rel="canonical" href="${SITE}/"></head><body></body></html>`)],
    ['sitemap.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${SITE}/about.html</loc></url>\n</urlset>\n`)],
  ])
  const out = prerenderSite(datasetFiles, tree)
  assert.equal([...out.keys()].filter(k => /^p\/[^/]+\/index\.html$/.test(k)).length, 8)
  assert.ok(out.get('index.html').includes(MARKER))
  assert.ok(out.get('sitemap.xml').includes(`<loc>${SITE}/about.html</loc>`) && out.get('sitemap.xml').includes(`<loc>${SITE}/p/</loc>`))
  for (const [k, v] of out) assert.equal(typeof v, 'string', k)
  // Every page with a photo credits it; every public page may be indexed.
  for (const [k, v] of out) if (k.startsWith('p/')) {
    assert.ok(!/noindex/.test(v), k)
    const imgs = (v.match(/<img [^>]*src="https:/g) || []).length, credits = (v.match(/<figcaption>© /g) || []).length
    assert.equal(credits, imgs, k + ': a credit for every photo')
  }
  assert.throws(() => prerenderSite(new Map([['manifest.json', '{']]), tree), /JSON|missing/)
})
