-- v17 — REQ-006 durable, append-only subagent runtime telemetry.
-- Safe to re-run. Runtime events intentionally exclude prompts, tool arguments,
-- HTML/CSS payloads, credentials, and other design content.

ALTER TABLE public.harness_sessions
  DROP CONSTRAINT IF EXISTS harness_sessions_status_check;
ALTER TABLE public.harness_sessions
  ADD CONSTRAINT harness_sessions_status_check
  CHECK (status IN ('active','paused','completed','blocked','failed','cancelled','timed_out'));

CREATE TABLE IF NOT EXISTS public.harness_runtime_events (
  id                text PRIMARY KEY,
  cursor            bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  client_event_id   text NOT NULL,
  account_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id        text NOT NULL REFERENCES public.harness_sessions(id) ON DELETE CASCADE,
  task_id           text REFERENCES public.design_kanban_tasks(id) ON DELETE CASCADE,
  role              text NOT NULL,
  event_type        text NOT NULL CHECK (event_type IN ('start','request','tool','retry','compaction','done','error','cancelled')),
  round             integer CHECK (round IS NULL OR round >= 0),
  max_rounds        integer CHECK (max_rounds IS NULL OR max_rounds > 0),
  attempt           integer CHECK (attempt IS NULL OR attempt > 0),
  provider          text,
  model             text,
  tool_name         text,
  call_id           text,
  elapsed_ms        integer CHECK (elapsed_ms IS NULL OR elapsed_ms >= 0),
  input_tokens      integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
  output_tokens     integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
  cumulative_tokens integer CHECK (cumulative_tokens IS NULL OR cumulative_tokens >= 0),
  token_count_kind  text CHECK (token_count_kind IS NULL OR token_count_kind IN ('actual','estimated')),
  context_chars     integer CHECK (context_chars IS NULL OR context_chars >= 0),
  template_ids      text[] NOT NULL DEFAULT '{}',
  error_message     text,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, client_event_id)
);

-- If an earlier local copy of v17 created cursor BY DEFAULT, harden it on re-run.
ALTER TABLE public.harness_runtime_events
  ALTER COLUMN cursor SET GENERATED ALWAYS;

CREATE INDEX IF NOT EXISTS idx_hre_session_cursor ON public.harness_runtime_events(session_id, cursor);
CREATE INDEX IF NOT EXISTS idx_hre_task_created ON public.harness_runtime_events(task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hre_account_created ON public.harness_runtime_events(account_id, created_at DESC);

ALTER TABLE public.harness_runtime_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.harness_runtime_event_owned(
  p_account_id uuid,
  p_session_id text,
  p_task_id text,
  p_role text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.harness_sessions AS hs
    JOIN public.design_kanban_tasks AS ht ON ht.id = hs.task_id
    WHERE hs.id = p_session_id
      AND hs.task_id = p_task_id
      AND hs.role = p_role
      AND hs.account_id = p_account_id
      AND ht.account_id = p_account_id
  );
$$;

REVOKE ALL ON FUNCTION public.harness_runtime_event_owned(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.harness_runtime_event_owned(uuid, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_harness_runtime_event_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.harness_runtime_event_owned(NEW.account_id, NEW.session_id, NEW.task_id, NEW.role) THEN
    RAISE EXCEPTION 'runtime event tenant/session/task ownership mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_harness_runtime_event_ownership() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_harness_runtime_event_ownership ON public.harness_runtime_events;
CREATE TRIGGER trg_harness_runtime_event_ownership
  BEFORE INSERT ON public.harness_runtime_events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_harness_runtime_event_ownership();

DROP POLICY IF EXISTS "read_own_runtime_events" ON public.harness_runtime_events;
CREATE POLICY "read_own_runtime_events" ON public.harness_runtime_events
  FOR SELECT USING (account_id = auth.uid());

DROP POLICY IF EXISTS "insert_own_runtime_events" ON public.harness_runtime_events;
CREATE POLICY "insert_own_runtime_events" ON public.harness_runtime_events
  FOR INSERT WITH CHECK (
    account_id = auth.uid()
    AND public.harness_runtime_event_owned(account_id, session_id, task_id, role)
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'harness_runtime_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.harness_runtime_events;
  END IF;
END $$;
