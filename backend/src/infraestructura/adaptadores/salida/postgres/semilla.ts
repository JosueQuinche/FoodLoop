/**
 * FoodLoop · Semilla de PostgreSQL
 *
 * Crea el esquema y carga catálogo, áreas, servicios y un conjunto de
 * lotes con los patrones que documenta la literatura. Es destructiva:
 * vacía las tablas de operación antes de cargar.
 *
 * Ejecutar: npm run semilla
 */
import "dotenv/config";
import {
  crearPiscina, aplicarEsquema,
} from "./repositorios";
import { AREAS, INGREDIENTES, CATALOGO } from "./catalogo";
import type { Causa } from "@foodloop/dominio";

const CADENA = process.env.DATABASE_URL
  ?? "postgres://postgres:postgres@localhost:5432/foodloop";

function crearAzar(semilla: number) {
  let s = semilla;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

const CAUSAS: { causa: Causa; peso: number }[] = [
  { causa: "sobreproduccion", peso: 0.38 },
  { causa: "devolucion_linea", peso: 0.27 },
  { causa: "error_porcionado", peso: 0.18 },
  { causa: "caducidad_proxima", peso: 0.12 },
  { causa: "defecto_calidad", peso: 0.05 },
];

const SERVICIOS = ["Desayuno", "Almuerzo turno 1", "Almuerzo turno 2", "Cena"];

export async function sembrar() {
  const p = crearPiscina(CADENA);
  console.log(`\n  Conectando a ${CADENA.replace(/:[^:@]+@/, ":****@")}`);
  await aplicarEsquema(p);
  console.log("  Esquema aplicado.");

  await p.query(`TRUNCATE feedback_explicacion, decision, recomendacion_lote,
    recomendacion, merma, produccion, asistencia RESTART IDENTITY CASCADE`);
  // Las cuentas no se borran: perderlas obligaría a registrarse de nuevo
  // cada vez que se recarguen los datos de ejemplo.
  await p.query("TRUNCATE receta_ingrediente, receta, ingrediente, area, servicio RESTART IDENTITY CASCADE");

  // Cuentas iniciales, una por perfil. La contraseña es la misma para
  // todas por comodidad durante las sesiones de validación; en una
  // implantación real cada persona definiría la suya al darse de alta.
  const CUENTAS = [
    ["m.calderon@cateringandes.ec", "Mateo Calderón", "chef"],
    ["l.ordonez@cateringandes.ec", "Lucía Ordóñez", "produccion"],
    ["k.jimenez@cateringandes.ec", "Karla Jiménez", "admin"],
    ["a.vega@cateringandes.ec", "Andrés Vega", "calidad"],
  ];
  for (const [correo, nombre, rol] of CUENTAS)
    await p.query(`INSERT INTO usuario (correo, nombre, rol, clave_hash)
      VALUES ($1,$2,$3, crypt($4, gen_salt('bf', 10)))
      ON CONFLICT (correo) DO NOTHING`,
      [correo, nombre, rol, "foodloop2026"]);

  for (const a of AREAS)
    await p.query("INSERT INTO area (id,nombre,capacidad_kg) VALUES ($1,$2,$3)",
      [a.id, a.nombre, a.capacidadKg]);

  for (const [i, s] of SERVICIOS.entries())
    await p.query("INSERT INTO servicio (id,nombre,orden) VALUES ($1,$2,$3)",
      [i, s, i]);

  for (const i of INGREDIENTES)
    await p.query(`INSERT INTO ingrediente (id,codigo,nombre,categoria,unidad,
      costo_unitario,vida_util_crudo_h,vida_util_cocido_h,temp_max_c)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [i.id, i.codigo, i.nombre, i.categoria, i.unidad, i.costoUnitario,
       i.vidaUtilCrudoH, i.vidaUtilCocidoH, i.tempMaxC]);

  for (const r of CATALOGO) {
    await p.query(`INSERT INTO receta (id,codigo,nombre,area_id,porciones_base,
      peso_porcion_g,minutos,tipo_proceso,temp_proceso_c,aceptacion_base,pasos)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [r.id, r.codigo, r.nombre, r.areaId, r.porcionesBase, r.pesoPorcionG,
       r.minutos, r.tipoProceso, r.tempProcesoC, r.aceptacion,
       JSON.stringify(r.pasos)]);
    for (const q of r.requisitos)
      await p.query(`INSERT INTO receta_ingrediente (receta_id,ingrediente_id,
        cantidad,es_principal,admite_estado) VALUES ($1,$2,$3,$4,$5)`,
        [r.id, q.ingredienteId, q.cantidad, q.esPrincipal, q.admiteEstado]);
  }

  // Lotes repartidos en los últimos siete días, para que las series
  // temporales del panel tengan algo que mostrar desde el primer arranque.
  const azar = crearAzar(20260727);
  // ------------------------------------------------------------------
  // Histórico de producción y asistencia: seis meses, que es el periodo
  // que declara la metodología. Estas dos series son las que permiten
  // expresar la merma como proporción de lo producido.
  //
  // El desvío de comensales tiene media negativa a propósito: acude
  // menos gente de la prevista, que es el patrón que documenta la
  // literatura y el origen principal del excedente.
  // ------------------------------------------------------------------
  const DIAS_HISTORICO = 182;
  const BASE_COMENSALES = [210, 480, 430, 160];   // por servicio

  for (let d = DIAS_HISTORICO; d >= 0; d--) {
    const fecha = new Date(Date.now() - d * 86_400_000);
    const iso = fecha.toISOString().slice(0, 10);
    const finDeSemana = fecha.getDay() === 0 || fecha.getDay() === 6;

    for (let s = 0; s < SERVICIOS.length; s++) {
      const base = Math.round(BASE_COMENSALES[s] * (finDeSemana ? 0.35 : 1));
      const previstos = base + Math.round((azar() - 0.5) * 50);
      // desvío centrado en -6 %, con dispersión
      const desvio = -0.06 + (azar() - 0.5) * 0.14;
      const reales = Math.max(20, Math.round(previstos * (1 + desvio)));

      await p.query(`INSERT INTO asistencia (fecha, servicio_id,
        comensales_previstos, comensales_reales) VALUES ($1,$2,$3,$4)
        ON CONFLICT DO NOTHING`, [iso, s, previstos, reales]);

      // dos o tres recetas por servicio, sin repetir
      const disponibles = [...Array(CATALOGO.length).keys()];
      const cuantas = 2 + (azar() < 0.5 ? 1 : 0);
      for (let k = 0; k < cuantas; k++) {
        const idx = Math.floor(azar() * disponibles.length);
        const recetaId = disponibles.splice(idx, 1)[0];
        const porciones = Math.round(previstos * (0.35 + azar() * 0.2));
        await p.query(`INSERT INTO produccion (fecha, servicio_id, receta_id,
          porciones_producidas) VALUES ($1,$2,$3,$4)
          ON CONFLICT DO NOTHING`, [iso, s, recetaId, porciones]);
      }
    }
  }

  // Lotes de días anteriores que se cierran con una decisión.
  const cerrados: number[] = [];

  // Los tres primeros son didácticos y, sobre todo, COMBINABLES: pollo
  // cocido más arroz cocido cubren la misma receta, de modo que el
  // multi-lote se puede demostrar desde el primer arranque.
  const forzados = [
    { ing: 0, cocido: true, cant: 6.4, temp: 3.2, apto: true, horas: 18, diasAtras: 0 },
    { ing: 2, cocido: true, cant: 9.1, temp: 2.8, apto: true, horas: 28, diasAtras: 0 },
    { ing: 4, cocido: false, cant: 2.6, temp: 4.0, apto: true, horas: 40, diasAtras: 0 },
    // dos lotes del MISMO ingrediente, para mostrar el reparto por urgencia
    { ing: 0, cocido: true, cant: 3.2, temp: 3.5, apto: true, horas: 11, diasAtras: 0 },
    // cadena de frío rota: solo sobreviven los reprocesos térmicos
    { ing: 8, cocido: true, cant: 2.0, temp: 8.4, apto: true, horas: 9, diasAtras: 0 },
    // sin dictamen sanitario: ninguna alternativa es viable
    { ing: 7, cocido: false, cant: 3.1, temp: 4.0, apto: false, horas: 30, diasAtras: 0 },
  ];

  let n = 0;
  for (let i = 0; i < 42; i++) {
    const f = forzados[i];
    const ing = INGREDIENTES[f ? f.ing : Math.floor(azar() * INGREDIENTES.length)];
    const cocido = f ? f.cocido : azar() < 0.62;
    const cantidad = f ? f.cant : Math.round((1.2 + azar() * 9.5) * 10) / 10;
    const temp = f ? f.temp : Math.round((2 + azar() * 3) * 10) / 10;
    const apto = f ? f.apto : azar() > 0.08;
    const diasAtras = f ? f.diasAtras : (i < 14 ? 0 : Math.floor(1 + azar() * 6));

    let acc = azar(); let causa: Causa = "sobreproduccion";
    for (const c of CAUSAS) { acc -= c.peso; if (acc <= 0) { causa = c.causa; break; } }

    const vidaH = f ? f.horas : (cocido ? ing.vidaUtilCocidoH : ing.vidaUtilCrudoH);
    const reg = new Date(Date.now() - diasAtras * 86_400_000 - azar() * 8 * 3_600_000);
    n++;
    const codigo = `MRM-${String(reg.getFullYear()).slice(2)}`
      + `${String(reg.getMonth() + 1).padStart(2, "0")}`
      + `${String(reg.getDate()).padStart(2, "0")}-${String(n).padStart(4, "0")}`;

    const { rows: ins } = await p.query(`INSERT INTO merma (codigo,ingrediente_id,
      area_id,servicio_id,cantidad,estado_producto,temperatura_c,causa,
      apto_reproceso,registrado_en,vence_en)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [codigo, ing.id, Math.floor(azar() * AREAS.length),
       Math.floor(azar() * SERVICIOS.length), cantidad,
       cocido ? "cocido" : "crudo", temp, causa, apto,
       reg.toISOString(),
       new Date(reg.getTime() + vidaH * 3_600_000).toISOString()]);
    if (diasAtras > 0) cerrados.push(Number(ins[0].id));
  }

  // Historial. Una parte de las recomendaciones combina dos lotes del
  // mismo día, porque es lo que ocurre en la operación real y porque sin
  // ellas el indicador de propuestas multi-lote saldría en cero y no se
  // podría reportar la funcionalidad.
  const sinUsar = [...cerrados];
  while (sinUsar.length > 0) {
    // Dos de cada cinco recomendaciones combinan dos lotes.
    const combinar = sinUsar.length >= 2 && azar() < 0.4;
    const usados = combinar
      ? [sinUsar.shift()!, sinUsar.shift()!]
      : [sinUsar.shift()!];

    const recetaId = Math.floor(azar() * CATALOGO.length);
    const { rows: mer } = await p.query(
      `SELECT id, cantidad, registrado_en FROM merma WHERE id = ANY($1)`,
      [usados]);

    const kg = mer.reduce((a, m) => a + Number(m.cantidad), 0);
    const { rows: rec } = await p.query(`
      INSERT INTO recomendacion (receta_id, generada_en, version_modelo,
        aptitud, posicion, porciones, kg_aprovechados, costo_recuperado)
      VALUES ($1,$2,'2.0.0',$3,1,$4,$5,$6) RETURNING id`,
      [recetaId, mer[0].registrado_en,
       // las combinadas puntúan más alto: cubren más receta con merma
       Math.round((combinar ? 78 + azar() * 18 : 58 + azar() * 25) * 10) / 10,
       Math.round(20 + azar() * 30), kg,
       Math.round(kg * 4 * 100) / 100]);

    const recId = Number(rec[0].id);
    for (const [i, m] of mer.entries())
      await p.query(`INSERT INTO recomendacion_lote (recomendacion_id, merma_id,
        cantidad_usada, es_principal) VALUES ($1,$2,$3,$4)`,
        [recId, m.id, m.cantidad, i === 0]);

    // Las combinadas se aprueban más, que es lo que hace que el modelo
    // aprenda a preferirlas mediante el factor de aceptación.
    const accion = azar() < (combinar ? 0.82 : 0.6) ? "aprobada" : "descartada";
    await p.query(`INSERT INTO decision (recomendacion_id, rol, usuario,
      accion, decidida_en) VALUES ($1,'chef','Mateo Calderón',$2,
      (SELECT registrado_en + INTERVAL '2 hours' FROM merma WHERE id = $3))`,
      [recId, accion, usados[0]]);

    if (azar() < 0.34) {
      const cl = azar() < 0.72 ? "clara" : (azar() < 0.5 ? "confusa" : "insuficiente");
      await p.query(`INSERT INTO feedback_explicacion (recomendacion_id, rol,
        usuario, claridad) VALUES ($1,'chef','Mateo Calderón',$2)`, [recId, cl]);
    }
  }

  for (const t of ["usuario", "area", "servicio", "ingrediente", "receta",
                   "asistencia", "produccion", "merma",
                   "recomendacion", "recomendacion_lote", "decision",
                   "feedback_explicacion"]) {
    const { rows: c } = await p.query(`SELECT COUNT(*) AS n FROM ${t}`);
    console.log(`    ${t.padEnd(14)} ${String(c[0].n).padStart(4)} registros`);
  }
  console.log();
  await p.end();
}

/** Solo se ejecuta cuando el archivo se invoca directamente. */
const invocadoDirecto = process.argv[1]?.includes("semilla");
if (invocadoDirecto) sembrar().catch((e) => {
  console.error("\n  No se pudo sembrar la base:\n ", e.message);
  console.error("\n  Comprueba que PostgreSQL esté corriendo y que la base");
  console.error("  'foodloop' exista:  createdb foodloop\n");
  process.exit(1);
});
