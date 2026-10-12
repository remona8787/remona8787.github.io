import {createClient} from 'npm:@supabase/supabase-js@2';
import {getAdminKey} from '../_shared/media.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Content-Type':'application/json'};
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
 if(req.method!=='POST')return json({error:'POST required'},405);
 const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');if(!token)return json({error:'authentication_required'},401);
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,getAdminKey(),{auth:{persistSession:false}});
 const {data,error}=await admin.auth.getUser(token);if(error||!data.user)return json({error:'invalid_session'},401);
 if(!data.user.last_sign_in_at||Date.now()-Date.parse(data.user.last_sign_in_at)>300000)return json({error:'recent_sign_in_required'},403);
 // Storage objects must be removed before deleting their owner. Work in bounded batches.
 for(let batch=0;batch<100;batch++){
  const {data:objects,error:listError}=await admin.storage.from('visit-photos').list(data.user.id,{limit:100});
  if(listError)return json({error:'photo_cleanup_failed'},500);
  if(!objects?.length)break;
  const {error:storageError}=await admin.storage.from('visit-photos').remove(objects.map(x=>data.user.id+'/'+x.name));
  if(storageError)return json({error:'photo_cleanup_failed'},500);
  if(batch===99)return json({error:'photo_cleanup_incomplete_retry'},409);
 }
 const {error:signOutError}=await admin.auth.admin.signOut(token,'global');
 if(signOutError)return json({error:'session_revocation_failed'},500);
 const {error:removeError}=await admin.auth.admin.deleteUser(data.user.id);
 if(removeError)return json({error:'account_deletion_failed'},500);
 return json({ok:true});
});
