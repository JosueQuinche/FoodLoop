/**
 * FoodLoop · Descripción del propio modelo
 *
 * El modelo se describe a sí mismo: qué etapas tiene, qué hace cada una,
 * en qué archivo vive y por qué está separada de las demás.
 *
 * Esto no es documentación suelta. Está en el código y se sirve por la
 * API, de modo que lo que se cuenta del modelo y lo que el modelo hace
 * no pueden divergir: si una etapa cambia de responsabilidad y nadie
 * actualiza esta tabla, la discrepancia aparece en la pantalla que la
 * muestra, no en una memoria que ya nadie relee.
 */

export interface DescripcionEtapa {
  codigo: "E1" | "E2" | "E3" | "E4" | "E5" | "E6";
  nombre: string;
  archivo: string;
  entra: string;
  sale: string;
  porQue: string;
}

export const ETAPAS: readonly DescripcionEtapa[] = [
  {
    codigo: "E1",
    nombre: "Entrada de datos",
    archivo: "dominio/src/servicios/motor/e1-entrada.ts",
    entra: "lotes seleccionados, catálogo de recetas, inventario de bodega, "
      + "carga por área e instante de evaluación",
    sale: "la misma entrada depurada, más el registro de lo que se rechazó "
      + "y por qué",
    porQue: "El motor no consulta la base ni lee el reloj: todo entra como "
      + "argumento. Es lo que permite ejecutarlo sobre un caso congelado y "
      + "obtener la misma salida, que es la condición para poder verificarlo.",
  },
  {
    codigo: "E2",
    nombre: "Restricciones duras",
    archivo: "dominio/src/servicios/motor/e2-restricciones.ts",
    entra: "una receta candidata y los lotes seleccionados",
    sale: "si es admisible y, si no, qué reglas incumple y cuál decide",
    porQue: "Va antes de medir y de puntuar. Así ninguna puntuación alta "
      + "puede rescatar una propuesta que incumple una restricción "
      + "sanitaria: estructuralmente, no llega a puntuarse.",
  },
  {
    codigo: "E3",
    nombre: "Extracción de características",
    archivo: "dominio/src/servicios/motor/e3-caracteristicas.ts",
    entra: "una receta admisible y los lotes que puede usar",
    sale: "siete números en [0,1] —el vector del modelo—, dos señales de "
      + "operación sacadas del histórico de producción y lo observado en "
      + "cada eje, en palabras",
    porQue: "Es la etapa que convierte una situación de cocina en una "
      + "representación comparable entre recetas distintas. No conoce los "
      + "pesos: solo mide. Separarla permite comprobar que el modelo mide lo "
      + "que dice medir sin discutir a la vez cómo lo combina.",
  },
  {
    codigo: "E4",
    nombre: "Puntuación",
    archivo: "dominio/src/servicios/motor/e4-puntuacion.ts",
    entra: "el vector, los siete pesos de valor y los nueve coeficientes "
      + "aprendidos por regresión logística",
    sale: "la aptitud = P(ejecución) × valor de aprovechamiento, con la "
      + "contribución de cada eje a cada parte",
    porQue: "El valor dice qué conviene a la merma (criterio experto); la "
      + "probabilidad, qué ejecuta de verdad la cocina (aprendida de datos). "
      + "Las dos partes son lineales en su escala, de modo que la "
      + "explicación sigue siendo exacta y no una aproximación posterior.",
  },
  {
    codigo: "E5",
    nombre: "Ordenamiento",
    archivo: "dominio/src/servicios/motor/e5-ordenamiento.ts",
    entra: "las candidatas admisibles con su puntuación",
    sale: "las N mejores, ordenadas",
    porQue: "Los tres desempates están declarados —kilos aprovechados, "
      + "ventana más corta, código— para que la salida no dependa del orden "
      + "en que el catálogo venga de la base de datos.",
  },
  {
    codigo: "E6",
    nombre: "Explicación",
    archivo: "dominio/src/servicios/motor/e6-explicacion.ts",
    entra: "el vector, la puntuación y los pesos",
    sale: "la descomposición por factores (valor y ejecución), el resumen y "
      + "el contrafactual",
    porQue: "La explicación se lee de la aritmética que ya calculó la etapa "
      + "4, no se reconstruye. Las siete contribuciones suman el valor, las "
      + "nueve del componente aprendido suman el logit de la probabilidad, y "
      + "puede comprobarse con una calculadora.",
  },
] as const;

/** Lo que el modelo todavía no hace, dicho sin adornos. */
export const PENDIENTE: readonly string[] = [
  "La probabilidad de ejecución se aprende sobre un sustituto: que la "
  + "receta se produjera en el centro en las 48 h siguientes al lote. Dice "
  + "que la propuesta encaja en el menú real, no que la merma se usara en "
  + "ella; eso exige registrar las decisiones del chef sobre las propuestas.",
  "La serie de producción del centro es una reconstrucción referencial. "
  + "Las métricas describen el comportamiento del modelo sobre esos "
  + "registros y deben confirmarse con datos de operación medidos.",
  "Los siete pesos del valor de aprovechamiento siguen siendo de criterio "
  + "experto: son el objetivo del sistema, que se declara y no se infiere.",
] as const;

export const TIPO_MODELO =
  "Recomendador híbrido con aprendizaje automático supervisado: "
  + "restricciones sanitarias duras, valor de aprovechamiento de criterio "
  + "experto y probabilidad de ejecución estimada por regresión logística "
  + "sobre el histórico de producción. Aptitud = P(ejecución) × valor.";
