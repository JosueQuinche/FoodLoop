/**
 * @foodloop/dominio · superficie pública del paquete
 *
 * Núcleo compartido por el backend y el frontend. No depende de Express,
 * React, SQL ni HTTP: solo TypeScript. Que ambos extremos importen este
 * mismo paquete garantiza que la lógica del modelo sea literalmente la
 * misma en los dos lados, no dos copias que se van separando con el tiempo.
 */
export * from "./modelo/tipos";
export * from "./servicios/motor";
export * from "./servicios/autorizacion";
export * from "./puertos/entrada/casos-uso";
export * from "./puertos/salida/repositorios";
export * from "./aplicacion/index";
