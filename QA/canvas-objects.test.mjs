import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  findCanvasObjectPosition,
  findFrameContainingCanvasRect,
  normalizeCanvasObject,
  resizeCanvasObjectBounds,
  rotationDegreesFromTransform,
  rotationFromPointer,
  toFrameLocalBounds,
} from "../src/lib/canvasObjects.ts";
import {
  DESIGN_CLIPBOARD_KEY,
  persistDesignClipboard,
  readDesignClipboard,
} from "../src/lib/designClipboard.ts";
import { updateTemplateSchema } from "../api/src/middleware/validate.ts";
import { createDocumentStore } from "../src/lib/documentStore.ts";

test("normalizes root objects with null frame ownership for data synchronization", () => {
  const object = normalizeCanvasObject({
    id: "copy",
    name: "Copy",
    html: '<p data-layer-kind="text">Draft</p>',
    css: "",
    x: 20,
    y: 30,
    width: 240,
    height: 60,
  }, 0);

  assert.equal(object.frameId, null);
  assert.equal(object.kind, "text");
  assert.equal(object.name, "Copy");
});

test("places imported root objects beyond frames and existing canvas objects", () => {
  const position = findCanvasObjectPosition(
    [{ x: 0, y: 40, width: 1080, height: 1080 }],
    [{ x: 1280, y: 100, width: 300, height: 200 }],
  );

  assert.deepEqual(position, { x: 1680, y: 40 });
});

test("resizes root objects from every edge while keeping the opposite edge fixed", () => {
  assert.deepEqual(
    resizeCanvasObjectBounds({ x: 100, y: 80, width: 200, height: 120 }, "se", 30, 20),
    { x: 100, y: 80, width: 230, height: 140 },
  );
  assert.deepEqual(
    resizeCanvasObjectBounds({ x: 100, y: 80, width: 200, height: 120 }, "nw", 40, 30),
    { x: 140, y: 110, width: 160, height: 90 },
  );
  assert.deepEqual(
    resizeCanvasObjectBounds({ x: 100, y: 80, width: 200, height: 120 }, "w", 500, 0),
    { x: 292, y: 80, width: 8, height: 120 },
  );
});

test("computes visual root rotation without discarding an existing angle", () => {
  assert.equal(rotationDegreesFromTransform("scaleX(-1) rotate(30deg)"), 30);
  assert.equal(
    Math.round(rotationFromPointer(
      { x: 100, y: 100 },
      { x: 100, y: 50 },
      { x: 150, y: 100 },
      30,
    )),
    120,
  );
});

test("converts the painted bbox to frame-local coordinates at the active zoom", () => {
  assert.deepEqual(
    toFrameLocalBounds(
      { left: 300, top: 220, width: 240, height: 120 },
      { left: 100, top: 100 },
      2,
    ),
    { x: 100, y: 60, width: 120, height: 60 },
  );
});

test("finds the frame that fully contains a canvas-space rect", () => {
  const frames = [
    { id: "a", x: 0, y: 0, width: 1080, height: 1080 },
    { id: "b", x: 1200, y: 0, width: 400, height: 300 },
  ];

  assert.equal(findFrameContainingCanvasRect(frames, { x: 1250, y: 50, width: 100, height: 80 })?.id, "b");
  // Straddling the frame edge → no owner (creation defaults outside).
  assert.equal(findFrameContainingCanvasRect(frames, { x: 1150, y: 50, width: 100, height: 80 }), null);
  // Edge-aligned counts as contained (1px tolerance).
  assert.equal(findFrameContainingCanvasRect(frames, { x: 1200, y: 0, width: 400, height: 300 })?.id, "b");
  assert.equal(findFrameContainingCanvasRect(frames, { x: 1200.5, y: 0, width: 399, height: 299.5 })?.id, "b");
  // Degenerate rects own nothing.
  assert.equal(findFrameContainingCanvasRect(frames, { x: 1250, y: 50, width: 0, height: 80 }), null);
});

test("excludes the source frame when routing a dragged layer to a new owner", () => {
  const frames = [
    { id: "a", x: 0, y: 0, width: 100, height: 100 },
    { id: "b", x: 150, y: 0, width: 100, height: 100 },
  ];

  // A rect only inside the source frame must not re-enter it...
  assert.equal(findFrameContainingCanvasRect(frames, { x: 10, y: 10, width: 40, height: 40 }, "a"), null);
  // ...but still resolves when nothing is excluded.
  assert.equal(findFrameContainingCanvasRect(frames, { x: 10, y: 10, width: 40, height: 40 })?.id, "a");
});

test("wires orphan-text creation and frame containment through the editor", async () => {
  const editor = await readFile(new URL("../src/pages/EditorV2.tsx", import.meta.url), "utf8");
  const designFrame = await readFile(new URL("../src/components/DesignFrame.tsx", import.meta.url), "utf8");
  const canvas = await readFile(new URL("../src/components/InfiniteHtmlCanvas.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../src/components/HtmlContextualPanel.tsx", import.meta.url), "utf8");

  assert.match(editor, /const handleCreateOrphanText = useCallback/);
  assert.match(editor, /onCreateOrphanText=\{handleCreateOrphanText\}/);
  assert.match(editor, /findFrameContainingCanvasRect\(framesRef\.current, canvasBox, frameId\)/);
  assert.match(editor, /inferCanvasObjectKind\(extracted\.layerHtml\)/);
  assert.match(editor, /const targetFrameId = frameId \?\? selectedFrameId;/);
  assert.match(designFrame, /onCreateOrphanTextRef\.current\?\.\(Math\.round\(frame\.x \+ bx\)/);
  assert.match(designFrame, /"text", Math\.round\(startX\), Math\.round\(startY\), undefined, frame\.id\)/);
  // Frame resize must rewrite the shadow clip rule (bug: grown frames kept clipping).
  assert.match(designFrame, /width: \$\{frame\.width\}px.*mapBodySelectors\(cssRef\.current\)/);
  assert.match(designFrame, /\[frame\.width, frame\.height\]\);/);
  assert.match(canvas, /onCreateOrphanFromTool\?\.\(activeTool, Math\.round\(start\.x\), Math\.round\(start\.y\), 0, 0\)/);
  assert.match(canvas, /onCreateOrphanText=\{onCreateOrphanText\}/);
  // Creating text must land the contextual panel on it (the font picker is
  // only rendered while rightPanelTab === "contextual").
  assert.match(editor, /if \(type === "text"\) \{\s*\n\s*setAutoEditOrphanId\(orphanId\);[\s\S]*?setRightPanelTab\("contextual"\);/);
  const panelPins = editor.match(/setRightPanelTab\("contextual"\);\s*\n\s*setContextualSubTab\("properties"\);/g) || [];
  assert.ok(panelPins.length >= 3, `expected the 3 text-creation paths to pin the contextual panel, got ${panelPins.length}`);
  // Auto-edit must retry past the shadow patch race AND emit the selection
  // (the emission is what points the panel at the new text).
  assert.match(designFrame, /enterTextEditMode\(el\);\s*\n\s*selectElement\(el\);/);
  assert.match(designFrame, /if \(\+\+tries > 30\) \{ onAutoEditHandled\?\.\(\); return; \}/);
  // Typography must never die silently: the rich-text registry is keyed by
  // FRAME id, so orphan texts (synthetic element, frameId = orphan id) and
  // dead registrations must fall back to the CSS branch instead of a no-op `?.`.
  assert.match(panel, /const richCall = element\.layerKind === "text" \? frameRichTextRegistry\.get\(element\.frameId\) : undefined;/);
  assert.match(panel, /console\.warn\("\[typography\] text layer sin rich-text registry/);
  assert.match(panel, /update\(element\.selector, property, value\);/);
  assert.match(designFrame, /console\.warn\("\[rich-text\] registry callback sin root"/);
  // Panel popovers: cards inside a PanelPopup must NOT self-position (a
  // nested popupCard hung its content below the empty shell, off-screen),
  // and the stroke color must use the shared picker, not the native input.
  assert.doesNotMatch(panel, /style=\{popupCard\}/);
  assert.match(panel, /<div style=\{popupBody\}>/);
  assert.match(panel, /strokePickerOpen && \(\s*\n\s*<PanelPopup anchor=\{strokeRowRef\}/);
  assert.match(panel, /<ColorPickerCard\s*\n\s*hex=\{isSvgShape \? toHex\(s\["stroke"\]\) : stroke\.color\}/);
  // Element ops toolbar: the floating strip above the canvas (which pushed
  // the canvas down on every selection) is gone — the controls live in the
  // contextual panel's Code tab via the codeToolbar prop.
  assert.doesNotMatch(editor, /editor-v2-elem-ops/);
  assert.match(editor, /codeToolbar=\{/);
  assert.match(panel, /codeToolbar\?: React\.ReactNode/);
  assert.match(panel, /\{codeToolbar && \(/);
  // SVG pen fill: the painted path's computed fill backs the attribute read
  // (pen shapes carry fill only in the `[sel] path` rule), computed "none"
  // is a REAL transparent state (never the #c8b898 accent fallback), and
  // writes must update the CSS RULE — a presentation attribute always loses
  // to author CSS, which is why the canvas stayed black while the panel
  // showed the new colour.
  assert.match(panel, /const svgPaintedRaw = svgPaintedFill \|\| \(svgComputedFill === "none" \? "rgba\(0, 0, 0, 0\)" : svgComputedFill\);/);
  assert.match(panel, /update\(`\$\{selector\} path`, "fill", hex\);/);
  assert.match(panel, /update\(`\$\{selector\} path`, "fill", `url\(#musa-fill-\$\{element\.layerId\}\)`\);/);
  // Generic re-emits must keep the painted-path source for SVG shapes (a
  // dropped source flipped the fill row to "no relleno propio" and unmounted
  // the open fill picker).
  assert.match(designFrame, /const effectiveSource = source === element && rememberedSource && element\.contains\(rememberedSource\)/);
  // Selection box OBB (phase 1, rotate-only): pure-rotation transforms get
  // the LAYOUT box rotated by the matrix angle; rotate drags spin the same
  // box in real time; handles ride INSIDE the box.
  assert.match(designFrame, /obbAngle = Math\.atan2\(m12, m11\);/);
  assert.match(designFrame, /transformOrigin: elStyle\.transformOrigin,/);
  assert.match(designFrame, /selectionBox\.style\.transform = `rotate\(\$\{currentRotation\}deg\)`/);
  assert.match(designFrame, /selectionBox\.appendChild\(handle\);/);
  assert.match(designFrame, /startResize\(el, e as MouseEvent, direction, boxX, boxY, boxW, boxH\);/);
  // Pen bounds: the committed svg box hugs the INKED curve (sampled), not
  // the Bézier control hull — computeBounds stays for fitPathBox's refit.
  const pathDataLib = await readFile(new URL("../src/lib/pathData.ts", import.meta.url), "utf8");
  assert.match(pathDataLib, /export function computeInkBounds\(/);
  assert.match(pathDataLib, /deCasteljau\(controls, sample \/ samplesPerSegment\)/);
  assert.match(designFrame, /const bounds = computeInkBounds\(pts, closed\);/);
});

test("undoes frame-to-canvas transfers atomically without reverting unrelated frames", () => {
  const frameA = { id: "a", name: "A", x: 0, y: 0, width: 100, height: 100, html: "<div>A</div>", css: "", background: "#fff" };
  const frameB = { id: "b", name: "B", x: 200, y: 0, width: 100, height: 100, html: "<div>B</div>", css: "", background: "#fff" };
  const object = {
    id: "root", name: "Root", kind: "shape", frameId: null,
    html: '<div data-layer-id="root"></div>', css: "", x: 20, y: 20,
    width: 40, height: 40, zIndex: 1,
  };
  const store = createDocumentStore([frameA, frameB]);
  store.replaceCanvasObjects([]);
  store.replaceDocumentWithUndo([{ ...frameA, html: "" }, frameB], [object], "move to canvas");

  assert.equal(store.undo(), true);
  assert.equal(store.frames[0].html, "<div>A</div>");
  assert.equal(store.frames[1].html, "<div>B</div>");
  assert.equal(store.canvasObjects.length, 0);
  assert.equal(store.redo(), true);
  assert.equal(store.frames[0].html, "");
  assert.equal(store.frames[1].html, "<div>B</div>");
  assert.equal(store.canvasObjects[0].id, "root");
});

test("shares selected root objects through the cross-tab design clipboard", () => {
  const values = new Map();
  const previousStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  });
  const clipboard = {
    kind: "canvas-object",
    objects: [{
      layerId: "orphan_source",
      object: {
        id: "orphan_source",
        name: "Photo",
        kind: "image",
        frameId: null,
        html: '<img data-layer-id="orphan_source" src="photo.png">',
        css: '[data-layer-id="orphan_source"] { width: 240px; height: 160px; }',
        x: 320,
        y: 180,
        width: 240,
        height: 160,
        zIndex: 2,
      },
    }],
    pasteCount: 0,
  };

  try {
    assert.equal(persistDesignClipboard(clipboard), true);
    assert.ok(values.has(DESIGN_CLIPBOARD_KEY));
    assert.deepEqual(readDesignClipboard(), clipboard);
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previousStorage });
  }
});

test("API validation preserves root objects and their null frame ownership", () => {
  const result = updateTemplateSchema.safeParse({
    canvasObjects: [{
      id: "copy",
      name: "Copy",
      kind: "text",
      frameId: null,
      html: "<p>Draft</p>",
      css: "",
      x: 20,
      y: 30,
      width: 240,
      height: 60,
      zIndex: 1,
    }],
  });

  assert.equal(result.success, true);
  assert.equal(result.data?.canvasObjects?.[0].frameId, null);
});
