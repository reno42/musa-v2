/**
 * QA REQ040 — P2.6 preset library: previews, compatibility, consistent apply.
 * Plain .mjs (node --experimental-strip-types). presetLibrary.ts is DOM-free,
 * so no shim is needed: functional coverage runs the real functions, plus a
 * source pass over AnimationPanel.tsx (card UI + wiring).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { ANIMATION_PRESETS, PRESET_CATEGORIES, normalizeAnimation } =
  await import("../shared/animationSchema.ts");
const {
  filterPresets,
  checkPresetCompat,
  applyPresetConsistent,
  removeLayerAnimation,
  previewName,
  previewCssBlock,
  previewAnimationValue,
} = await import("../src/lib/presetLibrary.ts");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const src = (p) => readFileSync(join(ROOT, p), "utf8");

/** Valid minimal clip for a layer (opacity fade). */
const fadeClip = (layerId) => ({
  layerId,
  startSec: 0,
  endSec: 1,
  tweens: [{ prop: "opacity", easing: "ease-out", keyframes: [{ t: 0, value: "0" }, { t: 1, value: "1" }] }],
});

const fixture = () => normalizeAnimation({
  timeline: { durationSec: 5, loop: "once", fps: 30 },
  // normalize never cross-applies instance records: the clip carries its tag.
  clips: [{ ...fadeClip("L2"), instanceId: "inst-fade-in-L2" }],
  transitions: [],
  instances: [{ id: "inst-fade-in-L2", presetId: "fade-in", layerId: "L2", params: {} }],
});

test("P26-1 catalog invariants: every preset carries library metadata", () => {
  assert.ok(ANIMATION_PRESETS.length >= 10);
  const cats = new Set(PRESET_CATEGORIES.map(c => c.id));
  assert.ok(cats.has("all"));
  for (const p of ANIMATION_PRESETS) {
    assert.ok(p.id && p.label, `preset ${p.id} needs id+label`);
    assert.ok(cats.has(p.category), `preset ${p.id} category must be a declared one`);
    assert.ok(p.about && p.about.length >= 8, `preset ${p.id} needs a real about line`);
    assert.ok(p.tweens.length >= 1, `preset ${p.id} needs tweens`);
    for (const tw of p.tweens) {
      assert.ok(tw.keyframes.length >= 2, `preset ${p.id} tween ${tw.prop} needs >=2 keyframes`);
      assert.equal(tw.keyframes[0].t, 0);
      assert.equal(tw.keyframes[tw.keyframes.length - 1].t, 1);
    }
  }
  assert.equal(filterPresets("", "all").length, ANIMATION_PRESETS.length);
});

test("P26-2 filterPresets: categories + free-text search", () => {
  assert.deepEqual(filterPresets("", "salida").map(p => p.id), ["fade-out"]);
  assert.ok(filterPresets("", "entrada").every(p => p.category === "entrada"));
  assert.deepEqual(filterPresets("desenfoca", "all").map(p => p.id), ["blur-in"]); // matches about
  assert.deepEqual(filterPresets("typewriter", "all").map(p => p.id), ["typewriter"]); // matches id
  assert.ok(filterPresets("LOOP", "bucle").some(p => p.id === "float")); // case-insensitive
  assert.deepEqual(filterPresets("inexistente-xyz", "all"), []);
  // Combined: category narrows the text search.
  assert.deepEqual(filterPresets("fade", "salida").map(p => p.id), ["fade-out"]);
  assert.deepEqual(filterPresets("fade", "bucle"), []);
});

test("P26-3 preview CSS: built from the preset's own tweens + easings", () => {
  const css = previewCssBlock(filterPresets("", "all"));
  assert.ok(css.includes("@keyframes musapv-fade-in {"));
  const fade = css.slice(css.indexOf("musapv-fade-in"), css.indexOf("musapv-fade-out"));
  assert.match(fade, /0% \{ animation-timing-function: ease-out; opacity: 0; \}/);
  assert.match(fade, /100% \{ opacity: 1; \}/); // last stop carries no timing
  assert.ok(css.includes("cubic-bezier(0.35, 1.4, 0.45, 1)")); // pop resolves its spring easing
  assert.ok(css.includes("clipPath: inset(0 100% 0 0);")); // typewriter keeps its prop
  // Multi-keyframe loop: 0/50/100 stops.
  const float = css.slice(css.indexOf("musapv-float"));
  assert.ok(float.includes("50% {"));
  // Stable names + shorthand.
  assert.equal(previewName("fade-in"), "musapv-fade-in");
  assert.equal(previewAnimationValue("fade-in"), "musapv-fade-in 1300ms linear infinite");
  assert.equal(previewAnimationValue("pop", 800), "musapv-pop 800ms linear infinite");
});

test("P26-4 compat gate: verbatim messages, refuses before touching anything", () => {
  const noTarget = checkPresetCompat("fade-in", null);
  assert.equal(noTarget.ok, false);
  assert.equal(noTarget.reason, "Selecciona un objeto para aplicar Fade in");
  const audio = checkPresetCompat("fade-in", { layerId: "aud-1", visual: false, kind: "audio" });
  assert.equal(audio.reason, "Este efecto requiere un objeto visual; la pista Audio no es compatible");
  const other = checkPresetCompat("fade-in", { layerId: "x", visual: false });
  assert.equal(other.reason, "Este efecto requiere un objeto visual");
  assert.deepEqual(checkPresetCompat("fade-in", { layerId: "L1", visual: true }), { ok: true });
  assert.ok(checkPresetCompat("no-existe", { layerId: "L1", visual: true }).reason.includes("Preset desconocido"));
});

test("P26-5 applyPresetConsistent: clip tagged + instance recorded, others untouched", () => {
  const res = applyPresetConsistent(null, "fade-in", { layerId: "L1", visual: true });
  assert.ok(res.ok);
  assert.equal(res.instanceId, "inst-fade-in-L1");
  const clip = res.schema.clips.find(c => c.layerId === "L1");
  assert.equal(clip.instanceId, "inst-fade-in-L1");
  assert.equal(clip.tweens[0].prop, "opacity");
  const inst = res.schema.instances.find(i => i.id === "inst-fade-in-L1");
  assert.equal(inst.presetId, "fade-in");
  assert.equal(inst.layerId, "L1");
  assert.deepEqual(inst.params, {});
  // With a live document: the other layer's clip AND instance survive.
  const res2 = applyPresetConsistent(fixture(), "fade-in", { layerId: "L1", visual: true });
  assert.ok(res2.ok);
  const l2 = res2.schema.clips.find(c => c.layerId === "L2");
  assert.equal(l2.instanceId, "inst-fade-in-L2");
  assert.ok(res2.schema.instances.some(i => i.id === "inst-fade-in-L2"));
  // Explicit window is honored.
  const res3 = applyPresetConsistent(null, "fade-out", { layerId: "L1", visual: true }, { startSec: 1, endSec: 2 });
  assert.ok(res3.ok);
  const w = res3.schema.clips.find(c => c.layerId === "L1");
  assert.equal(w.startSec, 1);
  assert.equal(w.endSec, 2);
});

test("P26-6 replacement drops the layer's sibling instance (one active per layer)", () => {
  const withOld = normalizeAnimation({
    timeline: { durationSec: 5, loop: "once", fps: 30 },
    clips: [
      { ...fadeClip("L1"), instanceId: "inst-fade-in-L1" },
      { ...fadeClip("L2"), instanceId: "inst-fade-in-L2" },
    ],
    transitions: [],
    instances: [
      { id: "inst-fade-in-L1", presetId: "fade-in", layerId: "L1", params: { custom: 1 } },
      { id: "inst-fade-in-L2", presetId: "fade-in", layerId: "L2", params: {} },
    ],
  });
  const res = applyPresetConsistent(withOld, "slide-in", { layerId: "L1", visual: true });
  assert.ok(res.ok);
  // L1: only the new instance, old params gone.
  assert.deepEqual(res.schema.instances.filter(i => i.layerId === "L1").map(i => i.id), ["inst-slide-in-L1"]);
  const l1 = res.schema.clips.find(c => c.layerId === "L1");
  assert.equal(l1.instanceId, "inst-slide-in-L1");
  assert.equal(l1.tweens[0].prop, "transform"); // the new preset's tween won
  // L2 keeps its own instance + clip untouched.
  assert.ok(res.schema.instances.some(i => i.id === "inst-fade-in-L2"));
  assert.equal(res.schema.clips.find(c => c.layerId === "L2").instanceId, "inst-fade-in-L2");
});

test("P26-7 gate failures keep the document reference intact", () => {
  const fx = fixture();
  for (const [presetId, target] of [
    ["fade-in", null],
    ["fade-in", { layerId: "", visual: true }],
    ["fade-in", { layerId: "aud-1", visual: false, kind: "audio" }],
    ["no-existe", { layerId: "L1", visual: true }],
  ]) {
    const res = applyPresetConsistent(fx, presetId, target);
    assert.equal(res.ok, false, `${presetId}/${JSON.stringify(target)} must refuse`);
    assert.ok(res.reason.length > 8);
    assert.ok(!("schema" in res)); // no rebuilt document rides a failure
  }
  // The fixture itself was never touched.
  assert.equal(fx.clips.length, 1);
  assert.equal(fx.instances.length, 1);
});

test("P26-8 removeLayerAnimation: clip + instance records go together", () => {
  const res = removeLayerAnimation(fixture(), "L2");
  assert.ok(res);
  assert.equal(res.clips.length, 0);
  assert.equal((res.instances || []).length, 0);
  // Unknown layer is a safe no-op on a normalized copy.
  const fx = fixture();
  const same = removeLayerAnimation(fx, "NOPE");
  assert.equal(same.clips.length, 1);
  assert.equal(same.instances.length, 1);
  assert.equal(same.clips[0].layerId, "L2");
  // Null in, null out.
  assert.equal(removeLayerAnimation(null, "L2"), null);
});

test("P26-9 source: panel uses the one apply path, cards, search and confirm", () => {
  const panel = src("src/components/AnimationPanel.tsx");
  // Consistency: the panel never calls the raw schema apply directly.
  assert.ok(!panel.includes("applyPresetToSchema"));
  assert.match(panel, /import \{\s*applyPresetConsistent,\s*checkPresetCompat,\s*filterPresets,/);
  assert.match(panel, /applyPresetConsistent\(schema, presetId, \{ layerId: targetLayerId, visual: true \}\)/);
  assert.match(panel, /removeLayerAnimation\(schema, id\)/);
  // Library UI: search, categories, cards with hover preview, notices.
  assert.match(panel, /Buscar preset…/);
  assert.match(panel, /PRESET_CATEGORIES\.map/);
  assert.match(panel, /filterPresets\(presetQuery, presetCat\)/);
  assert.match(panel, /onMouseEnter=\{\(\) => setLive\(true\)\}/);
  assert.match(panel, /previewAnimationValue\(preset\.id\)/);
  assert.match(panel, /previewCssBlock\(visiblePresets\)/);
  assert.match(panel, /Selecciona un objeto para aplicar un preset\./);
  // Replacement confirms exact scope before overwriting.
  assert.match(panel, /reemplaza la animación actual de esta capa/);
  assert.match(panel, /Aplicar y reemplazar/);
  assert.match(panel, /requestApply\(id, targetLayerId, hasExistingClip\)/);
  // Gate feeds the notice row.
  assert.match(panel, /setPresetNotice\(gate\.reason\)/);
  // Both hosts render the same library.
  assert.match(panel, /Biblioteca de movimiento/);
  assert.match(panel, /Biblioteca a capa/);
});
