-- ============================================================
-- Design Harness: Supabase Table Migrations
-- Run in Supabase SQL Editor (one at a time or all together)
-- ============================================================

-- FASE 2: Recipes table
CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  workspace_id TEXT,
  structure JSONB NOT NULL DEFAULT '{}',
  template_html TEXT,
  template_css TEXT,
  preview_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- FASE 3: Batch jobs table
CREATE TABLE IF NOT EXISTS batch_jobs (
  id TEXT PRIMARY KEY,
  template_id TEXT,
  recipe_id TEXT,
  status TEXT DEFAULT 'queued',
  total_count INTEGER DEFAULT 0,
  completed_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  results JSONB DEFAULT '[]',
  errors JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- FASE 4: Section locks table (multi-agent)
CREATE TABLE IF NOT EXISTS section_locks (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  section_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  acquired_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(template_id, section_id)
);

-- FASE 5: Brands table (store brand configs)
CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  workspace_id TEXT,
  colors JSONB DEFAULT '[]',
  fonts JSONB DEFAULT '[]',
  logo JSONB,
  spacing JSONB,
  rules JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Realtime on all new tables (needed for Fase 4 multi-agent)
ALTER PUBLICATION supabase_realtime ADD TABLE recipes;
ALTER PUBLICATION supabase_realtime ADD TABLE batch_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE section_locks;
ALTER PUBLICATION supabase_realtime ADD TABLE brands;
