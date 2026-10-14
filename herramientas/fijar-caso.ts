/**
 * Congela un caso de prueba del motor en un archivo JSON.
 *
 * La semilla crea los lotes con vencimientos relativos al momento de
 * sembrar, de modo que dos ejecuciones distintas producen vidas útiles
 * distintas y las puntuaciones no son comparables entre ellas. Este
 * comando guarda los lotes, el catálogo, el inventario, las cargas y el
 * instante de evaluación con fechas absolutas, para que cualquier
 * ejecución posterior parta exactamente de la misma entrada.
 *
 * Es lo que permite demostrar que una reestructuración del motor no
 * cambió ninguna de sus salidas.
 *
 *     npx tsx herramientas/fijar-caso.ts
 */
import { writeFileSync } from "node:fs";
import { baseEnMemoria } from "./db-memoria.mjs";
import { aplicarEsquema } from "../backend/src/infraestructura/adaptadores/salida/mongo/conexion";
import { sembrar } from "../backend/src/infraestructura/adaptadores/salida/mongo/semilla";
import {
  LotesMongo, CatalogoMongo, CargasMongo,
} from "../backend/src/infraestructura/adaptadores/salida/mongo/repositorios";

const SALIDA = "herramientas/caso-motor.json";

async function principal() {
  const db = baseEnMemoria() as never;
  await aplicarEsquema(db);
  await sembrar(db);

  const repoLotes = new LotesMongo(db);
  const caso = {
    ahora: new Date().toISOString(),
    lotes: await repoLotes.listarPendientes(),
    catalogo: await new CatalogoMongo(db).listarActivos(),
    inventario: [...(await repoLotes.inventarioDisponible())],
    cargas: [...(await new CargasMongo(db).cargasPorArea())],
  };

  writeFileSync(SALIDA, JSON.stringify(caso, null, 1));
  console.log(`\n  ${SALIDA}`);
  console.log(`  ${caso.lotes.length} lotes · ${caso.catalogo.length} recetas\n`);
}

principal().catch((e) => { console.error(e); process.exit(1); });
