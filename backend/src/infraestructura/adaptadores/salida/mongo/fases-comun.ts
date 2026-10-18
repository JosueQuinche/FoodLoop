/**
 * FoodLoop · Piezas comunes a las cuatro fases de la metodología
 *
 * Las cuatro fases compartían dos supuestos que dejaron de ser ciertos al
 * cargar los datos del centro, y este módulo es lo que los corrige.
 *
 * EL RELOJ
 *
 * Cada fase hacía `const ahora = new Date()`. Con la semilla de ejemplo
 * eso funciona, porque la semilla genera lotes vigentes. Con un conjunto
 * histórico no: los 1577 lotes del centro van de enero a junio de 2026,
 * de modo que evaluados con el reloj del sistema están todos vencidos y
 * las cinco validaciones de la Fase 2 devuelven cero. Un informe lleno de
 * ceros no dice que el modelo falle; dice que se le preguntó por un día
 * en el que no había nada que decidir.
 *
 * La corrección no es tocar las fechas de los datos —eso sería falsear el
 * conjunto— sino situar la evaluación en el instante en que cada lote
 * existió. El motor ya recibe ese instante por la etapa 1; aquí
 * simplemente se le pasa el que corresponde. `reloj: "porLote"` evalúa
 * cada lote a las dos horas de haberse registrado, que es cuando la
 * cocina tendría la decisión delante.
 *
 * EL REGISTRO
 *
 * Las fases imprimían por consola y nada más. Para el anexo de la tesis
 * hace falta que quede un archivo, y para comparar dos ejecuciones hace
 * falta que las cifras salgan como datos y no solo como texto alineado.
 * `Registro` recoge ambas cosas: la transcripción legible y las métricas
 * con nombre, que `herramientas/evidencias.ts` vuelca a disco.
 */

import type { Lote, ModoModelo } from "@foodloop/dominio";

/**
 * Horas entre el registro de un lote y el momento en que se lo evalúa.
 *
 * Dos horas es el supuesto operativo: la merma se genera al cerrar un
 * servicio y la decisión de qué hacer con ella se toma poco después, no
 * en el mismo instante ni al día siguiente. Cambiar este número cambia
 * cuánta ventana sanitaria le queda al lote en la evaluación, así que es
 * un parámetro declarado y no una constante escondida.
 */
export const MARGEN_REVISION_H = 2;

export interface OpcionesFase {
  /**
   * Instante de evaluación. Una fecha fija sitúa toda la fase en ese
   * momento; `"porLote"` sitúa cada lote en su propio registro más
   * `MARGEN_REVISION_H`, que es lo que corresponde a un conjunto
   * histórico. Por omisión, el reloj del sistema.
   */
  reloj?: Date | "porLote";
  /**
   * `operacion` aplica las seis restricciones. `potencial` aplaza R1 y R4
   * —las dos que dependen de campos que el centro no midió— y marca el
   * resultado como no autorizable. Ver `APLAZABLES` en el dominio.
   */
  modo?: ModoModelo;
  /** Dónde se acumulan la transcripción y las métricas. */
  registro?: Registro;
}

/** Métrica con nombre, unidad y el valor que se reporta. */
export interface Metrica {
  clave: string;
  etiqueta: string;
  valor: number | string | null;
  unidad?: string;
  nota?: string;
}

/**
 * Acumula lo que la fase imprime y lo que la fase mide.
 *
 * Va separado porque son dos públicos distintos: la transcripción es para
 * quien lee el informe, las métricas son para quien quiere compararlas
 * entre ejecuciones o llevarlas a una tabla del artículo.
 */
export class Registro {
  readonly lineas: string[] = [];
  readonly metricas: Metrica[] = [];
  /** Contexto de la ejecución: qué datos, qué reloj, qué modo. */
  readonly contexto: Record<string, unknown> = {};

  constructor(private readonly aConsola = true) {}

  linea(texto = "") {
    this.lineas.push(texto);
    if (this.aConsola) console.log(texto);
  }

  /** Imprime una fila alineada y, si se le da clave, la registra. */
  fila(etiqueta: string, valor: string, nota = "", clave?: string, unidad?: string) {
    this.linea(`  ${etiqueta.padEnd(40)} ${valor.padStart(9)}   ${nota}`);
    if (clave) this.metrica(clave, etiqueta, valor, unidad, nota);
  }

  metrica(clave: string, etiqueta: string, valor: number | string | null,
          unidad?: string, nota?: string) {
    // El valor llega como viene de la tabla: con relleno a la izquierda y
    // a veces con su unidad pegada ("  1652.9 kg", "$ 9387.91", "4.5 %").
    // Para que la métrica sea un número y no una cadena hay que quitar
    // todo eso antes de convertir.
    const limpio = typeof valor === "string"
      ? valor.trim().replace(/[$\s]/g, "").replace(/[a-zA-Z%°]+$/, "").replace(",", ".")
      : valor;
    const n = typeof limpio === "string" ? Number(limpio) : limpio;
    this.metricas.push({
      clave, etiqueta,
      valor: valor === "—" || valor === null ? null
        : Number.isFinite(n as number) ? (n as number) : valor,
      unidad, nota: nota || undefined,
    });
  }

  titulo(texto: string, grueso = false) {
    this.linea();
    this.linea(`  ${texto}`);
    this.linea("  " + (grueso ? "═" : "─").repeat(66));
  }

  /** La transcripción completa, para escribirla a un archivo. */
  texto() { return this.lineas.join("\n"); }
}

/**
 * Instante en que debe evaluarse un lote, según las opciones de la fase.
 *
 * Que sea una función y no un valor es justamente el punto: con un
 * conjunto histórico cada lote tiene su propio «ahora», y usar uno solo
 * para todos es lo que vaciaba las métricas.
 */
export function relojDe(lote: Lote, opciones: OpcionesFase = {}): Date {
  const r = opciones.reloj;
  if (r instanceof Date) return new Date(r);
  if (r === "porLote")
    return new Date(lote.registradoEn.getTime() + MARGEN_REVISION_H * 3_600_000);
  return new Date();
}

/** Instante de referencia para lo que no depende de un lote concreto. */
export function relojGeneral(lotes: Lote[], opciones: OpcionesFase = {}): Date {
  const r = opciones.reloj;
  if (r instanceof Date) return new Date(r);
  if (r === "porLote" && lotes.length) {
    const t = Math.max(...lotes.map((l) => l.registradoEn.getTime()));
    return new Date(t + MARGEN_REVISION_H * 3_600_000);
  }
  return new Date();
}

/**
 * Detecta si el conjunto cargado es histórico, es decir, si evaluarlo con
 * el reloj del sistema no dejaría ningún lote vigente.
 *
 * Sirve para avisar en el encabezado del informe en lugar de dejar que el
 * lector interprete una tabla de ceros como un fallo del modelo.
 */
export function esHistorico(lotes: Lote[], ahora = new Date()): boolean {
  if (lotes.length === 0) return false;
  return lotes.every((l) => l.venceEn.getTime() <= ahora.getTime());
}

/** Describe el reloj elegido, para el encabezado del informe. */
export function describirReloj(opciones: OpcionesFase = {}): string {
  const r = opciones.reloj;
  if (r instanceof Date) return `fijo en ${r.toISOString().slice(0, 16).replace("T", " ")}`;
  if (r === "porLote") return `por lote · registro + ${MARGEN_REVISION_H} h`;
  return "reloj del sistema";
}

export const pct = (a: number, b: number) => b ? `${(a / b * 100).toFixed(1)} %` : "—";

/** Generador reproducible. Las fases no pueden depender de Math.random. */
export function crearAzar(semilla: number) {
  let s = semilla;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
