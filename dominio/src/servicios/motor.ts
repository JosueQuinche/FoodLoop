/**
 * FoodLoop · Motor de correspondencia y explicabilidad
 * Fase 2 de la metodología.
 *
 * Tres etapas, en este orden:
 *   1. Filtros duros  -> descartan alternativas inviables. No puntúan.
 *   2. Puntuación     -> combinación ponderada de factores observables.
 *   3. Explicación    -> descomposición de la puntuación en contribuciones.
 *
 * La etapa 3 no es un añadido posterior: la puntuación se calcula ya
 * descompuesta, de modo que la explicación es la propia aritmética del
 * modelo y no una reconstrucción aproximada.
 */

import type {
  Lote, ItemCatalogo, Factor, Resultado, Descarte, TipoProceso,
} from "../modelo/tipos";

export const VERSION_MODELO = "1.0.0";

/** Pesos del modelo. Declarados aquí para que sean auditables. */
export const PESOS = {
  cobertura: 0.30,      // qué parte de la receta cubre el inventario
  aporteMerma: 0.22,    // qué parte del peso final proviene del excedente
  urgencia: 0.20,       // cuán apremiante es usar el lote
  absorcion: 0.12,      // qué parte del lote consume la preparación
  jerarquia: 0.12,      // escalón en la jerarquía de gestión del excedente
  aceptacion: 0.10,     // valoración histórica del plato
  cargaArea: -0.06,     // penaliza áreas saturadas
} as const;

/**
 * Jerarquía de gestión del excedente (Papargyropoulou et al., 2014).
 * La reutilización culinaria que devuelve el excedente a alimentación
 * humana es preferible a la conservación, que solo aplaza la decisión.
 * Sin este factor el modelo premia las alternativas triviales de un solo
 * ingrediente, que maximizan cobertura sin generar valor nuevo.
 */
const JERARQUIA: Record<TipoProceso, number> = {
  reproceso_termico: 1.0,
  ensamblaje_frio: 1.0,
  panaderia: 0.9,
  conservacion: 0.35,
};

type MotivoDescarte =
  | "no_apto" | "vencido" | "sin_tiempo" | "estado" | "no_usa_lote" | "termico";

const MOTIVOS: Record<MotivoDescarte, string> = {
  no_apto: "El lote no tiene dictamen sanitario favorable.",
  vencido: "El lote superó su vida útil antes de poder procesarse.",
  sin_tiempo: "La preparación no termina dentro de la ventana sanitaria del lote.",
  estado: "La receta no admite el ingrediente en el estado en que se encuentra el lote.",
  no_usa_lote: "La receta no incluye el ingrediente del lote.",
  termico: "Un producto cocido fuera de temperatura exige reproceso térmico; la receta no lo aplica.",
};

export const horasRestantes = (lote: Lote, ahora: Date): number =>
  (lote.venceEn.getTime() - ahora.getTime()) / 3_600_000;

// ---------------------------------------------------------------------
// Etapa 1 · Filtros duros
// ---------------------------------------------------------------------

/**
 * Devuelve el motivo de descarte, o null si la alternativa es viable.
 *
 * Los filtros son binarios a propósito. Una restricción sanitaria no se
 * compensa con una puntuación alta en otro factor: o se cumple, o la
 * alternativa no existe. Mezclarla con el resto de criterios en una suma
 * ponderada permitiría que una receta muy conveniente superase una
 * barrera de inocuidad, que es justo lo que no debe ocurrir.
 */
export function filtrosDuros(
  lote: Lote, item: ItemCatalogo, ahora: Date,
): MotivoDescarte | null {
  if (!lote.aptoReproceso) return "no_apto";
  if (horasRestantes(lote, ahora) <= 0) return "vencido";

  const req = item.requisitos.find((r) => r.ingredienteId === lote.ingredienteId);
  if (!req) return "no_usa_lote";
  if (req.admiteEstado !== "ambos" && req.admiteEstado !== lote.estadoProducto)
    return "estado";

  // el proceso debe caber en la ventana sanitaria, con 1 h de margen
  if (item.minutos / 60 + 1 > horasRestantes(lote, ahora)) return "sin_tiempo";

  // producto cocido que rompió cadena de frío: solo se salva con
  // tratamiento térmico que alcance temperatura de seguridad
  if (lote.estadoProducto === "cocido" && lote.temperaturaC > 5) {
    if (item.tipoProceso !== "reproceso_termico" || item.tempProcesoC < 74)
      return "termico";
  }
  return null;
}

// ---------------------------------------------------------------------
// Etapas 2 y 3 · Puntuación descompuesta
// ---------------------------------------------------------------------

/**
 * Factor de escalado de la receta para absorber el lote. Se escala para
 * consumir el lote completo, pero sin exceder lo que permita el
 * ingrediente más limitante del resto de la receta.
 */
function calcularEscala(
  lote: Lote, item: ItemCatalogo, disponibles: Map<number, number>,
): number {
  const base = item.requisitos.find((r) => r.ingredienteId === lote.ingredienteId);
  if (!base || base.cantidad <= 0) return 1;
  const deseada = lote.cantidad / base.cantidad;
  let tope = deseada;
  for (const r of item.requisitos) {
    if (r.ingredienteId === lote.ingredienteId) continue;
    const disp = disponibles.get(r.ingredienteId) ?? 0;
    if (r.cantidad > 0 && disp > 0) tope = Math.min(tope, disp / r.cantidad);
  }
  return Math.max(0.25, Math.min(deseada, tope, 4));
}

export function evaluar(
  lote: Lote, item: ItemCatalogo, disponibles: Map<number, number>,
  cargaArea: number, ahora: Date,
): Resultado {
  const factores: Factor[] = [];
  const req = item.requisitos;
  const base = req.find((r) => r.ingredienteId === lote.ingredienteId)!;

  // --- factor 1: cobertura de requisitos -----------------------------
  // faltar un ingrediente principal pesa el doble que faltar uno accesorio
  const pesoTotal = req.reduce((a, r) => a + (r.esPrincipal ? 2 : 1), 0);
  const pesoCubierto = req.reduce(
    (a, r) => a + ((disponibles.get(r.ingredienteId) ?? 0) >= r.cantidad
      ? (r.esPrincipal ? 2 : 1) : 0), 0);
  let cobertura = pesoTotal ? pesoCubierto / pesoTotal : 0;
  // una alternativa con un único requisito alcanza cobertura total sin
  // aportar combinación; se atenúa para no premiar la trivialidad
  if (req.length === 1) cobertura *= 0.6;
  const faltantes = req.filter(
    (r) => (disponibles.get(r.ingredienteId) ?? 0) < r.cantidad).length;
  factores.push({
    nombre: "Disponibilidad de los ingredientes de la receta",
    valorObservado: `${req.length - faltantes} de ${req.length} en inventario`,
    peso: PESOS.cobertura, contribucion: cobertura * PESOS.cobertura * 100,
  });

  // --- factor 2: aporte de merma al peso final -----------------------
  const escala = calcularEscala(lote, item, disponibles);
  const pesoRecetaKg = (item.porcionesBase * item.pesoPorcionG / 1000) * escala;
  const kgUsados = Math.min(lote.cantidad, base.cantidad * escala);
  const aporte = pesoRecetaKg ? Math.min(1, kgUsados / pesoRecetaKg) : 0;
  factores.push({
    nombre: "Proporción del plato que proviene de la merma",
    valorObservado: `${Math.round(aporte * 100)} % del peso final`,
    peso: PESOS.aporteMerma, contribucion: aporte * PESOS.aporteMerma * 100,
  });

  // --- factor 3: urgencia --------------------------------------------
  // decae linealmente: 48 h o más no es urgente, 0 h es máxima urgencia
  const horas = horasRestantes(lote, ahora);
  const urgencia = Math.max(0, Math.min(1, (48 - horas) / 48));
  factores.push({
    nombre: "Vida útil restante del lote",
    valorObservado: `${horas.toFixed(0)} h`,
    peso: PESOS.urgencia, contribucion: urgencia * PESOS.urgencia * 100,
  });

  // --- factor 4: absorción del lote ----------------------------------
  const absorcion = lote.cantidad ? Math.min(1, kgUsados / lote.cantidad) : 0;
  factores.push({
    nombre: "Parte del lote que consume la preparación",
    valorObservado: `${kgUsados.toFixed(1)} de ${lote.cantidad.toFixed(1)} ${lote.unidad}`,
    peso: PESOS.absorcion, contribucion: absorcion * PESOS.absorcion * 100,
  });

  // --- factor 5: jerarquía de aprovechamiento ------------------------
  const jer = JERARQUIA[item.tipoProceso];
  factores.push({
    nombre: "Nivel en la jerarquía de aprovechamiento",
    valorObservado: jer >= 0.9
      ? "Reutilización culinaria directa"
      : "Conservación; aplaza la decisión",
    peso: PESOS.jerarquia, contribucion: jer * PESOS.jerarquia * 100,
  });

  // --- factor 6: aceptación histórica --------------------------------
  const acept = (item.aceptacion - 1) / 4;
  factores.push({
    nombre: "Aceptación histórica del plato",
    valorObservado: `${item.aceptacion.toFixed(1)} / 5`,
    peso: PESOS.aceptacion, contribucion: acept * PESOS.aceptacion * 100,
  });

  // --- factor 7: carga del área (penalización) -----------------------
  factores.push({
    nombre: "Carga de trabajo del área",
    valorObservado: `${item.area} al ${Math.round(cargaArea * 100)} %`,
    peso: PESOS.cargaArea, contribucion: cargaArea * PESOS.cargaArea * 100,
  });

  const aptitud = Math.round(Math.max(0, Math.min(100,
    factores.reduce((a, f) => a + f.contribucion, 0))) * 10) / 10;

  return {
    item, aptitud, factores,
    kgAprovechados: Math.round(kgUsados * 100) / 100,
    porciones: Math.round(item.porcionesBase * escala),
    costoRecuperado: Math.round(kgUsados * lote.costoUnitario * 100) / 100,
    escala,
    resumen: `Se propone «${item.nombre}» porque ${lote.ingrediente.toLowerCase()} `
      + `está ${lote.estadoProducto} y vence en ${horas.toFixed(0)} horas. `
      + `La preparación rinde ${Math.round(item.porcionesBase * escala)} porciones `
      + `y el ${Math.round(aporte * 100)} % de su peso proviene del lote.`,
    contrafactuales: contrafactuales(lote, item, horas, faltantes),
  };
}

/**
 * Explicación contrafactual: qué tendría que cambiar para otra salida.
 * Nunes y Jannach (2017) señalan que este tipo de explicación es la que
 * mejor sostiene la confianza, porque delimita el alcance de la decisión.
 */
function contrafactuales(
  lote: Lote, item: ItemCatalogo, horas: number, faltantes: number,
): string[] {
  const out: string[] = [];
  if (horas > 6)
    out.push(`Con menos de ${(item.minutos / 60 + 1).toFixed(0)} horas de vida `
      + `útil, esta alternativa quedaría descartada por no caber en la ventana `
      + `sanitaria.`);
  out.push(faltantes === 0
    ? "Si faltara alguno de los ingredientes complementarios, la aptitud bajaría "
      + "y otra receta pasaría al primer lugar."
    : `Faltan ${faltantes} ingrediente(s) en inventario. Reponerlos elevaría la `
      + `aptitud de esta alternativa.`);
  out.push(lote.estadoProducto === "cocido"
    ? "Si el producto estuviera crudo, se abrirían alternativas de cocción "
      + "directa que hoy no se evalúan."
    : "Si el producto estuviera cocido, esta alternativa se descartaría y solo "
      + "quedarían reprocesos térmicos.");
  return out;
}

// ---------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------

/**
 * Devuelve las mejores alternativas y la lista de descartes con motivo.
 * Devolver también los descartes es deliberado: la trazabilidad de por
 * qué NO se propuso algo forma parte de la explicabilidad.
 */
export function recomendar(
  lote: Lote, catalogo: ItemCatalogo[], disponibles: Map<number, number>,
  cargas: Map<number, number>, ahora: Date, topN = 3,
): { resultados: Resultado[]; descartes: Descarte[] } {
  const resultados: Resultado[] = [];
  const descartes: Descarte[] = [];

  for (const item of catalogo) {
    const motivo = filtrosDuros(lote, item, ahora);
    if (motivo) {
      // "no_usa_lote" es ruido: la mayoría del catálogo no usa el lote
      if (motivo !== "no_usa_lote")
        descartes.push({ alternativa: item.nombre, motivo: MOTIVOS[motivo] });
      continue;
    }
    resultados.push(
      evaluar(lote, item, disponibles, cargas.get(item.areaId) ?? 0, ahora));
  }

  resultados.sort((a, b) => b.aptitud - a.aptitud);
  return { resultados: resultados.slice(0, topN), descartes };
}
