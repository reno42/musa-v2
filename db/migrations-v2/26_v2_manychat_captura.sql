-- ═══════════════════════════════════════════════════════════════════════════
-- Migración 26 — ManyChat: custom_fields + channel_ids en crm_contacts,
-- y tipos de interacción nuevos para la captura automática del bot.
--
-- Qué agrega:
-- 1. crm_contacts.custom_fields (jsonb): los custom fields que ManyChat manda
--    por suscriptor (merge por clave — nunca pisa lo que escribió el equipo).
-- 2. crm_contacts.channel_ids (text[]): identidad cruzada por canal — entradas
--    "manychat:<canal>:<id de suscriptor>" para unificar al mismo humano que
--    llega por Instagram, WhatsApp, TikTok o el sitio web embebido.
-- 3. Índice GIN sobre tags (el match de identidad filtra contactos con el tag
--    «manychat» en todo el workspace).
-- 4. crm_interactions: extiende el CHECK con mensaje, story_reply, form_web
--    (la captura ManyChat) y like/follow/unfollow (reservados: ManyChat no
--    los entrega hoy, quedan listos para entradas manuales).
--
-- Sin esta migración el sistema degrada con gracia: el webhook guarda la
-- entrada en social_inbox igual, el contacto se crea sin custom_fields ni
-- channel_ids y la interacción cae a «otro» con aviso en la respuesta.
--
-- CÓMO USARLO: Dashboard › SQL Editor → correr. Éxito = "Success. No rows
-- returned".
-- Ejecutado: 2026-11-07 (Success. No rows returned).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.crm_contacts add column if not exists custom_fields jsonb not null default '{}'::jsonb;
alter table public.crm_contacts add column if not exists channel_ids text[] not null default '{}'::text[];

create index if not exists crm_contacts_tags_gin on public.crm_contacts using gin (tags);

alter table public.crm_interactions drop constraint if exists crm_interactions_interaction_type_check;
alter table public.crm_interactions add constraint crm_interactions_interaction_type_check
  check (interaction_type = any (array[
    'primer_contacto'::text, 'reunion'::text, 'llamada'::text, 'email'::text,
    'whatsapp'::text, 'propuesta_enviada'::text, 'revision'::text, 'aprobacion'::text,
    'publicacion'::text, 'pago'::text, 'follow_up'::text, 'objecion'::text,
    'otro'::text, 'comentario'::text,
    'mensaje'::text, 'story_reply'::text, 'form_web'::text,
    'like'::text, 'follow'::text, 'unfollow'::text
  ]));
