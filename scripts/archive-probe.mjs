// Dry run of the archive collector against the LIVE sources, without a database (docs/ARCHIVE_SPEC.md §5, docs/ARCHIVE_COLLECTOR.md).
// Runs the seed rules through the same adapters, classifier and normalizer as archive-collect and reports, per rule,
// what the source returned: counts, label breakdown, the top candidates and every error. Writes
// release/archive-probe.json. Always exits 0: a failing source is a finding to report, not a crash.
//   npm run archive:probe                        all free rules (+ NAVER/Brave when their keys are in the environment)
//   node scripts/archive-probe.mjs --kinds rss    only some kinds (comma-separated)
//   node scripts/archive-probe.mjs --out path     another report path
// Keys: NAVER_API_KEY_ID / NAVER_API_KEY (/ NAVER_API_MODE), BRAVE_API_KEY from the environment only; never printed.
// The Wikidata change check uses the QIDs of the curated seed (site-public-cleared/assets/seed.js) and the last 7 days.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { SEED_RULES } from '../edge-functions/_shared/archive/seed-rules.mjs'
import { collectRule, collectorLimiter, labelCounts } from '../edge-functions/_shared/archive/pipeline.mjs'
import { defaultKeywords } from '../edge-functions/_shared/archive/classify.mjs'
import { USER_AGENT } from '../edge-functions/_shared/archive/http.mjs'
import { statusForScore } from '../edge-functions/_shared/archive/classify.mjs'

const root = path.resolve(import.meta.dirname, '..')
const arg = (/** @type {string} */ name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null }
const OUT = path.resolve(root, arg('--out') || 'release/archive-probe.json')
const KINDS = arg('--kinds') ? String(arg('--kinds')).split(',').map((s) => s.trim()) : null
const getEnv = (/** @type {string} */ name) => process.env[name]

async function seedQids() {
  try {
    const text = await readFile(path.join(root, 'site-public-cleared/assets/seed.js'), 'utf8')
    return [...new Set([...text.matchAll(/"wikidata":\s*"(Q[1-9]\d*)"/g)].map((m) => m[1]))]
  } catch { return [] }
}

async function main() {
  const started = Date.now()
  const keywords = defaultKeywords()
  const limiter = collectorLimiter()
  const qids = await seedQids()
  const wikidataProjects = qids.map((q) => ({ project_id: 'seed:' + q, wikidata_qid: q }))
  const naverKeys = !!(getEnv('NAVER_API_KEY_ID') && getEnv('NAVER_API_KEY'))
  const braveKey = !!getEnv('BRAVE_API_KEY')
  const rules = SEED_RULES.filter((r) => !KINDS || KINDS.includes(r.kind)).map((r, i) => ({
    ...r,
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    // Keyed sources are probed only when their keys are present (the seed keeps them off in the database); without
    // keys the pipeline skips them and says why (naver_keys_not_set, brave_key_not_set).
    enabled: r.kind.startsWith('naver') || r.kind === 'brave' ? true : r.enabled,
    // Wikidata: report items modified in the last week (a first run would only set a baseline).
    last_run_at: r.kind === 'wikidata' ? new Date(started - 7 * 86400e3).toISOString() : null,
  }))
  /** @type {any[]} */
  const report = []
  for (const rule of rules) {
    const t0 = Date.now()
    let result
    try {
      result = await collectRule(rule, { getEnv, limiter, keywords, wikidataProjects })
    } catch (e) {
      result = { status: 'error', reason: null, fetched: 0, items: [], errors: [{ stage: 'probe', message: String(/** @type {any} */ (e)?.message || e), url: null, http_status: null }], dropped: {}, project_updates: [], not_modified: false, websub: null }
    }
    const items = result.items || []
    const entry = {
      name: rule.name, kind: rule.kind, url: rule.url, status: result.status, reason: result.reason, ms: Date.now() - t0,
      fetched: result.fetched, items: items.length, dropped: result.dropped, labels: labelCounts(items),
      statuses: items.reduce((/** @type {Record<string, number>} */ acc, /** @type {any} */ it) => { const s = statusForScore(it.classification.score); acc[s] = (acc[s] || 0) + 1; return acc }, {}),
      websub_hub: result.websub?.hub ?? null,
      project_updates: (result.project_updates || []).map((/** @type {any} */ u) => ({ qid: u.qid, date_modified: u.date_modified })),
      errors: (result.errors || []).map((/** @type {any} */ e) => ({ stage: e.stage, http_status: e.http_status, message: String(e.message).slice(0, 500), url: e.url })),
      top: [...items].sort((a, b) => b.classification.score - a.classification.score).slice(0, 5).map((it) => ({
        title: it.title, url: it.canonical_url, publisher: it.publisher, language: it.language, published_at: it.published_at,
        score: it.classification.score, label: it.classification.label, source_kind: it.source_kind, reliability: it.reliability, detected: it.detected,
      })),
    }
    report.push(entry)
    const errs = entry.errors.length ? '  ' + entry.errors[0].message.slice(0, 120) : ''
    console.log(`${entry.status.padEnd(8)} ${rule.kind.padEnd(10)} ${String(rule.name).padEnd(40)} fetched ${String(entry.fetched).padStart(3)}  items ${String(entry.items).padStart(3)}${entry.reason ? '  (' + entry.reason + ')' : ''}${errs}`)
  }
  const all = report.flatMap((r) => r.top)
  const totals = {
    rules: report.length,
    success: report.filter((r) => r.status === 'success').length,
    partial: report.filter((r) => r.status === 'partial').length,
    error: report.filter((r) => r.status === 'error').length,
    skipped: report.filter((r) => r.status === 'skipped').length,
    fetched: report.reduce((n, r) => n + (r.fetched || 0), 0),
    items: report.reduce((n, r) => n + r.items, 0),
    labels: report.reduce((/** @type {Record<string, number>} */ acc, r) => { for (const [k, v] of Object.entries(r.labels)) acc[k] = (acc[k] || 0) + /** @type {number} */ (v); return acc }, {}),
  }
  const out = {
    generated_at: new Date().toISOString(),
    environment: { node: process.version, ci: !!process.env.CI, github_run: process.env.GITHUB_RUN_ID || null, naver_keys: naverKeys, brave_key: braveKey },
    user_agent: USER_AGENT, classifier_version: keywords.version, ms: Date.now() - started,
    note: 'Dry run without a database: nothing was stored. A rule with status success read its live source; verified_at in the database is set only by an operator after reviewing a report like this one.',
    totals,
    reachable: report.filter((r) => r.status === 'success' || r.status === 'partial').map((r) => r.name),
    unreachable: report.filter((r) => r.status === 'error').map((r) => ({ name: r.name, error: r.errors[0]?.message ?? null })),
    top_candidates: all.sort((a, b) => b.score - a.score).slice(0, 20),
    rules: report,
  }
  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(out, null, 2) + '\n')
  console.log(`\n${totals.rules} rules: ${totals.success} success, ${totals.partial} partial, ${totals.error} error, ${totals.skipped} skipped; ${totals.items} items. Report: ${path.relative(root, OUT)}`)
}

try { await main() } catch (e) {
  // Even a crash of the probe itself leaves a report and exit code 0 (the workflow uploads whatever exists).
  console.error('probe failed:', /** @type {any} */ (e)?.stack || e)
  try { await mkdir(path.dirname(OUT), { recursive: true }); await writeFile(OUT, JSON.stringify({ generated_at: new Date().toISOString(), crashed: String(/** @type {any} */ (e)?.message || e) }, null, 2) + '\n') } catch { /* nothing more */ }
}
process.exitCode = 0
