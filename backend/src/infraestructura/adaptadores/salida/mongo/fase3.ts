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
import { conectar, aplicarEsquema } from "./conexion";
import {
  LotesMongo, CatalogoMongo, CargasMongo, DecisionesMongo,
  TrazasMongo, MaestrosMongo, FeedbackMongo, UsuariosMongo, ConsultasMongo,
} from "./repositorios";
import {
  ObtenerRecomendacionesUC, RegistrarDecisionUC, RegistrarMermaUC,
  ConsultarOperacionUC, RegistrarFeedbackUC, IniciarSesionUC,
  recomendar, filtrosDuros, PESOS, VERSION_MODELO,
} from "@foodloop/dominio";
import type { Rol, Lote } from "@foodloop/dominio";

const URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
const NOMBRE_DB = process.env.MONGODB_DB ?? "foodloop";

const barra = (v: number, ancho = 26) => {
  const n = Math.max(0, Math.min(ancho, Math.round(Math.abs(v) / 32 * ancho)));
  return (v >= 0 ? "▰" : "▱").repeat(Math.max(1, n));
};

export async function fase3(dbExterna?: Db) {
  const propia = dbExterna ? null : await conectar(URI, NOMBRE_DB);
  const db = dbExterna ?? propia!.db;
  await aplicarEsquema(db);

  const lotes = new LotesMongo(db);
  const catalogo = new CatalogoMongo(db);
  const cargas = new CargasMongo(db);
  const decisiones = new DecisionesMongo(db);
  const trazas = new TrazasMongo(db);
  const maestros = new MaestrosMongo(db);
  const feedback = new FeedbackMongo(db);
  const usuarios = new UsuariosMongo(db);
  const consultas = new ConsultasMongo(db, lotes);

  const reloj = { ahora: () => new Date() };
  let rolActivo: Rol = "chef";
  let cuentaActiva = { id: "", nombre: "Sesión de experimentación" };
  const sesion = {
    rolActual: () => rolActivo,
    usuarioIdActual: () => cuentaActiva.id,
    usuarioActual: () => cuentaActiva.nombre,
  };

  console.log(`\n  FASE 3 · EXPERIMENTACIÓN · modelo ${VERSION_MODELO}`);
  console.log("  " + "═".repeat(72));

  // ==================================================================
  // A · Pruebas del prototipo integrado
  // ==================================================================
  console.log("\n  A · PRUEBAS DEL PROTOTIPO INTEGRADO");
  console.log("  " + "─".repeat(72));
  console.log("  Recorrido equivalente al de las sesiones con usuarios.\n");

  const pruebas: { paso: string; ok: boolean; detalle: string }[] = [];
  const registrar = (paso: string, ok: boolean, detalle: string) => {
    pruebas.push({ paso, ok, detalle });
    console.log(`  ${ok ? "✓" : "✗"} ${paso.padEnd(34)} ${detalle}`);
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
  const inventario = await consultas.inventario();
  registrar("4. Ingredientes disponibles", inventario.length > 0,
    `${inventario.length} ingredientes; el más urgente vence en `
    + `${inventario[0]?.horasMinimas.toFixed(0) ?? "—"} h`);

  // 5 · recomendaciones sobre un conjunto multi-lote
  const vigentes = (await lotes.listarPendientes())
    .filter((l) => l.aptoReproceso && l.venceEn > new Date());
  const cat = await catalogo.listarActivos();
  const disp = await lotes.inventarioDisponible();
  const carg = await cargas.cargasPorArea();

  let seleccion: Lote[] = vigentes.slice(0, 1);
  for (const a of vigentes)
    for (const b of vigentes) {
      if (a.id >= b.id || a.ingredienteId === b.ingredienteId) continue;
      const r = recomendar([a, b], cat, disp, carg, new Date(), 1).resultados[0];
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
  console.log(`\n  Pasos superados: ${superadas} de ${pruebas.length}`);

  // ==================================================================
  // B · Demostración del componente XAI
  // ==================================================================
  if (propuesta) {
    console.log("\n\n  B · DEMOSTRACIÓN DEL COMPONENTE XAI");
    console.log("  " + "═".repeat(72));
    console.log("  Caso: " + seleccion.map((l) =>
      `${l.codigo} (${l.cantidad} ${l.unidad} de ${l.ingrediente.toLowerCase()}, `
      + `${l.estadoProducto}, ${((l.venceEn.getTime() - Date.now()) / 3_600_000).toFixed(0)} h)`)
      .join("\n        "));

    // --- paso 1: qué se descartó y por qué --------------------------
    console.log("\n  PASO 1 · Filtros sanitarios");
    console.log("  " + "─".repeat(72));
    console.log("  Antes de puntuar nada, se eliminan las alternativas inviables.");
    console.log("  Son binarias: una restricción sanitaria no se compensa con una");
    console.log("  puntuación alta en otro criterio.\n");

    const motivos = new Map<string, string[]>();
    for (const item of cat) {
      const m = filtrosDuros(seleccion, item, new Date());
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
      console.log("  Ninguna alternativa compatible fue descartada por filtros.");
    } else {
      for (const [m, recetas] of motivos)
        console.log(`  ${(NOMBRES[m] ?? m).padEnd(44)} ${recetas.length} descartada(s)`
          + `\n     ${recetas.slice(0, 3).join(", ")}`);
    }
    console.log(`\n  Alternativas que superan los filtros: ${salida.resultados.length}`);

    // --- paso 2: la aritmética de la puntuación ---------------------
    console.log(`\n  PASO 2 · Composición de la puntuación`);
    console.log("  " + "─".repeat(72));
    console.log(`  Alternativa seleccionada: «${propuesta.item.nombre}»\n`);
    console.log(`  ${"Factor".padEnd(42)} ${"Peso".padStart(6)} ${"Aporta".padStart(8)}`);
    console.log("  " + "─".repeat(72));
    for (const f of propuesta.factores) {
      console.log(`  ${f.nombre.slice(0, 42).padEnd(42)} ${f.peso.toFixed(2).padStart(6)} `
        + `${(f.contribucion >= 0 ? "+" : "") + f.contribucion.toFixed(2).padStart(7)}`);
      console.log(`     ${f.valorObservado}`);
      console.log(`     ${barra(f.contribucion)}`);
    }
    const suma = propuesta.factores.reduce((a, f) => a + f.contribucion, 0);
    console.log("  " + "─".repeat(72));
    console.log(`  ${"Aptitud resultante".padEnd(42)} ${"".padStart(6)} `
      + `${suma.toFixed(2).padStart(8)}`);
    console.log(`\n  La aptitud mostrada al usuario es ${propuesta.aptitud}: la suma de`);
    console.log(`  las contribuciones, no una cifra calculada aparte. Por eso la`);
    console.log(`  explicación no puede diferir del resultado.`);

    // --- paso 3: contraste con la alternativa siguiente -------------
    if (salida.resultados[1]) {
      const otra = salida.resultados[1];
      console.log(`\n  PASO 3 · Por qué esta y no la siguiente`);
      console.log("  " + "─".repeat(72));
      console.log(`  ${"Factor".padEnd(38)} ${propuesta.item.nombre.slice(0, 13).padStart(14)} `
        + `${otra.item.nombre.slice(0, 13).padStart(14)}`);
      console.log("  " + "─".repeat(72));
      for (let i = 0; i < propuesta.factores.length; i++) {
        const a = propuesta.factores[i], b = otra.factores[i];
        if (!b) continue;
        const dif = a.contribucion - b.contribucion;
        console.log(`  ${a.nombre.slice(0, 38).padEnd(38)} `
          + `${a.contribucion.toFixed(2).padStart(14)} ${b.contribucion.toFixed(2).padStart(14)}`
          + (Math.abs(dif) > 3 ? `   ← ${dif > 0 ? "+" : ""}${dif.toFixed(1)}` : ""));
      }
      console.log("  " + "─".repeat(72));
      console.log(`  ${"Aptitud".padEnd(38)} ${propuesta.aptitud.toFixed(1).padStart(14)} `
        + `${otra.aptitud.toFixed(1).padStart(14)}`);
    }

    // --- paso 4: contrafactuales ------------------------------------
    console.log(`\n  PASO 4 · Qué tendría que cambiar para otra salida`);
    console.log("  " + "─".repeat(72));
    for (const c of propuesta.contrafactuales) console.log(`  · ${c}`);

    // --- paso 5: la explicación en una frase ------------------------
    console.log(`\n  PASO 5 · Explicación en lenguaje natural`);
    console.log("  " + "─".repeat(72));
    console.log(`  ${propuesta.resumen}`);

    // --- paso 6: trazabilidad ---------------------------------------
    console.log(`\n  PASO 6 · Lo que queda registrado`);
    console.log("  " + "─".repeat(72));
    const doc = await db.collection("recomendaciones")
      .findOne({ _id: propuesta.recomendacionId } as never);
    if (doc) {
      const d = doc as Record<string, unknown>;
      console.log(`  Documento ${propuesta.recomendacionId} de la colección «recomendaciones»:`);
      console.log(`     versión del modelo   ${d.versionModelo}`);
      console.log(`     lotes consumidos     ${(d.aportes as unknown[]).length}`);
      console.log(`     factores guardados   ${(d.factores as unknown[]).length}`);
      console.log(`     contrafactuales      ${(d.contrafactuales as unknown[]).length}`);
      console.log(`     decisión             ${d.decision ? "registrada" : "pendiente"}`);
      console.log(`     valoraciones         ${((d.feedback as unknown[]) ?? []).length}`);
      console.log(`\n  Toda la propuesta vive en un solo documento. Reconstruir por`);
      console.log(`  qué se recomendó algo meses después no exige recalcularlo:`);
      console.log(`  basta con leer el registro.`);
    }

    console.log(`\n  PESOS DEL MODELO`);
    console.log("  " + "─".repeat(72));
    for (const [k, v] of Object.entries(PESOS))
      console.log(`  ${k.padEnd(42)} ${v.toFixed(2).padStart(6)}`);
    console.log("\n  Declarados en el código, no ajustados por caso.");
  }

  console.log("\n  " + "═".repeat(72) + "\n");
  if (propia) await propia.cliente.close();
  return { pruebas: pruebas.length, superadas };
}

if (process.argv[1]?.endsWith("mongo/fase3.ts"))
  fase3().catch((e) => {
    console.error("\n  No se pudo experimentar:\n ", e.message, "\n");
    process.exit(1);
  });
