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

  await p.query("TRUNCATE decision, traza, merma RESTART IDENTITY CASCADE");
  await p.query("TRUNCATE receta_ingrediente, receta, ingrediente, area, servicio RESTART IDENTITY CASCADE");

  for (const a of AREAS)
    await p.query("INSERT INTO area (id,nombre,capacidad_kg) VALUES ($1,$2,$3)",
      [a.id, a.nombre, a.capacidadKg]);

  for (const [i, s] of SERVICIOS.entries())
    await p.query("INSERT INTO servicio (nombre,orden) VALUES ($1,$2)", [s, i]);

  for (const i of INGREDIENTES)
    await p.query(`INSERT INTO ingrediente (id,codigo,nombre,categoria,unidad,
      costo_unitario,vida_util_crudo_h,vida_util_cocido_h,temp_max_c)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [i.id, i.codigo, i.nombre, i.categoria, i.unidad, i.costoUnitario,
       i.vidaUtilCrudoH, i.vidaUtilCocidoH, i.tempMaxC]);

  for (const r of CATALOGO) {
    await p.query(`INSERT INTO receta (id,codigo,nombre,area_id,porciones_base,
      peso_porcion_g,minutos,tipo_proceso,temp_proceso_c,aceptacion,pasos)
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
  const forzados = [
    { ing: 0, cocido: true, cant: 6.4, temp: 3.2, apto: true, horas: 18, diasAtras: 0 },
    { ing: 8, cocido: true, cant: 2.0, temp: 8.4, apto: true, horas: 9, diasAtras: 0 },
    { ing: 7, cocido: false, cant: 3.1, temp: 4.0, apto: false, horas: 30, diasAtras: 0 },
  ];

  // Los lotes de días anteriores existen para alimentar las series del
  // panel, pero se cierran con una decisión: en una operación real nadie
  // deja un lote de hace cinco días esperando. Solo los de hoy quedan
  // pendientes, y por tanto con vida útil todavía positiva.
  const cerrados: number[] = [];
  let n = 0;
  for (let i = 0; i < 42; i++) {
    const f = forzados[i];
    const ing = INGREDIENTES[f ? f.ing : Math.floor(azar() * INGREDIENTES.length)];
    const cocido = f ? f.cocido : azar() < 0.62;
    const cantidad = f ? f.cant : Math.round((1.2 + azar() * 9.5) * 10) / 10;
    const temp = f ? f.temp : Math.round((2 + azar() * 3) * 10) / 10;
    const apto = f ? f.apto : azar() > 0.08;
    // los tres forzados y otros nueve son de hoy; el resto, de días previos
    const diasAtras = f ? f.diasAtras : (i < 12 ? 0 : Math.floor(1 + azar() * 6));

    let acc = azar(); let causa: Causa = "sobreproduccion";
    for (const c of CAUSAS) { acc -= c.peso; if (acc <= 0) { causa = c.causa; break; } }

    const vidaH = f ? f.horas : (cocido ? ing.vidaUtilCocidoH : ing.vidaUtilCrudoH);
    const reg = new Date(Date.now() - diasAtras * 86_400_000 - azar() * 8 * 3_600_000);
    n++;
    const codigo = `MRM-${String(reg.getFullYear()).slice(2)}`
      + `${String(reg.getMonth() + 1).padStart(2, "0")}`
      + `${String(reg.getDate()).padStart(2, "0")}-${String(n).padStart(4, "0")}`;

    const { rows: ins } = await p.query(`INSERT INTO merma (codigo,ingrediente_id,
      area_id,servicio,cantidad,estado_producto,temperatura_c,causa,apto_reproceso,
      registrado_en,vence_en) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id`,
      [codigo, ing.id, Math.floor(azar() * AREAS.length),
       SERVICIOS[Math.floor(azar() * SERVICIOS.length)], cantidad,
       cocido ? "cocido" : "crudo", temp, causa, apto,
       reg.toISOString(),
       new Date(reg.getTime() + vidaH * 3_600_000).toISOString()]);
    if (diasAtras > 0) cerrados.push(Number(ins[0].id));
  }

  // Cerrar los lotes de días anteriores. Dos tercios se aprobaron y el
  // resto se descartó, que es lo que da forma a la serie "aprovechada".
  for (const id of cerrados) {
    const accion = azar() < 0.68 ? "aprobada" : "descartada";
    await p.query(`INSERT INTO decision (id,merma_id,receta_id,rol,usuario,accion,decidida_en)
      VALUES (gen_random_uuid(),$1,0,'chef','Mateo Calderón',$2,
              (SELECT registrado_en + INTERVAL '2 hours' FROM merma WHERE id = $1))`,
      [id, accion]);
  }

  for (const t of ["area", "servicio", "ingrediente", "receta", "merma", "decision"]) {
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
