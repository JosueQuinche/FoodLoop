/**
 * FoodLoop · Fase 3 · Experimentación
 *
 * Ejecuta el prototipo integrado con el modelo y demuestra, sobre un
 * caso concreto, cómo se genera una recomendación y cómo se explica.
 *
 * Tiene dos partes:
 *
 *   A · Pruebas del prototipo integrado. Recorre el flujo completo que
 *       realiza un usuario en las sesiones de validación y comprueba
 *       que cada paso responde: acceso, registro de excedente, consulta
 *       de disponibilidad, recomendación, explicación, receta, decisión
 *       y valoración.
 *
 *   B · Demostración del componente XAI. Toma una recomendación real y
 *       muestra la aritmética completa: qué alternativas se descartaron
 *       y por qué, cómo se compone la puntuación factor a factor, y qué
 *       tendría que cambiar para que la salida fuera otra.
 *
 * La parte B es la que responde a «cómo se explica por qué se genera
 * cada recomendación»: la explicación no se redacta después, se calcula
 * al mismo tiempo que la puntuación.
 *
 * Ejecutar: npm run fase3
 */

import "dotenv/config";
import type { Db } from "mongodb";
import { conectar, aplicarEsquema, ejecutadoDirectamente } from "./conexion";
import {
  Registro, relojDe, relojGeneral, describirReloj, type OpcionesFase,
} from "./fases-comun";
import {
  LotesMongo, CatalogoMongo, CargasMongo, DecisionesMongo,
  TrazasMongo, MaestrosMongo, FeedbackMongo, UsuariosMongo, ConsultasMongo,
} from "./repositorios";
import {
  ObtenerRecomendacionesUC, RegistrarDecisionUC, RegistrarMermaUC,
  ConsultarOperacionUC, RegistrarFeedbackUC, IniciarSesionUC,
  recomendar, filtrosDuros, PESOS, VERSION_MODELO, MODELO_APRENDIDO,
} from "@foodloop/dominio";
import type { Rol, Lote } from "@foodloop/dominio";

const URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
const NOMBRE_DB = process.env.MONGODB_DB ?? "foodloop";

const barra = (v: number, ancho = 26) => {
  const n = Math.max(0, Math.min(ancho, Math.round(Math.abs(v) / 32 * ancho)));
  return (v >= 0 ? "▰" : "▱").repeat(Math.max(1, n));
};

export async function fase3(dbExterna?: Db, opciones: OpcionesFase = {}) {
  const propia = dbExterna ? null : await conectar(URI, NOMBRE_DB);
  const db = dbExterna ?? propia!.db;
  await aplicarEsquema(db);

  const reg = opciones.registro ?? new Registro();
  reg.contexto.fase = "fase3";
  reg.contexto.version = VERSION_MODELO;
  reg.contexto.reloj = describirReloj(opciones);
  const lotes = new LotesMongo(db);
  const catalogo = new CatalogoMongo(db);
  const cargas = new CargasMongo(db);
  const decisiones = new DecisionesMongo(db);
  const trazas = new TrazasMongo(db);
  const maestros = new MaestrosMongo(db);
  const feedback = new FeedbackMongo(db);
  const usuarios = new UsuariosMongo(db);
  const consultas = new ConsultasMongo(db, lotes);

  // El instante de la experimentación. Con un conjunto histórico no
  // puede ser el del sistema: los lotes del centro están vencidos y la
  // demostración del XAI se quedaría sin ninguna propuesta que explicar.
  const todos = await lotes.listarPendientes();
  // El instante se toma del lote APTO más reciente, no del último lote a
  // secas: con los datos del centro la mayoría está pendiente de
  // dictamen, y situarse en un día sin lotes autorizables dejaba la
  // demostración sin ninguna propuesta que explicar.
  const candidatos = todos.filter((l) => l.aptoReproceso);
  const referencia = (candidatos.length ? candidatos : todos)
    .reduce((a, l) => (a && a.registradoEn > l.registradoEn ? a : l), todos[0]);
  const instante = referencia
    ? new Date(referencia.registradoEn.getTime() + 2 * 3_600_000)
    : relojGeneral(todos, opciones);
  const reloj = { ahora: () => new Date(instante) };
  let rolActivo: Rol = "chef";
  let cuentaActiva = { id: "", nombre: "Sesión de experimentación" };
  const sesion = {
    rolActual: () => rolActivo,
    usuarioIdActual: () => cuentaActiva.id,
    usuarioActual: () => cuentaActiva.nombre,
  };

  reg.linea(`\n  FASE 3 · EXPERIMENTACIÓN · modelo ${VERSION_MODELO}`);
  reg.linea(`  Instante de evaluación: ${describirReloj(opciones)}`);
  reg.linea("  " + "═".repeat(72));

  // ==================================================================
  // A · Pruebas del prototipo integrado
  // ==================================================================
  reg.linea("\n  A · PRUEBAS DEL PROTOTIPO INTEGRADO");
  reg.linea("  " + "─".repeat(72));
  reg.linea("  Recorrido equivalente al de las sesiones con usuarios.\n");

  const pruebas: { paso: string; ok: boolean; detalle: string }[] = [];
  const registrar = (paso: string, ok: boolean, detalle: string) => {
    pruebas.push({ paso, ok, detalle });
    reg.linea(`  ${ok ? "✓" : "✗"} ${paso.padEnd(34)} ${detalle}`);
  };

  // 1 · acceso
  let usuario;
  try {
    usuario = await new IniciarSesionUC(usuarios)
      .ejecutar({ correo: "m.calderon@cateringandes.ec", clave: "foodloop2026" });
    rolActivo = usuario.rol;
    cuentaActiva = { id: usuario.id, nombre: usuario.nombre };
    registrar("1. Inicio de sesión", true,
      `${usuario.nombre} · perfil ${usuario.rol}`);
  } catch (e) {
    registrar("1. Inicio de sesión", false, (e as Error).message);
  }

  // 2 · panel
  const operacion = await new ConsultarOperacionUC(lotes, decisiones, reloj).ejecutar();
  registrar("2. Panel de operación", operacion.lotes.length > 0,
    `${operacion.lotes.length} lotes pendientes, ${operacion.kgDisponibles.toFixed(1)} kg disponibles`);

  // 3 · registro de excedente
  const ing = (await maestros.ingredientes())[0];
  let nuevoLote;
  try {
    nuevoLote = await new RegistrarMermaUC(lotes, maestros, reloj).ejecutar({
      ingredienteId: ing.id, areaId: 0, servicioId: 0, cantidad: 4.5,
      estadoProducto: "cocido", temperaturaC: 3.4,
      causa: "sobreproduccion", aptoReproceso: true,
    });
    registrar("3. Registro de excedente", true,
      `${nuevoLote.codigo} · ${nuevoLote.cantidad} ${nuevoLote.unidad} de ${nuevoLote.ingrediente}`);
  } catch (e) {
    registrar("3. Registro de excedente", false, (e as Error).message);
  }

  // 4 · disponibilidad
  const inventario = await consultas.inventario(instante);
  registrar("4. Ingredientes disponibles", inventario.length > 0,
    `${inventario.length} ingredientes; el más urgente vence en `
    + `${inventario[0]?.horasMinimas.toFixed(0) ?? "—"} h`);

  // 5 · recomendaciones sobre un conjunto multi-lote
  // Se recorre el conjunto buscando un lote que, en SU instante, siga
  // vigente. Con la semilla cualquiera sirve; con el histórico hay que
  // buscarlo, y es justo lo que hace que la fase no salga vacía.
  // Vigentes EN EL INSTANTE DE LA FASE, no cada uno en el suyo: la
  // demostración ocurre en un momento concreto y los lotes que se
  // combinan tienen que coexistir en él.
  const vigentes = todos
    .filter((l) => l.aptoReproceso && l.venceEn > instante && l.registradoEn <= instante)
    .slice(0, 120);
  const cat = await catalogo.listarActivos();
  const disp = await lotes.inventarioDisponible(instante);
  const carg = await cargas.cargasPorArea();

  let seleccion: Lote[] = vigentes.slice(0, 1);
  for (const a of vigentes)
    for (const b of vigentes) {
      if (a.id >= b.id || a.ingredienteId === b.ingredienteId) continue;
      const r = recomendar([a, b], cat, disp, carg, instante, 1).resultados[0];
      if (r && r.aportes.length > 1) { seleccion = [a, b]; break; }
    }

  const uc = new ObtenerRecomendacionesUC(lotes, catalogo, cargas, trazas, reloj, 3);
  const salida = await uc.ejecutar(seleccion.map((l) => l.id));
  registrar("5. Recomendaciones", salida.resultados.length > 0,
    `${salida.resultados.length} alternativas para `
    + `${seleccion.length} lote(s); ${salida.descartes.length} descartes`);

  const propuesta = salida.resultados[0];

  // 6 · explicación
  registrar("6. Explicación (XAI)",
    !!propuesta && propuesta.factores.length >= 7,
    propuesta ? `${propuesta.factores.length} factores, `
      + `${propuesta.contrafactuales.length} contrafactuales` : "sin propuesta");

  // 7 · receta con sus ingredientes
  registrar("7. Detalle de receta",
    !!propuesta && propuesta.item.requisitos.length > 0,
    propuesta ? `${propuesta.item.requisitos.length} ingredientes, `
      + `escalada a ${propuesta.porciones} porciones` : "—");

  // 8 · decisión y atribución
  if (propuesta?.recomendacionId) {
    rolActivo = "admin";
    let bloqueado = false;
    try {
      await new RegistrarDecisionUC(decisiones, sesion).ejecutar({
        recomendacionId: propuesta.recomendacionId,
        recetaId: propuesta.item.id, accion: "aprobada",
      });
    } catch (e) {
      bloqueado = (e as { codigo?: string }).codigo === "SIN_ATRIBUCION";
    }
    registrar("8. Control de atribuciones", bloqueado,
      bloqueado ? "el perfil administrativo no puede aprobar"
        : "ATENCIÓN: se admitió una aprobación sin atribución");

    rolActivo = "chef";
    try {
      await new RegistrarDecisionUC(decisiones, sesion).ejecutar({
        recomendacionId: propuesta.recomendacionId,
        recetaId: propuesta.item.id, accion: "aprobada",
      });
      registrar("9. Aprobación", true, `«${propuesta.item.nombre}» enviada a producción`);
    } catch (e) {
      registrar("9. Aprobación", false, (e as Error).message);
    }

    // 10 · valoración de la explicación
    try {
      await new RegistrarFeedbackUC(feedback, sesion)
        .ejecutar({ recomendacionId: propuesta.recomendacionId, claridad: "clara" });
      registrar("10. Valoración del XAI", true, "registrada en la recomendación");
    } catch (e) {
      registrar("10. Valoración del XAI", false, (e as Error).message);
    }
  }

  const superadas = pruebas.filter((p) => p.ok).length;
  reg.linea(`\n  Pasos superados: ${superadas} de ${pruebas.length}`);

  // ==================================================================
  // B · Demostración del componente XAI
  // ==================================================================
  if (propuesta) {
    reg.linea("\n\n  B · DEMOSTRACIÓN DEL COMPONENTE XAI");
    reg.linea("  " + "═".repeat(72));
    reg.linea("  Caso: " + seleccion.map((l) =>
      `${l.codigo} (${l.cantidad} ${l.unidad} de ${l.ingrediente.toLowerCase()}, `
      + `${l.estadoProducto}, ${((l.venceEn.getTime() - Date.now()) / 3_600_000).toFixed(0)} h)`)
      .join("\n        "));

    // --- paso 1: qué se descartó y por qué --------------------------
    reg.linea("\n  PASO 1 · Filtros sanitarios");
    reg.linea("  " + "─".repeat(72));
    reg.linea("  Antes de puntuar nada, se eliminan las alternativas inviables.");
    reg.linea("  Son binarias: una restricción sanitaria no se compensa con una");
    reg.linea("  puntuación alta en otro criterio.\n");

    const motivos = new Map<string, string[]>();
    for (const item of cat) {
      const m = filtrosDuros(seleccion, item, reloj.ahora());
      if (m && m !== "no_usa_lotes") {
        const lista = motivos.get(m) ?? [];
        lista.push(item.nombre);
        motivos.set(m, lista);
      }
    }
    const NOMBRES: Record<string, string> = {
      no_apto: "Sin dictamen sanitario favorable",
      vencido: "Lote fuera de su vida útil",
      sin_tiempo: "No cabe en la ventana sanitaria",
      estado: "Estado del producto no admitido",
      termico: "Cadena de frío rota sin reproceso térmico",
    };
    if (motivos.size === 0) {
      reg.linea("  Ninguna alternativa compatible fue descartada por filtros.");
    } else {
      for (const [m, recetas] of motivos)
        reg.linea(`  ${(NOMBRES[m] ?? m).padEnd(44)} ${recetas.length} descartada(s)`
          + `\n     ${recetas.slice(0, 3).join(", ")}`);
    }
    reg.linea(`\n  Alternativas que superan los filtros: ${salida.resultados.length}`);

    // --- paso 2: la aritmética de la puntuación ---------------------
    reg.linea(`\n  PASO 2 · Composición de la puntuación`);
    reg.linea("  " + "─".repeat(72));
    reg.linea(`  Alternativa seleccionada: «${propuesta.item.nombre}»\n`);
    reg.linea(`  ${"Factor".padEnd(42)} ${"Peso".padStart(6)} ${"Aporta".padStart(8)}`);
    reg.linea("  " + "─".repeat(72));
    for (const f of propuesta.factores) {
      reg.linea(`  ${f.nombre.slice(0, 42).padEnd(42)} ${f.peso.toFixed(2).padStart(6)} `
        + `${(f.contribucion >= 0 ? "+" : "") + f.contribucion.toFixed(2).padStart(7)}`);
      reg.linea(`     ${f.valorObservado}`);
      reg.linea(`     ${barra(f.contribucion)}`);
    }
    const suma = propuesta.factores.reduce((a, f) => a + f.contribucion, 0);
    reg.linea("  " + "─".repeat(72));
    reg.linea(`  ${"Valor de aprovechamiento".padEnd(42)} ${"".padStart(6)} `
      + `${suma.toFixed(2).padStart(8)}`);

    // la parte aprendida: nueve términos en log-odds
    const fe = propuesta.factoresEjecucion ?? [];
    if (fe.length) {
      reg.linea(`\n  Componente aprendido · probabilidad de ejecución (regresión logística)\n`);
      reg.linea(`  ${"Entrada".padEnd(42)} ${"Coef.".padStart(6)} ${"Log-odds".padStart(8)}`);
      reg.linea("  " + "─".repeat(72));
      reg.linea(`  ${"intercepto".padEnd(42)} ${"".padStart(6)} `
        + `${(propuesta.interceptoEjecucion ?? 0).toFixed(2).padStart(8)}`);
      for (const f of fe)
        reg.linea(`  ${f.nombre.slice(0, 42).padEnd(42)} ${f.peso.toFixed(2).padStart(6)} `
          + `${(f.contribucion >= 0 ? "+" : "") + f.contribucion.toFixed(2).padStart(7)}`
          + `   ${f.valorObservado}`);
      const z = (propuesta.interceptoEjecucion ?? 0) + fe.reduce((a, f) => a + f.contribucion, 0);
      reg.linea("  " + "─".repeat(72));
      reg.linea(`  ${"Logit → P(ejecución) = σ(logit)".padEnd(42)} ${z.toFixed(2).padStart(6)} `
        + `${(100 / (1 + Math.exp(-z))).toFixed(1).padStart(7)} %`);
    }
    reg.linea(`\n  Aptitud mostrada al usuario: ${propuesta.aptitud} = `
      + `P ${((propuesta.probabilidadEjecucion ?? 1) * 100).toFixed(1)} % × valor `
      + `${propuesta.valorAprovechamiento ?? suma.toFixed(1)}.`);
    reg.linea(`  Las dos partes se leen de la aritmética del modelo, no de una`);
    reg.linea(`  cifra calculada aparte. Por eso la explicación no puede diferir`);
    reg.linea(`  del resultado.`);

    // --- paso 3: contraste con la alternativa siguiente -------------
    if (salida.resultados[1]) {
      const otra = salida.resultados[1];
      reg.linea(`\n  PASO 3 · Por qué esta y no la siguiente`);
      reg.linea("  " + "─".repeat(72));
      reg.linea(`  ${"Factor".padEnd(38)} ${propuesta.item.nombre.slice(0, 13).padStart(14)} `
        + `${otra.item.nombre.slice(0, 13).padStart(14)}`);
      reg.linea("  " + "─".repeat(72));
      for (let i = 0; i < propuesta.factores.length; i++) {
        const a = propuesta.factores[i], b = otra.factores[i];
        if (!b) continue;
        const dif = a.contribucion - b.contribucion;
        reg.linea(`  ${a.nombre.slice(0, 38).padEnd(38)} `
          + `${a.contribucion.toFixed(2).padStart(14)} ${b.contribucion.toFixed(2).padStart(14)}`
          + (Math.abs(dif) > 3 ? `   ← ${dif > 0 ? "+" : ""}${dif.toFixed(1)}` : ""));
      }
      reg.linea("  " + "─".repeat(72));
      reg.linea(`  ${"Valor de aprovechamiento".padEnd(38)} `
        + `${(propuesta.valorAprovechamiento ?? propuesta.aptitud).toFixed(1).padStart(14)} `
        + `${(otra.valorAprovechamiento ?? otra.aptitud).toFixed(1).padStart(14)}`);
      if (propuesta.probabilidadEjecucion !== undefined)
        reg.linea(`  ${"P(ejecución), aprendida".padEnd(38)} `
          + `${(100 * propuesta.probabilidadEjecucion).toFixed(1).padStart(12)} % `
          + `${(100 * (otra.probabilidadEjecucion ?? 0)).toFixed(1).padStart(12)} %`);
      reg.linea(`  ${"Aptitud = P × valor".padEnd(38)} ${propuesta.aptitud.toFixed(1).padStart(14)} `
        + `${otra.aptitud.toFixed(1).padStart(14)}`);
    }

    // --- paso 4: contrafactuales ------------------------------------
    reg.linea(`\n  PASO 4 · Qué tendría que cambiar para otra salida`);
    reg.linea("  " + "─".repeat(72));
    for (const c of propuesta.contrafactuales) reg.linea(`  · ${c}`);

    // --- paso 5: la explicación en una frase ------------------------
    reg.linea(`\n  PASO 5 · Explicación en lenguaje natural`);
    reg.linea("  " + "─".repeat(72));
    reg.linea(`  ${propuesta.resumen}`);

    // --- paso 6: trazabilidad ---------------------------------------
    reg.linea(`\n  PASO 6 · Lo que queda registrado`);
    reg.linea("  " + "─".repeat(72));
    const doc = await db.collection("recomendaciones")
      .findOne({ _id: propuesta.recomendacionId } as never);
    if (doc) {
      const d = doc as Record<string, unknown>;
      reg.linea(`  Documento ${propuesta.recomendacionId} de la colección «recomendaciones»:`);
      reg.linea(`     versión del modelo   ${d.versionModelo}`);
      reg.linea(`     lotes consumidos     ${(d.aportes as unknown[]).length}`);
      reg.linea(`     factores guardados   ${(d.factores as unknown[]).length}`);
      reg.linea(`     contrafactuales      ${(d.contrafactuales as unknown[]).length}`);
      reg.linea(`     decisión             ${d.decision ? "registrada" : "pendiente"}`);
      reg.linea(`     valoraciones         ${((d.feedback as unknown[]) ?? []).length}`);
      reg.linea(`\n  Toda la propuesta vive en un solo documento. Reconstruir por`);
      reg.linea(`  qué se recomendó algo meses después no exige recalcularlo:`);
      reg.linea(`  basta con leer el registro.`);
    }

    reg.linea(`\n  PESOS DEL MODELO`);
    reg.linea("  " + "─".repeat(72));
    for (const [k, v] of Object.entries(PESOS))
      reg.linea(`  ${k.padEnd(42)} ${v.toFixed(2).padStart(6)}`);
    reg.linea("\n  Pesos del valor: declarados en el código, de criterio experto.");
    reg.linea(`\n  COEFICIENTES APRENDIDOS · ${MODELO_APRENDIDO.algoritmo}`);
    reg.linea("  " + "─".repeat(72));
    reg.linea(`  ${"intercepto".padEnd(42)} ${MODELO_APRENDIDO.intercepto.toFixed(3).padStart(7)}`);
    for (const [k, v] of Object.entries(MODELO_APRENDIDO.coeficientes))
      reg.linea(`  ${k.padEnd(42)} ${v.toFixed(3).padStart(7)}`);
    reg.linea(`\n  Estimados con npm run ml:entrenar sobre ${MODELO_APRENDIDO.periodoEntrenamiento.desde} `
      + `a ${MODELO_APRENDIDO.periodoEntrenamiento.hasta}.`);
  }

  reg.linea("\n  " + "═".repeat(72) + "\n");
  if (propia) await propia.cliente.close();
  return { pruebas: pruebas.length, superadas };
}

if (ejecutadoDirectamente("mongo/fase3.ts"))
  fase3().catch((e) => {
    console.error("\n  No se pudo experimentar:\n ", e.message, "\n");
    process.exit(1);
  });
