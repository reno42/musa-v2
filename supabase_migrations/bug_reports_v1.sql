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

-- workspace_id — v3: NO se asume el tipo de workspaces.id (en esta base es
-- text con ids con prefijo; en instalaciones standard de Supabase es uuid).
-- El tipo se lee EN VIVO de information_schema y la columna se crea o
-- convierte a ese tipo exacto. Idempotente, cubre los tres estados:
--   a) no existe                    → se crea con el tipo de workspaces.id
--   b) existe con otro tipo         → se convierte (valores no convertibles → null)
--   c) ya tiene el tipo correcto    → no se toca
-- Además, reportes cuyo workspace_id no exista en workspaces pasan a null
-- para que la FK nunca falle.
do $$
declare
  v_target text; -- data_type exacto de workspaces.id en ESTA base
begin
  select c.data_type into v_target
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'workspaces' and c.column_name = 'id'
   limit 1;
  if v_target is null then
    raise exception 'bug_reports_v1: no se encontro public.workspaces.id';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bug_reports' and column_name = 'workspace_id'
  ) then
    execute format('alter table public.bug_reports add column workspace_id %s', v_target);
  elsif exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bug_reports'
      and column_name = 'workspace_id' and data_type is distinct from v_target
  ) then
    -- pre-limpieza solo si el destino es uuid (text→uuid es exigente con el formato)
    if v_target = 'uuid' then
      update public.bug_reports
        set workspace_id = null
        where workspace_id is not null
          and workspace_id::text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    end if;
    execute format(
      'alter table public.bug_reports alter column workspace_id type %s using workspace_id::text::%s',
      v_target, v_target
    );
  end if;

  -- huerfanos: si el workspace ya no existe, el reporte queda sin workspace
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
