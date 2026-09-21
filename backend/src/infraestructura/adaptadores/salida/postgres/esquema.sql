-- =====================================================================
-- FoodLoop · Esquema v2 · multi-lote y feedback
--
-- Ejecutar en Supabase: SQL Editor → New query → pegar → Run.
-- Idempotente: puede volver a ejecutarse sin error.
--
-- Cambios respecto a la v1:
--   · Una recomendación puede consumir VARIOS lotes de merma.
--   · Un lote puede consumirse parcialmente en varias recomendaciones.
--   · Las decisiones alimentan la aceptación del modelo (bucle cerrado).
--   · El servicio pasa a ser clave foránea en lugar de texto libre.
-- =====================================================================

-- ---------------------------------------------------------------------
-- TIPOS
-- ---------------------------------------------------------------------

DO $$ BEGIN CREATE TYPE unidad_medida AS ENUM ('kg','L','unid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE estado_producto AS ENUM ('crudo','cocido');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE admite_estado AS ENUM ('crudo','cocido','ambos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE tipo_proceso AS ENUM
  ('reproceso_termico','ensamblaje_frio','conservacion','panaderia');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE causa_merma AS ENUM
  ('sobreproduccion','devolucion_linea','error_porcionado',
   'caducidad_proxima','defecto_calidad');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE rol_usuario AS ENUM
  ('chef','produccion','admin','calidad');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE accion_decision AS ENUM
  ('aprobada','modificada','descartada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Valoración de la explicación por parte del usuario. Es el insumo
-- cualitativo de la Fase 4 sobre comprensión del componente XAI.
DO $$ BEGIN CREATE TYPE claridad_explicacion AS ENUM
  ('clara','confusa','insuficiente');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- CATÁLOGOS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS area (
  id            SMALLINT PRIMARY KEY,
  nombre        TEXT NOT NULL UNIQUE,
  capacidad_kg  NUMERIC(6,2) NOT NULL DEFAULT 60 CHECK (capacidad_kg > 0)
);

CREATE TABLE IF NOT EXISTS servicio (
  id      SMALLINT PRIMARY KEY,
  nombre  TEXT NOT NULL UNIQUE,
  orden   SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ingrediente (
  id                  SMALLINT PRIMARY KEY,
  codigo              TEXT NOT NULL UNIQUE,
  nombre              TEXT NOT NULL,
  categoria           TEXT NOT NULL,
  unidad              unidad_medida NOT NULL,
  costo_unitario      NUMERIC(8,2) NOT NULL CHECK (costo_unitario >= 0),
  vida_util_crudo_h   INTEGER NOT NULL CHECK (vida_util_crudo_h > 0),
  vida_util_cocido_h  INTEGER NOT NULL CHECK (vida_util_cocido_h > 0),
  temp_max_c          NUMERIC(4,1) NOT NULL DEFAULT 4
);

-- ---------------------------------------------------------------------
-- RECETARIO
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS receta (
  id              SMALLINT PRIMARY KEY,
  codigo          TEXT NOT NULL UNIQUE,
  nombre          TEXT NOT NULL,
  area_id         SMALLINT NOT NULL REFERENCES area(id) ON DELETE RESTRICT,
  porciones_base  SMALLINT NOT NULL CHECK (porciones_base > 0),
  peso_porcion_g  SMALLINT NOT NULL CHECK (peso_porcion_g > 0),
  minutos         SMALLINT NOT NULL CHECK (minutos > 0),
  tipo_proceso    tipo_proceso NOT NULL,
  temp_proceso_c  NUMERIC(5,1) NOT NULL DEFAULT 0,
  -- Valoración de partida, usada mientras no haya decisiones suficientes.
  -- La aceptación efectiva se calcula en v_aceptacion_receta.
  aceptacion_base NUMERIC(2,1) NOT NULL DEFAULT 3.5
                  CHECK (aceptacion_base BETWEEN 1 AND 5),
  pasos           JSONB NOT NULL DEFAULT '[]'::jsonb,
  activa          BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS receta_ingrediente (
  receta_id       SMALLINT NOT NULL REFERENCES receta(id) ON DELETE CASCADE,
  ingrediente_id  SMALLINT NOT NULL REFERENCES ingrediente(id) ON DELETE RESTRICT,
  cantidad        NUMERIC(7,3) NOT NULL CHECK (cantidad > 0),
  es_principal    BOOLEAN NOT NULL DEFAULT FALSE,
  admite_estado   admite_estado NOT NULL DEFAULT 'ambos',
  PRIMARY KEY (receta_id, ingrediente_id)
);

-- ---------------------------------------------------------------------
-- OPERACIÓN
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS merma (
  id               BIGSERIAL PRIMARY KEY,
  codigo           TEXT NOT NULL UNIQUE,
  ingrediente_id   SMALLINT NOT NULL REFERENCES ingrediente(id) ON DELETE RESTRICT,
  area_id          SMALLINT NOT NULL REFERENCES area(id) ON DELETE RESTRICT,
  -- Antes era texto libre. Como clave foránea, dos registros ya no pueden
  -- escribir el mismo servicio de formas distintas.
  servicio_id      SMALLINT NOT NULL REFERENCES servicio(id) ON DELETE RESTRICT,
  cantidad         NUMERIC(8,2) NOT NULL CHECK (cantidad > 0),
  estado_producto  estado_producto NOT NULL,
  temperatura_c    NUMERIC(4,1) NOT NULL,
  causa            causa_merma NOT NULL,
  apto_reproceso   BOOLEAN NOT NULL DEFAULT TRUE,
  registrado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  vence_en         TIMESTAMPTZ NOT NULL,
  CONSTRAINT vida_util_coherente CHECK (vence_en > registrado_en)
);

-- ---------------------------------------------------------------------
-- USUARIOS
--
-- El perfil deja de estar escrito en el código y pasa a la base: es la
-- cuenta la que determina qué puede hacer cada persona.
--
-- La contraseña se guarda como hash con sal, nunca en claro. Para un
-- prototipo académico se usa un esquema sencillo basado en pgcrypto;
-- una implantación real usaría bcrypt o argon2 con más iteraciones.
-- ---------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS usuario (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correo        TEXT NOT NULL UNIQUE,
  nombre        TEXT NOT NULL,
  rol           rol_usuario NOT NULL,
  clave_hash    TEXT NOT NULL,
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_acceso TIMESTAMPTZ,
  CONSTRAINT correo_valido CHECK (correo LIKE '%_@_%._%')
);

COMMENT ON COLUMN usuario.rol IS
  'Determina las atribuciones. La interfaz las consulta, no las decide.';

CREATE INDEX IF NOT EXISTS idx_usuario_correo ON usuario (lower(correo));

-- ---------------------------------------------------------------------
-- REGISTROS DE OPERACIÓN: PRODUCCIÓN Y CONSUMO
--
-- Fase 1 de la metodología. Junto con `merma`, estas dos tablas son las
-- tres fuentes que el modelo integra. Comparten (fecha, servicio_id)
-- como clave de cruce, que es el identificador común que permite
-- relacionarlas sin depender de la aplicación.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS produccion (
  id                   BIGSERIAL PRIMARY KEY,
  fecha                DATE NOT NULL,
  servicio_id          SMALLINT NOT NULL REFERENCES servicio(id) ON DELETE RESTRICT,
  receta_id            SMALLINT NOT NULL REFERENCES receta(id) ON DELETE RESTRICT,
  porciones_producidas INTEGER NOT NULL CHECK (porciones_producidas >= 0),
  -- Una receta se produce una vez por servicio y día.
  CONSTRAINT produccion_unica UNIQUE (fecha, servicio_id, receta_id)
);

COMMENT ON TABLE produccion IS
  'Registro histórico de producción diaria por menú y servicio.';

CREATE TABLE IF NOT EXISTS asistencia (
  id                   BIGSERIAL PRIMARY KEY,
  fecha                DATE NOT NULL,
  servicio_id          SMALLINT NOT NULL REFERENCES servicio(id) ON DELETE RESTRICT,
  comensales_previstos INTEGER NOT NULL CHECK (comensales_previstos >= 0),
  comensales_reales    INTEGER NOT NULL CHECK (comensales_reales >= 0),
  CONSTRAINT asistencia_unica UNIQUE (fecha, servicio_id)
);

COMMENT ON TABLE asistencia IS
  'Consumo real frente a previsto. El desvío explica buena parte del excedente.';

-- ---------------------------------------------------------------------
-- SALIDAS DEL MODELO
--
-- La recomendación pasa a ser una entidad propia. Antes vivía dentro de
-- la traza como JSON y no se podía consultar ni referenciar; ahora una
-- decisión apunta a la recomendación que aprueba, y la recomendación
-- declara qué lotes consume.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recomendacion (
  id                BIGSERIAL PRIMARY KEY,
  receta_id         SMALLINT NOT NULL REFERENCES receta(id) ON DELETE RESTRICT,
  generada_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  version_modelo    TEXT NOT NULL,
  aptitud           NUMERIC(4,1) NOT NULL CHECK (aptitud BETWEEN 0 AND 100),
  posicion          SMALLINT NOT NULL CHECK (posicion > 0),
  porciones         SMALLINT NOT NULL,
  kg_aprovechados   NUMERIC(8,2) NOT NULL,
  costo_recuperado  NUMERIC(10,2) NOT NULL,
  -- Documentos JSON: la descomposición de la puntuación y los
  -- contrafactuales. Son estructuras variables y solo se leen enteras,
  -- de modo que como documento encajan mejor que como tablas.
  factores          JSONB NOT NULL DEFAULT '[]'::jsonb,
  contrafactuales   JSONB NOT NULL DEFAULT '[]'::jsonb,
  descartes         JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- MULTI-LOTE: el corazón del cambio. Una recomendación toma cantidades
-- de varios lotes; un lote participa en varias recomendaciones.
CREATE TABLE IF NOT EXISTS recomendacion_lote (
  recomendacion_id  BIGINT NOT NULL REFERENCES recomendacion(id) ON DELETE CASCADE,
  merma_id          BIGINT NOT NULL REFERENCES merma(id) ON DELETE CASCADE,
  cantidad_usada    NUMERIC(8,2) NOT NULL CHECK (cantidad_usada > 0),
  -- Un lote cubre el ingrediente principal o uno complementario.
  es_principal      BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (recomendacion_id, merma_id)
);

CREATE TABLE IF NOT EXISTS decision (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recomendacion_id  BIGINT NOT NULL REFERENCES recomendacion(id) ON DELETE CASCADE,
  rol               rol_usuario NOT NULL,
  usuario           TEXT NOT NULL,
  accion            accion_decision NOT NULL,
  motivo            TEXT,
  decidida_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Una recomendación se decide una sola vez.
  CONSTRAINT una_decision_por_recomendacion UNIQUE (recomendacion_id)
);

-- FEEDBACK sobre la explicación. Separado de la decisión a propósito:
-- un usuario puede aprobar una recomendación y aun así encontrar la
-- explicación confusa, y ese es justamente el dato interesante para la
-- evaluación del componente XAI.
CREATE TABLE IF NOT EXISTS feedback_explicacion (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recomendacion_id  BIGINT NOT NULL REFERENCES recomendacion(id) ON DELETE CASCADE,
  rol               rol_usuario NOT NULL,
  usuario           TEXT NOT NULL,
  claridad          claridad_explicacion NOT NULL,
  -- Qué factor le resultó menos comprensible, si señaló alguno.
  factor_confuso    TEXT,
  comentario        TEXT,
  registrado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- ÍNDICES
-- ---------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_merma_vence      ON merma (vence_en);
CREATE INDEX IF NOT EXISTS idx_merma_ingr       ON merma (ingrediente_id);
CREATE INDEX IF NOT EXISTS idx_merma_registrado ON merma (registrado_en DESC);
CREATE INDEX IF NOT EXISTS idx_merma_apto       ON merma (apto_reproceso)
  WHERE apto_reproceso = TRUE;
CREATE INDEX IF NOT EXISTS idx_ri_ingrediente   ON receta_ingrediente (ingrediente_id);
CREATE INDEX IF NOT EXISTS idx_rl_merma         ON recomendacion_lote (merma_id);
CREATE INDEX IF NOT EXISTS idx_rec_receta       ON recomendacion (receta_id);
CREATE INDEX IF NOT EXISTS idx_dec_accion       ON decision (accion);
CREATE INDEX IF NOT EXISTS idx_fb_recomendacion ON feedback_explicacion (recomendacion_id);

-- ---------------------------------------------------------------------
-- VISTAS
-- ---------------------------------------------------------------------

-- Cuánto queda de cada lote: lo registrado menos lo ya comprometido en
-- recomendaciones aprobadas. Es lo que permite el consumo parcial.
CREATE OR REPLACE VIEW v_lote_disponible AS
SELECT
  m.id, m.codigo, m.ingrediente_id, m.area_id, m.servicio_id,
  m.cantidad AS cantidad_original,
  m.cantidad - COALESCE(usado.kg, 0) AS cantidad_disponible,
  m.estado_producto, m.temperatura_c, m.causa, m.apto_reproceso,
  m.registrado_en, m.vence_en,
  i.nombre AS ingrediente, i.unidad, i.costo_unitario,
  a.nombre AS area, s.nombre AS servicio,
  ROUND((m.cantidad - COALESCE(usado.kg, 0)) * i.costo_unitario, 2) AS valor,
  EXTRACT(EPOCH FROM (m.vence_en - now())) / 3600 AS horas_restantes
FROM merma m
JOIN ingrediente i ON i.id = m.ingrediente_id
JOIN area a        ON a.id = m.area_id
JOIN servicio s    ON s.id = m.servicio_id
LEFT JOIN (
  SELECT rl.merma_id, SUM(rl.cantidad_usada) AS kg
  FROM recomendacion_lote rl
  JOIN decision d ON d.recomendacion_id = rl.recomendacion_id
  WHERE d.accion = 'aprobada'
  GROUP BY rl.merma_id
) usado ON usado.merma_id = m.id;

-- BUCLE CERRADO: la aceptación se recalcula de las decisiones reales.
--
-- No se usa la proporción de aprobación directamente, porque con pocas
-- decisiones oscila de forma absurda: tres rechazos seguidos hundirían
-- una receta de 4,4 a 1,0. Se aplica encogimiento hacia la valoración
-- de partida, con un peso previo de K observaciones ficticias.
--
--   efectiva = (base · K + observada · n) / (K + n)
--
-- Con n pequeño domina la base; conforme se acumulan decisiones, la
-- evidencia real va tomando el control. Es la corrección habitual en
-- estimaciones sobre muestras pequeñas y evita que el modelo reaccione
-- de forma desproporcionada a los primeros casos.
CREATE OR REPLACE VIEW v_aceptacion_receta AS
WITH conteo AS (
  SELECT
    r.id AS receta_id,
    r.nombre,
    r.aceptacion_base,
    COUNT(d.id) AS n_decisiones,
    COUNT(d.id) FILTER (WHERE d.accion = 'aprobada') AS aprobadas
  FROM receta r
  LEFT JOIN recomendacion rec ON rec.receta_id = r.id
  LEFT JOIN decision d        ON d.recomendacion_id = rec.id
  GROUP BY r.id, r.nombre, r.aceptacion_base
)
SELECT
  receta_id, nombre, aceptacion_base, n_decisiones, aprobadas,
  CASE
    WHEN n_decisiones = 0 THEN aceptacion_base
    ELSE ROUND(
      (aceptacion_base * 8 +
       (1 + 4 * (aprobadas::numeric / n_decisiones)) * n_decisiones)
      / (8 + n_decisiones), 1)
  END AS aceptacion_efectiva
FROM conteo;

-- Comprensión de las explicaciones, por receta. Alimenta la Fase 4.
CREATE OR REPLACE VIEW v_claridad_explicacion AS
SELECT
  r.nombre AS receta,
  COUNT(*) AS valoraciones,
  COUNT(*) FILTER (WHERE f.claridad = 'clara') AS claras,
  ROUND(100.0 * COUNT(*) FILTER (WHERE f.claridad = 'clara')
        / NULLIF(COUNT(*), 0), 1) AS pct_claras
FROM feedback_explicacion f
JOIN recomendacion rec ON rec.id = f.recomendacion_id
JOIN receta r          ON r.id = rec.receta_id
GROUP BY r.nombre
ORDER BY valoraciones DESC;

CREATE OR REPLACE VIEW v_merma_por_causa AS
SELECT causa::TEXT AS causa, ROUND(SUM(cantidad), 1) AS kg, COUNT(*) AS lotes
FROM merma GROUP BY causa ORDER BY kg DESC;

CREATE OR REPLACE VIEW v_merma_por_area AS
SELECT a.nombre AS area, a.capacidad_kg,
       ROUND(COALESCE(SUM(m.cantidad), 0), 1) AS kg
FROM area a LEFT JOIN merma m ON m.area_id = a.id
GROUP BY a.id, a.nombre, a.capacidad_kg ORDER BY kg DESC;

CREATE OR REPLACE VIEW v_merma_por_dia AS
SELECT
  d.dia::DATE AS fecha,
  ROUND(COALESCE(SUM(m.cantidad), 0), 1) AS registrada,
  ROUND(COALESCE(SUM(rl.cantidad_usada) FILTER
        (WHERE de.accion = 'aprobada'), 0), 1) AS aprovechada
FROM generate_series(
       (now() - INTERVAL '6 days')::DATE, now()::DATE, INTERVAL '1 day') AS d(dia)
LEFT JOIN merma m               ON m.registrado_en::DATE = d.dia::DATE
LEFT JOIN recomendacion_lote rl ON rl.merma_id = m.id
LEFT JOIN decision de           ON de.recomendacion_id = rl.recomendacion_id
GROUP BY d.dia ORDER BY d.dia;

-- INTEGRACIÓN DE LA FASE 1
--
-- Cruza las tres fuentes por fecha y servicio. Es la vista que
-- materializa lo que la metodología describe como objetivo de la
-- primera fase, y la que permite expresar la merma como proporción de
-- lo producido en lugar de en kilos absolutos, que por sí solos no
-- dicen si la operación fue eficiente o no.
CREATE OR REPLACE VIEW v_operacion_diaria AS
SELECT
  a.fecha,
  s.nombre AS servicio,
  a.comensales_previstos,
  a.comensales_reales,
  a.comensales_previstos - a.comensales_reales AS desvio_comensales,
  ROUND(100.0 * (a.comensales_previstos - a.comensales_reales)
        / NULLIF(a.comensales_previstos, 0), 1) AS desvio_pct,
  COALESCE(p.porciones, 0) AS porciones_producidas,
  COALESCE(m.kg, 0) AS kg_merma,
  COALESCE(m.valor, 0) AS valor_merma,
  -- Peso estimado de lo producido, para poder comparar con la merma.
  ROUND(COALESCE(p.peso_kg, 0), 1) AS kg_producidos,
  ROUND(100.0 * COALESCE(m.kg, 0) / NULLIF(p.peso_kg, 0), 1) AS merma_pct
FROM asistencia a
JOIN servicio s ON s.id = a.servicio_id
LEFT JOIN (
  SELECT pr.fecha, pr.servicio_id,
         SUM(pr.porciones_producidas) AS porciones,
         SUM(pr.porciones_producidas * r.peso_porcion_g) / 1000.0 AS peso_kg
  FROM produccion pr JOIN receta r ON r.id = pr.receta_id
  GROUP BY pr.fecha, pr.servicio_id
) p ON p.fecha = a.fecha AND p.servicio_id = a.servicio_id
LEFT JOIN (
  SELECT mm.registrado_en::DATE AS fecha, mm.servicio_id,
         SUM(mm.cantidad) AS kg,
         SUM(mm.cantidad * i.costo_unitario) AS valor
  FROM merma mm JOIN ingrediente i ON i.id = mm.ingrediente_id
  GROUP BY mm.registrado_en::DATE, mm.servicio_id
) m ON m.fecha = a.fecha AND m.servicio_id = a.servicio_id;

-- Relación entre el desvío de comensales y la merma generada. Es la
-- hipótesis operativa que sostiene el modelo: se pierde sobre todo por
-- producir para más gente de la que acude.
CREATE OR REPLACE VIEW v_desvio_vs_merma AS
SELECT
  CASE
    WHEN desvio_pct < 0  THEN 'Acudieron más de los previstos'
    WHEN desvio_pct < 5  THEN 'Desvío bajo (0-5 %)'
    WHEN desvio_pct < 12 THEN 'Desvío medio (5-12 %)'
    ELSE 'Desvío alto (>12 %)'
  END AS rango_desvio,
  COUNT(*) AS servicios,
  ROUND(AVG(kg_merma), 1) AS kg_merma_medio,
  ROUND(AVG(merma_pct), 1) AS merma_pct_medio
FROM v_operacion_diaria
WHERE kg_producidos > 0
GROUP BY rango_desvio
ORDER BY MIN(desvio_pct);

CREATE INDEX IF NOT EXISTS idx_prod_fecha_serv ON produccion (fecha, servicio_id);
CREATE INDEX IF NOT EXISTS idx_asis_fecha_serv ON asistencia (fecha, servicio_id);

-- Trazabilidad completa: qué se recomendó, con qué lotes y qué se decidió.
CREATE OR REPLACE VIEW v_trazabilidad AS
SELECT
  rec.id AS recomendacion_id,
  rec.generada_en,
  rec.version_modelo,
  r.nombre AS receta,
  rec.aptitud,
  rec.posicion,
  (SELECT COUNT(*) FROM recomendacion_lote WHERE recomendacion_id = rec.id)
    AS lotes_usados,
  (SELECT string_agg(m.codigo, ', ' ORDER BY m.codigo)
   FROM recomendacion_lote rl JOIN merma m ON m.id = rl.merma_id
   WHERE rl.recomendacion_id = rec.id) AS lotes,
  d.accion, d.rol, d.usuario, d.decidida_en,
  f.claridad AS claridad_explicacion
FROM recomendacion rec
JOIN receta r              ON r.id = rec.receta_id
LEFT JOIN decision d       ON d.recomendacion_id = rec.id
LEFT JOIN feedback_explicacion f ON f.recomendacion_id = rec.id
ORDER BY rec.generada_en DESC;
