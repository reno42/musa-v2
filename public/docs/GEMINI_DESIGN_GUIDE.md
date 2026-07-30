# Futuraria Design Editor — Guía Completa para Gemini

> **Propósito:** Este documento te enseña a usar el Futuraria Design Editor como si fueras un diseñador humano. Cubre TODAS las herramientas MCP disponibles, el flujo de trabajo completo, y — lo más importante — cómo **componer** diseños con formas, posiciones, rotaciones, capas y jerarquía visual.

---

## Índice

1. [Conceptos Clave](#1-conceptos-clave)
2. [Flujo de Trabajo Completo](#2-flujo-de-trabajo-completo)
3. [Catálogo Completo de Herramientas MCP](#3-catálogo-completo-de-herramientas-mcp)
4. [Guía de Composición Visual](#4-guía-de-composición-visual)
5. [Sistema de Diseño y Tokens (Template v2)](#5-sistema-de-diseño-y-tokens-template-v2)
6. [Recetas de Composición (Ejemplos Prácticos)](#6-recetas-de-composición-ejemplos-prácticos)
7. [Reglas de Oro](#7-reglas-de-oro)

---

## 1. Conceptos Clave

### El modelo mental: "Marcos sobre un escritorio infinito"

Imagina un escritorio infinito donde colocas hojas de papel. Cada hoja es un **Frame** (marco). Dentro de cada marco dibujas **elementos** (formas, texto, imágenes). Los marcos NO se solapan — el sistema los coloca automáticamente en un grid.

```
Workspace (carpeta de proyecto)
  └── Template (archivo de diseño)
        ├── Frame 1 (hoja 1, ej. 1080×1080 px — Instagram post)
        │     ├── <div data-layer-id="rect-0"> — rectángulo azul
        │     ├── <h1 data-layer-id="text-1"> — título
        │     └── <img data-layer-id="img-2"> — foto
        ├── Frame 2 (hoja 2, ej. 1080×1350 px — carousel slide)
        └── Frame 3 (hoja 3)
```

### Regla de Oro #1: PRIMERO el marco, DESPUÉS el contenido

**NUNCA** intentes agregar elementos sin crear un frame primero. El sistema lo rechazará con error `NO_FRAMES_ERROR`.

### Tipos de formas disponibles

| Tipo | Herramienta | Descripción |
|------|------------|-------------|
| Rectángulo | `add_primitive(type:"rect")` o `draw_shape(type:"rect")` | Div con width/height/background |
| Círculo | `add_primitive(type:"circle")` o `draw_shape(type:"circle")` | Div con border-radius:50% |
| Triángulo | `draw_shape(type:"triangle")` | CSS clip-path |
| Estrella | `draw_shape(type:"star")` | SVG de 5 puntas |
| Polígono | `draw_shape(type:"polygon", sides:N)` | SVG con N lados |
| Texto | `add_primitive(type:"text")` | Div con texto |
| Path libre | `draw_path` o `draw_bezier` | SVG path (curvas Bézier, líneas) |
| SVG importado | `import_svg` | Convierte SVG externo en elementos editables |

---

## 2. Flujo de Trabajo Completo

### Paso 1: Crear workspace y template

```
create_workspace({ name: "Cliente X — Redes Sociales" })
  → { id: "ws_abc" }

create_template({ name: "Post Instagram", workspaceId: "ws_abc", engine: "html", width: 1080, height: 1080 })
  → { id: "tpl_xyz", frames: [{ id: "f1" }] }
```

**IMPORTANTE:** `create_template` con `engine:"html"` ya crea el Frame 1 automáticamente. No necesitas crear un frame extra si solo vas a usar uno.

### Paso 2: Agregar frames adicionales (para carruseles, variantes)

```
create_html_frame({ templateId: "tpl_xyz", name: "Slide 2", width: 1080, height: 1350 })
  → { id: "f2" }

create_html_frame({ templateId: "tpl_xyz", name: "Slide 3", width: 1080, height: 1350 })
  → { id: "f3" }
```

### Paso 3: Construir la composición (dentro de cada frame)

Aquí es donde ocurre la magia. El orden importa — los elementos se renderizan en el orden en que los creas (el último encima).

```
// 1. FONDO — siempre primero
add_primitive({ templateId:"tpl_xyz", frameId:"f1", type:"rect",
  x:0, y:0, width:1080, height:1080, color:"#fafffa" })

// 2. FORMA DECORATIVA — óvalo girado
draw_shape({ templateId:"tpl_xyz", frameId:"f1", type:"circle",
  x:300, y:200, width:600, height:400, color:"#2bee4b" })
// Transformar el círculo en óvalo y girarlo:
transform_element({ templateId:"tpl_xyz", frameId:"f1",
  elementId:"circle-1", width:600, height:350, rotation:15 })

// 3. TEXTO — encima de las formas
add_primitive({ templateId:"tpl_xyz", frameId:"f1", type:"text",
  x:80, y:300, width:500, content:"DISEÑO", fontSize:140,
  color:"#121613" })

// 4. LÍNEA DECORATIVA (tick)
add_primitive({ templateId:"tpl_xyz", frameId:"f1", type:"rect",
  x:80, y:460, width:72, height:3, color:"#2bee4b" })

// 5. IMAGEN — si tienes URL
add_element({ templateId:"tpl_xyz", frameId:"f1", tag:"img",
  html:'<img src="https://..." style="width:400px;height:400px;border-radius:14px;object-fit:cover" />' })
```

### Paso 4: Ajustar y refinar

```
// Mover algo
transform_element({ templateId, frameId, elementId:"text-2",
  x:100, y:320, rotation:-5 })

// Cambiar texto
update_frame_content({ templateId, frameId:"f1",
  selector:'[data-layer-id="text-2"]', patch:{ text:"NUEVO TEXTO" } })

// Ver el resultado
get_template({ templateId })
  → devuelve todo el HTML/CSS generado
```

### Paso 5: Extraer el sistema de diseño (tokens)

```
generate_design_artifacts({ templateId:"tpl_xyz", action:"publish", brandName:"Mi Marca" })
  → { tokensJson, designMd, sharedCss, styleFingerprint, brandId }
```

---

## 3. Catálogo Completo de Herramientas MCP

### 🏗️ Workspace y Templates

| Herramienta | Params requeridos | Params opcionales | Qué hace |
|-------------|-------------------|-------------------|----------|
| `list_workspaces` | — | — | Lista tus workspaces |
| `create_workspace` | `name` | `description` | Crea carpeta de proyecto |
| `list_templates` | — | `workspaceId`, `search`, `limit` | Lista templates |
| `get_template` | `id` | — | Obtiene template completo con frames |
| `create_template` | `name`, `workspaceId` | `engine:"html"`, `width`(1080), `height`(1080), `html`, `css` | Crea template + Frame 1 automático |
| `update_template` | `id` | `name`, `html`, `css`, `frames` | Actualiza template |
| `delete_template` | `id` | — | Elimina permanentemente |
| `duplicate_template` | `id` | `name` | Copia independiente |
| `rename_template` | `templateId`, `name` | — | Renombra |

### 🖼️ Frames (Marcos/Hojas)

| Herramienta | Params requeridos | Params opcionales | Qué hace |
|-------------|-------------------|-------------------|----------|
| `create_html_frame` | `templateId`, `name` | `width`, `height`, `html`, `css`, `background`, `frameStrategy`("multi"\|"single-web") | Crea frame. Posición auto-calculada. |
| `update_html_frame` | `templateId`, `frameId` | `name`, `html`, `css`, `width`, `height`, `x`, `y`, `background` | Modifica frame existente |
| `delete_html_frame` | `templateId`, `frameId` | — | Elimina frame (no el último) |
| `get_html_frames` | `templateId` | — | Lista frames con contenido |
| `duplicate_frame` | `templateId`, `sourceFrameId` | `newName` | Duplica frame exacto |

### ✏️ Elementos y Contenido

| Herramienta | Params requeridos | Params opcionales | Qué hace |
|-------------|-------------------|-------------------|----------|
| `add_element` | `templateId`, `tag`, `frameId` | `html`, `css`, `parentSelector`, `position`, `layerName` | Agrega elemento HTML arbitrario |
| `add_primitive` | `templateId`, `frameId`, `type` | `x`(0), `y`(0), `width`, `height`, `color`, `content`, `fontSize`, `borderRadius` | **type:** `rect`, `circle`, `text` |
| `remove_element` | `templateId`, `elementId` | — | Elimina elemento por data-layer-id |
| `update_element` | `templateId`, `elementId` | `css`, `content`, `attributes` | Modifica elemento existente |
| `change_element_tag` | `templateId`, `elementId`, `newTag` | `frameId` | Cambia tag HTML (div→h1, etc.) |
| `reorder_element` | `templateId`, `elementId`, `newIndex` | — | Cambia orden dentro del padre |
| `update_frame_content` | `templateId`, `frameId`, `selector` | `patch:{ text, html, src, href, className, style, backgroundImage, attr, remove }` | Edita quirúrgicamente por selector CSS |
| `edit_text_content` | `templateId`, `frameId`, `layerId`, `text` | — | Cambia texto de un elemento |

### 🎨 Dibujo y Formas

| Herramienta | Params requeridos | Params opcionales | Qué hace |
|-------------|-------------------|-------------------|----------|
| `draw_shape` | `templateId`, `frameId`, `type`, `x`, `y`, `width`, `height` | `color`, `borderRadius`, `sides` | **type:** `rect`, `circle`, `triangle`, `star`, `polygon` |
| `draw_path` | `templateId`, `frameId`, `pathData`, `x`, `y`, `width`, `height` | `stroke`, `strokeWidth` | Path SVG con comandos M, L, C, Q |
| `draw_bezier` | `templateId`, `frameId`, `pathData`, `x`, `y`, `width`, `height` | `fill`, `stroke`, `strokeWidth`, `closed` | Curvas Bézier (C, Q, S, T, A) |
| `import_svg` | `workspaceId` | `svg`, `url`, `name` | Convierte SVG externo en elementos |
| `shape_to_path` | `templateId`, `frameId`, `elementId` | — | Convierte div shape a SVG path |
| `pathfinder` | `templateId`, `frameId`, `elementIdA`, `elementIdB`, `operation` | — | **operation:** `union`, `subtract`, `intersect`, `exclude` |
| `edit_path_points` | `templateId`, `frameId`, `elementId`, `newPathData` | — | Reemplaza path data completo |
| `edit_path_point` | `templateId`, `frameId`, `elementId` | `pointIndex`, `x`, `y`, `action`("move"\|"delete"\|"toggle"), `type` | Edita punto individual |

### 🔄 Transformación

| Herramienta | Params requeridos | Params opcionales | Qué hace |
|-------------|-------------------|-------------------|----------|
| `transform_element` | `templateId`, `frameId`, `elementId` | `x`, `y`, `width`, `height`, `rotation` | Mueve, redimensiona, ROTA |
| `group_elements` | `templateId`, `frameId`, `elementIds` | `groupName` | Agrupa elementos en wrapper |
| `align_elements` | `templateId`, `frameId`, `elementIds`, `align` | — | **align:** `left`, `center`, `right`, `top`, `middle`, `bottom` |

### 🖌️ Estilos Visuales

| Herramienta | Params requeridos | Params opcionales | Qué hace |
|-------------|-------------------|-------------------|----------|
| `set_html` | `templateId`, `frameId` | `html` | Reemplaza HTML del frame |
| `set_css` | `templateId`, `frameId` | `css` | Reemplaza CSS del frame |
| `set_css_variable` | `templateId`, `name`, `value` | — | Define variable CSS (:root) |
| `get_css_variables` | `templateId` | — | Lista variables CSS |
| `set_stroke_style` | `templateId`, `frameId`, `layerId` | `stroke`, `strokeWidth`, `strokeLinecap`, `strokeLinejoin`, `strokeDasharray` | Estilo de borde SVG |
| `set_gradient` | `templateId`, `frameId`, `layerId`, `gradientType`, `stops` | `angle` | **gradientType:** `linear`, `radial`, `conic` |
| `set_blend_mode` | `templateId`, `frameId`, `layerId`, `blendMode` | — | CSS mix-blend-mode |
| `outline_stroke` | `templateId`, `frameId`, `layerId` | `strokeWidth` | Convierte stroke a path relleno |
| `offset_path` | `templateId`, `frameId`, `layerId`, `offset` | `miterLimit` | Expande/contrae path |
| `copy_style` | `templateId`, `frameId`, `layerId` | — | Copia CSS de un elemento |
| `paste_style` | `templateId`, `frameId`, `layerId`, `styles` | — | Pega CSS a un elemento |
| `set_pseudo_state` | `templateId`, `frameId`, `layerId`, `pseudo`, `styles` | — | **pseudo:** `:hover`, `:active`, `:focus` |

### 🔒 Capas y Visibilidad

| Herramienta | Params requeridos | Params opcionales | Qué hace |
|-------------|-------------------|-------------------|----------|
| `lock_element` | `templateId`, `frameId`, `layerId`, `locked` | — | Bloquea/desbloquea capa |
| `hide_element` | `templateId`, `frameId`, `layerId`, `hidden` | — | Muestra/oculta capa |

### 🎯 Sistema de Diseño y Brand

| Herramienta | Params requeridos | Params opcionales | Qué hace |
|-------------|-------------------|-------------------|----------|
| `generate_design_artifacts` | `templateId` | `action`("generate"\|"publish"), `brandName` | Extrae tokens + DESIGN.md + CSS |
| `get_design_artifacts` | `templateId` | — | Recupera artefactos guardados |
| `create_brand_guideline` | `workspaceId`, `name` | `description`, `tokensJson`, `designMd`, `sharedCss` | Crea brand en DB |
| `get_brand_guideline` | `brandId` | — | Obtiene brand |
| `list_brand_guidelines` | `workspaceId` | — | Lista brands |
| `apply_brand_to_template` | `templateId`, `brandId` | — | Vincula brand a template |
| `get_active_styles` | `workspaceId` | — | Estilos bloqueados (AI debe usarlos) |
| `set_style_lock` | `workspaceId`, `brandId`, `locked` | — | Bloquea/desbloquea estilo |
| `download_style_template` | — | — | Descarga template v2 para Gemini |
| `generate_ui_components` | `templateId` | `targetFrameId`, `components` | Genera kit UI: `button-primary`, `button-secondary`, `button-ghost`, `card`, `navbar`, `form-input`, `hero` |

### 📋 Batch y CSV

| Herramienta | Params requeridos | Params opcionales | Qué hace |
|-------------|-------------------|-------------------|----------|
| `profile_template_pool` | `templateIds` | — | Detecta slots de contenido |
| `generate_csv_template` | `templateIds` | `rowCount`, `delimiter` | Genera CSV para llenar |
| `apply_csv_to_frames` | `workspaceId`, `csvData`, `templateIds` | `outputName`, `naming`, `onMissingTemplate`, `onOverflow` | Genera frames desde CSV |
| `export_batch` | `templateId` | `frameIds`, `format`("png"\|"svg"\|"pdf") | Exporta frames |
| `render_batch` | `templateIds` | `format`, `scale`, `transparent` | Renderiza múltiples templates |

### 🖼️ Assets e Imágenes

| Herramienta | Params requeridos | Params opcionales | Qué hace |
|-------------|-------------------|-------------------|----------|
| `upload_image` | `name` | `data`(base64), `url`, `workspaceId`, `tags` | Sube imagen |
| `list_assets` | — | `workspaceId`, `search`, `mimeType`, `limit` | Lista assets |
| `delete_asset` | `id` | — | Elimina asset |
| `search_stock_image` | `query` | `orientation`, `color` | Busca en Unsplash/Pexels |

### 🔤 Fuentes

| Herramienta | Params requeridos | Params opcionales | Qué hace |
|-------------|-------------------|-------------------|----------|
| `list_fonts` | `templateId` | — | Fuentes usadas en template |
| `add_font_to_template` | `templateId`, `family` | `weights` | Agrega Google Font |
| `get_font_details` | `family` | — | Metadata de fuente |

### 🤖 AI y Generación

| Herramienta | Params requeridos | Params opcionales | Qué hace |
|-------------|-------------------|-------------------|----------|
| `generate_from_prompt` | `prompt` | `width`, `height`, `brandId`, `style` | Genera template desde prompt |
| `enhance_template` | `templateId`, `instruction` | — | Modifica con lenguaje natural |

---

## 4. Guía de Composición Visual

> **Esta sección es LA MÁS IMPORTANTE.** Gemini ya puede replicar colores, tipografías y tamaños. Lo que falta es COMPOSICIÓN: dónde poner cada cosa, qué formas usar, cómo crear jerarquía visual.

### 4.1 El modelo de capas (z-order)

En HTML/CSS, los elementos se apilan en el orden en que aparecen en el DOM. El **último elemento creado va encima**. Esto es clave para la composición:

```
Capa 5 (arriba):   Texto del headline (h1)
Capa 4:             Línea decorativa (tick mark)
Capa 3:             Imagen (solapada al headline)
Capa 2:             Forma decorativa (óvalo/círculo girado)
Capa 1 (abajo):     Fondo (rectángulo full-bleed)
```

**Regla práctica:** Siempre crea los elementos en orden de atrás hacia adelante.

### 4.2 Posicionamiento absoluto

Todos los elementos se posicionan con `x` e `y` en píxeles, relativos a la esquina superior izquierda del frame (0,0). El sistema usa `position: absolute` internamente.

```
Frame 1080×1080:
  (0,0) ───────────────────── (1080,0)
  │                                │
  │     (100,200) → elemento      │
  │                                │
  (0,1080) ────────────── (1080,1080)
```

### 4.3 Rotación: el arma secreta

`transform_element` acepta `rotation` en grados. Esto permite composiciones dinámicas que rompen la cuadrícula:

```
// Crear un rectángulo
draw_shape({ type:"rect", x:200, y:300, width:600, height:400, color:"#2bee4b" })
  → { layerName: "rect-0" }

// Girarlo 15 grados
transform_element({ elementId:"rect-0", rotation:15 })
```

**Usos creativos de rotación:**
- Fondos diagonales que crean dinamismo
- Texto girado como elemento decorativo
- Formas que "escapan" de los márgenes
- Composición asimétrica tipo revista

### 4.4 Jerarquía visual con tamaño

La jerarquía NO se logra solo con la escala tipográfica — también con el TAMAÑO de las formas:

| Elemento | Tamaño típico | Propósito |
|----------|--------------|-----------|
| Fondo | 1080×1080 (full frame) | Lienzo |
| Forma hero | 400-800px | Ancla visual principal |
| Imagen | 300-500px | Contenido visual |
| Headline | 60-240px font-size | Jerarquía máxima |
| Body text | 16-22px font-size | Lectura |
| Tick/divider | 40-72px × 2-3px | Acento sutil |
| CTA button | 200-400px × 50-70px | Acción |

### 4.5 El espacio negativo (whitespace)

El espacio vacío NO es un error — es una herramienta de diseño. Usa márgenes generosos:

```
⚠️  MAL: Todo pegado a los bordes
✅  BIEN: 80-120px de margen en los bordes, 40-80px entre secciones
```

### 4.6 Composición asimétrica (tipo revista)

La composición simétrica (todo centrado) es aburrida. La composición asimétrica crea tensión visual:

```
┌──────────────────────────┐
│                          │
│   ╔══════════╗           │  ← Forma anclada a la izquierda
│   ║  FORMA   ║  TEXTO   │  ← Texto a la derecha
│   ║ DECORAT. ║  GRANDE  │
│   ╚══════════╝           │
│              ────        │  ← Tick mark debajo del texto
│              CTA →       │  ← Botón alineado con el texto
│                          │
└──────────────────────────┘
```

### 4.7 Overlap (solapamiento)

Solapa elementos para crear profundidad:

```
1. draw_shape(type:"rect", x:100, y:200, w:500, h:600, color:"#f0f0f0")
2. draw_shape(type:"circle", x:350, y:150, w:400, h:400, color:"#2bee4b")
   → El círculo SOLAPA al rectángulo (está encima)
3. add_primitive(type:"text", x:400, y:250, content:"TÍTULO", fontSize:96)
   → El texto está SOBRE ambas formas
```

### 4.8 Tensión directional

Crea líneas de fuerza que guíen el ojo:

```
// Línea diagonal que cruza el frame
draw_path({
  pathData: "M 0 0 L 1080 1080",
  x:0, y:0, width:1080, height:1080,
  stroke:"#2bee4b", strokeWidth:4
})
```

### 4.9 Grid invisible

Aunque uses posicionamiento absoluto, piensa en un grid subyacente:

```
Frame 1080×1080 dividido mentalmente:
┌──────────┬──────────┐
│  Zona 1  │  Zona 2  │  ← 540px cada columna
│ (540px)  │ (540px)  │
├──────────┼──────────┤
│  Zona 3  │  Zona 4  │  ← Línea horizontal en y=540
│ (540px)  │ (540px)  │
└──────────┴──────────┘
```

Alinea los bordes de tus elementos a estas líneas imaginarias para crear cohesión visual.

---

## 5. Sistema de Diseño y Tokens (Template v2)

Cuando uses `download_style_template`, recibirás un JSON con esta estructura. Gemini debe LLENAR este template, no crear uno propio.

### Estructura del template v2

```
{
  "$schema": "...",
  "meta": { nombre, descripción, mood, formatDimensions },
  "color": {
    "canvas": { "$value": "#hex", "role": "...", "description": "...", "constraints": "..." },
    "ink": { ... }, "accent": { ... }, ... 12 colores en total
  },
  "typography": {
    "families": [                    ← ARRAY de 4 familias
      { name, token, role, weights[], lineHeight, fallback, usage, constraints }
    ],
    "scale": [                       ← ARRAY de tamaños tipográficos
      { role, size, lineHeight, letterSpacing, family, weight, token }
    ],
    "textTransformRules": { ... },
    "colorRules": { h1, p, caption, ... },
    "pairingLogic": "..."
  },
  "spacing": {
    "scale": { "4": { "$value": "4px", "use": "..." }, ... },
    "semantic": { sectionGap, cardPadding, ... }
  },
  "radius": { "card": { "$value": "14px" }, "button": {...}, ... },
  "shadows": { "cta": { "$value": "...", "constraints": "..." } },
  "surfaces": [{ level, name, value, purpose, elevation }],
  "layout": { pageMaxWidth, grids, postLayout },
  "components": {                     ← 22 componentes con CSS
    "masthead": { name, css, wordmark, menu },
    "heroHeadline": { name, css, sizes, emphasisPatterns },
    "accentTick": { name, css },
    "ctaButton": { name, css, structure, constraints },
    ... (bodyText, imageTile, captionPair, sectionLabel, calendarGrid,
         countdown, agendaList, timeline, speakerBio, blockquote,
         audiencePills, expectGrid, statGrid, formFields, footerBar,
         detailRow, chartBar, slide)
  },
  "decoration": { accentTicks, ornaments, greenMark },
  "imagery": { style, treatment, frames, placement, constraints[] },
  "rules": { "do": [...], "dont": [...] },
  "cssCustomProperties": { ":root": { "--color-canvas": "#...", ... } },
  "promptExamples": [],
  "adaptationGuide": { steps[], nonNegotiableStructure[] }
}
```

### Cómo usar el template con Gemini

1. Descarga el template: `download_style_template()` → guarda como `.json`
2. Adjunta el JSON + imágenes de referencia a Gemini
3. Gemini analiza las imágenes y LLENA los `$value` del JSON
4. El humano sube el JSON lleno: `create_brand_guideline({ tokensJson: "..." })`
5. El sistema calcula el fingerprint automáticamente

### Tokens → Elementos visuales (mapeo)

Cuando tengas los tokens de una marca, así los traduces a herramientas MCP:

| Token | Herramienta MCP | Ejemplo |
|-------|----------------|---------|
| `color.canvas.$value` | `add_primitive(type:"rect", color:)` | Fondo del frame |
| `color.accent.$value` | `draw_shape(color:)` | Forma decorativa, tick, CTA |
| `color.ink.$value` | `add_primitive(type:"text", color:)` | Títulos, texto principal |
| `color.inkSecondary.$value` | `add_primitive(type:"text", color:)` | Body text, labels |
| `color.border.$value` | `draw_shape(color:)` + `borderRadius` | Líneas divisorias |
| `typography.families[0].name` | `add_font_to_template(family:)` → CSS `font-family` | Display font |
| `typography.scale[].size` | `add_primitive(fontSize:)` | Tamaño de texto |
| `radius.card.$value` | `add_primitive(borderRadius:)` | Bordes redondeados |
| `shadows.cta.$value` | CSS directo en `add_element` | Sombra de botón |
| `spacing.scale.*.$value` | Márgenes entre elementos (`x`, `y`, gaps) | Espaciado |

---

## 6. Recetas de Composición (Ejemplos Prácticos)

### Receta 1: Post Editorial con Forma Geométrica

**Objetivo:** Post de Instagram 1080×1080 con headline masivo, forma decorativa girada, y foto.

```
Paso 1: Template y frame
create_template({ name:"Post Editorial", workspaceId:"ws_abc", engine:"html", width:1080, height:1080 })
  → tplId, frameId:"f1"

Paso 2: Fondo
add_primitive({ templateId:tplId, frameId:"f1", type:"rect",
  x:0, y:0, width:1080, height:1080, color:"#fafffa" })

Paso 3: Forma decorativa (círculo convertido en óvalo, girado)
draw_shape({ templateId:tplId, frameId:"f1", type:"circle",
  x:150, y:180, width:700, height:700, color:"#2bee4b" })
  → layerName:"circle-0"
transform_element({ templateId:tplId, frameId:"f1", elementId:"circle-0",
  width:650, height:420, rotation:12 })

Paso 4: Imagen (solapa con la forma)
add_element({ templateId:tplId, frameId:"f1", tag:"div",
  html:'<img src="https://ejemplo.com/foto.jpg" style="position:absolute;left:380px;top:120px;width:440px;height:440px;border-radius:14px;object-fit:cover" />' })

Paso 5: Headline masivo
add_primitive({ templateId:tplId, frameId:"f1", type:"text",
  x:80, y:520, width:900, content:"Diseño sin Límites", fontSize:132, color:"#121613" })

Paso 6: Tick accent
add_primitive({ templateId:tplId, frameId:"f1", type:"rect",
  x:80, y:680, width:72, height:3, color:"#2bee4b" })

Paso 7: Body text
add_primitive({ templateId:tplId, frameId:"f1", type:"text",
  x:80, y:710, width:520, content:"La nueva era del diseño computacional combina creatividad humana con precisión algorítmica.", fontSize:20, color:"#516254" })
```

### Receta 2: Carrousel de 3 Slides

**Objetivo:** 3 slides 1080×1350 para carrusel de Instagram.

```
Paso 1: Template base
create_template({ name:"Carrousel Producto", workspaceId:"ws_abc", engine:"html", width:1080, height:1350 })
  → tplId, frameId:"f1"

Paso 2: Slides 2 y 3
create_html_frame({ templateId:tplId, name:"Slide 2", width:1080, height:1350 })
  → "f2"
create_html_frame({ templateId:tplId, name:"Slide 3", width:1080, height:1350 })
  → "f3"

Paso 3: Construir Slide 1 (frameId:"f1") — Portada
add_primitive({ frameId:"f1", type:"rect", x:0,y:0,w:1080,h:1350, color:"#121613" })
add_primitive({ frameId:"f1", type:"text", x:80,y:200, w:900, content:"PRODUCTO NUEVO", fontSize:140, color:"#fafffa" })
add_primitive({ frameId:"f1", type:"rect", x:80,y:380, w:72,h:3, color:"#2bee4b" })
add_primitive({ frameId:"f1", type:"text", x:80,y:420, w:500, content:"Descubre la revolución.", fontSize:22, color:"#516254" })

Paso 4: Slide 2 (frameId:"f2") — Features
// Similar estructura, diferente contenido...

Paso 5: Slide 3 (frameId:"f3") — CTA final
// Similar estructura, diferente contenido...
```

### Receta 3: Composición con Paths y Curvas

**Objetivo:** Diseño orgánico con curvas Bézier.

```
// Crear una forma de "ola" con path
draw_bezier({
  templateId:tplId, frameId:"f1",
  pathData:"M 0 300 C 200 100, 400 500, 600 200 C 800 -100, 1000 400, 1080 300 L 1080 0 L 0 0 Z",
  x:0, y:0, width:1080, height:600,
  fill:"#2bee4b", closed:true
})

// Y un texto encima
add_primitive({ frameId:"f1", type:"text",
  x:80, y:200, content:"FLUIR", fontSize:180, color:"#121613" })
```

### Receta 4: Grilla de Estadísticas

**Objetivo:** 3 columnas con números grandes + labels.

```
// Fila de 3 stats (cada stat = ~320px ancho, gap = 40px)
// Stat 1
add_primitive({ frameId:"f1", type:"text",
  x:80, y:800, content:"94%", fontSize:96, color:"#2bee4b" })
add_primitive({ frameId:"f1", type:"text",
  x:80, y:910, content:"Engagement Rate", fontSize:18, color:"#516254" })

// Stat 2
add_primitive({ frameId:"f1", type:"text",
  x:400, y:800, content:"12K", fontSize:96, color:"#121613" })
add_primitive({ frameId:"f1", type:"text",
  x:400, y:910, content:"Monthly Users", fontSize:18, color:"#516254" })

// Stat 3
add_primitive({ frameId:"f1", type:"text",
  x:720, y:800, content:"3.2s", fontSize:96, color:"#121613" })
add_primitive({ frameId:"f1", type:"text",
  x:720, y:910, content:"Avg. Load Time", fontSize:18, color:"#516254" })
```

### Receta 5: Duplicar y Personalizar en Masa

**Objetivo:** 20 posts con el mismo diseño pero diferente texto/imagen.

```
// 1. Diseñar el template maestro (frame 1)
// ... (usar receta 1 o similar)

// 2. Duplicar el frame 19 veces
for i in 2..20:
  duplicate_frame({ templateId, sourceFrameId:"f1", newName:"Post "+i })

// 3. Personalizar cada frame
update_frame_content({ frameId:"f2", selector:"h1", patch:{ text:"Nuevo título 2" } })
update_frame_content({ frameId:"f3", selector:"h1", patch:{ text:"Nuevo título 3" } })
// ... etc
```

---

## 7. Reglas de Oro

### ✅ SIEMPRE haz esto:

1. **Frame primero:** `create_template` o `create_html_frame` antes de cualquier `add_primitive` o `add_element`
2. **Orden de capas:** Fondo → Formas decorativas → Imágenes → Texto → Acentos (ticks, botones)
3. **Posicionamiento absoluto:** Cada elemento con `x` e `y` explícitos
4. **Usa los tokens:** Si hay un brand guideline activo (`get_active_styles`), USA sus colores, fuentes y escalas
5. **Rotación con propósito:** No gires porque sí — la rotación debe servir a la composición
6. **Espacio negativo:** Márgenes de 80-120px en bordes, 40-80px entre elementos
7. **Jerarquía con tamaño:** Lo más grande = lo más importante. El headline DEBE ser el elemento más dominante
8. **Consistencia entre frames:** Si es un carrusel, todos los slides comparten masthead, footer, y paleta de colores

### ❌ NUNCA hagas esto:

1. **NO crees elementos sin frame** — el sistema lo rechazará
2. **NO centres todo** — la composición asimétrica es más interesante
3. **NO uses más de 1 color accent** — un sistema cromático fuerte tiene UN solo color saturado
4. **NO pongas texto sobre formas del mismo color** — debe haber contraste
5. **NO uses tamaños de fuente arbitrarios** — usa la escala tipográfica del brand guideline
6. **NO mezcles display fonts en un mismo headline** — una sola familia display por titular
7. **NO uses imágenes a color si el brand es B&W** — respeta el tratamiento de imagen del brand
8. **NO ignores el `get_active_styles`** — si hay estilos bloqueados, son obligatorios

---

## Apéndice A: Tamaños de Frame Comunes

| Formato | Ancho × Alto | Uso |
|---------|-------------|-----|
| Instagram Post (Square) | 1080 × 1080 | Feed post estándar |
| Instagram Story | 1080 × 1920 | Stories verticales |
| Carousel Slide | 1080 × 1350 | Carrusel (4:5 ratio) |
| Facebook Post | 1200 × 630 | Link share preview |
| Twitter Post | 1200 × 675 | Single image tweet |
| LinkedIn Post | 1200 × 627 | Company/page post |
| Web Banner | 1920 × 600 | Hero section |
| Print A4 | 2480 × 3508 | Print @ 300dpi |

## Apéndice B: Colores Semánticos Estándar

Usa estos roles de color al llenar el template v2:

| Token | Significado | Cuándo usarlo |
|-------|------------|---------------|
| `canvas` | Fondo principal | TODO el fondo del frame |
| `ink` | Texto principal | Headlines, strong, texto dominante |
| `inkPure` | Máximo contraste | Negro puro para bordes duros, iconos |
| `inkSecondary` | Texto secundario | Body text, captions, labels |
| `bark` | Superficie oscura | Paneles secundarios, footer |
| `border` | Bordes y divisores | Líneas finas, bordes de cards |
| `accent` | Color de acento | CTAs, ticks, highlights, ÚNICO color saturado |
| `accentSupport` | Acento secundario | Decoración, baja frecuencia |
| `pollen` | Acento claro | Decoración sutil |
| `success` | Éxito | Indicadores positivos |
| `warning` | Advertencia | Alertas |
| `error` | Error | Estados de error |

---

## Apéndice C: Checklist de Composición (para Gemini)

Antes de dar por terminado un diseño, verifica:

- [ ] ¿Creé el frame antes que cualquier elemento?
- [ ] ¿El fondo cubre todo el frame (0,0,w,h)?
- [ ] ¿Los elementos están ordenados de atrás hacia adelante?
- [ ] ¿Hay jerarquía visual clara (headline > body > caption)?
- [ ] ¿Usé los colores del brand guideline (no inventé colores nuevos)?
- [ ] ¿Las fuentes son las del token (`families[].name`)?
- [ ] ¿Los tamaños de fuente respetan la escala tipográfica (`typography.scale`)?
- [ ] ¿Hay espacio negativo suficiente en los bordes (80-120px)?
- [ ] ¿El diseño es asimétrico y dinámico (no todo centrado)?
- [ ] ¿Las formas decorativas tienen propósito (no son ruido visual)?
- [ ] ¿El CTA tiene una flecha (→) si el brand lo requiere?
- [ ] ¿Las imágenes respetan el radius del brand (`radius.card`)?
- [ ] ¿No hay más de 1 color saturado en todo el diseño?
- [ ] ¿Los elementos solapados crean profundidad sin caos?
