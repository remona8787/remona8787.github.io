// Web discovery (GDELT DOC API, RSS/Atom feeds; NAVER/Brave only when their keys are set) through the collector
// modules of edge-functions/_shared/archive: the same adapters, keyword prefilter, classifier, normaliser and story
// clustering as the archive-collect Edge Function. Results are CANDIDATES ONLY (admin-data/candidates.json): they are
// never public until an editorial decision approves one. Rule state (conditional-GET validators, failure counts,
// backoff) is kept in state/web-rules.json; candidates accumulate in state/candidates.json.
import { collectRule, ruleState } from '../../edge-functions/_shared/archive/pipeline.mjs'
import { SEED_RULES } from '../../edge-functions/_shared/archive/seed-rules.mjs'
import { buildAliasIndex, matchAlias } from '../../edge-functions/_shared/archive/normalize.mjs'
import { statusForScore } from '../../edge-functions/_shared/archive/classify.mjs'
import { confidence } from '../../edge-functions/_shared/archive/reliability.mjs'
import { fnv1a } from './util.mjs'

const KEEP_DAYS = { auto_ignored: 30, default: 180 }

/** The seed rules this run may use (keyed sources only when their keys are set). */
export function webRules({ gdelt = true, rss = true, getEnv = () => undefined } = {}) {
  return SEED_RULES.filter((r) => {
    if (r.kind === 'gdelt') return gdelt && r.enabled
    if (r.kind === 'rss') return rss && r.enabled
    if (r.kind === 'naver_news' || r.kind === 'naver_blog') return !!(getEnv('NAVER_API_KEY_ID') && getEnv('NAVER_API_KEY'))
    if (r.kind === 'brave') return !!getEnv('BRAVE_API_KEY')
    return false
  })
}

/**
 * Runs the rules that are due. Returns {results: [...], items: [...], state: updated rule state, errors}.
 * @param {{client: any, rules: any[], ruleState: Record<string, any>, projects: {id: string, names: string[], wikidata_qid: string|null}[], getEnv?: Function, deadline?: number}} o
 */
export async function collectWeb({ client, rules, ruleState: prev = {}, projects = [], getEnv = () => undefined, deadline = Infinity }) {
  const aliasIndex = buildAliasIndex(projects.map((p) => ({ project_id: p.id, names: p.names, wikidata_qid: p.wikidata_qid })))
  const now = client.clock()
  const results = [], items = [], errors = []
  const state = { ...prev }
  for (const rule of rules) {
    const key = `${rule.kind}:${rule.name}`
    const s = state[key] || {}
    if (s.backoff_until && Date.parse(s.backoff_until) > now) { results.push({ key, status: 'skipped', reason: 'backoff', until: s.backoff_until }); continue }
    if (s.next_run_at && Date.parse(s.next_run_at) > now + 30 * 60e3) { results.push({ key, status: 'skipped', reason: 'not_due', next_run_at: s.next_run_at }); continue }
    if (client.clock() >= deadline) { results.push({ key, status: 'skipped', reason: 'time_budget' }); continue }
    const full = { ...rule, id: null, last_run_at: s.last_run_at || null, etag: s.etag || null, last_modified: s.last_modified || null, failure_count: s.failure_count || 0 }
    let r
    try {
      r = await collectRule(full, { fetch: client.politeFetch, clock: client.clock, sleep: client.sleep, limiter: client.limiter, getEnv, aliasIndex, deadline, timeoutMs: 20000 })
    } catch (e) {
      errors.push({ stage: 'web', rule: key, message: String(e?.message || e).slice(0, 300) })
      continue
    }
    const st = ruleState(full, r, client.clock())
    state[key] = { ...s, ...st, last_run_at: r.status === 'error' || r.status === 'skipped' ? s.last_run_at || null : new Date(now).toISOString(), last_status: r.status }
    for (const e of r.errors) errors.push({ stage: 'web_' + e.stage, rule: key, message: e.message, url: e.url, http_status: e.http_status })
    results.push({ key, kind: rule.kind, status: r.status, reason: r.reason, fetched: r.fetched, kept: r.items.length, not_modified: r.not_modified, dropped: r.dropped, errors: r.errors.length })
    // The collector keys known projects by database UUID; here the project ids are archive ids, so the match is
    // made again on the title for the editors' "matches project" hint.
    for (const it of r.items) items.push({ ...it, matched_project: matchAlias(it.title, aliasIndex)?.project_id || null })
  }
  return { results, items, state, errors }
}

/**
 * Merges new §8 items into the stored candidates: one candidate per story (story_key), hits deduplicated by
 * canonical URL, confidence = 0.6 × classifier score + 0.4 × best reliability, status from the score thresholds.
 */
export function mergeCandidates(stored = {}, items = [], { now = Date.now() } = {}) {
  const out = { ...stored }
  const iso = new Date(now).toISOString()
  for (const it of items) {
    const id = 'cand-' + fnv1a(it.keys.story_key).toString(36)
    const c = out[id] || { id, first_seen: iso, hits: [], status: null }
    c.last_seen = iso
    if (!c.hits.some((h) => h.canonical_url === it.canonical_url)) {
      c.hits.push({ provider: it.provider, url: it.url, canonical_url: it.canonical_url, title: it.title, excerpt: it.excerpt, publisher: it.publisher, language: it.language, published_at: it.published_at, source_kind: it.source_kind, reliability: it.reliability })
      c.hits = c.hits.slice(-20)
    }
    if (!c.classification || it.classification.score > c.classification.score) c.classification = it.classification
    c.detected = { ...(c.detected || {}), ...Object.fromEntries(Object.entries(it.detected).filter(([, v]) => v !== null)) }
    const best = Math.max(...c.hits.map((h) => h.reliability || 0))
    c.confidence = confidence(c.classification.score, best)
    c.status = c.status === 'approved' ? 'approved' : statusForScore(c.classification.score)
    c.matched_project = it.matched_project || c.matched_project || null
    out[id] = c
  }
  // Retention: auto-ignored candidates 30 days, others 180 days after they were last seen.
  for (const [id, c] of Object.entries(out)) {
    const days = KEEP_DAYS[c.status] ?? KEEP_DAYS.default
    if (now - Date.parse(c.last_seen || c.first_seen) > days * 86400e3 && c.status !== 'approved') delete out[id]
  }
  return out
}
