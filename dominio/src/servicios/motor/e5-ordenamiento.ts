/**
 * FoodLoop · Etapa 5 · Ordenamiento
 *
 * Qué recibe:  las candidatas admisibles con su puntuación.
 * Qué produce: las N mejores, ordenadas.
 *
 * El criterio principal es la aptitud. Lo que esta etapa añade es qué
 * ocurre cuando dos recetas empatan, que antes quedaba resuelto por el
 * orden en que el catálogo venía de la base de datos: un criterio que no
 * es defendible, porque haría que insertar una receta nueva cambiara
 * recomendaciones que no tienen nada que ver con ella.
 *
 * Los desempates van en orden de objetivo del sistema:
 *
 *   1. aptitud, de mayor a menor;
<<<<<<< HEAD
 *   1b. valor de aprovechamiento, de mayor a menor —desde la versión 3
 *      la aptitud es P × valor, y ante igual aptitud se prefiere la que
 *      más aprovecha si se ejecuta;
=======
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
 *   2. kilos de merma aprovechados, de mayor a menor —ante igual
 *      puntuación, se prefiere la que da salida a más excedente;
 *   3. ventana sanitaria más corta primero —se atiende antes lo que
 *      antes caduca;
 *   4. código de receta, alfabético —no es un criterio de calidad, es
 *      lo que garantiza que la salida sea reproducible cuando los tres
 *      anteriores empatan.
 *
 * En el conjunto de prueba actual los desempates no se activan: las 91
 * evaluaciones producen 133 propuestas sin un solo empate de aptitud.
 * Están igualmente porque con datos reales, que tienen muchas más
 * recetas y lotes más parecidos entre sí, los empates aparecen.
 */

import type { Candidata } from "./tipos";

export function ordenar(candidatas: Candidata[], topN: number): {
  ranking: Candidata[];
  /** Cuántas quedaron fuera por el corte, no por el modelo. */
  fueraDeCorte: number;
} {
  const ordenadas = [...candidatas].sort((a, b) =>
    b.puntuacion.aptitud - a.puntuacion.aptitud
<<<<<<< HEAD
    || b.puntuacion.valor - a.puntuacion.valor
=======
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
    || b.caracteristicas.kgUsados - a.caracteristicas.kgUsados
    || a.caracteristicas.horasConjunto - b.caracteristicas.horasConjunto
    || a.item.codigo.localeCompare(b.item.codigo));

  return {
    ranking: ordenadas.slice(0, topN),
    fueraDeCorte: Math.max(0, ordenadas.length - topN),
  };
}
