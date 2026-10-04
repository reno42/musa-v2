# REQ-032 — Buscatrazos real: booleanos client-side + fix extractBBox del MCP

**Fecha:** 2026-09-25
**Síntoma reportado por Ren (dogfood):**
1. Unir círculo + estrella: no se creó una sola figura; la estrella cambió de color, se teletransportó a la esquina superior izquierda y quedó como "grupo" no desagrupable.
2. Sustraer rectángulo de estrella: la estrella saltó a otra posición, el rectángulo desapareció sin restar nada, y restó donde nunca hubo solape — malogró el diseño.

---

## 1. Causa raíz (verificada contra el repo)

### A. `extractBBox` lee mal la posición de SVG — `netlify/functions/mcp.mjs:14000-14006`
```js
if (vbx) {
  const parts = vbx.split(/\s+/);
  return { x: parseFloat(parts[0]) || 0, y: parseFloat(parts[1]) || 0, ... };
}
```
Los dos primeros números del viewBox son el **origen del sistema de coordenadas local**, NO la posición del elemento en el frame. Una estrella con `style="left:300px; top:200px"` se cree que está en (0,0). Eso explica el teletransporte y la resta en el lugar equivocado. Los divs (círculo/rectángulo) resuelven bien via `resolveStyles` — por eso solo los SVG saltan.

### B. "union" no es unión — `mcp.mjs:~14089`
La op union mete **ambos paths originales dentro de un solo `<svg>`** (dos figuras para siempre, imposible de desagrupar porque es una capa única) y pinta **ambos** con `fill = pathA.fill` → el síntoma "solo le cambió el color a la estrella".

### C. El motor booleano real existe y es código muerto
`src/lib/pathBoolean.ts` exporta `sampleShapeRing`, `booleanShapeOp` (polygon-clipping: union/difference/intersection/xor con aplanado de curvas), `ringsToPathD`, `ringsBounds`. Ambas dependencias (`polygon-clipping`, `svg-path-commander` via `pathData.ts`) ya están en package.json. Hoy solo se importa su tipo (`HtmlContextualPanel.tsx:24`).

### D. Los fixes de mask ya hechos en working tree (sin commit) son correctos pero insuficientes
Los cambios sin commit en `mcp.mjs` (mask/clip sobre `<g>` sin transform, XOR por doble mask) arreglan la semántica SVG del mask, pero **no** la geometría de entrada errada por (A).

## 2. Decisión de diseño

- **Operaciones booleanas se calculan CLIENT-SIDE** en `EditorV2.tsx` con el motor existente: geometría exacta en espacio de frame, sin roundtrip, inmune a la carrera de guardado que hoy flush+PUT+GET intenta mitigar.
- **Fix de `extractBBox` en el servidor** para que la tool MCP `pathfinder` también dé posiciones correctas a los agentes IA.

## 3. Items

### Item 1 — `handlePathfinder` client-side en `src/pages/EditorV2.tsx`
REEMPLAZAR el `handlePathfinder` actual (líneas ~3546-3627, el que hace flush PUT + llama a `/mcp` method `pathfinder` + re-GET) por la versión local. No borrar los imports que sigan usándose por otros handlers.

a) Imports: agregar `booleanShapeOp, ringsBounds, ringsToPathD, sampleShapeRing` desde `../lib/pathBoolean` y **`getCssPropertyValue` al import existente de `../lib/cssMutations`** (ya existe en cssMutations.ts:249 — sin él NO compila).

b) Agregar helpers a nivel de módulo (junto a `simpleHash`):

```tsx
function pxValue(value: string): number | null {
  const match = value.match(/^(-?\d+(?:\.\d+)?)px/);
  return match ? parseFloat(match[1]) : null;
}

function inlineStyleValue(el: Element, prop: string): string {
  const style = (el as HTMLElement).style;
  return style ? style.getPropertyValue(prop) : "";
}

function layerBoxValue(el: Element, css: string, layerId: string, prop: string): number | null {
  return pxValue(inlineStyleValue(el, prop))
    ?? pxValue(getCssPropertyValue(css, `[data-layer-id="${layerId}"]`, prop));
}

function roundedRectPath(w: number, h: number, radius: string): string {
  let rx = 0, ry = 0;
  const br = radius.trim();
  if (br.endsWith("%")) {
    const pct = Math.min(50, parseFloat(br) || 0) / 100;
    rx = w * pct; ry = h * pct;
  } else if (br) {
    const pxr = parseFloat(br) || 0;
    rx = Math.min(pxr, w / 2); ry = Math.min(pxr, h / 2);
  }
  return (rx > 0 || ry > 0)
    ? `M${rx},0 H${w - rx} A${rx},${ry} 0 0 1 ${w},${ry} V${h - ry} A${rx},${ry} 0 0 1 ${w - rx},${h} H${rx} A${rx},${ry} 0 0 1 0,${h - ry} V${ry} A${rx},${ry} 0 0 1 ${rx},0 Z`
    : `M0,0 H${w} V${h} H0 Z`;
}

function extractShapeRing(el: Element, css: string): { ring: [number, number][]; fill: string } | null {
  const layerId = el.getAttribute("data-layer-id") || "";
  const kind = el.getAttribute("data-layer-kind");
  if (!layerId || kind === "text" || kind === "group" || kind === "image" || el.tagName.toLowerCase() === "img") return null;
  const tag = el.tagName.toLowerCase();
  let local: [number, number][] | null = null;
  let fill = "#8B5CF6";
  const left = layerBoxValue(el, css, layerId, "left") ?? 0;
  const top = layerBoxValue(el, css, layerId, "top") ?? 0;
  let scaleX = 1, scaleY = 1, originX = 0, originY = 0;

  if (tag === "svg" || tag === "path") {
    const pathEl = tag === "path" ? el : el.querySelector("path");
    const polygonEl = pathEl ? null : el.querySelector("polygon");
    const polygonD = polygonEl
      ? (() => { const pts = (polygonEl.getAttribute("points") || "").trim(); return pts ? `M${pts} Z` : ""; })()
      : "";
    const d = pathEl?.getAttribute("d") || polygonD;
    if (!d) return null;
    local = sampleShapeRing(d);
    fill = pathEl?.getAttribute("fill") || polygonEl?.getAttribute("fill") || fill;
    const vb = (el.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
    if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) {
      originX = vb[0]; originY = vb[1];
      const w = layerBoxValue(el, css, layerId, "width");
      const h = layerBoxValue(el, css, layerId, "height");
      scaleX = w && w > 0 ? w / vb[2] : 1;
      scaleY = h && h > 0 ? h / vb[3] : 1;
    }
  } else {
    const w = layerBoxValue(el, css, layerId, "width");
    const h = layerBoxValue(el, css, layerId, "height");
    if (!w || !h) return null;
    const br = inlineStyleValue(el, "border-radius")
      || getCssPropertyValue(css, `[data-layer-id="${layerId}"]`, "border-radius");
    local = sampleShapeRing(roundedRectPath(w, h, br));
    fill = inlineStyleValue(el, "background-color")
      || getCssPropertyValue(css, `[data-layer-id="${layerId}"]`, "background-color")
      || getCssPropertyValue(css, `[data-layer-id="${layerId}"]`, "background")
      || fill;
  }
  if (!local || local.length < 3) return null;
  return {
    ring: local.map(([x, y]) => [left + (x - originX) * scaleX, top + (y - originY) * scaleY] as [number, number]),
    fill,
  };
}
```

c) Nuevo `handlePathfinder` (reemplaza el async actual; ya no es async):

```tsx
const handlePathfinder = useCallback((op: "union" | "subtract" | "intersect" | "exclude") => {
  if (!selectedFrameId || multiSelectLayerIds.length < 2) return;
  const frame = framesRef.current.find(f => f.id === selectedFrameId);
  if (!frame) return;
  try {
    const doc = new DOMParser().parseFromString(frame.html || "", "text/html");
    const shapes: { id: string; ring: [number, number][]; fill: string; node: Element }[] = [];
    for (const layerId of multiSelectLayerIds) {
      const node = doc.querySelector(`[data-layer-id="${layerId}"]`);
      if (!node) continue;
      const geometry = extractShapeRing(node, frame.css || "");
      if (!geometry) {
        addToast("Buscatrazos: solo figuras con relleno — no textos, grupos ni imágenes.", "error");
        return;
      }
      shapes.push({ id: layerId, ...geometry, node });
    }
    if (shapes.length < 2) {
      addToast("Buscatrazos: no encontré las figuras seleccionadas.", "error");
      return;
    }

    const rings = booleanShapeOp(op, shapes.map(s => [s.ring]));
    if (!rings || rings.length === 0) {
      addToast(`Buscatrazos: ${op} no produce ninguna figura (¿las formas se tocan?).`, "error");
      return;
    }
    const bounds = ringsBounds(rings);
    if (!bounds) return;
    const [minX, minY, maxX, maxY] = bounds;
    const width = Math.max(1, Math.round((maxX - minX) * 100) / 100);
    const height = Math.max(1, Math.round((maxY - minY) * 100) / 100);

    // El relleno sigue la capa más arriba en el HTML (convención Illustrator).
    const frameHtml = frame.html || "";
    const ordered = [...shapes].sort((a, b) =>
      frameHtml.indexOf(`data-layer-id="${a.id}"`) - frameHtml.indexOf(`data-layer-id="${b.id}"`));
    const topmost = ordered[ordered.length - 1];
    const local = rings.map(ring => ring.map(([x, y]) => [
      Math.round((x - minX) * 100) / 100,
      Math.round((y - minY) * 100) / 100,
    ] as [number, number]));

    const newLayerId = createLayerId();
    const opName = op.charAt(0).toUpperCase() + op.slice(1);
    const newHtml = `<svg data-layer-id="${newLayerId}" data-layer-name="${opName}" data-layer-kind="svg" viewBox="0 0 ${width} ${height}" style="position:absolute;left:${minX}px;top:${minY}px;width:${width}px;height:${height}px;overflow:visible;"><path d="${ringsToPathD(local)}" fill="${topmost.fill}" fill-rule="evenodd"/></svg>`;

    for (const shape of shapes) shape.node.remove();
    const updatedFrameHtml = doc.body.innerHTML + "\n" + newHtml;
    const updatedFrameCss = removeLayersCss(frame.css || "", shapes.map(s => s.id))
      + `\n[data-layer-id="${newLayerId}"] {\n  position: absolute;\n  left: ${minX}px;\n  top: ${minY}px;\n  width: ${width}px;\n  height: ${height}px;\n  overflow: visible;\n}\n`;

    const updated = framesRef.current.map(f =>
      f.id === selectedFrameId ? { ...f, html: updatedFrameHtml, css: updatedFrameCss } : f
    );
    store.replaceAllWithUndo(updated, "edit");
    autoSave(updated);
    setMultiSelectLayerIds([]);
    handleSelectLayerElement(selectedFrameId, newLayerId);
    addToast(op === "subtract"
      ? `Sustraer: ${shapes[0].id === shapes[0].id ? "" : ""}resta a la PRIMERA figura seleccionada. ${shapes.length} figuras combinadas en una.`
      : `${opName}: ${shapes.length} figuras combinadas en una.`, "success");
  } catch (err: any) {
    addToast(`Buscatrazos falló: ${err?.message || "error desconocido"}`, "error");
    setMultiSelectLayerIds([]);
  }
}, [selectedFrameId, multiSelectLayerIds, autoSave, addToast, handleSelectLayerElement]);
```

NOTA para el implementer: el toast de subtract arriba tiene un ternero basura (`shapes[0].id === shapes[0].id`) — simplifícalo a texto plano: `Sustraer: resta a la PRIMERA figura seleccionada. N figuras combinadas en una.`

Verificar que `removeLayersCss` esté en el import de cssMutations (ya está, línea 83). Los atajos Ctrl+Alt+U/S/I/E (~líneas 4294-4297) no cambian.

### Item 2 — Fix `extractBBox` en `netlify/functions/mcp.mjs:14000-14006`
Reemplazar el cuerpo que devuelve el origen del viewBox por:

```js
function extractBBox($svg) {
  // viewBox 1-2 son el origen del espacio LOCAL, no la posición en el frame —
  // devolverlos teletransportaba todo SVG a la esquina (0,0) en pathfinder.
  const style = $svg.attr("style") || "";
  const vbx = $svg.attr("viewBox");
  const resolved = resolveStyles($svg, cssRules);
  const pxNum = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const inlinePx = (prop) => {
    const m = style.match(new RegExp(`(?:^|;)\\s*${prop}:\\s*(-?[\\d.]+)px`));
    return m ? parseFloat(m[1]) : null;
  };
  const vbParts = vbx ? vbx.split(/\s+/).map(parseFloat) : [];
  return {
    x: inlinePx("left") ?? pxNum(resolved["left"]) ?? 0,
    y: inlinePx("top") ?? pxNum(resolved["top"]) ?? 0,
    w: inlinePx("width") ?? pxNum(resolved["width"]) ?? (Number.isFinite(vbParts[2]) ? vbParts[2] : 100),
    h: inlinePx("height") ?? pxNum(resolved["height"]) ?? (Number.isFinite(vbParts[3]) ? vbParts[3] : 100),
  };
}
```

OJO: `cssRules` está definida DESPUÉS de `extractBBox` en el archivo (línea ~14027: `const cssRules = parseCssRules(frame.css || "")`). Verificar el orden de declaración — si `extractBBox` se invoca solo dentro de `geometryFromDiv`/post-declaración, funciona por hoisting de función; si no, mover la declaración de `cssRules` antes de `extractBBox`. Confirmar con lectura, no asumir.

### Item 3 — Higiene de commit (OBLIGATORIO, en este orden)
El working tree ya tiene 137 líneas sin commit en `mcp.mjs`: los fixes de mask/clip/XOR en el case pathfinder + una tool `set_pattern_fill` no relacionada. Para no mezclar tres cambios:

1. Commit A (primero, SOLO lo que ya está): los fixes de mask `<g>`/doble-mask/XOR del case `pathfinder` + `set_pattern_fill` (MCP_TOOLS ~línea 4188 y su handler ~17452). Mensaje: `fix(mcp): pathfinder mask user-space + xor, add set_pattern_fill tool`. IMPORTANTE: este commit incluye el ARREGLO PREVIO de la herramienta; el fix del Item 2 va en el commit C para que quede trazable por separado.
2. Commit B: Item 1 (EditorV2). Mensaje: `feat(editor): real client-side pathfinder booleans via pathBoolean engine`.
3. Commit C: Item 2 (extractBBox). Mensaje: `fix(mcp): extractBBox reads real layer position, not viewBox origin`.
4. NO pushear. NO tocar sdkconfig/package.json/lockfiles. Si `npx tsc` exige algo más, es Scope creep: reportar, no improvisar.

### Item 4 — Verificación (evidencia citada, no "debería funcionar")
1. `npx tsc` → exit 0.
2. Test unitario rápido (script node o vitest si existe infra): construir dos anillos que se solapan (rect 0,0,100x100 y estrella aproximada en 50,50) y verificar `booleanShapeOp("subtract")` devuelve anillo con área < rect. Guardar en `QA/pathfinder-boolean.test.*` siguiendo el patrón de los tests QA existentes (`QA/ghost-preflight.test.mjs`).
3. Grep: `grep -n "viewBox" netlify/functions/mcp.mjs | grep -n "parts\[0\]"` → 0 resultados en extractBBox.
4. Reportar qué NO se probó: build de prod y prueba visual en el editor (requiere deploy — decisión de Ren).

## 5. Fuera de alcance
- Shapes rotadas/skeweadas antes de combinar (no se transforman a espacio de frame — declarado; feedback con toast si ocurre queda para un REQ futuro).
- Strokes: los booleanos operan sobre fills; los strokes de las fuentes se pierden (convención aceptada, igual que el motor actual).
- El flujo de guardado (PUT flush + re-GET) que el handlePathfinder viejo hacía: eliminarlo es parte del fix; NO refactorizar autoSave.

## 6. PROMPT DEL AGENTE IDE (copiar tal cual)

```
Trabajas en el repo C:/Users/Renzo/.openclaw/workspace/design-main, rama actual. Lee primero docs/requirements/REQ-032-buscatrazos-booleanos-client-side.md COMPLETO — es tu spec. Un item = un commit en el orden del Item 3 (A: higiene de lo ya existente sin commit en mcp.mjs, B: EditorV2, C: extractBBox). Verificación del Item 4 con evidencia citada (comandos + salidas exactas). NO pushees. NO toques archivos fuera del scope. Si algo no cuadra con la spec, para y reporta en vez de asumir. Reporta: commits (hash + mensaje), salida de tsc, resultado del test de booleanos, y el grep del Item 4.3.
```
