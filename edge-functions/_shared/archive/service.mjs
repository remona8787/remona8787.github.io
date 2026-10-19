// What the archive Edge Functions do with the database (docs/ARCHIVE_SPEC.md §4 service API, §5), written against an
// injected rpc(fn, args) and plain reads, so Node tests, Deno tests and the functions run the same code.
//  - runCollect (archive-collect): claim due rules (or the rules an editor asked for), run each through the pipeline,
//    log every error, ingest the items, record Wikidata changes, finish each run with its rule state, subscribe to
//    hubs that feeds advertise, and renew WebSub leases that end within 48 hours. dry_run reads and fetches only.
//  - handlePush (archive-websub POST): verify the signature, then parse and ingest the pushed feed as trigger websub.
//  - handleVerification (archive-websub GET): the hub's verification of intent.

import { collectRule, buildItems, ruleState, labelCounts, collectorLimiter } from './pipeline.mjs'
import { compileKeywords, defaultKeywords } from './classify.mjs'
import { buildAliasIndex } from './normalize.mjs'
import { parseFeed, feedRecords } from './adapters/rss.mjs'
import { verifySignature, verifyIntent, sendSubscription, callbackFor, newSecret, DEFAULT_LEASE_SECONDS, RENEW_WITHIN_HOURS } from './websub.mjs'
import { defaultSleep, errorText } from './http.mjs'

export const MAX_RULES = 6
export const INGEST_CHUNK = 500
// Leave this much of the budget for the last writes; a rule is not started with less than RULE_MIN_MS left.
export const BUDGET_MARGIN_MS = 10000
export const RULE_MIN_MS = 20000
export const MAX_RENEWALS = 20
// A claimed rule that had no time left in this run is finished as skipped and comes back within the hour.
export const RETRY_SOON_MS = 10 * 60 * 1000

/**
 * @typedef {(fn: string, args: Record<string, unknown>) => Promise<any>} Rpc
 * @typedef {import('./pipeline.mjs').Rule & {id: string}} DbRule
 */

/**
 * Keywords: the database's enabled rows when there are any (an admin's edits apply), else the seed list.
 * @param {(() => Promise<any[]|null>)|null|undefined} readKeywords
 */
async function loadKeywords(readKeywords) {
  if (!readKeywords) return { compiled: defaultKeywords(), source: 'seed', error: null }
  try {
    const rows = await readKeywords()
    if (Array.isArray(rows) && rows.length) return { compiled: compileKeywords(rows), source: 'database', error: null }
    return { compiled: defaultKeywords(), source: 'seed', error: null }
  } catch (e) {
    return { compiled: defaultKeywords(), source: 'seed', error: errorText(e) }
  }
}

/** Sums archive_ingest answers over chunks. @param {any[]} answers */
function sumIngest(answers) {
  const out = { kept: 0, new_candidates: 0, matched_projects: 0, duplicates: 0, ignored: 0 }
  for (const a of answers) for (const k of Object.keys(out)) out[/** @type {keyof typeof out} */ (k)] += Number(a?.[k]) || 0
  return out
}

/**
 * @param {Rpc} rpc @param {string|null} runId @param {string|null} ruleId @param {import('./pipeline.mjs').RunError[]} errors
 */
async function logErrors(rpc, runId, ruleId, errors) {
  for (const e of errors.slice(0, 50)) {
    await rpc('archive_log_error', { p_run_id: runId, p_rule_id: ruleId, p_stage: e.stage, p_http: e.http_status, p_message: e.message.slice(0, 1000), p_url: e.url ? String(e.url).slice(0, 2000) : null })
  }
}

/**
 * Subscribes to a hub for a topic unless a pending or active subscription exists (WebSub §5.1). The row is written
 * as pending BEFORE the request, so the hub's verification GET finds the topic.
 * @param {Rpc} rpc @param {{topic: string, hub: string, ruleId: string|null, callbackBase: string, policy: object, renew?: boolean}} o
 */
export async function subscribe(rpc, { topic, hub, ruleId, callbackBase, policy, renew = false }) {
  const existing = await rpc('archive_websub_get', { p_topic: topic })
  if (!renew && existing && (existing.state === 'pending' || existing.state === 'active')) return { topic, action: 'exists', ok: true, error: null }
  const secret = existing?.secret || newSecret()
  const hubUrl = hub || existing?.hub
  if (!hubUrl) return { topic, action: 'no_hub', ok: false, error: 'no hub' }
  await rpc('archive_websub_upsert', { p_topic: topic, p_hub: hubUrl, p_secret: secret, p_state: 'pending', p_lease_seconds: null, p_rule_id: ruleId })
  const res = await sendSubscription({ hub: hubUrl, topic, callback: callbackFor(callbackBase, topic), secret, leaseSeconds: DEFAULT_LEASE_SECONDS }, policy)
  if (!res.ok) await rpc('archive_websub_upsert', { p_topic: topic, p_hub: null, p_secret: null, p_state: 'failed', p_lease_seconds: null, p_rule_id: null })
  return { topic, action: renew ? 'renew' : 'subscribe', ok: res.ok, error: res.error }
}

/**
 * @param {object} o
 * @param {Rpc} o.rpc
 * @param {(q: {ruleIds: string[]|null, limit: number}) => Promise<DbRule[]>} o.readRules  read-only rule lookup (dry runs)
 * @param {() => Promise<any[]|null>} [o.readKeywords]
 * @param {(input: string, init?: RequestInit) => Promise<Response>} [o.fetch]
 * @param {() => number} [o.clock]
 * @param {(ms: number) => Promise<void>} [o.sleep]
 * @param {(name: string) => string|undefined|null} [o.getEnv]
 * @param {'cron'|'admin'} o.trigger
 * @param {string[]|null} [o.ruleIds]
 * @param {number} [o.maxRules]
 * @param {boolean} [o.dryRun]
 * @param {string} o.owner
 * @param {number} [o.deadline]
 */
export async function runCollect({ rpc, readRules, readKeywords, fetch, clock = Date.now, sleep = defaultSleep, getEnv = () => undefined, trigger, ruleIds = null, maxRules = MAX_RULES, dryRun = false, owner, deadline = Infinity }) {
  const limit = Math.max(1, Math.min(MAX_RULES, Math.floor(maxRules) || MAX_RULES))
  const rules = /** @type {DbRule[]} */ (dryRun
    ? await readRules({ ruleIds, limit })
    : await rpc('archive_claim_due_rules', { p_limit: limit, p_owner: owner, p_rule_ids: ruleIds && ruleIds.length ? ruleIds : null })) || []
  const aliasRows = (await rpc('archive_alias_index', {})) || []
  const aliasIndex = buildAliasIndex(aliasRows)
  const wikidataProjects = aliasRows.filter((/** @type {any} */ r) => r?.wikidata_qid).map((/** @type {any} */ r) => ({ project_id: String(r.project_id), wikidata_qid: String(r.wikidata_qid) }))
  const kw = await loadKeywords(readKeywords)
  const limiter = collectorLimiter(clock, sleep)
  const policy = { fetch, clock, sleep, limiter }
  const callbackBase = String(getEnv('WEBSUB_CALLBACK_URL') || '').trim() || null
  /** @type {any[]} */
  const summaries = []
  /** @type {any[]} */
  const websub = []
  for (const rule of rules) {
    const now = clock()
    if (now > deadline - RULE_MIN_MS) {
      // No time left: hand the claim back so the rule runs again within the hour.
      if (!dryRun) {
        const runId = await rpc('archive_start_run', { p_rule_id: rule.id, p_trigger: trigger })
        await rpc('archive_finish_run', { p_run_id: runId, p_status: 'skipped', p_counts: { fetched: 0, errors: 0, reason: 'time_budget' }, p_rule_state: { next_run_at: new Date(now + RETRY_SOON_MS).toISOString() } })
      }
      summaries.push({ rule_id: rule.id, name: rule.name, kind: rule.kind, status: 'skipped', reason: 'time_budget' })
      continue
    }
    let runId = null
    try {
      if (!dryRun) runId = await rpc('archive_start_run', { p_rule_id: rule.id, p_trigger: trigger })
      const result = await collectRule(rule, { ...policy, getEnv, keywords: kw.compiled, aliasIndex, wikidataProjects, deadline: deadline - BUDGET_MARGIN_MS })
      /** @type {Record<string, number>} */
      let ingest = { kept: 0, new_candidates: 0, matched_projects: 0, duplicates: 0, ignored: 0 }
      let updates = 0
      if (!dryRun) {
        await logErrors(rpc, runId, rule.id, result.errors)
        const answers = []
        for (let i = 0; i < result.items.length; i += INGEST_CHUNK) answers.push(await rpc('archive_ingest', { p_run_id: runId, p_items: result.items.slice(i, i + INGEST_CHUNK) }))
        ingest = sumIngest(answers)
        for (const u of result.project_updates) {
          await rpc('archive_record_project_update', { p_project_id: u.project_id, p_kind: 'wikidata_changed', p_detail: { qid: u.qid, date_modified: u.date_modified, values: u.values, since: rule.last_run_at ?? null, rule_id: rule.id } })
          updates++
        }
        const state = ruleState(rule, result, clock())
        // archive_finish_run: counts given here replace what archive_ingest accumulated, so only the collector's own
        // counts are passed; other keys are kept in the run's detail.
        await rpc('archive_finish_run', {
          p_run_id: runId, p_status: result.status,
          p_counts: { fetched: result.fetched, errors: result.errors.length, dropped: result.dropped, labels: labelCounts(result.items), not_modified: result.not_modified, reason: result.reason, classifier: kw.compiled.version, project_updates: updates },
          p_rule_state: state,
        })
        if (result.websub && callbackBase && rule.kind === 'rss') {
          try { websub.push(await subscribe(rpc, { topic: result.websub.self || /** @type {string} */ (rule.url), hub: result.websub.hub, ruleId: rule.id, callbackBase, policy })) }
          catch (e) { websub.push({ topic: result.websub.self, action: 'subscribe', ok: false, error: errorText(e) }) }
        }
      }
      summaries.push({
        rule_id: rule.id, name: rule.name, kind: rule.kind, run_id: runId, status: result.status, reason: result.reason, fetched: result.fetched,
        items: result.items.length, ingest, project_updates: dryRun ? result.project_updates.length : updates, dropped: result.dropped, labels: labelCounts(result.items),
        errors: result.errors.map((e) => ({ stage: e.stage, http_status: e.http_status, message: e.message.slice(0, 300) })), websub_hub: result.websub?.hub ?? null,
        ...(dryRun ? { sample: [...result.items].sort((a, b) => b.classification.score - a.classification.score).slice(0, 10).map((i) => ({ title: i.title, url: i.canonical_url, label: i.classification.label, score: i.classification.score, source_kind: i.source_kind, detected: i.detected, keys: i.keys })) } : {}),
      })
    } catch (e) {
      // A database failure for one rule: record it and hand the claim back, then go on with the next rule.
      const message = errorText(e)
      if (runId) {
        try { await rpc('archive_log_error', { p_run_id: runId, p_rule_id: rule.id, p_stage: 'ingest', p_http: null, p_message: message, p_url: null }) } catch { /* reported below */ }
        try { await rpc('archive_finish_run', { p_run_id: runId, p_status: 'error', p_counts: { errors: 1 }, p_rule_state: {} }) } catch { /* the claim expires after 30 minutes */ }
      }
      summaries.push({ rule_id: rule.id, name: rule.name, kind: rule.kind, run_id: runId, status: 'error', errors: [{ stage: 'database', http_status: null, message }] })
    }
  }
  // Lease renewals (and retries of failed or unverified subscriptions), only for real runs with a callback URL.
  if (!dryRun && callbackBase && clock() < deadline - RULE_MIN_MS) {
    const due = (await rpc('archive_websub_due', { p_within_hours: RENEW_WITHIN_HOURS })) || []
    for (const sub of due.slice(0, MAX_RENEWALS)) {
      if (clock() > deadline - BUDGET_MARGIN_MS) break
      try { websub.push(await subscribe(rpc, { topic: sub.topic, hub: sub.hub, ruleId: sub.rule_id ?? null, callbackBase, policy, renew: true })) }
      catch (e) { websub.push({ topic: sub.topic, action: 'renew', ok: false, error: errorText(e) }) }
    }
  }
  return { rules: summaries, websub, keywords: { source: kw.source, version: kw.compiled.version, error: kw.error }, aliases: aliasIndex.entries.length, websub_enabled: !!callbackBase }
}

/**
 * The hub's GET (WebSub §5.3). Known pending/active topic → 200 with the challenge, and the subscription becomes
 * active with the hub's lease (subscribe) or expired (unsubscribe); a denial marks it failed.
 * @param {Rpc} rpc @param {URLSearchParams} params
 */
export async function handleVerification(rpc, params) {
  const topic = params.get('hub.topic')
  const sub = topic ? await rpc('archive_websub_get', { p_topic: topic }) : null
  const v = verifyIntent(params, sub || null)
  if (v.status === 200 && sub) {
    const state = v.mode === 'subscribe' ? 'active' : v.mode === 'unsubscribe' ? 'expired' : 'failed'
    await rpc('archive_websub_upsert', { p_topic: topic, p_hub: null, p_secret: null, p_state: state, p_lease_seconds: v.mode === 'subscribe' ? v.leaseSeconds ?? DEFAULT_LEASE_SECONDS : null, p_rule_id: null })
  }
  return v
}

/**
 * A content push (WebSub §8). Unknown or ended topics answer 410 (the hub stops); a missing or wrong signature is
 * acknowledged like a valid push (202, so a forger learns nothing) but ignored and logged. A valid push is parsed
 * and ingested as a websub run of the subscription's rule.
 * @param {object} o
 * @param {Rpc} o.rpc
 * @param {string|null} o.topic
 * @param {Uint8Array} o.body
 * @param {string} o.text the decoded body
 * @param {string|null} o.signature X-Hub-Signature(-256) value
 * @param {() => Promise<any[]|null>} [o.readKeywords]
 * @param {() => number} [o.clock]
 * @returns {Promise<{status: number, accepted: boolean, reason: string|null, run_id?: string|null, ingest?: any}>}
 */
export async function handlePush({ rpc, topic, body, text, signature, readKeywords, clock = Date.now }) {
  const sub = topic ? await rpc('archive_websub_get', { p_topic: topic }) : null
  if (!sub || (sub.state !== 'active' && sub.state !== 'pending')) return { status: 410, accepted: false, reason: sub ? 'state_' + sub.state : 'unknown_topic' }
  const check = await verifySignature(body, signature, sub.secret)
  if (!check.ok) {
    await rpc('archive_log_error', { p_run_id: null, p_rule_id: sub.rule_id ?? null, p_stage: 'websub', p_http: null, p_message: `push ignored: ${check.reason}`, p_url: topic })
    return { status: 202, accepted: false, reason: check.reason }
  }
  const runId = await rpc('archive_start_run', { p_rule_id: sub.rule_id ?? null, p_trigger: 'websub' })
  try {
    let feed
    try { feed = parseFeed(text, { now: clock() }) } catch (e) {
      await rpc('archive_log_error', { p_run_id: runId, p_rule_id: sub.rule_id ?? null, p_stage: 'parse', p_http: null, p_message: errorText(e), p_url: topic })
      await rpc('archive_finish_run', { p_run_id: runId, p_status: 'error', p_counts: { fetched: 0, errors: 1 }, p_rule_state: {} })
      return { status: 202, accepted: true, reason: 'parse_error', run_id: runId }
    }
    const records = feedRecords(feed, { provider: 'websub', feedUrl: topic })
    const kw = await loadKeywords(readKeywords)
    const aliasIndex = buildAliasIndex((await rpc('archive_alias_index', {})) || [])
    const built = buildItems(records, { rule: { id: sub.rule_id ?? null, kind: 'websub' }, now: clock(), keywords: kw.compiled, aliasIndex })
    await logErrors(rpc, runId, sub.rule_id ?? null, built.errors)
    const answers = []
    for (let i = 0; i < built.items.length; i += INGEST_CHUNK) answers.push(await rpc('archive_ingest', { p_run_id: runId, p_items: built.items.slice(i, i + INGEST_CHUNK) }))
    const ingest = sumIngest(answers)
    await rpc('archive_finish_run', { p_run_id: runId, p_status: built.errors.length ? 'partial' : 'success', p_counts: { fetched: records.length, errors: built.errors.length, dropped: built.dropped, labels: labelCounts(built.items), classifier: kw.compiled.version }, p_rule_state: {} })
    return { status: 202, accepted: true, reason: null, run_id: runId, ingest }
  } catch (e) {
    try { await rpc('archive_finish_run', { p_run_id: runId, p_status: 'error', p_counts: { errors: 1 }, p_rule_state: {} }) } catch { /* nothing more to do */ }
    throw e
  }
}
