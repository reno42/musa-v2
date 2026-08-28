-- ═══════════════════════════════════════════════════════════════
-- FUTURARIA v34 — Content Calendar: the exact frame (REQ-023)
--
-- A grid lives in ONE design file with several frames side by side.
-- template_id alone says which FILE; frame_id says which frame inside
-- that file is THIS piece's exact design. Without it, a six-frame
-- grid exports as "the file" and nobody can tell which art goes with
-- which post — which is the whole point of a client-facing grid.
--
-- frame_id is the id of an element of templates.frames (stored as JSON
-- inside the template's data), so there is no table to reference —
-- integrity is "does the frame still exist in the file", the same
-- looseness the editor itself already has when frames are deleted.
--
-- Safe to re-run.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE content_calendar
  ADD COLUMN IF NOT EXISTS frame_id TEXT;

COMMENT ON COLUMN content_calendar.frame_id IS
  'Exact frame inside the template_id file (frames[].id in the template data). NULL = not pinned to one design yet. Cleared when template_id changes or the file is deleted.';

-- Partial index: most rows in an organic-heavy workspace have no frame,
-- and NULLs would only bloat it.
CREATE INDEX IF NOT EXISTS idx_cc_frame
  ON content_calendar(frame_id) WHERE frame_id IS NOT NULL;
