/* Estudio Creativo — service worker. Lo genera build.py: no lo edites a mano. */
const VERSION = "1.1";
const PREFIX = "estudio-app-";
const CACHE = PREFIX + VERSION;
const SHELL = [
 "./",
 "./index.html",
 "./hub.css",
 "./hub.js",
 "./apps.json",
 "./imagenes.json",
 "./manifest.webmanifest",
 "./fondo-base.svg",
 "./icon-192.png",
 "./icon-512.png",
 "./icon-maskable-512.png",
 "./apple-touch-icon.png",
 "./imagenes/fondo-web.jpg"
];
const SOLO_MIOS = true;
// build: d6d9535bea51

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
