import { useEffect, useState } from "react";
import type { ReactNode, CSSProperties } from "react";

/**
 * Isotipo del cliente.
 *
 * Se usan dos representaciones según el tamaño, y no por capricho: el
 * logotipo completo incluye frutas de pocos píxeles que a 30 px se
 * convierten en manchas de color ilegibles. Por encima de 64 px se
 * muestra la imagen original; por debajo, una reducción vectorial del
 * bucle que conserva la forma y los dos colores de marca.
 *
 * La variante clara del archivo lleva el texto en oscuro, de modo que
 * sobre fondo oscuro se sustituye por la versión aclarada.
 */
export function Logo(
  { tam = 34, mono = false, completo = false }:
  { tam?: number; mono?: boolean; completo?: boolean },
) {
  const [oscuro, setOscuro] = useState(
    () => document.documentElement.dataset.tema === "oscuro");

  useEffect(() => {
    const obs = new MutationObserver(() =>
      setOscuro(document.documentElement.dataset.tema === "oscuro"));
    obs.observe(document.documentElement, {
      attributes: true, attributeFilter: ["data-tema"],
    });
    return () => obs.disconnect();
  }, []);

  if (completo || tam >= 64) {
    return (
      <img
        src={oscuro ? "./foodloop-oscuro.png" : "./foodloop.png"}
        alt="FoodLoop"
        width={tam}
        style={{ height: "auto", display: "block", flex: "none" }}
      />
    );
  }

  // Reducción vectorial: el bucle y la punta de flecha, sin las frutas.
  const v = mono ? "currentColor" : "var(--verde)";
  const n = mono ? "currentColor" : "var(--naranja)";
  return (
    <svg viewBox="0 0 66 40" width={tam} aria-hidden="true" style={{ flex: "none" }}>
      <path d="M33 20 C27 8, 10 8, 8 20 C6 32, 27 32, 33 20" fill="none"
        stroke={v} strokeWidth="5.5" strokeLinecap="round" />
      <path d="M33 20 C39 32, 56 32, 58 20 C59.5 11, 50 6, 42 9.5" fill="none"
        stroke={n} strokeWidth="5.5" strokeLinecap="round" />
      <polygon points="36,10 47,4 47,16" fill={n} />
    </svg>
  );
}

/**
 * Logotipo en horizontal: el icono del cliente, con sus frutas, y el
 * nombre al lado. Es el formato del boceto para la barra de navegación,
 * donde el logotipo vertical quedaría demasiado pequeño para leerse.
 */
export function MarcaHorizontal({ alto = 40 }: { alto?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <img src="./foodloop-icono.png" alt="" height={alto}
        style={{ height: alto, width: "auto", display: "block" }} />
      <span style={{
        fontFamily: "Archivo, system-ui, sans-serif", fontWeight: 700,
        fontSize: alto * 0.62, letterSpacing: "-0.03em", lineHeight: 1,
      }}>
        <span style={{ color: "var(--marca-texto)" }}>Food</span>
        <span style={{ color: "var(--naranja)" }}>Loop</span>
      </span>
    </span>
  );
}

/**
 * Imagen de una preparación.
 *
 * Cada receta puede tener dos archivos en `public/recetas`:
 *
 *   REC-005.jpg        panorámico, para la ficha de la receta
 *   REC-005-mini.jpg   cuadrado, para la lista de recomendaciones
 *
 * Son dos porque los encuadres no son intercambiables: la miniatura de
 * la lista es un cuadrado de 76 px y, recortando ahí una imagen 21:9,
 * del plato quedaría una franja central. Cuando el archivo cuadrado no
 * existe se usa el panorámico, y si tampoco está se dibuja una carátula
 * con un color estable por receta y el icono de su tipo de proceso, de
 * modo que la interfaz nunca muestra un hueco ni una imagen rota.
 *
 * En la lista se mantiene en tamaño contenido a propósito: sirve para
 * reconocer el plato de un vistazo, no para persuadir. En una
 * herramienta de apoyo a la decisión, una imagen apetitosa que dominara
 * la tarjeta competiría con los factores que el modelo expone.
 */
export function FotoReceta({
  codigo, nombre, tipoProceso, tam = 76, ancho, panoramica = false,
}: {
  codigo: string; nombre: string; tipoProceso?: string;
  tam?: number; ancho?: number | string;
  /** Formato ancho, para mostrar el plato terminado en la ficha. */
  panoramica?: boolean;
}) {
  // Orden de intentos: el recorte que corresponde a este sitio, luego
  // el otro, y por último la carátula generada.
  const fuentes = panoramica
    ? [`./recetas/${codigo}.jpg`]
    : [`./recetas/${codigo}-mini.jpg`, `./recetas/${codigo}.jpg`];
  const [intento, setIntento] = useState(0);
  const falla = intento >= fuentes.length;

  // Tono estable por receta: el mismo código produce siempre el mismo
  // color. Se multiplica por 31 en lugar de sumar los caracteres porque
  // los códigos del recetario se diferencian en pocos dígitos y una
  // suma simple los agruparía todos en el mismo rango de color.
  let semilla = 0;
  for (const c of codigo) semilla = (semilla * 31 + c.charCodeAt(0)) % 100_000;
  const tono = (semilla * 47) % 360;
  const glifo = tipoProceso === "conservacion" ? "copo"
    : tipoProceso === "panaderia" ? "pan"
    : tipoProceso === "ensamblaje_frio" ? "hoja" : "olla";

  const estilo: CSSProperties = panoramica
    ? { width: "100%", height: "100%", objectFit: "cover", display: "block" }
    : {
        width: ancho ?? tam, height: tam, flex: "none",
        borderRadius: "var(--r)", objectFit: "cover", display: "block",
      };

  if (!falla)
    return (
      <img key={fuentes[intento]} src={fuentes[intento]} alt={nombre}
        style={estilo} onError={() => setIntento((i) => i + 1)}
        loading="lazy" />
    );

  return (
    <div style={{
      ...estilo,
      display: "grid", placeItems: "center", textAlign: "center",
      background: `linear-gradient(135deg, hsl(${tono} 42% 88%), hsl(${(tono + 40) % 360} 50% 78%))`,
      color: `hsl(${tono} 45% 32%)`,
      border: panoramica ? "none" : "1px solid var(--borde)",
    }} role="img" aria-label={`Sin fotografía de ${nombre}`}>
      <div>
        <Icono n={glifo} s={panoramica ? 56 : Math.round(tam * 0.34)} />
        {panoramica && (
          <div style={{
            marginTop: 12, fontSize: 12.5, opacity: .75, maxWidth: "30ch",
            lineHeight: 1.45,
          }}>
            Sin imagen del plato. Se muestra al añadir el archivo{" "}
            <b style={{ fontFamily: "IBM Plex Mono, monospace" }}>{codigo}.jpg</b>
          </div>
        )}
      </div>
    </div>
  );
}

export function Marca({ claro = false }: { claro?: boolean }) {
  return (
    <>
      <Logo tam={30} />
      <span>Food<span style={{ color: claro ? "#FBC490" : "var(--naranja)" }}>Loop</span></span>
    </>
  );
}

const trazos: Record<string, string> = {
  panel: "M3 10.5 12 3l9 7.5M5 10v10h14V10",
  chispa: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z",
  receta: "M4 4.5h6a2.5 2.5 0 0 1 2 2v13a2 2 0 0 0-2-1.5H4zM20 4.5h-6a2.5 2.5 0 0 0-2 2v13a2 2 0 0 1 2-1.5h6z",
  check: "m5 12.5 4.5 4.5L19 7",
  alerta: "M12 4.5 21 19H3zM12 10v4M12 16.5v.01",
  flecha: "M5 12h14M13 6l6 6-6 6",
  salir: "M14 4.5H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 19.5h8M17 8.5 20.5 12 17 15.5M20 12H9.5",
  sol: "M12 2v2M12 20v2M4.2 4.2l1.5 1.5M18.3 18.3l1.5 1.5M2 12h2M20 12h2M4.2 19.8l1.5-1.5M18.3 5.7l1.5-1.5",
  luna: "M20 13.5A8.2 8.2 0 0 1 10.5 4a8.5 8.5 0 1 0 9.5 9.5z",
  plus: "M12 5v14M5 12h14",
  refrescar: "M20 11.5A8 8 0 1 0 18 17M20 6v5.5h-5.5",
  x: "M6 6l12 12M18 6L6 18",
  buscar: "M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM16 16l4 4",
  box: "M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9",
  reloj: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 7.5V12l3 2",
  hoja: "M5 19c0-8 5-14 15-14 0 10-6 15-14 15zM5 19l8-8",
  olla: "M4 10h16v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM4 10H2.5M20 10h1.5M9 6.5c0-1.2 1-1.6 1-2.8M12 6.5c0-1.2 1-1.6 1-2.8M15 6.5c0-1.2 1-1.6 1-2.8",
  copo: "M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M12 7l2.5-2.5M12 7L9.5 4.5M12 17l2.5 2.5M12 17l-2.5 2.5",
  pan: "M5 10.5c0-2.5 3.1-4.5 7-4.5s7 2 7 4.5v5c0 1.4-1.1 2.5-2.5 2.5h-9A2.5 2.5 0 0 1 5 15.5zM9 6.6V18M15 6.6V18",
  globo: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9M12 3c-2.5 2.6-3.8 5.6-3.8 9s1.3 6.4 3.8 9",
  grupo: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M17.5 13.4a6.5 6.5 0 0 1 4 6.6",
  "flecha-izq": "M19 12H5M11 6l-6 6 6 6",
  usuario: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20a7.5 7.5 0 0 1 15 0",
  escudo: "M12 3l7 3v5.5c0 4.2-2.9 7.6-7 8.5-4.1-.9-7-4.3-7-8.5V6z",
};

export function Icono({ n, s = 17 }: { n: keyof typeof trazos | "cerebro" | "sol"; s?: number }) {
  if (n === "cerebro")
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="6" r="2.4" /><circle cx="6.5" cy="16" r="2.4" />
        <circle cx="17.5" cy="16" r="2.4" />
        <path d="M10.6 7.9 7.9 13.9M13.4 7.9l2.7 6M8.9 16h6.2" />
      </svg>
    );
  if (n === "sol")
    return (
      <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" /><path d={trazos.sol} />
      </svg>
    );
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={trazos[n]} />
    </svg>
  );
}

/** Distintivo de estado. El color nunca va solo: siempre lleva texto. */
export function Distintivo(
  { tipo, children }: { tipo: "ok" | "aviso" | "critico" | "neutro"; children: ReactNode },
) {
  const clase = { ok: "d-ok", aviso: "d-aviso", critico: "d-critico", neutro: "d-neutro" }[tipo];
  return (
    <span className={`distintivo ${clase}`}>
      {tipo !== "neutro" && <span className="punto" />}
      {children}
    </span>
  );
}

export function useTema() {
  const [tema, setTema] = useState<"claro" | "oscuro">("claro");
  useEffect(() => { document.documentElement.dataset.tema = tema; }, [tema]);
  return { tema, alternar: () => setTema((t) => (t === "claro" ? "oscuro" : "claro")) };
}

export function Aviso({ texto }: { texto: string | null }) {
  if (!texto) return null;
  return <div className="aviso-flotante" role="status" aria-live="polite">{texto}</div>;
}

export const fmt = (n: number, d = 1) =>
  n.toLocaleString("es-EC", { minimumFractionDigits: d, maximumFractionDigits: d });
