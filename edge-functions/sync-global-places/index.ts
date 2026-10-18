// Nationwide/worldwide light places from Wikidata, synced ONCE for every visitor, and the rights checks of their
// photos. Two phases, each with its own cron job (release/launch/install-six-hour-sync.sql):
//  - "places" (the default; aol-global-places-6h, every 6 hours): the same small branch queries as the browser sync,
//    stored in public.discovered_places, which the app reads through the view public.public_discovered_places; the time
//    left goes to photo checks. A failed branch (or one whose answer dropped below half of what it had found) keeps
//    the places it returned last time.
//  - "images" (aol-global-places-images-3h, every 3 hours): only the P18 photo rights checks on Commons (batches of 50),
//    with the whole budget, so every photo is re-checked well within the view's 24-hour verdict lifetime.
// One run at a time: both phases take the same lock (claim_discovered_sync), which expires by itself a minute after
// the budget. Every run is logged to sync_runs (job sync-global-places or sync-global-places-images) with the status
// of each branch, the photo counts and alerts (the same branch failing, or photos deferred, 3 runs in a row).
// Since v0.16 each stored record (compactPlaces, record version 2) also carries the archive facts Wikidata states:
// inception year, country ISO code, architect / creator / operator and state of use (field state source_reported).
// Body (all optional): {"phase": "places"|"images", "budget_ms": 130000, "image_limit": 3000, "branch_timeout_ms": 60000, "force": false}
import { authorizedSecret } from "../_shared/auth.mjs"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"
import { getAdminKey } from "../_shared/media.ts"
import { DEFAULT_POLICY } from "../_shared/live-media.mjs"
import { GLOBAL_SYNC_INTERVAL_MS } from "../_shared/global-places.mjs"
import {
  runServerSync, runServerImages, runAlerts, krFopFromEnv, SERVER_JOB, SERVER_IMAGES_JOB, SERVER_PHASES, ALERT_STREAK, MAX_BUDGET_MS,
} from "../_shared/global-places-server.mjs"

// Wikimedia asks automated clients for a descriptive User-Agent with a way to reach the operator.
const UA = "ArchitectureOfLight/0.15 (https://light-architecture-jihyun.peppydegu2.chatgpt.site; server sync) sync-global-places"
// A logged run that started this long ago and is still "running" was stopped before it could log its end.
const STALE_RUN_MS = 10 * 60 * 1000
// The run lock outlives the budget by this much, so a run the platform stopped does not block the next one for long.
const LOCK_MARGIN_MS = 60 * 1000
// Per-request limits: Commons (each continuation round), WDQS (the branch timeout usually ends it first), database.
const COMMONS_TIMEOUT_MS = 30000
const WDQS_TIMEOUT_MS = 90000
const DB_TIMEOUT_MS = 20000

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

const clamp = (value: unknown, fallback: number, min: number, max: number) => {
  const n = Number(value ?? fallback)
  return Math.min(Math.max(Number.isFinite(n) ? Math.floor(n) : fallback, min), max)
}
const message = (e: unknown) => String((e as { message?: string } | null)?.message || e).slice(0, 300)
const withTimeout = (signal: AbortSignal | null | undefined, ms: number) => signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)

// JSON from Wikidata/Commons with the descriptive User-Agent. A request ends after timeoutMs, or earlier when the
// caller's signal aborts it (a branch timeout or the Wikidata deadline; for Commons, the run's deadline).
async function fetchJSON(url: string, init: RequestInit = {}, timeoutMs = COMMONS_TIMEOUT_MS) {
  const headers = new Headers(init.headers)
  headers.set("User-Agent", UA)
  const res = await fetch(url, { ...init, headers, signal: withTimeout(init.signal, timeoutMs) })
  if (!res.ok) throw new Error("HTTP " + res.status)
  return await res.json()
}
// Database requests (PostgREST) never wait longer than DB_TIMEOUT_MS each.
const dbFetch = (input: string | URL | Request, init: RequestInit = {}) => fetch(input, { ...init, signal: withTimeout(init.signal, DB_TIMEOUT_MS) })

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405)

  const expected = Deno.env.get("MEDIA_CRON_SECRET")
  const supplied = req.headers.get("x-aol-cron-secret")
  const adminExpected = Deno.env.get("MEDIA_ADMIN_SECRET")
  const adminSupplied = req.headers.get("x-aol-media-admin-secret")
  if (!authorizedSecret([[expected, supplied], [adminExpected, adminSupplied]])) {
    return json({ error: "unauthorized" }, 401)
  }

  const started = Date.now()
  const raw = await req.json().catch(() => ({}))
  const body: Record<string, unknown> = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
  const phase = body.phase ?? "places"
  if (phase !== "places" && phase !== "images") return json({ error: "invalid_phase", phases: SERVER_PHASES }, 400)
  const job = phase === "images" ? SERVER_IMAGES_JOB : SERVER_JOB
  // Supabase answers a request that has not responded within 150 s with 504 on every plan (and stops a function at its
  // wall-clock limit), so a run takes at most MAX_BUDGET_MS (130 s): the caller always gets the summary. Photos not
  // reached wait for the next run; the photo phase gives them their own budget.
  const budgetMs = clamp(body.budget_ms, 130000, 10000, MAX_BUDGET_MS)
  const imageLimit = clamp(body.image_limit, 3000, 0, 20000)
  const branchTimeoutMs = clamp(body.branch_timeout_ms, 60000, 5000, 120000)
  const force = body.force === true
  const policy = { ...DEFAULT_POLICY, krFopDisplay: krFopFromEnv(Deno.env.get("MEDIA_KR_FOP_DISPLAY")) }
  // Leave time for the last writes and the log; the branch queries stop early enough for some photo checks.
  const deadline = started + budgetMs - 8000
  const wdqsDeadline = started + Math.max(budgetMs - 30000, Math.floor((budgetMs - 8000) * 0.75))
  // The run's id in sync_runs, also the owner of the run lock (a 409 names the run that holds it).
  const runId = crypto.randomUUID()

  let supabase: SupabaseClient | null = null
  let logged = false
  let locked = false
  try {
    const db: SupabaseClient = supabase = createClient(Deno.env.get("SUPABASE_URL")!, getAdminKey(), { auth: { persistSession: false }, global: { fetch: dbFetch } })
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await db.rpc(fn, args)
      if (error) throw new Error(`${fn}: ${error.message}`)
      return data
    }

    // Atomic: of two runs started together (the cron and a manual run) exactly one gets the lock. force takes it from
    // a run that still holds it (the older run's writes never replace newer rows, see apply_discovered_places).
    const claim = await rpc("claim_discovered_sync", { p_job: SERVER_JOB, p_owner: runId, p_lease_seconds: Math.ceil((budgetMs + LOCK_MARGIN_MS) / 1000), p_force: force })
    if (!claim?.ok) return json({ ok: false, error: "already_running", phase, run: claim?.owner ?? null, locked_at: claim?.locked_at ?? null, expires_at: claim?.expires_at ?? null }, 409)
    locked = true

    const now = new Date(started).toISOString()
    // A run the platform stopped (time limit) never logged its end: close it so the log does not say "running" forever.
    const { error: staleError } = await db.from("sync_runs").update({ status: "failed", finished_at: now, error_message: "did not finish (stopped before it could log, e.g. by the time limit)" })
      .eq("job_name", job).eq("status", "running").lt("started_at", new Date(started - STALE_RUN_MS).toISOString())
    if (staleError) throw staleError
    // The runs before this one, newest first, for the alerts.
    const { data: history, error: historyError } = await db.from("sync_runs").select("status,metadata")
      .eq("job_name", job).neq("status", "running").order("started_at", { ascending: false }).limit(ALERT_STREAK - 1)
    if (historyError) throw historyError
    const settings = { phase, kr_fop_display: policy.krFopDisplay, budget_ms: budgetMs, image_limit: imageLimit }
    const { error: runError } = await db.from("sync_runs").insert({
      id: runId,
      provider: phase === "images" ? "wikimedia_commons" : "wikidata",
      job_name: job,
      status: "running",
      started_at: now,
      metadata: settings,
    })
    if (runError) throw runError
    logged = true

    const store = {
      applyPlaces: (rows: unknown[], seenAt: string) => rpc("apply_discovered_places", { p_rows: rows, p_seen_at: seenAt }),
      prune: (seenAt: string, failedBranches: string[]) => rpc("prune_discovered_places", { p_seen_at: seenAt, p_failed_branches: failedBranches }),
      branchCounts: (seenAt: string) => rpc("discovered_branch_counts", { p_seen_at: seenAt }),
      imagesDue: (limit: number, checkedBefore: string, krFop: boolean) => rpc("discovered_images_due", { p_limit: limit, p_checked_before: checkedBefore, p_kr_fop: krFop }),
      setMedia: (rows: unknown[], checkedAt: string, krFop: boolean) => rpc("set_discovered_media", { p_rows: rows, p_checked_at: checkedAt, p_kr_fop: krFop }),
    }
    const fetchCommons = (url: string, init?: RequestInit) => fetchJSON(url, init, COMMONS_TIMEOUT_MS)

    let summary: Record<string, unknown>
    let status: "success" | "partial" | "failed"
    let errors: (string | null)[]
    let alerts: string[]
    let counts: { fetched_count: number; inserted_count: number; updated_count: number; flagged_count: number }
    if (phase === "images") {
      const result = await runServerImages({ fetchCommons, store, now, policy, deadline, imageLimit })
      alerts = runAlerts({ phase, result, history })
      status = result.status
      errors = [result.images.error]
      counts = { fetched_count: result.images.due, inserted_count: 0, updated_count: result.images.updated, flagged_count: result.images.blocked }
      summary = { images: result.images }
    } else {
      const result = await runServerSync({
        fetchWdqs: (url: string, init?: RequestInit) => fetchJSON(url, init, WDQS_TIMEOUT_MS),
        fetchCommons, store, now, policy, deadline, wdqsDeadline, imageLimit, branchTimeoutMs,
        // The run's 6-hour slot: the branch start order rotates by one place per run.
        rotation: Math.floor(started / GLOBAL_SYNC_INTERVAL_MS),
      })
      alerts = runAlerts({ phase, result, history })
      const failedBranches = result.branches.filter((b) => !b.ok).map((b) => b.id)
      const suspect = result.branches.filter((b) => b.ok && b.suspect).map((b) => `${b.id} (${b.rows} of ${b.stored})`)
      status = result.status
      errors = [
        result.error,
        result.images.error,
        failedBranches.length ? `failed branches: ${failedBranches.join(", ")}` : null,
        suspect.length ? `branches below half of their stored places, kept: ${suspect.join(", ")}` : null,
      ]
      counts = {
        fetched_count: result.stats?.places ?? 0,
        inserted_count: result.stats?.upserted ?? 0,
        updated_count: result.images.updated,
        flagged_count: failedBranches.length + suspect.length + result.images.blocked,
      }
      summary = { error: result.error, branches: result.branches, stats: result.stats, images: result.images }
    }

    const { error: logError } = await db.from("sync_runs").update({
      finished_at: new Date().toISOString(),
      status,
      ...counts,
      error_message: [...errors, ...alerts].filter(Boolean).join("; ").slice(0, 2000) || null,
      metadata: { ...settings, ms: Date.now() - started, alerts, ...summary },
    }).eq("id", runId)
    if (logError) throw logError

    return json({ ok: status !== "failed", run: runId, phase, status, alerts, ...summary }, status === "failed" ? 502 : 200)
  } catch (error) {
    const text = message(error)
    if (supabase && logged) {
      try {
        await supabase.from("sync_runs").update({ finished_at: new Date().toISOString(), status: "failed", error_message: text }).eq("id", runId)
      } catch { /* the response still reports the error */ }
    }
    return json({ ok: false, run: logged ? runId : null, phase, error: text }, 500)
  } finally {
    if (supabase && locked) {
      try { await supabase.rpc("release_discovered_sync", { p_job: SERVER_JOB, p_owner: runId }) } catch { /* the lock expires by itself */ }
    }
  }
})
