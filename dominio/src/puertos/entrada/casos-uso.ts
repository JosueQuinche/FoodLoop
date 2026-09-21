/**
 * FoodLoop · Puertos de entrada (driving ports)
 *
 * Casos de uso que el sistema ofrece al exterior. La interfaz de usuario
 * es solo uno de los posibles adaptadores de entrada: una CLI, una tarea
 * programada o una API REST consumirían exactamente estos mismos puertos.
 *
 * La UI depende de estas interfaces, nunca de sus implementaciones. Eso
 * permite montar la interfaz contra dobles de prueba sin levantar nada.
 */

import type {
  Lote, Resultado, Descarte, Rol, Decision, Sugerencia, Usuario,
} from "../../modelo/tipos";

export interface LotePendiente {
  lote: Lote;
  horasRestantes: number;
  estadoVida: "apto" | "por_vencer" | "critico" | "vencido" | "sin_dictamen";
  valorEnRiesgo: number;
}

export interface ResumenOperacion {
  lotes: LotePendiente[];
  kgDisponibles: number;
  enRiesgo: number;
  valorEnRiesgo: number;
  aptos: number;
  decisiones: number;
}

/** Caso de uso 1: consultar el estado de la operación. */
export interface ConsultarOperacion {
  ejecutar(): Promise<ResumenOperacion>;
}

export interface SalidaRecomendacion {
  /** Los lotes que el usuario seleccionó para esta evaluación. */
  lotes: Lote[];
  resultados: Resultado[];
  descartes: Descarte[];
  /** Lotes no seleccionados que elevarían la aptitud. */
  sugerencias: Sugerencia[];
  versionModelo: string;
}

/** Caso de uso 2: obtener recomendaciones para uno o varios lotes. */
export interface ObtenerRecomendaciones {
  ejecutar(loteIds: number | number[]): Promise<SalidaRecomendacion>;
}

/** Caso de uso 3: registrar la decisión del responsable. */
export interface RegistrarDecision {
  ejecutar(entrada: {
    recomendacionId: number;
    recetaId: number;
    accion: Decision["accion"];
    motivo?: string;
  }): Promise<Decision>;
}

/** Caso de uso 8: valorar la claridad de una explicación. */
export interface RegistrarFeedback {
  ejecutar(entrada: {
    recomendacionId: number;
    claridad: "clara" | "confusa" | "insuficiente";
    factorConfuso?: string;
    comentario?: string;
  }): Promise<void>;
}

/**
 * Caso de uso 4: consultar qué puede hacer el rol activo.
 *
 * Los permisos viven en el dominio, no en la interfaz. Si la UI los
 * decidiera, cada nuevo adaptador de entrada tendría que reimplementar
 * las mismas reglas y acabarían divergiendo.
 */
export interface Permisos {
  aprueba: boolean;
  editaRecetario: boolean;
  veCostos: boolean;
  dictaminaSanidad: boolean;
}

export interface ConsultarPermisos {
  ejecutar(rol: Rol): Permisos;
}

/** Datos que el usuario captura al registrar una merma. */
export interface EntradaMerma {
  ingredienteId: number;
  areaId: number;
  servicioId: number;
  cantidad: number;
  estadoProducto: "crudo" | "cocido";
  temperaturaC: number;
  causa: Lote["causa"];
  aptoReproceso: boolean;
}

/**
 * Caso de uso 5: registrar una merma.
 *
 * La vida útil no la fija el usuario: se deriva del ingrediente y del
 * estado del producto. Dejar que se escriba a mano abriría la puerta a
 * que un lote vencido pareciera vigente.
 */
export interface RegistrarMerma {
  ejecutar(entrada: EntradaMerma): Promise<Lote>;
}

/** Series para las gráficas del panel. */
export interface Estadisticas {
  porCausa: { causa: string; kg: number }[];
  porArea: { area: string; kg: number; capacidadKg: number }[];
  porDia: { fecha: string; registrada: number; aprovechada: number }[];
  porEstadoVida: { estado: string; lotes: number }[];
  totalKg: number;
  totalValor: number;
  kgAprovechados: number;
}

/** Caso de uso 6: indicadores agregados para el panel. */
export interface ConsultarEstadisticas {
  ejecutar(): Promise<Estadisticas>;
}

/** Caso de uso 7: catálogo de ingredientes y áreas para el formulario. */
export interface ConsultarMaestros {
  ejecutar(): Promise<{
    ingredientes: { id: number; nombre: string; unidad: string }[];
    areas: { id: number; nombre: string }[];
    servicios: string[];
  }>;
}

/** Caso de uso 9: autenticar a una persona. */
export interface IniciarSesion {
  ejecutar(entrada: { correo: string; clave: string }): Promise<Usuario>;
}

/** Caso de uso 10: dar de alta una cuenta. */
export interface RegistrarUsuario {
  ejecutar(entrada: {
    correo: string; nombre: string; rol: Rol; clave: string;
  }): Promise<Usuario>;
}

/** Error de dominio. La UI lo distingue de un fallo de infraestructura. */
export class ErrorDominio extends Error {
  constructor(mensaje: string, readonly codigo: string) {
    super(mensaje);
    this.name = "ErrorDominio";
  }
}
