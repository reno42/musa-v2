# 🎨 DESIGN TOOL MCP — Guía Completa para Mira

**Versión:** 3.1 — 20 Agosto 2026 (agrega Animación, Transiciones y export a video F0/F1)

---

## ⚡ CONEXIÓN

```
URL MCP:  https://bejewelled-llama-a6719d.netlify.app/mcp
API Key:  fdr_ws_beIyGjsGSdlRMU2W4nj4jostikL_sS_f
Workspace: ws_user_8e9f031817184e0ab205
```

---

## 🎯 CAPACIDADES — Qué puedo hacer

### 1. MEDIDAS Y ADAPTACIÓN AL FRAME
**Problema:** No salirme de los bordes del frame al diseñar.
**Solución:** Antes de diseñar, obtener dimensiones con `get_template` o `get_frame`. Usar `detect_structure` para conocer regiones (hero, headline, body, CTA).

```json
// Obtener medidas del frame
{"name":"get_template","arguments":{"templateId":"tpl_xxx"}}
// → width, height, frames[].width, frames[].height

// Detectar regiones del layout
{"name":"detect_structure","arguments":{"templateId":"tpl_xxx","frameId":"frame_xxx"}}
// → regions: hero, headline, body, cta con coordenadas
```

**Regla:** body CSS debe tener `width` y `height` que coincidan con el frame.

---

### 2. EXTRAER ESTILOS Y DISEÑAR CON TOKENS
**Problema:** Usar los mismos colores, fuentes y espaciados de diseños existentes.
**Solución:** `extract_design_system` o `generate_design_artifacts`.

```json
// Extraer sistema de diseño completo
{"name":"extract_design_system","arguments":{"templateId":"tpl_xxx"}}
// → tokens: colores, tipografía, espaciado, bordes, sombras

// Generar artifacts (DESIGN.md + tokens.json + shared.css)
{"name":"generate_design_artifacts","arguments":{"templateId":"tpl_xxx","action":"generate"}}
// → designMd, tokensJson, sharedCss, sourceHash

// Publicar como brand guideline (queda en DB)
{"name":"generate_design_artifacts","arguments":{"templateId":"tpl_xxx","action":"publish","brandName":"Futuraria"}}
// → brandId, _published: true
```

**Flujo:** Extraer → usar los tokens en CSS custom properties → diseñar con consistencia.

---

### 3. MARCAS EN CRM (Brand Guidelines)
**Problema:** Tener todas las marcas de proyectos registradas y aplicables.
**Solución:** `create_brand_guideline` + `apply_brand_to_template`.

```json
// Listar marcas existentes
{"name":"list_brand_guidelines","arguments":{"workspaceId":"ws_user_8e9f031817184e0ab205"}}

// Crear nueva marca
{"name":"create_brand_guideline","arguments":{
  "workspaceId":"ws_user_8e9f031817184e0ab205",
  "name":"Plaza Aurora",
  "tokensJson":"{...}",
  "designMd":"# Plaza Aurora Brand\n..."
}}

// Aplicar marca a template
{"name":"apply_brand_to_template","arguments":{"templateId":"tpl_xxx","brandId":"brand_xxx"}}
// → El template hereda tokens, CSS variables y estilos de la marca
```

**Marcas a registrar:** Futuraria, Plaza Aurora, Diatta, GHCoin, Mirella Bartra, FoodPrice, Dental 3D.

---

### 4. CSV BATCH — Plantilla → CSV → 30 diseños
**Problema:** Crear 20-30 variantes de un diseño cambiando textos e imágenes.
**Solución:** Pipeline de 3 pasos.

```json
// PASO 1: Profilear templates para detectar slots
{"name":"profile_template_pool","arguments":{"templateIds":["tpl_xxx"]}}
// → profiles, csvColumns, totalSlots

// PASO 2: Generar CSV template para humano
{"name":"generate_csv_template","arguments":{"templateIds":["tpl_xxx"],"rowCount":30}}
// → csv con columnas y filas vacías

// PASO 3 (después de que humano llena el CSV): Aplicar
{"name":"apply_csv_to_frames","arguments":{
  "workspaceId":"ws_user_8e9f031817184e0ab205",
  "csvData":"<CSV llenado por humano>",
  "templateIds":["tpl_xxx"],
  "outputName":"Batch Export - 28 Jul",
  "naming":"Post {index} - {titulo}",
  "onOverflow":"truncate"
}}
// → outputTemplateId con todos los frames generados
```

**Uso de `data-slot`:** Agregar `data-slot="titulo"` en el HTML para nombrar columnas del CSV explícitamente.

---

### 5. DESIGN SYSTEM DESDE FRAMES
**Problema:** Generar un sistema de diseño completo desde cualquier template.
**Solución:** `extract_design_system`.

```json
{"name":"extract_design_system","arguments":{"templateId":"tpl_xxx"}}
// → Extrae: colores, tipografías, espaciados, componentes, variables CSS
// → Útil para documentar y reutilizar en otros diseños
```

---

### 6. MANUAL DE MARCA
**Problema:** Generar PDF/HTML de identidad visual completo.
**Solución:** `generate_brand_manual`.

```json
{"name":"generate_brand_manual","arguments":{
  "templateId":"tpl_xxx",
  "brandName":"Futuraria",
  "tagline":"Automatización con IA para empresas"
}}
// → brandManualHtml: documento completo con portada, paleta, tipografía, componentes
```

---

### 7. STYLE TRANSFER — Copiar estilo de A a B
**Problema:** "¿Cómo se vería este diseño con los colores de Plaza Aurora?"
**Solución:** 4 pasos.

```json
// PASO 1: Extraer estilos del diseño fuente (A)
{"name":"generate_design_artifacts","arguments":{"templateId":"tpl_A","action":"publish","brandName":"Estilo Fuente"}}
// → brandId_A

// PASO 2: Duplicar el diseño destino (B)
{"name":"duplicate_template","arguments":{"id":"tpl_B","name":"Diseño B - Con estilo A"}}
// → nuevo templateId

// PASO 3: Aplicar marca al duplicado
{"name":"apply_brand_to_template","arguments":{"templateId":"nuevo_id","brandId":"brandId_A"}}
// → El diseño B ahora tiene los tokens visuales de A

// PASO 4: Renderizar para comparar
{"name":"render_html_template","arguments":{"templateId":"nuevo_id"}}
```

---

### 8. CRONJOBS DE DISEÑO
**Problema:** Diseños pendientes que Mira o Lara deben crear automáticamente.
**Solución:** Cronjob en Hermes que lee lista de pendientes y diseña.

```bash
# Ejemplo: cronjob diario que revisa diseños pendientes
hermes cronjob create \
  --schedule "0 9 * * *" \
  --name "Diseños pendientes" \
  --deliver "telegram" \
  --prompt "Revisa el archivo DISENOS_PENDIENTES.md en Obsidian. Si hay diseños nuevos marcados como 'listo_para_diseñar', créalos usando el MCP del Design Tool. Usa import_design con el HTML/CSS especificado. Actualiza el estado a 'diseñado' y reporta en Telegram."
```

---

### 9. CALADO, MÁSCARAS Y SELECCIÓN DE IMÁGENES (F1-F4)

**Problema:** Recortar sujetos (calar), enmascarar zonas y quitar fondos sin destruir el original.

**Regla de oro:** el **path SVG cerrado es la fuente de verdad** de la máscara
(`data-mask-for` + `data-mask-mode`). Todo re-bakea desde él y sigue editable con
`edit_path_points`. Los píxeles del `<img>` jamás se tocan.

#### Flujo A — Calado vectorial (F1): dibujar y recortar

```json
// 1. Dibujar un path cerrado alrededor del sujeto (o usar draw_bezier existente)
{"name":"draw_path","arguments":{"templateId":"tpl_xxx","frameId":"fr_xxx","pathData":"M 50 50 L 250 50 L 250 200 L 50 200 Z","layerName":"silueta"}}

// 2. Crear la selección: el exterior desaparece (mode include)
{"name":"create_mask_from_path","arguments":{"templateId":"tpl_xxx","frameId":"fr_xxx","targetImageLayerId":"img_1","pathElementId":"path_7","mode":"include"}}

// 3. Ajustar la silueta: la máscara re-bakea sola
{"name":"edit_path_points","arguments":{"templateId":"tpl_xxx","frameId":"fr_xxx","elementId":"path_7","newPathData":"M 60 40 L 260 40 L 260 210 L 60 210 Z"}}

// 4. Invertir (quedar solo el exterior) o rellenar el sujeto de color
{"name":"invert_mask","arguments":{"templateId":"tpl_xxx","frameId":"fr_xxx","imageLayerId":"img_1"}}
{"name":"fill_mask","arguments":{"templateId":"tpl_xxx","frameId":"fr_xxx","imageLayerId":"img_1","fill":"#3B82F6"}}
```

#### Flujo B — Quitar fondo automático (F3, u2netp ONNX local)

```json
// Idempotente por asset: repetir devuelve el cutout existente sin reprocesar.
{"name":"remove_background","arguments":{"assetId":"ast_123","applyTo":{"templateId":"tpl_xxx","frameId":"fr_xxx","layerId":"img_1"}}}
// → { jobId, status: "done", result: { cutoutUrl, maskUrl, svgPath, width, height }, applied: true }
// Si devuelve status "queued" (cold start): {"name":"segment_status","arguments":{"jobId":"seg_xxx"}}
```

#### Flujo C — Varita (F2): seleccionar con clics o con texto

```json
// SAM por clics: puntos normalizados 0..1 (o px + imageWidth/imageHeight); neg=true = fondo
{"name":"segment_click","arguments":{"url":"https://…/foto.jpg","points":[{"x":0.5,"y":0.5},{"x":0.1,"y":0.9,"neg":true}],"workspaceId":"ws_…"}}

// CLIPSeg por texto (F2b): "la persona" — sin puntos; prompt toma precedencia
{"name":"segment_click","arguments":{"url":"https://…/foto.jpg","prompt":"la persona","workspaceId":"ws_…","applyTo":{"templateId":"tpl_xxx","frameId":"fr_xxx","layerId":"img_1"}}}
// → { result: { svgPath: { dNorm: "M0.1 0.2 … Z" } }, applied } — la máscara queda editable con edit_path_points
```

#### Flujo D — Borrador no destructivo (F4)

```json
{"name":"mask_brush","arguments":{"templateId":"tpl_xxx","frameId":"fr_xxx","imageLayerId":"img_1","strokes":[{"points":[{"x":10,"y":10},{"x":40,"y":30}],"size":24,"mode":"erase"}]}}
// → Trazos negros (borran) o blancos (restauran, mode:"restore"); acumulan en data-mask-brushes
```

**Notas:** 0 tokens de LLM — los 3 modelos corren en ONNX local (u2netp, MobileSAM, CLIPSeg int8). Primer job de cada modelo descarga pesos (~4.5/40/100MB) → cold start lento, después 1-4s.

---

## 📐 FLUJOS RÁPIDOS (copy-paste)

### Crear diseño nuevo
```
create_template → import_design → render_html_template
```

### Crear batch de 30 posts
```
profile_template_pool → generate_csv_template → (humano llena CSV) → apply_csv_to_frames
```

### Extraer marca y aplicarla
```
generate_design_artifacts(publish) → apply_brand_to_template
```

### Style transfer
```
generate_design_artifacts(A, publish) → duplicate_template(B) → apply_brand_to_template(B, brand_A)
```

### Manual de marca
```
generate_brand_manual → guardar HTML
```

### Calar una imagen
```
draw_path (silueta) → create_mask_from_path (include) → edit_path_points (refinar)
```

### Quitar fondo y calar sujeto
```
remove_background (→ cutoutUrl) → segment_click (prompt o clics) → mask aplicada editable
```

### 10. ANIMACIÓN Y TRANSICIONES (F0)
**Problema:** Dar movimiento a un diseño (entrada de capas, loop suave) y encadenar frames con transiciones, sin tocar CSS a mano.
**Solución:** El frame guarda `animation` — UN solo esquema JSON (timeline + clips + tweens) que el editor compila a WAAPI para preview y el export usa para video. Las tools editan ese esquema; jamás escriben CSS animations sueltas.

```json
// Ver catálogo de presets y easings (10 presets, spring incluido)
{"name":"list_animation_presets","arguments":{}}
// → presets: fade-in, slide-in-up, zoom-in, pop, float, typewriter, ...

// Atajo: aplicar presets a una capa (reemplaza SU clip, conserva el resto)
{"name":"set_animation","arguments":{"templateId":"tpl_xxx","frameId":"frame_xxx",
  "presetIds":["fade-in","slide-in-up"],"presetLayerId":"layer_headline"}}
// El 2º preset REEMPLAZA al 1º en esa capa (1 clip por capa) — para combinar
// efectos, manda 2 capas o un animation completo con tweens multi-prop.

// Esquema completo (control total): keyframes t=0..1 DENTRO de la ventana del clip
{"name":"set_animation","arguments":{"templateId":"tpl_xxx","frameId":"frame_xxx",
  "animation":{"timeline":{"durationSec":5,"fps":30,"loop":"pingpong"},
    "clips":[{"layerId":"layer_headline","startSec":0.2,"endSec":1.4,
      "tweens":[{"prop":"opacity","easing":"ease-out-expo",
        "keyframes":[{"t":0,"value":"0"},{"t":1,"value":"1"}]}]}]}}}

// Leer / auditar
{"name":"get_animation","arguments":{"templateId":"tpl_xxx","frameId":"frame_xxx"}}
// → stats: clips por capa, duración, loop, transitions

// Transición hacia el siguiente frame (vive en el frame ORIGEN)
{"name":"apply_transition","arguments":{"templateId":"tpl_xxx","frameId":"frame_a",
  "toFrameId":"frame_b","type":"slide","durationSec":0.8}}
```

**Reglas:**
- 1 clip por capa; los tweens declaran `prop` + `keyframes[{t,value}]` + `easing` (nombre CSS, `cubic-bezier(...)` o `spring(damping,stiffness)`).
- Props animables: `transform, opacity, filter, color, backgroundColor, backgroundPosition, clipPath, width, height, top, left`.
- Preview en el editor: selecciona el frame → pestaña **Animation** (play/scrub/loop). El video exportado usa el MISMO sampler — lo que ves es lo que descargas.
- Export a video (WebM/MP4): botón **Exportar video** en el panel Animation del editor — 100% navegador, 0 invocaciones, 0 tokens LLM (F1).

---

## 🚫 ERRORES COMUNES

| Error | Causa | Solución |
|-------|-------|----------|
| Timeout 300s | URL incorrecta | `bejewelled-llama-a6719d.netlify.app/mcp` |
| "API key restricted" | WorkspaceId incorrecto | `ws_user_8e9f031817184e0ab205` |
| "EDITABILITY_CONTRACT_ERROR" | `update_html_frame` sin data-layer-id | Usar `import_design` |
| Parse error -32700 | JSON mal formado | html+css separados, no document |
| "NO_FRAMES_ERROR" | Template sin frames | Crear con `engine:"html"` primero |
| Prompt con acentos se corrompe ("camión" → "camiÃ³n") | Payload bash sin escape UTF-8 | Enviar con `ensure_ascii=True` (Python) o escapar a `\uXXXX`; nunca texto acentuado crudo en `-d '{…}'` |
| "Provide prompt, points or box" | `segment_click` sin prompts | Mandar `points`, `box` o `prompt` (uno alcanza) |
| "Unknown animation preset: X" | `set_animation` con `presetIds` inválidos | Correr `list_animation_presets` primero; el id va en `presetIds`, no en `animation` |
| Job queda en "queued" >8s | Cold start descargando modelo | Poll con `segment_status(jobId)` |

---

## 📁 ARCHIVOS RELACIONADOS
- `REPORTE_MIRA_DESIGN_TOOL_28JUL.md` — Diagnóstico de la herramienta
- `BUG_MCP_API_CAIDO_28JUL.md` — Issue del MCP caído (resuelto: URL incorrecta)
- `BUGS_DESIGN_REPLICATION.md` — Bugs históricos de replicación
- `DESIGN_HARNESS_RULES.md` — Reglas del Design Harness
- `MCP_TOOL_CATALOG_V2.md` — Catálogo completo de tools (sección Calado/Máscaras: M1-M8)
