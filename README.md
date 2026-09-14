# FoodLoop

Modelo de aprovechamiento de mermas alimentarias para operaciones de catering
industrial. A partir de las mermas disponibles, recomienda recetas de
reaprovechamiento y explica en qué se basa cada propuesta.

Frontend en React, backend en Express y PostgreSQL, con un núcleo de dominio
compartido por ambos extremos.

---

## Probarlo sin instalar nada

Si solo quieres ver funcionando el prototipo, hay una versión desplegada.
Pide el enlace a quien te compartió este repositorio.

Nota: el servidor gratuito se duerme tras un rato sin uso, de modo que la
primera carga puede tardar hasta un minuto. Las siguientes son inmediatas.

---

## Ejecutarlo en tu computadora

### 0. Requisitos

| Programa | Versión | Dónde |
|---|---|---|
| Node.js | 18 o superior | nodejs.org, versión LTS |
| PostgreSQL | 15 o superior, recomendada la 18 | postgresql.org/download |

Durante la instalación de PostgreSQL **anota la contraseña del usuario
`postgres`**: se necesita en el paso 3. Deja el puerto 5432 y marca la
instalación de pgAdmin.

### 1. Clonar el proyecto

```bash
git clone https://github.com/JosueQuinche/FoodLoop.git
cd FoodLoop
```

### 2. Crear la base de datos

```bash
createdb foodloop
```

Si `createdb` no está disponible, desde pgAdmin haz clic derecho sobre
Databases, Create, Database, y ponle el nombre `foodloop`. O desde psql:

```sql
CREATE DATABASE foodloop;
```

### 3. Configurar la conexión

Copia `backend/.env.example` a `backend/.env` y pon tu contraseña:

```
DATABASE_URL=postgres://postgres:TU_CLAVE@localhost:5432/foodloop
PORT=3001
```

Si tu contraseña contiene `@`, `#`, `/`, `:` o `%`, hay que codificarla:
la arroba se escribe `%40`, la almohadilla `%23`, la barra `%2F`.

### 4. Instalar y sembrar

```bash
npm install
npm run semilla
```

La semilla crea las tablas, los tipos enumerados, los índices y las vistas,
y carga el catálogo más 42 lotes repartidos en siete días para que las
gráficas tengan datos desde el primer arranque. Debe imprimir el conteo de
cada tabla.

### 5. Arrancar

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
| `password authentication failed for user "postgres"` | La contraseña del `.env` no coincide con la de PostgreSQL |
| `database "foodloop" does not exist` | Falta el paso 2 |
| `ECONNREFUSED 127.0.0.1:5432` | El servicio de PostgreSQL no está iniciado |
| `Missing script: "dev"` | Estás en una subcarpeta; debes estar en la raíz del proyecto |
| `EADDRINUSE :3001` | Otro proceso ocupa el puerto; ciérralo o cambia `PORT` en el `.env` |

---

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
  backend/      Express + PostgreSQL
  frontend/     React + Vite
  render.yaml   configuración de despliegue
```

El dominio contiene entidades, motor de correspondencia, política de
permisos, puertos y casos de uso. No importa React, ni Express, ni SQL.
Ambos extremos consumen el mismo paquete, de modo que la lógica del modelo
existe una sola vez y no puede divergir entre cliente y servidor.

---

## Modelo de datos

Siete tipos enumerados y ocho tablas.

```
area  ──< receta                (un área produce muchas recetas)
area  ──< merma                 (un área genera muchas mermas)
ingrediente ──< merma           (un ingrediente aparece en muchas mermas)
receta ──< receta_ingrediente >── ingrediente    (N:M con atributos)
merma ──< traza                 (cada evaluación deja su traza)
merma ──1 decision              (un lote recibe una sola decisión)
receta ──< decision             (una receta puede aprobarse muchas veces)
```

Restricciones que hacen trabajo real:

- `vida_util_coherente` impide que un lote venza antes de registrarse.
- `una_decision_por_lote` es lo que saca un lote de la lista de pendientes.
- Los `ENUM` restringen el dominio de verdad, a diferencia de un `CHECK`
  sobre texto libre.
- `ON DELETE RESTRICT` en los catálogos evita borrar un ingrediente que
  todavía aparece en mermas históricas; `CASCADE` en traza y decisión,
  porque sin el lote no tienen sentido.

Cuatro vistas encapsulan los cruces recurrentes: `v_lote_completo`,
`v_merma_por_causa`, `v_merma_por_area` y `v_merma_por_dia`, esta última
con `generate_series` para que los días sin registros aparezcan en cero en
lugar de faltar.

Para ver el diagrama entidad-relación: en pgAdmin, clic derecho sobre la
base `foodloop` y elegir **ERD For Database**.

---

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

## Verificar la arquitectura

```bash
npm run verificar
```

Comprueba que el dominio no importe paquetes externos ni frameworks, y que
las capas de backend y frontend apunten hacia adentro. Está enganchado al
`build`, de modo que romper la arquitectura rompe la compilación.
