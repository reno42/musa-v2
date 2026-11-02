# REQ-068 — Espejo local sin quota: cura del popup "Error crítico: no se pudo guardar localmente"

**Prioridad:** ALTA — afecta a un usuario aliado estratégico (trae usuarios y coopera en el plan de lanzamiento). Su workspace: `ws_user_a711ca35dbba44bfbd36` (142 templates; 3 principales de 2.61–4.56 MB c/u = 9.9 MB juntos).

## Problema (verificado con evidencia, no síntomas)

1. **Consola real del usuario (2026-10-29, design.futuraria.com):**
   `QuotaExceededError: ... Setting the value of 'futuraria_local_templates' exceeded the quota`
   repetido en cada autosave + toast rojo persistente "Error crítico: no se pudo guardar localmente. Verifica el espacio disponible." (texto engañoso: NO es disco, es localStorage ~5 MB del navegador).
2. **Causa raíz en el código:**
   - `EditorV2.tsx` ~L1331: cada autosave llama `saveLocal(templateId, payload)` con el payload COMPLETO (html/css/base64 de todos los frames).
   - `templateApi.ts` L188-192 `saveLocalTemplate`: acumula TODOS los templates abiertos en UNA sola key `futuraria_local_templates`, reescrita entera, y **nunca se purga** — ni siquiera después de un PUT exitoso al servidor.
   - Aritmética del caso real: con templates de 2.6–4.6 MB, abrir 2-3 design systems supera los ~5 MB del origen. Matemáticamente imposible que quepa; seguirá pasando a todos los usuarios que crezcan.
3. **El guardado al servidor NO está afectado** (PUT corre en paso separado; el usuario confirma que graba normal). El espejo local es solo fallback offline. PERO:
   - `templateApi.ts` L35-54 `getTemplate` PREFIERE el espejo local si es más nuevo o está dentro de una ventana de gracia de 5s. Un espejo viejo/parcial combinado con esta preferencia es riesgo de servir contenido desactualizado. La cura debe respetar esta semántica, no solo "borrar".

## Fix (cura, no paliativo) — 3 piezas

### F1 — Ciclo de vida del espejo (CORE)
En `templateApi.ts`:
1. Nueva `removeLocal(id)`: borra la entrada del template dentro de `futuraria_local_templates` y reescribe la key.
2. Nueva `saveLocalBudgeted(id, data)`: antes de escribir, medir el total serializado. Presupuesto: **4 MB** (margen bajo el quota real). Si excede:
   - Evicted LRU: borrar espejos de otros templates por `updatedAt` ascendente hasta entrar en presupuesto.
   - Si el MISMO payload a guardar excede el presupuesto solo: no espejar (log una línea), el save real es el servidor.
3. En `EditorV2.tsx`, tras **PUT exitoso** (con la generación aún vigente, `gen === docGenerationRef.current`): llamar `removeLocal(templateId)`. El servidor es source of truth; el espejo solo debe existir mientras el doc está dirty o el PUT viene fallando.
4. En PUT fallido (agotó los 4 intentos): CONSERVAR el espejo (es su trabajo real: resiliencia offline). No tocar la lógica de reintentos.

### F2 — Error honesto + self-heal (UX)
En el `catch` de `saveLocal` en `EditorV2.tsx`:
1. Self-heal ANTES de avisar: llamar `saveLocalBudgeted` (que ya evicta); reintentar una vez.
2. Si aún falla: toast nuevo, UNA vez por sesión (dedupe con ref, no en cada autosave):
   "La caché local de tu navegador está llena. Tus diseños se guardan igual en el servidor. [Limpiar caché local]"
   - Botón "Limpiar caché local" → `localStorage.removeItem('futuraria_local_templates')` + confirmar con toast de éxito.
3. Eliminar el texto "Verifica el espacio disponible" (manda al usuario a revisar su disco).

### F3 — Telemetría mínima
Una línea `console.warn` por evento: tamaño de la key, IDs evicted, resultado del retry. Sin nuevos nested objects; grepeable.

## Reglas de ejecución

- Un ítem del checklist = un commit. Sin migraciones de schema. Sin dependencias nuevas. Estable > clever; toda desviación se documenta en el PR.
- Archivos en alcance (SOLO estos): `src/lib/templateApi.ts`, `src/pages/EditorV2.tsx`, `scripts/probe-local-mirror.mjs` (nuevo). Ningún otro archivo.
- `getTemplate` L35-54 (ventana de gracia 5s) NO se modifica en este REQ — con F1 el espejo solo existe cuando es legítimamente más nuevo, y la ventana queda correcta.

## Definition of DONE (verificar cada ítem antes de reportar)

- [ ] `npx tsc --noEmit` limpio.
- [ ] `node scripts/probe-local-mirror.mjs` verde, con asserts REALES sobre las funciones del repo (import directo con extensión .ts, node corre TS sin bundler):
  1. Tres payloads de ~2.5 MB consecutivos → el store queda bajo 4 MB (evicción funciona, nunca lanza QuotaExceeded).
  2. PUT exitoso simulado → el espejo del template desaparece.
  3. PUT fallido simulado → el espejo del template permanece.
  4. `getLocalTemplate` de un template evicted → null, y la lógica de getTemplate cae al server sin error.
- [ ] Toast nuevo aparece UNA sola vez aunque hayan N saves fallidos (dedupe verificado en probe o revisión de código explicada en el PR).
- [ ] Build + deploy al pipeline habitual + smoke: `/api/health` 200.
- [ ] E2E en prod (cuenta de prueba o la del usuario aliado): abrir los 3 templates grandes (Crafter Station 2.70 MB, Sundai 4.13 MB, Núcleo Lab 2.61 MB o equivalentes), editar cada uno, esperar "guardado": cero QuotaExceededError en consola y `futuraria_local_templates` bajo 4 MB (verifiable con `Object.entries(localStorage).map(([k,v])=>k+': '+Math.round(v.length/1024)+' KB')`).

## Fuera de alcance

- IndexedDB como almacenamiento alternativo (posible REQ futuro; NO en este).
- Cambios al flujo de reintentos del PUT ni al realtime.
- La ventana de gracia de `getTemplate`.
