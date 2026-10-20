/**
 * FoodLoop · Entrenamiento y evaluación del componente aprendido
 *
 *     npm run ml:entrenar                 (sobre ./datos)
 *     npm run ml:entrenar -- ./otra-carpeta
 *
 * Qué hace, en orden:
 *
 *   1. Construye el conjunto supervisado (ver `conjunto.ts`).
 *   2. Lo parte por FECHA, no al azar: entrena con enero–abril y evalúa
 *      con mayo–junio. Partir al azar mezclaría días futuros en el
 *      entrenamiento y daría cifras que en operación no se repiten.
 *   3. Ajusta la regresión logística sobre el entrenamiento.
 *   4. Compara, sobre el MISMO periodo de prueba, cinco formas de
 *      ordenar las candidatas de cada lote:
 *        · aleatorio                 suelo de referencia
 *        · heurística de popularidad la mejor regla simple sin aprendizaje:
 *                                    echar la merma en lo que más
 *                                    prepara (regla de popularidad)
 *        · modelo 2 · experto        pesos fijos, la versión anterior
 *        · modelo 3 · solo ML        la probabilidad aprendida a secas
 *        · modelo 3 · híbrido        P × valor, la versión desplegada
 *   5. Calcula intervalos de confianza por bootstrap pareado y repite
 *      todo en validación temporal con origen móvil (4 cortes).
 *   6. Escribe los coeficientes en el dominio
 *      (`dominio/src/servicios/motor/modelo-aprendido.ts`) y las
 *      evidencias en `evidencias/ml/`.
 *
 * El modelo que se escribe es EL MISMO que se evaluó (entrenado con
 * enero–abril), de modo que las métricas publicadas corresponden
 * exactamente a los coeficientes que usa la aplicación.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ajustarLogistica, sigmoide, logit, auc, precisionMedia, logLoss, brier,
  resumirOrdenamiento, metricasLista, bootstrapDiferencia, azarSemilla,
  ENTRADAS_APRENDIDAS, etiquetaEntrada, VERSION_MODELO,
} from "@foodloop/dominio";
import type { ItemLista, ResumenOrdenamiento, EntradaAprendida } from "@foodloop/dominio";
import { construirConjunto, porLote, HORIZONTE_DIAS, type Ejemplo } from "./conjunto";

const CORTE = "2026-05-01";
const LAMBDA = 1;
const CORTES_CV = ["2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01"];

const A = 78;
const linea = (c = "─") => console.log("  " + c.repeat(A));
const tit = (s: string) => { console.log(`\n  ${s}`); linea("═"); };
const f3 = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : "—");
const pct = (n: number) => (Number.isFinite(n) ? `${(100 * n).toFixed(1)} %` : "—");

type Puntuador = (e: Ejemplo) => number;
interface Ajuste { intercepto: number; coeficientes: number[]; sinVariacion: number[] }

const matriz = (es: Ejemplo[]) => es.map((e) => ENTRADAS_APRENDIDAS.map((k) => e.x[k]));
const prob = (m: Ajuste) => (e: Ejemplo) =>
  sigmoide(logit(ENTRADAS_APRENDIDAS.map((k) => e.x[k]), m.intercepto, m.coeficientes));

function entrenar(es: Ejemplo[]): Ajuste {
  return ajustarLogistica(matriz(es), es.map((e) => e.y), { lambda: LAMBDA });
}

/** Los cinco ordenamientos que se comparan. */
function puntuadores(m: Ajuste): Record<string, Puntuador> {
  const P = prob(m);
  // El aleatorio usa una semilla por fila (no un estado compartido), de
  // modo que la cifra no depende del orden en que se recorran los lotes.
  const azarFila = (e: Ejemplo) => azarSemilla(
    [...`${e.lote}|${e.receta}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7))();
  return {
    "Aleatorio": azarFila,
    "Heurística de popularidad (sin ML)": (e) => e.x.frecuenciaMenu + 1e-3 * e.x.recenciaMenu,
    "Modelo 2 · experto (v2.1)": (e) => e.valor,
    "Modelo 3 · solo ML (P)": P,
    "Modelo 3 · híbrido P×valor (v3)": (e) => P(e) * e.valor,
  };
}

const listas = (es: Ejemplo[], s: Puntuador): ItemLista[][] =>
  porLote(es).map((g) => g.map((e) => ({
    puntuacion: s(e), relevante: e.y, kg: e.kg, clave: e.receta,
  })));

interface Fila extends ResumenOrdenamiento {
  modelo: string; auc: number; ap: number; logloss?: number; brier?: number;
  /** Proporción de primeras propuestas que son recetas de deshidratado (APR). */
  apr1: number;
}

function evaluarTodos(test: Ejemplo[], m: Ajuste): Fila[] {
  const ys = test.map((e) => e.y);
  const P = prob(m);
  return Object.entries(puntuadores(m)).map(([modelo, s]) => {
    const sc = test.map(s);
    const ls = listas(test, s);
    const primeras = porLote(test).map((g) =>
      [...g].sort((a, b) => s(b) - s(a) || a.receta.localeCompare(b.receta))[0]);
    const fila: Fila = {
      modelo, ...resumirOrdenamiento(ls),
      auc: auc(sc, ys), ap: precisionMedia(sc, ys),
      apr1: primeras.filter((e) => e.receta.startsWith("APR")).length / primeras.length,
    };
    if (modelo.includes("solo ML")) {
      const ps = test.map(P);
      fila.logloss = logLoss(ps, ys);
      fila.brier = brier(ps, ys);
    }
    return fila;
  });
}

function imprimirTabla(filas: Fila[]) {
  console.log("  " + "Modelo".padEnd(36) + ["HR@1", "HR@3", "P@3", "NDCG@3", "MRR", "MAP", "AUC"]
    .map((h) => h.padStart(8)).join("") + "kg ejec.".padStart(10));
  linea();
  for (const r of filas)
    console.log("  " + r.modelo.slice(0, 35).padEnd(36)
      + [r.hr1, r.hr3, r.p3, r.ndcg3, r.mrr, r.map, r.auc].map((v) => f3(v).padStart(8)).join("")
      + r.kgEjecutables.toFixed(1).padStart(10));
}

/** Métrica por lote, para el bootstrap pareado. */
function porLoteMetrica(test: Ejemplo[], s: Puntuador, k: "hr3" | "ndcg3" | "hr1") {
  return porLote(test).map((g) => metricasLista(g.map((e) => ({
    puntuacion: s(e), relevante: e.y, kg: e.kg, clave: e.receta,
  })))).filter((m): m is Extract<typeof m, { hr1: number }> => "hr1" in m).map((m) => m[k]);
}

const csv = (filas: Record<string, unknown>[]) => {
  const cab = Object.keys(filas[0]);
  return [cab.join(","), ...filas.map((f) => cab.map((c) => {
    const v = f[c];
    return typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(6))
      : `"${String(v ?? "").replace(/"/g, '""')}"`;
  }).join(","))].join("\n") + "\n";
};

async function principal() {
  const carpeta = process.argv[2] ?? "./datos";
  const salida = path.resolve("evidencias/ml");
  fs.mkdirSync(salida, { recursive: true });

  const t0 = Date.now();
  const C = await construirConjunto(carpeta);
  const es = C.ejemplos;
  const train = es.filter((e) => e.fecha < CORTE);
  const test = es.filter((e) => e.fecha >= CORTE);
  const rango = (xs: Ejemplo[]) => ({
    desde: xs.reduce((a, e) => (e.fecha < a ? e.fecha : a), "9999"),
    hasta: xs.reduce((a, e) => (e.fecha > a ? e.fecha : a), ""),
  });

  tit("FOODLOOP · COMPONENTE DE APRENDIZAJE AUTOMÁTICO");
  console.log(`  Variable objetivo: la receta se produjo el día del lote o en los`);
  console.log(`  ${HORIZONTE_DIAS} siguientes (≤ 48 h). Cada lote, evaluado en su registro + 2 h.`);
  console.log();
  const lotesTr = new Set(train.map((e) => e.lote)).size;
  const lotesTe = new Set(test.map((e) => e.lote)).size;
  console.log(`  Ejemplos (lote × receta admisible)   ${String(es.length).padStart(7)}   de ${C.lotes.length} lotes`);
  console.log(`  Entrenamiento ${rango(train).desde} a ${rango(train).hasta}   ${String(train.length).padStart(7)}   ${lotesTr} lotes · ${pct(train.filter((e) => e.y).length / train.length)} positivos`);
  console.log(`  Prueba        ${rango(test).desde} a ${rango(test).hasta}   ${String(test.length).padStart(7)}   ${lotesTe} lotes · ${pct(test.filter((e) => e.y).length / test.length)} positivos`);

  // --- ajuste ---------------------------------------------------------
  const ajuste = ajustarLogistica(matriz(train), train.map((e) => e.y), { lambda: LAMBDA });
  tit("COEFICIENTES APRENDIDOS · regresión logística L2 (λ = 1), IRLS");
  console.log(`  Convergió en ${ajuste.iteraciones} iteraciones · log-loss de entrenamiento ${f3(ajuste.perdida)}`);
  console.log(`  ${"intercepto".padEnd(48)}${ajuste.intercepto.toFixed(3).padStart(9)}`);
  ENTRADAS_APRENDIDAS.forEach((k, j) => {
    const sv = ajuste.sinVariacion.includes(j);
    console.log(`  ${etiquetaEntrada(k).etiqueta.slice(0, 47).padEnd(48)}${ajuste.coeficientes[j].toFixed(3).padStart(9)}`
      + (sv ? "   sin variación en los datos: no estimable" : ""));
  });

  // --- comparación en prueba -----------------------------------------
  const filas = evaluarTodos(test, ajuste);
  tit(`COMPARACIÓN EN PRUEBA · ${rango(test).desde} a ${rango(test).hasta} · ${lotesTe} lotes`);
  imprimirTabla(filas);
  console.log();
  console.log(`  Lotes con al menos una receta ejecutable: ${filas[0].listasEvaluables} de ${filas[0].listas}.`);
  console.log("  HR, P, NDCG, MRR y MAP se promedian sobre esos lotes; «kg ejec.» suma, en");
  console.log("  todos, los kilos de la primera propuesta cuando era ejecutable.");
  const solo = filas.find((f) => f.modelo.includes("solo ML"))!;
  console.log(`\n  Calibración de la probabilidad: log-loss ${f3(solo.logloss!)} · Brier ${f3(solo.brier!)}`);
  const base = test.filter((e) => e.y).length / test.length;
  console.log(`  (un modelo que predijera siempre la tasa base: log-loss ${f3(logLoss(test.map(() => base), test.map((e) => e.y)))} · Brier ${f3(brier(test.map(() => base), test.map((e) => e.y)))})`);

  // --- significación --------------------------------------------------
  const S = puntuadores(ajuste);
  const v2 = S["Modelo 2 · experto (v2.1)"], v3 = S["Modelo 3 · híbrido P×valor (v3)"];
  const man = S["Heurística de popularidad (sin ML)"];
  tit("¿LA MEJORA ES REAL? · bootstrap pareado por lote, 2 000 remuestreos, IC 95 %");
  const sig: Record<string, unknown>[] = [];
  for (const [nombre, a, b] of [
    ["v3 híbrido − v2 experto", v2, v3],
    ["v3 híbrido − popularidad", man, v3],
  ] as const)
    for (const k of ["hr1", "hr3", "ndcg3"] as const) {
      const d = bootstrapDiferencia(porLoteMetrica(test, a, k), porLoteMetrica(test, b, k));
      console.log(`  ${nombre.padEnd(26)} ${k.toUpperCase().padEnd(6)} Δ = ${(d.media >= 0 ? "+" : "") + f3(d.media)}`
        + `   IC 95 % [${f3(d.inf)}, ${f3(d.sup)}]   ${d.inf > 0 ? "significativa" : d.sup < 0 ? "significativa (en contra)" : "no significativa"}`);
      sig.push({ comparacion: nombre, metrica: k, diferencia: d.media, ic_inf: d.inf, ic_sup: d.sup });
    }

  // --- validación temporal con origen móvil ---------------------------
  tit("VALIDACIÓN TEMPORAL · origen móvil, 4 cortes (entrena con lo anterior, prueba un mes)");
  const cv: Record<string, unknown>[] = [];
  for (const c of CORTES_CV) {
    const fin = CORTES_CV[CORTES_CV.indexOf(c) + 1] ?? "2026-07-01";
    const tr = es.filter((e) => e.fecha < c);
    const te = es.filter((e) => e.fecha >= c && e.fecha < fin);
    const m = entrenar(tr);
    for (const r of evaluarTodos(te, m))
      cv.push({ corte: c, modelo: r.modelo, hr1: r.hr1, hr3: r.hr3, ndcg3: r.ndcg3, map: r.map, auc: r.auc, kg: r.kgEjecutables });
  }
  const modelos = [...new Set(cv.map((r) => r.modelo as string))];
  const ms = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return [m, Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))];
  };
  console.log("  " + "Modelo".padEnd(36) + ["HR@3", "NDCG@3", "AUC", "kg/mes"].map((h) => h.padStart(16)).join(""));
  linea();
  const cvResumen: Record<string, unknown>[] = [];
  for (const mod of modelos) {
    const rs = cv.filter((r) => r.modelo === mod);
    const cols = (["hr3", "ndcg3", "auc", "kg"] as const).map((k) => ms(rs.map((r) => r[k] as number)));
    console.log("  " + mod.slice(0, 35).padEnd(36) + cols.map(([m, s]) =>
      `${m.toFixed(3)} ± ${s.toFixed(3)}`.padStart(16)).join(""));
    cvResumen.push({ modelo: mod, hr3: cols[0][0], hr3_de: cols[0][1], ndcg3: cols[1][0], ndcg3_de: cols[1][1], auc: cols[2][0], auc_de: cols[2][1], kg_mes: cols[3][0], kg_mes_de: cols[3][1] });
  }

  // --- impacto operativo frente al procedimiento actual ---------------
  tit("IMPACTO OPERATIVO EN EL PERIODO DE PRUEBA");
  const lotesPrueba = [...new Set(test.map((e) => e.lote))];
  const kgTotal = lotesPrueba.reduce((a, l) => a + (C.kgLote.get(l) ?? 0), 0);
  const valorTotal = lotesPrueba.reduce((a, l) => a + (C.valorLote.get(l) ?? 0), 0);
  console.log(`  Merma generada en el periodo: ${kgTotal.toFixed(1)} kg · valor $ ${valorTotal.toFixed(2)}`);
  console.log("  Procedimiento actual registrado: ninguna decisión de reaprovechamiento");
  console.log("  ejecutada («No autorizada» en las 1 577 filas) → 0 kg recuperados.\n");
  const impacto: Record<string, unknown>[] = [{ modelo: "Procedimiento actual (registrado)", kg: 0, costo: 0, pctKg: 0 }];
  for (const [mod, s] of Object.entries(S)) {
    let kg = 0, costo = 0;
    for (const g of porLote(test)) {
      const p = [...g].sort((a, b) => s(b) - s(a) || a.receta.localeCompare(b.receta))[0];
      if (p.y) { kg += p.kg; costo += p.costo; }
    }
    impacto.push({ modelo: mod, kg, costo, pctKg: kg / kgTotal });
    console.log(`  ${mod.slice(0, 40).padEnd(41)} ${kg.toFixed(1).padStart(7)} kg   $ ${costo.toFixed(2).padStart(7)}   ${pct(kg / kgTotal).padStart(7)} de la merma`);
  }
  console.log("\n  Kilos y costo de las primeras propuestas que eran ejecutables (receta");
  console.log("  producida en ≤ 48 h). Es una cota conservadora: solo cuenta la primera.");

  // --- escritura -------------------------------------------------------
  const hib = filas.find((f) => f.modelo.includes("híbrido"))!;
  const coef = Object.fromEntries(ENTRADAS_APRENDIDAS.map((k, j) =>
    [k, Math.round(ajuste.coeficientes[j] * 1e6) / 1e6])) as Record<EntradaAprendida, number>;
  const metricas = {
    hr1: hib.hr1, hr3: hib.hr3, p3: hib.p3, ndcg3: hib.ndcg3, mrr: hib.mrr, map: hib.map,
    aucProbabilidad: solo.auc, apProbabilidad: solo.ap,
    logloss: solo.logloss!, brier: solo.brier!, kgEjecutables: hib.kgEjecutables,
  };
  const r4 = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 1e4) / 1e4]));
  const modelo = {
    version: `${VERSION_MODELO}+${new Date().toISOString().slice(0, 10)}`,
    algoritmo: "Regresión logística L2 (IRLS)",
    objetivo: `receta producida en el centro en ≤ ${HORIZONTE_DIAS * 24} h desde el lote`,
    entrenadoEn: new Date().toISOString().slice(0, 10),
    periodoEntrenamiento: rango(train),
    periodoPrueba: rango(test),
    ejemplos: train.length,
    positivos: train.filter((e) => e.y).length,
    lambda: LAMBDA,
    intercepto: Math.round(ajuste.intercepto * 1e6) / 1e6,
    coeficientes: coef,
    sinVariacion: ajuste.sinVariacion.map((j) => ENTRADAS_APRENDIDAS[j]),
    metricasPrueba: r4(metricas),
  };
  const destino = path.resolve("dominio/src/servicios/motor/modelo-aprendido.ts");
  fs.writeFileSync(destino, `/**
 * FoodLoop · Modelo aprendido
 *
 * ARCHIVO GENERADO por \`npm run ml:entrenar\`. No editar a mano: se
 * reescribe en cada entrenamiento con los coeficientes estimados y las
 * métricas sobre el periodo de prueba, que el modelo no vio.
 *
 * Coeficientes en log-odds por unidad de cada entrada (todas en [0,1]).
 * Positivo: acerca la propuesta a lo que la cocina ejecuta. Negativo:
 * la aleja. Un coeficiente en cero con la entrada en \`sinVariacion\`
 * significa que los datos no permiten estimarlo, no que no importe.
 */
import type { ModeloAprendido } from "./pesos";

export const MODELO_APRENDIDO: ModeloAprendido = ${JSON.stringify(modelo, null, 2)};
`);

  fs.writeFileSync(path.join(salida, "dataset.csv"), csv(es.map((e) => ({
    lote: e.lote, fecha: e.fecha, particion: e.fecha < CORTE ? "entrenamiento" : "prueba",
    ingrediente: e.ingrediente, receta: e.receta,
    ...e.x, valor: e.valor, kg: e.kg, costo: e.costo, y: e.y,
  }))));
  fs.writeFileSync(path.join(salida, "comparacion.csv"), csv(filas.map((f) => ({
    modelo: f.modelo, hr1: f.hr1, hr3: f.hr3, p3: f.p3, ndcg3: f.ndcg3, mrr: f.mrr, map: f.map,
    auc: f.auc, ap: f.ap, kg_ejecutables: f.kgEjecutables, primeras_apr: f.apr1,
  }))));
  fs.writeFileSync(path.join(salida, "validacion-temporal.csv"), csv(cv));
  fs.writeFileSync(path.join(salida, "validacion-temporal-resumen.csv"), csv(cvResumen));
  fs.writeFileSync(path.join(salida, "significacion.csv"), csv(sig));
  fs.writeFileSync(path.join(salida, "impacto.csv"), csv(impacto));
  fs.writeFileSync(path.join(salida, "coeficientes.csv"), csv([
    { entrada: "intercepto", etiqueta: "intercepto", coeficiente: ajuste.intercepto },
    ...ENTRADAS_APRENDIDAS.map((k, j) => ({ entrada: k, etiqueta: etiquetaEntrada(k).etiqueta, coeficiente: ajuste.coeficientes[j] })),
  ]));
  fs.writeFileSync(path.join(salida, "resumen.json"), JSON.stringify({
    modelo, conjunto: { ejemplos: es.length, lotes: C.lotes.length, entrenamiento: train.length, prueba: test.length, lotesEntrenamiento: lotesTr, lotesPrueba: lotesTe, positivosPrueba: test.filter((e) => e.y).length },
    comparacion: filas, validacionTemporal: cvResumen, significacion: sig, impacto,
    calibracionBase: { logloss: logLoss(test.map(() => base), test.map((e) => e.y)), brier: brier(test.map(() => base), test.map((e) => e.y)) },
  }, null, 2));

  tit("ESCRITO");
  console.log(`  ${path.relative(process.cwd(), destino)}   coeficientes que usa la aplicación`);
  console.log(`  evidencias/ml/                                  dataset, comparación, validación, impacto`);
  console.log(`\n  ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
}

principal().catch((e) => { console.error(e); process.exit(1); });
