-- ═══════════════════════════════════════════════════════════════
-- Futuraria Design — Design Comments (pins on canvas like Word)
-- Allows humans and AI to leave location-anchored comments on designs.
-- Comments sync to Kanban as actionable items with a source label.
--
-- PREREQUISITES: design_kanban.sql must exist (references design_kanban_tasks).
-- Run AFTER: harness.sql (shares account_id pattern).
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────
-- TABLE: design_comments
-- A comment pinned to a specific x/y location on a frame.
-- Visible on mobile, tablet, desktop, and to AI agents.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS design_comments (
  id            TEXT PRIMARY KEY DEFAULT ('comment_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16)),
  template_id   TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  frame_id      TEXT,
  workspace_id  TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
  account_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Pin location in frame coordinates (percentages 0-100 so they survive resize)
  x_pct         DOUBLE PRECISION DEFAULT 50,
  y_pct         DOUBLE PRECISION DEFAULT 50,

  -- Comment content
  body          TEXT NOT NULL,
  author_name   TEXT NOT NULL DEFAULT 'Anónimo',
  author_avatar TEXT,

  -- Lifecycle
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'resolved', 'archived')),

  -- SOURCE: where was this comment created?
  -- 'editor_pin'  = someone tapped on the canvas in the editor
  -- 'mobile_pin'  = someone tapped on mobile/tablet
  -- 'kanban'      = created directly in the Kanban
  -- 'ai_review'   = AI reviewer left it during harness review
  -- 'chat'        = AI leader created it from the chat
  source        TEXT NOT NULL DEFAULT 'editor_pin'
                CHECK (source IN ('editor_pin', 'mobile_pin', 'kanban', 'ai_review', 'chat')),

  -- If this comment auto-created a Kanban task, link it here
  kanban_task_id TEXT REFERENCES design_kanban_tasks(id) ON DELETE SET NULL,

  -- Threading: optional parent for replies
  parent_id     TEXT REFERENCES design_comments(id) ON DELETE CASCADE,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_dc_template  ON design_comments(template_id, frame_id);
CREATE INDEX IF NOT EXISTS idx_dc_workspace ON design_comments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_dc_account   ON design_comments(account_id);
CREATE INDEX IF NOT EXISTS idx_dc_status    ON design_comments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dc_source    ON design_comments(source);
CREATE INDEX IF NOT EXISTS idx_dc_parent    ON design_comments(parent_id);

-- ─────────────────────────────────────────────────────────────
-- RLS: account-scoped reads/writes, AI uses service role (bypasses)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE design_comments ENABLE ROW LEVEL SECURITY;

-- Users can read comments on templates they can see (simplified: any authenticated)
DROP POLICY IF EXISTS "Authenticated can read design_comments" ON design_comments;
CREATE POLICY "Authenticated can read design_comments" ON design_comments
  FOR SELECT USING (
    auth.role() = 'authenticated'
    OR account_id IS NULL
    OR account_id = auth.uid()
  );

-- Authenticated users can create comments
DROP POLICY IF EXISTS "Authenticated can insert design_comments" ON design_comments;
CREATE POLICY "Authenticated can insert design_comments" ON design_comments
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Users can update their own comments or resolve any on their account
DROP POLICY IF EXISTS "Authenticated can update design_comments" ON design_comments;
CREATE POLICY "Authenticated can update design_comments" ON design_comments
  FOR UPDATE USING (
    auth.role() = 'authenticated'
    AND (account_id IS NULL OR account_id = auth.uid())
  );

-- ─────────────────────────────────────────────────────────────
-- TRIGGER: auto-update updated_at
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_dc_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dc_updated_at ON design_comments;
CREATE TRIGGER trg_dc_updated_at
  BEFORE UPDATE ON design_comments
  FOR EACH ROW EXECUTE FUNCTION update_dc_updated_at();

-- ─────────────────────────────────────────────────────────────
-- REALTIME: broadcast comment changes to all devices
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'design_comments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.design_comments;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- DONE — design_comments table ready.
-- ═══════════════════════════════════════════════════════════════
