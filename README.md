# Estudio Creativo

Un solo sitio para abrir los programas de dibujo y animación: **Pincelada** y **GachaMotion Studio**.
Se instala como app (Chrome/Edge: «Instalar»; iPad: Compartir → «Añadir a pantalla de inicio»), funciona sin internet
y se actualiza desde aquí.

- Estudio: `https://unnamecount.github.io/`
- Pincelada: `https://unnamecount.github.io/pincelada/` (repo `pincelada`, NO cambiar esa dirección: sus obras se guardan en ella)
- GachaMotion: `https://unnamecount.github.io/gachamotion/` (carpeta `gachamotion/` de este repo)

## Publicar una novedad

1. Cambia el programa (`../Pincelada/pincelada.html`, `gachamotion/…` o el propio Estudio).
2. Apunta la novedad ARRIBA del `cambios.json` de ese programa con una versión nueva.
3. `py -3.12 publicar.py "qué has cambiado"` → construye y sube todo.

Las apps avisan solas («Actualizar»), y en el Estudio, «Buscar novedades» las revisa todas.

## Imágenes del Estudio

Deja `imagenes/fondo.png` (o .jpg/.webp) y `imagenes/logo.png` y ejecuta `build.py` (o `publicar.py`):
se reducen de tamaño, se usan de fondo y de icono. Las originales no se suben.

## Añadir otro programa

Añade una entrada en `apps.json` (nombre, `url`, `icono`, `version`, `cache`) y que ese programa tenga su `sw.js`
con la caché `<cache><versión>` y un `version.json`. GachaMotion es un ejemplo (lo genera `build.py`).
