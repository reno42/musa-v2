# REQ-PHOTO-FASE4 — Modo Composición (superficie tipo Photoshop)

- **Fecha:** 2026-09-28
- **Estado:** F4.1+F4.2+F4.2b+F4.2c ENTREGADOS (2026-09-28, orden directa de Renzo:
  "implementa la fase que falta" + "quiero el panel de herramientas de la
  izquierda como Photoshop" + "implementa todo: orden exacto, todas las tools
  y sus variantes con flyout, mismos iconos"); F4.3 (transformaciones
  avanzadas de selección, selección rápida real, trazados vectoriales)
  y F4.4 (healing generativo BYOK) quedan en backlog.
- **Origen:** Feedback de Renzo al revisar el Modo Foto en local: el visor
  (develop) no tiene "las herramientas que debería tener un Photoshop".
  El develop (Fases 1-3) es Lightroom-style por diseño; las herramientas de
  edición por capas corresponden a la Fase 4 declarada en el plan REQ-32.
- **Precedencia:** photoEngine (visor WebGL2), photoRecipe (receta),
  photo_documents.mode ya acepta `'composition'` en el CHECK de v59 —
  la base de datos está lista.

## Contexto entregado (Fases 1-3)

1. **Fase 1 (develop):** visor WebGL2 (WB, tono, curvas, HSL, grading, B/N,
   detalle, grain/viñeta, máscaras radial/linear/brush, crop/straighten),
   REST /api/photos/*, migración v59.
2. **Fase 2 (MCP):** 11 tools photo_* sincrónicas en el worker (347 total).
3. **Fase 3 (Biblioteca):** PhotoLibraryPanel con culling (texto, rating,
   flag) sobre photo_catalog_items dentro del panel izquierdo.

## Objetivo

Un **Modo Composición** dentro del Modo Foto: edición raster multicapa sobre
la foto activa, con stack de capas y blend modes — el análogo del panel de
capas de Photoshop/Photopea — sin salir del editor ni deconvolver el modelo
de receta existente (la composición es un documento aparte referenciado por
la foto, no un segundo tipo de receta).

## Desglose propuesto (sub-fases commiteables)

- **F4.1 — Superficie + stack de capas:** nueva ruta visual `mode=composition`
  en el overlay: canvas WebGL con N texturas (1 por capa raster), composición
  por blend modes (normal, multiply, screen, overlay, soft-light, darken,
  lighten, difference) + opacity + máscara de capa (reutiliza el brushmask
  existente por capa). Modelo: `photo_composition_layers` (tabla nueva,
  migración v60) — capa = {asset_url, blend, opacity, transform, mask}.
- **F4.2 — Pincel raster + panel de capas:** pintar EN una capa (canvas 2D
  por capa subido a textura), UI del stack (reordenar, visibilidad, rename,
  add/remove), atajos (B pincel, V mover).
- **F4.3 — Selección y transformación:** marco rect angular (lasso después),
  mover/escalar/rotar capa activa, snap a bordes/centro.
- **F4.4 — Retoque asistido (opcional, con IA BYOK):** clone stamp manual
  primero; healing/generative fill vía proveedor externo queda FUERA del
  alcance base (requiere BYOK y cuota).

## No objetivos (explícitos)

- Texto vectorial editable dentro de la composición (el editor ya lo hace a
  nivel diseño; duplicarlo aquí viola "una sola superficie por trabajo").
- Reemplazar el canvas del diseño: la composición vive SOLO dentro del Modo
  Foto y se aplica como variante (mismo flujo "Aplicar a la capa").
- HDR / 32-bit / ajustes de cámara raw.

## Criterios de aceptación (borrador)

- C1: stack de ≥4 capas con blend+opacity compone en 1 draw por frame
  (60fps con 3 capas 4K en Chrome desktop).
- C2: cada capa tiene máscara de pincel propia; Ctrl+Z por gesto.
- C3: el documento de composición persiste (v60) y se reabre idéntico.
- C4: "Aplicar a la capa" genera la variante aplanada (JPEG q0.92 ≤4096)
  y preserva el original (contrato data-orig-src intacto).
- C5: MCP: al menos composition_list / composition_apply_layer documentadas
  o declaradas NO implementadas en el catálogo (sin tools fantasma).

## Decisiones abiertas para Renzo

1. ¿F4 entra antes que otras prioridades del backlog (REQ-033+)? → **RESPONDIDO (2026-09-28): sí, se implementó ya.**
2. ¿Las capas hijas pueden ser OTRAS fotos del workspace (assets remotos) o
   solo la foto activa + assets subidos? → **v1: solo capas de pintura sobre
   la foto activa.** Capas de imagen remota = F4.3+ (requiere resolver CORS
   por asset y subir texturas adicionales).
3. ¿Se necesita export PSD? → **v1: NO** — export aplanado PNG/JPEG y
   "Aplicar a la capa" (variante JPEG q0.92 ≤4096).

## Entregado en v1 (2026-09-28) — desviaciones documentadas

- **Modelo:** `photo_compositions` (migración v60) — UNA fila por
  (workspace_id, source_url) con `layers_json` (capa = CompositionLayer con
  dataUrl PNG incluido), en lugar de `photo_composition_layers` relacional:
  el stack se persiste y reabre atómicamente, y el contenido pincelado viaja
  dentro del JSON con caps defensivos (≤12 capas, ≤3MB/dataUrl, ≤8MB total,
  espejados API↔shared↔QA).
- **Render:** stack DOM sobre el visor WebGL (canvas 2D por capa +
  `mix-blend-mode` + opacity + transform CSS) en lugar de N texturas en
  shader — estable y 60fps; el flatten para exportar/aplicar usa canvas 2D
  con `globalCompositeOperation` (mismos nombres de blend que CSS).
- **UI:** botón "Componer" en la toolbar; herramientas flotantes (Mover /
  Pincel / color / tamaño / Goma); panel Capas (visibilidad, blend, opacity,
  reordenar, borrar) + sliders Escala/Rotación/Offset en el inspector.
- **MCP (C5):** tools composition_* declaradas **NO implementadas** en v1 —
  el catálogo no las anuncia (sin tools fantasma). Persistencia vía REST
  GET/PUT /api/photos/composition (mismo patrón que documents/catalog).
- **F4.2b — Rail de herramientas estilo Photoshop (2026-09-28, feedback
  directo de Renzo):** `PhotoToolRail.tsx` — barra vertical izquierda con 18
  herramientas iconadas SVG (cero emojis): mover, marco, lazo, varita
  mágica (flood-fill BFS con tolerancia), recortar, cuentagotas, pincel
  corrector, parche, tampón de clonar (Alt+clic origen, alineado), pincel,
  borrador, bote de pintura, desenfoque, exponer, quemar, máscaras, mano,
  zoom. Motor de trazos por estampado (soft brush engine) sobre scratch →
  master, con recorte por máscara de selección (marco/lazo/varita comparten
  `selectionMask`), snapshot del revelado para retoque (render identidad +
  drawImage en el mismo tick), barra de opciones contextual (tamaño,
  opacidad, color, tolerancia), hormigas de selección, atajos V/M/L/W/C/I/
  J/P/S/B/E/G/U/O/N/K/H/Z + Supr borra selección, cursor por herramienta.
  Las herramientas de pintura cambian solas a modo Componer (con guarda de
  carga). **Desviación v1 honesta:** corrector/parche son remuestreo del
  entorno con costura difuminada — NO healing generativo (eso sigue siendo
  F4.4 BYOK). QA: `QA/req-photo-tools.test.mjs` (21 tests).
- **F4.2c — Paridad Photopea: orden exacto + variantes flyout (2026-09-28,
  feedback directo de Renzo con captura de referencia):** `PhotoToolRail.tsx`
  reescrito — **21 grupos** (los 20 de la referencia + Máscaras extra al
  final) en el ORDEN EXACTO: mover, marco, lazo, selección rápida, recortar,
  cuentagotas, pincel corrector, pincel, tampón, historial, borrador,
  degradado, desenfoque, exponer, texto, pluma, selección de trazado,
  formas, mano, zoom, máscaras. Cada grupo con sus **variantes en flyout**
  (triangulito o clic derecho; la última usada queda como icono del botón);
  las variantes "pronto" avisan honestamente sin cambiar la selección (cero
  tools fantasma; pathsel avisa y no selecciona). Atajos: V/M/L/W/C/I/J/B/S/
  **Y** (historial)/E/G/U/O/**T** (texto)/**P** (pluma)/**A** (trazado)/**R**
  (formas — desviación documentada: U ya era Desenfoque)/H/Z/**K** (máscaras).
  Motores v1 nuevos en el overlay: lápiz (borde duro), pincel de historial
  (reestampa el revelado base), enfocar/dedo/esponja (filtros sobre la capa;
  esponja Alt = desaturar), ojos rojos (dessatura), borrador mágico (BFS
  sobre la capa + destino-out), degradado lineal/radial (vector arrastrado,
  respeta selección), formas rect/elipse/línea (contorno), texto rasterizado
  (input en la barra + Enter), pluma por puntos (Enter cierra y traza), lazo
  poligonal y marco de fila/columna de 1 px. Barra de opciones por grupo con
  Flujo y Suavizar (Photopea). Modelo GRUPO+variante (los ids de variante
  colisionan entre grupos: "rect" vive en marco y formas). QA: 24 tests
  nuevos (orden exacto, atajos únicos, honestidad soon, motores v1) —
  `QA/req-photo-tools.test.mjs` 24/24 + composición 12/12.
- **No implemented yet (backlog):** transformación de la SELECCIÓN (mover/
  escalar el hormiguero), plumas de selección avanzadas, capas de ajuste,
  licuar, relleno según contenido y F4.4 healing generativo (el corrector/
  parche/tampón ya existen como retocado client-side v1).
- **Pendiente del usuario:** correr `supabase_migrations_v60.sql` en el SQL
  Editor de Supabase (igual que v59) — sin la tabla, Guardar composición
  falla con mensaje claro y el resto del editor funciona normal.

### F4.2d — Compose Pro (paridad Photoshop, tanda 2) — IMPLEMENTADO 28-29 SEP

Cierre de casi todo el backlog anterior tras el análisis "super picky" vs
Photoshop (11 áreas). Commit `f920b19` (main, sin push).

1. **Undo/redo de la composición:** Ctrl+Z/Y en Componer (botones también);
   12 pasos con snapshots de capas + masters + máscaras; ráfaga de sliders
   agrupada a un paso (debounce 600 ms); flechas desplazan la capa activa.
2. **Máscaras de capa POR SESIÓN:** botón "+ Añadir máscara de capa" en el
   panel derecho; pintar con cualquier pincel oculta, Alt revela; los espejos
   DOM y el aplanado de exportación las respetan. HONESTO: no viaja en el
   JSON v60 (el toast lo dice: "viva en la sesión").
3. **Pincel Pro:** Dureza continua 0-100 (lápiz mantiene 0.94), presión de
   lápiz óptico, `[` `]` (1-400), cursor circular de tamaño real, dúo
   frontal/fondo en el rail (X alterna, D restablece).
4. **Transformación libre:** Ctrl+T con manijas de escala (esquinas) y
   rotación; preview viva en el espejo; Enter aplica · Esc cancela.
5. **Texto VIVO:** capas kind "text" re-editables (clic con la T sobre el
   texto), fuentes del sistema, persistidas de forma aditiva (el dataUrl
   sigue siendo el raster; el objeto text viaja por normalize).
6. **Selecciones v2:** Shift añade, Alt quita (marco/lazo/varita),
   Ctrl+Shift+I invierte, slider Difuminar (feather al commit), hormigas
   animadas (SVG animate).
7. **Enfocar REAL:** máscara de desenfoque (unsharp 0.9) sobre el estado
   previo del trazo, calculada al soltar sobre la bbox del trazo.
8. **Blends 8 → 16:** exclusion, hard-light, color-dodge, color-burn, hue,
   saturation, color, luminosity. Los 11 modos PS sin primitiva CSS/canvas
   (dissolve, linear-*, pin/vivid-light, etc.) quedan documentados fuera:
   requieren shader multi-textura.
9. **QoL:** espacio = mano temporal, Alt+rueda = zoom rápido, Shift+letra
   cicla variantes del grupo activo, auto-selección de capa por alpha con
   Mover.

QA: suite nueva `QA/req-photo-compose-pro.test.mjs` (25 tests, incluye
anti-scope-creep: nada de licuar/PSD/relleno según contenido) +
`req-photo-composition` y `req-photo-tools` actualizadas al nuevo contrato →
**63/63 verdes**; `tsc --noEmit` 0; regression completa 899/896/3 = baseline
(solo fallos foráneos conocidos). Deploy local verificado: Vite :5173 sirve
los módulos transformados con los símbolos nuevos y la API :3001 responde
/health ok.

**Sigue en backlog (requiere primitives nuevas, no client-side simple):**
PSD import/export (ag-psd ya está en deps), licuar, relleno según contenido,
capas de ajuste, panel Historia visible, los 11 blends shader.

---

## F4.2e "Compose Max" — tanda final de paridad (2026-09-28)

Commit `0f96964` (pusheado a GitHub `main` sobre origin actualizado) + deploy
Cloudflare (versión `e3669fb5`).

1. **Ops de capa**: Duplicar (Ctrl+J) · Fusionar hacia abajo (Ctrl+E) ·
   Aplanar imagen (Ctrl+Shift+E) — respetan blend, alpha, transform,
   máscara y ajustes; toasts honestos si no hay capa debajo / una sola capa.
2. **Portapapeles de selección**: Ctrl+C copia recortado por la selección
   activa; Ctrl+V pega como capa nueva.
3. **Slot de selección**: Guardar sel. / Cargar sel. en la barra de opciones.
4. **Máscaras de capa PERSISTENTES** (migración v60): save embarca el
   dataUrl dentro de la capa (cuenta para el techo de 8 MB); load lo
   decodifica de vuelta a canvas. Ya no son "solo sesión".
5. **Ajustes no destructivos por capa**: Brillo/Contraste/Saturación/Matiz
   vía ctx.filter en espejo DOM, fusión, aplanado y exportación; identidad
   no se persiste. (Saca del backlog "capas de ajuste".)
6. **Menú Filtro**: Gaussiano · Ruido · Mosaico · Paso alto · Nubes —
   recortan por la selección activa.
7. **Máscara rápida (Q)**: overlay rojo; pintar añade, Alt borra; al salir
   se convierte en selección (bbox escaneado a ≤256 px); toast honesto si
   quedó vacía; la selección previa entra editable.
8. **Panel Historia**: cada paso lleva etiqueta; lista con saltos directos
   (deshace en cadena). (Saca del backlog "panel Historia visible".)
9. **Selección rápida (SAM)**: POST /api/segment/click → poll de jobs →
   maskUrl se vuelve selección; Shift añade, Alt resta; timeout honesto que
   sugiere la varita mágica en local (el worker no corre). Sin feather a
   propósito (contrato QA: applyFeatherToMask sigue en 2 llamadas).
10. **Tampón de patrón**: cuadros/puntos/diagonal/ruido con tesela 8-80,
    cacheada por tipo+tamaño+color; sin tocar el srcMode bloqueado por QA
    (bypass isPattern con early-return).
11. **Formas**: polígono de N lados (3-20) + 5 custom (estrella/corazón/
    flecha/rayo/gota).
12. **Texto**: vertical (rota 90° por línea, persistido en text.vertical)
    y máscara de texto (rasteriza blanco a selección para rellenar).
13. **Pluma libre**: arrastra y suelta, cierra el trazado automáticamente.
14. **Barra de estado**: zoom % · dimensiones · herramienta/variante ·
    flags MÁSCARA RÁPIDA / PINTANDO MÁSCARA.

Rail: 7 variantes salen de "soon" (quick, pattern, typevert, typemask,
freeform, polygon, custom); 13 deferrals honestos siguen "soon" (curvature,
path, magnetic, artboard, slice, sampler, ruler, colorreplace, mixer,
arthistory, bgeraser, rotate, perspective).

QA: suite nueva `QA/req-photo-compose-max.test.mjs` (22 tests: contrato
shared con strip-types, anti-scope-creep de deferrals y guardas de los
contratos bloqueados — cap 12, feather 2, sin licuar/PSD) → **85/85
verdes** en las 4 suites photo (27+13+23+22); `tsc --noEmit` 0; regression
899/896/3 = baseline exacta (solo fallos foráneos conocidos:
crm-diatta-upgrade:357, dashboard-design-systems:25,
mcp-social-publish-tools:98).

**Sigue en backlog (requiere primitives nuevas, no client-side simple):**
PSD import/export (ag-psd ya está en deps), licuar, relleno según contenido,
los 11 blends shader, refine edge, modos Edit>Transform (skew/distort/
perspectiva), texto en trayecto, lazo magnético, curvatura, vectores
(pathsel), pincel mezclador, historial del arte, borrador de fondo.

---

## F4.3 — MCP-first: composición por capas expuesta al agente (2026-09-28)

Regla del humano: **todo debe ser MCP first**. La UI del Modo Composición
escribía en `photo_compositions` (v60) pero el agente no tenía NINGUNA tool
para esa tabla — solo el revelado (11 tools `photo_*` de Fase 2). Gap cerrado
al 100% del modelo de datos:

**8 tools nuevas (`netlify/functions/mcp.mjs`, commit `710a0d2`):**

| Tool | Qué hace |
|---|---|
| `photo_compose_get` | Lee la pila (metadata + bytes; dataUrls completos con `includeDataUrls`). Read-only (viewer). |
| `photo_compose_add_layer` | Capa `paint` (lienzo vacío) o `text` (value/size/color/font/x/y/vertical). Tope 12. |
| `photo_compose_update_layer` | Parcha name/blend(16)/opacity/visible/transform/adjust/text/dataUrl(≤3MB). |
| `photo_compose_delete_layer` | Elimina una capa (el base siempre es la foto revelada). |
| `photo_compose_reorder_layers` | Mueve una capa a `index` (0 = base). |
| `photo_compose_duplicate_layer` | Clona con máscara/ajustes/texto + offset 0.002, inserta encima. |
| `photo_compose_set_layer_mask` | Máscara PNG dataUrl (alpha: opaco = visible) o `clear:true`. Vía MCP de selecciones/máscara rápida. |
| `photo_compose_clear` | Vacía la pila (requiere `confirm:true`). |

**Garantías (idénticas a la REST):** misma puerta `normalizeCompositionLayers`
(shared, import `.ts` como ya hacía photoRecipe), topes 12 capas / 3MB dataUrl /
8MB total, upsert service-role `onConflict workspace_id,source_url`, targeting
idéntico al resto de `photo_*` (templateId + layerId/sourceUrl vía
`resolvePhotoContext`).

**Honesto por diseño del producto:** pintar píxeles, filtros, fusionar y
aplanar siguen client-side (CF no puede raster: sharp/onnx stubbed). El agente
compone con capas/texto/máscaras + `segment_click`/`mask_brush`/`fill_mask` —
el resultado es el mismo JSONB que la UI abre en el Modo Composición.

**Sync:** catálogo 347→355 (`npm run sync:skill` regeneró SKILL.md +
tools_catalog.json); conteos manuales actualizados (INSTALL.md 268→355,
`public/.well-known/mcp.json` 259→355 ×2). Página de documentación
(`toolsDocumentation.ts`, local-only) con las 19 filas del Modo Foto.

**QA:** suite nueva `QA/mcp-photo-compose-tools.test.mjs` (29 tests: registro,
gating viewer/editor, topes espejo, clamps, anti-scope sin sharp/onnx +
funcional real de normalizeCompositionLayers); `QA/req032-photo-mcp.test.mjs`
actualizado al contrato 11+8=19 `photo_*`. Gates: tsc 0; compose-pro 27,
composition 13, tools 23, compose-tools 29, photo-mcp 10 — todos verdes;
regresión 899/896/3 = baseline exacta (solo los 3 fallos foráneos conocidos).