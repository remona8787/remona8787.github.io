
const D = window.AOL_DATA;
const allPlaces = D.places;
const places = allPlaces.filter(p => p.launch_decision !== 'HOLD');
const curations = D.curations;
const curationPlaces = D.curation_places;
const works = D.works;
const schedules = D.schedules;
const sources = D.sources;

const state={page:'home',selectedPlace:null,selectedCuration:null,category:'전체',freeOnly:false,region:'서울'};
const store={
  saved:new Set(JSON.parse(localStorage.getItem('aol_saved_v02')||'[]')),
  visited:JSON.parse(localStorage.getItem('aol_visited_v02')||'{}'),
  sync(){localStorage.setItem('aol_saved_v02',JSON.stringify([...this.saved]));localStorage.setItem('aol_visited_v02',JSON.stringify(this.visited));}
};
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const placeById=id=>allPlaces.find(p=>p.place_id===id);

function liveState(p){
  const s=p.live_operation_state||'';
  if(s.includes('UPCOMING')) return ['예정','off'];
  if(s.includes('ENDED')||s.includes('BETWEEN')) return ['시즌 종료','off'];
  if((p.audit_status||'').includes('HOLD')) return ['확인중','off'];
  if((p.audit_status||'').includes('PARTIAL')||(p.audit_status||'').includes('NEEDS')||(p.audit_status||'').includes('CONFLICT')) return ['재확인 필요','warn'];
  return ['검증됨',''];
}
function statusPill(p){const [t,c]=liveState(p);return `<span class="live-pill ${c}"><span class="source-dot"></span>${t}</span>`}
function badge(p){return `${p.free?'<span class="badge">무료</span>':'<span class="badge violet">유료/조건부</span>'}<span class="badge violet">${esc(p.primary_category)}</span>`}
function visual(){return `<div class="visual"></div>`}
function placeCard(p){return `<button class="place-card" data-place="${p.place_id}">${visual()}<div class="card-body">${badge(p)} ${statusPill(p)}<h3>${esc(p.name_kr)}</h3><div class="meta">${esc(p.district)} · ${esc(p.current_hours_verified||p.typical_hours||'운영정보 확인')}</div><div class="auditline">검증 ${esc(p.verified_at||'')}</div></div></button>`}
function listCard(p,extra=''){return `<button class="list-card" data-place="${p.place_id}"><div class="thumb"></div><div><h3>${esc(p.name_kr)}</h3><div class="meta">${esc(p.primary_category)} · ${esc(p.district)} · ${statusPill(p)}</div><div class="small">${extra||esc(p.short_description||'')}</div></div><div class="arrow">›</div></button>`}

function regionTabs(){
 return `<div class="region-tabs">${['서울','전국','세계'].map(x=>`<button class="region-tab ${state.region===x?'active':''}" data-region="${x}">${x}</button>`).join('')}</div>`;
}
function liveProviders(region){
  const arr = region==='전국'
    ? [['TourAPI 4.0','전국 관광지·행사·이미지·동기화 목록','API key 필요'],['서울/지자체 OpenAPI','문화행사·공간·예약','도시별 adapter'],['Wikidata','장소 QID·기초정보','키 없이 enrichment 가능']]
    : [['Wikidata + OSM','전세계 식별·기초지리','canonical enrichment'],['Google Places / Foursquare','영업시간·존재·POI 실시간 보강','API key + 약관 준수'],['Ticketmaster','글로벌 이벤트 후보','API key'],['Europeana / Wikimedia','문화 이미지·아카이브','자산별 권리 확인']];
  return `<div class="list">${arr.map(a=>`<div class="provider-card"><h3>${esc(a[0])}</h3><div>${esc(a[1])}</div><div class="small muted">${esc(a[2])}</div></div>`).join('')}</div>`;
}

function renderHome(){
 const featured=places.filter(p=>p.MVP_priority==='A'&&p.launch_decision==='KEEP').slice(0,10);
 const now=places.filter(p=>p.launch_decision==='KEEP'&&!['UPCOMING','BETWEEN_SEASONS'].includes(p.live_operation_state)).slice(0,8);
 return `<div class="eyebrow">SEOUL · LIVE-READY V0.2</div><h1>도시의 빛을 발견하세요.</h1><p class="muted">검증된 장소 + 라이브 데이터 연동 준비.</p>
 <section class="hero"><div class="eyebrow">TONIGHT</div><h2>오늘 밤 뭐 볼까?</h2><p>현재 추천 가능한 장소만 먼저 보여줍니다.</p><button class="cta" data-tonight>오늘 밤 추천 보기 →</button></section>
 <div class="chips" style="margin-top:14px"><button class="chip" data-quick="free">무료</button><button class="chip" data-quick="Media Facade">미디어파사드</button><button class="chip" data-quick="Immersive">몰입형</button><button class="chip" data-quick="Light Art">빛</button></div>
 <div class="section-head"><h2>지금 추천 가능</h2><button data-nav="map">더보기</button></div><div class="hscroll">${now.map(placeCard).join('')}</div>
 <div class="section-head"><h2>Editor Pick</h2><span class="small muted">검증 우선</span></div><div class="hscroll">${featured.map(placeCard).join('')}</div>
 <div class="section-head"><h2>이번 주 큐레이션</h2><button data-nav="curation">전체</button></div><div class="list">${curations.slice(0,3).map(c=>`<button class="curation-card" data-curation="${c.curation_id}"><div class="eyebrow">${esc(c.theme||'CURATION')}</div><h3>${esc(c.title)}</h3><div class="muted">${esc(c.subtitle||'')}</div></button>`).join('')}</div>`;
}

function renderMap(){
 let filtered=places;
 if(state.category!=='전체') filtered=filtered.filter(p=>p.primary_category===state.category);
 if(state.freeOnly) filtered=filtered.filter(p=>p.free);
 const pins=[[22,30],[50,25],[75,35],[35,52],[62,58],[18,72],[82,75],[48,82]].map(a=>`<span class="mock-pin" style="left:${a[0]}%;top:${a[1]}%"></span>`).join('');
 if(state.region!=='서울'){
   return `<div class="eyebrow">EXPLORE</div><h1>지도 · ${state.region}</h1>${regionTabs()}<div class="notice"><b>${state.region} 자동 확장 구조는 준비됨.</b><br>실제 장소를 불러오려면 provider API key가 필요합니다. 아래 소스는 50곳 고정 DB를 넘어 자동 갱신하는 용도입니다.</div><h2>연동 소스</h2>${liveProviders(state.region)}<h2>데이터 원칙</h2><div class="notice">빛의 건축 자체 해설은 영구 DB에 보관하고, Google/Foursquare 같은 live 정보는 provider ID + TTL snapshot으로 분리합니다.</div>`;
 }
 return `<div class="eyebrow">EXPLORE</div><h1>지도</h1>${regionTabs()}
 <div class="chips">${['전체','Media Facade','Media Art','Immersive','Light Art','Architecture'].map(x=>`<button class="chip ${state.category===x?'active':''}" data-category="${x}">${x==='전체'?'전체':x}</button>`).join('')}<button class="chip ${state.freeOnly?'active':''}" data-free>무료</button></div>
 <div class="map-shell" style="margin-top:12px">${pins}</div><div class="notice" style="margin-top:10px">지도 핀 좌표는 아직 API Geocoding 전이라 임의 생성하지 않았습니다. 주소 검증은 완료/부분완료 상태를 장소별로 표시했습니다.</div>
 <div class="section-head"><h2>서울 장소 ${filtered.length}</h2><span class="small muted">${esc(state.category)}</span></div><div class="list">${filtered.slice(0,40).map(p=>listCard(p)).join('')}</div>`;
}

function renderDetail(p){
 const pw=works.filter(w=>w.place_id===p.place_id), ps=schedules.filter(s=>s.place_id===p.place_id), src=sources.filter(s=>s.place_id===p.place_id);
 const saved=store.saved.has(p.place_id), visited=store.visited[p.place_id]||0;
 const mapUrl='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(p.address||p.name_kr);
 return `<div class="detail-head"><div class="cover"></div></div><div class="detail-content">
 <div class="detail-title"><div><div class="eyebrow">${esc(p.primary_category)} · ${esc(p.district)}</div><h1>${esc(p.name_kr)}</h1><div class="muted">${esc(p.name_en||'')}</div></div><button class="round-action" data-save="${p.place_id}">${saved?'♥':'♡'}</button></div>
 <div style="margin:10px 0">${statusPill(p)}</div><p>${esc(p.short_description)}</p>
 <div style="display:flex;gap:8px"><button class="cta secondary" data-visit="${p.place_id}">✓ 방문했어요${visited?` · ${visited}`:''}</button><a class="cta" style="text-decoration:none" target="_blank" href="${mapUrl}">지도 검색</a></div>
 <h2>이곳을 추천하는 이유</h2><p class="quote">${esc(p.why_it_matters)}</p>
 <div class="info-grid"><div class="info"><strong>주소</strong>${esc(p.address||'확인 필요')}</div><div class="info"><strong>운영</strong>${esc(p.current_hours_verified||p.typical_hours||'확인 필요')}</div><div class="info"><strong>관람료</strong>${p.free?'무료':'유료/조건부'}</div><div class="info"><strong>검증일</strong>${esc(p.verified_at||'')}</div></div>
 <h2>빛의 건축 해설</h2><p>${esc(p.expert_description||p.description)}</p>
 <h2>현재 프로그램</h2><p>${esc(p.current_program||'최신 편성 확인 필요')}</p>
 <div class="notice"><b>데이터 감사:</b> ${esc(p.audit_status||'')}<br>${esc(p.verification_note||'')}</div>
 ${pw.length?`<h2>작품 / 전시</h2><div class="list">${pw.map(w=>`<div class="info"><strong>${esc(w.title)}</strong><span class="small muted">${esc(w.artist||'')} · ${esc(w.media||'')}</span><p>${esc(w.description||'')}</p></div>`).join('')}</div>`:''}
 ${ps.length?`<h2>Seed 일정</h2>${ps.map(s=>`<div class="info" style="margin-bottom:8px"><strong>${esc(s.day_of_week)}</strong>${esc(s.open_time||'')} ${s.close_time?'– '+esc(s.close_time):''}<div class="small muted">${esc(s.note||'')}</div></div>`).join('')}`:''}
 <h2>검증 출처</h2>${p.verification_source_1?`<p class="source"><a class="link" target="_blank" href="${esc(p.verification_source_1)}">검증 출처 1</a></p>`:''}${p.verification_source_2?`<p class="source"><a class="link" target="_blank" href="${esc(p.verification_source_2)}">검증 출처 2</a></p>`:''}
 ${src.map(s=>`<p class="source">${esc(s.publisher)} · <a class="link" target="_blank" href="${esc(s.url)}">Seed 출처</a></p>`).join('')}
 </div>`;
}

function renderCuration(){return `<div class="eyebrow">CURATED JOURNEYS</div><h1>큐레이션</h1><p class="muted">외부 데이터가 늘어나도 편집 큐레이션은 빛의 건축의 핵심 자산으로 유지됩니다.</p><div class="list">${curations.map(c=>`<button class="curation-card" data-curation="${c.curation_id}"><div class="eyebrow">${esc(c.city)} · ${esc(c.estimated_time)}</div><h3>${esc(c.title)}</h3><div>${esc(c.subtitle||'')}</div></button>`).join('')}</div>`}
function renderCurationDetail(c){const links=curationPlaces.filter(x=>x.curation_id===c.curation_id).sort((a,b)=>(a.order||0)-(b.order||0));return `<button class="chip" data-back="curation">← 큐레이션</button><div class="eyebrow" style="margin-top:18px">${esc(c.city)} · ${esc(c.estimated_time)}</div><h1>${esc(c.title)}</h1><p>${esc(c.description||'')}</p><button class="cta full" data-curation-map>지도에서 ${links.length}곳 보기</button><h2>코스</h2><div class="list">${links.map((x,i)=>{const p=placeById(x.place_id);return p?listCard(p,`${String(i+1).padStart(2,'0')} · ${esc(x.editor_comment||'')}`):''}).join('')}</div>`}
function renderSaved(){const list=[...store.saved].map(placeById).filter(Boolean);return `<div class="eyebrow">SAVE</div><h1>저장한 장소</h1>${list.length?`<div class="list">${list.map(p=>listCard(p)).join('')}</div>`:`<div class="empty">아직 저장한 장소가 없습니다.</div>`}`}
function renderMy(){const visited=Object.keys(store.visited).map(placeById).filter(Boolean), districts=new Set(visited.map(p=>p.district).filter(Boolean));return `<div class="eyebrow">MY LIGHT MAP</div><h1>나의 빛 지도</h1><p class="muted">프로토타입은 localStorage, 실제 앱은 Supabase saved_places / visited_places로 교체.</p><div class="stats"><div class="stat"><strong>${visited.length}</strong><span>방문</span></div><div class="stat"><strong>${store.saved.size}</strong><span>저장</span></div><div class="stat"><strong>${districts.size}</strong><span>지역</span></div></div><h2>최근 방문</h2>${visited.length?`<div class="list">${visited.map(p=>listCard(p,`방문 ${store.visited[p.place_id]}회`)).join('')}</div>`:`<div class="empty">방문 기록이 없습니다.</div>`}<h2>Live-ready</h2><div class="notice">전국/세계 provider 연동 시에도 개인 기록은 우리 DB의 canonical place_id와 연결됩니다.</div>`}

function setPage(page,payload){state.page=page;if(page==='detail')state.selectedPlace=payload;if(page==='curationDetail')state.selectedCuration=payload;document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.nav===page||(page==='detail'&&b.dataset.nav==='map')||(page==='curationDetail'&&b.dataset.nav==='curation')));render();window.scrollTo({top:0,behavior:'smooth'})}
function render(){let out='';if(state.page==='home')out=renderHome();if(state.page==='map')out=renderMap();if(state.page==='detail')out=renderDetail(state.selectedPlace);if(state.page==='curation')out=renderCuration();if(state.page==='curationDetail')out=renderCurationDetail(state.selectedCuration);if(state.page==='saved')out=renderSaved();if(state.page==='my')out=renderMy();$('#view').innerHTML=out;bind()}
function bind(){
 document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>setPage(b.dataset.nav));
 document.querySelectorAll('[data-place]').forEach(b=>b.onclick=()=>setPage('detail',placeById(b.dataset.place)));
 document.querySelectorAll('[data-curation]').forEach(b=>b.onclick=()=>setPage('curationDetail',curations.find(c=>c.curation_id===b.dataset.curation)));
 document.querySelectorAll('[data-back]').forEach(b=>b.onclick=()=>setPage(b.dataset.back));
 document.querySelectorAll('[data-region]').forEach(b=>b.onclick=()=>{state.region=b.dataset.region;render()});
 document.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{state.category=b.dataset.category;render()});
 const free=$('[data-free]');if(free)free.onclick=()=>{state.freeOnly=!state.freeOnly;render()};
 const tonight=$('[data-tonight]');if(tonight)tonight.onclick=()=>{state.region='서울';setPage('map')};
 document.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>{const q=b.dataset.quick;state.region='서울';setPage('map');if(q==='free')state.freeOnly=true;else state.category=q;render()});
 document.querySelectorAll('[data-save]').forEach(b=>b.onclick=()=>{const id=b.dataset.save;store.saved.has(id)?store.saved.delete(id):store.saved.add(id);store.sync();render()});
 document.querySelectorAll('[data-visit]').forEach(b=>b.onclick=()=>{const id=b.dataset.visit;store.visited[id]=(store.visited[id]||0)+1;store.sync();render()});
 const cm=$('[data-curation-map]');if(cm)cm.onclick=()=>{state.region='서울';setPage('map')};
}
const dlg=$('#searchDialog'),input=$('#searchInput'),results=$('#searchResults');
$('#searchBtn').onclick=()=>{dlg.showModal();input.focus();showSearch('')};input.oninput=()=>showSearch(input.value);
function showSearch(q){const t=q.trim().toLowerCase();const found=places.filter(p=>!t||[p.name_kr,p.name_en,p.district,p.primary_category,p.short_description].some(v=>String(v||'').toLowerCase().includes(t))).slice(0,30);results.innerHTML=found.map(p=>listCard(p)).join('');results.querySelectorAll('[data-place]').forEach(b=>b.onclick=()=>{dlg.close();setPage('detail',placeById(b.dataset.place))})}
render();
if('serviceWorker'in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('sw.js').catch(()=>{});
