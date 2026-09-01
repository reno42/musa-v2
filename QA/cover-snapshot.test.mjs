import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { THUMB_EDGE, thumbnailScale } from "../src/lib/autoSnapshot.ts";

test("manual cover capture renders only the thumbnail budget", async () => {
  const source = await readFile(new URL("../src/pages/EditorV2.tsx", import.meta.url), "utf8");
  assert.match(source, /thumbnailScale\(selectedFrame\.width, selectedFrame\.height\)/);
  assert.match(source, /captureFrameToPng\(selectedFrame, scale, "jpg"\)/);
  const scale = thumbnailScale(1080, 1350);
  assert.equal(Math.round(1350 * scale), THUMB_EDGE);
});

test("snapshot failures are visible instead of swallowed", async () => {
  const source = await readFile(new URL("../src/components/FileInfoPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /role="alert"/);
  assert.match(source, /setCoverError\(message\)/);
  assert.doesNotMatch(source, /handleSnapshot[\s\S]{0,1200}catch \{\}/);
});
