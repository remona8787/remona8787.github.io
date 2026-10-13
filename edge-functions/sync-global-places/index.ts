// Nationwide/worldwide light places from Wikidata, synced ONCE every 6 hours for every visitor (cron job
// aol-global-places-6h). Runs the same small branch queries as the browser sync, rights-checks the P18 photos on
// Commons in batches of 50, and stores the result in public.discovered_places, which the app reads through the view
// public.public_discovered_places. A failed branch keeps the places it returned last time; every run is logged to
// sync_runs with the status of each branch.
// Body (all optional): {"budget_ms": 130000, "image_limit": 3000, "branch_timeout_ms": 60000, "force": false}
import { authorizedSecret } from "../_shared/auth.mjs"
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"
import { getAdminKey } from "../_shared/media.ts"
import { DEFAULT_POLICY } from "../_shared/live-media.mjs"
import { runServerSync, krFopFromEnv, SERVER_JOB } from "../_shared/global-places-server.mjs"

// Wikimedia asks automated clients for a descriptive User-Agent with a way to reach the operator.
const UA = "ArchitectureOfLight/0.15 (https://light-architecture-jihyun.peppydegu2.chatgpt.site; server sync) sync-global-places"
// A run that started less than this long ago and never finished counts as still running (a crashed run is not waited for).
const RUNNING_WINDOW_MS = 10 * 60 * 1000

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

// JSON from Wikidata/Commons with the descriptive User-Agent. WDQS requests carry the branch's own timeout signal;
// Commons requests get 30 s each.
async function fetchJSON(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  headers.set("User-Agent", UA)
  const signal = init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(30000)
  const res = await fetch(url, { ...init, headers, signal })
  if (!res.ok) throw new Error("HTTP " + res.status)
  return await res.json()
}

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
  // Supabase answers a request that has not responded within 150 s with 504, and stops a function after its wall-clock
  // limit (150 s on the free plan): by default the run takes at most ~130 s. Photos not reached wait for the next run.
  const budgetMs = clamp(body.budget_ms, 130000, 20000, 380000)
  const imageLimit = clamp(body.image_limit, 3000, 0, 20000)
  const branchTimeoutMs = clamp(body.branch_timeout_ms, 60000, 5000, 120000)
  const policy = { ...DEFAULT_POLICY, krFopDisplay: krFopFromEnv(Deno.env.get("MEDIA_KR_FOP_DISPLAY")) }

  let runId: string | null = null
  let supabase: SupabaseClient | null = null
  try {
    const db: SupabaseClient = supabase = createClient(Deno.env.get("SUPABASE_URL")!, getAdminKey(), { auth: { persistSession: false } })
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await db.rpc(fn, args)
      if (error) throw new Error(`${fn}: ${error.message}`)
      return data
    }

    if (body.force !== true) {
      const { data: running, error } = await db.from("sync_runs").select("id,started_at")
        .eq("job_name", SERVER_JOB).eq("status", "running")
        .gt("started_at", new Date(started - RUNNING_WINDOW_MS).toISOString()).limit(1)
      if (error) throw error
      if (running?.length) return json({ ok: false, error: "already_running", run: running[0].id }, 409)
    }

    const now = new Date(started).toISOString()
    // A run the platform stopped (time limit) never logged its end: close it so the log does not say "running" forever.
    const { error: staleError } = await db.from("sync_runs").update({ status: "failed", finished_at: now, error_message: "did not finish (stopped before it could log, e.g. by the time limit)" })
      .eq("job_name", SERVER_JOB).eq("status", "running").lt("started_at", new Date(started - RUNNING_WINDOW_MS).toISOString())
    if (staleError) throw staleError
    const { data: run, error: runError } = await db.from("sync_runs").insert({
      provider: "wikidata",
      job_name: SERVER_JOB,
      status: "running",
      started_at: now,
      metadata: { kr_fop_display: policy.krFopDisplay, budget_ms: budgetMs, image_limit: imageLimit },
    }).select("id").single()
    if (runError) throw runError
    runId = run?.id ?? null

    const result = await runServerSync({
      fetchWdqs: fetchJSON,
      fetchCommons: (url: string) => fetchJSON(url),
      store: {
        applyPlaces: (rows, seenAt) => rpc("apply_discovered_places", { p_rows: rows, p_seen_at: seenAt }),
        prune: (seenAt, failedBranches) => rpc("prune_discovered_places", { p_seen_at: seenAt, p_failed_branches: failedBranches }),
        imagesDue: (limit, checkedBefore, krFop) => rpc("discovered_images_due", { p_limit: limit, p_checked_before: checkedBefore, p_kr_fop: krFop }),
        setMedia: (rows, checkedAt, krFop) => rpc("set_discovered_media", { p_rows: rows, p_checked_at: checkedAt, p_kr_fop: krFop }),
      },
      now,
      policy,
      // Leave time for the last writes and the log; the branch queries stop early enough for some photo checks.
      deadline: started + budgetMs - 8000,
      wdqsDeadline: started + Math.max(budgetMs - 30000, 15000),
      imageLimit,
      branchTimeoutMs,
    })

    const failedBranches = result.branches.filter((b) => !b.ok)
    const { error: logError } = await db.from("sync_runs").update({
      finished_at: new Date().toISOString(),
      status: result.status,
      fetched_count: result.stats?.places ?? 0,
      inserted_count: result.stats?.upserted ?? 0,
      updated_count: result.images.updated,
      flagged_count: failedBranches.length + result.images.blocked,
      error_message: result.error || result.images.error || (failedBranches.length ? `failed branches: ${failedBranches.map((b) => b.id).join(", ")}` : null),
      metadata: { kr_fop_display: policy.krFopDisplay, budget_ms: budgetMs, image_limit: imageLimit, ms: Date.now() - started, branches: result.branches, stats: result.stats, images: result.images },
    }).eq("id", runId)
    if (logError) throw logError

    return json({ ok: result.status !== "failed", run: runId, ...result }, result.status === "failed" ? 502 : 200)
  } catch (error) {
    const text = message(error)
    if (supabase && runId) {
      try {
        await supabase.from("sync_runs").update({ finished_at: new Date().toISOString(), status: "failed", error_message: text }).eq("id", runId)
      } catch { /* the response still reports the error */ }
    }
    return json({ ok: false, run: runId, error: text }, 500)
  }
})
