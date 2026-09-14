import { useEffect, useState } from "react";
import { Logo, Marca, Icono } from "../componentes/UI";

/** El id enlaza cada entrada del menú con su sección en la página. */
const SECCIONES = [
  { id: "contexto", t: "Contexto" },
  { id: "metodo", t: "Método" },
  { id: "proceso", t: "Proceso" },
  { id: "acceso", t: "Acceso" },
];

const PILARES = [
  {
    n: "0.1", t: "Detecta",
    d: "El excedente se registra en el punto donde ocurre, con su estado, su temperatura y su vida útil restante. Sin ese dato el modelo no puede decidir nada.",
  },
  {
    n: "0.2", t: "Recomienda",
    d: "La lógica de correspondencia cruza lo disponible contra el recetario institucional y devuelve las alternativas viables, ordenadas por aptitud.",
  },
  {
    n: "0.3", t: "Explica",
    d: "Cada recomendación llega con los factores que la sostienen y su peso. Una propuesta sin sustento visible no sobrevive al uso cotidiano en cocina.",
  },
];

const PASOS = [
  { t: "Estructuración", d: "Producción, asistencia, mermas y recetario se integran en un esquema relacional cruzado por fecha, servicio e ingrediente." },
  { t: "Correspondencia", d: "Filtros sanitarios duros primero; después, puntuación ponderada de siete factores observables." },
  { t: "Explicabilidad", d: "La puntuación se calcula descompuesta, de modo que la explicación es la aritmética del modelo y no una reconstrucción." },
  { t: "Decisión", d: "El responsable aprueba, modifica o descarta. Cada decisión queda registrada para auditoría y reentrenamiento." },
];

export default function Portada({ onEntrar }: { onEntrar: () => void }) {
  const [activa, setActiva] = useState("");

  /**
   * Resalta en el menú la sección visible. Se usa IntersectionObserver en
   * lugar de escuchar el scroll: el navegador hace el cálculo y no se
   * dispara un evento por cada píxel desplazado.
   */
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entradas) => {
        const visible = entradas
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiva(visible.target.id);
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: [0, 0.25, 0.5] },
    );
    for (const s of SECCIONES) {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, []);

  const irA = (id: string) => {
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <div className="portada">
      <div className="fondo-vivo" aria-hidden="true">
        <span className="orbe o1" />
        <span className="orbe o2" />
        <span className="orbe o3" />
      </div>
      <nav className="p-nav">
        <span className="marca"><Marca /></span>
        <div className="enlaces">
          {SECCIONES.map((s) => (
            <button key={s.id} onClick={() => irA(s.id)}
              aria-current={activa === s.id}>
              {s.t}
            </button>
          ))}
          <button className="btn btn-sm btn-primario" onClick={onEntrar}>
            Entrar
          </button>
        </div>
      </nav>

      <header className="hero">
        <span className="rotulo">Catering industrial · Loja, Ecuador</span>
        <h1>De la merma a <em>nuevas recetas</em></h1>
        <div className="hero-pie">
          <p>
            Un modelo de apoyo a la decisión que convierte los registros históricos
            de producción y residuos en recomendaciones concretas de reaprovechamiento
            culinario, con la explicación de cada propuesta.
          </p>
        </div>
        <div className="fila" style={{ gap: 12, marginTop: 28 }}>
          <button className="btn btn-primario btn-grande" onClick={onEntrar}>
            Abrir el panel <Icono n="flecha" s={18} />
          </button>
          <button className="btn btn-grande" onClick={() => onEntrar()}>
            Ver una recomendación
          </button>
        </div>
      </header>

      <div className="cifras">
        <div>
          <div className="n">939 000</div>
          <div className="l">Toneladas perdidas al año en Ecuador</div>
        </div>
        <div>
          <div className="n">8–10 %</div>
          <div className="l">De las emisiones globales atribuidas al desperdicio</div>
        </div>
        <div>
          <div className="n">7</div>
          <div className="l">Factores que el modelo evalúa y explica</div>
        </div>
      </div>

      <section className="seccion" id="contexto">
        <div className="seccion-cab">
          <span className="rotulo">Contexto</span>
          <h2>El dato existe. La decisión, no.</h2>
          <p>
            Las herramientas disponibles cuantifican cuánto se pierde y dónde, pero
            no dicen qué hacer con esa información. FoodLoop se sitúa en el nivel
            prescriptivo: recomienda una acción concreta sobre un excedente concreto.
          </p>
        </div>
        <div className="rejilla-3">
          {PILARES.map((p) => (
            <article className="celda" key={p.t}>
              <span className="rotulo">{p.t}</span>
              <h3>{p.t}</h3>
              <p>{p.d}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="seccion" id="metodo">
        <div className="seccion-cab">
          <span className="rotulo">Método</span>
          <h2>Cuatro fases</h2>
          <p>
            El artefacto sigue los principios de la investigación en ciencia del
            diseño. Cada fase responde a un objetivo específico y produce una
            salida verificable.
          </p>
        </div>
        <div className="pasos">
          {PASOS.map((p) => (
            <article className="paso" key={p.t}>
              
              <h3>{p.t}</h3>
              <p>{p.d}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="seccion" id="proceso">
        <div className="seccion-cab">
          <span className="rotulo">Jerarquía</span>
          <h2>Alimentar antes que conservar</h2>
          <p>
            El modelo aplica la ordenación de la jerarquía de gestión del excedente:
            reutilizar alimentando personas es preferible a congelar, que solo
            aplaza la decisión. Ese criterio pesa dentro de la puntuación.
          </p>
        </div>
        <div className="rejilla-3">
          <article className="celda">
            <span className="rotulo">Preferente</span>
            <h3>Reutilización culinaria</h3>
            <p>El excedente vuelve a la línea como ingrediente de una nueva preparación servida a comensales.</p>
          </article>
          <article className="celda">
            <span className="rotulo">Intermedio</span>
            <h3>Conservación</h3>
            <p>Porcionado y congelación. Mantiene el valor alimentario pero traslada la decisión a otro día.</p>
          </article>
          <article className="celda">
            <span className="rotulo">Último recurso</span>
            <h3>Descarte</h3>
            <p>Compostaje o vertedero. El sistema registra el motivo, que alimenta el reentrenamiento del modelo.</p>
          </article>
        </div>
      </section>

      <section className="cta" id="acceso">
        <div>
          <span className="rotulo">Acceso</span>
          <h2>Entra al prototipo</h2>
        </div>
        <div className="der">
          <button className="btn btn-primario btn-grande" onClick={onEntrar}>
            Abrir el panel <Icono n="flecha" s={18} />
          </button>
          <p className="pequeno apagado" style={{ maxWidth: "34ch" }}>
            Prototipo de validación académica. Los datos son simulados y se
            reinician en cada sesión.
          </p>
        </div>
      </section>

      <footer className="pie">
        <Logo tam={22} />
        <span>FoodLoop · Prototipo funcional v1.0</span>
        <span style={{ marginLeft: "auto" }}>
          Modelo para el aprovechamiento de mermas alimentarias en operaciones de
          catering industrial
        </span>
      </footer>
    </div>
  );
}
