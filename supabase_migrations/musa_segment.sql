-- ═══════════════════════════════════════════════════════════════
-- Calado / máscaras / selección — segment_jobs table
-- ═══════════════════════════════════════════════════════════════
-- Idempotent. Run in the Supabase SQL Editor BEFORE deploying the
-- segmentation code (netlify/functions/image-segment-background.mjs,
-- api/src/routes/segmentation.ts, mcp.mjs remove_background /
-- segment_click / segment_status), or those paths fail with
-- "relation segment_jobs does not exist".
--
-- Design: ONNX segmentation (u2netp / MobileSAM / CLIPSeg) runs in a
-- Netlify BACKGROUND function (15-min budget, native deps); the HTTP
-- entry points (REST + MCP) only create a job row, dispatch the
-- background function and poll this table. RLS is enabled with no
-- policies → service-role only, same posture as internal harness
-- tables. Zero LLM tokens anywhere in this pipeline.
CREATE TABLE IF NOT EXISTS segment_jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  kind TEXT NOT NULL,                -- remove_background | segment_click | segment_text
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','done','error')),
  input_url TEXT,
  params_json JSONB NOT NULL DEFAULT '{}',
  result_json JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Background-function sweep + status polling
CREATE INDEX IF NOT EXISTS idx_segment_jobs_status
  ON segment_jobs (status, created_at);

-- Idempotency lookups for remove_background derive-assets
-- (assets.tags ∋ ['cutout','src:<assetId>'])
CREATE INDEX IF NOT EXISTS idx_assets_tags_gin
  ON assets USING GIN (tags);

ALTER TABLE segment_jobs ENABLE ROW LEVEL SECURITY;

-- Weights bucket for the ONNX models (u2netp ~4.5MB, MobileSAM quant
-- ~25MB, CLIPSeg int8 ~85MB + CLIP BPE vocab/merges). Public read — these
-- are open-weights files, and public URLs let the background function
-- fetch them without signing. Populated by scripts/fetch-segment-models.mjs.
INSERT INTO storage.buckets (id, name, public)
VALUES ('ml-models', 'ml-models', true)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE segment_jobs IS
  'ONNX segmentation jobs (remove_background / segment_click / segment_text). Created by REST+MCP, processed by the image-segment-background Netlify function. Service-role only (RLS, no policies).';
