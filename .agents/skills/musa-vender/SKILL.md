---
name: musa-vender
description: Vender en Musa (CRM). Oportunidades y su embudo comercial, personas y empresas (marcas cliente), interacciones, cotizaciones con firma, tarifario, fees mensuales con horas, proyectos con tareas y accesos al portal del cliente. Úsala para registrar, mover o revisar cualquier cosa comercial.
module: vender
---

# Vender · CRM, oportunidades y clientes

## Cómo está armado

- **Empresas** = marcas del espacio con su relación comercial (lead o cliente), prioridad, salud de la cuenta y próximo seguimiento.
- **Personas** = contactos, cada uno ligado a una marca, con estado (lead, activo…).
- **Oportunidades** = deals con etapa, valor, moneda, probabilidad, fecha de cierre y **entregables** (qué piezas incluye). Mover la etapa **es** el embudo.
- **Interacciones** = reuniones, llamadas, propuestas enviadas: la línea de tiempo comercial.
- **Cotizaciones**: ítems del tarifario del espacio, total y una página pública donde el cliente firma.
- **Fees**: monto mensual por marca con horas y piezas incluidas, consumo y pedidos fuera de alcance.
- **Proyectos**: lo que se trabaja para cada marca (brief, cotización, playbook, fechas, presupuesto, horas, avance) con sus tareas.
- **Portal del cliente**: acceso para que el cliente apruebe piezas y briefs sin crear cuenta.

## Flujos

**Ver el panorama (siempre primero)**
- `get_crm_overview({ workspaceId })`: marcas con su salud (en riesgo si no hay oportunidades abiertas y 30+ días sin contacto), personas, oportunidades con avance de producción y resumen del pipeline.

**Registrar una oportunidad**
1. Si la marca no existe: `brands_create` (skill `musa-marcas`) o `create_crm_contact({ brandName })`, que la crea.
2. `create_crm_deal({ workspaceId, brandId, title, stage, value, currency, probability, expectedCloseDate, deliverables })`.
3. Contacto principal: `create_crm_contact` y `update_crm_deal({ primaryContactId })`.

**Avanzar o cerrar**
- `update_crm_deal({ workspaceId, dealId, stage })`. Al ganar, `finalValue`; al perder, `lostReason`.
- Ajustar una línea de entregables: `update_crm_deliverable`.
- Cada contacto real se registra: `log_interaction({ brandId, contactId?, interactionType, notes, interactionDate })`.

**Seguimiento de cuentas en riesgo**
1. `get_crm_overview` → marcas `at_risk`.
2. `list_interactions({ brandId })` para ver el último contacto.
3. Propón el siguiente paso; `update_crm_brand({ brandId, nextFollowUpAt, crmNotes })`.

**Dar acceso al portal a un cliente**
1. `provision_client_access({ workspaceId, email, name, brandId })`: crea la cuenta del cliente (o rota su contraseña). La contraseña se muestra **una sola vez**: entrégasela a la persona en ese momento.
2. `list_guests`, `update_client_profile`, `reset_client_password`, `revoke_guest` para administrarlos.
- Solo administradores de la agencia pueden hacerlo.

**Cotizar**
1. `list_rates({ workspaceId })` → tarifario. Si no existe o hay que cambiarlo: `rates_save` (solo admins).
2. `quote_save({ workspaceId, title, brandId, dealId?, currency, items: [{ label, price, qty, unit }] })` → queda en Borrador con número y total.
3. Revisada por la persona: `quote_set_status({ id, status: "Enviada" })` → devuelve la `url` donde el cliente firma. Envíala con `email_send` (skill `musa-mailing-eventos`) si te lo piden.
4. Cuando el cliente firma, el estado pasa solo a Firmada; también puedes marcar Rechazada o Vencida.

**Fees y horas**
- `list_fees`, `fee_save({ brandId, monthlyFee, currency, hoursIncluded, piecesIncluded })`.
- Registrar consumo: `fee_log({ id, hours?, pieces?, outOfScope?: ["Video extra para TikTok"] })`; `clearOutOfScope: true` cuando se resolvieron.

**Proyectos**
- `list_projects({ workspaceId, brandId?, withTasks: true })`.
- `project_save({ name, brandId, briefId?, quoteId?, status, startsOn, endsOn, budget, hoursPlanned, progress })`. Estados: Planificando, En producción, En revisión, Pausado, Entregado, Cerrado.
- Tareas: `project_task_save({ projectId, title, due, status: "todo" | "doing" | "done" })`; `delete: true` la borra.
- Desde un playbook: `playbook_apply` (skill `musa-planear`).

**Growth loops (mecánica de crecimiento por marca)**
- `list_growth_loops` y `save_growth_loop({ brandName, macro: "acq" | "ret" | "mon", sub, values })`. Se ven en Vender › Loops y Medir › Loops (más en `musa-medir`).

## Herramientas

Panorama y oportunidades
- `get_crm_overview`, `list_crm_deals`, `create_crm_deal`, `update_crm_deal`, `update_crm_deliverable`.

Personas y empresas
- `create_crm_contact`, `update_crm_contact`, `update_crm_brand`.
- `capture_social_contact`: desde la bandeja de redes (skill `musa-redes`).

Interacciones
- `log_interaction`, `list_interactions`.

Portal del cliente
- `provision_client_access`, `list_guests`, `update_client_profile`, `reset_client_password`, `revoke_guest`.

Loops
- `list_growth_loops`, `save_growth_loop`.

Cotizaciones y tarifario
- `list_quotes`, `quote_save`, `quote_set_status`, `list_rates`, `rates_save`.

Fees
- `list_fees`, `fee_save`, `fee_log`.

Proyectos
- `list_projects`, `project_save`, `project_task_save`.

## Reglas

- Nunca inventes montos, probabilidades ni fechas: pregúntalos.
- Una cotización se marca Enviada solo cuando la persona la revisó.
- El portal del cliente nunca muestra datos comerciales internos; no los pongas en su perfil.
- Las credenciales del cliente se muestran una vez: no las guardes en notas.
- Los límites de personas dependen del plan.

## Ejemplos

- "Registra la oportunidad con Nativa: rediseño de marca, 4500 USD, 60 %, cierre fin de mes"
- "¿Qué clientes están en riesgo y qué les propongo?"
- "Dale acceso al portal a la gerente de marketing de Café Altura"
- "Cotiza 12 posts y 4 reels para Kuna en soles"
