# 🏗️ Migración Fabric.js → HTML/CSS: Análisis Completo

**Fecha:** 2026-06-17 | **Autor:** Lara  
**Contexto:** Ren pregunta si el approach HTML/CSS (estilo Paper.design) resolvería los stoppers actuales, si sigue siendo freemium, y qué problemas traería.

---

## 1. RESUMEN EJECUTIVO

**Sí, el approach HTML/CSS resuelve de raíz TODOS los stoppers de diseño actuales** porque usa el motor de renderizado del browser nativo en vez de Fabric.js. Y **sí, sigue siendo 100% freemium** — no hay costo de infraestructura adicional, todo corre en el browser del usuario vía iframe.

---

## 2. ARQUITECTURA ACTUAL (Fabric.js)

```
┌──────────────────────────────────────────────────┐
│  Editor React (Futuraria)                        │
│  ┌────────────────────────────────────────────┐  │
│  │  <canvas> Fabric.js                        │  │
│  │  Objetos JSON → render propietario 2D      │  │
│  │                                            │  │
│  │  Limitaciones:                             │  │
│  │  ❌ Sin gradientes nativos                 │  │
│  │  ❌ Sin Google Fonts (solo Syne/Inter)     │  │
│  │  ❌ Sin border-radius renderizado          │  │
│  │  ❌ Sin text/box shadows nativos           │  │
│  │  ❌ Sin blend modes                        │  │
│  │  ❌ Sin imágenes de fondo                  │  │
│  │  ❌ Sin CSS layout (flex/grid)             │  │
│  └────────────────────────────────────────────┘  │
│                                                   │
│  MCP Tools → REST API → store JSON → canvas JSON  │
│  Render: Puppeteer → Fabric.js canvas → PNG       │
└──────────────────────────────────────────────────┘
```

**Problema raíz:** Cada feature de CSS hay que re-implementarla manualmente en el modelo de objetos de Fabric.js. Es como construir una casa paralela al lado de la que ya existe (el browser).

---

## 3. ARQUITECTURA PROPUESTA (HTML/CSS)

```
┌──────────────────────────────────────────────────┐
│  Editor React (Futuraria)                        │
│  ┌─────────────────┐  ┌────────────────────────┐ │
│  │ Panel CÓDIGO    │  │  <iframe sandbox>      │ │
│  │ (Monaco Editor) │  │                        │ │
│  │                 │  │  Browser REAL con:      │ │
│  │ HTML + CSS      │  │  ✅ Google Fonts        │ │
│  │                 │  │  ✅ Gradientes          │ │
│  │ <div class="    │  │  ✅ Border-radius       │ │
│  │   card">        │  │  ✅ Box/Text shadows    │ │
│  │   <h1>Título   │  │  ✅ Blend modes         │ │
│  │   </h1>        │  │  ✅ Flexbox/Grid        │ │
│  │ </div>         │  │  ✅ Imágenes nativas    │ │
│  │                 │  │  ✅ Animaciones CSS     │ │
│  │ .card {         │  │  ✅ Backdrop-filter     │ │
│  │   background:   │  │  ✅ SVG filters         │ │
│  │   linear-       │  │  ✅ Clip-path           │ │
│  │   gradient(...) │  │  ✅ 100% CSS standard   │ │
│  │ }               │  │                        │ │
│  └─────────────────┘  └────────────────────────┘ │
│         ↕ postMessage                              │
│    Click en iframe → resalta selector CSS          │
│    Editar CSS → iframe se actualiza en vivo        │
│                                                    │
│  MCP Tools → REST API → store HTML/CSS strings → DB│
│  Render: Puppeteer → HTML/CSS page → PNG           │
└────────────────────────────────────────────────────┘
```

---

## 4. COMPARATIVA DIRECTA

| Feature | Fabric.js (actual) | HTML/CSS (propuesto) | ¿Gratis? |
|---------|:---:|:---:|:---:|
| Google Fonts | ❌ Solo Syne + Inter | ✅ `@import url(...)` | Sí |
| Gradientes | ❌ No implementado | ✅ `linear-gradient()`, `radial-gradient()`, `conic-gradient()` | Sí |
| Border-radius | ❌ Campos rx/ry ignorados | ✅ `border-radius: 12px` | Sí |
| Text shadows | ❌ | ✅ `text-shadow: 0 2px 8px rgba(...)` | Sí |
| Box shadows | ❌ | ✅ `box-shadow`, multiples sombras | Sí |
| Imágenes | ❌ Parcial | ✅ `<img>`, `background-image`, `object-fit` | Sí |
| Blend modes | ❌ | ✅ `mix-blend-mode`, `background-blend-mode` | Sí |
| Flexbox layout | ❌ | ✅ `display: flex; gap: 16px` | Sí |
| Grid layout | ❌ | ✅ `display: grid; grid-template-columns` | Sí |
| Animaciones | ❌ | ✅ `@keyframes`, `transition`, `animation` | Sí |
| Filters | ❌ | ✅ `filter: blur()`, `backdrop-filter` | Sí |
| Clip-path | ❌ | ✅ `clip-path: polygon(...)` | Sí |
| SVG inline | ❌ | ✅ `<svg>...</svg>` | Sí |
| Custom fonts | ❌ | ✅ Cualquier `.woff2` cargado | Sí |
| Opacity | ⚠️ Campo existe | ✅ `opacity: 0.5` | Sí |
| Z-index | ❌ | ✅ `z-index: 10` | Sí |
| Variables CSS | ❌ | ✅ `var(--brand-green)` | Sí |
| Media queries | ❌ | ✅ `@media (max-width: 768px)` | Sí |
| Emojis nativos | ❌ | ✅ Renderizado del OS | Sí |

**Conclusión:** HTML/CSS obtiene GRATIS el 95% de features que Fabric.js necesitaría meses de implementar.

---

## 5. ANÁLISIS FREEMIUM

### ¿Hay costo de infraestructura adicional?

**NO.** Todo lo crítico sigue siendo $0:

| Componente | Costo Fabric.js | Costo HTML/CSS | Nota |
|-----------|:---:|:---:|------|
| Editor (React) | $0 (Netlify free) | $0 (Netlify free) | Sin cambio |
| Canvas de diseño | $0 (browser del usuario) | $0 (iframe en browser) | Sin cambio |
| MCP Server | $0 (Netlify Edge) | $0 (Netlify Edge) | Sin cambio |
| API REST | $0 (Netlify Functions) | $0 (Netlify Functions) | Sin cambio |
| Base de datos | $0 (Supabase free tier) | $0 (Supabase free tier) | Sin cambio |
| Render (export PNG) | $0 (Puppeteer en Netlify) | $0 (Puppeteer en Netlify) | **Más barato**: renderizar HTML/CSS es más rápido que Fabric.js |
| Google Fonts | N/A (no implementado) | $0 (Google Fonts CDN es gratis) | Sin costo |
| Monaco Editor | N/A | $0 (open source, MIT) | Sin costo |

**Todo sigue siendo freemium.** La diferencia es que con HTML/CSS tenemos más features sin costo adicional.

### ¿Qué necesita el usuario?

- **Navegador moderno** (Chrome, Firefox, Safari, Edge) — lo mismo que ahora
- **Sin descargas, sin instalación** — igual que ahora
- **Sin plugins** — igual que ahora

---

## 6. PROBLEMAS IDENTIFICADOS Y RIESGOS

### 🔴 P0 — Riesgos Críticos

#### 6.1 Migración de templates existentes
**Problema:** Hay templates activos (mega-template 168 objetos, post "3 Tipos de Diseñadores", etc.) en formato Fabric.js JSON. No son automáticamente convertibles a HTML/CSS.

**Solución:**
- **Coexistencia**: El nuevo editor HTML/CSS convive con el editor Fabric.js existente. Templates antiguos se abren en el editor Fabric.js. Templates nuevos se crean en HTML/CSS.
- **No se migra contenido viejo** — solo se crea nuevo en el nuevo sistema.
- **Ruta:** `GET /api/templates/:id` → si `engine: "html"` abre editor nuevo, si no, editor Fabric.js.

**Riesgo mitigado:** ✅ Sin pérdida de datos. Coexistencia.

#### 6.2 Render pipeline (export PNG)
**Problema:** El render actual usa Puppeteer con Fabric.js. Con HTML/CSS, Puppeteer es MÁS FÁCIL (solo carga el HTML, no necesita Fabric.js), pero hay que refactorizar `render.mjs`.

**Solución:**
- `render.mjs` ya usa Puppeteer. En vez de `page.evaluate(() => canvas.toDataURL())`, hace `page.setContent(html)` y toma screenshot.
- **Es más simple**, no más complejo.

**Riesgo mitigado:** ✅ Menos código, más rápido.

#### 6.3 Seguridad del iframe (XSS)
**Problema:** El iframe renderiza HTML/CSS arbitrario. Si un agente o usuario malicioso inyecta `<script>`, podría ejecutar código en el contexto del editor.

**Solución:**
- **sandbox iframe:** `<iframe sandbox="allow-scripts allow-same-origin">` — bloquea scripts por defecto
- **CSP header:** `Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'none'`
- **Sanitización server-side:** DOMPurify en el MCP server antes de guardar
- **Sin JavaScript en el diseño:** Solo HTML + CSS. Si el diseño necesita interactividad (ej: hover states), se usa CSS puro.

**Riesgo mitigado:** ✅ CSP + sandbox + sanitización.

### 🟡 P1 — Riesgos Medios

#### 6.4 Complejidad del editor de código
**Problema:** Monaco Editor es pesado (~5MB gzipped). Puede afectar el tiempo de carga inicial.

**Solución:**
- **Code splitting:** Monaco se carga en lazy, solo cuando el usuario abre el panel de código
- **Alternativa ligera:** CodeMirror 6 (~50KB) como fallback
- **MVP con CodeMirror, upgrade a Monaco después**

**Riesgo mitigado:** ✅ Lazy load + fallback.

#### 6.5 Bidireccionalidad diseño↔código
**Problema:** Cuando el usuario clickea un elemento en el iframe, necesitamos saber qué línea de CSS lo genera. Esto requiere que cada elemento tenga un data attribute único.

**Solución:**
- Cada elemento HTML generado lleva `data-layer-id="txt_01"` o similar
- El iframe emite `postMessage({ type: 'select', layerId: 'txt_01' })` al editor
- El editor busca `layerId` en su store y resalta el código correspondiente
- **Esto ES el diferenciador** vs herramientas que solo son "HTML preview"

**Riesgo mitigado:** ✅ Algoritmo conocido, implementado en Paper, CodePen, etc.

#### 6.6 MCP Tools — rediseño completo
**Problema:** Las 14 MCP tools actuales están diseñadas para Fabric.js (`draw_shape`, `transform_object`, `auto_layout`, etc.). Necesitan ser re-diseñadas para HTML/CSS.

**Solución (ver Sección 8):** Nuevas MCP tools específicas para manipulación HTML/CSS.

**Riesgo mitigado:** ✅ Diseño detallado abajo.

### 🟢 P2 — Riesgos Bajos

#### 6.7 Responsive design
**Problema:** El diseño HTML/CSS es inherentemente responsive. ¿Cómo fijamos un "viewport" para exportar a dimensiones fijas (1080×1080 para posts)?

**Solución:**
- El iframe se configura a las dimensiones del template (`width`, `height`)
- `transform: scale()` para preview responsive en el editor
- Export: Puppeteer viewport fijo a las dimensiones del template

**Riesgo mitigado:** ✅ Trivial con CSS transform + viewport fijo.

#### 6.8 Assets (imágenes) en el diseño
**Problema:** Las imágenes en HTML/CSS necesitan URLs absolutas. ¿Dónde se hostean?

**Solución:**
- Supabase Storage (ya configurado)
- URLs públicas de Supabase → `<img src="https://...supabase.co/storage/...">`
- Upload vía MCP tool: `upload_asset(file)` → devuelve URL pública

**Riesgo mitigado:** ✅ Infraestructura existente.

---

## 7. PLAN DE FASES

### Fase 0 — Proof of Concept (2-3 días Agent IDE)

**Objetivo:** Validar que el approach funciona sin romper nada existente.

```
Tareas:
1. Crear ruta nueva: /editor-v2?template=xxx → carga editor HTML/CSS
2. Iframe sandbox + postMessage bridge básico
3. Monaco Editor lazy-loaded en panel izquierdo
4. Template nuevo con campo "engine": "html" en el store
5. Render: Puppeteer carga HTML en vez de Fabric.js
6. Coexistencia: el editor viejo sigue funcionando en /editor
```

**Entregable:** Un template HTML/CSS que se edita en Monaco, se previsualiza en iframe, y se exporta a PNG.

### Fase 1 — MCP Tools HTML/CSS (2-3 días)

**Objetivo:** Lara puede crear diseños completos vía MCP.

```
Tareas:
1. create_html_template(name, workspaceId, width, height)
2. set_html(templateId, html) — reemplaza el HTML completo
3. set_css(templateId, css) — reemplaza el CSS completo
4. insert_element(templateId, selector, html, position)
5. update_styles(templateId, selector, cssProperties)
6. set_content(templateId, selector, text)
7. add_stylesheet(templateId, url) — Google Fonts, etc.
8. upload_asset(file) → URL
```

### Fase 2 — Bidireccionalidad (2-3 días)

**Objetivo:** Click en diseño → resalta en código, y viceversa.

```
Tareas:
1. Generar data-layer-id en cada elemento al guardar
2. postMessage bridge: iframe → editor (click, hover)
3. postMessage bridge: editor → iframe (highlight, scroll to element)
4. Sincronización en tiempo real (edit CSS → iframe update < 100ms)
5. Panel de propiedades visuales (color, tamaño, posición)
```

### Fase 3 — Features completas (3-5 días)

**Objetivo:** Todo lo que prometimos. Migración completa.

```
Tareas:
1. Google Fonts picker integrado (ya existe GoogleFontPicker.tsx)
2. Color picker visual con variables CSS
3. Templates de diseño (hero, card, carousel, post)
4. Componentes reutilizables (HTML partials + CSS)
5. Batch render de múltiples templates
6. Versiones/undo para HTML/CSS
7. Export: PNG, HTML, PDF
```

### Fase 4 — Deprecación Fabric.js (futuro)

```
Tareas:
1. Migrar templates activos manualmente (pocos)
2. Read-only para templates Fabric.js antiguos
3. Remover dependencia de Fabric.js del bundle
4. Limpiar código legacy
```

---

## 8. NUEVAS MCP TOOLS (Diseño Detallado)

### 8.1 Templates HTML

```yaml
create_html_template:
  description: "Create a new HTML/CSS design template"
  params:
    name: string
    workspaceId: string
    width: number (default 1080)
    height: number (default 1080)
    initialHtml: string (optional)
    initialCss: string (optional)
  returns: template object with engine: "html"

get_html_template:
  description: "Get full HTML + CSS + metadata"
  params:
    id: string
  returns: { html, css, assets, metadata }

set_html:
  description: "Replace full HTML content"
  params:
    templateId: string
    html: string

set_css:
  description: "Replace full CSS stylesheet"
  params:
    templateId: string
    css: string
```

### 8.2 Manipulación de Elementos

```yaml
insert_element:
  description: "Insert HTML element at position/selector"
  params:
    templateId: string
    selector: string (CSS selector, or "body" for root)
    position: "before" | "after" | "prepend" | "append" | "replace"
    html: string (HTML element with optional data-layer-id)
    layerName: string (unique ID for bidirectional link)

update_styles:
  description: "Update CSS properties for a selector"
  params:
    templateId: string
    selector: string
    properties:
      color: string
      background: string
      fontFamily: string
      fontSize: string
      # ... cualquier propiedad CSS
    merge: boolean (true = merge con CSS existente, false = reemplazar)

set_content:
  description: "Change text content of an element"
  params:
    templateId: string
    selector: string
    text: string

remove_element:
  description: "Remove element by selector"
  params:
    templateId: string
    selector: string

duplicate_element:
  description: "Clone element with new layerName"
  params:
    templateId: string
    selector: string
    newLayerName: string
```

### 8.3 Assets y Recursos

```yaml
add_stylesheet:
  description: "Add external stylesheet (Google Fonts, etc.)"
  params:
    templateId: string
    url: string
    id: string (optional, para gestionar después)

upload_asset:
  description: "Upload image/font to Supabase Storage"
  params:
    templateId: string
    file: base64
    filename: string
    folder: string (default "assets")
  returns: { url: string }

list_assets:
  description: "List uploaded assets for a template"
  params:
    templateId: string
  returns: [{ url, filename, size, type }]

delete_asset:
  description: "Remove uploaded asset"
  params:
    templateId: string
    filename: string
```

### 8.4 Layout y Composición

```yaml
apply_layout:
  description: "Apply flex/grid layout to a container"
  params:
    templateId: string
    selector: string
    layout:
      type: "flex" | "grid"
      direction: "row" | "column" | "row-reverse" | "column-reverse"
      gap: string (e.g. "16px")
      justifyContent: string
      alignItems: string
      gridTemplate: string (para grid)

set_dimensions:
  description: "Set width/height/padding/margin"
  params:
    templateId: string
    selector: string
    width: string (CSS value, e.g. "300px", "100%")
    height: string
    padding: string
    margin: string

align_elements:
  description: "Align children within a container"
  params:
    templateId: string
    selector: string (container)
    horizontal: "left" | "center" | "right" | "stretch" | "space-between"
    vertical: "top" | "center" | "bottom" | "stretch"
```

### 8.5 Estilos Visuales

```yaml
set_gradient:
  description: "Apply gradient background"
  params:
    templateId: string
    selector: string
    gradient:
      type: "linear" | "radial" | "conic"
      angle: string (e.g. "135deg", optional for radial)
      stops:
        - color: string
          position: string (e.g. "0%", "50%")

set_shadow:
  description: "Apply box-shadow or text-shadow"
  params:
    templateId: string
    selector: string
    type: "box" | "text"
    shadow:
      offsetX: string
      offsetY: string
      blur: string
      spread: string (box only)
      color: string
      inset: boolean (box only)

set_typography:
  description: "Configure all typography properties"
  params:
    templateId: string
    selector: string
    fontFamily: string
    fontSize: string
    fontWeight: string | number
    fontStyle: "normal" | "italic"
    lineHeight: string
    letterSpacing: string
    textAlign: "left" | "center" | "right" | "justify"
    textDecoration: string
    textTransform: string
    color: string

set_border:
  description: "Configure border and border-radius"
  params:
    templateId: string
    selector: string
    width: string
    style: "solid" | "dashed" | "dotted"
    color: string
    radius: string (e.g. "12px", "50%", "8px 16px")

set_background:
  description: "Set background image/color with blend mode"
  params:
    templateId: string
    selector: string
    color: string (optional)
    image: string (URL, optional)
    size: "cover" | "contain" | "auto" | string
    position: string
    repeat: string
    blendMode: string
```

### 8.6 Render y Export

```yaml
render_html_template:
  description: "Render HTML/CSS template to PNG/JPG"
  params:
    templateId: string
    format: "png" | "jpg"
    scale: number (1-4, default 2)
    selector: string (optional, render specific element instead of full page)

render_all_html_templates:
  description: "Batch render multiple templates"
  params:
    templateIds: string[]
    format: "png" | "jpg"
    scale: number

export_html_template:
  description: "Export as standalone HTML file"
  params:
    templateId: string
    inlineAssets: boolean (embed CSS/images as data URIs)
  returns: { html: string, downloadUrl: string }
```

---

## 9. QUÉ NECESITAMOS PARA EMPEZAR

### Técnico

| # | Recurso | Estado | Detalle |
|---|---------|:---:|---------|
| 1 | Monaco Editor | ❌ Instalar | `npm install @monaco-editor/react` |
| 2 | DOMPurify | ❌ Instalar | `npm install dompurify` + `@types/dompurify` |
| 3 | Iframe sandbox component | ❌ Crear | Componente React con postMessage bridge |
| 4 | HTML/CSS store | ❌ Crear | Extender `DesignTemplate` con campos `html`, `css`, `engine` |
| 5 | MCP tools HTML/CSS | ❌ Crear | 15 nuevas tools (Sección 8) |
| 6 | Render HTML | ❌ Modificar | `render.mjs` → soportar HTML mode |
| 7 | Frontend editor-v2 | ❌ Crear | Nueva ruta + componente |
| 8 | TypeScript types | ❌ Extender | `types.ts` con `HtmlTemplate`, `CssStylesheet` |
| 9 | GoogleFontPicker | ✅ Existe | `src/components/GoogleFontPicker.tsx` — reutilizable |
| 10 | Supabase Storage | ✅ Existe | Ya configurado para upload de assets |
| 11 | Auth + rate limiting | ✅ Existe | Sin cambios |
| 12 | Webhook system | ✅ Existe | Sin cambios |

### Conocimiento

| # | Área | Gap | Mitigación |
|---|------|-----|-----------|
| 1 | postMessage API | No la hemos usado en este proyecto | API estándar, bien documentada |
| 2 | Monaco Editor | No lo hemos integrado | @monaco-editor/react lo simplifica |
| 3 | DOMPurify sanitization | Nuevo en el stack | API simple, 5 líneas de configuración |
| 4 | CSS-in-JS no necesario | Alivio — todo es CSS vanilla | Menos dependencias |

### Tiempo estimado

| Fase | Días Agent IDE | Complejidad |
|------|:---:|:---:|
| Fase 0 — PoC | 2-3 | Media |
| Fase 1 — MCP Tools | 2-3 | Media-Alta |
| Fase 2 — Bidireccionalidad | 2-3 | Alta |
| Fase 3 — Features completas | 3-5 | Media |
| Fase 4 — Deprecación | 1-2 | Baja |
| **Total** | **10-16 días** | — |

---

## 10. DECISIÓN: ¿VALE LA PENA?

### Pros
- ✅ **100% de los stoppers resueltos** de raíz, no parcheados
- ✅ **$0 costo adicional** — todo freemium
- ✅ **Los agentes ya saben CSS** — no necesitan aprender DSL propietario
- ✅ **Bidireccionalidad diseño↔código** — el diferenciador que pidió Ren
- ✅ **Menos código de mantenimiento** — CSS evoluciona solo
- ✅ **Sin deuda técnica futura** en features de diseño visual
- ✅ **Coexistencia** con el editor actual, sin romper nada

### Contras
- ❌ **10-16 días de desarrollo** (pero es menos que implementar los 20 gaps de Fabric.js uno por uno)
- ❌ **Curva de aprendizaje** en postMessage + Monaco
- ❌ **Dos codebases** durante la transición (Fabric.js + HTML/CSS)

### Veredicto

**SÍ, vale la pena.** El approach HTML/CSS resuelve permanente y gratuitamente problemas que en Fabric.js requerirían meses de desarrollo incremental para apenas alcanzar el 70% de features que CSS da gratis. La bidireccionalidad diseño↔código es exactamente lo que Ren visualizó.

---

## 11. PRÓXIMO PASO

Si Ren aprueba, preparo el `/goal` para el Agent IDE con:
1. Fase 0 (PoC) detallada con rutas de archivos específicas
2. No tocar nada del editor Fabric.js existente
3. Nueva ruta `/editor-v2` + componente `HtmlCanvas.tsx`
4. Extensión de tipos en `types.ts`
5. MCP tools mínimas para probar el pipeline completo

---

> **Documento generado:** `docs/HTML_CSS_MIGRATION_ANALYSIS.md`  
> **Repositorio:** `design-main`  
> **Skills relacionadas:** `futuraria-design-system`, `semiology-of-graphics`, `graphic-thinking`
