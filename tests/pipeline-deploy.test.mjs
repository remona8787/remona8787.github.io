// Deploy assembly (pipeline/deploy.mjs) and the live check helpers (pipeline/verify-live.mjs): main = built site +
// data/ (admin data is never published, and an old data/admin/ on main is removed), the kept files of main, an invalid
// dataset never replacing a valid one, the idempotent deploy id, robots.txt, and the waiting/summary logic of
// verify-live (the browser part runs on Actions).
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assemble, loadDataset, robotsWithAdmin, treeId, KEEP } from '../pipeline/deploy.mjs'
import { waitForDeploy, pickDetail, screens, summarize, renditionWidth, galleryCheck, imageKey, VIEWPORTS, INTERNAL_TERMS } from '../pipeline/verify-live.mjs'

const root = path.resolve(import.meta.dirname, '..')
const FIX = path.join(root, 'tests/fixtures/pipeline')

async function world() {
  const dir = await mkdtemp(path.join(tmpdir(), 'aol-deploy-'))
  const dist = path.join(dir, 'dist'), data = path.join(dir, 'data'), site = path.join(dir, 'site')
  await mkdir(path.join(dist, 'assets'), { recursive: true })
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>x</title>\n')
  await writeFile(path.join(dist, 'assets/app.js'), 'console.log(1)\n')
  await writeFile(path.join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\nDisallow: /admin/\nSitemap: https://remona8787.github.io/sitemap.xml\n')
  await writeFile(path.join(dist, '.nojekyll'), '')
  await writeFile(path.join(dist, 'README.md'), 'built readme must not replace main\n')
  await mkdir(path.join(dist, 'data'), { recursive: true })
  await writeFile(path.join(dist, 'data/stale.json'), '{}')
  await cp(path.join(FIX, 'site-data'), path.join(data, 'site-data'), { recursive: true })
  await cp(path.join(FIX, 'admin-data'), path.join(data, 'admin-data'), { recursive: true })
  await mkdir(path.join(site, '.github/workflows'), { recursive: true })
  await mkdir(path.join(site, '.git'), { recursive: true })
  await writeFile(path.join(site, '.git/HEAD'), 'ref: refs/heads/main\n')
  await writeFile(path.join(site, '.github/workflows/archive.yml'), 'name: archive\n')
  await writeFile(path.join(site, 'README.md'), '# main readme\n')
  await writeFile(path.join(site, 'CNAME'), 'example.org\n')
  await writeFile(path.join(site, 'old-page.html'), 'old\n')
  await mkdir(path.join(site, 'old-assets'), { recursive: true })
  await writeFile(path.join(site, 'old-assets/x.js'), 'old\n')
  return { dir, dist, data, site }
}

test('assemble: dist + site-data → data/; admin-data is never published; main keeps .git, .github, README.md, .nojekyll, CNAME', async () => {
  const w = await world()
  try {
    const r = await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site, sourceSha: 'aaa', dataSha: 'bbb', now: '2026-10-20T07:00:00.000Z' })
    assert.equal(r.changed, true)
    assert.equal(r.dataset, 'data_branch')
    assert.equal(r.admin, 'not_published')
    const manifest = JSON.parse(await readFile(path.join(FIX, 'site-data/manifest.json'), 'utf8'))
    assert.equal(r.build_id, manifest.build_id)
    assert.match(r.deploy_id, /^[0-9a-f]{12}$/)
    const top = (await readdir(w.site)).sort()
    assert.deepEqual(top, ['.git', '.github', '.nojekyll', 'CNAME', 'README.md', 'assets', 'data', 'deploy.json', 'index.html', 'robots.txt'])
    assert.equal(await readFile(path.join(w.site, 'README.md'), 'utf8'), '# main readme\n')
    assert.equal(await readFile(path.join(w.site, '.github/workflows/archive.yml'), 'utf8'), 'name: archive\n')
    assert.equal(await readFile(path.join(w.site, 'CNAME'), 'utf8'), 'example.org\n')
    assert.ok(existsSync(path.join(w.site, '.git/HEAD')))
    for (const f of ['manifest.json', 'index.json', 'home.json', 'stats.json', ...manifest.files.shards]) {
      assert.deepEqual(await readFile(path.join(w.site, 'data', f)), await readFile(path.join(FIX, 'site-data', f)), f + ' copied byte for byte')
    }
    assert.ok(!existsSync(path.join(w.site, 'data/stale.json')), 'a data/ folder of the build never mixes with the dataset')
    assert.ok(!existsSync(path.join(w.site, 'data/admin')), 'internal admin data stays on the data branch')
    assert.deepEqual((await readdir(path.join(w.site, 'data'))).sort(), ['home.json', 'index.json', 'manifest.json', 'projects', 'research', 'stats.json'])
    assert.match(await readFile(path.join(w.site, 'robots.txt'), 'utf8'), /^Disallow: \/admin\/\nDisallow: \/data\/admin\/\nSitemap:/m)
    const stamp = JSON.parse(await readFile(path.join(w.site, 'deploy.json'), 'utf8'))
    assert.deepEqual(stamp, { schema: 1, deploy_id: r.deploy_id, build_id: manifest.build_id, dataset: 'data_branch', admin: 'not_published', source: 'aaa', data: 'bbb', at: '2026-10-20T07:00:00.000Z' })
    // The deploy id is the content: an unchanged deploy touches nothing, even with other commit ids and times.
    const again = await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site, sourceSha: 'ccc', dataSha: 'ddd', now: '2026-10-20T13:00:00.000Z' })
    assert.equal(again.changed, false)
    assert.equal(again.deploy_id, r.deploy_id)
    assert.deepEqual(JSON.parse(await readFile(path.join(w.site, 'deploy.json'), 'utf8')), stamp)
    // A change of the site is a new deploy.
    await writeFile(path.join(w.dist, 'assets/app.js'), 'console.log(2)\n')
    const changed = await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site })
    assert.equal(changed.changed, true)
    assert.notEqual(changed.deploy_id, r.deploy_id)
  } finally { await rm(w.dir, { recursive: true, force: true }) }
})

test('an old data/admin/ on main is removed by the next deploy, even when nothing else changed', async () => {
  const w = await world()
  try {
    const first = await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site })
    // What a v0.17 deploy left on main: data/admin/ next to the dataset, and the same deploy id in deploy.json.
    await mkdir(path.join(w.site, 'data/admin'), { recursive: true })
    for (const f of ['report.json', 'quality.json', 'candidates.json']) await writeFile(path.join(w.site, 'data/admin', f), '{}')
    const logs = []
    const r = await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site, log: (s) => logs.push(s) })
    assert.equal(r.deploy_id, first.deploy_id, 'the tree is the same')
    assert.equal(r.removed_admin, true)
    assert.equal(r.changed, true, 'so the commit removes data/admin/')
    assert.ok(!existsSync(path.join(w.site, 'data/admin')))
    assert.ok(existsSync(path.join(w.site, 'data/manifest.json')))
    assert.ok(logs.some((l) => /data\/admin\/ on main is removed/.test(l)))
    const again = await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site })
    assert.equal(again.changed, false)
  } finally { await rm(w.dir, { recursive: true, force: true }) }
})

test('an invalid or missing dataset never replaces the deployed one; invalid admin data is reported, never published', async () => {
  const w = await world()
  try {
    const first = await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site })
    const deployed = await readFile(path.join(w.site, 'data/index.json'))
    // A broken shard on the data branch.
    const m = JSON.parse(await readFile(path.join(w.data, 'site-data/manifest.json'), 'utf8'))
    await writeFile(path.join(w.data, 'site-data', m.files.shards[0]), '{"schema":1,"projects":[{"id":"x"}]}')
    await writeFile(path.join(w.data, 'admin-data/report.json'), '{not json')
    const logs = []
    const r = await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site, log: (s) => logs.push(s) })
    assert.equal(r.dataset, 'kept_previous')
    assert.equal(r.admin, 'not_published')
    assert.ok(r.dataset_errors.length > 0)
    assert.ok(r.admin_errors.some((e) => /report\.json: invalid JSON/.test(e)))
    assert.equal(r.build_id, first.build_id)
    assert.equal(r.changed, false, 'same site, same deployed data: nothing to deploy')
    assert.deepEqual(await readFile(path.join(w.site, 'data/index.json')), deployed)
    assert.ok(logs.some((l) => /not deployed/.test(l)))
    // Even with a new site build, the deployed dataset stays.
    await writeFile(path.join(w.dist, 'index.html'), '<!doctype html><title>y</title>\n')
    const r2 = await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site })
    assert.equal(r2.changed, true)
    assert.deepEqual(await readFile(path.join(w.site, 'data/index.json')), deployed)
    assert.ok(!existsSync(path.join(w.site, 'data/admin')))
    // No data branch yet and nothing deployed: the site goes out without data/.
    const fresh = await world()
    try {
      const r3 = await assemble({ dist: fresh.dist, dataDir: path.join(fresh.dir, 'missing'), siteDir: fresh.site })
      assert.equal(r3.dataset, 'none')
      assert.equal(r3.build_id, null)
      assert.ok(!existsSync(path.join(fresh.site, 'data')))
      assert.ok(existsSync(path.join(fresh.site, 'deploy.json')))
    } finally { await rm(fresh.dir, { recursive: true, force: true }) }
  } finally { await rm(w.dir, { recursive: true, force: true }) }
})

test('project pages: made from the deployed dataset (never a rejected one), with the sitemap and the marker; same inputs, same deploy id', async () => {
  const w = await world()
  try {
    // A build with a canonical site URL (scripts/build.mjs writes SITE_URL) and its own sitemap, plus a stale p/.
    await writeFile(path.join(w.dist, 'index.html'), '<!doctype html><html><head><title>x</title><link rel="canonical" href="https://remona8787.github.io/"></head><body></body></html>\n')
    await writeFile(path.join(w.dist, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>https://remona8787.github.io/</loc></url>\n</urlset>\n')
    await mkdir(path.join(w.dist, 'p/STALE'), { recursive: true })
    await writeFile(path.join(w.dist, 'p/STALE/index.html'), 'stale\n')
    const index = JSON.parse(await readFile(path.join(FIX, 'site-data/index.json'), 'utf8'))
    const ids = index.rows.map((r) => r[index.fields.indexOf('id')])
    const r = await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site, now: '2026-10-25T20:00:00.000Z' })
    assert.equal(r.dataset, 'data_branch')
    assert.equal(r.pages, ids.length)
    for (const id of ids) assert.ok(existsSync(path.join(w.site, 'p', id, 'index.html')), id)
    assert.ok(existsSync(path.join(w.site, 'p/index.html')))
    assert.ok(!existsSync(path.join(w.site, 'p/STALE')), 'p/ of a build never mixes with the pages of the dataset')
    const sitemap = await readFile(path.join(w.site, 'sitemap.xml'), 'utf8')
    assert.match(sitemap, /<loc>https:\/\/remona8787\.github\.io\/<\/loc>/, 'the site\'s own entries stay')
    assert.ok(ids.every((id) => sitemap.includes(`/p/${encodeURIComponent(id)}/`)))
    assert.match(await readFile(path.join(w.site, 'index.html'), 'utf8'), /<meta name="aol-static-pages" content="p\/">/)
    const page = await readFile(path.join(w.site, 'p', 'SEOUL018', 'index.html'), 'utf8')
    assert.match(page, /<link rel="canonical" href="https:\/\/remona8787\.github\.io\/p\/SEOUL018\/"/)
    // Idempotent: the same inputs give the same tree, so nothing changes on main.
    const again = await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site, now: '2026-10-25T21:00:00.000Z' })
    assert.equal(again.changed, false)
    assert.equal(again.deploy_id, r.deploy_id)
    // A rejected dataset on the data branch (a project without its record): the deployed dataset and its pages stay,
    // and the rejected dataset's new project never gets a page.
    const bad = { ...index, rows: [...index.rows, index.rows[0].map((v, i) => (index.fields[i] === 'id' ? 'Q99999991' : v))] }
    await writeFile(path.join(w.data, 'site-data/index.json'), JSON.stringify(bad))
    const kept = await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site })
    assert.equal(kept.dataset, 'kept_previous')
    assert.equal(kept.changed, false, 'the same deployed dataset gives the same pages')
    assert.equal(kept.pages, ids.length)
    assert.ok(!existsSync(path.join(w.site, 'p/Q99999991')))
    // Nothing deployed and no valid dataset: no pages at all (and no stale ones from the build).
    const none = await world()
    try {
      await writeFile(path.join(none.dist, 'index.html'), '<!doctype html><html><head><link rel="canonical" href="https://remona8787.github.io/"></head></html>\n')
      await mkdir(path.join(none.dist, 'p/STALE'), { recursive: true })
      await writeFile(path.join(none.dist, 'p/STALE/index.html'), 'stale\n')
      const r3 = await assemble({ dist: none.dist, dataDir: path.join(none.dir, 'missing'), siteDir: none.site })
      assert.equal(r3.dataset, 'none')
      assert.equal(r3.pages, 0)
      assert.ok(!existsSync(path.join(none.site, 'p')))
    } finally { await rm(none.dir, { recursive: true, force: true }) }
  } finally { await rm(w.dir, { recursive: true, force: true }) }
})

test('research package: the deployed dataset\'s version (latest.json = build id), a change log against the build on main, never a rejected dataset; a published version stays as it is', async () => {
  const w = await world()
  try {
    const manifest = JSON.parse(await readFile(path.join(FIX, 'site-data/manifest.json'), 'utf8'))
    const A = manifest.build_id
    const r1 = await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site, now: '2026-10-26T01:00:00.000Z' })
    assert.ok(r1.research_files >= 8)
    const latest = JSON.parse(await readFile(path.join(w.site, 'data/research/latest.json'), 'utf8'))
    assert.equal(latest.version, A)
    for (const f of ['projects.csv', 'projects.json', 'projects.geojson', 'sources.csv', 'images.csv', 'relations.csv', 'events.csv', 'datapackage.json', 'README.md', 'CITATION.txt']) assert.ok(existsSync(path.join(w.site, 'data/research', A, f)), f)
    assert.ok(!existsSync(path.join(w.site, 'data/research', A, 'CHANGELOG.md')), 'nothing was on main before')
    assert.equal((await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site })).changed, false, 'same inputs, same deploy')
    // A new build on the data branch: its package has a change log against A; deploying it again changes nothing.
    const B = A.slice(0, -8) + 'b0b0b0b0'
    // Every file of a dataset carries its build id.
    const rebuild = async (id, patch = {}) => {
      for (const f of ['manifest.json', 'index.json', 'home.json', 'stats.json', ...manifest.files.shards]) {
        const file = path.join(w.data, 'site-data', f)
        const j = JSON.parse(await readFile(file, 'utf8'))
        await writeFile(file, JSON.stringify({ ...j, build_id: id, ...(f === 'manifest.json' ? patch : {}) }))
      }
    }
    await rebuild(B)
    const r2 = await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site })
    assert.equal(r2.changed, true)
    assert.equal(JSON.parse(await readFile(path.join(w.site, 'data/research/latest.json'), 'utf8')).version, B)
    assert.match(await readFile(path.join(w.site, 'data/research', B, 'CHANGELOG.md'), 'utf8'), new RegExp(A))
    assert.ok(!existsSync(path.join(w.site, 'data/research', A)), 'one version in the tree; older ones stay in the history of main')
    const again = await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site })
    assert.equal(again.changed, false, 'the published version (with its change log) is kept as it is')
    assert.ok(existsSync(path.join(w.site, 'data/research', B, 'CHANGELOG.md')))
    // A rejected dataset on the data branch: the deployed version stays, the rejected build never gets a package.
    const C = A.slice(0, -8) + 'c0c0c0c0'
    await rebuild(C, { counts: { ...manifest.counts, projects: -1 } })
    const r3 = await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site })
    assert.equal(r3.dataset, 'kept_previous')
    assert.equal(r3.changed, false)
    assert.ok(!existsSync(path.join(w.site, 'data/research', C)))
    assert.equal(JSON.parse(await readFile(path.join(w.site, 'data/research/latest.json'), 'utf8')).version, B)
  } finally { await rm(w.dir, { recursive: true, force: true }) }
})

test('a dataset published by the previous pipeline version (records without kind and status) still deploys, byte for byte', async () => {
  const w = await world()
  try {
    const manifest = JSON.parse(await readFile(path.join(FIX, 'site-data/manifest.json'), 'utf8'))
    for (const f of manifest.files.shards) {
      const file = path.join(w.data, 'site-data', f)
      const j = JSON.parse(await readFile(file, 'utf8'))
      await writeFile(file, JSON.stringify({ ...j, projects: j.projects.map(({ kind, start_date, end_date, status, status_source, ...r }) => r) }))
    }
    const r = await assemble({ dist: w.dist, dataDir: w.data, siteDir: w.site })
    assert.equal(r.dataset, 'data_branch', r.dataset_errors.join('; '))
    const shard = manifest.files.shards[0]
    assert.deepEqual(await readFile(path.join(w.site, 'data', shard)), await readFile(path.join(w.data, 'site-data', shard)))
  } finally { await rm(w.dir, { recursive: true, force: true }) }
})

test('loadDataset checks the whole dataset; robots.txt and the tree id', async () => {
  const ok = await loadDataset(path.join(FIX, 'site-data'))
  assert.equal(ok.ok, true, ok.errors.join('\n'))
  assert.ok(ok.files.has('manifest.json') && ok.files.has('index.json') && ok.files.has('projects/000.json'))
  const missing = await loadDataset(path.join(FIX, 'nothing-here'))
  assert.deepEqual(missing.errors, ['manifest.json: missing'])
  // robots.txt: added once, after the last rule; a missing file gets a default.
  const once = robotsWithAdmin('User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: https://x/sitemap.xml\n')
  assert.equal(once, 'User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /data/admin/\n\nSitemap: https://x/sitemap.xml\n')
  assert.equal(robotsWithAdmin(once), once)
  assert.match(robotsWithAdmin(undefined), /^User-agent: \*\nAllow: \/\nDisallow: \/data\/admin\//)
  const a = new Map([['a', Buffer.from('1')], ['b', Buffer.from('2')]]), b = new Map([['b', Buffer.from('2')], ['a', Buffer.from('1')]])
  assert.equal(treeId(a), treeId(b), 'order does not matter')
  assert.notEqual(treeId(a), treeId(new Map([['a', Buffer.from('1')], ['b', Buffer.from('3')]])))
  assert.ok(KEEP.includes('.github') && KEEP.includes('README.md') && KEEP.includes('.nojekyll'))
})

test('verify-live: waits until the live site serves this deploy and build, or reports why not', async () => {
  let now = 0
  const clock = () => now, sleep = async (ms) => { now += ms }
  let live = { deploy: { deploy_id: 'old', at: 't0' }, manifest: { build_id: 'B0', counts: { projects: 1 } } }
  const seen = []
  const fetch = async (url) => {
    seen.push(url)
    const u = new URL(url)
    if (now >= 45e3) live = { deploy: { deploy_id: 'new', at: 't1', dataset: 'data_branch' }, manifest: { build_id: 'B1', generated_at: 'g', counts: { projects: 60, with_images: 10, with_hero: 3 } } }
    const body = u.pathname.endsWith('deploy.json') ? live.deploy : live.manifest
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const r = await waitForDeploy({ site: 'https://remona8787.github.io', deployId: 'new', buildId: 'B1', fetch, clock, sleep, intervalMs: 15e3, timeoutMs: 120e3 })
  assert.equal(r.ok, true)
  assert.equal(r.attempts, 4)
  assert.deepEqual(r.live, { deploy_id: 'new', deployed_at: 't1', source: null, dataset: 'data_branch', build_id: 'B1', generated_at: 'g', counts: { projects: 60, with_images: 10, with_hero: 3 } })
  assert.ok(seen.every((u) => /^https:\/\/remona8787\.github\.io\/(deploy\.json|data\/manifest\.json)\?t=/.test(u)), 'cache-busting queries on the site root')
  now = 0
  const never = await waitForDeploy({ site: 'https://remona8787.github.io/', deployId: 'other', buildId: 'B1', fetch, clock, sleep, intervalMs: 15e3, timeoutMs: 60e3 })
  assert.equal(never.ok, false)
  assert.match(never.error, /waiting for other/)
  const down = await waitForDeploy({ site: 'https://x.example/', deployId: 'a', fetch: async () => new Response('no', { status: 404 }), clock, sleep, intervalMs: 10e3, timeoutMs: 30e3 })
  assert.equal(down.ok, false)
  assert.match(down.error, /deploy\.json: HTTP 404/)
})

test('verify-live: screens, viewports, detail pick and the summary', async () => {
  assert.deepEqual(VIEWPORTS.map((v) => [v.width, v.height]), [[390, 844], [1440, 900]])
  assert.deepEqual(screens('Q1 x').map((s) => [s.name, s.path]), [['home', ''], ['explore', '#explore'], ['map', '#map'], ['detail', '#place/Q1%20x'], ['place-SEOUL006', '#place/SEOUL006'], ['data', '#data'], ['admin', 'admin/']])
  assert.equal(screens(null).some((s) => s.name === 'detail'), false)
  assert.equal(screens('SEOUL006').filter((s) => s.path === '#place/SEOUL006').length, 1, 'the regression page is not opened twice')
  // What a detail page shows, matched to its record by Commons file name or URL.
  const rec = JSON.parse(await readFile(path.join(FIX, 'site-data/projects/000.json'), 'utf8')).projects.find((r) => r.id === 'Q7715933')
  const shownUrls = [rec.images[0].display[0][1], rec.images[1].thumb + '?utm_source=x', 'https://example.org/logo.png', rec.credits.find((c) => c.portrait).portrait.thumb]
  const g = galleryCheck(shownUrls, rec)
  assert.equal(g.shown, 3)
  assert.deepEqual(g.providers, { commons: 3 })
  assert.equal(g.artist_portrait_visible.length, 1, 'a portrait on the page is reported')
  assert.deepEqual(g.unverified_visible, [])
  assert.equal(imageKey('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Foo_bar.jpg/960px-Foo_bar.jpg'), imageKey('https://upload.wikimedia.org/wikipedia/commons/a/ab/Foo_bar.jpg'))
  // The place page after the overhaul: portraits inside [data-creator-portrait] are reported apart and are not
  // forbidden; the main gallery is counted on its own.
  const portraitUrl = rec.credits.find((c) => c.portrait).portrait.thumb
  const g2 = galleryCheck(shownUrls.filter((u) => u !== portraitUrl), rec, { portraits: [portraitUrl], gallery: [rec.images[0].display[0][1]] })
  assert.deepEqual(g2.artist_portrait_visible, [])
  assert.deepEqual(g2.creator_portraits, { shown: 1, matched: 1 })
  assert.equal(g2.main_gallery.matched, 1)
  assert.deepEqual(g2.main_gallery.kinds, { [rec.images[0].kind]: 1 })
  assert.equal(screens('x').find((s) => s.name === 'admin').public, false, 'the admin page may show review vocabulary')
  assert.equal(pickDetail({ hero: [{ project: 'H' }], featured: ['F'] }, null), 'H')
  assert.equal(pickDetail({ hero: [], featured: ['F'] }, null), 'F')
  assert.equal(pickDetail(null, { rows: [['R', 'n']] }), 'R')
  assert.equal(pickDetail(null, null), null)
  for (const t of ['재확인 시점 경과', '확인 기록 있음', '검토 목록', '편집 검수', '자동 수집·미검수']) assert.ok(INTERNAL_TERMS.includes(t), t)
  const page = (o) => ({ page: 'home', viewport: 'mobile', ok: true, console_errors: [], page_errors: [], failed_requests: [], http_errors: [], broken_images: 0, internal_terms: [], lcp: { ms: 900 }, transfer: { total_bytes: 1000 }, data_files: [{ path: 'data/home.json', bytes: 10 }], ...o })
  const s = summarize([page(), page({ page: 'explore', lcp: { ms: 1800 }, console_errors: ['x'], data_files: [{ path: 'data/index.json' }] }), page({ page: 'detail', viewport: 'desktop', ok: false, lcp: null, internal_terms: ['검토 목록'] })])
  assert.equal(s.pages, 3)
  assert.equal(s.loaded, 2)
  assert.equal(s.console_errors, 1)
  assert.equal(s.max_lcp_ms, 1800)
  assert.deepEqual(s.internal_terms, ['검토 목록'])
  assert.equal(s.home_loads_index, false, 'only explore loaded index.json')
  assert.equal(summarize([page({ data_files: [{ path: 'data/index.json' }] })]).home_loads_index, true)
  // The live hero of v0.17 was a 500 px thumbnail: the summary names the rendition the home page painted.
  const hero = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/68/A.jpg/1920px-A.jpg'
  assert.deepEqual(summarize([page({ lcp: { ms: 900, url: hero } })]).home_lcp_image_px, { mobile: 1920 })
  assert.equal(renditionWidth('https://thumb.wikimedia.org/wikipedia/commons/thumb/6/68/A.jpg/500px-A.jpg?utm_source=x'), 500)
  assert.equal(renditionWidth('https://live.staticflickr.com/65535/123_abc_k.jpg'), 2048)
  assert.equal(renditionWidth('https://example.org/a.jpg'), null)
})
