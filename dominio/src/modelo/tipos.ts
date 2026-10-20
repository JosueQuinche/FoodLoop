/**
 * FoodLoop · Tipos del dominio
 *
 * El motor es agnóstico respecto del catálogo: no conoce el dominio
 * culinario. Opera sobre dos abstracciones, `Lote` (elemento disponible)
 * e `ItemCatalogo` (alternativa que declara requisitos). Los parámetros
 * propios de cada alternativa viven en el catálogo, no en el motor.
 */

export type EstadoProducto = "crudo" | "cocido";
export type AdmiteEstado = EstadoProducto | "ambos";

export type TipoProceso =
  | "reproceso_termico"
  | "ensamblaje_frio"
  | "conservacion"
  | "panaderia";

export type Causa =
  | "sobreproduccion"
  | "devolucion_linea"
  | "error_porcionado"
  | "caducidad_proxima"
  | "defecto_calidad";

export type Unidad = "kg" | "L" | "unid";

export type Rol = "chef" | "produccion" | "admin" | "calidad";

export interface Ingrediente {
  id: number;
  codigo: string;
  nombre: string;
  categoria: string;
  unidad: Unidad;
  costoUnitario: number;
  vidaUtilCrudoH: number;
  vidaUtilCocidoH: number;
  tempMaxC: number;
}

/**
 * Estado del dictamen sanitario de un lote.
 *
 * El tercer valor existe porque los registros del centro de producción
 * no traen el dictamen evaluado: declaran la condición que habría que
 * comprobar. Decir «no apto» de un lote que nadie examinó sería tan
 * falso como decir «apto», y con `aptoReproceso` a secas no se podía
 * distinguir «se comprobó y no sirve» de «no se comprobó».
 */
export type Dictamen = "apto" | "no_apto" | "pendiente";

export interface Lote {
  id: number;
  codigo: string;
  ingredienteId: number;
  ingrediente: string;
  cantidad: number;
  unidad: Unidad;
  costoUnitario: number;
  estadoProducto: EstadoProducto;
  temperaturaC: number;
  aptoReproceso: boolean;
  /**
   * Opcional por compatibilidad: ausente equivale a derivarlo de
   * `aptoReproceso`, que es lo que hacen los registros anteriores.
   */
  dictamen?: Dictamen;
  /**
   * Campos cuyo valor no se midió sino que se derivó de una regla al
   * importar. Viaja con el lote para que la explicación pueda decir
   * sobre qué supuestos se calculó.
   */
  camposDerivados?: string[];
  registradoEn: Date;
  venceEn: Date;
  areaId: number;
  area: string;
  servicio: string;
  causa: Causa;
}

/** Dictamen efectivo de un lote, con el valor heredado si no lo declara. */
export const dictamenDe = (l: Lote): Dictamen =>
  l.dictamen ?? (l.aptoReproceso ? "apto" : "no_apto");

/**
 * Ingrediente que una receta requiere. Vive embebido dentro del
 * documento de la receta: es la relación entre ambos.
 *
 * `nombre` y `unidad` se copian del catálogo de ingredientes a
 * propósito. En un modelo documental esa duplicación es deliberada:
 * permite leer una receta completa sin consultar otra colección, que
 * es la razón de ser de embeber. `ingredienteId` sigue siendo la
 * referencia autorizada para cualquier cálculo.
 */
export interface Requisito {
  ingredienteId: number;
  nombre?: string;
  unidad?: string;
  cantidad: number;
  esPrincipal: boolean;
  admiteEstado: AdmiteEstado;
}

export interface ItemCatalogo {
  id: number;
  codigo: string;
  nombre: string;
  areaId: number;
  area: string;
  porcionesBase: number;
  pesoPorcionG: number;
  minutos: number;
  tipoProceso: TipoProceso;
  tempProcesoC: number;
  aceptacion: number;
  requisitos: Requisito[];
  pasos: string[];
  /**
   * Fechas (AAAA-MM-DD) en que el centro produjo esta receta. Es la
   * memoria de operación de la que el componente aprendido saca sus dos
   * señales. Opcional: sin historial, las dos señales valen cero y el
   * modelo sigue funcionando con las siete características.
   */
  producciones?: string[];
}

/** Porción de un lote que una recomendación consume. */
export interface AporteLote {
  lote: Lote;
  cantidadUsada: number;
  /** Cubre el ingrediente principal de la receta o uno complementario. */
  esPrincipal: boolean;
}

export interface Factor {
  nombre: string;
  valorObservado: string;
  peso: number;
  contribucion: number;
  /**
   * Por qué este factor pesa lo que pesa, en una frase.
   *
   * Mostrar el peso sin justificarlo deja al usuario ante un número
   * arbitrario: en la evaluación con usuarios, «entiendo por qué unos
   * factores pesan más que otros» quedó entre los ítems más bajos.
   */
  porQue: string;
}

export interface Resultado {
  /** Asignado al persistir la traza; la interfaz lo usa para decidir. */
  recomendacionId?: number;
  item: ItemCatalogo;
  aptitud: number;
  factores: Factor[];
  /** Qué lotes consume y en qué cantidad. Antes era un único lote. */
  aportes: AporteLote[];
  kgAprovechados: number;
  porciones: number;
  costoRecuperado: number;
  /**
   * Lo que valen los lotes seleccionados si terminaran en la basura.
   * Puesto junto a `costoRecuperado` convierte la recomendación en una
   * cifra que la administración puede leer: cuánto hay en juego y qué
   * parte rescata esta preparación.
   */
  valorEnRiesgo: number;
  escala: number;
  contrafactuales: string[];
  resumen: string;
  /**
   * Falso cuando la propuesta se calculó aplazando una regla sanitaria
   * por falta de medición. El potencial de aprovechamiento es real; la
   * autorización para ejecutarla, no.
   *
   * Ausente en el modo normal, donde toda propuesta es autorizable
   * porque ninguna regla se aplazó.
   */
  autorizable?: boolean;
  /** Qué habría que medir para poder autorizarla. Una línea por falta. */
  faltaMedir?: string[];
  /**
   * Componente aprendido (modelo 3). `aptitud` es el producto de las dos
   * cifras: probabilidad de ejecución × valor de aprovechamiento.
   */
  probabilidadEjecucion?: number;
  /** Valor de aprovechamiento en [0,100]: la aptitud del modelo 2. */
  valorAprovechamiento?: number;
  /**
   * Las nueve contribuciones al logit de la probabilidad. Suman, con el
   * intercepto, exactamente el logit: la explicación de la parte
   * aprendida es tan aritmética como la del valor.
   */
  factoresEjecucion?: Factor[];
  interceptoEjecucion?: number;
}

/**
 * Lote que el usuario no seleccionó pero que mejoraría la propuesta.
 * La selección la decide el chef; el sistema solo señala la oportunidad.
 */
export interface Sugerencia {
  lote: Lote;
  motivo: string;
  /** Cuánto subiría la aptitud si se incorporara. */
  gananciaAptitud: number;
}

export interface Descarte {
  alternativa: string;
  motivo: string;
}

export interface Decision {
  id: string;
  /** La decisión aprueba una recomendación completa, no un lote suelto. */
  recomendacionId: number;
  recetaId: number;
  rol: Rol;
  /**
   * Referencia a la cuenta que decidió. Permite consultar el historial
   * por persona, que con el nombre solo sería ambiguo.
   */
  usuarioId: string;
  /**
   * Nombre en el momento de decidir. Se conserva junto al identificador
   * a propósito: un registro de trazabilidad debe seguir diciendo quién
   * decidió aunque la cuenta cambie de nombre o se desactive.
   */
  usuario: string;
  accion: "aprobada" | "modificada" | "descartada";
  motivo?: string;
  decididaEn: Date;
}


/** Cuenta de una persona que opera el sistema. */
export interface Usuario {
  id: string;
  correo: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  creadoEn: Date;
  ultimoAcceso?: Date;
}

/** Sesión abierta tras autenticarse. */
export interface Sesion {
  usuario: Usuario;
  token: string;
}
