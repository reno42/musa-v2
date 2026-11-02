-- Páginas públicas con enlace propio: formularios (/f), brief para el cliente (/b) y portal de cotizaciones (/q). Idempotente.
-- El token es aleatorio (no adivinable) y distinto del id interno.
begin;
alter table public.workspace_forms add column if not exists public_token uuid not null default gen_random_uuid();
create unique index if not exists workspace_forms_public_token_key on public.workspace_forms (public_token);

alter table public.briefs add column if not exists public_token uuid not null default gen_random_uuid();
create unique index if not exists briefs_public_token_key on public.briefs (public_token);

alter table public.crm_quotes
  add column if not exists public_token uuid not null default gen_random_uuid(),
  add column if not exists signed_by_name text,
  add column if not exists client_comment text,
  add column if not exists decided_at timestamptz;
create unique index if not exists crm_quotes_public_token_key on public.crm_quotes (public_token);

alter table public.workspace_form_responses
  add column if not exists contact_id uuid references public.crm_contacts(id) on delete set null;
create index if not exists idx_form_responses_form on public.workspace_form_responses (form_id, created_at desc);

-- registro de envíos: también enlaces mandados por correo
alter table public.workspace_email_sends drop constraint if exists workspace_email_sends_kind_check;
alter table public.workspace_email_sends add constraint workspace_email_sends_kind_check check (kind in ('campana','secuencia','evento','prueba','formulario','enlace'));
commit;
