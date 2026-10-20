/**
 * FoodLoop · Unidades de peso
 *
 * Servicio de dominio puro de presentación: convierte y da formato, no
 * almacena. En MongoDB y en todo el resto del dominio las cantidades
 * están en kilogramos y siguen estándolo; la libra existe únicamente
 * porque en la cocina las balanzas y las fichas de porcionado se leen en
 * libras, y hacer esa cuenta de cabeza en mitad de un turno es
 * precisamente donde se equivoca el porcionado.
 *
 * Vive en el dominio y no en la interfaz para que el número que se
 * muestra y el que se teclea pasen por la misma aritmética: si el
 * frontend convirtiera por su cuenta, el campo de registro y la cifra
 * del panel podrían dejar de cuadrar por redondeo.
 *
 * El tipo se llama `UnidadPeso` y no `Unidad` a propósito: `Unidad` ya
 * está tomado en el modelo y nombra otra cosa —la unidad en que se mide
 * el ingrediente, que puede ser kg, L o unid—. Son dos conceptos
 * distintos: aquel dice en qué está medido el producto, este en qué se
 * le muestra un peso al usuario.
 */

/**
 * Factor de conversión de la libra avoirdupois.
 *
 * Una libra son 0,45359237 kg por definición (acuerdo internacional de
 * 1959), de modo que el recíproco 1 kg = 2,20462262… lb es periódico y
 * hay que truncarlo en algún punto. Se trunca en ocho cifras y no en
 * dos porque el mismo factor se aplica a cifras acumuladas: con 2,2 el
 * error sobre el histórico de merma de un mes se cuenta en kilos y las
 * cifras del panel dejarían de cuadrar con las de la base, que es el
 * tipo de desajuste que hace desconfiar de todo el tablero.
 */
export const LB_POR_KG = 2.20462262;

/** Unidad en que se le presenta un peso al usuario. */
export type UnidadPeso = "kg" | "lb";

export const aLibras = (kg: number): number => kg * LB_POR_KG;

/** La inversa, para lo que el usuario teclea en libras antes de guardarlo. */
export const aKilogramos = (lb: number): number => lb / LB_POR_KG;

/** El valor numérico en la unidad pedida, sin formato. Para las gráficas. */
export const enUnidad = (kg: number, unidad: UnidadPeso): number =>
  unidad === "lb" ? aLibras(kg) : kg;

/**
 * Número con coma decimal y punto de miles.
 *
 * Es el formato que ya usa el resto del proyecto, que trabaja en es-EC.
 * Se expone aparte de `formatear` porque hay sitios de la interfaz que
 * pintan la cifra y la unidad en elementos distintos.
 */
export const numero = (valor: number, decimales = 1): string =>
  valor.toLocaleString("es-EC", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });

/** Un peso en kilogramos, mostrado en la unidad pedida: «4,5 kg». */
export const formatear = (
  kg: number, unidad: UnidadPeso, decimales = 1,
): string => `${numero(enUnidad(kg, unidad), decimales)} ${unidad}`;

/**
 * Las dos unidades a la vez: «4,5 kg (9,9 lb)».
 *
 * Para los sitios donde el dato se confirma antes de guardarlo y no
 * conviene que dependa de qué unidad tenga activa quien mira.
 */
export const formatearAmbas = (kg: number, decimales = 1): string =>
  `${formatear(kg, "kg", decimales)} (${formatear(kg, "lb", decimales)})`;

/**
 * Cantidad acompañada de la unidad en que está almacenada.
 *
 * El catálogo mide algunos ingredientes en litros y otros en piezas, y
 * ahí la libra no significa nada: la conversión se aplica solo cuando lo
 * guardado es masa y en los demás casos se devuelve la unidad original.
 * Sin esta comprobación un lote de 3 L de caldo de ave se anunciaría
 * como «6,6 lb».
 */
export const formatearCantidad = (
  cantidad: number,
  unidadBase: string | undefined,
  unidad: UnidadPeso,
  decimales = 1,
): string =>
  (unidadBase ?? "kg") === "kg"
    ? formatear(cantidad, unidad, decimales)
    : `${numero(cantidad, decimales)} ${unidadBase}`;

/** Si a una cantidad guardada en esta unidad le aplica la conversión. */
export const esMasa = (unidadBase: string | undefined): boolean =>
  (unidadBase ?? "kg") === "kg";
