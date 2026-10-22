// QA/req-vid13-video-templates.test.mjs — REQ-VID13 plantillas con slots +
// importador one-off de drafts CapCut. El mapper del importador es puro y se
// testea de verdad (µs passthrough, texto doble-codificado, companions de
// extra_material_refs, dict de materials, síntesis de overlay). Los contratos
// de UI/servicio se afirman sobre el source. Corre con:
//   node --experimental-strip-types --test QA/req-vid13-video-templates.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  decodeDraftText,
  isImportableUrl,
  mapCanvas,
  mapClip,
  mapDraft,
} from "../scripts/import-capcut-draft.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const tabSource = read("src/components/video/VideoProjectsTab.tsx");
const apiRoutesSource = read("api/src/routes/videoProjects.ts");
const apiServiceSource = read("api/src/services/videoProjects.ts");
const importerSource = read("scripts/import-capcut-draft.mjs");

// ── decodeDraftText: doble codificación de CapCut ────────────────────────────

test("VID13 texto: plain, JSON-string (doble), doble-doble y objeto {text}", () => {
  assert.equal(decodeDraftText("Hola mundo"), "Hola mundo");
  assert.equal(decodeDraftText('"Hola mundo"'), "Hola mundo");
  assert.equal(decodeDraftText(JSON.stringify(JSON.stringify({ text: "Doble" }))), "Doble");
  assert.equal(decodeDraftText(JSON.stringify({ text: "Directo" })), "Directo");
  assert.equal(decodeDraftText('{"text":"Con \\"comillas\\""}'), 'Con "comillas"');
});

// ── mapCanvas / mapClip / URLs ───────────────────────────────────────────────

test("VID13 canvas: ratio original → w:h reducido; ratio explícito pasa igual", () => {
  assert.deepEqual(mapCanvas({ width: 1080, height: 1920, ratio: "original" }), { canvasW: 1080, canvasH: 1920, ratio: "9:16" });
  assert.deepEqual(mapCanvas({ width: 1920, height: 1080 }), { canvasW: 1920, canvasH: 1080, ratio: "16:9" });
  assert.equal(mapCanvas({ width: 1080, height: 1920, ratio: "9:16" }).ratio, "9:16");
});

test("VID13 clip: normalizado a ClipTransform (clamp x/y −1..1, flip bool, null si falta)", () => {
  assert.deepEqual(mapClip({
    alpha: 0.9, rotation: 5, scale_x: 1.2, scale_y: 1.2,
    transform: { x: 0.1, y: -0.2 }, flip: { x: true, y: false },
  }), { x: 0.1, y: -0.2, scale: 1.2, rotation: 5, alpha: 0.9, flip: { x: true, y: false } });
  assert.equal(mapClip(undefined), null);
  assert.equal(mapClip({}).flip, null);
  // clamp de alpha y scale
  assert.equal(mapClip({ alpha: 7, scale_x: 900 }).alpha, 1);
  assert.equal(mapClip({ alpha: 7, scale_x: 900 }).scale, 100);
});

test("VID13 URLs: http(s) y /absoluta importan; disco Windows queda marcada local", () => {
  assert.equal(isImportableUrl("https://cdn.x.com/a.mp4"), true);
  assert.equal(isImportableUrl("/Users/x/Movies/a.mp4"), true);
  assert.equal(isImportableUrl("C:/Media/a.mp4"), false);
  assert.equal(isImportableUrl(""), false);
});

// ── mapDraft: fixture CapCut end-to-end ──────────────────────────────────────

const FIXTURE = {
  canvas_config: { width: 1080, height: 1920, ratio: "original" },
  duration: 9_000_000,
  fps: 30,
  materials: {
    videos: [{ id: "v1", path: "https://cdn.x.com/a.mp4", duration: 8_000_000 }],
    audios: [{ id: "a1", path: "https://cdn.x.com/b.mp3", duration: 9_000_000 }],
    texts: [
      { id: "t1", content: '{"text":"Hola mundo"}' },
      { id: "t2", content: JSON.stringify(JSON.stringify({ text: "Overlay" })) },
    ],
    stickers: [{ id: "s1", name: "Fire", resource_path: "res/fire" }],
    effects: [{ id: "e1", name: "Blur" }],
  },
  tracks: [
    {
      id: "trV", type: "video",
      segments: [{
        id: "sg1", material_id: "v1",
        target_timerange: { start: 0, duration: 3_000_000 },
        source_timerange: { start: 500_000, duration: 3_000_000 },
        speed: 2,
        clip: { alpha: 0.9, rotation: 5, scale_x: 1.2, scale_y: 1.2, transform: { x: 0.1, y: 0 }, flip: { x: false, y: false } },
        extra_material_refs: ["e1", "t2"],
      }],
    },
    { id: "trA", type: "audio", segments: [{ id: "sg2", material_id: "a1", target_timerange: { start: 0, duration: 4_000_000 }, speed: 1 }] },
    { id: "trX", type: "text", segments: [{ id: "sg3", material_id: "t1", target_timerange: { start: 1_000_000, duration: 2_000_000 }, speed: 1 }] },
  ],
};

test("VID13 mapDraft: µs passthrough exacto (target/source/speed/clip)", () => {
  const r = mapDraft(FIXTURE, { name: "Import" });
  assert.equal(r.project.fps, 30);
  assert.equal(r.project.canvasW, 1080);
  assert.equal(r.project.canvasH, 1920);
  assert.equal(r.project.ratio, "9:16");
  assert.equal(r.tracks.length, 3);
  assert.deepEqual(r.tracks.map((t) => t.type), ["video", "audio", "text"]);
  assert.deepEqual(r.tracks.map((t) => t.z_order), [0, 1, 2]);
  const byTrack = (type) => {
    const tr = r.tracks.find((t) => t.type === type);
    return r.segments.filter((s) => s.capcutTrackId === tr.ref);
  };
  const [v] = byTrack("video");
  assert.equal(v.target_start_us, 0);
  assert.equal(v.target_dur_us, 3_000_000); // µs SIN tocar
  assert.equal(v.source_start_us, 500_000);
  assert.equal(v.source_dur_us, 3_000_000);
  assert.equal(v.speed, 2);
  assert.equal(v.clip.scale, 1.2);
  assert.equal(v.clip.flip.x, false);
  const [a] = byTrack("audio");
  assert.equal(a.target_dur_us, 4_000_000);
  assert.equal(a.source_start_us, null); // CapCut no declara source en el audio
  const [t] = byTrack("text");
  assert.equal(t.target_start_us, 1_000_000);
  assert.equal(t.target_dur_us, 2_000_000);
});

test("VID13 mapDraft: dict de materials → un material nuevo por CapCut id", () => {
  const r = mapDraft(FIXTURE, { name: "Import" });
  const videos = r.materials.filter((m) => m.kind === "video");
  assert.equal(videos.length, 1);
  assert.equal(videos[0].payload.url, "https://cdn.x.com/a.mp4");
  assert.equal(videos[0].payload.durationUs, 8_000_000); // µs passthrough
  const texts = r.materials.filter((m) => m.kind === "text");
  assert.deepEqual(texts.map((m) => m.payload.text).sort(), ["Hola mundo", "Overlay"]);
});

test("VID13 mapDraft: extra_material_refs → companion kind=effect + extra_refs", () => {
  const r = mapDraft(FIXTURE, { name: "Import" });
  const tr = r.tracks.find((t) => t.type === "video");
  const [v] = r.segments.filter((s) => s.capcutTrackId === tr.ref);
  assert.equal(v.extraRefs.length, 1);
  const fx = r.materials.find((m) => m.ref === v.extraRefs[0]);
  assert.equal(fx.kind, "effect");
  assert.equal(fx.payload.builtin, false);
  assert.equal(fx.payload.manifest.name, "Blur");
  assert.equal(fx.payload.manifest.type, "draft:effect");
  assert.equal(typeof fx.payload.manifest.zorder, "number");
});

test("VID13 mapDraft: texto overlay (solo extra_material_refs) se sintetiza en el track de texto", () => {
  const r = mapDraft(FIXTURE, { name: "Import" });
  const textTr = r.tracks.find((t) => t.type === "text");
  const textSegs = r.segments.filter((s) => s.capcutTrackId === textTr.ref);
  assert.equal(textSegs.length, 2); // t1 (track propio) + t2 (overlay sintetizado)
  const overlay = textSegs.find((s) => s.target_start_us === 0 && s.target_dur_us === 3_000_000);
  assert.ok(overlay, "el overlay hereda el timing del anfitrión");
  assert.equal(overlay.source_start_us, null);
  assert.ok(r.warnings.some((w) => w.includes("sintetizado")));
});

test("VID13 mapDraft: ruta local se marca (Storage pendiente) sin romper el mapeo", () => {
  const r = mapDraft({
    canvas_config: { width: 1080, height: 1920 },
    fps: 30,
    materials: { videos: [{ id: "v1", path: "C:/Media/a.mp4", duration: 1_000_000 }] },
    tracks: [{ id: "trV", type: "video", segments: [{ id: "sg1", material_id: "v1", target_timerange: { start: 0, duration: 1_000_000 }, speed: 1 }] }],
  }, { name: "Local" });
  assert.deepEqual(r.localPaths, ["C:/Media/a.mp4"]);
  assert.equal(r.segments.length, 1);
});

test("VID13 mapDraft: duration_us del proyecto = fin del contenido (recompute)", () => {
  const r = mapDraft(FIXTURE, { name: "Import" });
  let end = 0;
  for (const s of r.segments) end = Math.max(end, s.target_start_us + s.target_dur_us);
  assert.equal(r.project.durationUs, end);
  assert.equal(r.project.durationUs, 4_000_000);
});

// ── Draft encriptado (CapCut nuevo) ──────────────────────────────────────────

test("VID13 draft encriptado: JSON.parse falla → aviso + exit 2 (sin escribir nada)", () => {
  assert.throws(() => JSON.parse("\u0000\u0001\u0002CifradoCapCut"), SyntaxError);
  assert.match(importerSource, /CIFRAN/);
  assert.match(importerSource, /process\.exit\(2\)/);
  // dry-run por defecto: sin --apply no hay POST
  assert.match(importerSource, /dry-run: no se escribió nada/);
  assert.match(importerSource, /args\.apply/);
});

// ── Contratos de servicio y UI (source asserts) ─────────────────────────────

test("VID13 rutas: register-template + instantiate registradas con gate editor", () => {
  assert.match(apiRoutesSource, /videoProjectRoutes\.post\("\/:projectId\/register-template"/);
  assert.match(apiRoutesSource, /videoProjectRoutes\.post\("\/:projectId\/instantiate"/);
  assert.match(apiRoutesSource, /instantiateVideoTemplate\(projectId, \{/);
});

test("VID13 service: slots validados, clone con clamp CapCut al nuevo source", () => {
  assert.match(apiServiceSource, /SLOTS_REQUIRED/);
  assert.match(apiServiceSource, /SLOT_DUPLICATED/);
  assert.match(apiServiceSource, /SLOT_KIND_INVALID/);
  assert.match(apiServiceSource, /SLOTS_MISSING/);
  assert.match(apiServiceSource, /NOT_TEMPLATE/);
  assert.match(apiServiceSource, /export async function registerVideoTemplate/);
  assert.match(apiServiceSource, /export async function instantiateVideoTemplate/);
  // El target se mantiene salvo material nuevo más corto (clamp CapCut)
  assert.match(apiServiceSource, /targetDurForSource\(sourceDur, s\.speed\)/);
  assert.match(apiServiceSource, /export function validateSlotMarker/);
});

test("VID13 UI: badge + botón Usar plantilla; dialog de slots instancia y abre", () => {
  assert.match(tabSource, /p\.is_template && <span className="vp-template-badge"/);
  assert.match(tabSource, /Usar plantilla/);
  assert.match(tabSource, /openInstantiate/);
  assert.match(tabSource, /\/instantiate`/);
  assert.match(tabSource, /name: tplName\.trim\(\) \|\| undefined, slots/);
  // video/audio → URL + duración en segundos convertida a µs SIEMPRE
  assert.match(tabSource, /payload\.durationUs = Math\.round\(secs \* 1_000_000\)/);
  assert.match(tabSource, /kind === "text"/);
  assert.match(tabSource, /onOpenProject\(newId\)/);
});
