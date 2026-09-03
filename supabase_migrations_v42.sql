-- FUTURARIA v42 — Social publishing state for content_calendar.
-- Safe to re-run. Provider credentials are encrypted per workspace connection.

ALTER TABLE content_calendar
  ADD COLUMN IF NOT EXISTS publishing_status TEXT NOT NULL DEFAULT 'borrador',
  ADD COLUMN IF NOT EXISTS publishing_provider TEXT,
  ADD COLUMN IF NOT EXISTS publishing_connection_id UUID,
  ADD COLUMN IF NOT EXISTS publishing_channels TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS publishing_scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS publishing_timezone TEXT,
  ADD COLUMN IF NOT EXISTS publishing_external_id TEXT,
  ADD COLUMN IF NOT EXISTS publishing_request_id UUID,
  ADD COLUMN IF NOT EXISTS publishing_error TEXT,
  ADD COLUMN IF NOT EXISTS publishing_destinations JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS publishing_payload JSONB,
  ADD COLUMN IF NOT EXISTS publishing_retry_pending BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS publishing_event_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS publishing_platform_urls JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cc_publish_request
  ON content_calendar(publishing_provider, publishing_request_id)
  WHERE publishing_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cc_publish_status
  ON content_calendar(workspace_id, publishing_status);

CREATE INDEX IF NOT EXISTS idx_cc_publish_connection
  ON content_calendar(workspace_id, publishing_connection_id);

COMMENT ON COLUMN content_calendar.publishing_request_id IS
  'Stable idempotency key reused by safe retries and sent to the social provider.';

CREATE TABLE IF NOT EXISTS social_publish_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, event_id)
);

ALTER TABLE social_publish_events ENABLE ROW LEVEL SECURITY;
