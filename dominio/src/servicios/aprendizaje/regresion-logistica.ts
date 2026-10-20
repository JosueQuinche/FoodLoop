/**
 * FoodLoop · Regresión logística
 *
 * El componente de aprendizaje automático del modelo. Estima, a partir
 * del histórico, la probabilidad de que una propuesta se ejecute:
 *
 *     P(ejecución | x) = σ( b + Σ wᵢ · xᵢ )      σ(z) = 1 / (1 + e⁻ᶻ)
 *
 * POR QUÉ REGRESIÓN LOGÍSTICA Y NO UN BOSQUE O UNA RED
 *
 * Se compararon las tres familias sobre los mismos datos (ver
 * `herramientas/ml/comparar.py`). Un bosque aleatorio y un gradient
 * boosting no superaron a la regresión logística en ninguna métrica de
 * ordenamiento en la validación temporal, y la regresión logística
 * conserva lo que el proyecto no puede perder: la contribución de cada
 * factor es exactamente wᵢ·xᵢ, de modo que la explicación sigue siendo
 * la aritmética del modelo y no una aproximación posterior.
 *
 * CÓMO SE AJUSTA
 *
 * Por Newton-Raphson (mínimos cuadrados reponderados, IRLS) con
 * regularización L2. Con diez parámetros la matriz hessiana es de 10×10
 * y converge en menos de quince iteraciones, sin tasa de aprendizaje
 * que elegir y sin azar: los mismos datos producen siempre los mismos
 * coeficientes, que es la condición para poder auditar el modelo.
 *
 * Es el mismo problema que resuelve `LogisticRegression(C=1/λ)` de
 * scikit-learn; `comparar.py` lo comprueba coeficiente a coeficiente.
 *
 * Sin dependencias, como el resto del dominio.
 */

export interface OpcionesAjuste {
  /** Regularización L2 sobre la suma de pérdidas. No afecta al intercepto. */
  lambda?: number;
  /** Tope de iteraciones de Newton. */
  maxIter?: number;
  /** Se detiene cuando ningún coeficiente cambia más que esto. */
  tolerancia?: number;
  /**
   * Varianza mínima para estimar un coeficiente. Una columna constante
   * no contiene información: su coeficiente sería indistinguible del
   * intercepto y saldría con un valor arbitrario. Se fija en cero y se
   * declara.
   */
  varianzaMinima?: number;
}

export interface AjusteLogistico {
  intercepto: number;
  coeficientes: number[];
  /** Columnas sin variación en los datos de entrenamiento. */
  sinVariacion: number[];
  iteraciones: number;
  /** Log-verosimilitud negativa media al terminar. */
  perdida: number;
  convergio: boolean;
}

export const sigmoide = (z: number): number =>
  z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));

export function logit(
  x: readonly number[], intercepto: number, coeficientes: readonly number[],
): number {
  let z = intercepto;
  for (let j = 0; j < coeficientes.length; j++) z += coeficientes[j] * x[j];
  return z;
}

/** Resuelve A·x = b por eliminación gaussiana con pivoteo parcial. */
function resolver(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((fila, i) => [...fila, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let f = c + 1; f < n; f++) if (Math.abs(M[f][c]) > Math.abs(M[p][c])) p = f;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c] || 1e-12;
    for (let f = c + 1; f < n; f++) {
      const k = M[f][c] / piv;
      if (k === 0) continue;
      for (let j = c; j <= n; j++) M[f][j] -= k * M[c][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let f = n - 1; f >= 0; f--) {
    let s = M[f][n];
    for (let j = f + 1; j < n; j++) s -= M[f][j] * x[j];
    x[f] = s / (M[f][f] || 1e-12);
  }
  return x;
}

/**
 * Ajusta la regresión logística.
 *
 * @param X filas de características, todas de la misma longitud
 * @param y 1 si la propuesta se ejecutó, 0 si no
 */
export function ajustarLogistica(
  X: readonly (readonly number[])[], y: readonly number[], o: OpcionesAjuste = {},
): AjusteLogistico {
  const lambda = o.lambda ?? 1;
  const maxIter = o.maxIter ?? 50;
  const tol = o.tolerancia ?? 1e-8;
  const varMin = o.varianzaMinima ?? 1e-6;
  const n = X.length;
  const d = n ? X[0].length : 0;

  // columnas que se estiman
  const sinVariacion: number[] = [];
  const activas: number[] = [];
  for (let j = 0; j < d; j++) {
    let m = 0;
    for (let i = 0; i < n; i++) m += X[i][j];
    m /= n || 1;
    let v = 0;
    for (let i = 0; i < n; i++) v += (X[i][j] - m) ** 2;
    v /= n || 1;
    (v < varMin ? sinVariacion : activas).push(j);
  }

  // parámetros: [b, w(activas)...]
  const k = activas.length + 1;
  let theta = new Array<number>(k).fill(0);
  let iter = 0;
  let convergio = false;

  for (; iter < maxIter; iter++) {
    const g = new Array<number>(k).fill(0);
    const H = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let i = 0; i < n; i++) {
      const fila = [1, ...activas.map((j) => X[i][j])];
      let z = 0;
      for (let a = 0; a < k; a++) z += theta[a] * fila[a];
      const p = sigmoide(z);
      const r = p - y[i];
      const w = Math.max(p * (1 - p), 1e-10);
      for (let a = 0; a < k; a++) {
        g[a] += r * fila[a];
        for (let c = a; c < k; c++) H[a][c] += w * fila[a] * fila[c];
      }
    }
    for (let a = 0; a < k; a++) for (let c = 0; c < a; c++) H[a][c] = H[c][a];
    // L2 sin penalizar el intercepto
    for (let a = 1; a < k; a++) { g[a] += lambda * theta[a]; H[a][a] += lambda; }

    const paso = resolver(H, g);
    theta = theta.map((t, a) => t - paso[a]);
    if (Math.max(...paso.map(Math.abs)) < tol) { convergio = true; iter++; break; }
  }

  const coeficientes = new Array<number>(d).fill(0);
  activas.forEach((j, a) => { coeficientes[j] = theta[a + 1]; });
  const intercepto = theta[0];

  let perdida = 0;
  for (let i = 0; i < n; i++) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, sigmoide(logit(X[i], intercepto, coeficientes))));
    perdida -= y[i] * Math.log(p) + (1 - y[i]) * Math.log(1 - p);
  }

  return {
    intercepto, coeficientes, sinVariacion, iteraciones: iter,
    perdida: perdida / (n || 1), convergio,
  };
}
