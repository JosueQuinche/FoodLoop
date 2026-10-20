/**
 * FoodLoop · Inspector del modelo
 *
 * Ejecuta el modelo sobre una selección de lotes e imprime las seis
 * etapas una por una: qué entra, qué sale, qué se mide y de dónde sale
 * cada cifra que el usuario acaba leyendo.
 *
 * Existe porque la interfaz muestra el resultado del modelo pero no el
 * modelo. Quien tenga que juzgar si esto es un modelo de decisión o un
 * programa que ordena recetas necesita ver la aritmética, y la
 * aritmética no cabe en una pantalla de cocina.
 *
 *     npx tsx herramientas/inspeccionar-modelo.ts                 el lote más urgente
 *     npx tsx herramientas/inspeccionar-modelo.ts MER-0007        un lote concreto
 *     npx tsx herramientas/inspeccionar-modelo.ts MER-0007 MER-0012   un conjunto
 *     npx tsx herramientas/inspeccionar-modelo.ts --todos         tabla de todos los lotes
 *
 * Requiere el caso congelado: npx tsx herramientas/fijar-caso.ts
 */
import {
  ejecutarModelo, CARACTERISTICAS, PARAMETROS, REGLAS, cotaSuperior, PENDIENTE,
  horasRestantes, VERSION_MODELO,
} from "@foodloop/dominio";
import type { Caracteristica, TrazaModelo } from "@foodloop/dominio";
import { cargarCaso } from "./caso-motor";

const A = 74;
const linea = (c = "─") => console.log("  " + c.repeat(A));
const t = (s: string) => { console.log(`\n  ${s}`); linea("═"); };
const fila = (k: string, v: string) =>
  console.log(`  ${k.padEnd(46)}${v.padStart(A - 46)}`);

/** Abrevia el nombre del eje para que la matriz quepa a lo ancho. */
const CORTO: Record<Caracteristica, string> = {
  cobertura: "cobert", aporteMerma: "aporte", urgencia: "urgenc",
  absorcion: "absorc", jerarquia: "jerarq", aceptacion: "acepta",
  cargaArea: "carga",
};

const caso = cargarCaso();
const { lotes, catalogo, inventario, cargas, ahora } = caso;

// ---------------------------------------------------------------------
// Modo tabla: una línea por lote, para ver el comportamiento global
// ---------------------------------------------------------------------
if (process.argv[2] === "--todos") {
  t(`MODELO ${VERSION_MODELO} · COMPORTAMIENTO SOBRE ${lotes.length} LOTES`);

  // El ancho del primer campo sale del código más largo del conjunto: con
  // un ancho fijo, los códigos reales (MRM-AAMMDD-NNNN) desbordaban la
  // columna y se pegaban a las horas.
  const W = Math.max(6, ...lotes.map((l) => l.codigo.length)) + 2;
  const linea_de = (cod: string, h: string, adm: string, desc: string,
                    prop: string, apt: string, ms: string) =>
    `  ${cod.padEnd(W)}${h.padStart(5)}${adm.padStart(6)}${desc.padStart(6)}  `
    + `${prop.slice(0, 26).padEnd(27)}${apt.padStart(8)}${ms.padStart(5)}`;

  console.log(linea_de("lote", "h", "adm", "desc", "1.ª propuesta",
    "aptitud", "ms"));
  linea();
  for (const l of lotes) {
    const s = ejecutarModelo([l], catalogo, inventario, cargas, ahora, { topN: 3 });
    const e2 = s.traza.etapas[1].detalle as { admisibles: string[] };
    const r = s.resultados[0];
    console.log(linea_de(
      l.codigo,
      horasRestantes(l, ahora).toFixed(0),
      String(e2.admisibles.length),
      String(s.descartes.length),
      r ? r.item.nombre : "— ninguna",
      r ? r.aptitud.toFixed(1) : "—",
      String(s.traza.ms)));
  }
  linea();
  console.log();
  process.exit(0);
}

// ---------------------------------------------------------------------
// Selección
// ---------------------------------------------------------------------
const pedidos = process.argv.slice(2).filter((a) => !a.startsWith("--"));

/**
 * Sin lote indicado se elige el más urgente de los que todavía pueden
 * recomendarse: vigente, con dictamen favorable y con al menos una
 * propuesta. Elegir el más urgente a secas devolvía un lote vencido
 * hacía días, que es un caso real pero no sirve para mostrar el modelo:
 * la etapa 2 lo descarta y las cuatro siguientes quedan vacías.
 */
function porDefecto() {
  const viables = [...lotes]
    .filter((l) => l.aptoReproceso && horasRestantes(l, ahora) > 0)
    .sort((a, b) => horasRestantes(a, ahora) - horasRestantes(b, ahora));
  for (const l of viables) {
    const s = ejecutarModelo([l], catalogo, inventario, cargas, ahora, { topN: 1 });
    if (s.resultados.length > 0) return l;
  }
  return viables[0] ?? lotes[0];
}

const seleccion = pedidos.length
  ? pedidos.map((c) => {
      const l = lotes.find((x) => x.codigo === c);
      if (!l) { console.error(`\n  No existe el lote ${c} en el caso.\n`); process.exit(1); }
      return l;
    })
  : [porDefecto()];

const salida = ejecutarModelo(
  seleccion, catalogo, inventario, cargas, ahora, { topN: 3 });
const { traza } = salida;
const etapa = (i: number) => traza.etapas[i];
const det = <T>(i: number) => etapa(i).detalle as T;

// ---------------------------------------------------------------------
t(`MODELO FOODLOOP ${VERSION_MODELO} · EJECUCIÓN COMPLETA`);
console.log("  Recomendador basado en conocimiento con explicación incorporada.");
console.log("  Seis etapas. Ninguna consulta la base de datos ni lee el reloj:");
console.log("  todo entra por la etapa 1, de modo que la ejecución es reproducible.");
console.log();
fila("Instante de evaluación", ahora.toISOString().slice(0, 16).replace("T", " "));
fila("Lotes seleccionados", seleccion.map((l) => l.codigo).join(" + "));
fila("Catálogo", `${catalogo.length} recetas`);
fila("Tiempo total del modelo", `${traza.ms} ms`);

// ---------------------------------------------------------------------
t("E1 · ENTRADA DE DATOS");
const d1 = det<{
  lotes: string[]; kgSeleccionados: number; horasMinimas: number | null;
  rechazos: { que: string; motivo: string }[];
}>(0);
console.log(`  entra  ${etapa(0).entra}`);
console.log(`  sale   ${etapa(0).sale}`);
console.log();
for (const l of seleccion)
  fila(`  ${l.codigo} · ${l.ingrediente} ${l.estadoProducto}`,
    `${l.cantidad.toFixed(1)} ${l.unidad} · ${horasRestantes(l, ahora).toFixed(0)} h · `
    + `${l.temperaturaC} °C · ${l.aptoReproceso ? "apto" : "SIN DICTAMEN"}`);
const unidades = new Set(seleccion.map((l) => l.unidad));
fila("Total seleccionado", `${d1.kgSeleccionados.toFixed(1)} `
  + (unidades.size === 1 ? [...unidades][0] : "unidades mezcladas"));
fila("Ventana del conjunto", `${(d1.horasMinimas ?? 0).toFixed(1)} h`);
if (d1.rechazos.length) {
  console.log("\n  Rechazado en la entrada:");
  for (const r of d1.rechazos) fila(`  ${r.que}`, r.motivo);
} else {
  console.log("\n  Nada rechazado: todos los datos de entrada son utilizables.");
}

// ---------------------------------------------------------------------
t("E2 · RESTRICCIONES DURAS");
console.log(`  entra  ${etapa(1).entra}`);
console.log(`  sale   ${etapa(1).sale}`);
console.log();
console.log("  Seis reglas binarias. Una restricción sanitaria no se compensa");
console.log("  con una puntuación alta en otro eje: la receta no llega a puntuarse.");
console.log();
for (const r of Object.values(REGLAS))
  console.log(`  ${r.codigo} · ${r.titulo.padEnd(38)} ${r.alcance}`);

console.log("\n  Recetas descartadas y regla que lo decide:");
linea();
if (traza.descartesDetallados.length === 0) {
  console.log("  Ninguna.");
} else {
  for (const d of traza.descartesDetallados) {
    const inc = d.incumplimientos[0];
    const etiq = d.decisiva === "R0"
      ? "sin ingrediente en común"
      : `${REGLAS[d.decisiva!].titulo}`;
    console.log(`  ${d.receta.padEnd(10)} ${d.decisiva}  ${etiq.padEnd(34)}`
      + `${inc.lote ? inc.lote + " · " : ""}${inc.observado}`);
  }
}

// ---------------------------------------------------------------------
t("E3 · EXTRACCIÓN DE CARACTERÍSTICAS");
console.log(`  entra  ${etapa(2).entra}`);
console.log(`  sale   ${etapa(2).sale}`);
console.log();
console.log("  Cada receta admisible se convierte en siete números en [0,1].");
console.log("  Esta etapa NO conoce los pesos: solo mide.");
console.log();
console.log("  receta     " + CARACTERISTICAS.map((c) => CORTO[c].padStart(7)).join(""));
linea();
for (const v of traza.vectores)
  console.log(`  ${v.receta.padEnd(11)}`
    + CARACTERISTICAS.map((c) => v.valores[c].toFixed(2).padStart(7)).join(""));

// ---------------------------------------------------------------------
t("E4 · PUNTUACIÓN");
console.log(`  entra  ${etapa(3).entra}`);
console.log(`  sale   ${etapa(3).sale}`);
console.log();
console.log("  aptitud = recorte( Σ pesoᵢ · característicaᵢ · 100 , 0 , 100 )");
console.log();
console.log("  eje        peso   origen     por qué pesa lo que pesa");
linea();
for (const c of CARACTERISTICAS) {
  const p = PARAMETROS[c];
  console.log(`  ${CORTO[c].padEnd(10)}${p.valor.toFixed(2).padStart(5)}   `
    + `${p.origen.padEnd(10)} ${p.fundamento.split(".")[0].slice(0, 44)}`);
}
linea();
fila("Suma de pesos positivos", (cotaSuperior() / 100).toFixed(2));
fila("Cota superior de la aptitud", cotaSuperior().toFixed(0));
fila("Propuestas recortadas en esta ejecución",
  String((det<{ recortadas: number }>(3)).recortadas));

const mejor = traza.vectores.find((v) => v.receta === salida.resultados[0]?.item.codigo);
if (mejor) {
  console.log(`\n  Aritmética completa de la primera propuesta · ${mejor.receta}`);
  linea();
  console.log("  eje          valor      ×   peso   × 100  =  contribución");
  let suma = 0;
  for (const c of CARACTERISTICAS) {
    suma += mejor.contribuciones[c];
    console.log(`  ${CORTO[c].padEnd(10)}`
      + `${mejor.valores[c].toFixed(4).padStart(9)}`
      + `${PARAMETROS[c].valor.toFixed(2).padStart(10)}`
      + `${mejor.contribuciones[c].toFixed(3).padStart(21)}`);
  }
  linea();
  fila("Suma", suma.toFixed(3));
  fila("Aptitud publicada (redondeo a un decimal)", mejor.aptitud.toFixed(1));
}

// ---------------------------------------------------------------------
t("E5 · ORDENAMIENTO");
console.log(`  entra  ${etapa(4).entra}`);
console.log(`  sale   ${etapa(4).sale}`);
console.log();
console.log("  Criterio: aptitud · kg aprovechados · ventana más corta · código.");
console.log("  Los tres desempates están declarados para que la salida no dependa");
console.log("  del orden en que el catálogo venga de la base de datos.");
console.log();
for (const [pos, cod, apt] of det<{ ranking: [number, string, number][] }>(4).ranking)
  fila(`  ${pos}.º  ${cod}`, `${apt.toFixed(1)}`);

// ---------------------------------------------------------------------
t("E6 · EXPLICACIÓN");
console.log(`  entra  ${etapa(5).entra}`);
console.log(`  sale   ${etapa(5).sale}`);
console.log();
const r0 = salida.resultados[0];
if (!r0) {
  console.log("  El modelo no propuso nada para esta selección.");
} else {
  console.log(`  ${r0.item.nombre} · aptitud ${r0.aptitud.toFixed(1)}`);
  linea();
  console.log(`  Resumen         ${r0.resumen}`);
  console.log(`  Contrafactual   ${r0.contrafactuales[0]}`);
  console.log();
  console.log("  Descomposición que ve el usuario:");
  for (const f of r0.factores)
    console.log(`    ${f.nombre.slice(0, 40).padEnd(41)}`
      + `${f.valorObservado.slice(0, 25).padEnd(26)}`
      + `${f.contribucion >= 0 ? "+" : ""}${f.contribucion.toFixed(1).padStart(5)}`);
  linea();
  const comp = det<{ comprobacion: { sumaFactores: number; aptitud: number }[] }>(5)
    .comprobacion[0];
  fila("Suma de las contribuciones mostradas", comp.sumaFactores.toFixed(1));
  fila("Aptitud publicada", comp.aptitud.toFixed(1));
  console.log(comp.sumaFactores === comp.aptitud
    ? "\n  Coinciden. La explicación es la aritmética del modelo, no una\n"
      + "  reconstrucción posterior de ella."
    : "\n  NO coinciden. La explicación no refleja el cálculo.");
}

// ---------------------------------------------------------------------
t("COSTE POR ETAPA");
for (const e of traza.etapas)
  fila(`${e.codigo} · ${e.nombre}`, `${e.ms} ms`);
linea();
fila("Total", `${traza.ms} ms`);

// ---------------------------------------------------------------------
t("LO QUE ESTE MODELO TODAVÍA NO HACE");
for (const p of PENDIENTE) {
  // en párrafos de ~66 columnas, como el resto de la salida
  const palabras = p.split(" ");
  let lineaTxt = " ";
  for (const w of palabras) {
    if ((lineaTxt + " " + w).length > 68) { console.log(lineaTxt); lineaTxt = " "; }
    lineaTxt += " " + w;
  }
  console.log(lineaTxt);
  console.log();
}

export type { TrazaModelo };
