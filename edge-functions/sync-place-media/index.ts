import { authorizedSecret } from "../_shared/auth.mjs"
import { createClient } from "npm:@supabase/supabase-js@2"
import { fetchCommonsInfo } from "../_shared/commons.ts"
import { cacheCommonsAsset, getAdminKey } from "../_shared/media.ts"

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

async function wikidataP18(names: string[]) {
  for (const q of names) {
    try {
      const params = new URLSearchParams({
        action: "wbsearchentities", format: "json", origin: "*",
        language: /[가-힣]/.test(q) ? "ko" : "en",
        uselang: "ko", limit: "5", search: q,
      })
      const sr = await fetch(`https://www.wikidata.org/w/api.php?${params}`).then((r) => r.json())
      const hit = (sr.search || []).sort((a: any,b: any) => {
        const sa = Math.max(...names.map((n) => score(a.label || "", n)))
        const sb = Math.max(...names.map((n) => score(b.label || "", n)))
        return sb - sa
      })[0]
      if (!hit) continue
      const best = Math.max(...names.map((n) => score(hit.label || "", n)))
      if (best < 48) continue

      const gp = new URLSearchParams({
        action: "wbgetentities", format: "json", origin: "*",
        props: "claims", ids: hit.id,
      })
      const gr = await fetch(`https://www.wikidata.org/w/api.php?${gp}`).then((r) => r.json())
      const e = gr.entities?.[hit.id]
      const p18 = e?.claims?.P18?.[0]?.mainsnak?.datavalue?.value
      if (p18) return { file: String(p18), score: 98, via: "Wikidata P18" }
    } catch {}
  }
  return null
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
    const limit = Math.min(Math.max(Number(body.limit || 5), 1), 20)
    const placeCode = body.place_code ? String(body.place_code) : null
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, getAdminKey(), { auth:{persistSession:false} })

    let query = supabase
      .from("places")
      .select("id,place_code,name_kr,name_en,mvp_priority")
      .eq("is_published", true)
      .order("last_media_discovery_at", { ascending:true, nullsFirst:true })
      .order("mvp_priority", { ascending:true })
      .limit(limit)
    if (placeCode) query = query.eq("place_code", placeCode)

    const { data: places, error } = await query
    if (error) throw error

    const { data: run } = await supabase.from("sync_runs").insert({
      provider:"wikimedia_commons",
      job_name:"sync-place-media",
      status:"running",
    }).select().single()

    let fetched=0, inserted=0, flagged=0
    const result:any[]=[]

    for (const place of places || []) {
      const names=[place.name_kr,place.name_en].filter(Boolean)
      const seeds:any[]=[]
      const p18=await wikidataP18(names)
      if (p18) seeds.push(p18)
      seeds.push(...await commonsSearch(names))

      const unique = new Map<string,any>()
      for (const c of seeds) if (!unique.has(c.file) || unique.get(c.file).score < c.score) unique.set(c.file,c)
      const enriched:any[]=[]

      for (const c of Array.from(unique.values()).slice(0,8)) {
        try {
          const info=await fetchCommonsInfo(c.file)
          fetched++
          enriched.push({...c,allowed:info.commercialAllowed&&info.derivativesAllowed,license:info.licenseCode})
        } catch {}
      }

      enriched.sort((a,b)=>(Number(b.allowed)-Number(a.allowed))*1000+(b.score-a.score))
      const top=enriched.slice(0,3)
      const cached=[]

      for (let i=0;i<top.length;i++) {
        try {
          const c=top[i]
          const r=await cacheCommonsAsset(supabase,{
            placeCode:place.place_code,
            commonsFile:c.file,
            relevanceScore:c.score,
            isCover:i===0,
            displayOrder:i,
            allowPendingCache:true,
            reason:"automatic_top3_discovery",
          })
          inserted += r.cached ? 1 : 0
          if (r.clearanceStatus !== "cleared") flagged++
          cached.push({file:c.file,score:c.score,clearance:r.clearanceStatus})
        } catch (e) {
          flagged++
          cached.push({file:top[i].file,error:String(e?.message||e)})
        }
      }
      const {error:rotationError}=await supabase.from("places").update({last_media_discovery_at:new Date().toISOString()}).eq("id",place.id);
      if(rotationError)throw rotationError;
      result.push({place_code:place.place_code,cached})
    }

    if (run?.id) {
      await supabase.from("sync_runs").update({
        finished_at:new Date().toISOString(),
        status:"success",
        fetched_count:fetched,
        inserted_count:inserted,
        flagged_count:flagged,
        metadata:{places:result},
      }).eq("id",run.id)
    }

    return json({ok:true,places:result,fetched,inserted,flagged})
  } catch (error) {
    return json({ok:false,error:String(error?.message||error)},500)
  }
})
