-- Musa Publisher · fase 2-4 + modo agencia. Idempotente.
-- · publisher_accounts.brand_id: cada cuenta pertenece a una marca/cliente (null = de todo el espacio).
-- · publisher_oauth_apps.provider pasa a ser la «app» (meta sirve para Facebook e Instagram; google para
--   Google Business y Blogger). Se mantiene el nombre de la columna.
-- · publisher_oauth_states: enlaces de conexión para el cliente (válidos 7 días, un solo uso) y marca destino.
-- · publish_jobs: texto distinto por red (captions) e imagen liviana para redes con tope de 1 MB.
begin;

alter table public.publisher_accounts add column if not exists brand_id text references public.brands(id) on delete set null;
create index if not exists publisher_accounts_brand on public.publisher_accounts (workspace_id, brand_id);

alter table public.publisher_oauth_states add column if not exists brand_id text;
alter table public.publisher_oauth_states add column if not exists expires_at timestamptz;
alter table public.publisher_oauth_states add column if not exists is_link boolean not null default false;

alter table public.publish_jobs add column if not exists captions jsonb not null default '{}'::jsonb;
alter table public.publish_jobs add column if not exists media_small_url text;
alter table public.publish_jobs add column if not exists brand_id text;

commit;
