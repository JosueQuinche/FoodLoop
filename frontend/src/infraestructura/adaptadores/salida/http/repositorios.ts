/**
 * FoodLoop · Cliente de la API
 *
 * Toda la fricción de hablar con HTTP vive aquí: rutas, cabeceras,
 * deserialización de fechas y traducción de códigos de error a errores
 * de dominio, para que la interfaz muestre el motivo real.
 */

import { ErrorDominio } from "@foodloop/dominio";
import type {
  ResumenOperacion, SalidaRecomendacion, Decision, Lote,
  Estadisticas, EntradaMerma, Rol, Usuario,
} from "@foodloop/dominio";

export interface InventarioItem {
  ingredienteId: number;
  ingrediente: string;
  categoria: string;
  unidad: string;
  lotes: number;
  disponible: number;
  valor: number;
  horasMinimas: number;
}

export interface HistorialItem {
  recomendacionId: number;
  generadaEn: string;
  receta: string;
  aptitud: number;
  lotes: string;
  nLotes: number;
  kgAprovechados: number;
  costoRecuperado: number;
  accion: string | null;
  usuario: string | null;
  rol: string | null;
  claridad: string | null;
}

const BASE = (import.meta.env?.VITE_API as string) ?? "/api";

export interface Maestros {
  ingredientes: { id: number; nombre: string; unidad: string }[];
  areas: { id: number; nombre: string }[];
  servicios: string[];
}

let rolActivo: Rol = "chef";
let usuarioActivo = "Mateo Calderón";

export function fijarSesion(rol: Rol, usuario: string) {
  rolActivo = rol;
  usuarioActivo = usuario;
}

async function pedir<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  const r = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Rol": rolActivo,
      "X-Usuario": usuarioActivo,
      ...opciones.headers,
    },
  });

  if (!r.ok) {
    const cuerpo = await r.json().catch(() => null);
    // Un 4xx con código es una respuesta legítima del negocio, no un fallo.
    if (cuerpo?.codigo)
      throw new ErrorDominio(cuerpo.error ?? "Operación rechazada", cuerpo.codigo);
    throw new Error(`La API respondió ${r.status} en ${ruta}`);
  }
  return r.json() as Promise<T>;
}

const aFecha = (l: Record<string, unknown>): Lote => ({
  ...(l as unknown as Lote),
  registradoEn: new Date(l.registradoEn as string),
  venceEn: new Date(l.venceEn as string),
});

export const api = {
  /** Autenticación contra la base, no contra perfiles del código. */
  async iniciarSesion(correo: string, clave: string): Promise<Usuario> {
    const u = await pedir<Record<string, unknown>>("/sesion", {
      method: "POST", body: JSON.stringify({ correo, clave }),
    });
    return { ...(u as unknown as Usuario), creadoEn: new Date(u.creadoEn as string) };
  },

  registrar(d: {
    correo: string; nombre: string; rol: Rol; clave: string;
  }): Promise<Usuario> {
    return pedir<Usuario>("/usuarios", {
      method: "POST", body: JSON.stringify(d),
    });
  },

  /** Inventario vigente, para el panel de disponibilidad (Fase 2). */
  inventario(): Promise<InventarioItem[]> {
    return pedir<InventarioItem[]>("/inventario");
  },

  /** Histórico de aprovechamiento (Fase 2). */
  historial(): Promise<HistorialItem[]> {
    return pedir<HistorialItem[]>("/historial");
  },

  async operacion(): Promise<ResumenOperacion> {
    const d = await pedir<ResumenOperacion>("/operacion");
    return {
      ...d,
      lotes: d.lotes.map((x: ResumenOperacion["lotes"][number]) => ({
        ...x, lote: aFecha(x.lote as unknown as Record<string, unknown>),
      })),
    };
  },

  /** Evalúa uno o varios lotes como un conjunto. */
  async recomendaciones(loteIds: number[]): Promise<SalidaRecomendacion> {
    const d = await pedir<SalidaRecomendacion>("/recomendaciones", {
      method: "POST", body: JSON.stringify({ loteIds }),
    });
    return {
      ...d,
      lotes: d.lotes.map((l) => aFecha(l as unknown as Record<string, unknown>)),
      sugerencias: (d.sugerencias ?? []).map((s) => ({
        ...s, lote: aFecha(s.lote as unknown as Record<string, unknown>),
      })),
      resultados: d.resultados.map((r) => ({
        ...r,
        aportes: (r.aportes ?? []).map((a) => ({
          ...a, lote: aFecha(a.lote as unknown as Record<string, unknown>),
        })),
      })),
    };
  },

  decidir(entrada: {
    recomendacionId: number; recetaId: number;
    accion: Decision["accion"]; motivo?: string;
  }): Promise<Decision> {
    return pedir<Decision>("/decisiones", {
      method: "POST", body: JSON.stringify(entrada),
    });
  },

  /** Valoración de la claridad de la explicación. */
  feedback(entrada: {
    recomendacionId: number;
    claridad: "clara" | "confusa" | "insuficiente";
    factorConfuso?: string;
  }): Promise<{ estado: string }> {
    return pedir<{ estado: string }>("/feedback", {
      method: "POST", body: JSON.stringify(entrada),
    });
  },

  async registrarMerma(entrada: EntradaMerma): Promise<Lote> {
    const l = await pedir<Record<string, unknown>>("/lotes", {
      method: "POST", body: JSON.stringify(entrada),
    });
    return aFecha(l);
  },

  estadisticas(): Promise<Estadisticas> {
    return pedir<Estadisticas>("/estadisticas");
  },

  maestros(): Promise<Maestros> {
    return pedir<Maestros>("/maestros");
  },

  permisos(rol: Rol) {
    return pedir<{
      aprueba: boolean; editaRecetario: boolean;
      veCostos: boolean; dictaminaSanidad: boolean;
    }>(`/permisos/${rol}`);
  },
};
