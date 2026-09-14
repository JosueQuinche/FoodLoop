-- =====================================================================
-- FoodLoop · Esquema PostgreSQL
-- Fase 1 de la metodología: integración de producción, asistencia,
-- mermas y recetario mediante identificadores comunes.
--
-- Ejecutar:  psql -U postgres -d foodloop -f esquema.sql
-- El script es idempotente: puede volver a ejecutarse sin error.
-- =====================================================================

-- ---------------------------------------------------------------------
-- TIPOS ENUMERADOS
-- Un CHECK admite cualquier texto que cumpla la condición; un ENUM
-- restringe el dominio de verdad y documenta los valores válidos en el
-- propio esquema, que es lo que se quiere en un trabajo académico.
-- ---------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE unidad_medida AS ENUM ('kg', 'L', 'unid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_producto AS ENUM ('crudo', 'cocido');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE admite_estado AS ENUM ('crudo', 'cocido', 'ambos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tipo_proceso AS ENUM
    ('reproceso_termico', 'ensamblaje_frio', 'conservacion', 'panaderia');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE causa_merma AS ENUM
    ('sobreproduccion', 'devolucion_linea', 'error_porcionado',
     'caducidad_proxima', 'defecto_calidad');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE rol_usuario AS ENUM ('chef', 'produccion', 'admin', 'calidad');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE accion_decision AS ENUM ('aprobada', 'modificada', 'descartada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- CATÁLOGOS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS area (
  id            SMALLINT PRIMARY KEY,
  nombre        TEXT NOT NULL UNIQUE,
  capacidad_kg  NUMERIC(6,2) NOT NULL DEFAULT 60 CHECK (capacidad_kg > 0)
);

COMMENT ON COLUMN area.capacidad_kg IS
  'Capacidad de reproceso por turno; alimenta el factor de carga del modelo.';

CREATE TABLE IF NOT EXISTS servicio (
  id      SMALLSERIAL PRIMARY KEY,
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

COMMENT ON COLUMN ingrediente.temp_max_c IS
  'Temperatura máxima admisible para conservar aptitud de reproceso.';

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
  aceptacion      NUMERIC(2,1) NOT NULL DEFAULT 3.5
                  CHECK (aceptacion BETWEEN 1 AND 5),
  pasos           JSONB NOT NULL DEFAULT '[]'::jsonb,
  activa          BOOLEAN NOT NULL DEFAULT TRUE
);

-- Relación N:M entre receta e ingrediente, con atributos propios.
CREATE TABLE IF NOT EXISTS receta_ingrediente (
  receta_id       SMALLINT NOT NULL REFERENCES receta(id) ON DELETE CASCADE,
  ingrediente_id  SMALLINT NOT NULL REFERENCES ingrediente(id) ON DELETE RESTRICT,
  cantidad        NUMERIC(7,3) NOT NULL CHECK (cantidad > 0),
  es_principal    BOOLEAN NOT NULL DEFAULT FALSE,
  admite_estado   admite_estado NOT NULL DEFAULT 'ambos',
  PRIMARY KEY (receta_id, ingrediente_id)
);

COMMENT ON COLUMN receta_ingrediente.es_principal IS
  'Un ingrediente principal no admite sustitución; pesa el doble en la cobertura.';

-- ---------------------------------------------------------------------
-- OPERACIÓN
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS merma (
  id               BIGSERIAL PRIMARY KEY,
  codigo           TEXT NOT NULL UNIQUE,
  ingrediente_id   SMALLINT NOT NULL REFERENCES ingrediente(id) ON DELETE RESTRICT,
  area_id          SMALLINT NOT NULL REFERENCES area(id) ON DELETE RESTRICT,
  servicio         TEXT NOT NULL,
  cantidad         NUMERIC(8,2) NOT NULL CHECK (cantidad > 0),
  estado_producto  estado_producto NOT NULL,
  temperatura_c    NUMERIC(4,1) NOT NULL,
  causa            causa_merma NOT NULL,
  apto_reproceso   BOOLEAN NOT NULL DEFAULT TRUE,
  registrado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  vence_en         TIMESTAMPTZ NOT NULL,
  -- Un lote no puede vencer antes de registrarse.
  CONSTRAINT vida_util_coherente CHECK (vence_en > registrado_en)
);

COMMENT ON COLUMN merma.apto_reproceso IS
  'Dictamen sanitario. Restricción dura: sin él, ninguna alternativa es viable.';

-- Traza de lo que el modelo propuso, incluidos los casos sin propuesta.
CREATE TABLE IF NOT EXISTS traza (
  id              BIGSERIAL PRIMARY KEY,
  merma_id        BIGINT NOT NULL REFERENCES merma(id) ON DELETE CASCADE,
  generada_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  version_modelo  TEXT NOT NULL,
  propuestas      JSONB NOT NULL DEFAULT '[]'::jsonb,
  descartes       SMALLINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS decision (
  id           UUID PRIMARY KEY,
  merma_id     BIGINT NOT NULL REFERENCES merma(id) ON DELETE CASCADE,
  receta_id    SMALLINT NOT NULL REFERENCES receta(id) ON DELETE RESTRICT,
  rol          rol_usuario NOT NULL,
  usuario      TEXT NOT NULL,
  accion       accion_decision NOT NULL,
  motivo       TEXT,
  decidida_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Un lote recibe una sola decisión: es lo que lo saca de pendientes.
  CONSTRAINT una_decision_por_lote UNIQUE (merma_id)
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
CREATE INDEX IF NOT EXISTS idx_traza_merma      ON traza (merma_id);

-- ---------------------------------------------------------------------
-- VISTAS
-- Encapsulan los cruces recurrentes para que la aplicación no repita
-- la misma consulta en varios sitios.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW v_lote_completo AS
SELECT
  m.id, m.codigo, m.ingrediente_id, m.area_id, m.servicio, m.cantidad,
  m.estado_producto, m.temperatura_c, m.causa, m.apto_reproceso,
  m.registrado_en, m.vence_en,
  i.nombre AS ingrediente, i.unidad, i.costo_unitario,
  a.nombre AS area,
  ROUND(m.cantidad * i.costo_unitario, 2) AS valor,
  EXTRACT(EPOCH FROM (m.vence_en - now())) / 3600 AS horas_restantes,
  (d.id IS NOT NULL) AS decidido
FROM merma m
JOIN ingrediente i ON i.id = m.ingrediente_id
JOIN area a        ON a.id = m.area_id
LEFT JOIN decision d ON d.merma_id = m.id;

CREATE OR REPLACE VIEW v_merma_por_causa AS
SELECT m.causa::TEXT AS causa,
       ROUND(SUM(m.cantidad), 1) AS kg,
       COUNT(*) AS lotes
FROM merma m
GROUP BY m.causa
ORDER BY kg DESC;

CREATE OR REPLACE VIEW v_merma_por_area AS
SELECT a.nombre AS area,
       a.capacidad_kg,
       ROUND(COALESCE(SUM(m.cantidad), 0), 1) AS kg
FROM area a
LEFT JOIN merma m ON m.area_id = a.id
GROUP BY a.id, a.nombre, a.capacidad_kg
ORDER BY kg DESC;

-- Serie diaria: registrado frente a lo efectivamente aprovechado.
CREATE OR REPLACE VIEW v_merma_por_dia AS
SELECT
  d.dia::DATE AS fecha,
  ROUND(COALESCE(SUM(m.cantidad), 0), 1) AS registrada,
  ROUND(COALESCE(SUM(m.cantidad) FILTER (WHERE de.accion = 'aprobada'), 0), 1)
    AS aprovechada
FROM generate_series(
       (now() - INTERVAL '6 days')::DATE, now()::DATE, INTERVAL '1 day') AS d(dia)
LEFT JOIN merma m     ON m.registrado_en::DATE = d.dia::DATE
LEFT JOIN decision de ON de.merma_id = m.id
GROUP BY d.dia
ORDER BY d.dia;
