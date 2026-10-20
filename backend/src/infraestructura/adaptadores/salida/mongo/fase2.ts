/**
 * FoodLoop · Fase 2 · Evaluación del modelo construido
 *
 * Una vez preparados los datos y construido el modelo, esta evaluación
 * comprueba que el modelo se comporta como declara. Verifica cinco
 * propiedades sobre el conjunto cargado.
 *
 * POR QUÉ NO SE MIDE "ACIERTO" CONTRA EL HISTÓRICO
 *
 * La forma habitual de validar un recomendador es comprobar cuántas de
 * sus propuestas coinciden con lo que ocurrió después. Aquí eso no se
 * puede hacer todavía, por dos razones:
 *
 *   1. La hoja de decisiones del centro trae ESTADO_EJECUCION = "No
 *      autorizada" en las 1577 filas. No hay variable objetivo: no se
 *      sabe qué hizo la cocina con ningún lote, de modo que no hay nada
 *      contra lo que comparar. Con el conjunto de ejemplo el problema es
 *      el contrario y el mismo: las decisiones se generan al azar, así
 *      que medir acierto contra ruido produce números sin significado.
 *
 *   2. Aunque el histórico fuera real, coincidir con él indicaría
 *      plausibilidad, no calidad: el histórico registra lo que la
 *      operación hizo, no lo que convenía hacer. Un modelo que se
 *      limitara a repetir la práctica actual no aportaría nada.
 *
 * Lo que sí se puede validar con los datos disponibles es que el
 * artefacto cumple las propiedades que promete. Eso es verificación,
 * no predicción, y es lo que corresponde a esta fase mientras no se
 * disponga de la variable objetivo.
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
 * que justificar los pesos con más cuidado. Se mide volviendo a ejecutar
 * el modelo con los pesos perturbados —no reordenando las
 * contribuciones ya calculadas, que es una aproximación más débil—
 * porque la etapa 4 recibe el vector de pesos como argumento.
 *
 * Ejecutar:  npm run fase2                        (contra MongoDB)
 *            npm run fases -- fase2 --datos=./datos   (en memoria)
 */

import "dotenv/config";
import { conectar, aplicarEsquema, ejecutadoDirectamente } from "./conexion";
import { LotesMongo, CatalogoMongo, CargasMongo } from "./repositorios";
import {
  ejecutarModelo, aplicarRestricciones, horasRestantes,
  VERSION_MODELO, PESOS, CARACTERISTICAS, REGLAS,
} from "@foodloop/dominio";
import type {
  Lote, ItemCatalogo, Resultado, VectorPesos, ModoModelo,
} from "@foodloop/dominio";
import {
  Registro, relojDe, relojGeneral, describirReloj, esHistorico, pct, crearAzar,
  type OpcionesFase,
} from "./fases-comun";

const URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
const NOMBRE_DB = process.env.MONGODB_DB ?? "foodloop";

/** Tope de pares en V4. Con 1577 lotes los pares son 1,2 millones. */
const MAX_PARES = 400;
/** Tope de casos en V3 y V5, que repiten la evaluación muchas veces. */
const MAX_CASOS = 40;
/** Perturbaciones por caso en V5. */
const PERTURBACIONES = 20;

export async function fase2(
  dbExterna?: import("mongodb").Db,
  opciones: OpcionesFase = {},
) {
  const propia = dbExterna ? null : await conectar(URI, NOMBRE_DB);
  const db = dbExterna ?? propia!.db;
  await aplicarEsquema(db);

  const reg = opciones.registro ?? new Registro();
  const modo: ModoModelo = opciones.modo ?? "operacion";

  const repoLotes = new LotesMongo(db);
  const catalogo = await new CatalogoMongo(db).listarActivos();
  const disponibles = await repoLotes.inventarioDisponible();
  const cargas = await new CargasMongo(db).cargasPorArea();
  const lotes = await repoLotes.listarPendientes();

  const correr = (
    ls: Lote[], ahora: Date, topN = 3, pesos: VectorPesos = PESOS,
    m: ModoModelo = modo,
  ) => ejecutarModelo(ls, catalogo, disponibles, cargas, ahora, { topN, pesos, modo: m });

  reg.contexto.fase = "fase2";
  reg.contexto.version = VERSION_MODELO;
  reg.contexto.lotes = lotes.length;
  reg.contexto.recetas = catalogo.length;
  reg.contexto.reloj = describirReloj(opciones);
  reg.contexto.modo = modo;

  reg.linea(`\n  FASE 2 · EVALUACIÓN DEL MODELO · versión ${VERSION_MODELO}`);
  reg.linea("  " + "═".repeat(66));
  reg.fila("Lotes en el conjunto", String(lotes.length), "", "lotes");
  reg.fila("Recetas en el catálogo", String(catalogo.length), "", "recetas");
  reg.fila("Instante de evaluación", "", describirReloj(opciones));
  reg.fila("Modo", "", modo === "potencial"
    ? "potencial · R1 y R4 aplazadas" : "operación · las seis reglas");

  // Un conjunto histórico evaluado con el reloj del sistema da cero en
  // todo. Avisarlo evita que una tabla de ceros se lea como un fallo.
  if (esHistorico(lotes) && !(opciones.reloj)) {
    reg.linea();
    reg.linea("  AVISO: todos los lotes del conjunto están vencidos frente al");
    reg.linea("  reloj del sistema, de modo que las métricas saldrán en cero.");
    reg.linea("  Para evaluar un conjunto histórico hay que situarse en su");
    reg.linea("  periodo: --reloj=porLote sitúa cada lote en su registro + 2 h.");
  }

  // ==================================================================
  // V1 · Inocuidad
  // ==================================================================
  reg.titulo("V1 · INOCUIDAD");

  let propuestas = 0;
  const violaciones: string[] = [];

  for (const lote of lotes) {
    const ahora = relojDe(lote, opciones);
    const { resultados } = correr([lote], ahora);
    for (const r of resultados) {
      propuestas++;
      // Se vuelve a aplicar el bloque de restricciones sobre la propuesta
      // ya emitida. Si la etapa 2 hizo su trabajo, no puede incumplir
      // ninguna; que la comprobación sea independiente del camino que la
      // produjo es justamente lo que la hace valer como verificación.
      const v = aplicarRestricciones([lote], r.item, ahora, []);
      if (!v.admisible)
        for (const inc of v.incumplimientos)
          violaciones.push(
            `${lote.codigo} · ${r.item.nombre}: ${inc.regla} ${REGLAS[inc.regla].titulo}`
            + ` (${inc.observado})`);
    }
  }

  reg.fila("Propuestas examinadas", String(propuestas), "", "v1_propuestas");
  reg.fila("Violaciones de restricción", String(violaciones.length),
    violaciones.length === 0 ? "correcto" : "REVISAR", "v1_violaciones");
  for (const v of violaciones.slice(0, 5)) reg.linea(`     ✗ ${v}`);
  reg.linea();
  reg.linea("  La comprobación re-aplica las seis reglas sobre cada propuesta");
  reg.linea("  ya emitida, por un camino distinto del que la generó.");

  // ==================================================================
  // V2 · Cobertura
  // ==================================================================
  reg.titulo("V2 · COBERTURA");

  const cobertura = (m: ModoModelo) => {
    let con = 0;
    const motivos: Record<string, number> = {};
    const aptitudes: number[] = [];
    const recetasUsadas = new Map<string, number>();
    for (const lote of lotes) {
      const ahora = relojDe(lote, opciones);
      const { resultados } = correr([lote], ahora, 3, PESOS, m);
      if (resultados.length > 0) {
        con++;
        aptitudes.push(resultados[0].aptitud);
        const n = resultados[0].item.nombre;
        recetasUsadas.set(n, (recetasUsadas.get(n) ?? 0) + 1);
      } else {
        // Se busca la regla que decidió el descarte, ignorando R0: que
        // una receta no use el ingrediente no explica nada, porque la
        // mayoría del catálogo no lo usa. Lo que informa es la primera
        // regla sanitaria que bloqueó una receta que sí lo usaba.
        const aplazar = m === "potencial" ? (["R1", "R4"] as const) : ([] as const);
        let d = "sin_receta_compatible";
        for (const c of catalogo) {
          const v = aplicarRestricciones([lote], c, ahora, [...aplazar]);
          if (!v.admisible && v.decisiva && v.decisiva !== "R0") { d = v.decisiva; break; }
        }
        motivos[d] = (motivos[d] ?? 0) + 1;
      }
    }
    return { con, motivos, aptitudes, recetasUsadas };
  };

  const op = cobertura(modo);
  reg.fila("Lotes con al menos una propuesta", String(op.con),
    pct(op.con, lotes.length), "v2_cobertura_lotes");
  reg.fila("Aptitud media de la primera", op.aptitudes.length
    ? (op.aptitudes.reduce((a, b) => a + b, 0) / op.aptitudes.length).toFixed(1)
    : "—", "", "v2_aptitud_media");
  reg.fila("Recetas distintas propuestas", String(op.recetasUsadas.size),
    pct(op.recetasUsadas.size, catalogo.length), "v2_variedad_recetas");

  if (Object.keys(op.motivos).length) {
    reg.linea("\n  Lotes sin propuesta, por regla decisiva:");
    for (const [k, v] of Object.entries(op.motivos).sort((a, b) => b[1] - a[1])) {
      const t = (REGLAS as Record<string, { titulo: string }>)[k]?.titulo ?? k;
      reg.linea(`     ${(`${k} ${t}`).slice(0, 44).padEnd(44)} ${String(v).padStart(5)}   ${pct(v, lotes.length)}`);
    }
    reg.linea("\n  Un lote sin propuesta no es un fallo: si no hay alternativa");
    reg.linea("  sanitariamente viable, la respuesta correcta es no proponer.");
  }

  // Si el modo es operación y el conjunto trae campos sin medir, el
  // contraste con el potencial es el dato que importa: separa lo que el
  // modelo no puede resolver de lo que el centro no midió.
  if (modo === "operacion") {
    const pot = cobertura("potencial");
    if (pot.con > op.con) {
      reg.linea("\n  Contraste con el modo potencial (R1 y R4 aplazadas):");
      reg.fila("  Lotes con propuesta · potencial", String(pot.con),
        pct(pot.con, lotes.length), "v2_cobertura_potencial");
      reg.fila("  Diferencia atribuible a no medir", String(pot.con - op.con),
        "lotes", "v2_brecha_medicion");
      reg.linea("\n  Esa diferencia no la produce el modelo: la produce la falta");
      reg.linea("  de dictamen sanitario y de temperatura en el registro.");
    }
  }

  // ==================================================================
  // V3 · Determinismo
  // ==================================================================
  reg.titulo("V3 · DETERMINISMO");

  let inestables = 0, repetidas = 0;
  const clave = (r: { resultados: Resultado[] }) =>
    r.resultados.map((x) => `${x.item.id}:${x.aptitud}`).join("|");
  for (const lote of lotes.slice(0, MAX_CASOS)) {
    const ahora = relojDe(lote, opciones);
    repetidas++;
    if (clave(correr([lote], ahora)) !== clave(correr([lote], ahora))) inestables++;
  }
  reg.fila("Evaluaciones repetidas", String(repetidas), "", "v3_repeticiones");
  reg.fila("Salidas divergentes", String(inestables),
    inestables === 0 ? "correcto" : "REVISAR", "v3_divergentes");
  reg.linea("\n  Un modelo de apoyo a la decisión que cambiara de opinión sin");
  reg.linea("  que cambien los datos no sería auditable.");

  // ==================================================================
  // V4 · Monotonía del multi-lote
  // ==================================================================
  reg.titulo("V4 · MONOTONÍA AL COMBINAR LOTES");

  let pares = 0, mejora = 0, empeora = 0;
  const deltas: number[] = [];

  // Con 1577 lotes los pares son más de un millón. Se recorren en orden
  // y se corta al llegar al tope: el recorrido es determinista, de modo
  // que la muestra es la misma en cada ejecución.
  bucle:
  for (const a of lotes) {
    for (const b of lotes) {
      if (a.id >= b.id) continue;
      if (a.ingredienteId === b.ingredienteId) continue;
      const compatible = catalogo.some((c) =>
        c.requisitos.some((r) => r.ingredienteId === a.ingredienteId)
        && c.requisitos.some((r) => r.ingredienteId === b.ingredienteId));
      if (!compatible) continue;

      // Los dos lotes se evalúan en el instante del más reciente: es el
      // único momento en que ambos existen a la vez.
      const ahora = new Date(Math.max(
        relojDe(a, opciones).getTime(), relojDe(b, opciones).getTime()));
      const solo = correr([a], ahora, 1);
      const junto = correr([a, b], ahora, 1);
      if (solo.resultados.length === 0 || junto.resultados.length === 0) continue;

      pares++;
      const d = junto.resultados[0].aptitud - solo.resultados[0].aptitud;
      deltas.push(d);
      if (d > 0.5) mejora++;
      else if (d < -0.5) empeora++;
      if (pares >= MAX_PARES) break bucle;
    }
  }

  const mediaDelta = deltas.length
    ? deltas.reduce((x, y) => x + y, 0) / deltas.length : 0;
  reg.fila("Pares compatibles evaluados", String(pares), "", "v4_pares");
  reg.fila("Combinar mejora la aptitud", String(mejora), pct(mejora, pares), "v4_mejora");
  reg.fila("Combinar la empeora", String(empeora), pct(empeora, pares), "v4_empeora");
  reg.fila("Variación media de aptitud",
    `${mediaDelta >= 0 ? "+" : ""}${mediaDelta.toFixed(1)}`, "", "v4_delta_medio");
  reg.linea("\n  Que combinar mejore en la mayoría de los casos es lo esperado:");
  reg.linea("  dos lotes cubren más receta con merma que uno. Que empeore en");
  reg.linea("  algunos también es correcto, porque el lote añadido puede");
  reg.linea("  estrechar la ventana sanitaria del conjunto.");

  // ==================================================================
  // V5 · Sensibilidad a los pesos
  // ==================================================================
  reg.titulo("V5 · SENSIBILIDAD A LOS PESOS");

  // Perturbación real: se construye un vector de pesos alterado ±15 % y
  // se vuelve a ejecutar el modelo completo con él. La etapa 4 recibe los
  // pesos como argumento precisamente para que esto sea posible.
  const azar = crearAzar(20260914);
  let cambios = 0, comparados = 0, ensayos = 0;

  for (const lote of lotes.slice(0, MAX_CASOS)) {
    const ahora = relojDe(lote, opciones);
    const base = correr([lote], ahora, 3);
    if (base.resultados.length < 2) continue;
    comparados++;

    for (let i = 0; i < PERTURBACIONES; i++) {
      const perturbados = Object.fromEntries(
        CARACTERISTICAS.map((c) => [c, PESOS[c] * (0.85 + azar() * 0.30)]),
      ) as VectorPesos;
      const alt = correr([lote], ahora, 1, perturbados);
      ensayos++;
      if (alt.resultados.length === 0
          || alt.resultados[0].item.id !== base.resultados[0].item.id) cambios++;
    }
  }

  reg.fila("Casos con dos o más alternativas", String(comparados), "", "v5_casos");
  reg.fila("Perturbaciones ejecutadas", String(ensayos), "±15 % sobre los siete pesos", "v5_ensayos");
  reg.fila("Cambia la primera recomendación", String(cambios),
    pct(cambios, ensayos), "v5_cambios");

  const tasa = ensayos > 0 ? cambios / ensayos : 0;
  reg.linea();
  if (tasa > 0.3) {
    reg.linea("  ADVERTENCIA: el orden depende demasiado de los pesos exactos.");
    reg.linea("  Conviene justificar su elección con datos o reducir el número");
    reg.linea("  de factores con peso similar.");
  } else {
    reg.linea("  El orden se mantiene ante perturbaciones moderadas, de modo");
    reg.linea("  que no depende de haber acertado los pesos con precisión.");
    reg.linea("  Es el argumento que sostiene unos pesos fijados por criterio");
    reg.linea("  experto mientras no exista histórico con que estimarlos.");
  }

  // ==================================================================
  reg.linea("\n  " + "═".repeat(66));
  reg.linea("  QUÉ SE PUEDE AFIRMAR CON ESTA VALIDACIÓN");
  reg.linea("  " + "─".repeat(66));
  reg.linea("  Que el artefacto respeta las restricciones que declara, da");
  reg.linea("  salida a la proporción de lotes indicada, es determinista y");
  reg.linea("  su ordenamiento no es arbitrario.");
  reg.linea();
  reg.linea("  QUÉ NO");
  reg.linea("  " + "─".repeat(66));
  reg.linea("  Que sus recomendaciones sean las mejores posibles. Eso exige la");
  reg.linea("  variable objetivo —qué hizo la cocina con cada lote— que el");
  reg.linea("  conjunto no trae, o la evaluación con expertos de la Fase 4.\n");

  if (propia) await propia.cliente.close();
  return reg;
}

if (ejecutadoDirectamente("mongo/fase2.ts")) fase2().catch((e) => {
  console.error("\n  No se pudo validar:\n ", e.message, "\n");
  process.exit(1);
});
