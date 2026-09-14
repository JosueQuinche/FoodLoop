/**
 * FoodLoop · Gráficas
 *
 * SVG generado a mano en lugar de una librería. Tres razones: el peso del
 * paquete no crece, los colores salen de las variables CSS y por tanto el
 * modo oscuro funciona solo, y no hay una capa de terceros entre los datos
 * y lo que se dibuja.
 */

import { fmt } from "./UI";

const PALETA = ["var(--verde)", "var(--naranja)", "var(--accion)", "var(--critico)", "var(--texto-3)"];

/** Barras horizontales. Para comparar categorías con nombre largo. */
export function BarrasH(
  { datos, unidad = "kg" }: {
    datos: { etiqueta: string; valor: number; maximo?: number }[];
    unidad?: string;
  },
) {
  const tope = Math.max(...datos.map((d) => d.maximo ?? d.valor), 1);
  return (
    <div>
      {datos.map((d, i) => (
        <div className="barra-h" key={d.etiqueta}>
          <span className="pequeno">{d.etiqueta}</span>
          <div className="pista">
            <div className="relleno" style={{
              width: `${(d.valor / tope) * 100}%`,
              background: PALETA[i % PALETA.length],
            }} />
          </div>
          <span className="num pequeno">{fmt(d.valor)} {unidad}</span>
        </div>
      ))}
    </div>
  );
}

/** Barras verticales agrupadas. Para series temporales cortas. */
export function BarrasAgrupadas(
  { datos, series }: {
    datos: { etiqueta: string; valores: number[] }[];
    series: { nombre: string; color: string }[];
  },
) {
  const tope = Math.max(...datos.flatMap((d) => d.valores), 1);
  const alto = 150;
  return (
    <div>
      <div className="barras-v" style={{ height: alto }}>
        {datos.map((d) => (
          <div className="columna" key={d.etiqueta}>
            <div className="grupo">
              {d.valores.map((v, j) => (
                <div
                  key={j}
                  className="barra"
                  style={{
                    height: `${Math.max(2, (v / tope) * (alto - 26))}px`,
                    background: series[j].color,
                  }}
                  title={`${series[j].nombre}: ${fmt(v)} kg`}
                />
              ))}
            </div>
            <span className="eje">{d.etiqueta}</span>
          </div>
        ))}
      </div>
      <div className="leyenda">
        {series.map((s) => (
          <span key={s.nombre}>
            <i style={{ background: s.color }} />{s.nombre}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Anillo. Para una composición de pocas categorías. */
export function Anillo(
  { datos }: { datos: { etiqueta: string; valor: number; color: string }[] },
) {
  const total = datos.reduce((a, d) => a + d.valor, 0) || 1;
  const R = 54, r = 34, C = 2 * Math.PI * ((R + r) / 2);
  let acumulado = 0;

  return (
    <div className="anillo">
      <svg viewBox="0 0 130 130" width="130" height="130" role="img"
        aria-label="Distribución de lotes por estado">
        <g transform="rotate(-90 65 65)">
          {datos.filter((d) => d.valor > 0).map((d) => {
            const largo = (d.valor / total) * C;
            const el = (
              <circle key={d.etiqueta} cx="65" cy="65" r={(R + r) / 2}
                fill="none" stroke={d.color} strokeWidth={R - r}
                strokeDasharray={`${largo} ${C - largo}`}
                strokeDashoffset={-acumulado} />
            );
            acumulado += largo;
            return el;
          })}
        </g>
        <text x="65" y="61" textAnchor="middle" className="anillo-n">{total}</text>
        <text x="65" y="76" textAnchor="middle" className="anillo-l">lotes</text>
      </svg>
      <div className="anillo-leyenda">
        {datos.map((d) => (
          <div key={d.etiqueta}>
            <i style={{ background: d.color }} />
            <span className="pequeno">{d.etiqueta}</span>
            <span className="num pequeno apagado">{d.valor}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const COLOR_ESTADO: Record<string, string> = {
  "Apto": "var(--verde)",
  "Por vencer": "var(--naranja)",
  "Crítico": "var(--critico)",
  "Sin dictamen": "var(--texto-3)",
};

export const ETIQUETA_CAUSA: Record<string, string> = {
  sobreproduccion: "Sobreproducción",
  devolucion_linea: "Devolución de línea",
  error_porcionado: "Error de porcionado",
  caducidad_proxima: "Caducidad próxima",
  defecto_calidad: "Defecto de calidad",
};
