# 📋 Revisión FINAL: Plan de Export (.svg, .png, .pdf)

> **Revisor:** Lara | **Fecha:** 2026-07-01 10:30 GMT-5
> **Veredicto:** ✅ APROBADO con correcciones mutuas

---

## 🔄 Correcciones mutuas

### El agente me corrigió (y tenía razón):

| Mi claim | Realidad | Evidencia |
|---|---|---|
| "El backend tiene Puppeteer para PDF" | ❌ Puppeteer NO se puede usar en Netlify free tier (130MB > 50MB límite) | `render.mjs:38-46` lo documenta explícitamente |
| "El renderer de design-deploy es el backend activo" | ❌ El renderer real es `design-main/netlify/functions/render.mjs`. El de `design-deploy` es otro proyecto. | `design-main/api/src/services/renderer.ts` es un stub de 17 líneas |
| "Hay que arreglar el backend renderer para HTML engine" | ❌ `render.mjs` YA soporta frames HTML — lee `tpl._frameHtml`/`tpl._frameCss` | `render.mjs:64-65`, `render.mjs:198-200` |

### Yo corregí al agente (y aceptó):

| Mi claim | Respuesta del agente |
|---|---|
| "DOM-to-SVG son 8-12 horas, no 4-6" | ✅ Aceptó. Ajustó estimación. |
| "El plan original omitía el gap del renderer" | ✅ Aclaró que `render.mjs` ya lo cubre (aunque con self-rendering pages, no render directo) |

---

## ✅ Plan revisado — Aprobado

### Phase 0: MCP `export_frame` SVG via cheerio (2-3h)

- **cheerio** (~50KB, sin browser) parsea `frame.html` + `frame.css`
- Mapea elementos a SVG primitivos (rect, text, image)
- CSS cascade simple (tag, class, id selectors)
- Retorna `{ svg: "...", downloadUrl: "data:image/svg+xml;base64,..." }`
- **Limitaciones aceptables:** Sin flexbox/grid unwrapping, sin font embedding (Google Fonts como `<link>`)

### Phase 1A: UI PDF via jsPDF (1h)

- `npm install jspdf` → `captureFrameToPng` → `addImage` a PDF → download
- ~150KB gzip, client-side only

### Phase 1B: MCP PDF via self-rendering page (1h)

- Extiende `buildHtmlExportPage` con jsPDF CDN
- Auto-descarga PDF al abrir en browser
- MCP retorna `{ html: "...", _note: "Open → auto-downloads PDF" }`

### Phase 1C: Print fallback (30min)

- Botón "Print / Save as PDF" en render page
- `window.print()` con CSS de impresión

### Phase 2: UI SVG nativo para Figma (6-8h, deferred)

- Client-side: `getBoundingClientRect()` + `getComputedStyle()` → SVG
- Fonts como base64 `@font-face`
- Text wrapping con `<tspan>`

---

## 📊 Freemium Compliance

| Fase | Freemium? | Dependencia |
|---|---|---|
| Phase 0 (cheerio SVG) | ✅ | cheerio ~50KB |
| Phase 1A (jsPDF UI) | ✅ | jsPDF ~150KB client-side |
| Phase 1B (MCP PDF) | ✅ | jsPDF CDN in page |
| Phase 1C (print) | ✅ | Cero dependencias |
| Phase 2 (native SVG) | ✅ | Client-side only |

**Total Phases 0+1: 4-5 horas. Sin servicios pagos.**

---

## 🎯 Veredicto final

El plan es **técnicamente sólido, freemium-compatible, y correctamente priorizado.** Phase 0 entrega SVG para MCP inmediatamente. Phase 1 da PDF para Illustrator. Phase 2 es el camino a Figma cuando se necesite.

✅ **Luz verde.**
