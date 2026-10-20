/**
 * FoodLoop · Etapa 2 · Restricciones duras
 *
 * Qué recibe:  una receta candidata y los lotes seleccionados.
 * Qué produce: si la receta es admisible, y si no lo es, qué reglas
 *              incumple y cuál de ellas decide el descarte.
 *
 * Las seis reglas son binarias a propósito. Una restricción sanitaria no
 * se compensa con una puntuación alta en otro eje: o se cumple, o la
 * alternativa no existe. Por eso esta etapa va ANTES de la extracción de
 * características y no después: puntuar una receta inviable para
 * descartarla luego sería gastar cálculo en algo que no puede proponerse,
 * y, lo que importa más, dejaría abierta la posibilidad de que un peso
 * alto rescatara una propuesta insegura. Separadas en dos etapas, eso es
 * estructuralmente imposible.
 *
 * Con varios lotes basta que UNO incumpla para descartar la receta
 * entera. No se propone una versión parcial: o la receta se puede hacer
 * con lo seleccionado, o no se propone.
 *
 * Cada regla declara su fundamento. Las cinco primeras provienen del
 * sistema de análisis de peligros y puntos críticos de control (APPCC);
 * la sexta es estructural.
 */

import type { Lote, ItemCatalogo } from "../../modelo/tipos";
import { dictamenDe } from "../../modelo/tipos";
import type {
  CodigoRestriccion, Incumplimiento, SalidaRestricciones,
} from "./tipos";
import { horasRestantes, horasDelConjunto, usablesEn } from "./e1-entrada";

/** Holgura mínima entre el fin de la preparación y el fin de la vida útil. */
export const MARGEN_H = 1;

/** Temperatura a partir de la cual un cocido se considera fuera de cadena. */
export const LIMITE_FRIO_C = 5;

/** Temperatura que debe alcanzar un reproceso para rescatar un cocido. */
export const TEMP_SEGURA_C = 74;

export interface ReglaRestriccion {
  codigo: CodigoRestriccion;
  titulo: string;
  /** Mensaje que ve el usuario cuando esta regla descarta la receta. */
  motivo: string;
  fundamento: string;
  /** Sobre qué se evalúa: un lote suelto o el conjunto completo. */
  alcance: "lote" | "conjunto";
}

export const REGLAS: Record<CodigoRestriccion, ReglaRestriccion> = {
  R0: {
    codigo: "R0",
    titulo: "Coincidencia de ingredientes",
    motivo: "La receta no incluye ninguno de los ingredientes seleccionados.",
    fundamento: "Estructural: sin ingrediente en común no hay nada que medir.",
    alcance: "conjunto",
  },
  R1: {
    codigo: "R1",
    titulo: "Dictamen sanitario favorable",
    motivo: "Alguno de los lotes seleccionados no tiene dictamen sanitario favorable.",
    fundamento: "APPCC. Un lote sin dictamen favorable no vuelve a la cadena "
      + "alimentaria por ninguna vía.",
    alcance: "lote",
  },
  R2: {
    codigo: "R2",
    titulo: "Vida útil vigente",
    motivo: "Alguno de los lotes superó su vida útil.",
    fundamento: "APPCC. La vida útil se deriva del ingrediente y del estado "
      + "del producto; superada, el lote no se reprocesa.",
    alcance: "lote",
  },
  R3: {
    codigo: "R3",
    titulo: "Estado admitido por la receta",
    motivo: "La receta no admite alguno de los lotes en el estado en que se encuentra.",
    fundamento: "Tecnológico. Una receta que parte de producto crudo no "
      + "admite el mismo ingrediente ya cocido, y al contrario.",
    alcance: "lote",
  },
  R4: {
    codigo: "R4",
    titulo: "Cadena de frío de producto cocido",
    motivo: "Un lote cocido fuera de temperatura exige reproceso térmico; la receta no lo aplica.",
    fundamento: `APPCC. Un cocido por encima de ${LIMITE_FRIO_C} °C solo se `
      + `rescata con un tratamiento que alcance ${TEMP_SEGURA_C} °C en el centro `
      + "del producto.",
    alcance: "lote",
  },
  R5: {
    codigo: "R5",
    titulo: "Ventana sanitaria suficiente",
    motivo: "La preparación no termina dentro de la ventana sanitaria del lote más urgente.",
    fundamento: `APPCC. La preparación debe terminar con ${MARGEN_H} h de `
      + "margen sobre el vencimiento del lote más comprometido del conjunto.",
    alcance: "conjunto",
  },
};

/** Orden de evaluación. Fija cuál de varias reglas incumplidas decide. */
export const ORDEN_REGLAS = ["R1", "R2", "R3", "R4"] as const;

/**
 * Evalúa una regla de lote. Devuelve lo observado si la incumple, o null.
 *
 * Están sueltas y nombradas para que cada una pueda probarse por
 * separado: la Fase 2 de la metodología verifica que ninguna propuesta
 * incumple ninguna de ellas, y para eso necesita poder invocarlas una
 * a una.
 */
export const REGLAS_LOTE: Record<
  "R1" | "R2" | "R3" | "R4",
  (lote: Lote, item: ItemCatalogo, ahora: Date) => string | null
> = {
  R1: (lote) => {
    const d = dictamenDe(lote);
    if (d === "apto") return null;
    // Se distingue el lote examinado y rechazado del lote que nadie
    // examinó. Los dos se descartan en operación, pero no son lo mismo:
    // el segundo se resuelve midiendo, y el informe tiene que poder
    // decir cuántos lotes están en cada caso.
    return d === "pendiente"
      ? "dictamen sanitario pendiente: no se midió"
      : "sin dictamen favorable";
  },

  R2: (lote, _item, ahora) => {
    const h = horasRestantes(lote, ahora);
    return h > 0 ? null : `vencido hace ${Math.abs(h).toFixed(1)} h`;
  },

  R3: (lote, item) => {
    const req = item.requisitos.find((r) => r.ingredienteId === lote.ingredienteId);
    if (!req) return null;
    return req.admiteEstado === "ambos" || req.admiteEstado === lote.estadoProducto
      ? null
      : `lote ${lote.estadoProducto}, la receta admite ${req.admiteEstado}`;
  },

  R4: (lote, item) => {
    if (lote.estadoProducto !== "cocido" || lote.temperaturaC <= LIMITE_FRIO_C)
      return null;
    if (item.tipoProceso === "reproceso_termico" && item.tempProcesoC >= TEMP_SEGURA_C)
      return null;
    return `cocido a ${lote.temperaturaC} °C; la receta no alcanza `
      + `${TEMP_SEGURA_C} °C`;
  },
};

/**
 * Aplica las seis reglas y devuelve el veredicto.
 *
 * Se recorren los lotes por fuera y las reglas por dentro, y se recogen
 * TODOS los incumplimientos aunque el primero ya decida. Recoger solo el
 * primero bastaba para filtrar, pero no para explicar: al depurar la
 * importación de datos reales interesa saber que un lote incumple tres
 * reglas y no una.
 */
export function aplicarRestricciones(
  lotes: Lote[], item: ItemCatalogo, ahora: Date,
  aplazar: readonly CodigoRestriccion[] = [],
): SalidaRestricciones {
  const bloqueantes: Incumplimiento[] = [];
  const aplazadas: Incumplimiento[] = [];
  const recoger = (i: Incumplimiento) =>
    (aplazar.includes(i.regla) ? aplazadas : bloqueantes).push(i);
  const usables = usablesEn(lotes, item);

  if (lotes.length === 0 || usables.length === 0) {
    const i: Incumplimiento = {
      regla: "R0", lote: "",
      observado: lotes.length === 0
        ? "selección vacía"
        : "ningún ingrediente de la selección aparece en la receta",
    };
    // R0 no se aplaza nunca: sin ingrediente en común no hay nada que
    // medir ni que calcular.
    return {
      admisible: false, incumplimientos: [i], aplazadas: [],
      decisiva: "R0", usables,
    };
  }

  for (const lote of usables)
    for (const codigo of ORDEN_REGLAS) {
      const observado = REGLAS_LOTE[codigo](lote, item, ahora);
      if (observado) recoger({ regla: codigo, lote: lote.codigo, observado });
    }

  const requiere = item.minutos / 60 + MARGEN_H;
  const ventana = horasDelConjunto(usables, ahora);
  if (requiere > ventana)
    recoger({
      regla: "R5", lote: "",
      observado: `la receta necesita ${requiere.toFixed(1)} h y la ventana es `
        + `de ${ventana.toFixed(1)} h`,
    });

  // La decisiva es la primera que bloquea, en el orden de evaluación.
  const decisiva = bloqueantes[0]?.regla ?? null;
  return {
    admisible: bloqueantes.length === 0,
    incumplimientos: bloqueantes, aplazadas, decisiva, usables,
  };
}
