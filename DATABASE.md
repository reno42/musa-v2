create table public.api_keys (
  id text not null,
  user_id uuid null,
  name text not null default 'Default Key'::text,
  key_hash text not null,
  key_prefix text not null,
  permissions text[] null default '{templates:read,templates:write,render,webhooks}'::text[],
  last_used_at timestamp with time zone null,
  expires_at timestamp with time zone null,
  active boolean null default true,
  created_at timestamp with time zone null default now(),
  constraint api_keys_pkey primary key (id),
  constraint api_keys_user_id_fkey foreign KEY (user_id) references auth.users (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_api_keys_user on public.api_keys using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_api_keys_hash on public.api_keys using btree (key_hash) TABLESPACE pg_default;

create table public.render_logs (
  id text not null,
  template_id text null,
  status text not null default 'pending'::text,
  format text not null default 'png'::text,
  url text null,
  error text null,
  metadata jsonb null default '{}'::jsonb,
  created_at timestamp with time zone null default now(),
  completed_at timestamp with time zone null,
  constraint render_logs_pkey primary key (id),
  constraint render_logs_template_id_fkey foreign KEY (template_id) references templates (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_render_logs_template on public.render_logs using btree (template_id) TABLESPACE pg_default;

create index IF not exists idx_render_logs_status on public.render_logs using btree (status) TABLESPACE pg_default;

create table public.templates (
  id text not null,
  name text not null,
  data jsonb not null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  user_id uuid null,
  constraint templates_pkey primary key (id),
  constraint templates_user_id_fkey foreign KEY (user_id) references auth.users (id)
) TABLESPACE pg_default;

create index IF not exists idx_templates_created on public.templates using btree (created_at desc) TABLESPACE pg_default;

create table public.webhooks (
  id text not null,
  url text not null,
  events text[] not null,
  secret text null,
  active boolean null default true,
  created_at timestamp with time zone null default now(),
  user_id uuid null,
  constraint webhooks_pkey primary key (id),
  constraint webhooks_user_id_fkey foreign KEY (user_id) references auth.users (id)
) TABLESPACE pg_default;