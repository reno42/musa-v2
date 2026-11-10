---
name: musa-inicio
description: Inicio de Musa. Resumen del día, pendientes que necesitan acción, tablero de tareas (Mi trabajo) y el Segundo cerebro con la memoria del espacio. Úsala para saber qué está pasando, organizar trabajo o guardar y leer notas.
module: inicio
---

# Inicio · resumen, mi trabajo y segundo cerebro

Inicio es la vista de arranque: qué pasó, qué falta y qué sabe el espacio. Tres secciones:

- **Resumen**: KPIs del espacio, acciones pendientes y actividad reciente.
- **Mi trabajo**: tablero kanban de tareas (cards) por marca, con responsables, prioridad y fecha.
- **Segundo cerebro**: la memoria del espacio. Cada marca, diseño, pieza, brief, campaña, website, publicación, oportunidad, skill, agente y nota es un nodo enlazable con `[[Nombre]]`. Además registra **cómo opera cada persona**: qué pantallas abre y cuánto trabaja en cada una, qué crea, edita, publica o borra en cualquier módulo, qué botones usa, qué te pide a ti (su IA), dónde fallaste y qué corrigió a mano después de tu trabajo.

## Flujos

**Antes de coordinar con tu humano (siempre al empezar una sesión de trabajo)**
1. `brain_operator({ workspaceId })` → cómo opera la persona: módulos y horario, marcas e ítems que más toca, flujo típico, lo que te pide, tus errores, sus correcciones a tu trabajo y los aprendizajes guardados. Lee `markdown` y ajusta tu forma de trabajar a eso (formatos, tono, pasos, qué no hacer).
2. `brain_timeline({ workspaceId, since })` → qué hizo desde tu última sesión, o `brain_timeline({ workspaceId, entityId })` para la historia de un ítem.
3. Cuando la persona corrija tu trabajo, te diga una preferencia o veas en `correcciones_humanas` que cambió algo que hiciste, guarda el aprendizaje con `brain_learn({ workspaceId, lesson, kind, module?, brandId? })`. Una frase accionable («En Café Altura prefiere titulares de máximo 6 palabras»). Así la próxima IA no repite el error.

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
- `brain_operator`: perfil de cómo opera tu humano en el espacio (módulos, horario, flujo, IA, correcciones, aprendizajes).
- `brain_timeline`: línea de tiempo de acciones de la persona y de su IA, filtrable por módulo, ítem, marca, quién y desde.
- `brain_learn`: guarda un aprendizaje sobre cómo trabajar con la persona (preferencia, corrección, proceso, evitar, contexto).

## Reglas

- No dupliques en notas lo que ya está en el CRM, el calendario o las marcas: enlázalo con `[[ ]]`.
- Las cards son trabajo de personas y agentes; no cambies el responsable sin que te lo pidan.
- El perfil de operación es de la persona con la que hablas: cada quien ve solo lo suyo. No guardes en `brain_learn` datos sensibles (claves, salud, datos de pago), solo cómo trabajar mejor.

## Ejemplos

- "¿Qué tengo pendiente hoy?"
- "Crea una tarea para Pixel: carrusel de 5 errores del CRM para Kuna, prioridad alta, para el viernes"
- "Guarda en el cerebro que Café Altura no quiere fotos con personas en sus piezas"
- "¿Cómo trabajo yo en Musa? ¿Qué hago más y qué te corrijo?"
- "¿Qué hice ayer en el calendario?"
