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
  registradoEn: Date;
  venceEn: Date;
  areaId: number;
  area: string;
  servicio: string;
  causa: Causa;
}

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
