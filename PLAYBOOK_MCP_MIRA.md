# 🎨 DESIGN TOOL MCP — Guía Completa para Mira

**Versión:** 2.0 — 28 Julio 2026

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

---

## 🚫 ERRORES COMUNES

| Error | Causa | Solución |
|-------|-------|----------|
| Timeout 300s | URL incorrecta | `bejewelled-llama-a6719d.netlify.app/mcp` |
| "API key restricted" | WorkspaceId incorrecto | `ws_user_8e9f031817184e0ab205` |
| "EDITABILITY_CONTRACT_ERROR" | `update_html_frame` sin data-layer-id | Usar `import_design` |
| Parse error -32700 | JSON mal formado | html+css separados, no document |
| "NO_FRAMES_ERROR" | Template sin frames | Crear con `engine:"html"` primero |

---

## 📁 ARCHIVOS RELACIONADOS
- `REPORTE_MIRA_DESIGN_TOOL_28JUL.md` — Diagnóstico de la herramienta
- `BUG_MCP_API_CAIDO_28JUL.md` — Issue del MCP caído (resuelto: URL incorrecta)
- `BUGS_DESIGN_REPLICATION.md` — Bugs históricos de replicación
- `DESIGN_HARNESS_RULES.md` — Reglas del Design Harness
