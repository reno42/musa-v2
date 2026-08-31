-- Futuraria Design v41 — per-user, per-file preview reminder snoozes.
-- Idempotent: safe to run after applying the SQL manually.

ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS content_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS preview_reminder_preferences (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  snoozed_until TIMESTAMPTZ NOT NULL,
  snooze_days INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, template_id)
);

ALTER TABLE preview_reminder_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their preview reminders" ON preview_reminder_preferences;
CREATE POLICY "Users manage their preview reminders"
ON preview_reminder_preferences
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
