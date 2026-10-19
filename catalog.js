(function(root,factory){const a=factory(root);if(typeof module==='object'&&module.exports)module.exports=a;else root.AOLCatalog=a})(typeof globalThis!=='undefined'?globalThis:this,function(root){
'use strict';
// Shared archive vocabularies (archive-taxonomy.js): a global in the browser, a module in Node.
const T=root&&root.AOLTaxonomy||(typeof require==='function'?require('./archive-taxonomy.js'):null);
// [key, label, icon]: the icon is a Phosphor icon name from scripts/icons.mjs.
const categories=[['Media Facade','미디어파사드','buildings'],['Light Art','라이트아트','sparkle'],['Media Art','미디어아트','monitor-play'],['Architectural Lighting','건축조명','lightbulb-filament'],['Nightscape','야간경관','moon-stars'],['Public Art','공공미술','shapes'],['Exhibition','전시·페스티벌','frame-corners'],['Festival','빛 축제','confetti'],['Global','글로벌 프로젝트','globe-hemisphere-east']];
const text=v=>String(v||'').normalize('NFKC').toLocaleLowerCase();
// Korean and English names of cities that media facade projects are often filed under, for search and for showing a
// city in the current language. The Korean name is the key (the curated catalogue's own form); other cities keep the
// name their source gives.
const CITIES=[['서울','Seoul'],['부산','Busan'],['인천','Incheon'],['대구','Daegu'],['대전','Daejeon'],['광주','Gwangju'],['울산','Ulsan'],['세종','Sejong'],['수원','Suwon'],['진주시','Jinju'],['제주시','Jeju City'],['도쿄','Tokyo'],['오사카','Osaka'],['교토','Kyoto'],['나고야','Nagoya'],['고베','Kobe'],['베이징','Beijing'],['상하이','Shanghai'],['선전','Shenzhen'],['광저우','Guangzhou'],['홍콩','Hong Kong'],['마카오','Macau'],['타이베이','Taipei'],['싱가포르','Singapore'],['방콕','Bangkok'],['쿠알라룸푸르','Kuala Lumpur'],['자카르타','Jakarta'],['마닐라','Manila'],['하노이','Hanoi'],['호찌민','Ho Chi Minh City'],['뭄바이','Mumbai'],['델리','Delhi'],['알마티','Almaty'],['타슈켄트','Tashkent'],['두바이','Dubai'],['아부다비','Abu Dhabi'],['도하','Doha'],['리야드','Riyadh'],['이스탄불','Istanbul'],['텔아비브','Tel Aviv'],['런던','London'],['파리','Paris'],['리옹','Lyon'],['베를린','Berlin'],['뮌헨','Munich'],['함부르크','Hamburg'],['레버쿠젠','Leverkusen'],['그라츠','Graz'],['린츠','Linz'],['빈','Vienna'],['암스테르담','Amsterdam'],['로테르담','Rotterdam'],['브뤼셀','Brussels'],['바르셀로나','Barcelona'],['마드리드','Madrid'],['리스본','Lisbon'],['밀라노','Milan'],['로마','Rome'],['취리히','Zurich'],['코펜하겐','Copenhagen'],['스톡홀름','Stockholm'],['오슬로','Oslo'],['헬싱키','Helsinki'],['바르샤바','Warsaw'],['프라하','Prague'],['부다페스트','Budapest'],['모스크바','Moscow'],['뉴욕','New York'],['로스앤젤레스','Los Angeles'],['라스베이거스','Las Vegas'],['시카고','Chicago'],['샌프란시스코','San Francisco'],['토론토','Toronto'],['몬트리올','Montreal'],['멕시코시티','Mexico City'],['상파울루','São Paulo'],['리우데자네이루','Rio de Janeiro'],['부에노스아이레스','Buenos Aires'],['산티아고','Santiago'],['보고타','Bogotá'],['시드니','Sydney'],['멜버른','Melbourne'],['오클랜드','Auckland'],['요하네스버그','Johannesburg'],['케이프타운','Cape Town'],['카이로','Cairo'],['나이로비','Nairobi'],['라고스','Lagos']];
const cityByName=new Map();for(const [ko,en] of CITIES){cityByName.set(text(ko),ko);cityByName.set(text(en),ko)}
function cityKey(name){const n=String(name||'').trim();return cityByName.get(text(n))||n}
function cityLabel(key,lang){const c=CITIES.find(x=>x[0]===key);return c?(lang==='en'?c[1]:c[0]):String(key||'')}
// Country names to ISO codes (both languages), for places whose source gives only a name (curated rows, v0.15 caches).
let isoNames=null;
function isoOfName(name){if(!name||!T)return null;if(!isoNames){isoNames=new Map();for(const c of Object.keys(T.regionByIso))for(const l of ['ko','en']){const n=T.countryName(c,l);if(n&&n!==c)isoNames.set(text(n),c)}for(const [n,c] of [['한국','KR'],['대한민국','KR'],['korea','KR'],['republic of korea','KR'],['미국','US'],['영국','GB'],['홍콩','HK']])isoNames.set(text(n),c)}return isoNames.get(text(name))||null}
function isoOf(p){const c=p.country_iso2;if(typeof c==='string'&&/^[A-Z]{2}$/.test(c))return c;if(/^SEOUL\d+$/.test(p.place_id||''))return 'KR';return isoOfName(p.country||p.country_name)}
function region(p){const iso=isoOf(p),country=p.country||p.country_name||(/^SEOUL\d+$/.test(p.place_id)?'대한민국':iso&&T?T.countryName(iso,'ko'):''),city=p.city||(/^SEOUL\d+$/.test(p.place_id)?'서울':p.district||'');return {country,city,iso,countryKey:iso||country,cityKey:cityKey(city)}}
function regionKey(p){return p.region&&(!T||T.valid('region',p.region))?p.region:T?T.regionOf(isoOf(p)):null}
function countryLabel(key,lang){return /^[A-Z]{2}$/.test(key||'')&&T?T.countryName(key,lang):String(key||'')}
// Project types: the archive's own value, the curated seed's derived one, or for Wikidata items the one their light
// category clearly implies (shown as derived). Other categories imply no type.
const TYPE_OF_CATEGORY={'Media Facade':'media_facade','Light Art':'light_art','Festival':'festival_program','Exhibition':'festival_program'};
function typeOf(p){return p.project_type||(p.origin==='wikidata-sync'?TYPE_OF_CATEGORY[p.primary_category]||null:null)}
function typeDerived(p){return !p.project_type&&!!typeOf(p)}
const asYear=v=>{const n=typeof v==='string'&&/^\d{4}/.test(v)?Number(v.slice(0,4)):v;return Number.isInteger(n)&&n>=1000&&n<=2100?n:null};
// The year a project is filed under: installed, completed, the curated project year, else its programme's start year.
function yearOf(p){return asYear(p.year_installed)??asYear(p.year_completed)??asYear(p.project_year)??(valid(p.program_start)?Number(p.program_start.slice(0,4)):null)}
// Data origin and review, three groups: the editors' curated catalogue, records an editor verified (or a researcher
// assessed), and everything collected automatically that no editor has reviewed yet (archive and Wikidata alike).
function originOf(p){if(p.origin==='archive'){if(p.record_origin==='curated')return 'curated';return ['editor_verified','researcher_assessed'].includes(p.review_status)?'editor_verified':'unreviewed'}if(p.origin==='wikidata'||p.origin==='wikidata-sync')return 'unreviewed';return 'curated'}
const ORIGINS=[['curated','편집부 수록','Curated'],['editor_verified','편집 검수','Editor-verified'],['unreviewed','자동 수집 · 미검수','Auto-collected, unreviewed']];
const listOf=v=>Array.isArray(v)?v:v?[v]:[];
// Facets: multi-select within a facet (any of), all facets together (and).
const FACETS={region:p=>[regionKey(p)],project_type:p=>[typeOf(p)],installation_method:p=>[p.installation_method],technology:p=>Array.isArray(p.technologies)?p.technologies:[],envelope_type:p=>[p.envelope_type],operating_status:p=>[p.operating_status],origin:p=>[originOf(p)]};
const FACET_KEYS=Object.keys(FACETS);
function valid(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s}
function status(p,today){if(p.content_type==='permanent')return 'permanent';if(valid(p.program_end)&&p.program_end<today)return 'ended';if(valid(p.program_start)&&p.program_start>today)return 'upcoming';if(valid(p.program_start)&&valid(p.program_end)&&p.program_start<=today&&p.program_end>=today)return 'ongoing';return 'unknown'}
function available(p,today){return p.operation_verified===true&&valid(p.verified_at)&&p.verified_at<=today&&valid(p.operation_verified_until)&&p.operation_verified_until>=today&&/^https:\/\//.test(p.operation_source_url||'')&&['ongoing','permanent'].includes(status(p,today))}
// Coordinates on the map (one rule for every source, shown in the map legend): editorially verified coordinates
// (curated places, archive coordinates an editor or researcher confirmed) as pins; coordinates a source publishes
// (a Wikidata item, or a source named in the archive record) apart, as circles that name their source. Archive
// coordinates count only at exact or street precision (client/archive-rows.mjs). Always with an https source link.
function wikidataCoords(p){return p.coordinate_source==='wikidata'&&p.coordinate_review_status==='source'}
function sourceCoords(p){return p.coordinate_source==='archive'&&p.coordinate_review_status==='source'}
function mappable(p){return (p.coordinate_review_status==='verified'||wikidataCoords(p)||sourceCoords(p))&&typeof p.latitude==='number'&&typeof p.longitude==='number'&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180&&/^https:\/\//.test(p.coordinate_source_url||'')}
function coordKind(p){return !mappable(p)?null:wikidataCoords(p)?'wikidata':sourceCoords(p)?'source':'verified'}
function names(p){return [p.name_kr,p.name_en,p.name_ko,p.name_original,...(Array.isArray(p.aliases)?p.aliases:[])].filter(Boolean)}
function creditNames(p){return [p.architect,p.artist,p.producer,...(Array.isArray(p.credits)?p.credits.flatMap(c=>[c.name,c.name_en]):[])].filter(Boolean)}
function rank(p,q){q=text(q).trim();if(!q)return 0;const ns=names(p).map(text),name=ns.slice(0,2).join(' ');return (ns.some(n=>n===q)?100:0)+(ns.some(n=>n.startsWith(q))?40:0)+(name.includes(q)?30:ns.some(n=>n.includes(q))?20:0)+(text(p.building_name).includes(q)?15:0)+(creditNames(p).some(n=>text(n).includes(q))?10:0)}
// Thousands of places: build each searchable text once, and only when there is a query. It covers every name and
// alias, credits, the building, the address, the city and the country in Korean and English, and the type labels.
const hayCache=typeof WeakMap==='function'?new WeakMap():null;
function hay(p){let h=hayCache&&hayCache.get(p);if(h===undefined){const r=region(p),type=typeOf(p);h=[...names(p),p.district,p.address,p.short_description,p.summary_en,p.building_name,...creditNames(p),r.country,r.city,cityLabel(r.cityKey,'en'),cityLabel(r.cityKey,'ko'),r.iso&&T?T.countryName(r.iso,'ko'):'',r.iso&&T?T.countryName(r.iso,'en'):'',...(Array.isArray(p.categories)?p.categories.flatMap(k=>[k,(categories.find(c=>c[0]===k)||[])[1]]):[]),type&&T?T.label('project_type',type,'ko')+' '+T.label('project_type',type,'en'):''].map(text).join(' ');if(hayCache)hayCache.set(p,h)}return h}
// One place against the filters. skip leaves one facet out (facet counts show what each option would add).
function match(p,f,today,ctx,words,skip){
 if(p.is_published===false)return false;
 if(words.length){const h=hay(p);if(!words.every(x=>h.includes(x)))return false}
 const r=region(p);
 if(f.category&&f.category!=='전체'&&!(f.category==='Global'?!!r.country&&r.iso!=='KR'&&r.country!=='대한민국':p.primary_category===f.category))return false;
 if(f.district&&f.district!=='전체'&&p.district!==f.district)return false;
 if(f.country&&r.countryKey!==f.country&&r.country!==f.country)return false;
 if(f.city&&r.cityKey!==f.city&&r.city!==f.city)return false;
 if(f.state&&status(p,today)!==f.state)return false;
 if(f.kind&&p.content_type!==f.kind)return false;
 if(f.year&&String(p.project_year||p.program_start?.slice(0,4)||'')!==f.year)return false;
 if(f.free&&p.free!==true)return false;
 if(f.indoor&&p.indoor!==true)return false;
 if(f.saved&&!f.saved.has(p.place_id))return false;
 const from=asYear(f.year_from),to=asYear(f.year_to);
 if(from!==null||to!==null){const y=yearOf(p);if(y===null||from!==null&&y<from||to!==null&&y>to)return false}
 if(f.has_photo&&!(ctx&&ctx.hasPhoto&&ctx.hasPhoto(p)))return false;
 for(const k of FACET_KEYS){if(k===skip)continue;const want=listOf(f[k]);if(want.length&&!FACETS[k](p).some(v=>v&&want.includes(v)))return false}
 return true;
}
const queryWords=f=>{const q=text(f.q).trim();return q?q.split(/\s+/):[]};
const SORTS=['relevance','newest','updated','year_desc','year_asc','name'];
const desc=(a,b)=>a===b?0:!a?1:!b?-1:a<b?1:-1;
function sorter(f,ctx,scores){const s=f.sort,y=p=>yearOf(p),name=p=>ctx&&ctx.name?ctx.name(p):p.name_kr||'',lang=ctx&&ctx.lang==='en'?'en':'ko';
 if(s==='newest')return (a,b)=>desc(String(a.first_collected_at||a.created_at||''),String(b.first_collected_at||b.created_at||''));
 if(s==='updated')return (a,b)=>desc(String(a.updated_at||a.last_collected_at||''),String(b.updated_at||b.last_collected_at||''));
 if(s==='year_desc'||s==='year_asc'){const dir=s==='year_desc'?-1:1;return (a,b)=>{const x=y(a),z=y(b);return x===z?0:x===null?1:z===null?-1:(x-z)*dir}}
 if(s==='name')return (a,b)=>String(name(a)).localeCompare(String(name(b)),lang);
 return (a,b)=>scores.get(b)-scores.get(a)}
function search(places,f={},today,ctx){const words=queryWords(f);const out=places.filter(p=>match(p,f,today,ctx,words));const s=SORTS.includes(f.sort)?f.sort:'relevance';if(s==='relevance'&&!words.length)return out;const scores=new Map(words.length&&s==='relevance'?out.map(p=>[p,rank(p,f.q)]):[]);return out.sort(sorter({...f,sort:s},ctx,scores))}
// Option counts for the filter panel: for each facet, the places matching every other filter, by value; plus the
// countries (and the cities of the chosen country) with every filter but those two. only: just these facets.
function facetCounts(places,f={},today,ctx,only){const words=queryWords(f),out={};for(const k of only||FACET_KEYS){if(!FACETS[k])continue;const c={};for(const p of places)if(match(p,f,today,ctx,words,k))for(const v of FACETS[k](p))if(v)c[v]=(c[v]||0)+1;out[k]=c}
 if(only)return out;
 const loose={...f,country:'',city:''},countries={},cities={};for(const p of places){if(!match(p,loose,today,ctx,words))continue;const r=region(p);if(r.countryKey)countries[r.countryKey]=(countries[r.countryKey]||0)+1;if(r.cityKey&&(!f.country||r.countryKey===f.country||r.country===f.country))cities[r.cityKey]=(cities[r.cityKey]||0)+1}
 out.country=countries;out.city=cities;return out}
function activeFacets(f){return FACET_KEYS.flatMap(k=>listOf(f[k]).map(v=>[k,v]))}
// Similar projects: shared type, installation method, technologies, envelope, region and decade, each with its reason.
// A project needs at least one shared property of the work itself; region or decade alone is not similarity.
const decade=y=>y===null?null:Math.floor(y/10)*10;
function similar(p,places,n=6){const t=typeOf(p),m=p.installation_method,tech=new Set(Array.isArray(p.technologies)?p.technologies:[]),env=p.envelope_type,reg=regionKey(p),dec=decade(yearOf(p)),out=[];
 for(const x of places){if(x===p||x.place_id===p.place_id||x.is_published===false)continue;const why=[];let s=0;
  if(t&&typeOf(x)===t){s+=3;why.push(['type',t])}
  if(m&&x.installation_method===m){s+=2;why.push(['method',m])}
  const shared=(Array.isArray(x.technologies)?x.technologies:[]).filter(v=>tech.has(v));if(shared.length){s+=Math.min(2,shared.length);why.push(['technology',shared])}
  if(env&&x.envelope_type===env){s+=2;why.push(['envelope',env])}
  if(!t&&p.primary_category&&x.primary_category===p.primary_category){s+=2;why.push(['category',p.primary_category])}
  if(!why.length)continue;
  if(reg&&regionKey(x)===reg){s+=1;why.push(['region',reg])}
  const xd=decade(yearOf(x));if(dec!==null&&xd===dec){s+=1;why.push(['decade',dec])}
  if(s>=2)out.push({place:x,score:s,reasons:why})}
 return out.sort((a,b)=>b.score-a.score).slice(0,n)}
// Statistics of a set of places (the research data page): counts per value, largest first; unknown values counted apart.
function tally(places,get){const c=new Map();let unknown=0;for(const p of places){const vs=get(p).filter(v=>v!==null&&v!==undefined&&v!=='');if(!vs.length)unknown++;for(const v of vs)c.set(v,(c.get(v)||0)+1)}return {rows:[...c].sort((a,b)=>b[1]-a[1]||String(a[0]).localeCompare(String(b[0]))),unknown,total:places.length}}
const byKey=t=>({...t,rows:t.rows.sort((a,b)=>a[0]-b[0])});
function stats(places){return {
 region:tally(places,p=>[regionKey(p)]),
 country:tally(places,p=>[region(p).countryKey]),
 decade:byKey(tally(places,p=>[decade(yearOf(p))])),
 year:byKey(tally(places,p=>[yearOf(p)])),
 project_type:tally(places,p=>[typeOf(p)]),
 installation_method:tally(places,p=>[p.installation_method]),
 technology:tally(places,p=>Array.isArray(p.technologies)?p.technologies:[]),
 origin:tally(places,p=>[originOf(p)])
}}
// Research export of a set of places: one flat record per place with provenance (data origin, review, field states,
// sources and their licences), and a data dictionary for every column. Coded columns hold the controlled keys
// (archive-taxonomy.js); the type also comes as a label for people reading the CSV in a spreadsheet.
const EXPORT_FIELDS=[
 ['place_id','string','앱 안의 기록 ID (SEOUL… 편집부 수록, AR-… 아카이브, WD-Q… Wikidata)','Record ID in the app (SEOUL… curated, AR-… archive, WD-Q… Wikidata)'],
 ['name','string','이름(한국어 우선)','Name (Korean first)'],['name_en','string','영문 이름','English name'],['name_original','string','원어 이름','Original-language name'],
 ['project_type','vocab project_type','프로젝트 유형','Project type'],['project_type_label','string','프로젝트 유형 이름','Project type label'],
 ['region','vocab region','권역(국가 코드에서 도출)','Region (derived from the country code)'],['country_iso2','ISO 3166-1 alpha-2','국가 코드','Country code'],['country','string','국가 이름','Country name'],['city','string','도시','City'],
 ['latitude','number','위도(지도 표시 규칙을 통과한 값만)','Latitude (only values that pass the map rule)'],['longitude','number','경도','Longitude'],['coordinate_source','verified | wikidata | source | (빈 값)','좌표 구분: 편집 검증 · Wikidata 등록 · 수집 출처(검증 전)','Coordinate class: editor-verified, Wikidata, collected source (unverified)'],
 ['year','integer','분류 연도(설치, 완공·개시, 프로젝트, 프로그램 시작 연도 중 처음 있는 값)','Filing year (the first known of installed, completed/opened, project, programme start)'],['year_installed','integer','설치 연도','Year installed'],['year_completed','integer','완공·개시 연도','Year completed or opened'],
 ['operating_status','vocab operating_status','운영 상태','Operating status'],['installation_method','vocab installation_method','설치 방식','Installation method'],['envelope_type','vocab envelope_type','건축 외피','Building envelope'],['technologies','vocab technology[] (; 구분)','기술','Technologies (; separated)'],['content_types','vocab content_type[] (; 구분)','콘텐츠 유형','Content types (; separated)'],
 ['building_name','string','건물','Building'],['credits','string (역할: 이름; …)','참여자','Credits (role: name; …)'],
 ['data_origin','curated | editor_verified | unreviewed','데이터 출처·검수 구분','Data origin and review group'],['record_origin','vocab record_origin','기록 출처','Record origin'],['review_status','vocab review_status','검수 상태(아카이브)','Review status (archive)'],['update_status','vocab update_status','갱신 상태','Update status'],
 ['field_states','string (항목=상태; …)','항목별 상태(기록되지 않은 항목은 미확인)','Field states (fields not listed are unverified)'],
 ['first_collected_at','ISO 8601','처음 수집','First collected'],['last_collected_at','ISO 8601','마지막 수집','Last collected'],['last_verified_at','ISO 8601','마지막 검수·확인','Last verified'],
 ['wikidata_qid','string','Wikidata 항목','Wikidata item'],['official_url','URL','공식 웹사이트','Official website'],['source_urls','URL (공백 구분)','출처 링크','Source links (space separated)'],['source_licenses','string (; 구분)','출처별 라이선스','Licence per source'],['record_url','URL','앱의 기록 주소','Record URL in the app']
];
function exportRows(places,ctx={}){const lang=ctx.lang==='en'?'en':'ko',lab=(n,k)=>k&&T?T.label(n,k,lang)||k:'';return places.map(p=>{const r=region(p),type=typeOf(p),fs=Object.assign({},p.field_status||{});if(typeDerived(p))fs.project_type={state:'derived'};const src=Array.isArray(p.sources)?p.sources:[],urls=[...new Set([...src.map(s=>s.url),p.source_url,p.verification_source_1,p.verification_source_2].filter(u=>/^https?:\/\//.test(u||'')))],kind=coordKind(p),synced=p.origin==='wikidata-sync';
 return {place_id:p.place_id,name:p.name_kr||'',name_en:p.name_en||'',name_original:p.name_original||'',project_type:type||'',project_type_label:lab('project_type',type),region:regionKey(p)||'',country_iso2:r.iso||'',country:r.iso&&T?T.countryName(r.iso,lang):r.country||'',city:cityLabel(r.cityKey,lang)||'',latitude:kind?p.latitude:'',longitude:kind?p.longitude:'',coordinate_source:kind||'',year:yearOf(p)??'',year_installed:asYear(p.year_installed)??'',year_completed:asYear(p.year_completed)??'',operating_status:p.operating_status||'',installation_method:p.installation_method||'',envelope_type:p.envelope_type||'',technologies:(p.technologies||[]).join('; '),content_types:(p.content_types||[]).join('; '),building_name:p.building_name||'',credits:(Array.isArray(p.credits)?p.credits:[]).map(c=>c.role+': '+c.name).join('; '),data_origin:originOf(p),record_origin:p.record_origin||(p.origin===undefined||p.origin===null?'curated':synced?'auto_collected':''),review_status:p.review_status||'',update_status:p.update_status||'',field_states:Object.entries(fs).map(([k,v])=>k+'='+v.state).join('; '),first_collected_at:p.first_collected_at||'',last_collected_at:p.last_collected_at||(synced&&ctx.syncedAt?ctx.syncedAt:''),last_verified_at:p.last_verified_at||(!p.origin&&valid(p.verified_at)?p.verified_at:''),wikidata_qid:p.wikidata||'',official_url:p.official_url||(/^https?:/.test(p.website||'')?p.website:''),source_urls:urls.join(' '),source_licenses:[...new Set([...src.map(s=>s.license).filter(Boolean),...(synced||p.wikidata?['Wikidata: CC0 1.0']:[])])].join('; '),record_url:ctx.recordURL?ctx.recordURL(p):''}})}
const WARNING={ko:'주의: 자동 수집·자동 분류된 값은 검증된 사실이 아닙니다. 항목별 상태(field_states)와 출처를 함께 확인하세요.',en:'Note: values that were collected or classified automatically are not verified facts. Check field_states and the sources.'};
// CSV for spreadsheets: UTF-8 with a BOM (Excel), CRLF, every cell quoted, formula-like cells defused. The first line
// is the warning as a comment line ("# …": pandas read_csv(comment='#'), R read.csv(comment.char='#')).
function exportCSV(places,ctx={}){const rows=exportRows(places,ctx),cols=EXPORT_FIELDS.map(f=>f[0]),cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';return '﻿# '+WARNING[ctx.lang==='en'?'en':'ko'].replace(/[",\r\n]/g,' ')+'\r\n'+[cols.map(cell).join(','),...rows.map(r=>cols.map(c=>cell(r[c])).join(','))].join('\r\n')+'\r\n'}
function dictionary(lang){return EXPORT_FIELDS.map(([field,type,ko,en])=>({field,type,description:lang==='en'?en:ko}))}
function exportJSON(places,ctx={}){const lang=ctx.lang==='en'?'en':'ko';return {meta:{title:'빛의 건축 아카이브 · Architecture of Light archive',generated_at:ctx.now||new Date().toISOString(),app_version:ctx.version||'',count:places.length,filters:ctx.filters||{},warning:WARNING[lang],licenses:{wikidata:'CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/)',commons:lang==='en'?'Wikimedia Commons images: per file (follow the licence and attribution on each file page); no images are included in this file':'Wikimedia Commons 이미지: 파일마다 다름 (각 파일 페이지의 라이선스와 저작자 표시를 따름) · 이 파일에는 이미지가 들어 있지 않음',editorial:lang==='en'?'Editorial text and classifications: licence to be confirmed by the operator (운영자 확정 필요)':'편집부 텍스트·분류: 운영자 확정 필요',sources:lang==='en'?'Source links point to the original publications; their rights stay with each publisher':'출처 링크는 원문을 가리키며, 원문의 권리는 각 발행처에 있음'},citation:ctx.citation||'',data_dictionary:dictionary(lang),field_states:T?T.vocab.field_state.map(([k,ko,en])=>({state:k,label:lang==='en'?en:ko})):[]},projects:exportRows(places,ctx)}}
return {categories,region,regionKey,isoOf,isoOfName,countryLabel,cityKey,cityLabel,typeOf,typeDerived,yearOf,originOf,ORIGINS,FACET_KEYS,facetCounts,activeFacets,status,available,mappable,wikidataCoords,sourceCoords,coordKind,search,valid,similar,stats,exportRows,exportCSV,exportJSON,EXPORT_FIELDS,WARNING,SORTS,names};
});
