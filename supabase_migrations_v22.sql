-- ═══════════════════════════════════════════════════════════════
-- FUTURARIA v22 — Content Calendar
--
-- One row per piece of content: what goes out, when, on which channels,
-- and whether it is paid or organic. The section formerly called "Textos"
-- is built on this.
--
-- Shape follows the agency reports Renzo shared (IPG / Santander): the
-- dimensions a media plan is actually organised by are campaign → ad set →
-- ad, and paid and organic share every one of them except spend. So this
-- keeps ONE table with `kind` telling them apart, rather than two tables
-- that would have to be joined back together for every calendar view.
--
-- campaign and ad_set are both nullable, on purpose. A post with neither is
-- still a post. See the graph, which draws a campaign node only when there
-- is a campaign — the shape of the data is what tells the user there is
-- something worth organising.
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS content_calendar (
  id            TEXT PRIMARY KEY DEFAULT ('cc_' || substr(md5(random()::text), 1, 16)),
  workspace_id  TEXT NOT NULL,

  -- When it goes out. Time is optional: "el jueves" is a real answer.
  scheduled_date DATE NOT NULL,
  scheduled_time TIME,

  -- What it is.
  topic         TEXT,                       -- "tema"
  copy          TEXT,                       -- the caption itself
  kind          TEXT NOT NULL DEFAULT 'organic',   -- 'organic' | 'ad'
  channels      TEXT[] NOT NULL DEFAULT '{}',      -- instagram, facebook, tiktok…
  status        TEXT NOT NULL DEFAULT 'idea',      -- idea|diseño|aprobación|programado|publicado

  -- Where it sits in the media plan. Both optional.
  brand_id      TEXT REFERENCES brands(id) ON DELETE SET NULL,
  campaign      TEXT,
  ad_set        TEXT,                       -- "conjunto de anuncios"

  -- What it points at. A design file we own, an asset, or a plain link —
  -- whichever exists. template_id is the join to the graph and the kanban.
  template_id   TEXT REFERENCES templates(id) ON DELETE SET NULL,
  asset_id      TEXT,
  external_url  TEXT,

  -- Filled in after it goes live, so the calendar can show what happened.
  published_at  TIMESTAMPTZ,
  permalink     TEXT,                       -- the post's URL once published

  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN content_calendar.kind IS
  'organic | ad. Paid and organic share every dimension except spend, so they live in one table and this tells them apart.';
COMMENT ON COLUMN content_calendar.campaign IS
  'Optional. A post with no campaign is still a post; the UI must not invent one.';
COMMENT ON COLUMN content_calendar.ad_set IS
  'Optional, and not only for ads — an organic series is an ad set by another name.';

CREATE INDEX IF NOT EXISTS idx_cc_workspace_date ON content_calendar(workspace_id, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_cc_template       ON content_calendar(template_id);
CREATE INDEX IF NOT EXISTS idx_cc_brand          ON content_calendar(brand_id);
CREATE INDEX IF NOT EXISTS idx_cc_kind           ON content_calendar(workspace_id, kind);

ALTER TABLE content_calendar ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_calendar_read" ON content_calendar;
CREATE POLICY "content_calendar_read" ON content_calendar
  FOR SELECT USING (has_workspace_role(workspace_id, 'viewer'));

DROP POLICY IF EXISTS "content_calendar_write" ON content_calendar;
CREATE POLICY "content_calendar_write" ON content_calendar
  FOR ALL USING (has_workspace_role(workspace_id, 'editor'))
  WITH CHECK (has_workspace_role(workspace_id, 'editor'));
