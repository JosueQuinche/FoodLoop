/**
 * Ejecuta el motor sobre el caso congelado y vuelca TODA su salida a un
 * archivo, en forma comparable carácter a carácter.
 *
 * Se recorren los lotes de uno en uno y después por parejas, porque la
 * evaluación de conjuntos usa caminos del código que la de un solo lote
 * no toca: el escalado limitado por varios ingredientes, el reparto entre
 * lotes del mismo ingrediente y los contrafactuales de combinación.
 *
 *     npx tsx herramientas/volcar-motor.ts salida.json
 *
 * Dos volcados iguales antes y después de un cambio demuestran que el
 * cambio fue de estructura y no de comportamiento.
 */
import { writeFileSync } from "node:fs";
import { recomendar, sugerirLotes } from "@foodloop/dominio";
import { cargarCaso } from "./caso-motor";

const SALIDA = process.argv[2] ?? "volcado.json";
const PAREJAS = 12;   // lotes cuyas parejas se recorren, para acotar el coste

const caso = cargarCaso();
const { lotes, catalogo, inventario, cargas, ahora } = caso;

/** Reduce un resultado a lo que debe permanecer idéntico. */
const resumir = (r: ReturnType<typeof recomendar>["resultados"][number]) => ({
  receta: r.item.codigo,
  aptitud: r.aptitud,
  porciones: r.porciones,
  kg: r.kgAprovechados,
  costo: r.costoRecuperado,
  enRiesgo: r.valorEnRiesgo,
  escala: Math.round(r.escala * 1e6) / 1e6,
  factores: r.factores.map((f) => [
    f.nombre, f.valorObservado, f.peso, Math.round(f.contribucion * 1e6) / 1e6,
  ]),
  aportes: r.aportes.map((a) => [a.lote.codigo, a.cantidadUsada, a.esPrincipal]),
  resumen: r.resumen,
  contrafactuales: r.contrafactuales,
});

const casos: unknown[] = [];

for (const lote of lotes) {
  const { resultados, descartes } = recomendar(
    [lote], catalogo, inventario, cargas, ahora, 3);
  casos.push({
    entrada: [lote.codigo],
    resultados: resultados.map(resumir),
    descartes,
    sugerencias: sugerirLotes([lote], lotes, catalogo, inventario, cargas, ahora)
      .map((s) => [s.lote.codigo, s.gananciaAptitud, s.motivo]),
  });
}

const base = lotes.slice(0, PAREJAS);
for (let i = 0; i < base.length; i++)
  for (let j = i + 1; j < base.length; j++) {
    const par = [base[i], base[j]];
    const { resultados, descartes } = recomendar(
      par, catalogo, inventario, cargas, ahora, 3);
    casos.push({
      entrada: par.map((l) => l.codigo),
      resultados: resultados.map(resumir),
      descartes,
    });
  }

writeFileSync(SALIDA, JSON.stringify(casos, null, 1));
const prop = casos.reduce(
  (a, c) => a + (c as { resultados: unknown[] }).resultados.length, 0);
console.log(`\n  ${SALIDA}`);
console.log(`  ${casos.length} evaluaciones · ${prop} propuestas\n`);
