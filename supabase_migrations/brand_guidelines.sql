-- ═══════════════════════════════════════════════════════════════
-- Futuraria Style Library — brand_guidelines table
-- Backs StyleLibraryPanel (create_brand_guideline, list_brand_guidelines,
-- get_brand_guideline, update_brand_guideline, delete_brand_guideline,
-- and the "📸 Capturar estilo" publish flow in generate_design_artifacts).
--
-- This table was referenced throughout the codebase (api/src/services/
-- brands.ts, netlify/functions/mcp.mjs) but never had a migration —
-- without it, every save falls through to an in-memory fallback that does
-- not survive past the current serverless invocation, so "style saved"
-- toasts appear but nothing is ever there to load back.
-- Ejecutar en Supabase SQL Editor (idempotent).
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS brand_guidelines (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  -- Everything else (description, tokensJson, designMd, sharedCss,
  -- sourceHash, styleFingerprint, sourceTemplateIds, ...) lives in `data`
  -- as JSONB — matches api/src/services/brands.ts's rowToBrand(), which
  -- spreads `data` and overlays id/workspace_id/name/created_at/updated_at.
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bg_workspace ON brand_guidelines(workspace_id);
CREATE INDEX IF NOT EXISTS idx_bg_updated   ON brand_guidelines(updated_at DESC);

-- ============================================================
-- ROW LEVEL SECURITY — same convention as design_kanban_tasks:
-- anyone can read (the Style Library UI needs this), only
-- authenticated users can write. The MCP server itself writes via
-- SECRET_KEY (service role), which bypasses RLS entirely.
-- ============================================================
ALTER TABLE brand_guidelines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read brand guidelines" ON brand_guidelines;
CREATE POLICY "Anyone can read brand guidelines" ON brand_guidelines
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Authenticated can insert brand guidelines" ON brand_guidelines;
CREATE POLICY "Authenticated can insert brand guidelines" ON brand_guidelines
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated can update brand guidelines" ON brand_guidelines;
CREATE POLICY "Authenticated can update brand guidelines" ON brand_guidelines
  FOR UPDATE USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated can delete brand guidelines" ON brand_guidelines;
CREATE POLICY "Authenticated can delete brand guidelines" ON brand_guidelines
  FOR DELETE USING (auth.role() = 'authenticated');

-- ============================================================
-- TRIGGER: auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_bg_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bg_updated_at ON brand_guidelines;
CREATE TRIGGER trg_bg_updated_at
  BEFORE UPDATE ON brand_guidelines
  FOR EACH ROW EXECUTE FUNCTION update_bg_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- END — brand_guidelines schema ready.
-- ═══════════════════════════════════════════════════════════════
