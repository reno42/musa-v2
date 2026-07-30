# 🎯 GOAL — Fase 1: Completar HTML/CSS Engine

> **Fecha:** 18 Junio 2026  
> **De:** Lara  
> **Para:** Agent IDE Act  
> **Repo:** `design-main`  
> **Contexto:** Fase 0 (PoC) completada. Cerrar gaps para engine productivo.

---

## 📋 Tareas en orden

### 1. DOMPurify en PUT /api/templates/:id
- **Archivo:** `api/src/routes/templates.ts`
- **Problema:** DOMPurify solo se aplica en MCP (`netlify/functions/mcp.mjs`). El PUT directo del REST API no sanitiza.
- **Fix:** Agregar sanitización en el handler PUT. Si `engine === "html"` y `html` viene en el body, pasar por DOMPurify antes de guardar.
- **Config DOMPurify:**
```typescript
ALLOWED_TAGS: ['div','span','h1','h2','h3','h4','h5','h6','p','img','a','br','svg','path','g','section','header','footer','main','article','ul','ol','li','button','strong','em','blockquote','code','pre','hr','table','tr','td','th','thead','tbody'],
ALLOWED_ATTR: ['class','id','src','alt','href','data-layer-id','style','width','height','viewBox','fill','d','stroke','stroke-width'],
```

### 2. Sincronizar Elemento ↔ Código
- **Archivos:** `src/components/HtmlCanvas.tsx`, `src/pages/EditorV2.tsx`
- **Problema:** Click en iframe solo loguea `layerId` en consola. Debe hacer scroll en Monaco hasta el selector CSS correspondiente.
- **Fix:**
  - En `EditorV2.tsx`: `handleSelectElement` recibe `layerId`, busca el selector CSS que contiene `data-layer-id="layerId"`, calcula la línea en el texto CSS, emite evento `scrollToLine` al `CodePanel`
  - En `CodePanel.tsx`: exponer método `scrollToLine(line)` vía ref o callback
  - Si el elemento clickeado no tiene `data-layer-id`, buscar el ancestro más cercano que sí tenga

### 3. Sincronizar tipos en src/shared/index.ts
- **Archivo:** `src/shared/index.ts`
- **Problema:** `DesignTemplate` en el frontend no tiene `engine`, `html`, `css`. Hay discrepancia con `api/src/types.ts`.
- **Fix:** Agregar campos `engine?: "fabric" | "html"`, `html?: string`, `css?: string` al tipo `DesignTemplate` en `src/shared/index.ts`.

### 4. Integrar Google Fonts al engine HTML
- **Archivos:** `src/pages/EditorV2.tsx`, `src/components/HtmlCanvas.tsx`, `src/components/CodePanel.tsx`
- **Componente existente:** `src/components/GoogleFontPicker.tsx` (ya implementado, solo falta integrarlo)
- **Fix:**
  - Agregar botón "Google Fonts" en la toolbar de EditorV2
  - Al seleccionar una font, insertar `@import url('https://fonts.googleapis.com/css2?family=...')` en el CSS
  - Agregar la font al `<link>` en el iframe srcDoc
  - Sugerir un snippet CSS en Monaco: `font-family: 'Selected Font', sans-serif;`

### 5. Render Puppeteer para engine HTML
- **Archivo:** `netlify/functions/render.mjs` (o nuevo archivo `netlify/functions/render-html.mjs`)
- **Problema:** El render actual de HTML usa SVG foreignObject, que tiene bugs con CSS complejo (gradientes, shadows, Google Fonts).
- **Fix:** 
  - Usar `page.setContent(fullHtml)` en Puppeteer en vez de foreignObject
  - Configurar viewport al tamaño del template
  - Esperar a que las Google Fonts carguen (waitUntil: 'networkidle0')
  - Tomar screenshot con `page.screenshot({ type: 'png' })`
  - Si Puppeteer no está disponible en Netlify (por peso de Chromium), mantener foreignObject como fallback pero documentar la limitación

### 6. Version history para HTML templates
- **Archivo:** `api/src/routes/templates.ts`
- **Problema:** El snapshot/diff actual solo compara `canvas.objects` de Fabric.js. Templates HTML no generan snapshots.
- **Fix:**
  - En el PUT handler, si `engine === "html"` y `html` o `css` cambiaron, guardar snapshot con `{ html, css, timestamp }`
  - Agregar a la tabla `template_versions` (si existe) o a un campo `version_history` JSONB
  - La tool MCP `list_versions` ya existe — solo necesita devolver versiones de HTML también

---

## 🚫 NO tocar
- ❌ Editor Fabric.js (`CanvasEditor.tsx`)
- ❌ Templates Fabric.js existentes
- ❌ MCP tools Fabric.js existentes
- ❌ Sistema de auth, workspaces

---

## ✅ Criterios de éxito
1. PUT `/api/templates/:id` con `engine: "html"` sanitiza HTML con DOMPurify
2. Click en iframe → Monaco hace scroll hasta el selector CSS correspondiente
3. `src/shared/index.ts` tiene `engine`, `html`, `css`
4. Google Fonts se carga en el iframe y se sugiere en Monaco al seleccionar del picker
5. Render HTML con Puppeteer genera PNG correcto con gradientes y Google Fonts
6. Las versiones de templates HTML se guardan y son recuperables vía `list_versions`
