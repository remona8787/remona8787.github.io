// The UI language (site-public-cleared/i18n.js): every key the app uses exists in both languages, placeholders match,
// and every screen the language switch covers renders in English without Korean interface text (the data itself,
// such as Korean names, descriptions and addresses, is removed before the check). docs/ARCHIVE_APP.md lists the
// screens that stay Korean.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const L=require('../site-public-cleared/i18n.js'),C=require('../site-public-cleared/core.js');
const dir=__dirname+'/../site-public-cleared/';
const app=fs.readFileSync(dir+'app.js','utf8'),shell=fs.readFileSync(dir+'index.html','utf8');
// Strings that exist only for English readers (the Korean UI needs no such note).
const EN_ONLY=new Set(['settings.koreanPages','my.koreanOnly']);
// Labels written in the language they switch to (the top-bar toggle reads 「한국어로 보기」 in English mode, carrying lang="ko").
const TARGET_LANG=new Set(['shell.langAria']);
test('every key the app uses exists, in both languages, with the same placeholders',()=>{
 const used=new Set([...app.matchAll(/\bt\('([a-z][a-zA-Z0-9_.]*)'/g),...shell.matchAll(/data-i18n(?:-aria)?="([a-z][a-zA-Z0-9_.]*)"/g)].map(m=>m[1]).filter(k=>!k.endsWith('.')));
 const missing=[...used].filter(k=>!(k in L.strings));assert.deepEqual(missing,[]);
 for(const [k,[ko,en]] of Object.entries(L.strings)){
  assert.ok(en&&en.trim(),'English missing: '+k);if(!EN_ONLY.has(k))assert.ok(ko&&ko.trim(),'Korean missing: '+k);
  const vars=v=>[...String(v).matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort().join();if(!EN_ONLY.has(k))assert.equal(vars(ko),vars(en),'placeholders differ: '+k);
  assert.ok(!/[가-힣]/.test(en)||TARGET_LANG.has(k),'Korean in the English text: '+k);
 }
 assert.equal(L.t('en','shell.langAria'),'한국어로 보기');assert.equal(L.t('ko','shell.langAria'),'Show in English');
 assert.equal(L.t('en','filter.show',{n:3}),'Show 3 results');assert.equal(L.t('ko','filter.show',{n:3}),'3개 결과 보기');assert.equal(L.t('en','nope.key'),'nope.key');
});
function boot(){
 const nodes=new Map(),events={},saved={};
 class Node{constructor(){this.innerHTML='';this.textContent='';this.dataset={};this.classList={add(){},remove(){},toggle(){}};this.open=false;this.isConnected=true}focus(){}querySelector(){return new Node()}querySelectorAll(){return []}showModal(){this.open=true}close(){this.open=false}setAttribute(){}}
 const base=['#view','#navigation','#networkStatus','#quickSearch','#modal','#toast','#appBarTitle'];base.forEach(k=>nodes.set(k,new Node()));
 const document={title:'',documentElement:{lang:'ko',dataset:{},setAttribute(){},toggleAttribute(){}},querySelector(s){if(base.includes(s))return nodes.get(s);return null},querySelectorAll(){return []},addEventListener(k,f){events[k]=f},createElement(){return {click(){},remove(){}}},body:{appendChild(){}}};
 const ctx={window:null,document,navigator:{onLine:true},location:{hash:'',protocol:'https:',href:'https://example.com/'},localStorage:{getItem:k=>saved[k]??null,setItem:(k,v)=>saved[k]=v},setTimeout(){return 1},clearTimeout(){},URL,Blob,Intl,Date,TextEncoder,console,crypto:require('node:crypto').webcrypto,addEventListener(){},scrollTo(){},AOLCore:C,AOL_CONFIG:{PUBLIC_URL:'https://light.example.org'}};ctx.window=ctx;vm.createContext(ctx);
 for(const f of ['assets/seed.js','archive-taxonomy.js','i18n.js','catalog.js','app.js'])vm.runInContext(fs.readFileSync(dir+f,'utf8'),ctx,{filename:f});
 return {ctx,nodes,events,document,eval:s=>vm.runInContext(s,ctx)};
}
test('the covered screens render fully in English; <html lang> follows; the choice persists',async()=>{
 const t=boot();const {fromArchiveRows}=await import('../client/archive-rows.mjs');const {ARCHIVE_ROWS}=await import('./fixtures/archive-app-rows.mjs');
 const a=fromArchiveRows(ARCHIVE_ROWS,{publicURL:'https://light.example.org'});t.ctx.AOL_ARCHIVE={status:'ok',projects:a.projects,fetchedAt:'2026-10-18T00:00:00.000Z'};t.ctx.AOL_ARCHIVE_MEDIA=a.media;
 t.ctx.AOL_GLOBAL={status:'partial',fetchedAt:'2026-10-18T00:00:00.000Z',branches:[{id:'world:genres',ok:false,error:'HTTP 500'}],places:[{place_id:'WD-Q7937834',name_kr:'비비드 시드니',name_en:'Vivid Sydney',short_description:'빛 축제',primary_category:'Festival',categories:['Festival'],country:'오스트레일리아',country_qid:'Q408',city:'시드니',latitude:-33.8688,longitude:151.2093,coordinate_review_status:'source',coordinate_source:'wikidata',coordinate_source_url:'https://www.wikidata.org/wiki/Q7937834',image:'Vivid.jpg',website:'https://www.vividsydney.com/',wikidata:'Q7937834',origin:'wikidata-sync',source_url:'https://www.wikidata.org/wiki/Q7937834',source_publisher:'Wikidata',sitelinks:25,scope:'world',branches:['world:seeds'],year_completed:2009,country_iso2:'AU',credits:[],field_status:{}}]};
 t.ctx.AOLGlobal={curatedMatch:()=>false,wantImages(){},imageStatus:()=>({state:'pending',reasons:[]})};
 t.eval("db.saved=['SEOUL001','AR-crown-fountain'];db.candidates=[];db.routes=[{id:'r1',name:'Route',date:'',note:'',stops:['SEOUL001']}]");
 t.events.click({target:{closest:s=>s==='button'?{dataset:{langSet:'en'},disabled:false}:null}});
 assert.equal(t.eval('uiLang()'),'en');assert.equal(t.document.documentElement.lang,'en');
 assert.equal(JSON.parse(t.ctx.localStorage.getItem(C.KEY)).preferences.language,'en','kept with the user’s records');
 // Every string value of the data (Korean names, descriptions, addresses, curation texts) is data, not UI.
 const data=new Set();const walk=v=>{if(typeof v==='string'){if(/[가-힣]/.test(v))data.add(v)}else if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')Object.values(v).forEach(walk)};
 walk(t.ctx.AOL_SEED);walk(a.projects);walk(t.ctx.AOL_GLOBAL.places);
 // A language option names itself in its own language and says so with lang="ko" (「한국어」 in the language switch).
 const strip=html=>{let h=html.replace(/<(\w+)\b[^>]*\blang="ko"[^>]*>[^<]*<\/\1>/g,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>');for(const d of [...data].sort((x,y)=>y.length-x.length))h=h.split(d).join(' ');return h};
 for(const page of ['home','explore','map','saved','my','settings','data','place/SEOUL001','place/SEOUL007','place/AR-ars-electronica-center','place/AR-al-bahr-towers','place/WD-Q7937834']){
  t.ctx.location.hash='#'+page;t.eval('render()');
  const text=strip(t.nodes.get('#view').innerHTML+' '+t.nodes.get('#navigation').innerHTML),korean=(text.match(/[^\s]*[가-힣][^\s]*/g)||[]);
  assert.deepEqual(korean,[],page+': Korean interface text in English mode');
  if(page==='settings')assert.match(t.nodes.get('#view').innerHTML,/<button[^>]*lang="ko"[^>]*data-lang-set="ko">한국어<\/button>/,'the Korean option is marked lang="ko"');
 }
 t.eval("savedTab='routes'");t.ctx.location.hash='#saved';t.eval('render()');assert.ok(!/[가-힣]/.test(strip(t.nodes.get('#view').innerHTML)),'saved courses tab');
 // Back to Korean.
 t.events.click({target:{closest:s=>s==='button'?{dataset:{langToggle:''},disabled:false}:null}});
 assert.equal(t.eval('uiLang()'),'ko');assert.equal(t.document.documentElement.lang,'ko');
});
