/**
 * FoodLoop · Adaptadores de salida sobre PostgreSQL
 *
 * Toda la fricción de hablar con SQL vive aquí: consultas parametrizadas,
 * conversión de NUMERIC a number y mapeo de snake_case a camelCase.
 * `pg` devuelve NUMERIC como cadena para no perder precisión, así que
 * cada valor decimal pasa por Number() de forma explícita.
 */

import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type {
  RepositorioLotes, RepositorioCatalogo, RepositorioCargas,
  RepositorioDecisiones, RepositorioTrazas, RepositorioMaestros,
  RepositorioEstadisticas, TrazaRecomendacion, NuevoLote,
  Lote, ItemCatalogo, Decision, Requisito,
} from "@foodloop/dominio";

const { Pool } = pg;
const AQUI = dirname(fileURLToPath(import.meta.url));

export type Piscina = pg.Pool;

export function crearPiscina(cadena: string): Piscina {
  return new Pool({ connectionString: cadena, max: 10 });
}

/** Crea el esquema si no existe. Idempotente. */
export async function aplicarEsquema(piscina: Piscina): Promise<void> {
  await piscina.query(readFileSync(join(AQUI, "esquema.sql"), "utf8"));
}

type Fila = Record<string, unknown>;
const num = (v: unknown) => Number(v);

const aLote = (f: Fila): Lote => ({
  id: Number(f.id),
  codigo: String(f.codigo),
  ingredienteId: Number(f.ingrediente_id),
  ingrediente: String(f.ingrediente),
  cantidad: num(f.cantidad),
  unidad: f.unidad as Lote["unidad"],
  costoUnitario: num(f.costo_unitario),
  estadoProducto: f.estado_producto as Lote["estadoProducto"],
  temperaturaC: num(f.temperatura_c),
  aptoReproceso: Boolean(f.apto_reproceso),
  registradoEn: new Date(String(f.registrado_en)),
  venceEn: new Date(String(f.vence_en)),
  areaId: Number(f.area_id),
  area: String(f.area),
  servicio: String(f.servicio),
  causa: f.causa as Lote["causa"],
});

export class LotesPg implements RepositorioLotes {
  constructor(private readonly p: Piscina) {}

  async listarPendientes(): Promise<Lote[]> {
    const { rows } = await this.p.query(
      "SELECT * FROM v_lote_completo WHERE NOT decidido ORDER BY vence_en ASC");
    return rows.map(aLote);
  }

  async obtenerPorId(id: number): Promise<Lote | null> {
    const { rows } = await this.p.query(
      "SELECT * FROM v_lote_completo WHERE id = $1", [id]);
    return rows[0] ? aLote(rows[0]) : null;
  }

  async inventarioDisponible(): Promise<Map<number, number>> {
    const { rows } = await this.p.query(`
      SELECT ingrediente_id, SUM(cantidad) AS total
      FROM merma
      WHERE apto_reproceso AND vence_en > now()
      GROUP BY ingrediente_id`);
    const m = new Map<number, number>();
    for (const r of rows) m.set(Number(r.ingrediente_id), num(r.total));
    // Insumos de economato: siempre disponibles, no provienen de merma.
    for (const id of [2, 5, 6, 9, 11, 13]) m.set(id, (m.get(id) ?? 0) + 12);
    return m;
  }

  async crear(d: NuevoLote): Promise<Lote> {
    // El código se compone con la fecha y el identificador asignado por la
    // secuencia, de modo que no hay colisiones bajo concurrencia.
    const { rows } = await this.p.query(`
      INSERT INTO merma (codigo, ingrediente_id, area_id, servicio, cantidad,
        estado_producto, temperatura_c, causa, apto_reproceso,
        registrado_en, vence_en)
      VALUES ('PROVISIONAL', $1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id`,
      [d.ingredienteId, d.areaId, d.servicio, d.cantidad, d.estadoProducto,
       d.temperaturaC, d.causa, d.aptoReproceso,
       d.registradoEn.toISOString(), d.venceEn.toISOString()]);

    const id = Number(rows[0].id);
    const f = d.registradoEn;
    const codigo = `MRM-${String(f.getFullYear()).slice(2)}`
      + `${String(f.getMonth() + 1).padStart(2, "0")}`
      + `${String(f.getDate()).padStart(2, "0")}-${String(id).padStart(4, "0")}`;
    await this.p.query("UPDATE merma SET codigo = $1 WHERE id = $2", [codigo, id]);

    const lote = await this.obtenerPorId(id);
    if (!lote) throw new Error("El lote recién creado no se pudo recuperar.");
    return lote;
  }
}

export class CatalogoPg implements RepositorioCatalogo {
  constructor(private readonly p: Piscina) {}

  private async armar(filas: Fila[]): Promise<ItemCatalogo[]> {
    const { rows: reqs } = await this.p.query("SELECT * FROM receta_ingrediente");
    return filas.map((f) => ({
      id: Number(f.id),
      codigo: String(f.codigo),
      nombre: String(f.nombre),
      areaId: Number(f.area_id),
      area: String(f.area),
      porcionesBase: Number(f.porciones_base),
      pesoPorcionG: Number(f.peso_porcion_g),
      minutos: Number(f.minutos),
      tipoProceso: f.tipo_proceso as ItemCatalogo["tipoProceso"],
      tempProcesoC: num(f.temp_proceso_c),
      aceptacion: num(f.aceptacion),
      pasos: (f.pasos as string[]) ?? [],
      requisitos: reqs
        .filter((r) => Number(r.receta_id) === Number(f.id))
        .map((r): Requisito => ({
          ingredienteId: Number(r.ingrediente_id),
          cantidad: num(r.cantidad),
          esPrincipal: Boolean(r.es_principal),
          admiteEstado: r.admite_estado as Requisito["admiteEstado"],
        })),
    }));
  }

  async listarActivos(): Promise<ItemCatalogo[]> {
    const { rows } = await this.p.query(`
      SELECT r.*, a.nombre AS area FROM receta r
      JOIN area a ON a.id = r.area_id WHERE r.activa ORDER BY r.id`);
    return this.armar(rows);
  }

  async obtenerPorId(id: number): Promise<ItemCatalogo | null> {
    const { rows } = await this.p.query(`
      SELECT r.*, a.nombre AS area FROM receta r
      JOIN area a ON a.id = r.area_id WHERE r.id = $1`, [id]);
    return rows[0] ? (await this.armar(rows))[0] : null;
  }
}

export class CargasPg implements RepositorioCargas {
  constructor(private readonly p: Piscina) {}

  async cargasPorArea(): Promise<Map<number, number>> {
    const { rows } = await this.p.query(`
      SELECT a.id, a.capacidad_kg, COALESCE(SUM(m.cantidad), 0) AS kg
      FROM area a LEFT JOIN merma m ON m.area_id = a.id
      GROUP BY a.id, a.capacidad_kg`);
    const m = new Map<number, number>();
    for (const r of rows)
      m.set(Number(r.id), Math.min(1, num(r.kg) / num(r.capacidad_kg)));
    return m;
  }
}

export class DecisionesPg implements RepositorioDecisiones {
  constructor(private readonly p: Piscina) {}

  async registrar(d: Omit<Decision, "id" | "decididaEn">): Promise<Decision> {
    const completa: Decision = { ...d, id: randomUUID(), decididaEn: new Date() };
    await this.p.query(`
      INSERT INTO decision (id, merma_id, receta_id, rol, usuario, accion, decidida_en)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [completa.id, completa.loteId, completa.recetaId, completa.rol,
       completa.usuario, completa.accion, completa.decididaEn.toISOString()]);
    return completa;
  }

  async listar(): Promise<Decision[]> {
    const { rows } = await this.p.query(
      "SELECT * FROM decision ORDER BY decidida_en DESC");
    return rows.map((f) => ({
      id: String(f.id),
      loteId: Number(f.merma_id),
      recetaId: Number(f.receta_id),
      rol: f.rol as Decision["rol"],
      usuario: String(f.usuario),
      accion: f.accion as Decision["accion"],
      decididaEn: new Date(String(f.decidida_en)),
    }));
  }
}

export class TrazasPg implements RepositorioTrazas {
  constructor(private readonly p: Piscina) {}

  async guardar(t: TrazaRecomendacion): Promise<void> {
    await this.p.query(`
      INSERT INTO traza (merma_id, generada_en, version_modelo, propuestas, descartes)
      VALUES ($1,$2,$3,$4,$5)`,
      [t.loteId, t.generadaEn.toISOString(), t.versionModelo,
       JSON.stringify(t.propuestas), t.descartes]);
  }

  async listar(): Promise<TrazaRecomendacion[]> {
    const { rows } = await this.p.query("SELECT * FROM traza ORDER BY id DESC");
    return rows.map((f) => ({
      loteId: Number(f.merma_id),
      generadaEn: new Date(String(f.generada_en)),
      versionModelo: String(f.version_modelo),
      propuestas: f.propuestas as TrazaRecomendacion["propuestas"],
      descartes: Number(f.descartes),
    }));
  }
}

export class MaestrosPg implements RepositorioMaestros {
  constructor(private readonly p: Piscina) {}

  async ingredientes() {
    const { rows } = await this.p.query(
      "SELECT * FROM ingrediente ORDER BY nombre");
    return rows.map((f) => ({
      id: Number(f.id),
      nombre: String(f.nombre),
      unidad: String(f.unidad),
      costoUnitario: num(f.costo_unitario),
      vidaUtilCrudoH: Number(f.vida_util_crudo_h),
      vidaUtilCocidoH: Number(f.vida_util_cocido_h),
      tempMaxC: num(f.temp_max_c),
    }));
  }

  async areas() {
    const { rows } = await this.p.query("SELECT * FROM area ORDER BY id");
    return rows.map((f) => ({
      id: Number(f.id), nombre: String(f.nombre), capacidadKg: num(f.capacidad_kg),
    }));
  }

  async servicios(): Promise<string[]> {
    const { rows } = await this.p.query(
      "SELECT nombre FROM servicio ORDER BY orden, id");
    return rows.map((f) => String(f.nombre));
  }
}

export class EstadisticasPg implements RepositorioEstadisticas {
  constructor(private readonly p: Piscina) {}

  async porCausa() {
    const { rows } = await this.p.query("SELECT causa, kg FROM v_merma_por_causa");
    return rows.map((f) => ({ causa: String(f.causa), kg: num(f.kg) }));
  }

  async porArea() {
    const { rows } = await this.p.query(
      "SELECT area, kg, capacidad_kg FROM v_merma_por_area");
    return rows.map((f) => ({
      area: String(f.area), kg: num(f.kg), capacidadKg: num(f.capacidad_kg),
    }));
  }

  async porDia(dias: number) {
    const { rows } = await this.p.query(
      "SELECT fecha, registrada, aprovechada FROM v_merma_por_dia LIMIT $1", [dias]);
    return rows.map((f) => ({
      fecha: new Date(String(f.fecha)).toISOString().slice(0, 10),
      registrada: num(f.registrada),
      aprovechada: num(f.aprovechada),
    }));
  }

  async totales() {
    const { rows } = await this.p.query(`
      SELECT
        COALESCE(SUM(m.cantidad), 0) AS kg,
        COALESCE(SUM(m.cantidad * i.costo_unitario), 0) AS valor,
        COALESCE(SUM(m.cantidad) FILTER (WHERE d.accion = 'aprobada'), 0) AS aprov
      FROM merma m
      JOIN ingrediente i ON i.id = m.ingrediente_id
      LEFT JOIN decision d ON d.merma_id = m.id`);
    const f = rows[0];
    return {
      totalKg: num(f.kg),
      totalValor: num(f.valor),
      kgAprovechados: num(f.aprov),
    };
  }
}
