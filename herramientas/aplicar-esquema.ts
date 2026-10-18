/**
 * Crea las colecciones con sus validadores e índices en MongoDB, sin
 * cargar datos.
 *
 *     npm run esquema
 *
 * Es el paso previo a cargar documentos con `mongoimport`. Sin él las
 * colecciones nacen sin validadores: MongoDB aceptaría documentos que el
 * modelo considera inválidos, y el rechazo por esquema —que es una de
 * las evidencias de la Fase 2— no se podría demostrar.
 *
 * `npm run importar` ya lo hace por dentro; esto solo separa ese paso.
 */
import "dotenv/config";
import { conectar, aplicarEsquema } from "../backend/src/infraestructura/adaptadores/salida/mongo/conexion";

const URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
const NOMBRE_DB = process.env.MONGODB_DB ?? "foodloop";

async function principal() {
  console.log(`\n  Servidor: ${URI}\n  Base:     ${NOMBRE_DB}`);
  const { db, cliente } = await conectar(URI, NOMBRE_DB);
  await aplicarEsquema(db);
  const nombres = (await db.listCollections().toArray()).map((c) => c.name).sort();
  console.log(`\n  Colecciones listas (${nombres.length}): ${nombres.join(", ")}\n`);
  await cliente.close();
}
principal().catch((e) => {
  console.error("\n  No se pudo aplicar el esquema:\n ", e.message, "\n");
  process.exit(1);
});
