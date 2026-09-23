/**
 * FoodLoop · Catálogo del caso de estudio
 *
 * Ingredientes, áreas y recetario institucional. Al sustituirlos por los
 * datos reales del caso, este archivo se reemplaza por un importador; el
 * esquema y el motor no cambian.
 */
import type { Ingrediente, ItemCatalogo } from "@foodloop/dominio";

export const AREAS = [
  { id: 0, nombre: "Cocina caliente", capacidadKg: 80 },
  { id: 1, nombre: "Cocina fría", capacidadKg: 45 },
  { id: 2, nombre: "Panadería", capacidadKg: 35 },
  { id: 3, nombre: "Economato", capacidadKg: 60 },
];

export const INGREDIENTES: Ingrediente[] = [
  { id: 0, codigo: "ING-001", nombre: "Pechuga de pollo", categoria: "Proteína animal", unidad: "kg", costoUnitario: 5.85, vidaUtilCrudoH: 72, vidaUtilCocidoH: 24, tempMaxC: 4 },
  { id: 1, codigo: "ING-002", nombre: "Carne de res molida", categoria: "Proteína animal", unidad: "kg", costoUnitario: 7.2, vidaUtilCrudoH: 48, vidaUtilCocidoH: 24, tempMaxC: 4 },
  { id: 2, codigo: "ING-005", nombre: "Arroz blanco", categoria: "Cereales", unidad: "kg", costoUnitario: 1.15, vidaUtilCrudoH: 4320, vidaUtilCocidoH: 30, tempMaxC: 4 },
  { id: 3, codigo: "ING-006", nombre: "Papa", categoria: "Vegetales", unidad: "kg", costoUnitario: 0.85, vidaUtilCrudoH: 720, vidaUtilCocidoH: 36, tempMaxC: 6 },
  { id: 4, codigo: "ING-007", nombre: "Brócoli", categoria: "Vegetales", unidad: "kg", costoUnitario: 2.3, vidaUtilCrudoH: 96, vidaUtilCocidoH: 42, tempMaxC: 4 },
  { id: 5, codigo: "ING-008", nombre: "Zanahoria", categoria: "Vegetales", unidad: "kg", costoUnitario: 1.1, vidaUtilCrudoH: 336, vidaUtilCocidoH: 48, tempMaxC: 6 },
  { id: 6, codigo: "ING-009", nombre: "Cebolla", categoria: "Vegetales", unidad: "kg", costoUnitario: 1.05, vidaUtilCrudoH: 720, vidaUtilCocidoH: 48, tempMaxC: 8 },
  { id: 7, codigo: "ING-011", nombre: "Lechuga", categoria: "Vegetales", unidad: "kg", costoUnitario: 2.0, vidaUtilCrudoH: 72, vidaUtilCocidoH: 12, tempMaxC: 4 },
  { id: 8, codigo: "ING-012", nombre: "Crema de leche", categoria: "Lácteos", unidad: "L", costoUnitario: 4.5, vidaUtilCrudoH: 168, vidaUtilCocidoH: 9, tempMaxC: 4 },
  { id: 9, codigo: "ING-013", nombre: "Queso mozzarella", categoria: "Lácteos", unidad: "kg", costoUnitario: 8.9, vidaUtilCrudoH: 336, vidaUtilCocidoH: 96, tempMaxC: 4 },
  { id: 10, codigo: "ING-015", nombre: "Pan de molde", categoria: "Panadería", unidad: "kg", costoUnitario: 2.75, vidaUtilCrudoH: 96, vidaUtilCocidoH: 26, tempMaxC: 20 },
  { id: 11, codigo: "ING-017", nombre: "Caldo de ave", categoria: "Salsas y fondos", unidad: "L", costoUnitario: 2.1, vidaUtilCrudoH: 720, vidaUtilCocidoH: 48, tempMaxC: 4 },
  { id: 12, codigo: "ING-019", nombre: "Fideo", categoria: "Cereales", unidad: "kg", costoUnitario: 1.45, vidaUtilCrudoH: 8760, vidaUtilCocidoH: 24, tempMaxC: 4 },
  { id: 13, codigo: "ING-004", nombre: "Huevo", categoria: "Proteína animal", unidad: "kg", costoUnitario: 3.1, vidaUtilCrudoH: 240, vidaUtilCocidoH: 48, tempMaxC: 6 },
];

const a = (id: number) => AREAS[id].nombre;

export const CATALOGO: ItemCatalogo[] = [
  {
    id: 0, codigo: "REC-001", nombre: "Arroz salteado con pollo y vegetales",
    areaId: 0, area: a(0), porcionesBase: 40, pesoPorcionG: 280, minutos: 35,
    tipoProceso: "reproceso_termico", tempProcesoC: 78, aceptacion: 4.4,
    requisitos: [
      { ingredienteId: 0, cantidad: 6.0, esPrincipal: true, admiteEstado: "cocido" },
      { ingredienteId: 2, cantidad: 8.0, esPrincipal: true, admiteEstado: "ambos" },
      { ingredienteId: 4, cantidad: 2.2, esPrincipal: false, admiteEstado: "ambos" },
      { ingredienteId: 5, cantidad: 1.6, esPrincipal: false, admiteEstado: "ambos" },
      { ingredienteId: 6, cantidad: 0.8, esPrincipal: false, admiteEstado: "crudo" },
    ],
    pasos: [
      "Verificar temperatura del lote entre 0 y 4 °C y ausencia de olores atípicos.",
      "Cortar la proteína en cubos de 2 cm y reservar en refrigeración.",
      "Blanquear brócoli y zanahoria 3 minutos y enfriar en agua con hielo.",
      "Saltear en tandas de 3 kg. Alcanzar 74 °C en el centro durante 15 segundos.",
      "Añadir arroz y sazonar. Homogenizar durante 4 minutos.",
      "Mantener sobre 65 °C hasta el servicio, o abatir a 4 °C en menos de 90 minutos.",
    ],
  },
  {
    id: 1, codigo: "REC-002", nombre: "Crema de ave con vegetales",
    areaId: 0, area: a(0), porcionesBase: 38, pesoPorcionG: 300, minutos: 50,
    tipoProceso: "reproceso_termico", tempProcesoC: 85, aceptacion: 3.9,
    requisitos: [
      { ingredienteId: 0, cantidad: 4.5, esPrincipal: true, admiteEstado: "cocido" },
      { ingredienteId: 8, cantidad: 2.0, esPrincipal: false, admiteEstado: "ambos" },
      { ingredienteId: 11, cantidad: 6.0, esPrincipal: true, admiteEstado: "ambos" },
      { ingredienteId: 4, cantidad: 1.4, esPrincipal: false, admiteEstado: "ambos" },
    ],
    pasos: [
      "Comprobar la cadena de frío del lote y descartar si supera 5 °C.",
      "Sofreír la base aromática y añadir el caldo de ave.",
      "Incorporar la proteína y llevar a ebullición durante 10 minutos.",
      "Triturar hasta obtener textura homogénea y colar.",
      "Añadir la crema fuera del fuego y rectificar sazón.",
      "Abatir o mantener sobre 65 °C según destino del servicio.",
    ],
  },
  {
    id: 2, codigo: "REC-003", nombre: "Porcionado y congelación de proteína",
    areaId: 3, area: a(3), porcionesBase: 32, pesoPorcionG: 200, minutos: 15,
    tipoProceso: "conservacion", tempProcesoC: 0, aceptacion: 3.2,
    requisitos: [
      { ingredienteId: 0, cantidad: 6.4, esPrincipal: true, admiteEstado: "cocido" },
    ],
    pasos: [
      "Pesar y porcionar en bolsas de 200 g.",
      "Etiquetar con lote de origen, fecha y responsable.",
      "Abatir a −18 °C en menos de 240 minutos.",
      "Registrar la entrada en el inventario de congelados.",
    ],
  },
  {
    id: 3, codigo: "REC-004", nombre: "Pastel de carne y papa",
    areaId: 0, area: a(0), porcionesBase: 45, pesoPorcionG: 320, minutos: 60,
    tipoProceso: "reproceso_termico", tempProcesoC: 80, aceptacion: 4.1,
    requisitos: [
      { ingredienteId: 1, cantidad: 5.5, esPrincipal: true, admiteEstado: "cocido" },
      { ingredienteId: 3, cantidad: 9.0, esPrincipal: true, admiteEstado: "ambos" },
      { ingredienteId: 6, cantidad: 1.0, esPrincipal: false, admiteEstado: "crudo" },
    ],
    pasos: [
      "Verificar el dictamen sanitario del lote de carne.",
      "Cocer y triturar la papa con un punto de sal.",
      "Saltear la carne con la base aromática hasta 74 °C internos.",
      "Montar en bandeja gastronorm alternando capas.",
      "Hornear 25 minutos a 180 °C hasta gratinar la superficie.",
    ],
  },
  {
    id: 4, codigo: "REC-005", nombre: "Puré de papa gratinado",
    areaId: 0, area: a(0), porcionesBase: 50, pesoPorcionG: 250, minutos: 40,
    tipoProceso: "reproceso_termico", tempProcesoC: 76, aceptacion: 4.0,
    requisitos: [
      { ingredienteId: 3, cantidad: 11.0, esPrincipal: true, admiteEstado: "cocido" },
      { ingredienteId: 9, cantidad: 2.5, esPrincipal: false, admiteEstado: "ambos" },
      { ingredienteId: 8, cantidad: 2.0, esPrincipal: false, admiteEstado: "ambos" },
    ],
    pasos: [
      "Triturar la papa en caliente para evitar textura gomosa.",
      "Incorporar la crema y ajustar densidad.",
      "Extender en bandeja y cubrir con queso rallado.",
      "Gratinar 12 minutos a 200 °C hasta dorar.",
    ],
  },
  {
    id: 5, codigo: "REC-006", nombre: "Ensalada mixta de la casa",
    areaId: 1, area: a(1), porcionesBase: 36, pesoPorcionG: 180, minutos: 20,
    tipoProceso: "ensamblaje_frio", tempProcesoC: 0, aceptacion: 3.6,
    requisitos: [
      { ingredienteId: 7, cantidad: 2.2, esPrincipal: true, admiteEstado: "crudo" },
      { ingredienteId: 5, cantidad: 1.5, esPrincipal: false, admiteEstado: "ambos" },
    ],
    pasos: [
      "Desinfectar el vegetal de hoja según el protocolo de la planta.",
      "Escurrir por completo antes del montaje.",
      "Cortar la zanahoria en juliana fina.",
      "Montar en el momento del servicio para evitar pérdida de textura.",
    ],
  },
  {
    id: 6, codigo: "REC-007", nombre: "Crutones y pan rallado",
    areaId: 2, area: a(2), porcionesBase: 60, pesoPorcionG: 60, minutos: 30,
    tipoProceso: "panaderia", tempProcesoC: 160, aceptacion: 3.4,
    requisitos: [
      { ingredienteId: 10, cantidad: 4.0, esPrincipal: true, admiteEstado: "ambos" },
    ],
    pasos: [
      "Retirar cortezas y cortar en cubos de 1,5 cm.",
      "Hornear a 160 °C durante 18 minutos removiendo a mitad.",
      "Enfriar por completo antes de envasar.",
      "Reservar en envase hermético hasta 15 días.",
    ],
  },
  {
    id: 7, codigo: "REC-008", nombre: "Budín de pan",
    areaId: 2, area: a(2), porcionesBase: 40, pesoPorcionG: 220, minutos: 55,
    tipoProceso: "panaderia", tempProcesoC: 170, aceptacion: 4.2,
    requisitos: [
      { ingredienteId: 10, cantidad: 3.5, esPrincipal: true, admiteEstado: "ambos" },
      { ingredienteId: 9, cantidad: 4.0, esPrincipal: false, admiteEstado: "ambos" },
      { ingredienteId: 13, cantidad: 1.2, esPrincipal: false, admiteEstado: "crudo" },
    ],
    pasos: [
      "Remojar el pan en la mezcla láctea durante 20 minutos.",
      "Batir los huevos e integrar sin generar espuma.",
      "Verter en molde y hornear a 170 °C durante 35 minutos.",
      "Comprobar cocción al centro y enfriar antes de porcionar.",
    ],
  },
  {
    id: 8, codigo: "REC-010", nombre: "Pasta al horno con queso",
    areaId: 0, area: a(0), porcionesBase: 42, pesoPorcionG: 300, minutos: 50,
    tipoProceso: "reproceso_termico", tempProcesoC: 82, aceptacion: 4.3,
    requisitos: [
      { ingredienteId: 12, cantidad: 5.5, esPrincipal: true, admiteEstado: "cocido" },
      { ingredienteId: 8, cantidad: 3.0, esPrincipal: false, admiteEstado: "ambos" },
      { ingredienteId: 9, cantidad: 3.0, esPrincipal: false, admiteEstado: "ambos" },
    ],
    pasos: [
      "Comprobar que la pasta no supere 30 horas desde su cocción.",
      "Mezclar con la salsa y repartir en bandeja.",
      "Cubrir con queso y hornear a 180 °C durante 22 minutos.",
      "Alcanzar 74 °C en el centro antes de servir.",
    ],
  },
  {
    id: 9, codigo: "REC-011", nombre: "Tortilla de papa y huevo",
    areaId: 0, area: a(0), porcionesBase: 40, pesoPorcionG: 240, minutos: 35,
    tipoProceso: "reproceso_termico", tempProcesoC: 75, aceptacion: 3.9,
    requisitos: [
      { ingredienteId: 3, cantidad: 6.0, esPrincipal: true, admiteEstado: "cocido" },
      { ingredienteId: 13, cantidad: 2.4, esPrincipal: true, admiteEstado: "crudo" },
      { ingredienteId: 6, cantidad: 0.7, esPrincipal: false, admiteEstado: "crudo" },
    ],
    pasos: [
      "Laminar la papa cocida y reservar.",
      "Batir el huevo e integrar la papa y la cebolla pochada.",
      "Cuajar en plancha hasta alcanzar 75 °C internos.",
      "Porcionar en frío para obtener cortes limpios.",
    ],
  },
];

