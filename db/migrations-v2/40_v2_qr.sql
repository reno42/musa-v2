-- 40_v2_qr.sql — Códigos QR (Crear › Códigos QR + botón «Código QR» en diseños, presentaciones, websites,
-- eventos, formularios, briefs y cotizaciones). Basado en QeepeR (Douglas Lovera), rehecho sobre Supabase.
--
-- qr_codes      un QR del espacio. kind:
--                 dynamic → el código lleva <app>/r/<code> y el worker redirige a destination_url (se cambia
--                           cuando quieras sin reimprimir; se pausa; cuenta escaneos).
--                 static  → el contenido va dentro del código (Wi‑Fi, contacto, correo, llamada, SMS, texto):
--                           no pasa por Musa, no se puede cambiar ni contar.
--               target_type/target_id: la cosa de Musa a la que apunta (un QR por cosa: se reutiliza).
-- qr_scan_days  escaneos por día, país y tipo de equipo (sin IP ni datos de la persona). Solo servidor.
--
-- Arreglos frente a QeepeR: el código sale de bytes aleatorios seguros y nunca pisa uno existente (allá era
-- Math.random sin revisar choques: podía sobrescribir el QR de otra cuenta); el destino se valida http(s) en la
-- base (allá era un TODO en el worker); los escaneos sí se cuentan (allá sumView estaba vacío e incrementViews
-- guardaba el mismo número); pausar no borra el enlace (allá se borraba de KV y se recreaba al activar).
-- Idempotente.

create table if not exists public.qr_codes (
  id text primary key default ('qr_' || replace(gen_random_uuid()::text, '-', '')),
  workspace_id text not null references public.workspaces(id) on delete cascade,
  kind text not null default 'dynamic',
  code text,
  name text not null,
  content_type text not null default 'url',
  destination_url text,
  content text,
  fields jsonb not null default '{}'::jsonb,
  target_type text,
  target_id text,
  brand_id text,
  style jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  scans integer not null default 0,
  last_scan_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qr_codes_kind_check check (kind in ('dynamic', 'static')),
  constraint qr_codes_type_check check (content_type in ('url', 'whatsapp', 'wifi', 'email', 'phone', 'sms', 'text', 'vcard')),
  constraint qr_codes_target_check check (target_type is null or target_type in ('design', 'presentation', 'website', 'event', 'form', 'brief', 'quote')),
  constraint qr_codes_name_len check (char_length(name) between 1 and 160)
);
create unique index if not exists qr_codes_code_u on public.qr_codes (code) where code is not null;
create index if not exists qr_codes_ws on public.qr_codes (workspace_id, created_at desc);
create unique index if not exists qr_codes_target_u on public.qr_codes (workspace_id, target_type, target_id) where target_type is not null;

create table if not exists public.qr_scan_days (
  qr_id text not null references public.qr_codes(id) on delete cascade,
  day date not null,
  country text not null default '',
  device text not null default '',
  scans integer not null default 0,
  primary key (qr_id, day, country, device)
);

-- ── código corto: 8 caracteres sin los que se confunden al leerlos (0/O, 1/l/I) ──
create or replace function public.v2_qr_new_code() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare a text := 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; b bytea; r text; i int; tries int := 0;
begin
  loop
    b := extensions.gen_random_bytes(8); r := '';
    for i in 0..7 loop r := r || substr(a, (get_byte(b, i) % length(a)) + 1, 1); end loop;
    exit when not exists (select 1 from public.qr_codes where code = r);
    tries := tries + 1;
    if tries > 8 then raise exception 'No se pudo generar un código único' using errcode = '23505'; end if;
  end loop;
  return r;
end $$;
revoke all on function public.v2_qr_new_code() from public, anon, authenticated;

-- ── reglas al guardar (valen igual para la pantalla y para el MCP) ──
create or replace function public.v2_qr_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare srv boolean := auth.uid() is null; n int;
begin
  if tg_op = 'INSERT' then
    if not srv then new.created_by := auth.uid(); end if;
    new.scans := 0; new.last_scan_at := null; new.created_at := now();
    if new.kind = 'dynamic' then new.code := public.v2_qr_new_code(); else new.code := null; end if;
    if new.kind = 'dynamic' then
      select count(*) into n from public.qr_codes where workspace_id = new.workspace_id and kind = 'dynamic';
      if n >= 2000 then raise exception 'Este espacio llegó a 2000 códigos QR dinámicos: borra los que ya no uses' using errcode = '54000'; end if;
    end if;
  else
    -- lo que la persona no cambia: el código impreso, el tipo, los escaneos y la autoría (el servidor sí: mover de espacio)
    new.id := old.id; new.code := old.code; new.kind := old.kind; new.created_by := old.created_by; new.created_at := old.created_at;
    if not srv then new.scans := old.scans; new.last_scan_at := old.last_scan_at; new.workspace_id := old.workspace_id; end if;
  end if;
  new.name := left(btrim(coalesce(new.name, '')), 160);
  if new.name = '' then new.name := 'Código QR'; end if;
  if new.kind = 'dynamic' then
    new.destination_url := btrim(coalesce(new.destination_url, ''));
    if new.destination_url !~* '^https?://[^\s/?#@]+([/?#][^\s]*)?$' then
      raise exception 'El destino tiene que ser un enlace http:// o https://' using errcode = '22023';
    end if;
    if char_length(new.destination_url) > 2048 then raise exception 'El enlace de destino es demasiado largo (máx. 2048)' using errcode = '22023'; end if;
    if new.destination_url ~* '^https?://[^/]+/r/[A-Za-z0-9]{6,16}/?$' then
      raise exception 'Ese enlace ya es de un código QR: apunta a su destino real' using errcode = '22023';
    end if;
    if new.content_type not in ('url', 'whatsapp') then raise exception 'Solo los enlaces y WhatsApp pueden ser dinámicos' using errcode = '22023'; end if;
    new.content := null;
  else
    if coalesce(new.content, '') = '' then raise exception 'Falta el contenido del QR' using errcode = '22023'; end if;
    if char_length(new.content) > 1800 then raise exception 'Es demasiado contenido para un código QR (máx. 1800 caracteres)' using errcode = '22023'; end if;
    new.destination_url := null; new.active := true;
  end if;
  if (new.target_type is null) <> (new.target_id is null) then raise exception 'target_type y target_id van juntos' using errcode = '22023'; end if;
  if jsonb_typeof(coalesce(new.style, '{}'::jsonb)) <> 'object' or char_length(coalesce(new.style, '{}'::jsonb)::text) > 200000 then
    raise exception 'Estilo inválido o con un logo demasiado pesado' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists qr_codes_guard on public.qr_codes;
create trigger qr_codes_guard before insert or update on public.qr_codes for each row execute function public.v2_qr_guard();

-- ── permisos: ver = viewer del espacio; crear/editar = editor; borrar = admin o quien lo creó ──
alter table public.qr_codes enable row level security;
alter table public.qr_scan_days enable row level security;
drop policy if exists qr_codes_read on public.qr_codes;
create policy qr_codes_read on public.qr_codes for select using (has_workspace_role(workspace_id, 'viewer'));
drop policy if exists qr_codes_insert on public.qr_codes;
create policy qr_codes_insert on public.qr_codes for insert with check (has_workspace_role(workspace_id, 'editor'));
drop policy if exists qr_codes_update on public.qr_codes;
create policy qr_codes_update on public.qr_codes for update using (has_workspace_role(workspace_id, 'editor')) with check (has_workspace_role(workspace_id, 'editor'));
drop policy if exists qr_codes_delete on public.qr_codes;
create policy qr_codes_delete on public.qr_codes for delete using (has_workspace_role(workspace_id, 'admin') or created_by = auth.uid());
drop policy if exists qr_scan_days_read on public.qr_scan_days;
create policy qr_scan_days_read on public.qr_scan_days for select using (exists (select 1 from public.qr_codes q where q.id = qr_id and has_workspace_role(q.workspace_id, 'viewer')));
grant select, insert, update, delete on public.qr_codes to authenticated;
grant select on public.qr_scan_days to authenticated;
revoke all on public.qr_codes from anon;
revoke all on public.qr_scan_days from anon;

-- ── el worker al escanear /r/<code>: destino + conteo, en una sola llamada (solo service_role) ──
create or replace function public.v2_qr_hit(p_code text, p_country text default '', p_device text default '', p_count boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q record; d date := (now() at time zone 'America/Lima')::date;
begin
  if p_code is null or p_code !~ '^[A-Za-z0-9]{6,16}$' then return jsonb_build_object('state', 'missing'); end if;
  select id, destination_url, active into q from public.qr_codes where code = p_code and kind = 'dynamic';
  if not found then return jsonb_build_object('state', 'missing'); end if;
  if not q.active then return jsonb_build_object('state', 'paused'); end if;
  if p_count then
    update public.qr_codes set scans = scans + 1, last_scan_at = now() where id = q.id;
    insert into public.qr_scan_days (qr_id, day, country, device, scans)
      values (q.id, d, left(upper(coalesce(p_country, '')), 2), left(coalesce(p_device, ''), 10), 1)
      on conflict (qr_id, day, country, device) do update set scans = qr_scan_days.scans + 1;
  end if;
  return jsonb_build_object('state', 'ok', 'url', q.destination_url);
end $$;
revoke all on function public.v2_qr_hit(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.v2_qr_hit(text, text, text, boolean) to service_role;

-- ── el motor de mover conoce el tipo «qr» (sus escaneos viajan con él: cuelgan del id) ──
create or replace function public.v2__move_type_table(p_type text) returns text
language sql immutable as $$
  select case lower(p_type)
    when 'design' then 'templates' when 'template' then 'templates'
    when 'brand' then 'brands'
    when 'piece' then 'content_calendar' when 'content' then 'content_calendar'
    when 'video' then 'musa_video_projects'
    when 'photo' then 'photo_documents'
    when 'composition' then 'photo_compositions'
    when 'asset' then 'assets' when 'file' then 'assets'
    when 'note' then 'brain_notes'
    when 'flow' then 'flows'
    when 'credential' then 'flow_credentials'
    when 'contact' then 'crm_contacts'
    when 'deal' then 'crm_deals'
    when 'quote' then 'crm_quotes'
    when 'task' then 'design_kanban_tasks'
    when 'copy' then 'copy_recipes'
    when 'recipe' then 'recipes'
    when 'brief' then 'briefs'
    when 'campaign' then 'campaigns'
    when 'form' then 'workspace_forms'
    when 'mailing' then 'workspace_mailings'
    when 'event' then 'workspace_events'
    when 'project' then 'workspace_projects'
    when 'research' then 'research_sources'
    when 'playbook' then 'workspace_playbooks'
    when 'script' then 'workspace_take_scripts'
    when 'take' then 'musa_video_takes'
    when 'guideline' then 'brand_guidelines'
    when 'audience' then 'ad_audiences'
    when 'ad' then 'ad_campaigns'
    when 'skill' then 'workspace_skills'
    when 'website' then 'websites' when 'site' then 'websites'
    when 'qr' then 'qr_codes'
    else null end
$$;
revoke all on function public.v2__move_type_table(text) from public, anon, authenticated;

create or replace function public.v2__move_label(p_t text, p_id text) returns text
language plpgsql stable as $$
declare v text;
begin
  execute format('select %s from public.%I where id::text = $1',
    case p_t
      when 'templates' then 'name' when 'brands' then 'name' when 'content_calendar' then 'topic'
      when 'musa_video_projects' then 'name' when 'photo_documents' then 'source_url' when 'photo_compositions' then 'source_url'
      when 'assets' then 'name' when 'brain_notes' then 'title' when 'flows' then 'name' when 'flow_credentials' then 'name'
      when 'crm_contacts' then 'coalesce(nullif(trim(coalesce(first_name,'''')||'' ''||coalesce(last_name,'''')),''''), email)'
      when 'crm_deals' then 'title' when 'crm_quotes' then 'title' when 'design_kanban_tasks' then 'title'
      when 'copy_recipes' then 'name' when 'recipes' then 'name' when 'briefs' then 'title' when 'campaigns' then 'name'
      when 'workspace_forms' then 'name' when 'workspace_events' then 'name' when 'workspace_projects' then 'name'
      when 'research_sources' then 'name' when 'workspace_playbooks' then 'name' when 'workspace_take_scripts' then 'title'
      when 'brand_guidelines' then 'name' when 'ad_audiences' then 'name' when 'ad_campaigns' then 'name'
      when 'workspace_skills' then 'name' when 'websites' then 'name' when 'qr_codes' then 'name'
      else 'id::text' end, p_t) into v using p_id;
  return v;
exception when others then return null;
end $$;
revoke all on function public.v2__move_label(text, text) from public, anon, authenticated;
