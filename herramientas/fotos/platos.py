"""
FoodLoop · Ilustraciones de las preparaciones

Genera una lámina por receta: vista cenital, recipiente sobre superficie
de acero inoxidable, con los ingredientes representados de forma
reconocible pero estilizada.

Son ilustraciones, no fotografías. Para una ficha técnica de cocina
cumplen la función que pedían los participantes —ver a qué resultado
apunta la preparación— sin las dos pegas de una imagen generada: no hay
que declarar su origen ni existe duda sobre su licencia, porque se
dibujan aquí con código.

Salida: 1400×600 px, proporción 21:9, JPG.

Las imágenes ya están generadas y dentro del proyecto. Solo hace falta
volver a ejecutar este guion si se cambia un dibujo o se añade una
receta al recetario:

    pip install cairosvg pillow
    python herramientas/fotos/platos.py

Sin argumentos escribe en frontend/public/recetas, que es donde la
aplicación las busca. Con un argumento escribe en esa carpeta.
"""

import io
import math
import random
from pathlib import Path

import cairosvg
from PIL import Image

W, H = 1400, 600
CX, CY = W // 2, H // 2 + 8

# La ficha recorta un poco por arriba y por abajo, así que el recipiente
# se dibuja a tamaño cómodo y se amplía al final: así llena el encuadre
# sin que el dibujo tenga que rehacerse plato por plato.
ESCALA = 1.22
MINI = 400          # lado del recorte cuadrado de la lista

# Recetas que ya tienen fotografía real. Este guion no las toca, para
# que volver a generar las ilustraciones no borre una foto. Al añadir
# una fotografía nueva con preparar-fotos.py, agrega aquí su código.
CON_FOTOGRAFIA = {"REC-005", "REC-011"}

# --- paleta -----------------------------------------------------------
# Tonos tomados de alimentos reales; el fondo imita acero inoxidable
# cepillado, que es la superficie de trabajo de una cocina industrial.
ACERO_1, ACERO_2 = "#C9CDD0", "#B4B9BD"
PLATO, PLATO_SOMBRA, PLATO_BORDE = "#FBFAF7", "#E8E6E0", "#DAD8D1"

ARROZ_A, ARROZ_B = "#F3EAD6", "#E6D9BC"
POLLO_A, POLLO_B = "#E3C08A", "#CFA469"
CARNE_A, CARNE_B = "#9C6647", "#82523A"
PAPA_A, PAPA_B = "#F2DFA8", "#E3C978"
GRATIN_A, GRATIN_B = "#D9A74C", "#C08A32"
BROCOLI_A, BROCOLI_B = "#5E8C3A", "#47702B"
ZANAHORIA = "#E08A38"
TOMATE = "#C93B2E"
LECHUGA_A, LECHUGA_B = "#8FBF5A", "#6FA33F"
CREMA_A, CREMA_B = "#EFD9A8", "#E0C384"
PAN_A, PAN_B = "#DBAE63", "#C4924A"
QUESO = "#E8C464"
HUEVO = "#F0D678"
PEREJIL = "#6B9E3F"


def rnd(semilla: int):
    """Aleatoriedad reproducible: la misma receta da siempre la misma lámina."""
    return random.Random(semilla)


# --- piezas reutilizables --------------------------------------------

def fondo() -> str:
    """Superficie de acero con vetas suaves y viñeteado."""
    p = [f'<rect width="{W}" height="{H}" fill="url(#acero)"/>']
    r = rnd(7)
    for i in range(70):
        y = r.uniform(0, H)
        op = r.uniform(0.02, 0.06)
        p.append(f'<rect x="0" y="{y:.0f}" width="{W}" height="{r.uniform(0.6,1.8):.1f}" '
                 f'fill="#FFFFFF" opacity="{op:.3f}"/>')
    p.append(f'<rect width="{W}" height="{H}" fill="url(#vineta)"/>')
    return "".join(p)


def plato_redondo(cx: int, cy: int, rx: int, ry: int) -> str:
    """Plato blanco visto desde arriba, con ala y sombra proyectada."""
    return (
        f'<ellipse cx="{cx+6}" cy="{cy+10}" rx="{rx+6}" ry="{ry+6}" '
        f'fill="#000000" opacity="0.16" filter="url(#blur)"/>'
        f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{PLATO}" '
        f'stroke="{PLATO_BORDE}" stroke-width="2"/>'
        f'<ellipse cx="{cx}" cy="{cy}" rx="{rx*0.80:.0f}" ry="{ry*0.80:.0f}" '
        f'fill="none" stroke="{PLATO_SOMBRA}" stroke-width="2.5"/>'
    )


def bandeja(cx: int, cy: int, w: int, h: int, fill=PLATO) -> str:
    """Fuente rectangular de servicio, con esquinas redondeadas."""
    x, y = cx - w // 2, cy - h // 2
    return (
        f'<rect x="{x+6}" y="{y+10}" width="{w}" height="{h}" rx="26" '
        f'fill="#000000" opacity="0.16" filter="url(#blur)"/>'
        f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="26" fill="{fill}" '
        f'stroke="{PLATO_BORDE}" stroke-width="2"/>'
        f'<rect x="{x+14}" y="{y+14}" width="{w-28}" height="{h-28}" rx="18" '
        f'fill="none" stroke="{PLATO_SOMBRA}" stroke-width="2"/>'
    )


def granos(cx, cy, rx, ry, n, col_a, col_b, semilla, largo=(7, 13)):
    """Granos de arroz o pasta corta, orientados al azar."""
    r = rnd(semilla)
    out = []
    for _ in range(n):
        a = r.uniform(0, math.tau)
        d = math.sqrt(r.random())
        x = cx + math.cos(a) * rx * d
        y = cy + math.sin(a) * ry * d
        L = r.uniform(*largo)
        rot = r.uniform(0, 180)
        col = col_a if r.random() < 0.6 else col_b
        out.append(
            f'<rect x="{x-L/2:.1f}" y="{y-2.1:.1f}" width="{L:.1f}" height="4.2" '
            f'rx="2.1" fill="{col}" transform="rotate({rot:.0f} {x:.1f} {y:.1f})"/>')
    return "".join(out)


def trozos(cx, cy, rx, ry, n, col_a, col_b, semilla, tam=(13, 21)):
    """Cubos irregulares: proteína, papa o pan."""
    r = rnd(semilla)
    out = []
    for _ in range(n):
        a = r.uniform(0, math.tau)
        d = math.sqrt(r.random())
        x = cx + math.cos(a) * rx * d
        y = cy + math.sin(a) * ry * d
        s = r.uniform(*tam)
        rot = r.uniform(0, 90)
        col = col_a if r.random() < 0.55 else col_b
        out.append(
            f'<rect x="{x-s/2:.1f}" y="{y-s/2*0.8:.1f}" width="{s:.1f}" '
            f'height="{s*0.8:.1f}" rx="{s*0.18:.1f}" fill="{col}" '
            f'transform="rotate({rot:.0f} {x:.1f} {y:.1f})"/>')
    return "".join(out)


def brocoli(cx, cy, rx, ry, n, semilla):
    """Ramilletes: un tallo claro y una copa de círculos."""
    r = rnd(semilla)
    out = []
    for _ in range(n):
        a = r.uniform(0, math.tau)
        d = math.sqrt(r.random())
        x = cx + math.cos(a) * rx * d
        y = cy + math.sin(a) * ry * d
        s = r.uniform(0.85, 1.25)
        out.append(f'<rect x="{x-3.5*s:.1f}" y="{y+2*s:.1f}" width="{7*s:.1f}" '
                   f'height="{11*s:.1f}" rx="3" fill="#A8C98A"/>')
        for dx, dy, rr in ((-7, -2, 7.5), (7, -2, 7.5), (0, -8, 8), (0, 1, 7)):
            col = BROCOLI_A if r.random() < 0.6 else BROCOLI_B
            out.append(f'<circle cx="{x+dx*s:.1f}" cy="{y+dy*s:.1f}" '
                       f'r="{rr*s:.1f}" fill="{col}"/>')
    return "".join(out)


def bastones(cx, cy, rx, ry, n, col, semilla):
    """Zanahoria en bastones."""
    r = rnd(semilla)
    out = []
    for _ in range(n):
        a = r.uniform(0, math.tau)
        d = math.sqrt(r.random())
        x = cx + math.cos(a) * rx * d
        y = cy + math.sin(a) * ry * d
        L = r.uniform(20, 34)
        out.append(f'<rect x="{x-L/2:.1f}" y="{y-4:.1f}" width="{L:.1f}" height="8" '
                   f'rx="4" fill="{col}" transform="rotate({r.uniform(0,180):.0f} '
                   f'{x:.1f} {y:.1f})"/>')
    return "".join(out)


def hierbas(cx, cy, rx, ry, n, semilla):
    """Perejil picado por encima: rompe la uniformidad del color."""
    r = rnd(semilla)
    out = []
    for _ in range(n):
        a = r.uniform(0, math.tau)
        d = math.sqrt(r.random())
        x = cx + math.cos(a) * rx * d
        y = cy + math.sin(a) * ry * d
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r.uniform(1.6,3.2):.1f}" '
                   f'fill="{PEREJIL}" opacity="0.9"/>')
    return "".join(out)


def moteado(cx, cy, rx, ry, n, col, semilla, op=0.5, tam=(3, 7)):
    """Textura general: gratinado, migas, irregularidades."""
    r = rnd(semilla)
    out = []
    for _ in range(n):
        a = r.uniform(0, math.tau)
        d = math.sqrt(r.random())
        x = cx + math.cos(a) * rx * d
        y = cy + math.sin(a) * ry * d
        out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r.uniform(*tam):.1f}" '
                   f'fill="{col}" opacity="{op}"/>')
    return "".join(out)


# --- las diez preparaciones -------------------------------------------

def rec_001():
    """Arroz salteado con pollo y vegetales."""
    p = [plato_redondo(CX, CY, 268, 215)]
    p.append(f'<ellipse cx="{CX}" cy="{CY}" rx="215" ry="170" fill="{ARROZ_B}" opacity="0.55"/>')
    p.append(granos(CX, CY, 205, 160, 520, ARROZ_A, ARROZ_B, 11))
    p.append(trozos(CX, CY, 180, 138, 26, POLLO_A, POLLO_B, 12, tam=(17, 26)))
    p.append(brocoli(CX, CY, 175, 132, 9, 13))
    p.append(bastones(CX, CY, 185, 142, 14, ZANAHORIA, 14))
    p.append(hierbas(CX, CY, 195, 150, 40, 15))
    return "".join(p)


def rec_002():
    """Crema de ave con vegetales: bol hondo, superficie lisa."""
    p = [plato_redondo(CX, CY, 250, 205)]
    p.append(f'<ellipse cx="{CX}" cy="{CY}" rx="200" ry="160" fill="url(#crema)"/>')
    p.append(f'<ellipse cx="{CX-45}" cy="{CY-45}" rx="70" ry="42" fill="#FFFFFF" '
             f'opacity="0.18"/>')
    p.append(trozos(CX, CY, 150, 112, 12, POLLO_A, POLLO_B, 22, tam=(11, 16)))
    p.append(moteado(CX, CY, 165, 125, 26, ZANAHORIA, 23, op=0.75, tam=(3.5, 6)))
    p.append(hierbas(CX, CY, 170, 130, 34, 24))
    # vapor
    for i, dx in enumerate((-60, 0, 60)):
        p.append(f'<path d="M{CX+dx} {CY-150} q 18 -30 0 -58 q -18 -28 0 -54" '
                 f'stroke="#FFFFFF" stroke-width="7" fill="none" opacity="0.28" '
                 f'stroke-linecap="round"/>')
    return "".join(p)


def rec_003():
    """Porcionado y congelación: bandeja con porciones ordenadas."""
    p = [bandeja(CX, CY, 620, 380, "#E9ECEE")]
    r = rnd(31)
    for fila in range(2):
        for colu in range(4):
            x = CX - 232 + colu * 155
            y = CY - 82 + fila * 165
            p.append(f'<rect x="{x-62}" y="{y-58}" width="124" height="116" rx="12" '
                     f'fill="#F7F5F1" stroke="{PLATO_BORDE}" stroke-width="1.5"/>')
            p.append(trozos(x, y, 42, 38, 5, POLLO_A, POLLO_B, 40 + fila * 4 + colu,
                            tam=(26, 36)))
            # escarcha
            p.append(moteado(x, y, 52, 46, 16, "#FFFFFF", 60 + colu, op=0.5, tam=(1.5, 3.4)))
    return "".join(p)


def rec_004():
    """Pastel de carne y papa, con una porción ya servida.

    El hueco deja ver el fondo de la fuente y, en los cantos, el corte:
    la capa de papa dorada encima y la de carne debajo. Es la manera de
    mostrar que la preparación tiene dos capas sin recurrir a un corte
    lateral, que en vista cenital no se entendería.
    """
    p = [bandeja(CX, CY, 660, 400)]
    x0, y0, w, h = CX - 296, CY - 168, 592, 336
    p.append(f'<rect x="{x0}" y="{y0}" width="{w}" height="{h}" rx="14" fill="{GRATIN_A}"/>')
    p.append(moteado(CX, CY, 280, 155, 170, GRATIN_B, 51, op=0.55, tam=(5, 13)))
    p.append(moteado(CX, CY, 275, 150, 70, "#B87428", 52, op=0.5, tam=(3, 9)))
    p.append(hierbas(CX + 50, CY, 230, 140, 30, 54))

    # hueco de la porción servida: fondo de la fuente a la vista
    hx, hy, hw, hh = x0, y0, 208, 168
    p.append(f'<path d="M{hx} {hy+14} a14 14 0 0 1 14 -14 h{hw-14} v{hh} h{-hw} Z" '
             f'fill="#EDEAE1"/>')
    p.append(f'<path d="M{hx+10} {hy+20} a10 10 0 0 1 10 -10 h{hw-26} v{hh-14} '
             f'h{-(hw-10)} Z" fill="#E2DED3" opacity="0.7"/>')
    p.append(moteado(hx + hw * 0.5, hy + hh * 0.6, 70, 52, 16, "#C9A468", 55,
                     op=0.5, tam=(2, 5)))

    # cantos del corte: papa dorada arriba, carne debajo
    for cx_, cy_, cw, ch in ((hx + hw, hy, 20, hh), (hx, hy + hh, hw + 20, 20)):
        p.append(f'<rect x="{cx_}" y="{cy_}" width="{cw}" height="{ch}" '
                 f'fill="{CARNE_B}"/>')
        if cw > ch:
            p.append(f'<rect x="{cx_}" y="{cy_}" width="{cw}" height="7" '
                     f'fill="{PAPA_B}"/>')
        else:
            p.append(f'<rect x="{cx_}" y="{cy_}" width="7" height="{ch}" '
                     f'fill="{PAPA_B}"/>')
    p.append(trozos(hx + hw + 10, hy + hh * 0.5, 4, 66, 7, CARNE_A, CARNE_B, 56,
                    tam=(7, 11)))
    p.append(trozos(hx + hw * 0.5, hy + hh + 11, 90, 4, 9, CARNE_A, CARNE_B, 57,
                    tam=(7, 11)))
    return "".join(p)


def rec_005():
    """Puré de papa gratinado.

    Los surcos del tenedor no salen rectos ni parejos: se trazan con
    ondas de amplitud variable y las crestas se doran más que los
    valles, que es donde el horno pega primero.
    """
    p = [bandeja(CX, CY, 640, 390)]
    x0, y0, w, h = CX - 286, CY - 163, 572, 326
    p.append(f'<rect x="{x0}" y="{y0}" width="{w}" height="{h}" rx="14" fill="{PAPA_A}"/>')
    p.append(f'<defs><clipPath id="cPure"><rect x="{x0}" y="{y0}" width="{w}" '
             f'height="{h}" rx="14"/></clipPath></defs>')
    p.append('<g clip-path="url(#cPure)">')

    r = rnd(61)
    crestas = []
    for i in range(15):
        y = y0 + 18 + i * 22 + r.uniform(-3, 3)
        amp = r.uniform(5, 11)
        paso = r.uniform(44, 60)
        fase = r.uniform(0, math.tau)
        pts, x = [], x0 - 10
        j = 0
        while x < x0 + w + 24:
            yy = y + math.sin(fase + j * 1.9) * amp
            pts.append((x, yy))
            if j % 2 == 0:
                crestas.append((x, yy))
            x += paso + r.uniform(-6, 6)
            j += 1
        d = f"M{pts[0][0]:.0f} {pts[0][1]:.1f}"
        for (xa, ya), (xb, yb) in zip(pts, pts[1:]):
            d += f" Q{(xa+xb)/2:.0f} {ya + (yb-ya)*0.12:.1f} {xb:.0f} {yb:.1f}"
        p.append(f'<path d="{d}" fill="none" stroke="{GRATIN_A}" '
                 f'stroke-width="{r.uniform(22,30):.1f}" stroke-linecap="round" '
                 f'opacity="{r.uniform(0.75,0.95):.2f}"/>')

    # el horno no dora parejo: manchas anchas sobre las crestas
    r2 = rnd(64)
    for x, y in crestas:
        if r2.random() < 0.5:
            p.append(f'<ellipse cx="{x:.0f}" cy="{y:.1f}" '
                     f'rx="{r2.uniform(20,46):.0f}" ry="{r2.uniform(10,20):.0f}" '
                     f'fill="{GRATIN_B}" opacity="{r2.uniform(0.18,0.42):.2f}"/>')
    p.append(moteado(CX, CY, 268, 144, 38, "#A9661F", 63, op=0.35, tam=(4, 11)))
    p.append(f'<ellipse cx="{CX-70}" cy="{CY-52}" rx="150" ry="78" fill="#FFFFFF" '
             f'opacity="0.09"/>')
    p.append('</g>')
    return "".join(p)


def rec_006():
    """Ensalada mixta: hojas, tomate en gajos, zanahoria rallada."""
    p = [bandeja(CX, CY, 660, 400)]
    r = rnd(71)
    # hojas de lechuga
    for _ in range(46):
        a = r.uniform(0, math.tau)
        d = math.sqrt(r.random())
        x = CX + math.cos(a) * 262 * d
        y = CY + math.sin(a) * 148 * d
        s = r.uniform(0.85, 1.4)
        col = LECHUGA_A if r.random() < 0.55 else LECHUGA_B
        p.append(f'<ellipse cx="{x:.0f}" cy="{y:.0f}" rx="{34*s:.0f}" ry="{23*s:.0f}" '
                 f'fill="{col}" transform="rotate({r.uniform(0,180):.0f} {x:.0f} {y:.0f})" '
                 f'opacity="0.95"/>')
    # gajos de tomate
    for _ in range(11):
        a = r.uniform(0, math.tau)
        d = math.sqrt(r.random())
        x = CX + math.cos(a) * 240 * d
        y = CY + math.sin(a) * 132 * d
        rot = r.uniform(0, 360)
        p.append(f'<path d="M{x:.0f} {y:.0f} m -26 0 a 26 26 0 0 1 52 0 z" '
                 f'fill="{TOMATE}" transform="rotate({rot:.0f} {x:.0f} {y:.0f})"/>')
    p.append(bastones(CX, CY, 250, 138, 22, ZANAHORIA, 72))
    p.append(brocoli(CX, CY, 230, 125, 7, 73))
    return "".join(p)


def rec_007():
    """Crutones y pan rallado: cubos dorados y un montículo."""
    p = [bandeja(CX, CY, 660, 400, "#F4F2ED")]
    # montículo de pan rallado a la derecha
    p.append(f'<ellipse cx="{CX+180}" cy="{CY+18}" rx="132" ry="96" fill="{PAN_A}" '
             f'opacity="0.92"/>')
    p.append(moteado(CX + 180, CY + 18, 124, 88, 260, PAN_B, 81, op=0.6, tam=(2, 4.6)))
    # crutones a la izquierda
    r = rnd(82)
    for _ in range(34):
        a = r.uniform(0, math.tau)
        d = math.sqrt(r.random())
        x = CX - 170 + math.cos(a) * 150 * d
        y = CY + math.sin(a) * 128 * d
        s = r.uniform(24, 36)
        rot = r.uniform(0, 90)
        p.append(f'<rect x="{x-s/2:.0f}" y="{y-s/2:.0f}" width="{s:.0f}" height="{s:.0f}" '
                 f'rx="4" fill="{PAN_A}" stroke="{PAN_B}" stroke-width="2" '
                 f'transform="rotate({rot:.0f} {x:.0f} {y:.0f})"/>')
        p.append(f'<rect x="{x-s/2+4:.0f}" y="{y-s/2+4:.0f}" width="{s-8:.0f}" '
                 f'height="{s-8:.0f}" rx="3" fill="#E9C489" opacity="0.55" '
                 f'transform="rotate({rot:.0f} {x:.0f} {y:.0f})"/>')
    return "".join(p)


def rec_008():
    """Budín de pan: porciones cuadradas, superficie esponjosa."""
    p = [bandeja(CX, CY, 640, 390)]
    r = rnd(91)
    for fila in range(2):
        for colu in range(4):
            x = CX - 231 + colu * 154
            y = CY - 80 + fila * 160
            p.append(f'<rect x="{x-68}" y="{y-70}" width="136" height="140" rx="10" '
                     f'fill="{PAN_A}" stroke="{PAN_B}" stroke-width="2.5"/>')
            p.append(f'<rect x="{x-68}" y="{y-70}" width="136" height="26" rx="10" '
                     f'fill="{GRATIN_A}" opacity="0.7"/>')
            p.append(moteado(x, y, 56, 58, 30, "#C08A4A", 92 + colu + fila * 4,
                             op=0.35, tam=(3, 7)))
            p.append(moteado(x, y, 52, 54, 12, "#F5E3C0", 96 + colu, op=0.5, tam=(3, 6)))
    return "".join(p)


def penne(cx, cy, rx, ry, n, semilla):
    """Pasta corta tipo pluma: canuto con borde y hueco visible.

    Sin el hueco y el contorno la pasta se confunde con el gratinado y
    el conjunto se lee como textura, no como un plato.
    """
    r = rnd(semilla)
    out = []
    piezas = []
    for _ in range(n):
        # reparto rectangular: en una fuente la pasta llega a las esquinas
        piezas.append((cx + r.uniform(-rx, rx), cy + r.uniform(-ry, ry)))
    piezas.sort(key=lambda q: q[1])          # las de abajo tapan a las de arriba
    for x, y in piezas:
        L = r.uniform(40, 54)
        gr = r.uniform(19, 24)
        rot = r.uniform(0, 180)
        claro = r.random() < 0.55
        cara = "#F2D398" if claro else "#E4BE78"
        borde = "#CFA157" if claro else "#C0904A"
        g = f'transform="rotate({rot:.0f} {x:.1f} {y:.1f})"'
        out.append(
            f'<rect x="{x-L/2:.1f}" y="{y-gr/2:.1f}" width="{L:.1f}" '
            f'height="{gr:.1f}" rx="{gr/2:.1f}" fill="{cara}" stroke="{borde}" '
            f'stroke-width="2" {g}/>')
        out.append(
            f'<ellipse cx="{x-L/2+5:.1f}" cy="{y:.1f}" rx="3.6" '
            f'ry="{gr/2-3:.1f}" fill="#C08F4E" opacity="0.75" {g}/>')
        out.append(
            f'<rect x="{x-L/2+8:.1f}" y="{y-gr/2+3.5:.1f}" width="{L-16:.1f}" '
            f'height="3" rx="1.5" fill="#FFFFFF" opacity="0.30" {g}/>')
    return "".join(out)


def rec_010():
    """Pasta al horno con queso gratinado."""
    p = [bandeja(CX, CY, 660, 400)]
    x0, y0, w, h = CX - 296, CY - 168, 592, 336
    p.append(f'<rect x="{x0}" y="{y0}" width="{w}" height="{h}" rx="14" fill="#D79F52"/>')
    p.append(f'<defs><clipPath id="cFuente"><rect x="{x0}" y="{y0}" width="{w}" '
             f'height="{h}" rx="14"/></clipPath></defs>')
    p.append('<g clip-path="url(#cFuente)">')
    p.append(penne(CX, CY, 292, 166, 190, 101))
    # queso fundido: manchas anchas que caen entre la pasta
    r = rnd(102)
    for _ in range(30):
        x = CX + r.uniform(-290, 290)
        y = CY + r.uniform(-164, 164)
        rx_ = r.uniform(26, 52)
        p.append(f'<ellipse cx="{x:.0f}" cy="{y:.0f}" rx="{rx_:.0f}" '
                 f'ry="{rx_*r.uniform(0.5,0.75):.0f}" fill="{QUESO}" '
                 f'opacity="{r.uniform(0.42,0.66):.2f}"/>')
    p.append(moteado(CX, CY, 276, 152, 46, GRATIN_B, 103, op=0.55, tam=(6, 14)))
    p.append(moteado(CX, CY, 270, 146, 18, "#A9661F", 104, op=0.5, tam=(4, 9)))
    p.append(hierbas(CX, CY, 266, 144, 24, 105))
    p.append('</g>')
    return "".join(p)


def rec_011():
    """Tortilla de papa y huevo en cuñas."""
    p = [plato_redondo(CX, CY, 262, 212)]
    r = 185
    for i in range(8):
        a0 = math.radians(i * 45 - 90 + 1.6)
        a1 = math.radians((i + 1) * 45 - 90 - 1.6)
        x0, y0 = CX + math.cos(a0) * r, CY + math.sin(a0) * r * 0.80
        x1, y1 = CX + math.cos(a1) * r, CY + math.sin(a1) * r * 0.80
        p.append(f'<path d="M{CX} {CY} L{x0:.1f} {y0:.1f} A{r} {r*0.80:.0f} 0 0 1 '
                 f'{x1:.1f} {y1:.1f} Z" fill="{HUEVO}" stroke="{GRATIN_A}" '
                 f'stroke-width="3"/>')
    p.append(moteado(CX, CY, 165, 130, 90, PAPA_B, 111, op=0.6, tam=(6, 13)))
    p.append(moteado(CX, CY, 158, 124, 40, GRATIN_A, 112, op=0.5, tam=(5, 10)))
    p.append(hierbas(CX, CY, 150, 118, 18, 113))
    return "".join(p)


RECETAS = {
    "REC-001": ("Arroz salteado con pollo y vegetales", rec_001),
    "REC-002": ("Crema de ave con vegetales", rec_002),
    "REC-003": ("Porcionado y congelación de proteína", rec_003),
    "REC-004": ("Pastel de carne y papa", rec_004),
    "REC-005": ("Puré de papa gratinado", rec_005),
    "REC-006": ("Ensalada mixta de la casa", rec_006),
    "REC-007": ("Crutones y pan rallado", rec_007),
    "REC-008": ("Budín de pan", rec_008),
    "REC-010": ("Pasta al horno con queso", rec_010),
    "REC-011": ("Tortilla de papa y huevo", rec_011),
}


def svg(dibujo: str, escala: float = ESCALA) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}"
  viewBox="0 0 {W} {H}">
  <defs>
    <linearGradient id="acero" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{ACERO_1}"/>
      <stop offset="1" stop-color="{ACERO_2}"/>
    </linearGradient>
    <radialGradient id="vineta" cx="0.5" cy="0.45" r="0.78">
      <stop offset="0.55" stop-color="#000000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.22"/>
    </radialGradient>
    <radialGradient id="crema" cx="0.42" cy="0.38" r="0.72">
      <stop offset="0" stop-color="{CREMA_A}"/>
      <stop offset="1" stop-color="{CREMA_B}"/>
    </radialGradient>
    <filter id="blur"><feGaussianBlur stdDeviation="14"/></filter>
  </defs>
  {fondo()}
  <g transform="translate({CX} {CY}) scale({escala}) translate({-CX} {-CY})">
    {dibujo}
  </g>
</svg>'''


def lamina(fn, escala: float) -> Image.Image:
    png = cairosvg.svg2png(bytestring=svg(fn(), escala).encode("utf-8"),
                           output_width=W, output_height=H)
    return Image.open(io.BytesIO(png)).convert("RGB")


def generar(destino: Path) -> None:
    """Escribe, por receta, el panorámico de la ficha y el cuadrado de
    la lista de recomendaciones.

    El cuadrado no se recorta del panorámico: se vuelve a dibujar con el
    recipiente más pequeño, porque las fuentes rectangulares son más
    anchas que un recorte 1:1 y quedarían cortadas por los lados.
    """
    destino.mkdir(parents=True, exist_ok=True)
    print(f"\n  {'Código':<10} {'Preparación':<38} {'Ficha':>8} {'Mini':>7}")
    print("  " + "─" * 66)
    hechas = 0
    for codigo, (nombre, fn) in RECETAS.items():
        if codigo in CON_FOTOGRAFIA:
            print(f"  {codigo:<10} {nombre[:38]:<38}   ya tiene fotografía")
            continue
        hechas += 1
        ancha = destino / f"{codigo}.jpg"
        lamina(fn, ESCALA).save(ancha, "JPEG", quality=86, optimize=True,
                                progressive=True)

        mini = destino / f"{codigo}-mini.jpg"
        cuadro = lamina(fn, 0.82).crop(((W - H) // 2, 0, (W + H) // 2, H))
        cuadro.resize((MINI, MINI), Image.LANCZOS).save(
            mini, "JPEG", quality=86, optimize=True, progressive=True)

        print(f"  {codigo:<10} {nombre[:38]:<38} "
              f"{ancha.stat().st_size // 1024:>5} KB {mini.stat().st_size // 1024:>4} KB")
    print("  " + "─" * 66)
    print(f"  {hechas} ilustraciones en {destino.resolve()}\n")


if __name__ == "__main__":
    import sys
    # Por defecto, la carpeta que lee la aplicación, resuelta desde la
    # ubicación de este archivo para que dé igual desde dónde se lance.
    predeterminado = (Path(__file__).resolve().parents[2]
                      / "frontend" / "public" / "recetas")
    generar(Path(sys.argv[1]) if len(sys.argv) > 1 else predeterminado)
