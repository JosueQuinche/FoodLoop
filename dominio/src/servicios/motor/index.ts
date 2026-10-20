/**
 * FoodLoop · Motor de recomendación y explicabilidad
 * Fase 2 de la metodología.
 *
 * ARQUITECTURA DEL MODELO
 *
<<<<<<< HEAD
 * Desde la versión 3 el modelo es HÍBRIDO: restricciones sanitarias
 * duras, un valor de aprovechamiento de criterio experto y un
 * componente de APRENDIZAJE AUTOMÁTICO supervisado —regresión
 * logística— que estima sobre el histórico la probabilidad de que cada
 * propuesta se ejecute. La aptitud es el valor esperado de las dos:
 *
 *     aptitud = P(ejecución | x) × valor de aprovechamiento(x)
 *
 * Lo que se aprende y lo que no:
 *
 *   · Las restricciones sanitarias NO se aprenden. Son normas, no
 *     patrones, y van antes de puntuar (E2).
 *   · El objetivo —aprovechar merma según la jerarquía del excedente—
 *     NO se aprende. Se declara en los siete pesos de valor.
 *   · SÍ se aprende qué propuestas llega a ejecutar la cocina: los
 *     nueve coeficientes de la probabilidad, estimados con
 *     `npm run ml:entrenar` y escritos en `modelo-aprendido.ts`.
=======
 * El modelo es un recomendador basado en conocimiento con explicación
 * incorporada. No aprende de ejemplos: ordena alternativas según un
 * criterio declarado, porque en el arranque de una operación no existe
 * histórico de decisiones del que aprender, y porque las restricciones
 * sanitarias no son algo que convenga inducir de datos.
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
 *
 * Se ejecuta en seis etapas, cada una en su propio archivo, con su
 * entrada y su salida declaradas:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │  E1 · ENTRADA DE DATOS                      e1-entrada.ts       │
 *   │  lotes + catálogo + inventario + cargas + instante              │
 *   │  → entrada depurada, con registro de lo rechazado               │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │  E2 · RESTRICCIONES DURAS                   e2-restricciones.ts │
 *   │  seis reglas binarias, cinco de ellas sanitarias                │
 *   │  → recetas admisibles / descartadas, con la regla decisiva       │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │  E3 · EXTRACCIÓN DE CARACTERÍSTICAS      e3-caracteristicas.ts  │
 *   │  la situación de cocina medida en siete ejes                    │
 *   │  → vector de siete números en [0,1], sin pesos                  │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │  E4 · PUNTUACIÓN                            e4-puntuacion.ts    │
<<<<<<< HEAD
 *   │  valor (7 pesos expertos) × P(ejecución) (regresión logística)  │
=======
 *   │  combinación lineal del vector con los pesos del modelo         │
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
 *   │  → aptitud en [0,100] y contribución de cada eje                │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │  E5 · ORDENAMIENTO                          e5-ordenamiento.ts  │
 *   │  aptitud y tres desempates declarados                           │
 *   │  → las N mejores                                                │
 *   ├──────────────────────────────────────────────────────────────────┤
 *   │  E6 · EXPLICACIÓN                           e6-explicacion.ts   │
 *   │  descomposición, resumen y contrafactual                        │
 *   │  → lo que el usuario lee                                        │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Los parámetros del modelo —los siete pesos— viven aparte, en
 * `pesos.ts`, con su procedencia declarada.
 *
 * POR QUÉ SEIS ARCHIVOS Y NO UNO
 *
 * El motor estuvo en un solo archivo de 488 líneas y funcionaba igual.
 * Lo que no permitía era mirarlo por partes: la medición y la
 * ponderación estaban entrelazadas en la misma función, de modo que no
 * se podía comprobar el vector de características sin discutir a la vez
 * los pesos, ni sustituir los pesos sin tocar el código que mide. Con
 * las etapas separadas, cada una se prueba sola —`npm run modelo:probar`
 * lo hace— y la traza de ejecución puede decir qué hizo cada una.
 *
 * LO QUE EL MODELO NO HACE TODAVÍA
 *
<<<<<<< HEAD
 * La variable que el componente aprendido predice es un sustituto: que
 * la receta se produzca en el centro dentro de las 48 h siguientes al
 * lote. Dice que la propuesta encaja en el menú real, no que la merma
 * se usara efectivamente en ella; para eso hace falta registrar las
 * decisiones del chef sobre las propuestas, que es lo que el bucle de
 * retroalimentación empieza a acumular.
=======
 * Los pesos están fijados por criterio experto, no estimados sobre
 * datos. El único componente que se ajusta con el uso es la aceptación
 * histórica de cada plato, que se actualiza con las decisiones
 * registradas. Para ajustar los siete pesos hace falta el histórico de
 * decisiones del centro de producción: qué se hizo realmente con cada
 * lote de merma. Mientras no exista, el modelo se verifica —cumple lo
 * que promete— pero no se valida contra la práctica.
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
 */

import type {
  Lote, ItemCatalogo, Resultado, Descarte, Sugerencia,
} from "../../modelo/tipos";
import type {
  Candidata, SalidaModelo, TrazaEtapa, TrazaModelo, EntradaModelo,
  CodigoRestriccion, Incumplimiento,
} from "./tipos";
<<<<<<< HEAD
import type { VectorPesos, ModeloAprendido } from "./pesos";
import { PESOS } from "./pesos";
import { MODELO_APRENDIDO } from "./modelo-aprendido";
import type { ModoPuntuacion } from "./tipos";
=======
import type { VectorPesos } from "./pesos";
import { PESOS } from "./pesos";
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
import { normalizarEntrada, horasRestantes } from "./e1-entrada";
import { aplicarRestricciones, REGLAS } from "./e2-restricciones";
import { extraerCaracteristicas } from "./e3-caracteristicas";
import { puntuar } from "./e4-puntuacion";
import { ordenar } from "./e5-ordenamiento";
<<<<<<< HEAD
import {
  descomponer, descomponerEjecucion, resumir, contrafactual,
} from "./e6-explicacion";

export const VERSION_MODELO = "3.0.0";
=======
import { descomponer, resumir, contrafactual } from "./e6-explicacion";

export const VERSION_MODELO = "2.1.0";
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6

export * from "./pesos";
export * from "./tipos";
export * from "./ficha";
<<<<<<< HEAD
export { MODELO_APRENDIDO } from "./modelo-aprendido";
=======
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
export { horasRestantes, horasDelConjunto, usablesEn, normalizarEntrada } from "./e1-entrada";
export {
  aplicarRestricciones, REGLAS, REGLAS_LOTE, ORDEN_REGLAS,
  MARGEN_H, LIMITE_FRIO_C, TEMP_SEGURA_C,
} from "./e2-restricciones";
export {
<<<<<<< HEAD
  extraerCaracteristicas, calcularEscala, repartir, senalesOperacion, diaLocal,
  JERARQUIA, HORIZONTE_URGENCIA_H, ESCALA_MAX, ESCALA_MIN,
} from "./e3-caracteristicas";
export { puntuar, entradasAprendidas } from "./e4-puntuacion";
export { ordenar } from "./e5-ordenamiento";
export {
  descomponer, descomponerEjecucion, resumir, contrafactual,
} from "./e6-explicacion";
=======
  extraerCaracteristicas, calcularEscala, repartir,
  JERARQUIA, HORIZONTE_URGENCIA_H, ESCALA_MAX, ESCALA_MIN,
} from "./e3-caracteristicas";
export { puntuar } from "./e4-puntuacion";
export { ordenar } from "./e5-ordenamiento";
export { descomponer, resumir, contrafactual } from "./e6-explicacion";
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6

/**
 * Modo de ejecución del modelo.
 *
 *   operacion  el normal. Las seis reglas bloquean. Una propuesta que
 *              sale es una propuesta que la cocina puede ejecutar.
 *
 *   potencial  para datos en los que el dictamen o la temperatura no se
 *              midieron. R1 y R4 se evalúan igual, pero en lugar de
 *              bloquear quedan aplazadas: la receta se puntúa, se
 *              explica y sale marcada `autorizable: false`, con la lista
 *              de lo que habría que medir.
 *
 * El segundo modo existe porque los registros históricos del centro de
 * producción no traen esos dos campos. Con solo el modo de operación la
 * respuesta sobre esos registros es «ninguna recomendación» para todos
 * los lotes, que es correcto pero no dice nada; con el modo potencial se
 * puede responder qué se habría podido aprovechar y qué faltó medir para
 * autorizarlo, que es lo que el centro necesita saber.
 *
 * Lo que NO se aplaza nunca: R0, R2, R3 y R5. No dependen de una
 * medición ausente sino de datos que los registros sí traen —la fecha,
 * el estado del producto y el recetario—, de modo que aplazarlas sería
 * ocultar un incumplimiento real.
 */
export type ModoModelo = "operacion" | "potencial";

/** Reglas que el modo potencial aplaza, y por qué cada una. */
export const APLAZABLES: Record<"R1" | "R4", string> = {
  R1: "el dictamen sanitario no se midió",
  R4: "la temperatura del lote no se midió",
};

export interface OpcionesModelo {
  topN?: number;
  /** Pesos con que puntuar. Por defecto, los del modelo. */
  pesos?: VectorPesos;
  /** Por defecto `operacion`. */
  modo?: ModoModelo;
<<<<<<< HEAD
  /** Coeficientes del componente aprendido. Por defecto, los entrenados. */
  modelo?: ModeloAprendido;
  /**
   * `aprendida` (por defecto) puntúa con P × valor; `experta` reproduce
   * el modelo 2 para poder comparar las dos versiones.
   */
  puntuacion?: ModoPuntuacion;
=======
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
}

/** Construye el `Resultado` que consume la interfaz, desde las etapas. */
function componer(
  c: Candidata, usables: Lote[], pesos: VectorPesos,
  aplazadas: Incumplimiento[] = [],
): Resultado {
  const { item, caracteristicas: car, puntuacion: p } = c;
  const base: Resultado = {
    item,
    aptitud: p.aptitud,
    factores: descomponer(car, p, pesos),
<<<<<<< HEAD
    ...(p.modo === "aprendida" ? {
      probabilidadEjecucion: Math.round(p.probabilidad * 1000) / 1000,
      valorAprovechamiento: p.valor,
      factoresEjecucion: descomponerEjecucion(car, p),
      interceptoEjecucion: p.intercepto,
    } : {}),
=======
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
    aportes: car.aportes,
    kgAprovechados: Math.round(car.kgUsados * 100) / 100,
    porciones: Math.round(item.porcionesBase * car.escala),
    costoRecuperado: car.costoRecuperado,
    valorEnRiesgo: car.valorEnRiesgo,
    escala: car.escala,
    resumen: resumir(car, item),
    contrafactuales: contrafactual(car, item, usables),
  };
  // Los dos campos solo aparecen cuando hay algo que decir, de modo que
  // una propuesta del modo de operación es idéntica a la de antes.
  if (aplazadas.length === 0) return base;
  return {
    ...base,
    autorizable: false,
    faltaMedir: [...new Set(aplazadas.map(
      (i) => `${i.lote}: ${APLAZABLES[i.regla as "R1" | "R4"] ?? i.observado}`))],
  };
}

/**
 * Ejecuta el modelo completo y devuelve, además del resultado, la traza
 * de lo que hizo cada etapa.
 *
 * La traza no es instrumentación de depuración: es lo que permite
 * responder, de una recomendación concreta, qué datos entraron, qué
 * reglas se aplicaron, qué se midió, con qué pesos se combinó y de dónde
 * sale la frase que el usuario lee. Un modelo que no puede responder eso
 * no es auditable, y uno que no es auditable no debería decidir sobre
 * inocuidad alimentaria.
 */
export function ejecutarModelo(
  lotes: Lote[],
  catalogo: ItemCatalogo[],
  inventario: Map<number, number>,
  cargas: Map<number, number>,
  ahora: Date,
  opciones: OpcionesModelo = {},
): SalidaModelo {
  const topN = opciones.topN ?? 3;
  const pesos = opciones.pesos ?? PESOS;
<<<<<<< HEAD
  const modelo = opciones.modelo ?? MODELO_APRENDIDO;
  const modoPunt: ModoPuntuacion = opciones.puntuacion ?? "aprendida";
=======
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
  const modo: ModoModelo = opciones.modo ?? "operacion";
  const aplazar: CodigoRestriccion[] =
    modo === "potencial" ? ["R1", "R4"] : [];
  const etapas: TrazaEtapa[] = [];
  const t0 = Date.now();
  const marca = () => Date.now();

  // --- E1 · entrada de datos ----------------------------------------
  let t = marca();
  const { entrada, rechazos } = normalizarEntrada(
    lotes, catalogo, inventario, cargas, ahora);
  etapas.push({
    codigo: "E1", nombre: "Entrada de datos",
    entra: `${lotes.length} lotes · ${catalogo.length} recetas · `
      + `${inventario.size} ingredientes en bodega`,
    sale: `${entrada.lotes.length} lotes · ${entrada.catalogo.length} recetas`
      + (rechazos.length ? ` · ${rechazos.length} rechazos` : ""),
    ms: marca() - t,
    detalle: {
      lotes: entrada.lotes.map((l) => l.codigo),
      kgSeleccionados: entrada.lotes.reduce((a, l) => a + l.cantidad, 0),
      horasMinimas: entrada.lotes.length
        ? Math.min(...entrada.lotes.map((l) => horasRestantes(l, ahora)))
        : null,
      rechazos,
    },
  });

  // --- E2 · restricciones duras -------------------------------------
  t = marca();
  const admisibles: {
    item: ItemCatalogo; usables: Lote[]; aplazadas: Incumplimiento[];
  }[] = [];
  const descartes: Descarte[] = [];
  const descartesDetallados: TrazaModelo["descartesDetallados"] = [];
  const porRegla = new Map<CodigoRestriccion, number>();
  const porReglaAplazada = new Map<CodigoRestriccion, number>();

  for (const item of entrada.catalogo) {
    const v = aplicarRestricciones(entrada.lotes, item, entrada.ahora, aplazar);
    for (const a of v.aplazadas)
      porReglaAplazada.set(a.regla, (porReglaAplazada.get(a.regla) ?? 0) + 1);
    if (v.admisible) {
      admisibles.push({ item, usables: v.usables, aplazadas: v.aplazadas });
      continue;
    }
    porRegla.set(v.decisiva!, (porRegla.get(v.decisiva!) ?? 0) + 1);
    descartesDetallados.push({
      receta: item.codigo, decisiva: v.decisiva,
      incumplimientos: v.incumplimientos,
    });
    // R0 no se reporta al usuario: la mayoría del catálogo no comparte
    // ingrediente con la selección y listarlo sería ruido, no trazabilidad.
    if (v.decisiva !== "R0")
      descartes.push({ alternativa: item.nombre, motivo: REGLAS[v.decisiva!].motivo });
  }
  etapas.push({
    codigo: "E2", nombre: "Restricciones duras",
    entra: `${entrada.catalogo.length} recetas candidatas`,
    sale: `${admisibles.length} admisibles · `
      + `${entrada.catalogo.length - admisibles.length} descartadas`
      + (porReglaAplazada.size ? " · reglas aplazadas por falta de medición" : ""),
    ms: marca() - t,
    detalle: {
      modo,
      porRegla: Object.fromEntries([...porRegla].map(
        ([r, n]) => [`${r} ${REGLAS[r].titulo}`, n])),
      aplazadas: Object.fromEntries([...porReglaAplazada].map(
        ([r, n]) => [`${r} ${REGLAS[r].titulo}`, n])),
      admisibles: admisibles.map((a) => a.item.codigo),
    },
  });

  // --- E3 · extracción de características ---------------------------
  t = marca();
  const conCaracteristicas = admisibles.map((a) => ({
    ...a,
    caracteristicas: extraerCaracteristicas(a.usables, a.item, entrada),
  }));
  etapas.push({
    codigo: "E3", nombre: "Extracción de características",
    entra: `${admisibles.length} recetas admisibles`,
<<<<<<< HEAD
    sale: `${conCaracteristicas.length} vectores de 7 características `
      + "y 2 señales de operación",
=======
    sale: `${conCaracteristicas.length} vectores de 7 características`,
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
    ms: marca() - t,
    detalle: {
      ejes: ["cobertura", "aporteMerma", "urgencia", "absorcion",
        "jerarquia", "aceptacion", "cargaArea"],
<<<<<<< HEAD
      senales: ["frecuenciaMenu", "recenciaMenu"],
=======
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
      vectores: conCaracteristicas.map((c) => ({
        receta: c.item.codigo,
        escala: Math.round(c.caracteristicas.escala * 100) / 100,
        valores: c.caracteristicas.valores,
<<<<<<< HEAD
        senales: c.caracteristicas.senales,
=======
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
      })),
    },
  });

  // --- E4 · puntuación -----------------------------------------------
  t = marca();
  const candidatas: Candidata[] = conCaracteristicas.map((c) => ({
    item: c.item,
    caracteristicas: c.caracteristicas,
<<<<<<< HEAD
    puntuacion: puntuar(c.caracteristicas, pesos, modelo, modoPunt),
=======
    puntuacion: puntuar(c.caracteristicas, pesos),
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
  }));
  const recortadas = candidatas.filter((c) => c.puntuacion.recortada).length;
  etapas.push({
    codigo: "E4", nombre: "Puntuación",
<<<<<<< HEAD
    entra: modoPunt === "aprendida"
      ? `${candidatas.length} vectores · 7 pesos de valor · 9 coeficientes aprendidos`
      : `${candidatas.length} vectores · 7 pesos`,
=======
    entra: `${candidatas.length} vectores · 7 pesos`,
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
    sale: `${candidatas.length} aptitudes en [0,100]`
      + (recortadas ? ` · ${recortadas} recortadas` : ""),
    ms: marca() - t,
    detalle: {
      pesos,
<<<<<<< HEAD
      puntuacion: modoPunt,
      modeloAprendido: modoPunt === "aprendida"
        ? { version: modelo.version, intercepto: modelo.intercepto,
            coeficientes: modelo.coeficientes }
        : null,
      recortadas,
      aptitudes: candidatas.map((c) => [c.item.codigo, c.puntuacion.aptitud]),
      probabilidades: candidatas.map((c) =>
        [c.item.codigo, Math.round(c.puntuacion.probabilidad * 1000) / 1000]),
=======
      recortadas,
      aptitudes: candidatas.map((c) => [c.item.codigo, c.puntuacion.aptitud]),
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
    },
  });

  // --- E5 · ordenamiento ----------------------------------------------
  t = marca();
  const { ranking, fueraDeCorte } = ordenar(candidatas, topN);
  etapas.push({
    codigo: "E5", nombre: "Ordenamiento",
    entra: `${candidatas.length} candidatas puntuadas`,
    sale: `${ranking.length} propuestas · ${fueraDeCorte} fuera de corte`,
    ms: marca() - t,
    detalle: {
      corte: topN,
      ranking: ranking.map((c, i) => [i + 1, c.item.codigo, c.puntuacion.aptitud]),
    },
  });

  // --- E6 · explicación ------------------------------------------------
  t = marca();
  const porItem = new Map(admisibles.map((a) => [a.item.id, a]));
  const resultados = ranking.map((c) => {
    const a = porItem.get(c.item.id);
    return componer(c, a?.usables ?? [], pesos, a?.aplazadas ?? []);
  });
  etapas.push({
    codigo: "E6", nombre: "Explicación",
    entra: `${ranking.length} propuestas`,
<<<<<<< HEAD
    sale: `${resultados.length} explicaciones · 7 factores de valor · `
      + (modoPunt === "aprendida" ? "9 de ejecución · " : "")
=======
    sale: `${resultados.length} explicaciones · 7 factores · `
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
      + "1 resumen · 1 contrafactual cada una",
    ms: marca() - t,
    detalle: {
      comprobacion: resultados.map((r) => ({
        receta: r.item.codigo,
        aptitud: r.aptitud,
<<<<<<< HEAD
        valor: r.valorAprovechamiento ?? r.aptitud,
        // Las contribuciones deben sumar el valor. Es la comprobación
=======
        // Las contribuciones deben sumar la aptitud. Es la comprobación
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
        // de que la explicación es la aritmética del modelo y no un
        // relato construido aparte.
        sumaFactores: Math.round(
          r.factores.reduce((a, f) => a + f.contribucion, 0) * 10) / 10,
<<<<<<< HEAD
        // Y las del componente aprendido, más el intercepto, el logit.
        probabilidad: r.probabilidadEjecucion ?? null,
        probabilidadDesdeFactores: r.factoresEjecucion
          ? Math.round(1000 / (1 + Math.exp(-(
            (r.interceptoEjecucion ?? 0)
            + r.factoresEjecucion.reduce((a, f) => a + f.contribucion, 0))))) / 1000
          : null,
=======
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
      })),
    },
  });

  const traza: TrazaModelo = {
    version: VERSION_MODELO,
    generadaEn: ahora,
    pesos,
    etapas,
    vectores: candidatas.map((c) => ({
      receta: c.item.codigo,
      valores: c.caracteristicas.valores,
      contribuciones: c.puntuacion.contribuciones,
<<<<<<< HEAD
      senales: c.caracteristicas.senales,
      valor: c.puntuacion.valor,
      probabilidad: c.puntuacion.probabilidad,
=======
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
      aptitud: c.puntuacion.aptitud,
    })),
    descartesDetallados,
    ms: Date.now() - t0,
  };

  return { resultados, descartes, traza };
}

/**
 * Superficie estable del motor.
 *
 * Devuelve las mejores alternativas y la lista de descartes con motivo.
 * Devolver también los descartes es deliberado: la trazabilidad de por
 * qué NO se propuso algo forma parte de la explicabilidad.
 *
 * Quien necesite la traza por etapas usa `ejecutarModelo`.
 */
export function recomendar(
  lotes: Lote[], catalogo: ItemCatalogo[], disponibles: Map<number, number>,
  cargas: Map<number, number>, ahora: Date, topN = 3,
): { resultados: Resultado[]; descartes: Descarte[] } {
  const { resultados, descartes } = ejecutarModelo(
    lotes, catalogo, disponibles, cargas, ahora, { topN });
  return { resultados, descartes };
}

/**
 * Evalúa UNA receta contra un conjunto de lotes, sin filtros ni orden.
 *
 * Se conserva porque las pruebas de propiedades de la Fase 2 necesitan
 * puntuar una receta concreta aunque las restricciones la descarten, para
 * comprobar precisamente que la descartan.
 */
export function evaluar(
  lotes: Lote[], item: ItemCatalogo, disponibles: Map<number, number>,
  cargaArea: number, ahora: Date, pesos: VectorPesos = PESOS,
<<<<<<< HEAD
  modelo: ModeloAprendido = MODELO_APRENDIDO,
  modoPunt: ModoPuntuacion = "aprendida",
=======
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
): Resultado {
  const entrada: EntradaModelo = {
    lotes, catalogo: [item], inventario: disponibles,
    cargaPorArea: new Map([[item.areaId, cargaArea]]), ahora,
  };
  const usables = aplicarRestricciones(lotes, item, ahora).usables;
  const caracteristicas = extraerCaracteristicas(usables, item, entrada);
  const candidata: Candidata = {
<<<<<<< HEAD
    item, caracteristicas,
    puntuacion: puntuar(caracteristicas, pesos, modelo, modoPunt),
=======
    item, caracteristicas, puntuacion: puntuar(caracteristicas, pesos),
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
  };
  return componer(candidata, usables, pesos);
}

/**
 * Compatibilidad: devuelve el motivo de descarte con los nombres que ya
 * usan las fases de la metodología, o null si la receta es admisible.
 *
 * Es una traducción de los códigos de regla a los nombres anteriores. Se
 * mantiene para no reescribir las cuatro fases y sus evidencias; el
 * código nuevo usa `aplicarRestricciones`, que además dice qué lote
 * incumple qué regla.
 */
const NOMBRE_LEGADO: Record<CodigoRestriccion, string> = {
  R0: "no_usa_lotes", R1: "no_apto", R2: "vencido",
  R3: "estado", R4: "termico", R5: "sin_tiempo",
};

export function filtrosDuros(
  lotes: Lote[], item: ItemCatalogo, ahora: Date,
): "no_apto" | "vencido" | "sin_tiempo" | "estado" | "no_usa_lotes" | "termico" | null {
  const v = aplicarRestricciones(lotes, item, ahora);
  if (v.admisible) return null;
  return NOMBRE_LEGADO[v.decisiva!] as
    "no_apto" | "vencido" | "sin_tiempo" | "estado" | "no_usa_lotes" | "termico";
}

// ---------------------------------------------------------------------
// Sugerencia de lotes compatibles
// ---------------------------------------------------------------------

/**
 * Señala lotes no seleccionados que mejorarían la propuesta.
 *
 * La selección la decide el usuario; el sistema solo indica la
 * oportunidad. Un chef conoce restricciones que el modelo no ve, como
 * que dos lotes están en cámaras distintas o que uno ya está
 * comprometido para otro servicio, de modo que combinar automáticamente
 * produciría propuestas inaplicables.
 *
 * Se evalúa cada candidato por separado, no todas las combinaciones
 * posibles: el coste es lineal en el número de candidatos en lugar de
 * exponencial, y el usuario puede encadenar sugerencias si quiere
 * combinar tres o más lotes.
 */
export function sugerirLotes(
  seleccionados: Lote[], candidatos: Lote[], catalogo: ItemCatalogo[],
  disponibles: Map<number, number>, cargas: Map<number, number>,
  ahora: Date, maximo = 3,
): Sugerencia[] {
  if (seleccionados.length === 0) return [];

  const base = recomendar(seleccionados, catalogo, disponibles, cargas, ahora, 1);
  const aptitudBase = base.resultados[0]?.aptitud ?? 0;
  const yaElegidos = new Set(seleccionados.map((l) => l.id));

  const sugerencias: Sugerencia[] = [];
  for (const cand of candidatos) {
    if (yaElegidos.has(cand.id)) continue;
    if (!cand.aptoReproceso || horasRestantes(cand, ahora) <= 0) continue;

    const conCandidato = recomendar(
      [...seleccionados, cand], catalogo, disponibles, cargas, ahora, 1);
    const nueva = conCandidato.resultados[0]?.aptitud ?? 0;
    const ganancia = Math.round((nueva - aptitudBase) * 10) / 10;

    // Un umbral bajo llenaría la interfaz de sugerencias irrelevantes.
    if (ganancia >= 2)
      sugerencias.push({
        lote: cand,
        gananciaAptitud: ganancia,
        motivo: `Añadir ${cand.cantidad.toFixed(1)} ${cand.unidad} de `
          + `${cand.ingrediente.toLowerCase()} elevaría la aptitud de `
          + `${aptitudBase.toFixed(0)} a ${nueva.toFixed(0)}.`,
      });
  }

  return sugerencias
    .sort((a, b) => b.gananciaAptitud - a.gananciaAptitud)
    .slice(0, maximo);
}
