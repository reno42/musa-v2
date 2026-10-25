// REQ-053 F1+F4+F5 — subconjunto ampliado de MotionSpec (lógica). Run with:
// node --experimental-strip-types --test QA/motion-subset.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  GEOMETRY_PROPS,
  motionEffectsPayload,
  motionSubsetPropsPayload,
  motionTransitionCatalogPayload,
  resolveSpecEffect,
  validateGeometryValue,
  validateSpecTransitions,
} from "../shared/motionSubset.ts";
import { LOOKS } from "../shared/videoEffectsCatalog.ts";

test("F4: transición válida del catálogo normaliza con defaults del catálogo", () => {
  const { transitions, issues } = validateSpecTransitions([{ id: "t1", type: "fade" }]);
  assert.equal(issues.length, 0, JSON.stringify(issues));
  assert.deepEqual(transitions, [{ id: "t1", type: "fade", durationMs: 600 }]);
});

test("F4: id desconocido es error y lista los ids válidos", () => {
  const { transitions, issues } = validateSpecTransitions([{ type: "musa-fancy" }]);
  assert.equal(transitions.length, 0);
  const err = issues.find(i => i.code === "TRANSITION_UNKNOWN");
  assert.equal(err?.severity, "error");
  assert.ok(err.message.includes("musa-fancy"));
  assert.ok(err.message.includes("fade") && err.message.includes("pinwheel"), "lista ids válidos");
});

test("F4: params se clampan a rangos y las claves desconocidas se descartan con warning", () => {
  const clamp = validateSpecTransitions([{ type: "wipe", params: { softness: 999, dir: "diagonal" } }]);
  assert.equal(clamp.issues.length, 0, JSON.stringify(clamp.issues));
  assert.deepEqual(clamp.transitions[0].params, { dir: "left", softness: 0.5 }, "enum cae al default y num se clampea");

  const dropped = validateSpecTransitions([{ type: "fade", params: { foo: 1 } }]);
  assert.ok(dropped.issues.some(i => i.code === "TRANSITION_PARAMS_DROPPED" && i.severity === "warning"));
  assert.equal(dropped.transitions[0].params, undefined, "fade no tiene params declarados");
});

test("F4: durationMs clamp al canvas y default por tipo", () => {
  const clamped = validateSpecTransitions([{ type: "fade", durationMs: 99_000 }], { canvasDurationMs: 4000 });
  assert.equal(clamped.transitions[0].durationMs, 4000);
  assert.ok(clamped.issues.some(i => i.code === "TRANSITION_DURATION_CLAMPED" && i.severity === "warning"));

  const defaulted = validateSpecTransitions([{ type: "pinwheel", durationMs: 0 }]);
  assert.equal(defaulted.transitions[0].durationMs, 800, "default del catálogo");
});

test("F4: referencias a nodos inexistentes son error accionable", () => {
  const known = new Set(["a"]);
  const res = validateSpecTransitions([
    { type: "fade", fromNodeId: "a", toNodeId: "nope" },
    { type: "fade", fromNodeId: "ghost" },
  ], { knownNodeIds: known });
  assert.ok(res.issues.some(i => i.code === "TRANSITION_TO_MISSING"));
  assert.ok(res.issues.some(i => i.code === "TRANSITION_FROM_MISSING"));
  assert.equal(res.transitions.length, 0);
});

test("F4: ids duplicados se desambiguan de forma determinista (+)", () => {
  const { transitions } = validateSpecTransitions([{ id: "t", type: "fade" }, { id: "t", type: "slide" }]);
  assert.deepEqual(transitions.map(t => t.id), ["t", "t+"]);
});

test("F4: el payload del catálogo expone los 35 tipos con sus params", () => {
  const payload = motionTransitionCatalogPayload();
  assert.equal(payload.transitions.length, 35);
  const pinwheel = payload.transitions.find(t => t.id === "pinwheel");
  assert.equal(pinwheel.family, "overlay");
  assert.equal(pinwheel.params[0].key, "count");
  const ids = payload.transitions.map(t => t.id);
  assert.equal(new Set(ids).size, 35, "ids únicos");
});

test("F1: width/height/top/left aceptan px y %, con reglas por propiedad", () => {
  assert.equal(validateGeometryValue("width", 200).value, 200);
  assert.equal(validateGeometryValue("width", "50%").value, "50%");
  assert.equal(validateGeometryValue("height", "120px").value, 120);
  assert.equal(validateGeometryValue("top", -30).ok, true, "top sí puede ser negativo");
  assert.equal(validateGeometryValue("left", "-12.5px").value, -12.5);

  const neg = validateGeometryValue("width", -5);
  assert.equal(neg.ok, false);
  assert.equal(neg.issue.code, "GEOMETRY_NEGATIVE");

  const bad = validateGeometryValue("height", "auto");
  assert.equal(bad.ok, false);
  assert.equal(bad.issue.code, "GEOMETRY_INVALID");
});

test("F1: clipPath solo formas seguras — url/var/calc rechazan", () => {
  assert.equal(validateGeometryValue("clipPath", "none").value, "none");
  assert.equal(validateGeometryValue("clipPath", "inset(10% 20%)").value, "inset(10% 20%)");
  assert.equal(validateGeometryValue("clipPath", "circle(50%)").ok, true);
  assert.equal(validateGeometryValue("clipPath", "polygon(0% 0%, 100% 0%, 100% 100%)").ok, true);

  for (const unsafe of ["url(#mascara)", "calc(1px + 2%)", "inset(calc(1px))", "rotate(45deg)"]) {
    const res = validateGeometryValue("clipPath", unsafe);
    assert.equal(res.ok, false, unsafe);
    if (/^(url|calc|image|var)/i.test(unsafe) || unsafe.includes("calc(")) {
      assert.equal(res.issue.code, "GEOMETRY_CLIP_UNSAFE", unsafe);
    } else {
      assert.equal(res.issue.code, "GEOMETRY_INVALID", unsafe);
    }
  }

  const props = motionSubsetPropsPayload();
  assert.deepEqual(props.geometryProps, [...GEOMETRY_PROPS]);
});

test("F5: fx-lut resuelve el css EXACTO de la misma función css(intensity) del catálogo", () => {
  const { resolved, issues } = resolveSpecEffect("fx-lut", { look: "golden", intensity: 0.5 });
  assert.equal(issues.length, 0, JSON.stringify(issues));
  assert.equal(resolved.kind, "look");
  assert.equal(resolved.catalogId, "golden");
  const expected = LOOKS.find(l => l.id === "golden").css(0.5);
  assert.equal(resolved.cssFilter, expected, "paridad por construcción con preview/export");

  const clamp = resolveSpecEffect("fx-lut", { look: "bw", intensity: 42 });
  assert.equal(clamp.resolved.params.intensity, 1);
  const noop = resolveSpecEffect("fx-lut", { look: "none" });
  assert.ok(noop.issues.some(i => i.code === "EFFECT_NOOP" && i.severity === "warning"));
});

test("F5: ids desconocidos en cada familia son error con lista de ids válidos", () => {
  const look = resolveSpecEffect("fx-lut", { look: "nope" });
  assert.equal(look.resolved, undefined);
  assert.ok(look.issues[0].message.includes("golden"), "lista looks válidos");

  const overlay = resolveSpecEffect("fx-overlay", { overlay: "x" });
  assert.equal(overlay.issues[0].code, "EFFECT_OVERLAY_UNKNOWN");
  assert.ok(
    overlay.issues[0].message.includes("grain") && overlay.issues[0].message.includes("leak"),
    "lista ids válidos",
  );

  const anim = resolveSpecEffect("fx-text-anim", { anim: "nope" });
  assert.equal(anim.issues[0].code, "EFFECT_TEXT_ANIM_UNKNOWN");
  assert.ok(anim.issues[0].message.includes("typewriter"));

  const kind = resolveSpecEffect("css-crudo", {});
  assert.equal(kind.issues[0].code, "EFFECT_UNKNOWN");
  assert.ok(kind.issues[0].message.includes("fx-lut"));
});

test("F5: defaults deterministas y payload documentado", () => {
  assert.equal(resolveSpecEffect("fx-text-anim", {}).resolved.catalogId, "fade");
  assert.equal(resolveSpecEffect("fx-overlay", {}).issues[0].code, "EFFECT_OVERLAY_UNKNOWN", "overlay sin id no adivina");
  const payload = motionEffectsPayload();
  assert.equal(payload.effects.length, 3);
});
