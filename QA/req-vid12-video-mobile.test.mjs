// QA/req-vid12-video-mobile.test.mjs — REQ-VID12 editor de video en móvil.
// Lo puro (split con regla de oro por mitad) se testea de verdad importándolo.
// Los contratos UI/CSS (bottom sheet, toolbar contextual, pinch, 44px,
// fullscreen con scrub nativo) se afirman sobre el source (convención del
// repo: req-vid10/vid11). Corre con:
//   node --experimental-strip-types --test QA/req-vid12-video-mobile.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { genSegmentId, splitSegment, updateSegmentTiming } from "../src/components/video/videoDocOps.ts";
import { diffTreeOps, targetDurForSource } from "../src/lib/videoTimelineMath.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const editorSource = read("src/pages/VideoProjectEditor.tsx");
const toolbarSource = read("src/components/video/MobileToolbar.tsx");
const sheetSource = read("src/components/video/MobileSheet.tsx");
const timelineSource = read("src/components/video/ProjectTimeline.tsx");
const cssSource = read("src/index.css");

/** Doc mínimo: 1 track de video con un clip 0..4s (source 0..4s, speed 1). */
const seg = (over = {}) => ({
  id: "segA", track_id: "trkV", material_id: "matV",
  target_start_us: 0, target_dur_us: 4_000_000,
  source_start_us: 0, source_dur_us: 4_000_000, speed: 1,
  clip: null, extra_refs: [], ...over,
});
const doc = (segments) => ({
  project: { id: "p1", workspace_id: "ws", name: "t", fps: 30, canvas_w: 1080, canvas_h: 1920, ratio: "9:16", duration_us: 4_000_000, is_template: false },
  tracks: [{ id: "trkV", project_id: "p1", type: "video", z_order: 0, segments }],
  materials: [{ id: "matV", project_id: "p1", kind: "video", payload: { url: "https://x.com/a.mp4" }, slot: null }],
});

// ── Split puro: regla de oro por mitad ──────────────────────────────────────

test("VID12 splitSegment: mitad izq conserva id, derecha nace con id nuevo; timing exacto", () => {
  const next = splitSegment(doc([seg()]), "segA", 1_000_000, "segB");
  assert.ok(next, "split al medio debe funcionar");
  const [left, right] = next.tracks[0].segments;
  assert.equal(left.id, "segA");
  assert.equal(right.id, "segB");
  assert.equal(left.target_start_us, 0);
  assert.equal(left.target_dur_us, 1_000_000);
  assert.equal(left.source_start_us, 0);
  assert.equal(left.source_dur_us, 1_000_000);
  assert.equal(right.target_start_us, 1_000_000);
  assert.equal(right.target_dur_us, 3_000_000);
  assert.equal(right.source_start_us, 1_000_000);
  assert.equal(right.source_dur_us, 3_000_000);
});

test("VID12 splitSegment con speed: source' = round(target' × speed) en AMBAS mitades", () => {
  // target 0..2s, source 0..4s, speed 2 → split en 1s de target.
  const fast = seg({ target_dur_us: 2_000_000, source_dur_us: 4_000_000, speed: 2 });
  const next = splitSegment(doc([fast]), "segA", 1_000_000, "segB");
  assert.ok(next);
  const [left, right] = next.tracks[0].segments;
  assert.equal(left.target_dur_us, 1_000_000);
  assert.equal(left.source_dur_us, 2_000_000); // 1s × 2
  assert.equal(right.target_start_us, 1_000_000);
  assert.equal(right.target_dur_us, 1_000_000);
  assert.equal(right.source_start_us, 2_000_000); // continúa el source
  assert.equal(right.source_dur_us, 2_000_000);
  // La regla de oro se sostiene exacta por mitad.
  for (const s of [left, right]) {
    assert.equal(s.source_dur_us, Math.round(s.target_dur_us * 2));
  }
});

test("VID12 splitSegment materializa el source de clips sin source (texto)", () => {
  const text = seg({ id: "segT", material_id: "matT", source_start_us: null, source_dur_us: null });
  const next = splitSegment(doc([text]), "segT", 3_000_000, "segT2");
  assert.ok(next);
  const [left, right] = next.tracks[0].segments;
  // El server resuelve source null como start 0 + dur = target: el doc
  // cliente nace IDÉNTICO a lo que el PATCH/ADD va a escribir (cero drift).
  assert.equal(left.source_start_us, 0);
  assert.equal(left.source_dur_us, 3_000_000);
  assert.equal(right.source_start_us, 3_000_000);
  assert.equal(right.source_dur_us, 1_000_000);
});

test("VID12 splitSegment: fuera de rango (mitades < 1µs) → null, sin romper el doc", () => {
  assert.equal(splitSegment(doc([seg()]), "segA", 0, "segB"), null);
  assert.equal(splitSegment(doc([seg()]), "segA", 4_000_000, "segB"), null);
  assert.equal(splitSegment(doc([seg()]), "segA", 99_000_000, "segB"), null);
  assert.equal(splitSegment(doc([seg()]), "nope", 1_000_000, "segB"), null);
});

test("VID12 genSegmentId: vidseg_ + 12 hex (aceptado por resolveExplicitId)", () => {
  const id = genSegmentId();
  assert.match(id, /^vidseg_[0-9a-f]{12}$/);
  assert.notEqual(genSegmentId(), id);
});

test("VID12 velocidad rápida: regla de oro target' = round(source' / speed')", () => {
  assert.equal(targetDurForSource(4_000_000, 2), 2_000_000);
  assert.equal(targetDurForSource(4_000_000, 0.5), 8_000_000);
  assert.equal(targetDurForSource(1, 100), 1);
  // El editor recalcula target y congela source — mismo helper que el server.
  const d = doc([seg()]);
  const next = updateSegmentTiming(d, "segA", {
    target_start_us: 0,
    target_dur_us: targetDurForSource(4_000_000, 2),
    source_start_us: 0,
    source_dur_us: 4_000_000,
    speed: 2,
  });
  assert.equal(next.tracks[0].segments[0].target_dur_us, 2_000_000);
  assert.equal(next.tracks[0].segments[0].source_dur_us, 4_000_000);
  assert.equal(next.tracks[0].segments[0].speed, 2);
});

// ── Contratos UI (source asserts) ───────────────────────────────────────────

test("VID12 editor: matchMedia 768px es la verdad; sheet + toolbar + server-first", () => {
  assert.match(editorSource, /matchMedia\("\(max-width: 768px\)"\)/);
  assert.match(editorSource, /<MobileToolbar/);
  assert.match(editorSource, /<MobileSheet/);
  // server-first: apply + absorbSaved (sin re-POST duplicado del autosave)
  assert.match(editorSource, /const applyServerDoc = useCallback/);
  assert.match(editorSource, /store\.apply\(next, meta\);\s*\n\s*store\.absorbSaved\(next\);/);
  assert.match(editorSource, /onServerDocChange=\{applyServerDoc\}/);
});

test("VID12 editor: dividir en playhead y velocidad por regla de oro", () => {
  assert.match(editorSource, /splitSegment\(store\.getSnapshot\(\), selectedSegmentId, playheadUs, genSegmentId\(\)\)/);
  assert.match(editorSource, /label: "dividir clip"/);
  assert.match(editorSource, /targetDurForSource\(srcDur0, v\)/);
  assert.match(editorSource, /coalesceKey: `speed:\$\{seg\.id\}`/);
});

test("VID12 editor: preview fullscreen con scrub nativo (input range, µs)", () => {
  assert.match(editorSource, /<div className="vp-fullscreen" ref=\{stageWrapRef\}>/);
  assert.match(editorSource, /type="range"/);
  assert.match(editorSource, /max=\{endUs\}/);
  assert.match(editorSource, /step=\{1000\}/);
  assert.match(editorSource, /formatTimecode\(playheadUs\)/);
  assert.match(editorSource, /contentEndUs\(doc\)/);
  assert.match(editorSource, /variant="fullscreen"/);
  assert.match(editorSource, /requestFullscreen/);
});

test("VID12 toolbar contextual: sin selección agrega; clip = dividir/velocidad/efecto; texto = estilo", () => {
  assert.match(toolbarSource, /mode === "add"/);
  assert.match(toolbarSource, /mode === "clip"/);
  assert.match(toolbarSource, /mode === "text"/);
  assert.match(toolbarSource, /Dividir/);
  assert.match(toolbarSource, /\[0\.5, 1, 2\]/);
  assert.match(toolbarSource, /Efecto/);
  assert.match(toolbarSource, /Estilo/);
  // Agregar es server-first: POST material + POST segment → applyServerDoc
  assert.match(toolbarSource, /\/materials/);
  assert.match(toolbarSource, /\/segments/);
  assert.match(toolbarSource, /onServerDocChange\(\{ \.\.\.doc, materials, tracks \}/);
});

test("VID12 bottom sheet: tabs props/efectos/estilo; estilo via material.patch", () => {
  assert.match(sheetSource, /"props"/);
  assert.match(sheetSource, /"effects"/);
  assert.match(sheetSource, /"style"/);
  assert.match(sheetSource, /<InspectorPanel/);
  assert.match(sheetSource, /<EffectPicker/);
  // El estilo vive en payload.style y viaja como material.patch del autosave
  assert.match(sheetSource, /payload: \{ \.\.\.m\.payload, style: \{ \.\.\.style, \.\.\.patch \} \}/);
  assert.match(sheetSource, /coalesceKey: `style:\$\{material\.id\}`/);
});

test("VID12 timeline touch: pinch anclado al punto medio, SOLO pointer events", () => {
  assert.match(timelineSource, /pointerdown/i);
  assert.doesNotMatch(timelineSource, /\btouchstart\b|\btouchmove\b/); // cero listeners touch nativos
  assert.match(timelineSource, /pinchRef/);
  assert.match(timelineSource, /zoomAnchor/);
  assert.match(timelineSource, /onZoomChange\(/);
  assert.match(timelineSource, /scrollTop/); // drag vertical en zona vacía
});

// ── Contratos CSS (44px, ≤768px, thick handles, 16px anti-zoom iOS) ─────────

test("VID12 CSS: media query 768px oculta bin/inspector directos (la sheet los reemplaza)", () => {
  assert.match(cssSource, /@media \(max-width: 768px\)/);
  assert.match(cssSource, /\.vp-editor-body > \.vp-bin,/) ;
  assert.match(cssSource, /\.vp-editor-body > \.vp-inspector \{ display: none; \}/);
});

test("VID12 CSS: targets ≥44px en toolbar y sheet; handles gruesos en touch", () => {
  assert.match(cssSource, /\.vp-mobile-toolbar \.vp-btn \{ min-height: 44px/);
  assert.match(cssSource, /\.vp-sheet-tab \{ flex: 1; min-height: 44px/);
  assert.match(cssSource, /\.vp-sheet-close \{[^}]*44px/);
  assert.match(cssSource, /\.vp-tl-scroll \{ touch-action: pan-x; \}/);
  assert.match(cssSource, /\.vp-block-handle \{ width: 24px; \}/);
  assert.match(cssSource, /\.vp-editor input, \.vp-editor textarea, \.vp-editor select \{ font-size: 16px; \}/);
});

test("VID12 CSS: fullscreen + scrub con área de dedo", () => {
  assert.match(cssSource, /\.vp-fullscreen \{ position: fixed; inset: 0;/);
  assert.match(cssSource, /\.vp-fs-scrub \{ flex: 1; height: 44px;/);
  assert.match(cssSource, /\.vp-stage-fullscreen/);
});

// ── Regresión (QA en navegador 13 Oct 2026): el 2× del toolbar veía el UI
// cambiado y badge "Guardado", pero diffTreeOps no emitía ops (speed fuera
// del diff) → autosave adoptaba el doc sin PATCH y el reload perdía el cambio.

test("VID12 autosave diff: cambio de velocidad EMITE segment.patch con speed", () => {
  // La velocidad cambia target_dur (regla de oro) sin tocar source ya
  // materializado: el diff no puede quedarse en 0 ops.
  const before = doc([seg()]);
  const after = doc([seg({ target_dur_us: 2_000_000, speed: 2 })]);
  const ops = diffTreeOps(before, after);
  const patch = ops.find((o) => o.type === "segment.patch" && o.segmentId === "segA");
  assert.ok(patch, "diffTreeOps debe emitir segment.patch para un cambio de speed");
  assert.equal(patch.body.speed, 2);
});

test("VID12 PATCH server: rama speed (tras trim) + servicio con regla de oro", () => {
  const routesSource = read("api/src/routes/videoProjects.ts");
  const serviceSource = read("api/src/services/videoProjects.ts");
  assert.match(
    routesSource,
    /if \(body\.speed !== undefined\) \{\s*segment = await setSegmentSpeed\(projectId, segmentId, body\.speed\);/,
  );
  assert.match(serviceSource, /export async function setSegmentSpeed/);
  // El server materializa source con la speed VIEJA y re-deriva con la nueva.
  assert.match(serviceSource, /Math\.round\(segment\.target_dur_us \* oldSpeed\)/);
  assert.match(serviceSource, /targetDurForSource\(sourceDur, v\)/);
});
