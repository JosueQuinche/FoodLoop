/**
 * FoodLoop · Arranque del backend
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import { crearContenedor } from "./infraestructura/configuracion/contenedor";
import { crearRutas } from "./infraestructura/adaptadores/entrada/http/rutas";

const PUERTO = Number(process.env.PORT ?? 3001);
const URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
const NOMBRE_DB = process.env.MONGODB_DB ?? "foodloop";

async function arrancar() {
  const contenedor = await crearContenedor(URI, NOMBRE_DB);

  // En un despliegue nuevo la base existe pero está vacía. Sembrar aquí
  // evita tener que cargar los datos a mano. Se comprueba el recetario:
  // unas mermas vacías pueden ser legítimas, un recetario vacío nunca.
  const recetas = await contenedor.db.collection("recetas").countDocuments();
  if (recetas === 0) {
    console.log("  Base vacía: cargando datos iniciales…");
    const { sembrar } = await import(
      "./infraestructura/adaptadores/salida/mongo/semilla");
    await sembrar(contenedor.db);
  }

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use("/api", crearRutas(contenedor));

  app.listen(PUERTO, () => {
    console.log(`\n  Backend FoodLoop en http://localhost:${PUERTO}`);
    console.log(`  MongoDB: ${URI.replace(/:[^:@/]+@/, ":****@")} · base ${NOMBRE_DB}\n`);
  });
}

arrancar().catch((e) => {
  console.error("\n  No se pudo arrancar el backend:\n ", e.message);
  console.error("\n  Revisa MONGODB_URI en backend/.env: debe ser la misma");
  console.error("  cadena con la que te conectas en MongoDB Compass.");
  console.error("  Si la contraseña lleva @ # / %, va codificada (@ es %40).\n");
  process.exit(1);
});
