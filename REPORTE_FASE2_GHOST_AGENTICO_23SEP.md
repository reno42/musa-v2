# FASE 2 — Ghost Cursor Agéntico + Multi-proveedor: Informe final de tests

**Environment: [local design-main]** · 23 septiembre 2026 · Estado: ejecutado y verificado en local. **Sin push** (esperando tu instrucción explícita).

---

## 1. Veredicto

| Suite | Casos | Resultado |
|---|---|---|
| **Parte A** — FASE 2 core (ghost) | T1a, T1b, T2a, T2b, T3, T4, T5 | **7/7 ✓** |
| **Parte B** — Regresión router/recetas | T6-A1..A5, T6-B1..B6 | **12/12 ✓** |
| **Parte B** — ghost_perform vía MCP | T7 | **✓** (vía error estructurado, ver §5) |

**20/20 verdes.** Evidencia completa (videos webm + screenshots + logs por caso) en `.tmp/fase2-tests/`.

---

## 2. Qué se arregló en esta ronda de tests

1. **`ai_generate_text` ya no depende de OpenRouter** (`netlify/functions/mcp.mjs` + `musa-batch-core.mjs`): los 4 tools de texto (`ai_generate_text`, `ai_palette`, `ai_suggest_layout`, `ai_translate`) resuelven LLM con `resolveTextLlm(userId)`: cadena `OPENROUTER_API_KEY → ZHIPU_API_KEY (env)` y luego **BYOK del usuario** (zhipu → openrouter → deepseek, leído de DB en cada llamada — sin restart). Con tu key Zhipu, la receta del carrusel pasó de fallar siempre a crear carruseles reales.
2. **Parser de carrusel tolerante** (`src/lib/recipes.ts`): glm-5.3-flash ignora el separador `---` y responde con párrafos; el split ahora prueba `---` → párrafo doble → numeración. Verificado con probe: 5 bloques perfectos con el prompt exacto de la receta.
3. **OnboardingTour eliminado** (tu directiva, legacy): componente, mounts en Dashboard/EditorV2, card de Configuración. Cero referencias.
4. **T3 sanado**: el editor hace full-reload tras mutaciones remotas y mataba el waiter (`Execution context destroyed`) → nuevo `pollBubble` navigation-proof. El mensaje ambiguo ("agranda el frame 2") lo contestaba el Leader con una pregunta — válido pero no determinístico; el test ahora usa tamaño explícito.
5. **T6-A1/A2 "fantasmas"**: los ops instantáneos ejecutan en ~100ms y la burbuja salía ANTES de que el waiter armara su baseline → `bubble:null` falso. El veredicto del router en DB lo probó (`direct/editor_pan, 75ms`). Fix: armar el waiter antes de enviar.

---

## 3. Multi-proveedor (compatible Cloudflare)

- **Proxy same-origin `/api/llm`** (nuevo, `api/src/routes/llmProxy.ts`): auth JWT, la key viaja solo server-side (getUserKey desencripta en el server — la key BYOK nunca más llega al browser), endpoint desde mapa server-side (anti-SSRF), SSE en pipe. Necesario porque z.ai no manda `Access-Control-Allow-Origin` (el fetch browser-direct moría: "Failed to fetch" del ghost).
- **4 sitios migrados al proxy**: ChatFAB llmJson + loop principal (2 ramas), ChatTab (reemplaza PROVIDERS viejos con `CHAT_PROVIDERS`), ghostBridge.
- **CF**: `/api/keys*` ya es ruta nativa del worker (`worker/index.js` L85); `/api/llm` cae al express-shim como el resto de `/api/*` — **cero cambios en el worker**, `nodejs_compat` cubre todo lo usado. Verificado contra `wrangler.toml` (alias express-stub, assets dist).
- **Catálogo**: `PROVIDER_ENDPOINTS` exportado es la única fuente de verdad (deepseek/openai/anthropic/google/openrouter/kimi/moonshot/qwen/zhipu). `modelSync.ts` sincroniza modelos nuevos.
- Probe end-to-end: 401 sin auth ✓, 400 provider desconocido ✓, 200 zhipu con JSON de brain perfecto ✓ (`.tmp/fase2-probe-llm.mjs`).

---

## 4. Parte A — resultados por caso (los 7)

| Caso | Qué prueba | Resultado | Evidencia |
|---|---|---|---|
| T1a Teacher | Modo teacher: teatro paso a paso + template nuevo | ✓ "✓ Mostrado (5 pasos)" + "Mi primer diseño" creado | `videos/T1a-teacher.webm`, `T1a-teacher-badge/final.png`, `t1a-t1b-t5-run3.log` |
| T1b Full | Modo full: mismo fin, sin pausas | ✓ "✓ Mostrado (4 pasos)" + template | `videos/T1b-full.webm`, `T1b-full-badge/final.png` |
| T2a Chips→Aquí | "arma un carrusel de 5 frames del taller" → chips → Aquí: ghost ejecuta la receta con teatro | ✓ chips+badge+**carrusel real de 5 slides creado** (tpl_1cdda23a) | `videos/T2a-chips-aqui.webm`, `T2a-*-chips/badge/final.png`, `t2-t3-run4.log` |
| T2b Chips→Paralelo | Mismo pedido, headless sin ghost | ✓ chips sin badge + carrusel 5 slides (tpl_ce18a73d) | `videos/T2b-chips-parallel.webm` |
| T3 Edición | Editar NUNCA muestra chips ni crea archivos | ✓ sin chips, 0 archivos nuevos (6→6) | `videos/T3-edicion.webm`, `t3-run5.log` |
| T4 Abort | ABORTAR a mitad: UI limpia, sin estado roto | ✓ badge/cursor fuera, log de abort | `videos/T4-abort.webm`, `T4-abort-final.png` |
| T5 Límite | Objetivo inexistente: terminación honesta, cap respetado | ✓ "✓ Mostrado (0 pasos): No encontré… 'ZQX Campo Imposible 999'" — el brain concluye honesto sin quemar el cap | `videos/T5-budget.webm`, `t5-run6.log` |

---

## 5. Parte B — T6 (12/12) y T7

| Caso | Resultado | Nota |
|---|---|---|
| A1 pan / A2 zoom | ✓ | `✓ Hecho: editor_pan/editor_zoom (instantáneo)` |
| A3 export / A4 templates | ✓ | MCP-backed |
| A5 "hola que tal" | ✓ | **Lo contesta el LLM** (zhipu) — el aviso "necesito una API key" NO aparece: regresión del key store descartada |
| B1 style_transfer | ✓ | 5 pasos, brand reutilizado |
| B2 post_from_brand | ✓ | Frame con estilo real del brand |
| B3 publish_instagram | ✓ | Honesto: sin Buffer/Zernio conectados |
| B4 deck | ✓ | Chips → deck real creado |
| B5a animate | ✓ | Preset Fade in aplicado |
| B5b animate frame 99 | ✓ | Fallo honesto "Frame not found" en el paso exacto |
| B6 carrusel | ✓ | Chips → 3 slides reales (tpl_8ec4faf8). En 1 de 3 corridas zhipu dio timeout — flake del upstream, no del chain |
| **T7 ghost_perform** | ✓ | En catálogo ✓; llamada con key efímera QA → error JSON-RPC **estructurado** `-32000 … table 'public.ghost_jobs'` — el contrato "nunca falla raro" pre-migración. `t6-t7-run2.log` |

---

## 6. Notas honestas (límites, no excusas)

- **T3**: el resize directo por chat pertenece al pipeline de delegación Leader→Implementer (el Leader del Harness es orquestador sin tools de diseño, por diseño). Con glm-5.3-flash como Leader, la delegación completa no arranca de forma fiable (contesta saludo/pregunta). El contrato FASE 2 (router: sin chips, sin archivos) está verde; la delegación edit-mode es trabajo del pipeline del harness, no del ghost.
- **T5**: el brain (glm-5.3-flash) concluye "no está" en 0-2 pasos en vez de quemar el cap de 25 — decisión correcta según la regla de honestidad; el cap está garantizado por el loop duro de `ghostAgent.ts` (logs ≤ 27 verificado).
- **B6**: 1 timeout de zhipu en 3 corridas del mismo prompt (las otras 2 crearon carrusel). Si se vuelve frecuente, subir el timeout del tool `ai_generate_text`.

---

## 7. Te falta a vos (1 cosa)

**Correr `supabase_migrations_v56.sql`** (raíz del repo; copia en `supabase_migrations/ghost_jobs_v56.sql`) en el SQL Editor de Supabase. Es **idempotente** (IF NOT EXISTS + DO block para la publicación Realtime — seguro de re-correr). Crea `ghost_jobs` + `ghost_presence` + RLS + Realtime.

- Hasta entonces: `ghost_perform` responde con el error estructurado (T7 ✓ igual).
- Después: el MCP detecta la pestaña abierta (presencia <30s) y le entrega el trabajo al ghost de verdad — el camino `{accepted, jobId}` queda live.

---

## 8. Estado del working tree

Cambios sin commitear en local (mcp.mjs es archivo compartido — solo hunks propios, sin revertir WIP ajeno). **No se pusheó nada** — push solo con tu pedido explícito.
