/**
 * FoodLoop · Pruebas de las seis etapas del modelo
 *
 * Cada etapa se prueba por separado, con datos construidos para el caso
 * que se quiere comprobar y no con el conjunto completo. Es lo que
 * justifica haber partido el motor: antes, comprobar que la regla de
 * cadena de frío funcionaba exigía encontrar en los datos un lote cocido
 * fuera de temperatura y mirar el resultado final; ahora se le pasa un
 * lote a la regla y se mira lo que devuelve.
 *
 *     npx tsx herramientas/probar-etapas.ts
 *
 * Sin dependencias de prueba: un comparador de ocho líneas basta y
 * mantiene el proyecto sin añadir un marco más a la defensa.
 */
import {
  normalizarEntrada, aplicarRestricciones, REGLAS_LOTE,
  extraerCaracteristicas, puntuar, ordenar,
  descomponer, descomponerEjecucion, resumir, contrafactual, senalesOperacion,
  CARACTERISTICAS, PESOS, cotaSuperior, ejecutarModelo, MODELO_APRENDIDO,
  ajustarLogistica, sigmoide, auc, metricasLista, ENTRADAS_APRENDIDAS,
} from "@foodloop/dominio";
import type {
  Lote, ItemCatalogo, EntradaModelo, Candidata, Caracteristica, ModeloAprendido,
} from "@foodloop/dominio";

/** Señales nulas, para los vectores construidos a mano. */
const SIN_SENALES = {
  senales: { frecuenciaMenu: 0, recenciaMenu: 0 },
  observacionesSenales: { frecuenciaMenu: "", recenciaMenu: "" },
};

let hechas = 0, fallos = 0;
const grupos: string[] = [];

function grupo(nombre: string) {
  grupos.push(nombre);
  console.log(`\n  ${nombre}`);
  console.log("  " + "─".repeat(70));
}

function comprobar(que: string, condicion: boolean, detalle = "") {
  hechas++;
  if (condicion) {
    console.log(`  ✓ ${que}`);
  } else {
    fallos++;
    console.log(`  ✗ ${que}${detalle ? `\n      ${detalle}` : ""}`);
  }
}

const igual = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

// =====================================================================
// Datos de prueba, construidos a mano
// =====================================================================

const AHORA = new Date("2026-10-07T10:00:00Z");
const enHoras = (h: number) => new Date(AHORA.getTime() + h * 3_600_000);

const lote = (p: Partial<Lote> = {}): Lote => ({
  id: 1, codigo: "L-1", ingredienteId: 10, ingrediente: "Pollo",
  cantidad: 6, unidad: "kg", costoUnitario: 5,
  estadoProducto: "cocido", temperaturaC: 3, aptoReproceso: true,
  registradoEn: AHORA, venceEn: enHoras(20),
  areaId: 1, area: "Cocina caliente", servicio: "Almuerzo",
  causa: "sobreproduccion", ...p,
});

const receta = (p: Partial<ItemCatalogo> = {}): ItemCatalogo => ({
  id: 100, codigo: "R-1", nombre: "Salteado", areaId: 1,
  area: "Cocina caliente", porcionesBase: 20, pesoPorcionG: 250,
  minutos: 45, tipoProceso: "reproceso_termico", tempProcesoC: 80,
  aceptacion: 4, pasos: [],
  requisitos: [
    { ingredienteId: 10, cantidad: 3, esPrincipal: true, admiteEstado: "ambos" },
  ],
  ...p,
});

const entradaDe = (lotes: Lote[], item: ItemCatalogo): EntradaModelo => ({
  lotes, catalogo: [item],
  inventario: new Map(), cargaPorArea: new Map([[1, 0.5]]), ahora: AHORA,
});

// =====================================================================
grupo("E1 · ENTRADA DE DATOS");

{
  const r = normalizarEntrada(
    [lote(), lote({ id: 2, codigo: "L-0", cantidad: 0 })],
    [receta()], new Map(), new Map(), AHORA);
  comprobar("descarta el lote de cantidad cero y dice por qué",
    r.entrada.lotes.length === 1
    && r.rechazos.some((x) => x.que === "L-0" && /cantidad/.test(x.motivo)));
}
{
  const r = normalizarEntrada(
    [lote()], [receta(), receta({ id: 101, codigo: "R-0", requisitos: [] })],
    new Map(), new Map(), AHORA);
  comprobar("descarta la receta sin ingredientes declarados",
    r.entrada.catalogo.length === 1
    && r.rechazos.some((x) => x.que === "R-0"));
}
{
  const r = normalizarEntrada(
    [lote()], [receta({ porcionesBase: 0 })], new Map(), new Map(), AHORA);
  comprobar("descarta la receta sin rendimiento declarado",
    r.entrada.catalogo.length === 0);
}
{
  const r = normalizarEntrada([lote()], [receta()], new Map(), new Map(), AHORA);
  comprobar("no toca una entrada correcta",
    r.rechazos.length === 0 && r.entrada.lotes.length === 1);
}

// =====================================================================
grupo("E2 · RESTRICCIONES DURAS · una regla a la vez");

comprobar("R1 rechaza el lote sin dictamen favorable",
  REGLAS_LOTE.R1(lote({ aptoReproceso: false }), receta(), AHORA) !== null);
comprobar("R1 acepta el lote con dictamen favorable",
  REGLAS_LOTE.R1(lote(), receta(), AHORA) === null);

comprobar("R2 rechaza el lote vencido",
  REGLAS_LOTE.R2(lote({ venceEn: enHoras(-1) }), receta(), AHORA) !== null);
comprobar("R2 acepta el lote vigente",
  REGLAS_LOTE.R2(lote(), receta(), AHORA) === null);

comprobar("R3 rechaza el cocido en receta que exige crudo",
  REGLAS_LOTE.R3(lote({ estadoProducto: "cocido" }), receta({
    requisitos: [{ ingredienteId: 10, cantidad: 3, esPrincipal: true, admiteEstado: "crudo" }],
  }), AHORA) !== null);
comprobar("R3 acepta cualquier estado cuando la receta admite ambos",
  REGLAS_LOTE.R3(lote({ estadoProducto: "crudo" }), receta(), AHORA) === null
  && REGLAS_LOTE.R3(lote({ estadoProducto: "cocido" }), receta(), AHORA) === null);

comprobar("R4 rechaza el cocido fuera de frío si la receta no alcanza 74 °C",
  REGLAS_LOTE.R4(lote({ temperaturaC: 12 }),
    receta({ tipoProceso: "ensamblaje_frio", tempProcesoC: 0 }), AHORA) !== null);
comprobar("R4 rescata el cocido fuera de frío con reproceso a 80 °C",
  REGLAS_LOTE.R4(lote({ temperaturaC: 12 }), receta(), AHORA) === null);
comprobar("R4 no se aplica al producto crudo",
  REGLAS_LOTE.R4(lote({ estadoProducto: "crudo", temperaturaC: 12 }),
    receta({ tipoProceso: "ensamblaje_frio", tempProcesoC: 0 }), AHORA) === null);

{
  // 45 min de proceso + 1 h de margen = 1,75 h; la ventana es de 1 h
  const v = aplicarRestricciones([lote({ venceEn: enHoras(1) })], receta(), AHORA);
  comprobar("R5 rechaza cuando el proceso no cabe en la ventana",
    !v.admisible && v.decisiva === "R5");
}
{
  const v = aplicarRestricciones([lote({ ingredienteId: 99 })], receta(), AHORA);
  comprobar("R0 rechaza cuando no hay ingrediente en común",
    !v.admisible && v.decisiva === "R0");
}
{
  const v = aplicarRestricciones([], receta(), AHORA);
  comprobar("R0 rechaza la selección vacía",
    !v.admisible && v.decisiva === "R0");
}
{
  const v = aplicarRestricciones([lote()], receta(), AHORA);
  comprobar("admite el caso correcto, sin incumplimientos",
    v.admisible && v.incumplimientos.length === 0 && v.usables.length === 1);
}
{
  // Un lote sin dictamen y vencido hace cinco horas incumple tres
  // reglas, no dos: al estar vencido tampoco le queda ventana sanitaria
  // en la que quepa el proceso, de modo que R5 cae con R1 y R2. Se
  // recogen las tres y decide R1, que es la primera del orden.
  const v = aplicarRestricciones(
    [lote({ aptoReproceso: false, venceEn: enHoras(-5) })], receta(), AHORA);
  const reglas = v.incumplimientos.map((i) => i.regla);
  comprobar("recoge todos los incumplimientos y decide el primero en orden",
    v.decisiva === "R1" && igual(reglas, ["R1", "R2", "R5"]),
    `decisiva=${v.decisiva} reglas=${reglas.join(",")}`);
}
{
  const v = aplicarRestricciones(
    [lote(), lote({ id: 2, codigo: "L-2", aptoReproceso: false })], receta(), AHORA);
  comprobar("un solo lote incumplidor descarta la receta entera",
    !v.admisible && v.incumplimientos[0].lote === "L-2");
}

// =====================================================================
grupo("E3 · EXTRACCIÓN DE CARACTERÍSTICAS");

{
  const l = lote();
  const r = receta();
  const c = extraerCaracteristicas([l], r, entradaDe([l], r));
  comprobar("las siete características quedan en [0,1]",
    CARACTERISTICAS.every((k) => c.valores[k] >= 0 && c.valores[k] <= 1),
    JSON.stringify(c.valores));
  comprobar("la escala respeta el tope de 4",
    c.escala <= 4 && c.escala >= 0.25, `escala=${c.escala}`);
  comprobar("la etapa no aplica pesos: ningún valor coincide con su contribución",
    !("contribuciones" in c));
}
{
  // 6 kg disponibles para un requisito de 3 kg → escala 2
  const l = lote({ cantidad: 6 });
  const r = receta();
  const c = extraerCaracteristicas([l], r, entradaDe([l], r));
  comprobar("la escala sale del ingrediente limitante", c.escala === 2,
    `escala=${c.escala}`);
  comprobar("el reparto consume lo que la receta escalada necesita",
    c.kgUsados === 6, `kgUsados=${c.kgUsados}`);
  comprobar("absorción 1 cuando la receta consume todo lo seleccionado",
    c.valores.absorcion === 1);
}
{
  // dos lotes del mismo ingrediente: se consume primero el más urgente
  const a = lote({ id: 1, codigo: "L-viejo", cantidad: 2, venceEn: enHoras(6) });
  const b = lote({ id: 2, codigo: "L-nuevo", cantidad: 10, venceEn: enHoras(40) });
  const r = receta();
  const c = extraerCaracteristicas([a, b], r, entradaDe([a, b], r));
  comprobar("reparte empezando por el lote que vence antes",
    c.aportes[0].lote.codigo === "L-viejo",
    c.aportes.map((x) => x.lote.codigo).join(" → "));
  comprobar("la ventana del conjunto la fija el lote más comprometido",
    Math.round(c.horasConjunto) === 6 && c.masUrgente?.codigo === "L-viejo");
}
{
  // el ingrediente principal pesa el doble en la cobertura
  const r = receta({
    requisitos: [
      { ingredienteId: 10, cantidad: 3, esPrincipal: true, admiteEstado: "ambos" },
      { ingredienteId: 11, cantidad: 1, esPrincipal: false, admiteEstado: "ambos" },
    ],
  });
  const l = lote();
  const c = extraerCaracteristicas([l], r, entradaDe([l], r));
  comprobar("el principal cubierto y el secundario no dan cobertura 2/3",
    Math.abs(c.valores.cobertura - 2 / 3) < 1e-9,
    `cobertura=${c.valores.cobertura}`);
  comprobar("el requisito no cubierto aparece en faltantes",
    c.faltantes.length === 1 && c.faltantes[0].ingredienteId === 11);
}
{
  // urgencia: 48 h o más → 0; vencimiento inmediato → 1
  const r = receta({ minutos: 0 });
  const lejos = lote({ venceEn: enHoras(48) });
  const cerca = lote({ venceEn: enHoras(0.01) });
  comprobar("urgencia 0 a 48 h de la caducidad",
    extraerCaracteristicas([lejos], r, entradaDe([lejos], r)).valores.urgencia === 0);
  comprobar("urgencia cercana a 1 al borde del vencimiento",
    extraerCaracteristicas([cerca], r, entradaDe([cerca], r)).valores.urgencia > 0.999);
}
{
  const r = receta({ tipoProceso: "conservacion" });
  const l = lote();
  comprobar("la conservación puntúa más bajo que la reutilización en jerarquía",
    extraerCaracteristicas([l], r, entradaDe([l], r)).valores.jerarquia === 0.35);
}

// =====================================================================
grupo("E4 · PUNTUACIÓN");

{
  const l = lote();
  const r = receta();
  const c = extraerCaracteristicas([l], r, entradaDe([l], r));
  const p = puntuar(c);
  const suma = CARACTERISTICAS.reduce((a, k) => a + p.contribuciones[k], 0);
  comprobar("las contribuciones suman el bruto",
    Math.abs(suma - p.bruto) < 1e-9, `${suma} vs ${p.bruto}`);
  comprobar("el valor es el bruto recortado y redondeado",
    p.valor === Math.round(Math.max(0, Math.min(100, p.bruto)) * 10) / 10);
  comprobar("la probabilidad es σ del logit y está en (0,1)",
    Math.abs(p.probabilidad - sigmoide(p.logit)) < 1e-12
    && p.probabilidad > 0 && p.probabilidad < 1);
  const sumaEj = ENTRADAS_APRENDIDAS.reduce((a, k) => a + p.contribucionesEjecucion[k], 0);
  comprobar("intercepto + contribuciones aprendidas = logit",
    Math.abs(p.intercepto + sumaEj - p.logit) < 1e-9);
  comprobar("la aptitud es P × valor",
    Math.abs(p.aptitud - Math.round(p.probabilidad * p.valor * 10) / 10) <= 0.1);
  comprobar("el modo experto reproduce el modelo 2: aptitud = valor",
    puntuar(c, PESOS, MODELO_APRENDIDO, "experta").aptitud === p.valor);
  comprobar("no se recorta en un caso normal", p.recortada === false);
}
{
  // vector perfecto con área descargada: el bruto supera 100 y se recorta
  const c = {
    escala: 1, aportes: [], kgUsados: 0, pesoRecetaKg: 1,
    valores: Object.fromEntries(CARACTERISTICAS.map((k) =>
      [k, k === "cargaArea" ? 0 : 1])) as Record<Caracteristica, number>,
    observaciones: Object.fromEntries(
      CARACTERISTICAS.map((k) => [k, ""])) as Record<Caracteristica, string>,
    horasConjunto: 1, masUrgente: undefined,
    porIngrediente: new Map(), faltantes: [],
    costoRecuperado: 0, valorEnRiesgo: 0, ...SIN_SENALES,
  };
  const p = puntuar(c);
  comprobar("el bruto máximo es la cota declarada, 106",
    Math.abs(p.bruto - cotaSuperior()) < 1e-9, `bruto=${p.bruto}`);
  comprobar("el recorte actúa y queda registrado",
    p.valor === 100 && p.recortada === true);
}
{
  const c = {
    escala: 1, aportes: [], kgUsados: 0, pesoRecetaKg: 1,
    valores: Object.fromEntries(
      CARACTERISTICAS.map((k) => [k, 0])) as Record<Caracteristica, number>,
    observaciones: Object.fromEntries(
      CARACTERISTICAS.map((k) => [k, ""])) as Record<Caracteristica, string>,
    horasConjunto: 1, masUrgente: undefined,
    porIngrediente: new Map(), faltantes: [],
    costoRecuperado: 0, valorEnRiesgo: 0, ...SIN_SENALES,
  };
  comprobar("vector nulo da valor 0 y aptitud 0",
    puntuar(c).valor === 0 && puntuar(c).aptitud === 0);
}
{
  const l = lote();
  const r = receta();
  const c = extraerCaracteristicas([l], r, entradaDe([l], r));
  const dobles = Object.fromEntries(
    CARACTERISTICAS.map((k) => [k, PESOS[k] * 2])) as Record<Caracteristica, number>;
  comprobar("los pesos entran por argumento: duplicarlos duplica el bruto",
    Math.abs(puntuar(c, dobles).bruto - puntuar(c).bruto * 2) < 1e-9);
}

// =====================================================================
grupo("E5 · ORDENAMIENTO");

const candidata = (codigo: string, aptitud: number, kg: number, horas: number) => ({
  item: receta({ codigo }),
  caracteristicas: { kgUsados: kg, horasConjunto: horas } as Candidata["caracteristicas"],
  puntuacion: { aptitud } as Candidata["puntuacion"],
});

{
  const o = ordenar([
    candidata("B", 50, 1, 10),
    candidata("A", 80, 1, 10),
    candidata("C", 65, 1, 10),
  ], 3);
  comprobar("ordena por aptitud descendente",
    igual(o.ranking.map((c) => c.item.codigo), ["A", "C", "B"]));
}
{
  const o = ordenar([
    candidata("pocos", 70, 2, 10),
    candidata("muchos", 70, 9, 10),
  ], 2);
  comprobar("empate en aptitud: gana la que aprovecha más merma",
    o.ranking[0].item.codigo === "muchos");
}
{
  const o = ordenar([
    candidata("holgada", 70, 5, 30),
    candidata("urgente", 70, 5, 4),
  ], 2);
  comprobar("empate en aptitud y kilos: gana la de ventana más corta",
    o.ranking[0].item.codigo === "urgente");
}
{
  const o = ordenar([
    candidata("Z", 70, 5, 10),
    candidata("A", 70, 5, 10),
  ], 2);
  comprobar("empate total: desempata el código, de forma reproducible",
    o.ranking[0].item.codigo === "A");
}
{
  const o = ordenar([
    candidata("A", 90, 1, 1), candidata("B", 80, 1, 1),
    candidata("C", 70, 1, 1), candidata("D", 60, 1, 1),
  ], 2);
  comprobar("el corte deja constancia de cuántas quedaron fuera",
    o.ranking.length === 2 && o.fueraDeCorte === 2);
}

// =====================================================================
grupo("E6 · EXPLICACIÓN");

{
  const l = lote();
  const r = receta();
  const c = extraerCaracteristicas([l], r, entradaDe([l], r));
  const p = puntuar(c);
  const f = descomponer(c, p, PESOS);
  comprobar("devuelve un factor por característica, en orden canónico",
    f.length === 7);
  comprobar("la suma de las contribuciones mostradas es el valor publicado",
    Math.round(f.reduce((a, x) => a + x.contribucion, 0) * 10) / 10 === p.valor);
  const fe = descomponerEjecucion(c, p);
  comprobar("la parte aprendida da un factor por cada una de las nueve entradas",
    fe.length === 9 && fe.every((x) => x.valorObservado.length > 0));
  comprobar("intercepto + factores de ejecución reproducen la probabilidad",
    Math.abs(sigmoide(p.intercepto + fe.reduce((a, x) => a + x.contribucion, 0))
      - p.probabilidad) < 1e-12);
  comprobar("cada factor trae su valor observado, su peso y su justificación",
    f.every((x) => x.valorObservado.length > 0 && x.porQue.length > 0
      && typeof x.peso === "number"));
  comprobar("el resumen nombra la receta y cabe en una frase",
    resumir(c, r).includes(r.nombre) && resumir(c, r).split(". ").length <= 4);
  comprobar("el contrafactual es una sola frase",
    contrafactual(c, r, [l]).length === 1);
}
{
  // las cuatro ramas del contrafactual, una a una
  const r = receta();

  // 1 · margen sanitario ajustado (holgura < 3 h)
  const ajustado = lote({ venceEn: enHoras(2.5) });
  const c1 = extraerCaracteristicas([ajustado], r, entradaDe([ajustado], r));
  comprobar("rama 1 · avisa del margen sanitario cuando está cerca",
    /ya no se propondría/.test(contrafactual(c1, r, [ajustado])[0]));

  // 2 · falta un ingrediente, que es lo que el usuario puede resolver
  const r2 = receta({
    requisitos: [
      { ingredienteId: 10, cantidad: 3, esPrincipal: true, admiteEstado: "ambos" },
      { ingredienteId: 11, cantidad: 1, esPrincipal: false, admiteEstado: "ambos" },
    ],
  });
  const holgado = lote({ venceEn: enHoras(30) });
  const c2 = extraerCaracteristicas([holgado], r2, entradaDe([holgado], r2));
  comprobar("rama 2 · señala el ingrediente que sale de bodega",
    /sale de bodega/.test(contrafactual(c2, r2, [holgado])[0]));

  // 3 · todo cubierto, holgura intermedia (3 h ≤ holgura < 8 h)
  const medio = lote({ venceEn: enHoras(7) });
  const c3 = extraerCaracteristicas([medio], r, entradaDe([medio], r));
  comprobar("rama 3 · con holgura intermedia vuelve al aviso sanitario",
    /ya no se propondría/.test(contrafactual(c3, r, [medio])[0]));

  // 4 · combinación de lotes, con holgura amplia
  const a = lote({ id: 1, codigo: "L-a", cantidad: 2, venceEn: enHoras(30) });
  const b = lote({ id: 2, codigo: "L-b", ingredienteId: 11, cantidad: 2, venceEn: enHoras(30) });
  const r4 = receta({
    requisitos: [
      { ingredienteId: 10, cantidad: 1, esPrincipal: true, admiteEstado: "ambos" },
      { ingredienteId: 11, cantidad: 1, esPrincipal: false, admiteEstado: "ambos" },
    ],
  });
  const c4 = extraerCaracteristicas([a, b], r4, entradaDe([a, b], r4));
  comprobar("rama 4 · explica que es la combinación la que hace posible la receta",
    /combinación/.test(contrafactual(c4, r4, [a, b])[0]),
    contrafactual(c4, r4, [a, b])[0]);

  // 5 · un solo lote, todo cubierto, holgura amplia
  const solo = lote({ venceEn: enHoras(30) });
  const c5 = extraerCaracteristicas([solo], r, entradaDe([solo], r));
  comprobar("rama 5 · invita a añadir otro lote compatible",
    /añades otro lote/.test(contrafactual(c5, r, [solo])[0]),
    contrafactual(c5, r, [solo])[0]);
}

// =====================================================================
grupo("APRENDIZAJE · regresión logística, señales y métricas");

{
  // datos sintéticos con coeficientes conocidos: el ajuste debe recuperarlos
  let s = 12345;
  const azar = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const X: number[][] = [], y: number[] = [];
  for (let i = 0; i < 4000; i++) {
    const x = [azar(), azar(), 0.5];
    X.push(x);
    y.push(azar() < sigmoide(-1 + 3 * x[0] - 2 * x[1]) ? 1 : 0);
  }
  const m = ajustarLogistica(X, y, { lambda: 0.01 });
  comprobar("recupera coeficientes conocidos (−1, +3, −2) con error < 0,4",
    Math.abs(m.intercepto + 1) < 0.4 && Math.abs(m.coeficientes[0] - 3) < 0.4
    && Math.abs(m.coeficientes[1] + 2) < 0.4,
    `${m.intercepto.toFixed(2)} ${m.coeficientes.map((c) => c.toFixed(2))}`);
  comprobar("una columna constante no se estima: se fija en 0 y se declara",
    m.coeficientes[2] === 0 && m.sinVariacion.includes(2));
  comprobar("converge y es determinista",
    m.convergio && igual(m, ajustarLogistica(X, y, { lambda: 0.01 })));
}
{
  comprobar("AUC: orden perfecto = 1, invertido = 0, empate total = 0,5",
    auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1]) === 1
    && auc([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1]) === 0
    && auc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1]) === 0.5);
  const m = metricasLista([
    { puntuacion: 0.9, relevante: 0, kg: 1, clave: "a" },
    { puntuacion: 0.8, relevante: 1, kg: 2, clave: "b" },
    { puntuacion: 0.1, relevante: 0, kg: 3, clave: "c" },
  ]);
  comprobar("métricas de lista: relevante en 2.º puesto → HR@1 0, HR@3 1, MRR 0,5",
    "hr1" in m && m.hr1 === 0 && m.hr3 === 1 && m.mrr === 0.5 && m.kgPrimera === 0);
}
{
  const r = receta({ producciones: ["2026-10-01", "2026-10-06", "2026-10-07", "2026-10-08"] });
  const sn = senalesOperacion(r, AHORA);
  comprobar("las señales solo cuentan producciones de días anteriores (sin fuga)",
    sn.observaciones.frecuenciaMenu.startsWith("2 ") && sn.observaciones.recenciaMenu === "última hace 1 día");
  comprobar("sin historial, las dos señales valen 0",
    igual(senalesOperacion(receta(), AHORA).valores, { frecuenciaMenu: 0, recenciaMenu: 0 }));
}
{
  // ningún coeficiente aprendido rescata lo que una regla descartó
  const enorme: ModeloAprendido = {
    ...MODELO_APRENDIDO, intercepto: 50,
    coeficientes: Object.fromEntries(ENTRADAS_APRENDIDAS.map((k) => [k, 50])) as ModeloAprendido["coeficientes"],
  };
  const s = ejecutarModelo([lote({ aptoReproceso: false })], [receta()],
    new Map(), new Map(), AHORA, { modelo: enorme });
  comprobar("ningún coeficiente aprendido rescata lo que una regla sanitaria descartó",
    s.resultados.length === 0);
}

// =====================================================================
grupo("MODELO COMPLETO · propiedades de la tubería");

{
  const l = lote();
  const r = receta();
  const s = ejecutarModelo([l], [r], new Map(), new Map([[1, 0.5]]), AHORA);
  comprobar("la traza registra las seis etapas, en orden",
    igual(s.traza.etapas.map((e) => e.codigo), ["E1", "E2", "E3", "E4", "E5", "E6"]));
  comprobar("la traza guarda los pesos con que se puntuó",
    igual(s.traza.pesos, PESOS));
  comprobar("la traza guarda un vector por candidata admitida",
    s.traza.vectores.length === 1 && s.traza.vectores[0].receta === "R-1");
}
{
  const l = lote();
  const r = receta();
  const a = ejecutarModelo([l], [r], new Map(), new Map([[1, 0.5]]), AHORA);
  const b = ejecutarModelo([l], [r], new Map(), new Map([[1, 0.5]]), AHORA);
  comprobar("la misma entrada produce la misma salida",
    igual(a.resultados, b.resultados));
}
{
  // una receta descartada por restricciones nunca llega a puntuarse
  const vencido = lote({ venceEn: enHoras(-1) });
  const s = ejecutarModelo([vencido], [receta()], new Map(), new Map(), AHORA);
  comprobar("lo que la etapa 2 descarta no se puntúa ni se propone",
    s.resultados.length === 0 && s.traza.vectores.length === 0
    && s.traza.descartesDetallados[0].decisiva === "R2");
}
{
  // un peso alto no puede rescatar una propuesta insegura
  const sinDictamen = lote({ aptoReproceso: false });
  const enormes = Object.fromEntries(
    CARACTERISTICAS.map((k) => [k, 10])) as Record<Caracteristica, number>;
  const s = ejecutarModelo(
    [sinDictamen], [receta()], new Map(), new Map(), AHORA, { pesos: enormes });
  comprobar("ningún peso rescata lo que una restricción sanitaria descartó",
    s.resultados.length === 0);
}

// =====================================================================
console.log("\n  " + "═".repeat(70));
console.log(`  ${hechas} comprobaciones · ${grupos.length} grupos · `
  + `${fallos === 0 ? "todas pasan" : `${fallos} FALLAN`}`);
console.log();
process.exit(fallos === 0 ? 0 : 1);
