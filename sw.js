const C='poolcam-v4.5-calibration-safe';
const A=['./','./index.html','./styles.css','./camera.js','./calibration.js','./rules.js','./decision.js','./vision.js','./motion-worker.js','./app.js','./manifest.webmanifest','./calibration-test.html','./camera-test.html'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(A)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).then(r=>{const x=r.clone();caches.open(C).then(c=>c.put(e.request,x));return r}).catch(()=>caches.match(e.request)));return;}
  e.respondWith(fetch(e.request).then(r=>{if(r.ok||r.type==='opaque'){const x=r.clone();caches.open(C).then(c=>c.put(e.request,x)).catch(()=>{})}return r}).catch(()=>caches.match(e.request)));
});
