"""
FoodLoop · Preparación de las fotografías de las preparaciones

Toma las fotografías tal como llegan (de la cámara, del móvil o
descargadas) y genera los dos archivos que usa la aplicación:

    REC-005.jpg        1400×600  (21:9)  ficha de la receta
    REC-005-mini.jpg    400×400  (1:1)   lista de recomendaciones

Se generan dos recortes a propósito. La ficha muestra el plato a lo
ancho; la lista lo muestra en un cuadrado de 76 px. Si se usara el
mismo archivo para las dos cosas, el cuadrado recortaría la foto
panorámica por los lados y del plato quedaría una franja central.

USO

    pip install pillow
    python herramientas/fotos/preparar-fotos.py ./fotos-originales

El nombre de cada archivo de origen debe ser el código de la receta:
REC-001.jpg, REC-005.png, etc. Acepta jpg, jpeg, png y webp.

ENCUADRE

Por defecto recorta centrado. Cuando el plato no está en el centro de
la foto, se indica su posición en FOCOS, como fracción del ancho y del
alto (0.5, 0.5 es el centro exacto). Es lo que evita que un recorte
automático corte el plato por la mitad.
"""

import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps, ImageFilter
except ImportError:
    sys.exit("Falta Pillow. Instálalo con:  pip install pillow")

ANCHO, ALTO = 1400, 600          # ficha de la receta, 21:9
MINI = 400                       # lista de recomendaciones, 1:1
CALIDAD = 84
EXTENSIONES = {".jpg", ".jpeg", ".png", ".webp"}

# Dónde está el plato en cada fotografía, si no está centrado.
FOCOS = {
    "REC-005": (0.45, 0.47),
    "REC-011": (0.66, 0.52),
}


def recortar(im: Image.Image, proporcion: float, foco) -> Image.Image:
    """Recorta a la proporción pedida alrededor del punto de interés.

    Recorta en lugar de deformar: un plato estirado se nota de
    inmediato y le resta credibilidad a la ficha.
    """
    ancho, alto = im.size
    fx, fy = foco

    if ancho / alto > proporcion:
        nw, nh = int(alto * proporcion), alto
    else:
        nw, nh = ancho, int(ancho / proporcion)

    izq = int(ancho * fx - nw / 2)
    arr = int(alto * fy - nh / 2)
    izq = max(0, min(izq, ancho - nw))      # sin salirse de la imagen
    arr = max(0, min(arr, alto - nh))
    return im.crop((izq, arr, izq + nw, arr + nh))


def guardar(im: Image.Image, ruta: Path, tam) -> int:
    ancho_destino = tam[0]
    # Al ampliar una foto pequeña conviene un enfoque suave: la
    # interpolación deja los bordes lavados y el plato se ve borroso.
    amplia = ancho_destino > im.width
    im = im.resize(tam, Image.LANCZOS)
    if amplia:
        im = im.filter(ImageFilter.UnsharpMask(radius=1.6, percent=85, threshold=3))
    im.save(ruta, "JPEG", quality=CALIDAD, optimize=True, progressive=True)
    return ruta.stat().st_size


def procesar(origen: Path, destino: Path) -> None:
    destino.mkdir(parents=True, exist_ok=True)
    archivos = sorted(f for f in origen.iterdir()
                      if f.is_file() and f.suffix.lower() in EXTENSIONES)
    if not archivos:
        sys.exit(f"No hay imágenes en {origen}")

    print(f"\n  Origen:  {origen.resolve()}")
    print(f"  Destino: {destino.resolve()}\n")
    print(f"  {'Receta':<10} {'Original':>12} {'Ficha':>10} {'Mini':>8}   Aviso")
    print("  " + "─" * 68)

    for f in archivos:
        codigo = f.stem.upper().replace("-MINI", "")
        if not codigo.startswith("REC-"):
            print(f"  {f.name:<10} omitido · el nombre debe ser el código "
                  f"de la receta, por ejemplo REC-001.jpg")
            continue

        foco = FOCOS.get(codigo, (0.5, 0.5))
        with Image.open(f) as src:
            src = ImageOps.exif_transpose(src)       # orientación del móvil
            if src.mode != "RGB":
                fondo = Image.new("RGB", src.size, (255, 255, 255))
                fondo.paste(src, mask=src.convert("RGBA").split()[-1])
                src = fondo
            original = f"{src.width}×{src.height}"
            chica = src.width < 900

            a = guardar(recortar(src, ANCHO / ALTO, foco),
                        destino / f"{codigo}.jpg", (ANCHO, ALTO))
            b = guardar(recortar(src, 1.0, foco),
                        destino / f"{codigo}-mini.jpg", (MINI, MINI))

        aviso = "resolución baja, se verá blanda" if chica else ""
        print(f"  {codigo:<10} {original:>12} {a//1024:>7} KB {b//1024:>5} KB   {aviso}")

    print("  " + "─" * 68)
    print("\n  Listo. Arranca la aplicación y abre cualquier receta.\n")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("Uso: python herramientas/fotos/preparar-fotos.py "
                 "<carpeta-con-las-fotos> [carpeta-destino]")
    predeterminado = (Path(__file__).resolve().parents[2]
                      / "frontend" / "public" / "recetas")
    procesar(Path(sys.argv[1]),
             Path(sys.argv[2]) if len(sys.argv) > 2 else predeterminado)
