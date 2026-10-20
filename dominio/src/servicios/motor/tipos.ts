/**
 * FoodLoop · Tipos internos del motor
 *
 * Son los objetos que viajan de una etapa a la siguiente. Que cada etapa
 * declare qué recibe y qué devuelve es lo que hace que el modelo pueda
 * inspeccionarse por partes en lugar de como una caja que entra lotes y
 * saca recetas.
 */

import type {
  Lote, ItemCatalogo, AporteLote, Descarte, Resultado, Requisito,
} from "../../modelo/tipos";
import type {
  Caracteristica, VectorPesos, SenalOperacion, EntradaAprendida,
} from "./pesos";

// =====================================================================
// Etapa 1 · Entrada
// =====================================================================

/** Entrada normalizada del modelo. Lo que las etapas siguientes leen. */
export interface EntradaModelo {
  /** Lotes de merma que el usuario seleccionó. */
  lotes: Lote[];
  /** Recetas candidatas: las activas que declaran al menos un requisito. */
  catalogo: ItemCatalogo[];
  /** Cantidad vigente por ingrediente en bodega, para medir cobertura. */
  inventario: Map<number, number>;
  /** Ocupación por área en [0,1], para la penalización operativa. */
  cargaPorArea: Map<number, number>;
  /** Instante de evaluación. Se inyecta: el motor no lee el reloj. */
  ahora: Date;
}

/** Lo que la etapa 1 descartó de la entrada, y por qué. */
export interface RechazoEntrada {
  que: string;
  motivo: string;
}

export interface SalidaEntrada {
  entrada: EntradaModelo;
  rechazos: RechazoEntrada[];
}

// =====================================================================
// Etapa 2 · Restricciones duras
// =====================================================================

export type CodigoRestriccion =
  | "R0" | "R1" | "R2" | "R3" | "R4" | "R5";

/** Una regla incumplida por un lote concreto. */
export interface Incumplimiento {
  regla: CodigoRestriccion;
  /** Código del lote que la incumple; vacío si la regla es del conjunto. */
  lote: string;
  /** Qué se observó, con la cifra que lo motiva. */
  observado: string;
}

export interface SalidaRestricciones {
  /** Verdadero si la receta pasa a la etapa de características. */
  admisible: boolean;
  /** Incumplimientos que bloquean. No solo el primero. */
  incumplimientos: Incumplimiento[];
  /**
   * Incumplimientos de reglas aplazadas: se evaluaron y fallaron, pero
   * no bloquean porque dependen de un dato que no se midió. La receta
   * sigue adelante y la propuesta sale marcada como no autorizable.
   *
   * Vacío siempre en el modo normal de operación.
   */
  aplazadas: Incumplimiento[];
  /** Regla que decide el descarte: la primera en el orden de evaluación. */
  decisiva: CodigoRestriccion | null;
  /** Lotes de la selección que esta receta puede usar. */
  usables: Lote[];
}

// =====================================================================
// Etapa 3 · Extracción de características
// =====================================================================

/**
 * Lo que el modelo observa de una pareja (conjunto de lotes, receta).
 *
 * `valores` es el vector del modelo: siete números en [0,1], sin pesos
 * aplicados. Es la representación sobre la que se puntúa, y por eso está
 * separada de la puntuación: con el vector a la vista puede comprobarse
 * que el modelo mide lo que dice medir, independientemente de cómo lo
 * combine después.
 */
export interface Caracteristicas {
  /** Veces que se multiplica la receta base para ajustarla al excedente. */
  escala: number;
  /** Qué lote cubre qué cantidad de qué requisito. */
  aportes: AporteLote[];
  /** Kilos de merma que la preparación consume. */
  kgUsados: number;
  /** Peso del plato terminado, para medir qué parte viene de merma. */
  pesoRecetaKg: number;
  /** El vector del modelo. Sin pesos. */
  valores: Record<Caracteristica, number>;
  /** Lo observado en cada eje, en palabras, para la explicación. */
  observaciones: Record<Caracteristica, string>;
  /**
   * Señales de operación del histórico de producción. Entran solo en el
   * componente aprendido, no en el valor de aprovechamiento.
   */
  senales: Record<SenalOperacion, number>;
  observacionesSenales: Record<SenalOperacion, string>;
  /** Horas de vida útil del lote más comprometido del conjunto. */
  horasConjunto: number;
  /** El lote que fija esa ventana. */
  masUrgente: Lote | undefined;
  /** Cantidad de merma disponible por ingrediente. */
  porIngrediente: Map<number, number>;
  /** Requisitos que la merma seleccionada no alcanza a cubrir. */
  faltantes: Requisito[];
  /** Coste de la merma que la preparación recupera. */
  costoRecuperado: number;
  /** Coste de todo lo seleccionado si terminara en la basura. */
  valorEnRiesgo: number;
}

// =====================================================================
// Etapa 4 · Puntuación
// =====================================================================

/**
 * Cómo se puntúa. `aprendida` es el modelo 3 y el valor por defecto;
 * `experta` reproduce el modelo 2 —aptitud = valor de aprovechamiento—
 * y se conserva para poder comparar las dos versiones sobre los mismos
 * datos.
 */
export type ModoPuntuacion = "aprendida" | "experta";

export interface Puntuacion {
  /**
   * Puntuación final, en [0,100] y con un decimal. En el modo aprendido
   * es P(ejecución) × valor; en el experto, el valor.
   */
  aptitud: number;
  /** Valor de aprovechamiento en [0,100]: la combinación de los 7 pesos. */
  valor: number;
  /** Probabilidad de ejecución estimada por el componente aprendido. */
  probabilidad: number;
  /** b + Σ wᵢ·xᵢ. σ(logit) = probabilidad. */
  logit: number;
  intercepto: number;
  /** wᵢ·xᵢ de cada una de las nueve entradas. Suman logit − intercepto. */
  contribucionesEjecucion: Record<EntradaAprendida, number>;
  coeficientes: Record<EntradaAprendida, number>;
  modo: ModoPuntuacion;
  /** Aporte de cada característica al VALOR. Suma = bruto. */
  contribuciones: Record<Caracteristica, number>;
  /** Suma antes de recortar al intervalo [0,100]. */
  bruto: number;
  /** Verdadero si el recorte actuó. Debe ser falso siempre. */
  recortada: boolean;
  /** Pesos con que se puntuó. Permite reproducir la cifra. */
  pesos: VectorPesos;
}

// =====================================================================
// Etapa 5 · Ordenamiento
// =====================================================================

/** Candidata que superó las restricciones, con todo lo calculado. */
export interface Candidata {
  item: ItemCatalogo;
  caracteristicas: Caracteristicas;
  puntuacion: Puntuacion;
}

// =====================================================================
// Traza de ejecución
// =====================================================================

export interface TrazaEtapa {
  codigo: "E1" | "E2" | "E3" | "E4" | "E5" | "E6";
  nombre: string;
  /** Qué recibe la etapa, en una línea. */
  entra: string;
  /** Qué produce, en una línea. */
  sale: string;
  /** Milisegundos consumidos. */
  ms: number;
  /** Cifras propias de la etapa, para imprimir o mostrar. */
  detalle: Record<string, unknown>;
}

/**
 * Registro completo de una ejecución del modelo.
 *
 * No es un registro de depuración: es el objeto que permite responder, de
 * cada recomendación concreta, qué datos entraron, qué reglas se
 * aplicaron, qué se midió, con qué pesos se combinó y de dónde sale la
 * frase que el usuario lee.
 */
export interface TrazaModelo {
  version: string;
  generadaEn: Date;
  pesos: VectorPesos;
  etapas: TrazaEtapa[];
  /** Vector de características de cada candidata admitida. */
  vectores: {
    receta: string;
    valores: Record<Caracteristica, number>;
    contribuciones: Record<Caracteristica, number>;
    senales: Record<SenalOperacion, number>;
    valor: number;
    probabilidad: number;
    aptitud: number;
  }[];
  /** Reglas incumplidas por receta descartada. */
  descartesDetallados: {
    receta: string;
    decisiva: CodigoRestriccion | null;
    incumplimientos: Incumplimiento[];
  }[];
  /** Milisegundos totales. */
  ms: number;
}

export interface SalidaModelo {
  resultados: Resultado[];
  descartes: Descarte[];
  traza: TrazaModelo;
}
