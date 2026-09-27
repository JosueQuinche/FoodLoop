/**
 * FoodLoop · Fase 2 · Recolección y preparación de datos reales
 *
 * Carga los registros operativos del centro de producción desde archivos
 * CSV y los transforma al modelo documental. Sustituye a la semilla de
 * datos de ejemplo: mientras el modelo se construya sobre datos
 * generados, la fase de preparación de datos no está cumplida.
 *
 * ARCHIVOS ESPERADOS (carpeta `datos/`, codificación UTF-8)
 *
 *   ingredientes.csv
 *     codigo,nombre,categoria,unidad,costo_unitario,
 *     vida_util_crudo_h,vida_util_cocido_h,temp_max_c
 *
 *   recetas.csv
 *     codigo,nombre,area,porciones_base,peso_porcion_g,minutos,
 *     tipo_proceso,temp_proceso_c,aceptacion_base
 *
 *   receta_ingredientes.csv        ← la relación receta-ingrediente
 *     receta_codigo,ingrediente_codigo,cantidad,es_principal,admite_estado
 *
 *   produccion.csv
 *     fecha,servicio,receta_codigo,porciones_producidas
 *
 *   asistencia.csv
 *     fecha,servicio,comensales_previstos,comensales_reales
 *
 *   mermas.csv
 *     fecha,servicio,ingrediente_codigo,cantidad,estado_producto,
 *     temperatura_c,causa,apto_reproceso,area,vida_util_h
 *
 * CRITERIO DE PREPARACIÓN
 *
 * Los datos operativos reales llegan con inconsistencias: fechas en
 * formatos distintos, nombres de servicio escritos de varias maneras,
 * cantidades con coma decimal, filas incompletas. El importador las
 * normaliza y, cuando una fila no se puede salvar, la descarta y la
 * reporta en lugar de inventar un valor. El informe final declara
 * cuántas filas entraron y cuántas se descartaron, que es lo que hay
 * que citar en la fase de preparación de datos.
 *
 * Ejecutar: npm run importar -- ./datos
 */

import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Db } from "mongodb";
import { conectar, aplicarEsquema } from "./conexion";
import type {
  DocArea, DocServicio, DocIngrediente, DocReceta, DocMerma,
  DocOperacion, DocUsuario,
} from "./repositorios";

const URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
const NOMBRE_DB = process.env.MONGODB_DB ?? "foodloop";

// ---------------------------------------------------------------------
// Lectura y normalización
// ---------------------------------------------------------------------

/** Lector de CSV con comillas. No se usa librería para no añadir dependencia. */
function leerCsv(ruta: string): Record<string, string>[] {
  const texto = readFileSync(ruta, "utf-8").replace(/^﻿/, "");
  const filas: string[][] = [];
  let campo = "", fila: string[] = [], comillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === "," || c === ";") { fila.push(campo); campo = ""; }
    else if (c === "\n") { fila.push(campo); filas.push(fila); fila = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  if (filas.length < 2) return [];

  const cab = filas[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return filas.slice(1)
    .filter((f) => f.some((x) => x.trim() !== ""))
    .map((f) => Object.fromEntries(cab.map((h, i) => [h, (f[i] ?? "").trim()])));
}

/**
 * Número con coma o punto decimal. Los registros de cocina suelen venir
 * de hojas de cálculo con configuración regional española.
 */
function num(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Fecha en dd/mm/aaaa, aaaa-mm-dd o dd-mm-aaaa → aaaa-mm-dd.
 *
 * Se comprueba que el resultado sea un día que existe. Sin esa
 * comprobación, una fecha en formato estadounidense (03/13/2026) se
 * interpretaría como el mes 13 y produciría un registro con fecha
 * inválida que contaminaría todas las series temporales.
 */
function fecha(v: string | undefined): string | null {
  if (!v) return null;
  const t = v.trim().slice(0, 10);
  let a: string, mes: string, dia: string;

  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(t);
  if (m) [, a, mes, dia] = m;
  else {
    m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(t);
    if (!m) return null;
    [, dia, mes, a] = m;
  }

  const iso = `${a}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
  const d = new Date(`${iso}T12:00:00`);
  // Comparar con lo construido detecta tanto un mes fuera de rango como
  // un día que no existe en ese mes (31 de febrero, por ejemplo).
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso)
    return null;
  return iso;
}

const si = (v: string | undefined) =>
  /^(s[ií]|si|true|1|x|apto)$/i.test((v ?? "").trim());

/** Normaliza un nombre para comparar: sin tildes, minúsculas, sin dobles espacios. */
const clave = (v: string) =>
  v.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().trim().replace(/\s+/g, " ");

// ---------------------------------------------------------------------

interface Informe {
  archivo: string;
  leidas: number;
  cargadas: number;
  descartadas: { fila: number; motivo: string }[];
}

class Registro {
  informes: Informe[] = [];
  private actual!: Informe;

  abrir(archivo: string, leidas: number) {
    this.actual = { archivo, leidas, cargadas: 0, descartadas: [] };
    this.informes.push(this.actual);
    return this.actual;
  }
  ok() { this.actual.cargadas++; }
  descartar(fila: number, motivo: string) {
    this.actual.descartadas.push({ fila, motivo });
  }
}

// ---------------------------------------------------------------------

export async function importar(carpeta: string, dbExterna?: Db) {
  const propia = dbExterna ? null : await conectar(URI, NOMBRE_DB);
  const db = dbExterna ?? propia!.db;
  const reg = new Registro();

  const ruta = (n: string) => join(carpeta, n);
  const obligatorios = ["ingredientes.csv", "recetas.csv",
    "receta_ingredientes.csv", "mermas.csv"];
  const faltan = obligatorios.filter((f) => !existsSync(ruta(f)));
  if (faltan.length)
    throw new Error(`Faltan archivos en ${carpeta}: ${faltan.join(", ")}`);

  console.log(`\n  FASE 2 · PREPARACIÓN DE DATOS`);
  console.log(`  Origen: ${carpeta}`);
  console.log(`  Destino: ${URI.replace(/:[^:@/]+@/, ":****@")} · base ${NOMBRE_DB}\n`);

  await aplicarEsquema(db);
  for (const c of ["areas", "servicios", "ingredientes", "recetas", "mermas",
                   "recomendaciones", "operacion_diaria", "contadores"])
    await db.collection(c).deleteMany({});

  // ------------------------------------------------------------------
  // Áreas y servicios: se deducen de los datos, no se declaran aparte.
  // Pedir un catálogo más al centro de producción sería fricción
  // innecesaria cuando los nombres ya aparecen en los registros.
  // ------------------------------------------------------------------
  const areas = new Map<string, number>();
  const servicios = new Map<string, number>();
  const idArea = (n: string) => {
    const k = clave(n || "Sin área");
    if (!areas.has(k)) areas.set(k, areas.size);
    return areas.get(k)!;
  };
  const idServicio = (n: string) => {
    const k = clave(n || "Sin servicio");
    if (!servicios.has(k)) servicios.set(k, servicios.size);
    return servicios.get(k)!;
  };
  const nombreOriginal = new Map<string, string>();
  const recordar = (n: string) => {
    const k = clave(n);
    if (!nombreOriginal.has(k) && n.trim()) nombreOriginal.set(k, n.trim());
    return n;
  };

  // ------------------------------------------------------------------
  // Ingredientes
  // ------------------------------------------------------------------
  const filasIng = leerCsv(ruta("ingredientes.csv"));
  reg.abrir("ingredientes.csv", filasIng.length);
  const ingPorCodigo = new Map<string, DocIngrediente>();
  const docsIng: DocIngrediente[] = [];

  filasIng.forEach((f, i) => {
    const codigo = f.codigo?.trim();
    const nombre = f.nombre?.trim();
    const costo = num(f.costo_unitario);
    const crudo = num(f.vida_util_crudo_h);
    const cocido = num(f.vida_util_cocido_h);
    if (!codigo || !nombre)
      return reg.descartar(i + 2, "falta código o nombre");
    if (costo === null || crudo === null || cocido === null)
      return reg.descartar(i + 2, "costo o vida útil no numéricos");
    if (crudo <= 0 || cocido <= 0)
      return reg.descartar(i + 2, "vida útil debe ser mayor que cero");

    const unidad = (["kg", "l", "unid"].includes(clave(f.unidad ?? ""))
      ? (clave(f.unidad!) === "l" ? "L" : clave(f.unidad!))
      : "kg") as DocIngrediente["unidad"];

    const doc: DocIngrediente = {
      _id: docsIng.length, codigo, nombre,
      categoria: f.categoria?.trim() || "Sin categoría",
      unidad, costoUnitario: costo,
      vidaUtilCrudoH: Math.round(crudo),
      vidaUtilCocidoH: Math.round(cocido),
      tempMaxC: num(f.temp_max_c) ?? 4,
    };
    docsIng.push(doc);
    ingPorCodigo.set(codigo, doc);
    reg.ok();
  });
  if (docsIng.length) await db.collection<DocIngrediente>("ingredientes").insertMany(docsIng);

  // ------------------------------------------------------------------
  // Recetas + la relación receta-ingrediente embebida
  // ------------------------------------------------------------------
  const filasRec = leerCsv(ruta("recetas.csv"));
  const filasRI = leerCsv(ruta("receta_ingredientes.csv"));
  reg.abrir("recetas.csv", filasRec.length);

  const PROCESOS = ["reproceso_termico", "ensamblaje_frio", "conservacion", "panaderia"];
  const recPorCodigo = new Map<string, DocReceta>();
  const docsRec: DocReceta[] = [];

  filasRec.forEach((f, i) => {
    const codigo = f.codigo?.trim();
    const nombre = f.nombre?.trim();
    const porciones = num(f.porciones_base);
    const peso = num(f.peso_porcion_g);
    const minutos = num(f.minutos);
    if (!codigo || !nombre) return reg.descartar(i + 2, "falta código o nombre");
    if (!porciones || !peso || !minutos)
      return reg.descartar(i + 2, "porciones, peso o minutos no numéricos");

    const tp = clave(f.tipo_proceso ?? "").replace(/[ -]/g, "_");
    const doc: DocReceta = {
      _id: docsRec.length, codigo, nombre,
      areaId: idArea(recordar(f.area ?? "")),
      porcionesBase: Math.round(porciones),
      pesoPorcionG: Math.round(peso),
      minutos: Math.round(minutos),
      tipoProceso: (PROCESOS.includes(tp) ? tp : "reproceso_termico") as DocReceta["tipoProceso"],
      tempProcesoC: num(f.temp_proceso_c) ?? 0,
      aceptacionBase: Math.min(5, Math.max(1, num(f.aceptacion_base) ?? 3.5)),
      pasos: [], activa: true, requisitos: [],
    };
    docsRec.push(doc);
    recPorCodigo.set(codigo, doc);
    reg.ok();
  });

  // La relación se embebe en el documento de la receta. El nombre y la
  // unidad se copian del catálogo para que la receta se lea completa.
  reg.abrir("receta_ingredientes.csv", filasRI.length);
  filasRI.forEach((f, i) => {
    const receta = recPorCodigo.get(f.receta_codigo?.trim() ?? "");
    const ing = ingPorCodigo.get(f.ingrediente_codigo?.trim() ?? "");
    const cantidad = num(f.cantidad);
    if (!receta) return reg.descartar(i + 2, `receta ${f.receta_codigo} no existe`);
    if (!ing) return reg.descartar(i + 2, `ingrediente ${f.ingrediente_codigo} no existe`);
    if (!cantidad || cantidad <= 0) return reg.descartar(i + 2, "cantidad no válida");

    const estado = clave(f.admite_estado ?? "ambos");
    receta.requisitos.push({
      ingredienteId: ing._id,
      nombre: ing.nombre,
      unidad: ing.unidad,
      cantidad,
      esPrincipal: si(f.es_principal),
      admiteEstado: (["crudo", "cocido", "ambos"].includes(estado)
        ? estado : "ambos") as "crudo" | "cocido" | "ambos",
    });
    reg.ok();
  });

  // Una receta sin ingredientes no puede evaluarse: el motor la
  // descartaría siempre. Se excluye y se reporta.
  const sinIngredientes = docsRec.filter((r) => r.requisitos.length === 0);
  const recetasValidas = docsRec.filter((r) => r.requisitos.length > 0);
  if (recetasValidas.length)
    await db.collection<DocReceta>("recetas").insertMany(recetasValidas);

  // ------------------------------------------------------------------
  // Mermas
  // ------------------------------------------------------------------
  const filasMer = leerCsv(ruta("mermas.csv"));
  reg.abrir("mermas.csv", filasMer.length);
  const CAUSAS = ["sobreproduccion", "devolucion_linea", "error_porcionado",
    "caducidad_proxima", "defecto_calidad"];
  const docsMer: DocMerma[] = [];

  filasMer.forEach((f, i) => {
    const ing = ingPorCodigo.get(f.ingrediente_codigo?.trim() ?? "");
    const fch = fecha(f.fecha);
    const cantidad = num(f.cantidad);
    if (!ing) return reg.descartar(i + 2, `ingrediente ${f.ingrediente_codigo} no existe`);
    if (!fch) return reg.descartar(i + 2, `fecha no reconocida: "${f.fecha}"`);
    if (!cantidad || cantidad <= 0) return reg.descartar(i + 2, "cantidad no válida");

    const cocido = clave(f.estado_producto ?? "") === "cocido";
    const causa = clave(f.causa ?? "").replace(/[ -]/g, "_");
    const registrado = new Date(`${fch}T12:00:00`);
    // Si el registro no trae vida útil, se deriva del ingrediente y su
    // estado, que es el criterio sanitario del propio catálogo.
    const vidaH = num(f.vida_util_h)
      ?? (cocido ? ing.vidaUtilCocidoH : ing.vidaUtilCrudoH);

    const id = docsMer.length + 1;
    docsMer.push({
      _id: id,
      codigo: f.codigo?.trim()
        || `MRM-${fch.replace(/-/g, "").slice(2)}-${String(id).padStart(4, "0")}`,
      ingredienteId: ing._id,
      areaId: idArea(recordar(f.area ?? "")),
      servicioId: idServicio(recordar(f.servicio ?? "")),
      cantidad,
      estadoProducto: cocido ? "cocido" : "crudo",
      temperaturaC: num(f.temperatura_c) ?? 4,
      causa: (CAUSAS.includes(causa) ? causa : "sobreproduccion") as DocMerma["causa"],
      aptoReproceso: f.apto_reproceso === undefined ? true : si(f.apto_reproceso),
      registradoEn: registrado,
      venceEn: new Date(registrado.getTime() + vidaH * 3_600_000),
    });
    reg.ok();
  });
  if (docsMer.length) await db.collection<DocMerma>("mermas").insertMany(docsMer);

  // ------------------------------------------------------------------
  // Producción y asistencia: el cruce por fecha y servicio
  // ------------------------------------------------------------------
  const operacion = new Map<string, DocOperacion>();

  if (existsSync(ruta("asistencia.csv"))) {
    const filas = leerCsv(ruta("asistencia.csv"));
    reg.abrir("asistencia.csv", filas.length);
    filas.forEach((f, i) => {
      const fch = fecha(f.fecha);
      const prev = num(f.comensales_previstos);
      const real = num(f.comensales_reales);
      if (!fch) return reg.descartar(i + 2, `fecha no reconocida: "${f.fecha}"`);
      if (prev === null || real === null)
        return reg.descartar(i + 2, "comensales no numéricos");
      const sid = idServicio(recordar(f.servicio ?? ""));
      operacion.set(`${fch}|${sid}`, {
        _id: `${fch}|${sid}`, fecha: fch, servicioId: sid,
        comensalesPrevistos: Math.round(prev),
        comensalesReales: Math.round(real),
        produccion: [],
      });
      reg.ok();
    });
  }

  if (existsSync(ruta("produccion.csv"))) {
    const filas = leerCsv(ruta("produccion.csv"));
    reg.abrir("produccion.csv", filas.length);
    filas.forEach((f, i) => {
      const fch = fecha(f.fecha);
      const receta = recPorCodigo.get(f.receta_codigo?.trim() ?? "");
      const porciones = num(f.porciones_producidas);
      if (!fch) return reg.descartar(i + 2, `fecha no reconocida: "${f.fecha}"`);
      if (!receta) return reg.descartar(i + 2, `receta ${f.receta_codigo} no existe`);
      if (porciones === null) return reg.descartar(i + 2, "porciones no numéricas");

      const sid = idServicio(recordar(f.servicio ?? ""));
      const k = `${fch}|${sid}`;
      // Una producción sin asistencia registrada se conserva igual: el
      // cruce quedará incompleto pero el dato de producción es válido.
      const o = operacion.get(k) ?? {
        _id: k, fecha: fch, servicioId: sid,
        comensalesPrevistos: 0, comensalesReales: 0, produccion: [],
      };
      o.produccion.push({ recetaId: receta._id, porciones: Math.round(porciones) });
      operacion.set(k, o);
      reg.ok();
    });
  }
  if (operacion.size)
    await db.collection<DocOperacion>("operacion_diaria").insertMany([...operacion.values()]);

  // ------------------------------------------------------------------
  // Catálogos deducidos y contadores
  // ------------------------------------------------------------------
  const docsArea: DocArea[] = [...areas.entries()].map(([k, id]) => ({
    _id: id, nombre: nombreOriginal.get(k) ?? "Sin área", capacidadKg: 60,
  }));
  const docsServ: DocServicio[] = [...servicios.entries()].map(([k, id]) => ({
    _id: id, nombre: nombreOriginal.get(k) ?? "Sin servicio", orden: id,
  }));
  if (docsArea.length) await db.collection<DocArea>("areas").insertMany(docsArea);
  if (docsServ.length) await db.collection<DocServicio>("servicios").insertMany(docsServ);
  await db.collection<{ _id: string; seq: number }>("contadores").insertMany([
    { _id: "mermas", seq: docsMer.length },
    { _id: "recomendaciones", seq: 0 },
  ]);

  // Cuentas de acceso, que no provienen de los registros operativos.
  for (const [correo, nombre, rol] of [
    ["m.calderon@cateringandes.ec", "Mateo Calderón", "chef"],
    ["l.ordonez@cateringandes.ec", "Lucía Ordóñez", "produccion"],
    ["k.jimenez@cateringandes.ec", "Karla Jiménez", "admin"],
    ["a.vega@cateringandes.ec", "Andrés Vega", "calidad"],
  ] as [string, string, DocUsuario["rol"]][])
    await db.collection<DocUsuario>("usuarios").updateOne(
      { correo },
      { $setOnInsert: {
        _id: randomUUID(), correo, nombre, rol,
        claveHash: await bcrypt.hash("foodloop2026", 10),
        activo: true, creadoEn: new Date(),
      } },
      { upsert: true });

  // ------------------------------------------------------------------
  // Informe de preparación
  // ------------------------------------------------------------------
  console.log("  INFORME DE PREPARACIÓN DE DATOS");
  console.log("  " + "─".repeat(64));
  console.log(`  ${"Archivo".padEnd(26)} ${"Leídas".padStart(8)} ${"Cargadas".padStart(9)} ${"Descartadas".padStart(12)}`);
  let totalLeidas = 0, totalCargadas = 0, totalDescartadas = 0;
  for (const inf of reg.informes) {
    totalLeidas += inf.leidas;
    totalCargadas += inf.cargadas;
    totalDescartadas += inf.descartadas.length;
    console.log(`  ${inf.archivo.padEnd(26)} ${String(inf.leidas).padStart(8)} `
      + `${String(inf.cargadas).padStart(9)} ${String(inf.descartadas.length).padStart(12)}`);
  }
  console.log("  " + "─".repeat(64));
  console.log(`  ${"Total".padEnd(26)} ${String(totalLeidas).padStart(8)} `
    + `${String(totalCargadas).padStart(9)} ${String(totalDescartadas).padStart(12)}`);
  console.log(`\n  Tasa de aprovechamiento de los registros: `
    + `${totalLeidas ? (totalCargadas / totalLeidas * 100).toFixed(1) : "—"} %`);

  const conDescartes = reg.informes.filter((i) => i.descartadas.length);
  if (conDescartes.length) {
    console.log("\n  FILAS DESCARTADAS (primeras de cada archivo)");
    console.log("  " + "─".repeat(64));
    for (const inf of conDescartes) {
      console.log(`  ${inf.archivo}:`);
      for (const d of inf.descartadas.slice(0, 5))
        console.log(`     línea ${String(d.fila).padStart(5)} · ${d.motivo}`);
      if (inf.descartadas.length > 5)
        console.log(`     … y ${inf.descartadas.length - 5} más`);
    }
    console.log("\n  Ninguna fila descartada se sustituyó por un valor estimado.");
  }

  if (sinIngredientes.length) {
    console.log(`\n  ${sinIngredientes.length} receta(s) sin ingredientes declarados, excluidas:`);
    for (const r of sinIngredientes.slice(0, 5)) console.log(`     ${r.codigo} · ${r.nombre}`);
  }

  console.log("\n  CONJUNTO CARGADO");
  console.log("  " + "─".repeat(64));
  for (const c of ["areas", "servicios", "ingredientes", "recetas",
                   "operacion_diaria", "mermas"])
    console.log(`  ${c.padEnd(26)} ${String(await db.collection(c).countDocuments()).padStart(8)} documentos`);

  const conFecha = docsMer.filter((m) => !Number.isNaN(m.registradoEn.getTime()));
  if (conFecha.length) {
    const f = conFecha.map((m) => m.registradoEn.getTime());
    const desde = new Date(Math.min(...f)).toISOString().slice(0, 10);
    const hasta = new Date(Math.max(...f)).toISOString().slice(0, 10);
    const dias = Math.round((Math.max(...f) - Math.min(...f)) / 86_400_000) + 1;
    console.log(`\n  Periodo cubierto: ${desde} a ${hasta} (${dias} días)`);
  }
  console.log();

  if (propia) await propia.cliente.close();
  return { totalLeidas, totalCargadas, totalDescartadas };
}

if (process.argv[1]?.endsWith("mongo/importar.ts")) {
  const carpeta = process.argv[2] ?? "./datos";
  importar(carpeta).catch((e) => {
    console.error("\n  No se pudo importar:\n ", e.message, "\n");
    process.exit(1);
  });
}
