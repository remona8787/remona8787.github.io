const CACHE='aol-be9bcd74f1aa';
const ASSETS=['./index.html','./styles.css','./app.js','./core.js','./catalog.js','./account.js','./assets/cloud-boot.js','./assets/cloud.js','./assets/native.js','./assets/symbol.svg','./assets/seed.js','./assets/reviewed-media.js','./assets/media-blocklist.js','./assets/live-media.js','./assets/global-places.js','./assets/archive.js','./assets/dataset.js','./assets/led-facade.js','./archive-taxonomy.js','./i18n.js','./config.js','./manifest.webmanifest','./assets/icon-192.png','./assets/icon-512.png','./assets/symbol-dark.svg','./assets/favicon.svg','./assets/logo-ko-light-compact.svg','./assets/logo-ko-dark-compact.svg','./assets/fonts/pretendard/pretendardvariable-dynamic-subset.css'];
// The static archive dataset (data/, docs/STATIC_ARCHIVE.md "Output") lives in its own cache, stale-while-revalidate:
// a cached copy answers at once and the network refreshes it for next time. client/dataset.js asks for the index and
// the shards with ?v=<build_id>, so a new build is a new address; manifest.json and home.json carry the build_id, and
// when one arrives with a new build_id the entries of other builds are dropped. data/admin/ is never cached.
const DATA='aol-data';
const scopeURL=new URL(self.registration.scope);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('aol-')&&k!==CACHE&&k!==DATA).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
async function prune(cache,build){
 if(typeof build!=='string'||!build)return;
 for(const req of await cache.keys()){const v=new URL(req.url).searchParams.get('v');if(v&&v!==build)await cache.delete(req)}
}
async function data(event,req,url){
 const cache=await caches.open(DATA),hit=await cache.match(req);
 const net=fetch(req).then(async res=>{
  if(res.ok&&/json/i.test(res.headers.get('content-type')||'')){
   await cache.put(req,res.clone());
   if(/\/(manifest|home)\.json$/.test(url.pathname))await prune(cache,(await res.clone().json().catch(()=>null))?.build_id);
  }
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
 if(relative.startsWith('data/')&&relative.endsWith('.json')){event.respondWith(data(event,req,url));return}
 if(req.mode==='navigate'){
  event.respondWith(fetch(req).catch(async()=>{const hit=await caches.match(new URL('index.html',scopeURL).href);return hit||Response.error()}));return;
 }
 // Font chunks (unicode-range subsets) are cached as pages use them, so text keeps its typeface offline.
 if(relative.startsWith('assets/fonts/pretendard/woff2-dynamic-subset/')){
  event.respondWith(caches.open(CACHE).then(cache=>cache.match(req).then(hit=>hit||fetch(req).then(res=>{if(res.ok)cache.put(req,res.clone());return res}))));return;
 }
 if(!ASSETS.includes('./'+relative))return;
 event.respondWith(caches.match(req).then(hit=>hit||fetch(req)));
});
