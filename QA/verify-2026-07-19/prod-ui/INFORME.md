# Verificación EN VIVO — editor en PRODUCCIÓN (design.futuraria.com)

**Fecha:** 2026-07-19, 09:52–10:29 UTC · **Método:** puppeteer-core + Chrome del sistema (headless), perfiles de navegador controlados, captura de red con timestamps, sin editar código fuente. Scripts y evidencia en `QA/verify-2026-07-19/prod-ui/`.

## Notas de método (afectan al alcance)

- **Sin `.env` en el repo** (solo `.env.example`) → no había API key que cargar. El probe (`logs/00-probe.log`) demostró que **la API de prod acepta escrituras SIN `x-api-key`** (`MCP_ADMIN_KEY` no está seteada en el despliegue: `api/src/middleware/auth.ts:25-34` acepta todo en ese caso). Los GET son públicos. Esto es en sí mismo un **hallazgo de seguridad**: cualquiera puede crear/editar/borrar templates en prod hoy.
- El launcher de `QA/editor-interactions/` **no** acepta URL arbitraria (hardcodea `localhost:5173`), pero se reusaron su `browser.mjs` (resolver Chrome) y sus `page-helpers.mjs` (`window.__qa`, independientes de URL).
- El servidor **elimina `data:image/…;base64` del HTML en cada PUT** (`api/src/routes/templates.ts:204-222`, "502 prevention"). Relevante para el ítem 3: la imagen base64 solo persiste del lado cliente.
- Todos los objetos creados usan prefijo `verify-a2-` y fueron purgados (soft-delete + `/permanent`); verificación final: **0 vivos, 0 en papelera, 0 workspaces** (`logs/99-cleanup.log`).

## Tabla de resultados

| # | Ítem | Estado | Evidencia principal | Screenshots |
|---|------|--------|--------------------|-------------|
| 1 | DEBOUNCE-LOSS | **VERIFICADO** | PUT de control a +2021ms (200 OK); edición + cierre a 705ms → **0 PUTs**; mismo perfil reabre x=400 (localStorage); perfil limpio abre x=249 (servidor nunca recibió la 2ª edición) | `shots/01-01`…`01-06` |
| 2 | TEMPLATE-SWITCH | **VERIFICADO** (con matiz) | Edición en t1, Back a +388ms → **0 PUTs** a t1 ni t2; badge "Saving…" nunca apareció en t2 (0 avistamientos en 4.5s); t2 muestra solo sus frames; edición de t1 perdida en servidor (perfil limpio x=100) pero viva en localStorage | `shots/02-01`…`02-05` |
| 3 | LOCALSTORAGE-RISK | **VERIFICADO** (QuotaExceeded reproducido) | Un `setItem` por autosave a la única clave `futuraria_local_templates`, ~1.62M chars por escritura (doc completo ×2: `frames[].html` + `html` legacy); crecimiento 1.62M→3.25M→4.87M chars; al 4º template: **`QuotaExceededError`** + toast "Error crítico: no se pudo guardar localmente" + console `[SAVE] localStorage FAILED` | `shots/03-01-img-inyectada`, `03-02-quota-exceeded`, `03-03-estado-final` |
| 4 | GREY-UNDO-PROD | **VERIFICADO** | Botón Undo `disabled=true`, `opacity 0.4`, color `rgba(122,118,104,0.3)`, cursor `not-allowed` **antes y después** de una edición visible; Redo igual; Ctrl+Z no revierte (x queda 280) | `shots/04-01`…`04-04` |
| 5 | FIRST-REMOTE-MSG-LOST | **NO VERIFICADO** (la vía realtime no existe en prod) — **pero se verificó algo peor** | El bundle prod no incluye `VITE_SUPABASE_URL/ANON_KEY` (0 websockets observados) → `subscribeTemplate()` devuelve null → no hay re-suscripción en runtime. Lo que sí corre es el **polling de 5s, y NUNCA aplica cambios remotos**: ctx1 hizo 4 GETs tras el PUT de ctx2 y siguió mostrando x=100 durante 16s. Causa raíz (estática): closure stale — el `setInterval` lee `lastRemoteUpdate` del closure del efecto (siempre `null`, `EditorV2.tsx:280,528-529`) → la rama que aplica frames remotos es código muerto | `shots/05-01`…`05-03` |

## Detalle por ítem

### 1. DEBOUNCE-LOSS — VERIFICADO
Timeline (`logs/01-debounce-loss.log`):
- 10:08:49.666 edición control (drag +150) → 10:08:51.687 **PUT disparado a +2021ms**, 200 OK. El autosave funciona y tarda ~2s, como dice el análisis (`EditorV2.tsx:448-478`).
- 10:08:53.944 segunda edición (drag +150, x=400) → pestaña cerrada a **+705ms** → **0 PUTs** en los 3.5s siguientes.
- Reapertura **mismo perfil**: x=400 (sobrevive vía `futuraria_local_templates`, que se escribe síncrona al editar, `EditorV2.tsx:436-442`).
- Apertura **perfil limpio**: x=249 → en el servidor solo está la 1ª edición. **Los últimos <2s de trabajo nunca llegaron al servidor.**
- Corroborado además: no existe handler `beforeunload`/`pagehide`/`visibilitychange` en `src/`, y el cleanup de desmontaje (`EditorV2.tsx:484-486`) limpia el timer sin flush.
- Observación incidental: la posición del drag NO se serializa en el atributo `left` del HTML (queda `left:100px`); viaja por otro canal del payload (el round-trip servidor sí preserva la posición, como prueba el perfil limpio).

### 2. TEMPLATE-SWITCH — VERIFICADO con matiz de mecanismo
Timeline (`logs/02-template-switch.log`):
- 10:16:13.6 edición en t1 (x=220) → Back a **+388ms** → card de t2 a +2023ms → editor t2 listo a +2717ms.
- **PUT pendiente de t1: NUNCA disparó (0 requests)**. El matiz respecto a la hipótesis del "closure viejo": la vía UI normal (Back → Dashboard → otro template) **desmonta** EditorV2 y el cleanup `useEffect(...,[])` cancela el timer — el PUT no sale con closure viejo, simplemente **se cancela en silencio**. La única vía que cambia `templateId` sin desmontar (Batch-a-mator → "Open" tras generar un batch) no es alcanzable sin crear objetos fuera del prefijo permitido, así que no se ejercitó.
- **Badge "Saving…" en t2: 0 avistamientos** (polling del DOM cada 200ms durante 4.5s) — no hay parpadeo porque no hay PUT tardío.
- **selectedFrameId no queda stale** en esta vía: t2 remonta y `listFrames()` devuelve `["frame_a2_t2"]`.
- Resultado de datos: edición de t1 **perdida en servidor** (perfil limpio x=100) y **conservada en localStorage** (927 chars, entrada de t1 presente).

### 3. LOCALSTORAGE-RISK — VERIFICADO (explotó la cuota en vivo)
`logs/03-localstorage-risk.log`, `logs/03b-server-datauri-check.log`:
- Imagen PNG de ruido 450×450 generada en el script: data URI de **810,826 chars (~792KB)**.
- Inyección por la UI real (panel de código Monaco → `onHtmlChange` → `autoSave`) porque el servidor elimina data URIs del HTML en cada PUT — sembrarla por API no llega al cliente (probado: PUT con data URI → GET devuelve `src=""`).
- **Un `setItem("futuraria_local_templates", …)` por cada autosave**, 4 escrituras registradas de ~1.62M chars cada una. El payload duplica la imagen: va en `frames[0].html` y en el campo legacy `html` (`EditorV2.tsx:429-434`).
- Crecimiento acumulado de la clave compartida: 1.62M → 3.25M → 4.87M chars (3 templates grandes) → al editar el 4º: **`QuotaExceededError: Failed to execute 'setItem' on 'Storage'`** (`10:25:23.850`), toast crítico visible (screenshot) y `[SAVE] localStorage FAILED` en consola ×2. Cuota Chrome ≈5M chars por origen.
- Consecuencia observada: ese 4º template **no quedó en localStorage** (la clave se quedó en 3 entradas) y en el servidor su imagen queda strippeada → pérdida silenciosa del contenido inline.
- Nota: el PUT de autosave con body ~1.6MB no pudo medirse en bytes (puppeteer no expone `postData` de uploads grandes), limitación documentada.

### 4. GREY-UNDO-PROD — VERIFICADO
`logs/04-grey-undo.log`:
- Antes de editar: Undo `disabled=true`, opacity 0.4, color gris `rgba(122,118,104,0.3)`, cursor `not-allowed`.
- Tras un drag visible (x=280): **idéntico estado** — el botón sigue gris/deshabilitado. Redo también deshabilitado.
- Ctrl+Z no revierte la edición (x sigue 280 tras el atajo).
- Screenshots: `04-02` (toolbar completa tras editar) y `04-03` (crop del botón, tenue por el `disabled`).

### 5. FIRST-REMOTE-MSG-LOST — NO VERIFICADO (inalcanzable en prod) + hallazgo mayor VERIFICADO
`logs/05-bundle-check.log`, `logs/05-first-remote-msg.log`:
- El bundle prod (`/assets/index-aPT1aMHh.js`) **no contiene host de Supabase ni anon key** → `getClient()` null → **no hay suscripción realtime en runtime** (0 websockets en ambos contextos). La re-suscripción por `selectedFrameId` y el "primer mensaje descartado" (`EditorV2.tsx:492-499`) no ocurren en prod: ese código está muerto en este despliegue.
- Lo activo es el **fallback de polling (5s)**. Verificación con dos perfiles aislados: ctx2 editó (PUT a +2009ms, 200); ctx1 polleó a +3.4s, +8.4s, +13.4s… **y jamás aplicó el cambio** (x=100 durante 16s de muestreo cada 500ms).
- Causa raíz confirmada en fuente: el `setInterval` del polling se crea en el efecto `[, selectedFrameId]` y lee `lastRemoteUpdate` del **closure** (inicial `null`, `EditorV2.tsx:280`); aunque `setLastRemoteUpdate` actualiza el estado, el closure nunca lo ve → el guard `lastRemoteUpdate !== null` (`:529`) es siempre falso → la rama que aplica frames remotos es **código muerto**. Es decir: en prod no se pierde el primer mensaje remoto — **se pierden todos** (hasta recargar la página).

## Resumen final

- **4/5 ítems VERIFICADOS** (1, 2, 3, 4), 1 **NO VERIFICADO** por inalcanzable en el despliegue actual (5), con un **hallazgo adicional más grave verificado en vivo** en el mismo área (el polling de sincronización nunca aplica cambios remotos — closure stale de `lastRemoteUpdate`).
- **Hallazgos extra documentados:** (a) la API de prod acepta escrituras sin API key (`MCP_ADMIN_KEY` ausente); (b) el servidor elimina data URIs base64 en cada PUT (502 prevention) — el riesgo de cuota de localStorage es enteramente del lado cliente; (c) el payload de autosave serializa el documento dos veces (frames + html legacy), duplicando el costo de imágenes inline.
- **Limpieza:** todos los `verify-a2-*` purgados (soft + permanent) y workspace `verify-a2-ws` borrado; verificación final `clean: true` (0 vivos, 0 papelera, 0 workspaces) — `logs/99-cleanup.log`.
- **Sin secretos impresos**: no existía `.env`; no se usó ni mostró ninguna key.
