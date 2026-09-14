/**
 * FoodLoop · Puertos de salida (driven ports)
 *
 * Interfaces que el DOMINIO declara según lo que necesita, no según lo
 * que la infraestructura sabe ofrecer. Esta es la inversión de
 * dependencias que sostiene la arquitectura hexagonal: la flecha apunta
 * hacia adentro.
 *
 * Ninguna firma menciona SQL, HTTP, localStorage ni React. Si mañana el
 * repositorio pasa de memoria a PostgreSQL, cambia el adaptador y no
 * cambia ni el dominio ni la interfaz de usuario.
 *
 * Todas las operaciones son asíncronas aunque el adaptador en memoria
 * resuelva de inmediato. Declararlas síncronas ataría el contrato a la
 * implementación más simple y obligaría a reescribir las firmas al
 * introducir el adaptador HTTP.
 */

import type { Lote, ItemCatalogo, Decision, Rol } from "../../modelo/tipos";

/** Acceso a los elementos disponibles. Aquí, las mermas registradas. */
export interface RepositorioLotes {
  listarPendientes(): Promise<Lote[]>;
  obtenerPorId(id: number): Promise<Lote | null>;
  /** Cantidad vigente por ingrediente, para evaluar la cobertura. */
  inventarioDisponible(): Promise<Map<number, number>>;
  /** Persiste un lote nuevo y devuelve el registro con su identificador. */
  crear(datos: NuevoLote): Promise<Lote>;
}

/** Lo mínimo para dar de alta un lote. El resto lo deriva el dominio. */
export interface NuevoLote {
  ingredienteId: number;
  areaId: number;
  servicio: string;
  cantidad: number;
  estadoProducto: "crudo" | "cocido";
  temperaturaC: number;
  causa: Lote["causa"];
  aptoReproceso: boolean;
  registradoEn: Date;
  venceEn: Date;
}

/** Acceso al catálogo de alternativas. Aquí, el recetario institucional. */
export interface RepositorioCatalogo {
  listarActivos(): Promise<ItemCatalogo[]>;
  obtenerPorId(id: number): Promise<ItemCatalogo | null>;
}

/** Maestros necesarios para validar y presentar el formulario de alta. */
export interface RepositorioMaestros {
  ingredientes(): Promise<{
    id: number; nombre: string; unidad: string; costoUnitario: number;
    vidaUtilCrudoH: number; vidaUtilCocidoH: number; tempMaxC: number;
  }[]>;
  areas(): Promise<{ id: number; nombre: string; capacidadKg: number }[]>;
  servicios(): Promise<string[]>;
}

/** Agregados para las gráficas. El cálculo lo hace la base, no el dominio. */
export interface RepositorioEstadisticas {
  porCausa(): Promise<{ causa: string; kg: number }[]>;
  porArea(): Promise<{ area: string; kg: number; capacidadKg: number }[]>;
  porDia(dias: number): Promise<{ fecha: string; registrada: number; aprovechada: number }[]>;
  totales(): Promise<{ totalKg: number; totalValor: number; kgAprovechados: number }>;
}

/** Ocupación de cada área productiva, entre 0 y 1. */
export interface RepositorioCargas {
  cargasPorArea(): Promise<Map<number, number>>;
}

/**
 * Persistencia de las decisiones del usuario. Es lo que permite auditar
 * el modelo y alimentar su reentrenamiento, según la Fase 4.
 */
export interface RepositorioDecisiones {
  registrar(d: Omit<Decision, "id" | "decididaEn">): Promise<Decision>;
  listar(): Promise<Decision[]>;
}

/**
 * Traza de recomendaciones generadas. Separado del repositorio de
 * decisiones a propósito: una recomendación existe aunque nadie decida
 * sobre ella, y la Fase 3 necesita justamente esos casos.
 */
export interface RepositorioTrazas {
  guardar(traza: TrazaRecomendacion): Promise<void>;
  listar(): Promise<TrazaRecomendacion[]>;
}

export interface TrazaRecomendacion {
  loteId: number;
  generadaEn: Date;
  versionModelo: string;
  propuestas: { recetaId: number; aptitud: number; posicion: number }[];
  descartes: number;
}

/** Reloj. Inyectarlo hace el dominio determinista y testeable. */
export interface Reloj {
  ahora(): Date;
}

/** Quién opera el sistema. La UI no decide permisos; los consulta. */
export interface ProveedorSesion {
  rolActual(): Rol;
  usuarioActual(): string;
}
