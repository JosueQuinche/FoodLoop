/**
 * Ejecuta las cuatro fases de la metodología y deja las evidencias en
 * disco.
 *
 *     npx tsx herramientas/ejecutar-fases.ts
 *         las cuatro sobre la semilla de ejemplo
 *
 *     npx tsx herramientas/ejecutar-fases.ts --datos=./datos --reloj=porLote
 *         las cuatro sobre los datos del centro, situando cada lote en su
 *         propio registro: es la forma correcta de evaluar un conjunto
 *         histórico, y sin ella las métricas salen en cero
 *
 *     npx tsx herramientas/ejecutar-fases.ts fase2 --datos=./datos \
 *         --reloj=porLote --modo=potencial
 *         una sola fase, con las reglas que dependen de campos no
 *         medidos aplazadas
 *
 *     ... --evidencias=./evidencias
 *         además de imprimir, escribe un .txt por fase con la
 *         transcripción y un .json con las métricas, para el anexo
 *
 * Contra un servidor de MongoDB real se usan `npm run fase1` … `fase4`,
 * que aceptan los mismos parámetros por variable de entorno. Las cifras
 * son las mismas: dependen del motor de dominio y de los datos, no de
 * dónde estén guardados. Lo que esta vía en memoria NO comprueba es el
 * rechazo de documentos por los validadores del servidor, que exige
 * MongoDB de verdad.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { baseEnMemoria } from "./db-memoria.mjs";
import { aplicarEsquema } from "../backend/src/infraestructura/adaptadores/salida/mongo/conexion";
import { sembrar } from "../backend/src/infraestructura/adaptadores/salida/mongo/semilla";
import { importar } from "../backend/src/infraestructura/adaptadores/salida/mongo/importar";
import { fase1 } from "../backend/src/infraestructura/adaptadores/salida/mongo/fase1";
import { fase2 } from "../backend/src/infraestructura/adaptadores/salida/mongo/fase2";
import { fase3 } from "../backend/src/infraestructura/adaptadores/salida/mongo/fase3";
import { fase4 } from "../backend/src/infraestructura/adaptadores/salida/mongo/fase4";
import {
  Registro, type OpcionesFase,
} from "../backend/src/infraestructura/adaptadores/salida/mongo/fases-comun";
import type { ModoModelo } from "@foodloop/dominio";

const args = process.argv.slice(2);
const bandera = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=");
const cual = args.find((a) => !a.startsWith("--"));

function leerReloj(): OpcionesFase["reloj"] {
  const v = bandera("reloj");
  if (!v) return undefined;
  if (v === "porLote") return "porLote";
  const d = new Date(v.length === 10 ? `${v}T12:00:00` : v);
  if (Number.isNaN(d.getTime()))
    throw new Error(`--reloj no se entiende: "${v}". Use porLote o una fecha AAAA-MM-DD.`);
  return d;
}

async function principal() {
  const carpeta = bandera("datos");
  const destino = bandera("evidencias");
  const modo = (bandera("modo") ?? "operacion") as ModoModelo;
  if (modo !== "operacion" && modo !== "potencial")
    throw new Error(`--modo debe ser operacion o potencial, no "${modo}".`);

  const db = baseEnMemoria() as never;
  await aplicarEsquema(db);
  if (carpeta) await importar(carpeta, db as never);
  else await sembrar(db);

  if (destino) mkdirSync(destino, { recursive: true });

  const fases: Record<string, (d: never, o: OpcionesFase) => Promise<unknown>> =
    { fase1, fase2, fase3, fase4 };

  const resumen: Record<string, unknown> = {
    generadoEn: new Date().toISOString(),
    origenDatos: carpeta ?? "semilla de ejemplo",
    reloj: bandera("reloj") ?? "reloj del sistema",
    modo,
    fases: {} as Record<string, unknown>,
  };

  for (const [nombre, fn] of Object.entries(fases)) {
    if (cual && cual !== nombre) continue;
    const registro = new Registro();
    console.log("\n" + "=".repeat(70) + `\n${nombre.toUpperCase()}\n` + "=".repeat(70));
    await fn(db, { reloj: leerReloj(), modo, registro });

    if (destino) {
      writeFileSync(join(destino, `${nombre}.txt`), registro.texto(), "utf-8");
      writeFileSync(join(destino, `${nombre}.json`), JSON.stringify({
        contexto: registro.contexto, metricas: registro.metricas,
      }, null, 2), "utf-8");
      (resumen.fases as Record<string, unknown>)[nombre] = {
        contexto: registro.contexto,
        metricas: Object.fromEntries(registro.metricas.map((m) => [m.clave, m.valor])),
      };
    }
  }

  if (destino) {
    writeFileSync(join(destino, "resumen.json"), JSON.stringify(resumen, null, 2), "utf-8");
    console.log(`\n  Evidencias escritas en ${destino}/`);
  }
}

principal().catch((e) => { console.error(e); process.exit(1); });
