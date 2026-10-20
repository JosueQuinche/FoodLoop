/**
 * FoodLoop · Fase 2 · Evaluación del modelo sobre los registros del
 * centro de producción.
 *
 *     npx tsx herramientas/evaluar-historico.ts ./datos
 *
 * POR QUÉ NO SIRVE `npm run fase2` PARA ESTO
 *
 * Las fases evalúan con el reloj del momento en que se ejecutan. Sobre
 * un conjunto histórico eso no funciona: los lotes del centro van de
 * enero a junio de 2026, de modo que hoy están todos vencidos y la
 * regla R2 los descartaría sin excepción. El resultado sería «ninguna
 * recomendación para 1577 lotes», que es cierto y no dice nada.
 *
 * Cada lote se evalúa aquí en SU PROPIO momento: dos horas después de
 * registrarse, que es cuando la cocina decidiría qué hacer con él. El
 * motor ya admitía esto sin cambios porque el instante de evaluación
 * entra por la etapa 1 como argumento en lugar de leerse del reloj.
 *
 * LOS DOS MODOS
 *
 * El conjunto del centro no trae dictamen sanitario ni temperatura
 * medidos, y las dos cosas son reglas duras del modelo. Se evalúa dos
 * veces:
 *
 *   operación   las seis reglas bloquean. Responde qué se podía
 *               ejecutar con lo que está documentado.
 *   potencial   R1 y R4 quedan aplazadas. Responde qué se habría podido
 *               aprovechar y qué faltó medir para autorizarlo.
 *
 * La diferencia entre las dos cifras es, exactamente, el costo de no
 * haber medido.
 */
import { baseEnMemoria } from "./db-memoria.mjs";
import { importar } from "../backend/src/infraestructura/adaptadores/salida/mongo/importar";
import {
  LotesMongo, CatalogoMongo, CargasMongo,
} from "../backend/src/infraestructura/adaptadores/salida/mongo/repositorios";
import {
  ejecutarModelo, dictamenDe, VERSION_MODELO, REGLAS,
} from "@foodloop/dominio";
import type { Lote, ItemCatalogo, ModoModelo } from "@foodloop/dominio";

const A = 66;
const linea = (c = "─") => console.log("  " + c.repeat(A));
const tit = (s: string) => { console.log(`\n  ${s}`); linea("═"); };
const fila = (k: string, v: string, n = "") =>
  console.log(`  ${k.padEnd(38)}${v.padStart(10)}   ${n}`);

/** Dos horas después de registrarse: cuando la cocina decide. */
const DESFASE_H = 2;

const SIN_RECETA = "ninguna receta del catálogo usa ese ingrediente";

interface Resumen {
  conPropuesta: number;
  kgAprovechables: number;
  costoRecuperable: number;
  valorEnRiesgo: number;
  aptitudes: number[];
  porReglaDecisiva: Map<string, number>;
  recetasUsadas: Map<string, number>;
  noAutorizables: number;
  faltas: Map<string, number>;
  /** Ingredientes de merma que ninguna receta puede usar. */
  sinReceta: Map<string, number>;
}

function vacio(): Resumen {
  return {
    conPropuesta: 0, kgAprovechables: 0, costoRecuperable: 0,
    valorEnRiesgo: 0, aptitudes: [], porReglaDecisiva: new Map(),
    recetasUsadas: new Map(), noAutorizables: 0, faltas: new Map(),
    sinReceta: new Map(),
  };
}

const sube = (m: Map<string, number>, k: string, n = 1) =>
  m.set(k, (m.get(k) ?? 0) + n);

function evaluar(
  lotes: Lote[], catalogo: ItemCatalogo[],
  inventario: Map<number, number>, cargas: Map<number, number>,
  modo: ModoModelo,
): Resumen {
  const r = vacio();
  for (const lote of lotes) {
    const ahora = new Date(lote.registradoEn.getTime() + DESFASE_H * 3_600_000);
    const s = ejecutarModelo(
      [lote], catalogo, inventario, cargas, ahora, { topN: 1, modo });
    const p = s.resultados[0];
    if (!p) {
      // de qué murió: la regla que más recetas descartó para este lote
      const cuenta = new Map<string, number>();
      for (const d of s.traza.descartesDetallados)
        if (d.decisiva && d.decisiva !== "R0") sube(cuenta, d.decisiva);
      const peor = [...cuenta].sort((a, b) => b[1] - a[1])[0];
      if (peor) sube(r.porReglaDecisiva, peor[0]);
      else {
        // Ninguna receta llegó a una regla sanitaria: el catálogo
        // entero se descartó por R0. No es un problema sanitario, es
        // que el recetario no tiene dónde usar ese ingrediente.
        sube(r.porReglaDecisiva, SIN_RECETA);
        sube(r.sinReceta, lote.ingrediente);
      }
      continue;
    }
    r.conPropuesta++;
    r.kgAprovechables += p.kgAprovechados;
    r.costoRecuperable += p.costoRecuperado;
    r.valorEnRiesgo += p.valorEnRiesgo;
    r.aptitudes.push(p.aptitud);
    sube(r.recetasUsadas, `${p.item.codigo} ${p.item.nombre}`);
    if (p.autorizable === false) {
      r.noAutorizables++;
      for (const f of p.faltaMedir ?? [])
        sube(r.faltas, f.replace(/^[^:]+:\s*/, ""));
    }
  }
  return r;
}

const media = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

async function principal() {
  const carpeta = process.argv[2] ?? "./datos";
  const db = baseEnMemoria() as never;
  await importar(carpeta, db);

  const repo = new LotesMongo(db);
  const catalogo = await new CatalogoMongo(db).listarActivos();
  const inventario = await repo.inventarioDisponible();
  const cargas = await new CargasMongo(db).cargasPorArea();
  const lotes = await repo.listarPendientes();

  tit(`FASE 2 · EVALUACIÓN SOBRE LOS REGISTROS DEL CENTRO · modelo ${VERSION_MODELO}`);
  fila("Lotes de merma evaluados", String(lotes.length));
  fila("Recetas en el catálogo", String(catalogo.length));
  fila("Cada lote se evalúa", `+${DESFASE_H} h`, "después de registrarse");

  // ------------------------------------------------------------------
  tit("ESTADO SANITARIO DE LOS LOTES, SEGÚN LO DOCUMENTADO");
  const porDictamen = new Map<string, number>();
  const derivados = new Map<string, number>();
  for (const l of lotes) {
    sube(porDictamen, dictamenDe(l));
    for (const c of l.camposDerivados ?? []) sube(derivados, c);
  }
  for (const [k, n] of [...porDictamen].sort((a, b) => b[1] - a[1]))
    fila(`  ${k}`, String(n), `${(100 * n / lotes.length).toFixed(1)} %`);
  console.log();
  console.log("  Campos que no se midieron y se derivaron de una regla:");
  for (const [k, n] of [...derivados].sort((a, b) => b[1] - a[1]))
    fila(`  ${k}`, String(n), `${(100 * n / lotes.length).toFixed(1)} % de los lotes`);
  console.log();
  console.log("  El libro del centro declara «No evaluado» en el dictamen de las");
  console.log("  1577 filas y «No documentada» en la temperatura. Ninguno de los");
  console.log("  dos valores se inventó: el dictamen se derivó de la condición de");
  console.log("  inocuidad declarada y la temperatura del almacenamiento declarado.");

  // ------------------------------------------------------------------
  const modos: { modo: ModoModelo; titulo: string; nota: string }[] = [
    { modo: "operacion", titulo: "MODO OPERACIÓN · las seis reglas bloquean",
      nota: "Qué se podía ejecutar con lo que está documentado." },
    { modo: "potencial", titulo: "MODO POTENCIAL · R1 y R4 aplazadas",
      nota: "Qué se habría podido aprovechar si se hubiera medido." },
  ];
  const res: Record<string, Resumen> = {};

  for (const { modo, titulo, nota } of modos) {
    const r = evaluar(lotes, catalogo, inventario, cargas, modo);
    res[modo] = r;
    tit(titulo);
    console.log(`  ${nota}\n`);
    fila("Lotes con al menos una propuesta", String(r.conPropuesta),
      `${(100 * r.conPropuesta / lotes.length).toFixed(1)} %`);
    fila("Aptitud media de la primera", media(r.aptitudes).toFixed(1));
    fila("Merma aprovechable", `${r.kgAprovechables.toFixed(1)} kg`);
    fila("Costo recuperable", `$ ${r.costoRecuperable.toFixed(2)}`);
    if (r.noAutorizables) {
      fila("Propuestas NO autorizables", String(r.noAutorizables),
        "falta medición");
      console.log("\n  Qué habría que medir para autorizarlas:");
      for (const [k, n] of [...r.faltas].sort((a, b) => b[1] - a[1]))
        fila(`  ${k}`, String(n));
    }
    if (r.porReglaDecisiva.size) {
      console.log("\n  Lotes sin propuesta, por el motivo que más pesó:");
      for (const [k, n] of [...r.porReglaDecisiva].sort((a, b) => b[1] - a[1])) {
        const regla = (REGLAS as Record<string, { titulo: string }>)[k];
        fila(`  ${regla ? `${k} ${regla.titulo}` : k}`, String(n),
          `${(100 * n / lotes.length).toFixed(1)} %`);
      }
    }
    if (r.sinReceta.size) {
      console.log("\n  Productos de merma que el recetario no sabe aprovechar:");
      for (const [k, n] of [...r.sinReceta].sort((a, b) => b[1] - a[1]))
        fila(`  ${k}`, String(n), "lotes");
      console.log("\n  No es una limitación del modelo sino del catálogo: hace");
      console.log("  falta una receta que use ese ingrediente para que haya algo");
      console.log("  que proponer.");
    }
    if (r.recetasUsadas.size) {
      console.log("\n  Recetas más propuestas:");
      for (const [k, n] of [...r.recetasUsadas]
        .sort((a, b) => b[1] - a[1]).slice(0, 8))
        fila(`  ${k.slice(0, 36)}`, String(n));
    }
  }

  // ------------------------------------------------------------------
  tit("EL COSTO DE NO HABER MEDIDO");
  const o = res.operacion, p = res.potencial;
  fila("Lotes con propuesta · operación", String(o.conPropuesta),
    `${(100 * o.conPropuesta / lotes.length).toFixed(1)} %`);
  fila("Lotes con propuesta · potencial", String(p.conPropuesta),
    `${(100 * p.conPropuesta / lotes.length).toFixed(1)} %`);
  fila("Diferencia", String(p.conPropuesta - o.conPropuesta), "lotes");
  console.log();
  fila("Merma aprovechable · operación", `${o.kgAprovechables.toFixed(1)} kg`);
  fila("Merma aprovechable · potencial", `${p.kgAprovechables.toFixed(1)} kg`);
  fila("Diferencia", `${(p.kgAprovechables - o.kgAprovechables).toFixed(1)} kg`);
  console.log();
  fila("Costo recuperable · operación", `$ ${o.costoRecuperable.toFixed(2)}`);
  fila("Costo recuperable · potencial", `$ ${p.costoRecuperable.toFixed(2)}`);
  fila("Diferencia", `$ ${(p.costoRecuperable - o.costoRecuperable).toFixed(2)}`);

  console.log();
  console.log("  La diferencia entre las dos columnas no la produce el modelo:");
  console.log("  la produce la falta de un termómetro y de un registro de");
  console.log("  dictamen. El modelo se niega a autorizar lo que no está medido,");
  console.log("  que es lo que debe hacer; la cifra dice cuánto cuesta eso.");

  // ------------------------------------------------------------------
  tit("QUÉ SE PUEDE AFIRMAR CON ESTA EVALUACIÓN");
  console.log("  Que el modelo recorre los registros del centro, aplica sus seis");
  console.log("  reglas sobre datos que no generó él, y produce propuestas");
  console.log("  trazables lote por lote.");
  console.log();
  console.log("  QUÉ NO");
  linea();
  console.log("  Que estas cifras describan la operación real. El libro declara");
  console.log("  «RECONSTRUCCIÓN_REFERENCIAL» en las 1577 filas de merma, en las");
  console.log("  543 de servicios y en las 758 de producción; solo el recetario y");
<<<<<<< HEAD
  console.log("  el catálogo de ingredientes son documentales. La decisión sobre");
  console.log("  cada lote viene «No autorizada» en las 1577 filas; por eso el");
  console.log("  componente aprendido se entrena con un sustituto —que la receta se");
  console.log("  produjera en ≤ 48 h— y se evalúa aparte: npm run ml:entrenar.");
=======
  console.log("  el catálogo de ingredientes son documentales. Y la variable que");
  console.log("  diría si el modelo acierta —qué hizo la cocina con cada lote—");
  console.log("  viene «No autorizada» en las 1577 filas, de modo que sigue sin");
  console.log("  haber con qué ajustar los pesos ni contra qué comparar.");
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
  console.log();
}

principal().catch((e) => { console.error(e); process.exit(1); });
