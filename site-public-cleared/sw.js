const CACHE='aol-v0140-20261012-1';
const ASSETS=['./index.html','./styles.css','./app.js','./core.js','./catalog.js','./account.js','./assets/cloud.js','./assets/native.js','./assets/symbol.svg','./assets/seed.js','./assets/reviewed-media.js','./assets/media-blocklist.js','./assets/live-media.js','./assets/global-places.js','./assets/archive.js','./archive-taxonomy.js','./i18n.js','./config.js','./manifest.webmanifest','./assets/icon-192.png','./assets/icon-512.png','./assets/symbol-dark.svg','./assets/favicon.svg','./assets/logo-ko-light-compact.svg','./assets/logo-ko-dark-compact.svg','./assets/fonts/pretendard/pretendardvariable-dynamic-subset.css'];
const scopeURL=new URL(self.registration.scope);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('aol-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==scopeURL.origin||!url.pathname.startsWith(scopeURL.pathname))return;
 const relative=url.pathname.slice(scopeURL.pathname.length);
 // Never cache admin/auth/API responses or external images. Cache the shell only.
 if(relative.startsWith('admin/')||relative.startsWith('api/')||relative.startsWith('auth/'))return;
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
