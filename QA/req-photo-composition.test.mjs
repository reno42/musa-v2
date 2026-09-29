/**
 * QA — REQ-PHOTO-FASE4: Modo Composición (capas raster estilo Photoshop).
 *
 * Cubre:
 *   1. shared/photoComposition.ts — contrato puro (blends, caps, normalize).
 *   2. supabase_migrations_v60.sql — photo_compositions (TEXT ws + RLS + idem).
 *   3. api/src/routes/photos.ts — GET/PUT /api/photos/composition.
 *   4. PhotoModeOverlay.tsx — modo compose, pincel/mover, flatten, persistencia.
 *   5. PhotoComposePanel.tsx — panel de capas.
 *
 * Run: npm run test:regression (o: node --experimental-strip-types --test QA/req-photo-composition.test.mjs)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  blendToCanvasOp, COMPOSITION_BLENDS, COMPOSITION_SCHEMA_VERSION,
  createPaintLayer, MAX_COMPOSITION_LAYERS, MAX_LAYER_DATAURL_CHARS,
  normalizeCompositionLayers,
} from "../shared/photoComposition.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

// ── 1. shared/photoComposition.ts ─────────────────────────────────────────

test("F4.2d: COMPOSITION_BLENDS tiene los 16 blends con primitiva CSS/canvas", () => {
  assert.equal(COMPOSITION_BLENDS.length, 16);
  assert.deepEqual(
    [...COMPOSITION_BLENDS].sort(),
    [
      "color", "color-burn", "color-dodge", "darken", "difference", "exclusion",
      "hard-light", "hue", "lighten", "luminosity", "multiply", "normal",
      "overlay", "saturation", "screen", "soft-light",
    ],
  );
});

test("F4: blendToCanvasOp mapea normal→source-over y passthrough el resto", () => {
  assert.equal(blendToCanvasOp("normal"), "source-over");
  assert.equal(blendToCanvasOp("multiply"), "multiply");
  assert.equal(blendToCanvasOp("soft-light"), "soft-light");
});

test("F4: caps del módulo coinciden con el contracto del API", () => {
  assert.equal(MAX_COMPOSITION_LAYERS, 12);
  assert.equal(MAX_LAYER_DATAURL_CHARS, 3_000_000);
  assert.equal(COMPOSITION_SCHEMA_VERSION, 1);
});

test("F4: normalizeCompositionLayers clampa y descarta basura", () => {
  assert.deepEqual(normalizeCompositionLayers("no-array"), []);
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `l${i}`, dataUrl: "data:image/png;base64,AA" }));
  assert.equal(normalizeCompositionLayers(many).length, 12);
  const [clamped] = normalizeCompositionLayers([{ opacity: 5, blend: "no-existe", transform: { scale: 99, x: 10, rotation: 400 } }]);
  assert.equal(clamped.opacity, 1);
  assert.equal(clamped.blend, "normal");
  assert.equal(clamped.transform.scale, 8);
  assert.equal(clamped.transform.x, 2);
  assert.equal(clamped.transform.rotation, 180);
  // F4.2d: el guard de persistidas ya no filtra solo kind "paint" — la sonda
  // de clamp del dataUrl no debe ser persistida (una persistida sin contenido
  // se descarta: ver suite req-photo-compose-pro)
  const [junk] = normalizeCompositionLayers([{ dataUrl: "http://no-es-dataurl" }]);
  assert.equal(junk.dataUrl, "");
  // capa persistida SIN contenido = inválida
  assert.equal(normalizeCompositionLayers([{ kind: "paint", persisted: true, dataUrl: "" }]).length, 0);
});

test("F4: createPaintLayer crea capa por defecto pintable", () => {
  const l = createPaintLayer(0);
  assert.equal(l.kind, "paint");
  assert.equal(l.blend, "normal");
  assert.equal(l.opacity, 1);
  assert.equal(l.visible, true);
  assert.deepEqual(l.transform, { x: 0, y: 0, scale: 1, rotation: 0 });
  assert.equal(l.name, "Capa 1");
});

// ── 2. migración v60 ─────────────────────────────────────────────────────

test("F4: v60 crea photo_compositions con workspace TEXT + unique ws/source", () => {
  const sql = read("supabase_migrations_v60.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS photo_compositions/);
  // mismo criterio de tipos que v59: workspaces.id es TEXT
  assert.match(sql, /workspace_id TEXT NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  assert.match(sql, /UNIQUE \(workspace_id, source_url\)/);
  assert.match(sql, /layers_json JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
  assert.match(sql, /created_by UUID REFERENCES auth\.users\(id\)/);
});

test("F4: v60 RLS viewer-lee / editor-escribe e idempotente", () => {
  const sql = read("supabase_migrations_v60.sql");
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /"viewer can read compositions"[\s\S]*?has_workspace_role\(workspace_id, 'viewer'\)/);
  assert.match(sql, /"editor can write compositions"[\s\S]*?has_workspace_role\(workspace_id, 'editor'\)/);
  assert.match(sql, /"editor can update compositions"[\s\S]*?has_workspace_role\(workspace_id, 'editor'\)/);
  assert.match(sql, /"editor can delete compositions"[\s\S]*?has_workspace_role\(workspace_id, 'editor'\)/);
  // guard idempotente para ADD CONSTRAINT
  assert.match(sql, /IF NOT EXISTS \([\s\S]*?photo_compositions_id_prefix/);
});

// ── 3. API REST ──────────────────────────────────────────────────────────

test("F4: API expone GET/PUT /api/photos/composition con tenancy correcto", () => {
  const api = read("api/src/routes/photos.ts");
  assert.match(api, /photoRoutes\.get\("\/composition"/);
  assert.match(api, /photoRoutes\.put\("\/composition"/);
  const getPart = api.slice(api.indexOf('photoRoutes.get("/composition"'), api.indexOf('photoRoutes.put("/composition"'));
  assert.match(getPart, /canAccessWorkspace\(req\.auth, workspaceId, "viewer"\)/);
  assert.match(getPart, /\.maybeSingle\(\)/);
  const putPart = api.slice(api.indexOf('photoRoutes.put("/composition"'));
  assert.match(putPart, /canAccessWorkspace\(req\.auth, workspaceId, "editor"\)/);
  assert.match(putPart, /onConflict: "workspace_id,source_url"/);
  assert.match(putPart, /cmp_\$\{randomUUID\(\)\}/);
});

test("F4: API espeja los caps de capas y rechaza dataUrl gigante con 413", () => {
  const api = read("api/src/routes/photos.ts");
  // los consts viven en el bloque de composición (antes de las rutas)
  assert.match(api, /MAX_LAYERS = 12/);
  assert.match(api, /MAX_LAYER_CHARS = 3_000_000/);
  assert.match(api, /MAX_TOTAL_CHARS = 8_000_000/);
  const putPart = api.slice(api.indexOf('photoRoutes.put("/composition"'));
  assert.match(putPart, /413, "layer dataUrl exceeds 3MB"/);
  assert.match(putPart, /413, "composition exceeds 8MB"/);
});

// ── 4. PhotoModeOverlay ──────────────────────────────────────────────────

test("F4: overlay integra modo compose con stack DOM y herramientas", () => {
  const ov = read("src/components/PhotoModeOverlay.tsx");
  assert.match(ov, /"edit" \| "crop" \| "brush" \| "compose"/);
  assert.match(ov, /import \{ PhotoComposePanel \} from "\.\/PhotoComposePanel"/);
  // stack DOM: blend vía CSS (mismos nombres que globalCompositeOperation)
  assert.match(ov, /mixBlendMode: l\.blend as React\.CSSProperties\["mixBlendMode"\]/);
  // herramientas: pincel sobre master + goma + mover capa
  assert.match(ov, /const paintLayerAt = /);
  assert.match(ov, /destination-out/);
  assert.match(ov, /kind: "layer-paint"/);
  assert.match(ov, /kind: "layer-move"/);
  assert.match(ov, /onClick=\{enterComposeMode\}/);
});

test("F4: overlay persiste la composición y la resetea al cambiar de foto", () => {
  const ov = read("src/components/PhotoModeOverlay.tsx");
  assert.match(ov, /\/api\/photos\/composition\?workspaceId=\$\{encodeURIComponent\(workspaceId\)\}&sourceUrl=/);
  assert.match(ov, /method: "PUT",\s*\n\s*body: JSON\.stringify\(\{ workspaceId, sourceUrl: active\.src, layers: payload \}\)/);
  // al cambiar target las capas NUNCA arrastran a la otra foto
  assert.match(ov, /setComposeLayers\(\[\]\);\s*\n\s*setActiveLayerId\(null\);/);
  // masters offscreen = fuente de verdad; DOM = espejo
  assert.match(ov, /const ensureMasterCanvas = /);
  assert.match(ov, /layerCanvasesRef\.current\.get\(l\.id\)/);
});

test("F4: overlay aplana capas sobre el revelado para exportar/aplicar", () => {
  const ov = read("src/components/PhotoModeOverlay.tsx");
  assert.match(ov, /const flattenComposition = async /);
  assert.match(ov, /ctx\.globalCompositeOperation = blendToCanvasOp\(layer\.blend\)/);
  // la variante y el export usan el flatten SOLO si hay capas visibles
  assert.match(ov, /hasVisibleComposeLayers\s*\n\s*\? await flattenComposition/);
});

// ── 5. PhotoComposePanel ─────────────────────────────────────────────────

test("F4: panel de capas estilo Photoshop (blend/opacity/reorder/guardar)", () => {
  const panel = read("src/components/PhotoComposePanel.tsx");
  assert.match(panel, /COMPOSITION_BLENDS\.map\(b =>/);
  assert.match(panel, /type="range" min=\{0\} max=\{100\} value=\{Math\.round\(layer\.opacity \* 100\)\}/);
  assert.match(panel, /props\.onPatch\(layer\.id, \{ visible: !layer\.visible \}\)/);
  assert.match(panel, /props\.onMove\(layer\.id, 1\)/);
  assert.match(panel, /onClick=\{props\.onAdd\}/);
  assert.match(panel, /props\.onDelete\(layer\.id\)/);
  assert.match(panel, /Guardar composici/);
});
