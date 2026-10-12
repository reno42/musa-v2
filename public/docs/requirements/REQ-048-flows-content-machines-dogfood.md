# REQ-048 — Content Machines E2E: hallazgos de dogfood (IA conectada, sin key)

**Fecha:** 2026-10-12 · **Fuente:** sesión real de uso — 3 content machines armadas y ejecutadas E2E vía MCP + revisión en UI del editor por Ren.
**Nota de numeración:** este documento circuló como REQ-043 en el workspace `design-check`; aquí se renumera a REQ-048 porque design-main ya tiene un REQ-043 (vector-tools-parity).
**Estado base:** REQ-040 (wait/resume/wake), REQ-041 (recetas/brand flows) y REQ-042 (ai_task/flow_ai_complete) funcionan en producción. Este req NO rompe nada de eso: lo que sigue son las rugosidades encontradas al estirarlos a un uso real completo (3 flows, 11 piezas, corrección en vivo de errores).

## Contexto: qué se ejecutó (happy path verificado)

Tres flows creados y corridos el mismo día, todos con IA conectada (ai_task) y cero API keys:

| Flow | Run | Resultado |
|---|---|---|
| Caso 1 — Noticias (RSS→posts→diseño) | `run_1h2d6e531k73` | ✅ success tras 2 fixes |
| Caso 2 — Brief (calendario+copys+diseño) | `run_582x2t4i0e0q` | ✅ success al primer ensayo |
| Caso 3 — Eventos (FOMO+leads webhook) | `run_1j252q4a0c6o` | 🟡 llegó a su wait_webhook por diseño (captura de leads, expira solo) |

11 entradas de calendario con copy + 2 archivos de diseño multi-frame quedaron montados en el workspace. El recorrido fondo funciona; lo que sigue es lo que dolió.

---

## P0 — Corregir antes de vender flows + diseño como paquete

### F1. El save del editor CORROMPE el @import de Google Fonts (pierde los pesos)
- **Síntoma:** Frame "B — Invertido lima" (`tpl_c6e6f6ae-3eb`, `frame_0c7ceac1-280`). La IA lo creó con `@import url('...family=Syne:wght@700;800&family=Inter:wght@400;500;600&display=swap')`. Ren editó el frame en la UI (cambió font y volvió a Syne). Al re-leer con get_template el CSS quedó `@import url('...family=Syne&display=swap')` — **sin eje de pesos**.
- **Consecuencia:** Google sirve solo Syne 400; el titular pide `font-weight:900` y el navegador lo falsifica con synthetic bold. Renderiza "Syne" en las propiedades pero no es la Syne real.
- **Causa raíz:** el roundtrip de fonts del save del editor normaliza la URL del import y descarta query params (pesos). *Verificado por diff antes/después — no re-diagnosticar; falta confirmar el archivo exacto del normalizador.* **(Confirmado en el fix: `ensureGoogleFontImport` en `src/lib/googleFonts.ts` — el heal pass de cada llegada de CSS reescribía el import con variantes vacías.)**
- **Fix:** al guardar, preservar la query completa de las URLs de @import (o guardar la font como objeto de primer nivel con su descriptor completo, no como string CSS).
- **Verificación:** crear frame con import multi-weight → editar un texto en UI → guardar → get_template → el import conserva `wght@...`.

### F2. Canvas no repinta cuando la fuente termina de cargar (fallback congelado)
- **Síntoma:** mismo archivo: todos los frames decían `font-family:'Syne'` pero se veían sans-serif genérica. Cambiar la font a otra y volver a Syne lo arregló (forzó re-render con la fuente ya cacheada). Consola limpia (solo `[editor-back] click — REQ-026 BUG-004`).
- **Causa raíz (hipótesis fuerte):** el `@import` en CSS de frame carga la fuente async; el canvas compone antes de `document.fonts.ready` y no observa el evento de carga → no hay repaint. Sin error de JS, puro timing.
- **Fix:** en el pipeline de render del canvas, `await document.fonts.load()` para las familias declaradas en el CSS del frame antes del primer paint, o escuchar `document.fonts.onloadingdone` y repintar los frames afectados.
- **Verificación:** abrir un archivo con @import en red-throttled (DevTools) → tras cargar la fuente, el canvas se actualiza solo.

### FL1. `create_html_template` no crea frames — el humano ve "Este archivo está vacío"
- **Síntoma:** toda pieza creada hoy por IA con create_html_template (html+css a nivel archivo) quedó con `frames:[]`. Ren abrió la plantilla y vio el empty-state "Este archivo está vacío / 0 frames" aunque el diseño existía. Le pasó DOS veces (plantillas de la madrugada y las de eventos).
- **Causa raíz:** el tool escribe archivo-level html/css; el editor solo dibuja frames. La IA cree que terminó; el usuario cree que se perdió todo.
- **Fix (elige):** (a) create_html_template crea un frame inicial con el html/css provisto (receta natural: 1 archivo = 1+ frames), o (b) la response incluya warning explícito `"sin frames — llamar create_html_frame o el archivo se verá vacío en el editor"`.
- **Verificación:** create_html_template → list_templates/get_template muestra ≥1 frame o la advertencia en la respuesta.

### FL2. `flow_run` por API no aplica los `default` de los inputs
- **Síntoma:** flow con inputs con default (ej. `dias: 7`, `tema: ...`) corrido vía flow_run sin `input` → el briefing de ai_task salió con los huecos vacíos: "EXACTAMENTE  día(s)... tema: \"\"" (run `run_1w6k5l326d3h`, quedó zombi hasta expirar). En la UI el mini-form sí aplica defaults.
- **Consecuencia:** cualquier integración programática (cron, webhook externo) produce runs basura si no se pasa input completo — y el run igual avanza hasta el ai_task en vez de fallar temprano.
- **Fix:** executeFlow aplica defaults server-side para todo input ausente; si un required queda vacío, rechazar el run en el trigger, no en el nodo 2.
- **Verificación:** flow_run sin input → briefing con defaults o error de validación en el trigger.

---

## P1 — Errores crípticos que costaron corridas fallidas

### FL3. `add_content_idea` falla con mensajes que no dicen qué argumento vino mal
- Dos corridas perdidas del Caso 1 (`run_2o2u3d6r125w`, `run_421z4q2s4l2t`):
  1. `scheduledDate must be a valid YYYY-MM-DD date` — el flow no pedía fecha al payload (las noticias no traen fecha de publicación deseada). Razonable que sea required, pero el error no lista los args recibidos ni faltantes.
  2. `topic is required — an idea without a topic cannot be found later` — el payload traía el campo como `titulo` y los args referenciaban `{{item.titulo}}`... que era exactamente el bug: el arg decía `{{item.titulo}}` pero el schema pide `topic`. El mismatch llave-payload/args es el error más común posible en flows con ai_task y hoy se depura a ciegas.
- **Fix:** (a) el error de tool node incluya `recibido: {args resueltas}` vs `esperado: [campos required]`; (b) ideal: ai_task con requiredKeys podría validar en la entrega que las llaves usadas downstream existan, o los errors de validación listar `received_keys: [...]`.
- **Verificación:** provocar ambos errores en un flow de prueba → el mensaje nombra campo faltante y llaves recibidas.

### FL4. EDITABILITY_CONTRACT_ERROR críptico por whitespace y por clase `.root`
- Dos contratiempos hoy en create_html_frame:
  1. CSS multilinea (`\n` reales entre reglas) → `Layer layer_0 needs position:absolute (or fixed)` aunque el root lo tuviera inline. El parser parte el CSS por saltos.
  2. Template guardado con selector `.root{...}` (clase estándar) → mismo error, porque el wrapper root choca con la clase.
- **Workaround encontrado (documentar como receta):** root con estilos inline `position:absolute;left:0;top:0;width:...;height:...` + resto de clases en el CSS del frame TODO en una línea. Funciona al primer intento (usado en las 8 piezas de los casos 1-3).
- **Fix:** normalizar whitespace del CSS antes de parsear, y si el wrapper usa clase, ignorarla en lugar de contarla como layer 0. El mensaje de error podría sugerir "quita la clase .root o usa estilos inline en el wrapper".
- **Verificación:** create_html_frame con CSS multilinea y clase .root → normaliza o da error accionable.

### FL5. `source_rss` rechaza `{{input.x}}` en url (VALIDATION "URL del feed RSS debe ser una URL válida")
- Decisión razonable (validar en save, no en run) pero el flujo natural "feed como input del flow" queda cortado. Hoy el feed va hardcodeado en el nodo y cambiarlo requiere editar el nodo.
- **Fix (opcional):** permitir placeholder en url validando shape en save, o un input tipo `url` que el server sustituya al correr.
- **Verificación:** flow_save con url placeholder → acepta o da error que sugiera la alternativa.

### FL6. `add_content_idea` no acepta `channels` — el canal queda solo en `notes`
- Las 11 entradas creadas por flows quedaron `channels:[]` con el canal escrito en notes ("Canal: instagram"). La vista de calendario filtra/muestra por canal → entradas "sin canal" para el humano. Tuve que repasarlas a mano con update_content.
- **Fix:** agregar `channels` (array) a los args de add_content_idea.
- **Verificación:** flow con `channels: ["{{item.canal}}"]` → entrada con canal real.

---

## P2 — Pulido

- **F3.** El save del editor concatena el texto de layers multi-línea sin espacios en `data-layer-name` ("Tu clientevive en unacasainteligente"). Cosmético del panel de layers, pero confunde al re-leer por MCP. Fix: name = texto con espacios normalizados.
- **FL7.** update_content acepta cualquier frameId de la plantilla sin warning — crucé dos frames por error y el calendario mostró el diseño equivocado en una entrada. Sería útil un `frameName` de confirmación opcional (update rechaza si no coincide).
- **FL8.** Runs zombis visibles: corridas sin input o sin atención quedan `waiting` en la bandeja/historial hasta expirar. Ya cubierto por wake de REQ-040 para atención; falta un estado visual "nadie conectado va a atender esto" en la UI (ver FL9).
- **FL9.** Producto: la UI del run en waiting no distingue "mi IA está conectada y la vio" de "nadie va a venir". Un badge `IA conectada ✓ / sin IA conectada ⚠` en el run waiting ahorra la angustia de Ren mirando expirar tareas (le pasó con 5 tareas la madrugada del taller).
- **FL10.** wait_webhook default 240min es corto para captura de leads de un evento de un día. Ya es configurable vía timeoutMinutes — solo documentar el patrón en el playbook de flows (max razonable y qué pasa al expirar).

---

## Lecciones para la receta de flows con diseño (ya aplicadas en producción, no requieren fix)

Para que cualquier IA replique el pipeline completo sin tropiezos (verificado E2E en los 3 casos):

1. Piezas: UN archivo por campaña (`create_html_template`) + N frames (`create_html_frame`), root con estilos inline, CSS en una línea, sin clase `.root`.
2. Cada entrada: `update_content {id, templateId, frameId, channels}` — frame exacto, no compartido.
3. `flow_run` por API SIEMPRE con `input` completo (los defaults son solo de UI).
4. Payload de ai_task: llaves EXACTAS a las `{{item.x}}` de los args downstream — un solo nombre canónico (topic, fecha) de punta a punta.
5. add_content_idea exige topic + scheduledDate: la IA planificadora debe emitir fechas YYYY-MM-DD siempre.

## Prompt IDE (sección de ejecución)

> Ejecuta los fixes P0 y P1 de este documento sobre el código del editor y de flows. Orden sugerido: F1 (preservar query de fonts en save) → F2 (repintar canvas en fonts.ready) → FL1 (frame inicial o warning en create_html_template) → FL2 (defaults server-side en flow_run) → FL3/FL4 (errores accionables) → FL6 (channels en add_content_idea). Cada fix con su verificación del doc. Los P2 son opcionales salvo FL9 (badge IA conectada), que Ren pidió explícitamente para demos.

## Registro de ejecución (2026-10-12)

Ejecutados TODOS (P0+P1+P2) en un pase — ver commit REQ-048:
- **F1** `ensureGoogleFontImport` solo ensancha (nunca degrada) el eje del import existente.
- **F2** DesignFrame repinta al cargar cada `<link>` de font y en `document.fonts.ready`; `rasterizeFrame` espera `fonts.ready` antes del draw.
- **FL1** create_html_template siembra el PRIMER frame con el html/css (híbrido); si el contenido no cumple el contrato de capas, deja file-level + `warning` explícito.
- **FL2** executeFlow: string vacío en el payload NO pisa el default; required vacío falla INPUT_REQUIRED en el trigger.
- **FL3** errores de nodo tool llevan `recibido: {args}`; add_content_idea lista llaves recibidas.
- **FL4** editable-layers normaliza whitespace/`\n` literales del CSS, el wrapper con clase `root` es raíz estructural, y el error de posición sugiere la receta.
- **FL5** source_rss/source_nitter aceptan `{{input.x}}` en url (el runtime valida la URL resuelta).
- **FL6** verificado: schema+handler ya aceptan `channels`.
- **F3** nombres de capa con espacios normalizados (directText + htmlMutations).
- **FL7** update_content acepta `frameName` de confirmación (rechaza el pin si no coincide).
- **FL8+FL9** flow_history expone `aiConnected` y la bandeja de runs muestra el badge "● IA conectada / ● Sin IA conectada" en runs waiting.
- **FL10** playbook de flows documenta el patrón wait_webhook para captura de leads.
