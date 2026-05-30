# 📋 Gap Analysis: Mini-Figma Futuraria vs Paper vs Figma

**Fecha:** 2026-05-30 | **Autores:** Lara + Ren + Agent IDE  
**Contexto:** Logramos el pipeline MCP → Editor → Render a $0. Ahora identificamos qué falta para ser un producto completo.

---

## 🎯 Lo que Paper hace que nosotros no (todavía)

Paper es un canvas HTML/CSS con agentes vía MCP. Su diferencial:
- Canvas basado en web standards (HTML/CSS), no Fabric.js
- Agentes leen/escriben diseño directamente
- Design tokens sincronizados code ↔ canvas
- Conexión a datos reales (CMS, DB, APIs)

---

## 🔴 CAPA 1 — Tipografía (Google Fonts)

| Feature | Figma | Paper | Nosotros | Prioridad |
|---------|:---:|:---:|:---:|:---:|
| Google Fonts integration | ✅ 1400+ fonts | ✅ Web fonts | ❌ Solo Syne + Inter hardcodeadas | 🔴 Crítica |
| Font picker/search | ✅ | ✅ | ❌ | 🔴 |
| Font weight (100-900) | ✅ | ✅ | ⚠️ Solo fontWeight numérico | 🔴 |
| Italic | ✅ | ✅ | ❌ No hay flag italic | 🔴 |
| Kerning / letter-spacing | ✅ | ✅ | ❌ | 🟡 |
| Line height | ✅ | ✅ | ❌ | 🟡 |
| Underline / strikethrough | ✅ | ✅ | ❌ | 🟡 |
| Text alignment (L/C/R/Justify) | ✅ | ✅ | ⚠️ Solo textAlign string | 🟢 |

**Solución técnica:** Google Fonts API + `fontFamily` en textbox ampliado. Componente FontPicker que cargue la Google Fonts Developer API (gratis, sin key para lista básica).

---

## 🔴 CAPA 2 — Color y Estilo

| Feature | Figma | Paper | Nosotros | Prioridad |
|---------|:---:|:---:|:---:|:---:|
| Color picker | ✅ HEX/RGB/HSL | ✅ | ❌ Solo strings manuales | 🔴 |
| Gradientes (linear/radial) | ✅ | ✅ | ❌ Fabric.js no soporta en objetos básicos | 🔴 |
| Opacity por capa | ✅ | ✅ | ⚠️ Existe el campo pero no se usa | 🟡 |
| Text shadows | ✅ | ✅ | ❌ | 🟡 |
| Box shadows | ✅ | ✅ | ❌ | 🟡 |
| Border radius | ✅ | ✅ | ⚠️ Campos rx/ry existen pero no se renderizan | 🟡 |
| Border width/color | ✅ | ✅ | ⚠️ stroke/strokeWidth parcial | 🟡 |
| Blend modes | ✅ | ✅ | ❌ | 🟢 |
| Design tokens / variables | ✅ | ✅ | ❌ | 🟢 |

**Solución:** Implementar gradientes como rect superpuestos con opacidad. Border radius requiere actualizar el renderizador Fabric.js. Color picker = librería open source (react-color).

---

## 🔴 CAPA 3 — Layout y Composición

| Feature | Figma | Paper | Nosotros | Prioridad |
|---------|:---:|:---:|:---:|:---:|
| Frames / artboards | ✅ | ✅ | ❌ No implementado en MCP | 🔴 |
| Auto-layout (flex) | ✅ | ✅ | ❌ | 🔴 |
| Grid | ✅ | ✅ | ❌ | 🟡 |
| Constraints / responsive | ✅ | ✅ | ❌ | 🟡 |
| Align tools (L/C/R/T/B) | ✅ | ✅ | ❌ No en MCP | 🟡 |
| Distribute (horizontal/vertical) | ✅ | ✅ | ❌ | 🟢 |
| Z-index / layer order | ✅ | ✅ | ❌ | 🟡 |
| Groups | ✅ | ✅ | ❌ | 🟡 |

---

## 🟡 CAPA 4 — Assets y Media

| Feature | Figma | Paper | Nosotros | Prioridad |
|---------|:---:|:---:|:---:|:---:|
| Images (upload/URL) | ✅ | ✅ | ❌ | 🔴 |
| SVG import | ✅ | ✅ | ❌ | 🟡 |
| Video backgrounds | ❌ | ❌ | ❌ | 🟢 |
| Icon libraries | ✅ Plugins | ✅ | ❌ | 🟢 |
| Unsplash/Pexels integration | ✅ Plugins | ❌ | ❌ | 🟢 |

---

## 🟡 CAPA 5 — Componentes y Reusabilidad

| Feature | Figma | Paper | Nosotros | Prioridad |
|---------|:---:|:---:|:---:|:---:|
| Components (master/instance) | ✅ | ✅ | ❌ | 🟡 |
| Component variants | ✅ | ✅ | ❌ | 🟡 |
| Styles library | ✅ | ✅ | ⚠️ Existe campo styles[] vacío | 🟡 |
| Templates marketplace | ✅ Community | ❌ | ✅ Nuestro workspace Styles | 🟢 |

---

## 🟢 CAPA 6 — Colaboración y Workflow

| Feature | Figma | Paper | Nosotros | Prioridad |
|---------|:---:|:---:|:---:|:---:|
| MCP para agentes | ❌ | ✅ | ✅ | 🟢 |
| Editor web WYSIWYG | ✅ | ✅ | ✅ | 🟢 |
| Version history | ✅ | ✅ | ⚠️ Campo versions[] existe | 🟢 |
| Comments | ✅ | ✅ | ⚠️ Campo comments[] existe | 🟢 |
| Multiplayer | ✅ | ✅ | ❌ | 🟢 |
| Render server-side | ❌ | ❌ | ✅ PNG auto-download | 🟢 |

---

## 📊 Resumen: Lo que frena el producto hoy

| # | Bloqueante | Impacto |
|---|-----------|---------|
| 1 | **Google Fonts** — sin selector de fuentes, el editor es inútil para diseño real | No se puede diseñar con variedad tipográfica |
| 2 | **Gradientes** — el branding de Futuraria es verde→púrpura y no se puede representar | No se ve la identidad de marca |
| 3 | **Border radius** — los botones pill y cards redondeadas no se renderizan | Todo se ve cuadrado/feo |
| 4 | **Imágenes** — no se pueden agregar fotos de fondo | Sin imágenes no hay posts de noticias |
| 5 | **Color picker** — hay que escribir hex codes manualmente | Inusable para no-técnicos |

---

## 🗺️ Roadmap sugerido

### Fase 1 — MVP de diseño (1-2 días Agent IDE)
- Google Fonts API → font picker con search
- Color picker (react-color o nativo)
- Border radius en rect (Fabric.js `rx`/`ry`)
- Gradientes como overlay (2 rects superpuestos con opacidad)

### Fase 2 — Contenido real (1 día)
- Imágenes vía URL en el canvas
- Opacidad funcional en render
- Text shadows con efecto `shadow` de Fabric.js

### Fase 3 — Layout (2-3 días)
- Frames como contenedores (1080×1080 template default)
- Auto-layout básico (flex direction + gap)
- Align tools vía MCP
- Z-index / layer ordering

### Fase 4 — Producción (1-2 días)
- Componentes reutilizables
- Batch render (múltiples templates de una)
- Google Sheets → templates (n8n integration)

---

## 🔗 Referencias

- Paper: https://paper.design — HTML/CSS canvas con MCP nativo
- Figma API: https://www.figma.com/developers/api
- Google Fonts API: https://developers.google.com/fonts/docs/developer_api
- Fabric.js demos: http://fabricjs.com/demos/
