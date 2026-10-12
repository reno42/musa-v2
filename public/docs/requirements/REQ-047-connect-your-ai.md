# REQ-047 — Flows "Conecta tu IA": cada usuario llama a SU agente (MCP multi-tenant + wake por workspace + onboarding)

Fecha: 2026-10-12 · Estado: **propuesto** · Origen: test E2E del flow "Content machine" (Café Borja, `flow_2l2t660w383d` → ai_task waiting sin consumidor) y del "pase de voz" (`flow_2b6p6b681i5x` → wait_webhook con wake apuntando a webhook.site). Feedback de Ren: **la meta es producto — cada usuario conecta SU IA (Claude, Hermes, Cursor, Codex, Replit, n8n…) y los flows le pasan la voz a ESA IA, no a un agente central.**

---

## 0. Principio de diseño (leer primero)

El "pase de voz" NO es llamar a un agente específico. Es un **contrato abierto**: el flow se pausa, deja un briefing autocontenido, y CUALQUIER agente conectado con credenciales del workspace puede atenderlo. Tres capas, una misma condición de pausa:

| Capa | Mecanismo | Quién lo consume | Estado hoy |
|---|---|---|---|
| 1 | **MCP multi-tenant** (pull: `flow_ai_tasks` / `flow_resume`) | Cualquier agente con cliente MCP: Claude Desktop/Code, Cursor, Codex CLI, Cline, Windsurf, Hermes, Replit Agent | Existe PERO con auth global de un solo tenant (bloqueante) |
| 2 | **Wake outbound** (push: POST firmado HMAC) | Agentes con endpoint público (Hermes+túnel, n8n cloud, servidores) | Existe (REQ-040, verificado E2E) PERO config global, no por usuario |
| 3 | **Webhook genérico** (pull/push crudo) | n8n, Make, Zapier, scripts curl | Existe via wait_webhook + resumeToken |

Regla de producto: **Capa 1 es el default gratis; Capa 2 es el upgrade; Capa 3 es documentación.** Ninguna capa requiere que Futuraria corra proxies de IA ni consuma tokens ajenos: la IA del usuario es del usuario.

---

## 1. Objetivo

Un usuario nuevo debe poder, en <5 minutos y sin hablar contigo: registrar el MCP de Musa en su agente, dejar un flow corriendo, y ver cómo SU agente atiende las pausas ai_task y continúa el flow. Sin soporte, sin llaves compartidas, sin poll de tu parte.

---

## 2. Diagnóstico del estado actual (verificado en código)

### Lo que ya funciona
- `flow_ai_tasks` devuelve la bandeja con briefing completo (`netlify/functions/mcp.mjs:6771`) — el message ES autocontenido (probado: el run de Café Borja trae instrucciones completas con resumeToken y formato de payload).
- `flow_ai_complete` rechaza tareas con `requiredKeys` faltantes (mcp.mjs:24294) — validación de entrega correcta.
- `flow_wake_set/get/test` con HMAC + tenant por key (`mcp.mjs:6801-6825, 8251`) — push firmado verificado E2E el 9-oct.
- `flow_history {status:"waiting"}` como fallback barato de descubrimiento.
- Timeout de pausas → WAIT_EXPIRED automático (sin zombies: los runs waiting cuestan 0 CPU/tokens).

### Los 4 bloqueantes para multi-usuario (en orden de impacto)
1. **Auth global de un solo tenant** — todas las llamadas MCP usan la MISMA X-API-Key global (la de Ren). Un usuario B conectando el MCP vería/operaría los flows del usuario A. BLOCKER absoluto de producto.
2. **Wake global, no por workspace** — `flow_wake_set` escribe la URL del webhook del workspace de Ren (hoy webhook.site de una prueba). Cada usuario necesita SU config de wake, editable desde UI sin MCP.
3. **Cero onboarding self-serve** — no existe la página "Conecta tu IA" con snippets por agente; un usuario nuevo no sabe ni que `flow_ai_tasks` existe.
4. **El ai_task no avisa que hay bandeja** — el briefing dice "llama flow_ai_complete" pero asume un agente YA conectado. Si nadie está conectado, la tarea muere en silencio (aceptable, pero hay que comunicarlo en UI).

---

## 3. Alcance — 4 piezas

### PIEZA 1 — Auth multi-tenant por workspace (P1, blocker)

**Objetivo:** cada usuario tiene token(s) propios; `auth.workspaceId` deriva del token, no de una key global.

- Nuevo modelo `mcp_tokens` en Supabase: `{id, workspaceId, name, tokenHash, prefix, scopes, createdAt, lastUsedAt, revokedAt}`.
- Emisión desde la UI (Settings → API & MCP): botón "Generar token" → muestra `musa_sk_...` UNA vez (hash SHA-256 en BD, patrón del wake secret).
- Formato: `musa_sk_<22 base62>` con prefix verificable (`musa_sk_` + primeros 4) para listar sin revelar.
- **Scopes mínimos para v1:** `flows:read`, `flows:write`, `flows:resume`, `assets:write` — el set que un agente necesita para atender ai_tasks SIN poder borrar templates ni ver CRM de otros.
- Middleware MCP: resolver `Authorization: Bearer musa_sk_...` → `{workspaceId, scopes}` → inyectar como `auth.workspaceId` en TODAS las tools (mismo camino que la X-API-Key actual, mcp.mjs:8251 — el refactor es el resolver, no las 19 tools).
- Compatibilidad: la X-API-Key global sigue funcionando (es el token del owner, scope `*`) — nada de lo existente se rompe.
- Rate limit por token: 120 req/min (los agentes poll-ean; que el límite sea generoso pero exista).
- Auditoría mínima: tabla `mcp_token_calls` (tokenId, method, ms, status) con retención 30 días — para el dashboard "tu agente atendió N tareas este mes".

**Criterios de aceptación:**
1. Dos workspaces A/B con tokens distintos: B NO ve flows de A en ninguna tool (test: matrix de 19 methods × 2 tenants).
2. Token revocado → 401 inmediato en la siguiente llamada.
3. Scope `flows:read` NO permite `flow_save` (403 con mensaje del scope faltante).
4. La key global actual sigue operando todo (regresión cero).

### PIEZA 2 — Wake + AI-task config por workspace desde UI (P1)

**Objetivo:** el usuario configura SU webhook en Settings, sin MCP y sin tocar el tuyo.

- `flow_wake_set/get/test` ya derivan tenant de la key (mcp.mjs:8251) — la pieza nueva es la **UI**: Settings → Pestaña nueva "IA & Webhooks":
  - Campo "Webhook URL de tu agente" + botón "Probar" (llama `flow_wake_test` y muestra el HTTP status devuelto).
  - El secret se genera al guardar; UI muestra solo `secretHint` (últimos 4) + botón regenerar (invalida el anterior).
  - Sección "Tareas pendientes de tu IA": contador de `flow_ai_tasks` + lista con title/flowName/age + botón "Copiar briefing" (para pegarlo manual en cualquier chat IA — la salida de emergencia universal).
- Snippet de cron sugerido bajo el contador: `Cada 15 min, revisa flow_ai_tasks de Musa y atiende las tareas pendientes` — copy-paste a cualquier agente con scheduler.
- Regla de UI: si hay runs waiting >24h y wake configurado falló (último status ≠ 2xx), badge de advertencia en la card del flow.

**Criterios de aceptación:**
1. Usuario B configura su webhook y flow_wake_test devuelve el status de SU endpoint (no del workspace A).
2. Regenerar secret invalida el anterior (POST viejo rechazado con 401).
3. El contador de tareas de la bandeja coincide con `flow_ai_tasks` del token del usuario.

### PIEZA 3 — Onboarding "Conecta tu IA" (P1, la página)

**Objetivo:** la página que convierte "tiene cuenta" → "su agente está operativo".

Ruta nueva: `/connect` (público con login; accesible desde Settings y desde el banner de Flows cuando hay ai_tasks sin atender).

Contenido por bloques, cada uno con botón copiar:
1. **Claude Desktop / Claude Code** — `claude mcp add musa https://design.futuraria.com/mcp --header "Authorization: Bearer <SU token>"` + JSON para desktop_config.json.
2. **Cursor** — URL + header en `.cursor/mcp.json`.
3. **Hermes** — bloque `mcp:` de config.yaml con header auth.
4. **Codex CLI / Cline / Windsurf** — formato genérico streamable-http.
5. **n8n / Make / Zapier** — Capa 3: URLs del webhook + ejemplo de resume con curl (resumeToken del POST → `POST /mcp flow_resume`).
6. **Prompt de cron sugerido** (el del poll barato, 1 llamada/15 min).
7. **Prompt de sistema recomendado** para el agente del usuario: "Tienes acceso a Musa. Revisa flow_ai_tasks cuando te lo pida o en tu cron; cada tarea trae un briefing y un resumeToken; complétala con flow_ai_complete; jamás inventes resumeTokens."

Testing interactivo en la página: botón "Probar conexión" que hace un `flow_list` con el token del usuario y muestra ✓/✗ por agente (en realidad es 1 endpoint, pero el check por-agente guía al usuario).

**Criterios de aceptación:**
1. Un usuario nuevo copia el snippet de Claude Code, lo pega, y `flow_ai_tasks` responde en SU agente en <2 min sin tocar docs.
2. Cada snippet lleva el token del usuario inyectado (no placeholder) tras click en "mostrar mi token".
3. La página funciona mobile (los usuarios la abren desde el teléfono mientras configuran el agente en desktop).

### PIEZA 4 — Semántica de entrega y expiración comunicada (P2)

- El ai_task, al pausar, escribe en el run `expiresAt` visible; la UI de Flows muestra countdown en la card del run waiting.
- Al expirar (WAIT_EXPIRED): notificación in-app (campanita) + fila en la bandeja con estado "expirada — re-ejecuta el flow".
- El briefing del ai_task gana línea final: "Si nadie atiende esta tarea antes de <expiresAt>, el run expira sin costo."
- `flow_ai_tasks` gana flag `staleMinutes` por tarea para que el agente del usuario priorice.

**Criterios de aceptación:**
1. Run expirado aparece en bandeja como expirado, no desaparece en silencio.
2. El countdown visible coincide con el `expiresAt` del POST de wake.

---

## 4. Fuera de alcance (explícito)

- Proxy de IA server-side (Musa llamando a Claude/OpenAI por el usuario): NO — es el modelo BYOK del nodo `ai`, distinto del pase de voz. El pase de voz jamás consume tokens del lado de Futuraria.
- Agent hosting ("corremos tu agente por ti"): NO — eso es otro producto.
- OAuth MCP (Authorization Code flow del spec MCP): v2 — el token estático `musa_sk_` cubre el 100% de los agentes CLI/desktop actuales; OAuth agrega valor cuando haya clientes web de terceros.
- Webhooks entrantes por usuario (su agente expone tools que Musa llama): es la inversión del contrato; v2 si aparece el caso.

---

## 5. Fases (para el agente IDE)

### Fase A — Tokens multi-tenant (Pieza 1) [P1]
Tabla + emisión UI + resolver middleware + scopes + rate limit + auditoría mínima + tests de matrix 19×2.
**Aceptación:** §Pieza 1 criterios 1-4.

### Fase B — Settings IA & Webhooks (Pieza 2) [P1]
Pestaña nueva + wake por workspace + bandeja visible + regeneración de secret.
**Aceptación:** §Pieza 2 criterios 1-3.

### Fase C — Página /connect (Pieza 3) [P1]
Onboarding con snippets por agente + test de conexión + prompt de sistema.
**Aceptación:** §Pieza 3 criterios 1-3.

### Fase D — Expiración comunicada (Pieza 4) [P2]
Countdown + expiradas en bandeja + staleMinutes.
**Aceptación:** §Pieza 4 criterios 1-2.

Orden estricto: A → B → C (B sin A filtra tokens por la UI; C sin B promete una config que no existe). D puede ir en paralelo con C.

---

## 6. Riesgos

1. **Fuga de tenant en tools viejas:** la matrix de tests es OBLIGATORIA — cualquier tool que lea `workspaceId` del request (en vez del token) es un agujero entre usuarios.
2. **Tokens en snippets copiados:** los tokens viven en configs de agente del usuario (igual que OpenAI/Anthropic keys); documentar rotación. NUNCA loggear el token completo server-side.
3. **Polling abusivo:** el rate limit por token protege; documentar el cron de 15 min como ritmo recomendado.
4. **Expectativa del usuario con bandeja vacía:** la página /connect deja claro que las tareas aparecen CUANDO un flow pausa — el usuario no debe esperar tareas mágicas sin flows corriendo.
5. **El caso Ren (wake a webhook.site):** migrar la config del workspace de Ren al endpoint real de Hermes o dejarlo sin wake y operar por Capa 1 — decidir al implementar Fase B (el test actual de webhook.site muere solo al expirar).

---

## 7. Referencias

- `netlify/functions/mcp.mjs`: flow_ai_tasks (:6771), flow_ai_complete (:6782), wake (:6801-6825), tenant por key (:8251), gate requiredKeys (:24294).
- REQ-040 (wake HMAC, verificado E2E 9-oct) · REQ-041/042 (ai_task, requiredKeys) · REQ-027 (motor de flows).
- Caso de prueba vivo: run_4x3c0l5d6c6q (Café Borja, ai_task waiting) — usarlo como smoke test de la Fase A→C: un segundo workspace debería poder atenderlo si el owner lo asigna (nota: la asignación cross-workspace NO es parte de este req; el smoke test es con el token del MISMO workspace renovado).
