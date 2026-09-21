/**
 * FoodLoop · Adaptador de entrada HTTP
 *
 * Express es un detalle de implementación: traduce peticiones HTTP a
 * llamadas de casos de uso y respuestas de dominio a JSON. No contiene
 * reglas de negocio. Si mañana se añadiera una CLI o una cola de mensajes,
 * serían otros adaptadores de entrada invocando los mismos casos de uso.
 */

import { Router } from "express";
import type { Contenedor } from "../../../configuracion/contenedor";
import { ErrorDominio } from "@foodloop/dominio";
import type { Rol } from "@foodloop/dominio";

const ROLES: Rol[] = ["chef", "produccion", "admin", "calidad"];

export function crearRutas(c: Contenedor): Router {
  const r = Router();

  /**
   * El rol viaja en una cabecera para el prototipo. En producción saldría
   * del token de sesión; el cambio afecta solo a este archivo.
   */
  r.use((req, _res, next) => {
    const rol = req.header("X-Rol");
    if (rol && ROLES.includes(rol as Rol))
      c.sesion.cambiar(rol as Rol, req.header("X-Usuario") ?? "demo");
    next();
  });

  /**
   * Autenticación. El prototipo devuelve los datos del usuario y la
   * interfaz los conserva en memoria; una implantación real emitiría un
   * token firmado y este archivo sería el único que cambiaría.
   */
  r.post("/sesion", async (req, res, next) => {
    try {
      const u = await c.iniciarSesion.ejecutar({
        correo: String(req.body.correo ?? ""),
        clave: String(req.body.clave ?? ""),
      });
      c.sesion.cambiar(u.rol, u.nombre);
      res.json(u);
    } catch (e) { next(e); }
  });

  r.post("/usuarios", async (req, res, next) => {
    try {
      const u = await c.registrarUsuario.ejecutar({
        correo: String(req.body.correo ?? ""),
        nombre: String(req.body.nombre ?? ""),
        rol: req.body.rol,
        clave: String(req.body.clave ?? ""),
      });
      res.status(201).json(u);
    } catch (e) { next(e); }
  });

  r.get("/salud", (_req, res) => {
    res.json({ estado: "ok", version: "1.0.0" });
  });

  r.get("/operacion", async (_req, res, next) => {
    try {
      res.json(await c.consultarOperacion.ejecutar());
    } catch (e) { next(e); }
  });

  r.get("/lotes", async (_req, res, next) => {
    try {
      const { lotes } = await c.consultarOperacion.ejecutar();
      res.json(lotes);
    } catch (e) { next(e); }
  });

  r.get("/lotes/:id/recomendaciones", async (req, res, next) => {
    try {
      res.json(await c.obtenerRecomendaciones.ejecutar(Number(req.params.id)));
    } catch (e) { next(e); }
  });

  /**
   * Evaluación de varios lotes a la vez. Los identificadores viajan en
   * el cuerpo y no en la ruta porque una selección puede ser larga y las
   * URL tienen límite de longitud.
   */
  r.post("/recomendaciones", async (req, res, next) => {
    try {
      const ids = (req.body.loteIds as unknown[] ?? []).map(Number);
      res.json(await c.obtenerRecomendaciones.ejecutar(ids));
    } catch (e) { next(e); }
  });

  r.post("/feedback", async (req, res, next) => {
    try {
      await c.registrarFeedback.ejecutar({
        recomendacionId: Number(req.body.recomendacionId),
        claridad: req.body.claridad,
        factorConfuso: req.body.factorConfuso,
        comentario: req.body.comentario,
      });
      res.status(201).json({ estado: "registrado" });
    } catch (e) { next(e); }
  });

  r.get("/estadisticas", async (_req, res, next) => {
    try {
      res.json(await c.consultarEstadisticas.ejecutar());
    } catch (e) { next(e); }
  });

  /**
   * Disponibilidad de ingredientes. Agrupa los lotes vigentes por
   * ingrediente, que es como lo consulta una cocina: no importa cuántos
   * lotes de pollo hay, importa cuánto pollo hay y para cuándo.
   */
  r.get("/inventario", async (_req, res, next) => {
    try {
      const { rows } = await c.piscina.query(`
        SELECT
          v.ingrediente_id, v.ingrediente, i.categoria, v.unidad,
          COUNT(*)::int AS lotes,
          ROUND(SUM(v.cantidad_disponible), 2) AS disponible,
          ROUND(SUM(v.valor), 2) AS valor,
          ROUND(MIN(v.horas_restantes)::numeric, 1) AS horas_minimas
        FROM v_lote_disponible v
        JOIN ingrediente i ON i.id = v.ingrediente_id
        WHERE v.cantidad_disponible > 0 AND v.apto_reproceso
        GROUP BY v.ingrediente_id, v.ingrediente, i.categoria, v.unidad
        ORDER BY horas_minimas ASC`);
      res.json(rows.map((r2) => ({
        ingredienteId: Number(r2.ingrediente_id),
        ingrediente: String(r2.ingrediente),
        categoria: String(r2.categoria),
        unidad: String(r2.unidad),
        lotes: Number(r2.lotes),
        disponible: Number(r2.disponible),
        valor: Number(r2.valor),
        horasMinimas: Number(r2.horas_minimas),
      })));
    } catch (e) { next(e); }
  });

  /** Histórico de aprovechamiento: qué se propuso y qué se decidió. */
  r.get("/historial", async (_req, res, next) => {
    try {
      const { rows } = await c.piscina.query(
        "SELECT * FROM v_trazabilidad LIMIT 60");
      res.json(rows.map((f) => ({
        recomendacionId: Number(f.recomendacion_id),
        generadaEn: String(f.generada_en),
        receta: String(f.receta),
        aptitud: Number(f.aptitud),
        lotes: String(f.lotes ?? ""),
        nLotes: Number(f.lotes_usados ?? 0),
        kgAprovechados: 0,
        costoRecuperado: 0,
        accion: f.accion ? String(f.accion) : null,
        usuario: f.usuario ? String(f.usuario) : null,
        rol: f.rol ? String(f.rol) : null,
        claridad: f.claridad_explicacion ? String(f.claridad_explicacion) : null,
      })));
    } catch (e) { next(e); }
  });

  r.get("/maestros", async (_req, res, next) => {
    try {
      res.json(await c.consultarMaestros.ejecutar());
    } catch (e) { next(e); }
  });

  r.post("/lotes", async (req, res, next) => {
    try {
      const l = await c.registrarMerma.ejecutar({
        ingredienteId: Number(req.body.ingredienteId),
        areaId: Number(req.body.areaId),
        servicioId: Number(req.body.servicioId),
        cantidad: Number(req.body.cantidad),
        estadoProducto: req.body.estadoProducto,
        temperaturaC: Number(req.body.temperaturaC),
        causa: req.body.causa,
        aptoReproceso: req.body.aptoReproceso !== false,
      });
      res.status(201).json(l);
    } catch (e) { next(e); }
  });

  r.post("/decisiones", async (req, res, next) => {
    try {
      res.status(201).json(await c.registrarDecision.ejecutar({
        recomendacionId: Number(req.body.recomendacionId),
        recetaId: Number(req.body.recetaId),
        accion: req.body.accion,
        motivo: req.body.motivo,
      }));
    } catch (e) { next(e); }
  });

  r.get("/permisos/:rol", (req, res) => {
    const rol = req.params.rol as Rol;
    if (!ROLES.includes(rol)) {
      res.status(404).json({ error: "Rol desconocido", codigo: "ROL_INVALIDO" });
      return;
    }
    res.json(c.consultarPermisos.ejecutar(rol));
  });

  /**
   * Un error de dominio es una respuesta legítima del negocio (404, 403),
   * no un fallo del servidor. Distinguirlos permite que la interfaz
   * muestre el motivo real en lugar de un mensaje genérico.
   */
  r.use((err: unknown, _req: unknown, res: any, _next: unknown) => {
    if (err instanceof ErrorDominio) {
      const estado = err.codigo.endsWith("_NO_ENCONTRADO") ? 404
        : err.codigo === "SIN_ATRIBUCION" ? 403
        : err.codigo === "CREDENCIALES" || err.codigo === "CUENTA_INACTIVA" ? 401
        : err.codigo === "CORREO_DUPLICADO" ? 409 : 400;
      res.status(estado).json({ error: err.message, codigo: err.codigo });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Error interno", codigo: "INTERNO" });
  });

  return r;
}
