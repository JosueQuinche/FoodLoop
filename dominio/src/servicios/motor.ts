/**
 * FoodLoop · Motor de correspondencia y explicabilidad
 * Fase 2 de la metodología.
 *
 * Evalúa un CONJUNTO de lotes disponibles contra el catálogo de
 * alternativas. Una misma receta puede cubrirse con varios lotes de
 * merma, que es como ocurre en una cocina real: el salteado sale del
 * pollo de ayer más el arroz de esta mañana.
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
  AporteLote, Sugerencia, Requisito,
} from "../modelo/tipos";

export const VERSION_MODELO = "2.0.0";

/** Pesos del modelo. Declarados aquí para que sean auditables. */
export const PESOS = {
  cobertura: 0.30,      // qué parte de la receta cubren los lotes elegidos
  aporteMerma: 0.22,    // qué parte del peso final proviene del excedente
  urgencia: 0.20,       // cuán apremiante es el lote más comprometido
  absorcion: 0.12,      // qué parte de lo seleccionado consume la receta
  jerarquia: 0.12,      // escalón en la jerarquía de gestión del excedente
  aceptacion: 0.10,     // valoración histórica del plato
  cargaArea: -0.06,     // penaliza áreas saturadas
} as const;

/**
 * Jerarquía de gestión del excedente (Papargyropoulou et al., 2014).
 * La reutilización culinaria que devuelve el excedente a alimentación
 * humana es preferible a la conservación, que solo aplaza la decisión.
 */
const JERARQUIA: Record<TipoProceso, number> = {
  reproceso_termico: 1.0,
  ensamblaje_frio: 1.0,
  panaderia: 0.9,
  conservacion: 0.35,
};

type MotivoDescarte =
  | "no_apto" | "vencido" | "sin_tiempo" | "estado"
  | "no_usa_lotes" | "termico";

const MOTIVOS: Record<MotivoDescarte, string> = {
  no_apto: "Alguno de los lotes seleccionados no tiene dictamen sanitario favorable.",
  vencido: "Alguno de los lotes superó su vida útil.",
  sin_tiempo: "La preparación no termina dentro de la ventana sanitaria del lote más urgente.",
  estado: "La receta no admite alguno de los lotes en el estado en que se encuentra.",
  no_usa_lotes: "La receta no incluye ninguno de los ingredientes seleccionados.",
  termico: "Un lote cocido fuera de temperatura exige reproceso térmico; la receta no lo aplica.",
};

export const horasRestantes = (lote: Lote, ahora: Date): number =>
  (lote.venceEn.getTime() - ahora.getTime()) / 3_600_000;

/**
 * La ventana sanitaria de un conjunto la fija el lote más comprometido.
 * Tomar la media o el máximo permitiría planificar una preparación que
 * llega tarde para uno de los lotes, que es lo que no debe ocurrir.
 */
const horasDelConjunto = (lotes: Lote[], ahora: Date): number =>
  Math.min(...lotes.map((l) => horasRestantes(l, ahora)));

const usablesEn = (lotes: Lote[], item: ItemCatalogo): Lote[] =>
  lotes.filter((l) =>
    item.requisitos.some((r) => r.ingredienteId === l.ingredienteId));

// ---------------------------------------------------------------------
// Etapa 1 · Filtros duros
// ---------------------------------------------------------------------

/**
 * Devuelve el motivo de descarte, o null si la alternativa es viable.
 *
 * Los filtros son binarios a propósito. Una restricción sanitaria no se
 * compensa con una puntuación alta en otro factor: o se cumple, o la
 * alternativa no existe.
 *
 * Con varios lotes basta que UNO incumpla para descartar la receta
 * entera. No se propone una versión parcial: o la receta se puede hacer
 * con lo seleccionado, o no se propone.
 */
export function filtrosDuros(
  lotes: Lote[], item: ItemCatalogo, ahora: Date,
): MotivoDescarte | null {
  if (lotes.length === 0) return "no_usa_lotes";

  const usables = usablesEn(lotes, item);
  if (usables.length === 0) return "no_usa_lotes";

  for (const lote of usables) {
    if (!lote.aptoReproceso) return "no_apto";
    if (horasRestantes(lote, ahora) <= 0) return "vencido";

    const req = item.requisitos.find(
      (r) => r.ingredienteId === lote.ingredienteId)!;
    if (req.admiteEstado !== "ambos" && req.admiteEstado !== lote.estadoProducto)
      return "estado";

    // producto cocido que rompió cadena de frío: solo se salva con
    // tratamiento térmico que alcance temperatura de seguridad
    if (lote.estadoProducto === "cocido" && lote.temperaturaC > 5) {
      if (item.tipoProceso !== "reproceso_termico" || item.tempProcesoC < 74)
        return "termico";
    }
  }

  // el proceso debe caber en la ventana del lote más urgente, con 1 h de margen
  if (item.minutos / 60 + 1 > horasDelConjunto(usables, ahora))
    return "sin_tiempo";

  return null;
}

// ---------------------------------------------------------------------
// Etapas 2 y 3 · Puntuación descompuesta
// ---------------------------------------------------------------------

function agruparPorIngrediente(lotes: Lote[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const l of lotes)
    m.set(l.ingredienteId, (m.get(l.ingredienteId) ?? 0) + l.cantidad);
  return m;
}

/**
 * Factor de escalado de la receta.
 *
 * Con varios lotes la receta se escala hasta donde alcance el ingrediente
 * más limitante. Escalar más dejaría requisitos sin cubrir; escalar menos
 * desperdiciaría excedente que ya está disponible.
 */
function calcularEscala(
  lotes: Lote[], item: ItemCatalogo, disponibles: Map<number, number>,
): number {
  const porIngrediente = agruparPorIngrediente(lotes);
  let escala = 4;                      // tope superior razonable

  for (const [ingId, kg] of porIngrediente) {
    const req = item.requisitos.find((r) => r.ingredienteId === ingId);
    if (req && req.cantidad > 0) escala = Math.min(escala, kg / req.cantidad);
  }

  // los requisitos no cubiertos por merma salen del inventario, que
  // también limita hasta dónde se puede escalar
  for (const r of item.requisitos) {
    if (porIngrediente.has(r.ingredienteId)) continue;
    const disp = disponibles.get(r.ingredienteId) ?? 0;
    if (r.cantidad > 0 && disp > 0) escala = Math.min(escala, disp / r.cantidad);
  }

  return Math.max(0.25, Math.min(escala, 4));
}

/**
 * Reparte el consumo entre los lotes del mismo ingrediente.
 *
 * Se consume primero el lote más urgente: el objetivo del modelo es
 * evitar que algo se pierda, y lo que vence antes es lo que más riesgo
 * corre de perderse.
 */
function repartir(
  lotes: Lote[], item: ItemCatalogo, escala: number, ahora: Date,
): AporteLote[] {
  const aportes: AporteLote[] = [];
  const porIng = new Map<number, Lote[]>();

  for (const l of lotes) {
    if (!item.requisitos.some((r) => r.ingredienteId === l.ingredienteId)) continue;
    const grupo = porIng.get(l.ingredienteId) ?? [];
    grupo.push(l);
    porIng.set(l.ingredienteId, grupo);
  }

  for (const [ingId, grupo] of porIng) {
    const req = item.requisitos.find((r) => r.ingredienteId === ingId)!;
    let restante = req.cantidad * escala;

    const ordenados = [...grupo].sort(
      (a, b) => horasRestantes(a, ahora) - horasRestantes(b, ahora));

    for (const lote of ordenados) {
      if (restante <= 0.001) break;
      const usa = Math.min(lote.cantidad, restante);
      restante -= usa;
      aportes.push({
        lote,
        cantidadUsada: Math.round(usa * 100) / 100,
        esPrincipal: req.esPrincipal,
      });
    }
  }
  return aportes;
}

export function evaluar(
  lotes: Lote[], item: ItemCatalogo, disponibles: Map<number, number>,
  cargaArea: number, ahora: Date,
): Resultado {
  const factores: Factor[] = [];
  const req = item.requisitos;
  const usables = usablesEn(lotes, item);

  const escala = calcularEscala(usables, item, disponibles);
  const aportes = repartir(usables, item, escala, ahora);
  const kgUsados = aportes.reduce((a, x) => a + x.cantidadUsada, 0);
  const porIngrediente = agruparPorIngrediente(usables);

  // --- factor 1: cobertura de la receta con los lotes elegidos -------
  // Cambia de sentido respecto a la versión de un solo lote: antes
  // preguntaba si había inventario; ahora, qué parte de la receta sale
  // del excedente seleccionado. Un requisito cubierto por merma cuenta
  // entero; uno cubierto por compra cuenta parcialmente, porque la
  // receta es viable pero no aprovecha excedente.
  const pesoTotal = req.reduce((a, r) => a + (r.esPrincipal ? 2 : 1), 0);
  const pesoCubierto = req.reduce((a, r) => {
    const peso = r.esPrincipal ? 2 : 1;
    const necesario = r.cantidad * escala;
    if ((porIngrediente.get(r.ingredienteId) ?? 0) >= necesario) return a + peso;
    if ((disponibles.get(r.ingredienteId) ?? 0) >= necesario) return a + peso * 0.6;
    return a;
  }, 0);
  const cobertura = pesoTotal ? pesoCubierto / pesoTotal : 0;
  const deMerma = req.filter((r) =>
    (porIngrediente.get(r.ingredienteId) ?? 0) >= r.cantidad * escala).length;

  factores.push({
    nombre: "Cobertura de la receta con los lotes elegidos",
    valorObservado: `${deMerma} de ${req.length} ingredientes salen de merma`,
    peso: PESOS.cobertura, contribucion: cobertura * PESOS.cobertura * 100,
  });

  // --- factor 2: aporte de merma al peso final -----------------------
  const pesoRecetaKg = (item.porcionesBase * item.pesoPorcionG / 1000) * escala;
  const aporte = pesoRecetaKg ? Math.min(1, kgUsados / pesoRecetaKg) : 0;
  factores.push({
    nombre: "Proporción del plato que proviene de merma",
    valorObservado: `${Math.round(aporte * 100)} % del peso final`
      + (aportes.length > 1 ? `, combinando ${aportes.length} lotes` : ""),
    peso: PESOS.aporteMerma, contribucion: aporte * PESOS.aporteMerma * 100,
  });

  // --- factor 3: urgencia del conjunto -------------------------------
  const horas = horasDelConjunto(usables, ahora);
  const masUrgente = [...usables].sort(
    (a, b) => horasRestantes(a, ahora) - horasRestantes(b, ahora))[0];
  const urgencia = Math.max(0, Math.min(1, (48 - horas) / 48));
  factores.push({
    nombre: "Vida útil del lote más comprometido",
    valorObservado: `${horas.toFixed(0)} h · ${masUrgente.codigo}`,
    peso: PESOS.urgencia, contribucion: urgencia * PESOS.urgencia * 100,
  });

  // --- factor 4: absorción de lo seleccionado ------------------------
  const kgSeleccionados = usables.reduce((a, l) => a + l.cantidad, 0);
  const absorcion = kgSeleccionados ? Math.min(1, kgUsados / kgSeleccionados) : 0;
  factores.push({
    nombre: "Parte de lo seleccionado que consume la preparación",
    valorObservado: `${kgUsados.toFixed(1)} de ${kgSeleccionados.toFixed(1)} kg`,
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

  const costo = aportes.reduce(
    (a, x) => a + x.cantidadUsada * x.lote.costoUnitario, 0);

  return {
    item, aptitud, factores, aportes,
    kgAprovechados: Math.round(kgUsados * 100) / 100,
    porciones: Math.round(item.porcionesBase * escala),
    costoRecuperado: Math.round(costo * 100) / 100,
    escala,
    resumen: resumir(aportes, item, horas, escala, aporte),
    contrafactuales:
      contrafactuales(usables, item, horas, req, porIngrediente, escala),
  };
}

function resumir(
  aportes: AporteLote[], item: ItemCatalogo,
  horas: number, escala: number, aporte: number,
): string {
  const porciones = Math.round(item.porcionesBase * escala);
  if (aportes.length <= 1) {
    const a = aportes[0];
    if (!a) return `Se propone «${item.nombre}».`;
    return `Se propone «${item.nombre}» porque ${a.lote.ingrediente.toLowerCase()} `
      + `está ${a.lote.estadoProducto} y vence en ${horas.toFixed(0)} horas. `
      + `Rinde ${porciones} porciones y el ${Math.round(aporte * 100)} % de su `
      + `peso proviene del lote.`;
  }
  const lista = aportes
    .map((a) => `${a.cantidadUsada.toFixed(1)} kg de ${a.lote.ingrediente.toLowerCase()}`)
    .join(", ");
  return `Se propone «${item.nombre}» combinando ${aportes.length} lotes: `
    + `${lista}. La ventana sanitaria más ajustada es de ${horas.toFixed(0)} `
    + `horas. Rinde ${porciones} porciones y el ${Math.round(aporte * 100)} % `
    + `de su peso proviene de merma.`;
}

/**
 * Explicación contrafactual: qué tendría que cambiar para otra salida.
 * Nunes y Jannach (2017) señalan que este tipo de explicación es la que
 * mejor sostiene la confianza, porque delimita el alcance de la decisión.
 */
function contrafactuales(
  lotes: Lote[], item: ItemCatalogo, horas: number,
  req: Requisito[], porIngrediente: Map<number, number>, escala: number,
): string[] {
  const out: string[] = [];
  const minimo = item.minutos / 60 + 1;

  if (horas > minimo)
    out.push(`Si el lote más comprometido bajara de ${minimo.toFixed(0)} horas `
      + `de vida útil, esta alternativa quedaría descartada por no caber en la `
      + `ventana sanitaria.`);

  const faltantes = req.filter((r) =>
    (porIngrediente.get(r.ingredienteId) ?? 0) < r.cantidad * escala);
  out.push(faltantes.length === 0
    ? "Todos los ingredientes de la receta salen de los lotes seleccionados. "
      + "Retirar cualquiera de ellos bajaría la cobertura."
    : `${faltantes.length} ingrediente(s) se toman del inventario y no de `
      + `merma. Añadir lotes que los cubran elevaría la aptitud.`);

  out.push(lotes.length > 1
    ? "Evaluando los lotes por separado, ninguno alcanzaría esta cobertura: "
      + "la combinación es lo que hace viable la receta a esta escala."
    : "Seleccionar más lotes compatibles permitiría cubrir una parte mayor "
      + "de la receta con excedente.");

  return out;
}

// ---------------------------------------------------------------------
// Orquestación
// ---------------------------------------------------------------------

/**
 * Devuelve las mejores alternativas para el conjunto de lotes y la lista
 * de descartes con motivo. Devolver también los descartes es deliberado:
 * la trazabilidad de por qué NO se propuso algo forma parte de la
 * explicabilidad y permite auditar el modelo.
 */
export function recomendar(
  lotes: Lote[], catalogo: ItemCatalogo[], disponibles: Map<number, number>,
  cargas: Map<number, number>, ahora: Date, topN = 3,
): { resultados: Resultado[]; descartes: Descarte[] } {
  const resultados: Resultado[] = [];
  const descartes: Descarte[] = [];

  for (const item of catalogo) {
    const motivo = filtrosDuros(lotes, item, ahora);
    if (motivo) {
      // "no_usa_lotes" es ruido: la mayoría del catálogo no usa la selección
      if (motivo !== "no_usa_lotes")
        descartes.push({ alternativa: item.nombre, motivo: MOTIVOS[motivo] });
      continue;
    }
    resultados.push(
      evaluar(lotes, item, disponibles, cargas.get(item.areaId) ?? 0, ahora));
  }

  resultados.sort((a, b) => b.aptitud - a.aptitud);
  return { resultados: resultados.slice(0, topN), descartes };
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
