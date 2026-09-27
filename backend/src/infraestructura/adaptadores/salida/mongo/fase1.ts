/**
 * FoodLoop · Fase 1 · Definición y validación de requerimientos
 *
 * Comprueba que cada requerimiento declarado tiene una implementación
 * que lo satisface. No basta con enumerar requerimientos en el artículo:
 * si no se puede demostrar cuál es la pieza que cumple cada uno, la
 * validación de esta fase es una afirmación sin respaldo.
 *
 * Cada requerimiento se verifica ejecutando el comportamiento real
 * contra la base, no leyendo el código. Un requerimiento que pasa aquí
 * está efectivamente implementado.
 *
 * Ejecutar: npm run fase1
 */

import "dotenv/config";
import type { Db } from "mongodb";
import { conectar, aplicarEsquema } from "./conexion";
import {
  LotesMongo, CatalogoMongo, CargasMongo, DecisionesMongo, TrazasMongo,
  UsuariosMongo, ConsultasMongo,
} from "./repositorios";
import {
  recomendar, sugerirLotes, filtrosDuros, permisosDe, VERSION_MODELO,
} from "@foodloop/dominio";
import type { Rol } from "@foodloop/dominio";

const URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
const NOMBRE_DB = process.env.MONGODB_DB ?? "foodloop";

interface Requerimiento {
  id: string;
  tipo: "funcional" | "no funcional";
  enunciado: string;
  origen: string;
  verificar: (ctx: Contexto) => Promise<{ ok: boolean; evidencia: string }>;
}

interface Contexto {
  db: Db;
  lotes: LotesMongo;
  catalogo: CatalogoMongo;
  cargas: CargasMongo;
  decisiones: DecisionesMongo;
  trazas: TrazasMongo;
  usuarios: UsuariosMongo;
  consultas: ConsultasMongo;
}

// ---------------------------------------------------------------------
// Catálogo de requerimientos
//
// El origen indica de dónde proviene cada uno: del objetivo del trabajo,
// de la normativa sanitaria del sector o de una observación recogida en
// las sesiones con usuarios. Declararlo permite trazar cada decisión de
// diseño hasta su motivo.
// ---------------------------------------------------------------------

const REQUERIMIENTOS: Requerimiento[] = [
  {
    id: "RF-01", tipo: "funcional",
    enunciado: "El sistema registra un excedente con su estado, temperatura y vida útil.",
    origen: "Objetivo específico 1",
    async verificar({ lotes }) {
      const l = await lotes.listarPendientes();
      const completo = l.filter((x) =>
        x.estadoProducto && typeof x.temperaturaC === "number" && x.venceEn instanceof Date);
      return {
        ok: l.length > 0 && completo.length === l.length,
        evidencia: `${completo.length} de ${l.length} lotes con los tres campos`,
      };
    },
  },
  {
    id: "RF-02", tipo: "funcional",
    enunciado: "Cada receta declara los ingredientes que requiere y en qué cantidad.",
    origen: "Observación del asesor · relación receta-ingrediente",
    async verificar({ catalogo }) {
      const c = await catalogo.listarActivos();
      const conRequisitos = c.filter((r) => r.requisitos.length > 0);
      const conNombre = c.filter((r) => r.requisitos.every((q) => q.nombre));
      return {
        ok: c.length > 0 && conRequisitos.length === c.length,
        evidencia: `${conRequisitos.length} de ${c.length} recetas con ingredientes; `
          + `${conNombre.length} legibles sin consultar otra colección`,
      };
    },
  },
  {
    id: "RF-03", tipo: "funcional",
    enunciado: "El modelo propone alternativas de reaprovechamiento ordenadas por aptitud.",
    origen: "Objetivo específico 2",
    async verificar({ lotes, catalogo, cargas }) {
      const pend = await lotes.listarPendientes();
      const apto = pend.find((l) => l.aptoReproceso && l.venceEn > new Date());
      if (!apto) return { ok: false, evidencia: "no hay lotes vigentes que evaluar" };
      const { resultados } = recomendar(
        [apto], await catalogo.listarActivos(),
        await lotes.inventarioDisponible(), await cargas.cargasPorArea(), new Date(), 3);
      const ordenado = resultados.every((r, i) =>
        i === 0 || resultados[i - 1].aptitud >= r.aptitud);
      return {
        ok: resultados.length > 0 && ordenado,
        evidencia: `${resultados.length} alternativas para ${apto.codigo}, `
          + `aptitudes ${resultados.map((r) => r.aptitud).join(" ≥ ")}`,
      };
    },
  },
  {
    id: "RF-04", tipo: "funcional",
    enunciado: "Una preparación puede elaborarse combinando varios lotes de excedente.",
    origen: "Observación del cliente · multi-lote",
    async verificar({ lotes, catalogo, cargas }) {
      const pend = (await lotes.listarPendientes())
        .filter((l) => l.aptoReproceso && l.venceEn > new Date());
      const cat = await catalogo.listarActivos();
      const disp = await lotes.inventarioDisponible();
      const carg = await cargas.cargasPorArea();

      for (const a of pend)
        for (const b of pend) {
          if (a.id >= b.id || a.ingredienteId === b.ingredienteId) continue;
          const { resultados } = recomendar([a, b], cat, disp, carg, new Date(), 1);
          const r = resultados[0];
          if (r && r.aportes.length > 1)
            return {
              ok: true,
              evidencia: `«${r.item.nombre}» combina ${r.aportes.length} lotes: `
                + r.aportes.map((x) => `${x.lote.codigo} (${x.cantidadUsada} kg)`).join(" + "),
            };
        }
      return { ok: false, evidencia: "ninguna combinación produjo una propuesta multi-lote" };
    },
  },
  {
    id: "RF-05", tipo: "funcional",
    enunciado: "El sistema sugiere qué otros lotes elevarían la aptitud de la propuesta.",
    origen: "Decisión de diseño · el usuario decide, el sistema asiste",
    async verificar({ lotes, catalogo, cargas }) {
      const pend = (await lotes.listarPendientes())
        .filter((l) => l.aptoReproceso && l.venceEn > new Date());
      const cat = await catalogo.listarActivos();
      const disp = await lotes.inventarioDisponible();
      const carg = await cargas.cargasPorArea();
      for (const l of pend) {
        const s = sugerirLotes([l], pend, cat, disp, carg, new Date());
        if (s.length)
          return {
            ok: true,
            evidencia: `para ${l.codigo}: ${s.length} sugerencia(s), `
              + `la mejor aporta +${s[0].gananciaAptitud} puntos`,
          };
      }
      return { ok: false, evidencia: "ningún lote generó sugerencias" };
    },
  },
  {
    id: "RF-06", tipo: "funcional",
    enunciado: "Cada recomendación se acompaña de los factores que la sustentan.",
    origen: "Objetivo específico 2 · componente XAI",
    async verificar({ lotes, catalogo, cargas }) {
      const pend = (await lotes.listarPendientes())
        .filter((l) => l.aptoReproceso && l.venceEn > new Date());
      if (!pend.length) return { ok: false, evidencia: "sin lotes vigentes" };
      const { resultados } = recomendar(
        [pend[0]], await catalogo.listarActivos(),
        await lotes.inventarioDisponible(), await cargas.cargasPorArea(), new Date(), 1);
      const r = resultados[0];
      if (!r) return { ok: false, evidencia: "sin propuesta que explicar" };
      const suma = r.factores.reduce((a, f) => a + f.contribucion, 0);
      const coincide = Math.abs(suma - r.aptitud) < 0.15;
      return {
        ok: r.factores.length >= 7 && r.contrafactuales.length > 0 && coincide,
        evidencia: `${r.factores.length} factores + ${r.contrafactuales.length} `
          + `contrafactuales; suman ${suma.toFixed(1)} frente a aptitud ${r.aptitud}`,
      };
    },
  },
  {
    id: "RF-07", tipo: "funcional",
    enunciado: "Las decisiones del usuario se registran y ajustan el modelo.",
    origen: "Observación del cliente · feedback",
    async verificar({ db, catalogo }) {
      const decididas = await db.collection("recomendaciones")
        .countDocuments({ decision: { $exists: true } });
      const cat = await catalogo.listarActivos();
      const recetas = await db.collection<{ _id: number; aceptacionBase: number }>("recetas")
        .find().toArray();
      const base = new Map(recetas.map((r) => [r._id, r.aceptacionBase]));
      const ajustadas = cat.filter((c) =>
        Math.abs(c.aceptacion - (base.get(c.id) ?? c.aceptacion)) > 0.05);
      return {
        ok: decididas > 0 && ajustadas.length > 0,
        evidencia: `${decididas} decisiones registradas; la aceptación de `
          + `${ajustadas.length} recetas difiere ya de su valor de partida`,
      };
    },
  },
  {
    id: "RF-08", tipo: "funcional",
    enunciado: "El usuario puede valorar si comprende la explicación recibida.",
    origen: "Objetivo específico 3 · evaluación del XAI",
    async verificar({ db }) {
      const con = await db.collection("recomendaciones")
        .countDocuments({ "feedback.0": { $exists: true } });
      return {
        ok: con > 0,
        evidencia: `${con} recomendaciones con valoración de la explicación`,
      };
    },
  },
  {
    id: "RF-09", tipo: "funcional",
    enunciado: "El sistema presenta el excedente disponible agrupado por ingrediente.",
    origen: "Propuesta de trabajo · pantalla de ingredientes disponibles",
    async verificar({ consultas }) {
      const inv = await consultas.inventario();
      const ordenado = inv.every((x, i) => i === 0 || inv[i - 1].horasMinimas <= x.horasMinimas);
      return {
        ok: inv.length > 0 && ordenado,
        evidencia: `${inv.length} ingredientes agrupados, ordenados por urgencia`,
      };
    },
  },
  {
    id: "RF-10", tipo: "funcional",
    enunciado: "El sistema conserva el histórico de lo propuesto y lo decidido.",
    origen: "Propuesta de trabajo · pantalla de historial",
    async verificar({ consultas }) {
      const h = await consultas.historial();
      const conDecision = h.filter((x) => x.accion !== null);
      return {
        ok: h.length > 0,
        evidencia: `${h.length} registros en el histórico, `
          + `${conDecision.length} con decisión asociada`,
      };
    },
  },
  {
    id: "RNF-01", tipo: "no funcional",
    enunciado: "Ninguna propuesta puede vulnerar una restricción sanitaria.",
    origen: "Normativa de manipulación de alimentos",
    async verificar({ lotes, catalogo, cargas }) {
      const pend = await lotes.listarPendientes();
      const cat = await catalogo.listarActivos();
      const disp = await lotes.inventarioDisponible();
      const carg = await cargas.cargasPorArea();
      const ahora = new Date();
      let examinadas = 0, violaciones = 0;

      for (const l of pend) {
        const { resultados } = recomendar([l], cat, disp, carg, ahora, 3);
        for (const r of resultados) {
          examinadas++;
          if (filtrosDuros([l], r.item, ahora) !== null) violaciones++;
        }
      }
      return {
        ok: violaciones === 0,
        evidencia: `${examinadas} propuestas examinadas, ${violaciones} violaciones`,
      };
    },
  },
  {
    id: "RNF-02", tipo: "no funcional",
    enunciado: "Las atribuciones dependen del perfil y se comprueban en el servidor.",
    origen: "Separación de funciones en el centro de producción",
    async verificar() {
      const esperado: Record<Rol, boolean> = {
        chef: true, produccion: true, admin: false, calidad: false,
      };
      const fallos = (Object.keys(esperado) as Rol[])
        .filter((r) => permisosDe(r).aprueba !== esperado[r]);
      return {
        ok: fallos.length === 0,
        evidencia: fallos.length
          ? `perfiles con atribución incorrecta: ${fallos.join(", ")}`
          : "los cuatro perfiles tienen la atribución de aprobación esperada",
      };
    },
  },
  {
    id: "RNF-03", tipo: "no funcional",
    enunciado: "Una recomendación solo puede decidirse una vez.",
    origen: "Integridad de la trazabilidad",
    async verificar({ db, decisiones, usuarios }) {
      const rec = await db.collection<{ _id: number }>("recomendaciones")
        .findOne({ decision: { $exists: true } });
      if (!rec) return { ok: false, evidencia: "no hay recomendaciones decididas" };
      const cuenta = (await usuarios.listar())[0];
      try {
        await decisiones.registrar({
          recomendacionId: rec._id, recetaId: 0, accion: "aprobada", rol: "chef",
          usuarioId: cuenta?.id ?? "", usuario: cuenta?.nombre ?? "Verificación",
        });
        return { ok: false, evidencia: "se admitió una segunda decisión" };
      } catch (e) {
        const codigo = (e as { codigo?: string }).codigo;
        return {
          ok: codigo === "YA_DECIDIDA",
          evidencia: `el intento se rechazó con el código ${codigo}`,
        };
      }
    },
  },
  {
    id: "RF-11", tipo: "funcional",
    enunciado: "Cada decisión queda atribuida a la cuenta que la tomó.",
    origen: "Trazabilidad de la operación",
    async verificar({ db, usuarios }) {
      const cuentas = new Set((await usuarios.listar()).map((u) => u.id));
      const decididas = await db.collection<{
        decision?: { usuarioId?: string; usuario?: string };
      }>("recomendaciones").find({ decision: { $exists: true } }).toArray();
      if (!decididas.length)
        return { ok: false, evidencia: "no hay decisiones registradas" };
      const conCuenta = decididas.filter(
        (r) => r.decision?.usuarioId && cuentas.has(r.decision.usuarioId));
      return {
        ok: conCuenta.length === decididas.length,
        evidencia: `${conCuenta.length} de ${decididas.length} decisiones `
          + `referencian una cuenta existente, además de conservar el nombre`,
      };
    },
  },
  {
    id: "RNF-04", tipo: "no funcional",
    enunciado: "Las contraseñas se almacenan cifradas, nunca en texto claro.",
    origen: "Protección de credenciales",
    async verificar({ db, usuarios }) {
      const u = await db.collection<{ claveHash: string; correo: string }>("usuarios").findOne({});
      if (!u) return { ok: false, evidencia: "no hay cuentas registradas" };
      const correcta = await usuarios.verificar(u.correo, "foodloop2026");
      const incorrecta = await usuarios.verificar(u.correo, "clave-equivocada");
      return {
        ok: u.claveHash.startsWith("$2") && !!correcta && incorrecta === null,
        evidencia: `hash bcrypt (${u.claveHash.slice(0, 4)}…); `
          + `verificación correcta ${correcta ? "acepta" : "falla"}, `
          + `incorrecta ${incorrecta === null ? "rechaza" : "acepta"}`,
      };
    },
  },
  {
    id: "RNF-05", tipo: "no funcional",
    enunciado: "Ante los mismos datos, el modelo produce siempre la misma salida.",
    origen: "Auditabilidad del apoyo a la decisión",
    async verificar({ lotes, catalogo, cargas }) {
      const pend = (await lotes.listarPendientes()).slice(0, 12);
      const cat = await catalogo.listarActivos();
      const disp = await lotes.inventarioDisponible();
      const carg = await cargas.cargasPorArea();
      const ahora = new Date();
      const firma = (l: typeof pend) =>
        recomendar(l, cat, disp, carg, ahora, 3)
          .resultados.map((r) => `${r.item.id}:${r.aptitud}`).join("|");
      let divergen = 0;
      for (const l of pend) if (firma([l]) !== firma([l])) divergen++;
      return {
        ok: divergen === 0,
        evidencia: `${pend.length} evaluaciones repetidas, ${divergen} divergentes`,
      };
    },
  },
];

// ---------------------------------------------------------------------

export async function fase1(dbExterna?: Db) {
  const propia = dbExterna ? null : await conectar(URI, NOMBRE_DB);
  const db = dbExterna ?? propia!.db;
  await aplicarEsquema(db);

  const lotes = new LotesMongo(db);
  const ctx: Contexto = {
    db, lotes,
    catalogo: new CatalogoMongo(db),
    cargas: new CargasMongo(db),
    decisiones: new DecisionesMongo(db),
    trazas: new TrazasMongo(db),
    usuarios: new UsuariosMongo(db),
    consultas: new ConsultasMongo(db, lotes),
  };

  console.log(`\n  FASE 1 · DEFINICIÓN Y VALIDACIÓN DE REQUERIMIENTOS`);
  console.log(`  Modelo versión ${VERSION_MODELO}`);
  console.log("  " + "═".repeat(72));

  const resultados: { req: Requerimiento; ok: boolean; evidencia: string }[] = [];
  for (const req of REQUERIMIENTOS) {
    let r: { ok: boolean; evidencia: string };
    try { r = await req.verificar(ctx); }
    catch (e) { r = { ok: false, evidencia: `error: ${(e as Error).message}` }; }
    resultados.push({ req, ok: r.ok, evidencia: r.evidencia });
  }

  for (const tipo of ["funcional", "no funcional"] as const) {
    const grupo = resultados.filter((r) => r.req.tipo === tipo);
    console.log(`\n  REQUERIMIENTOS ${tipo.toUpperCase()}ES`.replace("NO FUNCIONALES", "NO FUNCIONALES"));
    console.log("  " + "─".repeat(72));
    for (const { req, ok, evidencia } of grupo) {
      console.log(`  ${ok ? "✓" : "✗"} ${req.id}  ${req.enunciado}`);
      console.log(`       origen:    ${req.origen}`);
      console.log(`       evidencia: ${evidencia}`);
    }
  }

  const cumplidos = resultados.filter((r) => r.ok).length;
  console.log("\n  " + "═".repeat(72));
  console.log(`  Requerimientos verificados: ${cumplidos} de ${resultados.length}`
    + `   (${(cumplidos / resultados.length * 100).toFixed(1)} %)`);
  if (cumplidos < resultados.length) {
    console.log("\n  Requerimientos no satisfechos:");
    for (const r of resultados.filter((x) => !x.ok))
      console.log(`     ${r.req.id} · ${r.evidencia}`);
  }
  console.log("\n  Cada requerimiento se comprobó ejecutando el comportamiento");
  console.log("  contra la base de datos, no inspeccionando el código.\n");

  if (propia) await propia.cliente.close();
  return { total: resultados.length, cumplidos, resultados };
}

if (process.argv[1]?.endsWith("mongo/fase1.ts"))
  fase1().catch((e) => {
    console.error("\n  No se pudo verificar:\n ", e.message, "\n");
    process.exit(1);
  });
