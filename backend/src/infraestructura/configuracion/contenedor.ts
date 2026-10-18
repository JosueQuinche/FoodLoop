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
  IniciarSesionUC, RegistrarUsuarioUC, InspeccionarModeloUC,
} from "@foodloop/dominio";
import type {
  ConsultarOperacion, ObtenerRecomendaciones, RegistrarDecision,
  ConsultarPermisos, RegistrarMerma, ConsultarEstadisticas,
  ConsultarMaestros, RegistrarFeedback, IniciarSesion, RegistrarUsuario,
  InspeccionarModelo, Reloj, ProveedorSesion, Rol,
} from "@foodloop/dominio";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Db } from "mongodb";
import { conectar, aplicarEsquema } from "../adaptadores/salida/mongo/conexion";
import {
  LotesMongo, CatalogoMongo, CargasMongo, DecisionesMongo, TrazasMongo,
  MaestrosMongo, EstadisticasMongo, FeedbackMongo, UsuariosMongo, ConsultasMongo,
} from "../adaptadores/salida/mongo/repositorios";

/**
 * Reloj del sistema, o situado en una fecha para revisión histórica.
 *
 * El dominio recibe el instante de evaluación por la etapa 1 en lugar de
 * leerlo él, y esa decisión es la que permite esto sin tocar una sola
 * línea del motor: recorrer los registros de un día pasado es cambiar el
 * reloj que se le inyecta, no el modelo.
 */
class RelojSistema implements Reloj {
  constructor(private readonly fija: Date | null = null) {}
  ahora() { return this.fija ? new Date(this.fija) : new Date(); }
}

interface Ambito { rol: Rol; usuario: string; usuarioId: string; }

/**
 * Sesión por petición.
 *
 * La versión anterior guardaba el rol en un campo del objeto, y ese
 * objeto es único para todo el proceso. Con un solo usuario no se nota,
 * pero con dos a la vez sí: si el supervisor abre una pantalla mientras
 * el chef está decidiendo, la petición del chef se atribuye al rol que
 * dejó escrito la del supervisor. Las decisiones quedarían atribuidas a
 * la persona equivocada, y eso es precisamente lo que el RF-11 y la
 * trazabilidad prometen que no ocurre.
 *
 * `AsyncLocalStorage` da a cada petición su propio ámbito sin tener que
 * pasar la sesión a mano por todas las capas: el contexto viaja con la
 * cadena de `await` y los casos de uso siguen recibiendo el mismo puerto
 * `ProveedorSesion` que antes.
 */
export class Sesion implements ProveedorSesion {
  private readonly almacen = new AsyncLocalStorage<Ambito>();
  /** Ámbito para los procesos sin petición: fases, semilla, scripts. */
  private fuera: Ambito = { rol: "chef", usuario: "Mateo Calderón", usuarioId: "" };

  private actual(): Ambito { return this.almacen.getStore() ?? this.fuera; }
  rolActual() { return this.actual().rol; }
  usuarioIdActual() { return this.actual().usuarioId; }
  usuarioActual() { return this.actual().usuario; }

  cambiar(rol: Rol, usuario: string, usuarioId = "") {
    const a = this.almacen.getStore();
    if (a) { a.rol = rol; a.usuario = usuario; a.usuarioId = usuarioId; }
    else this.fuera = { rol, usuario, usuarioId };
  }

  /** Abre un ámbito aislado. Lo usa el middleware, una vez por petición. */
  enAmbito<T>(fn: () => T): T {
    return this.almacen.run({ ...this.fuera }, fn);
  }
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
  inspeccionarModelo: InspeccionarModelo;
  sesion: Sesion;
  db: Db;
  consultas: ConsultasMongo;
}

export async function crearContenedor(
  uri: string, nombreDb = "foodloop", fechaRevision: Date | null = null,
): Promise<Contenedor> {
  const { db } = await conectar(uri, nombreDb);
  await aplicarEsquema(db);

  const reloj = new RelojSistema(fechaRevision);
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
    inspeccionarModelo: new InspeccionarModeloUC(lotes, catalogo, cargas, reloj),
    sesion, db,
    // El reloj gobierna también las consultas de lectura: al revisar
    // un día pasado, sin él el inventario sale vacío porque todo
    // aparece vencido frente a hoy.
    consultas: new ConsultasMongo(db, lotes, reloj),
  };
}
