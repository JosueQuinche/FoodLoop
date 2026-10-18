# FoodLoop

Modelo de aprovechamiento de mermas alimentarias para operaciones de catering
industrial. A partir de las mermas disponibles, recomienda recetas de
reaprovechamiento y explica en qué se basa cada propuesta.

Frontend en React, backend en Express y MongoDB como base de datos no
relacional, con un núcleo de dominio compartido por ambos extremos.

---

## Probarlo sin instalar nada

Si solo quieres ver funcionando el prototipo, hay una versión desplegada.
Pide el enlace a quien te compartió este repositorio.

Nota: el servidor gratuito se duerme tras un rato sin uso, de modo que la
primera carga puede tardar hasta un minuto. Las siguientes son inmediatas.

---

## Ejecutarlo en tu computadora

### 0. Requisitos

- **Node.js 18 o superior** (nodejs.org, versión LTS).
- **MongoDB**, de una de estas dos formas:
  - **Local:** MongoDB Community Server instalado y MongoDB Compass para
    ver los datos. La cadena de conexión es `mongodb://localhost:27017`.
  - **En la nube:** un clúster gratuito M0 en MongoDB Atlas. La cadena
    se obtiene en Connect → Drivers → Node.js.

### 1. Clonar el proyecto

```bash
git clone https://github.com/JosueQuinche/FoodLoop.git
cd FoodLoop
```

### 2. Configurar la conexión

Copia `backend/.env.example` a `backend/.env` y pon tu cadena de
conexión, la misma con la que te conectas en Compass:

```
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=foodloop
PORT=3001
```

Si la contraseña de Atlas contiene `@`, `#`, `/`, `:` o `%`, hay que
codificarla: la arroba se escribe `%40`.

La base `foodloop` no hay que crearla: se crea sola al sembrar.

### 3. Instalar y sembrar

```bash
npm install
npm run semilla
```

La semilla crea las colecciones con sus validadores e índices, y carga el
catálogo, seis meses de operación, 42 lotes y el historial de
recomendaciones. Debe imprimir el número de documentos de cada colección.
Después, en Compass, pulsa el botón de recargar y aparecerá la base
`foodloop`.

### 4. Arrancar

```bash
npm run dev
```

Levanta backend y frontend a la vez. Abre `http://localhost:5173`.

Si prefieres verlos por separado, en dos terminales:
`npm run dev:backend` y `npm run dev:frontend`.

---

## Si algo falla

| Mensaje | Qué significa |
|---|---|
| `ECONNREFUSED 127.0.0.1:27017` | El servidor de MongoDB local no está iniciado |
| `bad auth : authentication failed` | Usuario o contraseña de Atlas incorrectos |
| `querySrv ENOTFOUND` | La cadena de Atlas está mal copiada |
| `Server selection timed out` | En Atlas, falta permitir tu IP en Network Access |
| `Missing script: "dev"` | Estás en una subcarpeta; debes estar en la raíz del proyecto |
| `EADDRINUSE :3001` | Otro proceso ocupa el puerto; ciérralo o cambia `PORT` en el `.env` |

---

## Cuentas de ejemplo

La semilla crea una cuenta por perfil. La contraseña es `foodloop2026`
en todas:

| Correo | Perfil |
|---|---|
| m.calderon@cateringandes.ec | Chef ejecutivo |
| l.ordonez@cateringandes.ec | Jefa de producción |
| k.jimenez@cateringandes.ec | Analista administrativa |
| a.vega@cateringandes.ec | Supervisor de calidad |

También se pueden crear cuentas nuevas desde la pestaña **Crear cuenta**
del inicio de sesión. Las contraseñas se guardan cifradas con bcrypt,
nunca en claro.

## Qué probar

1. Entra como **chef ejecutivo**. Verás el panel con cuatro gráficas y la
   tabla de lotes pendientes.
2. Pulsa **Registrar merma**, captura un lote y guárdalo. Aparecerá en la
   tabla del panel.
3. Pulsa **Analizar** en cualquier lote. El modelo evalúa el catálogo y
   devuelve hasta tres alternativas ordenadas por aptitud.
4. Pulsa **¿Por qué?** para ver los siete factores con su contribución y los
   contrafactuales.
5. Abre **Mi perfil** desde el avatar de la barra superior y cambia a
   **analista administrativa**. Verás aparecer los costos y quedar
   bloqueado el botón de aprobar.

Casos que conviene mirar, incluidos a propósito en los datos de ejemplo:

- Un lote de **crema de leche a 8,4 °C** solo recibe reprocesos térmicos: la
  cadena de frío rota descarta el resto del catálogo.
- Un lote **sin dictamen sanitario** no recibe ninguna recomendación, y el
  sistema explica por qué.

---

## Estructura

```
FoodLoop/
  dominio/      @foodloop/dominio — núcleo compartido, sin dependencias
  backend/      Express + MongoDB
  frontend/     React + Vite
  render.yaml   configuración de despliegue
```

El dominio contiene entidades, motor de recomendación, política de
permisos, puertos y casos de uso. No importa React, ni Express, ni SQL.
Ambos extremos consumen el mismo paquete, de modo que la lógica del modelo
existe una sola vez y no puede divergir entre cliente y servidor.

El motor vive en `dominio/src/servicios/motor/`, una etapa por archivo:

```
motor/
  index.ts              la tubería: encadena las seis etapas y arma la traza
  pesos.ts              los siete parámetros, con la procedencia de cada uno
  ficha.ts              qué hace cada etapa y por qué está separada
  e1-entrada.ts         E1 · entrada de datos
  e2-restricciones.ts   E2 · seis reglas binarias, cinco sanitarias
  e3-caracteristicas.ts E3 · la situación de cocina medida en siete ejes
  e4-puntuacion.ts      E4 · combinación lineal del vector con los pesos
  e5-ordenamiento.ts    E5 · aptitud y tres desempates declarados
  e6-explicacion.ts     E6 · descomposición, resumen y contrafactual
```

Tres separaciones hacen el trabajo. **E1 no consulta la base ni lee el
reloj**: todo entra como argumento, y por eso la misma entrada produce
siempre la misma salida. **E2 va antes de medir y de puntuar**, de modo
que ninguna puntuación alta puede rescatar una propuesta que incumple una
restricción sanitaria: estructuralmente no llega a puntuarse. **E3 no
conoce los pesos**, solo mide, lo que permite revisar qué mide el modelo
sin discutir a la vez cómo lo combina, y sustituir los pesos por unos
ajustados sobre datos sin tocar el código que mide.

---

## Tecnologías y por qué

Cada capa usa lo que necesita y nada más. La distinción que suele
preguntarse: **sí hay frameworks en el proyecto** —Express y React—, pero
la capa de datos no usa ninguno.

| Capa | Herramienta | Versión |
| --- | --- | --- |
| Núcleo de dominio | TypeScript, **cero dependencias** | 5.6 |
| Base de datos | MongoDB, controlador oficial `mongodb` | 6.10 |
| Servidor | Express | 4.21 |
| Contraseñas | bcryptjs | 2.4 |
| Configuración | dotenv | 16.4 |
| Ejecución de TypeScript | tsx | 4.19 |
| Interfaz | React | 18.3 |
| Rutas de la interfaz | React Router | 6.26 |
| Empaquetado | Vite | 5.4 |
| Monorepo | npm workspaces, 3 paquetes | — |

### Lo que no se usó, y por qué

**Sin ODM ni ORM** (ni Mongoose, ni Prisma, ni TypeORM). Un ODM valida en
la aplicación, de modo que la regla solo se cumple mientras la escritura
pase por ella: una inserción desde MongoDB Compass o desde la consola se
la salta. Aquí la validación vive dentro del servidor de base de datos,
con validadores `$jsonSchema` por colección, y rechaza un documento mal
formado venga de donde venga. Con criterios sanitarios de por medio
—temperatura, estado del producto, caducidad— esa diferencia importa.

Hay un segundo motivo, arquitectónico: un ODM impone sus propias clases de
modelo y esos objetos se filtran al resto del programa. Sin él, el
adaptador traduce entre documentos y los tipos del dominio, y el dominio
no sabe qué base de datos hay debajo. No es teórico: **el proyecto ya
migró de PostgreSQL a MongoDB** y solo se reescribió la carpeta de
adaptadores.

**Sin framework de backend pesado** (ni NestJS, ni Fastify). La API expone
pocos endpoints y la lógica vive en el dominio; un framework con
inyección de dependencias y decoradores añadiría estructura sin resolver
ningún problema que el proyecto tenga.

**Sin framework de CSS ni biblioteca de componentes** (ni Tailwind, ni
Bootstrap, ni Material UI). La interfaz es CSS propio sobre variables, con
tokens de color, espaciado y movimiento declarados en `:root`.

**Sin biblioteca de animación** (ni Framer Motion, ni GSAP). El movimiento
son transiciones y animaciones CSS, que se ejecutan fuera del hilo
principal y no pierden fotogramas mientras el navegador carga.

---

## Modelo de datos

Base de datos no relacional orientada a documentos (MongoDB).

| Colección | Contenido |
|---|---|
| `areas`, `servicios`, `ingredientes` | Catálogos |
| `recetas` | Cada receta con sus ingredientes requeridos embebidos |
| `mermas` | Un documento por lote |
| `recomendaciones` | La propuesta con los **lotes que consume**, los factores de la explicación, la **decisión** y el **feedback**, todo en un documento |
| `operacion_diaria` | Producción y asistencia por fecha y servicio |
| `usuarios` | Cuentas, con la contraseña cifrada con bcrypt |

La colección clave es `recomendaciones`. Una receta hecha con varios
lotes de merma se representa con un arreglo `aportes`, y la decisión y
las valoraciones se guardan dentro del mismo documento. Guardarla es
atómico sin necesidad de transacciones.

La integridad se declara de forma explícita, porque MongoDB no la impone
por defecto:

- **Validadores `$jsonSchema`** en cada colección: tipos, campos
  obligatorios, valores permitidos y rangos. La base rechaza un documento
  que no los cumpla.
- **Índices únicos** en el código de lote y el correo de usuario.
- **Reglas en el código** para lo que un esquema no puede expresar: que
  un lote no venza antes de registrarse, o que una recomendación se
  decida una sola vez (con una actualización condicionada, que es
  atómica).

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/salud` | Comprobación de estado |
| GET | `/api/operacion` | Resumen del turno |
| GET | `/api/estadisticas` | Series para las gráficas |
| GET | `/api/maestros` | Ingredientes, áreas y servicios |
| GET | `/api/lotes` | Lotes pendientes |
| POST | `/api/lotes` | Registra una merma |
| GET | `/api/lotes/:id/recomendaciones` | Evalúa el catálogo |
| POST | `/api/decisiones` | Registra la decisión |
| GET | `/api/permisos/:rol` | Atribuciones del rol |

El rol activo viaja en la cabecera `X-Rol`. En producción saldría del token
de sesión; el cambio afectaría solo al adaptador HTTP.

---

## Reglas que el servidor aplica siempre

La vida útil se deriva del ingrediente y del estado del producto; no la
escribe el usuario. Un dictamen favorable se anula si la causa es defecto de
calidad o si la temperatura supera el máximo del ingrediente con margen. Y
aprobar exige atribución: un perfil administrativo recibe 403 aunque
manipule la petición, porque la comprobación vive en el dominio y no en la
interfaz.

---

## Las cuatro fases de la metodología

Cada fase tiene su propio comando. Se ejecutan en orden.

```bash
npm run fase1    # Definición y validación de requerimientos
npm run importar -- ./datos    # Fase 2 · preparación de datos reales
npm run fase2    # Fase 2 · evaluación del modelo construido
npm run fase3    # Experimentación: pruebas del prototipo y demostración XAI
npm run fase4    # Análisis de resultados
```

**Fase 1.** Verifica quince requerimientos, diez funcionales y cinco no
funcionales, ejecutando el comportamiento contra la base en lugar de
inspeccionar el código. Cada uno declara su origen: el objetivo del
trabajo, la normativa sanitaria o una observación recogida en las
sesiones.

**Fase 2.** Se compone de dos pasos. El primero, `importar`, carga los
registros reales del centro de producción desde archivos CSV y emite un
informe de preparación con cuántas filas entraron, cuántas se
descartaron y por qué motivo; ninguna fila descartada se sustituye por
un valor estimado. El segundo, `fase2`, evalúa el modelo construido
verificando cinco propiedades: inocuidad, cobertura, determinismo,
monotonía al combinar lotes y sensibilidad a los pesos.

El formato de los CSV está en `datos-plantilla/`, con un archivo de
ejemplo por cada uno. Mientras no se carguen datos reales, `npm run
semilla` genera un conjunto de ejemplo que permite recorrer el
prototipo, pero la fase de preparación de datos no queda cumplida con
él.

**Fase 3.** Ejecuta el recorrido completo del prototipo integrado, el
mismo que realizan los participantes en las sesiones, y demuestra el
componente XAI sobre un caso real en seis pasos: qué se descartó por
filtros sanitarios, cómo se compone la puntuación factor a factor, por
qué esa alternativa y no la siguiente, qué tendría que cambiar para otra
salida, la explicación en lenguaje natural y lo que queda registrado.

**Fase 4.** Reúne los indicadores de operación, modelo y explicabilidad,
y muestra cómo la aceptación de cada receta se recalcula a partir de las
decisiones reales.

La parte cualitativa está en `INSTRUMENTO-EVALUACION.md`: recorrido de
la sesión, cuestionario de 21 ítems en escala de Likert, preguntas
abiertas y el análisis previsto.

---

## Recorrer el prototipo con los datos del centro

```bash
npm run prototipo
```

Levanta el backend con los datos de `datos/` cargados en memoria y el
frontend en `http://localhost:5173`. No hace falta instalar MongoDB.

El conjunto del centro va de enero a junio de 2026, de modo que con el
reloj del sistema todos los lotes aparecen vencidos y el panel sale
vacío. El servidor de revisión se sitúa por eso en una fecha del propio
conjunto —la del último lote con dictamen favorable— y la interfaz lo
avisa en una banda sobre cada pantalla. Para situarse en otro día:

```bash
npx tsx herramientas/servidor-memoria.ts ./datos --fecha=2026-03-15
```

Esto no falsea la fecha de los registros, que conservan la suya: lo que
se mueve es el instante desde el que se los mira, que es el parámetro
que el motor ya recibía por la etapa 1.

### Con MongoDB

El prototipo en memoria reconstruye los datos en cada arranque, de modo
que las cuentas que se creen se guardan aparte, en `datos/.usuarios.json`.
Para que todo viva en la base de verdad:

1. Instala MongoDB Community Server (incluye Compass).
2. Copia `backend/.env.example` a `backend/.env`. Ya trae
   `MONGODB_URI=mongodb://localhost:27017`.
3. Descomenta `REVISION_FECHA=2026-06-23` en ese `.env`. Sin eso, los
   registros del centro —de enero a junio— aparecen todos vencidos y el
   panel sale vacío.
4. `npm run importar -- ./datos` carga los 1 577 lotes.
5. `npm run dev`.

El importador no borra la colección de usuarios, así que los datos se
pueden recargar sin perder cuentas. `REVISION_FECHA` es opcional y va
comentada por defecto: una instalación real no tiene que hacer nada para
usar el reloj del sistema.

**Dónde se ve cada cosa**

| Pantalla | Qué muestra |
| --- | --- |
| Panel | Los 1 577 lotes con su vida útil, su estado y el valor en riesgo |
| Recomendaciones | Las tres propuestas del modelo para la selección |
| Explicación | Los siete factores con su peso, su valor observado y su aporte |
| **El modelo** | Las seis etapas de esa ejecución, lo descartado con su regla, la matriz de características, la aritmética completa y los parámetros con su procedencia |

Un lote cuyo dictamen no se midió aparece como **«falta medir»**, no como
rechazado, y el prototipo ofrece ver su potencial de aprovechamiento con
las reglas sanitarias aplazadas: la propuesta sale marcada como no
autorizable y dice qué habría que medir.

---

## Ver el modelo por dentro

La interfaz muestra el resultado del modelo, pero no el modelo. Estos
comandos sirven para lo segundo.

```bash
npm run modelo           # las seis etapas de una ejecución, una por una
npm run modelo MRM-261007-0005          # sobre un lote concreto
npm run modelo MRM-261007-0005 MRM-261007-0012   # sobre un conjunto
npm run modelo:todos     # una línea por lote: admitidas, descartadas, aptitud
npm run modelo:probar    # 60 comprobaciones, cada etapa por separado
```

`npm run modelo` imprime, de una ejecución real: los lotes que entraron
con su vida útil y su dictamen; las recetas descartadas con la regla que
lo decidió y el lote que la incumplió; la matriz de siete
características por receta admisible; la tabla de pesos con la
procedencia de cada uno; la aritmética completa de la propuesta ganadora,
eje por eje; el ranking con sus desempates; y la explicación tal como la
ve el usuario, con la comprobación de que las siete contribuciones suman
la aptitud publicada.

Requiere un caso congelado, que se genera una vez:

```bash
npm run modelo:caso      # congela lotes, catálogo y fechas en un JSON
```

Congelar el caso es lo que permite demostrar que un cambio del motor no
alteró ninguna salida: `npm run modelo:volcar antes.json`, el cambio, y
`npm run modelo:volcar despues.json` producen dos archivos comparables
carácter a carácter. La reestructuración en seis etapas se verificó así,
sobre 91 evaluaciones y 133 propuestas.

Lo mismo está expuesto en el backend, para que la trazabilidad viva en
el sistema y no en un documento aparte:

| Ruta | Qué devuelve |
| --- | --- |
| `GET /modelo` | La ficha del modelo: etapas, reglas, parámetros con su procedencia y lo que no hace todavía |
| `POST /modelo/traza` | Para una selección de lotes, qué hizo cada etapa y con qué cifras |

La ficha se construye de las mismas tablas que el motor usa para
decidir, no de una descripción escrita aparte: si una etapa cambia de
responsabilidad y nadie actualiza su descripción, la discrepancia
aparece en la pantalla que la muestra.

## Verificar la arquitectura

```bash
npm run verificar
```

Comprueba que el dominio no importe paquetes externos ni frameworks, y que
las capas de backend y frontend apunten hacia adentro. Está enganchado al
`build`, de modo que romper la arquitectura rompe la compilación.
