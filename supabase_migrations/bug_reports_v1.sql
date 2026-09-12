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

-- workspace_id — v2 del archivo: en esta base la columna YA existía como text
-- (instalación vieja del botón flotante), así que "add column if not exists"
-- la saltaba en silencio y la FK reventaba con 42804 (uuid vs text). Este
-- bloque DO maneja los tres estados de forma idempotente:
--   a) no existe        → se crea uuid
--   b) existe como text → se convierte a uuid (ids no-uuid pasan a null)
--   c) ya es uuid       → no se toca
-- Reportes cuyo workspace_id no exista en workspaces también pasan a null
-- para que la FK nunca falle.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bug_reports' and column_name = 'workspace_id'
  ) then
    alter table public.bug_reports add column workspace_id uuid;
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bug_reports'
      and column_name = 'workspace_id' and data_type = 'text'
  ) then
    update public.bug_reports
      set workspace_id = null
      where workspace_id is not null
        and workspace_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    alter table public.bug_reports
      alter column workspace_id type uuid using workspace_id::uuid;
  end if;

  update public.bug_reports b
    set workspace_id = null
    where b.workspace_id is not null
      and not exists (select 1 from public.workspaces w where w.id = b.workspace_id);
end $$;

alter table public.bug_reports
  drop constraint if exists bug_reports_workspace_id_fkey;
alter table public.bug_reports
  add constraint bug_reports_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces(id) on delete set null;

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
