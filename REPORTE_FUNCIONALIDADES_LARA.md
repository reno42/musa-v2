# 👋 Hola, soy Lara — Design Engineer en Futuraria

Trabajo con Renzo orquestando infraestructura, deploys, auditorías y documentación. Mi scope: GitHub, Netlify, n8n, Supabase, Obsidian.

Tú (agente IDE Qoder) trabajas el código granular con DeepSeek v4. Yo no toco el código — hago deploys, conecto servicios y documento.

Coordinamos vía Renzo, que es el CEO de esta OPC (One Person Company)

---

## 📋 Reporte de Funcionalidades — Mini-Figma

### Bugs críticos reportados por Renzo (usabilidad 0):
1. **Zoom/Pan roto** — Fabric.js canvas no responde a scroll/arrastre
2. **Colapsar paneles** — los side panels no se ocultan, ocupan toda la pantalla
3. **Barra lateral ocupa mucho espacio** — no hay toggle de colapso funcional
4. **Hand tool (manito)** — no funciona para navegar el canvas

### Checklist completo abajo. 65 funcionalidades comparadas contra Figma, Canva y Dropbox Paper.
### Prioridad: reparar los 5 bugs críticos primero (afectan usabilidad básica).

---

# 📋 Checklist de Funcionalidades — Figma vs Canva vs Dropbox Paper vs Mini-Figma

> **URL del deploy:** https://bejewelled-llama-a6719d.netlify.app  
> **API funciona:** ✅ (testeado con POST/PUT vía X-API-Key)  
> **Fecha:** 24 Mayo 2026

## 🖼️ CANVAS / LIENZO

| Funcionalidad | Figma | Canva | Paper | Mini-Figma | Estado |
|--------------|-------|-------|-------|------------|--------|
| Zoom (scroll/ctrl) | ✅ | ✅ | ❌ | ✅ Fabric.js | 🟢 Funciona |
| Pan (arrastrar/space) | ✅ | ✅ | ❌ | ❌ | 🔴 NO funciona |
| Hand tool (manito) | ✅ | ✅ | ❌ | ❌ | 🔴 Roto |
| Grid/snap | ✅ | ✅ | ❌ | ✅ Snap settings | 🟡 Parcial |
| Reglas/guides | ✅ | ✅ | ❌ | ❌ | 🔴 Falta |
| Multi-page / frames | ✅ | ✅ | ❌ | ❌ | 🔴 Falta |
| Infinite canvas | ✅ | ✅ | ✅ | ✅ | 🟢 Ok |
| Dark mode canvas | ✅ | ✅ | ✅ | ✅ #0a0a0f | 🟢 Ok |
| Undo/Redo | ✅ | ✅ | ✅ | ❌ | 🔴 Falta |
| Copy/Paste | ✅ | ✅ | ✅ | ❌ | 🔴 Falta |

## 📐 OBJETOS Y CAPAS

| Funcionalidad | Figma | Canva | Paper | Mini-Figma | Estado |
|--------------|-------|-------|-------|------------|--------|
| Rectángulo | ✅ | ✅ | ❌ | ✅ | 🟢 Ok |
| Elipse/círculo | ✅ | ✅ | ❌ | ✅ | 🟢 Ok |
| Texto | ✅ | ✅ | ✅ | ✅ | 🟢 Ok |
| Imagen (upload) | ✅ | ✅ | ✅ | ✅ | 🟢 Ok |
| Línea/flecha | ✅ | ✅ | ❌ | ✅ | 🟢 Ok |
| Path/vector | ✅ | ✅ | ❌ | ✅ | 🟢 Ok |
| Grupo | ✅ | ✅ | ❌ | ✅ | 🟢 Ok |
| Frame/artboard | ✅ | ✅ | ❌ | ❌ | 🔴 Falta |
| Componentes | ✅ | ✅ | ❌ | ✅ | 🟡 Existe UI |
| Tabla | ❌ | ✅ | ✅ | ❌ | ⬜ No planeado |
| Video/embed | ❌ | ✅ | ✅ | ❌ | ⬜ No planeado |

## 🎨 ESTILOS Y DISEÑO

| Funcionalidad | Figma | Canva | Paper | Mini-Figma | Estado |
|--------------|-------|-------|-------|------------|--------|
| Color fill | ✅ | ✅ | ✅ | ✅ | 🟢 Ok |
| Stroke/borde | ✅ | ✅ | ❌ | ✅ | 🟢 Ok |
| Opacidad | ✅ | ✅ | ❌ | ✅ | 🟢 Ok |
| Sombras (shadow) | ✅ | ✅ | ❌ | ✅ | 🟢 Ok |
| Blur/effects | ✅ | ✅ | ❌ | ✅ | 🟢 Ok |
| Gradientes | ✅ | ✅ | ❌ | ❌ | 🔴 Falta |
| Border radius | ✅ | ✅ | ❌ | ✅ | 🟢 Ok |
| Text styles (font, size, weight) | ✅ | ✅ | ✅ | ✅ | 🟢 Ok |
| Text align | ✅ | ✅ | ✅ | ✅ | 🟢 Ok |
| Color picker | ✅ | ✅ | ❌ | ❌ | 🔴 Falta |
| Estilos guardados | ✅ | ✅ | ❌ | ✅ Styles panel | 🟢 Ok |
| Design tokens/variables | ✅ | ❌ | ❌ | ✅ Variables panel | 🟢 Ok |

## 📋 PANELES Y UI

| Funcionalidad | Figma | Canva | Paper | Mini-Figma | Estado |
|--------------|-------|-------|-------|------------|--------|
| Layers panel | ✅ | ✅ | ❌ | ✅ | 🟢 Ok |
| Properties panel | ✅ | ✅ | ❌ | ✅ | 🟢 Ok |
| Components panel | ✅ | ✅ | ❌ | ✅ | 🟢 Ok |
| Styles panel | ✅ | ❌ | ❌ | ✅ | 🟢 Ok |
| Toolbar | ✅ | ✅ | ✅ | ✅ | 🟢 Ok |
| Colapsar/expandir paneles | ✅ | ✅ | ❌ | ❌ | 🔴 Roto |
| Drag resize paneles | ✅ | ❌ | ❌ | ❌ | 🔴 Falta |
| Settings modal | ✅ | ✅ | ❌ | ✅ | 🟢 Ok |

## 🔧 HERRAMIENTAS AVANZADAS

| Funcionalidad | Figma | Canva | Paper | Mini-Figma | Estado |
|--------------|-------|-------|-------|------------|--------|
| Boolean operations | ✅ | ❌ | ❌ | ✅ | 🟢 Ok |
| Align/distribute | ✅ | ✅ | ❌ | ❌ | 🔴 Falta |
| Transform (rotate, scale) | ✅ | ✅ | ❌ | ✅ Fabric.js | 🟢 Ok |
| Mask/clip | ✅ | ❌ | ❌ | ❌ | 🔴 Falta |
| Constraints/auto-layout | ✅ | ❌ | ❌ | ❌ | 🔴 Falta |
| Prototype interactions | ✅ | ❌ | ❌ | ✅ PrototypePanel | 🟢 Ok |
| Version history | ✅ | ✅ | ✅ | ✅ VersionHistoryPanel | 🟢 Ok |
| Comments | ✅ | ✅ | ✅ | ✅ CommentsPanel + pins | 🟢 Ok |
| Auto-save | ✅ | ✅ | ✅ | ✅ useAutoSave.ts | 🟢 Ok |
| Real-time collaboration | ✅ | ✅ | ✅ | ✅ useRealtime.ts | 🟢 Ok |
| Cursor presence | ✅ | ❌ | ❌ | ✅ CursorOverlay | 🟢 Ok |

## 🔌 API Y EXTENSIBILIDAD

| Funcionalidad | Figma | Canva | Paper | Mini-Figma | Estado |
|--------------|-------|-------|-------|------------|--------|
| REST API | ✅ | ✅ | ❌ | ✅ Express + Edge | 🟢 Ok |
| API Keys | ✅ (OAuth) | ✅ | ❌ | ✅ SHA-256 | 🟢 Ok |
| Webhooks | ✅ | ❌ | ❌ | ✅ Eventos + n8n | 🟢 Ok |
| Plugins | ✅ | ✅ | ❌ | ❌ | 🔴 Falta |
| Templates gallery | ✅ | ✅ | ✅ | ✅ CRUD | 🟢 Ok |
| Export (PNG/SVG/PDF) | ✅ | ✅ | ✅ | ✅ Puppeteer + SVG | 🟢 Ok |
| n8n integration | ❌ | ❌ | ❌ | ✅ 3 workflows | 🟢 Ok |

## 🤝 COLABORACIÓN

| Funcionalidad | Figma | Canva | Paper | Mini-Figma | Estado |
|--------------|-------|-------|-------|------------|--------|
| Compartir link | ✅ | ✅ | ✅ | ✅ templateId URL | 🟢 Ok |
| Comentarios | ✅ | ✅ | ✅ | ✅ | 🟢 Ok |
| Multi-usuario | ✅ | ✅ | ✅ | ✅ | 🟢 Ok |
| Permisos/view-only | ✅ | ✅ | ❌ | ❌ | 🔴 Falta |
| Branches (branching) | ✅ | ❌ | ❌ | ✅ BranchPanel | 🟢 Ok |

## 📊 RESUMEN

| Categoría | Total | 🟢 Funciona | 🟡 Parcial | 🔴 Roto/Falta |
|-----------|-------|------------|-----------|--------------|
| Canvas/Lienzo | 10 | 3 | 1 | 6 |
| Objetos/Capas | 11 | 8 | 1 | 2 |
| Estilos | 12 | 9 | 0 | 3 |
| Paneles UI | 8 | 5 | 0 | 3 |
| Avanzadas | 11 | 8 | 0 | 3 |
| API/Extensibilidad | 7 | 6 | 0 | 1 |
| Colaboración | 6 | 5 | 0 | 1 |
| **TOTAL** | **65** | **44 (68%)** | **2 (3%)** | **19 (29%)** |

---

## 📋 BACKLOG — Pendientes clasificados por prioridad

### 🔴 P0 — CRÍTICO (bloquea uso básico)

| # | Feature | Tipo | Qué hace en Figma/Canva/Paper |
|---|---------|------|-------------------------------|
| 1 | **Zoom/Pan** | Fix | Figma: scroll zoom, space+drag pan, trackpad pinch. Canva: botones +/- y drag. |
| 2 | **Hand tool (manito)** | Fix | Figma: H key o spacebar para mover canvas sin seleccionar. |
| 3 | **Colapsar paneles** | Fix | Figma: Cmd+\ togglea sidebars. Canva: botón colapsar en cada panel. |
| 4 | **Undo/Redo** | Nueva | Figma: Cmd+Z / Cmd+Shift+Z. Historial completo de acciones. |
| 5 | **Copy/Paste** | Nueva | Figma: Cmd+C/V, Cmd+D (duplicate). Canva: botón duplicar. |
| 6 | **Delete/Backspace** | Nueva | Figma: suprimir objetos seleccionados con tecla Delete. |

### 🟠 P1 — ALTO (necesario para diseñar en serio)

| # | Feature | Tipo | Qué hace en Figma/Canva/Paper |
|---|---------|------|-------------------------------|
| 7 | **Color picker** | Nueva | Figma: eyedropper (I), color panel con HSL/HEX/RGBA. Canva: paleta + custom. |
| 8 | **Align/Distribute** | Nueva | Figma: alinear top/left/center/horizontal/vertical, distribuir spacing. |
| 9 | **Gradientes** | Nueva | Figma: linear, radial, angular, diamond. Canva: gradient editor visual. |
| 10 | **Frames/Artboards** | Nueva | Figma: frames anidables con constraints. Canva: páginas/artboards. |
| 11 | **Reglas y guías** | Nueva | Figma: rulers (Shift+R), drag guides desde reglas. Canva: rulers + guides. |
| 12 | **Group/Ungroup** | Fix | Figma: Cmd+G / Cmd+Shift+G. Ya existe UI pero testear funcionalidad. |
| 13 | **Layers: reorden drag-drop** | Fix | Figma: drag layers en panel para cambiar orden. Verificar si funciona. |
| 14 | **Lock/Unlock layers** | Nueva | Figma: Cmd+L bloquea capa, ícono candado en panel. |
| 15 | **Text editing inline** | Nueva | Figma: doble click en texto para editar directo en canvas. |

### 🟡 P2 — MEDIO (completezza del producto)

| # | Feature | Tipo | Qué hace en Figma/Canva/Paper |
|---|---------|------|-------------------------------|
| 16 | **Keyboard shortcuts** | Nueva | Figma: shortcuts panel (Ctrl+Shift+?). Tool shortcuts (R=rect, T=text, etc). |
| 17 | **Resize desde bordes** | Nueva | Figma/Canva: drag handles en esquinas y bordes para redimensionar. |
| 18 | **Multi-selección** | Nueva | Figma: Shift+click o drag-select múltiples objetos. |
| 19 | **Mask/Clip** | Nueva | Figma: usar objeto como máscara de otro. Canva: crop shapes. |
| 20 | **Constraints/Auto-layout** | Nueva | Figma: auto-layout (Shift+A), padding, gap, dirección, wrap. Componente más usado. |
| 21 | **Components variants** | Nueva | Figma: variantes de un componente (estados: default, hover, active, disabled). |
| 22 | **Component properties** | Nueva | Figma: boolean (show/hide), text override, instance swap en componentes. |
| 23 | **Export Selection** | Nueva | Figma: exportar selección como PNG/SVG/JPG/PDF con escala. Canva: download. |
| 24 | **Libraries/Styles** | Nueva | Figma: shared styles (color, text, effect, grid) entre archivos. Canva: brand kit. |
| 25 | **Drag resize paneles** | Nueva | Figma: drag borde de panel para ajustar ancho. |
| 26 | **Smart animate** | Nueva | Figma: animación automática entre frames en prototipo. |

### 🟢 P3 — BAJO (nice to have, diferencial)

| # | Feature | Tipo | Qué hace en Figma/Canva/Paper |
|---|---------|------|-------------------------------|
| 27 | **Dev Mode / Inspect** | Nueva | Figma: panel de inspección con código CSS/Swift/XML generado. |
| 28 | **Plugins API** | Nueva | Figma: plugins JS/TS con API figma.*. Canva: apps marketplace. |
| 29 | **Rich text / Markdown** | Nueva | Paper: edición rich text con bold/italic/headings/lists. Canva: text effects. |
| 30 | **Tables** | Nueva | Paper: tablas editables. Canva: tabla con estilos. Figma: no tiene nativo. |
| 31 | **Checklists / TODOs** | Nueva | Paper: checklist items ([] y [x]). Útil para design QA. |
| 32 | **Templates marketplace** | Nueva | Canva: galería de templates por categoría. Figma: community templates. |
| 33 | **Magic Write / AI** | Nueva | Canva: generación de texto con IA. Figma: AI features (beta). |
| 34 | **Background remover** | Nueva | Canva: quitar fondo de imágenes en 1 click. |
| 35 | **Photo filters** | Nueva | Canva: filtros, ajustes de brillo/contraste/saturación. |
| 36 | **QR code generator** | Nueva | Canva: generar QR code desde URL dentro del editor. |
| 37 | **Bulk create** | Nueva | Canva: generar múltiples variantes desde datos (merge tags). |
| 38 | **Mobile responsive** | Nueva | Figma: no. Canva: app mobile. Mini-Figma: actual no responsive. |
| 39 | **Offline mode** | Nueva | Paper: offline first con sync. Figma: no. |
| 40 | **Code blocks** | Nueva | Paper: bloques de código con syntax highlight. |
| 41 | **@mentions** | Nueva | Paper/Canva: @usuario para notificar en comentarios. |

---

## 🚨 TOP 5 BUGS CRÍTICOS (ya reportados — no repetir en backlog)

| # | Bug | Impacto |
|---|-----|---------|
| 1 | **Zoom/Pan roto** | Usabilidad 0 — no se navega el canvas |
| 2 | **Colapsar paneles roto** | Espacio de trabajo inusable |
| 3 | **Sin Undo/Redo** | Cada error es irreversible |
| 4 | **Sin Copy/Paste** | No se duplica elementos |
| 5 | **Falta color picker** | Solo hex codes manual |

---

## 🔍 Funcionalidades específicas de Figma que NO están documentadas aún (verificación manual necesaria)

- Component variants y propiedades (componentes con estados)
- Instance swap (cambiar instancia de componente)
- Auto-layout (dirección, gap, padding, wrap, hug/fill)
- Absolute position dentro de auto-layout
- Constraints (left, right, top, bottom, center, scale)
- Grid styles (layout grid, columns, rows)
- Stroke: múltiples strokes, inside/outside/center
- Efectos: layer blur, background blur
- Boolean groups: flatten, union, subtract, intersect, exclude
- Vector editing (puntos de curva, bezier handles)
- Secciones (agrupación semántica)
- Prototype triggers avanzados: after delay, mouse enter, key press
- Smart animate (transición entre variantes)
- Scroll position (fixed, sticky)
- Component description y documentation link

## 🔍 Funcionalidades específicas de Canva que NO están documentadas aún

- Brand kit (logos, fonts, paletas por marca)
- Magic Switch (redimensionar diseño automáticamente)
- Translate (traducción de texto en diseño)
- Draw (dibujo a mano alzada)
- Charts (gráficos de barra, línea, pie, etc)
- Mockups (aplicar diseño a fotos de productos)
- Animations (animar elementos, page transitions)
- Record yourself (video con cámara + pantalla)
- Presenter mode (vista de presentación)
- Share to social media (publicación directa)

## 🔍 Funcionalidades específicas de Paper que NO están documentadas aún

- Timeline / Gantt view
- Meeting notes template + asignar tareas
- Dropbox file embed (vista previa de archivos)
- Mobile app offline
- Document linking (link entre docs de Paper)
- Markdown import/export

---

## 📊 RESUMEN FINAL (actualizado)

| Categoría | Total Features | En Backlog P0 | En Backlog P1 | En Backlog P2 | En Backlog P3 |
|-----------|---------------|---------------|---------------|---------------|---------------|
| Canvas | 10 | 4 | 2 | 2 | 0 |
| Objetos | 11 | 1 | 4 | 2 | 1 |
| Estilos | 12 | 1 | 2 | 0 | 1 |
| Paneles | 8 | 1 | 0 | 1 | 0 |
| Avanzadas | 11 | 0 | 0 | 4 | 1 |
| API | 7 | 0 | 0 | 0 | 2 |
| Colaboración | 6 | 0 | 0 | 0 | 1 |
| **Nuevas (no en tabla original)** | 19 | 0 | 0 | 2 | 17 |
| **TOTAL** | **84** | **7** | **8** | **11** | **23** |

> **49 features pendientes totales. Prioridad: P0 primero (7 items críticos que bloquean uso básico).**
