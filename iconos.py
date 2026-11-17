"""Crea los iconos del Estudio.

Si existe imagenes/logo.(png|jpg|jpeg|webp), los iconos salen de esa imagen (recortada al centro).
Si no, dibuja un icono rosa con un destello y puntos de colores.
"""
import math
import pathlib
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent
IM = ROOT / 'imagenes'


def buscar(base):
    for ext in ('png', 'jpg', 'jpeg', 'webp'):
        p = IM / f'{base}.{ext}'
        if p.exists():
            return p
    return None


def degradado(n, a, b):
    g = Image.new('RGB', (n, n))
    d = ImageDraw.Draw(g)
    for y in range(n):
        t = y / (n - 1)
        d.line([(0, y), (n, y)], fill=tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)))
    return g


def destello(d, cx, cy, r, fill):
    pts = []
    for i in range(120):
        t = i / 120 * 2 * math.pi
        pts.append((cx + r * math.cos(t) ** 3, cy + r * math.sin(t) ** 3))
    d.polygon(pts, fill=fill)


def dibujar(n=1024, relleno=False):
    img = degradado(n, (255, 150, 200), (255, 79, 154))
    d = ImageDraw.Draw(img)
    destello(d, n * .5, n * .44, n * .27, (255, 255, 255))
    destello(d, n * .78, n * .22, n * .09, (255, 240, 200))
    destello(d, n * .22, n * .66, n * .06, (255, 255, 255))
    colores = [(255, 176, 0), (43, 212, 192), (122, 92, 255), (255, 255, 255)]
    for i, c in enumerate(colores):
        x = n * (.29 + .14 * i)
        r = n * .045
        d.ellipse([x - r, n * .82 - r, x + r, n * .82 + r], fill=c)
    if relleno:
        return img
    # esquinas redondeadas con transparencia
    m = Image.new('L', (n, n), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * .22), fill=255)
    out = img.convert('RGBA')
    out.putalpha(m)
    return out


def desde_logo(p, n, relleno):
    im = Image.open(p).convert('RGB')
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, (h - s) // 2, (w - s) // 2 + s, (h - s) // 2 + s)).resize((n, n), Image.LANCZOS)
    if relleno:
        # zona segura para iconos «maskable»: el dibujo ocupa el 80 % central
        base = Image.new('RGB', (n, n), im.getpixel((2, 2)))
        k = int(n * .8)
        base.paste(im.resize((k, k), Image.LANCZOS), ((n - k) // 2, (n - k) // 2))
        return base
    m = Image.new('L', (n, n), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, n - 1, n - 1], radius=int(n * .22), fill=255)
    out = im.convert('RGBA')
    out.putalpha(m)
    return out


def main():
    logo = buscar('logo')
    for nombre, n, relleno in (('icon-192.png', 192, False), ('icon-512.png', 512, False),
                               ('icon-maskable-512.png', 512, True), ('apple-touch-icon.png', 180, True)):
        img = desde_logo(logo, n, relleno) if logo else dibujar(n * 2, relleno).resize((n, n), Image.LANCZOS)
        img.save(ROOT / nombre)
    print('Iconos:', 'desde ' + logo.name if logo else 'dibujados por defecto')


if __name__ == '__main__':
    main()
