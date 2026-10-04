# REQ-025 — Ghost/Laya Full: ejecución visual inmediata en Musa

- **Status:** Requerimiento abierto; no implementar hasta aprobación.
- **Priority:** P0 — bloquea la promesa de control live.
- **Evidencia:** Cloudflare `def25a2d-f336-4065-887d-2c5d99bd462b`, commit `6cdee56`.
- **Prueba:** job `17285e66-41c4-4269-a99a-4d206c83457d`, sesión `ghost_1790280038359`.

## 1. Objetivo

Con el usuario dentro del editor de Musa, un prompt en modo Full debe producir:

> **prompt → movimiento visible inmediato → archivo nuevo por UI → diseño editable terminado**

Ghost debe mover un cursor visible y operar la interfaz real. Laya debe planificar sin dejar al usuario esperando a ciegas. No cuenta crear por API y abrir después. El control es dentro de Musa mediante cursor Ghost y eventos DOM; mover el puntero nativo de Windows o controlar otras aplicaciones queda fuera de alcance.

## 2. Estado observado

| Dato | Resultado |
|---|---|
| `ghost_perform` | `accepted: true`, `delivery: "tab"`, `mode: "full"` en **1399 ms** |
| Job | `17285e66-41c4-4269-a99a-4d206c83457d` |
| Sesión | `ghost_1790280038359` |
| Final | `failed`, `steps: 0` |
| Error | `/api/llm` respondió `401 invalid API key`; clave enmascarada `…eb52` |

Esto confirma que MCP, workspace, heartbeat, selección `tab`, inserción, claim y runner funcionaron. Falló la primera decisión LLM, antes de una acción útil. El error previo `res.send is not a function` **ya está resuelto** por el hotfix `6cdee56`; el 401 actual es distinto.

## 3. Flujo y componentes actuales

```text
ghost_perform (netlify/functions/mcp.mjs)
  → workspace/owner → ghost_presence (<30 s) → ghost_jobs(queued)
  → Realtime o polling → ghostBridge reclama queued→running
  → resolveGhostLlm → POST /api/llm → BYOK/proveedor
  → ghostAgent: observar → decidir 1 acción → actuar → repetir
  → ghostCursor mueve cursor/eventos DOM → resultado en ghost_jobs
```

- `src/lib/ghostBridge.ts`: heartbeat cada 15 s, claim, provider/model leader y lifecycle.
- `src/lib/ghostAgent.ts`: loop de hasta 25 pasos.
- `src/lib/ghostBrain.ts`: una llamada LLM por `click`, `type`, `scroll` o `done`.
- `src/lib/uiObserver.ts`: hasta 60 controles visibles con selector.
- `src/lib/ghostCursor.ts`: cursor/badge/ABORTAR; Full usa 80 ms y paste.
- `api/src/routes/llmProxy.ts`: autentica, resuelve BYOK y llama al proveedor.
- `netlify/functions/keys.mjs`: claves cifradas por usuario/proveedor.

## 4. Causa confirmada y riesgos probables

**Confirmado:** la BYOK `…eb52` fue rechazada con 401. Sin decisión, hubo cero pasos.

**No confirmado:** key revocada, provider equivocado, endpoint incompatible, configuración leader desfasada o modelo sin permisos. El job no conserva provider/model/keySource/last4, así que hoy no puede distinguirse automáticamente.

Aunque se cambie la key, no se garantiza velocidad sobrehumana: hay una llamada LLM por microacción; faltan drag, shortcuts, multiselección y propiedades; 25 pasos son pocos; presencia no significa editor listo; el primer movimiento espera al LLM; y existe fallback headless.

## 5. Alcance

Incluye contrato live-only, readiness, BYOK/provider, preflight, inicio inmediato, creación por UI, ejecución rápida, editabilidad, telemetría, seguridad, abort, idempotencia y rollback.

No incluye control fuera de Musa, publicación social, rediseño total del editor, navegador alterno del agente, rotación automática de una key personal ni creación headless silenciosa.

## 6. Requisitos funcionales

### RF-01 — Live obligatorio

`ghost_perform` acepta `deliveryPolicy: "live_required"`. Solo responde `delivery: "tab"` con pestaña elegible; si no, `LIVE_TAB_NOT_READY`. Queda **prohibido el fallback headless silencioso**, la creación por API y cualquier artifact oculto.

### RF-02 — Readiness real

Heartbeat: `tabId`, `workspaceId`, ruta, `surface`, `editorReady`, `templateId`, versiones frontend/protocolo, capabilities, `idle|busy`, timestamp y foco/visibilidad. Heartbeat fresco sin `editorReady` no basta.

### RF-03 — Pestaña y concurrencia

Priorizar pestaña visible/enfocada del workspace; luego editor más reciente. Ante empate, pedir `tabId` o `MULTIPLE_LIVE_TABS`. Claim atómico con `claimedByTabId`; un job activo por pestaña, nunca doble ejecución.

### RF-04 — Preflight BYOK

Antes de empezar, resolver provider/model canónicos, validar key y distinguir `missing`, `invalid`, `wrong_endpoint`, `forbidden_model`, `rate_limited` y `provider_unavailable`. Solo exponer provider/model/keySource/last4.

### RF-05 — Política de claves/fallback

- Descifrar solo server-side; Ghost no usa `/api/keys/:provider/decrypt` ni recibe plaintext.
- `401/403` invalida cache y corta antes de mutar.
- `429` admite backoff corto/visible, sin cambiar provider.
- Key administrada solo con política explícita del workspace.
- Nunca cambiar key/provider ni ir a headless sin consentimiento.

### RF-06 — Movimiento inmediato

Tras claim/preflight, mostrar badge/cursor y ejecutar una macro segura hacia “Nuevo archivo” sin esperar una ronda genérica. Mostrar fase (`Preparando`, `Creando`, `Aplicando`, `Verificando`) y mantener `ABORTAR`.

### RF-07 — Archivo nuevo por UI

Abrir “Nuevo archivo”, configurar dimensiones (1080×1080 por defecto), confirmar, esperar `editorReady` y verificar un `templateId` nuevo del workspace. No cuentan `create_template`, `create_html_template` ni equivalentes.

### RF-08 — Plan compilado/streaming

Laya genera `DesignSpec` y cola validada; Ghost empieza macros deterministas mientras llegan lotes. No una llamada LLM por click conocido. Nuevo archivo, texto, fondo, formas, duplicado, alineación, capas y guardado deben ser macros versionadas.

### RF-09 — Acciones suficientes

Agregar `drag`, `key/shortcut` con allowlist, multiselección, propiedades numéricas/color, capas, espera por condición y `assert`. Prohibidos `eval`, JS arbitrario y targets no observados/registrados.

### RF-10 — Resultado verificable

Éxito exige archivo nuevo abierto, texto/fondo/elementos en capas editables, nombres comprensibles, persistencia confirmada, `templateId` y resumen de capas. No rasterización total.

### RF-11 — Lifecycle

`requested → validating_tab → validating_credentials → accepted → claimed → planning → executing → verifying → done`; finales `rejected|failed|aborted|timed_out`. Todo fallo incluye `phase`, `reasonCode` y acción sugerida.

### RF-12 — Abort e idempotencia

`ABORTAR` cancela acciones/fetches en <200 ms, mantiene documento válido y nunca relanza/headless. Cada request lleva `idempotencyKey`; reintentar no crea otro archivo. Jobs viejos expiran.

## 7. Requisitos no funcionales

| Métrica | SLO |
|---|---|
| Ack MCP | p95 ≤ 1.5 s |
| Claim Realtime | p95 ≤ 300 ms |
| Badge/cursor desde claim | p95 ≤ 250 ms |
| Primera acción desde prompt | p95 ≤ 1 s; máximo 2 s |
| Silencio entre acciones | p95 ≤ 350 ms, salvo espera señalizada |
| Diseño simple, 6–10 capas | p50 ≤ 15 s; p95 ≤ 30 s |

Cursor/badge a 60 fps, main thread sin bloqueos >50 ms. Éxito ≥99% con key válida, cero artifacts headless en `live_required` y cero duplicados.

## 8. Telemetría y errores

Emitir con `jobId/sessionId/tabId`: `requested`, `tab_validated`, `credentials_validated`, `accepted`, `claimed`, `visual_started`, `plan_started/ready`, `action_started/completed`, `verification_started`, `done|failed|aborted`.

Registrar timestamps, `promptToVisualMs`, `promptToFirstActionMs`, duración, acciones planeadas/ejecutadas/fallidas, provider/model/keySource/last4 y versiones. Nunca key, Authorization, cookies ni valores sensibles.

Códigos mínimos: `LIVE_TAB_NOT_READY`, `MULTIPLE_LIVE_TABS`, `TAB_BUSY`, `AUTH_REQUIRED`, `BYOK_MISSING`, `BYOK_INVALID`, `BYOK_WRONG_ENDPOINT`, `MODEL_FORBIDDEN`, `PROVIDER_RATE_LIMITED`, `PROVIDER_UNAVAILABLE`, `PLAN_INVALID`, `UNSUPPORTED_EDITOR_ACTION`, `SELECTOR_STALE`, `DOCUMENT_NOT_CREATED`, `PERSISTENCE_FAILED`, `ABORTED_BY_USER`, `LIVE_TIMEOUT`.

## 9. Seguridad

- Validar membership/ownership y mantener RLS.
- Asociar job a usuario, workspace, pestaña y origen Musa.
- Redactar secretos; retención restringida del prompt.
- Allowlist de acciones/origen; bloquear navegación externa.
- Revalidar target antes de actuar.
- Badge, fase y ABORTAR visibles durante toda mutación.

## 10. Criterios de aceptación

1. En editor y con key válida, “Crea desde cero un post 1080×1080 que diga ‘Hola amigos de Instagram’, estilo libre, visual fuerte y capas editables” devuelve `tab/full/live_required`.
2. Cursor/badge ≤1 s; click visible en “Nuevo archivo”; ninguna ruta directa crea el template.
3. Sin silencios >2 s; termina ≤30 s p95.
4. ≥6 capas editables, incluido fondo/texto; nuevo `templateId` abierto/persistido.
5. Job `done`, `steps > 0`, fase `verified` y trace.
6. Con key inválida `…eb52` o equivalente: `BYOK_INVALID`, cero acciones/archivo/headless; muestra provider/model/last4 y cómo rotar.
7. Sin editor listo: `LIVE_TAB_NOT_READY` ≤1.5 s, sin job tardío/artifact.
8. Abort <200 ms; mismo idempotencyKey produce un solo archivo.
9. SLO calculados automáticamente; no basta percepción manual.

## 11. Matriz E2E

| Caso | Esperado |
|---|---|
| Editor + BYOK válida | Caso canónico por UI, `done`. |
| Key faltante/inválida/cruzada | Error específico, cero mutación/fallback. |
| Modelo prohibido, 429, 5xx | Error distinguible; retry solo 429; sin switch silencioso. |
| Sin pestaña/dashboard | Rechazo; heartbeat no equivale a editor listo. |
| Dos tabs/tab ocupada | Selección o error; nunca duplicar/intercalar. |
| Realtime perdido | Polling reclama una vez. |
| Selector obsoleto | Recuperación acotada o `SELECTOR_STALE`. |
| Reload/idempotency retry | Sin segundo archivo; reanudar o fallar explícito. |
| Abort planning/drag | <200 ms, documento válido. |
| Persistencia falla | `PERSISTENCE_FAILED`, nunca éxito falso. |
| Regresión `/api/llm` | JSON sin `res.send` error; SSE temprano. |

Suite en preview y producción Cloudflare con key de prueba rotatoria, nunca la personal.

## 12. Implementación por fases

1. **Observabilidad:** fases, reason codes, timestamps, provider/model/last4 y versiones.
2. **Readiness/BYOK:** handshake, configuración canónica, preflight y retirar plaintext de Ghost.
3. **Live-only:** `live_required`, multi-tab, busy, idempotencia, no headless.
4. **Velocidad:** macro Nuevo archivo, `DesignSpec`, cola batched/streaming, esperas por condición.
5. **Edición:** drag, shortcuts, propiedades, capas, IDs estables y verificación.
6. **Hardening:** E2E, feature flag, canary, prueba visible en prod y rollout por SLO.

## 13. Rollback

Usar `ghost_live_v2`. Rollback desactiva executor/capabilities sin tocar documentos. En `live_required` devuelve `LIVE_MODE_UNAVAILABLE`; nunca reactiva headless. Jobs terminan controladamente y migraciones son aditivas/compatibles con v1.

## 14. Definición de Done

- E2E verde en preview y producción Cloudflare.
- Caso canónico visible, por UI, dentro de SLO y editable.
- Job con `steps > 0`, `templateId`, capas y trace.
- Key inválida detectada antes de mutar; ningún secreto en browser/logs.
- Cero headless silencioso en `live_required`.
- Multi-tab, idempotencia, abort, timeout y rollback probados.
- Regresiones `res.send` y SSE verdes.
- Versión Cloudflare, commit y job final registrados.

Hasta entonces: **MCP y bridge live funcionan, pero la ejecución visual inmediata sigue bloqueada/incompleta**.
