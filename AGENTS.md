# AGENTS.md — Futuraria Design

Este repositorio usa MCP para operar Musa. Lee solo la guía del trabajo que vas a hacer; el catálogo completo de herramientas está en `SKILL.md` como referencia, no como lectura inicial.

## Entrada rápida

1. Para trabajo que depende de Supabase/MCP, llama `harness_healthcheck`. Si falla, informa el check fallido antes de mutar datos remotos. Para análisis local de código, no hace falta cargar el estado de una cuenta.
2. Identifica el resultado pedido. Usa el skill pertinente en `.agents/skills/`: `musa-design`, `musa-copywriting`, `musa-motion`, `musa-contacts` o `musa-config`. Un pedido puede usar varios en secuencia; pasa IDs de artefactos entre fases.
3. Consulta contexto de workspace, marca, template o CRM solo cuando el pedido lo necesita. No cargues todos los playbooks ni el catálogo MCP de entrada.
4. Ejecuta con un solo agente por defecto. Usa subagentes o revisión independiente cuando el trabajo sea amplio, tenga efectos externos importantes o una comprobación objetiva haya fallado. La verificación del resultado es obligatoria; el número de agentes no lo es.

## Invariantes

- No edites un template existente solo porque esté abierto: la solicitud debe identificarlo o referirse claramente a él.
- Para un diseño nuevo, verifica que el artefacto exista, tenga contenido y corresponda al pedido; renderiza cuando la calidad visual importe.
- Para cambios de CRM o configuración, relee el recurso y compara el estado final. No incluyas claves en prompts, logs ni respuestas.
- Para trabajos largos, guarda estado e IDs por lote; comunica resultados confirmados y errores concretos. No presentes una descripción del agente como prueba de ejecución.
- Si usas tareas del Kanban, respeta una feature activa por cuenta y los requisitos del cierre que expone el MCP. No marques `done` sin una verificación registrada.

## Referencias por necesidad

- Arquitectura y convenciones del harness: `docs/harness/` (solo al modificar el harness).
- Playbooks de diseño: `get_playbook({ name })` o `docs/GRAPH_PLAYBOOK_*.md` (solo el elegido).
- Herramientas MCP: búsqueda por nombre en `SKILL.md` o `tools/list` (solo el grupo necesario).
- Cómo agregar acciones o módulos: `docs/MUSA_ROUTING.md`.
- GraphForge: `graphforge/graphs/` muestra los flujos; actualmente no ejecuta rutas.
