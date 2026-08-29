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
  // same inlined fonts/images. Lines are grouped per character-rect top
  // and re-measured trimmed, so each PPT box is one visual line.
  assert.match(fc, /extractFrameTextBlocks[\s\S]*mapBodySelectors/);
  assert.match(fc, /extractFrameTextBlocks[\s\S]*inlineGoogleFontCss/);
  assert.match(fc, /setStart\(node, i\)/);
  assert.match(fc, /lr\.setStart\(node, from\)/);
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
  // Per-line, wrap off: the browser's breaks are frozen, so a substituted
  // font can never re-wrap a line down onto its neighbor.
  assert.match(tab, /wrap: false/);
  assert.doesNotMatch(tab, /lineSpacingMultiple/);
});

test("the cover leads with the brand and the requesting user", () => {
  const tab = read("src/components/ContentTab.tsx");
  assert.match(tab, /cover\.addText\(brandName, \{ x: 0\.7, y: 1\.4, w: 8\.6, h: 0\.85/);
  assert.match(tab, /Presentado por \$\{userName\}/);
  // The file's metadata author is the requester too.
  assert.match(tab, /pptx\.author = String\(userName\)/);
});

test("every cover, date and footer text carries an explicit height (cy=0 regression guard)", () => {
  const tab = read("src/components/ContentTab.tsx");
  // pptxgenjs defaults h to 0 → cy="0" shapes, which several PowerPoint
  // renderers collapse to invisible hairlines (the "empty cover" bug).
  const coverBlock = tab.slice(
    tab.indexOf("Portada: brand as the headline"),
    tab.indexOf("Frame → PNG."),
  );
  const adds = coverBlock.match(/cover\.addText\([^;]+/g) || [];
  assert.ok(adds.length >= 5, "the five cover texts are present");
  for (const a of adds) assert.match(a, /h: [0-9.]+/, `cover text without h: ${a.slice(0, 80)}`);
  assert.match(tab, /\{ x: 0\.5, y: 0\.3, w: 9, h: 0\.35, fontSize: 12, valign: "top"/);
  assert.match(tab, /\{ x: 0\.5, y: 5\.2, w: 9, h: 0\.3, fontSize: 9\.5, valign: "top"/);
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
