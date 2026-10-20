/* Pure domain functions. Shared by the browser and node:test. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AOLCore=api})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const VERSION=1,KEY='aol11_workspace';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
function safeURL(value){try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}}
function today(now=new Date()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)}
function validDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s}
function days(a,b){return Math.floor((Date.parse(b)-Date.parse(a))/86400000)}
function freshness(p,date=today()){
 const checked=p.verified_at,age=validDate(checked)?days(checked,date):null,ttl=Number(p.refresh_days)||30;
 if(p.origin==='wikidata')return {key:'unverified',label:'검색 후보 · 미검토',tone:'warn',age:null};
 if(p.origin==='wikidata-sync')return {key:'synced',label:'Wikidata 공동 편집 데이터',tone:'info',age:null};
 // Archive projects: the editor's review state first; a broken official link is said before anything else.
 if(p.origin==='archive'){if(p.update_status==='link_broken')return {key:'archive_link_broken',label:'링크 오류 · 확인 중',tone:'warn',age:null};if(p.review_status==='researcher_assessed')return {key:'archive_assessed',label:'연구자 평가',tone:'ok',age:null};if(p.review_status==='editor_verified')return {key:'archive_verified',label:'편집 검수',tone:'ok',age:null};if(p.record_origin==='curated')return {key:'archive_curated',label:'편집부 수록',tone:'ok',age:null};return {key:'archive_unreviewed',label:'자동 수집 · 미검수',tone:'warn',age:null}}
 if(validDate(p.program_end)&&p.program_end<date)return {key:'ended',label:'수록 프로그램 종료',tone:'off',age};
 if(validDate(p.program_start)&&p.program_start>date)return {key:'upcoming',label:'수록 일정상 예정',tone:'info',age};
 if(/ENDED|BETWEEN/.test(p.live_operation_state||''))return {key:'ended',label:'수록 프로그램 종료',tone:'off',age};
 if(age===null||age<0)return {key:'unverified',label:'확인일 검토 필요',tone:'warn',age};
 if(age>=ttl)return {key:'stale',label:'재확인 시점 경과',tone:'warn',age};
 if(/PARTIAL|NEEDS|CONFLICT/.test(p.audit_status||''))return {key:'review',label:'추가 확인 필요',tone:'warn',age};
 return {key:'recorded',label:'확인 기록 있음',tone:'ok',age};
}
// Commons thumbnails come in standard widths only (https://www.mediawiki.org/wiki/Common_thumbnail_sizes); a request for
// any other width may be refused. A srcset uses those widths, never wider than the original (or, when its width is not
// known, than the thumbnail the source gave). Returns null for anything that is not a Commons file URL.
const THUMB_WIDTHS=[330,500,960,1280,1920],COMMONS=/^https:\/\/(upload|thumb)\.wikimedia\.org\/wikipedia\/([a-z-]+)\/(?:thumb\/)?([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+)(?:\/(\d+)px-[^/?#]+)?$/;
function commonsSrcset(url,width=null,max=1920){const m=COMMONS.exec(String(url||''));if(!m)return null;const [,host,wiki,a,ab,file]=m;if(!/\.(jpe?g|png|webp|gif)$/i.test(file))return null;const base=`https://${host}.wikimedia.org/wikipedia/${wiki}/thumb/${a}/${ab}/${file}/`,cap=width?Math.min(max,width-1):m[6]?Math.min(max,Number(m[6])):Math.min(max,960),widths=THUMB_WIDTHS.filter(w=>w<=cap);if(!widths.length)return null;return {src:base+widths[Math.min(1,widths.length-1)]+'px-'+file,srcset:widths.map(w=>base+w+'px-'+file+' '+w+'w').join(', ')}}
function coords(p){const a=p.latitude,b=p.longitude;return typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=90&&Math.abs(b)<=180?[a,b]:null}
function filterPlaces(ps,f={}){const q=(f.q||'').normalize('NFKC').toLowerCase().trim();return ps.filter(p=>(!q||[p.name_kr,p.name_en,p.district,p.address,p.short_description].some(x=>String(x||'').normalize('NFKC').toLowerCase().includes(q)))&&(!f.category||f.category==='전체'||p.primary_category===f.category)&&(!f.district||f.district==='전체'||p.district===f.district)&&(!f.free||p.free===true)&&(!f.indoor||p.indoor===true)&&(!f.saved||f.saved.has(p.place_id))&&(!f.upcoming||freshness(p).key==='upcoming'))}
function empty(){return {schema:VERSION,saved:[],visits:[],routes:[],candidates:[],legacyVisits:{},preferences:{}}}
// A project of the media facade archive (origin 'archive', AR-<slug>) that the user saved, planned or recorded: the
// fields needed to show it while the archive list is not available (offline, expired cache). Keys are checked for
// shape only (labels come from the taxonomy when shown); links must be https and coordinates valid.
const ARCHIVE_ID=/^AR-[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/,KEY_RE=/^[a-z][a-z0-9_]{0,39}$/;
function archiveRecord(c){
 if(!checkText(c.name_kr,300)||!c.name_kr.trim()||!checkText(c.short_description||'',2000))return null;
 const t=(v,n)=>checkText(v,n)?v:'',k=v=>typeof v==='string'&&KEY_RE.test(v)?v:null,yr=v=>Number.isInteger(v)&&v>=1000&&v<=2100?v:null,https=v=>/^https:/.test(safeURL(v))?safeURL(v):'';
 const a={place_id:c.place_id,origin:'archive',archive_slug:c.place_id.slice(3),name_kr:c.name_kr,name_en:t(c.name_en,300),name_original:t(c.name_original,300)||null,short_description:c.short_description||'',primary_category:typeof c.primary_category==='string'&&/^[A-Za-z ]{1,40}$/.test(c.primary_category)?c.primary_category:null,project_type:k(c.project_type),region:k(c.region),country_iso2:typeof c.country_iso2==='string'&&/^[A-Z]{2}$/.test(c.country_iso2)?c.country_iso2:null,country:t(c.country,120),city:t(c.city,120),district:t(c.district,120),year_installed:yr(c.year_installed),year_completed:yr(c.year_completed),record_origin:k(c.record_origin),review_status:k(c.review_status)||'unreviewed',website:https(c.website),source_url:https(c.source_url),scope:c.scope==='korea'?'korea':'world',latitude:null,longitude:null};
 if(c.latitude!=null||c.longitude!=null){if(!coords(c))return null;const src=https(c.coordinate_source_url);if(src&&['verified','source'].includes(c.coordinate_review_status))Object.assign(a,{latitude:c.latitude,longitude:c.longitude,coordinate_review_status:c.coordinate_review_status,coordinate_source:'archive',coordinate_source_url:src})}
 return a;
}
function id(){return typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}
function checkText(v,max=4000){return typeof v==='string'&&v.length<=max}
function validate(data,knownIds=[]){
 if(!data||data.schema!==VERSION)throw Error('지원하지 않는 백업 형식입니다.');
 for(const k of ['saved','visits','routes','candidates'])if(!Array.isArray(data[k])||data[k].length>5000)throw Error('백업 목록 형식 또는 크기가 잘못되었습니다.');
 const out=empty(),known=new Set(knownIds);
 const seenCandidates=new Set();
 for(const c of data.candidates){
  if(c&&ARCHIVE_ID.test(c.place_id||'')&&c.origin==='archive'&&!seenCandidates.has(c.place_id)){const a=archiveRecord(c);if(!a)throw Error('아카이브 프로젝트 데이터가 잘못되었습니다.');seenCandidates.add(a.place_id);known.add(a.place_id);out.candidates.push(a);continue}
  if(!c||!/^WD-Q\d+$/.test(c.place_id)||seenCandidates.has(c.place_id)||!checkText(c.name_kr,300)||!checkText(c.short_description||'',2000))throw Error('세계 장소 데이터가 잘못되었습니다.');
  if((c.latitude!=null||c.longitude!=null)&&!coords(c))throw Error('좌표가 잘못되었습니다.');
  seenCandidates.add(c.place_id);known.add(c.place_id);
  const base={place_id:c.place_id,name_kr:c.name_kr,name_en:checkText(c.name_en,300)?c.name_en:'',short_description:c.short_description||'',origin:'wikidata',primary_category:'Global',district:'세계 검색',latitude:c.latitude??null,longitude:c.longitude??null,website:safeURL(c.website),source_url:'https://www.wikidata.org/wiki/'+c.place_id.slice(3),verified_at:validDate(c.verified_at)?c.verified_at:'',image:checkText(c.image,1000)?c.image:''};
  // A place from the 6-hourly Wikidata sync that the user saved, planned or recorded: keep what is needed to show it
  // when the sync result is not available (offline, expired cache). Source URLs are rebuilt from the QID, never trusted.
  if(c.origin==='wikidata-sync'){const kind=k=>typeof k==='string'&&/^[A-Za-z ]{1,40}$/.test(k),qid=c.place_id.slice(3),text=(v,n)=>checkText(v,n)?v:'';Object.assign(base,{origin:'wikidata-sync',primary_category:kind(c.primary_category)?c.primary_category:'Global',categories:Array.isArray(c.categories)?c.categories.filter(kind).slice(0,8):[],district:text(c.district,120),country:text(c.country,120),city:text(c.city,120),city_qid:/^Q\d+$/.test(c.city_qid||'')?c.city_qid:'',scope:c.scope==='korea'?'korea':'world',wikidata:qid,source_publisher:'Wikidata',sitelinks:Number.isInteger(c.sitelinks)&&c.sitelinks>=0?c.sitelinks:0,website:/^https:/.test(base.website)?base.website:''});if(coords(c))Object.assign(base,{coordinate_review_status:'source',coordinate_source:'wikidata',coordinate_source_url:base.source_url})}
  out.candidates.push(base);
 }
 out.saved=[...new Set(data.saved.filter(x=>known.has(x)))];
 const seenVisits=new Set(),seenRoutes=new Set();
 for(const v of data.visits){
  if(!v||!checkText(v.id,100)||!v.id||seenVisits.has(v.id)||!known.has(v.placeId)||!validDate(v.date)||!checkText(v.note)||!Number.isInteger(v.rating)||v.rating<0||v.rating>5)throw Error('방문 기록이 잘못되었습니다.');
  seenVisits.add(v.id);out.visits.push({id:v.id,placeId:v.placeId,date:v.date,note:v.note,rating:v.rating});
 }
 for(const r of data.routes){
  if(!r||!checkText(r.id,100)||!r.id||seenRoutes.has(r.id)||!checkText(r.name,120)||!r.name.trim()||!Array.isArray(r.stops)||r.stops.length>50||r.stops.some(x=>!known.has(x))||!checkText(r.note||'',2000)||r.date&&!validDate(r.date))throw Error('답사 코스가 잘못되었습니다.');
  seenRoutes.add(r.id);out.routes.push({id:r.id,name:r.name,date:r.date||'',note:r.note||'',stops:[...new Set(r.stops)]});
 }
 for(const [k,v] of Object.entries(data.legacyVisits||{}))if(known.has(k)&&Number.isInteger(v)&&v>0&&v<100000)out.legacyVisits[k]=v;
 out.preferences={theme:["system","light","dark"].includes(data.preferences?.theme)?data.preferences.theme:"system",language:data.preferences?.language==="en"?"en":"ko"};
 return out;
}
function read(storage,knownIds){
 try{const raw=storage.getItem(KEY);if(raw)return {data:validate(JSON.parse(raw),knownIds),warning:''};
 const d=empty(),old=JSON.parse(storage.getItem('aol3_saved')||'[]'),vis=JSON.parse(storage.getItem('aol3_visited')||'{}');d.saved=Array.isArray(old)?old.filter(x=>knownIds.includes(x)):[];d.legacyVisits=vis;
 return {data:validate(d,knownIds),warning:''};
 }catch{return {data:empty(),warning:'저장 데이터를 읽지 못했습니다. 기존 데이터는 덮어쓰지 않습니다. 백업을 복원하거나 기록 초기화를 선택하세요.',blocked:true}}
}
function write(storage,data){try{storage.setItem(KEY,JSON.stringify(data));return true}catch{return false}}
function csv(rows){const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';return '\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')}
function ics(route,lookup){
 if(!validDate(route.date))throw Error('답사 날짜를 먼저 지정하세요.');
 const escape=v=>String(v||'').replaceAll('\\','\\\\').replaceAll('\r','').replaceAll('\n','\\n').replaceAll(',','\\,').replaceAll(';','\\;');
 const date=route.date.replaceAll('-',''),end=new Date(Date.parse(route.date)+86400000).toISOString().slice(0,10).replaceAll('-','');
 const desc=route.stops.map((x,i)=>`${i+1}. ${lookup(x)?.name_kr||x}`).join('\n')+'\n'+route.note;
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Architecture of Light//KO','CALSCALE:GREGORIAN','BEGIN:VEVENT','UID:'+escape(route.id)+'@architecture-of-light','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z/,'Z'),'DTSTART;VALUE=DATE:'+date,'DTEND;VALUE=DATE:'+end,'SUMMARY:'+escape(route.name),'DESCRIPTION:'+escape(desc),'END:VEVENT','END:VCALENDAR'];
 // RFC5545: fold at 75 octets, never split a Unicode code point.
 return lines.map(line=>{let s='',n=0;for(const ch of line){const bytes=new TextEncoder().encode(ch).length;if(n+bytes>75){s+='\r\n ';n=1}s+=ch;n+=bytes}return s}).join('\r\n')+'\r\n';
}
return {VERSION,KEY,esc,safeURL,today,validDate,days,freshness,coords,commonsSrcset,THUMB_WIDTHS,filterPlaces,empty,id,validate,read,write,csv,ics};
});
