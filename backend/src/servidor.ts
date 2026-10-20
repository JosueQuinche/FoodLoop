/**
 * FoodLoop · Arranque del backend
 *
 * DÓNDE ESTÁ EL MODELO
 *
 * Aquí no. Esta carpeta no contiene ninguna regla del modelo de
 * recomendación: el backend recibe peticiones, lee y escribe documentos
 * y llama a casos de uso.
 *
 * El modelo vive en `dominio/src/servicios/motor/`, un paquete aparte,
 * repartido en las seis etapas que lo componen:
 *
 *   e1-entrada.ts         normaliza la entrada y recibe el instante
 *   e2-restricciones.ts   las seis reglas duras, ANTES de puntuar
 *   e3-caracteristicas.ts siete valores en [0,1] por candidata
 *   e4-puntuacion.ts      suma ponderada, guardando cada término
 *   e5-ordenamiento.ts    orden y desempates declarados
 *   e6-explicacion.ts     descompone la puntuación y el contrafactual
 *
 * y los parámetros en `pesos.ts`, separados del código que los aplica.
 *
 * Está así para que el motor pueda ejecutarse, probarse y auditarse sin
 * servidor ni base de datos. `npm run verificar` lo comprueba en cada
 * compilación. La documentación completa está en `backend/README.md`.
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import { crearContenedor } from "./infraestructura/configuracion/contenedor";
import { crearRutas } from "./infraestructura/adaptadores/entrada/http/rutas";

const PUERTO = Number(process.env.PORT ?? 3001);
const URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017";
const NOMBRE_DB = process.env.MONGODB_DB ?? "foodloop";

/**
 * Fecha de revisión histórica, opcional.
 *
 * Un conjunto de datos histórico no puede alimentar un panel «en vivo»:
 * los registros del centro van de enero a junio de 2026, de modo que con
 * el reloj del sistema aparecen todos vencidos y el panel sale vacío.
 * Declarando REVISION_FECHA en el .env, el sistema se sitúa en esa fecha
 * y puede recorrerse la operación de ese día.
 *
 * No falsea nada: los registros conservan su fecha. Lo que se mueve es
 * el instante desde el que se los mira, que es el único parámetro que el
 * motor necesita y que ya recibía por la etapa 1 en lugar de leerlo del
 * reloj. La interfaz avisa con una banda en cada pantalla.
 *
 * Ausente —que es lo normal— el sistema usa el reloj del sistema. Es
 * decir, una instalación real no tiene que hacer nada para comportarse
 * como debe; la revisión hay que pedirla expresamente.
 */
const REVISION = process.env.REVISION_FECHA?.trim();

async function arrancar() {
  const fechaRevision = REVISION ? new Date(`${REVISION}T12:00:00`) : null;
  if (REVISION && Number.isNaN(fechaRevision!.getTime())) {
    console.error(
      `\n  REVISION_FECHA no es una fecha válida: "${REVISION}".`
      + "\n  El formato es AAAA-MM-DD, por ejemplo 2026-06-23."
      + "\n  Corrígela en backend/.env, o coméntala para usar el reloj"
      + " del sistema.\n");
    process.exit(1);
  }

  const contenedor = await crearContenedor(URI, NOMBRE_DB, fechaRevision);

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

  // La interfaz pregunta por esta ruta para avisar de que lo que se está
  // mirando es un recorrido histórico y no la operación de hoy.
  app.get("/api/revision", (_req, res) => {
    res.json({
      revisando: fechaRevision ? fechaRevision.toISOString() : null,
      origen: NOMBRE_DB,
    });
  });

  app.use("/api", crearRutas(contenedor));

  app.listen(PUERTO, () => {
    console.log(`\n  Backend FoodLoop en http://localhost:${PUERTO}`);
    console.log(`  MongoDB: ${URI.replace(/:[^:@/]+@/, ":****@")} · base ${NOMBRE_DB}`);
    console.log(fechaRevision
      ? `  REVISIÓN HISTÓRICA situada en ${REVISION}. Quita REVISION_FECHA`
        + " del .env para usar el reloj del sistema.\n"
      : "  Reloj del sistema\n");
  });
}

arrancar().catch((e) => {
  console.error("\n  No se pudo arrancar el backend:\n ", e.message);
  console.error("\n  Revisa MONGODB_URI en backend/.env: debe ser la misma");
  console.error("  cadena con la que te conectas en MongoDB Compass.");
  console.error("  Si la contraseña lleva @ # / %, va codificada (@ es %40).\n");
  process.exit(1);
});
