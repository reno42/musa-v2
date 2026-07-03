# Fix: Template Profiler no distingue contenido de chrome en templates Futuraria

**Fecha:** 2026-07-03  
**Severidad:** Alta — bloquea el flujo CSV batch para todos los templates existentes  
**Archivos:** `netlify/functions/template-profiler.mjs`, `netlify/functions/mcp.mjs`  
**Template de prueba:** `tpl_8a398640-78e` (Enfermedad Celíaca — 11 frames HTML)

---

## 🔴 Síntoma

Al perfilar un template Futuraria (dark theme, HTML monolítico), el profiler detecta **todos** los elementos del DOM como slots, incluyendo chrome que el humano nunca debería llenar.

**CSV generado para el slide 01:**

```
_columnas: futuraria-logo, slide-num, wordmark, slide, content, stats-row, stat, stat_2, label, number, gradient-text, source-note, ...
```

El humano tendría que llenar campos como `futuraria-logo: "FUTURARIA"` y `slide-num: "GUÍA NUTRICIONAL"` — datos que son parte del diseño, no del contenido.

## 🎯 Expected behavior

El CSV debe tener solo columnas para **contenido reemplazable**:

```
_columnas: headline, subtitle, stat_1_value, stat_1_label, stat_2_value, stat_2_label, source
```

---

## 🔍 Root cause

### Causa 1: El profiler no filtra elementos decorativos/estructurales

Los templates Futuraria tienen muchos `<div>` decorativos dentro de cada slide:

```html
<div class="slide">           ← contenedor, detectado como slot "slide"
  <div class="bg-grid"></div> ← decorativo, vacío, pero detectado igual
  <div class="glow-tr"></div> ← decorativo
  <div class="futuraria-logo"><div class="star">...</div> ← chrome, detectado como slot "futuraria-logo"
```

El profiler actual trata **todo elemento con class o id** como potencial slot. Necesita reglas de filtrado.

### Causa 2: Los templates existentes no tienen `data-slot`

El profiler ya soporta `data-slot` (implementado en A4), pero ningún frame de los templates Futuraria lo usa. Sin `data-slot`, el profiler hace fallback a nombres basados en selectores CSS (".content", ".slide-num"), que no son nombres humanos ni útiles.

---

## 🔧 Fix — Dos cambios

### Cambio 1: template-profiler.mjs — Ignorar elementos sin contenido real

Agregar filtro en `profileFrame()` después del Step 1 (parseo HTML):

```js
// NEW: Filter out decorative/structural elements BEFORE classifying as slots
const DECORATIVE_CLASSES = ['bg-grid', 'glow-tr', 'glow-bl', 'star', 'accent-line'];
const CHROME_CLASSES = ['futuraria-logo', 'wordmark', 'slide-num', 'footer-bar'];
const STRUCTURAL_TAGS = ['html', 'head', 'body', 'style', 'script', 'meta', 'link'];

function isContentElement($el) {
  const tag = ($el[0]?.tagName || '').toLowerCase();
  const classes = ($el.attr('class') || '').split(/\s+/);

  // Ignorar tags estructurales
  if (STRUCTURAL_TAGS.includes(tag)) return false;

  // Ignorar elementos decorativos (solo visuales, sin contenido textual)
  if (DECORATIVE_CLASSES.some(c => classes.includes(c))) return false;

  // Ignorar chrome del template (logo, número de slide, etc.)
  if (CHROME_CLASSES.some(c => classes.includes(c))) return false;

  // Ignorar el contenedor principal .slide (es todo el frame)
  if (classes.includes('slide')) return false;

  // Ignorar elementos sin texto visible ni src
  const text = $el.text().trim();
  const hasSrc = !!($el.attr('src') || $el.css('background-image')?.match(/url\(/));
  if (!text && !hasSrc) return false;

  // Elementos con texto muy corto y sin data-slot probablemente son decorativos
  if (text.length < 3 && !$el.attr('data-slot') && !hasSrc) return false;

  return true;
}
```

Aplicar en el Step 2 del profiler:

```js
// Step 2: Classify elements as slots (ONLY content elements)
for (const el of elements) {
  if (!isContentElement(el)) continue;  // ← NEW
  // ... existing slot classification logic
}
```

### Cambio 2: template-profiler.mjs — Si hay data-slot, IGNORAR elementos sin data-slot

Cuando al menos un elemento en el frame tiene `data-slot`, el profiler debe asumir que el humano hizo el trabajo de marcar slots explícitamente. Los elementos sin `data-slot` se ignoran:

```js
function detectSlots($, html) {
  const allElements = /* parse all elements with class/id */;
  const hasExplicitSlots = allElements.some(el => el.attr('data-slot'));

  if (hasExplicitSlots) {
    // Modo explícito: solo elementos con data-slot
    return allElements.filter(el => el.attr('data-slot')).map(el => ({
      name: el.attr('data-slot'),
      type: classifySlotType(el),
      selector: buildSelector(el),
      ...
    }));
  }

  // Modo automático: comportamiento actual (con el filtro del Cambio 1)
  return allElements.filter(isContentElement).map(el => ({ ... }));
}
```

---

## 📋 Plan de implementación

| Paso | Archivo | Cambio | Tiempo |
|------|---------|--------|--------|
| 1 | `template-profiler.mjs` | Agregar `DECORATIVE_CLASSES`, `CHROME_CLASSES`, `isContentElement()` | 20 min |
| 2 | `template-profiler.mjs` | Agregar modo explícito: si hay `data-slot`, ignorar elementos sin él | 15 min |
| 3 | `template-profiler.mjs` | Aplicar filtro `isContentElement()` en el loop de clasificación | 5 min |
| 4 | `mcp.mjs` | Agregar `data-slot` al HTML de los 11 frames del template de celiacos (tpl_8a398640-78e) | 15 min |
| 5 | Test | Perfilar template → verificar que CSV tiene columnas limpias | 10 min |

**Total: ~1h**

---

## 📎 Templates que necesitan `data-slot`

| Template | Frames | Prioridad |
|----------|--------|-----------|
| `tpl_8a398640-78e` — Celiacos | 11 | P0 (bloquea el test) |
| `tpl_40e666ef-d86` — Colesterol | 11 | P1 |
| `tpl_8b6dd6c5-4f5` — Diabetes | ? | P2 |
| `tpl_fb2684fe-9af` — Carrusel Futuraria | ? | P2 |

**Propuesta:** Hacer los 11 frames de celiacos ahora como proof of concept. Los otros templates se marcan cuando se necesiten.

---

## 🧪 Verificación post-fix

```bash
# 1. Perfilar post-fix
profile_template_pool({ templateIds: ["tpl_8a398640-78e"] })
# Debe devolver ~6 slots con nombres humanos, no 15 con nombres de selectores

# 2. Generar CSV post-fix
generate_csv_template({ templateIds: ["tpl_8a398640-78e"], rowCount: 3 })
# CSV debe tener columnas como: headline, subtitle, stat_1_value, source

# 3. El humano llena 3 filas, aplica
apply_csv_to_frames({ csvData: "...", templateIds: ["tpl_8a398640-78e"] })
# Deben generarse 3 frames nuevos con el contenido del CSV
```
