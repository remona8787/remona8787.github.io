#!/usr/bin/env node
// Deploy assembly: job "deploy" of archive.yml (docs/STATIC_ARCHIVE.md, operations in docs/PIPELINE.md). The built
// site (dist/ of the source branch) and the published dataset of the data branch become the new tree of main:
//  - data branch site-data/ → data/ (only the files the contract names);
//  - admin-data/ is never published (v0.18): it stays on the data branch, and a data/admin/ left on main by an earlier
//    deploy is removed by this one (the new tree replaces everything but the kept files);
//  - a dataset that is missing or fails the schema checks is never deployed: the data/ already on main stays (the
//    outputs and the log say which);
//  - .git, .github/, README.md, .nojekyll and CNAME on main are kept; everything else is replaced by the new tree;
//  - robots.txt also disallows /data/admin/ (nothing is there any more; old links stay out of search indexes);
//  - project pages for search engines and link previews (scripts/prerender.mjs): p/<id>/, p/, sitemap.xml and the
//    aol-static-pages marker in index.html, made from the dataset that is deployed;
//  - deploy.json at the site root names the deploy: {deploy_id, build_id, source, data, at, dataset}. deploy_id is a
//    hash of the whole tree, so an unchanged deploy leaves main untouched (idempotent) and verify-live can wait for
//    this exact deploy even when the dataset (build_id) did not change.
//
// CLI: node pipeline/deploy.mjs --dist=<built site> --data=<data branch checkout> --site=<main checkout>
//        [--source-sha=<sha>] [--data-sha=<sha>] [--now=<iso>]
// Prints a summary and, on GitHub Actions, writes the step outputs deploy_id, build_id, changed, dataset and admin
// (always "not_published").
import path from 'node:path'
import { readFile, writeFile, rm, readdir, mkdir, appendFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { listFiles } from './lib/io.mjs'
import { checkDataset, checkReport, checkQuality, checkCandidates } from './lib/schema.mjs'
import { prerenderSite } from '../scripts/prerender.mjs'

/** Entries of main that the deploy never replaces or removes. */
export const KEEP = ['.git', '.github', 'README.md', '.nojekyll', 'CNAME']
export const ADMIN_FILES = ['report.json', 'quality.json', 'candidates.json']
/** The admin data stays on the data branch; the public site never carries it (docs/STATIC_ARCHIVE.md "Internal data"). */
export const ADMIN_PUBLISHED = false
const sha256 = (data) => createHash('sha256').update(data).digest('hex')

async function readJSONFile(file) {
  try { return { ok: true, value: JSON.parse(await readFile(file, 'utf8')) } } catch (e) { return { ok: false, error: existsSync(file) ? 'invalid JSON' : 'missing' } }
}

/**
 * Reads and checks a published dataset directory (manifest.json, index.json, home.json, stats.json and every shard the
 * manifest names). Returns {ok, buildId, files: Map(relative path → Buffer), errors}.
 */
export async function loadDataset(dir) {
  const errors = [], files = new Map()
  if (!dir || !existsSync(path.join(dir, 'manifest.json'))) return { ok: false, buildId: null, files, errors: ['manifest.json: missing'] }
  const get = async (rel) => {
    const r = await readJSONFile(path.join(dir, rel))
    if (!r.ok) { errors.push(`${rel}: ${r.error}`); return null }
    files.set(rel, await readFile(path.join(dir, rel)))
    return r.value
  }
  const manifest = await get('manifest.json')
  const shardFiles = Array.isArray(manifest?.files?.shards) ? manifest.files.shards : []
  if (manifest && !shardFiles.length) errors.push('manifest.json: no shards')
  if (shardFiles.some((f) => typeof f !== 'string' || !/^projects\/[A-Za-z0-9_-]{1,40}\.json$/.test(f))) errors.push('manifest.json: invalid shard path')
  const index = await get('index.json'), home = await get('home.json'), stats = await get('stats.json')
  const shards = {}
  for (const f of shardFiles.filter((x) => typeof x === 'string' && /^projects\/[A-Za-z0-9_-]{1,40}\.json$/.test(x))) {
    const s = await get(f)
    if (s) shards[f.slice('projects/'.length, -'.json'.length)] = s
  }
  if (!errors.length) errors.push(...checkDataset({ manifest, index, home, stats, shards }))
  return { ok: errors.length === 0, buildId: typeof manifest?.build_id === 'string' ? manifest.build_id : null, files: errors.length ? new Map() : files, errors }
}

/** Reads and checks admin-data (report, quality, candidates) on the data branch. Returns {ok, files, errors}. */
export async function loadAdmin(dir) {
  const errors = [], files = new Map()
  const checks = { 'report.json': checkReport, 'quality.json': checkQuality, 'candidates.json': checkCandidates }
  for (const f of ADMIN_FILES) {
    const r = dir ? await readJSONFile(path.join(dir, f)) : { ok: false, error: 'missing' }
    if (!r.ok) { errors.push(`${f}: ${r.error}`); continue }
    const e = checks[f](r.value)
    if (e.length) { errors.push(...e.slice(0, 10).map((x) => `${f}: ${x}`)); continue }
    files.set(f, await readFile(path.join(dir, f)))
  }
  return { ok: errors.length === 0, files: errors.length ? new Map() : files, errors }
}

/** robots.txt with "Disallow: /data/admin/" (added after the last Disallow line, or after User-agent). */
export function robotsWithAdmin(text) {
  const lines = String(text || 'User-agent: *\nAllow: /\n').replace(/\r\n/g, '\n').split('\n')
  if (lines.some((l) => /^Disallow:\s*\/data\/admin\/?\s*$/i.test(l.trim()))) return lines.join('\n')
  let at = -1
  lines.forEach((l, i) => { if (/^(Disallow|Allow|User-agent):/i.test(l.trim())) at = i })
  lines.splice(at + 1, 0, 'Disallow: /data/admin/')
  return lines.join('\n')
}

/** Hash of a tree (Map relative path → Buffer): the deploy id. */
export function treeId(tree) {
  const h = createHash('sha256')
  for (const p of [...tree.keys()].sort()) h.update(p + '\0' + sha256(tree.get(p)) + '\n')
  return h.digest('hex').slice(0, 12)
}

async function readTree(dir, prefix = '') {
  const out = new Map()
  for (const f of await listFiles(dir)) out.set(prefix + f.split(path.sep).join('/'), await readFile(path.join(dir, f)))
  return out
}

/**
 * Builds the new tree of main and, when it differs from the deployed one, writes it into siteDir.
 * @param {{dist: string, dataDir: string|null, siteDir: string, sourceSha?: string|null, dataSha?: string|null, now?: string, log?: (s: string) => void}} o
 */
export async function assemble({ dist, dataDir, siteDir, sourceSha = null, dataSha = null, now = new Date().toISOString(), log = () => {} }) {
  if (!existsSync(path.join(dist, 'index.html'))) throw new Error(`no built site in ${dist} (index.html missing)`)
  const tree = new Map()
  for (const [p, b] of await readTree(dist)) {
    const top = p.split('/')[0]
    if (KEEP.includes(top) && top !== '.nojekyll') continue
    // p/ (project pages) is made below from the dataset that is deployed, never taken from a build.
    if (top === 'data' || top === 'p' || p === 'deploy.json') continue
    tree.set(p, b)
  }
  // The dataset: the data branch's when it is valid, otherwise the one already deployed.
  const fresh = await loadDataset(dataDir ? path.join(dataDir, 'site-data') : null)
  const deployedData = path.join(siteDir, 'data')
  let dataset = 'none', buildId = null, datasetErrors = []
  let old = null
  if (fresh.ok) { dataset = 'data_branch'; buildId = fresh.buildId; for (const [f, b] of fresh.files) tree.set('data/' + f, b) } else {
    datasetErrors = fresh.errors
    old = await loadDataset(deployedData)
    if (old.ok) { dataset = 'kept_previous'; buildId = old.buildId; for (const [f, b] of old.files) tree.set('data/' + f, b) }
    log(`dataset of the data branch not deployed (${fresh.errors.slice(0, 5).join('; ')}); ${dataset === 'kept_previous' ? 'the deployed dataset stays' : 'no dataset is deployed'}`)
  }
  // Static project pages (scripts/prerender.mjs): p/<id>/index.html, p/index.html, sitemap.xml and the marker in
  // index.html, from the dataset that is deployed (a rejected one never gets pages). Pure, so the deploy id stays a
  // function of the inputs; a dataset it cannot read leaves the site without p/.
  const used = fresh.ok ? fresh : old?.ok ? old : null
  let pages = 0
  if (used) {
    try {
      for (const [p, s] of prerenderSite(used.files, tree)) { tree.set(p, Buffer.from(s)); if (/^p\/[^/]+\/index\.html$/.test(p)) pages++ }
    } catch (e) { log(`no project pages: ${e.message}`) }
  }
  // Admin data is internal: checked (so the summary can say whether it is valid) but never part of the site.
  const freshAdmin = await loadAdmin(dataDir ? path.join(dataDir, 'admin-data') : null)
  const admin = 'not_published', adminErrors = freshAdmin.ok ? [] : freshAdmin.errors
  const removedAdmin = existsSync(path.join(deployedData, 'admin'))
  if (removedAdmin) log('data/admin/ on main is removed: admin data is no longer published (it stays on the data branch)')
  tree.set('robots.txt', Buffer.from(robotsWithAdmin(tree.get('robots.txt')?.toString('utf8'))))
  if (!tree.has('.nojekyll')) tree.set('.nojekyll', Buffer.alloc(0))

  const deployId = treeId(tree)
  const previous = (await readJSONFile(path.join(siteDir, 'deploy.json'))).value ?? null
  const result = { deploy_id: deployId, build_id: buildId, dataset, admin, pages, removed_admin: removedAdmin, dataset_errors: datasetErrors.slice(0, 20), admin_errors: adminErrors.slice(0, 20), changed: previous?.deploy_id !== deployId || removedAdmin, files: tree.size + 1 }
  if (!result.changed) { log(`deploy ${deployId} is already on main: nothing to change`); return result }

  // Replace main's tree: remove everything but KEEP, then write the new files and deploy.json.
  await mkdir(siteDir, { recursive: true })
  for (const entry of await readdir(siteDir)) if (!KEEP.includes(entry)) await rm(path.join(siteDir, entry), { recursive: true, force: true })
  for (const [p, b] of tree) {
    if (p === '.nojekyll' && existsSync(path.join(siteDir, '.nojekyll'))) continue
    const file = path.join(siteDir, ...p.split('/'))
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, b)
  }
  const stamp = { schema: 1, deploy_id: deployId, build_id: buildId, dataset, admin, source: sourceSha || null, data: dataSha || null, at: now }
  await writeFile(path.join(siteDir, 'deploy.json'), JSON.stringify(stamp, null, 1) + '\n')
  log(`deploy ${deployId}: ${tree.size} files, dataset ${dataset}${buildId ? ' ' + buildId : ''}, ${pages} project pages, admin data not published`)
  return result
}

function args(argv) {
  const out = {}
  for (const a of argv) { const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a); if (m) out[m[1]] = m[2] ?? true }
  return out
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const a = args(process.argv.slice(2))
  if (!a.dist || !a.site) { console.error('usage: node pipeline/deploy.mjs --dist=<built site> --data=<data checkout> --site=<main checkout>'); process.exit(2) }
  try {
    const r = await assemble({ dist: path.resolve(a.dist), dataDir: a.data ? path.resolve(a.data) : null, siteDir: path.resolve(a.site), sourceSha: a['source-sha'] || null, dataSha: a['data-sha'] || null, now: a.now || undefined, log: (s) => console.log('[deploy] ' + s) })
    console.log('[deploy] ' + JSON.stringify(r))
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `deploy_id=${r.deploy_id}\nbuild_id=${r.build_id ?? ''}\nchanged=${r.changed}\ndataset=${r.dataset}\nadmin=${r.admin}\n`)
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Deploy\n\n- deploy id: \`${r.deploy_id}\` (${r.changed ? 'new' : 'unchanged, already on main'})\n- dataset: ${r.dataset}${r.build_id ? ` (build \`${r.build_id}\`)` : ''}\n- admin data: not published (stays on the data branch)${r.removed_admin ? '; data/admin/ removed from main' : ''}\n${r.dataset_errors.length ? `- dataset problems: ${r.dataset_errors.slice(0, 5).join('; ')}\n` : ''}`)
  } catch (e) {
    console.error('[deploy] failed:', e?.stack || e)
    process.exitCode = 1
  }
}

export const DEPLOY_SCRIPT = fileURLToPath(import.meta.url)
