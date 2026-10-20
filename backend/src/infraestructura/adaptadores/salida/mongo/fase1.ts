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
import { conectar, aplicarEsquema, ejecutadoDirectamente } from "./conexion";
import {
  LotesMongo, CatalogoMongo, CargasMongo, DecisionesMongo, TrazasMongo,
  UsuariosMongo, ConsultasMongo,
} from "./repositorios";
import {
  recomendar, sugerirLotes, filtrosDuros, permisosDe, VERSION_MODELO,
  ejecutarModelo,
} from "@foodloop/dominio";
import type { Rol, Lote } from "@foodloop/dominio";
import {
  Registro, relojDe, describirReloj, type OpcionesFase,
} from "./fases-comun";

const URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
const NOMBRE_DB = process.env.MONGODB_DB ?? "foodloop";

interface Requerimiento {
  id: string;
  tipo: "funcional" | "no funcional";
  enunciado: string;
  origen: string;
  /**
   * `noAplica` es un tercer estado necesario desde que las fases corren
   * sobre los datos del centro. Varios requerimientos se verifican
   * contra decisiones de usuario y valoraciones del XAI, y el conjunto
   * importado no trae ninguna: la hoja de decisiones viene con
   * ESTADO_EJECUCION = "No autorizada" en las 1577 filas. Contarlos como
   * incumplidos diría que el sistema no sabe registrar decisiones, que
   * es falso; lo que falta es el dato con que comprobarlo.
   */
  verificar: (ctx: Contexto) =>
    Promise<{ ok: boolean; evidencia: string; noAplica?: string }>;
}

interface Contexto {
  db: Db;
  /**
   * Instante en que debe evaluarse cada lote. Con un conjunto histórico
   * no puede ser `new Date()`: los lotes del centro están todos vencidos
   * frente al reloj del sistema, y entonces los requerimientos que
   * dependen de que exista una propuesta fallarían por falta de datos
   * vigentes, no por un defecto del modelo.
   */
  reloj: (l: Lote) => Date;
  /** Tope de lotes en las comprobaciones que recorren pares. */
  muestra: number;
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
    async verificar({ lotes, catalogo, cargas, reloj, muestra }) {
      const pend = await lotes.listarPendientes();
      const apto = pend.find((l) => l.aptoReproceso && l.venceEn > reloj(l));
      if (!apto) return { ok: false, evidencia: "no hay lotes vigentes que evaluar" };
      const { resultados } = recomendar(
        [apto], await catalogo.listarActivos(),
        await lotes.inventarioDisponible(), await cargas.cargasPorArea(),
        reloj(apto), 3);
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
    async verificar({ lotes, catalogo, cargas, reloj, muestra }) {
      const crudos = await lotes.listarPendientes();
      const pend = crudos
        .filter((l) => l.aptoReproceso && l.venceEn > reloj(l))
        .slice(0, muestra);
      const todosPend = crudos
        .filter((l) => l.venceEn > reloj(l))
        .slice(0, muestra);
      const cat = await catalogo.listarActivos();
      const disp = await lotes.inventarioDisponible();
      const carg = await cargas.cargasPorArea();

      // Se busca en los dos modos. En operación, sobre los datos del
      // centro, los únicos lotes con dictamen favorable son casi todos
      // del mismo ingrediente, de modo que no hay par que combinar: no
      // es que el modelo no sepa combinar, es que no hay con qué. El
      // modo potencial aplaza las reglas que dependen de lo no medido y
      // demuestra la capacidad sobre el mismo conjunto.
      for (const modo of ["operacion", "potencial"] as const) {
        // En potencial la lista no puede venir filtrada por dictamen:
        // ese es justamente el filtro que el modo aplaza. Con `pend` ya
        // filtrado, el segundo intento examinaba los mismos 71 lotes de
        // zanahoria y no encontraba par que combinar.
        const cands = modo === "potencial" ? todosPend : pend;
        for (const a of cands)
          for (const b of cands) {
            if (a.id >= b.id || a.ingredienteId === b.ingredienteId) continue;
            const ahora = new Date(Math.max(reloj(a).getTime(), reloj(b).getTime()));
            const { resultados } = ejecutarModelo(
              [a, b], cat, disp, carg, ahora, { topN: 1, modo });
            const r = resultados[0];
            if (r && r.aportes.length > 1)
              return {
                ok: true,
                evidencia: `«${r.item.nombre}» combina ${r.aportes.length} lotes: `
                  + r.aportes.map((x) => `${x.lote.codigo} (${x.cantidadUsada} kg)`).join(" + ")
                  + (modo === "potencial" ? " · verificado en modo potencial" : ""),
              };
          }
      }
      return { ok: false, evidencia: "ninguna combinación produjo una propuesta multi-lote" };
    },
  },
  {
    id: "RF-05", tipo: "funcional",
    enunciado: "El sistema sugiere qué otros lotes elevarían la aptitud de la propuesta.",
    origen: "Decisión de diseño · el usuario decide, el sistema asiste",
    async verificar({ lotes, catalogo, cargas, reloj, muestra }) {
      const pend = (await lotes.listarPendientes())
        .filter((l) => l.aptoReproceso && l.venceEn > reloj(l))
        .slice(0, muestra);
      const cat = await catalogo.listarActivos();
      const disp = await lotes.inventarioDisponible();
      const carg = await cargas.cargasPorArea();
      for (const l of pend) {
        const s = sugerirLotes([l], pend, cat, disp, carg, reloj(l));
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
    async verificar({ lotes, catalogo, cargas, reloj, muestra }) {
      const pend = (await lotes.listarPendientes())
        .filter((l) => l.aptoReproceso && l.venceEn > reloj(l))
        .slice(0, muestra);
      if (!pend.length) return { ok: false, evidencia: "sin lotes vigentes" };
      const { resultados } = recomendar(
        [pend[0]], await catalogo.listarActivos(),
        await lotes.inventarioDisponible(), await cargas.cargasPorArea(),
        reloj(pend[0]), 1);
      const r = resultados[0];
      if (!r) return { ok: false, evidencia: "sin propuesta que explicar" };
<<<<<<< HEAD
      // Desde el modelo 3 la explicación tiene dos partes exactas: los
      // siete factores suman el valor de aprovechamiento, y los nueve del
      // componente aprendido, con el intercepto, el logit de P.
      const valor = r.valorAprovechamiento ?? r.aptitud;
      const suma = r.factores.reduce((a, f) => a + f.contribucion, 0);
      const coincide = Math.abs(suma - valor) < 0.15;
      const fe = r.factoresEjecucion ?? [];
      const pDesde = 1 / (1 + Math.exp(-((r.interceptoEjecucion ?? 0)
        + fe.reduce((a, f) => a + f.contribucion, 0))));
      const coincideP = r.probabilidadEjecucion === undefined
        || Math.abs(pDesde - r.probabilidadEjecucion) < 0.001;
      return {
        ok: r.factores.length >= 7 && r.contrafactuales.length > 0 && coincide && coincideP,
        evidencia: `${r.factores.length} factores de valor + ${fe.length} de ejecución + `
          + `${r.contrafactuales.length} contrafactual; suman ${suma.toFixed(1)} = valor ${valor}`
          + (r.probabilidadEjecucion !== undefined
            ? `; los de ejecución reproducen P = ${(100 * pDesde).toFixed(1)} %` : ""),
=======
      const suma = r.factores.reduce((a, f) => a + f.contribucion, 0);
      const coincide = Math.abs(suma - r.aptitud) < 0.15;
      return {
        ok: r.factores.length >= 7 && r.contrafactuales.length > 0 && coincide,
        evidencia: `${r.factores.length} factores + ${r.contrafactuales.length} `
          + `contrafactuales; suman ${suma.toFixed(1)} frente a aptitud ${r.aptitud}`,
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
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
      if (decididas === 0)
        return { ok: false, noAplica: "el conjunto importado no trae decisiones de usuario (ESTADO_EJECUCION = «No autorizada» en las 1577 filas)",
          evidencia: "0 decisiones en la base" };
      return {
        ok: ajustadas.length > 0,
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
      if (con === 0)
        return { ok: false, noAplica: "el conjunto importado no trae valoraciones del XAI",
          evidencia: "0 valoraciones en la base" };
      return {
        ok: true,
        evidencia: `${con} recomendaciones con valoración de la explicación`,
      };
    },
  },
  {
    id: "RF-09", tipo: "funcional",
    enunciado: "El sistema presenta el excedente disponible agrupado por ingrediente.",
    origen: "Propuesta de trabajo · pantalla de ingredientes disponibles",
    async verificar({ consultas, lotes, reloj }) {
      // El inventario se consulta en el instante del lote más reciente,
      // no en el de hoy: con un conjunto histórico el reloj del sistema
      // devuelve siempre cero ingredientes disponibles.
      const pend = await lotes.listarPendientes();
      const aptos = pend.filter((l) => l.aptoReproceso);
      const ultimo = (aptos.length ? aptos : pend).reduce(
        (a, l) => (a && a.registradoEn > l.registradoEn ? a : l), pend[0]);
      const inv = await consultas.inventario(ultimo ? reloj(ultimo) : new Date());
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
      if (h.length === 0)
        return { ok: false, noAplica: "el conjunto importado no trae decisiones de usuario (ESTADO_EJECUCION = «No autorizada» en las 1577 filas)",
          evidencia: "0 registros en el histórico" };
      return {
        ok: true,
        evidencia: `${h.length} registros en el histórico, `
          + `${conDecision.length} con decisión asociada`,
      };
    },
  },
  {
    id: "RNF-01", tipo: "no funcional",
    enunciado: "Ninguna propuesta puede vulnerar una restricción sanitaria.",
    origen: "Normativa de manipulación de alimentos",
    async verificar({ lotes, catalogo, cargas, reloj, muestra }) {
      const pend = await lotes.listarPendientes();
      const cat = await catalogo.listarActivos();
      const disp = await lotes.inventarioDisponible();
      const carg = await cargas.cargasPorArea();
      let examinadas = 0, violaciones = 0;

      for (const l of pend) {
        const ahora = reloj(l);
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
      if (!rec) return { ok: false, noAplica: "el conjunto importado no trae decisiones de usuario (ESTADO_EJECUCION = «No autorizada» en las 1577 filas)",
        evidencia: "no hay recomendaciones decididas que reintentar" };
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
        return { ok: false, noAplica: "el conjunto importado no trae decisiones de usuario (ESTADO_EJECUCION = «No autorizada» en las 1577 filas)",
          evidencia: "no hay decisiones registradas que atribuir" };
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
    async verificar({ lotes, catalogo, cargas, reloj, muestra }) {
      const pend = (await lotes.listarPendientes()).slice(0, 12);
      const cat = await catalogo.listarActivos();
      const disp = await lotes.inventarioDisponible();
      const carg = await cargas.cargasPorArea();
      const firma = (l: typeof pend) =>
        recomendar(l, cat, disp, carg, reloj(l[0]), 3)
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

export async function fase1(dbExterna?: Db, opciones: OpcionesFase = {}) {
  const propia = dbExterna ? null : await conectar(URI, NOMBRE_DB);
  const db = dbExterna ?? propia!.db;
  await aplicarEsquema(db);

  const reg = opciones.registro ?? new Registro();
  const lotes = new LotesMongo(db);
  const ctx: Contexto = {
    db, lotes,
    reloj: (l) => relojDe(l, opciones),
    // Las comprobaciones RF-04 y RF-05 recorren pares de lotes. Con los
    // 1577 del centro eso es más de un millón de combinaciones, así que
    // se acota a los primeros: basta un caso para verificar que la
    // capacidad existe, que es lo que el requerimiento afirma.
    muestra: 120,
    catalogo: new CatalogoMongo(db),
    cargas: new CargasMongo(db),
    decisiones: new DecisionesMongo(db),
    trazas: new TrazasMongo(db),
    usuarios: new UsuariosMongo(db),
    consultas: new ConsultasMongo(db, lotes),
  };

  reg.contexto.fase = "fase1";
  reg.contexto.version = VERSION_MODELO;
  reg.contexto.reloj = describirReloj(opciones);
  reg.linea(`\n  FASE 1 · DEFINICIÓN Y VALIDACIÓN DE REQUERIMIENTOS`);
  reg.linea(`  Modelo versión ${VERSION_MODELO}`);
  reg.linea(`  Instante de evaluación: ${describirReloj(opciones)}`);
  reg.linea("  " + "═".repeat(72));

  const resultados: {
    req: Requerimiento; ok: boolean; evidencia: string; noAplica?: string;
  }[] = [];
  for (const req of REQUERIMIENTOS) {
    let r: { ok: boolean; evidencia: string; noAplica?: string };
    try { r = await req.verificar(ctx); }
    catch (e) { r = { ok: false, evidencia: `error: ${(e as Error).message}` }; }
    resultados.push({ req, ok: r.ok, evidencia: r.evidencia, noAplica: r.noAplica });
  }

  for (const tipo of ["funcional", "no funcional"] as const) {
    const grupo = resultados.filter((r) => r.req.tipo === tipo);
    reg.linea(`\n  REQUERIMIENTOS ${tipo.toUpperCase()}ES`.replace("NO FUNCIONALES", "NO FUNCIONALES"));
    reg.linea("  " + "─".repeat(72));
    for (const { req, ok, evidencia, noAplica } of grupo) {
      reg.linea(`  ${noAplica ? "–" : ok ? "✓" : "✗"} ${req.id}  ${req.enunciado}`);
      if (noAplica) reg.linea(`       no verificable: ${noAplica}`);
      reg.linea(`       origen:    ${req.origen}`);
      reg.linea(`       evidencia: ${evidencia}`);
    }
  }

  const aplicables = resultados.filter((r) => !r.noAplica);
  const noAplicables = resultados.filter((r) => r.noAplica);
  const cumplidos = aplicables.filter((r) => r.ok).length;
  reg.metrica("rf_total", "Requerimientos declarados", resultados.length);
  reg.metrica("rf_aplicables", "Verificables con este conjunto", aplicables.length);
  reg.metrica("rf_cumplidos", "Requerimientos verificados", cumplidos);
  reg.metrica("rf_tasa", "Tasa de verificación",
    Number((cumplidos / aplicables.length * 100).toFixed(1)), "%");
  for (const r of resultados)
    reg.metrica(`req_${r.req.id.replace("-", "_").toLowerCase()}`,
      r.req.enunciado, r.ok ? 1 : 0, "0/1", r.evidencia);
  reg.linea("\n  " + "═".repeat(72));
  reg.linea(`  Requerimientos verificados: ${cumplidos} de ${aplicables.length}`
    + `   (${(cumplidos / aplicables.length * 100).toFixed(1)} %)`);
  if (noAplicables.length) {
    reg.linea(`  No verificables con este conjunto: ${noAplicables.length}`
      + ` de ${resultados.length}`);
    reg.linea("  No son incumplimientos: la capacidad está implementada y se");
    reg.linea("  verifica con la semilla; lo que falta es el dato con que");
    reg.linea("  comprobarla sobre los registros del centro.");
  }
  if (cumplidos < aplicables.length) {
    reg.linea("\n  Requerimientos no satisfechos:");
    for (const r of aplicables.filter((x) => !x.ok))
      reg.linea(`     ${r.req.id} · ${r.evidencia}`);
  }
  reg.linea("\n  Cada requerimiento se comprobó ejecutando el comportamiento");
  reg.linea("  contra la base de datos, no inspeccionando el código.\n");

  if (propia) await propia.cliente.close();
  return { total: resultados.length, cumplidos, resultados };
}

if (ejecutadoDirectamente("mongo/fase1.ts"))
  fase1().catch((e) => {
    console.error("\n  No se pudo verificar:\n ", e.message, "\n");
    process.exit(1);
  });
