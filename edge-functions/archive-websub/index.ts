// WebSub callback of the media facade archive (docs/ARCHIVE_SPEC.md §2 "websub", §5). Public by design: hubs call it
// without any of our secrets, so it authenticates differently per method:
//  - GET  verification of intent: echoes hub.challenge only for a topic we asked for (pending or active subscription
//         in archive_websub_subscriptions); anything else gets 404 and no challenge.
//  - POST content push: accepted only with a valid HMAC signature (X-Hub-Signature-256, or X-Hub-Signature with
//         sha1/sha256/…) made with the per-subscription secret we gave the hub (verifySignature: crypto.subtle and a
//         constant-time comparison). A missing or wrong signature is acknowledged with the same 202 as a valid push
//         (WebSub §8: a forger learns nothing) but ignored and logged. Bodies over 2 MB are refused.
// The callback URL is WEBSUB_CALLBACK_URL?topic=<feed URL> (archive-collect subscribes with it), so the topic, and
// with it the secret, is known even when the hub sends no Link rel=self header.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2"
import { getAdminKey } from "../_shared/media.ts"
import { handlePush, handleVerification } from "../_shared/archive/service.mjs"
import { pushTopic, signatureHeader } from "../_shared/archive/websub.mjs"
import { readCapped, decodeBody, MAX_BYTES } from "../_shared/archive/http.mjs"

const DB_TIMEOUT_MS = 20000

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } })
}
const text = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } })
const message = (e: unknown) => String((e as { message?: string } | null)?.message || e).slice(0, 300)
const withTimeout = (signal: AbortSignal | null | undefined, ms: number) => signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms)
const dbFetch = (input: string | URL | Request, init: RequestInit = {}) => fetch(input, { ...init, signal: withTimeout(init.signal, DB_TIMEOUT_MS) })

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "GET or POST required" }, 405)
  const url = new URL(req.url)
  try {
    const db: SupabaseClient = createClient(Deno.env.get("SUPABASE_URL")!, getAdminKey(), { auth: { persistSession: false }, global: { fetch: dbFetch } })
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await db.rpc(fn, args)
      if (error) throw new Error(`${fn}: ${error.message}`)
      return data
    }
    if (req.method === "GET") {
      const v = await handleVerification(rpc, url.searchParams)
      return text(v.body, v.status)
    }
    // POST: the size cap before anything is read into memory, then the signature over the exact bytes received.
    const declared = Number(req.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > MAX_BYTES) return json({ error: "payload_too_large" }, 413)
    let bytes: Uint8Array
    try {
      bytes = await readCapped(new Response(req.body, { headers: req.headers }), MAX_BYTES, url.href)
    } catch {
      return json({ error: "payload_too_large" }, 413)
    }
    const readKeywords = async () => {
      const { data, error } = await db.from("archive_keywords").select("term,language,polarity,weight,enabled").eq("enabled", true).limit(10000)
      if (error) throw new Error("archive_keywords: " + error.message)
      return data
    }
    const result = await handlePush({
      rpc, readKeywords,
      topic: pushTopic(url, req.headers),
      body: bytes,
      text: decodeBody(bytes, req.headers.get("content-type")),
      signature: signatureHeader(req.headers),
    })
    // Valid and forged pushes get the same answer; only the database log tells them apart.
    if (result.status === 202) return json({ received: true }, 202)
    return json({ error: "gone" }, result.status)
  } catch (error) {
    return json({ ok: false, error: message(error) }, 500)
  }
})
