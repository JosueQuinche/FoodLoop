/**
 * FoodLoop · Capa de aplicación
 *
 * Implementa los puertos de entrada orquestando el servicio de dominio y
 * los puertos de salida. No contiene reglas de negocio propias: decide
 * el orden de las llamadas, no el criterio.
 *
 * Cada caso de uso recibe sus dependencias por constructor. No hay
 * importaciones de infraestructura en este archivo; solo interfaces.
 */

import type {
  RepositorioLotes, RepositorioCatalogo, RepositorioCargas,
  RepositorioDecisiones, RepositorioTrazas, Reloj, ProveedorSesion,
  RepositorioMaestros, RepositorioEstadisticas,
} from "../puertos/salida/repositorios";
import type {
  ConsultarOperacion, ResumenOperacion, LotePendiente,
  ObtenerRecomendaciones, SalidaRecomendacion,
  RegistrarDecision, ConsultarPermisos, Permisos,
  RegistrarMerma, EntradaMerma, ConsultarEstadisticas, Estadisticas,
  ConsultarMaestros,
} from "../puertos/entrada/casos-uso";
import { ErrorDominio } from "../puertos/entrada/casos-uso";
import type { Decision, Rol, Lote } from "../modelo/tipos";
import { recomendar, horasRestantes, VERSION_MODELO } from "../servicios/motor";
import { permisosDe } from "../servicios/autorizacion";

// ---------------------------------------------------------------------

export class ConsultarOperacionUC implements ConsultarOperacion {
  constructor(
    private readonly lotes: RepositorioLotes,
    private readonly decisiones: RepositorioDecisiones,
    private readonly reloj: Reloj,
  ) {}

  async ejecutar(): Promise<ResumenOperacion> {
    const [pendientes, decisiones] = await Promise.all([
      this.lotes.listarPendientes(),
      this.decisiones.listar(),
    ]);
    const ahora = this.reloj.ahora();
    const decididos = new Set(decisiones.map((d) => d.loteId));

    const items: LotePendiente[] = pendientes
      .filter((l) => !decididos.has(l.id))
      .map((lote) => ({
        lote,
        horasRestantes: horasRestantes(lote, ahora),
        estadoVida: clasificar(lote, horasRestantes(lote, ahora)),
        valorEnRiesgo: lote.cantidad * lote.costoUnitario,
      }))
      .sort((a, b) => a.horasRestantes - b.horasRestantes);

    return {
      lotes: items,
      kgDisponibles: items.reduce((a, i) => a + i.lote.cantidad, 0),
      enRiesgo: items.filter((i) => i.horasRestantes <= 24).length,
      valorEnRiesgo: items.reduce((a, i) => a + i.valorEnRiesgo, 0),
      aptos: items.filter((i) => i.lote.aptoReproceso).length,
      decisiones: decisiones.length,
    };
  }
}

/**
 * Un lote vencido no es lo mismo que uno crítico: el crítico todavía
 * admite reproceso si se actúa ya, el vencido lo rechaza el filtro duro.
 * Mezclarlos haría que el usuario pulsara «Analizar» en lotes que nunca
 * van a devolver una alternativa.
 */
const clasificar = (l: Lote, h: number): LotePendiente["estadoVida"] =>
  h <= 0 ? "vencido"
    : !l.aptoReproceso ? "sin_dictamen"
    : h <= 12 ? "critico"
    : h <= 24 ? "por_vencer" : "apto";

// ---------------------------------------------------------------------

export class ObtenerRecomendacionesUC implements ObtenerRecomendaciones {
  constructor(
    private readonly lotes: RepositorioLotes,
    private readonly catalogo: RepositorioCatalogo,
    private readonly cargas: RepositorioCargas,
    private readonly trazas: RepositorioTrazas,
    private readonly reloj: Reloj,
    private readonly topN = 3,
  ) {}

  async ejecutar(loteId: number): Promise<SalidaRecomendacion> {
    const lote = await this.lotes.obtenerPorId(loteId);
    if (!lote)
      throw new ErrorDominio(`No existe el lote ${loteId}.`, "LOTE_NO_ENCONTRADO");

    const [items, disponibles, cargas] = await Promise.all([
      this.catalogo.listarActivos(),
      this.lotes.inventarioDisponible(),
      this.cargas.cargasPorArea(),
    ]);

    const ahora = this.reloj.ahora();
    const { resultados, descartes } =
      recomendar(lote, items, disponibles, cargas, ahora, this.topN);

    // La traza se persiste siempre, incluso sin resultados: la Fase 3
    // necesita conocer los lotes para los que el modelo no propuso nada.
    await this.trazas.guardar({
      loteId, generadaEn: ahora, versionModelo: VERSION_MODELO,
      propuestas: resultados.map((r, i) => ({
        recetaId: r.item.id, aptitud: r.aptitud, posicion: i + 1,
      })),
      descartes: descartes.length,
    });

    return { lote, resultados, descartes, versionModelo: VERSION_MODELO };
  }
}

// ---------------------------------------------------------------------

export class RegistrarDecisionUC implements RegistrarDecision {
  constructor(
    private readonly decisiones: RepositorioDecisiones,
    private readonly sesion: ProveedorSesion,
  ) {}

  async ejecutar(e: {
    loteId: number; recetaId: number;
    accion: Decision["accion"]; motivo?: string;
  }): Promise<Decision> {
    const rol = this.sesion.rolActual();

    // La autorización se comprueba aquí, no en la interfaz. Un adaptador
    // de entrada distinto (CLI, API) queda cubierto por la misma regla.
    if (e.accion === "aprobada" && !permisosDe(rol).aprueba)
      throw new ErrorDominio(
        "Este perfil no tiene atribución para aprobar recomendaciones.",
        "SIN_ATRIBUCION");

    return this.decisiones.registrar({
      loteId: e.loteId, recetaId: e.recetaId, accion: e.accion,
      rol, usuario: this.sesion.usuarioActual(),
    });
  }
}

// ---------------------------------------------------------------------

export class ConsultarPermisosUC implements ConsultarPermisos {
  ejecutar(rol: Rol): Permisos {
    return permisosDe(rol);
  }
}

// ---------------------------------------------------------------------

/**
 * Registro de una merma.
 *
 * La vida útil se deriva del ingrediente y del estado del producto, no la
 * escribe el usuario. Y si la temperatura supera el máximo admisible del
 * ingrediente con margen, el lote entra sin dictamen favorable aunque
 * quien lo registra haya marcado que sí: la inocuidad no se declara, se
 * mide.
 */
export class RegistrarMermaUC implements RegistrarMerma {
  constructor(
    private readonly lotes: RepositorioLotes,
    private readonly maestros: RepositorioMaestros,
    private readonly reloj: Reloj,
  ) {}

  async ejecutar(e: EntradaMerma): Promise<Lote> {
    if (e.cantidad <= 0)
      throw new ErrorDominio("La cantidad debe ser mayor que cero.", "CANTIDAD_INVALIDA");

    const ingredientes = await this.maestros.ingredientes();
    const ing = ingredientes.find((i) => i.id === e.ingredienteId);
    if (!ing)
      throw new ErrorDominio("El ingrediente no existe en el catálogo.", "INGREDIENTE_NO_ENCONTRADO");

    const areas = await this.maestros.areas();
    if (!areas.some((a) => a.id === e.areaId))
      throw new ErrorDominio("El área no existe.", "AREA_NO_ENCONTRADA");

    const ahora = this.reloj.ahora();
    const vidaH = e.estadoProducto === "cocido"
      ? ing.vidaUtilCocidoH : ing.vidaUtilCrudoH;

    // Un defecto de calidad o una desviación térmica marcada anulan el
    // dictamen favorable, lo haya marcado o no quien registra.
    const apto = e.aptoReproceso
      && e.causa !== "defecto_calidad"
      && e.temperaturaC <= ing.tempMaxC + 3;

    return this.lotes.crear({
      ingredienteId: e.ingredienteId,
      areaId: e.areaId,
      servicio: e.servicio,
      cantidad: e.cantidad,
      estadoProducto: e.estadoProducto,
      temperaturaC: e.temperaturaC,
      causa: e.causa,
      aptoReproceso: apto,
      registradoEn: ahora,
      venceEn: new Date(ahora.getTime() + vidaH * 3_600_000),
    });
  }
}

// ---------------------------------------------------------------------

export class ConsultarEstadisticasUC implements ConsultarEstadisticas {
  constructor(
    private readonly stats: RepositorioEstadisticas,
    private readonly lotes: RepositorioLotes,
    private readonly reloj: Reloj,
  ) {}

  async ejecutar(): Promise<Estadisticas> {
    const [porCausa, porArea, porDia, totales, pendientes] = await Promise.all([
      this.stats.porCausa(),
      this.stats.porArea(),
      this.stats.porDia(7),
      this.stats.totales(),
      this.lotes.listarPendientes(),
    ]);

    const ahora = this.reloj.ahora();
    const cuenta = { apto: 0, por_vencer: 0, critico: 0, vencido: 0, sin_dictamen: 0 };
    for (const l of pendientes) {
      const h = horasRestantes(l, ahora);
      if (h <= 0) cuenta.vencido++;
      else if (!l.aptoReproceso) cuenta.sin_dictamen++;
      else if (h <= 12) cuenta.critico++;
      else if (h <= 24) cuenta.por_vencer++;
      else cuenta.apto++;
    }

    return {
      porCausa, porArea, porDia, ...totales,
      porEstadoVida: [
        { estado: "Apto", lotes: cuenta.apto },
        { estado: "Por vencer", lotes: cuenta.por_vencer },
        { estado: "Crítico", lotes: cuenta.critico },
        { estado: "Vencido", lotes: cuenta.vencido },
        { estado: "Sin dictamen", lotes: cuenta.sin_dictamen },
      ],
    };
  }
}

// ---------------------------------------------------------------------

export class ConsultarMaestrosUC implements ConsultarMaestros {
  constructor(private readonly maestros: RepositorioMaestros) {}

  async ejecutar() {
    const [ingredientes, areas, servicios] = await Promise.all([
      this.maestros.ingredientes(),
      this.maestros.areas(),
      this.maestros.servicios(),
    ]);
    return {
      ingredientes: ingredientes.map((i) => ({
        id: i.id, nombre: i.nombre, unidad: i.unidad,
      })),
      areas: areas.map((a) => ({ id: a.id, nombre: a.nombre })),
      servicios,
    };
  }
}
