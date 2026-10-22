/**
 * Contratos estáticos del Modo Foto sobre frames (raster de frame completo):
 * picker de origen en el menú, raster 2× cacheado por hash, y apply que
 * INSERTA una capa <img> nueva encima en vez de reemplazar un src existente.
 * Corre: node --experimental-strip-types --test QA/photo-frame-raster.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

// ── helpers puros (shared/photoTargets.ts no importa nada — corre en node) ──
const { frameRasterLayerId, frameSourceHash, parseFrameImages, collectPhotoTargets } =
  await import("../shared/photoTargets.ts");

test("frameRasterLayerId usa el prefijo frame: (no colisiona con el_*)", () => {
  const id = frameRasterLayerId("abc123");
  assert.equal(id, "frame:abc123");
  assert.ok(id.startsWith("frame:"));
  assert.ok(!id.startsWith("el_"));
});

test("frameSourceHash: estable para la misma fuente, distinto si cambia el diseño", () => {
  const a = frameSourceHash(["f1", "<p>hola</p>", ".x{}", 100, 200, "#fff"]);
  assert.equal(a, frameSourceHash(["f1", "<p>hola</p>", ".x{}", 100, 200, "#fff"]));
  assert.equal(a.length, 8);
  assert.notEqual(a, frameSourceHash(["f1", "<p>chau</p>", ".x{}", 100, 200, "#fff"]));
  assert.notEqual(a, frameSourceHash(["f1", "<p>hola</p>", ".x{}", 100, 200, "#000"]));
});

test("parseFrameImages/collectPhotoTargets siguen devolviendo targets sin kind (compat)", () => {
  const targets = parseFrameImages("fr1", '<img data-layer-id="l1" src="https://x/a.png">');
  assert.equal(targets.length, 1);
  assert.equal(targets[0].kind, undefined);
  assert.equal(collectPhotoTargets([{ id: "fr1", html: '<img data-layer-id="l1" src="https://x/a.png">' }], []).length, 1);
});

// ── EditorV2: entrada, raster, cache, apply ──
const editor = read("src/pages/EditorV2.tsx");

test("el menú 'Editor de fotos' abre el picker (no exige foto seleccionada)", () => {
  assert.match(editor, /setPhotoFramePickerOpen\(true\)/);
  assert.match(editor, /desc="Revelado no destructivo: fotos del diseño o frames rasterizados"/);
  // el flujo clásico por selección sigue vivo (botón "Editar foto" del panel)
  assert.match(editor, /const handleOpenPhotoMode = useCallback/);
});

test("handleOpenFrameInPhotoMode: raster 2× + subida a Assets + cache por hash", () => {
  assert.match(editor, /captureFrameToPng\(frame, 2, "png"/);
  assert.match(editor, /apiFetch<any>\("\/api\/assets\/upload"/);
  assert.match(editor, /frameSourceHash\(\[frame\.id, frame\.html, frame\.css, frame\.width, frame\.height, frame\.background\]\)/);
  assert.match(editor, /frameRasterCacheRef\.current\.set\(cacheKey, rasterUrl\)/);
  assert.match(editor, /kind: "frameRaster"/);
  assert.match(editor, /layerId: frameRasterLayerId\(frame\.id\)/);
});

test("apply sobre frameRaster INSERTA capa nueva encima (no setLayerAttributes)", () => {
  const anchor = editor.indexOf("if (target.kind === \"frameRaster\" && target.frameId)");
  assert.ok(anchor > 0, "falta la rama frameRaster en handlePhotoApplyToLayer");
  const branch = editor.slice(anchor, anchor + 1600);
  assert.match(branch, /insertLayerIntoHtml\(frame\.html, imgHtml, null, "inside"\)/);
  assert.match(branch, /data-orig-src="\$\{target\.src\}"/);
  assert.match(branch, /data-photo-recipe="\$\{recipeAttr\}"/);
  assert.match(branch, /store\.replaceAllWithUndo\(updated, "edit"\)/);
  assert.match(branch, /setPhotoModeOpen\(false\)/);
});

test("el raster activo llega al overlay vía extraTargets (tira de targets)", () => {
  assert.match(editor, /const photoExtraTargets = useMemo/);
  assert.match(editor, /extraTargets=\{photoExtraTargets\}/);
  assert.match(editor, /<PhotoFramePickerModal/);
});

// ── PhotoModeOverlay: los sintéticos se mezclan a los targets ──
const overlay = read("src/components/PhotoModeOverlay.tsx");

test("overlay: prop extraTargets opcional, mezclada después de los targets del html", () => {
  assert.match(overlay, /extraTargets\?: PhotoTarget\[\]/);
  const memo = overlay.indexOf("const targets = useMemo(() => {");
  assert.ok(memo > 0);
  const block = overlay.slice(memo, memo + 400);
  assert.match(block, /\[\.\.\.base, \.\.\.extraTargets\]/);
});

test("insertLayerIntoHtml con target null + inside = append al body (tope del z-order)", () => {
  const src = read("src/lib/htmlMutations.ts");
  const anchor = src.indexOf("export function insertLayerIntoHtml(");
  assert.ok(anchor > 0);
  const body = src.slice(anchor, anchor + 900);
  assert.match(body, /targetLayerId === null/);
  assert.match(body, /document\.body\.appendChild\(imported\)/);
});

// ── Picker: thumbnails con el rasterizador real + atajo a la foto seleccionada ──
const picker = read("src/components/PhotoFramePickerModal.tsx");

test("picker: miniaturas vía rasterizeFrame, grid de frames y card de foto seleccionada", () => {
  assert.match(picker, /import \{ rasterizeFrame \} from "\.\.\/lib\/frameCapture"/);
  assert.match(picker, /onPickFrame/);
  assert.match(picker, /hasSelectedPhoto/);
  assert.match(picker, /Editar la foto seleccionada/);
  assert.match(picker, /busyFrameId/);
});

test("picker genera thumbnails en serie con cancelación al desmontar", () => {
  assert.match(picker, /let cancelled = false;/);
  assert.match(picker, /for \(const frame of frames\)/);
  assert.match(picker, /return \(\) => \{ cancelled = true; \};/);
});
