/**
 * Contratos de la reparación CORS del rasterizador (Modo Foto sobre frames):
 * re-host vía /api/assets/upload?url=, SIN caché negativa de fallos, y
 * visibilidad de lo reparado/irreparable en el editor.
 * Corre: node --experimental-strip-types --test QA/frame-raster-repair.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const capture = read("src/lib/frameCapture.ts");

test("inlineImageUrl: repair callback re-hostea vía plataforma y reintenta", () => {
  assert.match(capture, /export type InlineImageRepair = \(url: string\) => Promise<string \| null>;/);
  assert.match(capture, /export interface InlineImageOptions \{/);
  const body = capture.slice(capture.indexOf("export async function inlineImageUrl("));
  const block = body.slice(0, body.indexOf("\n}"));
  assert.match(block, /if \(opts\?\.repair\) \{/);
  assert.match(block, /const platformUrl = await opts\.repair\(url\);/);
  // el reintento usa el MISMO fetchAsDataUri y cachea el resultado bueno
  assert.match(block, /await fetchAsDataUri\(platformUrl\)/);
  assert.match(block, /imageDataUriCache\.set\(url, dataUri\)/);
});

test("inlineImageUrl: fallos ya NO se cachean (fin de la caché negativa venenosa)", () => {
  assert.ok(!/imageDataUriCache\.set\(url, url\)/.test(capture),
    "la caché negativa set(url, url) envenenaba los reintentos de la sesión");
  const body = capture.slice(capture.indexOf("export async function inlineImageUrl("));
  assert.match(body, /opts\?\.onUnrepaired\?\.\(url\);\s*return url;/);
});

test("rasterizeFrame/inlineFrameImages aceptan InlineImageOptions (opt-in, callers intactos)", () => {
  assert.match(capture, /export async function rasterizeFrame\(\s*\n\s*source: FrameSource,\s*\n\s*scale = 2,\s*\n\s*opts\?: InlineImageOptions,/);
  assert.match(capture, /inlineFrameImages\(source\.html, source\.css, opts\)/);
  assert.match(capture, /await inlineImageUrl\(url, opts\)/);
});

// ── EditorV2: reparación con dedup + visibilidad ──
const editor = read("src/pages/EditorV2.tsx");

test("repairFrameImageForRaster: /api/assets/upload con url + dedup por sesión", () => {
  assert.match(editor, /const repairFrameImageForRaster = useCallback\(async \(url: string\): Promise<string \| null> => \{/);
  const anchor = editor.indexOf("const repairFrameImageForRaster");
  const block = editor.slice(anchor, anchor + 1200);
  assert.match(block, /apiFetch<any>\("\/api\/assets\/upload"/);
  assert.match(block, /url, workspaceId: templateWorkspaceId \|\| undefined/);
  assert.match(block, /repairedUrlCacheRef\.current\.get\(url\)/);
  assert.match(block, /repairedUrlCacheRef\.current\.set\(url, result\)/);
});

test("captureFrameToPng propaga inlineOpts al rasterizador", () => {
  assert.match(editor, /inlineOpts\?: InlineImageOptions/);
  assert.match(editor, /inlineOpts,\s*\n\s*\);/);
});

test("handleOpenFrameInPhotoMode pasa repair+onUnrepaired y avisa el resultado", () => {
  const anchor = editor.indexOf("const handleOpenFrameInPhotoMode");
  const block = editor.slice(anchor, anchor + 3400);
  assert.match(block, /repair: async \(url\) => \{/);
  assert.match(block, /onUnrepaired: \(url\) => unrepairedUrls\.push\(url\)/);
  assert.match(block, /if \(repairedCount > 0\)/);
  assert.match(block, /if \(unrepairedUrls\.length > 0\)/);
  assert.match(block, /quedará como hueco en la copia/);
});
