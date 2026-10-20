/**
 * FoodLoop · Etapa 6 · Explicación
 *
 * Qué recibe:  el vector de características, la puntuación y los pesos.
 * Qué produce: la descomposición por factores, el resumen en una frase y
 *              el contrafactual.
 *
 * La explicación no se reconstruye: se lee de la aritmética que ya
 * calculó la etapa 4. La contribución que el usuario ve de cada factor
 * es exactamente el término que entró en la suma, no una estimación
 * posterior de cuánto influyó. Por eso las siete contribuciones suman el
 * valor de aprovechamiento, las nueve del componente aprendido suman
 * (con el intercepto) el logit de la probabilidad de ejecución, y la
 * aptitud es el producto de las dos cifras. Todo se comprueba con una
 * calculadora.
 *
 * Tres niveles, porque en la evaluación con usuarios quedó claro que no
 * todos quieren lo mismo:
 *
 *   · resumen        una frase, para decidir sin leer nada más;
 *   · factores       los siete ejes con su valor, su peso y su aporte;
 *   · contrafactual  qué tendría que cambiar para que la salida fuera
 *                    otra, que es lo que delimita el alcance de la
 *                    recomendación.
 */

import type { ItemCatalogo, Factor, Lote } from "../../modelo/tipos";
import { CARACTERISTICAS, PARAMETROS, ENTRADAS_APRENDIDAS, etiquetaEntrada } from "./pesos";
import type { VectorPesos } from "./pesos";
import type { Caracteristicas, Puntuacion } from "./tipos";

/**
 * Descompone la puntuación en los siete términos que la forman.
 *
 * `peso` y `contribucion` viajan separados a propósito: el peso dice
 * cuánto importa el eje en general y la contribución cuánto aportó en
 * este caso. Mostrar solo la contribución dejaba al usuario sin saber si
 * un aporte bajo venía de que el factor pesa poco o de que se observó
 * poco, que son cosas distintas y llevan a decisiones distintas.
 */
export function descomponer(
  c: Caracteristicas, p: Puntuacion, pesos: VectorPesos,
): Factor[] {
  return CARACTERISTICAS.map((eje) => ({
    nombre: PARAMETROS[eje].etiqueta,
    valorObservado: c.observaciones[eje],
    peso: pesos[eje],
    contribucion: p.contribuciones[eje],
    porQue: PARAMETROS[eje].porQue,
  }));
}

/**
 * Descompone el logit de la probabilidad de ejecución en sus nueve
 * términos. `peso` es el coeficiente aprendido y `contribucion` el
 * término wⱼ·xⱼ en log-odds: positivos acercan la propuesta al menú
 * real, negativos la alejan. Con el intercepto, suman el logit.
 */
export function descomponerEjecucion(c: Caracteristicas, p: Puntuacion): Factor[] {
  return ENTRADAS_APRENDIDAS.map((e) => {
    const { etiqueta, porQue: porQueSenal } = etiquetaEntrada(e);
    const w = p.coeficientes[e] ?? 0;
    // La justificación del peso experto no sirve aquí: este coeficiente no
    // lo fijó nadie, lo estimó el ajuste. Se dice lo que el ajuste encontró.
    const porQue = !(CARACTERISTICAS as readonly string[]).includes(e)
      ? porQueSenal
      : w === 0
        ? "Sin variación en los datos de entrenamiento: el modelo no pudo "
          + "estimar su efecto y no lo usa."
        : w > 0
          ? "Aprendido del histórico: cuanto mayor es, más probable es que "
            + "la cocina prepare la receta."
          : "Aprendido del histórico: cuanto mayor es, menos probable es que "
            + "la cocina prepare la receta.";
    const observado = e in c.observaciones
      ? c.observaciones[e as keyof typeof c.observaciones]
      : c.observacionesSenales[e as keyof typeof c.observacionesSenales];
    return {
      nombre: etiqueta,
      valorObservado: observado,
      peso: p.coeficientes[e] ?? 0,
      contribucion: p.contribucionesEjecucion[e],
      porQue,
    };
  });
}

export function resumir(c: Caracteristicas, item: ItemCatalogo): string {
  const { aportes, horasConjunto: horas, escala } = c;
  const aporte = c.valores.aporteMerma;
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
 *
 * Se devuelve UNA sola frase, en el lenguaje de la cocina y con la
 * consecuencia concreta. En la evaluación con usuarios este fue el ítem
 * peor valorado: salían tres párrafos a la vez y en jerga («ventana
 * sanitaria», «elevaría la aptitud»), de modo que la explicación que
 * debía dar confianza terminaba estorbando. Se conserva el arreglo por
 * compatibilidad con la traza almacenada.
 */
export function contrafactual(
  c: Caracteristicas, item: ItemCatalogo, usables: Lote[],
): string[] {
  const margen = item.minutos / 60 + 1;
  const holgura = c.horasConjunto - margen;   // horas de sobra sobre lo que exige el proceso
  const masUrgente = c.masUrgente;
  const sanitario = masUrgente
    ? [`Si a ${masUrgente.codigo} le quedaran menos de ${margen.toFixed(0)} `
      + `horas, esta receta ya no se propondría.`]
    : null;

  // El orden no es arbitrario: se muestra lo que el usuario puede usar
  // ahora. El aviso sanitario solo informa cuando el margen está cerca;
  // con holgura amplia es ruido, porque la etapa 2 ya garantiza que el
  // proceso cabe en la ventana del lote.
  if (holgura < 3 && sanitario) return sanitario;

  if (c.faltantes.length > 0)
    return [c.faltantes.length === 1
      ? "Un ingrediente sale de bodega y no de merma. Si añades un lote que "
        + "lo cubra, esta receta sube de puesto."
      : `${c.faltantes.length} ingredientes salen de bodega y no de merma. Si `
        + `añades lotes que los cubran, esta receta sube de puesto.`];

  if (holgura < 8 && sanitario) return sanitario;

  if (usables.length > 1)
    return ["Por separado, ninguno de estos lotes alcanza para la receta. "
      + "Es la combinación la que la hace posible."];

  return ["Si añades otro lote compatible, esta misma receta aprovecharía "
    + "más excedente."];
}
