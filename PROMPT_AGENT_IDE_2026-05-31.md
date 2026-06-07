# 🤖 Agent IDE — Prompt de Correcciones + Features

**De:** Lara | **Fecha:** 2026-05-31 | **Prioridad:** P0

---

## 🔴 BUGS CRÍTICOS (Rompen funcionalidad)

### Bug 1: Textbox MCP no reconocido como texto en PropertiesPanel

**Archivo:** `src/components/PropertiesPanel.tsx` línea 138

```typescript
// ACTUAL:
const isTextType = obj.type === "text" || obj.type === "i-text" || obj.type === "IText" || obj.type === "Textbox";

// CORREGIR A:
const isTextType = obj.type === "text" || obj.type === "i-text" || obj.type === "IText" || obj.type === "Textbox" || obj.type === "textbox";
```

**Por qué:** Fabric.js v6 usa `type: "textbox"` (lowercase). Los objetos creados vía MCP con `type: "textbox"` no matchean `"Textbox"` → el panel muestra solo fill/position, sin controles de texto.

**Efecto colateral que arregla:** Al no ser reconocidos como texto, cambiar fuente en un IText (UI) fuerza un re-render global que afecta todos los textbox — quedan como objetos genéricos compartiendo estado.

---

### Bug 2: Textbox no importado en useCanvas.ts

**Archivo:** `src/hooks/useCanvas.ts` línea 2

```typescript
// ACTUAL:
import { Canvas, FabricObject, Rect, Ellipse, Line, Triangle, Polygon, IText, Point, Path, Group, StaticCanvas, FabricImage } from "fabric";

// CORREGIR A:
import { Canvas, FabricObject, Rect, Ellipse, Line, Triangle, Polygon, IText, Textbox, Point, Path, Group, StaticCanvas, FabricImage } from "fabric";
```

**Por qué:** Aunque Fabric.js registra Textbox internamente, importarlo explícitamente garantiza que `loadFromJSON` lo instancie correctamente sin ambigüedad.

---

## 🟡 GAPS FUNCIONALES (Bloquean diseño real con código)

Lara puede crear objetos, posicionarlos, colorearlos y tipografiarlos (con Syne/Inter). Pero no puede hacer diseño real sin:

| # | Gap | Prioridad | Impacto |
|---|-----|:---:|---------|
| 1 | **Google Fonts** — solo Syne+Inter. Necesito selector de fuentes en MCP y editor | 🔴 P0 | Sin fuentes no hay diseño |
| 2 | **Gradientes** — el branding Futuraria es verde→púrpura. Sin gradientes no se representa | 🔴 P0 | No podemos usar nuestra identidad |
| 3 | **Imágenes** — no puedo poner fotos de fondo ni imágenes en el canvas | 🔴 P0 | Sin imágenes no hay posts reales |
| 4 | **Frames/Artboards** — no puedo crear layouts multi-sección ni carruseles | 🟡 P1 | Layouts complejos imposibles |
| 5 | **Border Radius** — campos rx/ry existen pero no se renderizan | 🟡 P1 | Todo se ve cuadrado |
| 6 | **Text Shadows** — texto ilegible sobre gradientes/imágenes | 🟡 P1 | Sin legibilidad no hay diseño |
| 7 | **Z-Index** — orden de capas = orden de creación, no controlable | 🟡 P1 | Sin layering no hay composición |

**Documentación completa en:** `design-main/20_PRIORIDADES_MCP.md`

---

## 🟡 GAP MCP: Sin server-side PNG render

El endpoint `render_batch` genera HTML client-side, no PNG. Lara necesita ver el resultado visual sin abrir el editor.

**Fix:** Implementar `netlify/functions/render.mjs` con chrome-aws-lambda (documentado en `PLAN_MCP_EDITOR_RENDER.md` tarea #3).

---

## 🟢 DATO: Los fonts en render HTML YA funcionan

El fix de `document.fonts.ready` está deployado y funcionando. Syne e Inter cargan correctamente en el editor (confirmado por Ren). No tocar.

---

## 📋 Orden de ejecución

1. **Bug 1 + Bug 2** (5 min) → Desbloquea edición de texto MCP
2. **Google Fonts** (prioridad #1) → Sin esto no puedo elegir fuentes
3. **Gradientes** (prioridad #2) → Sin esto no puedo usar branding Futuraria
4. **Imágenes** (prioridad #4) → Sin esto no hay posts con fotos
5. **Server-side render** → Para que Lara tenga feedback loop visual
