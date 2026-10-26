/**
 * REQ-060 (merge de archivos) + REQ-061 (taxonomía) — QA del core compartido.
 *
 * Cubre las funciones puras que sirven por igual a MCP y REST:
 *   - shared/templatesMerge.ts  → normalizeMergeSources, collectSourceFrames,
 *     frameContentHash, effectiveDurationSec, planTemplateMerge,
 *     executeTemplateMerge (append + manifest + transiciones + estilos +
 *     dedupe + videoTimeline).
 *   - shared/tagNormalize.ts    → normalizeTagInput, normalizeTagList,
 *     buildAliasMap, applyTagAliases.
 *
 * Run: node --experimental-strip-types --test QA/req060-merge-taxonomy.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMergeSources,
  collectSourceFrames,
  frameContentHash,
  effectiveDurationSec,
  planTemplateMerge,
  executeTemplateMerge,
} from "../shared/templatesMerge.ts";
import {
  normalizeTagInput,
  normalizeTagList,
  buildAliasMap,
  applyTagAliases,
} from "../shared/tagNormalize.ts";

const mkFrame = (id, extra = {}) => ({
  id,
  name: `Frame ${id}`,
  ...extra,
});

// ── Normalización de fuentes ────────────────────────────────

test("normalizeMergeSources: strings, objetos, dedupe y mínimo 2", () => {
  const out = normalizeMergeSources([
    "a",
    { id: "b", frameIds: ["f1", "", "f2"] },
    { templateId: "c" },
    "a",
  ]);
  assert.deepEqual(out.map(s => s.id), ["a", "b", "c"]);
  assert.deepEqual(out[1].frameIds, ["f1", "f2"]);
  assert.equal(out[2].frameIds, undefined);

  assert.throws(() => normalizeMergeSources("nope"), /sources must be an array/);
  assert.throws(() => normalizeMergeSources(["a", {}]), /each source needs an id/);
  assert.throws(() => normalizeMergeSources(["a"]), /at least 2 sources/);
});

test("collectSourceFrames: subset por frameIds preserva orden y reporta faltantes", () => {
  const data = { frames: [mkFrame("f1"), mkFrame("f2"), mkFrame("f3")] };
  const r = collectSourceFrames(data, { id: "a", frameIds: ["f3", "f1", "zz"] });
  assert.deepEqual(r.frames.map(f => f.id), ["f3", "f1"]);
  assert.equal(r.total, 3);
  assert.deepEqual(r.missing, ["zz"]);
  // Sin frameIds: todos los frames.
  assert.deepEqual(collectSourceFrames(data, { id: "a" }).frames.length, 3);
});

test("frameContentHash ignora campos volátiles (ids, nombres, timestamps)", () => {
  const a = mkFrame("f1", { layers: [{ type: "text" }] });
  const b = { ...a, id: "f2", name: "Otro", layerId: "L9", createdAt: 1, updatedAt: 2 };
  assert.equal(frameContentHash(a), frameContentHash(b));
  assert.notEqual(frameContentHash(a), frameContentHash({ ...a, layers: [{ type: "rect" }] }));
});

test("effectiveDurationSec: máximo entre duraciones de frames y fin de clips", () => {
  assert.equal(effectiveDurationSec(null), 0);
  assert.equal(
    effectiveDurationSec({ frames: [mkFrame("f1", { animation: { timeline: { durationSec: 2.5 } } })] }),
    2.5,
  );
  assert.equal(
    effectiveDurationSec({ frames: [], videoTimeline: { videoClips: [{ startSec: 2, durationSec: 3 }] } }),
    5,
  );
});

// ── Plan (dry-run) ──────────────────────────────────────────

test("planTemplateMerge: nombre por defecto, modo new y conteos por fuente", () => {
  const A = { id: "a", name: "Guía 2026", data: { frames: [mkFrame("f1"), mkFrame("f2")], engine: "html", width: 1080, height: 1080 } };
  const B = { id: "b", name: "Deck ventas", data: { frames: [mkFrame("g1")], engine: "html", width: 1080, height: 1080 } };
  const C = { id: "c", name: "Extra", data: { frames: [mkFrame("h1")], engine: "html", width: 1080, height: 1080 } };
  const plan = planTemplateMerge({ sources: [{ id: "a" }, { id: "b" }], resolved: [A, B] });
  assert.equal(plan.target.mode, "new");
  assert.equal(plan.target.name, "Fusión: Guía 2026 + Deck ventas");
  assert.equal(plan.target.currentFrames, 0);
  assert.equal(plan.perSource[0].framesSelected, 2);
  assert.equal(plan.perSource[1].framesTotal, 1);
  assert.equal(plan.warnings.length, 0);
  assert.ok(plan.estimatedBytes > 0);
  assert.equal(plan.videoTimeline, null);

  const plan3 = planTemplateMerge({ sources: [{ id: "a" }, { id: "b" }, { id: "c" }], resolved: [A, B, C] });
  assert.equal(plan3.target.name, "Fusión: Guía 2026 + Deck ventas (+1)");
});

test("planTemplateMerge: warnings de fuente faltante, vacía, motor, tamaño y duplicados", () => {
  const twin = mkFrame("f1", { layers: [{ type: "text", text: "hola" }] });
  const A = {
    id: "a", name: "A",
    data: { frames: [twin, { ...twin, id: "f1c", name: "copia" }], engine: "html", width: 1080, height: 1080 },
  };
  const B = { id: "b", name: "B", data: { frames: [], engine: "pptx", width: 1920, height: 1080 } };
  const plan = planTemplateMerge({ sources: [{ id: "a" }, { id: "b" }, { id: "ghost" }], resolved: [A, B] });
  const codes = plan.warnings.map(w => w.code);
  assert.ok(codes.includes("SOURCE_MISSING"));
  assert.ok(codes.includes("EMPTY_SOURCE"));
  assert.ok(codes.includes("ENGINE_MISMATCH"));
  assert.ok(codes.includes("DIMENSION_MISMATCH"));
  // Contenido idéntico salvo id/nombre → un grupo de duplicados con 2 frames.
  assert.equal(plan.duplicates.length, 1);
  assert.equal(plan.duplicates[0].frames.length, 2);

  const plan2 = planTemplateMerge({
    sources: [{ id: "a" }, { id: "b" }], resolved: [A, B],
    target: { id: "t", name: "Base", data: { frames: [mkFrame("t1")] } },
  });
  assert.equal(plan2.target.mode, "append");
  assert.equal(plan2.target.name, "Base");
  assert.equal(plan2.target.currentFrames, 1);
});

// ── Execute (merge puro) ────────────────────────────────────

test("executeTemplateMerge: append conserva frames del target y manifest completa", () => {
  const target = { id: "t", name: "Base", data: { frames: [mkFrame("t1")], engine: "html", width: 1080, height: 1080 } };
  const A = { id: "a", name: "A", data: { frames: [mkFrame("a1"), mkFrame("a2")], engine: "html", width: 1080, height: 1080 } };
  const B = { id: "b", name: "B", data: { frames: [mkFrame("b1")], engine: "html", width: 1080, height: 1080 } };
  const res = executeTemplateMerge({
    sources: [{ id: "a" }, { id: "b" }], resolved: [A, B],
    target: { id: "t", name: "Base", data: target.data },
  });
  // 1 del target (intacto, mismo id) + 3 appendeados con ids frescos.
  assert.equal(res.frameCount, 4);
  assert.equal(res.data.frames[0].id, "t1");
  const newIds = res.data.frames.slice(1).map(f => f.id);
  assert.ok(newIds.every(id => !["a1", "a2", "b1"].includes(id)));
  assert.deepEqual(res.perSourceFrames, { a: 2, b: 1 });
  // Manifest: una entrada por frame de cada fuente, from → to.
  assert.equal(res.manifest.a.length, 2);
  assert.equal(res.manifest.b.length, 1);
  assert.deepEqual(res.manifest.a.map(e => e.from).sort(), ["a1", "a2"]);
  assert.ok(res.manifest.a.every(e => newIds.includes(e.to)));
  assert.deepEqual(res.droppedTransitions, 0);
  assert.deepEqual(res.dedupedFrames, 0);
});

test("executeTemplateMerge: transiciones remapeadas intra-fuente, huérfanas descartadas", () => {
  const A = {
    id: "a", name: "A",
    data: {
      frames: [
        mkFrame("a1", { animation: { transitions: [{ effect: "fade", toFrameId: "a2" }, { effect: "wipe", toFrameId: "ghost" }] } }),
        mkFrame("a2"),
      ],
      engine: "html",
    },
  };
  const B = { id: "b", name: "B", data: { frames: [mkFrame("b1")], engine: "html" } };
  const res = executeTemplateMerge({ sources: [{ id: "a" }, { id: "b" }], resolved: [A, B] });
  assert.equal(res.droppedTransitions, 1);
  const f1 = res.data.frames[0];
  assert.equal(f1.animation.transitions.length, 1);
  const a2New = res.manifest.a.find(e => e.from === "a2").to;
  assert.equal(f1.animation.transitions[0].toFrameId, a2New);
});

test("executeTemplateMerge: unión de styles/variables con first-wins", () => {
  const target = { id: "t", name: "Base", data: { frames: [], styles: { color: { value: "#000" }, brand: { value: "Musa" } } } };
  const A = { id: "a", name: "A", data: { frames: [mkFrame("a1")], styles: { color: { value: "#fff" }, accent: { value: "#0af" } }, variables: { tone: "warm" } } };
  const B = { id: "b", name: "B", data: { frames: [mkFrame("b1")], styles: { extra: true } } };
  const res = executeTemplateMerge({ sources: [{ id: "a" }, { id: "b" }], resolved: [A, B], target });
  assert.equal(res.data.styles.color.value, "#000"); // conflicto: gana el primero
  assert.equal(res.data.styles.brand.value, "Musa");
  assert.equal(res.data.styles.accent.value, "#0af"); // claves nuevas se suman
  assert.equal(res.data.styles.extra, true);
  assert.equal(res.data.variables.tone, "warm");
});

test('executeTemplateMerge: dedupe "skip" descarta copias exactas con rastro en manifest', () => {
  const dup = { layers: [{ type: "text", text: "hola" }] };
  const A = { id: "a", name: "A", data: { frames: [mkFrame("a1", dup), mkFrame("a2", JSON.parse(JSON.stringify(dup)))] } };
  const B = { id: "b", name: "B", data: { frames: [mkFrame("b1"), mkFrame("b2", JSON.parse(JSON.stringify(dup)))] } };
  const res = executeTemplateMerge({
    sources: [{ id: "a" }, { id: "b" }], resolved: [A, B],
    options: { dedupe: "skip" },
  });
  assert.equal(res.dedupedFrames, 2); // a2 y b2 son copias de a1
  assert.equal(res.frameCount, 2);    // a1 + b1
  const kept = res.manifest.a[0].to;
  assert.equal(res.manifest.a[1].to, null);
  assert.equal(res.manifest.a[1].dedupOf, kept);
  assert.equal(res.manifest.b[1].to, null);
  assert.equal(res.manifest.b[1].dedupOf, kept);
  assert.equal(res.perSourceFrames.a, 1);
});

test("executeTemplateMerge: modo new hereda identidad (engine/tamaño/canvas/html) de la primera fuente", () => {
  const A = { id: "a", name: "A", data: { frames: [mkFrame("a1")], engine: "html", width: 1080, height: 1350, canvas: { bg: "#fff" }, html: "<div/>", css: "body{}" } };
  const B = { id: "b", name: "B", data: { frames: [mkFrame("b1")], engine: "html", html: "<p/>", css: "p{}" } };
  const res = executeTemplateMerge({ sources: [{ id: "a" }, { id: "b" }], resolved: [A, B] });
  assert.equal(res.data.engine, "html");
  assert.equal(res.data.width, 1080);
  assert.equal(res.data.height, 1350);
  assert.deepEqual(res.data.canvas, { bg: "#fff" });
  assert.equal(res.data.html, "<div/>"); // un único engine → html/css del primero
});

test("executeTemplateMerge: videoTimeline concat desplaza clips; keep-target avisa y conserva", () => {
  const target = {
    id: "t", name: "Base",
    data: {
      frames: [mkFrame("t1", { animation: { timeline: { durationSec: 4 } } })],
      videoTimeline: { textClips: [{ startSec: 0, durationSec: 2 }] },
    },
  };
  const A = {
    id: "a", name: "A",
    data: {
      frames: [mkFrame("a1", { animation: { timeline: { durationSec: 3 } } })],
      videoTimeline: { textClips: [{ startSec: 0, durationSec: 2 }], audioClips: [{ startSec: 1, durationSec: 2 }] },
    },
  };
  const B = { id: "b", name: "B", data: { frames: [mkFrame("b1")], videoTimeline: { videoClips: [{ startSec: 0, durationSec: 5 }] } } };

  // Default keep-target: el timeline del target queda intacto y se advierte.
  const keep = executeTemplateMerge({ sources: [{ id: "a" }, { id: "b" }], resolved: [A, B], target });
  assert.equal(keep.data.videoTimeline.textClips.length, 1);
  assert.equal(keep.warnings.filter(w => w.code === "VIDEOTIMELINE_DROPPED").length, 2);

  // Concat: B entra después de la duración efectiva de target+A.
  const concat = executeTemplateMerge({
    sources: [{ id: "a" }, { id: "b" }], resolved: [A, B],
    target, options: { videoTimeline: "concat" },
  });
  const clips = concat.data.videoTimeline.textClips;
  assert.equal(clips.length, 2);
  assert.equal(clips[1].startSec, 4);           // offset = dur efectiva del target (4)
  assert.equal(concat.data.videoTimeline.audioClips[0].startSec, 5); // 4 + 1
  assert.equal(concat.data.videoTimeline.videoClips[0].startSec, 7); // 4 + 3
  assert.equal(concat.data.videoTimeline.textClips[0].startSec, 0);  // target sin shift
});

// ── Tags (REQ-061) ──────────────────────────────────────────

test("normalizeTagInput / normalizeTagList: normaliza, dedupe y tope de 50", () => {
  assert.equal(normalizeTagInput("  Hola   Mundo "), "hola mundo");
  assert.equal(normalizeTagInput(""), null);
  assert.equal(normalizeTagInput(null), null);
  assert.equal(normalizeTagInput("x".repeat(61)), null);
  assert.equal(normalizeTagInput("x".repeat(60)), "x".repeat(60));

  assert.deepEqual(normalizeTagList(["A", " a ", "B", 42, null, ""]), ["a", "b", "42"]);
  assert.deepEqual(normalizeTagList("nope"), []);
  assert.equal(normalizeTagList(Array.from({ length: 60 }, (_, i) => `t${i}`)).length, 50);
});

test("buildAliasMap / applyTagAliases: sustitución alias → canónico", () => {
  const map = buildAliasMap([
    { alias: "RRSS", canonicalName: "Redes Sociales" },
    { alias: "rrss", canonicalName: "Otra" }, // misma clave normalizada: gana la última
    { alias: "", canonicalName: "X" },        // basura ignorada
  ]);
  assert.equal(map["rrss"], "otra");
  assert.deepEqual(applyTagAliases(["rrss", "landing"], map), ["otra", "landing"]);
});

// ── Superficie MCP (REQ-061): marcas como objetos de primera clase ─────
// Slicing de fuente (patrón QA/mcp-*): el worker no se importa aquí; se
// verifica que las herramientas y la resolución brand→brand_id existan en
// worker/runtime/functions/mcp.mjs.
import { readFileSync } from "node:fs";
const mcpSource = readFileSync(new URL("../worker/runtime/functions/mcp.mjs", import.meta.url), "utf8");

test("mcp: brands_list / brands_create definidos, con handler idempotente", () => {
  assert.match(mcpSource, /name: "brands_list"/);
  assert.match(mcpSource, /name: "brands_create"/);
  assert.match(mcpSource, /case "brands_list":/);
  assert.match(mcpSource, /case "brands_create":/);
  // Idempotente por nombre (case-insensitive): devuelve la existente.
  assert.match(mcpSource, /results\.push\(\{ name: hit\.name, id: hit\.id, created: false \}\)/);
});

test("mcp: set_file_meta resuelve brand name → brand_id (el grafo lee brand_id primero)", () => {
  assert.match(mcpSource, /patch\.brand_id = brandMatch\.id;/);
  assert.match(mcpSource, /id: __brandId\(\), workspace_id: wsId, name: typed,/);
  // Vaciar la marca limpia también el vínculo.
  assert.match(mcpSource, /patch\.brand = null;\s*patch\.brand_id = null;/);
});
