// Read-only connectivity gate. No signup, SQL mutations, or credential output.
import {readFile,writeFile} from 'node:fs/promises';
import vm from 'node:vm';
const configPath=process.argv[2]||'site-public-cleared/config.js';
const ctx={window:{}};vm.runInNewContext(await readFile(configPath,'utf8'),ctx,{timeout:1000});
const cfg=ctx.window.AOL_CONFIG||{},checks=[];
// Legal pages (privacy/terms/support/delete-account) render these; PIPA requires an identified operator and contact.
{const ok=!!(cfg.OPERATOR_NAME?.trim()&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.SUPPORT_EMAIL||''));checks.push(ok?{name:'operator_contact',status:'passed'}:{name:'operator_contact',status:'blocked',reason:'set OPERATOR_NAME and SUPPORT_EMAIL in config.js'})}
async function probe(name,path,validate){
 if(!cfg.SUPABASE_URL||!cfg.SUPABASE_PUBLISHABLE_KEY){checks.push({name,status:'blocked',reason:'backend_not_configured'});return}
 try{
  const res=await fetch(new URL(path,cfg.SUPABASE_URL),{headers:{apikey:cfg.SUPABASE_PUBLISHABLE_KEY},signal:AbortSignal.timeout(15000)});
  if(!res.ok){checks.push({name,status:'failed',http:res.status});return}
  const json=await res.json();checks.push({name,status:validate(json)?'passed':'failed',http:res.status});
 }catch(e){checks.push({name,status:'failed',reason:e.name})}
}
await Promise.all([
 probe('public_catalog','/rest/v1/places?select=place_code,cities(name_en)&limit=1',x=>Array.isArray(x)&&x.length>0),
 probe('cleared_media_view','/rest/v1/public_place_media?select=id&limit=1',Array.isArray),
 probe('actual_media_available','/rest/v1/public_place_media?select=cached_public_url&limit=1',x=>Array.isArray(x)&&x.some(a=>a.cached_public_url)),
 probe('editorial_articles','/rest/v1/archive_articles?select=id&limit=1',Array.isArray),
 probe('email_auth_enabled','/auth/v1/settings',x=>x.external?.email===true)
]);
const report={at:new Date().toISOString(),configPath,checks,unverified:['email_delivery','two_user_rls','realtime_two_clients','private_photo_upload','admin_review','cron_execution','browser_e2e']};
await writeFile('release/launch/connectivity-report.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
process.exitCode=checks.every(x=>x.status==='passed')?0:1;
