/**
 * FoodLoop · Arranque del backend
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import { crearContenedor } from "./infraestructura/configuracion/contenedor";
import { crearRutas } from "./infraestructura/adaptadores/entrada/http/rutas";

const PUERTO = Number(process.env.PORT ?? 3001);
const CADENA = process.env.DATABASE_URL
  ?? "postgres://postgres:postgres@localhost:5432/foodloop";

async function arrancar() {
  const contenedor = await crearContenedor(CADENA);

  // En un despliegue nuevo la base existe pero está vacía. Sembrar aquí
  // evita tener que abrir una consola remota solo para cargar el catálogo.
  // Se comprueba el catálogo, no las mermas: unas mermas vacías pueden ser
  // un estado legítimo, un catálogo vacío nunca lo es.
  const { rows } = await contenedor.piscina.query(
    "SELECT COUNT(*)::int AS n FROM receta");
  if (rows[0].n === 0) {
    console.log("  Base vacía: cargando catálogo inicial…");
    const { sembrar } = await import(
      "./infraestructura/adaptadores/salida/postgres/semilla");
    await sembrar();
  }
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use("/api", crearRutas(contenedor));

  app.listen(PUERTO, () => {
    console.log(`\n  Backend FoodLoop en http://localhost:${PUERTO}`);
    console.log(`  PostgreSQL: ${CADENA.replace(/:[^:@]+@/, ":****@")}\n`);
  });
}

arrancar().catch((e) => {
  console.error("\n  No se pudo arrancar el backend:\n ", e.message);
  console.error("\n  Comprueba que PostgreSQL esté corriendo y que exista la base:");
  console.error("    createdb foodloop");
  console.error("  y que DATABASE_URL en backend/.env sea correcta.\n");
  process.exit(1);
});
