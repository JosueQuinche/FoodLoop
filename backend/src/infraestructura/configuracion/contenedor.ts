/**
 * FoodLoop · Contenedor de dependencias del backend
 *
 * Único punto que conoce implementaciones concretas. La migración de
 * PostgreSQL a MongoDB consistió en reescribir la carpeta de adaptadores
 * y cambiar las instanciaciones de aquí abajo; el dominio no se enteró.
 */

import {
  ConsultarOperacionUC, ObtenerRecomendacionesUC, RegistrarDecisionUC,
  ConsultarPermisosUC, RegistrarMermaUC, ConsultarEstadisticasUC,
  ConsultarMaestrosUC, RegistrarFeedbackUC,
  IniciarSesionUC, RegistrarUsuarioUC,
} from "@foodloop/dominio";
import type {
  ConsultarOperacion, ObtenerRecomendaciones, RegistrarDecision,
  ConsultarPermisos, RegistrarMerma, ConsultarEstadisticas,
  ConsultarMaestros, RegistrarFeedback, IniciarSesion, RegistrarUsuario,
  Reloj, ProveedorSesion, Rol,
} from "@foodloop/dominio";
import type { Db } from "mongodb";
import { conectar, aplicarEsquema } from "../adaptadores/salida/mongo/conexion";
import {
  LotesMongo, CatalogoMongo, CargasMongo, DecisionesMongo, TrazasMongo,
  MaestrosMongo, EstadisticasMongo, FeedbackMongo, UsuariosMongo, ConsultasMongo,
} from "../adaptadores/salida/mongo/repositorios";

class RelojSistema implements Reloj {
  ahora() { return new Date(); }
}

class Sesion implements ProveedorSesion {
  private rol: Rol = "chef";
  private usuario = "Mateo Calderón";
  rolActual() { return this.rol; }
  usuarioActual() { return this.usuario; }
  cambiar(rol: Rol, usuario: string) { this.rol = rol; this.usuario = usuario; }
}

export interface Contenedor {
  consultarOperacion: ConsultarOperacion;
  obtenerRecomendaciones: ObtenerRecomendaciones;
  registrarDecision: RegistrarDecision;
  consultarPermisos: ConsultarPermisos;
  registrarMerma: RegistrarMerma;
  consultarEstadisticas: ConsultarEstadisticas;
  consultarMaestros: ConsultarMaestros;
  registrarFeedback: RegistrarFeedback;
  iniciarSesion: IniciarSesion;
  registrarUsuario: RegistrarUsuario;
  sesion: Sesion;
  db: Db;
  consultas: ConsultasMongo;
}

export async function crearContenedor(
  uri: string, nombreDb = "foodloop",
): Promise<Contenedor> {
  const { db } = await conectar(uri, nombreDb);
  await aplicarEsquema(db);

  const reloj = new RelojSistema();
  const sesion = new Sesion();

  const lotes = new LotesMongo(db);
  const catalogo = new CatalogoMongo(db);
  const cargas = new CargasMongo(db);
  const decisiones = new DecisionesMongo(db);
  const trazas = new TrazasMongo(db);
  const maestros = new MaestrosMongo(db);
  const stats = new EstadisticasMongo(db);
  const feedback = new FeedbackMongo(db);
  const usuarios = new UsuariosMongo(db);

  return {
    consultarOperacion: new ConsultarOperacionUC(lotes, decisiones, reloj),
    obtenerRecomendaciones:
      new ObtenerRecomendacionesUC(lotes, catalogo, cargas, trazas, reloj, 3),
    registrarDecision: new RegistrarDecisionUC(decisiones, sesion),
    consultarPermisos: new ConsultarPermisosUC(),
    registrarMerma: new RegistrarMermaUC(lotes, maestros, reloj),
    consultarEstadisticas: new ConsultarEstadisticasUC(stats, lotes, reloj),
    consultarMaestros: new ConsultarMaestrosUC(maestros),
    registrarFeedback: new RegistrarFeedbackUC(feedback, sesion),
    iniciarSesion: new IniciarSesionUC(usuarios),
    registrarUsuario: new RegistrarUsuarioUC(usuarios),
    sesion, db,
    consultas: new ConsultasMongo(db, lotes),
  };
}
