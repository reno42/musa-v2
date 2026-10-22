// QA/req-vid11-video-timeline.test.mjs — REQ-VID11 timeline drag & drop.
// Lo puro (snap, trim con regla de oro, diff de autosave) se testea de verdad
// importándolo — incluida la prueba de CERO DRIFT cliente/servidor comparando
// targetDurForSource de ambos lados. Los contratos UI/store/ruta se afirman
// sobre el source (convención del repo: req-vid10). Corre con:
//   node --experimental-strip-types --test QA/req-vid11-video-timeline.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DROP_DUR_US,
  MIN_SEGMENT_DUR_US,
  SNAP_TOLERANCE_PX,
  US_PER_SECOND,
  computeTrimLeft,
  computeTrimRight,
  diffTreeOps,
  formatTimecode,
  snapCandidates,
  snapEdge,
  snapMove,
  targetDurForSource,
  usToPx,
  pxToUs,
} from "../src/lib/videoTimelineMath.ts";
import { targetDurForSource as serverTargetDurForSource } from "../api/src/services/videoProjects.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const timelineSource = read("src/components/video/ProjectTimeline.tsx");
const storeSource = read("src/lib/videoProjectStore.ts");
const appSource = read("src/App.tsx");
const routeSource = read("src/lib/appRoute.ts");
const dashboardSource = read("src/components/Dashboard.tsx");
const editorSource = read("src/pages/VideoProjectEditor.tsx");
const apiRoutesSource = read("api/src/routes/videoProjects.ts");
const apiServiceSource = read("api/src/services/videoProjects.ts");

// ── Timecode / conversiones ─────────────────────────────────────────────────

test("VID11 timecode: m:ss.d y h:mm:ss.mmm exactos, sin segundos flotando", () => {
  assert.equal(formatTimecode(0), "0:00.0");
  assert.equal(formatTimecode(65_500_000), "1:05.5");
  assert.equal(formatTimecode(3_600_000_000 + 1_000_000, 3), "1:00:01.000");
  assert.equal(formatTimecode(-2_500_000), "-0:02.5");
  assert.equal(usToPx(1_000_000, 1000), 1000);
  assert.equal(pxToUs(1000, 1000), 1_000_000);
});

// ── Snap magnético (8px) ────────────────────────────────────────────────────

test("VID11 snapEdge: dentro de tolerancia agarra el candidato; fuera redondea", () => {
  const cands = [1_000_000, 2_500_000];
  const tol = SNAP_TOLERANCE_PX * 1000; // 8px a 1000 µs/px = 8000 µs
  const hit = snapEdge(1_000_400, cands, tol);
  assert.equal(hit.value, 1_000_000);
  assert.equal(hit.guideUs, 1_000_000);
  const miss = snapEdge(1_010_000, cands, tol);
  assert.equal(miss.value, 1_010_000);
  assert.equal(miss.guideUs, null);
});

test("VID11 snapMove: head y tail compiten; gana el borde más cerca; clamp de maxStart", () => {
  // Grilla NO uniforme: el tail (start+1s = 2_000_600) está a 400µs de su
  // candidato y el head a 600µs del suyo → gana el tail.
  const cands = [0, 1_000_000, 2_000_200, 3_000_000];
  const tol = SNAP_TOLERANCE_PX * 1000;
  const byTail = snapMove(1_000_600, 1_000_000, cands, tol, 10_000_000);
  assert.equal(byTail.startUs, 1_000_200); // tail ancla a 2_000_200 → start = tail − dur
  assert.equal(byTail.guideUs, 2_000_200);
  // maxStart clampea el arranque (el bloque no escapa del window).
  const clamped = snapMove(9_900_000, 1_000_000, [], 1, 9_500_000);
  assert.equal(clamped.startUs, 9_500_000);
});

test("VID11 snapCandidates: excluye el propio bloque; incluye playhead y marcas 1s", () => {
  const cands = snapCandidates({
    excludeSegmentId: "yo",
    segments: [
      { id: "yo", target_start_us: 0, target_dur_us: 500_000 },
      { id: "otro", target_start_us: 2_000_000, target_dur_us: 1_000_000 },
    ],
    playheadUs: 750_000,
    windowEndUs: 2_600_000,
  });
  assert.ok(!cands.includes(500_000), "no ofrece el tail del bloque arrastrado (no es marca de 1s)");
  assert.ok(cands.includes(0), "el 0 es marca de 1s: candidato legítimo");
  assert.ok(cands.includes(2_000_000) && cands.includes(3_000_000));
  assert.ok(cands.includes(750_000), "playhead es candidato");
  assert.ok(cands.includes(1_000_000) && cands.includes(2_000_000), "marcas cada 1s");
});

// ── Regla de oro y CERO DRIFT cliente/servidor ──────────────────────────────

test("VID11 regla de oro: targetDurForSource del cliente ES la del service", () => {
  for (const [src, speed] of [[1_000_000, 1], [2_500_000, 0.5], [333_333, 2], [7, 100], [1, 0.01]]) {
    assert.equal(targetDurForSource(src, speed), serverTargetDurForSource(src, speed));
  }
});

// ── Trim: clamps CapCut espejando trimVideoSegment ──────────────────────────

const SEG = {
  target_start_us: 1_000_000,
  target_dur_us: 2_000_000,
  source_start_us: 500_000,
  source_dur_us: 2_000_000,
  speed: 2,
};

test("VID11 trimL: re-deriva target_dur con speed, mantiene borde derecho ±1µs", () => {
  // dt +250ms a speed 2 ⇒ source consume +500ms.
  const t = computeTrimLeft(SEG, 250_000, 10_000_000);
  assert.equal(t.source_start_us, 1_000_000); // 500_000 + 250_000×2
  assert.equal(t.source_dur_us, 1_500_000); // 2_000_000 − 500_000
  assert.equal(t.target_dur_us, 750_000); // round(1.5s / 2)
  assert.ok(Math.abs((t.target_start_us + t.target_dur_us) - (SEG.target_start_us + SEG.target_dur_us)) <= 1,
    "el borde derecho no se mueve más de 1µs");
});

test("VID11 trimL: nunca sale del source ni cruza el inicio; mínimo 1µs", () => {
  const pastStart = computeTrimLeft(SEG, -10_000_000, 10_000_000);
  assert.equal(pastStart.source_start_us, 0); // clamp a source_start ≥ 0
  const toNothing = computeTrimLeft(SEG, 10_000_000, 10_000_000);
  assert.equal(toNothing.target_dur_us, MIN_SEGMENT_DUR_US);
});

test("VID11 trimR: clampea al fin del material y deja el inicio intacto", () => {
  const matDur = 2_900_000; // 500_000 + 2_000_000 ya consumidos ⇒ margen 400_000µs source
  const t = computeTrimRight(SEG, 10_000_000, matDur);
  assert.equal(t.source_start_us, SEG.source_start_us);
  assert.ok(t.source_start_us + t.source_dur_us <= matDur, "no pasa el fin del material");
  assert.equal(t.target_start_us, SEG.target_start_us);
  assert.equal(t.target_dur_us, targetDurForSource(t.source_dur_us, 2));
});

test("VID11 trim de texto/sticker sin source: se materializa como el server", () => {
  const noSrc = { ...SEG, source_start_us: null, source_dur_us: null, speed: 1 };
  const t = computeTrimLeft(noSrc, 100_000, null);
  // dt +100ms a speed 1: el PATCH mandará sourceStartUs=100_000,
  // sourceDurUs=1_900_000 — exactamente el estado previsualizado.
  assert.equal(t.source_start_us, 100_000);
  assert.equal(t.source_dur_us, 1_900_000);
  assert.equal(t.target_dur_us, 1_900_000);
});

// ── diffTreeOps: el autosave manda lo mínimo, en orden ──────────────────────

const tree = (tracks, materials = []) => ({ tracks, materials });
const segRow = (over) => ({
  id: "s1", track_id: "t1", material_id: "m1",
  target_start_us: 0, target_dur_us: 1_000_000,
  source_start_us: 0, source_dur_us: 1_000_000,
  speed: 1, clip: null, extra_refs: [], ...over,
});

test("VID11 diff: move → un solo patch de targetStartUs; trim → ambos source", () => {
  const before = tree([{ id: "t1", type: "video", z_order: 0, segments: [segRow({})] }]);
  const moved = tree([{ id: "t1", type: "video", z_order: 0, segments: [segRow({ target_start_us: 1_500_000 })] }]);
  const [op] = diffTreeOps(before, moved);
  assert.deepEqual(op.body, { targetStartUs: 1_500_000 });

  const trimmed = tree([{ id: "t1", type: "video", z_order: 0, segments: [segRow({ source_start_us: 250_000, source_dur_us: 750_000, target_dur_us: 750_000 })] }]);
  const [op2] = diffTreeOps(before, trimmed);
  assert.deepEqual(op2.body, { sourceStartUs: 250_000, sourceDurUs: 750_000 });
});

test("VID11 diff: add nuevo → material.add, track.add, segment.add EN orden; delete → segment.delete", () => {
  const before = tree([], []);
  const after = tree(
    [{ id: "t1", type: "video", z_order: 0, segments: [segRow({ id: "vidseg_abc123456789" })] }],
    [{ id: "m1", kind: "video", payload: { url: "https://x/v.mp4" } }],
  );
  const ops = diffTreeOps(before, after);
  assert.deepEqual(ops.map((o) => o.type), ["material.add", "track.add", "segment.add"]);
  // El add lleva el id EXPLÍCITO (undo de delete re-crea la misma fila).
  assert.equal(ops[2].body.id, "vidseg_abc123456789");

  const deleted = tree([{ id: "t1", type: "video", z_order: 0, segments: [] }]);
  assert.deepEqual(diffTreeOps(after, deleted).map((o) => o.type), ["segment.delete"]);
  assert.deepEqual(diffTreeOps(before, before), []);
});

test("VID11 diff: clip transform → patch de clip; nada que cambiar → cero ops", () => {
  const before = tree([{ id: "t1", type: "video", z_order: 0, segments: [segRow({ clip: { x: 0 } })] }]);
  const after = tree([{ id: "t1", type: "video", z_order: 0, segments: [segRow({ clip: { x: 0.5 } })] }]);
  const [op] = diffTreeOps(before, after);
  assert.equal(op.type, "segment.patch");
  assert.deepEqual(op.body, { clip: { x: 0.5 } });
});

// ── Constantes compartidas ──────────────────────────────────────────────────

test("VID11 constantes: 8px de snap, 1s = 1e6 µs, drop default 5s", () => {
  assert.equal(SNAP_TOLERANCE_PX, 8);
  assert.equal(US_PER_SECOND, 1_000_000);
  assert.equal(DEFAULT_DROP_DUR_US, 5_000_000);
});

// ── Contratos UI/store/ruta afirmados sobre el source ───────────────────────

test("VID11 UI: SOLO pointer events (cero draggable/onMouseDown) + snap + guía + Ctrl+wheel", () => {
  assert.match(timelineSource, /onPointerDown/, "bloques con pointerdown");
  assert.match(timelineSource, /setPointerCapture/);
  assert.doesNotMatch(timelineSource, /draggable|onMouseDown|onMouseMove|onMouseUp/i,
    "aceptación: cero drag que no sea pointer events");
  assert.match(timelineSource, /snapMove|snapEdge/);
  assert.match(timelineSource, /SNAP_TOLERANCE_PX/);
  assert.match(timelineSource, /vp-guide/, "guía de alineación visible");
  assert.match(timelineSource, /ctrlKey/, "zoom con Ctrl+wheel");
  assert.match(timelineSource, /formatTimecode/, "timecode en vivo");
});

test("VID11 store: journal con coalescing, autosave diff a /api/video-projects, reconcilia al cargar", () => {
  assert.match(storeSource, /AUTOSAVE_DEBOUNCE_MS = 600/);
  assert.match(storeSource, /MAX_COMMANDS = 40/);
  assert.match(storeSource, /musa:videoProjectJournal:/);
  assert.match(storeSource, /diffTreeOps/);
  assert.match(storeSource, /\/api\/video-projects\//, "apiFetch compartido exige el prefijo /api");
  assert.match(storeSource, /syncFromServer/);
  // undo de un add de track/material (sin endpoint) se avisa una sola vez.
  assert.match(storeSource, /warnOrphanOnce/);
  assert.match(storeSource, /missingBaselineEntities/);
});

test("VID11 routing: #video/<projectId> + tab Video + atajos Ctrl+Z/Supr", () => {
  assert.match(routeSource, /"video"/, "tab video en WORKSPACE_TABS");
  assert.match(routeSource, /kind: "video", projectId/);
  assert.match(routeSource, /route.kind === "video"/, "la ruta de video exige cuenta");
  assert.match(appSource, /OPEN_VIDEO/);
  assert.match(appSource, /#video\//);
  assert.match(dashboardSource, /id: "video", label: "Video"/);
  assert.match(dashboardSource, /VideoProjectsTab/);
  assert.match(editorSource, /key === "z"/, "Ctrl+Z undo");
  assert.match(editorSource, /"Delete" \|\| e.key === "Backspace"/, "Supr elimina clip");
});

test("VID11 undo-of-delete: el service acepta id explícito con prefijo válido", () => {
  assert.match(apiServiceSource, /resolveExplicitId/);
  assert.match(apiServiceSource, /resolveExplicitId\(input\.id, "vidseg_"\)/);
  assert.match(apiServiceSource, /resolveExplicitId\(input\.id, "vidtrk_"\)/);
  assert.match(apiServiceSource, /resolveExplicitId\(input\.id, "vidmat_"\)/);
  assert.match(apiRoutesSource, /id: req\.body\?\.id/);
});
