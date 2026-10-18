# FoodLoop · Backend

Adaptador de entrada HTTP, persistencia en MongoDB y composición de la
aplicación.

## Lo primero: el modelo NO vive aquí

Esta carpeta no contiene ni una sola regla del modelo de recomendación.
El backend recibe peticiones, lee y escribe documentos, y llama a los
casos de uso. Nada más.

**El modelo está en `dominio/src/servicios/motor/`**, en la raíz del
proyecto, un paquete aparte.

Está así a propósito, y conviene poder explicar por qué: el motor no
importa nada de Express ni de MongoDB, de modo que se puede ejecutar, probar
y auditar sin levantar un servidor ni una base de datos. Si mañana el
almacenamiento dejara de ser MongoDB, el modelo no cambiaría una línea.
Una herramienta comprueba ese aislamiento en cada compilación:

```bash
npm run verificar     # → Regla de dependencias respetada en 37 archivos
```

## Dónde está cada pieza del modelo

`dominio/src/servicios/motor/` · 1 669 líneas en 10 archivos

| Archivo | Líneas | Qué hace |
| --- | ---: | --- |
| `e1-entrada.ts` | 90 | **Etapa 1 · Entrada.** Normaliza el lote, el catálogo de recetas, las cargas de servicio y el instante de evaluación en una sola estructura. Aquí entra el «ahora»: el motor no lee el reloj, lo recibe. |
| `e2-restricciones.ts` | 208 | **Etapa 2 · Restricciones.** Las seis reglas duras R0–R5, cinco de ellas de APPCC, cada una con su fundamento. Se evalúan ANTES de puntuar, de modo que ningún peso pueda rescatar una propuesta insegura. |
| `e3-caracteristicas.ts` | 209 | **Etapa 3 · Características.** Convierte cada pareja (lotes, receta) en siete valores entre 0 y 1. Todavía sin pesos: aquí solo se describe el caso. |
| `e4-puntuacion.ts` | 53 | **Etapa 4 · Puntuación.** La suma ponderada: `aptitud = Σ peso × característica`. Guarda cada término por separado como contribución. Recibe el vector de pesos como argumento. |
| `e5-ordenamiento.ts` | 47 | **Etapa 5 · Ordenamiento.** Ordena por aptitud y desempata por kilos usados, horas del conjunto y código, en ese orden. |
| `e6-explicacion.ts` | 117 | **Etapa 6 · Explicación.** Descompone la puntuación en sus términos y produce el contrafactual. No estima: lee las contribuciones que la etapa 4 ya guardó. |
| `pesos.ts` | 157 | Los siete parámetros del modelo, con valor, etiqueta, justificación y **origen declarado** (`experto` o `aprendido`). Separado del código que los aplica. |
| `tipos.ts` | 198 | Los tipos del motor: traza por etapas, incumplimientos, resultados. |
| `ficha.ts` | 108 | La ficha del modelo que consume la pantalla «El modelo» del prototipo. |
| `index.ts` | 482 | `ejecutarModelo()`, que encadena las seis etapas y devuelve la traza completa. |

### Por qué la explicación es fiable

La puntuación es lineal a propósito. No es una limitación: es lo que
permite que la etapa 6 muestre la **aritmética efectiva** del modelo en
lugar de una aproximación posterior. Con un modelo opaco y un explicador
aparte, la explicación y el cálculo pueden diferir; aquí no pueden,
porque son lo mismo.

### Los dos modos

`ejecutarModelo()` acepta `modo: "operacion" | "potencial"`. En operación
se aplican las seis reglas. En potencial se aplazan R1 (dictamen
sanitario) y R4 (temperatura) —las dos que dependen de campos que el
centro no midió— y el resultado sale marcado como **no autorizable**,
con la lista de qué falta medir. No es un modo permisivo: es la pregunta
«qué se habría podido aprovechar si se hubiera medido», contestada con
números.

## Cómo el backend usa el modelo

```
rutas.ts                   traduce HTTP a llamadas de caso de uso
   ↓
casos de uso (dominio)     ObtenerRecomendacionesUC, RegistrarMermaUC, …
   ↓
ejecutarModelo()           las seis etapas
   ↓
repositorios (MongoDB)     leen lotes y recetas, guardan la traza
```

El backend nunca llama al motor directamente: pasa por un caso de uso.
Son once, declarados en `dominio/src/aplicacion/index.ts`; el que ejecuta
el modelo es `ObtenerRecomendacionesUC`.

### Archivos de esta carpeta

```
src/
  servidor.ts                                  arranque: puerto, URI, reloj
  infraestructura/
    configuracion/contenedor.ts                composition root: el único
                                               sitio con clases concretas
    adaptadores/entrada/http/rutas.ts          Express → casos de uso
    adaptadores/salida/mongo/
      conexion.ts                              conexión, validadores
                                               $jsonSchema e índices
      repositorios.ts                          implementan los puertos
                                               que el dominio exige
      importar.ts                              carga los CSV del centro
      semilla.ts                               datos de demostración
      fase1.ts … fase4.ts                      las cuatro fases de la
                                               metodología
      fases-comun.ts                           reloj de revisión y
                                               registro de métricas
```

### Las colecciones

| Colección | Qué guarda |
| --- | --- |
| `mermas` | los lotes de excedente, con su estado, temperatura y vida útil |
| `recetas` | el catálogo, con los ingredientes que requiere cada una |
| `ingredientes` | el catálogo de ingredientes con su vida útil y costo |
| `operacion_diaria` | producción y asistencia por día y servicio |
| `areas`, `servicios` | se deducen de los datos, no se declaran aparte |
| `recomendaciones` | **cada propuesta que el modelo entregó**: versión del modelo, aptitud, los siete factores, los contrafactuales, los lotes consumidos, la decisión y las valoraciones |
| `usuarios` | cuentas, con la contraseña cifrada con bcrypt |

`recomendaciones` es la que sostiene la trazabilidad: toda la propuesta
vive en un solo documento, así que reconstruir meses después por qué se
recomendó algo no exige recalcularlo.

## Las cuatro fases de la metodología

Cada fase es un programa que se ejecuta contra la base y produce
evidencia reproducible.

| Comando | Fase |
| --- | --- |
| `npm run fase1` | Definición y validación de requerimientos |
| `npm run fase2` | Preparación y construcción del modelo · las cinco propiedades V1–V5 |
| `npm run fase3` | Experimentación · demostración del XAI paso a paso |
| `npm run fase4` | Análisis de resultados · operación, modelo y explicabilidad |

Sobre un conjunto histórico hay que situarlas en su periodo, o devuelven
cero porque todos los lotes aparecen vencidos:

```bash
npm run evidencias    # las cuatro, reloj por lote, salida a evidencias/
```

## Puesta en marcha

```bash
npm install
npm run esquema              # crea colecciones, validadores e índices
npm run importar -- ./datos  # carga los datos del centro
npm run dev                  # backend + frontend contra MongoDB
```

Por omisión se conecta a `mongodb://localhost:27017`, base `foodloop`.
Para cambiarlo, copie `.env.example` a `.env`.

Los datos del centro van de enero a junio de 2026. Para recorrerlos en el
prototipo hay que situarse en una fecha del propio conjunto, declarando
`REVISION_FECHA=2026-06-23` en `.env`. Eso no falsea los datos: los
registros conservan su fecha, y lo único que se mueve es el instante
desde el que se los mira, que es el parámetro que el motor ya recibe por
la etapa 1. La interfaz avisa en pantalla de que está en revisión
histórica.

## Limitación declarada

El rol del usuario viaja hoy en la cabecera `X-Rol`, que el propio
cliente declara, sin token firmado. Es alcance de prototipo y está
comentado en `rutas.ts`. En producción saldría del token de sesión, y el
cambio afectaría solo a ese archivo.
