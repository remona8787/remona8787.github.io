// Server-side bootstrap only. Never put MEDIA_ADMIN_SECRET in public config.
import {readFile} from 'node:fs/promises';
const {SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, MEDIA_ADMIN_SECRET}=process.env;
if(!SUPABASE_URL||!SUPABASE_PUBLISHABLE_KEY||!MEDIA_ADMIN_SECRET)throw Error('Missing server-side import environment');
const origin=new URL(SUPABASE_URL);if(origin.protocol!=='https:'||!origin.hostname.endsWith('.supabase.co'))throw Error('Invalid project URL');
const rows=JSON.parse(await readFile(new URL('../data/reviewed-media.json',import.meta.url),'utf8'));
let failed=0;
for(const row of rows){
 try{
 const res=await fetch(new URL('/functions/v1/cache-commons-media',origin),{method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_PUBLISHABLE_KEY,'x-aol-media-admin-secret':MEDIA_ADMIN_SECRET},body:JSON.stringify({place_code:row.place_code,commons_file:row.provider_asset_id,reviewed:true,is_cover:true,reason:'reviewed-bootstrap-2026-10-12'}),signal:AbortSignal.timeout(90000)});
 const data=await res.json();const ok=res.ok&&data.ok&&data.cached;
 console.log(JSON.stringify({place:row.place_code,http:res.status,cached:!!ok}));if(!ok)failed++;
 }catch(e){failed++;console.log(JSON.stringify({place:row.place_code,error:e.name}))}
}
process.exitCode=failed?1:0;
