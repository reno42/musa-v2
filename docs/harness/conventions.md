# Convenciones del Harness

> Homogeneidad extrema. La IA predice mejor cuando el sistema se parece a sí
> mismo en todas partes.

## MCP calls

- **JSON-RPC 2.0** sobre POST `https://design.futuraria.com/mcp`
- Header: `x-api-key: fdr_ws_...` (la key de la cuenta) o
  `Authorization: Bearer <supabase_access_token>` para usuarios logueados.
- Respuestas: `{ result: { content: [{ type: "text", text: "<json string>" }] } }`.
  Siempre `JSON.parse(result.content[0].text)` para leer el payload.

## Nombres de IDs

| Tipo | Prefijo | Ejemplo |
|---|---|---|
| Task (Kanban card) | `card_` | `card_lr2k8x9_a3f` |
| Session | `sess_` | `sess_lr2k8x9_q1w` |
| Entry | `he_` | `he_lr2k8x9_z4e` |
| Checkpoint | `hc_` | `hc_lr2k8x9_p0o` |
| Agent definition | `agent_def_` | `agent_def_leader` (defaults) |
| Cronjob | `cron_` | `cron_001` |
| API key | `fdr_ws_` | `fdr_ws_xxxxxxxxxxxxxxxx` |

## Status de tasks (Kanban ↔ Harness)

| Kanban | Harness equiv | Quién lo mueve |
|---|---|---|
| `backlog` | `pending` | Creación inicial |
| `research` | `in_progress` (explorer) | Implementer tras claim |
| `draft` | `in_progress` (implementer) | `harness_claim_feature` |
| `design` | `in_progress` (implementer activo) | Implementer durante el trabajo |
| `review` | bajo revisión | `harness_submit_for_review` |
| `feedback` | `CHANGES_REQUESTED` | Reviewer rechazó |
| `done` | completado | `harness_complete_feature` |

## Entradas (harness_entries)

- `entry_type` siempre en minúsculas, uno de: `plan, progress, blocker, review,
  verdict, summary, exploration, context_dump`.
- `content` en Markdown.
- `files_touched` como array de strings con paths relativos al repo.
- Una entrada = un evento significativo. No batchear 10 cosas en una.

## Comunicación entre agentes

- Subagente → Leader: UNA línea. `done -> sess_xxx` o `blocked -> sess_xxx`.
- Leader → Humano: plan + referencias a sesiones. Nunca el contenido crudo.
- Reviewer → Leader: `APPROVED -> sess_xxx` o `CHANGES_REQUESTED -> sess_xxx`.

## Errores

- Lanzar con `code: -32000` y `message` claro cuando falta setup.
- `code: -32601` para method not found (lo hace el router).
- `code: -32602` para params inválidos.
- El mensaje debe decirle al agente qué hacer: "Run harness.sql first", no
  "table not found".

## Comentarios en código

- Por defecto no se escriben. Solo cuando explican un *por qué* no obvio.
- En `mcp.mjs` cada `case` lleva un comentario `// ── Sección ──` para
  navegación, y los nuevos `harness_*` siguen ese patrón.
