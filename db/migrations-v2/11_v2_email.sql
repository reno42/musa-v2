-- Correo real (Resend o Postmark, a elección de cada espacio) — Musa v2. Idempotente.
begin;

-- proveedor y remitente por espacio; la llave es BYOK del dueño de la configuración (user_api_keys: resend | postmark)
create table if not exists public.workspace_email_settings (
  workspace_id text primary key references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('resend','postmark')),
  from_email text not null check (from_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  from_name text,
  reply_to text,
  postmark_stream text not null default 'broadcast',
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.workspace_email_settings enable row level security;
drop policy if exists email_settings_read on public.workspace_email_settings;
drop policy if exists email_settings_write on public.workspace_email_settings;
create policy email_settings_read on public.workspace_email_settings for select to authenticated using (has_workspace_role(workspace_id, 'viewer'));
create policy email_settings_write on public.workspace_email_settings for all to authenticated using (has_workspace_role(workspace_id, 'admin')) with check (has_workspace_role(workspace_id, 'admin') and owner_user_id = auth.uid());
grant select, insert, update, delete on public.workspace_email_settings to authenticated;

-- bajas: cada contacto tiene su enlace para darse de baja
alter table public.crm_contacts
  add column if not exists email_opt_out boolean not null default false,
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();
create unique index if not exists crm_contacts_unsubscribe_token_key on public.crm_contacts (unsubscribe_token);

-- registro de envíos (campañas, secuencias, eventos y pruebas)
create table if not exists public.workspace_email_sends (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  mailing_id uuid references public.workspace_mailings(id) on delete set null,
  event_id uuid references public.workspace_events(id) on delete set null,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  to_email text not null,
  kind text not null default 'campana' check (kind in ('campana','secuencia','evento','prueba','formulario')),
  provider text not null,
  provider_id text,
  status text not null default 'enviado' check (status in ('enviado','programado','error')),
  error text,
  scheduled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_email_sends_ws on public.workspace_email_sends (workspace_id, created_at desc);
create index if not exists idx_email_sends_mailing on public.workspace_email_sends (mailing_id);
alter table public.workspace_email_sends enable row level security;
drop policy if exists email_sends_read on public.workspace_email_sends;
create policy email_sends_read on public.workspace_email_sends for select to authenticated using (has_workspace_role(workspace_id, 'viewer'));
grant select on public.workspace_email_sends to authenticated;
commit;
