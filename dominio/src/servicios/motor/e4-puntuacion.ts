/**
 * FoodLoop · Etapa 4 · Puntuación
 *
 * Qué recibe:  el vector de características y el vector de pesos.
 * Qué produce: la aptitud en [0,100] y la contribución de cada eje.
 *
 * Toda la etapa es una combinación lineal:
 *
 *     aptitud = recorte( Σ  pesoᵢ · característicaᵢ · 100 ,  0 , 100 )
 *
 * Que quepa en una línea no es una simplificación del documento: es
 * literalmente lo que hace el modelo. Lo que no es trivial está en la
 * etapa anterior, que es la que convierte la situación de cocina en las
 * característicasᵢ, y en la etapa 2, que decide qué llega hasta aquí.
 *
 * El modelo es lineal por una razón, no por falta de alternativa. Una
 * combinación lineal permite afirmar de cada recomendación que un eje
 * aportó exactamente tantos puntos, y esa afirmación es verificable
 * sumándolos. Con un modelo no lineal —un árbol, una red— la explicación
 * habría que aproximarla después con una técnica como SHAP, y lo que el
 * usuario leería sería una estimación de la decisión, no la decisión. En
 * un sistema cuyo objetivo declarado es que el chef entienda por qué se
 * le propone algo, esa diferencia es el proyecto entero.
 *
 * Los pesos entran como argumento: cuando existan datos históricos
 * suficientes para ajustarlos, esta etapa no cambia.
 */

import type { Caracteristica, VectorPesos } from "./pesos";
import { CARACTERISTICAS, PESOS } from "./pesos";
import type { Caracteristicas, Puntuacion } from "./tipos";

export function puntuar(
  c: Caracteristicas, pesos: VectorPesos = PESOS,
): Puntuacion {
  const contribuciones = {} as Record<Caracteristica, number>;
  let bruto = 0;

  for (const eje of CARACTERISTICAS) {
    const aporte = c.valores[eje] * pesos[eje] * 100;
    contribuciones[eje] = aporte;
    bruto += aporte;
  }

  const recortado = Math.max(0, Math.min(100, bruto));
  return {
    aptitud: Math.round(recortado * 10) / 10,
    contribuciones,
    bruto,
    recortada: recortado !== bruto,
    pesos,
  };
}
