/**
 * Carga el caso congelado por `fijar-caso.ts` y reconstruye los tipos del
 * dominio, que el JSON no conserva: las fechas vuelven a ser `Date` y los
 * mapas vuelven a ser `Map`.
 */
import { readFileSync } from "node:fs";
import type { Lote, ItemCatalogo } from "@foodloop/dominio";

export interface CasoMotor {
  ahora: Date;
  lotes: Lote[];
  catalogo: ItemCatalogo[];
  inventario: Map<number, number>;
  cargas: Map<number, number>;
}

export function cargarCaso(ruta = "herramientas/caso-motor.json"): CasoMotor {
  const j = JSON.parse(readFileSync(ruta, "utf8"));
  return {
    ahora: new Date(j.ahora),
    lotes: j.lotes.map((l: Lote) => ({
      ...l,
      registradoEn: new Date(l.registradoEn),
      venceEn: new Date(l.venceEn),
    })),
    catalogo: j.catalogo as ItemCatalogo[],
    inventario: new Map<number, number>(j.inventario),
    cargas: new Map<number, number>(j.cargas),
  };
}
