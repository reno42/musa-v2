# 🏗️ Migración Fabric.js → HTML/CSS — Roadmap y Goal

> **Creado:** 18 Junio 2026 | **Fuente:** `design-main/docs/HTML_CSS_MIGRATION_ANALYSIS.md`  
> **Decisión:** ✅ Aprobado por Ren. Ejecutar Fase 0 (PoC).

---

## 🎯 Objetivo

Migrar el editor de diseño de Fabric.js (canvas propietario) a HTML/CSS nativo (iframe sandbox + Monaco Editor), manteniendo coexistencia con el editor actual. El agente escribe CSS puro y ve el resultado en tiempo real.

---

## 📋 Fase 0 — Proof of Concept (2-3 días)

### Archivos a crear/modificar

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `src/types.ts` | MODIFICAR | Agregar `engine: "fabric" | "html"` al tipo `DesignTemplate` |
| `src/types.ts` | MODIFICAR | Agregar campos `html: string`, `css: string` opcionales |
| `src/components/HtmlCanvas.tsx` | NUEVO | Componente principal: iframe sandbox + postMessage bridge |
| `src/components/CodePanel.tsx` | NUEVO | Panel Monaco/CodeMirror con tabs HTML + CSS |
| `src/pages/EditorV2.tsx` | NUEVO | Página del editor HTML/CSS que ensambla HtmlCanvas + CodePanel |
| `App.tsx` | MODIFICAR | Agregar ruta `/editor-v2?template=xxx` |
| `api/mcp-tools.ts` | MODIFICAR | Agregar 3 tools MCP mínimas: `create_html_template`, `set_html`, `set_css` |
| `api/render.mjs` | MODIFICAR | Agregar modo HTML: `page.setContent(html)` en vez de Fabric.js |
| `api/routes/templates.ts` | MODIFICAR | Soportar `engine: "html"` en POST/PUT + validación DOMPurify |
| `packages/shared/types.ts` | MODIFICAR | Tipos compartidos para HtmlTemplate |

### Instalar dependencias

```bash
npm install @monaco-editor/react dompurify
npm install -D @types/dompurify
```

### Especificaciones técnicas

#### 1. Iframe Sandbox
```tsx
<iframe
  sandbox="allow-same-origin"
  srcDoc={fullHtml}
  style={{ width: template.width, height: template.height, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
  ref={iframeRef}
/>
```
- Sin `allow-scripts` — previene XSS
- `srcDoc` con HTML+CSS inline
- `postMessage` para bidireccionalidad (click en iframe → resalta en código)

#### 2. CSP Header en el iframe
```html
<meta http-equiv="Content-Security-Policy" 
  content="default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'none'; img-src 'self' https:">
```

#### 3. DOMPurify en el API
```typescript
import DOMPurify from 'dompurify';
const clean = DOMPurify.sanitize(html, { 
  ALLOWED_TAGS: ['div','span','h1','h2','h3','h4','h5','h6','p','img','a','br','svg','path','g'],
  ALLOWED_ATTR: ['class','id','src','alt','href','data-layer-id','style']
});
```

#### 4. MCP Tools mínimas (Fase 0)
- `create_html_template(name, workspaceId, width, height, initialHtml?, initialCss?)`
- `set_html(templateId, html)` — reemplaza HTML, sanitiza con DOMPurify
- `set_css(templateId, css)` — reemplaza CSS

#### 5. Render HTML
Modificar `api/render.mjs`:
```javascript
if (template.engine === 'html') {
  await page.setContent(template.html + '<style>' + template.css + '</style>');
  // No necesita Fabric.js
} else {
  // Código actual de Fabric.js
}
```

---

## 🚫 Lo que NO se toca

- ❌ Editor Fabric.js existente (`/editor` sigue funcionando)
- ❌ Templates Fabric.js antiguos (se abren en el editor viejo)
- ❌ MCP tools Fabric.js existentes
- ❌ Sistema de auth, workspaces, rate limiting
- ❌ Supabase schema actual

---

## ✅ Criterios de éxito

1. `POST /api/templates` con `engine: "html"` crea template y devuelve 201
2. `PUT /api/templates/:id` con `set_html` actualiza HTML sanitizado
3. Abrir `/editor-v2?template=xxx` muestra iframe con el diseño renderizado
4. Editar CSS en Monaco → iframe se actualiza en < 200ms
5. `render_html_template` vía MCP exporta PNG correcto desde HTML/CSS
6. Editor viejo en `/editor` sigue funcionando sin cambios

---

> ⚡ *Preparado por Lara — 18 Junio 2026*
