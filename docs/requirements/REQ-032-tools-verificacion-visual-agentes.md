# REQ-032 — Tools de verificación visual para agentes: render_frame_png, text_metrics y diff_overlay

> **Prioridad:** P0 — sin esto, todo trabajo de réplica/creación de diseños por agentes es a ciegas.
> **Origen:** réplica AFEX Colombia (tpl_a4829b8c-042, 25-sep) salió con desbordes de texto, cinta diagonal mal anclada y logos falsificados — porque el agente no puede VER su propio output. Ren lo pidió explícito como feature de producto.
> **Evidencia del problema:** el tool actual `render_to_formats` devuelve una página HTML con html2canvas (un visor para humanos), no un PNG consumible por un agente. El browser headless del agente no comparte la sesión del editor. Resultado: cero loop de verificación visual → coordenadas estimadas a mano → desbordes y descuadres que solo el humano detecta después.

---

## 1. Los 3 tools (en orden de implementación)

### Tool 1 — `render_frame_png` (EL crítico)
Renderiza un frame a PNG real y devuelve la URL pública del asset (misma ruta que `upload_image`: bucket design-assets, URL firmada).

- **Input:** `templateId`, `frameId`, `width?` (default: el del frame), `height?`, `returnBase64?` (default false — si true, además incluye el b64 inline para consumo inmediato sin fetch).
- **Output:** `{ url, width, height, bytes }` (+ `base64` si se pidió).
- **Implementación:** el render headless ya existe (el pipeline de export PDF/PNG del editor rasteriza frames con `rasterizeFrame` en EditorV2 y hay render server-side en `/api/templates/:id/render`) — lo que falta es exponerlo como tool MCP que devuelva el archivo, no el visor html2canvas.
- **Regla de permisos:** mismo nivel que `get_template` (cualquier agente con API key del workspace). Es solo-lectura del diseño.
- **DoD:** agente llama el tool con un frame existente → recibe URL → descarga el PNG → el PNG coincide con lo que ve el humano en el editor (comparación manual 1 vez para calibrar).

### Tool 2 — `text_metrics` (medición puntual, NO autofit runtime)
Mide texto renderizado real y devuelve métricas — para que el agente ELIJA el tamaño correcto al crear, no para que el editor re-ajuste después.

- **Input:** `text`, `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `letterSpacing`, `boxWidth`, `boxHeight?`, `lineHeight?`.
- **Output:** `{ lines: number, renderedWidth: number, renderedHeight: number, overflows: boolean, suggestedFontSize?: number }` — `suggestedFontSize` solo si `overflows: true` y cabe bajar (mismo alto de caja).
- **DECISIÓN DE DISEÑO (pactada con Ren):** PROHIBIDO implementar esto como autofit en el runtime de render. El editor obedece "lo que ves es lo que hay": si el humano edita un texto, el texto NO se re-ajusta solo. Este tool es una medición que el agente consume EN TIEMPO DE CREACIÓN; el archivo resultante queda estático.
- **Implementación:** medición con canvas measureText en el server (mismo stack de rasterización del Tool 1; no necesita browser).
- **DoD:** con el caso real del AFEX: `text_metrics("ESTAMOS MÁS CERCA", Arial, 900, italic, 56, 620)` devuelve overflows=true y suggestedFontSize≈48 — dato que habría evitado el desborde.

### Tool 3 — `diff_overlay` (verificación sistemática contra referencia)
Compara el render de un frame contra una imagen de referencia (p.ej. el diseño original que se está replicando).

- **Input:** `templateId`, `frameId`, `referenceUrl` (o `referenceBase64`), `mode`: `"side-by-side" | "heatmap" | "score"`.
- **Output:** `side-by-side` → URL de una imagen compuesta (original | render); `heatmap` → URL de imagen con zonas de divergencia resaltadas + `{ divergentAreaPct, topDivergences: [{x, y, w, h, kind}] }` donde kind ∈ text-shape-shift, color-shift, missing-element, extra-element (heurística: suficiente para señalar DÓNDE, no qué es).
- **Implementación:** pillarel con Pillow/numpy ya validado en esta sesión (las verificaciones del fondo AFEX usaron exactamente este approach): render del Tool 1 + referencia → mismo tamaño → diff por bloques.
- **Regla:** es ayuda de localización, no oráculo — el output es sugerencia para el agente, que decide con su propia visión.
- **DoD:** con el AFEX original como referencia, el heatmap señala las zonas de texto desbordado que Ren detectó a ojo.

## 2. Items de trabajo (un item = un commit con verificación)

### Item 1 — `render_frame_png`
1. Endpoint MCP en `netlify/functions/mcp.mjs` (seguir el patrón de tools existentes; descripción honesta: "Renderiza un frame a PNG y devuelve URL — los agentes lo usan para VER su propio trabajo").
2. Reusar el rasterizador existente (server-side si ya hay; si solo existe client-side en EditorV2, extraer la parte Puppeteer/render-service que ya usa el export).
3. El PNG resultante se guarda como asset (`upload_image` interno) → URL firmada.
4. Test: render del frame de prueba devuelve PNG >0 bytes con dimensiones correctas; `node --check` limpio.

### Item 2 — `text_metrics`
1. Endpoint MCP con measureText server-side (canvas del runtime de render que ya existe; el tool NO debe lanzar browser).
2. Cache de métricas por (font, size, weight, style) — las fuentes del sistema no cambian entre llamadas.
3. Test: los 3 casos — texto que cabe, texto que desborda por ancho, texto que desborda por alto; suggestedFontSize correcto en el segundo.

### Item 3 — `diff_overlay`
1. Endpoint MCP que internamente llama el Tool 1, baja la referencia, normaliza tamaños y computa el diff (bloques de 32px, umbral de divergencia configurable, default 12%).
2. Output imagen compuesta (asset URL) + JSON de divergencias.
3. Test: render vs sí mismo → divergentAreaPct = 0; render vs original AFEX → señala las 3 zonas de texto que Ren reportó.

### Item 4 — Documentación y descubrimiento
1. Actualizar la descripción de los 3 tools en la lista MCP y en `SKILL.md` del repo si existe la sección de tools para agentes (Ren mantiene una con ~324 tools).
2. Ejemplo de uso encadenado en la descripción de `diff_overlay`: "flujo réplica: import_design → render_frame_png → diff_overlay → corregir CSS → repetir hasta divergencia < umbral".

## 3. Reglas (no negociables)
- Un item = un commit con verificación citada. Sin dependencias nuevas (Pillow/canvas ya están en el stack del render).
- **PROHIBIDO autofit en runtime de render** — decisión de producto pactada: el editor nunca re-escribe el trabajo del humano. `text_metrics` es solo medición.
- Los tools son solo-lectura de diseños: no mutan templates (solo crean assets de render/diff).
- NADA pusheado sin orden explícita de Ren.

## 4. Definición de Done
- [ ] `render_frame_png` devuelve URL de PNG descargable, dimensiones correctas, verificado contra el editor visualmente 1 vez.
- [ ] `text_metrics` con el caso AFEX detecta el overflow real (overflows=true, suggestedFontSize correcto).
- [ ] `diff_overlay` con referencia AFEX original señala las zonas desbordadas; render vs sí mismo = 0%.
- [ ] Los 3 tools aparecen en la lista MCP con descripciones que un agente entiende sin contexto.
- [ ] Tests verdes; tsc/node --check limpios; commits organizados; nada pusheado.

---

## 5. PROMPT PARA EL AGENTE IDE (copiar/pegar completo)

Lee y ejecuta `docs/requirements/REQ-032-tools-verificacion-visual-agentes.md` completo. Son 3 tools MCP nuevos que dan a los agentes verificación visual de su propio trabajo de diseño.

Por qué existen (contexto real, no lo reinventes): la réplica AFEX de ayer salió con textos desbordados y cinta mal rotada porque el agente no puede ver su output — `render_to_formats` devuelve un visor html2canvas para humanos, no un PNG consumible, y el browser del agente no comparte la sesión del editor.

Ejecuta los items del §2 EN ORDEN:
- **Item 1 `render_frame_png` (crítico):** tool que rasteriza un frame al PNG real y devuelve URL de asset firmada. Reusa el rasterizador existente del pipeline de export; no implementes un renderer nuevo.
- **Item 2 `text_metrics`:** medición de texto renderizado con measureText server-side + cache por combinación de fuente. IMPORTANTE — decisión de producto: es medición puntual para el agente en tiempo de creación; está PROHIBIDO implementarlo como autofit del runtime (el editor jamás re-ajusta textos del humano).
- **Item 3 `diff_overlay`:** compara render (via Tool 1) contra imagen de referencia; modos side-by-side/heatmap/score; bloques de 32px, umbral default 12%; output asset URL + JSON de divergencias localizadas.
- **Item 4:** documentar los 3 en la lista MCP con descripciones autocontenidas y el flujo encadenado de réplica en la descripción de diff_overlay.

Reglas: un item = un commit con verificación citada (comandos + resultados). Sin dependencias nuevas. Los tools NO mutan diseños (solo crean assets de render/diff). PROHIBIDO autofit en runtime. NADA pusheado sin orden explícita de Ren.

DoD §4: verifica cada punto con evidencia real —incluido el caso AFEX del Item 2 (la medición debe marcar overflow del texto "ESTAMOS MÁS CERCA" a 56px en caja de 620px) y del Item 3 (diff contra el original señala las zonas que Ren reportó: titular desbordado, AYUDACOL cortado, bancos encimados). Si no puedes ejecutar una verificación que requiera el diseño en prod, decláralo bloqueado con lo verificado — no lo inventes. Reporta: commits + resultado de cada punto del DoD.
