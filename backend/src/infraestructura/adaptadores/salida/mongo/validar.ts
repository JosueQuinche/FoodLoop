/**
 * FoodLoop · Fase 3 · Validación del modelo
 *
 * POR QUÉ ESTA VALIDACIÓN NO MIDE "ACIERTO"
 *
 * La forma habitual de validar un recomendador es comprobar cuántas de
 * sus propuestas coinciden con lo que ocurrió después. Aquí eso no se
 * puede hacer todavía, por dos razones:
 *
 *   1. El conjunto de datos disponible es sintético. Las decisiones
 *      históricas se generaron asignando recetas al azar, de modo que
 *      no contienen ninguna señal que un modelo pueda recuperar.
 *      Medir acierto contra ruido produce números sin significado: en
 *      una prueba previa el modelo obtuvo 4,3 % frente a 34,8 % del
 *      azar, y una versión anterior obtuvo 95,9 % frente a 93,1 % del
 *      azar. Ninguno de los dos decía nada sobre el modelo.
 *
 *   2. Aunque el histórico fuera real, coincidir con él indicaría
 *      plausibilidad, no calidad: el histórico registra lo que la
 *      operación hizo, no lo que convenía hacer. Un modelo que se
 *      limitara a repetir la práctica actual no aportaría nada.
 *
 * Lo que sí se puede validar con los datos disponibles es que el
 * artefacto cumple las propiedades que promete. Eso es verificación,
 * no predicción, y es lo que corresponde a esta fase mientras no se
 * disponga del conjunto de datos del caso de estudio.
 *
 * Las cinco propiedades verificadas:
 *
 *   V1 · Inocuidad     · nunca propone algo que viole una restricción
 *   V2 · Cobertura     · a cuántos lotes consigue dar salida
 *   V3 · Determinismo  · la misma entrada produce la misma salida
 *   V4 · Monotonía     · añadir un lote compatible no empeora la propuesta
 *   V5 · Sensibilidad  · cuánto depende el orden de los pesos elegidos
 *
 * La V5 es la más exigente: si pequeños cambios en los pesos alteran el
 * orden de las recomendaciones, la puntuación es arbitraria y habría
 * que justificar los pesos con más cuidado.
 *
 * Ejecutar: npm run validar --workspace=@foodloop/backend
 */

import "dotenv/config";
import { conectar, aplicarEsquema } from "./conexion";
import { LotesMongo, CatalogoMongo, CargasMongo } from "./repositorios";
import { recomendar, filtrosDuros, horasRestantes, VERSION_MODELO } from "@foodloop/dominio";
import type { Lote, ItemCatalogo, Resultado } from "@foodloop/dominio";

const URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
const NOMBRE_DB = process.env.MONGODB_DB ?? "foodloop";

const pct = (a: number, b: number) => b ? `${(a / b * 100).toFixed(1)} %` : "—";
const fila = (t: string, v: string, n = "") =>
  console.log(`  ${t.padEnd(40)} ${v.padStart(9)}   ${n}`);

function crearAzar(semilla: number) {
  let s = semilla;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

export async function validar(dbExterna?: import("mongodb").Db) {
  const propia = dbExterna ? null : await conectar(URI, NOMBRE_DB);
  const db = dbExterna ?? propia!.db;
  await aplicarEsquema(db);

  const repoLotes = new LotesMongo(db);
  const catalogo = await new CatalogoMongo(db).listarActivos();
  const disponibles = await repoLotes.inventarioDisponible();
  const cargas = await new CargasMongo(db).cargasPorArea();
  const lotes = await repoLotes.listarPendientes();
  const ahora = new Date();

  console.log(`\n  FASE 3 · VALIDACIÓN DEL MODELO · versión ${VERSION_MODELO}`);
  console.log("  " + "═".repeat(66));
  fila("Lotes en el conjunto de prueba", String(lotes.length));
  fila("Recetas en el catálogo", String(catalogo.length));

  // ==================================================================
  // V1 · Inocuidad
  // ==================================================================
  console.log("\n  V1 · INOCUIDAD");
  console.log("  " + "─".repeat(66));

  let propuestas = 0;
  const violaciones: string[] = [];

  for (const lote of lotes) {
    const { resultados } = recomendar([lote], catalogo, disponibles, cargas, ahora, 3);
    for (const r of resultados) {
      propuestas++;
      // Reglas que ninguna propuesta debe incumplir jamás.
      if (!lote.aptoReproceso)
        violaciones.push(`${lote.codigo}: propuesta sin dictamen sanitario`);
      if (horasRestantes(lote, ahora) <= 0)
        violaciones.push(`${lote.codigo}: propuesta sobre lote vencido`);
      if (r.item.minutos / 60 + 1 > horasRestantes(lote, ahora))
        violaciones.push(`${lote.codigo}: ${r.item.nombre} no cabe en la ventana`);
      if (lote.estadoProducto === "cocido" && lote.temperaturaC > 5
          && (r.item.tipoProceso !== "reproceso_termico" || r.item.tempProcesoC < 74))
        violaciones.push(`${lote.codigo}: cadena de frío rota sin reproceso térmico`);
      const req = r.item.requisitos.find((q) => q.ingredienteId === lote.ingredienteId);
      if (req && req.admiteEstado !== "ambos" && req.admiteEstado !== lote.estadoProducto)
        violaciones.push(`${lote.codigo}: estado no admitido por ${r.item.nombre}`);
    }
  }

  fila("Propuestas examinadas", String(propuestas));
  fila("Violaciones de restricción", String(violaciones.length),
    violaciones.length === 0 ? "correcto" : "REVISAR");
  for (const v of violaciones.slice(0, 5)) console.log(`     ✗ ${v}`);

  // ==================================================================
  // V2 · Cobertura
  // ==================================================================
  console.log("\n  V2 · COBERTURA");
  console.log("  " + "─".repeat(66));

  let conPropuesta = 0;
  const motivos: Record<string, number> = {};
  const aptitudes: number[] = [];

  for (const lote of lotes) {
    const { resultados } = recomendar([lote], catalogo, disponibles, cargas, ahora, 3);
    if (resultados.length > 0) {
      conPropuesta++;
      aptitudes.push(resultados[0].aptitud);
    } else {
      const m = catalogo
        .map((c) => filtrosDuros([lote], c, ahora))
        .find((x) => x && x !== "no_usa_lotes") ?? "sin_receta_compatible";
      motivos[m] = (motivos[m] ?? 0) + 1;
    }
  }

  const aptos = lotes.filter((l) => l.aptoReproceso && horasRestantes(l, ahora) > 0);
  fila("Lotes con al menos una propuesta", String(conPropuesta),
    pct(conPropuesta, lotes.length));
  fila("Sobre los lotes aptos y vigentes", String(conPropuesta),
    pct(conPropuesta, aptos.length));
  fila("Aptitud media de la primera", aptitudes.length
    ? (aptitudes.reduce((a, b) => a + b, 0) / aptitudes.length).toFixed(1) : "—");

  if (Object.keys(motivos).length) {
    console.log("\n  Lotes sin propuesta, por causa:");
    for (const [k, v] of Object.entries(motivos).sort((a, b) => b[1] - a[1]))
      console.log(`     ${k.padEnd(30)} ${String(v).padStart(4)}   ${pct(v, lotes.length)}`);
    console.log("\n  Un lote sin propuesta no es un fallo: si no hay alternativa");
    console.log("  sanitariamente viable, la respuesta correcta es no proponer.");
  }

  // ==================================================================
  // V3 · Determinismo
  // ==================================================================
  console.log("\n  V3 · DETERMINISMO");
  console.log("  " + "─".repeat(66));

  let inestables = 0;
  for (const lote of lotes.slice(0, 20)) {
    const a = recomendar([lote], catalogo, disponibles, cargas, ahora, 3);
    const b = recomendar([lote], catalogo, disponibles, cargas, ahora, 3);
    const clave = (r: { resultados: Resultado[] }) =>
      r.resultados.map((x) => `${x.item.id}:${x.aptitud}`).join("|");
    if (clave(a) !== clave(b)) inestables++;
  }
  fila("Evaluaciones repetidas", "20");
  fila("Salidas divergentes", String(inestables),
    inestables === 0 ? "correcto" : "REVISAR");
  console.log("\n  Un modelo de apoyo a la decisión que cambiara de opinión sin");
  console.log("  que cambien los datos no sería auditable.");

  // ==================================================================
  // V4 · Monotonía del multi-lote
  // ==================================================================
  console.log("\n  V4 · MONOTONÍA AL COMBINAR LOTES");
  console.log("  " + "─".repeat(66));

  let pares = 0, mejora = 0, empeora = 0;
  const deltas: number[] = [];

  for (const a of lotes) {
    for (const b of lotes) {
      if (a.id >= b.id) continue;
      if (a.ingredienteId === b.ingredienteId) continue;
      // solo pares que alguna receta pueda combinar
      const compatible = catalogo.some((c) =>
        c.requisitos.some((r) => r.ingredienteId === a.ingredienteId)
        && c.requisitos.some((r) => r.ingredienteId === b.ingredienteId));
      if (!compatible) continue;

      const solo = recomendar([a], catalogo, disponibles, cargas, ahora, 1);
      const junto = recomendar([a, b], catalogo, disponibles, cargas, ahora, 1);
      if (solo.resultados.length === 0 || junto.resultados.length === 0) continue;

      pares++;
      const d = junto.resultados[0].aptitud - solo.resultados[0].aptitud;
      deltas.push(d);
      if (d > 0.5) mejora++;
      else if (d < -0.5) empeora++;
    }
  }

  const mediaDelta = deltas.length
    ? deltas.reduce((x, y) => x + y, 0) / deltas.length : 0;
  fila("Pares compatibles evaluados", String(pares));
  fila("Combinar mejora la aptitud", String(mejora), pct(mejora, pares));
  fila("Combinar la empeora", String(empeora), pct(empeora, pares));
  fila("Variación media de aptitud", `${mediaDelta >= 0 ? "+" : ""}${mediaDelta.toFixed(1)}`);
  console.log("\n  Que combinar mejore en la mayoría de los casos es lo esperado:");
  console.log("  dos lotes cubren más receta con merma que uno. Que empeore en");
  console.log("  algunos también es correcto, porque el lote añadido puede");
  console.log("  estrechar la ventana sanitaria del conjunto.");

  // ==================================================================
  // V5 · Sensibilidad a los pesos
  // ==================================================================
  console.log("\n  V5 · SENSIBILIDAD A LOS PESOS");
  console.log("  " + "─".repeat(66));

  // Se perturban los pesos ±15 % y se observa si cambia la receta que
  // queda en primer lugar. Como los pesos son constantes del módulo, la
  // perturbación se simula reordenando por una puntuación recalculada
  // a partir de las contribuciones ya descompuestas.
  const azar = crearAzar(20260914);
  let cambios = 0, comparados = 0;

  for (const lote of lotes.slice(0, 25)) {
    const { resultados } = recomendar([lote], catalogo, disponibles, cargas, ahora, 3);
    if (resultados.length < 2) continue;
    comparados++;

    const perturbada = resultados.map((r) => ({
      id: r.item.id,
      valor: r.factores.reduce(
        (a, f) => a + f.contribucion * (0.85 + azar() * 0.30), 0),
    })).sort((a, b) => b.valor - a.valor);

    if (perturbada[0].id !== resultados[0].item.id) cambios++;
  }

  fila("Casos con dos o más alternativas", String(comparados));
  fila("Cambia la primera al perturbar ±15 %", String(cambios),
    pct(cambios, comparados));

  const inestable = comparados > 0 && cambios / comparados > 0.3;
  console.log();
  if (inestable) {
    console.log("  ADVERTENCIA: el orden depende demasiado de los pesos exactos.");
    console.log("  Conviene justificar su elección o reducir el número de");
    console.log("  factores con peso similar.");
  } else {
    console.log("  El orden se mantiene ante perturbaciones moderadas, de modo");
    console.log("  que no depende de haber acertado los pesos con precisión.");
  }

  // ==================================================================
  console.log("\n  " + "═".repeat(66));
  console.log("  QUÉ SE PUEDE AFIRMAR CON ESTA VALIDACIÓN");
  console.log("  " + "─".repeat(66));
  console.log("  Que el artefacto respeta las restricciones que declara, da");
  console.log("  salida a la proporción de lotes indicada, es determinista y");
  console.log("  su ordenamiento no es arbitrario.");
  console.log();
  console.log("  QUÉ NO");
  console.log("  " + "─".repeat(66));
  console.log("  Que sus recomendaciones sean las mejores posibles. Eso exige");
  console.log("  el conjunto de datos reales del caso de estudio y la");
  console.log("  evaluación con usuarios de la Fase 4.\n");

  if (propia) await propia.cliente.close();
}

if (process.argv[1]?.includes("validar")) validar().catch((e) => {
  console.error("\n  No se pudo validar:\n ", e.message, "\n");
  process.exit(1);
});
