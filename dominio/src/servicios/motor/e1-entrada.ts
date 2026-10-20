/**
 * FoodLoop · Etapa 1 · Entrada de datos
 *
 * Qué recibe:  los lotes seleccionados, el catálogo de recetas activas,
 *              el inventario de bodega, la carga por área y el instante
 *              de evaluación.
 * Qué produce: la misma entrada depurada, más la lista de lo que se
 *              descartó y por qué.
 *
 * El motor no consulta la base de datos ni lee el reloj: todo entra por
 * aquí como argumento. Esa decisión es la que permite ejecutar el modelo
 * sobre un caso congelado y obtener exactamente la misma salida, que es
 * la condición para poder verificarlo.
 *
 * La depuración es explícita en lugar de silenciosa. Antes, una receta
 * sin ingredientes declarados o un lote con cantidad cero simplemente no
 * aparecían en el resultado y no quedaba constancia. Ahora se registran:
 * cuando los datos vengan del centro de producción, los rechazos de esta
 * etapa son la primera señal de que un archivo llegó incompleto.
 */

import type { Lote, ItemCatalogo } from "../../modelo/tipos";
import type { EntradaModelo, RechazoEntrada, SalidaEntrada } from "./tipos";

export function normalizarEntrada(
  lotes: Lote[],
  catalogo: ItemCatalogo[],
  inventario: Map<number, number>,
  cargaPorArea: Map<number, number>,
  ahora: Date,
): SalidaEntrada {
  const rechazos: RechazoEntrada[] = [];

  const lotesValidos = lotes.filter((l) => {
    if (!(l.cantidad > 0)) {
      rechazos.push({ que: l.codigo, motivo: "cantidad no positiva" });
      return false;
    }
    if (Number.isNaN(l.venceEn.getTime())) {
      rechazos.push({ que: l.codigo, motivo: "fecha de vencimiento inválida" });
      return false;
    }
    return true;
  });

  // Una receta sin requisitos no puede evaluarse: no hay con qué medir
  // cobertura ni aporte. No es un caso teórico, lo produce una
  // importación en la que la hoja de ingredientes no cuadró con la de
  // recetas.
  const catalogoValido = catalogo.filter((r) => {
    if (r.requisitos.length === 0) {
      rechazos.push({ que: r.codigo, motivo: "receta sin ingredientes declarados" });
      return false;
    }
    if (!(r.porcionesBase > 0) || !(r.pesoPorcionG > 0)) {
      rechazos.push({ que: r.codigo, motivo: "rendimiento no declarado" });
      return false;
    }
    return true;
  });

  const entrada: EntradaModelo = {
    lotes: lotesValidos,
    catalogo: catalogoValido,
    inventario,
    cargaPorArea,
    ahora,
  };

  return { entrada, rechazos };
}

/** Horas que le quedan a un lote antes de agotar su vida útil. */
export const horasRestantes = (lote: Lote, ahora: Date): number =>
  (lote.venceEn.getTime() - ahora.getTime()) / 3_600_000;

/**
 * La ventana sanitaria de un conjunto la fija el lote más comprometido.
 * Tomar la media o el máximo permitiría planificar una preparación que
 * llega tarde para uno de los lotes, que es lo que no debe ocurrir.
 */
export const horasDelConjunto = (lotes: Lote[], ahora: Date): number =>
  lotes.length === 0
    ? 0
    : Math.min(...lotes.map((l) => horasRestantes(l, ahora)));

/** Lotes de la selección que esta receta declara entre sus requisitos. */
export const usablesEn = (lotes: Lote[], item: ItemCatalogo): Lote[] =>
  lotes.filter((l) =>
    item.requisitos.some((r) => r.ingredienteId === l.ingredienteId));
