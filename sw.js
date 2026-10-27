const CACHE='aol-s2-8ebf64f501be';
const ASSETS=['./index.html','./styles.css','./app.js','./core.js','./catalog.js','./account.js','./assets/cloud-boot.js','./assets/cloud.js','./assets/native.js','./assets/symbol.svg','./assets/seed.js','./assets/reviewed-media.js','./assets/media-blocklist.js','./assets/live-media.js','./assets/global-places.js','./assets/archive.js','./assets/dataset.js','./assets/led-facade.js','./archive-taxonomy.js','./i18n.js','./config.js','./manifest.webmanifest','./assets/icon-192.png','./assets/icon-512.png','./assets/symbol-dark.svg','./assets/favicon.svg','./assets/logo-ko-light-compact.svg','./assets/logo-ko-dark-compact.svg','./assets/fonts/pretendard/pretendardvariable-dynamic-subset.css'];
// Updates: a new deploy must reach a visitor on their next load, also while a tab stays open for days. So the worker
// takes over at once (skipWaiting, clients.claim), the shell is network-first (the cache answers offline), and
// manifest.json and home.json, which name the build, are network-first too. Shell caches of this generation start
// with aol-s2-; the cache-first workers of earlier versions (v0.14–v0.18) kept serving their old scripts until every
// tab closed, so when one of their caches is found the open pages are reloaded once.
// The static archive dataset (data/, docs/STATIC_ARCHIVE.md "Output") lives in its own cache. client/dataset.js asks
// for the index and the shards with ?v=<build_id>, so a new build is a new address: those answer from the cache at once
// and the network refreshes them (stale-while-revalidate); when manifest.json or home.json arrives with a new build_id
// the entries of other builds are dropped. data/admin/ is never cached.
const DATA='aol-data';
const scopeURL=new URL(self.registration.scope);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const old=(await caches.keys()).filter(k=>k.startsWith('aol-')&&k!==CACHE&&k!==DATA);
 await Promise.all(old.map(k=>caches.delete(k)));
 await self.clients.claim();
 if(old.some(k=>!k.startsWith('aol-s2-')))for(const c of await self.clients.matchAll({type:'window'}))c.navigate(c.url).catch(()=>{});
})()));
async function prune(cache,build){
 if(typeof build!=='string'||!build)return;
 for(const req of await cache.keys()){const v=new URL(req.url).searchParams.get('v');if(v&&v!==build)await cache.delete(req)}
}
// manifest.json and home.json: network-first, so a page never starts from the previous build.
async function latest(event,req,url){
 const cache=await caches.open(DATA);
 try{
  const res=await fetch(req);
  if(res.ok&&/json/i.test(res.headers.get('content-type')||'')){
   event.waitUntil((async()=>{await cache.put(req,res.clone());await prune(cache,(await res.clone().json().catch(()=>null))?.build_id)})());
  }
  return res;
 }catch(e){const hit=await cache.match(req);if(hit)return hit;throw e}
}
async function data(event,req,url){
 const cache=await caches.open(DATA),hit=await cache.match(req);
 const net=fetch(req).then(async res=>{
  if(res.ok&&/json/i.test(res.headers.get('content-type')||''))await cache.put(req,res.clone());
  return res;
 });
 if(hit){event.waitUntil(net.catch(()=>{}));return hit}
 return net;
}
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==scopeURL.origin||!url.pathname.startsWith(scopeURL.pathname))return;
 const relative=url.pathname.slice(scopeURL.pathname.length);
 // Never cache admin/auth/API responses or external images. Cache the shell only.
 if(relative.startsWith('admin/')||relative.startsWith('api/')||relative.startsWith('auth/')||relative.startsWith('data/admin/'))return;
 // Static project pages (p/, scripts/prerender.mjs) are plain pages: never answered with the app shell.
 if(relative.startsWith('p/'))return;
 if(relative.startsWith('data/')&&relative.endsWith('.json')){event.respondWith(/^data\/(manifest|home)\.json$/.test(relative)?latest(event,req,url):data(event,req,url));return}
 if(req.mode==='navigate'){
  event.respondWith(fetch(req).catch(async()=>{const hit=await caches.match(new URL('index.html',scopeURL).href);return hit||Response.error()}));return;
 }
 // Font chunks (unicode-range subsets) are cached as pages use them, so text keeps its typeface offline.
 if(relative.startsWith('assets/fonts/pretendard/woff2-dynamic-subset/')){
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(req).then(hit=>hit||fetch(req).then(res=>{if(res.ok)cache.put(req,res.clone());return res}))));return;
 }
 if(!ASSETS.includes('./'+relative))return;
 event.respondWith(fetch(req).then(res=>{if(res.ok){const copy=res.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,copy)))}return res}).catch(()=>caches.match(req).then(hit=>hit||Response.error())));
});
