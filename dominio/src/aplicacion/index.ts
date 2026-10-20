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
  RepositorioMaestros, RepositorioEstadisticas, RepositorioFeedback,
  RepositorioUsuarios,
} from "../puertos/salida/repositorios";
import type {
  ConsultarOperacion, ResumenOperacion, LotePendiente,
  ObtenerRecomendaciones, SalidaRecomendacion,
  RegistrarDecision, ConsultarPermisos, Permisos,
  RegistrarMerma, EntradaMerma, ConsultarEstadisticas, Estadisticas,
  ConsultarMaestros, RegistrarFeedback, IniciarSesion, RegistrarUsuario,
  InspeccionarModelo, FichaModelo,
} from "../puertos/entrada/casos-uso";
import { ErrorDominio } from "../puertos/entrada/casos-uso";
import type { Decision, Rol, Lote, Usuario } from "../modelo/tipos";
import { dictamenDe } from "../modelo/tipos";
import {
  sugerirLotes, horasRestantes, VERSION_MODELO,
  ejecutarModelo, ETAPAS, PENDIENTE, TIPO_MODELO,
  PARAMETROS, CARACTERISTICAS, REGLAS, cotaSuperior,
<<<<<<< HEAD
  MODELO_APRENDIDO, ENTRADAS_APRENDIDAS, etiquetaEntrada,
=======
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
} from "../servicios/motor/index";
import { permisosDe } from "../servicios/autorizacion";

// ---------------------------------------------------------------------

export class ConsultarOperacionUC implements ConsultarOperacion {
  constructor(
    private readonly lotes: RepositorioLotes,
    private readonly decisiones: RepositorioDecisiones,
    private readonly reloj: Reloj,
  ) {}

  async ejecutar(): Promise<ResumenOperacion> {
    const [pendientes, decisiones, comprometidos] = await Promise.all([
      this.lotes.listarPendientes(),
      this.decisiones.listar(),
      this.decisiones.lotesDecididos(),
    ]);
    const ahora = this.reloj.ahora();

    const items: LotePendiente[] = pendientes
      .filter((l) => !comprometidos.has(l.id))
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
      // Vencido no es «en riesgo»: el riesgo es perder algo que todavía
      // se puede salvar. Contarlos juntos daba 1558 lotes en riesgo
      // sobre un conjunto histórico en el que 1549 ya habían caducado.
      enRiesgo: items.filter(
        (i) => i.horasRestantes > 0 && i.horasRestantes <= 24).length,
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
    : dictamenDe(l) === "pendiente" ? "pendiente"
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

  /**
   * Acepta uno o varios lotes. El usuario elige la combinación; el
   * sistema evalúa el conjunto como una unidad y devuelve además los
   * lotes que mejorarían la propuesta si se incorporaran.
   */
  async ejecutar(
    loteIds: number | number[],
    modo: "operacion" | "potencial" = "operacion",
  ): Promise<SalidaRecomendacion> {
    const ids = Array.isArray(loteIds) ? loteIds : [loteIds];
    if (ids.length === 0)
      throw new ErrorDominio("Selecciona al menos un lote.", "SELECCION_VACIA");

    const lotes = await Promise.all(ids.map((id) => this.lotes.obtenerPorId(id)));
    const faltante = ids.find((_id, i) => lotes[i] === null);
    if (faltante !== undefined)
      throw new ErrorDominio(
        `No existe el lote ${faltante}.`, "LOTE_NO_ENCONTRADO");
    const seleccion = lotes as Lote[];

    const ahoraInv = this.reloj.ahora();
    const [items, disponibles, cargas, pendientes] = await Promise.all([
      this.catalogo.listarActivos(),
      this.lotes.inventarioDisponible(ahoraInv),
      this.cargas.cargasPorArea(),
      this.lotes.listarPendientes(),
    ]);

    const ahora = this.reloj.ahora();
    // Se usa `ejecutarModelo` y no `recomendar` porque la interfaz
    // necesita saber qué reglas se aplazaron, no solo el resultado.
    const { resultados, descartes, traza } = ejecutarModelo(
      seleccion, items, disponibles, cargas, ahora, { topN: this.topN, modo });

    // Lo que falta medir, una línea por lote y regla, sin repetir.
    const aplazadas = [...new Map(
      resultados
        .flatMap((r) => r.faltaMedir ?? [])
        .map((f) => {
          const i = f.indexOf(":");
          const lote = i > 0 ? f.slice(0, i).trim() : "";
          const falta = i > 0 ? f.slice(i + 1).trim() : f;
          return [`${lote}|${falta}`, { lote, falta }];
        }),
    ).values()];

    // Qué otros lotes elevarían la aptitud. No se combinan solos: la
    // decisión de qué mezclar es del chef, que conoce restricciones de
    // cocina que el modelo no observa.
    const sugerencias = sugerirLotes(
      seleccion, pendientes, items, disponibles, cargas, ahora);

    // La traza se persiste siempre, incluso sin resultados: la Fase 3
    // necesita conocer los casos para los que el modelo no propuso nada.
    // Los identificadores que devuelve son los que la interfaz usará
    // para registrar la decisión y el feedback.
    const idsPropuestas = await this.trazas.guardar({
      loteIds: seleccion.map((l) => l.id),
      generadaEn: ahora,
      versionModelo: VERSION_MODELO,
      modo,
      descartes,
      propuestas: resultados.map((r, i) => ({
        recetaId: r.item.id,
        posicion: i + 1,
        aptitud: r.aptitud,
        porciones: r.porciones,
        kgAprovechados: r.kgAprovechados,
        costoRecuperado: r.costoRecuperado,
        factores: r.factores,
        contrafactuales: r.contrafactuales,
        aportes: r.aportes.map((a) => ({
          mermaId: a.lote.id,
          cantidadUsada: a.cantidadUsada,
          esPrincipal: a.esPrincipal,
        })),
      })),
    });

    return {
      lotes: seleccion,
      resultados: resultados.map((r, i) => ({ ...r, recomendacionId: idsPropuestas[i] })),
      descartes, sugerencias,
      versionModelo: VERSION_MODELO,
      modo, aplazadas,
      // La traza se devuelve para que la pantalla del modelo pueda
      // mostrar las seis etapas de ESTA recomendación sin volver a
      // pedirla al servidor, que la recalcularía y podría dar otra
      // cosa si el inventario cambió en el intervalo.
      traza,
    };
  }
}

// ---------------------------------------------------------------------

/**
 * Inspección del modelo.
 *
 * Existe porque la interfaz muestra el resultado del modelo pero no el
 * modelo. Quien tenga que juzgar si esto es un modelo de decisión o un
 * programa que ordena recetas necesita ver, de una recomendación
 * concreta, qué datos entraron, qué reglas se aplicaron, qué se midió,
 * con qué pesos se combinó y de dónde sale la frase que el usuario lee.
 *
 * La ficha no toca la base de datos: describe el artefacto y se
 * construye a partir de las tablas que el propio motor declara. Si una
 * etapa cambia de responsabilidad y la tabla no se actualiza, la
 * discrepancia se ve en la pantalla.
 */
export class InspeccionarModeloUC implements InspeccionarModelo {
  constructor(
    private readonly lotes: RepositorioLotes,
    private readonly catalogo: RepositorioCatalogo,
    private readonly cargas: RepositorioCargas,
    private readonly reloj: Reloj,
  ) {}

  ficha(): FichaModelo {
    return {
      version: VERSION_MODELO,
      tipo: TIPO_MODELO,
      etapas: ETAPAS.map((e) => ({ ...e })),
      parametros: CARACTERISTICAS.map((eje) => ({
        eje,
        peso: PARAMETROS[eje].valor,
        origen: PARAMETROS[eje].origen,
        etiqueta: PARAMETROS[eje].etiqueta,
        porQue: PARAMETROS[eje].porQue,
        fundamento: PARAMETROS[eje].fundamento,
      })),
      reglas: Object.values(REGLAS).map((r) => ({
        codigo: r.codigo, titulo: r.titulo, alcance: r.alcance,
        motivo: r.motivo, fundamento: r.fundamento,
      })),
      cotaSuperior: cotaSuperior(),
      pendiente: [...PENDIENTE],
<<<<<<< HEAD
      aprendido: {
        version: MODELO_APRENDIDO.version,
        algoritmo: MODELO_APRENDIDO.algoritmo,
        objetivo: MODELO_APRENDIDO.objetivo,
        entrenadoEn: MODELO_APRENDIDO.entrenadoEn,
        periodoEntrenamiento: { ...MODELO_APRENDIDO.periodoEntrenamiento },
        periodoPrueba: { ...MODELO_APRENDIDO.periodoPrueba },
        ejemplos: MODELO_APRENDIDO.ejemplos,
        positivos: MODELO_APRENDIDO.positivos,
        lambda: MODELO_APRENDIDO.lambda,
        intercepto: MODELO_APRENDIDO.intercepto,
        coeficientes: ENTRADAS_APRENDIDAS.map((e) => ({
          entrada: e,
          etiqueta: etiquetaEntrada(e).etiqueta,
          coeficiente: MODELO_APRENDIDO.coeficientes[e],
          sinVariacion: MODELO_APRENDIDO.sinVariacion.includes(e),
        })),
        metricasPrueba: { ...MODELO_APRENDIDO.metricasPrueba },
      },
=======
>>>>>>> 33e1b16b217a044946b76fd8cc42eb6b5a57bbe6
    };
  }

  async traza(loteIds: number[]) {
    if (loteIds.length === 0)
      throw new ErrorDominio("Selecciona al menos un lote.", "SELECCION_VACIA");

    const encontrados = await Promise.all(
      loteIds.map((id) => this.lotes.obtenerPorId(id)));
    const faltante = loteIds.find((_id, i) => encontrados[i] === null);
    if (faltante !== undefined)
      throw new ErrorDominio(
        `No existe el lote ${faltante}.`, "LOTE_NO_ENCONTRADO");
    const seleccion = encontrados as Lote[];

    // Un solo instante para el inventario y para el motor: si cada uno
    // leyera el reloj por su cuenta podrían caer en lados distintos de
    // un vencimiento y la propuesta usaría un lote que el inventario ya
    // no cuenta.
    const ahora = this.reloj.ahora();
    const [items, disponibles, cargas] = await Promise.all([
      this.catalogo.listarActivos(),
      this.lotes.inventarioDisponible(ahora),
      this.cargas.cargasPorArea(),
    ]);

    const salida = ejecutarModelo(
      seleccion, items, disponibles, cargas, ahora);

    // La traza de inspección NO se persiste. La que se guarda es la de
    // `ObtenerRecomendacionesUC`, que corresponde a una recomendación
    // que el usuario vio; registrar también las inspecciones ensuciaría
    // el conjunto con el que se analiza la Fase 4.
    return { lotes: seleccion, ...salida };
  }
}

// ---------------------------------------------------------------------

export class RegistrarDecisionUC implements RegistrarDecision {
  constructor(
    private readonly decisiones: RepositorioDecisiones,
    private readonly sesion: ProveedorSesion,
  ) {}

  async ejecutar(e: {
    recomendacionId: number; recetaId: number;
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
      recomendacionId: e.recomendacionId, recetaId: e.recetaId,
      accion: e.accion, motivo: e.motivo, rol,
      usuarioId: this.sesion.usuarioIdActual(),
      usuario: this.sesion.usuarioActual(),
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
      servicioId: e.servicioId,
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
    const cuenta = {
      apto: 0, por_vencer: 0, critico: 0, vencido: 0,
      sin_dictamen: 0, pendiente: 0,
    };
    for (const l of pendientes) {
      const h = horasRestantes(l, ahora);
      if (h <= 0) cuenta.vencido++;
      else if (dictamenDe(l) === "pendiente") cuenta.pendiente++;
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
        { estado: "Pendiente de medir", lotes: cuenta.pendiente },
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


// ---------------------------------------------------------------------

/**
 * Valoración de la claridad de una explicación.
 *
 * Se registra con el rol de quien valora, porque el interés está en si
 * la comprensión varía entre quien decide en cocina y quien controla
 * desde escritorio. Cualquier perfil puede valorar, incluso los que no
 * aprueban: entender la propuesta y tener atribución para ejecutarla
 * son cosas distintas.
 */
export class RegistrarFeedbackUC implements RegistrarFeedback {
  constructor(
    private readonly feedback: RepositorioFeedback,
    private readonly sesion: ProveedorSesion,
  ) {}

  async ejecutar(e: {
    recomendacionId: number;
    claridad: "clara" | "confusa" | "insuficiente";
    factorConfuso?: string;
    comentario?: string;
  }): Promise<void> {
    await this.feedback.registrar({
      recomendacionId: e.recomendacionId,
      rol: this.sesion.rolActual(),
      usuarioId: this.sesion.usuarioIdActual(),
      usuario: this.sesion.usuarioActual(),
      claridad: e.claridad,
      factorConfuso: e.factorConfuso,
      comentario: e.comentario,
    });
  }
}


// ---------------------------------------------------------------------

/**
 * Inicio de sesión.
 *
 * El mensaje de error no distingue entre correo inexistente y clave
 * incorrecta. Decir cuál de los dos falló permitiría averiguar qué
 * cuentas existen probando correos, que es lo que se quiere evitar.
 */
export class IniciarSesionUC implements IniciarSesion {
  constructor(private readonly usuarios: RepositorioUsuarios) {}

  async ejecutar(e: { correo: string; clave: string }): Promise<Usuario> {
    const correo = e.correo.trim().toLowerCase();
    if (!correo || !e.clave)
      throw new ErrorDominio("Indica correo y contraseña.", "DATOS_INCOMPLETOS");

    const usuario = await this.usuarios.verificar(correo, e.clave);
    if (!usuario)
      throw new ErrorDominio("Correo o contraseña incorrectos.", "CREDENCIALES");
    if (!usuario.activo)
      throw new ErrorDominio("La cuenta está desactivada.", "CUENTA_INACTIVA");

    await this.usuarios.registrarAcceso(usuario.id);
    return usuario;
  }
}

/**
 * Alta de cuenta.
 *
 * La validación de la contraseña vive aquí y no en la interfaz: un
 * adaptador de entrada distinto quedaría cubierto por la misma regla.
 */
export class RegistrarUsuarioUC implements RegistrarUsuario {
  constructor(private readonly usuarios: RepositorioUsuarios) {}

  async ejecutar(e: {
    correo: string; nombre: string; rol: Rol; clave: string;
  }): Promise<Usuario> {
    const correo = e.correo.trim().toLowerCase();
    const nombre = e.nombre.trim();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo))
      throw new ErrorDominio("El correo no tiene un formato válido.", "CORREO_INVALIDO");
    if (nombre.length < 3)
      throw new ErrorDominio("Escribe el nombre completo.", "NOMBRE_CORTO");
    if (e.clave.length < 8)
      throw new ErrorDominio(
        "La contraseña debe tener al menos 8 caracteres.", "CLAVE_CORTA");

    if (await this.usuarios.buscarPorCorreo(correo))
      throw new ErrorDominio("Ya existe una cuenta con ese correo.", "CORREO_DUPLICADO");

    return this.usuarios.crear({ correo, nombre, rol: e.rol, clave: e.clave });
  }
}
