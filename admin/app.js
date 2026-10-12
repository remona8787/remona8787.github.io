// Load the SDK only after configuration is present.

const cfg=window.AOL_ADMIN_CONFIG||{};
const $=s=>document.querySelector(s);
const safeURL=s=>{try{const u=new URL(s);return /^https?:$/.test(u.protocol)?u.href:""}catch{return ""}};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
let supabase=null,currentCandidates=[],selected=null;

function configured(){return !!(cfg.SUPABASE_URL&&cfg.SUPABASE_PUBLISHABLE_KEY)}
function msg(el,text,bad=false){el.textContent=text;el.classList.toggle("hidden",!text);el.style.borderColor=bad?"#633838":"#5c4a29"}

async function boot(){
 if(!configured()){msg($("#loginMsg"),"서버 미연결: config.js에 SUPABASE_URL / PUBLISHABLE_KEY를 입력하세요. 개인 기록 기능은 메인 앱에서 사용할 수 있습니다.",true);$("#loginBtn").disabled=true;return}
 const {createClient}=await import("../assets/supabase.js");
 supabase=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY);
 const {data:{session}}=await supabase.auth.getSession();
 if(session) await enterAdmin(session); else showLogin();
 supabase.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>{if(session)enterAdmin(session).catch(e=>msg($("#loginMsg"),e.message,true));else showLogin()},0)});
}
function showLogin(){$("#loginPanel").classList.remove("hidden");$("#adminPanel").classList.add("hidden")}
async function login(){
 if(!supabase)return;
 msg($("#loginMsg"),"");
 const email=$("#email").value.trim(),password=$("#password").value;
 const {error}=await supabase.auth.signInWithPassword({email,password});
 if(error)msg($("#loginMsg"),error.message,true);
}
async function enterAdmin(session){
 const {data,isErr,error}=await supabase.rpc("is_app_admin");
 if(error||!data){await supabase.auth.signOut();msg($("#loginMsg"),"이 계정은 app_admins에 등록되어 있지 않습니다.",true);return}
 $("#loginPanel").classList.add("hidden");$("#adminPanel").classList.remove("hidden");$("#userLabel").textContent=session.user.email||"admin";
 await refreshAll();
}
async function refreshAll(){await Promise.all([loadStats(),loadCandidates(),loadJobs()])}
async function loadStats(){
 const {data,error}=await supabase.rpc("admin_candidate_stats");
 if(error){$("#stats").innerHTML=`<div class="notice">${esc(error.message)}</div>`;return}
 const keys=[["total","전체"],["ready","Ready"],["draft","Draft"],["published","Published"],["rejected","Rejected"],["high_relevance","70+"],["duplicates","중복클러스터"]];
 $("#stats").innerHTML=keys.map(([k,l])=>`<div class="stat"><b>${data?.[k]??0}</b><span>${l}</span></div>`).join("");
}
async function loadCandidates(){
 const params={
  p_city_code:$("#cityFilter").value||null,
  p_status:$("#statusFilter").value||null,
  p_min_score:Number($("#scoreFilter").value||0),
  p_search:$("#searchFilter").value.trim()||null,
  p_limit:200,p_offset:0
 };
 const {data,error}=await supabase.rpc("admin_list_candidates",params);
 if(error){$("#candidateRows").innerHTML=`<tr><td colspan="7">${esc(error.message)}</td></tr>`;return}
 currentCandidates=data||[];
 $("#candidateRows").innerHTML=currentCandidates.map(c=>`<tr data-id="${c.id}">
   <td><b>${esc(c.name)}</b><br><span style="color:#8994a2;font-size:11px">${esc(c.name_local||"")}</span></td>
   <td>${esc(c.city_code||"")}</td>
   <td>${esc(c.candidate_type||"")}</td>
   <td>${esc(c.primary_provider)}</td>
   <td class="score">${Number(c.relevance_score||0).toFixed(0)}</td>
   <td>${Number(c.confidence_score||0).toFixed(0)}</td>
   <td><span class="pill ${esc(c.publishing_status)}">${esc(c.publishing_status)}</span></td>
 </tr>`).join("");
 document.querySelectorAll("#candidateRows tr[data-id]").forEach(tr=>tr.onclick=()=>selectCandidate(tr.dataset.id));
}
function selectCandidate(id){
 selected=currentCandidates.find(c=>c.id===id); if(!selected)return;
 const c=selected;
 $("#candidateDetail").innerHTML=`
   <h3>${esc(c.name)}</h3>
   <div class="kv"><b>도시</b><span>${esc(c.city_code||"")}</span></div>
   <div class="kv"><b>Provider</b><span>${esc(c.primary_provider)} / ${esc(c.external_primary_id)}</span></div>
   <div class="kv"><b>유형</b><span>${esc(c.candidate_type||"")}</span></div>
   <div class="kv"><b>Relevance</b><span>${Number(c.relevance_score||0).toFixed(0)}</span></div>
   <div class="kv"><b>Confidence</b><span>${Number(c.confidence_score||0).toFixed(0)}</span></div>
   <div class="kv"><b>좌표</b><span>${c.lat??"-"}, ${c.lng??"-"}</span></div>
   <div class="kv"><b>주소</b><span>${esc(c.address_text||"-")}</span></div>
   <div class="kv"><b>중복</b><span>${esc(c.duplicate_cluster_id||"-")}</span></div>
   <div class="actions">
     <button class="btn ok" data-action="ready">Ready</button>
     <button class="btn ok" data-action="reviewed">Reviewed</button>
     <button class="btn" data-action="hide">Hide</button>
     <button class="btn bad" data-action="reject">Reject</button>
     <button class="btn primary" data-promote>Promote → Place</button>
   </div>
   ${c.website_url?`<p><a href="${esc(safeURL(c.website_url))}" target="_blank" style="color:#b997ff">공식/Provider URL 열기</a></p>`:""}
   <h4>Source metadata</h4><div class="meta">${esc(JSON.stringify(c.source_metadata||{},null,2))}</div>`;
 document.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>candidateAction(b.dataset.action));
 $("[data-promote]").onclick=promoteSelected;
}
async function candidateAction(action){
 if(!selected)return;
 let reason=null;
 if(action==="reject"){reason=prompt("Reject 사유");if(reason===null)return;if(!reason.trim()){alert("사유를 입력하세요.");return}}
 const {error}=await supabase.rpc("admin_update_candidate",{p_candidate_id:selected.id,p_action:action,p_reason:reason});
 if(error){alert(error.message);return}
 await refreshAll(); selected=null;$("#candidateDetail").textContent="처리되었습니다. 다시 후보를 선택하세요.";
}
async function promoteSelected(){
 if(!selected)return;
 const suggested=`AUTO-${(selected.city_code||"GLB")}-${selected.id.replaceAll("-","").slice(0,8).toUpperCase()}`;
 const code=prompt("새 place_code",suggested);
 if(code===null)return;
 const {data,error}=await supabase.rpc("admin_promote_candidate",{p_candidate_id:selected.id,p_place_code:code||null});
 if(error){alert(error.message);return}
 alert(`Canonical place 생성: ${data}`);await refreshAll();
}
async function runDiscovery(cityCode){
 const el=$("#discoverMsg");el.textContent=`${cityCode} discovery 실행 중…`;
 const {data:{session}}=await supabase.auth.getSession();
 if(!session){el.textContent="로그인이 필요합니다.";return}
 const limit=cityCode==="SEOUL"?100:120;
 const res=await fetch(`${cfg.SUPABASE_URL.replace(/\/$/,"")}/functions/v1/admin-discovery-command`,{
   method:"POST",
   headers:{
     "content-type":"application/json",
     "apikey":cfg.SUPABASE_PUBLISHABLE_KEY,
     "authorization":`Bearer ${session.access_token}`
   },
   body:JSON.stringify({city_code:cityCode,candidate_limit_per_city:limit})
 });
 const data=await res.json().catch(()=>({}));
 el.textContent=res.ok?`${cityCode} 완료 · fetched ${data?.result?.fetched??"?"}`:`실패: ${data?.error||data?.result?.error||res.status}`;
 await refreshAll();
}
async function loadJobs(){
 const {data,error}=await supabase.rpc("admin_list_ingestion_jobs",{p_limit:20});
 if(error){$("#jobs").textContent=error.message;return}
 $("#jobs").innerHTML=`<div class="table-wrap"><table><thead><tr><th>Job</th><th>Status</th><th>Fetched</th><th>Inserted</th><th>Flagged</th><th>Created</th></tr></thead><tbody>${(data||[]).map(j=>`<tr><td>${esc(j.job_name)}</td><td>${esc(j.status)}</td><td>${j.fetched_count}</td><td>${j.inserted_count}</td><td>${j.flagged_count}</td><td>${esc(j.created_at||"")}</td></tr>`).join("")}</tbody></table></div>`;
}

$("#loginBtn").onclick=login;
$("#password").addEventListener("keydown",e=>{if(e.key==="Enter")login()});
$("#logoutBtn").onclick=()=>supabase.auth.signOut();
$("#refreshBtn").onclick=refreshAll;
$("#applyFilter").onclick=loadCandidates;
$("#searchFilter").addEventListener("keydown",e=>{if(e.key==="Enter")loadCandidates()});
document.querySelectorAll("[data-discover]").forEach(b=>b.onclick=()=>runDiscovery(b.dataset.discover));
boot().catch(e=>{msg($("#loginMsg"),"연결 실패: "+e.message,true);$("#loginBtn").disabled=true});

$('#articleForm').onsubmit=async e=>{e.preventDefault();if(!supabase)return;const form=e.target,fd=new FormData(form),status=fd.get('status'),url=fd.get('source_url');try{if(url&&!safeURL(url))throw Error('출처 URL을 확인하세요.');const {error}=await supabase.from('archive_articles').insert({title:String(fd.get('title')).trim(),author:fd.get('author'),summary:fd.get('summary'),body:fd.get('body'),source_url:url||null,status,published_at:status==='published'?new Date().toISOString():null});if(error)throw error;$('#articleMsg').textContent='등록했습니다.';form.reset()}catch(err){$('#articleMsg').textContent=err.message}};
