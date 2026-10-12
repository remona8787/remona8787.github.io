import { authorizedSecret } from "../_shared/auth.mjs"
import { createClient } from "npm:@supabase/supabase-js@2"
import { fetchCommonsInfo } from "../_shared/commons.ts"
import { cacheCommonsAsset, getAdminKey } from "../_shared/media.ts"
import { buildPlaceQuery, parsePlaceQuery, WDQS_URL, DEFAULT_POLICY } from "../_shared/live-media.mjs"

const UA = "ArchitectureOfLight/0.14 (https://light-architecture-jihyun.peppydegu2.chatgpt.site)"

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

function norm(s: string) {
  return (s || "").toLowerCase().replace(/[()[\]{}\/·,:;'"“”‘’\-–—]/g, " ").replace(/\s+/g, " ").trim()
}

function tokens(s: string) {
  const stop = new Set(["서울","seoul","the","museum","미술관","센터","center","art","아트","문화","gallery","갤러리","light","architecture"])
  return norm(s).split(" ").filter((x) => x.length >= 2 && !stop.has(x))
}

function score(a: string, b: string) {
  const aa = norm(a), bb = norm(b)
  if (!aa || !bb) return 0
  if (aa === bb) return 100
  if (aa.includes(bb) || bb.includes(aa)) return 86
  const A = new Set(tokens(aa)), B = new Set(tokens(bb))
  let hit = 0
  for (const x of A) if (B.has(x)) hit++
  return hit ? Math.min(78, 28 + hit * 17) : 0
}

async function commonsSearch(names: string[]) {
  const candidates: any[] = []
  for (const q of names.slice(0,2)) {
    try {
      const params = new URLSearchParams({
        action:"query", format:"json", origin:"*",
        generator:"search", gsrnamespace:"6", gsrlimit:"10", gsrsearch:q,
      })
      const r = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`).then((x)=>x.json())
      for (const page of Object.values(r?.query?.pages || {}) as any[]) {
        const file = String(page.title || "").replace(/^File:/,"")
        if (!file) continue
        let rel = 0
        for (const n of names) rel = Math.max(rel, score(page.title || "", n))
        if (rel >= 24) candidates.push({ file, score: Math.min(94, 48 + Math.round(rel * .45)), via:"Commons search" })
      }
    } catch {}
  }
  return candidates
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

  try {
    const body = await req.json().catch(()=>({}))
    // Exact Wikidata matches: every published place, every run (one SPARQL query). Images cached per run are capped.
    const imageLimit = Math.min(Math.max(Number(body.limit || 60), 1), 150)
    // Places without an exact match: a few per run go through Commons search into the editorial review queue.
    const candidateLimit = Math.min(Math.max(Number(body.candidate_limit ?? 5), 0), 20)
    const placeCode = body.place_code ? String(body.place_code) : null
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getAdminKey(), { auth:{persistSession:false} })

    let query = supabase
      .from("places")
      .select("id,place_code,name_kr,name_en,mvp_priority,last_media_discovery_at")
      .eq("is_published", true)
      .order("last_media_discovery_at", { ascending:true, nullsFirst:true })
      .order("mvp_priority", { ascending:true })
    if (placeCode) query = query.eq("place_code", placeCode)
    const { data: places, error } = await query
    if (error) throw error

    const { data: run } = await supabase.from("sync_runs").insert({
      provider:"wikimedia_commons",
      job_name:"sync-place-media",
      status:"running",
    }).select().single()

    let fetched=0, inserted=0, flagged=0, cachedImages=0
    const result:any[]=[]
    const list=(places||[]).map((p:any)=>({...p,place_id:p.place_code}))

    const wdRes = await fetch(WDQS_URL, {
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded",Accept:"application/sparql-results+json","User-Agent":UA},
      body:new URLSearchParams({query:buildPlaceQuery(list),format:"json"}),
      signal:AbortSignal.timeout(30000),
    })
    if (!wdRes.ok) throw new Error(`Wikidata query HTTP ${wdRes.status}`)
    const matches = parsePlaceQuery(await wdRes.json(), list)

    const now = new Date().toISOString()
    let candidatesLeft = candidateLimit
    for (const place of list) {
      const m = matches.get(place.place_code)
      const cached:any[] = []
      if (m) {
        // Exact, unambiguous Wikidata match: publish automatically if the file passes the rights check.
        const files = m.images.slice(0, DEFAULT_POLICY.maxImagesPerPlace)
        for (let i=0;i<files.length && cachedImages<imageLimit;i++) {
          try {
            const r = await cacheCommonsAsset(supabase,{placeCode:place.place_code,commonsFile:files[i],relevanceScore:98,isCover:i===0,displayOrder:i,reviewed:true,reason:"wikidata_exact_match"})
            fetched++; cachedImages++
            inserted += r.cached ? 1 : 0
            if (r.clearanceStatus !== "cleared") flagged++
            cached.push({file:files[i],via:`Wikidata ${m.qid}`,clearance:r.clearanceStatus})
          } catch (e) {
            flagged++
            cached.push({file:files[i],error:String((e as {message?: string} | null)?.message || e)})
          }
        }
      } else if (candidatesLeft > 0) {
        // No exact match: Commons search results only ever enter the review queue (never auto-published).
        candidatesLeft--
        const names=[place.name_kr,place.name_en].filter(Boolean)
        for (const c of (await commonsSearch(names)).sort((a,b)=>b.score-a.score).slice(0,3)) {
          try {
            const r = await cacheCommonsAsset(supabase,{placeCode:place.place_code,commonsFile:c.file,relevanceScore:c.score,reviewed:false,reason:"commons_search_candidate"})
            fetched++
            if (r.clearanceStatus !== "cleared") flagged++
            cached.push({file:c.file,via:c.via,clearance:r.clearanceStatus})
          } catch (e) {
            flagged++
            cached.push({file:c.file,error:String((e as {message?: string} | null)?.message || e)})
          }
        }
      } else continue
      const {error:rotationError}=await supabase.from("places").update({last_media_discovery_at:now}).eq("id",place.id)
      if(rotationError)throw rotationError
      result.push({place_code:place.place_code,wikidata:m?.qid||null,cached})
    }

    if (run?.id) {
      await supabase.from("sync_runs").update({
        finished_at:new Date().toISOString(),
        status:"success",
        fetched_count:fetched,
        inserted_count:inserted,
        flagged_count:flagged,
        metadata:{matched:matches.size,places:result},
      }).eq("id",run.id)
    }

    return json({ok:true,matched:matches.size,places:result,fetched,inserted,flagged})
  } catch (error) {
    return json({ok:false,error:String((error as {message?: string} | null)?.message || error)},500)
  }
})
