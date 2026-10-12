
const AOL_CONFIG=window.AOL_CONFIG||{};
const D=window.AOL_SEED;
const places=D.places,curations=D.curations,curationPlaces=D.curation_places,works=D.works,schedules=D.schedules,sources=D.sources;
const state={page:'home',place:null,livePlace:null,curation:null,category:'전체',freeOnly:false,liveResults:[],selectedLive:null,map:null,markers:[]};
const AOL_REVIEW_MODE=false;
const AOL_PUBLIC_MODE=false;

const store={saved:new Set(JSON.parse(localStorage.getItem('aol3_saved')||'[]')),visited:JSON.parse(localStorage.getItem('aol3_visited')||'{}'),sync(){localStorage.setItem('aol3_saved',JSON.stringify([...this.saved]));localStorage.setItem('aol3_visited',JSON.stringify(this.visited))}};
const $=s=>document.querySelector(s); const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const strip=s=>{const d=document.createElement('div');d.innerHTML=s||'';return d.textContent||''}; const placeBy=id=>places.find(p=>p.place_id===id);


const IMG_CACHE_KEY='aol7_img_cache', IMG_TTL=3*24*60*60*1000;
const EXCLUDE_KEY='aol7_excluded_files';
let imgCache=JSON.parse(localStorage.getItem(IMG_CACHE_KEY)||'{}');
let excludedFiles=JSON.parse(localStorage.getItem(EXCLUDE_KEY)||'{}');
function saveImgCache(){try{localStorage.setItem(IMG_CACHE_KEY,JSON.stringify(imgCache))}catch{}}
function saveExcluded(){try{localStorage.setItem(EXCLUDE_KEY,JSON.stringify(excludedFiles))}catch{}}
function normName(s){return String(s||'').toLowerCase().replace(/[()[\]{}\/·,:;'"“”‘’\-–—]/g,' ').replace(/\s+/g,' ').trim()}
function tokens(s){return normName(s).split(' ').filter(x=>x.length>=2&&!['서울','seoul','the','museum','미술관','센터','center','art','아트','문화','gallery','갤러리','light','architecture'].includes(x))}
function nameScore(a,b){
 a=normName(a);b=normName(b); if(!a||!b)return 0;
 if(a===b)return 100;
 if(a.includes(b)||b.includes(a))return 86;
 const A=new Set(tokens(a)),B=new Set(tokens(b));let hit=0;A.forEach(x=>{if(B.has(x))hit++});
 return hit?Math.min(78,28+hit*17):0
}
function subjectKey(s){return s.place_id?`seed:${s.place_id}`:`live:${s.id}`}
function subjectNames(s){return s.place_id?[s.name_kr,s.name_en].filter(Boolean):[s.label,s.label_en,s.description].filter(Boolean)}
function isExcluded(subject,file){const key=subjectKey(subject);return (excludedFiles[key]||[]).includes(file)}
function excludeCandidate(subject,file){
 const key=subjectKey(subject); excludedFiles[key]=Array.from(new Set([...(excludedFiles[key]||[]),file])); saveExcluded();
 delete imgCache[key]; render();
}
function clearExclusions(subject){
 const key=subjectKey(subject); delete excludedFiles[key]; saveExcluded(); delete imgCache[key]; render();
}
function licenseDecision(meta){
 const lic=strip(meta?.LicenseShortName?.value||meta?.UsageTerms?.value||'').trim();
 const low=lic.toLowerCase();
 const allowed=(low.includes('cc by')||low.includes('cc0')||low.includes('public domain')||low==='pd'||low.includes('public-domain'))
   && !low.includes('nc') && !low.includes('nd');
 return {allowed,lic};
}
function candidateRelevance(title,desc,subject){
 let score=0; subjectNames(subject).forEach(n=>{score=Math.max(score,nameScore(title,n),nameScore(desc,n))}); return score;
}
async function infoFromPage(page){
 const ii=page?.imageinfo?.[0]; if(!ii)return null;
 const m=ii.extmetadata||{}, dec=licenseDecision(m), file=String(page.title||'').replace(/^File:/,'');
 const artist=strip(m.Artist?.value||m.Credit?.value||m.Attribution?.value||'Wikimedia Commons contributor');
 const desc=strip(m.ImageDescription?.value||'');
 const licenseUrl=m.LicenseUrl?.value||'';
 return {
   url:ii.thumburl||ii.url,file,artist,description:desc,license:dec.lic||'Unknown',licenseUrl,
   source:'https://commons.wikimedia.org/wiki/File:'+encodeURIComponent(file),
   allowed:dec.allowed, rightsStatus:dec.allowed?'cleared':'pending'
 };
}
async function commonsFileInfo(file){ 
 const u='https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1200&iiextmetadatafilter=Artist|Credit|Attribution|LicenseShortName|UsageTerms|LicenseUrl|ImageDescription&titles='+encodeURIComponent('File:'+file);
 const j=await fetch(u).then(r=>r.json()); const page=Object.values(j.query?.pages||{})[0]; return infoFromPage(page);
}
async function commonsCategoryCandidates(category,subject){
 if(!category)return [];
 try{
  const u='https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=categorymembers&gcmtitle='+encodeURIComponent('Category:'+category)+'&gcmnamespace=6&gcmlimit=18&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1200&iiextmetadatafilter=Artist|Credit|Attribution|LicenseShortName|UsageTerms|LicenseUrl|ImageDescription';
  const j=await fetch(u).then(r=>r.json()); const pages=Object.values(j.query?.pages||{});
  const out=[]; for(const pg of pages){ const inf=await infoFromPage(pg); if(inf&&(inf.allowed||AOL_REVIEW_MODE)&&!isExcluded(subject,inf.file)){ const relevance=candidateRelevance(pg.title,inf.description,subject); out.push({...inf,relevance,score:Math.min(99,72+Math.round(relevance*.22)),via:'Commons category'}); } }
  return out;
 }catch{return []}
}
async function commonsSearchCandidates(subject){
 const queries=subjectNames(subject).slice(0,2);
 const all=[];
 for(const q of queries){
  try{
   const u='https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch='+encodeURIComponent(q)+'&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1200&iiextmetadatafilter=Artist|Credit|Attribution|LicenseShortName|UsageTerms|LicenseUrl|ImageDescription';
   const j=await fetch(u).then(r=>r.json()); const pages=Object.values(j.query?.pages||{});
   for(const pg of pages){
    const inf=await infoFromPage(pg);
    if(inf&&(inf.allowed||AOL_REVIEW_MODE)&&!isExcluded(subject,inf.file)){
      const relevance=candidateRelevance(pg.title,inf.description,subject);
      if(relevance>=24) all.push({...inf,relevance,score:Math.min(96,48+Math.round(relevance*.45)),via:'Commons search'});
    }
   }
  }catch{}
 }
 return all;
}
async function findWikidataEntityForSeed(place){
 const queries=[place.name_kr,place.name_en].filter(Boolean); let best=null,bestScore=0;
 for(const q of queries){
  try{
   const u='https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*&language='+( /[가-힣]/.test(q)?'ko':'en')+'&uselang=ko&limit=8&search='+encodeURIComponent(q);
   const j=await fetch(u).then(r=>r.json());
   for(const h of j.search||[]){ const sc=Math.max(nameScore(h.label,place.name_kr),nameScore(h.label,place.name_en)); if(sc>bestScore){best=h;bestScore=sc;} }
  }catch{}
 }
 return bestScore>=48?best:null;
}

const CANONICAL_MEDIA_TTL=10*60*1000;
const canonicalMediaCache={};
function supabaseConfigured(){
 return !!(AOL_CONFIG.SUPABASE_URL && AOL_CONFIG.SUPABASE_PUBLISHABLE_KEY);
}
async function fetchCanonicalCachedAssets(subject){
 if(!subject?.place_id || !supabaseConfigured()) return [];
 const code=subject.place_id, hit=canonicalMediaCache[code];
 if(hit && Date.now()-hit.checkedAt<CANONICAL_MEDIA_TTL) return hit.assets;
 try{
  const base=String(AOL_CONFIG.SUPABASE_URL).replace(/\/$/,'');
  const url=base+'/rest/v1/public_place_media?place_code=eq.'+encodeURIComponent(code)+'&order=is_cover.desc,display_order.asc,relevance_score.desc&limit=12';
  const res=await fetch(url,{headers:{
    apikey:AOL_CONFIG.SUPABASE_PUBLISHABLE_KEY,
    Authorization:'Bearer '+AOL_CONFIG.SUPABASE_PUBLISHABLE_KEY,
    Accept:'application/json'
  }});
  if(!res.ok) throw new Error('Supabase media HTTP '+res.status);
  const rows=await res.json();
  const assets=(rows||[]).map(r=>({
    url:r.cached_public_url,
    file:r.provider_asset_id||r.storage_path||r.id,
    artist:r.creator||'',
    license:r.license_code||'',
    licenseUrl:r.license_url||'',
    source:r.source_url||r.original_file_url||'',
    allowed:true,
    rightsStatus:'cleared',
    relevance:100,
    score:Number(r.relevance_score||100),
    via:'Supabase cache',
    canonical:true,
    mediaAssetId:r.id,
    cacheVersion:r.cache_version||1,
    checkedAt:r.last_rights_sync_at||r.cached_at||''
  })).filter(x=>x.url && !isExcluded(subject,x.file));
  canonicalMediaCache[code]={checkedAt:Date.now(),assets};
  return assets;
 }catch(e){
  canonicalMediaCache[code]={checkedAt:Date.now(),assets:[],error:String(e?.message||e)};
  return [];
 }
}
function mergeMediaCandidates(primary,secondary){
 const seen=new Set(), out=[];
 for(const a of [...primary,...secondary]){
  const key=a.mediaAssetId||a.file||a.url;
  if(!key||seen.has(key))continue;
  seen.add(key);out.push(a);
 }
 return out.slice(0,12);
}

async function resolveSubjectImageCandidates(subject,force=false){
 const key=subjectKey(subject), cached=imgCache[key];
 const canonical=await fetchCanonicalCachedAssets(subject);
 if(canonical.length && !AOL_REVIEW_MODE) return canonical;
 if(!force && cached && Date.now()-cached.checkedAt<IMG_TTL){
   const liveCached=cached.assets||[];
   return canonical.length?mergeMediaCandidates(canonical,liveCached):liveCached;
 }
 let entityId=subject.place_id?null:subject.id, reason='not found', entity=null;
 const list=[];
 try{
  if(subject.place_id){ entity=await findWikidataEntityForSeed(subject); entityId=entity?.id||null; }
  if(entityId){
   const gu='https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=claims|labels|descriptions|sitelinks&languages=ko|en&ids='+entityId;
   const gj=await fetch(gu).then(r=>r.json()); const e=gj.entities?.[entityId];
   if(e){
    const p18=e?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    const p373=e?.claims?.P373?.[0]?.mainsnak?.datavalue?.value;
    if(p18 && !isExcluded(subject,p18)){
      const inf=await commonsFileInfo(p18);
      if(inf && (inf.allowed||AOL_REVIEW_MODE)){ list.push({...inf,relevance:100,score:98,via:'Wikidata P18',wikidataId:entityId}); }
    }
    if(p373){
      const cats=await commonsCategoryCandidates(p373,subject); list.push(...cats);
    }
   }
  } else {
    reason='Wikidata entity not matched';
  }
  const search=await commonsSearchCandidates(subject); list.push(...search);
 }catch(e){ reason='network/API error'; }

 const byFile={};
 for(const c of list){
  const prev=byFile[c.file];
  if(!prev || (Number(c.allowed)-Number(prev.allowed))*1000 + (c.score-prev.score) > 0) byFile[c.file]=c;
 }
 const liveAssets=Object.values(byFile).sort((a,b)=>(Number(b.allowed)-Number(a.allowed))*1000 + (b.score-a.score)).slice(0,12);
 imgCache[key]={checkedAt:Date.now(),assets:liveAssets,asset:liveAssets[0]||null,reason:liveAssets.length?'':reason}; saveImgCache();
 return canonical.length?mergeMediaCandidates(canonical,liveAssets):liveAssets;
}
async function resolvePlaceImage(place,force=false){ const assets=await resolveSubjectImageCandidates(place,force); return assets[0]||null; }
function creditText(a){const artist=strip(a.artist||'Wikimedia Commons contributor');return `${artist} · ${a.license}`}
function rightsInventory(){
 return Object.entries(imgCache).flatMap(([key,rec])=>(rec.assets||rec.asset?[...(rec.assets||[rec.asset])]:[]).map((a,i)=>({
   subject:key, rank:i+1, status:a.allowed?'cleared':'pending', source:a.source||'', creator:a.artist||'', license:a.license||'', licenseUrl:a.licenseUrl||'', file:a.file||'', via:a.via||'', score:a.score||'', checkedAt:rec.checkedAt||''
 })));
}
function downloadRightsCSV(){
 const rows=rightsInventory(), headers=['subject','rank','status','file','source','creator','license','licenseUrl','via','score','checkedAt'];
 const q=v=>`"${String(v??'').replaceAll('"','""')}"`; const csv=[headers.join(','),...rows.map(r=>headers.map(h=>q(r[h])).join(','))].join('\n');
 const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}); const url=URL.createObjectURL(blob), a=document.createElement('a');
 a.href=url; a.download='architecture-of-light_image-rights-review.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function syncImageElement(el,subject){
 if(!el||!subject||el.dataset.syncing==='1'||el.dataset.synced==='1')return;
 el.dataset.syncing='1';
 let stateEl=el.querySelector('.img-sync-state'); if(!stateEl){stateEl=document.createElement('div'); stateEl.className='img-sync-state'; stateEl.textContent='이미지 찾는 중'; el.appendChild(stateEl);}
 resolveSubjectImageCandidates(subject).then(assets=>{
  el.dataset.syncing='0';
  if(!assets.length){
    const rec=imgCache[subjectKey(subject)]||{}; stateEl.className='img-sync-state off'; stateEl.textContent='이미지 없음'; el.title=rec.reason||'적합한 이미지를 찾지 못함'; return;
  }
  const a=assets[0];
  const img=el.querySelector('img')||document.createElement('img'); if(!img.parentNode)el.prepend(img);
  img.alt=subject.place_id?subject.name_kr:subject.label; img.loading='lazy'; img.referrerPolicy='no-referrer';
  img.onload=()=>{img.classList.add('ready'); const ph=el.querySelector('.img-placeholder'); if(ph)ph.style.display='none';}
  img.onerror=()=>{stateEl.className='img-sync-state warn'; stateEl.textContent='이미지 로드 실패';}
  img.src=a.url;
  let c=el.querySelector('.img-credit'); if(!c){c=document.createElement('div'); c.className='img-credit'; el.appendChild(c);}
  const rightsLabel=a.allowed?'사용조건 확인됨':'권리확인 필요';
  c.innerHTML=`<a href="${a.source}" target="_blank" rel="noopener">${esc(creditText(a))}</a> · ${rightsLabel}`;
  stateEl.className='img-sync-state '+(a.allowed?'ok':'warn'); stateEl.textContent=(a.allowed?'✓ ':'⚠ ')+(a.via||'Commons');
  el.dataset.synced='1';
 });
}
function initImageSync(){
 const els=[...document.querySelectorAll('[data-img-place]')]; if(!els.length)return;
 const io='IntersectionObserver' in window ? new IntersectionObserver(entries=>{entries.forEach(en=>{ if(en.isIntersecting){ const p=placeBy(en.target.dataset.imgPlace); if(p)syncImageElement(en.target,p); io.unobserve(en.target);} })},{rootMargin:'400px'}) : null;
 els.forEach(el=> io ? io.observe(el) : syncImageElement(el, placeBy(el.dataset.imgPlace)));
}
function candidateCardHTML(subject,a,i){
 const badge=a.canonical?'<span class="rights-cleared">cached · cleared</span>':(a.allowed?'<span class="rights-cleared">cleared</span>':'<span class="rights-pending">권리확인 필요</span>');
 return `<div class="gallery-card">
  <div class="gallery-thumb"><img src="${esc(a.url)}" alt=""><div class="gallery-rank">대표후보 #${i+1}</div></div>
  <div class="gallery-body">
   <div class="gallery-head"><span class="score-pill">적합도 ${esc(a.score||0)}</span>${badge}</div>
   <div class="candidate-meta">${esc(a.via||'Commons')} · ${esc(a.file||'')}</div>
   <div class="candidate-meta">${esc(a.artist||'')} · ${esc(a.license||'Unknown')}</div>
   <div class="gallery-actions">
    <a class="mini-btn" href="${esc(a.source)}" target="_blank" rel="noopener">원본</a>
    <button class="mini-btn" data-exclude-subject="${esc(subjectKey(subject))}" data-exclude-file="${esc(a.file)}">제외</button>
   </div>
  </div>
 </div>`;
}
function populateCandidateGallery(subject, containerId){
 const box=document.getElementById(containerId); if(!box)return;
 box.innerHTML='<div class="meta">이미지 후보를 불러오는 중…</div>';
 resolveSubjectImageCandidates(subject).then(assets=>{
  if(!assets.length){ box.innerHTML='<div class="empty">표시할 이미지 후보가 없습니다.</div>'; return; }
  box.innerHTML=`<div class="gallery-grid">${assets.slice(0,3).map((a,i)=>candidateCardHTML(subject,a,i)).join('')}</div>
  ${assets.length>3?`<h3 style="margin-top:16px">추가 후보 ${assets.length-3}개</h3><div class="gallery-scroll">${assets.slice(3).map((a,i)=>candidateCardHTML(subject,a,i+3)).join('')}</div>`:''}
  <div class="notice" style="margin-top:12px">적합도 점수는 대표경로(P18/category/search), 장소명 일치도, 파일 설명 일치도를 기준으로 계산한 내부 참고값입니다.</div>`;
  bindDynamicActions();
 });
}
function bindDynamicActions(){
 document.querySelectorAll('[data-exclude-subject]').forEach(b=>b.onclick=()=>{
   const key=b.dataset.excludeSubject, file=b.dataset.excludeFile;
   const subject = key.startsWith('seed:') ? placeBy(key.replace('seed:','')) : (state.livePlace && key===subjectKey(state.livePlace) ? state.livePlace : state.liveResults.find(x=>('live:'+x.id)===key));
   if(subject) excludeCandidate(subject,file);
 });
 const ce=document.getElementById('clearExclusionsCurrent'); if(ce){
   ce.onclick=()=>{ const subject=state.page==='detail'?state.place:state.livePlace; if(subject) clearExclusions(subject); };
 }
}
function freshnessText(p){
 const checked=p.verified_at||'미검증'; const days=p.refresh_days||30;
 return `운영정보 ${checked} 검증 · ${days}일 주기`;
}

function status(p){const a=p.audit_status||'';const o=p.live_operation_state||'';if(o.includes('UPCOMING'))return['예정','off'];if(o.includes('ENDED')||o.includes('BETWEEN'))return['시즌 종료','off'];if(a.includes('PARTIAL')||a.includes('NEEDS')||a.includes('CONFLICT'))return['재확인','warn'];return['검증됨','']}
function statusHtml(p){const[x,c]=status(p);return `<span class="status ${c}">${x}</span>`} function badges(p){return `${p.free?'<span class="badge">무료</span>':'<span class="badge alt">유료/조건부</span>'}<span class="badge alt">${esc(p.primary_category)}</span>`}
function seedCard(p){return `<button class="card" data-place="${p.place_id}"><div class="visual synced-visual" data-img-place="${p.place_id}"><div class="img-placeholder"></div><img alt="" loading="lazy"></div><div class="card-body">${badges(p)} ${statusHtml(p)}<h3>${esc(p.name_kr)}</h3><div class="meta">${esc(p.district)} · ${esc(p.current_hours_verified||p.typical_hours||'')}</div></div></button>`}
function row(p,extra=''){return `<button class="row" data-place="${p.place_id}"><div class="thumb synced-visual" data-img-place="${p.place_id}"><div class="img-placeholder"></div><img alt="" loading="lazy"><div class="img-credit"></div></div><div><h3>${esc(p.name_kr)}</h3><div class="meta">${esc(p.primary_category)} · ${esc(p.district)}</div><div class="meta">${extra||esc(p.short_description||'')}</div></div><div>›</div></button>`}

function footer(){return `<div class="footer">Global live search: Wikidata · Wikimedia Commons. Map: © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>. 외부 정보는 각 제공처의 이용조건과 최신성에 따릅니다. <a href="./privacy.html">개인정보</a> · <a href="./about.html">서비스 정보</a></div>`}
function home(){
 const now=places.filter(p=>p.launch_decision==='KEEP'&&!String(p.live_operation_state).includes('UPCOMING')).slice(0,9);
 const editors=places.filter(p=>p.MVP_priority==='A'&&p.launch_decision==='KEEP').slice(0,10);
 return `<div class="review-banner"><b>INTERNAL IMAGE REVIEW MODE</b><br>Commons 후보 이미지를 라이선스 미확인 상태에서도 우선 표시합니다. 공개 출시 전 pending 이미지를 검토하세요.</div><div class="eyebrow" style="margin-top:14px">INTERNAL REVIEW · LIVE GLOBAL</div><h1>도시의 빛을 발견하세요.</h1><p class="muted">서울 큐레이션 + 전세계 Wikidata 라이브 탐색.</p>
 <section class="hero"><div class="eyebrow">TONIGHT</div><h2>오늘 밤 뭐 볼까?</h2><p>검증 상태와 현재 프로그램을 함께 확인하세요.</p><button class="cta" data-go-map>지도에서 찾기 →</button></section>
 <div class="section-head"><h2>서울 · 지금 추천</h2><button data-go-map>지도</button></div><div class="hscroll">${now.map(seedCard).join('')}</div>
 <div class="section-head"><h2>Editor Pick</h2><span class="meta">빛의 건축 해설</span></div><div class="hscroll">${editors.map(seedCard).join('')}</div>
 <h2>전세계 Live Search</h2><div class="notice">Wikidata를 실시간 조회합니다. 예: <b>teamLab Borderless</b>, <b>ARTE MUSEUM</b>, <b>digital art museum</b>. 좌표가 있는 검색결과는 실제 지도에 핀으로 표시됩니다.</div>
 <div class="live-search" style="margin-top:10px"><input id="globalHomeQ" placeholder="세계 장소 검색"><button class="cta" id="globalHomeBtn">검색</button></div>
 ${footer()}`;
}
function mapPage(){
 return `<div class="eyebrow">LIVE MAP</div><h1>서울 + 세계</h1>
 <div class="chips">${['전체','Media Facade','Media Art','Immersive','Light Art','Architecture'].map(x=>`<button class="chip ${state.category===x?'active':''}" data-cat="${x}">${x}</button>`).join('')}<button class="chip ${state.freeOnly?'active':''}" data-free>무료</button></div>
 <div id="leafletMap" class="map"></div>
 <div class="map-actions"><button class="cta dark" id="seoulView">서울 보기</button><button class="cta dark" id="myLocation">내 위치</button></div>
 <div class="notice">서울 Seed 장소는 정확한 좌표가 검증된 경우에만 자동 핀으로 넣도록 설계되어 있습니다. 현재 전세계 검색결과는 Wikidata P625 좌표를 그대로 지도에 표시합니다.</div>
 <h2>전세계 실시간 검색</h2><div class="live-search"><input id="globalQ" placeholder="예: teamLab Borderless"><button class="cta" id="globalBtn">검색</button></div><div id="globalMsg" class="meta" style="margin-top:8px"></div><div id="globalResults" class="live-results"></div>
 <div class="section-head"><h2>서울 Seed</h2><span class="meta">${places.length}곳</span></div><div class="list" id="seedList">${filteredPlaces().slice(0,35).map(p=>row(p)).join('')}</div>${footer()}`;
}
function filteredPlaces(){let r=places;if(state.category!=='전체')r=r.filter(p=>p.primary_category===state.category);if(state.freeOnly)r=r.filter(p=>p.free);return r}
function detail(p){
 const pw=works.filter(w=>w.place_id===p.place_id),ps=schedules.filter(s=>s.place_id===p.place_id),src=sources.filter(s=>s.place_id===p.place_id);
 const saved=store.saved.has(p.place_id),vis=store.visited[p.place_id]||0; const mapUrl='https://www.openstreetmap.org/search?query='+encodeURIComponent(p.address||p.name_kr);
 const exCount=(excludedFiles[subjectKey(p)]||[]).length;
 return `<div class="cover synced-visual" data-img-place="${p.place_id}"><div class="img-placeholder"></div><img alt="" loading="eager"><div class="img-credit"></div></div><div class="detail"><div class="titleline"><div><div class="eyebrow">${esc(p.primary_category)} · ${esc(p.district)}</div><h1>${esc(p.name_kr)}</h1><div class="muted">${esc(p.name_en||'')}</div></div><button class="circle" data-save="${p.place_id}">${saved?'♥':'♡'}</button></div>
 <div style="margin:9px 0">${statusHtml(p)}</div><p>${esc(p.short_description)}</p><div style="display:flex;gap:8px"><button class="cta dark" data-visit="${p.place_id}">✓ 방문${vis?` ${vis}회`:''}</button><a class="cta" target="_blank" href="${mapUrl}">지도 검색</a></div>
 <div class="sync-panel" style="margin-top:14px">
  <div class="sync-row"><b><span class="sync-dot"></span> 이미지</b><span>${supabaseConfigured()?'Supabase cache active → Commons fallback':'Supabase 미연결 · Commons live fallback'}</span></div>
  <div class="sync-row"><b><span class="sync-dot warn"></span> 운영정보</b><span>${esc(freshnessText(p))}</span></div>
  <div class="sync-row"><b>수동 제외</b><span>${exCount}개 파일 제외됨</span></div>
 </div>
 <h2>추천 이유</h2><p class="quote">${esc(p.why_it_matters)}</p>
 <div class="info-grid"><div class="info"><strong>주소</strong>${esc(p.address)}</div><div class="info"><strong>운영</strong>${esc(p.current_hours_verified||p.typical_hours||'확인 필요')}</div><div class="info"><strong>관람료</strong>${p.free?'무료':'유료/조건부'}</div><div class="info"><strong>검증일</strong>${esc(p.verified_at||'')}</div></div>
 <h2>대표 이미지 후보 3개</h2><p class="muted">대표 후보와 추가 후보를 확인하고, 잘못 매칭된 이미지는 제외할 수 있습니다.</p>
 <p><button class="mini-btn" id="clearExclusionsCurrent">현재 장소 제외목록 초기화</button></p>
 <div id="gallery-${p.place_id}"><div class="meta">이미지 후보를 불러오는 중…</div></div>
 <h2>빛의 건축 해설</h2><p>${esc(p.expert_description||p.description)}</p><h2>현재 프로그램</h2><p>${esc(p.current_program||'최신 편성 확인 필요')}</p>
 <div class="notice"><b>데이터 상태</b><br>${esc(p.audit_status||'')}<br>${esc(p.verification_note||'')}</div>
 ${pw.length?`<h2>작품 / 전시</h2>${pw.map(w=>`<div class="info" style="margin-bottom:8px"><strong>${esc(w.title)}</strong>${esc(w.artist||'')} · ${esc(w.media||'')}<p>${esc(w.description||'')}</p></div>`).join('')}`:''}
 ${ps.length?`<h2>Seed 일정</h2>${ps.map(s=>`<div class="info" style="margin-bottom:8px"><strong>${esc(s.day_of_week)}</strong>${esc(s.open_time||'')} ${s.close_time?'– '+esc(s.close_time):''}<div class="meta">${esc(s.note||'')}</div></div>`).join('')}`:''}
 <h2>출처</h2>${p.verification_source_1?`<p><a class="cta dark full" target="_blank" href="${esc(p.verification_source_1)}">검증 출처 열기</a></p>`:''}${p.verification_source_2?`<p><a class="cta dark full" target="_blank" href="${esc(p.verification_source_2)}">추가 출처 열기</a></p>`:''}${src.slice(0,2).map(s=>`<p class="meta"><a href="${esc(s.url)}" target="_blank" style="color:#bda9ff">${esc(s.publisher)} Seed 출처</a></p>`).join('')}${footer()}</div>`;
}

function liveDetail(x){
 const exCount=(excludedFiles[subjectKey(x)]||[]).length;
 const mapLink=x.lat!=null&&x.lng!=null?`https://www.openstreetmap.org/?mlat=${x.lat}&mlon=${x.lng}#map=16/${x.lat}/${x.lng}`:x.wikidata;
 return `<div class="cover"></div><div class="detail"><div class="titleline"><div><div class="eyebrow">GLOBAL LIVE RESULT · ${esc(x.id)}</div><h1>${esc(x.label)}</h1><div class="muted">${esc(x.description||'')}</div></div><button class="circle" data-promote-live="${esc(x.id)}">＋</button></div>
 <div class="live-detail-head">${x.lat!=null?'<span class="status">좌표 있음</span>':'<span class="status warn">좌표 없음</span>'}${x.website?'<span class="status">공식사이트</span>':''}<span class="status">전세계 검색결과</span></div>
 <p class="notice"><b>서울 Seed처럼 승격 가능한 라이브 엔티티</b><br>현재는 Wikidata 기반 임시 상세페이지이며, 추후 저장·큐레이션·DB 편입 후보로 사용할 수 있습니다.</p>
 <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="cta" target="_blank" href="${mapLink}">지도/위치 열기</a><a class="cta dark" target="_blank" href="${esc(x.wikidata)}">Wikidata</a>${x.website?`<a class="cta dark" target="_blank" href="${esc(x.website)}">공식사이트</a>`:''}</div>
 <div class="sync-panel" style="margin-top:14px">
  <div class="sync-row"><b><span class="sync-dot"></span> 이미지</b><span>${supabaseConfigured()?'Supabase cache active → Commons fallback':'Supabase 미연결 · Commons live fallback'}</span></div>
  <div class="sync-row"><b>수동 제외</b><span>${exCount}개 파일 제외됨</span></div>
  <div class="sync-row"><b>승격 흐름</b><span>검색결과 → 상세페이지 → 선별 → Seed 편입</span></div>
 </div>
 <h2>대표 이미지 후보 3개</h2>
 <p><button class="mini-btn" id="clearExclusionsCurrent">현재 장소 제외목록 초기화</button></p>
 <div id="gallery-live-${x.id}"><div class="meta">이미지 후보를 불러오는 중…</div></div>
 <h2>검색결과 메타데이터</h2>
 <div class="info-grid"><div class="info"><strong>Wikidata ID</strong>${esc(x.id)}</div><div class="info"><strong>좌표</strong>${x.lat!=null?esc(`${x.lat}, ${x.lng}`):'없음'}</div><div class="info"><strong>대표이미지(P18)</strong>${x.image?esc(x.image):'없음'}</div><div class="info"><strong>권장 사용</strong>향후 Seed 후보</div></div>
 <div class="notice">이 흐름은 전세계/전국 검색결과를 서울 Seed처럼 상세 검토 대상으로 올리는 첫 단계입니다. 검토 후 별도 DB 편입, 큐레이션 연결, 대표이미지 확정 흐름으로 확장할 수 있습니다.</div>
 ${footer()}</div>`;
}
function curationPage(){return `<div class="eyebrow">CURATED JOURNEYS</div><h1>큐레이션</h1><p class="muted">자동 수집이 늘어나도 ‘왜 볼 가치가 있는가’는 편집 자산으로 유지합니다.</p><div class="list">${curations.map(c=>`<button class="curation" data-cur="${c.curation_id}"><div class="eyebrow">${esc(c.city)} · ${esc(c.estimated_time)}</div><h3 style="font-size:21px">${esc(c.title)}</h3><div class="muted">${esc(c.subtitle||'')}</div></button>`).join('')}</div>${footer()}`}
function curationDetail(c){const links=curationPlaces.filter(x=>x.curation_id===c.curation_id).sort((a,b)=>(a.order||0)-(b.order||0));return `<button class="chip" data-nav="curation">← 큐레이션</button><div class="eyebrow" style="margin-top:18px">${esc(c.city)} · ${esc(c.estimated_time)}</div><h1>${esc(c.title)}</h1><p>${esc(c.description||'')}</p><button class="cta full" data-go-map>지도에서 보기</button><h2>코스</h2><div class="list">${links.map((x,i)=>{const p=placeBy(x.place_id);return p?row(p,`${i+1}. ${x.editor_comment||''}`):''}).join('')}</div>${footer()}`}
function savedPage(){const ps=[...store.saved].map(placeBy).filter(Boolean);return `<div class="eyebrow">SAVE</div><h1>저장한 장소</h1>${ps.length?`<div class="list">${ps.map(p=>row(p)).join('')}</div>`:`<div class="empty">아직 저장한 장소가 없습니다.</div>`}${footer()}`}
function myPage(){const ps=Object.keys(store.visited).map(placeBy).filter(Boolean),districts=new Set(ps.map(p=>p.district)); const excludedCount=Object.values(excludedFiles).reduce((a,b)=>a+(b?.length||0),0); return `<div class="eyebrow">MY LIGHT MAP</div><h1>나의 빛 지도</h1><p class="muted">Public Beta에서는 서버 계정 없이 이 기기에만 저장됩니다.</p><div class="notice"><b>자동 동기화</b><br>이미지는 3일마다 재검색·라이선스 재검증합니다. 운영정보는 현재 Seed 검증주기를 표시하며, 서울 OpenAPI 키를 연결하면 자동 일정 갱신으로 전환됩니다.</div><div class="sync-panel" style="margin-top:10px"><div class="sync-row"><b>Media backend</b><span>${supabaseConfigured()?'Hybrid · Supabase cache ON':'Live-only fallback'}</span></div></div><p><button class="cta dark full" id="refreshImages">이미지 캐시 지금 갱신</button></p>
<div class="sync-panel">
 <div class="sync-row"><b>이미지 권리검토</b><span>${rightsInventory().filter(x=>x.status==='cleared').length} cleared / ${rightsInventory().filter(x=>x.status==='pending').length} pending</span></div>
 <div class="sync-row"><b>수동 제외목록</b><span>${excludedCount}개 파일 제외됨</span></div>
 <button class="cta dark full" id="downloadRights">이미지 권리검토 CSV 내려받기</button>
</div>
<div class="sync-panel"><div class="sync-row"><b>이미지 캐시</b><span id="imgCacheStats">${Object.values(imgCache).filter(x=>(x.assets||[]).length>0).length} 장소 성공 / ${Object.values(imgCache).filter(x=>(x.assets||[]).length===0).length} 미확보</span></div></div><div class="stats"><div class="stat"><b>${ps.length}</b><small>방문</small></div><div class="stat"><b>${store.saved.size}</b><small>저장</small></div><div class="stat"><b>${districts.size}</b><small>지역</small></div></div><h2>방문</h2>${ps.length?`<div class="list">${ps.map(p=>row(p,`방문 ${store.visited[p.place_id]}회`)).join('')}</div>`:`<div class="empty">방문 기록이 없습니다.</div>`}${footer()}`}
function setPage(page,payload){state.page=page;if(page==='detail')state.place=payload;if(page==='liveDetail')state.livePlace=payload;if(page==='curationDetail')state.curation=payload;document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.nav===page||(page==='detail'&&n.dataset.nav==='map')||(page==='liveDetail'&&n.dataset.nav==='map')||(page==='curationDetail'&&n.dataset.nav==='curation')));render();scrollTo({top:0,behavior:'smooth'})}
function render(){let s='';if(state.page==='home')s=home();if(state.page==='map')s=mapPage();if(state.page==='detail')s=detail(state.place);if(state.page==='liveDetail')s=liveDetail(state.livePlace);if(state.page==='curation')s=curationPage();if(state.page==='curationDetail')s=curationDetail(state.curation);if(state.page==='saved')s=savedPage();if(state.page==='my')s=myPage();$('#view').innerHTML=s;bind();initImageSync();if(state.page==='detail'&&state.place)setTimeout(()=>populateCandidateGallery(state.place,`gallery-${state.place.place_id}`),0);if(state.page==='liveDetail'&&state.livePlace)setTimeout(()=>populateCandidateGallery(state.livePlace,`gallery-live-${state.livePlace.id}`),0);if(state.page==='map')setTimeout(initMap,0)}

function bind(){
 document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>setPage(b.dataset.nav));
 document.querySelectorAll('[data-place]').forEach(b=>b.onclick=()=>setPage('detail',placeBy(b.dataset.place)));
 document.querySelectorAll('[data-cur]').forEach(b=>b.onclick=()=>setPage('curationDetail',curations.find(c=>c.curation_id===b.dataset.cur)));
 document.querySelectorAll('[data-go-map]').forEach(b=>b.onclick=()=>setPage('map'));
 document.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{state.category=b.dataset.cat;render()});
 const f=$('[data-free]');if(f)f.onclick=()=>{state.freeOnly=!state.freeOnly;render()};
 document.querySelectorAll('[data-save]').forEach(b=>b.onclick=()=>{const id=b.dataset.save;store.saved.has(id)?store.saved.delete(id):store.saved.add(id);store.sync();render()});
 document.querySelectorAll('[data-visit]').forEach(b=>b.onclick=()=>{const id=b.dataset.visit;store.visited[id]=(store.visited[id]||0)+1;store.sync();render()});
 const ri=$('#refreshImages');if(ri)ri.onclick=()=>{imgCache={};saveImgCache();render();};
 const dr=$('#downloadRights');if(dr)dr.onclick=downloadRightsCSV;
 const gh=$('#globalHomeBtn');if(gh)gh.onclick=()=>{const q=$('#globalHomeQ').value.trim();setPage('map');setTimeout(()=>{const x=$('#globalQ');if(x){x.value=q;searchGlobal(q)}},50)}; document.querySelectorAll('[data-promote-live]').forEach(b=>b.onclick=()=>alert('이 엔티티는 상세 검토 단계입니다. 다음 단계에서는 Seed 후보 DB에 저장하도록 연결하면 됩니다.')); bindDynamicActions();
}

function initMap(){
 if(!window.L||!$('#leafletMap'))return;
 state.map=L.map('leafletMap',{worldCopyJump:true}).setView([37.5665,126.9780],11);
 L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(state.map);
 state.markers=[];
 const seoul=$('#seoulView');if(seoul)seoul.onclick=()=>state.map.setView([37.5665,126.9780],11);
 const loc=$('#myLocation');if(loc)loc.onclick=()=>navigator.geolocation?navigator.geolocation.getCurrentPosition(p=>state.map.setView([p.coords.latitude,p.coords.longitude],13),()=>alert('위치 권한이 없거나 위치를 가져오지 못했습니다.')):alert('이 브라우저는 위치 기능을 지원하지 않습니다.');
 const gb=$('#globalBtn');if(gb)gb.onclick=()=>searchGlobal($('#globalQ').value.trim());
 if(state.liveResults.length)showLiveMarkers(state.liveResults);
}
async function searchGlobal(q){
 if(!q)return;const msg=$('#globalMsg');if(msg)msg.textContent='Wikidata 실시간 검색 중…';
 try{
   const sUrl='https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&origin=*&language=ko&uselang=ko&limit=12&search='+encodeURIComponent(q);
   const sr=await fetch(sUrl).then(r=>r.json()); const ids=(sr.search||[]).map(x=>x.id);
   if(!ids.length){if(msg)msg.textContent='검색 결과가 없습니다.';renderLiveResults([]);return}
   const gUrl='https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*&props=labels|descriptions|claims|sitelinks&languages=ko|en&ids='+encodeURIComponent(ids.join('|'));
   const gr=await fetch(gUrl).then(r=>r.json());
   state.liveResults=ids.map(id=>normalizeEntity(gr.entities[id],(sr.search||[]).find(x=>x.id===id))).filter(Boolean);
   if(msg)msg.textContent=`Wikidata에서 ${state.liveResults.length}개 후보를 불러왔습니다. 좌표가 있는 항목은 지도에 표시됩니다.`;
   renderLiveResults(state.liveResults);showLiveMarkers(state.liveResults);
 }catch(e){if(msg)msg.textContent='외부 데이터 호출에 실패했습니다. 네트워크 상태 또는 Wikidata 서비스 상태를 확인하세요.'}
}
function claimVal(e,p){try{return e.claims[p][0].mainsnak.datavalue.value}catch{return null}}
function normalizeEntity(e,s){
 if(!e)return null;const c=claimVal(e,'P625');const image=claimVal(e,'P18');const site=claimVal(e,'P856');
 const label=(e.labels?.ko?.value||e.labels?.en?.value||s?.label||e.id);const description=(e.descriptions?.ko?.value||e.descriptions?.en?.value||s?.description||'');
 return {id:e.id,label,description,lat:c?.latitude,lng:c?.longitude,image,website:site,wikidata:'https://www.wikidata.org/wiki/'+e.id}
}
function renderLiveResults(arr){
 const box=$('#globalResults'); if(!box)return;
 box.innerHTML=arr.length?arr.map((x,i)=>`<div class="live-card" id="live-${x.id}"><div class="live-head"><div><div class="eyebrow">WIKIDATA · ${esc(x.id)}</div><h3>${esc(x.label)}</h3></div>${x.lat!=null?'<span class="status">좌표</span>':'<span class="status warn">좌표 없음</span>'}</div><p>${esc(x.description)}</p><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="chip" data-live-map="${i}">지도</button><button class="chip" data-live-detail="${i}">상세보기</button><a class="chip" target="_blank" href="${x.wikidata}" style="text-decoration:none">Wikidata</a>${x.website?`<a class="chip" target="_blank" href="${esc(x.website)}" style="text-decoration:none">공식사이트</a>`:''}${x.image?`<button class="chip" data-commons="${i}">Commons 이미지 확인</button>`:''}</div><div id="commons-${i}"></div></div>`).join(''):'<div class="empty">검색 결과 없음</div>';
 box.querySelectorAll('[data-live-map]').forEach(b=>b.onclick=()=>{const x=arr[+b.dataset.liveMap]; if(x.lat!=null&&state.map){state.map.setView([x.lat,x.lng],15)} else alert('Wikidata에 좌표가 없습니다.')});
 box.querySelectorAll('[data-live-detail]').forEach(b=>b.onclick=()=>setPage('liveDetail',arr[+b.dataset.liveDetail]));
 box.querySelectorAll('[data-commons]').forEach(b=>b.onclick=()=>loadCommons(arr[+b.dataset.commons],+b.dataset.commons));
}
function showLiveMarkers(arr){
 if(!state.map)return;state.markers.forEach(m=>m.remove());state.markers=[];
 arr.filter(x=>x.lat!=null&&x.lng!=null).forEach(x=>{const m=L.marker([x.lat,x.lng]).addTo(state.map).bindPopup(`<b>${esc(x.label)}</b><br>${esc(x.description)}`);state.markers.push(m)});
 if(state.markers.length===1)state.map.setView(state.markers[0].getLatLng(),15);else if(state.markers.length>1){const g=L.featureGroup(state.markers);state.map.fitBounds(g.getBounds().pad(.25))}
}
async function loadCommons(x,i){
 const box=$(`#commons-${i}`);if(!box||!x.image)return;box.innerHTML='<div class="meta">Wikimedia Commons 라이선스 확인 중…</div>';
 try{
  const u='https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1000&titles='+encodeURIComponent('File:'+x.image);
  const j=await fetch(u).then(r=>r.json());const page=Object.values(j.query?.pages||{})[0];const ii=page?.imageinfo?.[0];if(!ii)throw 0;
  const m=ii.extmetadata||{};const lic=strip(m.LicenseShortName?.value||m.UsageTerms?.value||'');const lurl=m.LicenseUrl?.value||'';const artist=strip(m.Artist?.value||m.Credit?.value||'');const lower=lic.toLowerCase();
  const allowed=(lower.includes('cc by')||lower.includes('cc0')||lower.includes('public domain')||lower==='pd')&&!lower.includes('nc')&&!lower.includes('nd');
  if(!allowed){box.innerHTML=`<div class="notice" style="margin-top:10px">자동 커버 사용 안 함: 라이선스 “${esc(lic||'불명')}”. 정확한 이용조건을 수동 확인해야 합니다.</div>`;return}
  box.innerHTML=`<img class="commons" src="${esc(ii.thumburl||ii.url)}" alt=""><div class="attrib">이미지: ${esc(artist||'Wikimedia Commons contributor')} · ${esc(lic)} ${lurl?`· <a href="${esc(lurl)}" target="_blank" style="color:#bba5ff">license</a>`:''} · <a href="https://commons.wikimedia.org/wiki/File:${encodeURIComponent(x.image)}" target="_blank" style="color:#bba5ff">source</a></div>`;
 }catch{box.innerHTML='<div class="notice" style="margin-top:10px">Commons 메타데이터를 불러오지 못했습니다.</div>'}
}

const dlg=$('#searchDialog'),si=$('#searchInput'),sb=$('#searchBody');$('#searchOpen').onclick=()=>{dlg.showModal();si.focus();seedSearch('')};si.oninput=()=>seedSearch(si.value);
function seedSearch(q){const t=q.trim().toLowerCase();const r=places.filter(p=>!t||[p.name_kr,p.name_en,p.district,p.primary_category,p.short_description].some(v=>String(v||'').toLowerCase().includes(t))).slice(0,25);sb.innerHTML=r.map(p=>row(p)).join('');sb.querySelectorAll('[data-place]').forEach(b=>b.onclick=()=>{dlg.close();setPage('detail',placeBy(b.dataset.place))})}
render();
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
