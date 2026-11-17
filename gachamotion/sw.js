/* GachaMotion Studio — service worker. Lo genera build.py: no lo edites a mano. */
const VERSION = "0.4";
const PREFIX = "gachamotion-app-";
const CACHE = PREFIX + VERSION;
const SHELL = [
 "./",
 "./editors/animation/app.css",
 "./editors/animation/app.js",
 "./editors/animation/index.html",
 "./editors/dibujo/app.css",
 "./editors/dibujo/app.js",
 "./editors/dibujo/index.html",
 "./icono-192.png",
 "./icono-512.png",
 "./index.html",
 "./shared/actualizar.js",
 "./shared/base.css",
 "./shared/bridge.js",
 "./shared/ui.js"
];
const SOLO_MIOS = false;
// build: b4ab3391a9f8

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'})));
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'skip') self.skipWaiting(); });

// Todo sale de la copia guardada de esta versión (así nunca se mezclan archivos de dos versiones).
// Las versiones nuevas llegan por el aviso «Actualizar».
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const base = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(base)) return;
  const rel = url.pathname.slice(base.length);
  if (rel.endsWith('version.json') || rel === 'sw.js') return;
  const clave = rel === '' ? './' : './' + rel;
  if (SOLO_MIOS && rel !== '' && !SHELL.includes(clave)) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = (await c.match(req, {ignoreSearch: true})) || (rel === '' || rel.endsWith('/') ? await c.match('./index.html') : null);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    } catch (err) {
      return Response.error();
    }
  })());
});
