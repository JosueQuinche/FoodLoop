/**
 * Ejecuta la semilla y las cuatro fases de la metodología contra una base
 * en memoria, sin necesidad de un servidor de MongoDB.
 *
 * Sirve para reproducir las evidencias que recoge el artículo:
 *
 *     npx tsx herramientas/ejecutar-fases.ts          las cuatro
 *     npx tsx herramientas/ejecutar-fases.ts fase2    solo una
 *
 * Contra un servidor real, las cifras son las mismas: dependen del motor
 * de dominio y de los datos sembrados, no del almacenamiento. Lo que esta
 * vía no comprueba es el rechazo de documentos por los validadores del
 * servidor, que se verifica arrancando MongoDB y ejecutando `npm run fase1`.
 */
import { baseEnMemoria } from "./db-memoria.mjs";
import { aplicarEsquema } from "../backend/src/infraestructura/adaptadores/salida/mongo/conexion";
import { sembrar } from "../backend/src/infraestructura/adaptadores/salida/mongo/semilla";
import { fase1 } from "../backend/src/infraestructura/adaptadores/salida/mongo/fase1";
import { fase2 } from "../backend/src/infraestructura/adaptadores/salida/mongo/fase2";
import { fase3 } from "../backend/src/infraestructura/adaptadores/salida/mongo/fase3";
import { fase4 } from "../backend/src/infraestructura/adaptadores/salida/mongo/fase4";

async function principal() {
  const db = baseEnMemoria() as never;
  const cual = process.argv[2];
  await aplicarEsquema(db);
  await sembrar(db);
  const fases: Record<string, (d: never) => Promise<unknown>> = { fase1, fase2, fase3, fase4 };
  for (const [nombre, fn] of Object.entries(fases)) {
    if (cual && cual !== nombre) continue;
    console.log("\n" + "=".repeat(70) + `\n${nombre.toUpperCase()}\n` + "=".repeat(70));
    await fn(db);
  }
}
principal().catch((e) => { console.error(e); process.exit(1); });
