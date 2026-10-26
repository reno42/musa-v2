-- ============================================================
-- MIGRACIÓN v85 — REQ-060 (merge de archivos) + REQ-061 (taxonomía)
-- Fecha: 2026-10-26
-- Ejecutar en Supabase SQL Editor (convención del repo: migración manual).
-- Idempotente: segura de re-ejecutar.
--
-- REQ-061 Fase 1:
--   * design_categories: categorías propias por workspace (antes: enum
--     hardcodeado de 4 valores). Siembra perezosa la hace la API al primer
--     listado — aquí NO se insertan las 4 históricas para no tocar datos.
--   * índice compuesto para resolución/facetas de categoría.
-- REQ-061 Fase 2 (en alcance):
--   * design_tags: registro de tags con jerarquía (path dotted), color,
--     permiso público/internal, provenance (user | ai:<model>) y scope
--     global (workspace_id NULL).
--   * design_tag_aliases: alias → canónico, normalizados al escribir.
-- REQ-060: sin tablas nuevas (merge opera sobre templates.data JSONB);
--   el snapshot pre-merge reusa el servicio de versiones existente.
-- ============================================================

-- ── Categorías de diseño por workspace ──────────────────────
CREATE TABLE IF NOT EXISTS design_categories (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  color        TEXT,                            -- hex para chips/grafo (Fase 2)
  scope        TEXT NOT NULL DEFAULT 'workspace', -- 'workspace' | 'global' (Fase 2)
  created_by   TEXT NOT NULL DEFAULT 'user',    -- 'user' | 'ai:<model>'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_design_categories_ws ON design_categories(workspace_id);

-- Facetas y resolución de categoría en design_file_meta (ya tenía idx_dfm_
-- sobre brand/tags/workspace/format desde v4; falta el par workspace+category).
CREATE INDEX IF NOT EXISTS idx_dfm_ws_category ON design_file_meta(workspace_id, category);

-- ── Registro de tags (enriquecimiento opt-in del array existente) ─────
-- La membresía archivo↔tag sigue viviendo en design_file_meta.tags TEXT[];
-- esta tabla solo agrega metadata: jerarquía, color, permiso, provenance.
-- workspace_id NULL = tag global de la cuenta (alcance multi-workspace).
CREATE TABLE IF NOT EXISTS design_tags (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE, -- NULL = global
  name         TEXT NOT NULL,
  parent_name  TEXT,                            -- path dotted: 'redes', 'redes.instagram'
  color        TEXT,
  is_internal  BOOLEAN NOT NULL DEFAULT false,  -- true = fuera de superficies públicas
  created_by   TEXT NOT NULL DEFAULT 'user',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- UNIQUE(workspace_id, name) con NULL no agrupa NULLs en Postgres; el índice
-- funcional con COALESCE trata los globals como un solo "workspace".
CREATE UNIQUE INDEX IF NOT EXISTS uq_design_tags_ws_name
  ON design_tags (COALESCE(workspace_id, '__global__'), name);

CREATE INDEX IF NOT EXISTS idx_design_tags_ws ON design_tags(workspace_id);

-- ── Aliases de tags (alias → canónico) ──────────────────────
-- canonical referencia el ID (estable ante renombres), no el name.
CREATE TABLE IF NOT EXISTS design_tag_aliases (
  workspace_id TEXT NOT NULL,
  alias        TEXT NOT NULL,
  canonical_id TEXT NOT NULL REFERENCES design_tags(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, alias)
);

-- ── Notas de operación ──────────────────────────────────────
-- * La API resuelve design_file_meta.category contra design_categories y
--   crea la fila si es nueva (patrón idéntico a brand). Las 4 categorías
--   históricas (Design System, Plantillas, Assets, Archivos) se siembran
--   perezosamente por workspace al primer listado — ningún dato migra.
-- * El normalizador de tags (shared/tagNormalize.ts) consulta
--   design_tag_aliases antes de persistir, tanto en la REST como en MCP.
-- * Rollback: DROP TABLE design_tag_aliases, design_tags, design_categories;
--   DROP INDEX idx_dfm_ws_category;
