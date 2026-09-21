/**
 * FoodLoop · Contenedor de dependencias del backend
 *
 * Único punto que conoce implementaciones concretas. Sustituir PostgreSQL
 * por otro motor es reescribir la carpeta de adaptadores y cambiar las
 * instanciaciones de aquí abajo; el dominio no se entera.
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
import {
  crearPiscina, aplicarEsquema, LotesPg, CatalogoPg, CargasPg,
  DecisionesPg, TrazasPg, MaestrosPg, EstadisticasPg, FeedbackPg, UsuariosPg,
} from "../adaptadores/salida/postgres/repositorios";
import type { Piscina } from "../adaptadores/salida/postgres/repositorios";

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
  piscina: Piscina;
}

export async function crearContenedor(cadena: string): Promise<Contenedor> {
  const piscina = crearPiscina(cadena);
  await aplicarEsquema(piscina);

  const reloj = new RelojSistema();
  const sesion = new Sesion();

  const lotes = new LotesPg(piscina);
  const catalogo = new CatalogoPg(piscina);
  const cargas = new CargasPg(piscina);
  const decisiones = new DecisionesPg(piscina);
  const trazas = new TrazasPg(piscina);
  const maestros = new MaestrosPg(piscina);
  const stats = new EstadisticasPg(piscina);
  const feedback = new FeedbackPg(piscina);
  const usuarios = new UsuariosPg(piscina);

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
    sesion, piscina,
  };
}
