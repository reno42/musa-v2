-- ═══════════════════════════════════════════════════════════════
-- v53 — Video Mode v2: direct browser → Supabase uploads (design-reels)
-- ═══════════════════════════════════════════════════════════════
-- REQ-VID v2: rendered reels (POST /video shim) already land in the public
-- design-reels bucket, but the 120MB base64-JSON ceiling of the worker shim
-- is the practical limit. This migration lets the BROWSER upload directly
-- with the user's JWT (reelUpload.ts path 1), keeping the worker shim as
-- fallback for environments without these policies.
--
-- Conventions reused:
--   • has_workspace_role(workspace, minimum_role) — SECURITY DEFINER (v9),
--     EXECUTE already granted to authenticated.
--   • (storage.foldername(name))[1] is ALWAYS the workspace id — writing
--     into another workspace's folder fails the role check by construction.
--
-- Idempotent: safe to re-run (DROP POLICY IF EXISTS + CREATE POLICY,
-- INSERT .. ON CONFLICT for the bucket).
-- ═══════════════════════════════════════════════════════════════

-- ── Bucket: public (stable mediaUrl for Zernio publish_content), 200MB cap ──
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('design-reels', 'design-reels', TRUE, 209715200)
ON CONFLICT (id) DO UPDATE SET
  public = TRUE,
  file_size_limit = EXCLUDED.file_size_limit;

-- Public buckets serve /object/public/ URLs without policies; these policies
-- govern DIRECT authenticated writes from the browser (the upload path).

DROP POLICY IF EXISTS "design_reels_workspace_insert" ON storage.objects;
CREATE POLICY "design_reels_workspace_insert" ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'design-reels'
  AND has_workspace_role((storage.foldername(name))[1], 'editor')
);

DROP POLICY IF EXISTS "design_reels_workspace_update" ON storage.objects;
CREATE POLICY "design_reels_workspace_update" ON storage.objects FOR UPDATE
USING (
  bucket_id = 'design-reels'
  AND has_workspace_role((storage.foldername(name))[1], 'editor')
)
WITH CHECK (
  bucket_id = 'design-reels'
  AND has_workspace_role((storage.foldername(name))[1], 'editor')
);

DROP POLICY IF EXISTS "design_reels_workspace_delete" ON storage.objects;
CREATE POLICY "design_reels_workspace_delete" ON storage.objects FOR DELETE
USING (
  bucket_id = 'design-reels'
  AND has_workspace_role((storage.foldername(name))[1], 'editor')
);
