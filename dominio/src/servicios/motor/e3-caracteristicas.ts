/**
 * FoodLoop · Etapa 3 · Extracción de características
 *
 * Qué recibe:  una receta admisible y los lotes que puede usar.
 * Qué produce: siete números en [0,1] —el vector del modelo— y lo que se
 *              observó en cada eje, en palabras.
 *
 * Esta es la etapa que hace que el sistema sea un modelo y no un
 * programa que ordena recetas. Convierte una situación de cocina —tanto
 * pollo cocido, tanta vida útil, tal receta, tal área— en una
 * representación numérica comparable entre recetas distintas. Lo que se
 * puntúa después es este vector, no la situación.
 *
 * Aquí NO hay pesos. Separar la medición de la ponderación tiene tres
 * consecuencias prácticas:
 *
 *   · puede comprobarse que el modelo mide lo que dice medir sin
 *     discutir al mismo tiempo cómo lo combina;
 *   · los pesos pueden sustituirse por unos ajustados sobre el histórico
 *     de decisiones sin tocar esta etapa;
 *   · la explicación al usuario puede mostrar el valor observado y su
 *     contribución por separado, que es lo que pedía la evaluación con
 *     usuarios.
 */

import type { ItemCatalogo, Lote, AporteLote, TipoProceso, Requisito } from "../../modelo/tipos";
<<<<<<< HEAD
import type { Caracteristica, SenalOperacion } from "./pesos";
import {
  VENTANA_FRECUENCIA_DIAS, SATURACION_FRECUENCIA, DECAIMIENTO_RECENCIA_DIAS,
} from "./pesos";
=======
import type { Caracteristica } from "./pesos";
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
import type { Caracteristicas, EntradaModelo } from "./tipos";
import { horasRestantes, horasDelConjunto } from "./e1-entrada";

/**
 * Jerarquía de gestión del excedente (Papargyropoulou et al., 2014).
 * La reutilización culinaria que devuelve el excedente a alimentación
 * humana es preferible a la conservación, que solo aplaza la decisión.
 */
export const JERARQUIA: Record<TipoProceso, number> = {
  reproceso_termico: 1.0,
  ensamblaje_frio: 1.0,
  panaderia: 0.9,
  conservacion: 0.35,
};

/** Horizonte sobre el que se normaliza la urgencia. */
export const HORIZONTE_URGENCIA_H = 48;

/** Tope de escalado de una receta respecto de su rendimiento base. */
export const ESCALA_MAX = 4;
export const ESCALA_MIN = 0.25;

<<<<<<< HEAD
/** Fecha local AAAA-MM-DD de un instante. */
export function diaLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DIA_MS = 86_400_000;

/**
 * Señales de operación de una receta en el instante de evaluación.
 *
 * Solo cuentan las producciones de días ANTERIORES al de la evaluación.
 * No es un detalle: la variable que el modelo aprende a predecir es si
 * la receta se produce ese día o los dos siguientes, de modo que dejar
 * entrar la producción del mismo día sería enseñarle la respuesta. En
 * operación real el menú del día suele conocerse de antemano; aun así
 * se excluye, para que lo que se mide al evaluar sea lo que el modelo
 * tendrá de verdad al decidir.
 */
export function senalesOperacion(item: ItemCatalogo, ahora: Date): {
  valores: Record<SenalOperacion, number>;
  observaciones: Record<SenalOperacion, string>;
} {
  const hoy = diaLocal(ahora);
  const tHoy = Date.parse(hoy);
  const previas = (item.producciones ?? []).filter((f) => f < hoy);
  const dias = (f: string) => Math.round((tHoy - Date.parse(f)) / DIA_MS);
  const enVentana = previas.filter((f) => dias(f) <= VENTANA_FRECUENCIA_DIAS).length;
  const ultima = previas.length ? previas.reduce((a, b) => (a > b ? a : b)) : null;

  const frecuenciaMenu = Math.min(1,
    Math.log1p(enVentana) / Math.log1p(SATURACION_FRECUENCIA));
  const recenciaMenu = ultima
    ? Math.exp(-dias(ultima) / DECAIMIENTO_RECENCIA_DIAS) : 0;

  return {
    valores: { frecuenciaMenu, recenciaMenu },
    observaciones: {
      frecuenciaMenu: `${enVentana} producciones en ${VENTANA_FRECUENCIA_DIAS} días`,
      recenciaMenu: ultima
        ? `última hace ${dias(ultima)} día${dias(ultima) === 1 ? "" : "s"}`
        : "sin producciones previas",
    },
  };
}

=======
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
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
export function calcularEscala(
  lotes: Lote[], item: ItemCatalogo, inventario: Map<number, number>,
): number {
  const porIngrediente = agruparPorIngrediente(lotes);
  let escala = ESCALA_MAX;

  for (const [ingId, kg] of porIngrediente) {
    const req = item.requisitos.find((r) => r.ingredienteId === ingId);
    if (req && req.cantidad > 0) escala = Math.min(escala, kg / req.cantidad);
  }

  // los requisitos no cubiertos por merma salen del inventario, que
  // también limita hasta dónde se puede escalar
  for (const r of item.requisitos) {
    if (porIngrediente.has(r.ingredienteId)) continue;
    const disp = inventario.get(r.ingredienteId) ?? 0;
    if (r.cantidad > 0 && disp > 0) escala = Math.min(escala, disp / r.cantidad);
  }

  return Math.max(ESCALA_MIN, Math.min(escala, ESCALA_MAX));
}

/**
 * Reparte el consumo entre los lotes del mismo ingrediente.
 *
 * Se consume primero el lote más urgente: el objetivo del modelo es
 * evitar que algo se pierda, y lo que vence antes es lo que más riesgo
 * corre de perderse.
 */
export function repartir(
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

export function extraerCaracteristicas(
  usables: Lote[], item: ItemCatalogo, entrada: EntradaModelo,
): Caracteristicas {
  const { inventario, cargaPorArea, ahora } = entrada;
  const req = item.requisitos;

  const escala = calcularEscala(usables, item, inventario);
  const aportes = repartir(usables, item, escala, ahora);
  const kgUsados = aportes.reduce((a, x) => a + x.cantidadUsada, 0);
  const porIngrediente = agruparPorIngrediente(usables);
  const cargaArea = cargaPorArea.get(item.areaId) ?? 0;

  // --- eje 1 · cobertura de la receta --------------------------------
  // Qué parte de la receta sale del excedente seleccionado. Un requisito
  // cubierto por merma cuenta entero; uno cubierto por compra cuenta
  // parcialmente, porque la receta es viable pero no aprovecha
  // excedente. Los ingredientes principales pesan el doble.
  const pesoTotal = req.reduce((a, r) => a + (r.esPrincipal ? 2 : 1), 0);
  const pesoCubierto = req.reduce((a, r) => {
    const peso = r.esPrincipal ? 2 : 1;
    const necesario = r.cantidad * escala;
    if ((porIngrediente.get(r.ingredienteId) ?? 0) >= necesario) return a + peso;
    if ((inventario.get(r.ingredienteId) ?? 0) >= necesario) return a + peso * 0.6;
    return a;
  }, 0);
  const cobertura = pesoTotal ? pesoCubierto / pesoTotal : 0;

  const faltantes: Requisito[] = req.filter((r) =>
    (porIngrediente.get(r.ingredienteId) ?? 0) < r.cantidad * escala);
  const deMerma = req.length - faltantes.length;

  // --- eje 2 · aporte de merma al peso final -------------------------
  const pesoRecetaKg = (item.porcionesBase * item.pesoPorcionG / 1000) * escala;
  const aporteMerma = pesoRecetaKg ? Math.min(1, kgUsados / pesoRecetaKg) : 0;

  // --- eje 3 · urgencia del conjunto ---------------------------------
  const horasConjunto = horasDelConjunto(usables, ahora);
  const masUrgente = [...usables].sort(
    (a, b) => horasRestantes(a, ahora) - horasRestantes(b, ahora))[0];
  const urgencia = Math.max(0, Math.min(1,
    (HORIZONTE_URGENCIA_H - horasConjunto) / HORIZONTE_URGENCIA_H));

  // --- eje 4 · absorción de lo seleccionado --------------------------
  const kgSeleccionados = usables.reduce((a, l) => a + l.cantidad, 0);
  const absorcion = kgSeleccionados ? Math.min(1, kgUsados / kgSeleccionados) : 0;

  // --- eje 5 · jerarquía de aprovechamiento --------------------------
  const jerarquia = JERARQUIA[item.tipoProceso];

  // --- eje 6 · aceptación histórica ----------------------------------
  // Escala 1..5 llevada a [0,1]: un plato valorado con un 1 no aporta
  // nada en este eje, no un 20 %.
  const aceptacion = (item.aceptacion - 1) / 4;

  const valores: Record<Caracteristica, number> = {
    cobertura, aporteMerma, urgencia, absorcion,
    jerarquia, aceptacion, cargaArea,
  };

  const observaciones: Record<Caracteristica, string> = {
    cobertura: `${deMerma} de ${req.length} ingredientes salen de merma`,
    aporteMerma: `${Math.round(aporteMerma * 100)} % del peso final`
      + (aportes.length > 1 ? `, combinando ${aportes.length} lotes` : ""),
    urgencia: `${horasConjunto.toFixed(0)} h · ${masUrgente.codigo}`,
    absorcion: `${kgUsados.toFixed(1)} de ${kgSeleccionados.toFixed(1)} kg`,
    jerarquia: jerarquia >= 0.9
      ? "Reutilización culinaria directa"
      : "Conservación; aplaza la decisión",
    aceptacion: `${item.aceptacion.toFixed(1)} / 5`,
    cargaArea: `${item.area} al ${Math.round(cargaArea * 100)} %`,
  };

<<<<<<< HEAD
  const senales = senalesOperacion(item, ahora);

  return {
    escala, aportes, kgUsados, pesoRecetaKg,
    valores, observaciones,
    senales: senales.valores,
    observacionesSenales: senales.observaciones,
=======
  return {
    escala, aportes, kgUsados, pesoRecetaKg,
    valores, observaciones,
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
    horasConjunto, masUrgente, porIngrediente, faltantes,
    costoRecuperado: Math.round(
      aportes.reduce((a, x) => a + x.cantidadUsada * x.lote.costoUnitario, 0)
      * 100) / 100,
    valorEnRiesgo: Math.round(
      usables.reduce((a, l) => a + l.cantidad * l.costoUnitario, 0) * 100) / 100,
  };
}
