# 🐛 BUG: Drag/Resize changes lost on page reload

## Severity: P0 — Data loss
Changes made by dragging or resizing elements are lost when the page is reloaded.

---

## 🔍 Root Cause Analysis

### The core problem: CSS saved, HTML not synced

When a user drags an element inside a frame, the `onDragUp` handler in `DesignFrame.tsx`:

1. ✅ Updates `target.style.left` and `target.style.top` in the DOM (inline styles)
2. ✅ Updates the CSS rule via `updateCssRule()` and saves it to frame CSS
3. ✅ Calls `onCssChangeRef.current(frame.id, newCss)` → triggers `handleFrameCssChange` → saves to localStorage + API
4. ❌ **Never updates the frame's `html` property** to reflect the new inline styles

On page reload:
- Frame HTML is re-injected into the Shadow DOM with **original inline styles** (e.g., `style="left:50px;top:100px"`)
- Frame CSS is applied with the **updated positions**
- **Inline styles have higher specificity than CSS** → the element reverts to its original position

### Why it works during the same session
React's `useEffect` for HTML (`[frame.html]`) only runs when the `html` string changes. Since drags only update CSS, the HTML isn't re-injected into the DOM during the session. The element stays at the dragged position because the DOM was mutated directly.

### Same bug affects resize
The resize handler (line ~691 in `DesignFrame.tsx`) has the identical pattern.

---

## ⚠️ Rejected: Naive 2-line fix (stale closure race)

The obvious fix — calling `onHtmlChangeRef` after `onCssChangeRef` — **fails** due to a stale closure race:

```typescript
// ❌ BROKEN
onCssChangeRef.current?.(frame.id, updated);       // → handleFrameCssChange → setFrames(css-updated)
onHtmlChangeRef.current?.(frame.id, content.innerHTML); // → handleFrameHtmlChange → setFrames(html-updated)
```

Both `handleFrameCssChange` and `handleFrameHtmlChange` are `useCallback` closures that capture the same `frames` snapshot. In React 18's automatic batching, the second `setFrames` **overwrites the CSS update**, losing the position change entirely.

```
handleFrameCssChange: setFrames(frames.map(f => ...css...))   // queued
handleFrameHtmlChange: setFrames(frames.map(f => ...html...)) // overwrites above → CSS lost!
```

---

## ✅ Correct Fix: Extend `onCssChange` with optional `newHtml`

**Strategy:** Update both CSS and HTML in a **single `setFrames` call** to avoid the race. Pass `content.innerHTML` as an optional third parameter to the existing CSS callback.

### Changes (5 lines across 3 files)

#### 1. `DesignFrame.tsx` — prop type (~line 36)

```typescript
// BEFORE
onCssChange?: (frameId: string, newCss: string) => void;

// AFTER
onCssChange?: (frameId: string, newCss: string, newHtml?: string) => void;
```

#### 2. `DesignFrame.tsx` — onDragUp (~line 524)

```typescript
// BEFORE
onCssChangeRef.current?.(frame.id, updated);

// AFTER
onCssChangeRef.current?.(frame.id, updated, content.innerHTML);
```

#### 3. `DesignFrame.tsx` — resize onUp (~line 691)

```typescript
// BEFORE
onCssChangeRef.current?.(frame.id, updated);

// AFTER
onCssChangeRef.current?.(frame.id, updated, content.innerHTML);
```

#### 4. `InfiniteHtmlCanvas.tsx` — prop type (~line 25)

```typescript
// BEFORE
onFrameCssChange?: (frameId: string, newCss: string) => void;

// AFTER
onFrameCssChange?: (frameId: string, newCss: string, newHtml?: string) => void;
```

#### 5. `EditorV2.tsx` — handleFrameCssChange (~line 429)

```typescript
// BEFORE
const handleFrameCssChange = useCallback((frameId: string, newCss: string) => {
  console.error("[FRAME-CSS] handleFrameCssChange entry", { frameId, cssLen: newCss.length });
  const updated = frames.map(f =>
    f.id === frameId ? { ...f, css: newCss } : f
  );
  pushUndo(frames);
  setFrames(updated);
  autoSave(updated);
}, [frames, autoSave, pushUndo]);

// AFTER
const handleFrameCssChange = useCallback((frameId: string, newCss: string, newHtml?: string) => {
  console.error("[FRAME-CSS] handleFrameCssChange entry", { frameId, cssLen: newCss.length, hasHtml: !!newHtml });
  const updated = frames.map(f => {
    if (f.id !== frameId) return f;
    const patch: any = { ...f, css: newCss };
    if (newHtml !== undefined) patch.html = newHtml;
    return patch;
  });
  pushUndo(frames);
  setFrames(updated);
  autoSave(updated);
}, [frames, autoSave, pushUndo]);
```

---

## 🧪 Verification after fix

1. Open editor at `https://design.futuraria.com/?template=tpl_1f3bf18a-670&v=2`
2. Drag an element inside any frame
3. Verify console shows `[SAVE] ✓ API PUT OK`
4. Reload the page (Ctrl+Shift+R)
5. **Element should stay at the dragged position** (not revert)
6. Test resize as well
7. Verify localStorage and API both have updated `html` in the frame

---

## 📊 Impact
- **Lines changed:** ~10 (5 locations)
- **Files changed:** 3 (`DesignFrame.tsx`, `InfiniteHtmlCanvas.tsx`, `EditorV2.tsx`)
- **New APIs/callbacks:** 0 (extends existing signature)
- **Backward compatibility:** ✅ — `newHtml` is optional, existing callers with 2 args still work
- **Risk:** Minimal. The `autoSave` debounce handles rapid-fire events. Undo captures pre-change state correctly (single `pushUndo` + single `setFrames`).

---

## 🔗 Reference: How other editors handle this

**GrapesJS approach:** Component model layer is the source of truth. All mutations go through the model, which then re-renders the DOM. DOM is never mutated directly — it's a read-only view.

**Our approach (hybrid):** We mutate the DOM directly (for real-time interactivity during drag), then sync back to the model. This requires both CSS AND HTML to be synced in a single atomic update.

The bug was that only CSS was synced, not HTML. The naive fix has a stale closure race. **Extending the callback with an optional parameter eliminates the race by keeping CSS+HTML in one `setFrames`.**
