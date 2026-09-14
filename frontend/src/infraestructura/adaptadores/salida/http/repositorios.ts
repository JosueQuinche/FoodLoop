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
  Estadisticas, EntradaMerma, Rol,
} from "@foodloop/dominio";

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
  async operacion(): Promise<ResumenOperacion> {
    const d = await pedir<ResumenOperacion>("/operacion");
    return {
      ...d,
      lotes: d.lotes.map((x: ResumenOperacion["lotes"][number]) => ({
        ...x, lote: aFecha(x.lote as unknown as Record<string, unknown>),
      })),
    };
  },

  async recomendaciones(loteId: number): Promise<SalidaRecomendacion> {
    const d = await pedir<SalidaRecomendacion>(`/lotes/${loteId}/recomendaciones`);
    return { ...d, lote: aFecha(d.lote as unknown as Record<string, unknown>) };
  },

  decidir(entrada: {
    loteId: number; recetaId: number;
    accion: Decision["accion"]; motivo?: string;
  }): Promise<Decision> {
    return pedir<Decision>("/decisiones", {
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
