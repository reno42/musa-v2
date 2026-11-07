---
name: musa-planear
description: Planear en Musa. Investigación con fuentes RSS y de X, encargos de contenido a partir de noticias, briefs de clientes, playbooks de campaña y el calendario de contenidos (ideas, piezas, fechas, canales). Úsala para armar la grilla del mes, proponer ideas o convertir una noticia en contenido.
module: planear
---

# Planear · investigación, briefs, calendario y playbooks

## Qué hay en el módulo

- **Investigación**: fuentes (RSS, cuentas de X vía Nitter) que traen tarjetas de noticias por marca. Una tarjeta se convierte en un encargo para la IA.
- **Briefs**: lo que pide el cliente para un proyecto: objetivo, público, tono, entregables, fecha y presupuesto. Cada brief tiene una página pública donde el cliente lo completa sin crear cuenta.
- **Calendario**: la grilla de contenidos. Cada pieza es una fila con fecha, tema, canales, copy, diseño adjunto y estado (idea → borrador → aprobado → publicado).
- **Playbooks**: campañas repetibles (pasos con día relativo, módulo y responsable). Al aplicarlos a una marca crean un proyecto con sus tareas.

## Flujos

**Armar el calendario del mes**
1. `resolve_brand` para tono, público y pilares de la marca; si hay brief, léelo en `brain_vault({ workspaceId, brandId })`.
2. `list_calendar_entries({ workspaceId, from, to })` para no duplicar lo ya planificado.
3. Por cada idea: `add_content_idea({ workspaceId, brandId, scheduledDate, topic, channels, kind, campaign })`. Quedan en estado idea, visibles en Calendario al instante.
4. Muestra la grilla propuesta y espera aprobación antes de redactar o diseñar.
5. Aprobada la grilla: redacta con `musa-copy` y guarda con `update_content({ id, copy })`; diseña con `musa-diseno` y adjunta el diseño con `update_content({ id, templateId })`.

**De noticia a contenido**
1. `research_list_items({ workspaceId, status?, search? })` → tarjetas recientes.
2. `research_create_request({ workspaceId, itemId, networks, formats, includeDesign?, brandId? })` crea el encargo con el briefing resuelto.
3. El encargo aparece en `research_ai_tasks`; la IA que lo toma entrega con `research_ai_complete({ resumeToken, payload })`. Si tú misma vas a producirlo, hazlo y entrégalo en el mismo turno.
4. Marca la tarjeta con `research_update_item({ status: "used" })`, o `dismissed` si no sirve.

**Brief de un cliente**
1. `list_briefs({ workspaceId, brandId? })` para ver los existentes.
2. `brief_save({ workspaceId, title, brandId, objective, audience, tone, deliverables, dueDate, budget })` → devuelve la `url` pública: compártela con el cliente (o envíala con `email_send`, skill `musa-mailing-eventos`).
3. Al aprobarlo: `brief_save({ id, status: "aprobado" })`; cuando arranca el trabajo, `status: "en_proyecto"` y crea el proyecto (`project_save`, skill `musa-vender`).

**Playbooks**
- `list_playbooks` → `playbook_apply({ workspaceId, playbookId, brandId, startDate })` crea el proyecto con una tarea por paso, fechadas desde el día D.
- Crear o editar uno: `playbook_save({ name, category, steps: [{ d: -7, t: "Brief aprobado", link: "planear/briefs", who: "Cuentas" }] })`.

**Configurar fuentes**
- `research_add_source({ workspaceId, name, url, type?, includeKeywords?, brandId? })` para un RSS o una cuenta de X.
- `research_refresh_sources` trae novedades ahora (no hay refresco automático en esta versión).

## Herramientas

Investigación
- `research_list_sources`: fuentes del espacio.
- `research_add_source`: agrega un RSS o una cuenta de X.
- `research_update_source`: cambia nombre, palabras clave, marca o la pausa.
- `research_delete_source`: borra la fuente y sus tarjetas.
- `research_refresh_sources`: trae noticias nuevas ahora.
- `research_list_items`: tarjetas de noticias.
- `research_update_item`: marca una tarjeta como usada o descartada.
- `research_create_request`: convierte una tarjeta en encargo (redes × formatos).
- `research_ai_tasks`: bandeja de encargos pendientes.
- `research_ai_complete`: entrega un encargo.

Calendario
- `list_calendar_entries`: piezas del calendario (filtros por fecha, marca, estado).
- `add_content_idea`: agrega una idea con fecha y tema.
- `update_content`: escribe el copy, cambia fecha/canales/campaña, adjunta diseño, cambia estado.
- `delete_content`: borra una pieza (solo si lo piden).

Briefs y playbooks
- `list_briefs`, `brief_save`: briefs con su página pública.
- `list_playbooks`, `playbook_save`, `playbook_apply`: campañas repetibles.

## Reglas

- La grilla se aprueba antes de producir piezas.
- Publicar no es parte de planear: para publicar o programar usa `musa-redes`.
- Las fechas van en `YYYY-MM-DD` y en la zona horaria del espacio.

## Ejemplos

- "Arma el calendario de noviembre de Café Altura: 3 posts por semana en Instagram y LinkedIn"
- "Convierte la noticia de hoy sobre IA en un carrusel de LinkedIn para Kuna"
- "Agrega el blog de Marketing Directo como fuente de investigación para la marca Nativa"
- "Arma el brief del lanzamiento de Nativa y mándale el enlace a la clienta"
