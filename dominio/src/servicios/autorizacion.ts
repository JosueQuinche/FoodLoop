/**
 * FoodLoop · Política de autorización
 *
 * Servicio de dominio puro. Define quién puede hacer qué según el modelo
 * de responsabilidades de un centro de producción, no según conveniencia
 * de la interfaz.
 *
 * La separación relevante: el chef ejecutivo responde por la producción
 * pero no por el presupuesto, de modo que no ve costos; la analista
 * administrativa valoriza pero no decide sobre el alimento; el supervisor
 * de calidad es el único que puede emitir dictamen sanitario, que es la
 * restricción dura del modelo de recomendación.
 */

import type { Rol } from "../modelo/tipos";
import type { Permisos } from "../puertos/entrada/casos-uso";

const MATRIZ: Record<Rol, Permisos> = {
  chef: {
    aprueba: true, editaRecetario: true,
    veCostos: false, dictaminaSanidad: false,
  },
  produccion: {
    aprueba: true, editaRecetario: false,
    veCostos: true, dictaminaSanidad: false,
  },
  admin: {
    aprueba: false, editaRecetario: false,
    veCostos: true, dictaminaSanidad: false,
  },
  calidad: {
    aprueba: false, editaRecetario: false,
    veCostos: false, dictaminaSanidad: true,
  },
};

export const permisosDe = (rol: Rol): Permisos => MATRIZ[rol];

export const PERFILES: Record<Rol, { nombre: string; ini: string; titulo: string }> = {
  chef: { nombre: "Mateo Calderón", ini: "MC", titulo: "Chef ejecutivo" },
  produccion: { nombre: "Lucía Ordóñez", ini: "LO", titulo: "Jefa de producción" },
  admin: { nombre: "Karla Jiménez", ini: "KJ", titulo: "Analista administrativa" },
  calidad: { nombre: "Andrés Vega", ini: "AV", titulo: "Supervisor de calidad" },
};

/** Ámbito de cada rol en cada pantalla, para orientar al usuario. */
export const AMBITO: Record<Rol, Record<string, string>> = {
  chef: {
    panel: "Ves las mermas disponibles del turno, sin datos de costo.",
    recomendaciones: "Puedes aprobar la recomendación y enviarla a producción.",
    xai: "Revisas el sustento del modelo antes de comprometer la línea.",
    receta: "Eres el único perfil que edita el recetario estandarizado.",
  },
  produccion: {
    panel: "Ves carga de línea y costo recuperable. Programas la ejecución.",
    recomendaciones: "Apruebas y programas, pero no modificas el estándar.",
    xai: "Verificas que el modelo pondere la carga de trabajo de tu área.",
    receta: "Envías a producción; la edición del estándar es del chef.",
  },
  admin: {
    panel: "Perfil de consulta: ves el valor en riesgo pero no apruebas.",
    recomendaciones: "Consultas el costo recuperado de cada alternativa.",
    xai: "Revisas el sustento del modelo para el informe del comité.",
    receta: "Solo lectura, para verificar el costo por porción.",
  },
  calidad: {
    panel: "Ves el estado sanitario de los lotes, no los costos.",
    recomendaciones: "Verificas que la alternativa respete la ventana sanitaria.",
    xai: "Compruebas que el modelo pondere la vida útil restante.",
    receta: "Revisas el punto crítico de control de la preparación.",
  },
};
