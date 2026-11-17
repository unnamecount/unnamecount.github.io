"""Publica TODO de una vez: Pincelada, GachaMotion y el Estudio Creativo.

Uso:   py -3.12 publicar.py "qué has cambiado"

Antes de ejecutarlo, apunta la novedad ARRIBA en el cambios.json que corresponda:
  - Pincelada:     ../Pincelada/cambios.json
  - GachaMotion:   gachamotion/cambios.json
  - Estudio:       cambios.json
(con una versión nueva; si no, las apps no sabrán que hay algo nuevo).

Hace: construye cada cosa, y sube a GitHub lo que haya cambiado. Las apps instaladas
avisan solas con el botón «Actualizar» (y el Estudio también lo muestra en su tarjeta).
"""
import pathlib
import subprocess
import sys

ESTUDIO = pathlib.Path(__file__).resolve().parent
PINCELADA = ESTUDIO.parent / 'Pincelada'


def run(cmd, cwd):
    r = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, encoding='utf-8', errors='replace')
    if r.returncode:
        print(r.stdout, r.stderr)
        sys.exit(f'Falló: {" ".join(cmd)}')
    return r.stdout.strip()


def publicar(carpeta, mensaje, nombre):
    if not run(['git', 'status', '--porcelain'], carpeta):
        print(f'{nombre}: sin cambios')
        return
    run(['git', 'add', '-A'], carpeta)
    run(['git', 'commit', '-m', mensaje], carpeta)
    run(['git', 'push'], carpeta)
    print(f'{nombre}: publicado ({run(["git", "log", "--oneline", "-1"], carpeta)})')


def main():
    msg = sys.argv[1] if len(sys.argv) > 1 else 'Actualización'
    if PINCELADA.exists():
        print(run([sys.executable, 'build.py'], PINCELADA))
        publicar(PINCELADA, msg, 'Pincelada')
    print(run([sys.executable, 'build.py'], ESTUDIO))
    publicar(ESTUDIO, msg, 'Estudio + GachaMotion')
    print('\nListo. GitHub tarda uno o dos minutos en mostrarlo. Después, en el Estudio: «Buscar novedades».')


if __name__ == '__main__':
    main()
