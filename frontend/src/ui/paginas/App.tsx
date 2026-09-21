/**
 * FoodLoop · Interfaz
 *
 * Adaptador de entrada. No contiene reglas de negocio: invoca la API y
 * pinta lo que devuelve. Toda validación que importe se repite en el
 * backend, porque la del navegador es comodidad, no control.
 */

import { useCallback, useEffect, useState } from "react";
import type {
  Resultado, Rol, ResumenOperacion, SalidaRecomendacion,
  Estadisticas, EntradaMerma, Causa, Usuario,
} from "@foodloop/dominio";
import { ErrorDominio, PERFILES, AMBITO, permisosDe } from "@foodloop/dominio";
import { api, fijarSesion } from "../../infraestructura/adaptadores/salida/http/repositorios";
import type {
  Maestros, InventarioItem, HistorialItem,
} from "../../infraestructura/adaptadores/salida/http/repositorios";
import { Logo, Icono, Distintivo, fmt } from "../componentes/UI";
import { BarrasH, BarrasAgrupadas, Anillo, COLOR_ESTADO, ETIQUETA_CAUSA } from "../componentes/Graficas";

type Pantalla = "panel" | "registro" | "inventario" | "recomendaciones"
  | "xai" | "receta" | "historial" | "perfil";

const TITULOS: Record<Pantalla, string> = {
  panel: "Panel",
  registro: "Registrar merma",
  recomendaciones: "Recomendaciones",
  xai: "Explicación",
  inventario: "Ingredientes disponibles",
  receta: "Receta",
  historial: "Histórico",
  perfil: "Mi perfil",
};

const ICONOS: Record<Pantalla, Parameters<typeof Icono>[0]["n"]> = {
  panel: "panel", registro: "plus", recomendaciones: "chispa",
  xai: "cerebro", receta: "receta", perfil: "usuario",
  inventario: "box", historial: "reloj",
};

const ETIQUETA_VIDA = {
  apto: "Apto", por_vencer: "Por vencer", critico: "Crítico",
  vencido: "Vencido", sin_dictamen: "Sin dictamen",
} as const;

const TIPO_VIDA = {
  apto: "ok", por_vencer: "aviso", critico: "critico",
  vencido: "neutro", sin_dictamen: "critico",
} as const;

/** Opciones del filtro de estado, en el orden en que se usan. */
const FILTROS = [
  { clave: "accionables", etiqueta: "Accionables" },
  { clave: "todos", etiqueta: "Todos" },
  { clave: "critico", etiqueta: "Críticos" },
  { clave: "por_vencer", etiqueta: "Por vencer" },
  { clave: "apto", etiqueta: "Aptos" },
  { clave: "sin_dictamen", etiqueta: "Sin dictamen" },
  { clave: "vencido", etiqueta: "Vencidos" },
] as const;

/** Iniciales a partir del nombre real de la cuenta. */
const iniciales = (nombre: string) =>
  nombre.split(" ").filter(Boolean).slice(0, 2)
    .map((p) => p[0]!.toUpperCase()).join("");

const CAUSAS: Causa[] = [
  "sobreproduccion", "devolucion_linea", "error_porcionado",
  "caducidad_proxima", "defecto_calidad",
];

/** Qué ve cada perfil. Se deriva de las atribuciones, no se declara aparte. */
const PANTALLAS_ROL: Record<Rol, string[]> = {
  chef: ["Panel", "Registrar merma", "Recomendaciones", "Explicación", "Receta"],
  produccion: ["Panel", "Registrar merma", "Recomendaciones", "Explicación", "Receta"],
  admin: ["Panel con costos", "Recomendaciones (consulta)", "Explicación", "Receta (lectura)"],
  calidad: ["Panel sanitario", "Registrar merma con dictamen", "Recomendaciones (consulta)", "Explicación"],
};

const ATRIBUCIONES = [
  {
    clave: "aprueba" as const, titulo: "Aprobar recomendaciones",
    si: "Puedes aprobar una propuesta y enviarla a producción.",
    no: "La aprobación corresponde al chef ejecutivo o a producción.",
  },
  {
    clave: "veCostos" as const, titulo: "Consultar costos",
    si: "Ves el costo unitario, el valor en riesgo y el costo recuperado.",
    no: "Los datos económicos están reservados a producción y administración.",
  },
  {
    clave: "editaRecetario" as const, titulo: "Editar el recetario",
    si: "Puedes modificar las recetas estandarizadas del catálogo.",
    no: "El recetario solo lo edita el chef ejecutivo.",
  },
  {
    clave: "dictaminaSanidad" as const, titulo: "Emitir dictamen sanitario",
    si: "Tu dictamen habilita o bloquea el reproceso de cada lote.",
    no: "El dictamen sanitario corresponde al supervisor de calidad.",
  },
];

const FORM_INICIAL: EntradaMerma = {
  ingredienteId: 0, areaId: 0, servicioId: 0, cantidad: 0,
  estadoProducto: "cocido", temperaturaC: 3.2,
  causa: "sobreproduccion", aptoReproceso: true,
};

export default function App(
  { usuario, onSalir, tema, alternarTema, notificar }: {
    usuario: Usuario; onSalir: () => void; tema: string;
    alternarTema: () => void; notificar: (t: string) => void;
  },
) {
  // El rol viene de la cuenta, no de una lista del código.
  const [rol, setRol] = useState<Rol>(usuario.rol);
  const [pantalla, setPantalla] = useState<Pantalla>("panel");
  const [resumen, setResumen] = useState<ResumenOperacion | null>(null);
  const [stats, setStats] = useState<Estadisticas | null>(null);
  const [maestros, setMaestros] = useState<Maestros | null>(null);
  const [salida, setSalida] = useState<SalidaRecomendacion | null>(null);
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [valorados, setValorados] = useState<Set<number>>(new Set());
  const [inventario, setInventario] = useState<InventarioItem[] | null>(null);
  const [historial, setHistorial] = useState<HistorialItem[] | null>(null);
  const [recSel, setRecSel] = useState<Resultado | null>(null);
  const [cargando, setCargando] = useState(false);
  const [form, setForm] = useState<EntradaMerma>(FORM_INICIAL);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [fallo, setFallo] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<string>("accionables");
  const [busqueda, setBusqueda] = useState("");

  const permisos = permisosDe(rol);
  const perfil = PERFILES[rol];

  const refrescar = useCallback(async () => {
    try {
      const [op, st] = await Promise.all([api.operacion(), api.estadisticas()]);
      setResumen(op); setStats(st); setFallo(null);
    } catch {
      setFallo("No hay conexión con el backend. Comprueba que esté corriendo "
        + "en el puerto 3001 y que PostgreSQL esté activo.");
    }
  }, []);

  useEffect(() => { void refrescar(); }, [refrescar]);

  useEffect(() => {
    if (pantalla === "inventario" && !inventario)
      api.inventario().then(setInventario).catch(() => notificar("No se pudo cargar el inventario."));
    if (pantalla === "historial" && !historial)
      api.historial().then(setHistorial).catch(() => notificar("No se pudo cargar el histórico."));
  }, [pantalla, inventario, historial, notificar]);
  useEffect(() => { fijarSesion(rol, PERFILES[rol].nombre); }, [rol]);

  useEffect(() => {
    if (pantalla !== "registro" || maestros) return;
    api.maestros().then((m) => {
      setMaestros(m);
      setForm((f) => ({
        ...f,
        ingredienteId: m.ingredientes[0]?.id ?? 0,
        areaId: m.areas[0]?.id ?? 0,
        servicioId: 0,
      }));
    }).catch(() => notificar("No se pudieron cargar los catálogos."));
  }, [pantalla, maestros, notificar]);

  /** Evalúa el conjunto indicado. Uno o varios lotes, mismo camino. */
  async function abrir(loteIds: number[]) {
    if (loteIds.length === 0) return;
    setCargando(true); setRecSel(null); setPantalla("recomendaciones");
    try {
      setSalida(await api.recomendaciones(loteIds));
    } catch (e) {
      notificar(e instanceof ErrorDominio ? e.message : "No se pudo evaluar la selección.");
      setPantalla("panel");
    } finally { setCargando(false); }
  }

  function alternar(id: number) {
    setSeleccion((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  /** Añade un lote sugerido y vuelve a evaluar con el conjunto ampliado. */
  async function incorporar(loteId: number) {
    if (!salida) return;
    const ids = [...salida.lotes.map((l) => l.id), loteId];
    setSeleccion(new Set(ids));
    await abrir(ids);
    notificar("Lote incorporado. La propuesta se recalculó con el conjunto.");
  }

  async function valorar(
    recomendacionId: number,
    claridad: "clara" | "confusa" | "insuficiente",
  ) {
    try {
      await api.feedback({ recomendacionId, claridad });
      setValorados((v) => new Set(v).add(recomendacionId));
      notificar(claridad === "clara"
        ? "Gracias. Tu valoración alimenta la evaluación del modelo."
        : "Registrado. Se revisará la redacción de esta explicación.");
    } catch {
      notificar("No se pudo registrar la valoración.");
    }
  }

  async function aprobar(r: Resultado) {
    if (!salida) return;
    try {
      if (!r.recomendacionId) {
        notificar("La recomendación no se pudo identificar. Vuelve a evaluar.");
        return;
      }
      await api.decidir({
        recomendacionId: r.recomendacionId, recetaId: r.item.id, accion: "aprobada",
      });
      notificar(`«${r.item.nombre}» aprobada y enviada a producción.`);
      setSeleccion(new Set());
      await refrescar();
      setPantalla("panel");
    } catch (e) {
      notificar(e instanceof ErrorDominio ? e.message : "No se pudo registrar la decisión.");
    }
  }

  async function guardarMerma() {
    const err: Record<string, string> = {};
    if (!form.cantidad || form.cantidad <= 0) err.cantidad = "Indica una cantidad mayor que cero.";
    if (form.servicioId < 0) err.servicioId = "Selecciona el servicio.";
    if (Number.isNaN(form.temperaturaC)) err.temperaturaC = "Indica la temperatura medida.";
    setErrores(err);
    if (Object.keys(err).length) return;

    try {
      const l = await api.registrarMerma(form);
      notificar(`Lote ${l.codigo} registrado. Vence en `
        + `${Math.round((l.venceEn.getTime() - Date.now()) / 3_600_000)} horas.`);
      setForm({ ...FORM_INICIAL, ingredienteId: form.ingredienteId,
        areaId: form.areaId, servicioId: form.servicioId });
      await refrescar();
      setPantalla("panel");
    } catch (e) {
      notificar(e instanceof ErrorDominio ? e.message : "No se pudo registrar la merma.");
    }
  }

  /**
   * «Accionables» es el filtro por defecto: oculta vencidos y lotes sin
   * dictamen, que son los que el motor va a rechazar de todos modos. Se
   * evita así que el usuario pulse Analizar en lotes sin salida posible.
   */
  const lotesVisibles = (resumen?.lotes ?? []).filter((l) => {
    const coincideEstado =
      filtro === "todos" ? true
      : filtro === "accionables"
        ? l.estadoVida !== "vencido" && l.estadoVida !== "sin_dictamen"
        : l.estadoVida === filtro;
    if (!coincideEstado) return false;
    if (!busqueda.trim()) return true;
    const t = busqueda.toLowerCase();
    return l.lote.codigo.toLowerCase().includes(t)
      || l.lote.ingrediente.toLowerCase().includes(t)
      || l.lote.area.toLowerCase().includes(t);
  });

  const cuentaPorEstado = (clave: string) =>
    clave === "todos" ? (resumen?.lotes.length ?? 0)
    : clave === "accionables"
      ? (resumen?.lotes ?? []).filter(
          (l) => l.estadoVida !== "vencido" && l.estadoVida !== "sin_dictamen").length
      : (resumen?.lotes ?? []).filter((l) => l.estadoVida === clave).length;

  const pantallas: Pantalla[] = ["panel", "registro", "inventario",
    "recomendaciones", "xai", "receta", "historial", "perfil"];

  return (
    <div className="app">
      <aside className="lateral">
        <div className="marca">
          <Logo tam={30} />
          <span>Food<span style={{ color: "var(--naranja)" }}>Loop</span></span>
        </div>
        <nav className="nav" aria-label="Navegación principal">
          {pantallas.map((p) => {
            const bloqueada = (p === "recomendaciones" && !salida)
              || ((p === "xai" || p === "receta") && !recSel);
            return (
              <button key={p} className="nav-item" aria-current={pantalla === p}
                style={{ opacity: bloqueada ? 0.4 : 1 }}
                onClick={() => bloqueada
                  ? notificar(p === "recomendaciones"
                    ? "Selecciona primero un lote en el panel."
                    : "Elige antes una recomendación.")
                  : setPantalla(p)}>
                <Icono n={ICONOS[p]} s={17} />
                {TITULOS[p]}
              </button>
            );
          })}
        </nav>
        <div className="lateral-pie">
          <div className="fila" style={{ gap: 9 }}>
            <div className="avatar">{iniciales(usuario.nombre)}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="pequeno" style={{ fontWeight: 500 }}>{perfil.nombre}</div>
              <div className="rotulo">{perfil.titulo}</div>
            </div>
            <button className="btn btn-fantasma btn-icono btn-sm" onClick={onSalir}
              aria-label="Cerrar sesión" title="Cerrar sesión">
              <Icono n="salir" s={16} />
            </button>
          </div>
        </div>
      </aside>

      <div>
        <header className="barra">
          <span className="miga">FoodLoop / <b>{TITULOS[pantalla]}</b></span>
          <div className="der">
            <button className="btn btn-sm btn-fantasma" onClick={() => void refrescar()}
              title="Volver a consultar la base">
              <Icono n="refrescar" s={15} /> Actualizar
            </button>
            <button className="rolbar" onClick={() => setPantalla("perfil")}
              title="Ver mi perfil y permisos"
              style={{ cursor: "pointer", font: "inherit" }}>
              <span className="pequeno apagado">{perfil.titulo}</span>
              <div className="avatar">{iniciales(usuario.nombre)}</div>
            </button>
            <button className="btn btn-icono" onClick={alternarTema}
              aria-label="Cambiar entre modo claro y oscuro">
              <Icono n={tema === "claro" ? "luna" : "sol"} s={17} />
            </button>
          </div>
        </header>

        <main className="principal">
          <div className="ambito">
            <span className="quien">{perfil.titulo}</span>
            <span className="txt">
              {pantalla === "perfil"
                ? "Consulta tus datos y las atribuciones de tu perfil."
                : pantalla === "inventario"
                  ? "Excedente vigente agrupado por ingrediente, ordenado por urgencia."
                  : pantalla === "historial"
                    ? "Trazabilidad de lo propuesto, lo decidido y lo valorado."
                    : AMBITO[rol][pantalla] ?? AMBITO[rol].panel}
            </span>
          </div>

          {fallo && (
            <div className="aviso" style={{ marginBottom: 20, borderColor: "var(--critico-linea)" }}>
              <Icono n="alerta" s={17} />
              <div>
                <b>Sin conexión con el servidor</b>
                <div className="pequeno apagado" style={{ marginTop: 4 }}>{fallo}</div>
              </div>
            </div>
          )}

          {/* ---------------- Panel ---------------- */}
          {pantalla === "panel" && resumen && stats && (
            <>
              <div className="cabecera">
                <div>
                  <h1>Mermas disponibles</h1>
                  <p>
                    {resumen.lotes.length} lotes sin decisión, {resumen.enRiesgo} con
                    vida útil comprometida.
                  </p>
                </div>
                <div className="espacio" />
                <button className="btn btn-primario" onClick={() => setPantalla("registro")}>
                  <Icono n="plus" s={16} /> Registrar merma
                </button>
              </div>

              <div className="rejilla g4" style={{ marginBottom: 16 }}>
                <div className="kpi">
                  <div className="l">Merma disponible</div>
                  <div className="v">{fmt(resumen.kgDisponibles)}{" "}
                    <span className="pequeno apagado">kg</span></div>
                  <div className="d">{resumen.lotes.length} lotes</div>
                </div>
                <div className="kpi">
                  <div className="l">Lotes en riesgo</div>
                  <div className="v">{resumen.enRiesgo}</div>
                  <div className="d">vencen en menos de 24 h</div>
                </div>
                {permisos.veCostos ? (
                  <div className="kpi">
                    <div className="l">Valor en riesgo</div>
                    <div className="v">$ {fmt(resumen.valorEnRiesgo, 2)}</div>
                    <div className="d">pendiente de decisión</div>
                  </div>
                ) : (
                  <div className="kpi">
                    <div className="l">Aptos para reproceso</div>
                    <div className="v">{resumen.aptos}
                      <span className="pequeno apagado"> de {resumen.lotes.length}</span></div>
                    <div className="d">con dictamen favorable</div>
                  </div>
                )}
                <div className="kpi">
                  <div className="l">Aprovechado</div>
                  <div className="v">{fmt(stats.kgAprovechados)}{" "}
                    <span className="pequeno apagado">kg</span></div>
                  <div className="d">
                    {stats.totalKg ? Math.round(stats.kgAprovechados / stats.totalKg * 100) : 0} % del total
                  </div>
                </div>
              </div>

              <div className="rejilla g2" style={{ marginBottom: 16 }}>
                <div className="tarjeta">
                  <div className="tarjeta-cab">
                    <h3>Registrado frente a aprovechado</h3>
                    <span className="rotulo">últimos 7 días</span>
                  </div>
                  <BarrasAgrupadas
                    datos={stats.porDia.map((d) => ({
                      etiqueta: d.fecha.slice(5).replace("-", "/"),
                      valores: [d.registrada, d.aprovechada],
                    }))}
                    series={[
                      { nombre: "Registrada", color: "var(--verde)" },
                      { nombre: "Aprovechada", color: "var(--naranja)" },
                    ]}
                  />
                </div>

                <div className="tarjeta">
                  <div className="tarjeta-cab"><h3>Estado de los lotes pendientes</h3></div>
                  <Anillo datos={stats.porEstadoVida.map((e) => ({
                    etiqueta: e.estado, valor: e.lotes,
                    color: COLOR_ESTADO[e.estado] ?? "var(--texto-3)",
                  }))} />
                </div>
              </div>

              <div className="rejilla g2" style={{ marginBottom: 16 }}>
                <div className="tarjeta">
                  <div className="tarjeta-cab"><h3>Merma por causa</h3></div>
                  <BarrasH datos={stats.porCausa.map((c) => ({
                    etiqueta: ETIQUETA_CAUSA[c.causa] ?? c.causa, valor: c.kg,
                  }))} />
                </div>
                <div className="tarjeta">
                  <div className="tarjeta-cab">
                    <h3>Merma por área</h3>
                    <span className="rotulo">frente a capacidad</span>
                  </div>
                  <BarrasH datos={stats.porArea.map((a) => ({
                    etiqueta: a.area, valor: a.kg, maximo: a.capacidadKg,
                  }))} />
                </div>
              </div>

              <div className="tarjeta" style={{ padding: "20px 7px 7px" }}>
                <div className="tarjeta-cab" style={{ padding: "0 13px" }}>
                  <h3>Lotes pendientes de decisión</h3>
                  <span className="rotulo">
                    {lotesVisibles.length} de {resumen.lotes.length}
                  </span>
                </div>

                {seleccion.size > 0 && (
                  <div className="barra-seleccion">
                    <span className="pequeno">
                      <b>{seleccion.size}</b> lote(s) seleccionado(s)
                      {seleccion.size > 1 && " · se evaluarán como un conjunto"}
                    </span>
                    <span className="espacio" />
                    <button className="btn btn-sm btn-fantasma"
                      onClick={() => setSeleccion(new Set())}>
                      Limpiar
                    </button>
                    <button className="btn btn-sm btn-primario"
                      onClick={() => void abrir([...seleccion])}>
                      <Icono n="chispa" s={15} /> Analizar la selección
                    </button>
                  </div>
                )}

                <div className="barra-filtros">
                  <div className="buscador">
                    <Icono n="buscar" s={16} />
                    <input className="entrada" placeholder="Buscar lote, ingrediente o área"
                      value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                    {busqueda && (
                      <button className="limpiar" onClick={() => setBusqueda("")}
                        aria-label="Limpiar búsqueda">
                        <Icono n="x" s={14} />
                      </button>
                    )}
                  </div>
                  <div className="fichas">
                    {FILTROS.map((f) => {
                      const n = cuentaPorEstado(f.clave);
                      if (n === 0 && f.clave !== "todos" && f.clave !== "accionables") return null;
                      return (
                        <button key={f.clave}
                          className={`ficha ${filtro === f.clave ? "activa" : ""}`}
                          onClick={() => setFiltro(f.clave)}>
                          {f.etiqueta} <span className="n">{n}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 34 }}><span className="sr-only">Seleccionar</span></th>
                      <th>Lote</th><th>Ingrediente</th><th className="num">Cantidad</th>
                      <th className="num">Vida útil</th><th>Estado</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lotesVisibles.map(({ lote, horasRestantes, estadoVida }) => (
                      <tr key={lote.id} className={seleccion.has(lote.id) ? "marcada" : ""}>
                        <td>
                          <input type="checkbox" className="casilla"
                            checked={seleccion.has(lote.id)}
                            disabled={estadoVida === "vencido"}
                            onChange={() => alternar(lote.id)}
                            aria-label={`Seleccionar lote ${lote.codigo}`} />
                        </td>
                        <td className="mono">{lote.codigo}</td>
                        <td>{lote.ingrediente}{" "}
                          <span className="pequeno apagado">({lote.estadoProducto})</span></td>
                        <td className="num">{fmt(lote.cantidad)} {lote.unidad}</td>
                        <td className="num">
                          {horasRestantes > 0
                            ? `${horasRestantes.toFixed(0)} h`
                            : "—"}
                        </td>
                        <td>
                          <Distintivo tipo={TIPO_VIDA[estadoVida]}>
                            {ETIQUETA_VIDA[estadoVida]}
                          </Distintivo>
                        </td>
                        <td className="num">
                          <button className="btn btn-sm"
                            aria-disabled={estadoVida === "vencido"}
                            onClick={() => estadoVida === "vencido"
                              ? notificar("El lote superó su vida útil: ninguna alternativa es viable.")
                              : void abrir([lote.id])}>
                            Analizar
                          </button>
                        </td>
                      </tr>
                    ))}
                    {lotesVisibles.length === 0 && (
                      <tr><td colSpan={7} className="apagado pequeno" style={{ padding: 20 }}>
                        {resumen.lotes.length === 0
                          ? "No hay lotes pendientes. Registra uno para empezar."
                          : "Ningún lote coincide con el filtro."}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ---------------- Registro ---------------- */}
          {pantalla === "registro" && (
            <>
              <div className="cabecera">
                <div>
                  <h1>Registrar merma</h1>
                  <p>
                    Captura el excedente en el punto donde ocurre. La vida útil se
                    calcula a partir del ingrediente y su estado, no se escribe a mano.
                  </p>
                </div>
              </div>

              {!maestros ? (
                <div className="tarjeta"><p className="apagado">Cargando catálogos…</p></div>
              ) : (
                <div className="rejilla" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
                  <div className="pila">
                    <div className="tarjeta">
                      <div className="tarjeta-cab"><h3>Producto</h3></div>
                      <div className="rejilla g2">
                        <div className="campo">
                          <label htmlFor="f-ing">Ingrediente <span className="req">*</span></label>
                          <div className="select-envoltura">
                            <select className="entrada" id="f-ing" value={form.ingredienteId}
                              onChange={(e) => setForm({ ...form, ingredienteId: Number(e.target.value) })}>
                              {maestros.ingredientes.map((i) =>
                                <option key={i.id} value={i.id}>{i.nombre}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="campo">
                          <label htmlFor="f-cant">Cantidad <span className="req">*</span></label>
                          <input className="entrada mono" id="f-cant" type="number"
                            min="0" step="0.1" value={form.cantidad || ""}
                            onChange={(e) => setForm({ ...form, cantidad: Number(e.target.value) })} />
                          {errores.cantidad && <span className="error-campo">{errores.cantidad}</span>}
                        </div>
                      </div>

                      <div className="campo" style={{ marginTop: 16 }}>
                        <label>Estado del producto <span className="req">*</span></label>
                        <div className="opciones">
                          {(["crudo", "cocido"] as const).map((v) => (
                            <label className="opcion" key={v}>
                              <input type="radio" name="estado" checked={form.estadoProducto === v}
                                onChange={() => setForm({ ...form, estadoProducto: v })} />
                              <span>{v === "crudo" ? "Crudo" : "Cocido"}</span>
                            </label>
                          ))}
                        </div>
                        <span className="ayuda">
                          Determina la vida útil y qué recetas pueden admitir el lote.
                        </span>
                      </div>
                    </div>

                    <div className="tarjeta">
                      <div className="tarjeta-cab"><h3>Origen</h3></div>
                      <div className="rejilla g2">
                        <div className="campo">
                          <label htmlFor="f-area">Área <span className="req">*</span></label>
                          <div className="select-envoltura">
                            <select className="entrada" id="f-area" value={form.areaId}
                              onChange={(e) => setForm({ ...form, areaId: Number(e.target.value) })}>
                              {maestros.areas.map((a) =>
                                <option key={a.id} value={a.id}>{a.nombre}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="campo">
                          <label htmlFor="f-serv">Servicio <span className="req">*</span></label>
                          <div className="select-envoltura">
                            <select className="entrada" id="f-serv" value={form.servicioId}
                              onChange={(e) => setForm({ ...form, servicioId: Number(e.target.value) })}>
                              {maestros.servicios.map((s, i) =>
                                <option key={s} value={i}>{s}</option>)}
                            </select>
                          </div>
                          {errores.servicioId && <span className="error-campo">{errores.servicioId}</span>}
                        </div>
                      </div>

                      <div className="campo" style={{ marginTop: 16 }}>
                        <label>Causa <span className="req">*</span></label>
                        <div className="opciones">
                          {CAUSAS.map((c) => (
                            <label className="opcion" key={c}>
                              <input type="radio" name="causa" checked={form.causa === c}
                                onChange={() => setForm({ ...form, causa: c })} />
                              <span>{ETIQUETA_CAUSA[c]}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="tarjeta">
                      <div className="tarjeta-cab"><h3>Control sanitario</h3></div>
                      <div className="rejilla g2">
                        <div className="campo">
                          <label htmlFor="f-temp">Temperatura medida (°C) <span className="req">*</span></label>
                          <input className="entrada mono" id="f-temp" type="number" step="0.1"
                            value={form.temperaturaC}
                            onChange={(e) => setForm({ ...form, temperaturaC: Number(e.target.value) })} />
                          {errores.temperaturaC && <span className="error-campo">{errores.temperaturaC}</span>}
                        </div>
                        <div className="campo">
                          <label>Dictamen</label>
                          <div className="opciones">
                            <label className="opcion">
                              <input type="radio" name="apto" checked={form.aptoReproceso}
                                disabled={!permisos.dictaminaSanidad && rol !== "chef" && rol !== "produccion"}
                                onChange={() => setForm({ ...form, aptoReproceso: true })} />
                              <span>Apto</span>
                            </label>
                            <label className="opcion">
                              <input type="radio" name="apto" checked={!form.aptoReproceso}
                                onChange={() => setForm({ ...form, aptoReproceso: false })} />
                              <span>No apto</span>
                            </label>
                          </div>
                          <span className="ayuda">
                            El servidor anula el dictamen favorable si la causa es defecto
                            de calidad o la temperatura excede el máximo del ingrediente.
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pila">
                    <div className="tarjeta">
                      <div className="tarjeta-cab"><h3>Resumen</h3></div>
                      <ul className="ingredientes">
                        <li><span>Ingrediente</span><span className="mono">
                          {maestros.ingredientes.find((i) => i.id === form.ingredienteId)?.nombre ?? "—"}
                        </span></li>
                        <li><span>Cantidad</span><span className="mono">
                          {form.cantidad ? fmt(form.cantidad) : "—"}{" "}
                          {maestros.ingredientes.find((i) => i.id === form.ingredienteId)?.unidad}
                        </span></li>
                        <li><span>Estado</span><span className="mono">{form.estadoProducto}</span></li>
                        <li><span>Área</span><span className="mono">
                          {maestros.areas.find((a) => a.id === form.areaId)?.nombre ?? "—"}
                        </span></li>
                        <li><span>Temperatura</span><span className="mono">
                          {fmt(form.temperaturaC)} °C
                        </span></li>
                        <li><span>Causa</span><span className="mono">
                          {ETIQUETA_CAUSA[form.causa]}
                        </span></li>
                      </ul>
                    </div>

                    <button className="btn btn-primario" style={{ justifyContent: "center" }}
                      onClick={() => void guardarMerma()}>
                      <Icono n="check" s={16} /> Guardar lote
                    </button>
                    <button className="btn" style={{ justifyContent: "center" }}
                      onClick={() => { setForm(FORM_INICIAL); setErrores({}); setPantalla("panel"); }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ---------------- Recomendaciones ---------------- */}
          {pantalla === "recomendaciones" && (
            cargando
              ? <div className="tarjeta"><p className="apagado">Evaluando el catálogo…</p></div>
              : salida && (
                <>
                  <div className="cabecera">
                    <div>
                      <h1>Recomendaciones</h1>
                      <p>
                        {salida.lotes.length === 1
                          ? `Lote ${salida.lotes[0].codigo} · ${salida.lotes[0].estadoProducto} · `
                            + `${fmt(salida.lotes[0].cantidad)} ${salida.lotes[0].unidad}.`
                          : `Conjunto de ${salida.lotes.length} lotes: `
                            + salida.lotes.map((l) => l.codigo).join(", ") + "."}
                        {" "}El modelo devolvió {salida.resultados.length} alternativa(s)
                        viable(s) y descartó {salida.descartes.length}.
                      </p>
                    </div>
                    <div className="espacio" />
                    <button className="btn btn-sm" onClick={() => setPantalla("panel")}>
                      Volver al panel
                    </button>
                  </div>

                  <div className="pila">
                    {salida.resultados.length === 0 && (
                      <div className="aviso">
                        <Icono n="alerta" s={17} />
                        <div>
                          <b>Ninguna alternativa viable para esta selección.</b>
                          <div className="pequeno apagado" style={{ marginTop: 6 }}>
                            {salida.lotes.every((l) => l.aptoReproceso)
                              ? salida.lotes.length > 1
                                ? "Ninguna receta del catálogo admite esta combinación "
                                  + "de ingredientes. Prueba seleccionando menos lotes."
                                : "Los filtros sanitarios descartaron el catálogo completo."
                              : "Alguno de los lotes no tiene dictamen sanitario favorable."}
                          </div>
                        </div>
                      </div>
                    )}

                    {salida.resultados.map((r, i) => (
                      <article className={`rec ${i === 0 ? "top" : ""}`} key={r.item.id}>
                        <div className="rec-cab">
                          <div className="rec-pos">{i + 1}</div>
                          <div style={{ flex: 1 }}>
                            <h2>{r.item.nombre}</h2>
                            <p className="pequeno apagado" style={{ marginTop: 4 }}>
                              {r.item.area} · {r.item.minutos} min · {r.item.codigo}
                            </p>
                            <div className="rec-meta">
                              <span>Aprovecha <b>{fmt(r.kgAprovechados)} kg</b></span>
                              <span>Rinde <b>{r.porciones} porciones</b></span>
                              {permisos.veCostos &&
                                <span>Costo recuperado <b>$ {fmt(r.costoRecuperado, 2)}</b></span>}
                            </div>

                            {r.aportes.length > 0 && (
                              <div className="aportes">
                                <span className="rotulo">
                                  {r.aportes.length > 1
                                    ? `Combina ${r.aportes.length} lotes`
                                    : "Procede de"}
                                </span>
                                <div className="aportes-lista">
                                  {r.aportes.map((a) => (
                                    <span className="aporte" key={a.lote.id}>
                                      <b className="mono">{a.lote.codigo}</b>
                                      {a.lote.ingrediente}
                                      <span className="mono">
                                        {fmt(a.cantidadUsada)} {a.lote.unidad}
                                      </span>
                                      {a.esPrincipal && (
                                        <span className="marca-principal">principal</span>
                                      )}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="rec-punt">
                            <div className="v">{r.aptitud}</div>
                            <div className="rotulo">Aptitud</div>
                          </div>
                        </div>
                        <div className="rec-pie">
                          <Distintivo tipo="ok">Dentro de la ventana sanitaria</Distintivo>
                          <span className="espacio" />
                          <button className="btn btn-sm"
                            onClick={() => { setRecSel(r); setPantalla("xai"); }}>
                            <Icono n="cerebro" s={15} /> ¿Por qué?
                          </button>
                          <button className="btn btn-sm"
                            onClick={() => { setRecSel(r); setPantalla("receta"); }}>
                            Ver receta
                          </button>
                          <button
                            className={`btn btn-sm ${i === 0 && permisos.aprueba ? "btn-primario" : ""}`}
                            aria-disabled={!permisos.aprueba}
                            onClick={() => void aprobar(r)}>
                            Aprobar
                          </button>
                          {!permisos.aprueba && (
                            <span className="bloqueo">
                              Aprobar corresponde al chef o a producción.
                            </span>
                          )}
                        </div>
                      </article>
                    ))}

                    {salida.sugerencias.length > 0 && (
                      <div className="tarjeta sugerencias">
                        <div className="tarjeta-cab">
                          <h3>Lotes que mejorarían la propuesta</h3>
                          <span className="rotulo">decides tú si combinarlos</span>
                        </div>
                        <div className="pila" style={{ gap: 10 }}>
                          {salida.sugerencias.map((s) => (
                            <div className="sugerencia" key={s.lote.id}>
                              <span className="ganancia">+{fmt(s.gananciaAptitud, 1)}</span>
                              <div style={{ flex: 1 }}>
                                <b className="mono pequeno">{s.lote.codigo}</b>
                                <div className="pequeno apagado">{s.motivo}</div>
                              </div>
                              <button className="btn btn-sm"
                                onClick={() => void incorporar(s.lote.id)}>
                                Incorporar
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {salida.descartes.length > 0 && (
                      <div className="aviso">
                        <Icono n="alerta" s={17} />
                        <div>
                          <b>{salida.descartes.length} alternativa(s) descartada(s)</b>
                          <div className="pequeno apagado" style={{ marginTop: 6 }}>
                            {salida.descartes.slice(0, 3).map((d) => (
                              <div key={d.alternativa}>{d.alternativa}: {d.motivo}</div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )
          )}

          {/* ---------------- Explicación ---------------- */}
          {pantalla === "xai" && recSel && (
            <>
              <div className="cabecera">
                <div>
                  <h1>Por qué esta recomendación</h1>
                  <p>{recSel.resumen}</p>
                </div>
                <div className="espacio" />
                <button className="btn btn-sm" onClick={() => setPantalla("recomendaciones")}>
                  Volver
                </button>
              </div>

              <div className="rejilla" style={{ gridTemplateColumns: "1.45fr 1fr" }}>
                <div className="pila">
                  <div className="xai">
                    <div className="xai-tit">
                      <Icono n="cerebro" s={18} /> Factores evaluados por el modelo
                    </div>
                    <div style={{ marginTop: 13 }}>
                      {recSel.factores.map((f) => {
                        const max = Math.max(
                          ...recSel.factores.map((x) => Math.abs(x.contribucion))) || 1;
                        return (
                          <div className="factor" key={f.nombre}>
                            <div>
                              <div className="n">{f.nombre}</div>
                              <div className="v">{f.valorObservado}</div>
                            </div>
                            <div className="pista">
                              <div className={`relleno ${f.contribucion < 0 ? "neg" : ""}`}
                                style={{ width: `${Math.abs(f.contribucion) / max * 100}%` }} />
                            </div>
                            <span className="pct">
                              {f.contribucion >= 0 ? "+" : ""}{fmt(f.contribucion, 1)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="tarjeta">
                    <div className="tarjeta-cab"><h3>Si el lote fuera distinto</h3></div>
                    <div className="pila" style={{ gap: 10 }}>
                      {recSel.contrafactuales.map((c) => <div className="contra" key={c}>{c}</div>)}
                    </div>
                  </div>
                </div>

                <div className="pila">
                  <div className="tarjeta">
                    <div className="tarjeta-cab"><h3>Aptitud</h3></div>
                    <div className="fila" style={{ alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontFamily: "Archivo", fontSize: 34, fontWeight: 600 }}>
                        {recSel.aptitud}
                      </span>
                      <span className="pequeno apagado">de 100</span>
                    </div>
                    <div className="separador" />
                    <p className="pequeno apagado">
                      La puntuación se calcula ya descompuesta: lo que ves a la
                      izquierda es la aritmética del modelo, no una reconstrucción
                      posterior.
                    </p>
                  </div>

                  {/* Valoración de la explicación. Se registra aparte de la
                      decisión: alguien puede aprobar la recomendación y aun
                      así no entender por qué se le propuso. */}
                  <div className="tarjeta">
                    <div className="tarjeta-cab"><h3>¿Se entiende esta explicación?</h3></div>
                    {recSel.recomendacionId && valorados.has(recSel.recomendacionId) ? (
                      <p className="pequeno apagado">
                        <Icono n="check" s={14} /> Ya valoraste esta explicación.
                      </p>
                    ) : (
                      <>
                        <p className="pequeno apagado" style={{ marginBottom: 12 }}>
                          Tu respuesta no cambia la recomendación: alimenta la
                          evaluación del componente de explicabilidad.
                        </p>
                        <div className="fila" style={{ gap: 8, flexWrap: "wrap" }}>
                          {([
                            ["clara", "Sí, la entiendo"],
                            ["confusa", "Es confusa"],
                            ["insuficiente", "Falta información"],
                          ] as const).map(([clave, texto]) => (
                            <button key={clave} className="btn btn-sm"
                              onClick={() => recSel.recomendacionId
                                ? void valorar(recSel.recomendacionId, clave)
                                : notificar("Vuelve a evaluar para poder valorar.")}>
                              {texto}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <button className="btn btn-primario" style={{ justifyContent: "center" }}
                    onClick={() => setPantalla("receta")}>
                    Continuar a la receta <Icono n="flecha" s={16} />
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ---------------- Ingredientes disponibles (Fase 2) ---------------- */}
          {pantalla === "inventario" && (
            <>
              <div className="cabecera">
                <div>
                  <h1>Ingredientes disponibles</h1>
                  <p>
                    Excedente vigente agrupado por ingrediente. Lo relevante en
                    cocina no es cuántos lotes hay, sino cuánto producto hay y
                    para cuándo.
                  </p>
                </div>
                <div className="espacio" />
                <button className="btn btn-sm"
                  onClick={() => { setInventario(null); notificar("Actualizando…"); }}>
                  <Icono n="refrescar" s={15} /> Actualizar
                </button>
              </div>

              {!inventario ? (
                <div className="tarjeta"><p className="apagado">Cargando…</p></div>
              ) : inventario.length === 0 ? (
                <div className="aviso">
                  <Icono n="alerta" s={17} />
                  <span>No hay excedente vigente. Todo está comprometido o vencido.</span>
                </div>
              ) : (
                <div className="tarjeta" style={{ padding: "20px 7px 7px" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Ingrediente</th><th>Categoría</th>
                        <th className="num">Lotes</th>
                        <th className="num">Disponible</th>
                        <th className="num">Vence en</th>
                        {permisos.veCostos && <th className="num">Valor</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {inventario.map((i) => (
                        <tr key={i.ingredienteId}>
                          <td>{i.ingrediente}</td>
                          <td className="apagado pequeno">{i.categoria}</td>
                          <td className="num">{i.lotes}</td>
                          <td className="num">{fmt(i.disponible)} {i.unidad}</td>
                          <td className="num">
                            <Distintivo tipo={i.horasMinimas <= 12 ? "critico"
                              : i.horasMinimas <= 24 ? "aviso" : "ok"}>
                              {i.horasMinimas.toFixed(0)} h
                            </Distintivo>
                          </td>
                          {permisos.veCostos &&
                            <td className="num">$ {fmt(i.valor, 2)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ---------------- Histórico de aprovechamiento (Fase 2) ---------------- */}
          {pantalla === "historial" && (
            <>
              <div className="cabecera">
                <div>
                  <h1>Histórico de aprovechamiento</h1>
                  <p>
                    Qué propuso el modelo, con qué lotes, quién decidió y cómo
                    valoró la explicación. Es la traza que permite auditar el
                    comportamiento del sistema.
                  </p>
                </div>
              </div>

              {!historial ? (
                <div className="tarjeta"><p className="apagado">Cargando…</p></div>
              ) : (
                <div className="tarjeta" style={{ padding: "20px 7px 7px" }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Fecha</th><th>Receta</th>
                        <th className="num">Aptitud</th>
                        <th>Lotes</th><th>Decisión</th><th>Responsable</th>
                        <th>Explicación</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historial.map((x) => (
                        <tr key={x.recomendacionId}>
                          <td className="mono pequeno">
                            {x.generadaEn.slice(0, 10)}
                          </td>
                          <td>{x.receta}</td>
                          <td className="num">{fmt(x.aptitud, 1)}</td>
                          <td className="mono pequeno">
                            {x.nLotes > 1
                              ? <Distintivo tipo="ok">{x.nLotes} lotes</Distintivo>
                              : x.lotes}
                          </td>
                          <td>
                            {x.accion === "aprobada"
                              ? <Distintivo tipo="ok">Aprobada</Distintivo>
                              : x.accion === "descartada"
                                ? <Distintivo tipo="critico">Descartada</Distintivo>
                                : <Distintivo tipo="neutro">Sin decidir</Distintivo>}
                          </td>
                          <td className="pequeno apagado">{x.usuario ?? "—"}</td>
                          <td className="pequeno apagado">
                            {x.claridad
                              ? x.claridad === "clara"
                                ? <Distintivo tipo="ok">Clara</Distintivo>
                                : <Distintivo tipo="aviso">{x.claridad}</Distintivo>
                              : "—"}
                          </td>
                        </tr>
                      ))}
                      {historial.length === 0 && (
                        <tr><td colSpan={7} className="apagado pequeno"
                          style={{ padding: 20 }}>
                          Todavía no hay recomendaciones registradas.
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ---------------- Perfil ---------------- */}
          {pantalla === "perfil" && (
            <>
              <div className="cabecera">
                <div>
                  <h1>Mi perfil</h1>
                  <p>
                    Tus atribuciones dentro del sistema y qué pantallas habilita
                    tu perfil.
                  </p>
                </div>
              </div>

              <div className="rejilla" style={{ gridTemplateColumns: "1fr 1.3fr" }}>
                <div className="pila">
                  <div className="tarjeta">
                    <div className="perfil-cab">
                      <div className="avatar-grande">{iniciales(usuario.nombre)}</div>
                      <div>
                        <h2>{usuario.nombre}</h2>
                        <p className="apagado pequeno" style={{ marginTop: 2 }}>
                          {perfil.titulo}
                        </p>
                      </div>
                    </div>
                    <div className="separador" />
                    <ul className="ingredientes">
                      <li><span>Centro</span><span className="mono">Planta Loja</span></li>
                      <li><span>Perfil</span><span className="mono">{rol}</span></li>
                      <li><span>Correo</span><span className="mono pequeno">
                        {usuario.correo}
                      </span></li>
                      <li><span>Cuenta creada</span><span className="mono pequeno">
                        {usuario.creadoEn.toLocaleDateString("es-EC")}
                      </span></li>
                      <li><span>Sesión iniciada</span><span className="mono">
                        {new Date().toLocaleTimeString("es-EC", {
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </span></li>
                    </ul>
                  </div>

                  <div className="tarjeta">
                    <div className="tarjeta-cab">
                      <h3>Pantallas habilitadas</h3>
                    </div>
                    <div className="pila" style={{ gap: 8 }}>
                      {PANTALLAS_ROL[rol].map((t) => (
                        <div className="fila" key={t} style={{ gap: 9 }}>
                          <Icono n="check" s={15} />
                          <span className="pequeno">{t}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button className="btn" style={{ justifyContent: "center" }}
                    onClick={onSalir}>
                    <Icono n="salir" s={16} /> Cerrar sesión
                  </button>
                </div>

                <div className="pila">
                  <div className="tarjeta">
                    <div className="tarjeta-cab">
                      <h3>Atribuciones</h3>
                      <span className="rotulo">definidas en el dominio</span>
                    </div>
                    {ATRIBUCIONES.map((a) => {
                      const tiene = permisos[a.clave];
                      return (
                        <div className={`permiso ${tiene ? "si" : "no"}`} key={a.clave}>
                          <div className="icono-p">
                            <Icono n={tiene ? "check" : "x"} s={16} />
                          </div>
                          <div className="texto">
                            <b>{a.titulo}</b>
                            <div>{tiene ? a.si : a.no}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="tarjeta">
                    <div className="tarjeta-cab">
                      <h3>Cambiar de perfil</h3>
                      <Distintivo tipo="aviso">Solo en el prototipo</Distintivo>
                    </div>
                    <p className="pequeno apagado">
                      En el sistema real el perfil viene de la cuenta con la que se
                      inicia sesión y no se puede cambiar desde la interfaz. Este
                      control existe para que puedas comprobar cómo se adapta la
                      aplicación durante las sesiones de validación.
                    </p>
                    <div className="separador" />
                    <div className="opciones">
                      {(Object.keys(PERFILES) as Rol[]).map((r) => (
                        <label className="opcion" key={r}>
                          <input type="radio" name="rol" checked={rol === r}
                            onChange={() => {
                              setRol(r);
                              notificar(`Ahora operas como ${PERFILES[r].titulo.toLowerCase()}.`);
                            }} />
                          <span>{PERFILES[r].titulo}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* ---------------- Receta ---------------- */}
          {pantalla === "receta" && recSel && salida && (
            <>
              <div className="cabecera">
                <div>
                  <h1>{recSel.item.nombre}</h1>
                  <p>
                    Receta {recSel.item.codigo}, escalada a {recSel.porciones} porciones
                    de {recSel.item.pesoPorcionG} g a partir de{" "}
                    {recSel.aportes.length === 1
                      ? `el lote ${recSel.aportes[0].lote.codigo}`
                      : `${recSel.aportes.length} lotes de merma`}.
                  </p>
                </div>
                <div className="espacio" />
                <button className="btn btn-sm" onClick={() => setPantalla("recomendaciones")}>
                  Volver
                </button>
              </div>

              <div className="rejilla g4" style={{ marginBottom: 16 }}>
                <div className="kpi"><div className="l">Rendimiento</div>
                  <div className="v">{recSel.porciones}{" "}
                    <span className="pequeno apagado">porc.</span></div></div>
                <div className="kpi"><div className="l">Tiempo total</div>
                  <div className="v">{recSel.item.minutos}{" "}
                    <span className="pequeno apagado">min</span></div></div>
                <div className="kpi"><div className="l">Temperatura de proceso</div>
                  <div className="v">{recSel.item.tempProcesoC || "—"}{" "}
                    <span className="pequeno apagado">°C</span></div></div>
                {permisos.veCostos ? (
                  <div className="kpi"><div className="l">Costo recuperado</div>
                    <div className="v">$ {fmt(recSel.costoRecuperado, 2)}</div></div>
                ) : (
                  <div className="kpi"><div className="l">Merma aprovechada</div>
                    <div className="v">{fmt(recSel.kgAprovechados)}{" "}
                      <span className="pequeno apagado">kg</span></div></div>
                )}
              </div>

              <div className="tarjeta">
                <div className="tarjeta-cab">
                  <h3>Procedimiento</h3>
                  {recSel.item.tempProcesoC >= 74 &&
                    <Distintivo tipo="aviso">Punto crítico de control</Distintivo>}
                </div>
                <ol className="pasos-receta">
                  {recSel.item.pasos.map((p) => <li key={p}>{p}</li>)}
                </ol>
                <div className="separador" />
                <div className="fila">
                  <span className="pequeno apagado">Estándar institucional</span>
                  <span className="espacio" />
                  <button className="btn btn-sm" aria-disabled={!permisos.editaRecetario}
                    onClick={() => notificar(permisos.editaRecetario
                      ? "La edición del recetario llega en la siguiente fase."
                      : "El recetario solo lo edita el chef ejecutivo.")}>
                    Editar estándar
                  </button>
                  <button className="btn btn-sm btn-primario" aria-disabled={!permisos.aprueba}
                    onClick={() => void aprobar(recSel)}>
                    Enviar a producción
                  </button>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
