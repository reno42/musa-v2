---
name: musa-mailing-eventos
description: Mailing, eventos y formularios en Musa. Crear, probar y enviar campañas y secuencias de correo (o convertir un diseño en correo), eventos online con página de inscripción y formularios de captura que alimentan el CRM. Úsala para correos, newsletters, secuencias de bienvenida, webinars y lanzamientos.
module: crear/mailing
---

# Mailing, eventos y formularios

## Qué hay en el módulo

- **Mailing**: campañas (un envío) y secuencias (varios correos por días). Se envían con el proveedor de correo del espacio (Resend, Postmark o el de Musa con cupo). Se guardan en borrador; el envío ocurre solo cuando la persona lo pide.
- **Eventos**: eventos online con página pública `/e/<slug>`, inscripción y archivo de calendario (.ics).
- **Formularios**: formularios de captura con página pública `/f/<token>`; cada respuesta entra al CRM como contacto.

## Flujos

**Campaña de correo**
1. `resolve_brand` y `get_brand_strategy` para la voz.
2. Redacta asunto y cuerpo (skill `musa-copy`).
3. `mailing_save({ workspaceId, kind: "campana", name, subject, html, brandId, segment? })`. `html` es el correo completo con CSS en línea; o usa `tpl` (news, promo, welcome, reactiv, invite) para una base.
4. `mailing_test({ workspaceId, id })` manda una prueba a la persona.
5. Para enviar: `mailing_send({ workspaceId, id })` sin `confirm` solo cuenta destinatarios. Muéstrale el número y, si la persona dice que sí, `mailing_send({ id, confirm: true })`. Si responde `nextOffset`, repite con `offset` hasta terminar. Para programar: `at` (fecha futura, solo Resend).

**Un diseño convertido en correo**
- `use_design_as_mailing({ workspaceId, templateId, name, subject })`: arma el HTML del correo desde el diseño, con CSS en línea para clientes de correo.

**Secuencia (bienvenida, nutrición, reactivación)**
- `mailing_save({ workspaceId, kind: "secuencia", name, steps: [{ d: 0, subject, tpl }, { d: 3, ... }] })`. `d` es el día desde que la persona entra.
- Activarla (envía el día 0 y programa el resto): `sequence_activate({ id, confirm: true })`, solo con aprobación.

**Evento**
1. `event_save({ workspaceId, name, startsAt: "2026-12-03T19:00:00-05:00", durationMin, platform, link, capacity, brandId, description, coverUrl })`.
2. Con `publish: true` crea la página pública; la respuesta trae la `url`.
3. Para promocionarlo: pieza (skill `musa-diseno`), correo de invitación (`tpl: "invite"`; el segmento `Inscritos · <nombre del evento>` le escribe a los inscritos) y publicación (skill `musa-redes`).
4. `list_events` (con cantidad de inscritos y URL) y `list_event_registrations({ eventId })`.

**Formulario de captura**
1. `form_save({ workspaceId, name, brandId, fields: [{ name: "nombre" }, { name: "email", type: "email" }, { name: "empresa" }], published: true })` → `url` pública.
2. `list_forms` y `list_form_responses({ formId })` para ver lo que llegó (cada respuesta ya está en el CRM).

**Un correo suelto** (enlace de cotización, brief o evento)
- `email_send({ workspaceId, to, subject, html, confirm: true })` cuando la persona lo pida.
- `get_email_settings` dice qué proveedor y remitente usa el espacio.

## Herramientas

Mailing
- `list_mailings`, `mailing_save`, `use_design_as_mailing`.
- `mailing_test`, `mailing_send`, `sequence_activate`, `email_send`, `get_email_settings`.

Eventos
- `event_save`, `list_events`, `list_event_registrations`.

Formularios
- `list_forms`, `form_save`, `list_form_responses`.

## Reglas

- Enviar, programar o activar correos solo cuando la persona lo pidió y vio cuántos destinatarios son (`confirm: true`).
- `startsAt` siempre con zona horaria.
- Respeta el segmento que pide la persona; si no lo dice, pregunta a quién va.

## Ejemplos

- "Arma el newsletter de diciembre de Café Altura con las 3 novedades del mes"
- "Convierte el diseño de Black Friday en un correo para toda la base"
- "Crea el webinar 'IA para agencias' el 3 de diciembre a las 7 pm de Lima y publica su página"
