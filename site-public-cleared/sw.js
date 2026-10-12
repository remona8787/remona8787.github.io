const CACHE='aol-v0133-20261012-1';
const ASSETS=['./index.html','./styles.css','./app.js','./core.js','./catalog.js','./account.js','./assets/cloud.js','./assets/native.js','./assets/symbol.svg','./assets/seed.js','./assets/reviewed-media.js','./config.js','./manifest.webmanifest','./assets/icon-192.png','./assets/icon-512.png'];
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
 if(!ASSETS.includes('./'+relative))return;
 event.respondWith(caches.match(req).then(hit=>hit||fetch(req)));
});
