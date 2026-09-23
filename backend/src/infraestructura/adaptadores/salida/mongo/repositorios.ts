/**
 * FoodLoop · Adaptadores de salida sobre MongoDB
 *
 * Implementan exactamente los mismos puertos que antes implementaba el
 * adaptador de PostgreSQL. El dominio, los casos de uso y la interfaz no
 * cambiaron una línea al migrar: esa es la propiedad que justifica la
 * arquitectura hexagonal.
 *
 * Los catálogos son pequeños (decenas de documentos) y se cruzan en
 * memoria. Las agregaciones sobre datos que crecen con el uso, como
 * mermas y recomendaciones, se resuelven en la propia base.
 */

import type { Db } from "mongodb";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { ErrorDominio } from "@foodloop/dominio";
import type {
  RepositorioLotes, RepositorioCatalogo, RepositorioCargas,
  RepositorioDecisiones, RepositorioTrazas, RepositorioMaestros,
  RepositorioEstadisticas, RepositorioFeedback, RepositorioUsuarios,
  TrazaRecomendacion, NuevoLote, Lote, ItemCatalogo, Decision, Usuario, Rol,
} from "@foodloop/dominio";
import { siguienteId } from "./conexion";

// ---------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------

export interface DocArea { _id: number; nombre: string; capacidadKg: number }
export interface DocServicio { _id: number; nombre: string; orden: number }
export interface DocIngrediente {
  _id: number; codigo: string; nombre: string; categoria: string;
  unidad: "kg" | "L" | "unid"; costoUnitario: number;
  vidaUtilCrudoH: number; vidaUtilCocidoH: number; tempMaxC: number;
}
export interface DocReceta {
  _id: number; codigo: string; nombre: string; areaId: number;
  porcionesBase: number; pesoPorcionG: number; minutos: number;
  tipoProceso: ItemCatalogo["tipoProceso"]; tempProcesoC: number;
  aceptacionBase: number; pasos: string[]; activa: boolean;
  requisitos: ItemCatalogo["requisitos"];
}
export interface DocMerma {
  _id: number; codigo: string; ingredienteId: number; areaId: number;
  servicioId: number; cantidad: number; estadoProducto: "crudo" | "cocido";
  temperaturaC: number; causa: Lote["causa"]; aptoReproceso: boolean;
  registradoEn: Date; venceEn: Date;
}
export interface DocDecision {
  id: string; rol: Rol; usuario: string;
  accion: Decision["accion"]; motivo?: string; decididaEn: Date;
}
export interface DocFeedback {
  rol: Rol; usuario: string; claridad: "clara" | "confusa" | "insuficiente";
  factorConfuso?: string; comentario?: string; registradoEn: Date;
}
export interface DocRecomendacion {
  _id: number; recetaId: number; generadaEn: Date; versionModelo: string;
  aptitud: number; posicion: number; porciones: number;
  kgAprovechados: number; costoRecuperado: number;
  factores: TrazaRecomendacion["propuestas"][number]["factores"];
  contrafactuales: string[];
  descartes: TrazaRecomendacion["descartes"];
  aportes: { mermaId: number; cantidadUsada: number; esPrincipal: boolean }[];
  decision?: DocDecision;
  feedback?: DocFeedback[];
}
export interface DocOperacion {
  _id: string; fecha: string; servicioId: number;
  comensalesPrevistos: number; comensalesReales: number;
  produccion: { recetaId: number; porciones: number }[];
}
export interface DocUsuario {
  _id: string; correo: string; nombre: string; rol: Rol;
  claveHash: string; activo: boolean; creadoEn: Date; ultimoAcceso?: Date;
}

const col = <T extends object>(db: Db, nombre: string) =>
  db.collection<T & { _id: T extends { _id: infer I } ? I : never }>(nombre);

// ---------------------------------------------------------------------
// Consumo comprometido
// ---------------------------------------------------------------------

/**
 * Cuánto de cada lote ya está comprometido en recomendaciones aprobadas.
 * Es lo que permite el consumo parcial: un lote de 9 kg del que una
 * receta aprobada toma 6 sigue disponible con 3.
 */
async function comprometidoPorLote(db: Db): Promise<Map<number, number>> {
  const filas = await db.collection<DocRecomendacion>("recomendaciones").aggregate<{
    _id: number; kg: number;
  }>([
    { $match: { "decision.accion": "aprobada" } },
    { $unwind: "$aportes" },
    { $group: { _id: "$aportes.mermaId", kg: { $sum: "$aportes.cantidadUsada" } } },
  ]).toArray();
  return new Map(filas.map((f) => [f._id, f.kg]));
}

async function catalogosEnMemoria(db: Db) {
  const [ing, areas, serv] = await Promise.all([
    col<DocIngrediente>(db, "ingredientes").find().toArray(),
    col<DocArea>(db, "areas").find().toArray(),
    col<DocServicio>(db, "servicios").find().toArray(),
  ]);
  return {
    ing: new Map(ing.map((i) => [i._id, i])),
    areas: new Map(areas.map((a) => [a._id, a])),
    serv: new Map(serv.map((s) => [s._id, s])),
  };
}

function aLote(
  m: DocMerma, comprometido: number,
  cat: Awaited<ReturnType<typeof catalogosEnMemoria>>,
): Lote {
  const i = cat.ing.get(m.ingredienteId);
  return {
    id: m._id,
    codigo: m.codigo,
    ingredienteId: m.ingredienteId,
    ingrediente: i?.nombre ?? "—",
    cantidad: Math.max(0, Math.round((m.cantidad - comprometido) * 100) / 100),
    unidad: i?.unidad ?? "kg",
    costoUnitario: i?.costoUnitario ?? 0,
    estadoProducto: m.estadoProducto,
    temperaturaC: m.temperaturaC,
    aptoReproceso: m.aptoReproceso,
    registradoEn: m.registradoEn,
    venceEn: m.venceEn,
    areaId: m.areaId,
    area: cat.areas.get(m.areaId)?.nombre ?? "—",
    servicio: cat.serv.get(m.servicioId)?.nombre ?? "—",
    causa: m.causa,
  };
}

// ---------------------------------------------------------------------

export class LotesMongo implements RepositorioLotes {
  constructor(private readonly db: Db) {}

  async listarPendientes(): Promise<Lote[]> {
    const [mermas, comp, cat] = await Promise.all([
      col<DocMerma>(this.db, "mermas").find().sort({ venceEn: 1 }).toArray(),
      comprometidoPorLote(this.db),
      catalogosEnMemoria(this.db),
    ]);
    // Un lote sigue pendiente mientras le quede cantidad disponible.
    return mermas
      .map((m) => aLote(m, comp.get(m._id) ?? 0, cat))
      .filter((l) => l.cantidad > 0);
  }

  async obtenerPorId(id: number): Promise<Lote | null> {
    const m = await col<DocMerma>(this.db, "mermas").findOne({ _id: id });
    if (!m) return null;
    const [comp, cat] = await Promise.all([
      comprometidoPorLote(this.db), catalogosEnMemoria(this.db)]);
    return aLote(m, comp.get(id) ?? 0, cat);
  }

  async inventarioDisponible(): Promise<Map<number, number>> {
    const ahora = new Date();
    const lotes = await this.listarPendientes();
    const m = new Map<number, number>();
    for (const l of lotes) {
      if (!l.aptoReproceso || l.venceEn <= ahora) continue;
      m.set(l.ingredienteId, (m.get(l.ingredienteId) ?? 0) + l.cantidad);
    }
    // Insumos de economato: siempre disponibles, no provienen de merma.
    for (const id of [2, 5, 6, 9, 11, 13]) m.set(id, (m.get(id) ?? 0) + 12);
    return m;
  }

  async crear(d: NuevoLote): Promise<Lote> {
    // El esquema no puede comparar dos campos entre sí; esta regla que
    // antes imponía un CHECK de la base pasa al adaptador.
    if (d.venceEn <= d.registradoEn)
      throw new ErrorDominio(
        "Un lote no puede vencer antes de registrarse.", "VIDA_UTIL_INCOHERENTE");

    const id = await siguienteId(this.db, "mermas");
    const f = d.registradoEn;
    const codigo = `MRM-${String(f.getFullYear()).slice(2)}`
      + `${String(f.getMonth() + 1).padStart(2, "0")}`
      + `${String(f.getDate()).padStart(2, "0")}-${String(id).padStart(4, "0")}`;

    await col<DocMerma>(this.db, "mermas").insertOne({
      _id: id, codigo,
      ingredienteId: d.ingredienteId, areaId: d.areaId, servicioId: d.servicioId,
      cantidad: d.cantidad, estadoProducto: d.estadoProducto,
      temperaturaC: d.temperaturaC, causa: d.causa,
      aptoReproceso: d.aptoReproceso,
      registradoEn: d.registradoEn, venceEn: d.venceEn,
    });

    const lote = await this.obtenerPorId(id);
    if (!lote) throw new Error("El lote recién creado no se pudo recuperar.");
    return lote;
  }
}

// ---------------------------------------------------------------------

/** Encogimiento hacia la valoración base, con un peso previo de 8 casos. */
export const K_ENCOGIMIENTO = 8;

export function aceptacionEfectiva(base: number, n: number, aprobadas: number): number {
  if (n === 0) return base;
  const observada = 1 + 4 * (aprobadas / n);
  return Math.round(((base * K_ENCOGIMIENTO + observada * n) / (K_ENCOGIMIENTO + n)) * 10) / 10;
}

export async function conteoDecisionesPorReceta(db: Db) {
  const filas = await db.collection<DocRecomendacion>("recomendaciones").aggregate<{
    _id: number; n: number; aprobadas: number;
  }>([
    { $match: { decision: { $exists: true } } },
    { $group: {
      _id: "$recetaId",
      n: { $sum: 1 },
      aprobadas: { $sum: { $cond: [{ $eq: ["$decision.accion", "aprobada"] }, 1, 0] } },
    } },
  ]).toArray();
  return new Map(filas.map((f) => [f._id, f]));
}

export class CatalogoMongo implements RepositorioCatalogo {
  constructor(private readonly db: Db) {}

  private async armar(recetas: DocReceta[]): Promise<ItemCatalogo[]> {
    const [areas, conteo] = await Promise.all([
      col<DocArea>(this.db, "areas").find().toArray(),
      conteoDecisionesPorReceta(this.db),
    ]);
    const nombreArea = new Map(areas.map((a) => [a._id, a.nombre]));
    return recetas.map((r) => {
      const c = conteo.get(r._id);
      return {
        id: r._id, codigo: r.codigo, nombre: r.nombre,
        areaId: r.areaId, area: nombreArea.get(r.areaId) ?? "—",
        porcionesBase: r.porcionesBase, pesoPorcionG: r.pesoPorcionG,
        minutos: r.minutos, tipoProceso: r.tipoProceso,
        tempProcesoC: r.tempProcesoC,
        // Bucle de retroalimentación: la aceptación se recalcula con las
        // decisiones reales en lugar de ser un valor fijo.
        aceptacion: aceptacionEfectiva(r.aceptacionBase, c?.n ?? 0, c?.aprobadas ?? 0),
        pasos: r.pasos ?? [],
        requisitos: r.requisitos,
      };
    });
  }

  async listarActivos(): Promise<ItemCatalogo[]> {
    const r = await col<DocReceta>(this.db, "recetas")
      .find({ activa: true }).sort({ _id: 1 }).toArray();
    return this.armar(r);
  }

  async obtenerPorId(id: number): Promise<ItemCatalogo | null> {
    const r = await col<DocReceta>(this.db, "recetas").findOne({ _id: id });
    return r ? (await this.armar([r]))[0] : null;
  }
}

// ---------------------------------------------------------------------

export class CargasMongo implements RepositorioCargas {
  constructor(private readonly db: Db) {}

  async cargasPorArea(): Promise<Map<number, number>> {
    const [areas, kg] = await Promise.all([
      col<DocArea>(this.db, "areas").find().toArray(),
      this.db.collection<DocMerma>("mermas").aggregate<{ _id: number; kg: number }>([
        { $group: { _id: "$areaId", kg: { $sum: "$cantidad" } } },
      ]).toArray(),
    ]);
    const porArea = new Map(kg.map((k) => [k._id, k.kg]));
    return new Map(areas.map((a) => [
      a._id, Math.min(1, (porArea.get(a._id) ?? 0) / a.capacidadKg)]));
  }
}

// ---------------------------------------------------------------------

/**
 * Persiste lo que el modelo propuso. Cada alternativa es un documento
 * con sus lotes embebidos. En la versión relacional esto exigía una
 * transacción para no dejar una recomendación sin sus lotes; aquí la
 * escritura de un documento es atómica por sí misma.
 */
export class TrazasMongo implements RepositorioTrazas {
  constructor(private readonly db: Db) {}

  async guardar(t: TrazaRecomendacion): Promise<number[]> {
    const ids: number[] = [];
    for (const p of t.propuestas) {
      const id = await siguienteId(this.db, "recomendaciones");
      await col<DocRecomendacion>(this.db, "recomendaciones").insertOne({
        _id: id, recetaId: p.recetaId, generadaEn: t.generadaEn,
        versionModelo: t.versionModelo, aptitud: p.aptitud, posicion: p.posicion,
        porciones: p.porciones, kgAprovechados: p.kgAprovechados,
        costoRecuperado: p.costoRecuperado, factores: p.factores,
        contrafactuales: p.contrafactuales, descartes: t.descartes,
        aportes: p.aportes, feedback: [],
      });
      ids.push(id);
    }
    return ids;
  }

  async listar(): Promise<TrazaRecomendacion[]> {
    const docs = await col<DocRecomendacion>(this.db, "recomendaciones")
      .find().sort({ generadaEn: -1 }).toArray();
    return docs.map((d) => ({
      loteIds: d.aportes.map((a) => a.mermaId),
      generadaEn: d.generadaEn,
      versionModelo: d.versionModelo,
      descartes: d.descartes ?? [],
      propuestas: [{
        recetaId: d.recetaId, posicion: d.posicion, aptitud: d.aptitud,
        porciones: d.porciones, kgAprovechados: d.kgAprovechados,
        costoRecuperado: d.costoRecuperado, factores: d.factores ?? [],
        contrafactuales: d.contrafactuales ?? [], aportes: d.aportes,
      }],
    }));
  }
}

// ---------------------------------------------------------------------

export class DecisionesMongo implements RepositorioDecisiones {
  constructor(private readonly db: Db) {}

  /**
   * La decisión se escribe dentro del documento de la recomendación. El
   * filtro `decision: { $exists: false }` hace que la operación solo
   * prospere si nadie ha decidido antes: es lo que sustituye a la
   * restricción de unicidad que tenía la base relacional, y es atómico.
   */
  async registrar(d: Omit<Decision, "id" | "decididaEn">): Promise<Decision> {
    const decision: DocDecision = {
      id: randomUUID(), rol: d.rol, usuario: d.usuario,
      accion: d.accion, decididaEn: new Date(),
      ...(d.motivo ? { motivo: d.motivo } : {}),
    };
    const recs = col<DocRecomendacion>(this.db, "recomendaciones");
    const r = await recs.updateOne(
      { _id: d.recomendacionId, decision: { $exists: false } },
      { $set: { decision } });

    if (r.matchedCount === 0) {
      const existe = await recs.findOne({ _id: d.recomendacionId }, { projection: { _id: 1 } });
      throw existe
        ? new ErrorDominio("Esta recomendación ya fue decidida.", "YA_DECIDIDA")
        : new ErrorDominio("La recomendación no existe.", "RECOMENDACION_NO_ENCONTRADO");
    }

    const rec = await recs.findOne({ _id: d.recomendacionId });
    return { ...d, recetaId: rec!.recetaId, id: decision.id, decididaEn: decision.decididaEn };
  }

  async listar(): Promise<Decision[]> {
    const docs = await col<DocRecomendacion>(this.db, "recomendaciones")
      .find({ decision: { $exists: true } })
      .sort({ "decision.decididaEn": -1 }).toArray();
    return docs.map((r) => ({
      id: r.decision!.id,
      recomendacionId: r._id,
      recetaId: r.recetaId,
      rol: r.decision!.rol,
      usuario: r.decision!.usuario,
      accion: r.decision!.accion,
      motivo: r.decision!.motivo,
      decididaEn: r.decision!.decididaEn,
    }));
  }

  /** Lotes consumidos por completo. Uno usado a medias sigue disponible. */
  async lotesDecididos(): Promise<Set<number>> {
    const [mermas, comp] = await Promise.all([
      col<DocMerma>(this.db, "mermas").find({}, { projection: { cantidad: 1 } }).toArray(),
      comprometidoPorLote(this.db),
    ]);
    return new Set(mermas
      .filter((m) => (comp.get(m._id) ?? 0) >= m.cantidad - 0.001)
      .map((m) => m._id));
  }
}

// ---------------------------------------------------------------------

/** El feedback se añade al documento de la recomendación que valora. */
export class FeedbackMongo implements RepositorioFeedback {
  constructor(private readonly db: Db) {}

  async registrar(f: {
    recomendacionId: number; rol: Rol; usuario: string;
    claridad: "clara" | "confusa" | "insuficiente";
    factorConfuso?: string; comentario?: string;
  }): Promise<void> {
    const entrada: DocFeedback = {
      rol: f.rol, usuario: f.usuario, claridad: f.claridad, registradoEn: new Date(),
      ...(f.factorConfuso ? { factorConfuso: f.factorConfuso } : {}),
      ...(f.comentario ? { comentario: f.comentario } : {}),
    };
    const r = await col<DocRecomendacion>(this.db, "recomendaciones")
      .updateOne({ _id: f.recomendacionId }, { $push: { feedback: entrada } });
    if (r.matchedCount === 0)
      throw new ErrorDominio("La recomendación no existe.", "RECOMENDACION_NO_ENCONTRADO");
  }

  async claridadPorReceta() {
    const [filas, recetas] = await Promise.all([
      this.db.collection<DocRecomendacion>("recomendaciones").aggregate<{
        _id: number; valoraciones: number; claras: number;
      }>([
        { $unwind: "$feedback" },
        { $group: {
          _id: "$recetaId",
          valoraciones: { $sum: 1 },
          claras: { $sum: { $cond: [{ $eq: ["$feedback.claridad", "clara"] }, 1, 0] } },
        } },
        { $sort: { valoraciones: -1 } },
      ]).toArray(),
      col<DocReceta>(this.db, "recetas").find({}, { projection: { nombre: 1 } }).toArray(),
    ]);
    const nombre = new Map(recetas.map((r) => [r._id, r.nombre]));
    return filas.map((f) => ({
      receta: nombre.get(f._id) ?? "—",
      valoraciones: f.valoraciones,
      claras: f.claras,
      pctClaras: Math.round((f.claras / f.valoraciones) * 1000) / 10,
    }));
  }
}

// ---------------------------------------------------------------------

export class MaestrosMongo implements RepositorioMaestros {
  constructor(private readonly db: Db) {}

  async ingredientes() {
    const docs = await col<DocIngrediente>(this.db, "ingredientes")
      .find().sort({ nombre: 1 }).toArray();
    return docs.map((i) => ({
      id: i._id, nombre: i.nombre, unidad: i.unidad,
      costoUnitario: i.costoUnitario, vidaUtilCrudoH: i.vidaUtilCrudoH,
      vidaUtilCocidoH: i.vidaUtilCocidoH, tempMaxC: i.tempMaxC,
    }));
  }

  async areas() {
    const docs = await col<DocArea>(this.db, "areas").find().sort({ _id: 1 }).toArray();
    return docs.map((a) => ({ id: a._id, nombre: a.nombre, capacidadKg: a.capacidadKg }));
  }

  async servicios(): Promise<string[]> {
    const docs = await col<DocServicio>(this.db, "servicios")
      .find().sort({ orden: 1, _id: 1 }).toArray();
    return docs.map((s) => s.nombre);
  }
}

// ---------------------------------------------------------------------

export class EstadisticasMongo implements RepositorioEstadisticas {
  constructor(private readonly db: Db) {}

  async porCausa() {
    const filas = await this.db.collection<DocMerma>("mermas").aggregate<{
      _id: string; kg: number;
    }>([
      { $group: { _id: "$causa", kg: { $sum: "$cantidad" } } },
      { $sort: { kg: -1 } },
    ]).toArray();
    return filas.map((f) => ({ causa: f._id, kg: Math.round(f.kg * 10) / 10 }));
  }

  async porArea() {
    const [areas, kg] = await Promise.all([
      col<DocArea>(this.db, "areas").find().toArray(),
      this.db.collection<DocMerma>("mermas").aggregate<{ _id: number; kg: number }>([
        { $group: { _id: "$areaId", kg: { $sum: "$cantidad" } } },
      ]).toArray(),
    ]);
    const porArea = new Map(kg.map((k) => [k._id, k.kg]));
    return areas
      .map((a) => ({
        area: a.nombre,
        kg: Math.round((porArea.get(a._id) ?? 0) * 10) / 10,
        capacidadKg: a.capacidadKg,
      }))
      .sort((a, b) => b.kg - a.kg);
  }

  /**
   * Serie diaria de los últimos días. Los días sin registros aparecen en
   * cero en lugar de faltar, para que la gráfica no tenga huecos.
   */
  async porDia(dias: number) {
    const desde = new Date();
    desde.setHours(0, 0, 0, 0);
    desde.setDate(desde.getDate() - (dias - 1));

    const [registrada, aprovechada] = await Promise.all([
      this.db.collection<DocMerma>("mermas").aggregate<{ _id: string; kg: number }>([
        { $match: { registradoEn: { $gte: desde } } },
        { $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$registradoEn" } },
          kg: { $sum: "$cantidad" },
        } },
      ]).toArray(),
      this.db.collection<DocRecomendacion>("recomendaciones").aggregate<{ _id: string; kg: number }>([
        { $match: { "decision.accion": "aprobada" } },
        { $unwind: "$aportes" },
        { $lookup: {
          from: "mermas", localField: "aportes.mermaId",
          foreignField: "_id", as: "merma",
        } },
        { $unwind: "$merma" },
        { $match: { "merma.registradoEn": { $gte: desde } } },
        { $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$merma.registradoEn" } },
          kg: { $sum: "$aportes.cantidadUsada" },
        } },
      ]).toArray(),
    ]);

    const reg = new Map(registrada.map((r) => [r._id, r.kg]));
    const apr = new Map(aprovechada.map((r) => [r._id, r.kg]));
    const serie = [];
    for (let i = 0; i < dias; i++) {
      const d = new Date(desde);
      d.setDate(desde.getDate() + i);
      const clave = d.toISOString().slice(0, 10);
      serie.push({
        fecha: clave,
        registrada: Math.round((reg.get(clave) ?? 0) * 10) / 10,
        aprovechada: Math.round((apr.get(clave) ?? 0) * 10) / 10,
      });
    }
    return serie;
  }

  async totales() {
    const [mermas, ing, aprov] = await Promise.all([
      col<DocMerma>(this.db, "mermas").find().toArray(),
      col<DocIngrediente>(this.db, "ingredientes").find().toArray(),
      this.db.collection<DocRecomendacion>("recomendaciones").aggregate<{ kg: number }>([
        { $match: { "decision.accion": "aprobada" } },
        { $unwind: "$aportes" },
        { $group: { _id: null, kg: { $sum: "$aportes.cantidadUsada" } } },
      ]).toArray(),
    ]);
    const costo = new Map(ing.map((i) => [i._id, i.costoUnitario]));
    return {
      totalKg: mermas.reduce((a, m) => a + m.cantidad, 0),
      totalValor: mermas.reduce((a, m) => a + m.cantidad * (costo.get(m.ingredienteId) ?? 0), 0),
      kgAprovechados: aprov[0]?.kg ?? 0,
    };
  }
}

// ---------------------------------------------------------------------

/**
 * Cuentas. La contraseña se guarda como hash bcrypt con coste 10; nunca
 * en claro. bcrypt incluye una sal distinta en cada hash, de modo que
 * dos cuentas con la misma contraseña no comparten hash.
 */
export class UsuariosMongo implements RepositorioUsuarios {
  constructor(private readonly db: Db) {}

  private aUsuario(d: DocUsuario): Usuario {
    return {
      id: d._id, correo: d.correo, nombre: d.nombre, rol: d.rol,
      activo: d.activo, creadoEn: d.creadoEn, ultimoAcceso: d.ultimoAcceso,
    };
  }

  async buscarPorCorreo(correo: string): Promise<Usuario | null> {
    const d = await col<DocUsuario>(this.db, "usuarios")
      .findOne({ correo: correo.trim().toLowerCase() });
    return d ? this.aUsuario(d) : null;
  }

  async verificar(correo: string, clave: string): Promise<Usuario | null> {
    const d = await col<DocUsuario>(this.db, "usuarios")
      .findOne({ correo: correo.trim().toLowerCase() });
    if (!d) return null;
    return (await bcrypt.compare(clave, d.claveHash)) ? this.aUsuario(d) : null;
  }

  async crear(d: { correo: string; nombre: string; rol: Rol; clave: string }): Promise<Usuario> {
    const doc: DocUsuario = {
      _id: randomUUID(),
      correo: d.correo.trim().toLowerCase(),
      nombre: d.nombre.trim(),
      rol: d.rol,
      claveHash: await bcrypt.hash(d.clave, 10),
      activo: true,
      creadoEn: new Date(),
    };
    await col<DocUsuario>(this.db, "usuarios").insertOne(doc);
    return this.aUsuario(doc);
  }

  async registrarAcceso(id: string): Promise<void> {
    await col<DocUsuario>(this.db, "usuarios")
      .updateOne({ _id: id }, { $set: { ultimoAcceso: new Date() } });
  }

  async listar(): Promise<Usuario[]> {
    const docs = await col<DocUsuario>(this.db, "usuarios")
      .find({ activo: true }).sort({ nombre: 1 }).toArray();
    return docs.map((d) => this.aUsuario(d));
  }
}

// ---------------------------------------------------------------------

/**
 * Consultas de lectura para las pantallas de disponibilidad e histórico.
 * Antes vivían como SQL dentro del adaptador HTTP; aquí quedan en el
 * adaptador de la base, que es donde corresponde.
 */
export class ConsultasMongo {
  constructor(private readonly db: Db, private readonly lotes: LotesMongo) {}

  async inventario() {
    const [pendientes, ing] = await Promise.all([
      this.lotes.listarPendientes(),
      col<DocIngrediente>(this.db, "ingredientes").find().toArray(),
    ]);
    const categoria = new Map(ing.map((i) => [i._id, i.categoria]));
    const ahora = Date.now();
    const grupos = new Map<number, {
      ingredienteId: number; ingrediente: string; categoria: string; unidad: string;
      lotes: number; disponible: number; valor: number; horasMinimas: number;
    }>();

    for (const l of pendientes) {
      if (!l.aptoReproceso) continue;
      const h = (l.venceEn.getTime() - ahora) / 3_600_000;
      const g = grupos.get(l.ingredienteId) ?? {
        ingredienteId: l.ingredienteId, ingrediente: l.ingrediente,
        categoria: categoria.get(l.ingredienteId) ?? "—", unidad: l.unidad,
        lotes: 0, disponible: 0, valor: 0, horasMinimas: Infinity,
      };
      g.lotes++;
      g.disponible += l.cantidad;
      g.valor += l.cantidad * l.costoUnitario;
      g.horasMinimas = Math.min(g.horasMinimas, h);
      grupos.set(l.ingredienteId, g);
    }
    return [...grupos.values()]
      .map((g) => ({
        ...g,
        disponible: Math.round(g.disponible * 100) / 100,
        valor: Math.round(g.valor * 100) / 100,
        horasMinimas: Math.round(g.horasMinimas * 10) / 10,
      }))
      .sort((a, b) => a.horasMinimas - b.horasMinimas);
  }

  async historial() {
    const [recs, recetas, mermas] = await Promise.all([
      col<DocRecomendacion>(this.db, "recomendaciones")
        .find().sort({ generadaEn: -1 }).limit(60).toArray(),
      col<DocReceta>(this.db, "recetas").find({}, { projection: { nombre: 1 } }).toArray(),
      col<DocMerma>(this.db, "mermas").find({}, { projection: { codigo: 1 } }).toArray(),
    ]);
    const nombre = new Map(recetas.map((r) => [r._id, r.nombre]));
    const codigo = new Map(mermas.map((m) => [m._id, m.codigo]));
    return recs.map((r) => ({
      recomendacionId: r._id,
      generadaEn: r.generadaEn.toISOString(),
      receta: nombre.get(r.recetaId) ?? "—",
      aptitud: r.aptitud,
      lotes: r.aportes.map((a) => codigo.get(a.mermaId) ?? `#${a.mermaId}`).join(", "),
      nLotes: r.aportes.length,
      kgAprovechados: r.kgAprovechados,
      costoRecuperado: r.costoRecuperado,
      accion: r.decision?.accion ?? null,
      usuario: r.decision?.usuario ?? null,
      rol: r.decision?.rol ?? null,
      claridad: r.feedback?.[0]?.claridad ?? null,
    }));
  }
}
