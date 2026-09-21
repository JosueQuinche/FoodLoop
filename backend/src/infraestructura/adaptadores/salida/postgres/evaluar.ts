/**
 * FoodLoop · Fase 4 · Evaluación del artefacto
 *
 * Calcula los indicadores de desempeño que sustentan la sección de
 * resultados del artículo. Se apoya en lo que el sistema registró
 * durante su uso, no en una simulación: las decisiones, las trazas de
 * recomendación y las valoraciones de las explicaciones.
 *
 * Los indicadores se agrupan en tres bloques:
 *
 *   1. Operación      · qué pasa con la merma
 *   2. Modelo         · cómo se comporta el motor
 *   3. Explicabilidad · si los usuarios entienden las propuestas
 *
 * El tercer bloque es el que distingue a este trabajo de un recomendador
 * corriente, y el que se contrasta con el cuestionario de las sesiones.
 *
 * Ejecutar: npm run evaluar --workspace=@foodloop/backend
 */

import "dotenv/config";
import { crearPiscina, aplicarEsquema } from "./repositorios";
import { PESOS, VERSION_MODELO } from "@foodloop/dominio";

const CADENA = process.env.DATABASE_URL
  ?? "postgres://postgres:postgres@localhost:5432/foodloop";

const n = (v: unknown) => Number(v ?? 0);
const pct = (a: number, b: number) => b ? `${(a / b * 100).toFixed(1)} %` : "—";
const fila = (etiqueta: string, valor: string, nota = "") =>
  console.log(`  ${etiqueta.padEnd(38)} ${valor.padStart(10)}   ${nota}`);

async function evaluar() {
  const p = crearPiscina(CADENA);
  await aplicarEsquema(p);

  console.log(`\n  FASE 4 · EVALUACIÓN DEL ARTEFACTO · versión ${VERSION_MODELO}`);
  console.log("  " + "═".repeat(66));

  // ------------------------------------------------------------------
  // 1 · Operación
  // ------------------------------------------------------------------
  const { rows: op } = await p.query(`
    SELECT
      COUNT(*) AS lotes,
      COALESCE(SUM(m.cantidad), 0) AS kg,
      COALESCE(SUM(m.cantidad * i.costo_unitario), 0) AS valor,
      COUNT(*) FILTER (WHERE NOT m.apto_reproceso) AS sin_dictamen
    FROM merma m JOIN ingrediente i ON i.id = m.ingrediente_id`);

  const { rows: apr } = await p.query(`
    SELECT
      COALESCE(SUM(rl.cantidad_usada), 0) AS kg,
      COALESCE(SUM(rl.cantidad_usada * i.costo_unitario), 0) AS valor
    FROM recomendacion_lote rl
    JOIN decision d ON d.recomendacion_id = rl.recomendacion_id
    JOIN merma m ON m.id = rl.merma_id
    JOIN ingrediente i ON i.id = m.ingrediente_id
    WHERE d.accion = 'aprobada'`);

  console.log("\n  1 · OPERACIÓN");
  console.log("  " + "─".repeat(66));
  fila("Lotes registrados", String(n(op[0].lotes)));
  fila("Merma total", `${n(op[0].kg).toFixed(1)} kg`);
  fila("Merma aprovechada", `${n(apr[0].kg).toFixed(1)} kg`,
    pct(n(apr[0].kg), n(op[0].kg)));
  fila("Valor de la merma", `$ ${n(op[0].valor).toFixed(2)}`);
  fila("Costo evitado", `$ ${n(apr[0].valor).toFixed(2)}`,
    pct(n(apr[0].valor), n(op[0].valor)));
  fila("Lotes sin dictamen sanitario", String(n(op[0].sin_dictamen)),
    pct(n(op[0].sin_dictamen), n(op[0].lotes)));

  // ------------------------------------------------------------------
  // 1b · Integración de las tres fuentes (Fase 1)
  // ------------------------------------------------------------------
  const { rows: integ } = await p.query(`
    SELECT
      COUNT(*) AS servicios,
      MIN(fecha) AS desde, MAX(fecha) AS hasta,
      SUM(porciones_producidas) AS porciones,
      ROUND(SUM(kg_producidos), 1) AS kg_prod,
      ROUND(AVG(desvio_pct), 1) AS desvio_medio,
      ROUND(100.0 * SUM(kg_merma) / NULLIF(SUM(kg_producidos), 0), 2) AS merma_pct
    FROM v_operacion_diaria`);

  if (n(integ[0].servicios) > 0) {
    const i0 = integ[0];
    console.log("\n  1b · INTEGRACIÓN DE PRODUCCIÓN, CONSUMO Y RESIDUOS");
    console.log("  " + "─".repeat(66));
    fila("Periodo cubierto", `${String(i0.desde).slice(0, 10)}`,
      `a ${String(i0.hasta).slice(0, 10)}`);
    fila("Servicios registrados", String(n(i0.servicios)));
    fila("Porciones producidas", n(i0.porciones).toLocaleString("es-EC"));
    fila("Peso producido", `${n(i0.kg_prod).toFixed(1)} kg`);
    fila("Desvío medio de comensales", `${n(i0.desvio_medio).toFixed(1)} %`,
      "previstos frente a reales");
    fila("Merma sobre lo producido", `${n(i0.merma_pct).toFixed(2)} %`,
      "indicador normalizado");

    const { rows: rel } = await p.query("SELECT * FROM v_desvio_vs_merma");
    if (rel.length > 1) {
      console.log("\n  Relación entre desvío de comensales y merma");
      console.log("  " + "─".repeat(66));
      console.log(`  ${"Rango de desvío".padEnd(34)} ${"Serv.".padStart(6)} ${"kg".padStart(8)} ${"%".padStart(7)}`);
      for (const r of rel)
        console.log(`  ${String(r.rango_desvio).padEnd(34)} `
          + `${String(n(r.servicios)).padStart(6)} `
          + `${n(r.kg_merma_medio).toFixed(1).padStart(8)} `
          + `${n(r.merma_pct_medio).toFixed(1).padStart(7)}`);
      console.log("\n  Que la merma crezca con el desvío sostiene la hipótesis");
      console.log("  del modelo: se pierde sobre todo por producir para más");
      console.log("  comensales de los que finalmente acuden.");
    }
  }

  // ------------------------------------------------------------------
  // 2 · Modelo
  // ------------------------------------------------------------------
  const { rows: mod } = await p.query(`
    SELECT
      COUNT(*) AS propuestas,
      COUNT(DISTINCT generada_en) AS evaluaciones,
      AVG(aptitud) AS aptitud_media,
      AVG(aptitud) FILTER (WHERE posicion = 1) AS aptitud_primera
    FROM recomendacion`);

  const { rows: multi } = await p.query(`
    SELECT
      COUNT(*) FILTER (WHERE lotes > 1) AS combinadas,
      COUNT(*) AS total,
      AVG(lotes) AS media_lotes
    FROM (
      SELECT recomendacion_id, COUNT(*) AS lotes
      FROM recomendacion_lote GROUP BY recomendacion_id
    ) t`);

  const { rows: dec } = await p.query(`
    SELECT accion::TEXT AS accion, COUNT(*) AS n
    FROM decision GROUP BY accion ORDER BY n DESC`);
  const totalDec = dec.reduce((a, d) => a + n(d.n), 0);
  const aprobadas = n(dec.find((d) => d.accion === "aprobada")?.n);

  console.log("\n  2 · MODELO");
  console.log("  " + "─".repeat(66));
  fila("Evaluaciones realizadas", String(n(mod[0].evaluaciones)));
  fila("Propuestas generadas", String(n(mod[0].propuestas)));
  fila("Aptitud media de la primera", n(mod[0].aptitud_primera).toFixed(1));
  fila("Propuestas multi-lote", String(n(multi[0].combinadas)),
    pct(n(multi[0].combinadas), n(multi[0].total)));
  fila("Lotes por propuesta", n(multi[0].media_lotes).toFixed(2));
  console.log();
  fila("Decisiones registradas", String(totalDec));
  for (const d of dec)
    fila(`  · ${d.accion}`, String(n(d.n)), pct(n(d.n), totalDec));
  fila("Tasa de aceptación", pct(aprobadas, totalDec),
    "indicador de utilidad percibida");

  // Aceptación por receta: el bucle de retroalimentación en acción.
  const { rows: acept } = await p.query(`
    SELECT nombre, n_decisiones, aprobadas, aceptacion_base, aceptacion_efectiva
    FROM v_aceptacion_receta
    WHERE n_decisiones > 0
    ORDER BY n_decisiones DESC LIMIT 6`);

  if (acept.length) {
    console.log("\n  Aceptación recalculada desde las decisiones reales");
    console.log("  " + "─".repeat(66));
    console.log(`  ${"Receta".padEnd(34)} ${"Dec.".padStart(5)} ${"Apr.".padStart(5)} ${"Base".padStart(6)} ${"Efect.".padStart(7)}`);
    for (const a of acept)
      console.log(`  ${String(a.nombre).slice(0, 34).padEnd(34)} `
        + `${String(n(a.n_decisiones)).padStart(5)} `
        + `${String(n(a.aprobadas)).padStart(5)} `
        + `${n(a.aceptacion_base).toFixed(1).padStart(6)} `
        + `${n(a.aceptacion_efectiva).toFixed(1).padStart(7)}`);
    console.log("\n  La columna efectiva es la que usa el modelo. Se calcula con");
    console.log("  encogimiento hacia la base, con un peso previo de 8 casos:");
    console.log("  las primeras decisiones mueven poco la valoración y hace");
    console.log("  falta evidencia acumulada para desplazarla de verdad.");
  }

  // ------------------------------------------------------------------
  // 3 · Explicabilidad
  // ------------------------------------------------------------------
  const { rows: fb } = await p.query(`
    SELECT claridad::TEXT AS claridad, COUNT(*) AS n
    FROM feedback_explicacion GROUP BY claridad`);
  const totalFb = fb.reduce((a, f) => a + n(f.n), 0);
  const claras = n(fb.find((f) => f.claridad === "clara")?.n);

  console.log("\n  3 · EXPLICABILIDAD");
  console.log("  " + "─".repeat(66));
  if (totalFb === 0) {
    console.log("  Todavía no hay valoraciones registradas.");
    console.log("  Se recogen durante las sesiones con usuarios, en la");
    console.log("  pantalla de explicación.");
  } else {
    fila("Valoraciones recogidas", String(totalFb));
    for (const f of fb)
      fila(`  · ${f.claridad}`, String(n(f.n)), pct(n(f.n), totalFb));
    fila("Explicaciones comprendidas", pct(claras, totalFb),
      "comprensión del componente XAI");

    const { rows: porRol } = await p.query(`
      SELECT rol::TEXT AS rol, COUNT(*) AS n,
             COUNT(*) FILTER (WHERE claridad = 'clara') AS claras
      FROM feedback_explicacion GROUP BY rol ORDER BY n DESC`);
    if (porRol.length > 1) {
      console.log("\n  Comprensión por perfil");
      console.log("  " + "─".repeat(66));
      for (const r of porRol)
        fila(`  ${r.rol}`, pct(n(r.claras), n(r.n)), `${n(r.n)} valoraciones`);
      console.log("\n  Una diferencia marcada entre quien decide en cocina y");
      console.log("  quien controla desde escritorio es un hallazgo reportable:");
      console.log("  sugiere que la explicación debería adaptarse al perfil.");
    }
  }

  // ------------------------------------------------------------------
  // Parámetros del artefacto
  // ------------------------------------------------------------------
  console.log("\n  PARÁMETROS DEL MODELO");
  console.log("  " + "─".repeat(66));
  for (const [k, v] of Object.entries(PESOS))
    fila(`  ${k}`, v.toFixed(2));
  console.log("\n  Declarados en el código y auditables. Reportarlos es lo que");
  console.log("  permite que otro investigador reproduzca los resultados.");

  console.log("\n  " + "═".repeat(66) + "\n");
  await p.end();
}

evaluar().catch((e) => {
  console.error("\n  No se pudo evaluar:\n ", e.message, "\n");
  process.exit(1);
});
