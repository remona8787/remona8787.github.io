import {photoAPI} from './private-photos.js';
import {createClient} from '@supabase/supabase-js';
const cfg=window.AOL_CONFIG||{};
const state={configured:!!(cfg.SUPABASE_URL&&cfg.SUPABASE_PUBLISHABLE_KEY),user:null,revision:0,status:'local',dirty:false,conflict:false,lastSync:null,error:'',admin:false};
let client=null,channel=null,timer=null,busy=false,ready=false,epoch=0,localGeneration=0,retry=0,catalogRequest=null;
const app=()=>window.AOLApp,notify=()=>{window.dispatchEvent(new CustomEvent('aol:cloud-state',{detail:{...state}}));};
const metaKey=uid=>'aol12_sync_'+uid;
function saveMeta(){if(state.user)localStorage.setItem(metaKey(state.user.id),JSON.stringify({revision:state.revision,dirty:state.dirty,lastSync:state.lastSync}));}
async function pull(){if(!client||!state.user||!ready)return;const uid=state.user.id,run=epoch;const {data,error}=await client.from('user_workspaces').select('document,revision,updated_at').eq('user_id',uid).maybeSingle();if(run!==epoch)return;if(error)throw error;if(!data)return;if(data.revision===state.revision)return;if(state.dirty){state.conflict=true;state.status='conflict';notify();return}app().replaceCloud(data.document);state.revision=data.revision;state.lastSync=data.updated_at;state.status='synced';saveMeta();notify();}
async function sync(){if(!ready||busy||!state.user||state.conflict)return;if(!state.dirty){try{await pull()}catch(e){fail(e)}return}busy=true;const run=epoch,generation=localGeneration,payload=structuredClone(app().getDB());state.status='syncing';notify();try{const {data,error}=await client.rpc('save_workspace',{p_document:payload,p_expected_revision:state.revision});if(run!==epoch)return;if(error)throw error;if(!data?.ok){state.conflict=true;state.status='conflict';return}retry=0;state.error='';state.revision=data.revision;state.lastSync=data.updated_at;state.dirty=generation!==localGeneration;state.status=state.dirty?'pending':'synced';saveMeta();}catch(e){if(run===epoch)fail(e)}finally{busy=false;notify();if(ready&&state.dirty&&!state.conflict&&navigator.onLine){clearTimeout(timer);timer=setTimeout(sync,Math.min(300000,5000*2**Math.min(retry++,6)))}}}
function fail(e){state.status='error';state.error=e.message||String(e);notify()}
async function sessionChanged(session){
 const uid=session?.user?.id;
 if(uid===state.user?.id&&ready)return;
 const run=++epoch;ready=false;clearTimeout(timer);
 const previous=channel;channel=null;
 // Switch the account synchronously before any network await.
 state.user=session?.user||null;state.admin=false;state.conflict=false;
 state.error='';state.revision=0;state.dirty=false;state.lastSync=null;retry=0;
 app().switchUser(uid||null);
 if(previous)client.removeChannel(previous).catch(()=>{});
 if(!uid){state.status=state.configured?'signed_out':'local';notify();return}
 let m={};try{m=JSON.parse(localStorage.getItem(metaKey(uid))||'{}');if(!m||!Number.isSafeInteger(m.revision??0)||(m.revision??0)<0)throw Error();}
 catch{throw Error('동기화 상태를 읽지 못했습니다. 기록을 백업한 뒤 복구하세요.');}
 state.revision=m.revision||0;state.dirty=!!m.dirty;state.lastSync=m.lastSync||null;
 ready=true;state.status='connecting';notify();
 try{
  await pull();if(run!==epoch)return;
  const {data}=await client.rpc('is_app_admin');if(run!==epoch)return;
  state.admin=data===true;
  channel=client.channel('workspace-'+uid).on('postgres_changes',{event:'*',schema:'public',table:'user_workspaces',filter:'user_id=eq.'+uid},()=>{
   if(run===epoch&&!busy)pull().catch(e=>{if(run===epoch)fail(e)});
  }).subscribe(status=>{
   if(run!==epoch)return;
   if(status==='SUBSCRIBED'){if(!state.conflict){state.status=state.dirty?'pending':'synced';sync()}}
   else if(status==='CHANNEL_ERROR'&&!state.conflict)state.status='reconnecting';
   notify();
  });
  if(state.dirty&&!state.conflict)sync();
  else if(!state.conflict){state.status='synced';notify()}
 }catch(e){if(run===epoch)fail(e)}
}
async function init(){
 if(!state.configured){notify();return}
 client=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'pkce'}});
 // Subscribe first: a public catalog outage must never disable sign-in.
 client.auth.onAuthStateChange((event,s)=>{
  if(event==='PASSWORD_RECOVERY'){location.hash='account';window.dispatchEvent(new CustomEvent('aol:password-recovery'))}
  setTimeout(()=>sessionChanged(s).catch(fail),0);
 });
 const initialEpoch=epoch;
 const {data,error}=await client.auth.getSession();if(error)throw error;
 if(epoch===initialEpoch)await sessionChanged(data.session);
 catalog().catch(e=>{state.catalogError=e.message||String(e);notify()});
 setInterval(()=>{if(!document.hidden&&navigator.onLine)catalog().catch(e=>{state.catalogError=e.message;notify()})},300000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)catalog().catch(e=>{state.catalogError=e.message;notify()})});
 client.channel('public-catalog').on('postgres_changes',{event:'*',schema:'public',table:'places'},()=>catalog().catch(e=>{state.catalogError=e.message||String(e);notify()})).subscribe();
}
function catalog(){
 if(!client)return Promise.resolve();
 if(catalogRequest)return catalogRequest;
 catalogRequest=loadCatalog().finally(()=>{catalogRequest=null});return catalogRequest;
}
async function loadCatalog(){
 const rows=[];
 for(let from=0;from<50000;from+=500){
  const {data,error}=await client.from('places').select('*,cities(name_en,name_local,countries(iso2,name_en,name_local))').eq('is_published',true).order('id').range(from,from+499);
  if(error)throw error;rows.push(...data);if(data.length<500)break;
 }
 app().setCatalog(rows);
 const {data:media,error:mediaError}=await client.from('public_place_media').select('*').limit(1000);
 // Keep the last successful media snapshot on API failure; never replace it with [].
 if(!mediaError)app().setMedia(media||[]);
 const {data:posts,error:postError}=await client.from('archive_articles').select('id,title,summary,body,author,source_url,published_at,status').eq('status','published').order('published_at',{ascending:false}).limit(100);
 if(!postError){window.AOL_ARTICLES=posts||[];app().render()}
 if(mediaError||postError)throw mediaError||postError;
 state.catalogError='';notify();
}
window.AOLCloud={state,sync,catalog,photos:photoAPI(()=>client,()=>state.user),
 async signIn(email,password){const {error}=await client.auth.signInWithPassword({email,password});if(error)throw error},
 async signUp(email,password){const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:cfg.PUBLIC_URL||location.origin}});if(error)throw error;return data},
 async signOut(){if(state.dirty)throw Error('동기화 대기 기록이 있습니다. 백업하거나 충돌을 해결한 뒤 로그아웃하세요.');const {error}=await client.auth.signOut();if(error)throw error},
 async resetPassword(email){const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:cfg.PUBLIC_URL||location.origin});if(error)throw error},
 async updatePassword(password){const {error}=await client.auth.updateUser({password});if(error)throw error},
 async migrateGuest(){if(!state.user||!ready||state.conflict)throw Error('먼저 로그인하고 동기화 충돌을 해결하세요.');app().mergeGuest();await sync()},
 async resolve(choice){
  if(!['local','remote'].includes(choice))throw Error('충돌 해결 방식 오류');
  if(!state.user||!ready)throw Error('로그인이 필요합니다.');
  const run=epoch,uid=state.user.id,generation=localGeneration;
  const {data,error}=await client.from('user_workspaces').select('document,revision').eq('user_id',uid).maybeSingle();
  if(run!==epoch)throw Error('계정이 변경되어 충돌 해결을 중단했습니다.');
  if(error)throw error;
  if(generation!==localGeneration)throw Error('기록이 변경되었습니다. 다시 확인하고 선택하세요.');
  if(choice==='remote'){app().backup();app().replaceCloud(data?.document||window.AOLCore.empty());state.dirty=false}else state.dirty=true;
  state.revision=data?.revision||0;state.conflict=false;saveMeta();notify();await sync();
 },
 async removeAccount(password){if(!state.user)throw Error('로그인 필요');const uid=state.user.id;const {error}=await client.auth.signInWithPassword({email:state.user.email,password});if(error)throw error;const {error:removeError}=await client.functions.invoke('delete-account');if(removeError)throw removeError;localStorage.removeItem('aol12_user_'+uid);localStorage.removeItem(metaKey(uid));state.dirty=false;await client.auth.signOut();},
 async submit(title,url,note){if(!state.user)throw Error('로그인이 필요합니다.');const {error}=await client.from('place_submissions').insert({user_id:state.user.id,title,source_url:url,note});if(error)throw error},
 client:()=>client
};
window.addEventListener('aol:changed',()=>{if(!ready||!state.user)return;localGeneration++;state.dirty=true;state.status=state.conflict?'conflict':'pending';saveMeta();notify();clearTimeout(timer);timer=setTimeout(sync,800)});
window.addEventListener('online',()=>sync());window.addEventListener('focus',()=>sync());
init().catch(fail);
