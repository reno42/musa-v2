-- ═══════════════════════════════════════════════════════════════
-- supabase_migrations_v29.sql — harness_entries: widen entry_type
-- CHECK (Futuraria Design, agosto 2026)
-- ═══════════════════════════════════════════════════════════════
--
-- WHAT: the chat runtime (ChatFAB) emits two telemetry entry types the
--   original CHECK rejected:
--     - diagnostic     (400-error captures, prompt snapshots, compaction
--                       audit — 8 call sites)
--     - subagent_trace (per-round implementer/reviewer trace — 2 call sites)
--   Every one of those inserts failed with
--   `violates check constraint "harness_entries_entry_type_check"`,
--   spamming the browser console and dropping rows from the governance
--   panel.
--
-- DEFENSIVE LAYER: netlify/functions/mcp.mjs (harness_log_entry) already
--   normalizes unknown types and retries extended types as "progress"
--   (with a "[<type>]" content prefix), so NOTHING breaks before or after
--   this migration — v29 just restores the true entry_type values in the
--   governance panel.
--
-- Idempotent: safe to re-run. After applying on production, update
--   .migration-version to v29 (scripts/check-migrations.mjs warns until
--   then; code keeps working either way).
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE harness_entries
  DROP CONSTRAINT IF EXISTS harness_entries_entry_type_check;

ALTER TABLE harness_entries
  ADD CONSTRAINT harness_entries_entry_type_check CHECK (entry_type IN
    ('plan','progress','blocker','review','verdict','summary','exploration',
     'context_dump','diagnostic','subagent_trace'));

COMMENT ON CONSTRAINT harness_entries_entry_type_check ON harness_entries IS
  'v29: adds diagnostic + subagent_trace emitted by the ChatFAB agent runtime (pre-v29 DBs get these retried as progress by mcp.mjs).';
