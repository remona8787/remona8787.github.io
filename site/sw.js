const C='aol-v08-review';const A=['./','./index.html','./styles.css','./app.js','./assets/seed.js','./config.js','./manifest.webmanifest','./assets/icon-192.png','./assets/icon-512.png','./privacy.html','./about.html'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(A))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin===location.origin)e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});
