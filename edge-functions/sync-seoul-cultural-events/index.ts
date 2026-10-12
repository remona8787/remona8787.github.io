import { authorizedSecret } from "../_shared/auth.mjs";
// v0.4 scaffold: Seoul culturalEventInfo auto-sync.
// Required secret: SEOUL_OPEN_DATA_KEY.
// Official dataset refresh cadence: daily (source metadata).
// Store event rows with source attribution; do not auto-overwrite editorial descriptions.

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST required", {status:405});
  if (!authorizedSecret([[Deno.env.get("MEDIA_CRON_SECRET"), req.headers.get("x-aol-cron-secret")], [Deno.env.get("MEDIA_ADMIN_SECRET"), req.headers.get("x-aol-media-admin-secret")]])) return new Response("Unauthorized", {status:401});
  const key = Deno.env.get("SEOUL_OPEN_DATA_KEY");
  if (!key) return new Response(JSON.stringify({ok:false,ready:true,message:"Set SEOUL_OPEN_DATA_KEY"}),
    {status:503,headers:{"content-type":"application/json"}});
  const url=`http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/culturalEventInfo/1/100/`;
  const raw=await fetch(url).then(r=>r.json());
  return new Response(JSON.stringify({
    ok:true,
    fetched:Array.isArray(raw?.culturalEventInfo?.row)?raw.culturalEventInfo.row.length:0,
    note:"Map provider fields into public.events; filter media/light/digital/night keywords; preserve source."
  }),{headers:{"content-type":"application/json"}});
});
