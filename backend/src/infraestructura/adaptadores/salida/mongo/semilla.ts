/**
 * FoodLoop · Semilla de MongoDB
 *
 * Crea colecciones, validadores e índices, y carga:
 *   · catálogos: áreas, servicios, ingredientes y recetario
 *   · seis meses de operación diaria (producción y asistencia)
 *   · 42 lotes de merma, los de hoy pendientes y los antiguos resueltos
 *   · el historial de recomendaciones, con decisiones y feedback
 *   · una cuenta por perfil
 *
 * Es destructiva con los datos de operación, pero conserva las cuentas
 * de usuario para no obligar a registrarse de nuevo.
 *
 * Ejecutar: npm run semilla
 */
import "dotenv/config";
import type { Db } from "mongodb";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { conectar, aplicarEsquema } from "./conexion";
import { AREAS, INGREDIENTES, CATALOGO } from "./catalogo";
import type { Causa } from "@foodloop/dominio";
import type {
  DocArea, DocServicio, DocIngrediente, DocReceta, DocMerma,
  DocRecomendacion, DocOperacion, DocUsuario,
} from "./repositorios";

const URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
const NOMBRE_DB = process.env.MONGODB_DB ?? "foodloop";

/** Generador reproducible: los datos de ejemplo deben ser repetibles. */
function crearAzar(semilla: number) {
  let s = semilla;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

const CAUSAS: { causa: Causa; peso: number }[] = [
  { causa: "sobreproduccion", peso: 0.38 },
  { causa: "devolucion_linea", peso: 0.27 },
  { causa: "error_porcionado", peso: 0.18 },
  { causa: "caducidad_proxima", peso: 0.12 },
  { causa: "defecto_calidad", peso: 0.05 },
];

const SERVICIOS = ["Desayuno", "Almuerzo turno 1", "Almuerzo turno 2", "Cena"];

const CUENTAS: [string, string, DocUsuario["rol"]][] = [
  ["m.calderon@cateringandes.ec", "Mateo Calderón", "chef"],
  ["l.ordonez@cateringandes.ec", "Lucía Ordóñez", "produccion"],
  ["k.jimenez@cateringandes.ec", "Karla Jiménez", "admin"],
  ["a.vega@cateringandes.ec", "Andrés Vega", "calidad"],
];

async function vaciar(db: Db) {
  for (const c of ["areas", "servicios", "ingredientes", "recetas", "mermas",
                   "recomendaciones", "operacion_diaria", "contadores"])
    await db.collection(c).deleteMany({});
}

export async function sembrar(dbExterna?: Db) {
  const propia = dbExterna ? null : await conectar(URI, NOMBRE_DB);
  const db = dbExterna ?? propia!.db;
  const azar = crearAzar(20260727);

  console.log(`\n  Conectando a ${URI.replace(/:[^:@/]+@/, ":****@")} · base ${NOMBRE_DB}`);
  await aplicarEsquema(db);
  console.log("  Colecciones, validadores e índices aplicados.");
  await vaciar(db);

  // ---------------- cuentas (se conservan si ya existen) ----------------
  for (const [correo, nombre, rol] of CUENTAS)
    await db.collection<DocUsuario>("usuarios").updateOne(
      { correo },
      { $setOnInsert: {
        _id: randomUUID(), correo, nombre, rol,
        claveHash: await bcrypt.hash("foodloop2026", 10),
        activo: true, creadoEn: new Date(),
      } },
      { upsert: true });

  // ---------------- catálogos ----------------
  await db.collection<DocArea>("areas").insertMany(
    AREAS.map((a) => ({ _id: a.id, nombre: a.nombre, capacidadKg: a.capacidadKg })));
  await db.collection<DocServicio>("servicios").insertMany(
    SERVICIOS.map((s, i) => ({ _id: i, nombre: s, orden: i })));
  await db.collection<DocIngrediente>("ingredientes").insertMany(
    INGREDIENTES.map((i) => ({
      _id: i.id, codigo: i.codigo, nombre: i.nombre, categoria: i.categoria,
      unidad: i.unidad, costoUnitario: i.costoUnitario,
      vidaUtilCrudoH: i.vidaUtilCrudoH, vidaUtilCocidoH: i.vidaUtilCocidoH,
      tempMaxC: i.tempMaxC,
    })));
  await db.collection<DocReceta>("recetas").insertMany(
    CATALOGO.map((r) => ({
      _id: r.id, codigo: r.codigo, nombre: r.nombre, areaId: r.areaId,
      porcionesBase: r.porcionesBase, pesoPorcionG: r.pesoPorcionG,
      minutos: r.minutos, tipoProceso: r.tipoProceso,
      tempProcesoC: r.tempProcesoC, aceptacionBase: r.aceptacion,
      pasos: r.pasos, activa: true, requisitos: r.requisitos,
    })));

  // ---------------- seis meses de operación diaria ----------------
  // El desvío de comensales tiene media negativa: acude menos gente de
  // la prevista, que es el origen principal del excedente.
  const BASE = [210, 480, 430, 160];
  const operacion: DocOperacion[] = [];
  for (let d = 182; d >= 0; d--) {
    const fecha = new Date(Date.now() - d * 86_400_000);
    const iso = fecha.toISOString().slice(0, 10);
    const finde = fecha.getDay() === 0 || fecha.getDay() === 6;
    for (let s = 0; s < SERVICIOS.length; s++) {
      const base = Math.round(BASE[s] * (finde ? 0.35 : 1));
      const previstos = base + Math.round((azar() - 0.5) * 50);
      const reales = Math.max(20, Math.round(previstos * (1 - 0.06 + (azar() - 0.5) * 0.14)));
      const libres = [...Array(CATALOGO.length).keys()];
      const produccion = [];
      for (let k = 0; k < 2 + (azar() < 0.5 ? 1 : 0); k++) {
        const recetaId = libres.splice(Math.floor(azar() * libres.length), 1)[0];
        produccion.push({ recetaId, porciones: Math.round(previstos * (0.35 + azar() * 0.2)) });
      }
      operacion.push({
        _id: `${iso}|${s}`, fecha: iso, servicioId: s,
        comensalesPrevistos: previstos, comensalesReales: reales, produccion,
      });
    }
  }
  await db.collection<DocOperacion>("operacion_diaria").insertMany(operacion);

  // ---------------- lotes de merma ----------------
  // Los seis primeros son didácticos: pollo y arroz combinables, dos
  // lotes del mismo ingrediente para el reparto por urgencia, uno con
  // cadena de frío rota y uno sin dictamen sanitario.
  const forzados = [
    { ing: 0, cocido: true, cant: 6.4, temp: 3.2, apto: true, horas: 18 },
    { ing: 2, cocido: true, cant: 9.1, temp: 2.8, apto: true, horas: 28 },
    { ing: 4, cocido: false, cant: 2.6, temp: 4.0, apto: true, horas: 40 },
    { ing: 0, cocido: true, cant: 3.2, temp: 3.5, apto: true, horas: 11 },
    { ing: 8, cocido: true, cant: 2.0, temp: 8.4, apto: true, horas: 9 },
    { ing: 7, cocido: false, cant: 3.1, temp: 4.0, apto: false, horas: 30 },
  ];
  const mermas: DocMerma[] = [];
  const cerrados: number[] = [];

  for (let i = 0; i < 42; i++) {
    const f = forzados[i];
    const ing = INGREDIENTES[f ? f.ing : Math.floor(azar() * INGREDIENTES.length)];
    const cocido = f ? f.cocido : azar() < 0.62;
    const cantidad = f ? f.cant : Math.round((1.2 + azar() * 9.5) * 10) / 10;
    const temp = f ? f.temp : Math.round((2 + azar() * 3) * 10) / 10;
    const apto = f ? f.apto : azar() > 0.08;
    const diasAtras = f ? 0 : (i < 14 ? 0 : Math.floor(1 + azar() * 6));

    let acc = azar(); let causa: Causa = "sobreproduccion";
    for (const c of CAUSAS) { acc -= c.peso; if (acc <= 0) { causa = c.causa; break; } }

    const vidaH = f ? f.horas : (cocido ? ing.vidaUtilCocidoH : ing.vidaUtilCrudoH);
    const reg = new Date(Date.now() - diasAtras * 86_400_000 - azar() * 8 * 3_600_000);
    const id = i + 1;
    mermas.push({
      _id: id,
      codigo: `MRM-${String(reg.getFullYear()).slice(2)}`
        + `${String(reg.getMonth() + 1).padStart(2, "0")}`
        + `${String(reg.getDate()).padStart(2, "0")}-${String(id).padStart(4, "0")}`,
      ingredienteId: ing.id,
      areaId: Math.floor(azar() * AREAS.length),
      servicioId: Math.floor(azar() * SERVICIOS.length),
      cantidad, estadoProducto: cocido ? "cocido" : "crudo",
      temperaturaC: temp, causa, aptoReproceso: apto,
      registradoEn: reg,
      venceEn: new Date(reg.getTime() + vidaH * 3_600_000),
    });
    if (diasAtras > 0) cerrados.push(id);
  }
  await db.collection<DocMerma>("mermas").insertMany(mermas);
  await db.collection<{ _id: string; seq: number }>("contadores")
    .insertOne({ _id: "mermas", seq: mermas.length });

  // ---------------- historial de recomendaciones ----------------
  // Dos de cada cinco combinan dos lotes del mismo día. Cada una lleva
  // dentro sus lotes, la decisión y, a veces, el feedback: es el
  // documento que describe completa una propuesta y su desenlace.
  const recs: DocRecomendacion[] = [];
  const pendientes = [...cerrados];
  let recId = 0;
  while (pendientes.length) {
    const combinar = pendientes.length >= 2 && azar() < 0.4;
    const usados = combinar ? [pendientes.shift()!, pendientes.shift()!] : [pendientes.shift()!];
    const docs = usados.map((u) => mermas.find((m) => m._id === u)!);
    const kg = docs.reduce((a, m) => a + m.cantidad, 0);
    const accion = azar() < (combinar ? 0.82 : 0.6) ? "aprobada" : "descartada";
    const conFeedback = azar() < 0.34;
    const claridad = azar() < 0.72 ? "clara" : (azar() < 0.5 ? "confusa" : "insuficiente");
    recId++;

    recs.push({
      _id: recId,
      recetaId: Math.floor(azar() * CATALOGO.length),
      generadaEn: docs[0].registradoEn,
      versionModelo: "2.0.0",
      aptitud: Math.round((combinar ? 78 + azar() * 18 : 58 + azar() * 25) * 10) / 10,
      posicion: 1,
      porciones: Math.round(20 + azar() * 30),
      kgAprovechados: Math.round(kg * 100) / 100,
      costoRecuperado: Math.round(kg * 4 * 100) / 100,
      factores: [], contrafactuales: [], descartes: [],
      aportes: docs.map((m, i) => ({
        mermaId: m._id, cantidadUsada: m.cantidad, esPrincipal: i === 0,
      })),
      decision: {
        id: randomUUID(), rol: "chef", usuario: "Mateo Calderón",
        accion, decididaEn: new Date(docs[0].registradoEn.getTime() + 2 * 3_600_000),
      },
      feedback: conFeedback ? [{
        rol: "chef", usuario: "Mateo Calderón", claridad,
        registradoEn: new Date(docs[0].registradoEn.getTime() + 2 * 3_600_000),
      }] : [],
    });
  }
  if (recs.length) await db.collection<DocRecomendacion>("recomendaciones").insertMany(recs);
  await db.collection<{ _id: string; seq: number }>("contadores")
    .insertOne({ _id: "recomendaciones", seq: recId });

  // ---------------- resumen ----------------
  for (const c of ["usuarios", "areas", "servicios", "ingredientes", "recetas",
                   "operacion_diaria", "mermas", "recomendaciones"])
    console.log(`    ${c.padEnd(18)} ${String(await db.collection(c).countDocuments()).padStart(4)} documentos`);
  console.log();

  if (propia) await propia.cliente.close();
}

/** Solo se ejecuta cuando el archivo se invoca directamente. */
if (process.argv[1]?.includes("semilla")) {
  sembrar().catch((e) => {
    console.error("\n  No se pudo sembrar la base:\n ", e.message);
    console.error("\n  Comprueba que MongoDB esté corriendo y que MONGODB_URI");
    console.error("  en backend/.env sea la cadena que usas en Compass.\n");
    process.exit(1);
  });
}
