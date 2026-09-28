// QA/req032-photo-platform.test.mjs — REQ-PHOTO-PLATFORM-001 (Fase 1 "Modo
// Foto"): la matemática pura (receta, LUTs, geometría, targets) se testea de
// verdad importándola; el API, la migración y el wiring del editor se afirman
// sobre el source (convención del repo: crm-inbox-capture / req032-visual).
// Corre con:
//   node --experimental-strip-types --test QA/req032-photo-platform.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  OP_ORDER, RECIPE_SCHEMA_VERSION, PHOTO_PRESETS,
  applyPreset, buildCurveLut, createDefaultRecipe, decodeRecipeAttr,
  displayRectToSourceRect, encodeRecipeAttr, normalizeRecipe,
  recipeHasEdits, resolveOutputSize, resolveRenderState,
} from "../shared/photoRecipe.ts";
import {
  collectPhotoTargets, groupTargetsBySrc, parseFrameImages,
} from "../shared/photoTargets.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const migration = readFileSync(ROOT + "supabase_migrations_v59.sql", "utf8");
const photosRoute = readFileSync(ROOT + "api/src/routes/photos.ts", "utf8");
const editorV2 = readFileSync(ROOT + "src/pages/EditorV2.tsx", "utf8");
const overlay = readFileSync(ROOT + "src/components/PhotoModeOverlay.tsx", "utf8");

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, `no se encontró el marcador de inicio: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.ok(end !== -1, `no se encontró el marcador de fin: ${endMarker}`);
  return source.slice(start, end);
}

const count = (haystack, needle) => haystack.split(needle).length - 1;

// ── Receta: normalize (única puerta de entrada) ──────────────────────────────

test("normalizeRecipe: clampa números, rellena defaults y descarta lo desconocido", () => {
  const r = normalizeRecipe({
    schemaVersion: 99,
    ops: [
      { type: "basic", params: { exposure: 999, contrast: "no-soy-número" } },
      { type: "op-inexistente", params: { foo: 1 } },
      { type: "effects", enabled: false, params: { grain: -50 } },
    ],
    masks: [{ kind: "brush", adjustments: { exposure: 500 } }, "junk"],
  });
  assert.equal(r.schemaVersion, RECIPE_SCHEMA_VERSION);
  // orden canónico: las 9 ops SIEMPRE, una vez cada una, en OP_ORDER
  assert.deepEqual(r.ops.map(o => o.type), OP_ORDER);
  const basic = r.ops.find(o => o.type === "basic").params;
  assert.equal(basic.exposure, 100);           // 999 → clamp
  assert.equal(basic.contrast, 0);             // no-número → fallback
  const effects = r.ops.find(o => o.type === "effects");
  assert.equal(effects.enabled, false);        // enabled se respeta
  assert.equal(effects.params.grain, 0);       // -50 → clamp a 0
  assert.equal(r.masks.length, 1);             // "junk" descartado
  assert.equal(r.masks[0].adjustments.exposure, 100);
});

test("normalizeRecipe: máscaras topadas a 6 y geometría clampa", () => {
  const masks = Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, kind: "radial" }));
  const r = normalizeRecipe({ masks, geometry: { straighten: 90, rotate90: 7, crop: { w: 5, h: -3 } } });
  assert.equal(r.masks.length, 6);
  assert.equal(r.geometry.straighten, 45);
  assert.equal(r.geometry.rotate90, 3);
  assert.equal(r.geometry.crop.w, 1);   // clamp(5, 0.05, 1-0) → 1
  assert.equal(r.geometry.crop.h, 0.05);
});

test("normalizeRecipe: idempotente (normalize(normalize(x)) === normalize(x))", () => {
  const r = normalizeRecipe({ ops: [{ type: "detail", params: { clarity: 33 } }] });
  assert.deepEqual(normalizeRecipe(r), r);
});

// ── Curvas: LUT identidad + monotonía ────────────────────────────────────────

test("buildCurveLut: [] y la diagonal producen identidad exacta", () => {
  for (const lut of [buildCurveLut([]), buildCurveLut([{ x: 0, y: 0 }, { x: 255, y: 255 }])]) {
    assert.equal(lut.length, 256);
    for (let i = 0; i < 256; i++) assert.equal(lut[i], i);
  }
});

test("buildCurveLut: SIEMPRE monótona no decreciente (una curva de tono no invierte)", () => {
  const lut = buildCurveLut([{ x: 0, y: 255 }, { x: 255, y: 0 }]); // inversión imposible
  for (let i = 1; i < 256; i++) assert.ok(lut[i] >= lut[i - 1], `inversión en ${i}`);
  // S-curve razonable: respeta anclas
  const s = buildCurveLut([{ x: 0, y: 0 }, { x: 64, y: 32 }, { x: 192, y: 224 }, { x: 255, y: 255 }]);
  assert.equal(s[0], 0);
  assert.equal(s[255], 255);
  for (let i = 1; i < 256; i++) assert.ok(s[i] >= s[i - 1]);
});

// ── Presets + detección de ediciones ─────────────────────────────────────────

test("8 presets curados: normalizan limpios, editan de verdad y son idempotentes", () => {
  assert.equal(PHOTO_PRESETS.length, 8);
  for (const preset of PHOTO_PRESETS) {
    const out = applyPreset(createDefaultRecipe(), preset);
    assert.deepEqual(normalizeRecipe(out), out, `preset ${preset.id} no normalizado`);
    assert.equal(recipeHasEdits(out), true, `preset ${preset.id} no edita`);
  }
});

test("recipeHasEdits: receta default NO edita; op desactivada tampoco", () => {
  assert.equal(recipeHasEdits(createDefaultRecipe()), false);
  const disabledNoise = createDefaultRecipe();
  disabledNoise.ops.find(o => o.type === "basic").enabled = false;
  disabledNoise.ops.find(o => o.type === "basic").params.exposure = 50; // sobra, pero está OFF
  assert.equal(recipeHasEdits(disabledNoise), false);
  const edited = createDefaultRecipe();
  edited.ops.find(o => o.type === "basic").params.exposure = 5;
  assert.equal(recipeHasEdits(edited), true);
});

// ── Estado resuelto (lo que consume el motor) ────────────────────────────────

test("resolveRenderState: op desactivada aporta defaults y HSL sale normalizado -1..1", () => {
  const r = normalizeRecipe({
    ops: [
      { type: "basic", enabled: false, params: { exposure: 80 } },
      { type: "hsl", params: { red: { h: 30, s: -100, l: 0 } } },
    ],
  });
  const st = resolveRenderState(r);
  assert.equal(st.basic.exposure, 0);                    // OFF → neutro
  const red = st.hsl[0];                                 // banda "red" es la primera
  assert.equal(red.h, 1);
  assert.equal(red.s, -1);
  assert.equal(st.masks.length, 0);
});

// ── Geometría pura ───────────────────────────────────────────────────────────

test("resolveOutputSize: rot90 impar intercambia ancho/alto", () => {
  assert.deepEqual(resolveOutputSize(4000, 3000, normalizeRecipe({}).geometry), { w: 4000, h: 3000 });
  const rot = { ...normalizeRecipe({}).geometry, rotate90: 1 };
  assert.deepEqual(resolveOutputSize(4000, 3000, rot), { w: 3000, h: 4000 });
});

test("displayRectToSourceRect: identidad sin rotar; 90° mapea el cuadrante", () => {
  const g0 = normalizeRecipe({}).geometry;
  const rect = { x: 0.1, y: 0.2, w: 0.5, h: 0.4 };
  assert.deepEqual(displayRectToSourceRect(rect, g0), rect);
  const g90 = { ...g0, rotate90: 1 };
  assert.deepEqual(displayRectToSourceRect({ x: 0, y: 0, w: 0.5, h: 0.5 }, g90), { x: 0, y: 0.5, w: 0.5, h: 0.5 });
  // el rect completo es invariante bajo cualquier rotación
  const full = { x: 0, y: 0, w: 1, h: 1 };
  for (const k of [0, 1, 2, 3]) {
    assert.deepEqual(displayRectToSourceRect(full, { ...g0, rotate90: k }), full);
  }
});

// ── Serialización data-photo-recipe (base64url, unicode-safe) ────────────────

test("encode/decodeRecipeAttr: round-trip byte-idéntico y charset base64url", () => {
  const recipe = normalizeRecipe({
    ops: [{ type: "white_balance", params: { temp: -22, tint: 7 } }],
    masks: [{ kind: "radial", cx: 0.5, cy: 0.5, r: 0.3 }],
  });
  const attr = encodeRecipeAttr(recipe);
  assert.match(attr, /^[A-Za-z0-9_-]+$/); // sin +, / ni = (seguro en HTML)
  assert.deepEqual(decodeRecipeAttr(attr), recipe);
  assert.equal(decodeRecipeAttr("%%%no-soy-base64"), null);
});

// ── photoTargets: inventario de fotos (puro, sin DOM) ────────────────────────

test("parseFrameImages: solo <img> con data-layer-id+src; lee receta embebida", () => {
  const html = '<div><img data-layer-id="a1" data-layer-kind="image" src="https://x/a.jpg" alt="Foto A">' +
    '<img src="https://x/sin-layer.jpg">' +
    '<img data-layer-id="b2" src="https://x/b.jpg" data-photo-recipe="abc_def"></div>';
  const targets = parseFrameImages("f1", html);
  assert.equal(targets.length, 2);
  assert.deepEqual(targets[0], { frameId: "f1", layerId: "a1", src: "https://x/a.jpg", name: "Foto A", recipeAttr: null });
  assert.equal(targets[1].recipeAttr, "abc_def");
});

test("collectPhotoTargets: frames primero, huérfanos image después (frameId null)", () => {
  const frames = [{ id: "f1", html: '<img data-layer-id="a1" src="https://x/a.jpg">' }];
  const objects = [
    { id: "o1", kind: "rect", html: "<div></div>" },
    { id: "o2", kind: "image", html: '<img data-layer-id="o2" src="https://x/a.jpg">', name: "Huérfana" },
  ];
  const targets = collectPhotoTargets(frames, objects);
  assert.equal(targets.length, 2);
  assert.equal(targets[0].frameId, "f1");
  assert.equal(targets[1].frameId, null);
  assert.equal(targets[1].name, "Huérfana");
  const groups = groupTargetsBySrc(targets);
  assert.equal(groups.size, 1);
  assert.equal(groups.get("https://x/a.jpg").length, 2); // misma foto, 2 instancias
});

// ── Migración v59: contratos idempotentes ────────────────────────────────────

test("migración v59: 3 tablas con RLS e índices idempotentes", () => {
  assert.ok(existsSync(ROOT + "supabase_migrations_v59.sql"));
  for (const table of ["photo_documents", "photo_versions", "photo_catalog_items"]) {
    assert.ok(migration.includes(`create table if not exists ${table}`), table);
  }
  assert.equal(count(migration, "enable row level security"), 3);
  assert.ok(count(migration, "drop policy if exists") >= 6, "políticas re-ejecutables");
  assert.ok(migration.includes("has_workspace_role(workspace_id, 'editor')"));
  assert.ok(migration.includes("has_workspace_role(workspace_id, 'viewer')"));
  assert.ok(count(migration, "create index if not exists") >= 3);
  // inmutabilidad del original: source_url único por workspace
  assert.match(migration, /unique[\s\S]{0,40}workspace_id[, ]+source_url/);
  assert.match(migration, /unique[\s\S]{0,40}workspace_id[, ]+asset_id/);
});

// ── API /api/photos: auth editor escribe, viewer lee, dbUserId cast ─────────

test("rutas photos: writes con canAccessWorkspace 'editor', lecturas 'viewer'", () => {
  for (const path of ["/documents", "/documents/:id/versions", "/documents/:id/restore", "/catalog", "/composition"]) {
    assert.ok(photosRoute.includes(path), `ruta faltante: ${path}`);
  }
  // 4 sitios 'editor': POST /documents, loadDocumentForWrite (compartido por
  // versions+restore), PUT catalog y PUT composition; 3 sitios 'viewer':
  // GET documents+catalog y GET composition.
  assert.equal(count(photosRoute, '"editor"'), 4);
  assert.equal(count(photosRoute, '"viewer"'), 3);
  assert.ok(photosRoute.includes("loadDocumentForWrite"));
  assert.match(photosRoute, /UUID_RE\.test\(userId\) \? userId : null/);
});

// ── Wiring del editor (EditorV2) ─────────────────────────────────────────────

test("EditorV2: el overlay de foto es dueño del teclado (guard junto al de video)", () => {
  assert.ok(editorV2.includes("videoModeOpenRef.current || photoModeOpenRef.current"));
  assert.match(editorV2, /photoModeOpenRef\.current = photoModeOpen;/);
});

test("EditorV2: rama photo en el ternary del canvas-area, embebida como video", () => {
  const ternary = sourceSlice(editorV2, ") : photoModeOpen ? (", ") : loading ? (");
  assert.match(ternary, /<PhotoModeOverlay/);
  assert.match(ternary, /initialTarget=\{photoModeTarget\}/);
  assert.match(ternary, /onApplyToLayer=\{handlePhotoApplyToLayer\}/);
  assert.match(ternary, /onApplyToAllInstances=\{handlePhotoApplyToAllInstances\}/);
});

test("EditorV2: aplicar a la capa preserva el original (data-orig-src se escribe UNA vez)", () => {
  const block = sourceSlice(editorV2, "const handlePhotoApplyToLayer", "const handlePhotoApplyToAllInstances");
  assert.match(block, /"data-orig-src": getLayerAttribute\(html, target\.layerId, "data-orig-src"\) \|\| target\.src/);
  assert.match(block, /"data-photo-recipe": recipeAttr/);
  // huérfanos: el variante también actualiza canvasObjects vía commitCanvasObjects
  assert.match(block, /commitCanvasObjects\(/);
});

test("EditorV2: todas las instancias barre frames+huérfanos por MISMO src en un lote", () => {
  const block = sourceSlice(editorV2, "const handlePhotoApplyToAllInstances", "const handleOpenPhotoMode");
  assert.match(block, /parseFrameImages\(/);
  assert.match(block, /t\.src !== src/);
  assert.match(block, /store\.replaceAllWithUndo\(updated, "edit"\)/);
});

test("EditorV2: botón topbar Foto con IconCamera, hermano del de Video", () => {
  const block = sourceSlice(editorV2, "editor-v2-topbar-label\">Video</span>", "editor-v2-topbar-sep");
  assert.match(block, /IconCamera size=\{14\}/);
  assert.match(block, /editor-v2-topbar-label">Foto</);
});

// ── Overlay: pureza del camino del slider + confirm de §2 ────────────────────

test("PhotoModeOverlay: el Slider NO toca la red (onChange solo sube estado)", () => {
  const slider = sourceSlice(overlay, "function Slider(", "// ── Editor de curva");
  assert.doesNotMatch(slider, /apiFetch|fetch\(/);
  // snapshot para undo en el gesto (pointerdown/flechas), commit diferido
  assert.match(slider, /onPointerDown=\{onCommitStart\}/);
  assert.match(slider, /onChange=\{e => onChange\(parseFloat\(e\.target\.value\)\)\}/);
});

test("PhotoModeOverlay: la variante sale JPEG q0.92 tope 4096 y sube SOLO en la acción explícita", () => {
  const build = sourceSlice(overlay, "const buildVariant", "const uploadVariant");
  assert.match(build, /renderToBlob\("image\/jpeg", 0\.92, maxSide\)/);
  const upload = sourceSlice(overlay, "const uploadVariant", "const handleApplyToLayer");
  assert.match(upload, /\/api\/assets\/upload/);
  assert.match(upload, /4096/);
});

test("PhotoModeOverlay: aplicar a todas las instancias exige window.confirm (REQ §2)", () => {
  const applyAll = sourceSlice(overlay, "const handleApplyToAll", "const handleSaveRecipe");
  assert.match(applyAll, /window\.confirm\(/);
});

// ── Engine WebGL2: orientación + geometría + recuperación de contexto ───────

test("photoEngine: convención Y-ABAJO única (vERT invertido, sin UNPACK_FLIP_Y)", () => {
  const engine = readFileSync(ROOT + "src/lib/photoEngine.ts", "utf8");
  // v=0 arriba: sin esto el visor sale espejado y las máscaras actúan al revés
  assert.match(engine, /vUV = vec2\(aPos\.x, -aPos\.y\) \* 0\.5 \+ 0\.5/);
  // fuente y brush se suben SIN flip (mismo espacio que la UI)
  assert.doesNotMatch(engine, /UNPACK_FLIP_Y_WEBGL/);
});

test("photoEngine: uSrcMat se sube con transpose=true (composeGeometryMatrix es row-major)", () => {
  const engine = readFileSync(ROOT + "src/lib/photoEngine.ts", "utf8");
  assert.match(engine, /uniformMatrix3fv\(this\.loc\("uSrcMat"\), true, mat\.mat\)/);
  assert.doesNotMatch(engine, /uniformMatrix3fv\(this\.loc\("uSrcMat"\), false/);
});

test("PhotoModeOverlay: recuperación de contexto WebGL y histograma limpio por foto", () => {
  assert.match(overlay, /addEventListener\("webglcontextlost"/);
  assert.match(overlay, /addEventListener\("webglcontextrestored"/);
  // el histograma viejo es de otra foto: se limpia al cambiar de target
  assert.match(overlay, /setHistogram\(null\)/);
});

// ── Fase 3: Biblioteca (catálogo del workspace) ──────────────────────────

test("PhotoLibraryPanel: lee /api/photos/catalog, filtra (culling) y persiste por assetId", () => {
  const lib = readFileSync(ROOT + "src/components/PhotoLibraryPanel.tsx", "utf8");
  assert.match(lib, /\/api\/photos\/catalog\?workspaceId=/);
  assert.match(lib, /method: "PUT"/);
  // MISMA derivación de assetId que visor/API/MCP → misma fila del catálogo
  assert.match(lib, /assetIdFromUrl/);
  assert.match(lib, /assetId: row\.asset_id/);
  // filtros de culling: texto, rating mínimo y flag
  assert.match(lib, /minRating/);
  assert.match(lib, /flagFilter/);
  // solo abre fotos presentes en el diseño actual
  assert.match(lib, /inDesign/);
});

test("Biblioteca integrada al overlay: pestaña + assetId unificado en shared", () => {
  assert.match(overlay, /"biblioteca"/);
  assert.match(overlay, /PhotoLibraryPanel/);
  // el helper ya NO es local del overlay: vive en shared/photoTargets.ts
  assert.doesNotMatch(overlay, /function assetIdFromUrl/);
  const targets = readFileSync(ROOT + "shared/photoTargets.ts", "utf8");
  assert.match(targets, /export function assetIdFromUrl/);
});
