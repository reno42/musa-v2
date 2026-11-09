---
name: musa-agentes
description: Agentes en Musa. Cómo trabaja una IA dentro del espacio: tomar tareas del tablero, sesiones con bitácora, revisión entre agentes, bandejas de encargos de flows e investigación, registro de tiempo y costo, conexiones MCP de terceros y enseñarle a la persona con el cursor de Musa. Incluye Skills y Gobernanza.
module: agentes
---

# Agentes · trabajo de IA dentro de Musa

## Qué hay en el módulo

- **Chats y Computadoras**: los agentes del espacio (integrados o en su propia computadora) y sus conversaciones.
- **Skills de Musa**: estas guías. Son las mismas para todas las personas y en todos los planes; cada agente consulta la del módulo en que trabaja (`list_skills`, `get_skill`).
- **Skills propias** (Agentes › Skills › Mis skills): procesos que la persona arma como flujograma (constructor visual o Mermaid). Musa los convierte al instante, sin IA, en una skill con el qué, el cómo y la herramienta de Musa de cada paso. Son de un espacio: privadas o compartidas con el equipo; nunca con clientes. Aparecen en `list_skills` como `mine`.
- **Gobernanza**: políticas de IA del espacio (aprobación humana antes de publicar, límites de gasto, datos ocultos) y el registro de lo que hizo cada agente. Léelas con `list_governance` antes de actuar y respétalas siempre.

## Flujos

**Seguir una skill propia**
1. `list_skills()` → mira `mine`. Si el pedido calza con una (su `description` dice cuándo usarla), `get_skill({ name })`.
2. Sigue los pasos en orden. Cada paso trae el cómo y, si aplica, la herramienta de Musa exacta (y sus parámetros en la nota). En cada decisión toma el camino que corresponda; un subproceso te manda a otra skill con `get_skill` y vuelves.

**Crear o editar una skill propia** (cuando la persona te describe su proceso)
1. Pregunta en qué espacio va y si la quiere privada o compartida con su equipo.
2. Arma el flujograma en Mermaid: `([Inicio])`, `[Paso]`, `{¿Decisión?}` con salidas `-->|sí|` / `-->|no|`, `[[Subproceso]]`, `([Fin])`. Por cada paso agrega `%% @how ID: cómo se hace` y, si usa Musa, `%% @tool ID: herramienta` y `%% @toolnote ID: parámetros`.
3. `save_workspace_skill({ workspaceId, mermaid, meta: { name, when, goal, inputs, outputs, rules }, visibility })`. Revisa `issues`: corrige los errores (herramienta inexistente, decisión con una sola salida, pasos sueltos) y vuelve a guardar hasta `ready: true`.
4. Para cambiarla: `get_skill_flow({ name })` → edita el Mermaid → `save_workspace_skill({ id, mermaid })`. Para borrarla, con confirmación: `delete_workspace_skill({ id })`.

**Antes de actuar en un espacio**
1. `list_governance({ workspaceId })` → políticas activas y acciones recientes. Si una política prohíbe lo que te piden, no lo hagas y explícalo.
2. Al terminar algo relevante (publicar, enviar, cambiar datos de clientes), regístralo: `agent_activity_log({ workspaceId, agentName, action, verdict: "Permitido" | "Bloqueado" | "Pidió aprobación" })`.

**Agentes del espacio**
- `list_agents`; `agent_save({ name, role, template: "musa" | "claude" | "hermes" | "openclaw", model, brands, permissions })` crea o edita uno (`delete: true` lo quita).
- Políticas: `governance_rule_save({ rule, description, enabled })` (solo dueños o admins).

**Tomar trabajo del tablero (modo harness)**
1. `harness_get_context({ agentType, workspaceId })` → tu rol, reglas y contexto.
2. `harness_list_features({ workspaceId, status })` → tareas disponibles.
3. `harness_claim_feature({ taskId })` → la tomas (nadie más la toma).
4. `harness_start_session({ taskId, role, agentName, plan })`.
5. Trabaja con las skills de cada módulo. Escribe avances, decisiones y archivos en `harness_log_entry({ sessionId, entryType, content })`, no solo en el chat.
6. `harness_submit_for_review({ sessionId, summary })`.
7. Si estás bloqueado: `harness_release_feature`.
8. Registra tiempo y tokens: `studio_log_agent_time({ taskId, agentRole, durationMs, tokensUsed, aiModel })`.

**Revisar el trabajo de otro agente**
1. `harness_get_entries({ sessionId })` → bitácora del implementador.
2. `harness_evaluate_checkpoint` por cada criterio (aprobado o no, con notas).
3. `harness_complete_feature({ taskId, sessionId })` solo si todo pasa.
- Roles disponibles: `list_agent_roles`. Sesiones: `harness_list_sessions`, `harness_finish_session`.

**Atender encargos que esperan a tu IA**
- De flows: `flow_ai_tasks` → `flow_ai_complete` (skill `musa-automatizaciones`).
- De investigación: `research_ai_tasks` → `research_ai_complete` (skill `musa-planear`).

**Usar herramientas de otros servicios conectados**
- `list_workspace_integrations({ workspaceId })` → conexiones MCP y de modelos del espacio (sin credenciales).
- `call_workspace_mcp({ workspaceId, connectionId, toolName, arguments })`: las llaves se quedan en el servidor.

**Enseñarle a la persona**
- `ghost_perform({ task, workspaceId })`: el cursor de Musa hace la tarea en la pestaña abierta de la persona, de forma visible, para que aprenda. Sin pestaña abierta, la ejecuta directo.

**Lote de Musa (producción en bloque)**
- `process_daily_batch` muestra qué haría (simulación); `musa_batch_run({ workspaceId, dryRun? })` lo ejecuta ahora. No corre solo.

**Diagnóstico**
- `harness_healthcheck`, `harness_report_error`, `harness_list_errors`, `harness_get_runtime_events`, `harness_record_runtime_event`, `harness_dump_context`, `harness_list_orphaned_tasks`.

## Herramientas

Skills propias
- `save_workspace_skill`: crea o actualiza una skill propia desde Mermaid (o el modelo) y devuelve la validación.
- `get_skill_flow`: el flujograma editable de una skill propia.
- `delete_workspace_skill`: borra una skill propia (quien la creó o un admin).


Agentes y gobernanza
- `list_agents`, `agent_save`, `list_governance`, `governance_rule_save`, `agent_activity_log`.

Sesiones y tareas
- `harness_get_context`, `harness_list_features`, `harness_claim_feature`, `harness_release_feature`.
- `harness_start_session`, `harness_log_entry`, `harness_get_entries`, `harness_dump_context`.
- `harness_submit_for_review`, `harness_evaluate_checkpoint`, `harness_complete_feature`, `harness_finish_session`, `harness_list_sessions`.
- `harness_list_orphaned_tasks`, `list_agent_roles`.

Tiempo y costo
- `studio_log_agent_time`, `studio_list_models` (modelos y precios).

Encargos
- `flow_ai_tasks`, `research_ai_tasks` (y sus `*_complete` en sus skills).

Integraciones y enseñanza
- `list_workspace_integrations`, `call_workspace_mcp`, `ghost_perform`, `observe_session`, `manage_chat_history`.

Lote
- `process_daily_batch`, `musa_batch_run`.

Diagnóstico
- `harness_healthcheck`, `harness_report_error`, `harness_list_errors`, `harness_record_runtime_event`, `harness_get_runtime_events`.

## Reglas

- Las políticas de Gobernanza mandan sobre cualquier pedido: si dicen "aprobación humana antes de publicar", no publiques sin ella.
- Lo importante va en la bitácora, no solo en el chat.
- Un agente no completa su propia tarea: la completa un revisor.
- Registra tu tiempo al terminar cada tarea.
- Si una skill propia calza con el pedido, síguela antes que improvisar: es el proceso de la persona.
- Antes de crear una skill propia, pregunta el espacio y si va privada o compartida con el equipo.

## Ejemplos

- "Toma la siguiente tarea del tablero y trabájala"
- "Revisa lo que hizo Pixel en el carrusel de Kuna y apruébalo si cumple"
- "Muéstrame cómo se crea un carrusel en Musa"
- "Convierte mi proceso de aprobación de piezas en una skill para el equipo"
- "Usa mi skill de onboarding de clientes con Café Altura"
