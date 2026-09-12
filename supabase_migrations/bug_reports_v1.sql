-- ═══════════════════════════════════════════════════════════════
-- Bug Reports v1 — flujo de reportes con ESTADO (report_bug MCP-first)
-- ───────────────────────────────────────────────────────────────
-- La tabla bug_reports existía (reportes del botón flotante: description,
-- url, device_info, console_errors, screenshot_url). Esta migración la
-- eleva a sistema de reportes con ciclo de vida para humanos Y agentes:
--
--   status         nuevo → en_progreso → corregido | descartado (reabrir = volver a en_progreso/nuevo)
--   reporter_kind  'humano' (botón flotante) | 'ia' (tool report_bug) —
--                  los reportes de IA traen pasos exactos y hints de código.
--   severity       baja | media | alta | critica
--   workspace_id   para reportes hechos desde un workspace (RLS/tenancy)
--   steps          pasos numerados para replicar (IA)
--   code_hints     archivos/símbolos/hipótesis técnicas (IA)
--   fix_notes      nota de la corrección (se muestra junto al estado)
--
-- Idempotente: seguro de ejecutarlo dos veces.
-- ═══════════════════════════════════════════════════════════════

alter table public.bug_reports
  add column if not exists status text not null default 'nuevo';

alter table public.bug_reports
  add column if not exists severity text default 'media';

alter table public.bug_reports
  add column if not exists workspace_id uuid references public.workspaces(id) on delete set null;

alter table public.bug_reports
  add column if not exists reporter_kind text not null default 'humano';

alter table public.bug_reports
  add column if not exists steps text;

alter table public.bug_reports
  add column if not exists code_hints text;

alter table public.bug_reports
  add column if not exists fix_notes text;

alter table public.bug_reports
  add column if not exists updated_at timestamptz default now();

-- Los reportes ya resueltos antes de la migración heredan su estado.
update public.bug_reports
  set status = 'corregido'
  where resolved_at is not null and status = 'nuevo';

create index if not exists idx_bug_reports_status on public.bug_reports (status);
create index if not exists idx_bug_reports_workspace on public.bug_reports (workspace_id);
