# 🔧 20 Prioridades Funcionales → MCP

**Fecha:** 2026-05-30 | **Orden:** por impacto en calidad de diseño

---

| # | Funcionalidad | MCP Tool | Parámetros | Por qué es crítica |
|---|--------------|----------|------------|---------------------|
| 1 | **Google Fonts** | `update_template` (objetos con `fontFamily`) | `fontFamily`, `fontWeight` (100-900), `fontStyle` (normal/italic), `letterSpacing` (px), `lineHeight` (multiplier) | Sin fuentes no hay diseño. Hoy solo Syne + Inter. Necesitamos cargar Google Fonts en el render y exponerlas en el editor. |
| 2 | **Gradientes** | `update_template` (objetos con `fillGradient`) | `fillGradient: { type: 'linear'\|'radial', stops: [{color,offset}] }` | El branding Futuraria es verde→púrpura. Sin gradientes no podemos representar nuestra propia identidad. |
| 3 | **Border Radius** | `update_template` (objetos con `rx`, `ry`) | `rx` (horizontal), `ry` (vertical) | Botones pill, cards redondeadas. Todo se ve cuadrado sin esto. |
| 4 | **Imágenes de fondo** | `update_template` (objetos tipo `image`) | `src` (URL), `objectFit` (cover/contain/fill) | Sin imágenes no hay posts de noticias. Es el tipo de contenido más común. |
| 5 | **Text Shadows** | `update_template` (objetos con `shadow`) | `shadow: { color, blur, offsetX, offsetY }` | Texto ilegible sobre fondos con imágenes. Necesario para legibilidad. |
| 6 | **Box Shadows** | `update_template` (objetos con `shadow`) | `shadow: { color, blur, offsetX, offsetY, spread }` | Elevación visual en cards. Sin sombras todo se ve plano. |
| 7 | **Color Picker en Editor** | N/A (lado editor, no MCP) | Componente UI de color picker (hex, rgb, hsl) | Nadie va a escribir `#d2ff02` a mano. Inusable para diseñadores. |
| 8 | **Italic / Bold / Underline** | `update_template` (objetos con estilos de texto) | `fontStyle: 'italic'`, `fontWeight: 700`, `textDecoration: 'underline'` | Tipografía básica. Hoy solo hay fontWeight numérico. |
| 9 | **Z-Index / Layer Order** | `update_template` (objetos con `zIndex`) | `zIndex` (número) | Sin esto, los objetos se apilan en orden de creación. Imposible diseñar layouts complejos. |
| 10 | **Opacity por capa** | `update_template` (objetos con `opacity`) | `opacity` (0-1) | Overlays, transparencias, watermarks. Campo existe pero no se renderiza. |
| 11 | **Frames (Artboards)** | `create_frame`, `update_frame`, `delete_frame` | `name`, `x`, `y`, `width`, `height`, `fill`, `parentFrameId` | Contenedores lógicos. Hoy todo va suelto en el canvas. Un carrusel necesita 4 frames. |
| 12 | **Alignment Tools** | `align_objects` (nuevo tool) | `direction: 'left'\|'center-h'\|'right'\|'top'\|'center-v'\|'bottom'`, `targetLayerNames[]` | Centrar, alinear, distribuir. Sin esto cada objeto se posiciona a mano. |
| 13 | **Grupos** | `group_objects`, `ungroup_objects` (nuevo) | `targetLayerNames[]`, `groupName` | Mover/escalar/editar múltiples objetos juntos. Cards con 3+ objetos son inmanejables sin grupos. |
| 14 | **Stroke / Borde** | `update_template` (objetos con `stroke`) | `stroke` (color), `strokeWidth` (px), `strokeDashArray` (patrón) | Bordes decorativos. Hoy solo rects básicos. |
| 15 | **Design Tokens / Variables** | `create_variable`, `get_variables`, `apply_variable` | `name`, `type: 'color'\|'spacing'\|'font'`, `value` | Un solo cambio de color verde actualiza 18 templates. Escalabilidad. |
| 16 | **Clip-Path / SVG shapes** | `update_template` (objetos tipo `path`) | `path` (SVG path data), `fill` | El logo estrella de Futuraria no se puede renderizar. Necesitamos SVG paths. |
| 17 | **Batch Update** | `batch_update` (nuevo tool) | `operations: [{ action: 'update'\|'create'\|'delete', ... }]` | Aplicar cambio a múltiples templates de una. Ej: cambiar el CTA en los 18 estilos. |
| 18 | **Versiones / Undo** | `list_versions`, `restore_version` | `templateId`, `versionId` | Sin undo, un error del agente borra trabajo. Crítico para adopción. |
| 19 | **Render Batch** | `render_batch` (nuevo tool) | `templateIds[]`, `format`, `scale` | Renderizar 5 carruseles de una. Sin esto, toca 1×1. |
| 20 | **Auto-Save / Dirty Flag** | N/A (lado editor) | Indicador visual de cambios no guardados | UX básica. Hoy no sabés si tu cambio se guardó. |

---

## 📊 Distribución por tipo

| Tipo | Cantidad | Items |
|------|:---:|------|
| **Nuevo MCP tool** | 5 | Frames, Alignment, Groups, Batch Update, Render Batch |
| **Mejora objeto existente** | 12 | Gradientes, border radius, imágenes, sombras, tipografía, z-index, opacidad, stroke, path |
| **Mejora editor (no MCP)** | 3 | Color picker, auto-save, Google Fonts loader |

---

## 🎯 Fases de implementación

### Fase 1 — Diseño mínimo viable (sprint 1)
`#1` Google Fonts → `#2` Gradientes → `#7` Color Picker

### Fase 2 — Tipografía completa (sprint 2)  
`#8` Italic/Bold/Underline → `#5` Text Shadows → `#1` Line-height + Kerning

### Fase 3 — Layout (sprint 3)
`#11` Frames → `#9` Z-Index → `#12` Alignment → `#13` Grupos

### Fase 4 — Visual (sprint 4)
`#3` Border Radius → `#4` Imágenes → `#6` Box Shadows → `#10` Opacity

### Fase 5 — Producción (sprint 5)
`#16` Clip-Path → `#17` Batch Update → `#19` Render Batch → `#18` Versiones

---

## 📂 Archivo en repo para Agent IDE

```
design-main/20_PRIORIDADES_MCP.md
```
