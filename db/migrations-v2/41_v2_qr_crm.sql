-- 41_v2_qr_crm.sql — Códigos QR ↔ CRM: a quién trajo cada QR.
-- Un QR dinámico que lleva a un formulario, evento, website o diseño de Musa agrega ?qr=<código> al destino; la página
-- lo manda con el envío y el servidor (solo si el QR es del MISMO espacio que lo que se envía) lo anota:
--   qr_captures              una fila por persona que dejó sus datos por ese QR (formulario, evento o descarga de diseño)
--   crm_contacts.origin_qr_id el QR por el que una persona NUEVA entró al CRM (además lleva las etiquetas «qr» y «QR · <nombre>»)
-- Diseños y presentaciones: qr_codes.fields.download = free | lead | view decide si quien escanea descarga libre,
-- deja nombre y correo para descargar, o solo mira (lo elige la persona al crear el QR).
-- Borrar el QR borra sus capturas pero nunca a las personas del CRM. Idempotente.
alter table public.crm_contacts add column if not exists origin_qr_id text references public.qr_codes(id) on delete set null;
create index if not exists crm_contacts_origin_qr on public.crm_contacts (origin_qr_id) where origin_qr_id is not null;

create table if not exists public.qr_captures (
  id bigint generated always as identity primary key,
  qr_id text not null references public.qr_codes(id) on delete cascade,
  kind text not null,
  contact_id uuid references public.crm_contacts(id) on delete set null,
  name text,
  email text,
  new_contact boolean not null default false,
  created_at timestamptz not null default now(),
  constraint qr_captures_kind_check check (kind in ('formulario', 'evento', 'descarga'))
);
create index if not exists qr_captures_qr on public.qr_captures (qr_id, created_at desc);

-- Solo el servidor escribe; ven las capturas quienes ven el QR (como sus escaneos: si el QR se mueve de espacio, viajan con él).
alter table public.qr_captures enable row level security;
drop policy if exists qr_captures_read on public.qr_captures;
create policy qr_captures_read on public.qr_captures for select using (exists (select 1 from public.qr_codes q where q.id = qr_id and has_workspace_role(q.workspace_id, 'viewer')));
grant select on public.qr_captures to authenticated;
revoke all on public.qr_captures from anon;

-- Resumen para la ficha del QR (con los permisos de quien pregunta).
create or replace function public.v2_qr_captured(p_qr text) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'total', count(*),
    'formulario', count(*) filter (where kind = 'formulario'),
    'evento', count(*) filter (where kind = 'evento'),
    'descarga', count(*) filter (where kind = 'descarga'),
    'newContacts', count(*) filter (where new_contact)
  ) from qr_captures where qr_id = p_qr
$$;
grant execute on function public.v2_qr_captured(text) to authenticated;
