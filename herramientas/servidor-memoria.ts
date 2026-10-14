/**
 * Levanta el backend completo contra una base en memoria, cargando los
 * datos del centro de producción.
 *
 *     npx tsx herramientas/servidor-memoria.ts ./datos
 *     npx tsx herramientas/servidor-memoria.ts ./datos --fecha=2026-03-15
 *
 * Sirve para recorrer el prototipo con los datos reales sin instalar
 * MongoDB. Es la misma API y los mismos casos de uso que `npm run
 * dev:backend`; lo único distinto es dónde viven los documentos, y eso
 * el dominio no lo sabe.
 *
 * Lo que esta vía NO comprueba es el rechazo de documentos por los
 * validadores del servidor de base de datos. Para eso hace falta
 * MongoDB de verdad y `npm run importar -- ./datos`.
 *
 * Sin carpeta de datos usa la semilla de ejemplo.
 */
import express from "express";
import cors from "cors";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { baseEnMemoria } from "./db-memoria.mjs";
import { crearRutas } from "../backend/src/infraestructura/adaptadores/entrada/http/rutas";
import { aplicarEsquema } from "../backend/src/infraestructura/adaptadores/salida/mongo/conexion";
import { sembrar } from "../backend/src/infraestructura/adaptadores/salida/mongo/semilla";
import { importar } from "../backend/src/infraestructura/adaptadores/salida/mongo/importar";
import {
  LotesMongo, CatalogoMongo, CargasMongo, DecisionesMongo, TrazasMongo,
  MaestrosMongo, EstadisticasMongo, FeedbackMongo, UsuariosMongo, ConsultasMongo,
} from "../backend/src/infraestructura/adaptadores/salida/mongo/repositorios";
import {
  ConsultarOperacionUC, ObtenerRecomendacionesUC, RegistrarDecisionUC,
  ConsultarPermisosUC, RegistrarMermaUC, ConsultarEstadisticasUC,
  ConsultarMaestrosUC, RegistrarFeedbackUC, IniciarSesionUC,
  RegistrarUsuarioUC, InspeccionarModeloUC,
} from "@foodloop/dominio";
import type { Rol, ProveedorSesion, Reloj } from "@foodloop/dominio";
import type { Db } from "mongodb";

const PUERTO = Number(process.env.PORT ?? 3001);

/**
 * Reloj de revisión histórica.
 *
 * Un conjunto de datos histórico no puede alimentar un panel «en vivo»:
 * los lotes del centro van de enero a junio de 2026, de modo que con el
 * reloj del sistema aparecen los 1577 vencidos y el prototipo no muestra
 * nada. Para recorrerlo hay que situarse en una fecha del propio
 * conjunto.
 *
 * Esto NO es falsear la fecha de los datos: los registros conservan la
 * suya. Lo que se mueve es el instante desde el que se los mira, que es
 * el único parámetro que el motor necesita y que ya recibía por la
 * etapa 1. La interfaz avisa de que está en revisión, para que nadie
 * confunda un recorrido histórico con la operación de hoy.
 */
class RelojRevision implements Reloj {
  constructor(private readonly fecha: Date | null) {}
  ahora() { return this.fecha ? new Date(this.fecha) : new Date(); }
  get revisando() { return this.fecha; }
}

class Sesion implements ProveedorSesion {
  private rol: Rol = "chef";
  private usuarioId = "";
  private usuario = "Mateo Calderón";
  rolActual() { return this.rol; }
  usuarioIdActual() { return this.usuarioId; }
  usuarioActual() { return this.usuario; }
  cambiar(rol: Rol, usuario: string, usuarioId = "") {
    this.rol = rol; this.usuario = usuario; this.usuarioId = usuarioId;
  }
}

async function arrancar() {
  const args = process.argv.slice(2);
  const carpeta = args.find((a) => !a.startsWith("--"));
  const pedida = args.find((a) => a.startsWith("--fecha="))?.slice(8);
  const db = baseEnMemoria() as unknown as Db;
  await aplicarEsquema(db);

  if (carpeta) await importar(carpeta, db);
  else await sembrar(db);

  // Sin fecha pedida, se sitúa en el último lote CON DICTAMEN FAVORABLE,
  // más dos horas. Situarse en el último lote a secas dejaba el panel
  // vacío: ese día los lotes estaban todos pendientes de medir y el
  // filtro de accionables no mostraba ninguno.
  let fecha: Date | null = pedida ? new Date(`${pedida}T12:00:00`) : null;
  if (!pedida && carpeta) {
    // El máximo se calcula recorriendo, no con sort().limit(1): la base
    // en memoria no implementa el cursor completo y devolvía vacío.
    const todas = await db.collection("mermas").find().toArray();
    const aptos = todas.filter((m) => m.aptoReproceso === true);
    const t = (aptos.length ? aptos : todas).reduce(
      (a, m) => Math.max(a, (m.registradoEn as Date)?.getTime() ?? 0), 0);
    if (t > 0) fecha = new Date(t + 2 * 3_600_000);
  }
  // --- cuentas, que sí sobreviven al reinicio ------------------------
  //
  // Todo lo demás vive en memoria y se reconstruye en cada arranque,
  // que es lo que hace innecesario instalar MongoDB. Las cuentas son la
  // excepción: crear una y perderla al reiniciar el servidor no es un
  // comportamiento que se pueda explicar a quien está probando el
  // prototipo. Se guardan en un archivo junto a los datos.
  const archivoCuentas = join(carpeta ?? ".", ".usuarios.json");

  if (existsSync(archivoCuentas)) {
    try {
      const guardadas = JSON.parse(readFileSync(archivoCuentas, "utf-8"));
      const col = db.collection("usuarios");
      for (const u of guardadas)
        await col.updateOne(
          { correo: u.correo },
          { $setOnInsert: { ...u, creadoEn: new Date(u.creadoEn) } },
          { upsert: true });
      console.log(`  Cuentas recuperadas de ${archivoCuentas}: ${guardadas.length}`);
    } catch {
      console.log(`  No se pudieron leer las cuentas de ${archivoCuentas}`);
    }
  }

  const guardarCuentas = async () => {
    try {
      const todas = await db.collection("usuarios").find().toArray();
      writeFileSync(archivoCuentas, JSON.stringify(todas, null, 1), "utf-8");
    } catch { /* no crítico: el prototipo sigue funcionando sin esto */ }
  };

  const reloj = new RelojRevision(fecha);
  const sesion = new Sesion();
  const lotes = new LotesMongo(db);
  const catalogo = new CatalogoMongo(db);
  const cargas = new CargasMongo(db);
  const decisiones = new DecisionesMongo(db);
  const maestros = new MaestrosMongo(db);
  const usuarios = new UsuariosMongo(db);

  const contenedor = {
    consultarOperacion: new ConsultarOperacionUC(lotes, decisiones, reloj),
    obtenerRecomendaciones: new ObtenerRecomendacionesUC(
      lotes, catalogo, cargas, new TrazasMongo(db), reloj, 3),
    registrarDecision: new RegistrarDecisionUC(decisiones, sesion),
    consultarPermisos: new ConsultarPermisosUC(),
    registrarMerma: new RegistrarMermaUC(lotes, maestros, reloj),
    consultarEstadisticas: new ConsultarEstadisticasUC(
      new EstadisticasMongo(db), lotes, reloj),
    consultarMaestros: new ConsultarMaestrosUC(maestros),
    registrarFeedback: new RegistrarFeedbackUC(new FeedbackMongo(db), sesion),
    iniciarSesion: new IniciarSesionUC(usuarios),
    registrarUsuario: new RegistrarUsuarioUC(usuarios),
    inspeccionarModelo: new InspeccionarModeloUC(lotes, catalogo, cargas, reloj),
    sesion, db,
    consultas: new ConsultasMongo(db, lotes),
  };

  const app = express();
  app.use(cors());
  app.use(express.json());

  // Esta ruta solo existe en el servidor de revisión, no en el backend
  // de producción: es la que permite a la interfaz avisar de que lo que
  // se está mirando es un recorrido histórico. Va montada aquí y no en
  // `rutas.ts` precisamente para que no llegue a producción.
  app.get("/api/revision", (_req, res) => {
    res.json({
      revisando: reloj.revisando ? reloj.revisando.toISOString() : null,
      origen: carpeta ?? "semilla de ejemplo",
    });
  });

  // Tras dar de alta una cuenta se vuelca la colección al archivo.
  //
  // Va ANTES de las rutas y se engancha al evento de fin de respuesta,
  // no después: un middleware colocado detrás no llega a ejecutarse
  // nunca, porque la ruta ya cerró la respuesta y no llama a next().
  // Y se comprueba el 201 para no guardar cuando el alta fue rechazada.
  app.use("/api/usuarios", (req, res, next) => {
    if (req.method === "POST")
      res.on("finish", () => { if (res.statusCode === 201) void guardarCuentas(); });
    next();
  });

  app.use("/api", crearRutas(contenedor as never));
  app.listen(PUERTO, () => {
    console.log(`\n  Backend en memoria en http://localhost:${PUERTO}`);
    console.log(`  Datos: ${carpeta ?? "semilla de ejemplo"}`);
    console.log(reloj.revisando
      ? `  Revisión histórica situada en ${reloj.revisando.toISOString().slice(0, 16).replace("T", " ")}\n`
      : "  Reloj del sistema\n");
  });
}

arrancar().catch((e) => { console.error(e); process.exit(1); });
