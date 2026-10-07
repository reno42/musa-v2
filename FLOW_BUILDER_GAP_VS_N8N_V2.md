# Flow Builder vs n8n — Gap analysis V2 (post batch-3)

> Fecha: 2026-10-07 · Reemplaza la lectura del doc original (FLOW_BUILDER_GAP_VS_N8N.md) como estado actual.
> ACTUALIZACIÓN 2026-10-07 (batch gap-v2): **F1, F2, F5, F8 y F9 implementados y verificados**
> (tests req027 36/36 + fase2 54/54, smoke E2E en vivo en 3011, build + dry-run OK). El motor queda
> con 27 tipos de nodo y el catálogo MCP con 373 tools; DB en v66 (flows.static_data).
> Método: re-inventario verificado contra el código real (FlowEditor.tsx, flows-core.mjs,
> flows-runtime.mjs, flows-sources.mjs, mcp.mjs) y los commits ab435fb (batch 2) y
> 2841dba (batch 3), con tests (engine parity 31/31, req027 31/31) y smoke E2E B5 en vivo.
> Conclusión corta: **las capas A, B, C, D y casi toda la E ya son n8n-grade. Queda 1 gap
> accionable directo (F6) + verticales (F3/F4) + backlog P3. No somos un clon: ganamos en la capa de diseño/MCP.**

---

## 1. Paridad CERRADA (verificada, con evidencia)

### Capa A — Editor (9/9) ✅ CERRADA
| # | Capacidad | Evidencia |
|---|---|---|
| A1 | Undo/redo completo (snapshots de grafo) | `undoRef/redoRef` GraphSnap, toda mutación apila |
| A2 | Multi-selección + box-select | shift-clic y banda elástica (`selIds`, `boxSel`) |
| A3 | Copiar/pegar/duplicar | Ctrl+C/V/D (`copySelection/pasteClipboard/duplicateSelection`) |
| A4 | Sticky notes | nodo `note` visual, fuera del run |
| A5 | Búsqueda de nodos | Tab abre palette con buscador enfocado |
| A6 | Grupos colapsables | renderer propio, arrastre muebla miembros, inspector w/h |
| A7 | Atajos n8n-style | Ctrl+Z/Y, Tab, Delete/Backspace, Ctrl+S |
| A8 | Duplicar flow completo | board (flow_get + flow_save sin id) |
| A9 | Minimap + auto-layout + snap grid | 176×104 con viewport rect; layout BFS; grid 10px |

### Capa B — Motor (10/10) ✅ CERRADA
| # | Capacidad | Evidencia |
|---|---|---|
| B1 | Retry por nodo con backoff | `retry:N`, LIMITS.maxRetryPerNode |
| B2 | Continue-on-fail | `onError:"continue"` sigue el grafo |
| B3 | Rama when:"error" por nodo | arista roja, solo se recorre al fallar |
| B4 | Error workflow global | trigger `type:"error"` + `__fromError` anti-recursión |
| B5 | Wait + human-in-the-loop | `wait_webhook`/`approval` → pausa con resumeToken, `flow_resume`, WAIT_EXPIRED (v64+v65) |
| B6 | Inspección input/output por paso | pestaña Historial con JsonBox por nodo |
| B7 | Data pinning | `input.__pins` engine + `runWithPins` en editor |
| B9 | Nodo code | JS inline sin require, con deadline |
| B10 | Variables de flow | `vars` + `{{vars.x}}` en config de nodos |
| B8 | ✅ Re-run desde un nodo (F8) | botón "▶ desde aquí" por paso en Historial: pinea ancestros con sus salidas del run elegido y re-ejecuta (`rerunFromStep`) |

### Capa C — Lógica avanzada (6/6) ✅ CERRADA
| # | Capacidad | Evidencia |
|---|---|---|
| C1 | Merge: append / byKey / branch | tests engine |
| C2 | Loop por lotes | salidas loop/done, sub-walk aislado |
| C3 | Switch multi-rama | reglas + fallback |
| C4 | Sub-workflows | nodo `subflow` + guard anti-recursión |
| C5 | Compare datasets | added/removed/changed + counts (batch 3) |
| C6 | Orden de ejecución documentado | BFS FIFO, raíces por posición |

### Capa D — Gestión (5/6)
| # | Capacidad | Evidencia |
|---|---|---|
| D1 | Tags + filtro en board | `tags:[..≤10]` |
| D2 | Versionado de edición + diff + restaurar | `versions[]` (≤10), `diffVersion`, `restoreVersion` |
| D3 | Reintentar run fallido desde Historial | `retrying` (flow_run) |
| D4 | 🔶 Lite: lock de flow (solo admin) | `locked` + badge candado; faltan roles owner/editor/viewer por flow |
| D6 | Notificación de fallos | error workflow corre CUALQUIER lógica (Slack/report vía tool) |
| D5 | ❌ Diferido por diseño | queue/workers — CF Workers + cap de concurrencia alcanzan en freemium |

### Capa E — IA/integraciones (4/5)
| # | Capacidad | Evidencia |
|---|---|---|
| E2 | Agente con tools en loop | nodo `agent` (allowlist, maxIterations, final) |
| E3 | Memoria de agente | flow_history last-N inyectado en el prompt |
| E5 | HTTP con auth + paginación | bearer/api_key/basic + paginación source_http (batch 3) |
| E1 | ✅ Structured output (F1) | `ai` con responseFormat:"json" + schema (JSON Schema acotado ≤2KB): valida y reintenta UNA vez; fallo final = AI_SCHEMA (engine + editor + smoke con runAiText stub) |
| E4 | ❌ Diferido por diseño | triggers de apps propios (inbox social, CRM, calendar) — ahora es el gap F3 |

---

## 2. NUEVA lista de gaps (lo que falta para "tal cual n8n")

| # | Gap | Cómo lo hace n8n | Esfuerzo | Prioridad |
|---|---|---|---|---|
| F1 | ✅ CERRADO — **Structured output en nodo ai** | Output Parser: JSON schema validado, retry al fallar | responseFormat:"json" ya no se pierde en el save (era dead code) + `schema` ≤2KB, validador acotado (type/enum/properties/required/items), UN retry con fixPrompt, fallo final `AI_SCHEMA`; editor: textarea schema | **P1 HECHO** |
| F2 | ✅ CERRADO — **Static data persistente entre runs** | `$getWorkflowStaticData` | v66 `flows.static_data` jsonb (aplicada), contexto `{{static.k}}`, store get/merge (superficial ≤8KB), tools `flow_static_data_get/set` (viewer/tenant OK) — smoke live set/get/merge/run | **P1 HECHO** |
| F3 | **Triggers de apps propios** (era E4, diferido) | Polling triggers de Gmail/Sheets/etc. | M por app | **P1 vertical** — inbox social, CRM (nuevo prospecto/oportunidad), calendar como triggers; es VENTAJA nuestra (módulos propios que n8n no tiene) |
| F4 | **Permisos por flow** (completar D4) | Projects/RBAC: owner/editor/viewer por workflow | M (RLS + UI share; el lock-lite ya existe) | **P2** — equipos reales sobre un mismo workspace |
| F5 | ✅ CERRADO — **Webhook con modos de respuesta** | Respond: immediately / when last node finishes | trigger `respond:"ack"\|"lastNode"` validado en engine; API: success→200 `{data: outputs}` (sin steps: los datos viajan limpios), waiting→202 SIN resumeToken, fallo→500; selector en el inspector del trigger | **P2 HECHO** |
| F6 | **Credencial OAuth2** para nodo http | OAuth2 con refresh automático | M | **P2** — hoy solo bearer/api_key/basic; mucha API moderna es OAuth2 |
| F7 | **Expresiones JS en templates** | `={{ $json.x * 2 }}` en cualquier campo | S-M (deepResolve con evaluador acotado) | **P3** — el nodo code cubre; es ergonomía |
| F8 | ✅ CERRADO — "Ejecutar desde nodo" en Historial (cierra B8) | Re-run desde un nodo con datos de la ejecución previa | `rerunFromStep`: BFS inverso de ancestros en el grafo actual → `flow_run` con `input.__pins` = salidas del run elegido (truncadas a 4KB, caveat dev) | **P3 HECHO** |
| F9 | ✅ CERRADO — Micro-nodos no-code de datos | Sort, Remove Duplicates, Aggregate, Limit | 4 tipos nuevos (NODE_TYPES 27): `sort{path?,dir}`, `dedupe{path?}`, `aggregate{}` (fan-in: junta TODAS las entradas), `limit{max≤100,keep}`; cap `maxItemsTransform:100`; paleta + nodeSummary + fan-in del editor | **P3 HECHO** |
| F10 | "Convertir selección en sub-flow" | Refactor action del editor | S | **P3** — el nodo subflow ya existe, es azúcar |
| F11 | History de versiones ilimitado + labels | n8n guarda todo con notas | S | **P3** — hoy ≤10 sin labels, suficiente |

### Diferidos por diseño (NO son deuda, son decisión)
| # | Qué | Por qué se difiere |
|---|---|---|
| D5 | Queue mode con workers externos | CF Workers + cap 240 runs/h + concurrencia por workspace cubren el freemium; activar solo con volumen real |
| — | RAG/vector stores/Evaluations de n8n AI | capa IA de n8n que no aplica 1:1; nuestro vertical es diseño; postergar hasta caso de uso propio |
| — | Timeout por flow configurable | presupuesto ~25s es límite de plataforma CF freemium, documentado |

---

## 3. Donde ya GANAMOS a n8n (no tocar)

1. **Nodo template/render**: el flow produce piezas de diseño editables — n8n no genera diseño.
2. **Nodos de brand**: validate/auto_fix/apply_brand dentro del motor.
3. **Library de machines verticales** (50 ideas): templates estáticos en n8n vs machines de diseño.
4. **Nodo `tool` = 371 MCP tools con UN nodo**: n8n necesita ~400 integraciones nodo-a-nodo; nosotros tenemos el catálogo completo por bridge MCP.
5. **Editor de diseño + builder en el mismo producto**, con Webhook-trigger + flow_resume para human-in-the-loop dentro del flujo creativo.

## 4. Ruta sugerida (corta, con lo que queda)

1. ~~Sprint "datos confiables" (F1 + F2)~~ — ✅ HECHO (batch gap-v2, 2026-10-07).
2. **Sprint "equipo"** (F4): permisos por flow (el re-run desde nodo ya entró con F8). ~3-4 días.
3. **Sprint "integraciones"** (F6): OAuth2 credentials (el respond del webhook ya entró con F5). ~1 semana.
4. **Vertical** (F3): triggers de inbox social y CRM — uno por semana, empezando por el que pida un cliente real.
5. P3 (F7, F10-F11): backlog; solo con demanda real del no-code.

> Criterio de "paridad" para dar por cerrado cada F: test engine + test req027 + smoke E2E en vivo (el estándar que fijó batch 3 con B5).
