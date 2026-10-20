/**
 * FoodLoop · Construcción del conjunto de aprendizaje
 *
 * Convierte los registros del centro en ejemplos supervisados: una fila
 * por pareja (lote, receta admisible), con las nueve entradas del
 * componente aprendido y la variable objetivo.
 *
 * LA VARIABLE OBJETIVO
 *
 *     y = 1  si la receta se produjo en el centro el día del lote o en
 *            los dos días siguientes (≤ 48 h, el horizonte de urgencia
 *            del modelo y la vida útil típica de un cocido);
 *     y = 0  si no.
 *
 * Es un sustituto, y se declara como tal: dice que la propuesta habría
 * encajado en el menú que la cocina realmente preparó —que es la
 * condición para que se ejecute sin reorganizar la producción—, no que
 * el chef usara la merma en ella. El libro del centro no trae ese dato:
 * su hoja de decisiones dice «No autorizada» en las 1 577 filas.
 *
 * Cada lote se evalúa en SU momento (registro + 2 h), como en
 * `evaluar-historico.ts`, y en modo potencial: el dictamen y la
 * temperatura no se midieron, de modo que con las seis reglas activas
 * casi ningún lote tendría candidatas y no habría nada que aprender. Las
 * reglas R0, R2, R3 y R5 sí se aplican.
 *
 * Las señales de operación solo ven producciones ANTERIORES al día del
 * lote (ver `senalesOperacion`), de modo que la entrada nunca contiene
 * la respuesta.
 */
import { baseEnMemoria } from "../db-memoria.mjs";
import { importar } from "../../backend/src/infraestructura/adaptadores/salida/mongo/importar";
import {
  LotesMongo, CatalogoMongo, CargasMongo,
} from "../../backend/src/infraestructura/adaptadores/salida/mongo/repositorios";
import { ejecutarModelo, ENTRADAS_APRENDIDAS, diaLocal } from "@foodloop/dominio";
import type { EntradaAprendida, ItemCatalogo, Lote } from "@foodloop/dominio";

/** Días posteriores al del lote que cuentan como ejecución. */
export const HORIZONTE_DIAS = 2;
/** Horas tras el registro en que se evalúa cada lote. */
export const DESFASE_H = 2;

export interface Ejemplo {
  lote: string;
  fecha: string;
  ingrediente: string;
  receta: string;
  nombre: string;
  x: Record<EntradaAprendida, number>;
  /** Valor de aprovechamiento: la aptitud del modelo 2. */
  valor: number;
  kg: number;
  costo: number;
  y: 0 | 1;
}

export interface Conjunto {
  ejemplos: Ejemplo[];
  lotes: Lote[];
  catalogo: ItemCatalogo[];
  /** Valor de lo que el centro tenía en merma, por lote. */
  valorLote: Map<string, number>;
  kgLote: Map<string, number>;
  fechaLote: Map<string, string>;
}

const sumarDias = (dia: string, n: number) => {
  const d = new Date(`${dia}T12:00:00`);
  d.setDate(d.getDate() + n);
  return diaLocal(d);
};

export async function construirConjunto(carpeta: string): Promise<Conjunto> {
  const db = baseEnMemoria() as never;
  const consola = console.log;
  console.log = () => {};          // el informe de importación no interesa aquí
  try { await importar(carpeta, db); } finally { console.log = consola; }

  const repo = new LotesMongo(db);
  const catalogo = await new CatalogoMongo(db).listarActivos();
  const inventario = await repo.inventarioDisponible();
  const cargas = await new CargasMongo(db).cargasPorArea();
  const lotes = await repo.listarPendientes();

  const producida = new Map(catalogo.map((c) => [c.codigo, new Set(c.producciones ?? [])]));
  const ejemplos: Ejemplo[] = [];
  const valorLote = new Map<string, number>();
  const kgLote = new Map<string, number>();
  const fechaLote = new Map<string, string>();

  for (const lote of lotes) {
    const ahora = new Date(lote.registradoEn.getTime() + DESFASE_H * 3_600_000);
    const dia = diaLocal(ahora);
    valorLote.set(lote.codigo, lote.cantidad * lote.costoUnitario);
    kgLote.set(lote.codigo, lote.cantidad);
    fechaLote.set(lote.codigo, dia);

    const s = ejecutarModelo([lote], catalogo, inventario, cargas, ahora, {
      topN: 10_000, modo: "potencial", puntuacion: "experta",
    });
    const porCodigo = new Map(s.resultados.map((r) => [r.item.codigo, r]));
    const dias = Array.from({ length: HORIZONTE_DIAS + 1 }, (_, i) => sumarDias(dia, i));

    for (const v of s.traza.vectores) {
      const r = porCodigo.get(v.receta)!;
      const x = {} as Record<EntradaAprendida, number>;
      for (const e of ENTRADAS_APRENDIDAS)
        x[e] = e in v.valores
          ? v.valores[e as keyof typeof v.valores]
          : v.senales[e as keyof typeof v.senales];
      const fechas = producida.get(v.receta) ?? new Set<string>();
      ejemplos.push({
        lote: lote.codigo, fecha: dia, ingrediente: lote.ingrediente,
        receta: v.receta, nombre: r.item.nombre, x,
        valor: v.valor, kg: r.kgAprovechados, costo: r.costoRecuperado,
        y: dias.some((d) => fechas.has(d)) ? 1 : 0,
      });
    }
  }
  return { ejemplos, lotes, catalogo, valorLote, kgLote, fechaLote };
}

/** Agrupa los ejemplos por lote, conservando el orden de aparición. */
export function porLote<T extends { lote: string }>(filas: readonly T[]): T[][] {
  const m = new Map<string, T[]>();
  for (const f of filas) {
    const g = m.get(f.lote) ?? [];
    g.push(f);
    m.set(f.lote, g);
  }
  return [...m.values()];
}
