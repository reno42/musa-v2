/**
 * QA REQ042 — eje z upgrade: drag-reorder with explicit z maps everywhere.
 *  • layerOrder: dragReorderedLayerZ (drop above/below → FULL map) and
 *    layerZShadowCss (plain selectors for shadow roots) — functional tests.
 *  • DesignFrame: the design canvas applies the map via style[data-df-z]
 *    (video-made z edits stay visible in design mode).
 *  • EditorV2: design-side structural stack edits reset the frame's z map.
 *  • VideoTimeline: row-header drag with insertion line + visible z badges.
 *  • VideoModeOverlay / HtmlLayersPanel: wiring + badges (source contracts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const {
  dragReorderedLayerZ,
  layerZShadowCss,
} = await import("../shared/layerOrder.ts");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const src = (p) => readFileSync(join(ROOT, p), "utf8");

test("P42-1 dragReorderedLayerZ: one drop re-orders the WHOLE stack", () => {
  const order = ["a", "b", "c", "d"]; // document order, d = front
  // Drop b in front of d: b is removed then re-inserted after d.
  assert.deepEqual(
    dragReorderedLayerZ(order, "b", "d", "in-front-of"),
    { a: 0, c: 1, d: 2, b: 3 },
    "b queda encima de d (y de todo lo que había entre medio)",
  );
  // Drop c behind a: c goes to the very back.
  assert.deepEqual(
    dragReorderedLayerZ(order, "c", "a", "behind"),
    { c: 0, a: 1, b: 2, d: 3 },
    "c queda debajo de a",
  );
  // Dropping a layer onto itself is a no-op, unknown ids are rejected.
  assert.equal(dragReorderedLayerZ(order, "b", "b", "in-front-of"), null);
  assert.equal(dragReorderedLayerZ(order, "x", "a", "behind"), null);
  assert.equal(dragReorderedLayerZ(order, "a", "x", "in-front-of"), null);
  // The input order is never mutated.
  assert.deepEqual(order, ["a", "b", "c", "d"]);
});

test("P42-2 layerZShadowCss: plain rules for shadow roots, empty → none", () => {
  assert.equal(layerZShadowCss({ a: 0, b: 3 }), '[data-layer-id="a"]{z-index:0 !important;}[data-layer-id="b"]{z-index:3 !important;}');
  assert.equal(layerZShadowCss(null), "");
  assert.equal(layerZShadowCss(undefined), "");
  assert.equal(layerZShadowCss({}), "");
});

test("P42-3 DesignFrame: the design canvas applies the explicit z map", () => {
  const t = src("src/components/DesignFrame.tsx");
  assert.match(t, /import \{ layerZShadowCss \} from "\.\.\/\.\.\/shared\/layerOrder\.ts";/);
  // Dedicated shadow style tag — created on demand, removed when the map empties.
  assert.match(t, /style\[data-df-z\]/);
  assert.match(t, /style\.setAttribute\("data-df-z", ""\)/);
  assert.match(t, /if \(!text\) \{ style\?\.remove\(\); return; \}/);
  assert.match(t, /layerZShadowCss\(frame\.layerZ\)/);
  assert.match(t, /\}, \[frame\.layerZ\]\);/);
});

test("P42-4 EditorV2: design stack edits reset the frame's z map", () => {
  const t = src("src/pages/EditorV2.tsx");
  // handleLayerStackChange (menu ▲▼ / Alt+arrows) and BOTH handleLayerDrop
  // branches mutate document order — each must clear the stale override.
  assert.match(t, /html: change\.html, css: stackedCss, layerZ: undefined/);
  assert.match(t, /REQ042: a design-side stack edit re-orders the DOM/);
  assert.match(t, /REQ042: same-frame drop = structural reorder → z map resets\./);
  assert.match(t, /REQ042: both frames' layer stacks changed structurally/);
  assert.match(t, /html: extracted\.html, css: sourceCss, layerZ: undefined/);
  assert.match(t, /html: inserted\.html, css: targetCss, layerZ: undefined/);
});

test("P42-5 VideoTimeline: row-header drag with insertion line + z badges", () => {
  const t = src("src/components/video/VideoTimeline.tsx");
  // Drag state + drop state; the dragged row never shows its own drop line.
  assert.match(t, /mode: "layerZ"; frameId: string; layerId: string/);
  assert.match(t, /const \[zDropTarget, setZDropTarget\] = useState<\{ layerId: string; placement: LayerZPlacement \} \| null>\(null\)/);
  assert.match(t, /const \[zDragLayerId, setZDragLayerId\] = useState<string \| null>\(null\)/);
  assert.match(t, /zDragLayerId !== track\.layerId/);
  // Rows are addressable; pointer position picks target AND side.
  assert.match(t, /data-video-layer-row=\{track\.layerId\}/);
  assert.match(t, /document\.elementFromPoint\(e\.clientX, e\.clientY\)/);
  assert.match(t, /closest\?\.\("\[data-video-layer-row\]"\)/);
  assert.match(t, /e\.clientY < rect\.top \+ rect\.height \/ 2 \? "in-front-of" : "behind"/);
  // The header drags Z; the lane keeps dragging TIME.
  assert.match(t, /e\.stopPropagation\(\); \/\/ the header drags Z; the lane drags TIME/);
  assert.match(t, /dragRef\.current = \{ mode: "layerZ", frameId: fid, layerId: track\.layerId \}/);
  // Insertion line + commit + badge.
  assert.match(t, /dropHere\?\.placement === "in-front-of" \? "2px solid #e0b57a" : "1px solid rgba\(255,255,255,0\.035\)"/);
  assert.match(t, /dropHere\?\.placement === "behind" \? "2px solid #e0b57a" : "1px solid transparent"/);
  assert.match(t, /onLayerZDrop\(d\.frameId, d\.layerId, zDropTarget\.layerId, zDropTarget\.placement\)/);
  assert.match(t, /data-video-z-badge/);
});

test("P42-6 VideoModeOverlay: drag commit turns DOM order into the z map", () => {
  const t = src("src/components/VideoModeOverlay.tsx");
  assert.match(t, /import \{ layerZStyleText, reorderedLayerZ, dragReorderedLayerZ, type LayerZPlacement \} from "\.\.\/\.\.\/shared\/layerOrder\.ts";/);
  assert.match(t, /const handleLayerZDrop = \(frameId: string, layerId: string, targetLayerId: string, placement: LayerZPlacement\)/);
  assert.match(t, /dragReorderedLayerZ\(order, layerId, targetLayerId, placement\)/);
  assert.match(t, /const layerZByFrame = useMemo\(/);
  // Wired to the timeline; the timeline's old selection-conditional prop is
  // gone (the inspector keeps its own layerZ= — that one stays).
  assert.match(t, /layerZByFrame=\{layerZByFrame\}/);
  assert.match(t, /onLayerZDrop=\{handleLayerZDrop\}/);
  assert.equal(t.split("layerZ={selection?.kind === \"layer\"").length - 1, 1, "only the inspector keeps a layerZ= wiring");
});

test("P42-7 HtmlLayersPanel: explicit-z badges in the Capas list", () => {
  const t = src("src/components/HtmlLayersPanel.tsx");
  // Root rows show their z from the frame's map (text, never color alone).
  assert.match(t, /layer\.depth === 0 && typeof tree\.frame\.layerZ\?\.\[layer\.layerId\] === "number"/);
  assert.match(t, /data-z-badge/);
  // The frame row announces an active map.
  assert.match(t, /data-frame-z-chip/);
  assert.match(t, /z·\{Object\.keys\(tree\.frame\.layerZ\)\.length\}/);
});
