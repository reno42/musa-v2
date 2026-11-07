---
name: musa-inicio
description: Inicio de Musa. Resumen del día, pendientes que necesitan acción, tablero de tareas (Mi trabajo) y el Segundo cerebro con la memoria del espacio. Úsala para saber qué está pasando, organizar trabajo o guardar y leer notas.
module: inicio
---

# Inicio · resumen, mi trabajo y segundo cerebro

Inicio es la vista de arranque: qué pasó, qué falta y qué sabe el espacio. Tres secciones:

- **Resumen**: KPIs del espacio, acciones pendientes y actividad reciente.
- **Mi trabajo**: tablero kanban de tareas (cards) por marca, con responsables, prioridad y fecha.
- **Segundo cerebro**: la memoria del espacio. Cada marca, diseño, pieza, brief, campaña, oportunidad y nota es un nodo enlazable con `[[Nombre]]`.

## Flujos

**"¿Qué tengo hoy?" / "Ponme al día"**
1. `get_dashboard_summary({ workspaceId })` → piezas publicadas, pipeline, alertas.
2. `list_pending_actions({ workspaceId })` → aprobaciones y respuestas que esperan a alguien.
3. `get_recent_activity({ workspaceId })` → qué se movió.
4. Resume en 5-8 líneas, con lo urgente primero.

**Crear o mover tareas (Mi trabajo)**
1. `studio_list_cards({ workspaceId, status? })` para ver el tablero.
2. `studio_create_card` con título, marca, brief, prioridad y fecha límite.
3. `studio_move_card` para cambiar de columna; `studio_update_card` para corregir campos; `studio_add_comment` para dejar decisiones o bloqueos en la card.
4. Si trabajaste en una card como agente, registra tu tiempo con `studio_log_agent_time` (skill `musa-agentes`).

**Leer la memoria antes de trabajar**
1. `brain_vault({ workspaceId, brandId?, bodies: false })` → índice de todo (liviano).
2. `search_notes({ workspaceId, query })` para encontrar algo puntual; `read_note({ workspaceId, slug })` para el texto completo.
3. `brain_digest` da las notas recientes agrupadas y el grafo de enlaces.

**Guardar lo aprendido**
- `brain_note_save({ workspaceId, title, body, folder?, brandId? })`. Usa `folder`: idea, brand, campaign, process o decision. Enlaza con `[[Nombre de marca]]`, `[[Nombre del diseño]]`, etc.; la respuesta trae los enlaces resueltos. Guarda decisiones, aprendizajes de campaña y preferencias del cliente, no copias de datos que ya viven en otro módulo.

## Herramientas

Resumen
- `get_dashboard_summary`: KPIs del espacio en una llamada.
- `list_pending_actions`: cola de "necesita tu acción" (aprobaciones, mensajes).
- `get_recent_activity`: movimientos recientes del tablero, piezas y diseños.

Mi trabajo (tablero)
- `studio_list_cards`: lista cards con filtros (marca, estado, prioridad, responsable).
- `studio_get_card`: detalle de una card con su historial.
- `studio_create_card`: crea una tarea.
- `studio_update_card`: edita campos permitidos (título, brief, tono, CTA, prioridad, fecha).
- `studio_move_card`: cambia de columna/estado.
- `studio_add_comment`: nota en el historial de la card.
- `studio_delete_card`: borra la card y su historial (irreversible; solo si lo piden).

Segundo cerebro
- `brain_vault`: el espacio completo (o una marca) con notas y enlaces resueltos.
- `brain_digest`: notas recientes por tipo y grafo de enlaces.
- `search_notes`: búsqueda en títulos y cuerpos.
- `read_note`: una nota completa por slug.
- `brain_note_save`: crea o actualiza una nota propia en markdown.

## Reglas

- No dupliques en notas lo que ya está en el CRM, el calendario o las marcas: enlázalo con `[[ ]]`.
- Las cards son trabajo de personas y agentes; no cambies el responsable sin que te lo pidan.

## Ejemplos

- "¿Qué tengo pendiente hoy?"
- "Crea una tarea para Pixel: carrusel de 5 errores del CRM para Kuna, prioridad alta, para el viernes"
- "Guarda en el cerebro que Café Altura no quiere fotos con personas en sus piezas"
