# REQ-028 — IA de plataforma para Ghost (freemium real): el Ghost funciona sin que el usuario ponga ninguna llave

> **Prioridad:** P0 — feature de producto, no nice-to-have.
> **Problema:** hoy el Ghost exige BYOK (llave propia del usuario). Un usuario nuevo NO tiene llave y NO va a registrarse en Z.ai/DeepSeek para probar: fricción = abandono. El Ghost debe funcionar DESDE CERO con IA de la plataforma, con cuota, y escalar a "cada uno con sus IAs" cuando el usuario decida subir su propia llave.
> **Verificación previa (Hermes, en código):** la plataforma YA tiene el concepto de LLM de plataforma — `resolveTextLlm()` en `netlify/functions/musa-batch-core.mjs` resuelve `env del server (ZHIPU_API_KEY / OPENROUTER_API_KEY) → BYOK del usuario` y lo usan las tools de texto de `mcp.mjs` (líneas 8865, 8977, 9000, 9492). **El Ghost NO está cableado a eso** — tiene su propio `resolveGhostLlm()` (BYOK-only). Este req cablea el Ghost a la IA de plataforma + agrega cuota + agrega el patrón "cada uno con sus IAs".

---

## 1. Diseño (3 capas, en orden de resolución)

```
Ghost necesita decidir (ghostBrain 1 llamada/microacción)
  ↓
CAPA 1 — IA de plataforma (freemium con cuota)
  llmProxy consulta: ¿el usuario tiene cuota disponible? SÍ →
  usa ZHIPU_API_KEY del server (glm-5.3-flash, thinking off) contra
  el provider zhipu. El usuario NO configuró nada. Gasta cuota.
  ↓ (sin cuota)
CAPA 2 — BYOK del usuario (ilimitada, la suya)
  igual que hoy: key desencriptada server-side (getUserKey).
  Cualquier provider del lineup (zhipu, openrouter, deepseek, …).
  ↓ (sin ninguna)
CAPA 3 — Rechazo honesto y accionable
  reasonCode FREEMIUM_QUOTA_EXHAUSTED / BYOK_MISSING con CTA:
  "Cuota gratis agotada ({n}/{n}). Sube tu llave en Configuración →
  Invita IAs para uso ilimitado" (mensaje existente de rotación).
```

**"Cada uno con sus IAs":** la resolución de rol leader (server prefs → localStorage → defaults, ya unificada en REQ-025.1) se mantiene. La capa 1 solo aplica cuando el usuario NO tiene key del provider de su rol leader. Si el usuario configuró su propia key de CUALQUIER provider (Claude, ChatGPT, Kimi, Qwen…), su key manda siempre y la plataforma no gasta ni interviene: su IA es la que controla la máquina.

## 2. Items de trabajo (en orden; un item = un commit con verificación)

### Item 1 — Resolver LLM del Ghost con cadena plataforma → BYOK
1. Extraer la cadena de resolución a `netlify/functions/ghostLlmChain.mjs` (importable por mcp.mjs y por el bundle):
   `resolveGhostChain(userId)` → `{ tier: "platform" | "byok" | "none", provider, model, headers, extraBody, keyLast4 }`.
   - platform: `process.env.ZHIPU_API_KEY` → zhipu / `glm-5.3-flash` / thinking off (idéntico a `resolveTextLlm`, extraer a shared en vez de duplicar).
   - byok: recorrido BYOK del rol leader del usuario (lógica actual de `resolveGhostLlm` movida server-side cuando aplique).
2. En `netlify/functions/mcp.mjs` (case `ghost_perform` y el endpoint de preflight): reemplazar la resolución BYOK-only por `resolveGhostChain`. El `reasonCode` del preflight para tier `none` pasa de `BYOK_MISSING` a `FREEMIUM_QUOTA_EXHAUSTED` cuando la cuota se agotó (Item 2), o `PLATFORM_LLM_UNAVAILABLE` si el server no tiene env key (config del operador, no culpa del usuario).
3. En `src/lib/ghostBridge.ts` (preflight client-side): misma cadena vía `/api/llm`/`/api/ghost/preflight` — el preflight YA clasifica 402/401; agregar los 2 reason codes nuevos a `ghostPreflight.ts` y sus mensajes con CTA.
4. El job trace (REQ-025.1 Item 3) registra `tier: "platform" | "byok"` — así auditas cuánto consume la capa gratis por usuario.

### Item 2 — Cuota freemium (server-side, no saltable)
1. Tabla nueva `llm_quota_usage` (SÍ hay migración en este req, es la excepción documentada):
   `user_id uuid pk, window_start timestamptz, platform_calls int default 0`. Ventana rodante mensual (1ero del mes UTC).
2. Helper `checkAndConsumeQuota(userId, cost=1)` en `keys.mjs` o nuevo `quota.mjs`: upsert atómico (`insert ... on conflict do update`) + `returning` para leer si excedió el límite DENTRO de la misma query (evita race entre pestañas).
3. Límite default `PLATFORM_FREE_GHOST_RUNS` env (default **30/mes** — parametrizable sin redeploy de código).
4. Los micro-pasos del Ghost consumen 1 llamada LLM cada uno: cobrar cuota POR RUN (job), no por llamada interna — `checkAndConsumeQuota` se invoca 1× en el claim del job, no en cada microacción. Un run abortado a la mitad NO se devuelve (documentado).
5. Si `llm_quota_usage` falla (DB caída): fail-closed para tier platform (no regalar cuota infinita por error) pero el mensaje distingue el error técnico.
6. Headers de respuesta del proxy: `X-Musa-Quota-Remaining: n` — el ChatFAB/Ghost pueden mostrar "Queda: 12/30" (UI mínima: texto en el badge del Ghost, sin pantalla nueva).

### Item 3 — Admin/observabilidad mínima
1. Vista SQL o query documentada: consumo platform por usuario y por mes (`select user_id, platform_calls from llm_quota_usage where window_start = date_trunc('month', now())`).
2. El trace del job ya distingue tier — con eso: `select count(*), tier from ghost_jobs ...` para costos.
3. Alerta operacional simple: si `ZHIPU_API_KEY` no está en env del deploy, el preflight devuelve `PLATFORM_LLM_UNAVAILABLE` (ya del Item 1) — el log de mcp.mjs lo deja claro para quien opere.

### Item 4 — UI honesta (mínima, sin pantallas nuevas)
1. En "Invita IAs": texto bajo el provider: "Sin llave: el Ghost usa la IA de Musa gratis (30 runs/mes). Con tu llave: ilimitado."
2. En el badge del Ghost durante run: "IA de Musa · quedan N" o "Tu IA ({provider})" según tier.
3. Mensajes de error de preflight ya cubiertos por REQ-025.1; solo agregar los 2 reason codes nuevos con CTA correcta.

### Item 5 — Tests + DoD verificable
1. Test de la cadena: sin env key y sin BYOK → `none/FREEMIUM_QUOTA_EXHAUSTED`; con env key y usuario sin cuota → platform rechaza; con env key + cuota → platform ok; con BYOK sin cuota → byok ok ilimitado.
2. Test de atomicidad de cuota: 2 claims simultáneos del último run disponible → exactamente 1 gana.
3. Test de preflight con los reason codes nuevos.
4. `tsc` + `node --check` limpios.

## 3. Costo (números, para decidir el límite default)
- glm-5.3-flash: precio de entrada de z.ai; un run Ghost típico = 10-25 microacciones ≈ 25 llamadas LLM con payloads de observación del editor (~2-6k tokens in, ~100 out cada una).
- Estimado por run: <S/0.10 con flash. 30 runs/mes gratis por usuario ≈ S/3 por usuario activo/mes. Con `thinking off` obligatorio (ya está en el proxy para zhipu) y `max_tokens` acotados en ghostBrain, se sostiene freemium.
- El env `PLATFORM_FREE_GHOST_RUNS` permite bajar el número sin tocar código si los números reales no dan.

## 4. Fuera de alcance (explícito)
- Facturación/pagos por cuota extra (después: plan gratis → plan pago).
- Streaming del LLM hacia el Ghost (no aporta: ghostBrain decide acciones, no texto visible).
- Nuevo UI de "planes". El badge + texto en Invita IAs es TODO el UI de este req.
- Cambiar el lineup de providers ni el proxy /api/llm por fuera de lo listado.

## 5. Definición de Done
- [ ] Usuario nuevo SIN ninguna llave: abre Ghost, manda prompt → run corre con IA de plataforma y descuenta 1 de 30. Verificado con job real en prod (o staging si el deploy aún no sale).
- [ ] El mismo usuario llega a 0: preflight rechaza con `FREEMIUM_QUOTA_EXHAUSTED` + CTA de Invita IAs, cero job creado, cero cursor.
- [ ] Usuario CON BYOK de cualquier provider: su key manda SIEMPRE (tier byok en el trace), cuota intacta.
- [ ] Cuota atómica: test de carrera pasa (1 solo ganador).
- [ ] Trace registra tier; query de observabilidad documentada en el README del req o comentario.
- [ ] `X-Musa-Quota-Remaining` visible en respuesta del proxy.
- [ ] Tests Item 5 verdes; tsc limpio; commits organizados; NADA pusheado sin orden de Ren.

## 6. Reglas (no negociables)
- Un item = un commit con verificación citada (comandos + resultados). La migración de `llm_quota_usage` es idempotente y con rollback documentado.
- NO re-diagnosticar: `resolveTextLlm` ya existe y funciona (usado por 4 call sites verificados) — REUTILIZAR, no reescribir.
- NO tocar `express-shim.js` ni cambiar el contrato de `ghost_perform` (solo su resolución interna de LLM).
- NO pushear sin orden explícita de Ren. Los deploys se prueban contra staging primero si existe, o con flag `ghost_platform_llm_v1` apagado en prod hasta verificación.

---

## 7. PROMPT PARA EL AGENTE IDE (copiar/pegar completo)

Lee y ejecuta `docs/requirements/REQ-028-ghost-freemium-platform-ai.md` completo. Es un feature de producto: el Ghost debe funcionar SIN que el usuario configure llave alguna, con cuota mensual, y escalar a BYOK ilimitada si el usuario la trae.

Contexto verificado que NO debes re-descubrir:
- `resolveTextLlm()` en `netlify/functions/musa-batch-core.mjs` YA resuelve env-key server → BYOK y lo usan las tools de texto de `mcp.mjs` (call sites 8865/8977/9000/9492). REUTILIZA esa lógica (extráela a shared), no la reimplementes.
- El Ghost hoy usa su `resolveGhostLlm()` BYOK-only (`src/lib/ghostBridge.ts:195`) — es lo que cambias.
- El preflight REQ-025.1 ya existe (`src/lib/ghostPreflight.ts`, gate en `ghostBridge.ts:342-355`, flag `ghost_preflight_v1`) — agregas reason codes, no reescribes el gate.
- El trace de job ya existe (`src/lib/ghostJobTrace.ts`) — agregas el campo `tier`.

Ejecuta los 5 items del §2 EN ORDEN (cada uno con su commit y verificación citada): cadena plataforma→BYOK, cuota atómica en `llm_quota_usage` (única migración permitida, idempotente, con rollback), observabilidad, UI mínima (texto Invita IAs + badge con tier y cuota restante vía `X-Musa-Quota-Remaining`), y tests del §2-Item 5 (incluye el de carrera: 2 claims del último run → 1 ganador).

Reglas: sin dependencias nuevas. NO tocar `express-shim.js`, el contrato de `ghost_perform`, ni el lineup de providers. Feature flag `ghost_platform_llm_v1` para apagar sin redeploy. NO pushear. Deploys solo con orden explícita de Ren.

DoD §5: verifica CADA punto con evidencia real (queries corridas, tests, y el caso canónico del usuario-nuevo-sin-llave si hay deploy disponible; si no, decláralo bloqueado por deploy como se hizo en REQ-025.1 — no lo inventes). Reporta: commits + verificación de cada punto.
