"""Construye el Estudio Creativo y GachaMotion para publicarlos (GitHub Pages).

Uso:  py -3.12 build.py

  1. Lee la versión más reciente de cambios.json (Estudio) y de gachamotion/cambios.json.
  2. Escribe sw.js y version.json de cada uno, y pone la versión en index.html.
  3. Prepara las imágenes: imagenes/fondo.* y imagenes/logo.* (cualquier tamaño) → versiones ligeras.
  4. Dibuja los iconos (de tu logo, si lo pones).

Para publicar una novedad: añade una entrada ARRIBA en cambios.json (o en gachamotion/cambios.json),
ejecuta este script y sube con publicar.py.  Las apps instaladas avisan solas.
"""
import hashlib
import json
import pathlib
import re
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent
IM = ROOT / 'imagenes'


def leer_cambios(carpeta):
    c = json.loads((carpeta / 'cambios.json').read_text(encoding='utf-8'))
    return c[0]


def escribir_version(carpeta, ult):
    (carpeta / 'version.json').write_text(
        json.dumps({'version': ult['version'], 'fecha': ult.get('fecha'), 'notas': ult.get('notas', [])}, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8')


def hash_archivos(carpeta, rels):
    h = hashlib.sha256()
    for r in sorted(rels):
        h.update(r.encode())
        h.update((carpeta / r).read_bytes())
    return h.hexdigest()[:12]


SW = '''/* {titulo} — service worker. Lo genera build.py: no lo edites a mano. */
const VERSION = {version};
const PREFIX = {prefix};
const CACHE = PREFIX + VERSION;
const SHELL = {shell};
const SOLO_MIOS = {solo_mios};
// build: {huella}

self.addEventListener('install', e => {{
  e.waitUntil((async () => {{
    const c = await caches.open(CACHE);
    await c.addAll(SHELL.map(u => new Request(u, {{cache: 'reload'}})));
  }})());
}});

self.addEventListener('activate', e => {{
  e.waitUntil((async () => {{
    for (const k of await caches.keys()) if (k.startsWith(PREFIX) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  }})());
}});

self.addEventListener('message', e => {{ if (e.data === 'skip') self.skipWaiting(); }});

// Todo sale de la copia guardada de esta versión (así nunca se mezclan archivos de dos versiones).
// Las versiones nuevas llegan por el aviso «Actualizar».
self.addEventListener('fetch', e => {{
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
  e.respondWith((async () => {{
    const c = await caches.open(CACHE);
    const hit = (await c.match(req, {{ignoreSearch: true}})) || (rel === '' || rel.endsWith('/') ? await c.match('./index.html') : null);
    if (hit) return hit;
    try {{
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }} catch (err) {{
      return Response.error();
    }}
  }})());
}});
'''


def escribir_sw(carpeta, titulo, prefix, version, shell, solo_mios):
    huella = hash_archivos(carpeta, [s[2:] for s in shell if s != './'] )
    (carpeta / 'sw.js').write_text(SW.format(
        titulo=titulo, version=json.dumps(version), prefix=json.dumps(prefix), shell=json.dumps(shell, indent=1),
        solo_mios='true' if solo_mios else 'false', huella=huella), encoding='utf-8')


def imagenes():
    """imagenes/fondo.* y imagenes/logo.* → versiones ligeras + imagenes.json"""
    out = {'fondo': None, 'logo': None}
    for ext in ('jpg', 'jpeg', 'png', 'webp'):
        p = IM / f'fondo.{ext}'
        if p.exists() and not out['fondo']:
            im = Image.open(p).convert('RGB')
            im.thumbnail((2200, 2200), Image.LANCZOS)
            im.save(IM / 'fondo-web.jpg', quality=84, optimize=True, progressive=True)
            out['fondo'] = 'imagenes/fondo-web.jpg'
        p = IM / f'logo.{ext}'
        if p.exists() and not out['logo']:
            im = Image.open(p).convert('RGBA')
            w, h = im.size
            s = min(w, h)
            im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s)).resize((512, 512), Image.LANCZOS)
            im.save(IM / 'logo-web.png', optimize=True)
            out['logo'] = 'imagenes/logo-web.png'
    (ROOT / 'imagenes.json').write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8')
    return out


def icono_gacha(carpeta):
    """Icono de GachaMotion: morado→rosa con un personajillo sonriente y «GM»."""
    def dib(n):
        g = Image.new('RGB', (n, n))
        d = ImageDraw.Draw(g)
        a, b = (122, 92, 255), (255, 79, 160)
        for y in range(n):
            t = y / (n - 1)
            d.line([(0, y), (n, y)], fill=tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)))
        d.ellipse([n * .22, n * .16, n * .78, n * .72], fill=(255, 226, 205))          # cara
        d.pieslice([n * .18, n * .10, n * .82, n * .56], 180, 360, fill=(86, 54, 150))   # flequillo
        for x in (.38, .62):
            d.ellipse([n * x - n * .045, n * .40 - n * .06, n * x + n * .045, n * .40 + n * .06], fill=(40, 40, 80))
        d.arc([n * .40, n * .46, n * .60, n * .60], 20, 160, fill=(190, 80, 110), width=max(2, n // 60))
        try:
            f = ImageFont.truetype('arialbd.ttf', int(n * .2))
        except OSError:
            f = ImageFont.load_default()
        d.text((n / 2, n * .86), 'GM', font=f, fill=(255, 255, 255), anchor='mm')
        return g
    for nombre, n in (('icono-192.png', 192), ('icono-512.png', 512)):
        g = dib(n * 2).resize((n, n), Image.LANCZOS)
        m = Image.new('L', (n, n), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * .22), fill=255)
        r = g.convert('RGBA')
        r.putalpha(m)
        r.save(carpeta / nombre)


def construir_gacha():
    g = ROOT / 'gachamotion'
    if not (g / 'cambios.json').exists():
        return None
    ult = leer_cambios(g)
    if not (g / 'icono-192.png').exists():
        icono_gacha(g)
    excluidos = {'sw.js', 'cambios.json', 'version.json'}
    rels = []
    for p in sorted(g.rglob('*')):
        if not p.is_file():
            continue
        r = p.relative_to(g).as_posix()
        if r in excluidos or r.startswith('tests/') or r.endswith(('.txt', '.md', '.bat', '.py')):
            continue
        rels.append(r)
    shell = ['./'] + ['./' + r for r in rels]
    escribir_sw(g, 'GachaMotion Studio', 'gachamotion-app-', ult['version'], shell, False)
    escribir_version(g, ult)
    # versión visible dentro de la app
    idx = g / 'index.html'
    if idx.exists():
        t = idx.read_text(encoding='utf-8')
        t2 = re.sub(r'/\*VER\*/".*?"/\*VER\*/', '/*VER*/' + json.dumps(ult['version']) + '/*VER*/', t)
        if t2 != t:
            idx.write_text(t2, encoding='utf-8')
    return ult['version']


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    ult = leer_cambios(ROOT)
    ver = ult['version']
    out = construir_gacha()
    subprocess.run([sys.executable, str(ROOT / 'iconos.py')], check=True)
    im = imagenes()
    idx = ROOT / 'index.html'
    t = idx.read_text(encoding='utf-8')
    t2 = re.sub(r'/\*VER\*/".*?"/\*VER\*/', '/*VER*/' + json.dumps(ver) + '/*VER*/', t)
    idx.write_text(t2, encoding='utf-8')
    shell = ['./', './index.html', './hub.css', './hub.js', './apps.json', './imagenes.json', './manifest.webmanifest', './fondo-base.svg',
             './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png']
    for k in ('fondo', 'logo'):
        if im[k]:
            shell.append('./' + im[k])
    escribir_sw(ROOT, 'Estudio Creativo', 'estudio-app-', ver, shell, True)
    escribir_version(ROOT, ult)
    print('Estudio', ver, '| GachaMotion', out or '(no está)', '| fondo:', im['fondo'] or 'por defecto', '| logo:', im['logo'] or 'por defecto')


if __name__ == '__main__':
    main()
