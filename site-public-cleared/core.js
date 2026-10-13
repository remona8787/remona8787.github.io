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
 if(validDate(p.program_end)&&p.program_end<date)return {key:'ended',label:'수록 프로그램 종료',tone:'off',age};
 if(validDate(p.program_start)&&p.program_start>date)return {key:'upcoming',label:'수록 일정상 예정',tone:'info',age};
 if(/ENDED|BETWEEN/.test(p.live_operation_state||''))return {key:'ended',label:'수록 프로그램 종료',tone:'off',age};
 if(age===null||age<0)return {key:'unverified',label:'확인일 검토 필요',tone:'warn',age};
 if(age>=ttl)return {key:'stale',label:'재확인 시점 경과',tone:'warn',age};
 if(/PARTIAL|NEEDS|CONFLICT/.test(p.audit_status||''))return {key:'review',label:'추가 확인 필요',tone:'warn',age};
 return {key:'recorded',label:'확인 기록 있음',tone:'ok',age};
}
function coords(p){const a=p.latitude,b=p.longitude;return typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=90&&Math.abs(b)<=180?[a,b]:null}
function filterPlaces(ps,f={}){const q=(f.q||'').normalize('NFKC').toLowerCase().trim();return ps.filter(p=>(!q||[p.name_kr,p.name_en,p.district,p.address,p.short_description].some(x=>String(x||'').normalize('NFKC').toLowerCase().includes(q)))&&(!f.category||f.category==='전체'||p.primary_category===f.category)&&(!f.district||f.district==='전체'||p.district===f.district)&&(!f.free||p.free===true)&&(!f.indoor||p.indoor===true)&&(!f.saved||f.saved.has(p.place_id))&&(!f.upcoming||freshness(p).key==='upcoming'))}
function empty(){return {schema:VERSION,saved:[],visits:[],routes:[],candidates:[],legacyVisits:{},preferences:{}}}
function id(){return typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)}
function checkText(v,max=4000){return typeof v==='string'&&v.length<=max}
function validate(data,knownIds=[]){
 if(!data||data.schema!==VERSION)throw Error('지원하지 않는 백업 형식입니다.');
 for(const k of ['saved','visits','routes','candidates'])if(!Array.isArray(data[k])||data[k].length>5000)throw Error('백업 목록 형식 또는 크기가 잘못되었습니다.');
 const out=empty(),known=new Set(knownIds);
 const seenCandidates=new Set();
 for(const c of data.candidates){
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
 out.preferences={theme:["light","dark"].includes(data.preferences?.theme)?data.preferences.theme:"light",language:data.preferences?.language==="en"?"en":"ko"};
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
return {VERSION,KEY,esc,safeURL,today,validDate,days,freshness,coords,filterPlaces,empty,id,validate,read,write,csv,ics};
});
