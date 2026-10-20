/**
 * FoodLoop · Etapa 4 · Puntuación
 *
<<<<<<< HEAD
 * Qué recibe:  el vector de características, los pesos de valor y el
 *              modelo aprendido.
 * Qué produce: la aptitud en [0,100] y, por separado, sus dos
 *              componentes con la contribución de cada eje.
 *
 * Desde la versión 3 la puntuación tiene dos partes:
 *
 *   VALOR       valor = recorte( Σ pesoᵢ · característicaᵢ · 100 , 0 , 100 )
 *               Qué tan buena es la propuesta PARA LA MERMA si se
 *               ejecuta. Siete pesos de criterio experto. Es la aptitud
 *               del modelo 2, sin cambios.
 *
 *   EJECUCIÓN   P = σ( b + Σ wⱼ · xⱼ )
 *               Qué tan probable es que la cocina la ejecute. Nueve
 *               coeficientes ESTIMADOS por regresión logística sobre el
 *               histórico de producción.
 *
 *   APTITUD     aptitud = P × valor
 *               El aprovechamiento esperado. Una propuesta excelente que
 *               nunca se cocina vale poco; una que se cocina siempre pero
 *               apenas usa merma, también.
 *
 * Las dos partes son lineales en su escala —el valor en puntos, la
 * ejecución en log-odds—, de modo que las dos explicaciones siguen
 * siendo exactas: las siete contribuciones suman el valor y las nueve
 * contribuciones más el intercepto suman el logit de P. No hay ninguna
 * aproximación posterior tipo SHAP.
 *
 * El aprendizaje no toca las restricciones: la etapa 2 sigue antes que
 * esta, de modo que ningún coeficiente aprendido puede rescatar una
 * propuesta insegura.
 */

import type { Caracteristica, EntradaAprendida, ModeloAprendido, VectorPesos } from "./pesos";
import { CARACTERISTICAS, ENTRADAS_APRENDIDAS, PESOS } from "./pesos";
import { MODELO_APRENDIDO } from "./modelo-aprendido";
import type { Caracteristicas, ModoPuntuacion, Puntuacion } from "./tipos";
import { sigmoide } from "../aprendizaje/regresion-logistica";

/** Las nueve entradas del componente aprendido, en orden canónico. */
export function entradasAprendidas(c: Caracteristicas): Record<EntradaAprendida, number> {
  return { ...c.valores, ...c.senales };
}

export function puntuar(
  c: Caracteristicas,
  pesos: VectorPesos = PESOS,
  modelo: ModeloAprendido = MODELO_APRENDIDO,
  modo: ModoPuntuacion = "aprendida",
): Puntuacion {
  // --- valor de aprovechamiento (criterio experto) -------------------
  const contribuciones = {} as Record<Caracteristica, number>;
  let bruto = 0;
=======
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

>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
  for (const eje of CARACTERISTICAS) {
    const aporte = c.valores[eje] * pesos[eje] * 100;
    contribuciones[eje] = aporte;
    bruto += aporte;
  }
<<<<<<< HEAD
  const recortado = Math.max(0, Math.min(100, bruto));
  const valor = Math.round(recortado * 10) / 10;

  // --- probabilidad de ejecución (aprendida) -------------------------
  const x = entradasAprendidas(c);
  const contribucionesEjecucion = {} as Record<EntradaAprendida, number>;
  let logit = modelo.intercepto;
  for (const e of ENTRADAS_APRENDIDAS) {
    const aporte = (modelo.coeficientes[e] ?? 0) * x[e];
    contribucionesEjecucion[e] = aporte;
    logit += aporte;
  }
  const probabilidad = sigmoide(logit);

  const aptitud = modo === "experta"
    ? valor
    : Math.round(probabilidad * recortado * 10) / 10;

  return {
    aptitud, valor, probabilidad, logit,
    intercepto: modelo.intercepto,
    contribucionesEjecucion,
    coeficientes: modelo.coeficientes,
    modo,
=======

  const recortado = Math.max(0, Math.min(100, bruto));
  return {
    aptitud: Math.round(recortado * 10) / 10,
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
    contribuciones,
    bruto,
    recortada: recortado !== bruto,
    pesos,
  };
}
