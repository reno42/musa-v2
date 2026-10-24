// REQ-056 F2 + REQ-057 F2: MCP-surface logic layer. Run with:
// node --experimental-strip-types --test QA/motion-surface.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalTransform,
  expandSpecPresets,
  importLottieMotionIntoSpec,
  motionPresetListPayload,
  motionPresetParamsPayload,
  parseCanonicalTransform,
} from "../shared/motionSurface.ts";
import { normalizeAnimation, sampleAnimationAt } from "../shared/animationSchema.ts";

// Integración con el validador del arnés (módulo de otra sesión en curso):
// si el archivo no existe, estas pruebas se saltan en vez de romper la suite.
let motionSpec = null;
try { motionSpec = await import("../shared/motionSpec.ts"); } catch { /* no disponible */ }
const integ = motionSpec ? test : test.skip;

function presetSpec(overrides = {}) {
  return {
    version: "1.0",
    id: "qa-surface",
    name: "QA surface",
    canvas: { width: 1080, height: 1920, fps: 30, durationMs: 4000, backgroundColor: "#0b0b0b" },
    assets: [],
    nodes: [
      {
        id: "hero", kind: "text", text: "Hola", editability: "editable",
        startMs: 0, endMs: 4000,
        preset: { id: "musa.motion.rise-in", params: { distPx: 100 } },
      },
    ],
    keyframes: [],
    effects: [],
    transitions: [],
    ...overrides,
  };
}

test("parseCanonicalTransform: ida y vuelta con canonicalTransform", () => {
  const s = canonicalTransform(12.5, -3, 1.25, 90);
  assert.deepEqual(parseCanonicalTransform(s), { x: 12.5, y: -3, scale: 1.25, rotation: 90 });
  assert.equal(parseCanonicalTransform("rotate(45deg)"), null);
  assert.equal(parseCanonicalTransform(42), null);
});

test("expandSpecPresets: expande a keyframes numéricos y strippea la declaración", () => {
  const { spec, applied, issues } = expandSpecPresets(presetSpec());
  assert.equal(issues.length, 0, JSON.stringify(issues));
  assert.equal(applied.length, 1);
  assert.equal(applied[0].nodeId, "hero");
  assert.equal(applied[0].preset, "musa.motion.rise-in");
  assert.deepEqual(applied[0].windowMs, { start: 0, end: 4000 });
  // 2 tiempos × (x,y,scale,rotation) + 2 de opacidad = 10.
  assert.equal(applied[0].keyframes, 10);

  const node = spec.nodes.find(n => n.id === "hero");
  assert.equal("preset" in node, false, "la declaración se consume");
  const kf = spec.keyframes;
  const at = (property, timeMs) => kf.find(k => k.property === property && k.timeMs === timeMs);
  assert.equal(at("y", 0).value, 100, "translateY inicial = distPx");
  assert.equal(at("y", 4000).value, 0);
  assert.equal(at("x", 0).value, 0);
  assert.equal(at("scale", 0).value, 1);
  assert.equal(at("rotation", 4000).value, 0);
  assert.equal(at("opacity", 0).value, 0);
  assert.equal(at("opacity", 4000).value, 1);
  for (const k of kf) {
    assert.equal(typeof k.value, "number", "valores numéricos");
    assert.ok(k.id.startsWith("kfp-hero-"), "ids deterministas");
    if (k.easing) assert.match(k.easing, /^(cubic-bezier\(|linear$|ease)/, "easing canónico");
  }
});

test("expandSpecPresets: determinista e idempotente (expandir dos veces es no-op)", () => {
  const a = expandSpecPresets(presetSpec());
  const b = expandSpecPresets(presetSpec());
  assert.equal(JSON.stringify(a.spec), JSON.stringify(b.spec));
  const second = expandSpecPresets(a.spec);
  assert.equal(second.applied.length, 0, "sin declaraciones preset no hay trabajo");
  assert.equal(JSON.stringify(second.spec.keyframes), JSON.stringify(a.spec.keyframes));
});

test("expandSpecPresets: id desconocido es ERROR y lista los ids válidos", () => {
  const { spec, applied, issues } = expandSpecPresets(presetSpec({
    nodes: [{ id: "hero", kind: "text", text: "x", editability: "editable", startMs: 0, endMs: 4000, preset: "musa.motion.nope" }],
  }));
  assert.equal(applied.length, 0);
  const err = issues.find(i => i.severity === "error");
  assert.equal(err.code, "PRESET_UNKNOWN");
  assert.ok(err.message.includes("musa.motion.rise-in"), "lista ids válidos");
  assert.equal("preset" in spec.nodes[0], false);
});

test("expandSpecPresets: ventana por defecto = ventana del nodo; mismatch y clamp avisos", () => {
  // Ventana default del nodo, sin warning de mismatch.
  const ok = expandSpecPresets(presetSpec({
    nodes: [{ id: "h", kind: "text", text: "x", editability: "editable", startMs: 1000, endMs: 3000, preset: "musa.motion.pulse-loop" }],
  }));
  assert.equal(ok.issues.length, 0, JSON.stringify(ok.issues));
  assert.deepEqual(ok.applied[0].windowMs, { start: 1000, end: 3000 });

  // Ventana parcial → warning de estiramiento potencial.
  const partial = expandSpecPresets(presetSpec({
    nodes: [{ id: "h", kind: "text", text: "x", editability: "editable", startMs: 0, endMs: 4000, preset: { id: "musa.motion.rise-in", windowMs: { start: 500, end: 2000 } } }],
  }));
  assert.ok(partial.issues.some(i => i.code === "PRESET_WINDOW_MISMATCH"));
  assert.deepEqual(partial.applied[0].windowMs, { start: 500, end: 2000 });

  // Fuera del canvas se clampea al durationMs.
  const clamped = expandSpecPresets(presetSpec({
    nodes: [{ id: "h", kind: "text", text: "x", editability: "editable", startMs: 0, endMs: 4000, preset: { id: "musa.motion.rise-in", windowMs: { start: 0, end: 99999 } } }],
  }));
  assert.deepEqual(clamped.applied[0].windowMs, { start: 0, end: 4000 });
});

test("expandSpecPresets: colisión con keyframe existente se omite con warning", () => {
  const { spec, applied, issues } = expandSpecPresets(presetSpec({
    keyframes: [{ id: "k1", nodeId: "hero", property: "opacity", timeMs: 0, value: 0.5 }],
  }));
  assert.equal(spec.keyframes.find(k => k.id === "k1").value, 0.5, "el keyframe humano se conserva");
  assert.ok(issues.some(i => i.code === "KEYFRAME_COLLISION" && i.severity === "warning"));
  assert.equal(applied[0].skipped, 1);
  assert.equal(applied[0].keyframes, 9);
});

test("expandSpecPresets: ventana degenerada en canvas diminuto es error", () => {
  const res = expandSpecPresets(presetSpec({
    canvas: { width: 100, height: 100, fps: 10, durationMs: 50 },
    nodes: [{ id: "h", kind: "text", text: "x", editability: "editable", startMs: 0, endMs: 50, preset: "musa.motion.rise-in" }],
  }));
  assert.ok(res.issues.some(i => i.severity === "error" && i.code === "PRESET_WINDOW_INVALID"));
});

function lottieTitle() {
  return {
    v: "5.9.0", fr: 30, ip: 0, op: 60, w: 1080, h: 1920,
    layers: [{
      nm: "title", ind: 1, ty: 5, ip: 0, op: 60,
      ks: {
        p: { a: 1, k: [{ t: 0, s: [100, 500] }, { t: 30, s: [100, 400] }] },
        s: { a: 0, k: [100, 100] },
        r: { a: 0, k: 0 },
        o: { a: 1, k: [{ t: 0, s: [0] }, { t: 24, s: [100] }] },
      },
    }],
  };
}

function specWithTitle(keyframes = []) {
  return {
    version: "1.0",
    canvas: { width: 1080, height: 1920, fps: 30, durationMs: 3000 },
    assets: [],
    nodes: [{ id: "title", kind: "text", text: "T", editability: "editable", startMs: 0, endMs: 1000 }],
    keyframes,
    effects: [],
    transitions: [],
  };
}

test("importLottieMotionIntoSpec: autocorrelaciona por nombre e inyecta numéricos", () => {
  const res = importLottieMotionIntoSpec(lottieTitle(), specWithTitle());
  assert.equal(res.ok, true, JSON.stringify(res.issues));
  assert.equal(res.applied.length, 1);
  assert.equal(res.applied[0].nodeId, "title");
  // transform (2 tiempos × 4 props) + opacity (3 tiempos) = 11.
  assert.equal(res.applied[0].keyframes, 11);
  assert.deepEqual(res.applied[0].windowMs, { start: 0, end: 1000 });
  const kf = res.spec.keyframes;
  const at = (property, timeMs) => kf.find(k => k.property === property && k.timeMs === timeMs);
  assert.equal(at("y", 0).value, 500);
  assert.equal(at("y", 1000).value, 400);
  assert.equal(at("opacity", 0).value, 0);
  assert.equal(at("opacity", 800).value, 1);
  assert.equal(at("opacity", 1000).value, 1);
  assert.ok(kf.every(k => k.id.startsWith("kfl-title-")));
  assert.ok(res.warnings.some(w => w.code === "visual-not-imported"));
});

test("importLottieMotionIntoSpec: re-importar reemplaza SOLO las propiedades importadas", () => {
  const pre = [
    { id: "humano", nodeId: "title", property: "opacity", timeMs: 0, value: 0.5 },
    { id: "humano2", nodeId: "title", property: "color", timeMs: 100, value: "#ff0000" },
  ];
  const first = importLottieMotionIntoSpec(lottieTitle(), specWithTitle(pre));
  assert.equal(first.applied[0].replaced, 1, "opacity se reemplaza");
  assert.equal(first.spec.keyframes.find(k => k.id === "humano"), undefined);
  assert.equal(first.spec.keyframes.find(k => k.id === "humano2").value, "#ff0000", "color no importado se conserva");

  const second = importLottieMotionIntoSpec(lottieTitle(), first.spec);
  assert.equal(JSON.stringify(second.spec.keyframes), JSON.stringify(first.spec.keyframes), "re-import idempotente");
});

test("importLottieMotionIntoSpec: staticProps caen a node.props; Lottie inválido es error", () => {
  const lottie = {
    v: "5.9.0", fr: 30, ip: 0, op: 30, w: 500, h: 500,
    layers: [{
      nm: "split", ind: 1, ty: 4, ip: 0, op: 30,
      ks: { p: { a: 0, k: [10, 20] }, s: { a: 0, k: [50, 50] }, r: { a: 0, k: 90 }, o: { a: 0, k: 80 } },
    }],
  };
  // La capa se autocorrelaciona por node.id: el spec necesita un nodo "split".
  const res = importLottieMotionIntoSpec(lottie, {
    ...specWithTitle(),
    nodes: [{ id: "split", kind: "shape", text: "", editability: "editable", startMs: 0, endMs: 1000 }],
  });
  assert.equal(res.ok, true, JSON.stringify(res.issues));
  const node = res.spec.nodes.find(n => n.id === "split");
  assert.deepEqual(node.props, { x: 10, y: 20, scale: 0.5, rotation: 90, opacity: 0.8 });
  assert.equal(res.spec.keyframes.length, 0, "estático no genera keyframes");

  const bad = importLottieMotionIntoSpec(null, specWithTitle());
  assert.equal(bad.ok, false);
  assert.equal(bad.issues[0].code, "LOTTIE_INVALID");
  assert.equal(bad.spec, null);
});

test("catálogo: payload de presets y params saneados por preset", () => {
  const payload = motionPresetListPayload();
  const ids = payload.presets.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 13, "el catálogo completo está expuesto");
  const params = motionPresetParamsPayload("musa.motion.rise-in");
  assert.equal(params.preset, "musa.motion.rise-in");
  assert.equal(typeof params.params.distPx, "number");
  assert.equal(motionPresetParamsPayload("musa.motion.nope"), null);
});

integ("integración: el spec expandido pasa normalizeMotionSpec y compila al schema", () => {
  const { spec, issues } = expandSpecPresets(presetSpec());
  assert.equal(issues.length, 0);
  const norm = motionSpec.normalizeMotionSpec(spec);
  assert.equal(norm.valid, true, JSON.stringify(norm.issues));
  const { schema } = motionSpec.motionSpecToAnimationSchema(norm.spec);
  const at = t => sampleAnimationAt(schema, t).get("hero");
  assert.equal(at(0).opacity, "0");
  assert.equal(at(4).opacity, "1");
  assert.ok(at(4).transform.includes("translateY(0px)"), "translateY termina en 0");
  assert.ok(normalizeAnimation(JSON.parse(JSON.stringify(schema))));
});
