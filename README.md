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

El dominio contiene entidades, motor de correspondencia, política de
permisos, puertos y casos de uso. No importa React, ni Express, ni SQL.
Ambos extremos consumen el mismo paquete, de modo que la lógica del modelo
existe una sola vez y no puede divergir entre cliente y servidor.

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

## Fases 3 y 4 de la metodología

```bash
npm run validar    # Fase 3: contraste contra el histórico
npm run evaluar    # Fase 4: indicadores del artefacto
```

`validar` verifica cinco propiedades del artefacto: que nunca viola una
restricción sanitaria, su cobertura, que es determinista, que combinar
lotes compatibles no empeora la propuesta, y que el orden de las
recomendaciones no depende de haber acertado los pesos con precisión.

No mide acierto predictivo contra el histórico, y el propio script
explica por qué: el conjunto de datos actual es sintético y sus
decisiones se generaron al azar, de modo que cualquier cifra de acierto
sería ruido. Esa comparación requiere los datos reales del caso.

`evaluar` agrupa los indicadores en operación, modelo y explicabilidad,
y muestra cómo la aceptación de cada receta se recalcula a partir de las
decisiones reales.

La parte cualitativa está en `INSTRUMENTO-EVALUACION.md`: recorrido de
la sesión, cuestionario de 21 ítems en escala de Likert, preguntas
abiertas y el análisis previsto.

## Verificar la arquitectura

```bash
npm run verificar
```

Comprueba que el dominio no importe paquetes externos ni frameworks, y que
las capas de backend y frontend apunten hacia adentro. Está enganchado al
`build`, de modo que romper la arquitectura rompe la compilación.
