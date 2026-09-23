/**
 * FoodLoop · Fase 4 · Evaluación del artefacto
 *
 * Indicadores de desempeño calculados sobre lo que el sistema registró:
 * mermas, operación diaria, recomendaciones, decisiones y valoraciones.
 * Se agrupan en tres bloques: operación, modelo y explicabilidad.
 *
 * Ejecutar: npm run evaluar
 */

import "dotenv/config";
import { conectar, aplicarEsquema } from "./conexion";
import { aceptacionEfectiva, conteoDecisionesPorReceta } from "./repositorios";
import type {
  DocMerma, DocIngrediente, DocRecomendacion, DocOperacion, DocReceta,
} from "./repositorios";
import { PESOS, VERSION_MODELO } from "@foodloop/dominio";

const URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
const NOMBRE_DB = process.env.MONGODB_DB ?? "foodloop";

const pct = (a: number, b: number) => b ? `${(a / b * 100).toFixed(1)} %` : "—";
const fila = (t: string, v: string, n = "") =>
  console.log(`  ${t.padEnd(38)} ${v.padStart(10)}   ${n}`);

export async function evaluar(dbExterna?: import("mongodb").Db) {
  const propia = dbExterna ? null : await conectar(URI, NOMBRE_DB);
  const db = dbExterna ?? propia!.db;
  await aplicarEsquema(db);

  const [mermas, ingredientes, recs, operacion, recetas] = await Promise.all([
    db.collection<DocMerma>("mermas").find().toArray(),
    db.collection<DocIngrediente>("ingredientes").find().toArray(),
    db.collection<DocRecomendacion>("recomendaciones").find().toArray(),
    db.collection<DocOperacion>("operacion_diaria").find().toArray(),
    db.collection<DocReceta>("recetas").find().toArray(),
  ]);
  const ing = new Map(ingredientes.map((i) => [i._id, i]));
  const merma = new Map(mermas.map((m) => [m._id, m]));

  console.log(`\n  FASE 4 · EVALUACIÓN DEL ARTEFACTO · versión ${VERSION_MODELO}`);
  console.log("  " + "═".repeat(66));

  // ------------------------------------------------------------------
  // 1 · Operación
  // ------------------------------------------------------------------
  const kgTotal = mermas.reduce((a, m) => a + m.cantidad, 0);
  const valorTotal = mermas.reduce(
    (a, m) => a + m.cantidad * (ing.get(m.ingredienteId)?.costoUnitario ?? 0), 0);
  let kgAprov = 0, valorAprov = 0;
  for (const r of recs.filter((x) => x.decision?.accion === "aprobada"))
    for (const a of r.aportes) {
      kgAprov += a.cantidadUsada;
      const m = merma.get(a.mermaId);
      valorAprov += a.cantidadUsada * (m ? ing.get(m.ingredienteId)?.costoUnitario ?? 0 : 0);
    }
  const sinDictamen = mermas.filter((m) => !m.aptoReproceso).length;

  console.log("\n  1 · OPERACIÓN");
  console.log("  " + "─".repeat(66));
  fila("Lotes registrados", String(mermas.length));
  fila("Merma total", `${kgTotal.toFixed(1)} kg`);
  fila("Merma aprovechada", `${kgAprov.toFixed(1)} kg`, pct(kgAprov, kgTotal));
  fila("Valor de la merma", `$ ${valorTotal.toFixed(2)}`);
  fila("Costo evitado", `$ ${valorAprov.toFixed(2)}`, pct(valorAprov, valorTotal));
  fila("Lotes sin dictamen sanitario", String(sinDictamen), pct(sinDictamen, mermas.length));

  // ------------------------------------------------------------------
  // 1b · Integración de producción, consumo y residuos (Fase 1)
  // ------------------------------------------------------------------
  if (operacion.length) {
    const peso = new Map(recetas.map((r) => [r._id, r.pesoPorcionG]));
    const mermaPorClave = new Map<string, number>();
    for (const m of mermas) {
      const clave = `${m.registradoEn.toISOString().slice(0, 10)}|${m.servicioId}`;
      mermaPorClave.set(clave, (mermaPorClave.get(clave) ?? 0) + m.cantidad);
    }

    let porciones = 0, kgProd = 0, sumaDesvio = 0;
    const rangos = new Map<string, { servicios: number; kg: number; pct: number[] }>();
    for (const o of operacion) {
      const kgServ = o.produccion.reduce(
        (a, p) => a + p.porciones * (peso.get(p.recetaId) ?? 0) / 1000, 0);
      porciones += o.produccion.reduce((a, p) => a + p.porciones, 0);
      kgProd += kgServ;
      const desvio = o.comensalesPrevistos
        ? (o.comensalesPrevistos - o.comensalesReales) / o.comensalesPrevistos * 100 : 0;
      sumaDesvio += desvio;

      const kgM = mermaPorClave.get(o._id) ?? 0;
      const rango = desvio < 0 ? "Acudieron más de los previstos"
        : desvio < 5 ? "Desvío bajo (0-5 %)"
        : desvio < 12 ? "Desvío medio (5-12 %)" : "Desvío alto (>12 %)";
      const g = rangos.get(rango) ?? { servicios: 0, kg: 0, pct: [] };
      g.servicios++;
      g.kg += kgM;
      if (kgServ > 0) g.pct.push(kgM / kgServ * 100);
      rangos.set(rango, g);
    }
    const fechas = operacion.map((o) => o.fecha).sort();

    console.log("\n  1b · INTEGRACIÓN DE PRODUCCIÓN, CONSUMO Y RESIDUOS");
    console.log("  " + "─".repeat(66));
    fila("Periodo cubierto", fechas[0], `a ${fechas[fechas.length - 1]}`);
    fila("Servicios registrados", String(operacion.length));
    fila("Porciones producidas", porciones.toLocaleString("es-EC"));
    fila("Peso producido", `${kgProd.toFixed(1)} kg`);
    fila("Desvío medio de comensales", `${(sumaDesvio / operacion.length).toFixed(1)} %`,
      "previstos frente a reales");
    fila("Merma sobre lo producido", `${(kgTotal / kgProd * 100).toFixed(2)} %`,
      "indicador normalizado");

    console.log("\n  Relación entre desvío de comensales y merma");
    console.log("  " + "─".repeat(66));
    console.log(`  ${"Rango de desvío".padEnd(34)} ${"Serv.".padStart(6)} ${"kg".padStart(8)}`);
    for (const nombre of ["Acudieron más de los previstos", "Desvío bajo (0-5 %)",
                          "Desvío medio (5-12 %)", "Desvío alto (>12 %)"]) {
      const g = rangos.get(nombre);
      if (!g) continue;
      console.log(`  ${nombre.padEnd(34)} ${String(g.servicios).padStart(6)} `
        + `${(g.kg / g.servicios).toFixed(2).padStart(8)}`);
    }
    console.log("\n  Con datos reales, que la merma media crezca con el desvío");
    console.log("  sostiene la hipótesis del modelo. Con los datos de ejemplo la");
    console.log("  relación no es concluyente, porque las mermas se generan al azar.");
  }

  // ------------------------------------------------------------------
  // 2 · Modelo
  // ------------------------------------------------------------------
  const decididas = recs.filter((r) => r.decision);
  const aprobadas = decididas.filter((r) => r.decision!.accion === "aprobada").length;
  const multi = recs.filter((r) => r.aportes.length > 1).length;
  const primeras = recs.filter((r) => r.posicion === 1);
  const aptitudPrimera = primeras.length
    ? primeras.reduce((a, r) => a + r.aptitud, 0) / primeras.length : 0;

  console.log("\n  2 · MODELO");
  console.log("  " + "─".repeat(66));
  fila("Propuestas registradas", String(recs.length));
  fila("Aptitud media de la primera", aptitudPrimera.toFixed(1));
  fila("Propuestas multi-lote", String(multi), pct(multi, recs.length));
  fila("Lotes por propuesta",
    (recs.reduce((a, r) => a + r.aportes.length, 0) / (recs.length || 1)).toFixed(2));
  console.log();
  fila("Decisiones registradas", String(decididas.length));
  for (const accion of ["aprobada", "descartada", "modificada"]) {
    const n = decididas.filter((r) => r.decision!.accion === accion).length;
    if (n) fila(`  · ${accion}`, String(n), pct(n, decididas.length));
  }
  fila("Tasa de aceptación", pct(aprobadas, decididas.length),
    "indicador de utilidad percibida");

  const conteo = await conteoDecisionesPorReceta(db);
  const filasAcept = recetas
    .map((r) => ({ r, c: conteo.get(r._id) }))
    .filter((x) => x.c && x.c.n > 0)
    .sort((a, b) => b.c!.n - a.c!.n)
    .slice(0, 6);

  if (filasAcept.length) {
    console.log("\n  Aceptación recalculada desde las decisiones reales");
    console.log("  " + "─".repeat(66));
    console.log(`  ${"Receta".padEnd(34)} ${"Dec.".padStart(5)} ${"Apr.".padStart(5)} ${"Base".padStart(6)} ${"Efect.".padStart(7)}`);
    for (const { r, c } of filasAcept)
      console.log(`  ${r.nombre.slice(0, 34).padEnd(34)} `
        + `${String(c!.n).padStart(5)} ${String(c!.aprobadas).padStart(5)} `
        + `${r.aceptacionBase.toFixed(1).padStart(6)} `
        + `${aceptacionEfectiva(r.aceptacionBase, c!.n, c!.aprobadas).toFixed(1).padStart(7)}`);
    console.log("\n  La columna efectiva es la que usa el modelo. Se calcula con");
    console.log("  encogimiento hacia la base, con un peso previo de 8 casos:");
    console.log("  las primeras decisiones mueven poco la valoración y hace");
    console.log("  falta evidencia acumulada para desplazarla de verdad.");
  }

  // ------------------------------------------------------------------
  // 3 · Explicabilidad
  // ------------------------------------------------------------------
  const valoraciones = recs.flatMap((r) => r.feedback ?? []);
  console.log("\n  3 · EXPLICABILIDAD");
  console.log("  " + "─".repeat(66));
  if (valoraciones.length === 0) {
    console.log("  Todavía no hay valoraciones registradas.");
  } else {
    fila("Valoraciones recogidas", String(valoraciones.length));
    for (const cl of ["clara", "confusa", "insuficiente"]) {
      const n = valoraciones.filter((v) => v.claridad === cl).length;
      if (n) fila(`  · ${cl}`, String(n), pct(n, valoraciones.length));
    }
    const claras = valoraciones.filter((v) => v.claridad === "clara").length;
    fila("Explicaciones comprendidas", pct(claras, valoraciones.length),
      "comprensión del componente XAI");

    const roles = [...new Set(valoraciones.map((v) => v.rol))];
    if (roles.length > 1) {
      console.log("\n  Comprensión por perfil");
      console.log("  " + "─".repeat(66));
      for (const rol of roles) {
        const del = valoraciones.filter((v) => v.rol === rol);
        fila(`  ${rol}`, pct(del.filter((v) => v.claridad === "clara").length, del.length),
          `${del.length} valoraciones`);
      }
    }
  }

  // ------------------------------------------------------------------
  console.log("\n  PARÁMETROS DEL MODELO");
  console.log("  " + "─".repeat(66));
  for (const [k, v] of Object.entries(PESOS)) fila(`  ${k}`, v.toFixed(2));
  console.log("\n  Declarados en el código y auditables. Reportarlos es lo que");
  console.log("  permite que otro investigador reproduzca los resultados.");
  console.log("\n  " + "═".repeat(66) + "\n");

  if (propia) await propia.cliente.close();
}

if (process.argv[1]?.includes("evaluar")) evaluar().catch((e) => {
  console.error("\n  No se pudo evaluar:\n ", e.message, "\n");
  process.exit(1);
});
