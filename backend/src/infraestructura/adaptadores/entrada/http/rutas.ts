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

  r.get("/estadisticas", async (_req, res, next) => {
    try {
      res.json(await c.consultarEstadisticas.ejecutar());
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
        servicio: String(req.body.servicio),
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
        loteId: Number(req.body.loteId),
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
        : err.codigo === "SIN_ATRIBUCION" ? 403 : 400;
      res.status(estado).json({ error: err.message, codigo: err.codigo });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Error interno", codigo: "INTERNO" });
  });

  return r;
}
