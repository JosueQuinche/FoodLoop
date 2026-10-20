/**
 * FoodLoop · Métricas de evaluación del modelo
 *
 * Dos familias, porque el modelo hace dos cosas:
 *
 *   CLASIFICACIÓN  ¿la probabilidad estimada separa lo que se ejecutó
 *                  de lo que no?  →  AUC-ROC, precisión media (AUC-PR),
 *                  log-loss y Brier (calibración).
 *
 *   ORDENAMIENTO   ¿lo que el usuario ve arriba es lo que se ejecutó?
 *                  →  HR@k, Precisión@k, NDCG@k, MRR y MAP, calculadas
 *                  por lote y promediadas.
 *
 * La segunda es la que importa para el usuario: el chef ve tres
 * propuestas, no una curva ROC. La primera dice si la probabilidad que
 * se le muestra es creíble.
 *
 * Sin dependencias.
 */

/** Área bajo la curva ROC, por rangos (Mann-Whitney), con empates. */
export function auc(puntuaciones: readonly number[], y: readonly number[]): number {
  const idx = puntuaciones.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0]);
  const rangos = new Array<number>(idx.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const r = (i + j) / 2 + 1;
    for (let t = i; t <= j; t++) rangos[idx[t][1]] = r;
    i = j + 1;
  }
  let pos = 0, sumaR = 0;
  for (let i = 0; i < y.length; i++) if (y[i] === 1) { pos++; sumaR += rangos[i]; }
  const neg = y.length - pos;
  if (pos === 0 || neg === 0) return NaN;
  return (sumaR - pos * (pos + 1) / 2) / (pos * neg);
}

/** Precisión media (área bajo la curva precisión-exhaustividad). */
export function precisionMedia(puntuaciones: readonly number[], y: readonly number[]): number {
  const orden = puntuaciones.map((s, i) => [s, y[i]] as const).sort((a, b) => b[0] - a[0]);
  let tp = 0, suma = 0;
  const pos = y.reduce((a, b) => a + b, 0);
  orden.forEach(([, yi], k) => { if (yi === 1) { tp++; suma += tp / (k + 1); } });
  return pos ? suma / pos : NaN;
}

export function logLoss(p: readonly number[], y: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const q = Math.min(1 - 1e-12, Math.max(1e-12, p[i]));
    s -= y[i] * Math.log(q) + (1 - y[i]) * Math.log(1 - q);
  }
  return s / (p.length || 1);
}

export function brier(p: readonly number[], y: readonly number[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += (p[i] - y[i]) ** 2;
  return s / (p.length || 1);
}

// ---------------------------------------------------------------------
// Ordenamiento
// ---------------------------------------------------------------------

/** Lo que se sabe de una candidata dentro de la lista de un lote. */
export interface ItemLista {
  puntuacion: number;
  relevante: 0 | 1;
  /** Kilos de merma que la propuesta consumiría. */
  kg: number;
  /** Desempate estable cuando dos puntuaciones coinciden. */
  clave: string;
}

export interface MetricasLista {
  hr1: number; hr3: number; p3: number; ndcg3: number; mrr: number; ap: number;
  /** Kilos de la primera propuesta si fue ejecutable, 0 si no. */
  kgPrimera: number;
}

export function ordenarLista(items: readonly ItemLista[]): ItemLista[] {
  return [...items].sort((a, b) =>
    b.puntuacion - a.puntuacion || a.clave.localeCompare(b.clave));
}

/**
 * Métricas de una lista. Devuelve null si el lote no tiene ninguna
 * candidata relevante: ahí ningún orden puede acertar y promediarlo
 * mezclaría la calidad del ranking con la del catálogo.
 * `kgPrimera` se cuenta en todos los lotes (cero si la primera no se
 * ejecutó), porque mide cuánta merma sale realmente.
 */
export function metricasLista(items: readonly ItemLista[]): MetricasLista | { kgPrimera: number } {
  const o = ordenarLista(items);
  const rel = o.map((x) => x.relevante);
  const kgPrimera = o[0] && o[0].relevante ? o[0].kg : 0;
  const total = rel.reduce<number>((a, b) => a + b, 0);
  if (total === 0) return { kgPrimera };

  const dcg = rel.slice(0, 3).reduce<number>((a, r, i) => a + r / Math.log2(i + 2), 0);
  let idcg = 0;
  for (let i = 0; i < Math.min(3, total); i++) idcg += 1 / Math.log2(i + 2);
  const primera = rel.indexOf(1);
  let tp = 0, ap = 0;
  rel.forEach((r, k) => { if (r) { tp++; ap += tp / (k + 1); } });

  return {
    hr1: rel[0],
    hr3: Math.max(...rel.slice(0, 3)),
    p3: rel.slice(0, 3).reduce<number>((a, b) => a + b, 0) / 3,
    ndcg3: dcg / idcg,
    mrr: 1 / (primera + 1),
    ap: ap / total,
    kgPrimera,
  };
}

export interface ResumenOrdenamiento {
  /** Lotes con al menos una candidata relevante. */
  listasEvaluables: number;
  listas: number;
  hr1: number; hr3: number; p3: number; ndcg3: number; mrr: number; map: number;
  /** Suma de kilos aprovechados por propuestas primeras ejecutables. */
  kgEjecutables: number;
}

export function resumirOrdenamiento(listas: readonly (readonly ItemLista[])[]): ResumenOrdenamiento {
  const ms = listas.map(metricasLista);
  const ev = ms.filter((m): m is MetricasLista => "hr1" in m);
  const media = (f: (m: MetricasLista) => number) =>
    ev.length ? ev.reduce((a, m) => a + f(m), 0) / ev.length : NaN;
  return {
    listasEvaluables: ev.length,
    listas: listas.length,
    hr1: media((m) => m.hr1), hr3: media((m) => m.hr3), p3: media((m) => m.p3),
    ndcg3: media((m) => m.ndcg3), mrr: media((m) => m.mrr), map: media((m) => m.ap),
    kgEjecutables: ms.reduce((a, m) => a + m.kgPrimera, 0),
  };
}

// ---------------------------------------------------------------------
// Incertidumbre
// ---------------------------------------------------------------------

/** Generador congruencial: bootstrap reproducible sin dependencias. */
export function azarSemilla(semilla: number): () => number {
  let s = semilla >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Intervalo de confianza del 95 % por bootstrap pareado, remuestreando
 * lotes. Pareado porque los dos modelos se evalúan sobre los mismos
 * lotes: lo que interesa es la diferencia, no cada media por separado.
 */
export function bootstrapDiferencia(
  a: readonly number[], b: readonly number[], repeticiones = 2000, semilla = 7,
): { media: number; inf: number; sup: number; pMenorOIgualCero: number } {
  const azar = azarSemilla(semilla);
  const n = a.length;
  const difs: number[] = [];
  for (let r = 0; r < repeticiones; r++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const k = Math.floor(azar() * n);
      s += b[k] - a[k];
    }
    difs.push(s / n);
  }
  difs.sort((x, y) => x - y);
  const media = a.reduce((s, _x, i) => s + (b[i] - a[i]), 0) / (n || 1);
  return {
    media,
    inf: difs[Math.floor(0.025 * repeticiones)],
    sup: difs[Math.floor(0.975 * repeticiones)],
    pMenorOIgualCero: difs.filter((d) => d <= 0).length / repeticiones,
  };
}
