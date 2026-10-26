-- ═══════════════════════════════════════════════════════════════
-- FUTURARIA v78 — Research module (REQ-051)
--
-- Ingesta de noticias/blogs (RSS y Nitter) como tarjetas dentro de
-- Copywriting, y el encargo «un click» que la IA del usuario conectada
-- al harness MCP atiende: research_ai_tasks descubre el briefing y
-- research_ai_complete lo entrega (mismo contrato D1 de REQ-042 —
-- la IA trabaja con SU suscripción; el server no llama proveedores).
--
-- Tres tablas, una por concepto:
--   research_sources   — de dónde se lee (feed RSS o instancia Nitter)
--   research_items     — cada noticia/tweet traído, dedupe por link_hash
--   research_requests  — el encargo: item × redes × formatos × diseños
--
-- El CRUD es idéntico para humanos (REST, pane «Research») y AIs
-- (tools research_*), como copy_recipes en v32.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS research_sources (
  id            TEXT PRIMARY KEY DEFAULT ('rsx_' || substr(md5(random()::text), 1, 16)),
  workspace_id  TEXT NOT NULL,

  name          TEXT NOT NULL,
  -- Feed URL: RSS directo, o la URL RSS de una instancia de Nitter
  -- (el flujo del engine ya normaliza ambas; aquí vive la URL final).
  url           TEXT NOT NULL CHECK (url LIKE 'https://%'),
  type          TEXT NOT NULL DEFAULT 'rss' CHECK (type IN ('rss', 'nitter')),

  -- Alcance editorial opcional: keywords en minúsculas, substring match
  -- sobre title+summary. include vacío = entra todo; exclude siempre filtra.
  include_keywords TEXT[] NOT NULL DEFAULT '{}',
  exclude_keywords TEXT[] NOT NULL DEFAULT '{}',

  -- Marca sugerida para los encargos creados desde esta fuente (opcional;
  -- debe ser una marca del workspace — lo valida la API, como en v44).
  brand_id      TEXT,

  -- Frecuencia del barrido del cron (minutos). Mínimo 30: freemium, un
  -- feed no necesita más.
  refresh_minutes INTEGER NOT NULL DEFAULT 60 CHECK (refresh_minutes >= 30 AND refresh_minutes <= 1440),
  active        BOOLEAN NOT NULL DEFAULT TRUE,

  -- Diagnóstico de la última corrida del sweep (o del refresh manual).
  last_fetched_at TIMESTAMPTZ,
  last_status   TEXT CHECK (last_status IN ('ok', 'error')),
  last_error    TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN research_sources.include_keywords IS
  'Lowercase substrings; an item passes if ANY matches (empty = pass all).';
COMMENT ON COLUMN research_sources.exclude_keywords IS
  'Lowercase substrings; an item is dropped if ANY matches. Applied after include.';

CREATE INDEX IF NOT EXISTS idx_rsx_workspace ON research_sources(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rsx_due ON research_sources(active)
  INCLUDE (id, workspace_id, url, type, name, include_keywords, exclude_keywords, brand_id, last_fetched_at, last_status, last_error)
  WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS research_items (
  id            TEXT PRIMARY KEY DEFAULT ('rin_' || substr(md5(random()::text), 1, 16)),
  workspace_id  TEXT NOT NULL,
  source_id     TEXT NOT NULL REFERENCES research_sources(id) ON DELETE CASCADE,

  title         TEXT NOT NULL,
  summary       TEXT,
  link          TEXT NOT NULL,
  -- Dedupe por workspace: el mismo link que llega por dos fuentes (o dos
  -- corridas) es UNA tarjeta. sha256 hex del link normalizado.
  link_hash     TEXT NOT NULL,
  image_url     TEXT,
  author        TEXT,
  source_name   TEXT,
  published_at  TIMESTAMPTZ,

  -- new: sin atender; used: ya generó contenido; dismissed: descartado.
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'used', 'dismissed')),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT research_items_link_unique UNIQUE (workspace_id, link_hash)
);

CREATE INDEX IF NOT EXISTS idx_rin_workspace_created ON research_items(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rin_workspace_status ON research_items(workspace_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS research_requests (
  id            TEXT PRIMARY KEY DEFAULT ('rrq_' || substr(md5(random()::text), 1, 16)),
  workspace_id  TEXT NOT NULL,
  item_id       TEXT NOT NULL REFERENCES research_items(id) ON DELETE CASCADE,

  -- Qué producir: redes × formatos. Los ids son las constantes compartidas
  -- de shared/researchNetworks.ts (linkedin|x|instagram|facebook|tiktok /
  -- post|carrusel|story); el CHECK solo frena basura obvia.
  networks      TEXT[] NOT NULL CHECK (array_length(networks, 1) >= 1),
  formats       TEXT[] NOT NULL CHECK (array_length(formats, 1) >= 1),
  include_design BOOLEAN NOT NULL DEFAULT FALSE,

  brand_id      TEXT,
  notes         TEXT,
  -- Fecha sugerida de la primera pieza (YYYY-MM-DD); vacío = hoy.
  scheduled_date TEXT,

  -- pending: esperando a la IA; done: entregó; error: falló/expiró.
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'error')),

  -- El briefing RESUELTO (artículo adjunto + instrucciones + contrato de
  -- entrega): la bandeja lo lista sin re-leer nada, como flow_ai_tasks.
  briefing      TEXT NOT NULL,
  -- Capability de entrega: solo quien lo tiene puede completar el encargo.
  resume_token  TEXT NOT NULL UNIQUE,
  expires_at    TIMESTAMPTZ NOT NULL,

  result        JSONB,
  error         TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rrq_workspace_pending ON research_requests(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rrq_item ON research_requests(item_id, created_at DESC);

-- ── RLS: mismo contrato de tenancy que copy_recipes (v32) ──────────────

ALTER TABLE research_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "research_sources_read" ON research_sources;
CREATE POLICY "research_sources_read" ON research_sources
  FOR SELECT USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "research_sources_write" ON research_sources;
CREATE POLICY "research_sources_write" ON research_sources
  FOR ALL USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));

ALTER TABLE research_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "research_items_read" ON research_items;
CREATE POLICY "research_items_read" ON research_items
  FOR SELECT USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "research_items_write" ON research_items;
CREATE POLICY "research_items_write" ON research_items
  FOR ALL USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));

ALTER TABLE research_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "research_requests_read" ON research_requests;
CREATE POLICY "research_requests_read" ON research_requests
  FOR SELECT USING (has_workspace_role(workspace_id, 'viewer'));
DROP POLICY IF EXISTS "research_requests_write" ON research_requests;
CREATE POLICY "research_requests_write" ON research_requests
  FOR ALL USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));
