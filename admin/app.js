// 빛의 건축 아카이브 운영 콘솔 (docs/ARCHIVE_SPEC.md §4, docs/ARCHIVE_ADMIN.md).
// Every string from the database is untrusted: markup is built only with html`` (which escapes every value) and links
// only through safeURL (http/https). The console mirrors the roles; the database enforces them.
const cfg=window.AOL_ADMIN_CONFIG||{},T=window.AOLTaxonomy;
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const RAW=Symbol('html');
const raw=s=>({[RAW]:String(s)});
const show=v=>v==null||v===false?'':Array.isArray(v)?v.map(show).join(''):v[RAW]!==undefined?v[RAW]:esc(v);
const html=(s,...v)=>raw(s.reduce((o,x,i)=>o+x+(i<v.length?show(v[i]):''),''));
const put=(el,t)=>{if(el)el.innerHTML=show(t)};
const on=(c,a)=>c?raw(' '+a):'';
const safeURL=s=>{try{const u=new URL(String(s??'').trim());return /^https?:$/.test(u.protocol)?u.href:''}catch{return ''}};
const link=(u,text)=>{const h=safeURL(u);return h?html`<a href="${h}" target="_blank" rel="noopener noreferrer">${text||h}</a>`:u?html`<span class="unsafe">${text||u} <small>(열 수 없는 주소)</small></span>`:''};
const rows=d=>Array.isArray(d)?d:d==null?[]:[d];
const blank=v=>v==null||v===''||(Array.isArray(v)&&!v.length);
const PAGE=50;

// Labels: the shared taxonomy for every archive vocabulary, plus the few operational ones it does not hold.
const LOCAL={
 run_status:{running:'실행 중',success:'성공',partial:'일부 성공',error:'실패',skipped:'건너뜀'},
 trigger:{cron:'예약',admin:'수동',websub:'푸시',probe:'점검'},
 update_kind:{new_source:'새 출처',changed_field:'값 변경',link_broken:'링크 오류',image_broken:'이미지 오류',wikidata_changed:'Wikidata 변경'},
 update_state:{open:'처리 전',applied:'반영함',dismissed:'무시함'},
 rights_status:{pending:'확인 중',cleared:'사용 가능',blocked:'사용 불가'},
 location_precision:{exact:'정확한 위치',street:'거리 수준',city:'도시 수준',unknown:'모름'},
 polarity:{positive:'긍정 · 파사드 용어',context:'맥락 · 건물·행사',negative:'부정 · 광고·매매'},
 confidence:{low:'낮음',medium:'보통',high:'높음'},
 role:{admin:'관리자',editor:'편집자',researcher:'연구자'}
};
const vocab=name=>LOCAL[name]?Object.entries(LOCAL[name]):(T?.vocab[name]||[]).map(v=>[v[0],v[1]]);
const lbl=(name,key)=>key==null||key===''?'미확인':LOCAL[name]?.[key]||T?.label(name,key)||String(key);
const dn=type=>{try{return new Intl.DisplayNames(['ko'],{type})}catch{return null}};
const regionDN=dn('region'),langDN=dn('language');
const countryName=c=>{if(!c)return '';try{return regionDN?.of(String(c).toUpperCase())||String(c)}catch{return String(c)}};
const langName=l=>{if(!l)return '';try{return langDN?.of(String(l))||String(l)}catch{return String(l)}};
const COUNTRIES=Object.keys(T?.regionByIso||{}).map(c=>[c,countryName(c)]).sort((a,b)=>a[1].localeCompare(b[1],'ko'));
const LANGS=['ko','en','ja','zh','de','fr','es','it','pt','nl','pl','ru','ar','tr'];
const langOptions=()=>LANGS.map(l=>[l,`${langName(l)} (${l})`]);

const DT=new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const DAY=new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit'});
const date=s=>{const d=s?new Date(s):null;return d&&!isNaN(d)?d:null};
const when=s=>{const d=date(s);return d?html`<time datetime="${d.toISOString()}">${DT.format(d)}</time>`:'—'};
const day=s=>{const d=date(s);return d?DAY.format(d):''};
const ago=s=>{const d=date(s);if(!d)return '—';const m=Math.round((Date.now()-d)/60000);return html`<time datetime="${d.toISOString()}" title="${DT.format(d)}">${m<1?'방금':m<60?`${m}분 전`:m<1440?`${Math.round(m/60)}시간 전`:m<43200?`${Math.round(m/1440)}일 전`:DAY.format(d)}</time>`};
const until=s=>{const d=date(s);if(!d||d<=Date.now())return '';const m=Math.round((d-Date.now())/60000);return m<60?`${m}분 뒤`:`${Math.round(m/60)}시간 뒤`};
const dur=(a,b)=>{const x=date(a),y=date(b);if(!x||!y)return '—';const s=Math.max(0,Math.round((y-x)/1000));return s<60?`${s}초`:`${Math.floor(s/60)}분 ${s%60}초`};
const num=n=>n==null||n===''||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString('ko-KR');
const pill=(text,tone)=>html`<span class="pill tone-${tone||'muted'}">${text}</span>`;
const RUN_TONE={success:'ok',partial:'warn',error:'bad',running:'accent',skipped:'muted'};
const LABEL_TONE={facade_project:'accent',event_program:'ok',ad_screen:'warn',product_vendor:'warn',irrelevant:'muted',uncertain:'muted'};
const VIS_TONE={published:'ok',draft:'muted',hidden:'bad'};
const POL_TONE={positive:'ok',context:'accent',negative:'bad'};

function errText(e){
 const m=String(e?.message||e||''),code=String(e?.code||'');
 if(code==='PGRST202'||/could not find the function/i.test(m))return '서버에 이 기능이 아직 없어요. 아카이브 데이터베이스 마이그레이션을 적용했는지 확인하세요.';
 if(code==='42501'||e?.status===401||e?.status===403||/permission denied|forbidden|not.allowed|(admin|editor|role)_required/i.test(m))return '권한이 없어요. 이 작업은 역할에 따라 제한돼요.';
 if(e?.name==='TypeError'||/failed to fetch|networkerror|load failed/i.test(m))return '서버에 연결하지 못했어요. 네트워크를 확인하고 다시 시도하세요.';
 if(/note_required/i.test(m))return '사유(메모)를 적어야 해요.';
 return m||'알 수 없는 오류가 났어요.';
}
function errBox(e,what='불러오지 못했어요.'){const t=errText(e),m=String(e?.message||'');return html`<div class="notice error" role="alert"><b>${what}</b> ${t}${m&&m!==t?html` <small class="detail">(${e.code?e.code+' · ':''}${m})</small>`:''}</div>`}
let toastTimer;
function toast(text,bad=false){const t=$('#toast');t.textContent=text;t.className='toast show'+(bad?' bad':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>{t.className='toast'},5000)}
const fieldErr=(k,msg)=>Object.assign(Error(`${F[k]?.[0]||k}: ${msg}`),{field:k});
const formErr=(k,msg)=>Object.assign(Error(msg),{field:k});
// Two-step confirm without a native dialog: the first press arms the button, a second press within 5 s runs it.
function armed(el,text){if(el.dataset.armed)return true;el.dataset.armed='1';const t=el.textContent;el.textContent=text;el.classList.add('armed');setTimeout(()=>{if(!el.isConnected)return;delete el.dataset.armed;el.textContent=t;el.classList.remove('armed')},5000);return false}

let sb=null;
async function rpc(name,params){const {data,error}=await sb.rpc(name,params);if(error)throw error;return data}
// Edge Functions take the signed-in user's JWT; the function checks the role again on the server.
async function callFunction(name,body){
 const {data:{session}}=await sb.auth.getSession();if(!session)throw Error('다시 로그인해 주세요.');
 const res=await fetch(`${String(cfg.SUPABASE_URL).replace(/\/+$/,'')}/functions/v1/${name}`,{method:'POST',headers:{'content-type':'application/json',apikey:cfg.SUPABASE_PUBLISHABLE_KEY,authorization:'Bearer '+session.access_token},body:JSON.stringify(body)});
 const data=await res.json().catch(()=>({}));
 if(!res.ok)throw Object.assign(Error(data?.error||data?.message||`HTTP ${res.status}`),{status:res.status});
 return data;
}

const S={role:null,email:'',tab:null,rules:[],dash:null,
 q:{items:[],sel:-1,more:false,panel:null},
 p:{items:[],more:false,cur:null,confirm:new Set(),pendingOpen:null},
 r:{items:[],cur:null},kw:{items:[]},lg:{items:[],cur:null,panel:null}};
const RANK={researcher:1,editor:2,admin:3};
const can=min=>(RANK[S.role]||0)>=(RANK[min]||9);

// Archive fields (ARCHIVE_SPEC §4 archive_projects), grouped as the editor shows them.
const F={
 name_original:['원어 이름','text'],name_original_lang:['원어 언어','lang'],name_ko:['한국어 이름','text'],name_en:['영어 이름','text'],aliases:['다른 이름 (줄마다 하나)','list'],
 country_iso2:['국가','iso'],city:['도시','text'],district:['구역','text'],address:['주소','text'],latitude:['위도','lat'],longitude:['경도','lng'],location_precision:['위치 정확도','vocab:location_precision'],
 building_name:['건물 이름','text'],project_type:['프로젝트 유형','vocab:project_type'],
 year_installed:['설치 연도','year'],year_completed:['준공 연도','year'],year_operating_since:['운영 시작 연도','year'],year_ended:['운영 종료 연도','year'],operating_status:['운영 상태','vocab:operating_status'],
 official_url:['공식 웹사이트','url'],wikidata_qid:['Wikidata ID','qid'],
 installation_method:['설치 방식','vocab:installation_method'],envelope_type:['외피 유형','vocab:envelope_type'],technology:['기술','multi:technology'],display_area_m2:['표출 면적 (m²)','num'],resolution_text:['해상도','text'],pixel_pitch_mm:['픽셀 피치 (mm)','num'],content_type:['콘텐츠 유형','multi:content_type'],interactive:['인터랙티브','bool'],
 viewing_points:['관람 지점','textarea'],spatial_context:['공간 맥락','multi:spatial_context'],urban_context:['도시 맥락','textarea'],summary_ko:['요약 (한국어)','textarea'],summary_en:['요약 (영어)','textarea']
};
const GROUPS=[
 ['basic','기본 정보',['name_original','name_original_lang','name_ko','name_en','aliases','country_iso2','city','district','address','latitude','longitude','location_precision','building_name','project_type','year_installed','year_completed','year_operating_since','year_ended','operating_status','official_url','wikidata_qid']],
 ['technical','기술·건축',['installation_method','envelope_type','technology','display_area_m2','resolution_text','pixel_pitch_mm','content_type','interactive']],
 ['context','맥락',['viewing_points','spatial_context','urban_context','summary_ko','summary_en']]];
const FIELDS=GROUPS.flatMap(g=>g[2]);
const kindOf=k=>F[k][1].split(':');

function options(list,v,blankLabel='미확인'){return html`${blankLabel!=null?html`<option value="">${blankLabel}</option>`:''}${list.map(([key,l])=>html`<option value="${key}"${on(String(v??'')===String(key),'selected')}>${l}</option>`)}`}
function control(k,v,id){
 const [kind,voc]=kindOf(k),ph='미확인';
 switch(kind){
  case 'textarea':return html`<textarea id="${id}" name="${k}" rows="3" placeholder="${ph}">${v??''}</textarea>`;
  case 'list':return html`<textarea id="${id}" name="${k}" rows="2" placeholder="${ph}">${rows(v).join('\n')}</textarea>`;
  case 'year':return html`<input id="${id}" name="${k}" type="number" inputmode="numeric" min="1800" max="2100" step="1" value="${v??''}" placeholder="${ph}">`;
  case 'num':case 'lat':case 'lng':return html`<input id="${id}" name="${k}" type="number" inputmode="decimal" step="any" value="${v??''}" placeholder="${ph}">`;
  case 'url':return html`<input id="${id}" name="${k}" type="url" value="${v??''}" placeholder="${ph}">`;
  case 'iso':return html`<select id="${id}" name="${k}">${options(COUNTRIES.map(([c,n])=>[c,`${n} (${c})`]),v)}</select>`;
  case 'lang':{const list=langOptions();if(v&&!LANGS.includes(v))list.push([v,`${langName(v)} (${v})`]);return html`<select id="${id}" name="${k}">${options(list,v)}</select>`}
  case 'vocab':return html`<select id="${id}" name="${k}">${options(vocab(voc),v)}</select>`;
  case 'bool':return html`<select id="${id}" name="${k}">${options([['true','예'],['false','아니요']],v==null?'':String(v))}</select>`;
  case 'multi':{const set=new Set(rows(v));return html`<div class="checks">${vocab(voc).map(([key,l])=>html`<label class="check"><input type="checkbox" name="${k}" value="${key}"${on(set.has(key),'checked')}> ${l}</label>`)}</div>`}
  default:return html`<input id="${id}" name="${k}" value="${v??''}" placeholder="${ph}">`;
 }
}
function readField(form,k){
 const [kind]=kindOf(k);
 if(kind==='multi'){const a=$$(`input[name="${k}"]:checked`,form).map(i=>i.value);return a.length?a:null}
 const s=String(form.elements.namedItem(k)?.value??'').trim();
 if(!s)return null;
 switch(kind){
  case 'year':{const n=Number(s);if(!Number.isInteger(n)||n<1800||n>2100)throw fieldErr(k,'1800~2100 사이의 연도를 적어 주세요.');return n}
  case 'num':{const n=Number(s);if(!Number.isFinite(n)||n<0)throw fieldErr(k,'0 이상의 숫자를 적어 주세요.');return n}
  case 'lat':case 'lng':{const n=Number(s),max=kind==='lat'?90:180;if(!Number.isFinite(n)||Math.abs(n)>max)throw fieldErr(k,`-${max}~${max} 사이의 숫자를 적어 주세요.`);return n}
  case 'url':if(!safeURL(s))throw fieldErr(k,'http:// 또는 https://로 시작하는 주소를 적어 주세요.');return s;
  case 'qid':if(!/^Q[1-9]\d*$/.test(s))throw fieldErr(k,'Q로 시작하는 Wikidata ID를 적어 주세요 (예: Q12345).');return s;
  case 'bool':return s==='true';
  case 'list':{const a=s.split('\n').map(x=>x.trim()).filter(Boolean);return a.length?a:null}
  default:return s;
 }
}
const norm=(k,v)=>{const [kind]=kindOf(k);if(blank(v))return null;if(kind==='multi')return [...v].sort();if(['year','num','lat','lng'].includes(kind))return Number(v);if(kind==='bool')return !!v;return typeof v==='string'?v.trim()||null:v};
const same=(k,a,b)=>JSON.stringify(norm(k,a))===JSON.stringify(norm(k,b));
function fmtField(k,v){
 if(blank(v))return '미확인';
 const [kind,voc]=kindOf(k);
 if(kind==='vocab')return lbl(voc,v);
 if(kind==='multi')return rows(v).map(x=>lbl(voc,x)).join(', ');
 if(kind==='iso')return `${countryName(v)} (${v})`;
 if(kind==='lang')return langName(v);
 if(kind==='bool')return v?'예':'아니요';
 if(kind==='url')return link(v);
 if(kind==='list')return rows(v).join(', ');
 return String(v);
}
function stateBadge(k,v,st){const s=blank(v)?'unverified':st?.state||'unverified';return html`<span class="state state-${s}" data-state-for="${k}">${lbl('field_state',s)}</span>`}
function fieldBox(k,v,st){
 const [label]=F[k],[kind]=kindOf(k),id='pf-'+k,s=blank(v)?'unverified':st?.state||'unverified';
 const confirm=!blank(v)&&!['editor_verified','researcher_assessed'].includes(s)?html`<button type="button" class="linkbtn" data-act="field-confirm" data-field="${k}" aria-label="${label} 값이 맞다고 확인">값 확인</button>`:'';
 const meta=html`<span class="field-meta">${stateBadge(k,v,st)}${confirm}</span>`;
 return kind==='multi'?html`<fieldset class="field wide" data-field="${k}"><legend>${label}</legend>${meta}${control(k,v,id)}</fieldset>`
  :html`<div class="field${['textarea','list'].includes(kind)?' wide':''}" data-field="${k}"><div class="field-top"><label for="${id}">${label}</label>${meta}</div>${control(k,v,id)}</div>`;
}
function plainField(k,v,prefix){const [label]=F[k],[kind]=kindOf(k),id=`${prefix}-${k}`;return kind==='multi'?html`<fieldset class="field wide"><legend>${label}</legend>${control(k,v,id)}</fieldset>`:html`<div class="field${['textarea','list'].includes(kind)?' wide':''}"><label for="${id}">${label}</label>${control(k,v,id)}</div>`}
const pname=p=>p?.name_ko||p?.name_en||p?.name_original||p?.slug||'(이름 미확인)';
const placeLine=p=>[p?.city,countryName(p?.country_iso2)].filter(Boolean).join(' · ')||'위치 미확인';

// ---- Sign-in and roles ----
function loginMsg(text){const m=$('#loginMsg');m.textContent=text||'';m.hidden=!text}
function showLogin(){
 S.role=null;S.tab=null;
 $('#loginView').hidden=false;$('#nav').hidden=true;$('#who').hidden=true;$('#logoutBtn').hidden=true;
 for(const v of $$('.view'))v.hidden=true;
 document.body.classList.remove('signed-in');
}
async function boot(){
 fillStatic();
 if(!T){loginMsg('../archive-taxonomy.js를 불러오지 못했어요. 배포 파일을 확인하세요.');$('#loginBtn').disabled=true;return}
 if(!(cfg.SUPABASE_URL&&cfg.SUPABASE_PUBLISHABLE_KEY)){loginMsg('서버가 연결되지 않았어요. admin/config.js에 SUPABASE_URL과 SUPABASE_PUBLISHABLE_KEY를 넣어 주세요.');$('#loginBtn').disabled=true;return}
 const {createClient}=await import('../assets/supabase.js');
 sb=createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY);
 sb.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')setTimeout(showLogin,0)});
 const {data:{session}}=await sb.auth.getSession();
 if(session)await enter(session);else showLogin();
}
async function login(){
 if(!sb)return;
 loginMsg('');
 const email=$('#email').value.trim(),password=$('#password').value;
 if(!email||!password){loginMsg('이메일과 비밀번호를 모두 적어 주세요.');return}
 $('#loginBtn').disabled=true;
 try{const {data,error}=await sb.auth.signInWithPassword({email,password});if(error)throw error;await enter(data.session)}
 catch(e){loginMsg(/invalid.login|invalid_credentials|invalid_grant/i.test(`${e.code||''} ${e.message||''}`)?'이메일 또는 비밀번호가 맞지 않아요.':errText(e))}
 finally{$('#loginBtn').disabled=false}
}
async function enter(session){
 let role=null;
 try{role=await rpc('archive_role')}
 catch(e){await sb.auth.signOut().catch(()=>{});showLogin();loginMsg(e?.code==='PGRST202'?'서버에 archive_role 함수가 없어요. 아카이브 데이터베이스 마이그레이션을 먼저 적용하세요.':'역할을 확인하지 못해 로그아웃했어요. '+errText(e));return}
 if(!RANK[role]){await sb.auth.signOut().catch(()=>{});showLogin();loginMsg('이 계정에는 운영 역할이 없어서 로그아웃했어요. 관리자에게 역할(관리자·편집자·연구자)을 받아야 들어올 수 있어요.');return}
 S.role=role;S.email=session?.user?.email||'';
 $('#loginView').hidden=true;$('#nav').hidden=false;$('#who').hidden=false;$('#logoutBtn').hidden=false;
 $('#whoEmail').textContent=S.email;$('#whoRole').textContent=lbl('role',role);
 document.body.classList.add('signed-in');
 for(const el of $$('[data-min-role]'))el.hidden=!can(el.dataset.minRole);
 put($('#navList'),TABS.filter(t=>can(t[2])).map(([id,l])=>html`<li><a href="#${id}" data-tab="${id}">${l}</a></li>`));
 route(false);
}

const TABS=[['dashboard','대시보드','editor'],['queue','검수 대기열','editor'],['projects','프로젝트','editor'],['updates','변경 감지','editor'],['runs','수집 작업','editor'],['rules','수집 규칙·키워드','editor'],['settings','설정','admin'],['research','연구자 평가','researcher'],['magazine','매거진','editor'],['places','장소 후보','editor']];
function route(focus){
 if(!S.role)return;
 const allowed=TABS.filter(t=>can(t[2])).map(t=>t[0]);
 let id=location.hash.slice(1);if(!allowed.includes(id))id=allowed[0];
 if(location.hash.slice(1)!==id)history.replaceState(null,'','#'+id);
 S.tab=id;
 for(const v of $$('.view'))v.hidden=v.id!=='view-'+id;
 for(const a of $$('#navList a')){if(a.dataset.tab===id){a.setAttribute('aria-current','page');a.scrollIntoView({block:'nearest',inline:'nearest'})}else a.removeAttribute('aria-current')}
 if(focus)$('#h-'+id)?.focus();
 Promise.resolve(LOAD[id]?.()).catch(e=>toast(errText(e),true));
}
addEventListener('hashchange',()=>route(true));

function fillStatic(){
 put($('#qStatus'),options(vocab('candidate_status'),'', '검수 대기 · 판단 보류'));
 put($('#projectVis'),options(vocab('visibility'),'', '전체'));
 put($('#kwPolarity'),options(vocab('polarity'),'', '전체'));
}
function fillRuleSelects(){
 const a=$('#runRule'),b=$('#runsRule'),va=a.value,vb=b.value;
 const list=S.rules.map(r=>[r.id,`${r.name} · ${lbl('rule_kind',r.kind)}${r.enabled?'':' (꺼짐)'}`]);
 put(a,options(list,va||S.rules.find(r=>r.enabled)?.id||'',null));
 put(b,options(list,vb,'모든 규칙'));
}
const ruleName=x=>x?.rule_name||S.rules.find(r=>r.id===x?.rule_id)?.name||(x?.rule_id?'규칙 '+String(x.rule_id).slice(0,8):'—');

// ---- 대시보드 ----
const DASH=[['queue','검수 대기','candidate_status'],['runs_24h','24시간 실행','run_status'],['runs_7d','7일 실행','run_status'],['errors','수집 오류','stage'],['open_updates','처리 전 변경','update_kind'],['broken_links','깨진 링크','link_state'],['sources_by_status','출처 링크 상태','link_state'],['projects_by_visibility','프로젝트 공개 상태','visibility'],['projects_by_review','프로젝트 검수 상태','review_status']];
const ALIAS={queue:'queue_counts',errors:'errors_24h'};
function tile([k,label,voc],v){
 let n=null,parts=[];
 if(typeof v==='number'||typeof v==='string')n=Number(v);
 else if(v&&typeof v==='object'){
  parts=Object.entries(v).filter(([x])=>x!=='total');
  n=k==='queue'&&('needs_review' in v||'uncertain' in v)?(+v.needs_review||0)+(+v.uncertain||0):'total' in v?+v.total:parts.reduce((a,[,c])=>a+(+c||0),0);
 }
 const warn=['errors','broken_links'].includes(k)&&n>0;
 return html`<div class="tile${warn?' tile-warn':''}"><span class="tile-label">${label}</span><b class="tile-num">${num(n)}</b>${parts.length?html`<ul class="tile-parts">${parts.map(([x,c])=>html`<li><span>${lbl(voc,x)}</span><b>${num(c)}</b></li>`)}</ul>`:''}</div>`;
}
const failing=r=>r.failure_count>0||r.last_status==='error'||!!until(r.backoff_until);
function attention(list){
 const bad=list.filter(failing);
 if(!bad.length)return html`<p class="muted">실패하거나 재시도를 기다리는 규칙이 없어요.</p>`;
 return html`<ul class="picklist">${bad.map(r=>html`<li><div><b>${r.name}</b> <span class="muted small">${lbl('rule_kind',r.kind)} · 연속 실패 ${num(r.failure_count||0)}회${until(r.backoff_until)?` · ${until(r.backoff_until)} 재시도`:''}</span></div>${can('admin')?html`<button type="button" class="btn" data-act="rule-retry" data-id="${r.id}">다시 시도</button>`:''}</li>`)}</ul><div data-result aria-live="polite"></div>`;
}
async function loadDashboard(){
 put($('#dashTiles'),html`<p class="muted">불러오는 중…</p>`);
 const [d,runs,rules]=await Promise.allSettled([rpc('archive_admin_dashboard'),rpc('archive_admin_list_runs',{p_limit:10,p_rule_id:null}),rpc('archive_admin_list_rules')]);
 if(rules.status==='fulfilled'){S.rules=rows(rules.value);fillRuleSelects();put($('#dashRules'),attention(S.rules))}else put($('#dashRules'),errBox(rules.reason,'규칙을 불러오지 못했어요.'));
 if(d.status==='fulfilled'){S.dash=d.value||{};put($('#dashTiles'),DASH.map(x=>tile(x,S.dash[x[0]]??S.dash[ALIAS[x[0]]])))}else put($('#dashTiles'),errBox(d.reason,'현황을 불러오지 못했어요.'));
 put($('#dashRuns'),runs.status==='fulfilled'?runsTable(rows(runs.value),true):errBox(runs.reason,'실행 기록을 불러오지 못했어요.'));
}
const COUNTS=[['fetched','가져옴'],['kept','남김'],['new_candidates','새 후보'],['matched_projects','기존 연결'],['duplicates','중복'],['ignored','제외'],['errors','오류']];
function runsTable(list,compact=false){
 if(!list.length)return html`<p class="muted">아직 실행 기록이 없어요.</p>`;
 const cols=compact?COUNTS.filter(([k])=>['fetched','new_candidates','errors'].includes(k)):COUNTS;
 return html`<div class="table-scroll" tabindex="0" role="region" aria-label="실행 기록 표"><table><thead><tr><th scope="col">시작</th><th scope="col">규칙</th>${compact?'':html`<th scope="col">계기</th>`}<th scope="col">상태</th><th scope="col">소요</th>${cols.map(([,l])=>html`<th scope="col" class="n">${l}</th>`)}</tr></thead><tbody>${list.map(r=>html`<tr><td>${when(r.started_at)}</td><td>${ruleName(r)}</td>${compact?'':html`<td>${lbl('trigger',r.trigger)}</td>`}<td>${pill(lbl('run_status',r.status),RUN_TONE[r.status])}</td><td>${dur(r.started_at,r.finished_at)}</td>${cols.map(([k])=>html`<td class="n">${num(r[k])}</td>`)}</tr>`)}</tbody></table></div>`;
}
function collectResult(r){
 const list=rows(r?.runs||r?.results),top=Object.entries(r||{}).filter(([,v])=>v!=null&&typeof v!=='object');
 const name=Object.fromEntries([...COUNTS,['rules','규칙'],['ok','성공'],['dry_run','시험 실행'],['status','상태'],['error','오류 내용']]);
 return html`<div class="notice ok"><b>수집 요청을 마쳤어요.</b>${top.length?html`<ul class="kv-inline">${top.map(([k,v])=>html`<li><span>${name[k]||k}</span> <b>${typeof v==='number'?num(v):String(v)}</b></li>`)}</ul>`:''}</div>
 ${list.length?html`<ul class="runlines">${list.map(x=>html`<li>${ruleName(x)} ${x.status?pill(lbl('run_status',x.status),RUN_TONE[x.status]):''} ${COUNTS.filter(([k])=>x[k]!=null).map(([k,l])=>html`<span class="muted small">${l} ${num(x[k])}</span> `)}${x.error?html`<span class="err small">${typeof x.error==='string'?x.error:JSON.stringify(x.error)}</span>`:''}</li>`)}</ul>`:''}
 <details class="raw-box"><summary>응답 전체 보기</summary><pre class="raw">${JSON.stringify(r,null,2)}</pre></details>`;
}
async function runCollect(body,box){
 put(box,html`<p class="muted">수집하고 있어요. 규칙에 따라 1분쯤 걸릴 수 있어요.</p>`);
 try{put(box,collectResult(await callFunction('archive-collect',body)))}catch(e){put(box,errBox(e,'수집을 실행하지 못했어요.'))}
}
const forms={},acts={};
forms['run-now']=async(f,fd)=>{
 const body=fd.get('mode')==='due'?{max_rules:Math.min(6,Math.max(1,parseInt(fd.get('max_rules'),10)||1))}:{rule_ids:[String(fd.get('rule_id')||'')]};
 if(body.rule_ids&&!body.rule_ids[0])throw formErr('rule_id','실행할 규칙을 고르세요.');
 await runCollect(body,$('#runResult'));
 loadDashboard().catch(()=>{});
};
acts['rule-retry']=async el=>{const box=el.closest('.card')?.querySelector('[data-result]');el.disabled=true;try{await runCollect({rule_ids:[el.dataset.id]},box)}finally{if(el.isConnected)el.disabled=false}};

// ---- 검수 대기열 ----
const OPEN=['needs_review','uncertain','auto_ignored'];
const candTitle=c=>c.detected_name||rows(c.hits)[0]?.title||'(제목 없음)';
const hitCount=c=>c.hit_count??rows(c.hits).length;
const curCand=()=>S.q.items[S.q.sel];
async function loadQueue({append=false,keep=null}={}){
 const fd=new FormData($('#queueFilter')),q=S.q;
 const params={p_status:fd.get('status')||null,p_q:String(fd.get('q')||'').trim()||null,p_min_conf:Number(fd.get('min_conf')||0),p_limit:PAGE,p_offset:append?q.items.length:0};
 if(!append)$('#queueCount').textContent='불러오는 중…';
 let list;
 try{list=rows(await rpc('archive_admin_list_candidates',params))}
 catch(e){q.items=[];q.sel=-1;put($('#queueList'),html`<li>${errBox(e,'후보를 불러오지 못했어요.')}</li>`);$('#queueCount').textContent='';$('#queueMore').hidden=true;renderDrawer();return}
 q.items=append?q.items.concat(list):list;q.more=list.length===PAGE;
 let i=-1;
 if(keep?.id)i=q.items.findIndex(c=>c.id===keep.id);
 if(i<0&&keep?.index!=null&&q.items.length)i=Math.min(keep.index,q.items.length-1);
 q.sel=i;
 renderQueue();renderDrawer();
}
function renderQueue(){
 const q=S.q;
 $('#queueCount').textContent=q.items.length?`후보 ${q.items.length}건${q.more?' 이상':''}`:'';
 put($('#queueList'),q.items.length?q.items.map((c,i)=>html`<li><button type="button" class="qitem" data-act="queue-pick" data-i="${i}"${on(i===q.sel,'aria-current="true"')}>
  <span class="qi-title">${candTitle(c)}</span>
  <span class="pills">${pill(lbl('candidate_label',c.label),LABEL_TONE[c.label])}${c.status!=='needs_review'?pill(lbl('candidate_status',c.status)):''}</span>
  <span class="qi-nums"><span>점수 <b>${num(c.score)}</b></span><span>신뢰도 <b>${num(c.confidence)}</b></span><span>기사 <b>${num(hitCount(c))}</b>건</span></span>
  <span class="qi-meta">${[countryName(c.detected_country_iso2),c.detected_city].filter(Boolean).join(' · ')||'위치 미확인'} · 처음 ${day(c.first_seen_at)||'—'} · 최근 ${ago(c.last_seen_at)}</span>
 </button></li>`):html`<li class="empty">조건에 맞는 후보가 없어요.</li>`);
 $('#queueMore').hidden=!q.more;
}
function select(i,focus=true){
 const q=S.q;if(i<0||i>=q.items.length)return;
 q.sel=i;q.panel=null;
 for(const b of $$('#queueList .qitem'))b.dataset.i==String(i)?b.setAttribute('aria-current','true'):b.removeAttribute('aria-current');
 renderDrawer();
 if(focus)(matchMedia('(max-width: 900px)').matches?$('#drawerTitle'):$(`#queueList .qitem[data-i="${i}"]`))?.focus();
}
function closeDrawer(){
 const i=S.q.sel;S.q.sel=-1;S.q.panel=null;
 for(const b of $$('#queueList .qitem'))b.removeAttribute('aria-current');
 renderDrawer();$(`#queueList .qitem[data-i="${i}"]`)?.focus();
}
function renderDrawer(){
 const c=curCand(),d=$('#drawer');
 $('#queueSplit').classList.toggle('has-detail',!!c);d.classList.toggle('open',!!c);
 put(d,c?drawerHTML(c):html`<p class="muted placeholder">후보를 고르면 근거와 처리 버튼이 여기 나와요.</p>`);
 if(c&&S.q.panel)put($('#reviewPanel'),reviewPanel(c,S.q.panel));
}
const hitItem=h=>html`<li class="hit"><p class="hit-title">${link(h.url||h.canonical_url,h.title||h.url)}</p><p class="muted small">${[h.publisher,lbl('rule_kind',h.provider),day(h.published_at)].filter(Boolean).join(' · ')}</p>${h.excerpt?html`<p class="excerpt">${h.excerpt}</p>`:''}</li>`;
function matchItem(m,open){
 const sim=m.similarity??m.score;
 return html`<li><div><b>${pname(m)}</b> <span class="muted small">${placeLine(m)}${sim!=null?` · 유사도 ${sim<=1?Math.round(sim*100)+'%':sim}`:''}${m.reason?` · ${m.reason}`:''}</span></div>${open&&(m.id||m.project_id)?html`<button type="button" class="btn" data-act="rv-attach" data-project="${m.id||m.project_id}">이 프로젝트에 연결</button>`:''}</li>`;
}
function drawerHTML(c){
 const hits=rows(c.hits),matches=rows(c.suggested_matches),reasons=rows(c.reasons),open=OPEN.includes(c.status);
 return html`<div class="drawer-head"><h2 id="drawerTitle" tabindex="-1">${candTitle(c)}</h2><button type="button" class="btn ghost" data-act="drawer-close" aria-label="상세 닫기 (Esc)">닫기</button></div>
 <p class="pills">${pill(lbl('candidate_label',c.label),LABEL_TONE[c.label])}${pill(lbl('candidate_status',c.status),c.status==='needs_review'?'accent':'muted')}</p>
 <dl class="facts"><div><dt>분류 점수</dt><dd>${num(c.score)}</dd></div><div><dt>신뢰도</dt><dd>${num(c.confidence)}</dd></div><div><dt>발견</dt><dd>${num(c.seen_count)}회 · 기사 ${num(hits.length)}건</dd></div><div><dt>처음 발견</dt><dd>${when(c.first_seen_at)}</dd></div><div><dt>최근 발견</dt><dd>${when(c.last_seen_at)}</dd></div></dl>
 ${c.reviewed_at?html`<p class="notice small">${when(c.reviewed_at)}에 처리했어요.${c.review_note?html` 메모: ${c.review_note}`:''}</p>`:''}
 <section class="review" aria-labelledby="rvH"><h3 id="rvH">처리</h3>
 ${open?html`<div class="actions" role="group" aria-label="검수 처리">${[['approve','새 프로젝트로 승인','primary'],['attach','기존 프로젝트에 연결',''],['merge','다른 후보와 병합',''],['reject','반려','danger']].map(([p,l,cls])=>html`<button type="button" class="btn ${cls}" data-act="rv-panel" data-panel="${p}" aria-expanded="${S.q.panel===p?'true':'false'}" aria-controls="reviewPanel">${l}</button>`)}${c.status==='auto_ignored'?html`<button type="button" class="btn ghost" data-act="rv-reopen">다시 열기</button>`:html`<button type="button" class="btn ghost" data-act="rv-ignore">무시</button>`}</div>${c.status==='auto_ignored'?html`<p class="muted small">점수가 낮아 자동으로 제외된 후보예요. 다시 열면 검수 대기로 돌아가요.</p>`:''}`
 :html`<div class="actions"><button type="button" class="btn" data-act="rv-reopen">다시 열기</button></div><p class="muted small">이미 처리한 후보예요. 다시 열면 대기열로 돌아가요.</p>`}
 <div id="reviewPanel"></div></section>
 <section aria-labelledby="whyH"><h3 id="whyH">분류 근거</h3>${reasons.length?html`<ul class="reasons">${reasons.map(r=>html`<li>${typeof r==='string'?r:JSON.stringify(r)}</li>`)}</ul>`:html`<p class="muted">근거가 기록되지 않았어요.</p>`}<p class="muted small">자동 분류${c.classifier_version?` ${c.classifier_version}`:''}의 판단이라 참고용이에요. 사실은 기사를 읽고 확인하세요.</p></section>
 <section aria-labelledby="locH"><h3 id="locH">감지한 위치</h3><dl class="facts"><div><dt>국가</dt><dd>${c.detected_country_iso2?`${countryName(c.detected_country_iso2)} (${c.detected_country_iso2})`:'미확인'}</dd></div><div><dt>도시</dt><dd>${c.detected_city||'미확인'}</dd></div><div><dt>좌표</dt><dd>${c.latitude!=null&&c.longitude!=null?`${c.latitude}, ${c.longitude}`:'미확인'}</dd></div><div><dt>언어</dt><dd>${c.language?`${langName(c.language)} (${c.language})`:'미확인'}</dd></div></dl></section>
 <section aria-labelledby="matchH"><h3 id="matchH">비슷한 프로젝트</h3>${matches.length?html`<ul class="picklist">${matches.map(m=>matchItem(m,open))}</ul>`:html`<p class="muted">아카이브에서 비슷한 프로젝트를 찾지 못했어요.</p>`}</section>
 <section aria-labelledby="hitH"><h3 id="hitH">기사·출처 ${hits.length}건</h3>${hits.length?html`<ol class="hits">${hits.map(hitItem)}</ol>`:html`<p class="muted">기사가 없어요.</p>`}</section>`;
}
const APPROVE=['name_original','name_original_lang','name_ko','name_en','country_iso2','city','address','latitude','longitude','building_name','project_type','installation_method','year_installed','operating_status','official_url','summary_ko'];
const LABEL_TYPE={facade_project:'media_facade',event_program:'festival_program'};
function reviewPanel(c,p){
 if(p==='approve'){
  const pre={name_original:c.detected_name,name_original_lang:c.language,country_iso2:c.detected_country_iso2,city:c.detected_city,latitude:c.latitude,longitude:c.longitude,project_type:LABEL_TYPE[c.label]};
  return html`<form data-form="rv-approve" class="panel-form" novalidate><p class="muted small">감지한 값을 미리 채웠어요. 기사에서 확인한 값만 남기고 모르는 칸은 비워 두세요(미확인).</p><div class="fields">${APPROVE.map(k=>plainField(k,pre[k],'ap'))}</div><label class="check toggle"><input type="checkbox" name="publish" value="1"> 승인하면서 바로 공개</label><button class="btn primary" type="submit">승인하고 프로젝트 만들기</button></form>`;
 }
 if(p==='attach')return html`<form data-form="rv-attach-search" class="panel-form" role="search" aria-label="연결할 프로젝트 검색"><label for="rvAttachQ">연결할 프로젝트 검색</label><div class="inline"><input id="rvAttachQ" name="q" type="search" value="${c.detected_name||''}"><button class="btn" type="submit">검색</button></div></form><ul id="rvAttachResults" class="picklist"></ul>`;
 if(p==='merge'){
  const others=S.q.items.filter(x=>x.id!==c.id);
  return others.length?html`<form data-form="rv-merge" class="panel-form"><label for="rvMergeInto">합칠 대상 후보</label><select id="rvMergeInto" name="into">${others.map(o=>html`<option value="${o.id}">${candTitle(o)} · ${lbl('candidate_status',o.status)}</option>`)}</select><p class="muted small">이 후보의 기사가 고른 후보로 옮겨지고, 이 후보는 '병합'이 돼요.</p><button class="btn primary" type="submit">병합하기</button></form>`:html`<p class="muted">목록에 병합할 다른 후보가 없어요. 필터를 바꿔 보세요.</p>`;
 }
 if(p==='reject')return html`<form data-form="rv-reject" class="panel-form" novalidate><label for="rvNote">반려 사유 (꼭 적어 주세요)</label><textarea id="rvNote" name="note" rows="3" aria-describedby="rvNoteErr" placeholder="예: 광고 전광판, 제품 홍보 기사"></textarea><p id="rvNoteErr" class="field-err" hidden></p><button class="btn danger" type="submit">반려하기</button></form>`;
 return '';
}
const DONE={approve_new:'새 프로젝트로 승인했어요.',attach:'기존 프로젝트에 연결했어요.',merge:'다른 후보와 병합했어요.',reject:'반려했어요.',ignore:'무시했어요.',reopen:'다시 열었어요.'};
async function review(action,payload){
 const c=curCand();if(!c)return;
 const index=S.q.sel;
 await rpc('archive_admin_review_candidate',{p_id:c.id,p_action:action,p_payload:payload});
 toast(DONE[action]);
 await loadQueue({keep:{index}});
 if(S.q.sel>=0)select(S.q.sel);
}
acts['queue-pick']=el=>select(Number(el.dataset.i));
acts['queue-more']=()=>loadQueue({append:true,keep:{id:curCand()?.id}});
acts['drawer-close']=()=>closeDrawer();
acts['rv-panel']=el=>{
 S.q.panel=S.q.panel===el.dataset.panel?null:el.dataset.panel;
 for(const b of $$('[data-act="rv-panel"]'))b.setAttribute('aria-expanded',String(b.dataset.panel===S.q.panel));
 put($('#reviewPanel'),S.q.panel?reviewPanel(curCand(),S.q.panel):'');
 $('#reviewPanel input:not([type=checkbox]),#reviewPanel textarea,#reviewPanel select')?.focus();
};
acts['rv-ignore']=()=>review('ignore',{});
acts['rv-reopen']=()=>review('reopen',{});
acts['rv-attach']=el=>review('attach',{project_id:el.dataset.project});
forms['rv-approve']=async f=>{
 const out={};for(const k of APPROVE){const v=readField(f,k);if(v!=null)out[k]=v}
 if(!out.name_original&&!out.name_ko&&!out.name_en)throw fieldErr('name_original','이름을 하나 이상 적어 주세요.');
 out.publish=f.elements.namedItem('publish').checked;
 await review('approve_new',out);
};
forms['rv-reject']=async(f,fd)=>{
 const note=String(fd.get('note')||'').trim(),box=f.elements.namedItem('note'),err=$('#rvNoteErr');
 if(!note){err.textContent='반려 사유를 적어 주세요.';err.hidden=false;box.setAttribute('aria-invalid','true');box.focus();return}
 await review('reject',{note});
};
forms['rv-merge']=(f,fd)=>review('merge',{into_candidate_id:String(fd.get('into'))});
forms['rv-attach-search']=async(f,fd)=>{
 const box=$('#rvAttachResults');put(box,html`<li class="muted">찾는 중…</li>`);
 try{const list=rows(await rpc('archive_admin_list_projects',{p_q:String(fd.get('q')||'').trim()||null,p_visibility:null,p_limit:10,p_offset:0}));put(box,list.length?list.map(p=>html`<li><div><b>${pname(p)}</b> <span class="muted small">${placeLine(p)} · ${lbl('visibility',p.visibility)}</span></div><button type="button" class="btn" data-act="rv-attach" data-project="${p.id}">이 프로젝트에 연결</button></li>`):html`<li class="muted">찾는 프로젝트가 없어요.</li>`)}
 catch(e){put(box,html`<li>${errBox(e,'프로젝트를 찾지 못했어요.')}</li>`)}
};

// ---- 프로젝트 ----
async function loadProjects({append=false,open=null}={}){
 const fd=new FormData($('#projectFilter')),P=S.p;
 if(!append)$('#projectCount').textContent='불러오는 중…';
 let list;
 try{list=rows(await rpc('archive_admin_list_projects',{p_q:String(fd.get('q')||'').trim()||null,p_visibility:fd.get('visibility')||null,p_limit:PAGE,p_offset:append?P.items.length:0}))}
 catch(e){put($('#projectList'),html`<li>${errBox(e,'프로젝트를 불러오지 못했어요.')}</li>`);$('#projectCount').textContent='';$('#projectMore').hidden=true;return}
 P.items=append?P.items.concat(list):list;P.more=list.length===PAGE;
 const p=open&&P.items.find(x=>x.id===open);
 if(p)openProject(p,false);else renderProjectList();
}
function renderProjectList(){
 const P=S.p;
 $('#projectCount').textContent=P.items.length?`프로젝트 ${P.items.length}건${P.more?' 이상':''}`:'';
 put($('#projectList'),P.items.length?P.items.map(p=>html`<li><button type="button" class="pitem" data-act="project-open" data-id="${p.id}"${on(P.cur?.id===p.id,'aria-current="true"')}><span class="pi-title">${pname(p)}</span><span class="muted small">${placeLine(p)}${p.project_type?` · ${lbl('project_type',p.project_type)}`:''}</span><span class="pills">${pill(lbl('visibility',p.visibility),VIS_TONE[p.visibility])}${pill(lbl('review_status',p.review_status),p.review_status==='unreviewed'?'muted':'ok')}${p.update_status&&p.update_status!=='current'?pill(lbl('update_status',p.update_status),'warn'):''}</span></button></li>`):html`<li class="empty">찾는 프로젝트가 없어요.</li>`);
 $('#projectMore').hidden=!P.more;
}
function openProject(p,focus=true){
 S.p.cur=p;S.p.confirm=new Set();
 renderProjectList();
 put($('#projectEditor'),editor(p));
 $('#projectSplit').classList.add('has-detail');
 if(focus)$('#editorTitle')?.focus();
}
const refreshProject=()=>loadProjects({open:S.p.cur?.id});
function editor(p){
 const isNew=!p.id,fs=p.field_status||{},region=T.regionOf(p.country_iso2);
 return html`<div class="editor-head"><button type="button" class="btn ghost back" data-act="project-close">← 목록</button>
 <h2 id="editorTitle" tabindex="-1">${isNew?'새 프로젝트':pname(p)}</h2>
 ${isNew?html`<p class="muted small">편집부가 직접 등록하는 프로젝트예요. 확인한 값만 적고, 저장한 뒤 출처를 붙이세요.</p>`:html`<p class="pills">${pill(lbl('visibility',p.visibility),VIS_TONE[p.visibility])}${pill(lbl('review_status',p.review_status))}${pill(lbl('record_origin',p.record_origin))}${p.update_status&&p.update_status!=='current'?pill(lbl('update_status',p.update_status),'warn'):''}</p>
 <dl class="facts small"><div><dt>슬러그</dt><dd class="mono">${p.slug||'—'}</dd></div><div><dt>권역 (국가에서 자동)</dt><dd>${region?lbl('region',region):'미확인'}</dd></div><div><dt>처음 수집</dt><dd>${when(p.first_collected_at)}</dd></div><div><dt>마지막 수집</dt><dd>${when(p.last_collected_at)}</dd></div><div><dt>마지막 확인</dt><dd>${when(p.last_verified_at)}</dd></div><div><dt>고친 때</dt><dd>${when(p.updated_at)}</dd></div></dl>`}</div>
 <p class="legend small"><span class="state state-unverified">미확인</span> 값이나 출처가 없음 <span class="state state-source_reported">출처 기재</span> 출처에 적힌 값 <span class="state state-derived">분류 추정</span> 분류에서 끌어낸 값 <span class="state state-editor_verified">편집 확인</span> 편집자가 확인함. 값을 고치거나 '값 확인'을 누르고 저장하면 편집 확인이 돼요.</p>
 <form id="projectForm" data-form="project-save" novalidate>
  ${GROUPS.map(([,title,keys])=>html`<fieldset class="group"><legend>${title}</legend><div class="fields">${keys.map(k=>fieldBox(k,p[k],fs[k]))}</div></fieldset>`)}
  <fieldset class="group"><legend>크레딧</legend><div id="creditRows">${rows(p.credits).map(c=>creditRow(c))}</div><button type="button" class="btn" data-act="credit-add">크레딧 추가</button></fieldset>
  <div class="savebar"><span id="dirtyNote" class="muted small" aria-live="polite"></span><button class="btn primary" type="submit">${isNew?'프로젝트 만들기':'저장'}</button></div>
 </form>
 ${isNew?html`<p class="notice">출처, 미디어, 공개 상태, 합치기는 저장한 뒤에 할 수 있어요.</p>`:html`${sourcesSection(p)}${mediaSection(p)}<section class="group" aria-labelledby="visH"><h3 id="visH">공개 상태</h3>${visibilityForm(p)}</section>${mergeSection()}`}`;
}
const creditRow=(c={})=>html`<div class="credit-row" data-credit><input type="hidden" name="credit_source" value="${c.source_id||''}">
 <label class="f">역할<select name="credit_role">${options(vocab('credit_role'),c.role||'other',null)}</select></label>
 <label class="f grow">이름<input name="credit_name" value="${c.name||''}"></label>
 <label class="f grow">영문 이름<input name="credit_name_en" value="${c.name_en||''}"></label>
 <label class="f">Wikidata ID<input name="credit_qid" value="${c.wikidata_qid||''}" placeholder="Q…"></label>
 <button type="button" class="btn ghost danger" data-act="credit-remove">빼기</button></div>`;
function readCredits(f){
 return $$('[data-credit]',f).map(r=>{
  const g=n=>String(r.querySelector(`[name="${n}"]`)?.value||'').trim()||null;
  const c={role:g('credit_role')||'other',name:g('credit_name'),name_en:g('credit_name_en'),wikidata_qid:g('credit_qid')};
  if(c.wikidata_qid&&!/^Q[1-9]\d*$/.test(c.wikidata_qid))throw Error('크레딧의 Wikidata ID는 Q로 시작해야 해요.');
  if(g('credit_source'))c.source_id=g('credit_source');
  return c;
 }).filter(c=>c.name);
}
const creditKey=list=>JSON.stringify(rows(list).map(c=>[c.role||'other',c.name||null,c.name_en||null,c.wikidata_qid||null]));
const creditsChanged=f=>{try{return creditKey(readCredits(f))!==creditKey(S.p.cur?.credits)}catch{return true}};
function isDirty(f,k){try{return !same(k,readField(f,k),S.p.cur[k])||S.p.confirm.has(k)}catch{return true}}
function refreshField(f,k){
 const b=$(`[data-state-for="${k}"]`,f);if(!b)return;
 if(isDirty(f,k)){let v=null;try{v=readField(f,k)}catch{}b.className='state state-pending';b.textContent=blank(v)?'미확인 · 저장 전':'편집 확인 · 저장 전';return}
 const p=S.p.cur,s=blank(p[k])?'unverified':(p.field_status||{})[k]?.state||'unverified';
 b.className='state state-'+s;b.textContent=lbl('field_state',s);
}
function countDirty(f){const n=FIELDS.filter(k=>isDirty(f,k)).length+(creditsChanged(f)?1:0);$('#dirtyNote').textContent=n?`저장하지 않은 항목 ${n}개`:''}
acts['field-confirm']=el=>{const f=$('#projectForm');S.p.confirm.add(el.dataset.field);refreshField(f,el.dataset.field);countDirty(f);el.hidden=true};
acts['credit-add']=()=>{$('#creditRows').insertAdjacentHTML('beforeend',show(creditRow()));countDirty($('#projectForm'));$('#creditRows [data-credit]:last-child select')?.focus()};
acts['credit-remove']=el=>{el.closest('[data-credit]').remove();countDirty($('#projectForm'))};
// Only changed (or confirmed) fields are sent: the server marks each field it receives editor_verified, and a null
// clears the value and its state. Fields the editor did not touch keep their value and provenance.
forms['project-save']=async f=>{
 const p=S.p.cur,isNew=!p.id,out=isNew?{}:{id:p.id};
 for(const k of FIELDS){const v=readField(f,k);if(isNew?v!=null:(!same(k,v,p[k])||S.p.confirm.has(k)))out[k]=v}
 const credits=readCredits(f);
 if(isNew?credits.length:creditKey(credits)!==creditKey(p.credits))out.credits=credits;
 if(Object.keys(out).length===(isNew?0:1)){toast('바뀐 내용이 없어요.');return}
 if(isNew&&!out.name_original&&!out.name_ko&&!out.name_en)throw fieldErr('name_original','이름을 하나 이상 적어 주세요.');
 const id=await rpc('archive_admin_upsert_project',{p_project:out});
 toast(isNew?'프로젝트를 만들었어요.':'저장했어요.');
 await loadProjects({open:(typeof id==='string'&&id)||p.id});
};
acts['project-open']=el=>{const p=S.p.items.find(x=>x.id===el.dataset.id);if(p)openProject(p)};
acts['project-new']=()=>openProject({});
acts['project-more']=()=>loadProjects({append:true,open:S.p.cur?.id});
acts['project-close']=()=>{S.p.cur=null;$('#projectSplit').classList.remove('has-detail');put($('#projectEditor'),html`<p class="muted placeholder">프로젝트를 고르거나 새로 만드세요.</p>`);renderProjectList();$('#projectList .pitem')?.focus()};
acts['project-goto']=el=>{$('#projectQ').value=el.dataset.name||'';S.p.pendingOpen=el.dataset.id;S.p.cur=null;location.hash='#projects'};

const sourceList=(list,removable)=>rows(list).length?html`<ul class="sources">${rows(list).map(s=>html`<li class="source"><p class="source-title">${link(s.url,s.title||s.url)}</p>
 <p class="muted small">${[s.publisher,lbl('source_kind',s.source_kind||s.kind),s.language&&langName(s.language),day(s.published_at)].filter(Boolean).join(' · ')}</p>
 <p class="pills">${pill('신뢰도 '+num(s.reliability))}${pill(lbl('link_state',s.link_state||'unknown'),s.link_state==='broken'?'bad':s.link_state==='ok'?'ok':'muted')}${pill('라이선스: '+(s.license||'미확인'))}</p>
 ${rows(s.supports).length?html`<p class="small">뒷받침하는 항목: ${rows(s.supports).map(k=>F[k]?.[0]||k).join(', ')}</p>`:''}
 ${removable&&(s.id||s.source_id)?html`<button type="button" class="btn ghost danger" data-act="source-remove" data-id="${s.id||s.source_id}">출처 빼기</button>`:''}</li>`)}</ul>`:html`<p class="muted">아직 출처가 없어요. 출처가 없는 값은 미확인으로 보여요.</p>`;
function sourcesSection(p){
 return html`<section class="group" aria-labelledby="srcH"><h3 id="srcH">출처 ${rows(p.sources).length}건</h3>${sourceList(p.sources,true)}
 <details class="addbox"><summary>출처 추가</summary><form data-form="source-add" class="panel-form" novalidate><div class="fields">
  <div class="field wide"><label for="srcUrl">출처 주소</label><input id="srcUrl" name="url" type="url" placeholder="https://"></div>
  <div class="field wide"><label for="srcTitle">제목</label><input id="srcTitle" name="title"></div>
  <div class="field"><label for="srcPub">발행처</label><input id="srcPub" name="publisher"></div>
  <div class="field"><label for="srcKind">출처 종류</label><select id="srcKind" name="source_kind">${options(vocab('source_kind'),'','고르세요')}</select></div>
  <div class="field"><label for="srcLang">언어</label><select id="srcLang" name="language">${options(langOptions(),'')}</select></div>
  <div class="field"><label for="srcDate">발행일</label><input id="srcDate" name="published_at" type="date"></div>
  <div class="field wide"><label for="srcLic">라이선스</label><input id="srcLic" name="license" placeholder="예: 저작권 있음(링크만), CC BY 4.0, CC0"></div>
  <fieldset class="field wide"><legend>이 출처가 뒷받침하는 항목</legend><div class="checks">${FIELDS.map(k=>html`<label class="check"><input type="checkbox" name="supports" value="${k}"> ${F[k][0]}</label>`)}</div></fieldset>
 </div><button class="btn primary" type="submit">출처 추가</button></form></details></section>`;
}
forms['source-add']=async(f,fd)=>{
 const url=String(fd.get('url')||'').trim();
 if(!safeURL(url))throw formErr('url','출처 주소는 http:// 또는 https://로 시작해야 해요.');
 if(!fd.get('source_kind'))throw formErr('source_kind','출처 종류를 고르세요.');
 const src={url,source_kind:String(fd.get('source_kind'))};
 for(const k of ['title','publisher','language','published_at','license']){const v=String(fd.get(k)||'').trim();if(v)src[k]=v}
 await rpc('archive_admin_add_source',{p_project_id:S.p.cur.id,p_source:src,p_supports:fd.getAll('supports').map(String)});
 toast('출처를 추가했어요.');await refreshProject();
};
acts['source-remove']=async el=>{if(!armed(el,'한 번 더 누르면 빼요'))return;await rpc('archive_admin_remove_source',{p_project_id:S.p.cur.id,p_source_id:el.dataset.id});toast('출처를 뺐어요.');await refreshProject()};

// Same licence rule as the image pipeline (edge-functions/_shared/live-media.mjs licenseAllowed).
const licenseAllowed=l=>/^(cc by(?: sa)? (?:1\.0|2\.0|2\.5|3\.0|4\.0)(?: [a-z]{2})?|cc0(?: 1\.0)?|public domain|pd)$/.test(String(l||'').trim().toLowerCase().replace(/[-_]/g,' ').replace(/\s+/g,' '));
const RIGHTS_TONE={pending:'warn',cleared:'ok',blocked:'bad'};
function mediaSection(p){
 const list=rows(p.media);
 return html`<section class="group" aria-labelledby="mediaH"><h3 id="mediaH">미디어 ${list.length}건</h3><p class="muted small">사용 가능(cleared)으로 확인한 자유 라이선스 이미지만 대표 이미지가 될 수 있어요. 저작자와 라이선스를 꼭 적어 주세요.</p>
 ${list.length?html`<ul class="media">${list.map(m=>html`<li class="media-item">${safeURL(m.url)?html`<img src="${safeURL(m.url)}" alt="" loading="lazy" referrerpolicy="no-referrer" width="96" height="72">`:html`<span class="thumb-missing">미리보기 없음</span>`}
  <div class="media-text"><p>${m.attribution||[m.author,m.license].filter(Boolean).join(' · ')||'저작자·라이선스 미확인'}</p><p class="pills">${pill(lbl('rights_status',m.rights_status||'pending'),RIGHTS_TONE[m.rights_status||'pending'])}${m.is_primary?pill('대표 이미지','accent'):''}${pill(lbl('link_state',m.link_state||'unknown'),m.link_state==='broken'?'bad':'muted')}</p>${m.page_url?html`<p class="small">${link(m.page_url,'원본 페이지')}</p>`:''}</div>
  <div class="row-actions"><button type="button" class="btn" data-act="media-edit" data-id="${m.id}">고치기</button><button type="button" class="btn ghost danger" data-act="media-remove" data-id="${m.id}">빼기</button></div></li>`)}</ul>`:html`<p class="muted">아직 미디어가 없어요.</p>`}
 <details class="addbox" id="mediaBox"><summary>미디어 추가</summary><div id="mediaFormBox">${mediaForm({})}</div></details></section>`;
}
function mediaForm(m){
 const ok=m.rights_status==='cleared'&&licenseAllowed(m.license),id=m.id?'me':'mn';
 return html`<form data-form="media-set" class="panel-form" novalidate><input type="hidden" name="id" value="${m.id||''}"><div class="fields">
  <div class="field wide"><label for="${id}-url">이미지 주소</label><input id="${id}-url" name="url" type="url" value="${m.url||''}" placeholder="https://"></div>
  <div class="field wide"><label for="${id}-page">원본 페이지</label><input id="${id}-page" name="page_url" type="url" value="${m.page_url||''}" placeholder="https://"></div>
  <div class="field"><label for="${id}-file">Commons 파일 이름</label><input id="${id}-file" name="commons_file" value="${m.commons_file||''}" placeholder="File:…"></div>
  <div class="field"><label for="${id}-lic">라이선스</label><input id="${id}-lic" name="license" value="${m.license||''}" placeholder="CC BY-SA 4.0"></div>
  <div class="field wide"><label for="${id}-licurl">라이선스 주소</label><input id="${id}-licurl" name="license_url" type="url" value="${m.license_url||''}" placeholder="https://"></div>
  <div class="field"><label for="${id}-author">저작자</label><input id="${id}-author" name="author" value="${m.author||''}"></div>
  <div class="field"><label for="${id}-rights">사용 권리</label><select id="${id}-rights" name="rights_status">${options(vocab('rights_status'),m.rights_status||'pending',null)}</select></div>
  <div class="field wide"><label for="${id}-attr">표기 문구</label><input id="${id}-attr" name="attribution" value="${m.attribution||''}" placeholder="저작자 · 라이선스 · 출처"></div>
 </div><label class="check toggle"><input type="checkbox" name="is_primary" value="1"${on(ok&&m.is_primary,'checked')}${on(!ok,'disabled')} aria-describedby="${id}-primhelp"> 대표 이미지로 쓰기</label>
 <p id="${id}-primhelp" class="muted small">사용 권리가 '사용 가능'이고 라이선스가 CC0, CC BY, CC BY-SA, 퍼블릭 도메인일 때만 고를 수 있어요.</p>
 <div class="actions"><button class="btn primary" type="submit">${m.id?'미디어 저장':'미디어 추가'}</button>${m.id?html`<button type="button" class="btn ghost" data-act="media-cancel">취소</button>`:''}</div></form>`;
}
function mediaGuard(f){const ok=f.elements.namedItem('rights_status').value==='cleared'&&licenseAllowed(f.elements.namedItem('license').value),box=f.elements.namedItem('is_primary');box.disabled=!ok;if(!ok)box.checked=false}
forms['media-set']=async(f,fd)=>{
 const g=k=>String(fd.get(k)||'').trim()||null;
 const m={url:g('url'),page_url:g('page_url'),commons_file:g('commons_file'),license:g('license'),license_url:g('license_url'),author:g('author'),attribution:g('attribution'),rights_status:g('rights_status')||'pending',is_primary:f.elements.namedItem('is_primary').checked};
 if(!safeURL(m.url))throw formErr('url','이미지 주소는 http:// 또는 https://로 시작해야 해요.');
 for(const k of ['page_url','license_url'])if(m[k]&&!safeURL(m[k]))throw formErr(k,'주소는 http:// 또는 https://로 시작해야 해요.');
 if(m.rights_status==='cleared'&&!licenseAllowed(m.license))throw formErr('license','사용 가능으로 두려면 CC0, CC BY, CC BY-SA, 퍼블릭 도메인 가운데 하나여야 해요.');
 if(m.rights_status==='cleared'&&!m.author&&!m.attribution)throw formErr('author','사용 가능한 이미지에는 저작자나 표기 문구가 있어야 해요.');
 if(m.is_primary&&m.rights_status!=='cleared')throw formErr('rights_status','대표 이미지는 사용 가능으로 확인한 이미지만 될 수 있어요.');
 const id=g('id');if(id)m.id=id;
 await rpc('archive_admin_set_media',{p_project_id:S.p.cur.id,p_media:m});
 toast(id?'미디어를 저장했어요.':'미디어를 추가했어요.');await refreshProject();
};
acts['media-edit']=el=>{const m=rows(S.p.cur?.media).find(x=>String(x.id)===el.dataset.id);if(!m)return;put($('#mediaFormBox'),mediaForm(m));const box=$('#mediaBox');box.open=true;box.querySelector('summary').textContent='미디어 고치기';$('#me-url')?.focus()};
acts['media-cancel']=()=>{put($('#mediaFormBox'),mediaForm({}));const box=$('#mediaBox');box.querySelector('summary').textContent='미디어 추가';box.open=false};
acts['media-remove']=async el=>{if(!armed(el,'한 번 더 누르면 빼요'))return;await rpc('archive_admin_remove_media',{p_media_id:el.dataset.id});toast('미디어를 뺐어요.');await refreshProject()};

function visibilityForm(p){
 const next=p.visibility==='published'?'hidden':'published';
 return html`<form data-form="visibility" class="panel-form" novalidate><fieldset class="radios"><legend>지금은 ‘${lbl('visibility',p.visibility||'draft')}’ 상태예요. 바꿀 상태를 고르세요.</legend>${['published','hidden','draft'].map(v=>html`<label class="check"><input type="radio" name="visibility" value="${v}"${on(v===next,'checked')}> ${lbl('visibility',v)}</label>`)}</fieldset>
 <label for="visNote">메모</label><textarea id="visNote" name="note" rows="2" placeholder="비공개로 바꿀 때는 사유를 꼭 적어 주세요."></textarea>
 <button class="btn primary" type="submit">공개 상태 바꾸기</button></form>`;
}
forms['visibility']=async(f,fd)=>{
 const v=String(fd.get('visibility')||''),note=String(fd.get('note')||'').trim()||null;
 if(v==='hidden'&&!note)throw formErr('note','비공개로 바꾸는 사유를 적어 주세요.');
 if(v==='published'&&!rows(S.p.cur.sources).length)throw Error('출처가 하나 이상 있어야 공개할 수 있어요.');
 await rpc('archive_admin_set_visibility',{p_project_id:S.p.cur.id,p_visibility:v,p_note:note});
 toast(v==='published'?'공개했어요.':v==='hidden'?'비공개로 바꿨어요.':'초안으로 돌렸어요.');await refreshProject();
};
const mergeSection=()=>html`<section class="group" aria-labelledby="mergeH"><h3 id="mergeH">다른 프로젝트를 이 프로젝트로 합치기</h3><p class="muted small">같은 프로젝트가 두 번 들어왔을 때 써요. 합친 쪽의 출처·크레딧·미디어·이름이 이리로 옮겨지고, 합친 쪽은 비공개가 돼요.</p>
 <form data-form="merge-search" class="panel-form" role="search" aria-label="합칠 프로젝트 검색"><label for="mergeQ">합칠 프로젝트 검색</label><div class="inline"><input id="mergeQ" name="q" type="search"><button class="btn" type="submit">검색</button></div></form><ul id="mergeResults" class="picklist"></ul></section>`;
forms['merge-search']=async(f,fd)=>{
 const box=$('#mergeResults');put(box,html`<li class="muted">찾는 중…</li>`);
 try{const list=rows(await rpc('archive_admin_list_projects',{p_q:String(fd.get('q')||'').trim()||null,p_visibility:null,p_limit:10,p_offset:0})).filter(p=>p.id!==S.p.cur.id);put(box,list.length?list.map(p=>html`<li><div><b>${pname(p)}</b> <span class="muted small">${placeLine(p)} · ${lbl('visibility',p.visibility)}</span></div><button type="button" class="btn danger" data-act="project-merge" data-id="${p.id}">이 프로젝트로 합치기</button></li>`):html`<li class="muted">합칠 프로젝트를 찾지 못했어요.</li>`)}
 catch(e){put(box,html`<li>${errBox(e,'프로젝트를 찾지 못했어요.')}</li>`)}
};
acts['project-merge']=async el=>{if(!armed(el,'한 번 더 누르면 합쳐요'))return;const keep=S.p.cur.id;await rpc('archive_admin_merge_projects',{p_keep:keep,p_drop:el.dataset.id});toast('두 프로젝트를 합쳤어요.');await loadProjects({open:keep})};

// ---- 변경 감지 ----
const fmtVal=v=>v==null||v===''?'미확인':typeof v==='object'?JSON.stringify(v):String(v);
function detailView(d){
 if(!d||typeof d!=='object')return '';
 const changes=rows(d.changes||(d.field?[d]:[])),srcs=rows(d.sources||d.hits||(d.url?[d]:[]));
 const used=['changes','sources','hits','field','old','new','before','after','url','title','publisher','canonical_url','http_status'];
 const rest=Object.entries(d).filter(([k])=>!used.includes(k));
 return html`${changes.length?html`<ul class="changes">${changes.map(c=>html`<li><b>${F[c.field]?.[0]||c.field}</b>: <span class="old">${fmtVal(c.old??c.before)}</span> → <span class="new">${fmtVal(c.new??c.after)}</span></li>`)}</ul>`:''}
 ${srcs.length?html`<ul class="hits">${srcs.map(s=>html`<li>${link(s.url||s.canonical_url,s.title||s.url)}${s.publisher?html` <span class="muted small">${s.publisher}</span>`:''}${s.http_status?html` <span class="muted small">HTTP ${s.http_status}</span>`:''}</li>`)}</ul>`:''}
 ${rest.length?html`<dl class="facts small">${rest.map(([k,v])=>html`<div><dt>${k}</dt><dd>${fmtVal(v)}</dd></div>`)}</dl>`:''}`;
}
async function loadUpdates(){
 const box=$('#updateList');put(box,html`<p class="muted">불러오는 중…</p>`);
 try{
  const list=rows(await rpc('archive_admin_list_updates',{p_status:new FormData($('#updatesFilter')).get('status')||null,p_limit:100}));
  put(box,list.length?html`<ul class="cards">${list.map(u=>{const name=u.project_name||(u.project?pname(u.project):'');return html`<li class="card update"><div class="card-head"><div><h2 class="h3">${name||'(이름 미확인)'}</h2><p class="pills">${pill(lbl('update_kind',u.kind),['link_broken','image_broken'].includes(u.kind)?'bad':'accent')}${pill(lbl('update_state',u.status),u.status==='open'?'warn':'muted')}<span class="muted small">${when(u.created_at)}</span></p></div>${u.project_id?html`<button type="button" class="btn ghost" data-act="project-goto" data-id="${u.project_id}" data-name="${name}">프로젝트 열기</button>`:''}</div>${detailView(u.detail)}${u.status==='open'?html`<div class="actions"><button type="button" class="btn primary" data-act="update-resolve" data-id="${u.id}" data-action="apply">반영</button><button type="button" class="btn ghost" data-act="update-resolve" data-id="${u.id}" data-action="dismiss">무시</button></div>`:u.resolved_at?html`<p class="muted small">${when(u.resolved_at)}에 처리했어요.</p>`:''}</li>`})}</ul>`:html`<p class="muted">처리할 변경이 없어요.</p>`);
 }catch(e){put(box,errBox(e,'변경 감지를 불러오지 못했어요.'))}
}
acts['update-resolve']=async el=>{await rpc('archive_admin_resolve_update',{p_id:el.dataset.id,p_action:el.dataset.action});toast(el.dataset.action==='apply'?'반영했어요.':'무시했어요.');await loadUpdates()};

// ---- 수집 작업 ----
function ruleHealth(list){
 if(!list.length)return html`<p class="muted">규칙이 없어요.</p>`;
 const admin=can('admin');
 return html`<div class="table-scroll" tabindex="0" role="region" aria-label="규칙 상태 표"><table><thead><tr><th scope="col">규칙</th><th scope="col">종류</th><th scope="col">사용</th><th scope="col">마지막 상태</th><th scope="col">마지막 실행</th><th scope="col">다음 실행</th><th scope="col" class="n">연속 실패</th><th scope="col">재시도 대기</th>${admin?html`<th scope="col"><span class="sr-only">작업</span></th>`:''}</tr></thead><tbody>${list.map(r=>{const wait=until(r.backoff_until);return html`<tr${on(failing(r),'class="warn-row"')}><td>${r.name}</td><td>${lbl('rule_kind',r.kind)}</td><td>${r.enabled?'켜짐':'꺼짐'}</td><td>${r.last_status?pill(lbl('run_status',r.last_status),RUN_TONE[r.last_status]):'—'}</td><td>${when(r.last_run_at)}</td><td>${when(r.next_run_at)}</td><td class="n">${num(r.failure_count||0)}</td><td>${wait?html`${wait} <span class="muted small">${when(r.backoff_until)}</span>`:'—'}</td>${admin?html`<td><button type="button" class="btn" data-act="rule-retry" data-id="${r.id}">다시 시도</button></td>`:''}</tr>`})}</tbody></table></div><div data-result aria-live="polite"></div>`;
}
const errorList=list=>list.length?html`<ul class="errors">${list.map(e=>html`<li><p><b>${ruleName(e)}</b> · ${e.stage||'—'}${e.http_status?` · HTTP ${e.http_status}`:''} · <span class="muted small">${when(e.at)}</span></p><p class="err-msg">${e.message||''}</p>${e.url?html`<p class="small">${link(e.url)}</p>`:''}</li>`)}</ul>`:html`<p class="muted">최근 오류가 없어요.</p>`;
async function loadRuns(){
 const rule=new FormData($('#runsFilter')).get('rule_id')||null;
 const [runs,errs,rules]=await Promise.allSettled([rpc('archive_admin_list_runs',{p_limit:50,p_rule_id:rule}),rpc('archive_admin_list_errors',{p_limit:50}),rpc('archive_admin_list_rules')]);
 if(rules.status==='fulfilled'){S.rules=rows(rules.value);fillRuleSelects()}
 put($('#runsTable'),runs.status==='fulfilled'?runsTable(rows(runs.value)):errBox(runs.reason,'실행 기록을 불러오지 못했어요.'));
 put($('#ruleHealth'),rules.status==='fulfilled'?ruleHealth(S.rules):errBox(rules.reason,'규칙을 불러오지 못했어요.'));
 put($('#errorList'),errs.status==='fulfilled'?errorList(rows(errs.value)):errBox(errs.reason,'오류 기록을 불러오지 못했어요.'));
}

// ---- 수집 규칙·키워드 (admin edits; editors read) ----
const KEYED={naver_news:'NAVER API 키가 Edge Function 비밀값에 있어야 동작해요.',naver_blog:'NAVER API 키가 Edge Function 비밀값에 있어야 동작해요.',brave:'Brave Search API는 키와 결제 카드가 필요하고 쓰는 만큼 비용이 나와요(1,000회에 약 5달러).'};
function ruleCards(list){
 if(!list.length)return html`<p class="muted">규칙이 없어요.</p>`;
 const admin=can('admin');
 return html`<ul class="rules">${list.map(r=>html`<li class="rule${r.enabled?'':' off'}" data-rule="${r.id}"><div class="rule-head"><div><h3>${r.name}</h3><p class="pills">${pill(lbl('rule_kind',r.kind),'accent')}${pill(r.enabled?'켜짐':'꺼짐',r.enabled?'ok':'muted')}${r.last_status?pill('마지막: '+lbl('run_status',r.last_status),RUN_TONE[r.last_status]):''}${r.failure_count>0?pill(`연속 실패 ${r.failure_count}회`,'bad'):''}</p></div>
  ${admin?html`<div class="actions"><button type="button" class="btn" data-act="rule-toggle" data-id="${r.id}">${r.enabled?'끄기':'켜기'}</button><button type="button" class="btn" data-act="rule-edit" data-id="${r.id}" aria-expanded="false">고치기</button></div>`:''}</div>
  <dl class="facts small">${r.query?html`<div class="wide"><dt>검색어</dt><dd class="mono">${r.query}</dd></div>`:''}${r.url?html`<div class="wide"><dt>주소</dt><dd>${link(r.url)}</dd></div>`:''}<div><dt>주기</dt><dd>${r.cadence_hours?`${r.cadence_hours}시간마다`:'—'}</dd></div><div><dt>언어</dt><dd>${r.language?langName(r.language):'모든 언어'}</dd></div>${r.region_hint?html`<div><dt>지역 힌트</dt><dd>${r.region_hint}</dd></div>`:''}<div><dt>이용 약관</dt><dd>${r.terms_url?link(r.terms_url,'약관 보기'):'적지 않음'}</dd></div><div><dt>검증</dt><dd>${r.verified_at?when(r.verified_at):'아직 검증 전'}</dd></div>${r.notes?html`<div class="wide"><dt>메모</dt><dd>${r.notes}</dd></div>`:''}</dl>
  ${KEYED[r.kind]?html`<p class="muted small">${KEYED[r.kind]}</p>`:''}<div class="rule-edit" hidden></div></li>`)}</ul>`;
}
function ruleForm(r){
 const isNew=!r.id,id=isNew?'rnew':'redit';
 return html`<form data-form="rule-save" class="panel-form" data-id="${r.id||''}" novalidate><div class="fields">
 ${isNew?html`<div class="field"><label for="${id}-kind">종류</label><select id="${id}-kind" name="kind">${options(vocab('rule_kind'),'gdelt',null)}</select></div><div class="field"><label for="${id}-name">이름</label><input id="${id}-name" name="name"></div><div class="field"><label for="${id}-lang">언어</label><select id="${id}-lang" name="language">${options(langOptions(),'','모든 언어')}</select></div><div class="field"><label for="${id}-region">지역 힌트</label><input id="${id}-region" name="region_hint" placeholder="예: KR, europe"></div>`:''}
 <div class="field wide"><label for="${id}-q">검색어 (GDELT·NAVER·Brave)</label><textarea id="${id}-q" name="query" rows="2">${r.query||''}</textarea></div>
 <div class="field wide"><label for="${id}-url">피드 주소 (RSS·WebSub)</label><input id="${id}-url" name="url" type="url" value="${r.url||''}" placeholder="https://"></div>
 <div class="field"><label for="${id}-cad">주기 (시간)</label><input id="${id}-cad" name="cadence_hours" type="number" min="1" max="168" step="1" value="${r.cadence_hours??6}"></div>
 <div class="field wide"><label for="${id}-terms">이용 약관 주소</label><input id="${id}-terms" name="terms_url" type="url" value="${r.terms_url||''}" placeholder="https://"></div>
 <div class="field wide"><label for="${id}-notes">메모</label><textarea id="${id}-notes" name="notes" rows="2">${r.notes||''}</textarea></div>
 </div><label class="check toggle"><input type="checkbox" name="enabled" value="1"${on(!isNew&&r.enabled,'checked')}> 켜기</label>
 <div class="actions"><button class="btn primary" type="submit">${isNew?'규칙 추가':'규칙 저장'}</button></div></form>`;
}
forms['rule-save']=async(f,fd)=>{
 const g=k=>String(fd.get(k)??'').trim()||null,id=f.dataset.id||null;
 const rule={enabled:f.elements.namedItem('enabled').checked,cadence_hours:Number(fd.get('cadence_hours')),query:g('query'),url:g('url'),terms_url:g('terms_url'),notes:g('notes')};
 if(!Number.isInteger(rule.cadence_hours)||rule.cadence_hours<1||rule.cadence_hours>168)throw formErr('cadence_hours','주기는 1~168시간 사이의 정수로 적어 주세요.');
 for(const k of ['url','terms_url'])if(rule[k]&&!safeURL(rule[k]))throw formErr(k,'주소는 http:// 또는 https://로 시작해야 해요.');
 const kind=id?S.rules.find(r=>r.id===id)?.kind:g('kind');
 if(['rss','websub'].includes(kind)&&!rule.url)throw formErr('url','RSS·WebSub 규칙에는 피드 주소가 있어야 해요.');
 if(['gdelt','naver_news','naver_blog','brave'].includes(kind)&&!rule.query)throw formErr('query','검색어를 적어 주세요.');
 if(id)rule.id=id;
 else{rule.kind=kind;rule.name=g('name');rule.language=g('language');rule.region_hint=g('region_hint');if(!rule.name)throw formErr('name','규칙 이름을 적어 주세요.')}
 await rpc('archive_admin_upsert_rule',{p_rule:rule});
 toast(id?'규칙을 저장했어요.':'규칙을 추가했어요.');await loadRules();
};
acts['rule-edit']=el=>{
 const li=el.closest('[data-rule]'),box=$('.rule-edit',li),r=S.rules.find(x=>x.id===el.dataset.id);
 for(const other of $$('.rule-edit:not([hidden])'))if(other!==box){other.hidden=true;put(other,'');other.closest('[data-rule]').querySelector('[data-act="rule-edit"]').setAttribute('aria-expanded','false')}
 const show_=box.hidden;box.hidden=!show_;put(box,show_?ruleForm(r):'');el.setAttribute('aria-expanded',String(show_));
 if(show_)$('textarea,input',box)?.focus();
};
acts['rule-toggle']=async el=>{
 const r=S.rules.find(x=>x.id===el.dataset.id);if(!r)return;
 if(r.kind==='brave'&&!r.enabled&&!armed(el,'비용이 나올 수 있어요. 한 번 더 누르면 켜요'))return;
 await rpc('archive_admin_upsert_rule',{p_rule:{id:r.id,enabled:!r.enabled}});
 toast(r.enabled?'규칙을 껐어요.':'규칙을 켰어요.');await loadRules();
};
function renderKeywords(){
 const fd=new FormData($('#kwFilter')),pol=fd.get('polarity')||'',q=String(fd.get('q')||'').trim().toLowerCase(),admin=can('admin');
 const list=S.kw.items.filter(k=>(!pol||k.polarity===pol)&&(!q||String(k.term).toLowerCase().includes(q)));
 put($('#kwTable'),list.length?html`<p class="muted small">${list.length}개${list.length!==S.kw.items.length?` (전체 ${S.kw.items.length}개)`:''}</p><div class="table-scroll" tabindex="0" role="region" aria-label="키워드 표"><table><thead><tr><th scope="col">낱말</th><th scope="col">언어</th><th scope="col">성격</th><th scope="col" class="n">가중치</th><th scope="col">사용</th>${admin?html`<th scope="col"><span class="sr-only">작업</span></th>`:''}</tr></thead><tbody>${list.map(k=>{const i=S.kw.items.indexOf(k);return html`<tr><td>${k.term}</td><td>${k.language?langName(k.language):'모든 언어'}</td><td>${pill(lbl('polarity',k.polarity),POL_TONE[k.polarity])}</td><td class="n">${num(k.weight)}</td><td>${k.enabled===false?'꺼짐':'켜짐'}</td>${admin?html`<td class="row-actions"><button type="button" class="btn" data-act="kw-edit" data-i="${i}">고치기</button><button type="button" class="btn ghost danger" data-act="kw-delete" data-i="${i}">지우기</button></td>`:''}</tr>`})}</tbody></table></div>`:html`<p class="muted">키워드가 없어요.</p>`);
}
function kwForm(k){
 const edit=k.term!=null,lock=edit&&!k.id;
 return html`<form data-form="kw-save" class="panel-form kwform" novalidate><h3>${edit?'키워드 고치기':'키워드 추가'}</h3><input type="hidden" name="id" value="${k.id||''}"><div class="fields">
 <div class="field"><label for="kwTerm">낱말</label><input id="kwTerm" name="term" value="${k.term||''}"${on(lock,'readonly')}></div>
 <div class="field"><label for="kwLang">언어</label><select id="kwLang" name="language"${on(lock,'disabled')}>${options(langOptions(),k.language||'','모든 언어')}</select>${lock?html`<input type="hidden" name="language" value="${k.language||''}">`:''}</div>
 <div class="field"><label for="kwPol">성격</label><select id="kwPol" name="polarity">${options(vocab('polarity'),k.polarity||'positive',null)}</select></div>
 <div class="field"><label for="kwWeight">가중치 (0~100)</label><input id="kwWeight" name="weight" type="number" min="0" max="100" step="1" value="${k.weight??10}"></div></div>
 <label class="check toggle"><input type="checkbox" name="enabled" value="1"${on(k.enabled!==false,'checked')}> 사용</label>
 <div class="actions"><button class="btn primary" type="submit">${edit?'키워드 저장':'키워드 추가'}</button>${edit?html`<button type="button" class="btn ghost" data-act="kw-cancel">취소</button>`:''}</div></form>`;
}
async function loadRules(){
 $('#rulesReadOnly').hidden=can('admin');
 const [rules,kws]=await Promise.allSettled([rpc('archive_admin_list_rules'),rpc('archive_admin_list_keywords')]);
 if(rules.status==='fulfilled'){S.rules=rows(rules.value);put($('#ruleList'),ruleCards(S.rules))}else put($('#ruleList'),errBox(rules.reason,'규칙을 불러오지 못했어요.'));
 if(kws.status==='fulfilled'){S.kw.items=rows(kws.value);renderKeywords()}else put($('#kwTable'),errBox(kws.reason,'키워드를 불러오지 못했어요.'));
 if(can('admin')){put($('#ruleNew'),ruleForm({}));if(!$('#kwEdit').childElementCount)put($('#kwEdit'),kwForm({}))}
}
forms['kw-filter']=()=>renderKeywords();
forms['kw-save']=async(f,fd)=>{
 const term=String(fd.get('term')||'').trim(),weight=Number(fd.get('weight'));
 if(!term)throw formErr('term','낱말을 적어 주세요.');
 if(!Number.isFinite(weight)||weight<0||weight>100)throw formErr('weight','가중치는 0~100 사이로 적어 주세요.');
 const kw={term,language:String(fd.get('language')||'')||null,polarity:String(fd.get('polarity')),weight,enabled:f.elements.namedItem('enabled').checked};
 if(fd.get('id'))kw.id=String(fd.get('id'));
 await rpc('archive_admin_upsert_keyword',{p_kw:kw});
 toast('키워드를 저장했어요.');put($('#kwEdit'),kwForm({}));await loadRules();
};
acts['kw-edit']=el=>{put($('#kwEdit'),kwForm(S.kw.items[Number(el.dataset.i)]));$('#kwEdit').scrollIntoView({block:'nearest'});$('#kwWeight').focus()};
acts['kw-cancel']=()=>put($('#kwEdit'),kwForm({}));
acts['kw-delete']=async el=>{const k=S.kw.items[Number(el.dataset.i)];if(!k||!armed(el,'한 번 더 누르면 지워요'))return;await rpc('archive_admin_delete_keyword',{p_term:k.term,p_language:k.language??null});toast('키워드를 지웠어요.');await loadRules()};

// ---- 설정 (admin) ----
async function loadSettings(){
 const box=$('#settingsBox');put(box,html`<p class="muted">불러오는 중…</p>`);
 let s=null,err=null;try{s=(await rpc('archive_admin_dashboard'))?.settings||null}catch(e){err=e}
 const v=s||{auto_list_structured:true,auto_ignore_below:35,review_threshold:60};
 put(box,html`${err?errBox(err,'지금 설정을 불러오지 못했어요.'):''}${!s?html`<p class="notice warn">서버에서 지금 설정을 받지 못해 기본값을 보여 줘요. 저장하면 아래 값으로 바뀌어요.</p>`:''}
 <form data-form="settings" class="stack" novalidate>
  <label class="check toggle"><input type="checkbox" name="auto_list_structured" value="1"${on(v.auto_list_structured!==false,'checked')} aria-describedby="setAutoHelp"> Wikidata 구조화 항목 자동 목록</label>
  <p id="setAutoHelp" class="muted small">미디어파사드·라이트아트 분류와 좌표가 있는 Wikidata 항목(CC0)을 '자동 수집 · 미검수'로 앱에 보여 줘요. 끄면 편집자가 승인한 항목만 보여요.</p>
  <label for="setReview">검수 기준 점수</label><input id="setReview" name="review_threshold" type="number" min="1" max="100" step="1" value="${v.review_threshold??60}" aria-describedby="setReviewHelp"><p id="setReviewHelp" class="muted small">분류 점수가 이 값 이상이면 '검수 대기'가 돼요.</p>
  <label for="setIgnore">자동 제외 기준 점수</label><input id="setIgnore" name="auto_ignore_below" type="number" min="0" max="99" step="1" value="${v.auto_ignore_below??35}" aria-describedby="setIgnoreHelp"><p id="setIgnoreHelp" class="muted small">이 값보다 낮으면 대기열에 넣지 않고 30일 동안 보관했다가 지워요. 두 기준 사이는 '판단 보류'예요.</p>
  <button class="btn primary" type="submit">설정 저장</button></form>`);
}
forms['settings']=async(f,fd)=>{
 const review_threshold=Number(fd.get('review_threshold')),auto_ignore_below=Number(fd.get('auto_ignore_below'));
 if(!Number.isInteger(review_threshold)||review_threshold<1||review_threshold>100)throw formErr('review_threshold','검수 기준은 1~100 사이의 정수예요.');
 if(!Number.isInteger(auto_ignore_below)||auto_ignore_below<0||auto_ignore_below>=review_threshold)throw formErr('auto_ignore_below','자동 제외 기준은 0 이상이고 검수 기준보다 낮아야 해요.');
 await rpc('archive_admin_set_settings',{p_settings:{auto_list_structured:f.elements.namedItem('auto_list_structured').checked,auto_ignore_below,review_threshold}});
 toast('설정을 저장했어요.');
};

// ---- 연구자 평가 ----
const RESEARCH_ATTRS=[['significance','학술적 의의'],['design_quality','설계 완성도'],['urban_impact','도시적 영향'],['authorship','저작·크레딧 해석'],['other','기타']];
async function loadResearch(){
 const q=String(new FormData($('#researchFilter')).get('q')||'').trim()||null;
 $('#researchCount').textContent='불러오는 중…';
 try{S.r.items=rows(await rpc('archive_search',{p_q:q,p_filters:{},p_sort:q?'relevance':'updated',p_limit:PAGE,p_offset:0}))}
 catch(e){S.r.items=[];put($('#researchList'),html`<li>${errBox(e,'프로젝트를 불러오지 못했어요.')}</li>`);$('#researchCount').textContent='';return}
 $('#researchCount').textContent=`공개 프로젝트 ${S.r.items.length}건`;
 renderResearchList();
}
const renderResearchList=()=>put($('#researchList'),S.r.items.length?S.r.items.map(p=>html`<li><button type="button" class="pitem" data-act="research-open" data-id="${p.id}"${on(S.r.cur?.id===p.id,'aria-current="true"')}><span class="pi-title">${pname(p)}</span><span class="muted small">${placeLine(p)}</span><span class="pills">${pill(lbl('review_status',p.review_status))}${rows(p.assessments).length?pill(`평가 ${rows(p.assessments).length}건`,'accent'):''}</span></button></li>`):html`<li class="empty">찾는 프로젝트가 없어요.</li>`);
function assessValue(attr){
 if(F[attr]){const [label,kind]=F[attr];return kind.startsWith('multi')?html`<fieldset class="field-in"><legend>평가 값: ${label}</legend>${control(attr,null,'as-'+attr)}</fieldset>`:html`<label for="as-${attr}">평가 값: ${label}</label>${control(attr,null,'as-'+attr)}`}
 return html`<label for="asText">평가 값</label><textarea id="asText" name="value_text" rows="3"></textarea>`;
}
function researchDetail(p){
 const fs=p.field_status||{},assess=rows(p.assessments);
 return html`<div class="editor-head"><button type="button" class="btn ghost back" data-act="research-close">← 목록</button><h2 id="researchTitle" tabindex="-1">${pname(p)}</h2><p class="pills">${pill(lbl('review_status',p.review_status))}${pill(lbl('record_origin',p.record_origin))}</p></div>
 ${GROUPS.map(([,title,keys])=>{const known=keys.filter(k=>!blank(p[k])),unknown=keys.filter(k=>blank(p[k]));return html`<section class="group"><h3>${title}</h3>${known.length?html`<dl class="facts readonly">${known.map(k=>html`<div><dt>${F[k][0]}</dt><dd>${fmtField(k,p[k])} ${stateBadge(k,p[k],fs[k])}</dd></div>`)}</dl>`:''}${unknown.length?html`<p class="muted small">미확인: ${unknown.map(k=>F[k][0]).join(', ')}</p>`:''}</section>`})}
 <section class="group"><h3>크레딧</h3>${rows(p.credits).length?html`<ul class="plain">${rows(p.credits).map(c=>html`<li>${lbl('credit_role',c.role)}: ${c.name}${c.name_en?` (${c.name_en})`:''}</li>`)}</ul>`:html`<p class="muted">미확인</p>`}</section>
 <section class="group"><h3>출처</h3>${sourceList(p.sources,false)}</section>
 <section class="group"><h3>지금까지의 평가 ${assess.length}건</h3>${assess.length?html`<ul class="plain assessments">${assess.map(a=>html`<li><b>${F[a.attribute]?.[0]||RESEARCH_ATTRS.find(x=>x[0]===a.attribute)?.[1]||a.attribute}</b>: ${F[a.attribute]?fmtField(a.attribute,a.value):fmtVal(a.value)} <span class="muted small">확신 ${lbl('confidence',a.confidence)} · ${a.method||'방법 미기재'} · ${day(a.created_at)}</span>${a.note?html`<p class="small">${a.note}</p>`:''}</li>`)}</ul>`:html`<p class="muted">아직 평가가 없어요.</p>`}</section>
 <section class="group" aria-labelledby="asH"><h3 id="asH">평가 추가</h3><form data-form="assess" class="panel-form" novalidate><div class="fields">
  <div class="field"><label for="asAttr">항목</label><select id="asAttr" name="attribute"><optgroup label="아카이브 항목">${FIELDS.map(k=>html`<option value="${k}"${on(k==='project_type','selected')}>${F[k][0]}</option>`)}</optgroup><optgroup label="연구 평가">${RESEARCH_ATTRS.map(([k,l])=>html`<option value="${k}">${l}</option>`)}</optgroup></select></div>
  <div class="field wide" id="asValueBox">${assessValue('project_type')}</div>
  <div class="field"><label for="asConf">확신 정도</label><select id="asConf" name="confidence">${options(vocab('confidence'),'medium',null)}</select></div>
  <div class="field"><label for="asMethod">방법</label><input id="asMethod" name="method" placeholder="예: 현장 조사, 문헌 검토"></div>
  <div class="field wide"><label for="asNote">메모</label><textarea id="asNote" name="note" rows="3" placeholder="근거 문헌이나 관찰 내용을 적어 주세요."></textarea></div>
 </div><button class="btn primary" type="submit">평가 저장</button></form></section>`;
}
acts['research-open']=el=>{const p=S.r.items.find(x=>x.id===el.dataset.id);if(!p)return;S.r.cur=p;renderResearchList();put($('#researchDetail'),researchDetail(p));$('#researchSplit').classList.add('has-detail');$('#researchTitle').focus()};
acts['research-close']=()=>{S.r.cur=null;$('#researchSplit').classList.remove('has-detail');put($('#researchDetail'),html`<p class="muted placeholder">프로젝트를 고르면 내용과 평가 양식이 나와요.</p>`);renderResearchList();$('#researchList .pitem')?.focus()};
forms['research-filter']=()=>loadResearch();
forms['assess']=async(f,fd)=>{
 const attr=String(fd.get('attribute')),value=F[attr]?readField(f,attr):String(fd.get('value_text')||'').trim()||null;
 if(value==null)throw formErr(F[attr]?attr:'value_text','평가 값을 적어 주세요.');
 const method=String(fd.get('method')||'').trim()||null;
 if(!method)throw formErr('method','어떤 방법으로 판단했는지 적어 주세요.');
 const a={attribute:attr,value,confidence:String(fd.get('confidence')),method,note:String(fd.get('note')||'').trim()||null};
 await rpc('archive_research_add_assessment',{p_project_id:S.r.cur.id,p_attribute:a.attribute,p_value:a.value,p_confidence:a.confidence,p_method:a.method,p_note:a.note});
 toast('평가를 저장했어요. 수집한 데이터와 따로 보관돼요.');
 S.r.cur.assessments=[...rows(S.r.cur.assessments),{...a,created_at:new Date().toISOString()}];
 put($('#researchDetail'),researchDetail(S.r.cur));renderResearchList();
};

// ---- 매거진 (archive_articles) ----
forms['article']=async(f,fd)=>{
 const msg=$('#articleMsg');msg.textContent='';
 const title=String(fd.get('title')||'').trim(),body=String(fd.get('body')||''),status=String(fd.get('status')),url=String(fd.get('source_url')||'').trim();
 if(!title)throw formErr('title','제목을 적어 주세요.');
 if(!body.trim())throw formErr('body','본문을 적어 주세요.');
 if(url&&!safeURL(url))throw formErr('source_url','출처 URL을 확인하세요.');
 const {error}=await sb.from('archive_articles').insert({title,author:String(fd.get('author')||'').trim()||null,summary:String(fd.get('summary')||''),body,source_url:url||null,status,published_at:status==='published'?new Date().toISOString():null});
 if(error)throw error;
 msg.textContent='등록했어요.';f.reset();
};

// ---- 장소 후보 (v0.10 external_candidates RPCs, unchanged on the server) ----
async function loadLegacy(){
 const fd=new FormData($('#legacyFilter'));
 const [stats,list,jobs]=await Promise.allSettled([rpc('admin_candidate_stats'),rpc('admin_list_candidates',{p_city_code:fd.get('city')||null,p_status:fd.get('status')||null,p_min_score:Number(fd.get('score')||0),p_search:String(fd.get('q')||'').trim()||null,p_limit:200,p_offset:0}),rpc('admin_list_ingestion_jobs',{p_limit:20})]);
 put($('#legacyStats'),stats.status==='fulfilled'?[['total','전체'],['ready','Ready'],['draft','Draft'],['published','Published'],['rejected','Rejected'],['high_relevance','70점 이상'],['duplicates','중복 묶음']].map(([k,l])=>tile([k,l],stats.value?.[k]??0)):errBox(stats.reason,'통계를 불러오지 못했어요.'));
 if(list.status==='fulfilled'){S.lg.items=rows(list.value);if(S.lg.cur)S.lg.cur=S.lg.items.find(c=>c.id===S.lg.cur.id)||null;renderLegacyList();renderLegacyDetail()}else put($('#legacyRows'),html`<li>${errBox(list.reason,'후보를 불러오지 못했어요.')}</li>`);
 put($('#legacyJobs'),jobs.status==='fulfilled'?(rows(jobs.value).length?html`<div class="table-scroll" tabindex="0" role="region" aria-label="수집 작업 표"><table><thead><tr><th scope="col">작업</th><th scope="col">상태</th><th scope="col" class="n">가져옴</th><th scope="col" class="n">추가</th><th scope="col" class="n">표시</th><th scope="col">만든 때</th></tr></thead><tbody>${rows(jobs.value).map(j=>html`<tr><td>${j.job_name}</td><td>${j.status}</td><td class="n">${num(j.fetched_count)}</td><td class="n">${num(j.inserted_count)}</td><td class="n">${num(j.flagged_count)}</td><td>${when(j.created_at)}</td></tr>`)}</tbody></table></div>`:html`<p class="muted">작업 기록이 없어요.</p>`):errBox(jobs.reason,'작업 기록을 불러오지 못했어요.'));
}
const renderLegacyList=()=>put($('#legacyRows'),S.lg.items.length?S.lg.items.map(c=>html`<li><button type="button" class="pitem" data-act="legacy-open" data-id="${c.id}"${on(S.lg.cur?.id===c.id,'aria-current="true"')}><span class="pi-title">${c.name}</span><span class="muted small">${[c.name_local,c.city_code,c.candidate_type,c.primary_provider].filter(Boolean).join(' · ')}</span><span class="pills">${pill(String(c.publishing_status||''),c.publishing_status==='ready'?'ok':c.publishing_status==='rejected'?'bad':'muted')}${pill('관련도 '+num(Math.round(c.relevance_score||0)))}</span></button></li>`):html`<li class="empty">조건에 맞는 후보가 없어요.</li>`);
function renderLegacyDetail(){
 const c=S.lg.cur,box=$('#legacyDetail');
 $('#legacySplit').classList.toggle('has-detail',!!c);
 if(!c){put(box,html`<p class="muted placeholder">후보를 고르세요.</p>`);return}
 const kv=[['도시',c.city_code],['제공처',`${c.primary_provider||''} / ${c.external_primary_id||''}`],['유형',c.candidate_type],['관련도',num(Math.round(c.relevance_score||0))],['신뢰도',num(Math.round(c.confidence_score||0))],['좌표',`${c.lat??'—'}, ${c.lng??'—'}`],['주소',c.address_text||'—'],['중복 묶음',c.duplicate_cluster_id||'—']];
 put(box,html`<div class="editor-head"><button type="button" class="btn ghost back" data-act="legacy-close">← 목록</button><h2 id="legacyTitle" tabindex="-1">${c.name}</h2></div>
 <dl class="facts">${kv.map(([k,v])=>html`<div><dt>${k}</dt><dd>${v||'—'}</dd></div>`)}</dl>
 <div class="actions"><button type="button" class="btn" data-act="legacy-action" data-action="ready">Ready</button><button type="button" class="btn" data-act="legacy-action" data-action="reviewed">Reviewed</button><button type="button" class="btn" data-act="legacy-action" data-action="hide">숨기기</button><button type="button" class="btn danger" data-act="legacy-panel" data-panel="reject" aria-expanded="${S.lg.panel==='reject'}">반려</button><button type="button" class="btn primary" data-act="legacy-panel" data-panel="promote" aria-expanded="${S.lg.panel==='promote'}">정식 장소로 만들기</button></div>
 ${S.lg.panel==='reject'?html`<form data-form="legacy-reject" class="panel-form" novalidate><label for="lgReason">반려 사유</label><textarea id="lgReason" name="reason" rows="2"></textarea><button class="btn danger" type="submit">반려하기</button></form>`:''}
 ${S.lg.panel==='promote'?html`<form data-form="legacy-promote" class="panel-form" novalidate><label for="lgCode">새 place_code</label><input id="lgCode" name="code" value="${`AUTO-${c.city_code||'GLB'}-${String(c.id).replaceAll('-','').slice(0,8).toUpperCase()}`}"><button class="btn primary" type="submit">만들기</button></form>`:''}
 ${c.website_url?html`<p>${link(c.website_url,'공식·제공처 페이지 열기')}</p>`:''}
 <h3>원본 메타데이터</h3><pre class="raw">${JSON.stringify(c.source_metadata||{},null,2)}</pre>`);
}
acts['legacy-open']=el=>{S.lg.cur=S.lg.items.find(c=>c.id===el.dataset.id)||null;S.lg.panel=null;renderLegacyList();renderLegacyDetail();$('#legacyTitle')?.focus()};
acts['legacy-close']=()=>{S.lg.cur=null;renderLegacyList();renderLegacyDetail()};
acts['legacy-panel']=el=>{S.lg.panel=S.lg.panel===el.dataset.panel?null:el.dataset.panel;renderLegacyDetail();$('#legacyDetail form input,#legacyDetail form textarea')?.focus()};
acts['legacy-action']=async el=>{await rpc('admin_update_candidate',{p_candidate_id:S.lg.cur.id,p_action:el.dataset.action,p_reason:null});toast('처리했어요.');await loadLegacy()};
forms['legacy-reject']=async(f,fd)=>{const reason=String(fd.get('reason')||'').trim();if(!reason)throw formErr('reason','반려 사유를 적어 주세요.');await rpc('admin_update_candidate',{p_candidate_id:S.lg.cur.id,p_action:'reject',p_reason:reason});S.lg.panel=null;toast('반려했어요.');await loadLegacy()};
forms['legacy-promote']=async(f,fd)=>{const id=await rpc('admin_promote_candidate',{p_candidate_id:S.lg.cur.id,p_place_code:String(fd.get('code')||'').trim()||null});S.lg.panel=null;toast(`정식 장소를 만들었어요: ${id}`);await loadLegacy()};
forms['legacy-filter']=()=>loadLegacy();
acts['legacy-discover']=async el=>{
 const city=el.dataset.city,msg=$('#discoverMsg');msg.textContent=`${el.textContent} 발견을 실행하고 있어요…`;el.disabled=true;
 try{const data=await callFunction('admin-discovery-command',{city_code:city,candidate_limit_per_city:city==='SEOUL'?100:120});msg.textContent=`${el.textContent} 완료 · 가져옴 ${data?.result?.fetched??'?'}`;await loadLegacy()}
 catch(e){msg.textContent=`실패: ${errText(e)}`}
 finally{el.disabled=false}
};

const LOAD={dashboard:loadDashboard,queue:()=>loadQueue({keep:{id:curCand()?.id}}),projects:()=>{const id=S.p.pendingOpen||S.p.cur?.id;S.p.pendingOpen=null;return loadProjects({open:id})},updates:loadUpdates,runs:loadRuns,rules:loadRules,settings:loadSettings,research:loadResearch,magazine:()=>{},places:loadLegacy};
acts['reload']=()=>LOAD[S.tab]?.();
forms['queue-filter']=()=>loadQueue();
forms['project-filter']=()=>loadProjects({open:S.p.cur?.id});
forms['updates-filter']=()=>loadUpdates();
forms['runs-filter']=()=>loadRuns();

// ---- Events ----
document.addEventListener('click',e=>{
 const el=e.target.closest('[data-act]');if(!el||el.disabled)return;
 const h=acts[el.dataset.act];if(!h)return;
 e.preventDefault();
 Promise.resolve().then(()=>h(el,e)).catch(err=>toast(errText(err),true));
});
document.addEventListener('submit',async e=>{
 const f=e.target,h=forms[f.dataset.form];if(!h)return;
 e.preventDefault();
 const btns=$$('button[type=submit]',f);for(const b of btns)b.disabled=true;
 try{await h(f,new FormData(f))}
 catch(err){
  if(err.field){const el=f.elements.namedItem(err.field),t=el?.focus?el:el?.[0];t?.setAttribute?.('aria-invalid','true');t?.focus?.()}
  toast(errText(err),true);
 }
 finally{for(const b of btns)b.disabled=false}
});
function onEdit(e){
 const t=e.target,f=t.form;
 if(t.getAttribute?.('aria-invalid'))t.removeAttribute('aria-invalid');
 if(!f)return;
 if(f.id==='projectForm'&&S.p.cur){if(F[t.name])refreshField(f,t.name);countDirty(f)}
 else if(f.dataset.form==='media-set'&&['rights_status','license'].includes(t.name))mediaGuard(f);
 else if(f.dataset.form==='assess'&&t.name==='attribute'&&e.type==='change')put($('#asValueBox'),assessValue(t.value));
 else if(f.dataset.form==='rv-reject'&&t.name==='note')$('#rvNoteErr').hidden=true;
}
document.addEventListener('input',onEdit);document.addEventListener('change',onEdit);
// Queue keyboard: j/k move, Esc closes the detail, / jumps to search. Never while typing in a field.
document.addEventListener('keydown',e=>{
 if(S.tab!=='queue'||e.metaKey||e.ctrlKey||e.altKey)return;
 const typing=e.target.closest?.('input,textarea,select,[contenteditable="true"]');
 if(e.key==='Escape'){if(typing){e.target.blur();return}if(S.q.sel>=0){e.preventDefault();closeDrawer()}return}
 if(typing)return;
 if(e.key==='j'||e.key==='k'){
  e.preventDefault();const n=S.q.items.length;if(!n)return;
  select(S.q.sel<0?(e.key==='j'?0:n-1):Math.max(0,Math.min(n-1,S.q.sel+(e.key==='j'?1:-1))));
 }else if(e.key==='/'){e.preventDefault();$('#queueSearch').focus()}
});
$('#loginForm').addEventListener('submit',e=>{e.preventDefault();login()});
$('#logoutBtn').addEventListener('click',async()=>{await sb?.auth.signOut().catch(()=>{});showLogin();loginMsg('')});
boot().catch(e=>{loginMsg('연결하지 못했어요: '+errText(e));$('#loginBtn').disabled=true});
