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
  RepositorioEstadisticas, RepositorioFeedback, RepositorioUsuarios,
  TrazaRecomendacion, Usuario,
  PropuestaPersistida, NuevoLote,
  Lote, ItemCatalogo, Decision, Requisito,
} from "@foodloop/dominio";

const { Pool } = pg;
const AQUI = dirname(fileURLToPath(import.meta.url));

export type Piscina = pg.Pool;

/**
 * Crea la piscina de conexiones.
 *
 * Supabase (y cualquier PostgreSQL gestionado) exige TLS, mientras que
 * una instalación local normalmente no lo tiene configurado. Se detecta
 * por el host en lugar de pedir otra variable de entorno: una cadena que
 * no apunta a localhost es una base remota.
 *
 * `rejectUnauthorized: false` acepta el certificado de Supabase sin
 * tener que distribuir su CA con el proyecto. Para un prototipo es
 * suficiente; en producción convendría fijar el certificado.
 */
export function crearPiscina(cadena: string): Piscina {
  const local = /localhost|127\.0\.0\.1/.test(cadena);
  return new Pool({
    connectionString: cadena,
    max: local ? 10 : 5,          // los planes gestionados limitan conexiones
    ssl: local ? undefined : { rejectUnauthorized: false },
    // Supabase cierra conexiones ociosas; reciclarlas evita errores
    // intermitentes de "connection terminated unexpectedly".
    idleTimeoutMillis: local ? 30_000 : 10_000,
    connectionTimeoutMillis: 15_000,
  });
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
  // La vista devuelve lo que queda tras descontar lo ya comprometido.
  cantidad: num(f.cantidad_disponible),
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

const SQL_LOTE = "SELECT * FROM v_lote_disponible";

export class LotesPg implements RepositorioLotes {
  constructor(private readonly p: Piscina) {}

  async listarPendientes(): Promise<Lote[]> {
    // Un lote sigue pendiente mientras le quede cantidad disponible: el
    // consumo parcial permite que participe en varias recomendaciones.
    const { rows } = await this.p.query(
      `${SQL_LOTE} WHERE cantidad_disponible > 0 ORDER BY vence_en ASC`);
    return rows.map(aLote);
  }

  async obtenerPorId(id: number): Promise<Lote | null> {
    const { rows } = await this.p.query(`${SQL_LOTE} WHERE id = $1`, [id]);
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
      INSERT INTO merma (codigo, ingrediente_id, area_id, servicio_id, cantidad,
        estado_producto, temperatura_c, causa, apto_reproceso,
        registrado_en, vence_en)
      VALUES ('PROVISIONAL', $1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id`,
      [d.ingredienteId, d.areaId, d.servicioId, d.cantidad, d.estadoProducto,
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
      // Aceptación calculada de las decisiones reales, no un valor fijo.
      aceptacion: num(f.aceptacion_efectiva ?? f.aceptacion_base),
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

  private readonly SELECT = `
    SELECT r.*, a.nombre AS area, ac.aceptacion_efectiva
    FROM receta r
    JOIN area a ON a.id = r.area_id
    LEFT JOIN v_aceptacion_receta ac ON ac.receta_id = r.id`;

  async listarActivos(): Promise<ItemCatalogo[]> {
    const { rows } = await this.p.query(
      `${this.SELECT} WHERE r.activa ORDER BY r.id`);
    return this.armar(rows);
  }

  async obtenerPorId(id: number): Promise<ItemCatalogo | null> {
    const { rows } = await this.p.query(`${this.SELECT} WHERE r.id = $1`, [id]);
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
    // receta_id no se guarda: la receta pertenece a la recomendación y
    // duplicarla permitiría que las dos se contradijeran.
    await this.p.query(`
      INSERT INTO decision (id, recomendacion_id, rol, usuario,
        accion, motivo, decidida_en)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [completa.id, completa.recomendacionId, completa.rol,
       completa.usuario, completa.accion, completa.motivo ?? null,
       completa.decididaEn.toISOString()]);
    return completa;
  }

  async listar(): Promise<Decision[]> {
    const { rows } = await this.p.query(`
      SELECT d.*, r.receta_id
      FROM decision d
      JOIN recomendacion r ON r.id = d.recomendacion_id
      ORDER BY d.decidida_en DESC`);
    return rows.map((f) => ({
      id: String(f.id),
      recomendacionId: Number(f.recomendacion_id),
      recetaId: Number(f.receta_id),
      rol: f.rol as Decision["rol"],
      usuario: String(f.usuario),
      accion: f.accion as Decision["accion"],
      motivo: f.motivo ? String(f.motivo) : undefined,
      decididaEn: new Date(String(f.decidida_en)),
    }));
  }

  /**
   * Lotes consumidos por completo en recomendaciones aprobadas. Un lote
   * usado a medias sigue disponible, de modo que no se incluye aquí.
   */
  async lotesDecididos(): Promise<Set<number>> {
    const { rows } = await this.p.query(
      "SELECT id FROM v_lote_disponible WHERE cantidad_disponible <= 0");
    return new Set(rows.map((r) => Number(r.id)));
  }
}

/**
 * Persiste lo que el modelo propuso.
 *
 * Una traza genera una fila en `recomendacion` por alternativa y una en
 * `recomendacion_lote` por cada lote que esa alternativa consume. Todo
 * dentro de una transacción: una recomendación sin sus lotes dejaría la
 * trazabilidad incompleta, que es justo lo que esta tabla existe para
 * evitar.
 */
export class TrazasPg implements RepositorioTrazas {
  constructor(private readonly p: Piscina) {}

  async guardar(t: TrazaRecomendacion): Promise<number[]> {
    if (t.propuestas.length === 0) return [];

    const cliente = await this.p.connect();
    try {
      await cliente.query("BEGIN");
      const ids: number[] = [];

      for (const prop of t.propuestas) {
        const { rows } = await cliente.query(`
          INSERT INTO recomendacion (receta_id, generada_en, version_modelo,
            aptitud, posicion, porciones, kg_aprovechados, costo_recuperado,
            factores, contrafactuales, descartes)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
          RETURNING id`,
          [prop.recetaId, t.generadaEn.toISOString(), t.versionModelo,
           prop.aptitud, prop.posicion, prop.porciones, prop.kgAprovechados,
           prop.costoRecuperado, JSON.stringify(prop.factores),
           JSON.stringify(prop.contrafactuales), JSON.stringify(t.descartes)]);

        const id = Number(rows[0].id);
        ids.push(id);

        for (const a of prop.aportes)
          await cliente.query(`
            INSERT INTO recomendacion_lote (recomendacion_id, merma_id,
              cantidad_usada, es_principal)
            VALUES ($1,$2,$3,$4)`,
            [id, a.mermaId, a.cantidadUsada, a.esPrincipal]);
      }

      await cliente.query("COMMIT");
      return ids;
    } catch (e) {
      await cliente.query("ROLLBACK");
      throw e;
    } finally {
      cliente.release();
    }
  }

  async listar(): Promise<TrazaRecomendacion[]> {
    const { rows } = await this.p.query(`
      SELECT r.*, (
        SELECT json_agg(json_build_object(
          'mermaId', rl.merma_id, 'cantidadUsada', rl.cantidad_usada,
          'esPrincipal', rl.es_principal))
        FROM recomendacion_lote rl WHERE rl.recomendacion_id = r.id
      ) AS aportes
      FROM recomendacion r ORDER BY r.generada_en DESC`);

    return rows.map((f) => ({
      loteIds: ((f.aportes as { mermaId: number }[]) ?? []).map((a) => a.mermaId),
      generadaEn: new Date(String(f.generada_en)),
      versionModelo: String(f.version_modelo),
      descartes: (f.descartes as TrazaRecomendacion["descartes"]) ?? [],
      propuestas: [{
        recetaId: Number(f.receta_id),
        posicion: Number(f.posicion),
        aptitud: num(f.aptitud),
        porciones: Number(f.porciones),
        kgAprovechados: num(f.kg_aprovechados),
        costoRecuperado: num(f.costo_recuperado),
        factores: (f.factores as PropuestaPersistida["factores"]) ?? [],
        contrafactuales: (f.contrafactuales as string[]) ?? [],
        aportes: (f.aportes as PropuestaPersistida["aportes"]) ?? [],
      }],
    }));
  }
}

/** Valoraciones de la explicación. Insumo de la Fase 4. */
export class FeedbackPg implements RepositorioFeedback {
  constructor(private readonly p: Piscina) {}

  async registrar(f: {
    recomendacionId: number; rol: string; usuario: string;
    claridad: string; factorConfuso?: string; comentario?: string;
  }): Promise<void> {
    await this.p.query(`
      INSERT INTO feedback_explicacion (recomendacion_id, rol, usuario,
        claridad, factor_confuso, comentario)
      VALUES ($1,$2,$3,$4,$5,$6)`,
      [f.recomendacionId, f.rol, f.usuario, f.claridad,
       f.factorConfuso ?? null, f.comentario ?? null]);
  }

  async claridadPorReceta() {
    const { rows } = await this.p.query("SELECT * FROM v_claridad_explicacion");
    return rows.map((f) => ({
      receta: String(f.receta),
      valoraciones: Number(f.valoraciones),
      claras: Number(f.claras),
      pctClaras: num(f.pct_claras),
    }));
  }
}

/**
 * Cuentas de usuario.
 *
 * El hash se calcula y se comprueba en la propia base con pgcrypto, de
 * modo que la contraseña en claro no circula por la aplicación más allá
 * del parámetro de la consulta. `crypt` con sal de tipo blowfish genera
 * un hash distinto para la misma contraseña en cada alta, lo que impide
 * deducir que dos cuentas comparten clave.
 */
export class UsuariosPg implements RepositorioUsuarios {
  constructor(private readonly p: Piscina) {}

  private aUsuario(f: Fila): Usuario {
    return {
      id: String(f.id),
      correo: String(f.correo),
      nombre: String(f.nombre),
      rol: f.rol as Usuario["rol"],
      activo: Boolean(f.activo),
      creadoEn: new Date(String(f.creado_en)),
      ultimoAcceso: f.ultimo_acceso ? new Date(String(f.ultimo_acceso)) : undefined,
    };
  }

  async buscarPorCorreo(correo: string): Promise<Usuario | null> {
    const { rows } = await this.p.query(
      "SELECT * FROM usuario WHERE lower(correo) = lower($1)", [correo]);
    return rows[0] ? this.aUsuario(rows[0]) : null;
  }

  async verificar(correo: string, clave: string): Promise<Usuario | null> {
    // La comparación se hace en la base: crypt recalcula el hash con la
    // sal almacenada y lo contrasta en una sola operación.
    const { rows } = await this.p.query(`
      SELECT * FROM usuario
      WHERE lower(correo) = lower($1) AND clave_hash = crypt($2, clave_hash)`,
      [correo, clave]);
    return rows[0] ? this.aUsuario(rows[0]) : null;
  }

  async crear(d: {
    correo: string; nombre: string; rol: string; clave: string;
  }): Promise<Usuario> {
    const { rows } = await this.p.query(`
      INSERT INTO usuario (correo, nombre, rol, clave_hash)
      VALUES ($1,$2,$3, crypt($4, gen_salt('bf', 10)))
      RETURNING *`, [d.correo, d.nombre, d.rol, d.clave]);
    return this.aUsuario(rows[0]);
  }

  async registrarAcceso(id: string): Promise<void> {
    await this.p.query(
      "UPDATE usuario SET ultimo_acceso = now() WHERE id = $1", [id]);
  }

  async listar(): Promise<Usuario[]> {
    const { rows } = await this.p.query(
      "SELECT * FROM usuario WHERE activo ORDER BY nombre");
    return rows.map((f) => this.aUsuario(f));
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
    // Lo aprovechado ya no es la cantidad del lote: con multi-lote y
    // consumo parcial, es la suma de lo efectivamente comprometido en
    // recomendaciones aprobadas. Se calcula aparte para no multiplicar
    // filas al unir merma con sus aportes.
    const { rows } = await this.p.query(`
      SELECT
        COALESCE(SUM(m.cantidad), 0) AS kg,
        COALESCE(SUM(m.cantidad * i.costo_unitario), 0) AS valor,
        COALESCE((
          SELECT SUM(rl.cantidad_usada)
          FROM recomendacion_lote rl
          JOIN decision d ON d.recomendacion_id = rl.recomendacion_id
          WHERE d.accion = 'aprobada'
        ), 0) AS aprov
      FROM merma m
      JOIN ingrediente i ON i.id = m.ingrediente_id`);
    const f = rows[0];
    return {
      totalKg: num(f.kg),
      totalValor: num(f.valor),
      kgAprovechados: num(f.aprov),
    };
  }
}
