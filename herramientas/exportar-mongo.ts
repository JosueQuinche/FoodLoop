/**
 * Exporta los datos del centro ya transformados a documentos de MongoDB.
 *
 *     npx tsx herramientas/exportar-mongo.ts ./datos ./mongo-export
 *
 * PARA QUÉ SIRVE ESTO, Y PARA QUÉ NO
 *
 * La vía normal de llevar los datos a MongoDB es `npm run importar --
 * ./datos`, que conecta con el servidor, aplica el esquema y escribe las
 * colecciones. Esa es la que se usa y la que deja todo consistente.
 *
 * Esta herramienta existe para otra cosa: entregar los documentos como
 * archivos, en el formato que `mongoimport` acepta, de modo que se
 * puedan cargar en una base sin tener que ejecutar el proyecto. Sirve
 * para el anexo de la tesis, para pasárselos a un tercero y para
 * revisarlos a mano antes de cargarlos.
 *
 * Los documentos son LOS MISMOS que escribiría el importador: se
 * producen recorriendo exactamente el mismo código, sobre una base en
 * memoria, y se vuelcan después. No hay una segunda transformación que
 * pudiera divergir de la primera.
 *
 * LAS FECHAS
 *
 * Se escriben como {"$date": "..."} y no como texto. Es la diferencia
 * entre que MongoDB guarde una fecha o guarde una cadena: con texto, los
 * validadores `$jsonSchema` rechazan el documento, y aunque pasaran, el
 * motor no podría comparar vencimientos. Ese formato es JSON extendido
 * canónico, que es lo que `mongoimport` interpreta.
 *
 * LAS CUENTAS NO SE EXPORTAN
 *
 * La colección `usuarios` lleva hashes de contraseña. No son datos del
 * centro, son credenciales, y no tienen por qué viajar en un anexo. Las
 * cuentas se crean con `npm run semilla` o registrándose en el prototipo.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { baseEnMemoria } from "./db-memoria.mjs";
import { aplicarEsquema } from "../backend/src/infraestructura/adaptadores/salida/mongo/conexion";
import { importar } from "../backend/src/infraestructura/adaptadores/salida/mongo/importar";
import type { Db } from "mongodb";

/** Colecciones que se exportan, en orden de dependencia. */
const COLECCIONES = [
  "areas", "servicios", "ingredientes", "recetas",
  "operacion_diaria", "mermas",
] as const;

/** Colecciones que existen pero NO se exportan, y por qué. */
const EXCLUIDAS: Record<string, string> = {
  usuarios: "lleva hashes de contraseña; se crean con `npm run semilla`",
  recomendaciones: "las genera el uso del prototipo, no la importación",
  decisiones: "las genera el uso del prototipo, no la importación",
};

/**
 * Convierte las fechas a JSON extendido. Recorre el documento entero
 * porque hay fechas anidadas dentro de arreglos (`produccion`) y de
 * subdocumentos.
 */
function aExtendido(v: unknown): unknown {
  if (v instanceof Date) return { $date: v.toISOString() };
  if (Array.isArray(v)) return v.map(aExtendido);
  if (v && typeof v === "object") {
    const salida: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>))
      salida[k] = aExtendido(x);
    return salida;
  }
  return v;
}

async function principal() {
  const carpeta = process.argv[2] ?? "./datos";
  const destino = process.argv[3] ?? "./mongo-export";

  const db = baseEnMemoria() as unknown as Db;
  await aplicarEsquema(db);
  await importar(carpeta, db);

  mkdirSync(destino, { recursive: true });
  console.log("\n  DOCUMENTOS DE MONGODB EXPORTADOS");
  console.log("  " + "─".repeat(64));

  const resumen: { coleccion: string; documentos: number; archivo: string }[] = [];
  for (const nombre of COLECCIONES) {
    const docs = await db.collection(nombre).find().toArray();
    const archivo = `${nombre}.json`;
    writeFileSync(join(destino, archivo),
      JSON.stringify(docs.map(aExtendido), null, 1), "utf-8");
    resumen.push({ coleccion: nombre, documentos: docs.length, archivo });
    console.log(`  ${nombre.padEnd(20)} ${String(docs.length).padStart(6)} documentos  →  ${archivo}`);
  }

  console.log("\n  No exportadas:");
  for (const [c, porQue] of Object.entries(EXCLUIDAS))
    console.log(`  ${c.padEnd(20)} ${porQue}`);

  // Instrucciones junto a los datos: quien reciba la carpeta suelta, sin
  // el repositorio, tiene que poder cargarla igual.
  const comandos = COLECCIONES.map((c) =>
    `mongoimport --db foodloop --collection ${c} --file ${c}.json --jsonArray --drop`,
  ).join("\n");

  writeFileSync(join(destino, "LEEME.md"), `# Datos del centro, en documentos de MongoDB

Generado con \`npm run exportar:mongo\` a partir de \`${carpeta}\`.
Son los mismos documentos que escribe \`npm run importar -- ./datos\`:
se producen con el mismo código, sobre una base en memoria, y se
vuelcan después.

## Contenido

| Colección | Documentos | Archivo |
| --- | ---: | --- |
${resumen.map((r) => `| ${r.coleccion} | ${r.documentos} | ${r.archivo} |`).join("\n")}

Las fechas van como \`{"$date": "..."}\` (JSON extendido canónico). En
texto plano los validadores \`$jsonSchema\` rechazarían los documentos y
el motor no podría comparar vencimientos.

No se exportan:

${Object.entries(EXCLUIDAS).map(([c, p]) => `- \`${c}\`: ${p}`).join("\n")}

## Cómo cargarlos

Primero cree las colecciones con sus validadores e índices, desde la
raíz del proyecto:

\`\`\`
npm run esquema
\`\`\`

Importar sin ese paso también funciona, pero las colecciones quedan sin
validadores ni índices: MongoDB aceptaría después documentos que el
modelo considera inválidos.

Después, desde esta carpeta:

\`\`\`
${comandos}
\`\`\`

\`--drop\` reemplaza la colección. Quítelo si quiere añadir en lugar de
reemplazar.

## La vía recomendada

Si tiene el proyecto a mano, esto es más simple y hace lo mismo:

\`\`\`
npm run importar -- ./datos
\`\`\`

Conecta, aplica el esquema y escribe las colecciones en un solo paso.
`, "utf-8");

  console.log(`\n  Escrito en ${destino}/ · ${resumen.reduce((a, r) => a + r.documentos, 0)} documentos`);
  console.log(`  Instrucciones de carga en ${destino}/LEEME.md\n`);
}

principal().catch((e) => { console.error(e); process.exit(1); });
