"""
FoodLoop · Conversión del dataset del centro de producción a las
plantillas que consume el importador.

    python3 herramientas/dataset/convertir.py <dataset.xlsx> ./datos

Lee las hojas del libro entregado por el centro y escribe los seis CSV
que `npm run importar -- ./datos` ya sabe cargar. No carga nada: deja los
archivos y un informe de procedencia.

POR QUÉ UN PASO INTERMEDIO Y NO UN IMPORTADOR DIRECTO DEL XLSX

Porque el importador ya está escrito y probado, y porque la conversión
tiene decisiones que hay que poder auditar una por una. Separados, los
CSV intermedios se pueden abrir y revisar antes de cargar nada, y el
informe dice de qué columna del libro salió cada campo.

LO QUE EL LIBRO NO TRAE, Y QUÉ SE HACE CON ELLO

El libro declara en cada fila su propia procedencia. El recetario y el
catálogo de ingredientes son documentales (`ORIGINAL_RECETARIO_MAREMIO`);
la serie temporal —servicios, producción, mermas, decisiones, inventario—
es `RECONSTRUCCIÓN_REFERENCIAL`. Y tres campos que el modelo necesita no
existen en ninguna hoja:

  · temperatura del lote      "No documentada" en las 1577 filas
  · hora de generación        "No documentada" en las 1577 filas
  · dictamen sanitario        "No evaluado" en las 1577 filas

Ninguno se rellena con un número inventado. Cada uno se DERIVA de una
columna que el libro sí trae, con una regla escrita aquí abajo, y la fila
resultante queda marcada con la procedencia de ese campo. El informe
final dice cuántos valores son medidos y cuántos derivados, que es lo que
hay que citar en la fase de preparación de datos.

La diferencia importa: un valor derivado de una regla declarada se puede
discutir y rehacer con otra regla; un número inventado no se puede ni
auditar ni corregir.
"""
import csv
import sys
from collections import Counter, defaultdict
from pathlib import Path

try:
    import openpyxl
except ModuleNotFoundError:
    sys.exit(
        "\n  Falta la librería openpyxl, que es la que lee archivos .xlsx.\n"
        "\n      pip install openpyxl\n"
        "\n  En Windows, si «pip» no se reconoce:\n"
        "\n      python -m pip install openpyxl\n"
        "\n  Este comando es el ÚNICO del proyecto que necesita Python. La\n"
        "  conversión del libro a CSV se hace una vez; después, cargar y\n"
        "  evaluar los datos ya es solo Node:\n"
        "\n      npm run datos:evaluar -- ./datos\n"
        "\n  Si ya tienes los CSV en la carpeta datos/, no hace falta\n"
        "  convertir nada ni instalar Python.\n")

# =====================================================================
# Reglas declaradas
# =====================================================================

# --- unidades -> kilogramos ------------------------------------------
# El recetario está en quintales, libras, atados y cubetas; las mermas en
# kilogramos. El motor compara una cosa con la otra, de modo que todo se
# lleva a kg. Las cuatro primeras son equivalencias exactas; las demás
# son pesos de uso en cocina y quedan marcadas como aproximadas.
A_KG = {
    "quintal": 45.36, "saco": 45.36,          # 1 quintal = 100 lb
    "lb": 0.4536, "libra": 0.4536,
    "kilo": 1.0, "kg": 1.0,
    "gr": 0.001, "g": 0.001,
    "litro": 1.0, "l": 1.0,                    # densidad ~1 para caldos y aceite
    "cubeta": 1.8,                             # cubeta de 30 huevos
    "unidad": 0.15,
    "atado": 0.30,
    "pareja": 0.50,
    "caja": 10.0,
    "balde": 5.0,
    "lata 900": 0.9,
    "cuarto": 0.25,
}
UNIDAD_EXACTA = {"quintal", "saco", "lb", "libra", "kilo", "kg", "gr", "g"}

# --- vida útil por categoría de ingrediente --------------------------
# El catálogo no declara vida útil. Se asigna por categoría según el
# criterio sanitario habitual para restauración colectiva: horas en
# crudo y horas una vez cocido, que es siempre menor.
VIDA_UTIL_H = {
    "proteína": (48, 24),
    "lácteo": (72, 24),
    "verdura": (120, 48),
    "vegetal": (120, 48),
    "fruta": (96, 48),
    "cereal": (720, 24),
    "grano": (720, 24),
    "abarrote": (2160, 48),
    "condimento": (2160, 72),
    "panadería": (72, 48),
}
VIDA_UTIL_DEFECTO = (72, 24)

# --- temperatura máxima admisible ------------------------------------
TEMP_MAX_C = {
    "proteína": 4, "lácteo": 4, "verdura": 6, "vegetal": 6, "fruta": 6,
    "cereal": 20, "grano": 20, "abarrote": 20, "condimento": 20,
    "panadería": 20,
}
TEMP_MAX_DEFECTO = 4

# --- temperatura del lote: derivada del almacenamiento declarado -----
# La hoja Trazabilidad_Lotes declara dónde se guardó cada lote. Es el
# único dato del libro relacionado con la temperatura, de modo que la
# regla se ancla ahí en lugar de en un número elegido a mano:
#
#   "Cámara refrigerada"                    -> 4,0 °C
#   "Área de segregación de materia prima"  -> 18,0 °C (ambiente, Loja)
#
# ESTE ES EL SUPUESTO MÁS CONSECUENTE DE TODA LA CONVERSIÓN. La regla R4
# del motor descarta un producto cocido por encima de 5 °C salvo que la
# receta alcance 74 °C. Los 511 lotes cocidos del libro están declarados
# en cámara refrigerada, de modo que con esta regla pasan el filtro; con
# 6 °C en lugar de 4, ninguno pasaría salvo por reproceso térmico. El
# informe lo reporta aparte para que la sensibilidad quede a la vista.
TEMP_POR_ALMACENAMIENTO = {
    "cámara refrigerada": 4.0,
    "área de segregación de materia prima": 18.0,
}
TEMP_DEFECTO = 18.0

# --- dictamen sanitario: derivado de las condiciones declaradas ------
# La hoja Control_Inocuidad trae "No evaluado" en las 1577 filas, pero
# Lotes_Merma sí declara la condición de inocuidad de cada lote en texto.
# De ahí se deriva el dictamen, en tres estados:
#
#   apto       la condición declara el material apto y validado
#   no_apto    la condición declara la no aptitud
#   pendiente  la condición exige una evaluación que nadie registró
#
# El tercer estado es el honesto para la mayoría: el libro no dice que el
# lote sea apto ni que no lo sea, dice que haría falta comprobarlo.
DICTAMEN = [
    ("material apto", "apto"),
    ("no aptitud asumida", "no_apto"),
    ("descartar sin registro", "pendiente"),
    ("descartar sin control", "pendiente"),
]
DICTAMEN_DEFECTO = "pendiente"

# --- causa de la merma -> vocabulario del modelo ---------------------
CAUSA = {
    "error de porcionado": "error_porcionado",
    "sobreproducción": "sobreproduccion",
    "defecto de calidad": "defecto_calidad",
    "devolución de línea": "devolucion_linea",
    "recortes de preparación": "error_porcionado",
    "caducidad próxima": "caducidad_proxima",
}

# --- área de preparación -> tipo de proceso --------------------------
TIPO_PROCESO = {
    "cocina caliente": ("reproceso_termico", 80),
    "cocina fría": ("ensamblaje_frio", 0),
    "panadería": ("panaderia", 180),
    "pastelería": ("panaderia", 180),
}
TIPO_PROCESO_DEFECTO = ("reproceso_termico", 80)

# --- productos de merma -> ingrediente del catálogo ------------------
# Los lotes nombran el producto en texto libre (14 valores distintos) y
# el recetario lo referencia por código. El puente se escribe aquí, a
# mano y a la vista, porque una coincidencia por parecido de nombre
# acertaría la mayoría de las veces y fallaría en silencio el resto.
# El estado del producto va junto: "arroz cocido" es arroz, cocido.
#
# El destino puede ser un nombre de ingrediente o un código ING-xxxx.
# Se usa el código cuando el nombre no lo encuentra: las recetas de
# aprovechamiento de pan declaran ING-0123 «Baguette», no «Pan», y sin
# ese puente los 120 lotes de pan no servido quedaban sin ninguna receta
# que los usara aunque el libro trae cuatro.
#
# Tres de estas líneas son un SUPUESTO, no una traducción, porque el
# libro no dice de qué producto se trata:
#   · "verduras cocidas"  -> zanahoria, la verdura más presente
#   · "sopa sobrante"     -> papa, base habitual de las sopas del centro
#   · "fruta recortada"   -> frutilla, la fruta que más usan las recetas
#                            de aprovechamiento (APR-047 y APR-049)
# Sin ellas, 364 lotes no se podrían evaluar; con ellas, se evalúan bajo
# un supuesto declarado. El informe los cuenta aparte.
PRODUCTO_A_INGREDIENTE = {
    "arroz cocido": ("Arroz", "cocido", False),
    "pollo cocido": ("Pollo", "cocido", False),
    "verduras cocidas": ("Zanahoria", "cocido", True),
    "sopa sobrante": ("Papa", "cocido", True),
    "pan no servido": ("ING-0123", "cocido", False),
    "papas peladas sobrantes": ("Papa", "crudo", False),
    "cáscaras de papa": ("Papa", "crudo", False),
    "recortes de zanahoria": ("Zanahoria", "crudo", False),
    "recortes de pimiento": ("Pimiento", "crudo", False),
    "cáscaras de cebolla": ("Cebolla", "crudo", False),
    "corazones de tomate": ("Tomate", "crudo", False),
    "tallos de cilantro": ("Cilantro", "crudo", False),
    "fruta sana recortada": ("ING-0126", "crudo", True),
    "fruta recortada": ("ING-0126", "crudo", True),
}

# Balance de masa: ingredientes declarados frente al peso del plato.
#
# La corrección es asimétrica a propósito, y esto importa:
#
#   · ingredientes MUCHO MÁS pesados que el plato es imposible. Una
#     receta que rinde 10,4 kg no puede llevar 149 kg de ingredientes.
#     Ahí la cantidad está mal y se normaliza.
#
#   · ingredientes MÁS LIGEROS que el plato es normal y no se toca. Una
#     sopa de 43 kg lleva 17 kg de ingredientes porque el resto es agua,
#     y el agua no figura en el recetario. Normalizar hacia arriba
#     inventaría ingredientes que la receta no lleva.
#
# Una regla simétrica habría "corregido" 164 de 208 recetas, la mayoría
# sopas y jugos que estaban bien.
BALANCE_MAX = 1.8         # por encima de esto, la cantidad es imposible
BALANCE_OBJETIVO = 1.15   # se pierde agua al cocinar, se añade líquido


# =====================================================================
def norm(x):
    return "" if x is None else str(x).strip()


def clave(x):
    return norm(x).lower()


def numero(x):
    if isinstance(x, (int, float)):
        return float(x)
    s = norm(x).replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


class Informe:
    """Lleva la cuenta de qué campo salió de dónde."""

    def __init__(self):
        self.lineas = []
        self.conteo = defaultdict(Counter)

    def campo(self, archivo, campo, procedencia):
        self.conteo[f"{archivo}·{campo}"][procedencia] += 1

    def nota(self, texto):
        self.lineas.append(texto)

    def imprimir(self):
        print("\n  PROCEDENCIA DE CADA CAMPO ESCRITO")
        print("  " + "=" * 68)
        for k in sorted(self.conteo):
            arch, campo = k.split("·")
            tot = sum(self.conteo[k].values())
            det = " · ".join(f"{p}={n}" for p, n in self.conteo[k].most_common())
            print(f"  {arch:24} {campo:22} {tot:5}   {det}")
        if self.lineas:
            print("\n  NOTAS")
            print("  " + "=" * 68)
            for l in self.lineas:
                print(f"  · {l}")


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    libro, destino = sys.argv[1], Path(sys.argv[2])
    destino.mkdir(parents=True, exist_ok=True)
    inf = Informe()

    wb = openpyxl.load_workbook(libro, read_only=True, data_only=True)

    def hoja(nombre):
        ws = wb[nombre]
        it = ws.iter_rows(values_only=True)
        cab = [norm(c) for c in next(it)]
        return [dict(zip(cab, r)) for r in it]

    print(f"\n  CONVERSIÓN DEL DATASET DEL CENTRO DE PRODUCCIÓN")
    print(f"  Origen:  {libro}")
    print(f"  Destino: {destino}/")
    print("  " + "=" * 68)

    # =================================================================
    # ingredientes.csv
    # =================================================================
    cat = hoja("Catalogo_Ingredientes")
    # Los nombres que usan las mermas ("Arroz", "Pollo"...) tienen que
    # existir como ingrediente. Se buscan en el catálogo por prefijo; el
    # que no aparezca se añade como ingrediente propio, declarado.
    por_nombre = {}
    filas_ing = []
    for c in cat:
        cod, nom = norm(c["CODIGO_INGREDIENTE"]), norm(c["NOMBRE_INGREDIENTE"])
        if not cod or not nom:
            continue
        categoria = norm(c["CATEGORIA"]) or "Sin categoría"
        u = clave(c["UNIDAD"])
        factor = A_KG.get(u)
        costo = numero(c["COSTO_POR_UNIDAD_USD"])
        if factor is None or costo is None:
            inf.campo("ingredientes.csv", "descartado", f"unidad '{u}' no convertible")
            continue
        # el costo venía por unidad de compra; se lleva a costo por kg
        costo_kg = round(costo / factor, 4)
        ck = clave(categoria)
        crudo, cocido = next((v for k, v in VIDA_UTIL_H.items() if k in ck),
                             VIDA_UTIL_DEFECTO)
        tmax = next((v for k, v in TEMP_MAX_C.items() if k in ck), TEMP_MAX_DEFECTO)

        filas_ing.append({
            "codigo": cod, "nombre": nom, "categoria": categoria,
            "unidad": "kg", "costo_unitario": costo_kg,
            "vida_util_crudo_h": crudo, "vida_util_cocido_h": cocido,
            "temp_max_c": tmax,
        })
        por_nombre.setdefault(clave(nom), cod)
        inf.campo("ingredientes.csv", "costo_unitario",
                  "documental, convertido a kg" if u in UNIDAD_EXACTA
                  else f"documental, conversión aproximada ({u})")
        inf.campo("ingredientes.csv", "vida_util_*", "derivada de la categoría")
        inf.campo("ingredientes.csv", "temp_max_c", "derivada de la categoría")

    # puente de los productos de merma
    codigos_cat = {f["codigo"] for f in filas_ing}

    def ingrediente_de(nombre_producto):
        destino, estado, supuesto = PRODUCTO_A_INGREDIENTE[clave(nombre_producto)]
        # un código se usa tal cual; un nombre se busca en el catálogo
        if destino.startswith("ING-"):
            return (destino if destino in codigos_cat else None), estado, supuesto
        dk = clave(destino)
        if dk in por_nombre:
            return por_nombre[dk], estado, supuesto
        for nom, cod in por_nombre.items():
            if nom.startswith(dk):
                return cod, estado, supuesto
        return None, estado, supuesto

    faltantes = set()
    mermas = hoja("Lotes_Merma")
    for m in mermas:
        p = clave(m["INGREDIENTE_O_PREPARACION"])
        if p not in PRODUCTO_A_INGREDIENTE:
            faltantes.add(p)
            continue
        if ingrediente_de(p)[0] is None:
            faltantes.add(PRODUCTO_A_INGREDIENTE[p][0])

    # un producto de merma sin ingrediente en el catálogo se añade,
    # declarado como tal: sin él, sus lotes no se podrían cargar
    for base in sorted(faltantes):
        cod = f"ING-MER-{len(filas_ing):03d}"
        filas_ing.append({
            "codigo": cod, "nombre": base.title(), "categoria": "Vegetal",
            "unidad": "kg", "costo_unitario": 1.0,
            "vida_util_crudo_h": 120, "vida_util_cocido_h": 48, "temp_max_c": 6,
        })
        # la clave va normalizada: `ingrediente_de` busca por clave(), y
        # guardarla en mayúsculas dejaba los lotes sin puente igualmente
        por_nombre[clave(base)] = cod
        inf.campo("ingredientes.csv", "ingrediente añadido",
                  "producto de merma sin entrada en el catálogo")
        inf.nota(f"«{base.title()}» aparece en las mermas pero no en el catálogo "
                 f"de ingredientes; se añadió como {cod} con costo 1,00 USD/kg "
                 f"a falta de dato.")

    escribir(destino / "ingredientes.csv", filas_ing)

    # =================================================================
    # recetas.csv + receta_ingredientes.csv
    # =================================================================
    recetario = hoja("Recetario")
    ri = hoja("Receta_Ingredientes")
    por_receta = defaultdict(list)
    for r in ri:
        por_receta[norm(r["CODIGO_RECETA"])].append(r)

    filas_rec, filas_ri = [], []
    normalizadas = 0
    for r in recetario:
        cod = norm(r["CODIGO_RECETA"])
        nom = norm(r["NOMBRE_RECETA"])
        porciones = numero(r["RENDIMIENTO_PORCIONES"])
        peso = numero(r["PESO_PORCION_G"])
        minutos = numero(r["TIEMPO_PREPARACION_MIN"])
        area = norm(r["AREA_PREPARACION"]) or "Cocina caliente"
        if not (cod and nom and porciones and peso and minutos):
            inf.campo("recetas.csv", "descartada", "rendimiento o tiempo sin declarar")
            continue

        ingredientes = por_receta.get(cod, [])
        if not ingredientes:
            inf.campo("recetas.csv", "descartada", "sin ingredientes declarados")
            continue

        # cantidades a kg
        conv = []
        for x in ingredientes:
            u = clave(x["UNIDAD"])
            c = numero(x["CANTIDAD"])
            f = A_KG.get(u)
            cod_ing = norm(x["CODIGO_INGREDIENTE"])
            if c is None or f is None or not cod_ing:
                inf.campo("receta_ingredientes.csv", "descartada",
                          f"cantidad o unidad no convertible ({u})")
                continue
            conv.append([cod_ing, c * f, u, norm(x["INGREDIENTE"])])
        if not conv:
            inf.campo("recetas.csv", "descartada", "ninguna cantidad convertible")
            continue

        # balance de masa: los ingredientes deben pesar lo que el plato
        plato_kg = porciones * peso / 1000
        total_kg = sum(c[1] for c in conv)
        ratio = total_kg / plato_kg if plato_kg else 0
        if ratio > BALANCE_MAX and total_kg > 0:
            # se conservan las proporciones relativas y se ajusta la
            # escala, que es lo único que el balance permite corregir sin
            # inventar una formulación nueva
            k = (plato_kg * BALANCE_OBJETIVO) / total_kg
            for c in conv:
                c[1] *= k
            normalizadas += 1
            procedencia_cant = "normalizada: los ingredientes no podían rendir el plato"
        else:
            procedencia_cant = "documental, convertida a kg"

        tp, temp = next((v for k, v in TIPO_PROCESO.items() if k in clave(area)),
                        TIPO_PROCESO_DEFECTO)
        filas_rec.append({
            "codigo": cod, "nombre": nom, "area": area,
            "porciones_base": int(porciones), "peso_porcion_g": int(peso),
            "minutos": int(minutos), "tipo_proceso": tp, "temp_proceso_c": temp,
            "aceptacion_base": 3.5,
        })
        inf.campo("recetas.csv", "tipo_proceso", "derivado del área de preparación")
        inf.campo("recetas.csv", "aceptacion_base", "sin dato; neutral 3,5")

        mayor = max(conv, key=lambda c: c[1])
        for c in conv:
            filas_ri.append({
                "receta_codigo": cod, "ingrediente_codigo": c[0],
                "cantidad": round(c[1], 3),
                "es_principal": "si" if c is mayor else "no",
                "admite_estado": "ambos",
            })
            inf.campo("receta_ingredientes.csv", "cantidad", procedencia_cant)
            inf.campo("receta_ingredientes.csv", "es_principal",
                      "derivado: el de mayor peso en la receta")
            inf.campo("receta_ingredientes.csv", "admite_estado",
                      "sin dato; se admite crudo o cocido")

    escribir(destino / "recetas.csv", filas_rec)
    escribir(destino / "receta_ingredientes.csv", filas_ri)
    if normalizadas:
        inf.nota(f"{normalizadas} de {len(filas_rec)} recetas declaraban más de "
                 f"{BALANCE_MAX} veces en ingredientes el peso del plato que "
                 f"rinden, que es físicamente imposible. Se conservaron las "
                 f"proporciones entre ingredientes y se ajustó la escala al "
                 f"rendimiento declarado, con un factor objetivo de "
                 f"{BALANCE_OBJETIVO}. Las recetas con menos masa en "
                 f"ingredientes que en el plato —sopas y jugos, donde el agua "
                 f"no figura— se dejaron como están.")

    # =================================================================
    # mermas.csv
    # =================================================================
    trazas = {norm(t["ID_LOTE_MERMA"]): t for t in hoja("Trazabilidad_Lotes")}
    filas_mer = []
    sin_puente = Counter()
    temp_derivada = Counter()
    dictamenes = Counter()

    for m in mermas:
        idl = norm(m["ID_LOTE_MERMA"])
        prod = clave(m["INGREDIENTE_O_PREPARACION"])
        kg = numero(m["CANTIDAD_KG"])
        f = norm(m["FECHA"])[:10]
        if prod not in PRODUCTO_A_INGREDIENTE:
            sin_puente[prod] += 1
            continue
        cod_ing, estado_puente, supuesto = ingrediente_de(prod)
        if cod_ing is None or kg is None or not f:
            sin_puente[prod] += 1
            continue

        estado = clave(m["ESTADO_CRUDO_COCIDO"])
        estado = "cocido" if estado in ("cocido", "preparado") else "crudo"

        alm = clave(trazas.get(idl, {}).get("ALMACENAMIENTO_PROPUESTO"))
        temp = TEMP_POR_ALMACENAMIENTO.get(alm, TEMP_DEFECTO)
        temp_derivada[f"{alm or 'sin dato'} -> {temp} °C"] += 1

        cond = clave(m["CONDICIONES_INOCUIDAD"])
        dic = next((v for k, v in DICTAMEN if k in cond), DICTAMEN_DEFECTO)
        dictamenes[dic] += 1

        filas_mer.append({
            "codigo": norm(m["ID_LOTE_MERMA"]),
            "fecha": f,
            "servicio": norm(m["SERVICIO"]) or "Almuerzo",
            "ingrediente_codigo": cod_ing,
            "cantidad": kg,
            "estado_producto": estado,
            "temperatura_c": temp,
            "causa": CAUSA.get(clave(m["CAUSA"]), "sobreproduccion"),
            "apto_reproceso": {"apto": "si", "no_apto": "no",
                               "pendiente": "pendiente"}[dic],
            "area": norm(m["ORIGEN_AREA_DE_MERMA"]) or "Cocina caliente",
            "vida_util_h": "",
        })
        inf.campo("mermas.csv", "cantidad", "documental (reconstruido)")
        inf.campo("mermas.csv", "temperatura_c",
                  "DERIVADA del almacenamiento declarado")
        inf.campo("mermas.csv", "apto_reproceso",
                  "DERIVADO de las condiciones de inocuidad")
        inf.campo("mermas.csv", "ingrediente_codigo",
                  "SUPUESTO: el libro no dice qué producto es"
                  if supuesto else "puente al catálogo por nombre o código")

    escribir(destino / "mermas.csv", filas_mer)
    for p, n in sin_puente.most_common():
        inf.nota(f"{n} lotes de «{p}» sin puente al catálogo: no se cargan.")

    # =================================================================
    # asistencia.csv y produccion.csv
    # =================================================================
    serv = hoja("Servicios_Diarios")
    filas_asi = []
    for s in serv:
        f = norm(s["FECHA"])[:10]
        prev = numero(s["COMENSALES_PREVISTOS"])
        real = numero(s["COMENSALES_ATENDIDOS_REFERENCIAL"]) \
            if "COMENSALES_ATENDIDOS_REFERENCIAL" in s else None
        if real is None:
            real = next((numero(v) for k, v in s.items()
                         if k.startswith("COMENSALES_ATENDIDOS")), None)
        if not f or prev is None or real is None:
            continue
        filas_asi.append({
            "fecha": f, "servicio": norm(s["SERVICIO"]) or "Almuerzo",
            "comensales_previstos": int(prev), "comensales_reales": int(real),
        })
        inf.campo("asistencia.csv", "comensales", "documental (reconstruido)")
    escribir(destino / "asistencia.csv", filas_asi)

    codigos_rec = {r["codigo"] for r in filas_rec}
    prod = hoja("Produccion_Diaria")
    filas_pro, sin_codigo = [], 0
    for p in prod:
        f = norm(p["FECHA"])[:10]
        cod = norm(p["CODIGO_RECETA_SI_COINCIDE"])
        porc = numero(p["PORCIONES_PRODUCIDAS"])
        if not cod:
            sin_codigo += 1
            continue
        if cod not in codigos_rec or not f or porc is None:
            sin_codigo += 1
            continue
        filas_pro.append({
            "fecha": f, "servicio": norm(p["TIPO_PREPARACION"]) or "Almuerzo",
            "receta_codigo": cod, "porciones_producidas": int(porc),
        })
        inf.campo("produccion.csv", "porciones", "documental (reconstruido)")
    escribir(destino / "produccion.csv", filas_pro)
    if sin_codigo:
        inf.nota(f"{sin_codigo} de {len(prod)} filas de producción no traen código "
                 f"de receta que exista en el recetario: no se cargan. El libro "
                 f"las marca «Receta sin código si no existe coincidencia».")

    # =================================================================
    print(f"\n  ESCRITO")
    print("  " + "=" * 68)
    for n, filas in [("ingredientes.csv", filas_ing), ("recetas.csv", filas_rec),
                     ("receta_ingredientes.csv", filas_ri), ("mermas.csv", filas_mer),
                     ("asistencia.csv", filas_asi), ("produccion.csv", filas_pro)]:
        print(f"  {n:28} {len(filas):6} filas")

    print(f"\n  TEMPERATURA DERIVADA DEL ALMACENAMIENTO")
    print("  " + "=" * 68)
    for k, n in temp_derivada.most_common():
        print(f"  {n:6}  {k}")
    print("\n  Ningún lote trae temperatura medida. Si la cámara estuviera a 6 °C")
    print("  en lugar de 4, la regla R4 descartaría los lotes cocidos salvo por")
    print("  reproceso térmico. Es el supuesto más consecuente de la conversión.")

    print(f"\n  DICTAMEN SANITARIO DERIVADO")
    print("  " + "=" * 68)
    tot = sum(dictamenes.values())
    for k, n in dictamenes.most_common():
        print(f"  {n:6}  {100*n/tot:5.1f}%  {k}")
    print("\n  El libro declara «No evaluado» en las 1577 filas de inocuidad.")
    print("  Estos tres estados salen de la columna de condiciones de inocuidad.")

    inf.imprimir()
    print()


def escribir(ruta, filas):
    if not filas:
        ruta.write_text("", encoding="utf-8")
        return
    with open(ruta, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(filas[0].keys()))
        w.writeheader()
        w.writerows(filas)


if __name__ == "__main__":
    main()
