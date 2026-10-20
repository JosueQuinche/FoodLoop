/**
 * Sustituto de MongoDB en memoria, para ejecutar las fases de la
 * metodología sin un servidor.
 *
 * Por qué existe: las cuatro fases y la semilla aceptan una base externa
 * (`dbExterna`), de modo que pueden ejecutarse contra cualquier objeto
 * que presente la parte del controlador que usan. Este archivo
 * implementa esa parte sobre `mingo`, que resuelve consultas y tuberías
 * de agregación en memoria.
 *
 * Para qué NO sirve: no valida esquemas ni aplica índices únicos. Las
 * cifras que producen las fases al ejecutarse aquí son las mismas que
 * contra un servidor real, porque dependen del motor de dominio y de
 * los datos, no del almacenamiento. Lo que no se puede comprobar aquí
 * es el rechazo de documentos mal formados por el validador, que es
 * cosa del servidor.
 *
 *     node herramientas/db-memoria.mjs            → ejecuta las 4 fases
 *     node herramientas/db-memoria.mjs fase2      → solo una
 */

import { Query, Aggregator } from "mingo";
// En mingo 7 los operadores se registran con solo importarlos.
import "mingo/operators/accumulator";
import "mingo/operators/expression";
import "mingo/operators/pipeline";
import "mingo/operators/query";

const clonar = (d) => structuredClone(d);

/** Aplica los operadores de actualización que usan los repositorios. */
function aplicarCambio(doc, cambio) {
  for (const [op, campos] of Object.entries(cambio)) {
    for (const [ruta, valor] of Object.entries(campos)) {
      const partes = ruta.split(".");
      let destino = doc;
      for (const p of partes.slice(0, -1)) destino = (destino[p] ??= {});
      const clave = partes.at(-1);
      if (op === "$set") destino[clave] = valor;
      else if (op === "$unset") delete destino[clave];
      else if (op === "$inc") destino[clave] = (destino[clave] ?? 0) + valor;
      else if (op === "$push") (destino[clave] ??= []).push(valor);
      else if (op === "$setOnInsert") { /* lo trata upsert */ }
      else throw new Error(`operador no soportado: ${op}`);
    }
  }
  return doc;
}

function cursor(docs) {
  let salida = docs;
  const c = {
    sort(s) {
      const campos = Object.entries(s);
      salida = [...salida].sort((a, b) => {
        for (const [k, dir] of campos) {
          const va = a[k], vb = b[k];
          if (va < vb) return -dir;
          if (va > vb) return dir;
        }
        return 0;
      });
      return c;
    },
    limit(n) { salida = salida.slice(0, n); return c; },
    skip(n) { salida = salida.slice(n); return c; },
    project() { return c; },
    async toArray() { return salida.map(clonar); },
    [Symbol.asyncIterator]: async function* () { for (const d of salida) yield clonar(d); },
  };
  return c;
}

function coleccion(almacen, nombre) {
  almacen[nombre] ??= [];
  const docs = () => almacen[nombre];
  return {
    find(filtro = {}) { return cursor(new Query(filtro).find(docs()).all()); },
    async findOne(filtro = {}) {
      const r = new Query(filtro).find(docs()).all();
      return r.length ? clonar(r[0]) : null;
    },
    async countDocuments(filtro = {}) { return new Query(filtro).find(docs()).all().length; },
    /**
     * `$lookup` necesita saber resolver una colección por su nombre, y
     * mingo no lo hace solo: se le pasa el resolvedor que devuelve los
     * documentos de cualquier colección del mismo almacén. Sin esto,
     * cualquier consulta con cruce entre colecciones responde 500.
     */
    aggregate(tuberia = []) {
      const opciones = {
        collectionResolver: (otra) => (almacen[otra] ??= []),
      };
      return cursor(new Aggregator(tuberia, opciones).run(docs()));
    },
    async insertOne(doc) { docs().push(clonar(doc)); return { acknowledged: true, insertedId: doc._id }; },
    async insertMany(lista) {
      for (const d of lista) docs().push(clonar(d));
      return { acknowledged: true, insertedCount: lista.length };
    },
    async updateOne(filtro, cambio, opciones = {}) {
      const encontrados = new Query(filtro).find(docs()).all();
      if (encontrados.length === 0) {
        if (!opciones.upsert) return { matchedCount: 0, modifiedCount: 0 };
        const nuevo = aplicarCambio({ ...filtro, ...(cambio.$setOnInsert ?? {}) }, cambio);
        docs().push(nuevo);
        return { matchedCount: 0, modifiedCount: 0, upsertedId: nuevo._id };
      }
      const indice = docs().indexOf(encontrados[0]);
      aplicarCambio(docs()[indice], cambio);
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async findOneAndUpdate(filtro, cambio, opciones = {}) {
      const r = await this.updateOne(filtro, cambio, opciones);
      const despues = new Query(filtro).find(docs()).all()[0] ?? null;
      void r;
      return opciones.includeResultMetadata === false || opciones.returnDocument
        ? (despues ? clonar(despues) : null)
        : { value: despues ? clonar(despues) : null };
    },
    async deleteMany(filtro = {}) {
      const fuera = new Set(new Query(filtro).find(docs()).all());
      const antes = docs().length;
      almacen[nombre] = docs().filter((d) => !fuera.has(d));
      return { deletedCount: antes - almacen[nombre].length };
    },
    async createIndex() { return "índice-simulado"; },
  };
}

export function baseEnMemoria() {
  const almacen = Object.create(null);
  return {
    collection: (n) => coleccion(almacen, n),
    listCollections: () => ({ toArray: async () => Object.keys(almacen).map((name) => ({ name })) }),
    createCollection: async (n) => { almacen[n] ??= []; return coleccion(almacen, n); },
    command: async () => ({ ok: 1 }),
    _almacen: almacen,
  };
}
