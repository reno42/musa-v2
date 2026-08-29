# AGENTS.md — Mapa de navegación para agentes de IA

> Este archivo es el **punto de entrada** para cualquier agente que trabaje en
> Futuraria Design. NO es una biblia de reglas: es un **mapa**. Lee solo lo que
> necesites cuando lo necesites (divulgación progresiva).
>
> A diferencia de un arnés local basado en archivos, aquí **el estado vive en la
> nube** (Supabase) y se accede via MCP. La memoria se extrae constantemente para
> evitar la degradación del contexto: las conversaciones largas olvidan, así que
> escribimos todo a `harness_entries` y los subagentes leen solo lo mínimo.

---

## 1. Antes de empezar (obligatorio)

1. Llama `harness_healthcheck`. Si `ok: false`, **para** y reporta qué check
   falló. No toques código con el entorno roto.
2. Llama `harness_get_context({ agentType: "leader" })` para bootstrap tu rol.
3. Llama `harness_list_features({ status: "backlog" })` para ver tareas
   pendientes con acceptance criteria. Elige **una**.

## 2. Mapa del repositorio

| Recurso | Qué contiene | Cuándo leerlo |
|---|---|---|
| `harness_list_features` (MCP) | Tareas con estado y acceptance | Siempre, al empezar |
| `harness_get_context` (MCP) | Tu rol, la task activa, entradas recientes | Siempre, al empezar |
| `harness_get_entries` (MCP) | Bitácora de la sesión (anti-teléfono-descompuesto) | Para recuperar contexto |
| `docs/harness/architecture.md` | Qué significa "hacer un buen trabajo" aquí | Antes de implementar |
| `docs/harness/conventions.md` | Reglas de estilo, nombres, estructura | Antes de escribir código |
| `docs/harness/verification.md` | Cómo verificar que tu trabajo funciona | Antes de declarar done |
| `docs/harness/checkpoints.md` | Criterios objetivos C1-C5 (estado final correcto) | Para auto-evaluarte |
| `SKILL.md` | Catálogo completo de MCP tools del editor | Antes de usar tools de diseño |
| `harness/CHART_RECIPES.md` | Reglas de composición (#8 vertical ≥70%, #9 chart obligatorio) + 6 recetas CSS de charts | Antes de crear cualquier template/deck |
| `harness/SPEC_CREATE_CHART.md` | Spec de la tool nativa `create_chart` + lint COVERAGE/TYPE_FLOOR | Al implementar features de charts |
| `supabase_migrations/harness.sql` | Schema del harness (multi-tenant) | Si necesitas entender el modelo de datos |

## 3. Reglas duras (no negociables)

- **Una sola feature a la vez por cuenta.** `harness_claim_feature` falla si ya
  hay una task en `draft` o `design`. Es el equivalente cloud del check de
  `init.sh` que rechaza >1 `in_progress`.
- **No marques `done` sin verificación.** El reviewer corre
  `harness_evaluate_checkpoint` por cada C1-C5. `harness_complete_feature` falla
  si algún checkpoint está en false o no se evaluó.
- **Documenta cada paso** con `harness_log_entry` mientras trabajas, no al final.
- **Anti-teléfono-descompuesto:** los subagentes escriben resultados a
  `harness_entries` y devuelven solo una referencia (`done -> sess_xxx`). El
  contenido nunca circula por chat.
- **Flush de contexto al 40%:** cuando tu ventana se llene, llama
  `harness_dump_context` para vaciarla a la DB. El siguiente agente la recupera
  via `harness_get_context`.
- **Si no sabes algo, busca en `docs/harness/`** antes de inventarlo.

## 4. Cómo elegir una tarea

```
1. harness_list_features({ status: "backlog" })
2. Elige la de menor prioridad (1=urgente) o la más vieja
3. harness_claim_feature({ taskId: "..." })  → falla si otra IA ya la tomó
4. harness_start_session({ taskId, role: "implementer", plan: "..." })
5. Trabajala, logueando cada paso con harness_log_entry
```

## 5. Roles y cómo invocarlos

Los roles viven en `harness_agent_definitions` (Supabase). Tres por defecto:

| Rol | Qué hace | Cómo se invoca |
|---|---|---|
| **leader** | Orquesta. Descompone. Nunca implementa. | Eres tú hablando con el humano |
| **implementer** | Ejecuta UNA feature. Pide review. | Cambio de contexto: lee context_summary de harness_start_session |
| **reviewer** | Verifica contra acceptance + checkpoints. Aprueba/rechaza. | Cambio de contexto tras harness_submit_for_review |
| **explorer** (opcional) | Investiga antes de implementar. | Se lanza en paralelo para tareas complejas |

**Cómo "invocas un subagente" en la práctica:**

1. Llamas `harness_start_session({ taskId, role: "implementer", plan: "..." })`
2. El MCP te devuelve un `context_summary` ya armado: rol + acceptance + plan
3. Pones ese `context_summary` como system prompt de un subagente nativo
   (Claude Code `Agent` tool, Qoder subagent) o como cambio de tu propio rol
4. El subagente trabaja con contexto mínimo — más eficiente, menos alucinaciones
5. Cada paso que da lo escribe a `harness_entries` via `harness_log_entry`
6. Al terminar llama `harness_submit_for_review` y responde solo:
   `done -> sess_xxx`

## 6. Cierre de feature (lifecycle)

Antes de marcar done:

1. Implementer terminó → `harness_submit_for_review({ sessionId, summary })`
2. Status pasa automáticamente a `review` → Kanban UI lo refleja en vivo
3. Leader lanza reviewer con `harness_start_session({ role: "reviewer" })`
4. Reviewer lee entries con `harness_get_entries`
5. Reviewer corre `harness_healthcheck({ templateId })` — debe pasar
6. Reviewer corre `harness_evaluate_checkpoint` por cada C1-C5
7. Si todos pass: `harness_complete_feature({ taskId })` → status `done`
8. Si alguno fail: implementer relanza con el feedback

## 7. Si te bloqueas

- Llama `harness_release_feature({ taskId, toStatus: "feedback", reason: "..." })`
- Loguea un `harness_log_entry({ entryType: "blocker", content: "..." })`
- Reporta al humano: `blocked -> ver harness_entries de sess_xxx`

## 8. Cronjobs (automatización)

Las cuentas pueden programar tasks automáticas en `harness_cronjobs`. El Edge
Function `harness-cron` las dispara según schedule, crea la task y la procesa.
Cuando el humano se despierta, las ve en la columna Done del Kanban.
