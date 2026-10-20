// Mock Supabase for the admin console E2E (qa/admin.spec.mjs): Auth (password sign-in, logout), PostgREST RPCs with
// the role checks of ARCHIVE_SPEC §4, the archive_articles table and the Edge Functions. Every request is recorded so
// tests can compare the exact RPC names and parameter objects with the db track. The data includes XSS strings.
import {readFileSync} from 'node:fs';
import {expect} from '@playwright/test';

export const SUPABASE='https://aol-test.supabase.co',KEY='sb_publishable_admin_test',PASSWORD='correct-horse-battery';
export const XSS='<img src=x onerror=alert(1)>',XSS_SCRIPT='<script>alert(2)</script>',XSS_ATTR='"><svg onload=alert(4)>';
const PNG=readFileSync(new URL('../site-public-cleared/assets/icon-192.png',import.meta.url));
export const USERS={
 admin:{id:'00000000-0000-4000-8000-0000000000a1',email:'admin@aol.test',role:'admin'},
 editor:{id:'00000000-0000-4000-8000-0000000000e1',email:'editor@aol.test',role:'editor'},
 researcher:{id:'00000000-0000-4000-8000-0000000000f1',email:'researcher@aol.test',role:'researcher'},
 nobody:{id:'00000000-0000-4000-8000-000000000001',email:'nobody@aol.test',role:null}
};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
export const token=u=>`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:u.id,email:u.email,role:'authenticated',aud:'authenticated',exp:2000000000})}.c2lnbmF0dXJl`;
const userObj=u=>({id:u.id,aud:'authenticated',role:'authenticated',email:u.email,app_metadata:{provider:'email'},user_metadata:{},created_at:'2026-01-01T00:00:00Z'});
const session=u=>({access_token:token(u),token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:'refresh-'+u.id,user:userObj(u)});

const H=3600e3,ago=h=>new Date(Date.now()-h*H).toISOString(),ahead=h=>new Date(Date.now()+h*H).toISOString();
export const ID={
 c1:'c1000000-0000-4000-8000-000000000001',c2:'c1000000-0000-4000-8000-000000000002',c3:'c1000000-0000-4000-8000-000000000003',c4:'c1000000-0000-4000-8000-000000000004',c5:'c1000000-0000-4000-8000-000000000005',
 p1:'a1000000-0000-4000-8000-000000000001',p2:'a1000000-0000-4000-8000-000000000002',p3:'a1000000-0000-4000-8000-000000000003',
 gdelt:'b1000000-0000-4000-8000-000000000001',dezeen:'b1000000-0000-4000-8000-000000000002',archinect:'b1000000-0000-4000-8000-000000000003',naver:'b1000000-0000-4000-8000-000000000004',brave:'b1000000-0000-4000-8000-000000000005',
 u1:'d1000000-0000-4000-8000-000000000001',u2:'d1000000-0000-4000-8000-000000000002',u3:'d1000000-0000-4000-8000-000000000003',
 l1:'e1000000-0000-4000-8000-000000000001',l2:'e1000000-0000-4000-8000-000000000002'
};

// Fresh, mutable data for one test.
export function seed(){
 const candidates=[
  {id:ID.c1,status:'needs_review',label:'facade_project',score:82,confidence:76,classifier_version:'classify-1',
   reasons:['positive "media facade" +30','context "museum" +10','context "relit" +6','location Graz (AT)'],
   detected_name:'BIX Media Facade, Kunsthaus Graz',detected_country_iso2:'AT',detected_city:'Graz',latitude:47.0713,longitude:15.4342,language:'en',
   first_seen_at:ago(50),last_seen_at:ago(3),seen_count:3,matched_project_id:null,duplicate_of:null,reviewed_at:null,review_note:null,
   hits:[{provider:'rss',url:'https://www.dezeen.com/2026/10/10/bix-media-facade-kunsthaus-graz-relit/',canonical_url:'https://dezeen.com/2026/10/10/bix-media-facade-kunsthaus-graz-relit/',title:'BIX media facade at Kunsthaus Graz is relit after restoration',publisher:'Dezeen',published_at:ago(60),excerpt:'The low-resolution light installation on the acrylic skin of the museum shows new commissioned works.'},
         {provider:'gdelt',url:'https://www.designboom.com/architecture/kunsthaus-graz-bix-2026/',canonical_url:'https://designboom.com/architecture/kunsthaus-graz-bix-2026/',title:'Kunsthaus Graz switches its BIX facade back on',publisher:'designboom',published_at:ago(40),excerpt:null}],
   suggested_matches:[{id:ID.p2,name_en:'Kunsthaus Graz BIX',name_original:'Kunsthaus Graz',city:'Graz',country_iso2:'AT',similarity:0.62,reason:'이름 비슷함'}]},
  {id:ID.c2,status:'needs_review',label:'facade_project',score:70,confidence:61,classifier_version:'classify-1',reasons:[XSS],
   detected_name:null,detected_country_iso2:'KR',detected_city:'<i>Seoul</i>',latitude:null,longitude:null,language:'ko',
   first_seen_at:ago(30),last_seen_at:ago(2),seen_count:1,
   hits:[{provider:'gdelt',url:'javascript:alert(1)',canonical_url:'javascript:alert(1)',title:XSS,publisher:XSS_SCRIPT,published_at:ago(30),excerpt:'<b onmouseover=alert(3)>굵게</b> 미디어파사드 기사 요약'}],
   suggested_matches:[{id:ID.p3,name_ko:XSS_ATTR,city:'서울',country_iso2:'KR',similarity:0.5}]},
  {id:ID.c3,status:'uncertain',label:'ad_screen',score:48,confidence:44,classifier_version:'classify-1',reasons:['positive "미디어파사드" +30','negative "임대" -25'],
   detected_name:'강남대로 미디어 전광판 임대',detected_country_iso2:'KR',detected_city:'서울',latitude:null,longitude:null,language:'ko',
   first_seen_at:ago(20),last_seen_at:ago(20),seen_count:1,
   hits:[{provider:'naver_news',url:'https://n.news.naver.com/article/001/0000000001',title:'강남대로 대형 미디어 전광판 임대 모집',publisher:'연합뉴스',published_at:ago(20),excerpt:'광고주 모집 중인 대형 전광판...'}],suggested_matches:[]},
  {id:ID.c4,status:'uncertain',label:'event_program',score:55,confidence:52,classifier_version:'classify-1',reasons:['positive "プロジェクションマッピング" +25','context "festival" +8'],
   detected_name:'東京ライトショー 2026',detected_country_iso2:'JP',detected_city:'東京',latitude:35.68,longitude:139.76,language:'ja',
   first_seen_at:ago(10),last_seen_at:ago(9),seen_count:2,
   hits:[{provider:'gdelt',url:'https://www.example.jp/news/light-show-2026',title:'東京ライトショー、都庁舎にプロジェクションマッピング',publisher:'Example Japan',published_at:ago(10),excerpt:null}],suggested_matches:[]},
  {id:ID.c5,status:'needs_review',label:'facade_project',score:77,confidence:70,classifier_version:'classify-1',reasons:['positive "Medienfassade" +30','context "Bahnhof" +8'],
   detected_name:'Medienfassade am Hauptbahnhof',detected_country_iso2:'DE',detected_city:'Leipzig',latitude:null,longitude:null,language:'de',
   first_seen_at:ago(80),last_seen_at:ago(5),seen_count:4,
   hits:[{provider:'rss',url:'https://www.baunetz.de/meldungen/medienfassade-hauptbahnhof.html',title:'Neue Medienfassade am Leipziger Hauptbahnhof',publisher:'BauNetz',published_at:ago(80),excerpt:'Die LED-Fassade zeigt künstlerische Inhalte.'}],suggested_matches:[]}
 ];
 const p1={id:ID.p1,slug:'galleria-centercity-cheonan',name_original:'갤러리아 센터시티',name_original_lang:'ko',name_ko:'갤러리아 센터시티',name_en:'Galleria Centercity',aliases:['Galleria Centercity Cheonan'],
  country_iso2:'KR',region:'east_asia',city:'천안',district:'서북구',address:'충청남도 천안시 서북구 공원로 227',latitude:36.7987,longitude:127.1047,location_precision:'street',
  year_installed:2010,year_completed:2010,year_operating_since:null,year_ended:null,operating_status:'operating',building_name:'갤러리아 백화점 센터시티',project_type:'media_facade',
  installation_method:'led_backlit_cladding',envelope_type:'glass_curtain_wall',technology:['led_rgb'],display_area_m2:null,resolution_text:null,pixel_pitch_mm:null,content_type:['artwork','advertising'],interactive:false,
  viewing_points:null,spatial_context:['commercial_district'],urban_context:null,summary_ko:'유리 외피 뒤 LED로 낮과 밤의 표정이 바뀌는 백화점 파사드.',summary_en:null,
  wikidata_qid:null,official_url:'https://dept.galleria.co.kr/',record_origin:'curated',review_status:'editor_verified',visibility:'published',update_status:'current',
  field_status:{name_ko:{state:'editor_verified'},city:{state:'source_reported',source_id:'s1'},year_installed:{state:'source_reported',source_id:'s1'},project_type:{state:'derived'},installation_method:{state:'source_reported'}},
  first_collected_at:ago(900),last_collected_at:ago(30),last_verified_at:ago(200),created_at:ago(900),updated_at:ago(30),
  credits:[{role:'architect',name:'UNStudio',name_en:'UNStudio',wikidata_qid:'Q1361437'}],
  sources:[{id:'s1',url:'https://www.unstudio.com/en/page/12081/galleria-centercity',title:'Galleria Centercity',publisher:'UNStudio',source_kind:'official',language:'en',published_at:'2010-12-01',reliability:90,link_state:'ok',license:'저작권 있음(링크만)',supports:['city','year_installed','installation_method']}],
  media:[{id:'m1',url:'https://upload.wikimedia.org/wikipedia/commons/a/ab/Galleria_Centercity.jpg',page_url:'https://commons.wikimedia.org/wiki/File:Galleria_Centercity.jpg',commons_file:'File:Galleria_Centercity.jpg',license:'CC BY-SA 4.0',license_url:'https://creativecommons.org/licenses/by-sa/4.0/',author:'Kim Photographer',attribution:'Kim Photographer · CC BY-SA 4.0 · Wikimedia Commons',rights_status:'cleared',is_primary:true,link_state:'ok'},
         {id:'m2',url:'https://example.org/press/galleria.jpg',page_url:'https://example.org/press',commons_file:null,license:null,license_url:null,author:null,attribution:null,rights_status:'pending',is_primary:false,link_state:'unknown'}]};
 const p2={id:ID.p2,slug:'kunsthaus-graz-bix',name_original:'Kunsthaus Graz',name_original_lang:'de',name_ko:null,name_en:'Kunsthaus Graz BIX',aliases:null,country_iso2:'AT',region:'europe',city:'Graz',
  year_installed:2003,project_type:'media_facade',installation_method:'led_linear_pixel',record_origin:'auto_collected',review_status:'unreviewed',visibility:'draft',update_status:'new_info',
  field_status:{name_en:{state:'source_reported'},year_installed:{state:'source_reported'},project_type:{state:'derived'}},first_collected_at:ago(100),last_collected_at:ago(9),updated_at:ago(9),
  credits:[{role:'architect',name:'Peter Cook, Colin Fournier'},{role:'media_artist',name:'realities:united'}],sources:[],media:[]};
 const p3={id:ID.p3,slug:'xss-test',name_ko:XSS_ATTR,name_en:null,name_original:null,country_iso2:'KR',region:'east_asia',city:'서울',official_url:'javascript:alert(5)',record_origin:'auto_collected',review_status:'unreviewed',visibility:'hidden',update_status:'link_broken',
  field_status:{},updated_at:ago(4),credits:[],media:[],
  sources:[{id:'s3',url:'javascript:alert(6)',title:XSS,publisher:XSS_SCRIPT,source_kind:'news',language:'ko',reliability:25,link_state:'broken',license:null,supports:[]}]};
 const rules=[
  {id:ID.gdelt,kind:'gdelt',name:'GDELT · media facade (en)',query:'"media facade" OR "media façade"',url:null,language:'en',region_hint:null,enabled:true,cadence_hours:6,next_run_at:ahead(2),last_run_at:ago(4),last_status:'success',failure_count:0,backoff_until:null,terms_url:'https://www.gdeltproject.org/about.html#termsofuse',verified_at:null,notes:null},
  {id:ID.dezeen,kind:'rss',name:'Dezeen RSS',query:null,url:'https://www.dezeen.com/feed/',language:'en',region_hint:null,enabled:true,cadence_hours:6,next_run_at:ahead(3),last_run_at:ago(3),last_status:'partial',failure_count:0,backoff_until:null,terms_url:'https://www.dezeen.com/terms-conditions/',verified_at:null,notes:null},
  {id:ID.archinect,kind:'rss',name:'Archinect RSS',query:null,url:'https://archinect.com/feed/1/news',language:'en',region_hint:null,enabled:true,cadence_hours:6,next_run_at:ahead(4),last_run_at:ago(1),last_status:'error',failure_count:3,backoff_until:ahead(4),terms_url:null,verified_at:null,notes:XSS},
  {id:ID.naver,kind:'naver_news',name:'네이버 뉴스 · 미디어파사드',query:'미디어파사드',url:null,language:'ko',region_hint:'KR',enabled:false,cadence_hours:6,next_run_at:null,last_run_at:null,last_status:null,failure_count:0,backoff_until:null,terms_url:'https://www.ncloud.com/policy/terms/service',verified_at:null,notes:'키를 넣으면 켜요.'},
  {id:ID.brave,kind:'brave',name:'Brave · media facade',query:'media facade building',url:null,language:'en',region_hint:null,enabled:false,cadence_hours:24,next_run_at:null,last_run_at:null,last_status:null,failure_count:0,backoff_until:null,terms_url:null,verified_at:null,notes:null}
 ];
 const run=(id,rule_id,status,h,counts)=>({id,rule_id,trigger:'cron',status,started_at:ago(h),finished_at:status==='running'?null:new Date(Date.now()-h*H+42e3).toISOString(),attempt:1,fetched:0,kept:0,new_candidates:0,matched_projects:0,duplicates:0,ignored:0,errors:0,...counts});
 return {
  candidates,projects:[p1,p2,p3],rules,
  runs:[run('r-1',ID.archinect,'error',1,{errors:1}),run('r-2',ID.dezeen,'partial',3,{fetched:40,kept:6,new_candidates:2,matched_projects:1,duplicates:1,ignored:2,errors:1}),run('r-3',ID.gdelt,'success',4,{fetched:75,kept:12,new_candidates:3,matched_projects:2,duplicates:4,ignored:3,trigger:'admin'}),run('r-4',ID.gdelt,'running',0.01,{})],
  errors:[{run_id:'r-1',rule_id:ID.archinect,at:ago(1),stage:'fetch',http_status:503,message:'Service Unavailable '+XSS,url:'https://archinect.com/feed/1/news'},{run_id:'r-2',rule_id:ID.dezeen,at:ago(3),stage:'parse',http_status:null,message:'Unexpected token < in item 12',url:'javascript:alert(7)'}],
  keywords:[{id:'k1',term:'media facade',language:'en',polarity:'positive',weight:30,enabled:true},{id:'k2',term:'미디어파사드',language:'ko',polarity:'positive',weight:30,enabled:true},{id:'k3',term:'building',language:'en',polarity:'context',weight:8,enabled:true},{id:'k4',term:'임대',language:'ko',polarity:'negative',weight:25,enabled:true},{id:'k5',term:XSS,language:'en',polarity:'negative',weight:5,enabled:false}],
  updates:[{id:ID.u1,project_id:ID.p1,project_name:'갤러리아 센터시티',kind:'new_source',status:'open',created_at:ago(6),detail:{sources:[{url:'https://www.archdaily.com/1000000/galleria-centercity-revisited',title:'Galleria Centercity revisited',publisher:'ArchDaily'}]}},
           {id:ID.u2,project_id:ID.p3,project_name:XSS_ATTR,kind:'link_broken',status:'open',created_at:ago(5),detail:{url:'javascript:alert(8)',http_status:404,consecutive_failures:3}},
           {id:ID.u3,project_id:ID.p2,project_name:'Kunsthaus Graz BIX',kind:'wikidata_changed',status:'open',created_at:ago(2),detail:{changes:[{field:'year_installed',old:2003,new:2004}]}}],
  dashboard:{queue:{needs_review:3,uncertain:2,auto_ignored:41},runs_24h:{total:12,success:9,partial:2,error:1},runs_7d:{total:80,success:70,partial:6,error:4},errors:3,
   sources_by_status:{ok:120,unknown:30,redirect:6,broken:4},projects_by_visibility:{published:52,draft:11,hidden:3},projects_by_review:{editor_verified:40,unreviewed:24,researcher_assessed:2},open_updates:3,broken_links:4,
   settings:{auto_list_structured:true,auto_ignore_below:35,review_threshold:60}},
  search:[{...p1,sources:p1.sources.map(({id,source_kind,...s})=>({...s,kind:source_kind})),media:[p1.media[0]],assessments:[{attribute:'project_type',value:'media_facade',confidence:'high',method:'문헌 검토',note:'UNStudio 작품 설명',created_at:ago(100)}]}],
  legacy:{stats:{total:10,ready:3,draft:4,published:2,rejected:1,high_relevance:5,duplicates:1},
   candidates:[{id:ID.l1,name:'Seoullo Media Canvas',name_local:'서울로 미디어캔버스',city_code:'SEOUL',candidate_type:'media_facade',primary_provider:'wikidata',external_primary_id:'Q100000',relevance_score:82,confidence_score:70,publishing_status:'ready',lat:37.556,lng:126.972,address_text:'서울 중구',website_url:'https://seoullo7017.co.kr/',duplicate_cluster_id:null,source_metadata:{label:'Seoullo'}},
               {id:ID.l2,name:XSS,name_local:XSS_SCRIPT,city_code:'SEOUL',candidate_type:'light_art',primary_provider:'osm',external_primary_id:'node/1',relevance_score:55,confidence_score:40,publishing_status:'draft',lat:null,lng:null,address_text:null,website_url:'javascript:alert(9)',duplicate_cluster_id:null,source_metadata:{note:XSS}}],
   jobs:[{id:'j1',job_name:'discover-seoul',status:'success',fetched_count:100,inserted_count:10,flagged_count:2,created_at:ago(7)}]}
 };
}

const ADMIN_ONLY=new Set(['archive_admin_upsert_rule','archive_admin_upsert_keyword','archive_admin_delete_keyword','archive_admin_set_settings']);
const ANY_ROLE=new Set(['archive_role','archive_search','archive_research_add_assessment']);
const LEGACY=new Set(['admin_candidate_stats','admin_list_candidates','admin_update_candidate','admin_promote_candidate','admin_list_ingestion_jobs']);
const now=()=>new Date().toISOString();
const findP=(d,id)=>d.projects.find(p=>p.id===id);
const RPC={
 archive_role:(d,b,u)=>u?.role??null,
 archive_admin_dashboard:d=>d.dashboard,
 archive_admin_list_candidates:(d,b)=>{
  let list=d.candidates.filter(c=>b.p_status?c.status===b.p_status:['needs_review','uncertain'].includes(c.status)).filter(c=>(c.confidence||0)>=(b.p_min_conf||0));
  if(b.p_q){const q=b.p_q.toLowerCase();list=list.filter(c=>JSON.stringify([c.detected_name,c.detected_city,c.hits.map(h=>h.title)]).toLowerCase().includes(q))}
  return list.sort((a,x)=>x.confidence-a.confidence).slice(b.p_offset||0,(b.p_offset||0)+(b.p_limit||50));
 },
 archive_admin_review_candidate:(d,b)=>{
  const c=d.candidates.find(x=>x.id===b.p_id);if(!c)throw {status:400,body:{code:'P0002',message:'candidate_not_found'}};
  if(b.p_action==='reject'&&!b.p_payload?.note)throw {status:400,body:{code:'22023',message:'note_required'}};
  c.status={approve_new:'approved',attach:'approved',merge:'merged',reject:'rejected',ignore:'auto_ignored',reopen:'needs_review'}[b.p_action];
  c.reviewed_at=now();c.review_note=b.p_payload?.note||null;
  return {id:c.id,status:c.status,...(b.p_action==='approve_new'?{project_id:'a1000000-0000-4000-8000-0000000000ff'}:{})};
 },
 archive_admin_list_projects:(d,b)=>{
  let list=d.projects.filter(p=>!b.p_visibility||p.visibility===b.p_visibility);
  if(b.p_q){const q=b.p_q.toLowerCase();list=list.filter(p=>[p.name_ko,p.name_en,p.name_original,p.city,p.building_name].some(x=>String(x||'').toLowerCase().includes(q)))}
  return list.slice(b.p_offset||0,(b.p_offset||0)+(b.p_limit||50));
 },
 archive_admin_upsert_project:(d,b)=>{
  const x=b.p_project;
  if(x.id){const p=findP(d,x.id);p.field_status={...p.field_status};for(const [k,v] of Object.entries(x)){if(k==='id')continue;p[k]=v;if(k==='credits')continue;if(v==null)delete p.field_status[k];else p.field_status[k]={state:'editor_verified',at:now()}}p.updated_at=now();return p.id}
  const id='a1000000-0000-4000-8000-0000000000aa';
  d.projects.unshift({id,visibility:'draft',review_status:'editor_verified',record_origin:'editor_created',update_status:'current',credits:[],sources:[],media:[],...x,field_status:Object.fromEntries(Object.keys(x).filter(k=>k!=='credits').map(k=>[k,{state:'editor_verified'}]))});
  return id;
 },
 archive_admin_set_visibility:(d,b)=>{findP(d,b.p_project_id).visibility=b.p_visibility;return null},
 archive_admin_merge_projects:(d,b)=>{const keep=findP(d,b.p_keep),drop=findP(d,b.p_drop);keep.sources=[...keep.sources,...drop.sources];drop.visibility='hidden';return keep.id},
 archive_admin_add_source:(d,b)=>{const id='s-new';findP(d,b.p_project_id).sources.push({id,...b.p_source,supports:b.p_supports,reliability:70,link_state:'unknown'});return id},
 archive_admin_remove_source:(d,b)=>{const p=findP(d,b.p_project_id);p.sources=p.sources.filter(s=>s.id!==b.p_source_id);return null},
 archive_admin_set_media:(d,b)=>{const p=findP(d,b.p_project_id),m=b.p_media;if(m.is_primary)p.media.forEach(x=>x.is_primary=false);const old=p.media.find(x=>x.id===m.id);if(old){Object.assign(old,m);return old.id}p.media.push({id:'m-new',link_state:'unknown',...m});return 'm-new'},
 archive_admin_remove_media:(d,b)=>{for(const p of d.projects)p.media=p.media.filter(m=>m.id!==b.p_media_id);return null},
 archive_admin_list_updates:(d,b)=>d.updates.filter(u=>!b.p_status||u.status===b.p_status).slice(0,b.p_limit||100),
 archive_admin_resolve_update:(d,b)=>{const u=d.updates.find(x=>x.id===b.p_id);u.status=b.p_action==='apply'?'applied':'dismissed';u.resolved_at=now();return null},
 archive_admin_list_runs:(d,b)=>d.runs.filter(r=>!b.p_rule_id||r.rule_id===b.p_rule_id).slice(0,b.p_limit||50),
 archive_admin_list_errors:(d,b)=>d.errors.slice(0,b.p_limit||50),
 archive_admin_list_rules:d=>d.rules,
 archive_admin_upsert_rule:(d,b)=>{const r=b.p_rule,old=d.rules.find(x=>x.id===r.id);if(old){Object.assign(old,r);return old.id}const id='b1000000-0000-4000-8000-0000000000aa';d.rules.push({id,failure_count:0,...r});return id},
 archive_admin_list_keywords:d=>d.keywords,
 archive_admin_upsert_keyword:(d,b)=>{const k=b.p_kw,old=d.keywords.find(x=>x.id===k.id||(x.term===k.term&&x.language===k.language));if(old)Object.assign(old,k);else d.keywords.push({id:'k-new',...k});return null},
 archive_admin_delete_keyword:(d,b)=>{d.keywords=d.keywords.filter(k=>!(k.term===b.p_term&&(k.language??null)===b.p_language));return null},
 archive_admin_set_settings:(d,b)=>{d.dashboard.settings={...b.p_settings};return null},
 archive_search:(d,b)=>d.search.filter(p=>!b.p_q||[p.name_ko,p.name_en,p.city].some(x=>String(x||'').includes(b.p_q))),
 archive_research_add_assessment:()=>'f1000000-0000-4000-8000-000000000001',
 admin_candidate_stats:d=>d.legacy.stats,
 admin_list_candidates:d=>d.legacy.candidates,
 admin_update_candidate:(d,b)=>({id:b.p_candidate_id,publishing_status:b.p_action==='reject'?'rejected':'ready'}),
 admin_promote_candidate:()=>'0d000000-0000-4000-8000-000000000001',
 admin_list_ingestion_jobs:d=>d.legacy.jobs
};
const FN={
 'archive-collect':(d,b)=>({ok:true,rules:(b.rule_ids||[]).length||b.max_rules,runs:(b.rule_ids||[ID.gdelt]).map(rule_id=>({rule_id,status:'success',fetched:25,new_candidates:2,matched_projects:1,errors:0}))}),
 'admin-discovery-command':()=>({ok:true,result:{fetched:42}})
};
const CORS={'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,x-client-info,prefer,accept-profile,content-profile,x-supabase-api-version,x-retry-count','access-control-expose-headers':'content-range'};

// Installs the admin test config, the mock backend and an image stub (every other outside request is refused).
// fail: {rpcOrFunctionName: {status, body}} makes that call fail.
export async function mockSupabase(page,{fail={},data=seed()}={}){
 const calls=[],byToken=new Map(Object.values(USERS).map(u=>[token(u),u]));
 await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/,r=>r.request().resourceType()==='image'?r.fulfill({contentType:'image/png',body:PNG}):r.abort('blockedbyclient'));
 await page.route('**/admin/config.js',r=>r.fulfill({contentType:'text/javascript',body:`window.AOL_ADMIN_CONFIG={SUPABASE_URL:${JSON.stringify(SUPABASE)},SUPABASE_PUBLISHABLE_KEY:${JSON.stringify(KEY)}};`}));
 await page.route(SUPABASE+'/**',async r=>{
  const req=r.request(),url=new URL(req.url()),headers=req.headers();
  if(req.method()==='OPTIONS')return r.fulfill({status:204,headers:CORS});
  let body=null;try{body=req.postData()?JSON.parse(req.postData()):null}catch{}
  const user=byToken.get(String(headers.authorization||'').replace(/^Bearer /i,''));
  const reply=(status,json)=>r.fulfill({status,headers:{...CORS,'content-type':'application/json'},body:JSON.stringify(json??null)});
  const path=url.pathname;
  if(path==='/auth/v1/token'){
   calls.push({kind:'auth',name:'token',body});
   const u=Object.values(USERS).find(x=>x.email===body?.email);
   return !u||body.password!==PASSWORD?reply(400,{code:400,error_code:'invalid_credentials',msg:'Invalid login credentials'}):reply(200,session(u));
  }
  if(path==='/auth/v1/logout'){calls.push({kind:'auth',name:'logout'});return r.fulfill({status:204,headers:CORS})}
  if(path==='/auth/v1/user')return user?reply(200,userObj(user)):reply(401,{msg:'invalid JWT'});
  const rpc=path.match(/^\/rest\/v1\/rpc\/(\w+)$/),fn=path.match(/^\/functions\/v1\/([\w-]+)$/);
  if(rpc||fn){
   const name=(rpc||fn)[1];
   calls.push({kind:rpc?'rpc':'fn',name,body,authorization:headers.authorization||null,apikey:headers.apikey||null});
   if(fail[name])return reply(fail[name].status||400,fail[name].body||{code:'XX000',message:'boom'});
   const role=user?.role;
   if(!ANY_ROLE.has(name)&&(rpc||name==='archive-collect')){
    if(!role||(ADMIN_ONLY.has(name)?role!=='admin':!['admin','editor'].includes(role)))return reply(403,{code:'42501',message:ADMIN_ONLY.has(name)?'admin_required':'editor_required'});
   }
   if(LEGACY.has(name)&&!['admin','editor'].includes(role))return reply(400,{code:'P0001',message:'admin_required'});
   const h=rpc?RPC[name]:FN[name];
   if(!h)return reply(404,rpc?{code:'PGRST202',message:`Could not find the function public.${name} in the schema cache`}:{error:'not found'});
   try{return reply(200,h(data,body||{},user))}catch(e){return reply(e.status||500,e.body||{message:String(e)})}
  }
  if(path==='/rest/v1/archive_articles'){calls.push({kind:'rest',name:'archive_articles',method:req.method(),body});return r.fulfill({status:201,headers:CORS,body:''})}
  return reply(404,{message:'not mocked: '+path});
 });
 const rpcs=name=>calls.filter(c=>c.kind==='rpc'&&c.name===name);
 return {calls,data,rpcs,last:name=>rpcs(name).at(-1)};
}

export async function signIn(page,role='admin',hash=''){
 await page.goto('/admin/'+hash);
 await page.getByLabel('이메일').fill(USERS[role].email);
 await page.getByLabel('비밀번호').fill(PASSWORD);
 await page.getByRole('button',{name:'로그인'}).click();
 await expect(page.locator('#nav')).toBeVisible();
}
export const TAB_LABELS={dashboard:'대시보드',queue:'검수 대기열',projects:'프로젝트',updates:'변경 감지',runs:'수집 작업',rules:'수집 규칙·키워드',settings:'설정',research:'연구자 평가',magazine:'매거진',places:'장소 후보'};
// An element that exists once a tab has rendered its data (networkidle does not wait for in-page tab switches).
export const READY={dashboard:'#dashRuns table',queue:'#queueList .qitem',projects:'#projectList .pitem',updates:'#updateList .update',runs:'#errorList li',rules:'#kwTable table',settings:'#settingsBox form',research:'#researchList .pitem',magazine:'#articleForm',places:'#legacyJobs table'};
export const TABS_BY_ROLE={
 admin:['dashboard','queue','projects','updates','runs','rules','settings','research','magazine','places'],
 editor:['dashboard','queue','projects','updates','runs','rules','research','magazine','places'],
 researcher:['research']
};
