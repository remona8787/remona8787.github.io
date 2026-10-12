const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('client/cloud.js','utf8').replace(/^import .*;\n/gm,'');
const flush=()=>new Promise(r=>setImmediate(r));
function setup({placesError=null,mediaError=null,workspace=null,admin=null}={}){
 let callback,session=null;const switches=[],replacements=[],media=[],channels=[];
 const timers=[];const local=new Map();
 const client={auth:{onAuthStateChange(fn){callback=fn},async getSession(){return {data:{session}}}},
 from(table){const result=table==='user_workspaces'?()=>typeof workspace==='function'?workspace():{data:workspace}:()=>({data:[],error:table==='places'?placesError:table==='public_place_media'?mediaError:null});
 const q={select(){return q},eq(){return q},order(){return q},range(){return Promise.resolve(result())},limit(){return Promise.resolve(result())},maybeSingle(){return Promise.resolve(result())}};return q},
 async rpc(name){return name==='is_app_admin'?(admin?admin():{data:false}):{data:{ok:true,revision:1}}},
 channel(name){channels.push(name);const q={on(){return q},subscribe(fn){if(fn)fn('SUBSCRIBED');return q}};return q},async removeChannel(){}};
 const win={AOL_CONFIG:{SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public'},AOLApp:{switchUser(id){switches.push(id)},replaceCloud(d){replacements.push(d)},getDB(){return {saved:[]}},setCatalog(){},setMedia(m){media.push(m)},render(){},backup(){}},AOLCore:{empty:()=>({})},addEventListener(){},dispatchEvent(){}};
 const ctx=vm.createContext({window:win,createClient:()=>client,photoAPI:()=>({}),localStorage:{getItem:k=>local.get(k)||null,setItem:(k,v)=>local.set(k,v)},document:{hidden:false,addEventListener(){}},setInterval(){},CustomEvent:class {},setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout(){},structuredClone,navigator:{onLine:true},location:{origin:'https://example.com'}});
 vm.runInContext(source,ctx);
 return {win,ctx,client,switches,replacements,media,channels,local,async login(id){callback('SIGNED_IN',{user:{id}});timers.shift()();await flush()},setWorkspace(v){workspace=v}};
}
test('catalog outage does not prevent auth subscription or account switching',async()=>{const t=setup({placesError:{message:'offline'}});await flush();await t.login('alice');assert.equal(t.win.AOLCloud.state.user.id,'alice');assert.equal(t.switches.at(-1),'alice');assert.equal(t.win.AOLCloud.state.catalogError,'offline')});
test('failed media request preserves last successful media',async()=>{const t=setup({mediaError:{message:'offline'}});await flush();assert.equal(t.media.length,0)});
test('stale admin response cannot attach previous user channel',async()=>{let release;let calls=0;const t=setup({admin:()=>++calls===1?new Promise(r=>release=r):{data:false}});await flush();await t.login('alice');await t.login('bob');release({data:true});await flush();assert.equal(t.win.AOLCloud.state.user.id,'bob');assert.equal(t.win.AOLCloud.state.admin,false);assert.ok(!t.channels.includes('workspace-alice'));assert.ok(t.channels.includes('workspace-bob'))});
test('realtime subscription cannot hide a workspace conflict',async()=>{const t=setup({workspace:{revision:2,document:{saved:['server']}}});t.local.set('aol12_sync_alice',JSON.stringify({revision:1,dirty:true}));await flush();await t.login('alice');assert.equal(t.win.AOLCloud.state.status,'conflict');assert.equal(t.replacements.length,0)});
test('conflict resolution cannot apply a response after account switch',async()=>{const t=setup();await flush();await t.login('alice');let release;t.setWorkspace(()=>new Promise(r=>release=r));const pending=t.win.AOLCloud.resolve('remote');t.setWorkspace(null);await t.login('bob');release({data:{revision:2,document:{saved:['alice']}}});await assert.rejects(pending,/계정이 변경/);assert.equal(t.replacements.length,0)});
test('catalog requests are deduplicated',async()=>{const t=setup();await flush();const a=t.win.AOLCloud.catalog(),b=t.win.AOLCloud.catalog();assert.equal(a,b);await a});
test('invalid sync revision blocks syncing instead of overwriting server state',async()=>{const t=setup();await flush();t.local.set('aol12_sync_alice',JSON.stringify({revision:-1,dirty:true}));await t.login('alice');assert.equal(t.win.AOLCloud.state.status,'error');assert.match(t.win.AOLCloud.state.error,/동기화 상태/);assert.ok(!t.channels.includes('workspace-alice'))});
