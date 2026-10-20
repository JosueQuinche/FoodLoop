/**
 * Ejecuta el importador de la Fase 2 contra una base en memoria.
 *
 *     npx tsx herramientas/importar-memoria.ts ./datos
 *
 * Sirve para revisar el informe de preparación de datos —qué filas
 * entraron, cuántas se descartaron y por qué— sin necesidad de un
 * servidor de MongoDB. Lo que esta vía no comprueba es el rechazo de
 * documentos por los validadores del servidor; para eso hace falta
 * arrancar MongoDB y ejecutar `npm run importar -- ./datos`.
 *
 * La base queda en memoria y se pierde al terminar, de modo que el
 * comando siguiente la vuelve a construir. Para evaluar el modelo sobre
 * los datos cargados, `herramientas/evaluar-historico.ts` hace las dos
 * cosas en una sola ejecución.
 */
import { baseEnMemoria } from "./db-memoria.mjs";
import { importar } from "../backend/src/infraestructura/adaptadores/salida/mongo/importar";

async function principal() {
  const carpeta = process.argv[2] ?? "./datos";
  const db = baseEnMemoria() as never;
  await importar(carpeta, db);
}

principal().catch((e) => { console.error(e); process.exit(1); });
