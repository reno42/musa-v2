# Reporte T7-full + Dogfood + Brain budget — 23 SEP 2026

**Entorno:** `[local design-main]` — nada pusheado (regla permanente: push solo bajo pedido explícito).
**Previo:** migración v56 aplicada por el usuario (verificado: `ghost_jobs` HTTP 200).

---

## 1) T7 full-flow — el camino que faltaba, verificado de punta a punta ✓

`MCP inserta job → presencia → la pestaña lo reclama → ghost ejecuta con teatro → done + burbuja + link`.

Evidencia (3 corridas de `node .tmp/fase2-t7-full.mjs`, video + 3 screenshots por corrida):

| Leg | Resultado | Evidencia |
|---|---|---|
| Presencia (heartbeat <30s) | ✓ 2.4–2.6s de edad, `page=/editor` | `results-t7-full.json` |
| MCP `ghost_perform` | `{accepted: true, delivery: "tab", jobId}` | job `b1686476-cab6…` (run 3) |
| Claim por la pestaña | **2.26–2.28s** en las 3 corridas (Realtime + guard de carrera) | `claimLatencyMs` |
| Ejecución con teatro | banner "Musa está operando — no toques nada" + ABORTAR + Manos ON | `T7-full-running.png` |
| Escritura del desenlace | `status=done` + `result{delivery:"tab", steps, sessionId: ghost_*}` | fila en `ghost_jobs` |
| Poll documentado | `ghost_perform({jobId})` → `done` (round-trip MCP) | `mcpPollStatus` |
| Burbuja al chat | `✓ Ghost (vía MCP): {nota} (N pasos)` capturada en run 3 | `doneBubble` |
| Logs del brain | 3–9 filas nuevas en `chatfab_decisions` con sess `ghost_*` por corrida | query REST |

### Hallazgos honestos

1. **Limitación de capacidad (no de pipeline):** la tarea "crea un frame rectangular
   llamado Demo Ghost T7" → el ghost **crea el frame** pero **no lo renombra**: la
   observación del brain no expone campo de rename (haría falta capas/Props en el
   whitelist de observación). El brain lo reporta HONESTO ("el nombre quedó
   pendiente") — comportamiento correcto del agente; mejora pendiente de alcance,
   no bug. Posible fix futuro: exponer el input de nombre del panel Propiedades en
   `ghostBrain` (targets observables).
2. **Carrera UI (cosmética):** si la última acción del ghost dispara la recarga
   completa del editor (sync de mutación remota), el `emitJob(done)` puede perder
   la burbuja ✓ en DOM — la fila y el poll MCP ya dicen `done`. Ver run 2 vs run 3:
   el detector por conteo era el artefacto; el set-based (run 3) capturó ambas
   burbujas. El canal de notificación funciona (burbuja ✕ running + ✓ done).
3. El dev stack (vite+API) murió entre corridas (EBUSY de Windows, pitfall conocido);
   relanzado con `npm run dev:all` — sin relación con el código de FASE 2.

## 2) Dogfood — demo para lead ✓

`node .tmp/dogfood-carrusel-seo.mjs` — flujo de usuario puro (sin arnés): login →
editor → "arma un carrusel del taller SEO" → chips (1.5s) → clic "Aquí, viendo a
Musa" → teatro → **12.1s** → `✓ Receta carrusel_content`.

- **Video:** `.tmp/fase2-tests/videos/demo-ghost-carrusel-seo.webm` (1.16 MB)
- **Shot final:** `dogfood-3-final.png` — chat con la burbuja ✓ + link clickeable
  `/?template=tpl_b06aeeb4-39b&v=2`, chain de tools (`aquí, con ghost` →
  `ai_generate_text` → `create_html_carousel`) y el toggle **Teacher** visible.
- **Producto real creado:** `tpl_b06aeeb4-39b` "Carrusel — taller SEO", 1080×1350,
  3 slides con copy real (verificado en DB):
  1. "Domina el SEO en un solo taller — Aprende a posicionar tu web en Google paso a paso"
  2. "Qué aprenderás con nosotros — Keywords, SEO técnico, contenido y linkbuilding"
  3. "Inscríbete ya — Cupos limitados… DM o enlace en bio"

### Bug encontrado y corregido por el dogfood (este es el punto del dogfood)

El topic salía mordido: "carrusel **del** taller SEO" → brief **"l taller SEO"**.
Causa: `(?:de|sobre|acerca de)?` sin `\b` comía el prefijo "de" de "del".
Fix en `src/lib/recipes.ts`: alternación longest-first `(?:acerca de|del|de|sobre)\b`
+ strip de preposición sobrante en el brief. Take 3 confirma: `sobre "taller SEO"`.

Take 2 (fallado, documentado): la receta murió in-flight por la recarga del editor
(sync de mutación remota de take 1) — carrera conocida de T3; el waiter Node-side
del script ya la tolera. No reproducido en takes 1/3.

## 3) Brain con max_tokens 512 ✓

- `src/lib/agentRuntime.ts`: nueva const `GHOST_BRAIN_MAX_TOKENS = 512` (techo de
  DECISIÓN, no de generación — el chat rico sigue en `LLM_MAX_TOKENS` 8192).
- `src/components/ChatFAB.tsx` (`llmJson` del loop agéntico) y
  `src/lib/ghostBridge.ts` (`resolveGhostLlm` — solo sirve decisiones a
  `runGhostAgent`): migrados a 512. Una decisión gasta ~60 tokens → ~16x de techo
  libre; ahorra costo y acelera el TTFT de cada paso del ghost.

## Validación

- `npx tsc --noEmit` → **0 errores**.
- `node --check` implícito por ejecución de los 2 scripts E2E nuevos.
- Tocados: `agentRuntime.ts`, `ChatFAB.tsx` (import + 2 líneas), `ghostBridge.ts`
  (import + body), `recipes.ts` (brief regex). Nada en worker/ ni mcp.mjs hoy.

## Pendiente / no hecho

- Sin push (regla). Commit local sí (pedido explícito del usuario).
- Rename de frames desde el ghost: registrado en backlog del Kanban
  (`card_86652ecf389db185`, workspace QA) — NO se implementa.
- Gate del reload con receta activa: **IMPLEMENTADO** tras el reporte inicial.
  `src/lib/creationActivity.ts`: contador de coreografía en vuelo +
  `beforeunload` que pide confirmación antes de recargar/cerrar con receta
  activa + veto del full-reload de vite HMR en dev. Cableado en las tres vías
  (chips, loop manual, jobs del bridge). Además, `runCreationChoice` recibió
  catch externo: un throw pre-receta ya no muere en silencio — siempre deja
  burbuja ✕ (el hole real observado en take 2).
