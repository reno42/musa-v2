# HTML Design Engine — Infinite Canvas Architecture

## Overview

The HTML editor (EditorV2) has been transformed from a single-page "code-to-web viewer" into a **Figma-like multi-frame design tool** using the "infinite desk" metaphor:

- **Infinite canvas** = the desk (pan/zoom)
- **Frames** = papers placed on the desk (each with specific dimensions)
- **Design** happens within each frame using HTML/CSS
- **Bidirectional sync**: drag elements → CSS updates; edit code → DOM updates visually

## Architecture

```
EditorV2 (orchestrator / state owner)
├── HtmlToolbar (general tools: Select, Hand, frame presets, zoom)
├── InsertToolbar (HTML element insertion — existing)
├── CodePanel (HTML/CSS code editor — existing)
├── InfiniteHtmlCanvas (the desk: pan/zoom viewport)
│   └── DesignFrame[] (each "paper": Shadow DOM + interaction overlay)
└── HtmlContextualPanel (contextual tools: typography, color, spacing, layout)
```

## Data Model

### FrameData (core unit)
```typescript
interface FrameData {
  id: string;
  name: string;
  x: number;        // position on canvas
  y: number;
  width: number;    // frame dimensions (e.g. 1080×1080)
  height: number;
  html: string;     // HTML content inside frame
  css: string;      // CSS styles for this frame
  background: string;
}
```

### SelectedElementInfo (element selection context)
```typescript
interface SelectedElementInfo {
  layerId: string;
  tag: string;
  selector: string;     // CSS selector (data-layer-id > #id > .class > tag)
  computedStyles: Record<string, string>;
  frameId: string;
}
```

## Components

### 1. EditorV2 (`src/pages/EditorV2.tsx`)
**Role**: Top-level orchestrator. Owns all state.

**Key state**:
- `frames: FrameData[]` — all frames on the canvas
- `selectedFrameId` — active frame
- `activeTool: "select" | "hand"` — current tool
- `zoom: number` — canvas zoom level
- `selectedElement: SelectedElementInfo | null` — selected DOM element
- `undoStack / redoStack` — JSON snapshots for undo/redo (max 50)

**Key flows**:
- **Load template**: Parses `frames[]` array from API, or converts legacy single html/css to one frame
- **Auto-save**: Debounced 2s, saves both `frames[]` and backward-compat `html`/`css`
- **Keyboard shortcuts**: V=select, H=hand, Ctrl+Z=undo, Ctrl+Shift+Z=redo, Del=delete frame, Ctrl+D=duplicate

### 2. InfiniteHtmlCanvas (`src/components/InfiniteHtmlCanvas.tsx`)
**Role**: The "desk" — infinite pannable/zoomable viewport holding all frames.

**Pan**: Middle-click (always), Hand tool + left-click, or trackpad two-finger
**Zoom**: Scroll wheel (zooms toward cursor position)
**Frame drag**: Select tool + mousedown on frame → tracks mouse delta → calls `onFrameMove`

**Transform**: CSS `translate(pan.x, pan.y) scale(zoom)` on a wrapper div.

### 3. DesignFrame (`src/components/DesignFrame.tsx`)
**Role**: A single "paper" on the desk. Renders HTML/CSS in Shadow DOM with interaction overlay.

**Three-layer architecture**:
1. **Shadow DOM**: `<style>` element + `<div id="__df_content">` with innerHTML — fully CSS-isolated
2. **Interaction overlay**: Absolutely positioned div on top of content for selection boxes and resize handles
3. **Sync engine**: Bidirectional code↔DOM sync with lock flags

**Interaction handlers**:
- `mousedown` on element → select (shows blue border + corner handles)
- `mousedown` + `mousemove` on selected element → drag (sets `position: absolute`, updates `left`/`top`)
- `mousedown` on corner handle + `mousemove` → resize (updates `width`/`height`)
- `mouseup` after drag/resize → updates CSS string via `updateCssRule()` → calls `onCssChange`

**CSS sync**:
- **Code → DOM**: `useEffect` on `frame.css` updates `<style>` textContent + font imports
- **DOM → Code**: After drag/resize, `updateCssRule()` modifies the CSS string and calls `onCssChange`
- **Sync lock**: `syncLockRef` flag prevents infinite loop (DOM→Code sets flag, Code→DOM checks and skips)

**Font loading**: `extractFontImports()` parses `@import url(...)` from CSS, injects `<link>` elements into Shadow DOM.

### 4. HtmlToolbar (`src/components/HtmlToolbar.tsx`)
**Role**: General tools toolbar (always visible).

**Tools**:
- Undo / Redo buttons
- Select (V) — grab/move frames and elements
- Hand (H) — pan the canvas
- Frame presets: IG Square (1080×1080), IG Story (1080×1920), IG Feed (1080×1350), Banner (1920×1080), Twitter (1200×628)
- Zoom In / Out / Fit + percentage display

### 5. HtmlContextualPanel (`src/components/HtmlContextualPanel.tsx`)
**Role**: Contextual tools panel — appears when an element is selected inside a frame.

**Sections** (collapsible):
- **Typography**: font-family, font-size, font-weight, text-align, letter-spacing, line-height, text-decoration, text-transform
- **Color**: text color picker, background color picker, opacity slider
- **Spacing**: margin (4 sides), padding (4 sides), border, border-radius
- **Layout**: display mode (flex/block/grid/inline), width, height, gap

Each change modifies the CSS string via `updateCssProperty()` utility and triggers re-render.

## Bidirectional Sync Flow

### Code → Visual (user edits code)
```
CodePanel onChange → handleCssChange(frames) → React re-render
→ DesignFrame useEffect(frame.css) → shadow <style>.textContent = newCss
→ Visual update in frame
```

### Visual → Code (user drags/resizes element)
```
DesignFrame mousedown+mousemove → DOM style change (left/top/width/height)
→ mouseup → syncLockRef = true
→ updateCssRule(cssString, selector, {position, left, top})
→ onCssChange(frameId, updatedCss)
→ EditorV2 handleFrameCssChange → frames state update
→ CodePanel receives new CSS prop
→ syncLockRef prevents redundant DOM update
```

### Contextual Panel → Both
```
HtmlContextualPanel onChange → updateCssProperty(css, selector, prop, value)
→ handleContextualCssChange → handleCssChange → frames update
→ CodePanel shows updated CSS + DesignFrame Shadow DOM updates
```

## Frame Presets

| Name | Width | Height | Use Case |
|------|-------|--------|----------|
| IG Square | 1080 | 1080 | Instagram square post |
| IG Story | 1080 | 1920 | Instagram/Reels story |
| IG Feed | 1080 | 1350 | Instagram portrait post |
| Banner | 1920 | 1080 | Web banner / hero |
| Twitter | 1200 | 628 | Twitter/X card |

## Backward Compatibility

Templates saved before multi-frame support are auto-converted:
- Legacy `{ html, css, width, height }` → single `FrameData` with `id: "frame_0"`
- On save, both `frames[]` array AND `html`/`css` fields are sent (active frame's content)

## File Manifest

| File | Lines | Purpose |
|------|-------|---------|
| `src/pages/EditorV2.tsx` | ~625 | Orchestrator: state, undo/redo, load/save, layout |
| `src/components/DesignFrame.tsx` | ~396 | Shadow DOM frame + interaction + CSS sync |
| `src/components/InfiniteHtmlCanvas.tsx` | ~221 | Pan/zoom viewport holding frames |
| `src/components/HtmlToolbar.tsx` | ~121 | General tools toolbar |
| `src/components/HtmlContextualPanel.tsx` | ~386 | Contextual element properties panel |

## Next Steps (future sprints)

1. **Multi-element drag**: Currently only one element can be selected/dragged at a time
2. **Snap/guides**: Smart alignment guides when dragging elements
3. **Layer reordering**: Drag layers in StructurePanel to reorder DOM z-index
4. **Group selection**: Shift+click to select multiple elements
5. **Copy/paste elements**: Ctrl+C/V to duplicate selected elements within a frame
6. **AI multi-frame generation**: MCP tools to generate carousels with multiple frames side by side
7. **Real-time collaboration cursors**: Show other users' cursors on the canvas
