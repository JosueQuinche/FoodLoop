/**
 * FoodLoop · Conexión a MongoDB y modelo documental
 *
 * En una base relacional la integridad la imponen el esquema y las
 * claves foráneas. En MongoDB los documentos son flexibles por defecto,
 * de modo que esa integridad hay que declararla explícitamente. Se hace
 * en dos niveles:
 *
 *   · Validadores $jsonSchema en cada colección: tipos, campos
 *     obligatorios, valores permitidos y rangos. La base rechaza un
 *     documento que no los cumpla, venga de donde venga.
 *
 *   · Reglas en el dominio y en los adaptadores para lo que un esquema
 *     no puede expresar, como que un lote no venza antes de registrarse
 *     o que una recomendación se decida una sola vez.
 *
 * MODELO
 *
 *   areas, servicios, ingredientes   catálogos
 *   recetas                          con sus requisitos embebidos
 *   mermas                           un documento por lote
 *   recomendaciones                  con los lotes que consume, los
 *                                    factores de la explicación, la
 *                                    decisión y el feedback embebidos
 *   operacion_diaria                 producción y asistencia por
 *                                    fecha y servicio
 *   usuarios                         cuentas
 *   contadores                       secuencias para identificadores
 *
 * La colección clave es `recomendaciones`: todo lo que ocurre alrededor
 * de una propuesta vive en un único documento, lo que además hace que
 * guardarla sea atómico sin necesidad de transacciones.
 */

import { MongoClient, type Db } from "mongodb";

export interface ConexionMongo {
  cliente: MongoClient;
  db: Db;
}

export async function conectar(uri: string, nombreDb = "foodloop"): Promise<ConexionMongo> {
  const cliente = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10_000,
    // Atlas cierra conexiones ociosas; mantener pocas evita errores
    // intermitentes y no hace falta más para este volumen.
    maxPoolSize: 10,
  });
  await cliente.connect();
  return { cliente, db: cliente.db(nombreDb) };
}

/**
 * Identificadores numéricos autoincrementales.
 *
 * El dominio trabaja con identificadores numéricos para lotes, recetas y
 * recomendaciones. Mantenerlos evita tocar el dominio al cambiar de base,
 * que es justamente lo que promete la arquitectura hexagonal.
 */
export async function siguienteId(db: Db, secuencia: string): Promise<number> {
  const r = await db.collection<{ _id: string; seq: number }>("contadores")
    .findOneAndUpdate(
      { _id: secuencia },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" },
    );
  return r!.seq;
}

// ---------------------------------------------------------------------
// Validadores
// ---------------------------------------------------------------------

const numero = { bsonType: ["int", "long", "double", "decimal"] };

const VALIDADORES: Record<string, object> = {
  areas: {
    bsonType: "object",
    required: ["_id", "nombre", "capacidadKg"],
    properties: {
      nombre: { bsonType: "string" },
      capacidadKg: { ...numero, minimum: 0, exclusiveMinimum: true },
    },
  },
  servicios: {
    bsonType: "object",
    required: ["_id", "nombre", "orden"],
    properties: { nombre: { bsonType: "string" }, orden: numero },
  },
  ingredientes: {
    bsonType: "object",
    required: ["_id", "codigo", "nombre", "categoria", "unidad",
      "costoUnitario", "vidaUtilCrudoH", "vidaUtilCocidoH", "tempMaxC"],
    properties: {
      unidad: { enum: ["kg", "L", "unid"] },
      costoUnitario: { ...numero, minimum: 0 },
      vidaUtilCrudoH: { ...numero, minimum: 1 },
      vidaUtilCocidoH: { ...numero, minimum: 1 },
    },
  },
  recetas: {
    bsonType: "object",
    required: ["_id", "codigo", "nombre", "areaId", "porcionesBase",
      "pesoPorcionG", "minutos", "tipoProceso", "requisitos"],
    properties: {
      tipoProceso: {
        enum: ["reproceso_termico", "ensamblaje_frio", "conservacion", "panaderia"],
      },
      porcionesBase: { ...numero, minimum: 1 },
      aceptacionBase: { ...numero, minimum: 1, maximum: 5 },
      requisitos: {
        bsonType: "array",
        minItems: 1,
        items: {
          bsonType: "object",
          required: ["ingredienteId", "cantidad", "esPrincipal", "admiteEstado"],
          properties: {
            cantidad: { ...numero, minimum: 0, exclusiveMinimum: true },
            admiteEstado: { enum: ["crudo", "cocido", "ambos"] },
          },
        },
      },
    },
  },
  mermas: {
    bsonType: "object",
    required: ["_id", "codigo", "ingredienteId", "areaId", "servicioId",
      "cantidad", "estadoProducto", "temperaturaC", "causa",
      "aptoReproceso", "registradoEn", "venceEn"],
    properties: {
      cantidad: { ...numero, minimum: 0, exclusiveMinimum: true },
      estadoProducto: { enum: ["crudo", "cocido"] },
      causa: {
        enum: ["sobreproduccion", "devolucion_linea", "error_porcionado",
          "caducidad_proxima", "defecto_calidad"],
      },
      aptoReproceso: { bsonType: "bool" },
      registradoEn: { bsonType: "date" },
      venceEn: { bsonType: "date" },
    },
  },
  recomendaciones: {
    bsonType: "object",
    required: ["_id", "recetaId", "generadaEn", "versionModelo", "aptitud",
      "posicion", "aportes"],
    properties: {
      aptitud: { ...numero, minimum: 0, maximum: 100 },
      aportes: {
        bsonType: "array",
        items: {
          bsonType: "object",
          required: ["mermaId", "cantidadUsada", "esPrincipal"],
          properties: { cantidadUsada: { ...numero, minimum: 0, exclusiveMinimum: true } },
        },
      },
      decision: {
        bsonType: "object",
        required: ["id", "rol", "usuario", "accion", "decididaEn"],
        properties: {
          rol: { enum: ["chef", "produccion", "admin", "calidad"] },
          accion: { enum: ["aprobada", "modificada", "descartada"] },
        },
      },
      feedback: {
        bsonType: "array",
        items: {
          bsonType: "object",
          required: ["rol", "usuario", "claridad", "registradoEn"],
          properties: { claridad: { enum: ["clara", "confusa", "insuficiente"] } },
        },
      },
    },
  },
  operacion_diaria: {
    bsonType: "object",
    required: ["fecha", "servicioId", "comensalesPrevistos", "comensalesReales", "produccion"],
    properties: {
      fecha: { bsonType: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      comensalesPrevistos: { ...numero, minimum: 0 },
      comensalesReales: { ...numero, minimum: 0 },
    },
  },
  usuarios: {
    bsonType: "object",
    required: ["_id", "correo", "nombre", "rol", "claveHash", "activo", "creadoEn"],
    properties: {
      correo: { bsonType: "string", pattern: "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$" },
      rol: { enum: ["chef", "produccion", "admin", "calidad"] },
    },
  },
};

/** Crea colecciones, validadores e índices. Idempotente. */
export async function aplicarEsquema(db: Db): Promise<void> {
  const existentes = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));

  for (const [nombre, esquema] of Object.entries(VALIDADORES)) {
    const opciones = {
      validator: { $jsonSchema: esquema },
      validationLevel: "strict" as const,
      validationAction: "error" as const,
    };
    if (existentes.has(nombre))
      await db.command({ collMod: nombre, ...opciones });
    else
      await db.createCollection(nombre, opciones);
  }

  await Promise.all([
    db.collection("mermas").createIndex({ venceEn: 1 }),
    db.collection("mermas").createIndex({ ingredienteId: 1 }),
    db.collection("mermas").createIndex({ registradoEn: -1 }),
    db.collection("mermas").createIndex({ codigo: 1 }, { unique: true }),
    db.collection("recomendaciones").createIndex({ "aportes.mermaId": 1 }),
    db.collection("recomendaciones").createIndex({ recetaId: 1 }),
    db.collection("recomendaciones").createIndex({ generadaEn: -1 }),
    db.collection("operacion_diaria").createIndex(
      { fecha: 1, servicioId: 1 }, { unique: true }),
    db.collection("usuarios").createIndex({ correo: 1 }, { unique: true }),
  ]);
}
