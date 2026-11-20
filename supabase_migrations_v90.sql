-- REQ-083 — eventos presenciales e híbridos (fix del CHECK reportado por Instinct).
-- La tabla workspace_events fue creada con platform CHECK ('meet','zoom') antes de que el
-- formulario ofreciera Presencial/Híbrido: la UI mostraba la opción y la BD la rechazaba (400).
-- Idempotente: el DROP usa el nombre del constraint; si ya se corrió, el DO block lo salta.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workspace_events_platform_check'
      AND conrelid = 'public.workspace_events'::regclass
  ) THEN
    ALTER TABLE public.workspace_events
      DROP CONSTRAINT workspace_events_platform_check;
  END IF;
END $$;

ALTER TABLE public.workspace_events
  ADD CONSTRAINT workspace_events_platform_check
  CHECK (platform IN ('meet', 'zoom', 'presencial', 'hibrido'));
