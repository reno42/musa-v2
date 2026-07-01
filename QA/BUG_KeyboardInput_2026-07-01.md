# 🐛 BUG: Keyboard input inconsistente — spacebar/nudge no persiste

## Severity: P1 — UX degradado
Pulsaciones rápidas de teclado no se registran consistentemente. 5 pulsaciones → solo 3 se graban.

---

## 🔍 Root Cause Analysis

### Hallazgo 1: No existe handler de teclado para nudge

El editor **no tiene implementado** movimiento de elementos por teclado (ArrowLeft/Right/Up/Down). El único input de teclado que existe está en `EditorV2.tsx:795-831`:

```
C:\Users\Renzo\.openclaw\workspace\design-main\src\pages\EditorV2.tsx
```

Solo maneja:
- Tool switching: V, H, R, O, T, P (línea 812-818)
- Undo/Redo: Ctrl+Z / Ctrl+Shift+Z (líneas 805-806)
- Delete/Backspace (línea 819-826)
- Escape para cerrar dropdowns (línea 799)

### Hallazgo 2: "Space+Drag → Pan canvas" documentado pero NO implementado

`KeyboardShortcuts.tsx:70` documenta `{ keys: "Space+Drag", description: "Pan canvas" }` pero **no hay código que lo maneje**. Ni en `EditorV2.tsx`, ni en `InfiniteHtmlCanvas.tsx`, ni en `FloatingToolbar.tsx`. El hand tool solo se activa con tecla "H" o clic en toolbar.

### Hallazgo 3: contentEditable + whitespace = inconsistencia

Si Ren está editando texto (doble-clic → contentEditable), cada spacebar inserta un espacio literal en el DOM. El save ocurre SOLO en blur:

```
DesignFrame.tsx:555-570 — onBlur handler
```

**Problema de whitespace en HTML:**
- El navegador colapsa espacios consecutivos en HTML renderizado
- Si escribís `"Hola     mundo"` (5 espacios), `textContent` devuelve `"Hola     mundo"` ✓
- `handleTextChange` (EditorV2.tsx:665) reemplaza el texto con regex
- Pero al reinyectar el HTML vía `content.innerHTML = frame.html`, **el navegador colapsa los espacios** → solo se ven ~1-3 espacios
- Esto NO es un bug de save, es un bug de **renderizado de whitespace**

### Hallazgo 4: Posible race condition en ráfagas de save

```
C:\Users\Renzo\.openclaw\workspace\design-main\src\pages\EditorV2.tsx
handleFrameCssChange: línea 429
autoSave: línea ~230
```

Cuando múltiples eventos de teclado disparan saves en rápida sucesión:
1. `handleFrameCssChange` usa `frames` del closure de `useCallback` (línea 429)
2. React 18 batea múltiples `setFrames` → solo sobrevive el último
3. `autoSave` tiene debounce de 2s → solo se ejecuta el último
4. localStorage se escribe en cada llamada (síncrono) → el último valor persiste

Esto NO debería causar pérdida de datos si el CSS se computa correctamente del DOM (porque cada nudge lee la posición actual del elemento). Pero **si hay un contentEditable involucrado**, el `textContent` puede verse afectado por el colapso de whitespace del navegador.

---

## 🎯 Diagnóstico más probable

Si Ren está usando **doble-clic para editar texto** y presionando spacebar para agregar espacios:

1. contentEditable → cada spacebar inserta espacio en DOM
2. Browser colapsa espacios consecutivos en el elemento editable (comportamiento nativo)
3. Al blur → `textContent` captura menos espacios de los esperados
4. El save persiste correctamente, pero **lo que se guardó ya tenía los espacios colapsados**

**Solución recomendada:** Agregar `white-space: pre-wrap` al elemento durante contentEditable + guardarlo así en el CSS.

---

## 📋 Acciones recomendadas para el agente IDE

### 1. Implementar nudge por teclado (Arrow keys)

Agregar en `EditorV2.tsx` (dentro del handler de teclado línea ~810):

```typescript
// Arrow keys → nudge selected element by 1px (10px with Shift)
case "arrowleft":
case "arrowright":
case "arrowup":
case "arrowdown":
  if (selectedElement) {
    e.preventDefault();
    const delta = e.shiftKey ? 10 : 1;
    // ... trigger nudge on the selected element
  }
  break;
```

Referencia: **Figma** usa Arrow keys para nudge 1px, Shift+Arrow para 10px. **Penpot** (open-source, `github.com/penpot/penpot`) hace lo mismo con `move-selected` commands.

### 2. Implementar Space+Drag para pan

Agregar en `EditorV2.tsx` handler de teclado:
```typescript
if (e.key === " " && !isInput) {
  e.preventDefault();
  setActiveTool("hand");
  // Al soltar space, volver al tool anterior
}
```

### 3. Fix whitespace en contentEditable

En `DesignFrame.tsx`, al activar contentEditable (~línea 553), agregar al estilo del target:
```typescript
target.style.whiteSpace = "pre-wrap";
```
Y removerlo en blur (~línea 557).

Esto previene que el navegador colapse espacios consecutivos durante la edición.

---

## 🧪 Verificación

1. Doble-clic en texto → presionar spacebar 5 veces → clic fuera → reload
2. **Los 5 espacios deben persistir** con `white-space: pre-wrap`
3. Arrow keys deben mover elementos seleccionados 1px/10px
4. Space debe activar pan mode temporalmente

---

## 🔗 Referencias

- **Penpot keyboard handling:** `github.com/penpot/penpot` — usa `common/src/app/main/ui/workspace/shortcuts.cljs`
- **Figma keyboard shortcuts:** `help.figma.com/hc/en-us/articles/360040328653-Keyboard-shortcuts`
- **contentEditable whitespace issue:** Conocido en Chrome/Firefox — los espacios consecutivos se colapsan a menos que `white-space: pre-wrap` esté activo
- **React batching & stale closures:** `react.dev/learn/state-as-a-snapshot` — explica por qué callbacks ven snapshots viejos del state
