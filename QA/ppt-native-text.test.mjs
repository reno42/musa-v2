// Option A ("texto sobre arte") for the copywriting PPT export — the
// design's own words must reach PowerPoint as native, selectable text laid
// over a text-hidden raster, and the cover must lead with the brand and the
// requesting user. Source invariants, per the repo's QA convention.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("frameCapture exposes the native-text toolkit for the PPT export", () => {
  const fc = read("src/lib/frameCapture.ts");
  assert.match(fc, /export interface PptTextBlock/);
  assert.match(fc, /export async function extractFrameTextBlocks/);
  assert.match(fc, /export async function rasterizeFrameWithoutText/);
  // The art raster hides the text layer, not the design.
  assert.match(fc, /-webkit-text-fill-color:transparent/);
  // The measurer is a live-layout twin of the raster path: same scoping,
  // same inlined fonts/images.
  assert.match(fc, /extractFrameTextBlocks[\s\S]*mapBodySelectors/);
  assert.match(fc, /extractFrameTextBlocks[\s\S]*inlineGoogleFontCss/);
});

test("ContentTab renders design text as native boxes and falls back to the baked PNG", () => {
  const tab = read("src/components/ContentTab.tsx");
  assert.match(tab, /import \{ extractFrameTextBlocks, rasterizeFrame, rasterizeFrameWithoutText/);
  assert.match(tab, /frameToSlideArt/);
  // No text found ⇒ classic raster — never an empty-looking slide.
  assert.match(tab, /blocks\.length\s*\?\s*await rasterizeFrameWithoutText/);
  // Blocks land inside the art region, scaled px→inches; px→points is ×72.
  assert.match(tab, /artX \+ b\.x \* fit/);
  assert.match(tab, /b\.fontSize \* fit \* 72/);
});

test("the cover leads with the brand and the requesting user", () => {
  const tab = read("src/components/ContentTab.tsx");
  assert.match(tab, /cover\.addText\(brandName, \{ x: 0\.7, y: 1\.4, w: 8\.6, fontSize: 44, bold: true/);
  assert.match(tab, /Presentado por \$\{userName\}/);
  // The file's metadata author is the requester too.
  assert.match(tab, /pptx\.author = String\(userName\)/);
});

test("the export popup offers editable vs flat design text", () => {
  const tab = read("src/components/ContentTab.tsx");
  assert.match(tab, /const \[pptTextMode, setPptTextMode\] = useState<"native" \| "flat">\("native"\)/);
  assert.match(tab, /<option value="native"/);
  assert.match(tab, /<option value="flat"/);
  // Flat mode must skip extraction — the raster keeps its baked text.
  assert.match(tab, /if \(pptTextMode === "native"\) \{\s*try \{ blocks = await extractFrameTextBlocks/);
  // The generator must actually react to the chosen mode.
  assert.match(tab, /pptBrandId, pptTextMode, brands,/);
});
