/**
 * FoodLoop · Parámetros del modelo
 *
 * Este archivo contiene lo único del motor que es un parámetro y no una
 * regla: los siete pesos con que se combinan las características
 * observadas. Está separado del código que los aplica a propósito.
 *
 * La razón es que un peso y una regla se justifican de forma distinta.
 * Una regla sanitaria se defiende con la norma que la obliga; un peso se
 * defiende con el criterio de quien lo fijó, y más adelante con los datos
 * que lo confirmen o lo corrijan. Teniéndolos en un archivo aparte, con
 * su procedencia declarada, se puede sustituir el conjunto completo por
 * uno ajustado sobre el histórico de decisiones sin tocar una sola línea
 * de la lógica del motor: `puntuar()` recibe el vector de pesos como
 * argumento.
 *
 * Mientras no exista ese histórico, la procedencia de los siete es
 * `experto`. Declararlo es parte de la honestidad del modelo: un peso
 * fijado por criterio y uno estimado sobre datos no sostienen las mismas
 * afirmaciones.
 */

/**
 * Las siete características observables que el modelo mide sobre cada
 * pareja (conjunto de lotes, receta). Son los ejes del modelo: la etapa
 * de extracción produce un valor en [0,1] para cada una y la etapa de
 * puntuación los combina. Añadir una característica es añadir una
 * entrada aquí, su cálculo en la etapa 3 y su peso en la tabla de abajo.
 */
export type Caracteristica =
  | "cobertura"
  | "aporteMerma"
  | "urgencia"
  | "absorcion"
  | "jerarquia"
  | "aceptacion"
  | "cargaArea";

/** Orden canónico. Fija el orden del vector y el de la explicación. */
export const CARACTERISTICAS: readonly Caracteristica[] = [
  "cobertura", "aporteMerma", "urgencia", "absorcion",
  "jerarquia", "aceptacion", "cargaArea",
] as const;

export interface ParametroPeso {
  /** Valor con que se multiplica la característica. Negativo = penaliza. */
  valor: number;
  /** De dónde sale el valor. Condiciona lo que puede afirmarse de él. */
  origen: "experto" | "aprendido";
  /** Nombre con que aparece en la explicación al usuario. */
  etiqueta: string;
  /** Por qué pesa lo que pesa, en una frase, para el usuario final. */
  porQue: string;
  /** Fundamento del criterio, para el lector académico. */
  fundamento: string;
}

/**
 * Tabla de parámetros del modelo.
 *
 * Los valores proceden de la jerarquía de gestión del excedente
 * alimentario (Papargyropoulou et al., 2014): primero que la preparación
 * sea posible con lo que hay, después que dé salida a la mayor cantidad
 * de excedente, después la urgencia, y en último lugar los factores de
 * conveniencia operativa.
 */
export const PARAMETROS: Record<Caracteristica, ParametroPeso> = {
  cobertura: {
    valor: 0.30,
    origen: "experto",
    etiqueta: "Cobertura de la receta con los lotes elegidos",
    porQue: "Es el que más pesa: si la receta no se puede armar con lo que "
      + "hay, lo demás da igual.",
    fundamento: "Viabilidad de la preparación. Una recomendación que exige "
      + "comprar la mitad de los ingredientes no gestiona excedente: "
      + "introduce coste nuevo.",
  },
  aporteMerma: {
    valor: 0.22,
    origen: "experto",
    etiqueta: "Proporción del plato que proviene de merma",
    porQue: "Pesa alto porque mide cuánto excedente sale de verdad en el "
      + "plato. Una receta que lleva una pizca no resuelve la merma.",
    fundamento: "Mide el aprovechamiento efectivo, que es el objetivo del "
      + "sistema. Separado de la cobertura porque una receta puede cubrir "
      + "todos sus requisitos con merma y seguir consumiendo poca cantidad.",
  },
  urgencia: {
    valor: 0.20,
    origen: "experto",
    etiqueta: "Vida útil del lote más comprometido",
    porQue: "Pesa alto porque lo que vence antes hay que resolverlo antes.",
    fundamento: "Prioridad temporal. El excedente es un recurso que caduca; "
      + "una recomendación excelente que llega tarde no evita la pérdida.",
  },
  absorcion: {
    valor: 0.12,
    origen: "experto",
    etiqueta: "Parte de lo seleccionado que consume la preparación",
    porQue: "Pesa menos: lo que sobre del lote todavía puede ir a otra "
      + "preparación el mismo día.",
    fundamento: "Pesa menos que el aporte porque el remanente no se pierde "
      + "necesariamente: puede atenderse en una segunda recomendación dentro "
      + "de la misma ventana sanitaria.",
  },
  jerarquia: {
    valor: 0.12,
    origen: "experto",
    etiqueta: "Nivel en la jerarquía de aprovechamiento",
    porQue: "Pesa menos: congelar también sirve, pero solo aplaza la "
      + "decisión en lugar de resolverla.",
    fundamento: "Jerarquía de gestión del excedente (Papargyropoulou et al., "
      + "2014): la reutilización que devuelve el excedente a alimentación "
      + "humana es preferible a la conservación.",
  },
  aceptacion: {
    valor: 0.10,
    origen: "experto",
    etiqueta: "Aceptación histórica del plato",
    porQue: "Pesa poco: que el plato guste orienta, pero no decide si la "
      + "merma se aprovecha o se bota.",
    fundamento: "Un plato rechazado por el comensal genera merma nueva, de "
      + "modo que el factor es pertinente; pesa poco porque la alternativa a "
      + "un plato poco aceptado suele ser el descarte, que es peor.",
  },
  cargaArea: {
    valor: -0.06,
    origen: "experto",
    etiqueta: "Carga de trabajo del área",
    porQue: "Es el único que resta: si el área está saturada, la "
      + "preparación es menos realista para hoy.",
    fundamento: "Única penalización del modelo. Recoge la factibilidad "
      + "operativa: una propuesta correcta que el área no puede ejecutar hoy "
      + "no se ejecuta.",
  },
};

/** Vector de pesos. Es lo que recibe la etapa de puntuación. */
export type VectorPesos = Record<Caracteristica, number>;

export const PESOS: VectorPesos = Object.fromEntries(
  CARACTERISTICAS.map((c) => [c, PARAMETROS[c].valor]),
) as VectorPesos;

/**
 * Cota superior de la puntuación con estos pesos.
 *
 * Los pesos positivos suman 1,06, de modo que la puntuación teórica
 * máxima es 106 y no 100. Se documenta en lugar de reescalar porque
 * exigiría que las siete características valieran 1 a la vez con el área
 * descargada, combinación que no se ha observado: en el conjunto de
 * prueba la puntuación más alta es 86. Si al cargar los datos reales
 * apareciera alguna propuesta por encima de 100, el recorte quedaría
 * registrado en la traza (`recortada`) y entonces procedería normalizar.
 */
export const cotaSuperior = (pesos: VectorPesos = PESOS): number =>
  CARACTERISTICAS.reduce((a, c) => a + Math.max(0, pesos[c]), 0) * 100;
