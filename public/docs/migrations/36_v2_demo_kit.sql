-- 36_v2_demo_kit.sql — datos de ejemplo REALES en cada espacio (reemplaza el botón «Datos de ejemplo»)
--
-- Pedido del usuario (2026-11-09): todos los módulos vienen con ejemplos desde que te creas la cuenta, para ver
-- todo lo que se puede hacer y cómo se vería tu marca. No dependen de un botón: son filas de verdad del espacio,
-- se editan, se guardan y se borran como cualquier otra.
--
--   v2_demo_seed(ws)     siembra UNA sola vez por espacio (marca workspaces.data.demo_seeded_at) y solo en los
--                        módulos que están vacíos: nunca mezcla ejemplos con lo que la persona ya creó.
--                        Si el espacio ya tiene marcas, los ejemplos usan ESAS marcas (y sus colores en los diseños);
--                        si no tiene, crea marcas de ejemplo (brands.is_demo) que no cuentan para el límite del plan.
--                        Lo llama la app al abrir el espacio (bridge.js). No hay disparos automáticos.
--   workspace_demo_items registro de lo sembrado (tabla + id), por si un día se quiere «borrar los ejemplos».
-- Correos de ejemplo en dominios .example (no existen); formularios y eventos sin publicar fuera de Musa;
-- mailings y secuencias nunca quedan programados ni activos. Idempotente.

alter table public.brands add column if not exists is_demo boolean not null default false;

create table if not exists public.workspace_demo_items (
  workspace_id text not null references public.workspaces(id) on delete cascade,
  tbl text not null,
  row_id text not null,
  created_at timestamptz not null default now(),
  primary key (tbl, row_id)
);
create index if not exists workspace_demo_items_ws on public.workspace_demo_items (workspace_id);
alter table public.workspace_demo_items enable row level security;
drop policy if exists workspace_demo_items_read on public.workspace_demo_items;
create policy workspace_demo_items_read on public.workspace_demo_items for select to authenticated
  using (exists (select 1 from public.workspace_members m where m.workspace_id = workspace_demo_items.workspace_id and m.user_id = auth.uid()));
revoke insert, update, delete on public.workspace_demo_items from anon, authenticated;

-- Bandeja: la tabla tenía RLS sin políticas, así que la app no podía leer ni marcar ningún mensaje (ni los reales).
-- Leen los miembros del espacio; responder, marcar hecho o asignar lo hace quien edita. Crear y borrar sigue siendo del servidor.
drop policy if exists social_inbox_read on public.social_inbox;
create policy social_inbox_read on public.social_inbox for select to authenticated using (has_workspace_role(workspace_id, 'viewer'));
drop policy if exists social_inbox_update on public.social_inbox;
create policy social_inbox_update on public.social_inbox for update to authenticated
  using (has_workspace_role(workspace_id, 'editor')) with check (has_workspace_role(workspace_id, 'editor'));

-- las marcas de ejemplo no cuentan para el límite del plan
create or replace function public.v2_guard_brand_limit() returns trigger language plpgsql security definer set search_path = public as $$
declare owner text; lim int;
begin
  if coalesce(current_setting('musa.trusted', true), '') = '1' or coalesce(new.is_demo, false) then return new; end if;
  select owner_id into owner from workspaces where id = new.workspace_id;
  if owner is null then return new; end if;
  lim := (v2_entitlements(owner::uuid)->>'brands')::int;
  if lim is not null and (select count(*) from brands b join workspaces w on w.id = b.workspace_id where w.owner_id = owner and not b.is_demo) >= lim then
    raise exception 'LIMIT_BRANDS: tu plan permite % marcas. Mejora tu plan para agregar más.', lim;
  end if;
  return new;
end $$;

create or replace function public.v2_my_plan() returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); e jsonb; a credit_accounts; payer uuid; pa credit_accounts;
begin
  payer := v2_credit_available(uid);
  e := v2_entitlements(uid);
  select * into a from credit_accounts where user_id = uid;
  if payer is not null and payer <> uid then select * into pa from credit_accounts where user_id = payer; end if;
  return e || jsonb_build_object(
    'brands_used', (select count(*) from brands b join workspaces w on w.id = b.workspace_id where w.owner_id = uid::text and not b.is_demo),
    'seats_used', 1 + (select count(distinct m.user_id) from workspace_members m join workspaces w on w.id = m.workspace_id where w.owner_id = uid::text and m.user_id <> uid),
    'emails_used', (select count(*) from workspace_email_sends s join workspaces w on w.id = s.workspace_id where w.owner_id = uid::text and s.provider = 'musa' and s.created_at >= date_trunc('month', now())),
    'credits', jsonb_build_object('plan', coalesce(a.plan_credits, 0), 'pack', coalesce(a.pack_credits, 0), 'monthly', coalesce(a.plan_grant, 0), 'next_refill', a.next_refill,
      'team', case when pa.user_id is not null then pa.plan_credits + pa.pack_credits end));
end $$;

-- color de texto legible sobre un fondo (#rrggbb)
create or replace function public.v2_demo_ink(p_hex text) returns text language plpgsql immutable as $$
declare h text := lower(ltrim(coalesce(p_hex, ''), '#')); r int; g int; b int;
begin
  if h !~ '^[0-9a-f]{6}$' then return '#111111'; end if;
  r := ('x' || substr(h, 1, 2))::bit(8)::int; g := ('x' || substr(h, 3, 2))::bit(8)::int; b := ('x' || substr(h, 5, 2))::bit(8)::int;
  return case when (0.299 * r + 0.587 * g + 0.114 * b) > 150 then '#111111' else '#ffffff' end;
end $$;

-- primer color de una marca (acepta "#hex" o {hex|value})
create or replace function public.v2_demo_color(p_colors jsonb, p_i int) returns text language sql immutable as $$
  select case jsonb_typeof(p_colors -> p_i) when 'string' then p_colors ->> p_i when 'object' then coalesce(p_colors -> p_i ->> 'hex', p_colors -> p_i ->> 'value') end
$$;

create or replace function public.v2_demo_seed(p_ws text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  K constant jsonb := $K${"brands": [{"name": "Nexo Digital", "colors": ["#0b0b0b", "#d2ff02", "#f4f4f0"], "fonts": ["Syne", "Inter"], "rel": "client", "health": "active", "house": true, "notes": "Tu marca propia de ejemplo: estudio de marketing con IA."}, {"name": "Kuna Studio", "colors": ["#b5532f", "#f6e7da", "#2b1a12"], "fonts": ["Fraunces", "Inter"], "rel": "client", "health": "active", "notes": "Moda hecha en Perú. Fee mensual."}, {"name": "Café Altura", "colors": ["#2a1c13", "#e8c9a0", "#c58a52"], "fonts": ["DM Serif Display", "Inter"], "rel": "client", "health": "at_risk", "notes": "Cafetería de especialidad. Negociando plan anual."}, {"name": "Nómade", "colors": ["#3f4c39", "#e9dcc3", "#e07a3f"], "fonts": ["Inter", "Fraunces"], "rel": "client", "health": "active", "notes": "Agencia de viajes lentos por el sur del Perú."}, {"name": "Bloom", "colors": ["#b04a5a", "#f4c7c3", "#fff6f4"], "fonts": ["Playfair Display", "Inter"], "rel": "client", "health": "churned", "notes": "Belleza. Pack de Instagram en pausa."}, {"name": "Andes Tech", "colors": ["#0f2a3f", "#38bdf8", "#e6f6ff"], "fonts": ["Space Grotesk", "Inter"], "rel": "lead", "health": "active", "notes": "Software B2B. Prospecto de retainer en LinkedIn."}], "contacts": [{"key": "c1", "fn": "María", "ln": "Gutiérrez", "b": 2, "job": "Gerente de marketing", "email": "maria@kuna.example", "phone": "+51 999 111 201", "ago": 2}, {"key": "c2", "fn": "Jorge", "ln": "Salazar", "b": 3, "job": "Dueño", "email": "jorge@cafealtura.example", "phone": "+51 999 111 202", "ago": 5}, {"key": "c3", "fn": "Valeria", "ln": "Ríos", "b": 4, "job": "Directora de contenido", "email": "valeria@nomade.example", "phone": "+51 999 111 203", "ago": 1}, {"key": "c4", "fn": "Carlos", "ln": "Quispe", "b": 6, "job": "CMO", "email": "carlos@andestech.example", "phone": "+51 999 111 204", "ago": 12}, {"key": "c5", "fn": "Lucía", "ln": "Mendoza", "b": 5, "job": "Fundadora", "email": "lucia@bloom.example", "phone": "+51 999 111 205", "ago": 0}, {"key": "c6", "fn": "Miguel", "ln": "Huamán", "company": "Ruta Sur", "job": "Jefe comercial", "email": "miguel@rutasur.example", "phone": "+51 999 111 206", "ago": 8}], "deals": [{"t": "Andes Tech · retainer LinkedIn", "v": 6000, "st": "discovery", "c": "c4", "b": 6, "p": 20, "next": "Llamada de descubrimiento"}, {"t": "Ruta Sur · lanzamiento", "v": 3700, "st": "discovery", "c": "c6", "b": 1, "p": 25, "next": "Enviar casos de éxito"}, {"t": "Nómade · videos Q1", "v": 2500, "st": "proposal", "c": "c3", "b": 4, "p": 50, "next": "Esperar firma de la cotización"}, {"t": "Café Altura · plan anual", "v": 3200, "st": "negotiation", "c": "c2", "b": 3, "p": 70, "next": "Resolver dudas de reels por mes"}, {"t": "Kuna Studio · renovación", "v": 4800, "st": "approved", "c": "c1", "b": 2, "p": 100, "next": "Kickoff de verano"}, {"t": "Bloom · pack Instagram", "v": 1900, "st": "approved", "c": "c5", "b": 5, "p": 100, "next": "Retomar en enero"}], "cal": [{"day": 3, "time": "18:00", "b": 2, "topic": "Lanzamiento colección otoño", "copy": "Llegó el otoño a Kuna: alpaca, lana y tejidos de Cusco hechos para durar. Desliza para ver la colección 🍂", "vt": "carrusel", "ch": ["instagram"], "st": "aprobado"}, {"day": 5, "time": "09:00", "b": 1, "topic": "5 errores al elegir CRM", "copy": "Si tu equipo vive en Excel, este post es para ti. Los 5 errores que más vemos al elegir un CRM.", "vt": "post", "ch": ["linkedin"], "st": "aprobado"}, {"day": 7, "time": "19:30", "b": 3, "topic": "Detrás de cámaras · rodaje", "copy": "Así preparamos el menú de temporada ☕", "vt": "reel", "ch": ["tiktok", "instagram"], "st": "borrador"}, {"day": 9, "time": "11:00", "b": 4, "topic": "Guía: ruta lenta por Arequipa", "copy": "3 días, 0 prisas. Nuestra ruta favorita por Arequipa y el Colca.", "vt": "carrusel", "ch": ["instagram"], "st": "aprobado"}, {"day": 11, "time": "18:00", "b": 2, "topic": "Promo Black Friday", "copy": "−30 % solo este fin de semana. Envío gratis a todo el Perú.", "vt": "story", "ch": ["instagram"], "st": "borrador"}, {"day": 13, "time": "08:30", "b": 1, "topic": "Hilo: IA para pymes", "copy": "Cómo una pyme puede producir contenido semanal con IA sin perder su voz. Hilo 🧵", "vt": "post", "ch": ["x", "linkedin"], "st": "idea"}, {"day": 15, "time": "20:00", "b": 3, "topic": "Testimonio de cliente", "copy": "«El mejor chai especiado de Miraflores». Gracias Pablo 🙌", "vt": "reel", "ch": ["facebook", "instagram"], "st": "aprobado"}, {"day": 17, "time": "09:00", "b": 4, "topic": "Newsletter del mes", "copy": "Rutas lentas, fotos de la comunidad y la fecha de nuestra próxima salida.", "vt": "post", "ch": ["email"], "st": "borrador"}, {"day": 19, "time": "18:30", "b": 5, "topic": "Nueva línea de cuidado", "copy": "Tu rutina, más simple. Conoce la nueva línea de Bloom 🌸", "vt": "carrusel", "ch": ["instagram"], "st": "idea"}, {"day": 21, "time": "12:00", "b": 1, "topic": "Caso de éxito: Kuna Studio", "copy": "De 0 a 32 piezas al mes sin crecer el equipo. Así trabajamos con Kuna Studio.", "vt": "post", "ch": ["linkedin"], "st": "aprobado"}, {"day": 24, "time": "19:00", "b": 2, "topic": "Unboxing edición limitada", "copy": "Abrimos la caja de la edición limitada en vivo 📦", "vt": "reel", "ch": ["tiktok"], "st": "idea"}, {"day": 26, "time": "10:00", "b": 6, "topic": "Webinar: datos que venden", "copy": "Te invitamos al webinar de Andes Tech sobre datos y ventas B2B.", "vt": "post", "ch": ["linkedin"], "st": "idea"}], "tasks": [{"t": "Carrusel 5 errores CRM", "b": 1, "type": "post", "fmt": "Carrusel · 6 láminas", "st": "design", "prio": 1, "due": 0}, {"t": "Menú de temporada", "b": 3, "type": "post", "fmt": "Historia 9:16", "st": "draft", "prio": 2, "due": 1}, {"t": "Ajustes al lookbook otoño", "b": 2, "type": "deck", "fmt": "A4 · 12 páginas", "st": "feedback", "prio": 2, "due": 3}, {"t": "Banner del canal de YouTube", "b": 4, "type": "banner", "fmt": "2560×1440", "st": "backlog", "prio": 3, "due": 6}, {"t": "Aprobar campaña Black Friday", "b": 2, "type": "post", "fmt": "3 piezas", "st": "review", "prio": 1, "due": 0}], "notes": [{"et": "brand", "t": "Voz de marca", "b": 1, "body": "# Voz de {B1}\nCercana, directa y sin tecnicismos. Hablamos de **CRM e IA** como herramientas, no como magia.\n\n- Tuteamos siempre\n- Cero anglicismos innecesarios\n- Cada post termina con una acción concreta\n\nVer [[Serie CRM]] y [[Proceso de aprobación]]."}, {"et": "brand", "t": "Guía rápida de {B2}", "b": 2, "body": "# {B2}\nRopa hecha en Perú que dura más de un verano. Paleta terracota, tipografía Fraunces.\n\nCampaña activa: [[Campaña otoño]]. Cliente con fee mensual.\n\nOjo: el cliente pide revisar tallas antes de publicar."}, {"et": "brand", "t": "Menú y tono de {B3}", "b": 3, "body": "# {B3}\nTono cálido, de barrio. Fotos con luz natural.\n\n- El menú de temporada cambia cada 3 meses\n- Apertura del local de Miraflores en [[Ideas Q1]]"}, {"et": "campaign", "t": "Campaña otoño", "b": 2, "body": "# Campaña otoño · {B2}\nLookbook de 12 páginas, 8 stories y 4 reels.\n\nAprendizaje: los carruseles con precio visible convierten 2× más. Lo repetimos en [[Ideas Q1]]."}, {"et": "campaign", "t": "Serie CRM", "b": 1, "body": "# Serie CRM · {B1}\nCarruseles educativos semanales. El de [[5 errores del CRM]] es el que más se guarda.\n\nSiguiente: embudo en 3 pasos."}, {"et": "campaign", "t": "5 errores del CRM", "b": 1, "body": "# 5 errores del CRM\n1. No registrar el origen del lead\n2. No hacer seguimiento en 48 h\n3. Etapas que nadie entiende\n4. Datos duplicados\n5. Nadie mira el reporte\n\nParte de [[Serie CRM]]."}, {"et": "process", "t": "Proceso de aprobación", "b": 1, "body": "# Proceso de aprobación\nRevisión interna → cliente en el portal → se programa sola.\n\nSi el cliente pide cambios dos veces, se agenda una llamada. Aplica a [[Voz de marca]] y a todos los clientes."}, {"et": "idea", "t": "Ideas Q1", "b": 1, "body": "# Ideas Q1\n- Webinar de IA para pymes (otra vez, se llenó)\n- Repetir el formato de [[Campaña otoño]] para verano\n- Evento de apertura de {B3}\n- Reels semanales con un clon de voz"}], "inbox": [{"who": "María Gutiérrez", "h": "@mariag", "pf": "instagram", "k": "message", "st": "new", "m": 25, "txt": "¿Tienen la colección otoño en talla S? Quiero el abrigo de alpaca 🧥"}, {"who": "@cafeamante", "h": "@cafeamante", "pf": "tiktok", "k": "comment", "st": "new", "m": 48, "txt": "Pedí el latte de calabaza y llegó frío 😕"}, {"who": "Jorge Salazar", "h": "jorge@cafealtura.example", "pf": "email", "k": "message", "st": "new", "m": 95, "txt": "Revisé la propuesta del plan anual, tengo dudas sobre la cantidad de reels por mes."}, {"who": "Lucía Mendoza", "h": "+51 999 111 205", "pf": "whatsapp", "k": "message", "st": "replied", "m": 1000, "txt": "Hola, ¿cuándo sale el post de la nueva línea?", "reply": "¡Hola Lucía! Sale el jueves a las 7 p. m. Te mando la vista previa hoy."}, {"who": "@viajera.pe", "h": "@viajera.pe", "pf": "instagram", "k": "comment", "st": "new", "m": 140, "txt": "¡Me salvaron el viaje! ¿Harán uno de Arequipa?"}, {"who": "Andes Tech", "h": "andes-tech", "pf": "linkedin", "k": "mention", "st": "new", "m": 1250, "txt": "Gracias por la charla sobre CRM y contenido. ¿Hacemos un webinar juntos?"}, {"who": "Pablo R.", "h": "pablo.r", "pf": "facebook", "k": "review", "st": "done", "m": 1500, "txt": "El mejor chai especiado de Miraflores. Volveré. ★★★★★"}, {"who": "Carla Núñez", "h": "+51 999 111 207", "pf": "whatsapp", "k": "message", "st": "new", "m": 160, "txt": "¿Hacen envíos a Arequipa? Quiero 2 ponchos."}, {"who": "Sofía Campos", "h": "@sofiac", "pf": "youtube", "k": "comment", "st": "done", "m": 4300, "txt": "¿En qué minuto explican cómo reservar?", "reply": "¡Hola Sofía! Está en el minuto 3:45. Te dejamos el enlace en la descripción 😉"}], "copys": [{"n": "Hook: ¿sigues usando Excel?", "type": "hook", "b": 1, "use": 12, "c": "¿Sigues llevando tus clientes en Excel? No es tu culpa: nadie te enseñó otra forma. En 3 pasos te mostramos cómo ordenar tu embudo sin contratar a nadie."}, {"n": "Caption colección otoño", "type": "caption", "b": 2, "use": 4, "c": "Hecho en Perú, pensado para durar. La colección otoño ya está aquí 🍂 Alpaca, lana y tejidos de Cusco. Link en bio."}, {"n": "Guion reel 30 s", "type": "guion", "b": 3, "use": 0, "c": "0–3 s: taza humeante en primer plano. 3–12 s: el barista muele el café de altura. 12–25 s: primer sorbo y sonrisa. 25–30 s: «Tu café de altura, ahora a la vuelta»."}, {"n": "Asunto de newsletter", "type": "asunto", "b": 4, "use": 0, "c": "Rutas lentas de este mes 🌄 (y una salida con cupos)"}, {"n": "CTA de landing", "type": "cta", "b": 1, "use": 9, "c": "Agenda una llamada de 20 minutos y recibe tu plan de contenido en 48 horas."}, {"n": "Descripción de YouTube", "type": "descripcion", "b": 4, "use": 0, "c": "En este video recorremos Arequipa, el Colca y Puno a ritmo lento: dónde dormir, qué comer y cómo moverte sin apuros. Suscríbete para la próxima ruta."}], "briefs": [{"key": "b1", "b": 2, "t": "Campaña verano 2027", "st": "por_completar", "by": "María G.", "obj": "Vender la colección verano: +20 % en ventas online en enero", "aud": "Mujeres 22–35, Lima y Arequipa, compran por Instagram", "del": ["12 posts", "8 stories", "4 reels", "1 lookbook", "ads 4 semanas"], "f": {"Objetivo": "Vender la colección verano: +20 % en ventas online en enero", "Público": "Mujeres 22–35, Lima y Arequipa, compran por Instagram", "Mensaje clave": "Ropa hecha en Perú que dura más de un verano", "Entregables": "12 posts · 8 stories · 4 reels · 1 lookbook · ads 4 semanas", "Canales": "Instagram, TikTok, mailing", "Fechas": "Lanzamiento 8 ene · cierre 28 feb", "Presupuesto": "— falta", "Aprueba": "María Gutiérrez"}}, {"key": "b2", "b": 3, "t": "Apertura local Miraflores", "st": "aprobado", "by": "Jorge S.", "obj": "Llenar el local la primera semana", "aud": "Vecinos de Miraflores y oficinistas", "del": ["Evento de apertura", "6 posts", "1 reel", "volantes", "ads locales"], "budget": 6500, "f": {"Objetivo": "Llenar el local la primera semana", "Público": "Vecinos de Miraflores y oficinistas", "Mensaje clave": "Tu café de altura, ahora a la vuelta", "Entregables": "Evento de apertura · 6 posts · 1 reel · volantes · ads locales", "Canales": "Instagram, TikTok, OOH barrial", "Fechas": "Apertura en 3 semanas", "Presupuesto": "S/ 6 500", "Aprueba": "Jorge Salazar"}}, {"key": "b3", "b": 4, "t": "Videos de destinos Q1", "st": "en_proyecto", "by": "Valeria R.", "obj": "Posicionar 4 destinos de viaje lento", "aud": "Viajeros 28–45 que planifican con tiempo", "del": ["4 videos de 3 min", "12 cortes verticales", "subtítulos ES/EN"], "budget": 2500, "f": {"Objetivo": "Posicionar 4 destinos de viaje lento", "Público": "Viajeros 28–45 que planifican con tiempo", "Mensaje clave": "Viaja lento, recuerda más", "Entregables": "4 videos de 3 min · 12 cortes verticales · subtítulos ES/EN", "Canales": "YouTube, Instagram", "Fechas": "Ene–mar", "Presupuesto": "S/ 2 500", "Aprueba": "Valeria Ríos"}}], "rates": [{"l": "Post o carrusel", "p": 180, "u": "pieza"}, {"l": "Story", "p": 90, "u": "pieza"}, {"l": "Reel editado", "p": 450, "u": "pieza"}, {"l": "Video largo (3 min)", "p": 1200, "u": "pieza"}, {"l": "Lookbook / catálogo", "p": 1500, "u": "pieza"}, {"l": "Gestión de ads", "p": 900, "u": "mes"}, {"l": "Community management", "p": 1600, "u": "mes"}, {"l": "Sesión de fotos", "p": 1100, "u": "día"}], "quotes": [{"key": "q1", "n": "COT-0142", "b": 3, "t": "Apertura local Miraflores", "st": "Firmada", "it": [[0, 6], [2, 1], [5, 1], [7, 1]], "sent": 9, "signed": "Jorge Salazar", "items": [{"label": "Post o carrusel", "qty": 6, "price": 180, "unit": "pieza"}, {"label": "Reel editado", "qty": 1, "price": 450, "unit": "pieza"}, {"label": "Gestión de ads", "qty": 1, "price": 900, "unit": "mes"}, {"label": "Sesión de fotos", "qty": 1, "price": 1100, "unit": "día"}], "total": 4165.4}, {"key": "q2", "n": "COT-0145", "b": 4, "t": "Videos de destinos Q1", "st": "Enviada", "it": [[3, 4], [2, 12]], "sent": 2, "items": [{"label": "Video largo (3 min)", "qty": 4, "price": 1200, "unit": "pieza"}, {"label": "Reel editado", "qty": 12, "price": 450, "unit": "pieza"}], "total": 12036.0}, {"key": "q3", "n": "COT-0147", "b": 2, "t": "Campaña verano 2027", "st": "Borrador", "it": [[0, 12], [1, 8], [2, 4], [4, 1], [5, 2]], "items": [{"label": "Post o carrusel", "qty": 12, "price": 180, "unit": "pieza"}, {"label": "Story", "qty": 8, "price": 90, "unit": "pieza"}, {"label": "Reel editado", "qty": 4, "price": 450, "unit": "pieza"}, {"label": "Lookbook / catálogo", "qty": 1, "price": 1500, "unit": "pieza"}, {"label": "Gestión de ads", "qty": 2, "price": 900, "unit": "mes"}], "total": 9416.4}, {"key": "q4", "n": "COT-0139", "b": 6, "t": "Retainer LinkedIn", "st": "Rechazada", "it": [[0, 8], [6, 1]], "sent": 20, "items": [{"label": "Post o carrusel", "qty": 8, "price": 180, "unit": "pieza"}, {"label": "Community management", "qty": 1, "price": 1600, "unit": "mes"}], "total": 3587.2}], "fees": [{"b": 2, "fee": 4800, "hi": 60, "hu": 41, "pi": 35, "pd": 32, "out": []}, {"b": 3, "fee": 3200, "hi": 40, "hu": 52, "pi": 16, "pd": 18, "out": ["Video 3D de producto (no estaba en el contrato)", "2 rondas extra de cambios en el menú"]}, {"b": 4, "fee": 2500, "hi": 30, "hu": 24, "pi": 12, "pd": 12, "out": []}, {"b": 5, "fee": 1900, "hi": 20, "hu": 8, "pi": 10, "pd": 8, "out": []}], "projects": [{"b": 2, "n": "Campaña verano 2027", "st": "Planificando", "brief": "b1", "quote": "q3", "s": 30, "e": 80, "bud": 9416, "sp": 0, "hp": 6, "hu": 2, "team": ["Ana T.", "Pixel"], "prog": 10, "tasks": [["Kickoff con el cliente", "cliente", "done", -2], ["Moodboard y concepto", "interna", "doing", 5], ["Calendario de enero", "interna", "todo", 12], ["Aprobación del concepto", "cliente", "todo", 15]]}, {"b": 2, "n": "Contenido del mes", "st": "En producción", "s": -10, "e": 20, "bud": 4800, "sp": 3280, "hp": 25, "hu": 16, "team": ["Ana T.", "Kai", "Pixel"], "prog": 60, "tasks": [["Copys del mes en lote", "interna", "done", -6], ["Piezas por lote con CSV", "interna", "done", -3], ["Aprobación en bloque", "cliente", "doing", 2], ["Programar todo el mes", "interna", "todo", 4]]}, {"b": 3, "n": "Apertura local Miraflores", "st": "En producción", "brief": "b2", "quote": "q1", "s": -7, "e": 21, "bud": 4165, "sp": 2900, "hp": 18, "hu": 6, "team": ["Luis M.", "Kai"], "prog": 45, "tasks": [["Invitación al evento", "interna", "done", -4], ["Reel detrás de cámaras", "interna", "doing", 3], ["Volantes para el barrio", "cliente", "todo", 7]]}, {"b": 4, "n": "Videos de destinos Q1", "st": "En revisión", "brief": "b3", "quote": "q2", "s": 45, "e": 135, "bud": 12036, "sp": 0, "hp": 3, "hu": 1, "team": ["Sofía C.", "Luis M."], "prog": 5, "tasks": [["Guion de Arequipa", "interna", "doing", 10], ["Firma de la cotización", "cliente", "todo", 3]]}, {"b": 1, "n": "Serie CRM para pymes", "st": "En producción", "s": -20, "e": 10, "bud": 0, "sp": 0, "hp": 14, "hu": 9, "team": ["Pixel"], "prog": 70, "tasks": [["Carrusel 5 errores CRM", "interna", "done", -5], ["Embudo en 3 pasos", "interna", "doing", 4]]}, {"b": 5, "n": "Pack Instagram", "st": "Pausado", "s": -40, "e": 20, "bud": 1900, "sp": 600, "hp": 5, "hu": 3, "team": ["Ana T."], "prog": 30, "tasks": [["Retomar en enero", "cliente", "todo", 50]]}], "forms": [{"n": "Contacto · landing", "b": 1, "type": "Contacto", "pub": true, "leads": 142, "f": [["nombre", "Nombre", "text", true], ["email", "Correo", "email", true], ["whatsapp", "WhatsApp", "tel", false], ["necesidad", "¿Qué necesitas?", "select", false]]}, {"n": "Lead ads Instagram", "b": 2, "type": "Lead magnet", "pub": true, "leads": 61, "f": [["nombre", "Nombre", "text", true], ["email", "Correo", "email", true], ["talla", "Talla favorita", "select", false]]}, {"n": "Link en bio · reservas", "b": 3, "type": "Reserva", "pub": true, "leads": 23, "f": [["nombre", "Nombre", "text", true], ["whatsapp", "WhatsApp", "tel", true], ["fecha", "Fecha y hora", "date", false], ["personas", "Personas", "number", false]]}, {"n": "Inscripción · Webinar IA para pymes", "b": 1, "type": "Inscripción", "pub": false, "leads": 86, "f": [["nombre", "Nombre", "text", true], ["email", "Correo", "email", true], ["empresa", "Empresa", "text", false]]}, {"n": "Brief para clientes nuevos", "b": 1, "type": "Brief", "pub": true, "leads": 7, "f": [["marca", "Marca", "text", true], ["objetivo", "Objetivo", "textarea", true], ["presupuesto", "Presupuesto", "select", false], ["entrega", "Fecha de entrega", "date", false]]}], "mails": [{"n": "Newsletter del mes", "b": 4, "subj": "Rutas lentas de este mes 🌄", "seg": "Suscriptores", "tpl": "news", "st": "enviada", "d": -8, "sent": 2140, "open": 41.2, "click": 6.1}, {"n": "Promo Black Friday", "b": 2, "subj": "−30 % solo este fin de semana", "seg": "Clientes", "tpl": "promo", "st": "borrador", "d": 18}, {"n": "Te extrañamos", "b": 3, "subj": "Tu chai te espera ☕", "seg": "Inactivos 60 días", "tpl": "reactiv", "st": "borrador", "d": 4}, {"n": "Bienvenida", "b": 1, "subj": "Bienvenido a {B1}", "seg": "Leads nuevos", "tpl": "welcome", "st": "enviada", "d": -20, "sent": 412, "open": 58.3, "click": 14.2}], "seqs": [{"n": "Bienvenida a leads", "b": 1, "groups": ["Leads nuevos"], "st": "pausada", "inside": 86, "done": 312, "steps": [{"d": 0, "subject": "Bienvenido a {B1}", "tpl": "welcome"}, {"d": 2, "subject": "5 errores que matan tu CRM", "tpl": "news"}, {"d": 5, "subject": "¿Hablamos 15 minutos?", "tpl": "news"}]}, {"n": "Recuperar inactivos", "b": 3, "groups": ["Inactivos 60 días"], "st": "pausada", "inside": 41, "done": 120, "steps": [{"d": 0, "subject": "Tu chai te espera ☕", "tpl": "reactiv"}, {"d": 3, "subject": "Menú de temporada", "tpl": "news"}, {"d": 7, "subject": "Última oportunidad: 15 % off", "tpl": "promo"}]}, {"n": "Clientes nuevos", "b": 2, "groups": ["Clientes", "Suscriptores"], "st": "borrador", "inside": 0, "done": 54, "steps": [{"d": 0, "subject": "Gracias por tu compra", "tpl": "welcome"}, {"d": 10, "subject": "Lookbook otoño", "tpl": "news"}]}], "events": [{"n": "Webinar: IA para pymes", "b": 1, "d": 2, "h": 19, "mi": 0, "plat": "meet", "link": "https://meet.google.com/", "cap": 150, "dur": 45, "desc": "Cómo una pyme puede producir contenido semanal con IA sin perder su voz de marca. 45 minutos + preguntas.", "regs": [{"n": "Lucía Mendoza", "e": "lucia.mendoza@correo.example", "st": "confirmado", "src": "pagina", "ago": 1}, {"n": "Carlos Quispe", "e": "carlos.quispe@correo.example", "st": "confirmado", "src": "ads", "ago": 4}, {"n": "Valeria Ríos", "e": "valeria.rios@correo.example", "st": "confirmado", "src": "mailing", "ago": 7}, {"n": "Diego Paredes", "e": "diego.paredes@correo.example", "st": "confirmado", "src": "pagina", "ago": 1}, {"n": "Sofía Campos", "e": "sofia.campos@correo.example", "st": "confirmado", "src": "instagram", "ago": 4}, {"n": "Andrea Torres", "e": "andrea.torres@correo.example", "st": "confirmado", "src": "pagina", "ago": 7}]}, {"n": "Lanzamiento colección invierno", "b": 2, "d": 9, "h": 18, "mi": 30, "plat": "zoom", "link": "https://zoom.us/", "cap": 300, "dur": 45, "desc": "Presentamos en vivo la colección de invierno: alpaca, lana y tejidos de Cusco. Sorteo para los asistentes.", "regs": [{"n": "Lucía Mendoza", "e": "lucia.mendoza@correo.example", "st": "confirmado", "src": "pagina", "ago": 1}, {"n": "Carlos Quispe", "e": "carlos.quispe@correo.example", "st": "confirmado", "src": "ads", "ago": 4}, {"n": "Valeria Ríos", "e": "valeria.rios@correo.example", "st": "confirmado", "src": "mailing", "ago": 7}, {"n": "Diego Paredes", "e": "diego.paredes@correo.example", "st": "confirmado", "src": "pagina", "ago": 1}, {"n": "Sofía Campos", "e": "sofia.campos@correo.example", "st": "confirmado", "src": "instagram", "ago": 4}, {"n": "Andrea Torres", "e": "andrea.torres@correo.example", "st": "confirmado", "src": "pagina", "ago": 7}, {"n": "Mateo Salinas", "e": "mateo.salinas@correo.example", "st": "confirmado", "src": "ads", "ago": 1}, {"n": "Camila Rojas", "e": "camila.rojas@correo.example", "st": "confirmado", "src": "mailing", "ago": 4}]}, {"n": "Cata de cafés de altura", "b": 3, "d": 1, "h": 10, "mi": 0, "plat": "meet", "link": "https://meet.google.com/", "cap": 40, "dur": 50, "desc": "Cata guiada de 3 orígenes peruanos. Te enviamos el kit a casa si te inscribes antes del jueves.", "regs": [{"n": "Lucía Mendoza", "e": "lucia.mendoza@correo.example", "st": "confirmado", "src": "pagina", "ago": 1}, {"n": "Carlos Quispe", "e": "carlos.quispe@correo.example", "st": "confirmado", "src": "ads", "ago": 4}, {"n": "Valeria Ríos", "e": "valeria.rios@correo.example", "st": "confirmado", "src": "mailing", "ago": 7}, {"n": "Diego Paredes", "e": "diego.paredes@correo.example", "st": "confirmado", "src": "pagina", "ago": 1}, {"n": "Sofía Campos", "e": "sofia.campos@correo.example", "st": "confirmado", "src": "instagram", "ago": 4}, {"n": "Andrea Torres", "e": "andrea.torres@correo.example", "st": "confirmado", "src": "pagina", "ago": 7}, {"n": "Mateo Salinas", "e": "mateo.salinas@correo.example", "st": "confirmado", "src": "ads", "ago": 1}, {"n": "Camila Rojas", "e": "camila.rojas@correo.example", "st": "confirmado", "src": "mailing", "ago": 4}, {"n": "Bruno Díaz", "e": "bruno.diaz@correo.example", "st": "confirmado", "src": "pagina", "ago": 7}, {"n": "Paula Vega", "e": "paula.vega@correo.example", "st": "confirmado", "src": "instagram", "ago": 1}]}, {"n": "Demo en vivo: Musa para agencias", "b": 1, "d": 0, "h": null, "mi": 0, "plat": "zoom", "link": "https://zoom.us/", "cap": 50, "dur": 30, "desc": "Demo de 30 minutos: de un brief a un carrusel publicado, con flows y reportes por marca.", "regs": [{"n": "Lucía Mendoza", "e": "lucia.mendoza@correo.example", "st": "confirmado", "src": "pagina", "ago": 1}, {"n": "Carlos Quispe", "e": "carlos.quispe@correo.example", "st": "confirmado", "src": "ads", "ago": 4}, {"n": "Valeria Ríos", "e": "valeria.rios@correo.example", "st": "confirmado", "src": "mailing", "ago": 7}, {"n": "Diego Paredes", "e": "diego.paredes@correo.example", "st": "confirmado", "src": "pagina", "ago": 1}, {"n": "Sofía Campos", "e": "sofia.campos@correo.example", "st": "confirmado", "src": "instagram", "ago": 4}, {"n": "Andrea Torres", "e": "andrea.torres@correo.example", "st": "confirmado", "src": "pagina", "ago": 7}, {"n": "Mateo Salinas", "e": "mateo.salinas@correo.example", "st": "confirmado", "src": "ads", "ago": 1}, {"n": "Camila Rojas", "e": "camila.rojas@correo.example", "st": "confirmado", "src": "mailing", "ago": 4}, {"n": "Bruno Díaz", "e": "bruno.diaz@correo.example", "st": "confirmado", "src": "pagina", "ago": 7}, {"n": "Paula Vega", "e": "paula.vega@correo.example", "st": "confirmado", "src": "instagram", "ago": 1}, {"n": "Jorge Salazar", "e": "jorge.salazar@correo.example", "st": "confirmado", "src": "pagina", "ago": 4}, {"n": "Fernanda Luna", "e": "fernanda.luna@correo.example", "st": "confirmado", "src": "ads", "ago": 7}]}, {"n": "Q&A: viajes lentos por el sur", "b": 4, "d": -6, "h": 20, "mi": 0, "plat": "meet", "link": "https://meet.google.com/", "cap": 120, "dur": 60, "desc": "Respondemos en vivo sus preguntas sobre la ruta por Arequipa, Colca y Puno.", "att": 41, "regs": [{"n": "Lucía Mendoza", "e": "lucia.mendoza@correo.example", "st": "no_asistio", "src": "pagina", "ago": 1}, {"n": "Carlos Quispe", "e": "carlos.quispe@correo.example", "st": "asistio", "src": "ads", "ago": 4}, {"n": "Valeria Ríos", "e": "valeria.rios@correo.example", "st": "asistio", "src": "mailing", "ago": 7}, {"n": "Diego Paredes", "e": "diego.paredes@correo.example", "st": "no_asistio", "src": "pagina", "ago": 1}, {"n": "Sofía Campos", "e": "sofia.campos@correo.example", "st": "asistio", "src": "instagram", "ago": 4}, {"n": "Andrea Torres", "e": "andrea.torres@correo.example", "st": "asistio", "src": "pagina", "ago": 7}, {"n": "Mateo Salinas", "e": "mateo.salinas@correo.example", "st": "no_asistio", "src": "ads", "ago": 1}, {"n": "Camila Rojas", "e": "camila.rojas@correo.example", "st": "asistio", "src": "mailing", "ago": 4}, {"n": "Bruno Díaz", "e": "bruno.diaz@correo.example", "st": "asistio", "src": "pagina", "ago": 7}, {"n": "Paula Vega", "e": "paula.vega@correo.example", "st": "no_asistio", "src": "instagram", "ago": 1}, {"n": "Jorge Salazar", "e": "jorge.salazar@correo.example", "st": "asistio", "src": "pagina", "ago": 4}, {"n": "Fernanda Luna", "e": "fernanda.luna@correo.example", "st": "asistio", "src": "ads", "ago": 7}, {"n": "Iván Ramos", "e": "ivan.ramos@correo.example", "st": "no_asistio", "src": "mailing", "ago": 1}, {"n": "Rocío Chávez", "e": "rocio.chavez@correo.example", "st": "asistio", "src": "pagina", "ago": 4}]}], "ads": [{"n": "Colección invierno · ventas", "b": 2, "net": "meta", "obj": "Ventas", "st": "active", "bud": 3000, "spend": 1840, "s": -12, "e": 18, "impr": 214000, "clicks": 4280, "res": 118, "lbl": "compras", "rev": 21240, "aud": "Lookalike clientes 1%", "type": "seasonal"}, {"n": "Cata de cafés · inscripciones", "b": 3, "net": "tt", "obj": "Leads", "st": "active", "bud": 800, "spend": 430, "s": -5, "e": 1, "impr": 96000, "clicks": 2100, "res": 38, "lbl": "inscritos", "rev": 0, "aud": "Intereses café · Lima", "type": "event"}, {"n": "Webinar IA para pymes · leads", "b": 1, "net": "li", "obj": "Leads", "st": "active", "bud": 1500, "spend": 960, "s": -9, "e": 2, "impr": 41000, "clicks": 610, "res": 62, "lbl": "inscritos", "rev": 0, "aud": "Dueños de pymes · Perú", "type": "event"}, {"n": "Remarketing página del webinar", "b": 1, "net": "meta", "obj": "Leads", "st": "active", "bud": 400, "spend": 120, "s": -3, "e": 2, "impr": 18000, "clicks": 390, "res": 21, "lbl": "inscritos", "rev": 0, "aud": "Visitantes de la página", "type": "event"}, {"n": "Suscriptores de YouTube", "b": 4, "net": "gg", "obj": "Reconocimiento", "st": "active", "bud": 1200, "spend": 700, "s": -20, "e": 10, "impr": 380000, "clicks": 5200, "res": 640, "lbl": "suscriptores", "rev": 0, "aud": "Viajeros 25-40", "type": "general"}, {"n": "Black Friday −30 %", "b": 2, "net": "tt", "obj": "Ventas", "st": "active", "ui": "Programada", "bud": 2500, "spend": 0, "s": 18, "e": 21, "impr": 0, "clicks": 0, "res": 0, "lbl": "compras", "rev": 0, "aud": "Clientes + lookalike", "type": "seasonal"}, {"n": "Pack Instagram", "b": 5, "net": "meta", "obj": "Ventas", "st": "completed", "ui": "Pausada", "bud": 600, "spend": 310, "s": -25, "e": -2, "impr": 52000, "clicks": 700, "res": 9, "lbl": "compras", "rev": 1710, "aud": "Intereses belleza · Lima", "type": "general"}], "areas": [{"key": "mk", "n": "Marketing", "lead": "Carla Vega", "d": "Valida todo lo que sale y contrata agencias", "p": 9, "val": true}, {"key": "rrhh", "n": "Recursos humanos", "lead": "Paola Ríos", "d": "Employer branding y comunicación interna con plantillas", "p": 4}, {"key": "inno", "n": "Innovación", "lead": "Marco Torres", "d": "Demo days, pilotos y contenido de producto nuevo", "p": 5}, {"key": "prod", "n": "Producto", "lead": "Lucía Flores", "d": "Lanzamientos de la app y nuevas funciones", "p": 7}, {"key": "exp", "n": "Experiencia", "lead": "Rosa Mejía", "d": "Eventos y experiencia de cliente", "p": 4}], "approvals": [{"t": "Post lanzamiento App 3.0", "area": "prod", "by": "Agencia externa", "ck": [1, 1, 1, 1, 0], "st": "pendiente", "tpl": 0, "checks": [["Logo y márgenes", 1], ["Colores de la guía", 1], ["Tipografía", 1], ["Tono de voz", 1], ["Claims legales", 0]]}, {"t": "Afiche employer branding", "area": "rrhh", "by": "Paola Ríos · con plantilla", "ck": [1, 1, 1, 1, 1], "st": "pendiente", "tpl": 1, "checks": [["Logo y márgenes", 1], ["Colores de la guía", 1], ["Tipografía", 1], ["Tono de voz", 1], ["Claims legales", 1]]}, {"t": "Invitación al evento de clientes", "area": "exp", "by": "Agencia externa", "ck": [1, 0, 1, 1, 1], "st": "cambios", "tpl": 3, "cm": "Usar el color secundario de la guía en el botón.", "checks": [["Logo y márgenes", 1], ["Colores de la guía", 0], ["Tipografía", 1], ["Tono de voz", 1], ["Claims legales", 1]]}, {"t": "Video demo day", "area": "inno", "by": "Marco Torres", "ck": [1, 1, 1, 1, 1], "st": "aprobado", "tpl": 2, "checks": [["Logo y márgenes", 1], ["Colores de la guía", 1], ["Tipografía", 1], ["Tono de voz", 1], ["Claims legales", 1]]}], "playbooks": [{"cat": "Lanzamiento", "name": "Lanzamiento de producto", "d": "Teaser, día D, pauta y mailing coordinados", "uses": 6, "steps": [{"d": -21, "t": "Brief y objetivo de la campaña", "link": "planear/briefs", "who": "Ejecutivo de cuentas"}, {"d": -18, "t": "Concepto creativo y moodboard", "link": "crear/disenos", "who": "Director creativo"}, {"d": -14, "t": "Piezas: teaser, post, story y reel en todos los formatos", "link": "crear/disenos", "who": "Pixel (agente)"}, {"d": -10, "t": "Landing con formulario de interesados", "link": "vender/formularios", "who": "Automatizador"}, {"d": -7, "t": "Secuencia de 3 correos", "link": "crear/mailing", "who": "Kai (agente)"}, {"d": -5, "t": "Campaña de ads con 3 audiencias", "link": "anunciar/campanas", "who": "Trafficker"}, {"d": -2, "t": "Aprobación del cliente en el portal", "link": "clientes/portal", "who": "Cliente"}, {"d": 0, "t": "Publicación coordinada en todas las redes", "link": "planear/calendario", "who": "Flow"}, {"d": 7, "t": "Reporte de resultados al cliente", "link": "medir/reportes", "who": "Flow"}]}, {"cat": "Evento", "name": "Webinar o evento online", "d": "Inscripción, recordatorios con countdown y seguimiento", "uses": 4, "steps": [{"d": -20, "t": "Crear el evento y su página pública", "link": "crear/eventos", "who": "Community manager"}, {"d": -18, "t": "Piezas de difusión con countdown", "link": "crear/disenos", "who": "Pixel (agente)"}, {"d": -14, "t": "Correo de invitación a la base", "link": "crear/mailing", "who": "Kai (agente)"}, {"d": -7, "t": "Ads de inscripción", "link": "anunciar/campanas", "who": "Trafficker"}, {"d": -1, "t": "Recordatorio 24 h y 1 h antes", "link": "crear/mailing", "who": "Flow"}, {"d": 0, "t": "Sala de espera y evento en vivo", "link": "crear/eventos", "who": "Anfitrión"}, {"d": 1, "t": "Grabación + correo a asistentes y no asistentes", "link": "crear/mailing", "who": "Flow"}, {"d": 2, "t": "Leads calientes al CRM", "link": "vender/oportunidades", "who": "Flow"}]}, {"cat": "Ventas", "name": "Seguimiento de propuesta", "d": "Que ninguna cotización se enfríe", "uses": 11, "steps": [{"d": 0, "t": "Enviar cotización para firma", "link": "vender/cotizaciones", "who": "Ejecutivo de cuentas"}, {"d": 2, "t": "Recordatorio amable por correo", "link": "crear/mailing", "who": "Kai (agente)"}, {"d": 5, "t": "Mandar un caso de éxito parecido", "link": "conversar/bandeja", "who": "Ejecutivo de cuentas"}, {"d": 7, "t": "Llamada de cierre", "link": "vender/oportunidades", "who": "Director de cuentas"}, {"d": 10, "t": "Loop: oferta con fecha límite", "link": "vender/loops", "who": "Flow"}]}, {"cat": "Crisis", "name": "Comentario negativo que escala", "d": "Protocolo de respuesta y escalamiento", "uses": 2, "steps": [{"d": 0, "t": "Alerta: sentimiento negativo sobre el umbral", "link": "conversar/bandeja", "who": "Kai (agente)"}, {"d": 0, "t": "Pausar publicaciones programadas de la marca", "link": "planear/calendario", "who": "Flow"}, {"d": 0, "t": "Respuesta con plantilla aprobada por el cliente", "link": "conversar/bandeja", "who": "Community manager"}, {"d": 1, "t": "Escalar al cliente si sigue creciendo", "link": "clientes/portal", "who": "Director de cuentas"}, {"d": 3, "t": "Reporte del caso y aprendizajes", "link": "medir/reportes", "who": "Community manager"}]}, {"cat": "Cliente nuevo", "name": "Onboarding de cliente", "d": "De contrato firmado a primer mes publicado", "uses": 5, "steps": [{"d": 0, "t": "Contrato y fee firmados", "link": "clientes/fees", "who": "Ejecutivo de cuentas"}, {"d": 1, "t": "Kickoff y brief maestro", "link": "planear/briefs", "who": "Ejecutivo de cuentas"}, {"d": 2, "t": "Extraer su sistema de diseño", "link": "crear/marcas", "who": "Pixel (agente)"}, {"d": 3, "t": "Conectar sus redes y su bandeja", "link": "configuracion/integraciones", "who": "Automatizador"}, {"d": 5, "t": "Calendario del primer mes", "link": "planear/calendario", "who": "Estratega"}, {"d": 7, "t": "Invitarlo a su portal", "link": "clientes/portal", "who": "Ejecutivo de cuentas"}]}, {"cat": "Contenido recurrente", "name": "Mes de contenido always-on", "d": "12 posts, 8 stories y 4 reels por marca", "uses": 18, "steps": [{"d": -10, "t": "Ideas del mes desde Investigación", "link": "planear/investigacion", "who": "Estratega"}, {"d": -8, "t": "Copys en lote", "link": "crear/copys", "who": "Kai (agente)"}, {"d": -6, "t": "Piezas por lote con CSV", "link": "crear/disenos", "who": "Pixel (agente)"}, {"d": -3, "t": "Aprobación en bloque del cliente", "link": "clientes/portal", "who": "Cliente"}, {"d": 0, "t": "Programar todo el mes", "link": "planear/calendario", "who": "Flow"}, {"d": 30, "t": "Reporte mensual", "link": "medir/reportes", "who": "Flow"}]}, {"cat": "Temporada", "name": "Black Friday", "d": "Precalentamiento, día D y remarketing", "uses": 3, "steps": [{"d": -15, "t": "Base de ofertas del cliente", "link": "planear/briefs", "who": "Ejecutivo de cuentas"}, {"d": -10, "t": "Piezas de oferta por lote", "link": "crear/disenos", "who": "Pixel (agente)"}, {"d": -7, "t": "Lista de espera por mailing", "link": "crear/mailing", "who": "Kai (agente)"}, {"d": -3, "t": "Ads de precalentamiento", "link": "anunciar/campanas", "who": "Trafficker"}, {"d": 0, "t": "Ofertas en vivo cada 3 horas", "link": "planear/calendario", "who": "Flow"}, {"d": 2, "t": "Remarketing a carritos y clics", "link": "anunciar/audiencias", "who": "Trafficker"}]}], "designs": [{"name": "Carrusel · 5 errores del CRM", "w": 1080, "h": 1350, "b": 1, "bg": "{C1}", "html": "<div data-layer-id=\"fondo\" data-layer-name=\"fondo\" data-layer-kind=\"shape\"></div>\n<div data-layer-id=\"acento\" data-layer-name=\"acento\" data-layer-kind=\"shape\"></div>\n<div data-layer-id=\"numero\" data-layer-name=\"numero\" data-layer-kind=\"text\">5</div>\n<div data-layer-id=\"titulo\" data-layer-name=\"titulo\" data-layer-kind=\"text\">errores que matan tu CRM</div>\n<div data-layer-id=\"bajada\" data-layer-name=\"bajada\" data-layer-kind=\"text\">Y cómo evitarlos sin cambiar de herramienta.</div>\n<div data-layer-id=\"marca\" data-layer-name=\"marca\" data-layer-kind=\"text\">{B}</div>\n<div data-layer-id=\"boton\" data-layer-name=\"boton\" data-layer-kind=\"shape\"></div>\n<div data-layer-id=\"boton_t\" data-layer-name=\"boton_t\" data-layer-kind=\"text\">Desliza →</div>", "css": "@import url(\"https://fonts.googleapis.com/css2?family=Syne:wght@600;800&family=Inter:wght@400;600;700&family=Fraunces:opsz,wght@9..144,600;9..144,800&display=swap\");\n\n[data-layer-id=\"fondo\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 0px;\n  top: 0px;\n  width: 1080px;\n  height: 1350px;\n  background-color: {C1};\n}\n\n[data-layer-id=\"acento\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 0px;\n  top: 0px;\n  width: 1080px;\n  height: 18px;\n  background-color: {C2};\n}\n\n[data-layer-id=\"numero\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 72px;\n  top: 90px;\n  width: 700px;\n  height: 560px;\n  font-family: 'Syne', sans-serif;\n  font-weight: 800;\n  font-size: 560px;\n  line-height: 1;\n  color: {C2};\n}\n\n[data-layer-id=\"titulo\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 72px;\n  top: 690px;\n  width: 936px;\n  height: 320px;\n  font-family: 'Syne', sans-serif;\n  font-weight: 800;\n  font-size: 88px;\n  line-height: 1.02;\n  color: {INK1};\n}\n\n[data-layer-id=\"bajada\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 72px;\n  top: 1030px;\n  width: 860px;\n  height: 120px;\n  font-family: 'Inter', sans-serif;\n  font-size: 38px;\n  line-height: 1.35;\n  color: {INK1};\n  opacity: 0.72;\n}\n\n[data-layer-id=\"marca\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 72px;\n  top: 1222px;\n  width: 560px;\n  height: 50px;\n  font-family: 'Inter', sans-serif;\n  font-weight: 700;\n  font-size: 32px;\n  color: {INK1};\n}\n\n[data-layer-id=\"boton\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 744px;\n  top: 1200px;\n  width: 264px;\n  height: 76px;\n  background-color: {C2};\n  border-radius: 38px;\n}\n\n[data-layer-id=\"boton_t\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 744px;\n  top: 1218px;\n  width: 264px;\n  height: 40px;\n  font-family: 'Inter', sans-serif;\n  font-weight: 700;\n  font-size: 30px;\n  text-align: center;\n  color: {INK2};\n}\n"}, {"name": "Historia · Menú de temporada", "w": 1080, "h": 1920, "b": 3, "bg": "{C1}", "html": "<div data-layer-id=\"fondo\" data-layer-name=\"fondo\" data-layer-kind=\"shape\"></div>\n<div data-layer-id=\"circulo\" data-layer-name=\"circulo\" data-layer-kind=\"shape\"></div>\n<div data-layer-id=\"marca\" data-layer-name=\"marca\" data-layer-kind=\"text\">{B}</div>\n<div data-layer-id=\"titulo\" data-layer-name=\"titulo\" data-layer-kind=\"text\">Menú de temporada</div>\n<div data-layer-id=\"item1\" data-layer-name=\"item1\" data-layer-kind=\"text\">Latte de calabaza ········ S/ 14</div>\n<div data-layer-id=\"item2\" data-layer-name=\"item2\" data-layer-kind=\"text\">Chai especiado ··········· S/ 12</div>\n<div data-layer-id=\"item3\" data-layer-name=\"item3\" data-layer-kind=\"text\">Pie de manzana ··········· S/ 16</div>\n<div data-layer-id=\"item4\" data-layer-name=\"item4\" data-layer-kind=\"text\">Filtrado de altura ······· S/ 11</div>\n<div data-layer-id=\"boton\" data-layer-name=\"boton\" data-layer-kind=\"shape\"></div>\n<div data-layer-id=\"boton_t\" data-layer-name=\"boton_t\" data-layer-kind=\"text\">Reserva tu mesa</div>", "css": "@import url(\"https://fonts.googleapis.com/css2?family=Syne:wght@600;800&family=Inter:wght@400;600;700&family=Fraunces:opsz,wght@9..144,600;9..144,800&display=swap\");\n\n[data-layer-id=\"fondo\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 0px;\n  top: 0px;\n  width: 1080px;\n  height: 1920px;\n  background-color: {C1};\n}\n\n[data-layer-id=\"circulo\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 620px;\n  top: -180px;\n  width: 640px;\n  height: 640px;\n  background-color: {C2};\n  border-radius: 50%;\n  opacity: 0.9;\n}\n\n[data-layer-id=\"marca\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 80px;\n  top: 120px;\n  width: 600px;\n  height: 50px;\n  font-family: 'Inter', sans-serif;\n  font-weight: 700;\n  font-size: 34px;\n  letter-spacing: 4px;\n  text-transform: uppercase;\n  color: {INK1};\n}\n\n[data-layer-id=\"titulo\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 80px;\n  top: 520px;\n  width: 920px;\n  height: 300px;\n  font-family: 'Fraunces', serif;\n  font-weight: 800;\n  font-size: 136px;\n  line-height: 1;\n  color: {INK1};\n}\n\n[data-layer-id=\"item1\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 80px;\n  top: 900px;\n  width: 920px;\n  height: 70px;\n  font-family: 'Inter', sans-serif;\n  font-size: 44px;\n  color: {INK1};\n}\n\n[data-layer-id=\"item2\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 80px;\n  top: 1000px;\n  width: 920px;\n  height: 70px;\n  font-family: 'Inter', sans-serif;\n  font-size: 44px;\n  color: {INK1};\n}\n\n[data-layer-id=\"item3\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 80px;\n  top: 1100px;\n  width: 920px;\n  height: 70px;\n  font-family: 'Inter', sans-serif;\n  font-size: 44px;\n  color: {INK1};\n}\n\n[data-layer-id=\"item4\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 80px;\n  top: 1200px;\n  width: 920px;\n  height: 70px;\n  font-family: 'Inter', sans-serif;\n  font-size: 44px;\n  color: {INK1};\n}\n\n[data-layer-id=\"boton\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 80px;\n  top: 1640px;\n  width: 920px;\n  height: 120px;\n  background-color: {C2};\n  border-radius: 60px;\n}\n\n[data-layer-id=\"boton_t\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 80px;\n  top: 1676px;\n  width: 920px;\n  height: 50px;\n  font-family: 'Inter', sans-serif;\n  font-weight: 700;\n  font-size: 40px;\n  text-align: center;\n  color: {INK2};\n}\n"}, {"name": "Lookbook otoño · portada", "w": 1080, "h": 1350, "b": 2, "bg": "{C2}", "html": "<div data-layer-id=\"fondo\" data-layer-name=\"fondo\" data-layer-kind=\"shape\"></div>\n<div data-layer-id=\"foto\" data-layer-name=\"foto\" data-layer-kind=\"shape\"></div>\n<div data-layer-id=\"anio\" data-layer-name=\"anio\" data-layer-kind=\"text\">LOOKBOOK</div>\n<div data-layer-id=\"titulo\" data-layer-name=\"titulo\" data-layer-kind=\"text\">Otoño hecho a mano</div>\n<div data-layer-id=\"bajada\" data-layer-name=\"bajada\" data-layer-kind=\"text\">Alpaca, lana y tejidos de Cusco. 24 prendas.</div>\n<div data-layer-id=\"marca\" data-layer-name=\"marca\" data-layer-kind=\"text\">{B}</div>", "css": "@import url(\"https://fonts.googleapis.com/css2?family=Syne:wght@600;800&family=Inter:wght@400;600;700&family=Fraunces:opsz,wght@9..144,600;9..144,800&display=swap\");\n\n[data-layer-id=\"fondo\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 0px;\n  top: 0px;\n  width: 1080px;\n  height: 1350px;\n  background-color: {C2};\n}\n\n[data-layer-id=\"foto\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 540px;\n  top: 0px;\n  width: 540px;\n  height: 1350px;\n  background-image: linear-gradient(160deg, {C1} 0%, {C3} 100%);\n}\n\n[data-layer-id=\"anio\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 72px;\n  top: 96px;\n  width: 400px;\n  height: 50px;\n  font-family: 'Inter', sans-serif;\n  font-weight: 700;\n  font-size: 30px;\n  letter-spacing: 6px;\n  color: {C1};\n}\n\n[data-layer-id=\"titulo\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 72px;\n  top: 420px;\n  width: 430px;\n  height: 440px;\n  font-family: 'Fraunces', serif;\n  font-weight: 800;\n  font-size: 120px;\n  line-height: 1;\n  color: {C1};\n}\n\n[data-layer-id=\"bajada\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 72px;\n  top: 900px;\n  width: 420px;\n  height: 160px;\n  font-family: 'Inter', sans-serif;\n  font-size: 32px;\n  line-height: 1.4;\n  color: {INK2};\n}\n\n[data-layer-id=\"marca\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 72px;\n  top: 1230px;\n  width: 420px;\n  height: 50px;\n  font-family: 'Inter', sans-serif;\n  font-weight: 700;\n  font-size: 30px;\n  color: {C1};\n}\n"}, {"name": "Post · Webinar en vivo", "w": 1080, "h": 1080, "b": 1, "bg": "{C1}", "html": "<div data-layer-id=\"fondo\" data-layer-name=\"fondo\" data-layer-kind=\"shape\"></div>\n<div data-layer-id=\"halo\" data-layer-name=\"halo\" data-layer-kind=\"shape\"></div>\n<div data-layer-id=\"badge\" data-layer-name=\"badge\" data-layer-kind=\"shape\"></div>\n<div data-layer-id=\"badge_t\" data-layer-name=\"badge_t\" data-layer-kind=\"text\">EN VIVO</div>\n<div data-layer-id=\"titulo\" data-layer-name=\"titulo\" data-layer-kind=\"text\">IA para pymes</div>\n<div data-layer-id=\"fecha\" data-layer-name=\"fecha\" data-layer-kind=\"text\">Jueves · 7:00 p. m. · gratis</div>\n<div data-layer-id=\"bajada\" data-layer-name=\"bajada\" data-layer-kind=\"text\">Contenido semanal con IA sin perder la voz de tu marca.</div>\n<div data-layer-id=\"marca\" data-layer-name=\"marca\" data-layer-kind=\"text\">{B}</div>", "css": "@import url(\"https://fonts.googleapis.com/css2?family=Syne:wght@600;800&family=Inter:wght@400;600;700&family=Fraunces:opsz,wght@9..144,600;9..144,800&display=swap\");\n\n[data-layer-id=\"fondo\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 0px;\n  top: 0px;\n  width: 1080px;\n  height: 1080px;\n  background-color: {C1};\n}\n\n[data-layer-id=\"halo\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 560px;\n  top: 520px;\n  width: 760px;\n  height: 760px;\n  background-color: {C2};\n  border-radius: 50%;\n  opacity: 0.18;\n}\n\n[data-layer-id=\"badge\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 72px;\n  top: 72px;\n  width: 190px;\n  height: 56px;\n  background-color: {C2};\n  border-radius: 28px;\n}\n\n[data-layer-id=\"badge_t\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 72px;\n  top: 84px;\n  width: 190px;\n  height: 32px;\n  font-family: 'Inter', sans-serif;\n  font-weight: 700;\n  font-size: 24px;\n  text-align: center;\n  letter-spacing: 2px;\n  color: {INK2};\n}\n\n[data-layer-id=\"titulo\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 72px;\n  top: 300px;\n  width: 936px;\n  height: 300px;\n  font-family: 'Syne', sans-serif;\n  font-weight: 800;\n  font-size: 120px;\n  line-height: 1;\n  color: {INK1};\n}\n\n[data-layer-id=\"fecha\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 72px;\n  top: 640px;\n  width: 900px;\n  height: 60px;\n  font-family: 'Inter', sans-serif;\n  font-weight: 600;\n  font-size: 40px;\n  color: {C2};\n}\n\n[data-layer-id=\"bajada\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 72px;\n  top: 720px;\n  width: 820px;\n  height: 120px;\n  font-family: 'Inter', sans-serif;\n  font-size: 32px;\n  line-height: 1.4;\n  color: {INK1};\n  opacity: 0.75;\n}\n\n[data-layer-id=\"marca\"] {\n  position: absolute;\n  box-sizing: border-box;\n  left: 72px;\n  top: 968px;\n  width: 600px;\n  height: 44px;\n  font-family: 'Inter', sans-serif;\n  font-weight: 700;\n  font-size: 30px;\n  color: {INK1};\n}\n"}]}$K$::jsonb;
  uid uuid := auth.uid();
  v_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  v_owner text; v_by uuid;
  b text[] := '{}'; n text[] := '{}'; c1 text[] := '{}'; c2 text[] := '{}'; c3 text[] := '{}';
  rb text[]; rn text[]; rc jsonb[];
  e jsonb; x jsonb; i int; j int; v_id text; v_uuid uuid;
  cmap jsonb := '{}'; bmap jsonb := '{}'; qmap jsonb := '{}'; amap jsonb := '{}'; tpls text[] := '{}';
  v_html text; v_css text; v_bg text; v_start timestamptz; v_m0 date := date_trunc('month', now())::date;
  done text[] := '{}';
begin
  if p_ws is null then return jsonb_build_object('seeded', false); end if;
  if uid is null and v_claims is not null and coalesce(v_claims->>'role', '') <> 'service_role' then raise exception 'not allowed'; end if;
  if uid is not null and not exists (select 1 from workspace_members where workspace_id = p_ws and user_id = uid and role in ('owner', 'admin', 'editor')) then
    return jsonb_build_object('seeded', false, 'reason', 'role');
  end if;

  -- una sola vez por espacio
  update workspaces set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('demo_seeded_at', now())
   where id = p_ws and not (coalesce(data, '{}'::jsonb) ? 'demo_seeded_at')
  returning owner_id into v_owner;
  if not found then return jsonb_build_object('seeded', false); end if;
  begin v_by := coalesce(uid, v_owner::uuid); exception when others then v_by := uid; end;

  /* ── marcas: las del espacio o, si no hay, las de ejemplo ── */
  select array_agg(id order by created_at, id), array_agg(name order by created_at, id), array_agg(colors order by created_at, id)
    into rb, rn, rc from brands where workspace_id = p_ws;
  if rb is null then
    for e in select * from jsonb_array_elements(K->'brands') loop
      v_id := 'brand_' || substr(md5(p_ws || ':demo:' || (e->>'name')), 1, 20);
      insert into brands (id, name, workspace_id, colors, fonts, relationship_status, account_health, is_house, is_demo, crm_notes)
      values (v_id, e->>'name', p_ws, e->'colors', e->'fonts', e->>'rel', e->>'health', coalesce((e->>'house')::boolean, false), true, e->>'notes')
      on conflict (id) do nothing;
      insert into workspace_demo_items values (p_ws, 'brands', v_id) on conflict do nothing;
      b := b || v_id::text; n := n || (e->>'name'); c1 := c1 || (e->'colors'->>0); c2 := c2 || (e->'colors'->>1); c3 := c3 || (e->'colors'->>2);
    end loop;
    done := done || 'brands'::text;
  else
    for i in 1..6 loop
      j := ((i - 1) % cardinality(rb)) + 1;
      b := b || rb[j]::text; n := n || rn[j]::text;
      c1 := c1 || coalesce(v2_demo_color(rc[j], 0), K->'brands'->(i - 1)->'colors'->>0);
      c2 := c2 || coalesce(v2_demo_color(rc[j], 1), K->'brands'->(i - 1)->'colors'->>1);
      c3 := c3 || coalesce(v2_demo_color(rc[j], 2), v2_demo_color(rc[j], 1), K->'brands'->(i - 1)->'colors'->>2);
    end loop;
  end if;

  /* ── Vender: personas y oportunidades ── */
  if v_by is not null and not exists (select 1 from crm_contacts where workspace_id = p_ws) then
    for e in select * from jsonb_array_elements(K->'contacts') loop
      insert into crm_contacts (workspace_id, brand_id, brand_name, first_name, last_name, email, phone, job_title, company, status, created_by, origin_source, created_at, updated_at)
      values (p_ws, case when e ? 'b' then b[(e->>'b')::int] end, case when e ? 'b' then n[(e->>'b')::int] else e->>'company' end,
              e->>'fn', e->>'ln', e->>'email', e->>'phone', e->>'job', case when e ? 'b' then n[(e->>'b')::int] else e->>'company' end,
              'active', v_by, 'ejemplo', now() - make_interval(days => (e->>'ago')::int + 20), now() - make_interval(days => (e->>'ago')::int))
      returning id into v_uuid;
      cmap := cmap || jsonb_build_object(e->>'key', v_uuid);
      insert into workspace_demo_items values (p_ws, 'crm_contacts', v_uuid::text) on conflict do nothing;
    end loop;
    done := done || 'crm_contacts'::text;
  end if;
  if not exists (select 1 from crm_deals where workspace_id = p_ws) then
    for e in select * from jsonb_array_elements(K->'deals') loop
      insert into crm_deals (workspace_id, brand_id, primary_contact_id, title, stage, value, final_value, currency, probability, next_step_note, next_step_date, created_by, expected_close_date)
      values (p_ws, b[(e->>'b')::int], (cmap->>(e->>'c'))::uuid, e->>'t', e->>'st', (e->>'v')::numeric,
              case when e->>'st' = 'approved' then (e->>'v')::numeric end, 'PEN', (e->>'p')::int, e->>'next', current_date + 3, v_by, current_date + 21)
      returning id into v_uuid;
      insert into workspace_demo_items values (p_ws, 'crm_deals', v_uuid::text) on conflict do nothing;
    end loop;
    done := done || 'crm_deals'::text;
  end if;

  /* ── Crear › Diseños (con los colores de cada marca) ── */
  if not exists (select 1 from templates where workspace_id = p_ws and deleted_at is null and coalesce(is_brand_manual, false) = false) then
    for e in select * from jsonb_array_elements(K->'designs') loop
      i := (e->>'b')::int;
      v_id := 'tpl_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
      v_html := replace(replace(replace(replace(replace(replace(replace(e->>'html', '{C1}', c1[i]), '{C2}', c2[i]), '{C3}', c3[i]), '{INK1}', v2_demo_ink(c1[i])), '{INK2}', v2_demo_ink(c2[i])), '{B}', n[i]), '{B1}', n[1]);
      v_css := replace(replace(replace(replace(replace(e->>'css', '{C1}', c1[i]), '{C2}', c2[i]), '{C3}', c3[i]), '{INK1}', v2_demo_ink(c1[i])), '{INK2}', v2_demo_ink(c2[i]));
      v_bg := replace(replace(e->>'bg', '{C1}', c1[i]), '{C2}', c2[i]);
      insert into templates (id, name, workspace_id, user_id, created_by, slug, data)
      values (v_id, e->>'name', p_ws, v_by, v_by, left(regexp_replace(lower(e->>'name'), '[^a-z0-9]+', '-', 'g'), 60) || '-' || substr(v_id, 5, 6),
        jsonb_build_object('id', v_id, 'name', e->>'name', 'engine', 'html', 'width', (e->>'w')::int, 'height', (e->>'h')::int, 'html', '', 'css', '',
          'brandId', b[i], 'workspaceId', p_ws, 'isBrandManual', false, 'styles', '[]'::jsonb, 'comments', '[]'::jsonb, 'versions', '[]'::jsonb, 'components', '[]'::jsonb,
          'variables', jsonb_build_object('bindings', '{}'::jsonb, 'variables', '[]'::jsonb, 'collections', '[]'::jsonb),
          'metadata', jsonb_build_object('createdAt', now(), 'createdBy', v_by, 'updatedAt', now(), 'demo', true),
          'frames', jsonb_build_array(jsonb_build_object('id', 'frame_' || substr(md5(v_id), 1, 12), 'x', 0, 'y', 0, 'name', e->>'name',
            'width', (e->>'w')::int, 'height', (e->>'h')::int, 'background', v_bg, 'html', v_html, 'css', v_css))));
      tpls := tpls || v_id::text;
      insert into workspace_demo_items values (p_ws, 'templates', v_id) on conflict do nothing;
    end loop;
    done := done || 'templates'::text;
  end if;

  /* ── Planear › Calendario y contenidos ── */
  if not exists (select 1 from content_calendar where workspace_id = p_ws) then
    for e in select * from jsonb_array_elements(K->'cal') loop
      v_id := 'cc_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
      insert into content_calendar (id, workspace_id, scheduled_date, scheduled_time, topic, copy, kind, channels, status, brand_id, visual_type, published_at, created_by, template_id)
      values (v_id, p_ws, v_m0 + ((e->>'day')::int - 1), (e->>'time')::time, e->>'topic', e->>'copy',
              case when e->>'vt' = 'reel' then 'video' else 'organic' end,
              array(select jsonb_array_elements_text(e->'ch')), e->>'st', b[(e->>'b')::int], e->>'vt',
              case when e->>'st' = 'aprobado' and v_m0 + ((e->>'day')::int - 1) < current_date then (v_m0 + ((e->>'day')::int - 1))::timestamptz + (e->>'time')::time end,
              v_by,
              case when e->>'topic' like '5 errores%' and cardinality(tpls) > 0 then tpls[1] end);
      insert into workspace_demo_items values (p_ws, 'content_calendar', v_id) on conflict do nothing;
    end loop;
    done := done || 'content_calendar'::text;
  end if;

  /* ── Inicio › Mi trabajo ── */
  if v_by is not null and not exists (select 1 from design_kanban_tasks where workspace_id = p_ws) then
    for e in select * from jsonb_array_elements(K->'tasks') loop
      v_id := 'task_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
      insert into design_kanban_tasks (id, workspace_id, account_id, created_by, assigned_to, title, brand_id, type, format, status, priority, deadline, source)
      values (v_id, p_ws, v_by, v_by::text, v_by::text, e->>'t', b[(e->>'b')::int], e->>'type', e->>'fmt', e->>'st', (e->>'prio')::int, current_date + (e->>'due')::int, 'ejemplo');
      insert into workspace_demo_items values (p_ws, 'design_kanban_tasks', v_id) on conflict do nothing;
    end loop;
    done := done || 'design_kanban_tasks'::text;
  end if;

  /* ── Agentes › Segundo cerebro ── */
  if not exists (select 1 from brain_notes where workspace_id = p_ws) then
    for e in select * from jsonb_array_elements(K->'notes') loop
      v_uuid := null;
      insert into brain_notes (workspace_id, slug, title, body_md, entity_type, source, created_by)
      values (p_ws, 'demo-' || substr(md5(e->>'t'), 1, 10), replace(replace(replace(e->>'t', '{B1}', n[1]), '{B2}', n[2]), '{B3}', n[3]),
              replace(replace(replace(e->>'body', '{B1}', n[1]), '{B2}', n[2]), '{B3}', n[3]), e->>'et', 'human', v_by)
      on conflict do nothing
      returning id into v_uuid;
      if v_uuid is not null then insert into workspace_demo_items values (p_ws, 'brain_notes', v_uuid::text) on conflict do nothing; end if;
    end loop;
    done := done || 'brain_notes'::text;
  end if;

  /* ── Conversar › Bandeja ── */
  if not exists (select 1 from social_inbox where workspace_id = p_ws) then
    for e in select * from jsonb_array_elements(K->'inbox') loop
      v_uuid := null;
      insert into social_inbox (workspace_id, provider, external_id, kind, platform, author_name, author_handle, content, occurred_at, status, reply_text, replied_at, raw)
      values (p_ws, 'ejemplo', 'demo_' || p_ws || '_' || md5(e->>'txt'), e->>'k', e->>'pf', e->>'who', e->>'h', e->>'txt', now() - make_interval(mins => (e->>'m')::int),
              e->>'st', e->>'reply', case when e ? 'reply' then now() - make_interval(mins => (e->>'m')::int - 11) end, '{"demo": true}'::jsonb)
      on conflict do nothing
      returning id into v_uuid;
      if v_uuid is not null then insert into workspace_demo_items values (p_ws, 'social_inbox', v_uuid::text) on conflict do nothing; end if;
    end loop;
    done := done || 'social_inbox'::text;
  end if;

  /* ── Crear › Copys ── */
  if not exists (select 1 from copy_recipes where workspace_id = p_ws) then
    for e in select * from jsonb_array_elements(K->'copys') loop
      v_id := 'crx_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
      insert into copy_recipes (id, workspace_id, type, name, content, source, owner_id, brand_id, usage_count)
      values (v_id, p_ws, e->>'type', e->>'n', e->>'c', 'humano', v_by, b[(e->>'b')::int], (e->>'use')::int);
      insert into workspace_demo_items values (p_ws, 'copy_recipes', v_id) on conflict do nothing;
    end loop;
    done := done || 'copy_recipes'::text;
  end if;

  /* ── Planear › Briefs ── */
  if not exists (select 1 from briefs where workspace_id = p_ws) then
    for e in select * from jsonb_array_elements(K->'briefs') loop
      insert into briefs (workspace_id, brand_id, brand_name, title, status, objective, audience, deliverables, content, budget, due_date, created_by)
      values (p_ws, b[(e->>'b')::int], n[(e->>'b')::int], e->>'t', e->>'st', e->>'obj', e->>'aud', e->'del',
              jsonb_build_object('fields', e->'f', 'requested_by', e->>'by'), (e->>'budget')::numeric, current_date + 30, v_by)
      returning id into v_uuid;
      bmap := bmap || jsonb_build_object(e->>'key', v_uuid);
      insert into workspace_demo_items values (p_ws, 'briefs', v_uuid::text) on conflict do nothing;
    end loop;
    done := done || 'briefs'::text;
  end if;

  /* ── Vender › Cotizaciones (con su tarifario) ── */
  if not exists (select 1 from workspace_rates where workspace_id = p_ws) then
    insert into workspace_rates (workspace_id, label, price, unit, sort)
    select p_ws, r->>'l', (r->>'p')::numeric, r->>'u', (o - 1)::int from jsonb_array_elements(K->'rates') with ordinality as t(r, o);
  end if;
  if not exists (select 1 from crm_quotes where workspace_id = p_ws) then
    for e in select * from jsonb_array_elements(K->'quotes') loop
      insert into crm_quotes (workspace_id, number, brand_id, brand_name, title, status, items, currency, total, sent_at, signed_at, signed_by_name, created_by)
      values (p_ws, e->>'n', b[(e->>'b')::int], n[(e->>'b')::int], e->>'t', e->>'st', e->'items', 'PEN', (e->>'total')::numeric,
              case when e ? 'sent' then now() - make_interval(days => (e->>'sent')::int) end,
              case when e->>'st' = 'Firmada' then now() - make_interval(days => (e->>'sent')::int - 2) end, e->>'signed', v_by)
      returning id into v_uuid;
      qmap := qmap || jsonb_build_object(e->>'key', v_uuid);
      insert into workspace_demo_items values (p_ws, 'crm_quotes', v_uuid::text) on conflict do nothing;
    end loop;
    done := done || 'crm_quotes'::text;
  end if;

  /* ── Clientes › Fees y proyectos ── */
  if not exists (select 1 from workspace_fees where workspace_id = p_ws) then
    for e in select * from jsonb_array_elements(K->'fees') loop
      insert into workspace_fees (workspace_id, brand_id, brand_name, monthly_fee, currency, hours_included, hours_used, pieces_included, pieces_delivered, out_of_scope)
      values (p_ws, b[(e->>'b')::int], n[(e->>'b')::int], (e->>'fee')::numeric, 'PEN', (e->>'hi')::numeric, (e->>'hu')::numeric, (e->>'pi')::int, (e->>'pd')::int, e->'out')
      returning id into v_uuid;
      insert into workspace_demo_items values (p_ws, 'workspace_fees', v_uuid::text) on conflict do nothing;
    end loop;
    done := done || 'workspace_fees'::text;
  end if;
  if not exists (select 1 from workspace_projects where workspace_id = p_ws) then
    for e in select * from jsonb_array_elements(K->'projects') loop
      insert into workspace_projects (workspace_id, brand_id, brand_name, name, status, brief_id, quote_id, starts_on, ends_on, budget, spent, hours_planned, hours_used, team, progress, created_by)
      values (p_ws, b[(e->>'b')::int], n[(e->>'b')::int], e->>'n', e->>'st', (bmap->>(e->>'brief'))::uuid, (qmap->>(e->>'quote'))::uuid,
              current_date + (e->>'s')::int, current_date + (e->>'e')::int, (e->>'bud')::numeric, (e->>'sp')::numeric, (e->>'hp')::numeric, (e->>'hu')::numeric, e->'team', (e->>'prog')::int, v_by)
      returning id into v_uuid;
      insert into workspace_demo_items values (p_ws, 'workspace_projects', v_uuid::text) on conflict do nothing;
      for x in select * from jsonb_array_elements(e->'tasks') loop
        insert into workspace_project_tasks (workspace_id, project_id, title, kind, status, due)
        values (p_ws, v_uuid, x->>0, x->>1, x->>2, current_date + (x->>3)::int);
      end loop;
    end loop;
    done := done || 'workspace_projects'::text;
  end if;

  /* ── Crear › Formularios (las respuestas reales llegan a Vender › Personas) ── */
  if not exists (select 1 from workspace_forms where workspace_id = p_ws) then
    for e in select * from jsonb_array_elements(K->'forms') loop
      insert into workspace_forms (workspace_id, name, published, response_count, schema, created_by)
      values (p_ws, e->>'n', (e->>'pub')::boolean, (e->>'leads')::int,
              jsonb_build_object('brand_id', b[(e->>'b')::int], 'type', e->>'type',
                'fields', (select jsonb_agg(jsonb_build_object('name', f->>0, 'label', f->>1, 'type', f->>2, 'required', (f->>3)::boolean)) from jsonb_array_elements(e->'f') f)), v_by)
      returning id into v_uuid;
      insert into workspace_demo_items values (p_ws, 'workspace_forms', v_uuid::text) on conflict do nothing;
    end loop;
    done := done || 'workspace_forms'::text;
  end if;

  /* ── Crear › Mailing y secuencias (nunca quedan programados ni activos) ── */
  if not exists (select 1 from workspace_mailings where workspace_id = p_ws) then
    for e in select * from jsonb_array_elements(K->'mails') loop
      insert into workspace_mailings (workspace_id, subject, status, send_at, kind, content, created_by)
      values (p_ws, replace(e->>'subj', '{B1}', n[1]), e->>'st', (current_date + (e->>'d')::int)::timestamptz + time '09:00', 'campana',
              jsonb_build_object('name', e->>'n', 'brand_id', b[(e->>'b')::int], 'seg', (e->>'seg') || ' · ' || n[(e->>'b')::int], 'tpl', e->>'tpl',
                'sent', coalesce((e->>'sent')::int, 0), 'open', coalesce((e->>'open')::numeric, 0), 'click', coalesce((e->>'click')::numeric, 0), 'demo', true), v_by)
      returning id into v_uuid;
      insert into workspace_demo_items values (p_ws, 'workspace_mailings', v_uuid::text) on conflict do nothing;
    end loop;
    for e in select * from jsonb_array_elements(K->'seqs') loop
      insert into workspace_mailings (workspace_id, subject, status, kind, content, created_by)
      values (p_ws, e->>'n', e->>'st', 'secuencia',
              jsonb_build_object('name', e->>'n', 'brand_id', b[(e->>'b')::int],
                'groups', (select jsonb_agg(to_jsonb(g || ' · ' || n[(e->>'b')::int])) from jsonb_array_elements_text(e->'groups') g),
                'steps', (select jsonb_agg(jsonb_set(s, '{subject}', to_jsonb(replace(s->>'subject', '{B1}', n[1])))) from jsonb_array_elements(e->'steps') s),
                'inside', (e->>'inside')::int, 'done', (e->>'done')::int, 'demo', true), v_by)
      returning id into v_uuid;
      insert into workspace_demo_items values (p_ws, 'workspace_mailings', v_uuid::text) on conflict do nothing;
    end loop;
    done := done || 'workspace_mailings'::text;
  end if;

  /* ── Crear › Eventos e inscritos (sin publicar fuera de Musa) ── */
  if not exists (select 1 from workspace_events where workspace_id = p_ws) then
    for e in select * from jsonb_array_elements(K->'events') loop
      v_start := case when e->>'h' is null then date_trunc('hour', now()) + interval '3 hours'
                      else ((current_date + (e->>'d')::int)::timestamp + make_interval(hours => (e->>'h')::int, mins => (e->>'mi')::int)) at time zone 'America/Lima' end;
      insert into workspace_events (workspace_id, name, date, starts_at, duration_min, platform, link, capacity, brand_id, description, attendees, published, created_by)
      values (p_ws, e->>'n', (v_start at time zone 'America/Lima')::date, v_start, (e->>'dur')::int, e->>'plat', e->>'link', (e->>'cap')::int, b[(e->>'b')::int], e->>'desc',
              coalesce((e->>'att')::int, 0), false, v_by)
      returning id into v_uuid;
      insert into workspace_demo_items values (p_ws, 'workspace_events', v_uuid::text) on conflict do nothing;
      insert into workspace_event_regs (workspace_id, event_id, name, email, status, source, created_at)
      select p_ws, v_uuid, r->>'n', r->>'e', r->>'st', r->>'src', now() - make_interval(days => (r->>'ago')::int) from jsonb_array_elements(e->'regs') r;
    end loop;
    done := done || 'workspace_events'::text;
  end if;

  /* ── Anunciar › Campañas (métricas de ejemplo en el brief; las reales llegan al conectar las cuentas) ── */
  if not exists (select 1 from campaigns where workspace_id = p_ws) then
    for e in select * from jsonb_array_elements(K->'ads') loop
      insert into campaigns (workspace_id, brand_id, name, status, campaign_type, budget_plan_usd, brief)
      values (p_ws, b[(e->>'b')::int], e->>'n', e->>'st', e->>'type', (e->>'bud')::numeric,
              jsonb_build_object('net', e->>'net', 'obj', e->>'obj', 'st', e->>'ui', 'spend', (e->>'spend')::numeric, 'impr', (e->>'impr')::bigint, 'clicks', (e->>'clicks')::bigint,
                'res', (e->>'res')::int, 'resLbl', e->>'lbl', 'rev', (e->>'rev')::numeric, 'aud', e->>'aud',
                'start', current_date + (e->>'s')::int, 'end', current_date + (e->>'e')::int, 'demo', true)::text)
      returning id into v_id;
      insert into workspace_demo_items values (p_ws, 'campaigns', v_id) on conflict do nothing;
    end loop;
    done := done || 'campaigns'::text;
  end if;

  /* ── Planear › Playbooks ── */
  if not exists (select 1 from workspace_playbooks where workspace_id = p_ws) then
    for e in select * from jsonb_array_elements(K->'playbooks') loop
      insert into workspace_playbooks (workspace_id, category, name, description, steps, uses, created_by)
      values (p_ws, e->>'cat', e->>'name', e->>'d', e->'steps', (e->>'uses')::int, v_by)
      returning id into v_uuid;
      insert into workspace_demo_items values (p_ws, 'workspace_playbooks', v_uuid::text) on conflict do nothing;
    end loop;
    done := done || 'workspace_playbooks'::text;
  end if;

  /* ── Organización › Áreas y aprobaciones ── */
  if not exists (select 1 from workspace_areas where workspace_id = p_ws) then
    for e in select * from jsonb_array_elements(K->'areas') loop
      insert into workspace_areas (workspace_id, name, description, lead_name, member_count, validates, created_by)
      values (p_ws, e->>'n', e->>'d', e->>'lead', (e->>'p')::int, coalesce((e->>'val')::boolean, false), v_by)
      returning id into v_uuid;
      amap := amap || jsonb_build_object(e->>'key', v_uuid);
      insert into workspace_demo_items values (p_ws, 'workspace_areas', v_uuid::text) on conflict do nothing;
    end loop;
    done := done || 'workspace_areas'::text;
  end if;
  if not exists (select 1 from workspace_approvals where workspace_id = p_ws) and amap <> '{}'::jsonb then
    for e in select * from jsonb_array_elements(K->'approvals') loop
      insert into workspace_approvals (workspace_id, piece_id, piece_name, piece_type, brand_name, requested_by, status, area_id, checks, comment, requested_at, decided_at, created_by)
      values (p_ws, case when cardinality(tpls) > (e->>'tpl')::int then tpls[(e->>'tpl')::int + 1] end, e->>'t', 'template', n[1], e->>'by', e->>'st',
              (amap->>(e->>'area'))::uuid, e->'checks', e->>'cm', now() - interval '1 day', case when e->>'st' <> 'pendiente' then now() - interval '2 hours' end, v_by)
      returning id into v_uuid;
      insert into workspace_demo_items values (p_ws, 'workspace_approvals', v_uuid::text) on conflict do nothing;
    end loop;
    done := done || 'workspace_approvals'::text;
  end if;

  return jsonb_build_object('seeded', true, 'modules', to_jsonb(done),
    'flows_empty', not exists (select 1 from flows where workspace_id = p_ws));
end $$;

revoke all on function public.v2_demo_seed(text) from public, anon;
grant execute on function public.v2_demo_seed(text) to authenticated, service_role;
revoke all on function public.v2_demo_ink(text) from public, anon;
revoke all on function public.v2_demo_color(jsonb, int) from public, anon;
