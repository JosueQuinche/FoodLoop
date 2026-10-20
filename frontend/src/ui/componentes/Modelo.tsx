/**
 * FoodLoop · Pantalla del modelo
 *
 * Muestra el modelo, no su resultado. El resto de la aplicación enseña
 * qué recomendó; esta pantalla enseña cómo llegó ahí: las seis etapas
 * con lo que entró y salió de cada una, las recetas que se descartaron
 * con la regla que lo decidió, el vector de siete características de
 * cada candidata, los pesos con la procedencia de cada uno, y la
 * aritmética completa de la propuesta ganadora con la comprobación de
 * que las contribuciones suman la aptitud publicada.
 *
 * Existe porque la explicación por factores, que ya estaba, responde
 * «por qué esta receta» pero no «qué es este modelo». Son dos preguntas
 * distintas y las hacen personas distintas: la primera la hace quien
 * decide en cocina, la segunda quien tiene que juzgar el sistema.
 *
 * Todo lo que se ve aquí viene del servidor. Ni una cifra se recalcula
 * en el navegador: la ficha sale de `GET /modelo` y la traza viaja con
 * la recomendación que el usuario tiene en pantalla, de modo que las
 * etapas que se muestran son las de ESA ejecución y no las de otra.
 */

import { useEffect, useState } from "react";
import type { FichaModelo, SalidaRecomendacion } from "@foodloop/dominio";
import { api } from "../../infraestructura/adaptadores/salida/http/repositorios";
import { Icono, fmt } from "./UI";

/** Abreviatura de cada eje, para que la matriz quepa a lo ancho. */
const CORTO: Record<string, string> = {
  cobertura: "cobert", aporteMerma: "aporte", urgencia: "urgenc",
  absorcion: "absorc", jerarquia: "jerarq", aceptacion: "acepta",
  cargaArea: "carga",
};
const EJES = ["cobertura", "aporteMerma", "urgencia", "absorcion",
  "jerarquia", "aceptacion", "cargaArea"];

/**
 * Cuántas filas de la matriz de características se muestran.
 *
 * Con el catálogo del centro una selección admite medio centenar de
 * recetas, y la tabla entera se comía la pantalla sin añadir nada: lo
 * que hay que poder ver es que cada candidata se convierte en siete
 * números, no las cincuenta. Se muestran las mejores y se dice cuántas
 * quedan fuera.
 */
const FILAS_MATRIZ = 12;

type Detalle = Record<string, unknown>;

/**
 * Lee un eje de un mapa de siete valores.
 *
 * La traza llega como JSON y sus mapas de ejes son objetos sin tipar.
 * Un acceso con conversión en línea dentro del JSX se parte en dos
 * líneas y deja de compilar, así que la conversión vive aquí, una vez.
 */
const eje = (mapa: unknown, k: string): number =>
  (mapa as Record<string, number>)[k] ?? 0;

export function Modelo({ salida }: { salida: SalidaRecomendacion | null }) {
  const [ficha, setFicha] = useState<FichaModelo | null>(null);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    api.modelo().then(setFicha).catch(() => setFallo(true));
  }, []);

  if (fallo)
    return (
      <div className="tarjeta">
        <p>No se pudo leer la ficha del modelo. Comprueba que el servidor
          esté levantado.</p>
      </div>
    );
  if (!ficha) return <div className="tarjeta"><p className="apagado">Cargando…</p></div>;

  const traza = salida?.traza;
  const etapasTraza = new Map(
    (traza?.etapas ?? []).map((e) => [e.codigo, e]));
  const primera = salida?.resultados[0];
  const vectorGanador = traza?.vectores.find(
    (v) => v.receta === primera?.item.codigo);

  return (
    <>
      <div className="cabecera">
        <div>
          <h1>El modelo, por dentro</h1>
          <p>{ficha.tipo}</p>
        </div>
        <div className="espacio" />
        <span className="distintivo d-neutro mono">v{ficha.version}</span>
        {salida && (
          <span className={`distintivo ${salida.modo === "potencial"
            ? "d-aviso" : "d-ok"}`}>
            modo {salida.modo}
          </span>
        )}
      </div>

      {!salida && (
        <div className="aviso">
          <Icono n="cerebro" s={16} />
          <span>Abajo está el modelo tal como está declarado. Para ver una
            ejecución concreta —qué entró en cada etapa y de dónde sale cada
            cifra— selecciona un lote en el panel y vuelve aquí.</span>
        </div>
      )}

      {/* ---------------- las seis etapas ---------------- */}
      <div className="seccion-cab">
        <h2>Las seis etapas</h2>
        <p className="pequeno apagado">
          Cada una en su propio archivo, con su entrada y su salida
          declaradas. {salida
            ? `Esta ejecución tardó ${traza?.ms} ms en total.`
            : "Los números aparecen al evaluar un lote."}
        </p>
      </div>

      <div className="pila etapas">
        {ficha.etapas.map((e) => {
          const t = etapasTraza.get(e.codigo as never);
          return (
            <div className="etapa" key={e.codigo}>
              <div className="etapa-id">
                <span className="etapa-cod mono">{e.codigo}</span>
                {t && <span className="etapa-ms mono">{t.ms} ms</span>}
              </div>
              <div>
                <h3>{e.nombre}</h3>
                <div className="etapa-flujo">
                  <div>
                    <span className="rotulo">entra</span>
                    <p>{t ? t.entra : e.entra}</p>
                  </div>
                  <div>
                    <span className="rotulo">sale</span>
                    <p>{t ? t.sale : e.sale}</p>
                  </div>
                </div>
                <p className="porque">{e.porQue}</p>
                <code className="etapa-archivo mono">{e.archivo}</code>
              </div>
            </div>
          );
        })}
      </div>

      {/* ---------------- qué se descartó ---------------- */}
      {traza && traza.descartesDetallados.length > 0 && (
        <>
          <div className="seccion-cab">
            <h2>Etapa 2 · lo que no llegó a puntuarse</h2>
            <p className="pequeno apagado">
              {traza.descartesDetallados.length} recetas descartadas, con la
              regla que lo decidió y lo que se observó. Una restricción
              sanitaria no se compensa con una puntuación alta: la receta no
              llega a la etapa de puntuación.
            </p>
          </div>
          <div className="tarjeta sin-relleno">
            <table className="tabla-modelo">
              <thead>
                <tr><th>Receta</th><th>Regla</th><th>Lote</th><th>Observado</th></tr>
              </thead>
              <tbody>
                {traza.descartesDetallados
                  .filter((d) => d.decisiva !== "R0")
                  .map((d) => {
                    const i = d.incumplimientos[0];
                    const regla = ficha.reglas.find((x) => x.codigo === d.decisiva);
                    return (
                      <tr key={d.receta}>
                        <td className="mono">{d.receta}</td>
                        <td>
                          <span className="distintivo d-critico mono">{d.decisiva}</span>
                          {" "}{regla?.titulo}
                        </td>
                        <td className="mono apagado">{i?.lote || "—"}</td>
                        <td className="apagado">{i?.observado}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            {traza.descartesDetallados.every((d) => d.decisiva === "R0") && (
              <p className="pequeno apagado" style={{ padding: 16 }}>
                Las descartadas lo fueron todas por no compartir ningún
                ingrediente con la selección, que es el caso de la mayoría del
                catálogo y no se lista.
              </p>
            )}
          </div>
        </>
      )}

      {/* ---------------- el vector ---------------- */}
      {traza && traza.vectores.length > 0 && (
        <>
          <div className="seccion-cab">
            <h2>Etapa 3 · la situación medida en siete números</h2>
            <p className="pequeno apagado">
              Cada receta admisible se convierte en siete valores entre 0 y 1.
              Esta etapa no conoce los pesos: solo mide. Es la representación
              sobre la que el modelo decide.
            </p>
          </div>
          <div className="tarjeta sin-relleno">
            <table className="tabla-modelo matriz">
              <thead>
                <tr>
                  <th>Receta</th>
                  {EJES.map((k) => <th key={k} className="num">{CORTO[k]}</th>)}
                  <th className="num">aptitud</th>
                </tr>
              </thead>
              <tbody>
                {[...traza.vectores]
                  .sort((a, b) => b.aptitud - a.aptitud)
                  .slice(0, FILAS_MATRIZ)
                  .map((v) => (
                  <tr key={v.receta}
                    className={v.receta === primera?.item.codigo ? "destacada" : ""}>
                    <td className="mono">{v.receta}</td>
                    {EJES.map((k) => (
                      <td key={k} className="num mono">
                        {fmt(eje(v.valores, k), 2)}
                      </td>
                    ))}
                    <td className="num mono fuerte">{fmt(v.aptitud, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {traza.vectores.length > FILAS_MATRIZ && (
              <p className="pequeno apagado" style={{ padding: "12px 14px" }}>
                Se muestran las {FILAS_MATRIZ} de mayor aptitud de{" "}
                {traza.vectores.length} candidatas admisibles. Las demás se
                midieron igual y entraron en el ordenamiento.
              </p>
            )}
          </div>
        </>
      )}

      {/* ---------------- la aritmética ---------------- */}
      {vectorGanador && primera && (
        <>
          <div className="seccion-cab">
            <h2>Etapa 4 · de dónde sale la aptitud {fmt(primera.aptitud, 1)}</h2>
            <p className="pequeno apagado">
              valor de aprovechamiento = suma de (valor × peso × 100), recortada
              a [0, 100]; aptitud = P(ejecución) × valor, con P estimada por el
              componente aprendido (sección más abajo). La cota de estos pesos
              es {ficha.cotaSuperior}.
            </p>
          </div>
          <div className="tarjeta sin-relleno">
            <table className="tabla-modelo">
              <thead>
                <tr>
                  <th>Eje</th><th className="num">valor</th>
                  <th className="num">peso</th><th className="num">× 100</th>
                  <th>origen del peso</th>
                </tr>
              </thead>
              <tbody>
                {EJES.map((k) => {
                  const p = ficha.parametros.find((x) => x.eje === k)!;
                  const valor = eje(vectorGanador.valores, k);
                  const aporte = eje(vectorGanador.contribuciones, k);
                  return (
                    <tr key={k}>
                      <td>{p.etiqueta}</td>
                      <td className="num mono">{fmt(valor, 4)}</td>
                      <td className="num mono">{fmt(p.peso, 2)}</td>
                      <td className={`num mono fuerte ${aporte < 0 ? "neg" : ""}`}>
                        {aporte >= 0 ? "+" : ""}{fmt(aporte, 3)}
                      </td>
                      <td className="apagado">
                        <span className={`distintivo ${p.origen === "experto"
                          ? "d-neutro" : "d-ok"}`}>{p.origen}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Suma de las siete contribuciones = valor de aprovechamiento</td>
                  <td className="num mono fuerte">
                    {fmt(EJES.reduce(
                      (a, k) => a + eje(vectorGanador.contribuciones, k), 0), 1)}
                  </td>
                  <td />
                </tr>
                {primera.probabilidadEjecucion !== undefined && (
                  <tr>
                    <td colSpan={3}>× probabilidad de ejecución (aprendida)</td>
                    <td className="num mono fuerte">
                      {fmt(primera.probabilidadEjecucion * 100, 1)} %
                    </td>
                    <td />
                  </tr>
                )}
                <tr>
                  <td colSpan={3}>Aptitud publicada</td>
                  <td className="num mono fuerte">{fmt(primera.aptitud, 1)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="contra">
            Las dos cifras coinciden, y por eso la explicación que ve la cocina
            es la aritmética del modelo y no una reconstrucción posterior de
            ella. Puede comprobarse con una calculadora.
          </div>
        </>
      )}

      {/* ---------------- el orden ---------------- */}
      {traza && etapasTraza.get("E5") && (
        <>
          <div className="seccion-cab">
            <h2>Etapa 5 · el orden y sus desempates</h2>
            <p className="pequeno apagado">
              Aptitud, después kilos aprovechados, después ventana más corta, y
              por último el código de receta. Los tres desempates están
              declarados para que la salida no dependa del orden en que el
              catálogo venga de la base de datos.
            </p>
          </div>
          <div className="tarjeta">
            <div className="pila" style={{ gap: 8 }}>
              {((etapasTraza.get("E5")!.detalle as Detalle).ranking as
                [number, string, number][] ?? []).map(([pos, cod, apt]) => (
                <div className="fila ranking-fila" key={cod}>
                  <span className="rec-pos mono">{pos}</span>
                  <span className="mono">{cod}</span>
                  <div className="espacio" />
                  <span className="mono fuerte">{fmt(apt, 1)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ---------------- reglas y parámetros declarados ---------------- */}
      <div className="seccion-cab">
        <h2>Las seis restricciones</h2>
        <p className="pequeno apagado">
          Binarias. Cinco provienen del análisis de peligros y puntos críticos
          de control; la primera es estructural.
        </p>
      </div>
      <div className="tarjeta sin-relleno">
        <table className="tabla-modelo">
          <thead>
            <tr><th>Código</th><th>Regla</th><th>Alcance</th><th>Fundamento</th></tr>
          </thead>
          <tbody>
            {ficha.reglas.map((g) => {
              const aplazada = salida?.modo === "potencial"
                && (g.codigo === "R1" || g.codigo === "R4");
              return (
                <tr key={g.codigo} className={aplazada ? "aplazada" : ""}>
                  <td>
                    <span className={`distintivo mono ${aplazada
                      ? "d-aviso" : "d-neutro"}`}>{g.codigo}</span>
                  </td>
                  <td>
                    {g.titulo}
                    {aplazada && (
                      <div className="pequeno" style={{ color: "var(--naranja-texto)" }}>
                        aplazada: depende de un dato que no se midió
                      </div>
                    )}
                  </td>
                  <td className="apagado">{g.alcance}</td>
                  <td className="apagado">{g.fundamento}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="seccion-cab">
        <h2>Valor de aprovechamiento · los siete pesos</h2>
        <p className="pequeno apagado">
          El objetivo del sistema, de criterio experto. Viven en un archivo
          aparte y entran a la etapa 4 como argumento.
        </p>
      </div>
      <div className="tarjeta sin-relleno">
        <table className="tabla-modelo">
          <thead>
            <tr><th>Eje</th><th className="num">peso</th><th>origen</th>
              <th>Fundamento</th></tr>
          </thead>
          <tbody>
            {ficha.parametros.map((p) => (
              <tr key={p.eje}>
                <td>{p.etiqueta}</td>
                <td className="num mono fuerte">{fmt(p.peso, 2)}</td>
                <td>
                  <span className={`distintivo ${p.origen === "experto"
                    ? "d-neutro" : "d-ok"}`}>{p.origen}</span>
                </td>
                <td className="apagado">{p.fundamento}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------------- componente aprendido ---------------- */}
      {ficha.aprendido && (
        <>
          <div className="seccion-cab">
            <h2>Probabilidad de ejecución · componente aprendido</h2>
            <p className="pequeno apagado">
              {ficha.aprendido.algoritmo}. Objetivo: {ficha.aprendido.objetivo}.
              Entrenado con {ficha.aprendido.ejemplos.toLocaleString("es")} ejemplos
              ({ficha.aprendido.periodoEntrenamiento.desde} a{" "}
              {ficha.aprendido.periodoEntrenamiento.hasta}); evaluado sobre{" "}
              {ficha.aprendido.periodoPrueba.desde} a {ficha.aprendido.periodoPrueba.hasta},
              que el modelo no vio.
            </p>
          </div>
          <div className="tarjeta sin-relleno">
            <table className="tabla-modelo">
              <thead>
                <tr><th>Entrada</th><th className="num">coeficiente</th><th>origen</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Intercepto</td>
                  <td className="num mono fuerte">{fmt(ficha.aprendido.intercepto, 3)}</td>
                  <td><span className="distintivo d-ok">aprendido</span></td>
                </tr>
                {ficha.aprendido.coeficientes.map((c) => (
                  <tr key={c.entrada}>
                    <td>{c.etiqueta}</td>
                    <td className="num mono fuerte">{fmt(c.coeficiente, 3)}</td>
                    <td>
                      <span className={`distintivo ${c.sinVariacion ? "d-neutro" : "d-ok"}`}>
                        {c.sinVariacion ? "sin variación en los datos" : "aprendido"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Object.keys(ficha.aprendido.metricasPrueba).length > 0 && (
            <div className="tarjeta" style={{ marginTop: 12 }}>
              <div className="tarjeta-cab"><h3>Métricas en el periodo de prueba</h3></div>
              <div className="fila" style={{ gap: 24, flexWrap: "wrap" }}>
                {([
                  ["HR@3", "hr3"], ["NDCG@3", "ndcg3"], ["MRR", "mrr"],
                  ["AUC", "aucProbabilidad"], ["Brier", "brier"],
                ] as const).map(([t, k]) => (
                  <div key={k}>
                    <div className="rotulo">{t}</div>
                    <b className="mono">{fmt(ficha.aprendido.metricasPrueba[k] ?? NaN, 3)}</b>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ---------------- lo que falta ---------------- */}
      <div className="seccion-cab">
        <h2>Lo que este modelo todavía no hace</h2>
      </div>
      <div className="pila" style={{ gap: 10 }}>
        {ficha.pendiente.map((p) => (
          <div className="contra" key={p.slice(0, 24)}>{p}</div>
        ))}
      </div>
    </>
  );
}
