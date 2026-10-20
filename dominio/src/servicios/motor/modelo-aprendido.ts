/**
 * FoodLoop · Modelo aprendido
 *
 * ARCHIVO GENERADO por `npm run ml:entrenar`. No editar a mano: se
 * reescribe en cada entrenamiento con los coeficientes estimados y las
 * métricas sobre el periodo de prueba, que el modelo no vio.
 *
 * Coeficientes en log-odds por unidad de cada entrada (todas en [0,1]).
 * Positivo: acerca la propuesta a lo que la cocina ejecuta. Negativo:
 * la aleja. Un coeficiente en cero con la entrada en `sinVariacion`
 * significa que los datos no permiten estimarlo, no que no importe.
 */
import type { ModeloAprendido } from "./pesos";

export const MODELO_APRENDIDO: ModeloAprendido = {
  "version": "3.0.0+2026-10-20",
  "algoritmo": "Regresión logística L2 (IRLS)",
  "objetivo": "receta producida en el centro en ≤ 48 h desde el lote",
  "entrenadoEn": "2026-10-20",
  "periodoEntrenamiento": {
    "desde": "2026-01-01",
    "hasta": "2026-04-30"
  },
  "periodoPrueba": {
    "desde": "2026-05-01",
    "hasta": "2026-06-30"
  },
  "ejemplos": 43651,
  "positivos": 1095,
  "lambda": 1,
  "intercepto": -6.70927,
  "coeficientes": {
    "cobertura": -1.678809,
    "aporteMerma": -1.534165,
    "urgencia": 0.539358,
    "absorcion": 0.04645,
    "jerarquia": 0.681465,
    "aceptacion": 0,
    "cargaArea": 2.000565,
    "frecuenciaMenu": 3.606082,
    "recenciaMenu": 0.257171
  },
  "sinVariacion": [
    "aceptacion"
  ],
  "metricasPrueba": {
    "hr1": 0.256,
    "hr3": 0.4464,
    "p3": 0.1746,
    "ndcg3": 0.2759,
    "mrr": 0.4048,
    "map": 0.3167,
    "aucProbabilidad": 0.784,
    "apProbabilidad": 0.1134,
    "logloss": 0.1081,
    "brier": 0.0249,
    "kgEjecutables": 83.59
  }
};
