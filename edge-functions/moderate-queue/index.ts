// Community moderation worker (v2.0, docs/PLATFORM.md "Moderation"). Called every few minutes by pg_cron (pg_net) with
// the x-aol-cron-secret header (MODERATION_CRON_SECRET). For each pending item (platform_moderation_pending): the rule
// layer, the contextual classifier when ANTHROPIC_API_KEY is set (model MODERATION_MODEL, default claude-opus-5-5),
// then platform_moderation_apply records the result. The database decides what an automatic result may do: text is
// approved only when auto_approve_text is on; photos and submissions always wait for a person. Submissions also get
// a duplicate check against the public index and a link policy check (stored in community_submissions.checks).
// Secrets come from the function's environment only; no content is logged.
import { createClient } from "npm:@supabase/supabase-js@2"
import Anthropic from "npm:@anthropic-ai/sdk"
import { getAdminKey } from "../_shared/media.ts"
import { authorizedSecret } from "../_shared/auth.mjs"
import { rules, decide } from "../_shared/platform/moderation.mjs"
import { classify, DEFAULT_MODEL } from "../_shared/platform/classify.mjs"
import { duplicates, urlPolicy } from "../_shared/platform/submissions.mjs"

const BATCH = 25
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } })

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405)
  if (!authorizedSecret([[Deno.env.get("MODERATION_CRON_SECRET"), req.headers.get("x-aol-cron-secret")]])) return json({ error: "unauthorized" }, 401)
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, getAdminKey(), { auth: { persistSession: false } })
  const key = Deno.env.get("ANTHROPIC_API_KEY")
  const llm = key ? new Anthropic({ apiKey: key }) : null
  const model = Deno.env.get("MODERATION_MODEL") || DEFAULT_MODEL
  const maxLinks = 3
  const { data: items, error } = await admin.rpc("platform_moderation_pending", { p_limit: BATCH })
  if (error) return json({ error: "queue_unavailable" }, 503)
  let index: unknown = null
  const out: Record<string, number> = { approved: 0, needs_review: 0, rejected: 0, errors: 0 }
  for (const it of items || []) {
    const r = rules(it.text_content, { maxLinks })
    let classifier = null
    if (llm && !r.block) {
      try { classifier = await classify(llm, { model, type: it.target_type, text: it.text_content }) } catch (_e) { classifier = { ok: false, error: "api_error" } }
    }
    const d = decide({ rules: r, classifier })
    if (it.target_type === "submission") {
      try {
        if (!index) index = await (await fetch((Deno.env.get("PUBLIC_SITE_URL") || "https://remona8787.github.io") + "/data/index.json", { signal: AbortSignal.timeout(15000) })).json()
        const { data: sub } = await admin.from("community_submissions").select("name,name_en,country_iso2,city,official_url,source_urls").eq("id", it.target_id).single()
        const links = [sub?.official_url, ...(sub?.source_urls || [])].filter(Boolean).map((u: string) => ({ url: u, ...urlPolicy(u) }))
        await admin.from("community_submissions").update({ checks: { duplicates: duplicates(sub || {}, index as never), links, at: new Date().toISOString() } }).eq("id", it.target_id)
      } catch (_e) { /* the editor sees no checks and checks by hand */ }
    }
    const { error: applyError } = await admin.rpc("platform_moderation_apply", { p_type: it.target_type, p_id: it.target_id, p_decision: d.decision, p_categories: { ...d.categories, escalate: d.escalate }, p_model: classifier ? model : "rules" })
    if (applyError) out.errors++
    else out[d.decision]++
  }
  return json({ ok: true, processed: (items || []).length, classifier: llm ? model : null, ...out })
})
