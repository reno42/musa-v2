/**
 * QA REQ043 — no-code expression rules (wiggle / loop / pulse).
 * The COMPILERS are pure and fully tested: determinism (same seed = same
 * motion), keyframe shape (t spans the window, values are canonical
 * transforms, ends land at rest), param sanitation, apply consistency
 * (one clip per layer + live instance record) and the regeneration/bake
 * contract. UI wiring is asserted as source contracts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const {
  EXPRESSION_RULES,
  findExpressionRule,
  sanitizeExpressionParams,
  defaultExpressionParams,
  compileExpressionClip,
  applyExpressionToSchema,
  updateExpressionParams,
  expressionOfLayer,
  expressionLabel,
} = await import("../src/lib/expressionRules.ts");
const { bakePresetInstance, instanceIdFor } = await import("../src/lib/presetInstances.ts");
const { applyPresetToSchema, normalizeAnimation } = await import("../shared/animationSchema.ts");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const src = (p) => readFileSync(join(ROOT, p), "utf8");

const XFORM = /^translateX\(-?[\d.]+px\) translateY\(-?[\d.]+px\) scale\([\d.]+\) rotate\(-?[\d.]+deg\)$/;

test("P43-1 catalog: three rules, sane param defs, sanitize clamps", () => {
  assert.deepEqual(EXPRESSION_RULES.map(r => r.id), ["exp-wiggle", "exp-loop", "exp-pulse"]);
  for (const rule of EXPRESSION_RULES) {
    assert.ok(rule.label && rule.about, `${rule.id} has label+about`);
    for (const def of rule.params) {
      assert.ok(def.min <= def.default && def.default <= def.max, `${rule.id}.${def.key} default inside range`);
      assert.ok(def.step > 0);
    }
    // Defaults compile: the catalog must never ship a broken rule.
    const clip = compileExpressionClip(rule.id, defaultExpressionParams(rule), 0, 3);
    assert.ok(clip && clip.tweens.length === 1, `${rule.id} compiles with defaults`);
  }
  const wig = findExpressionRule("exp-wiggle");
  const clean = sanitizeExpressionParams(wig, { amplitud: 999, velocidad: "x", semilla: -5 });
  assert.equal(clean.amplitud, 30, "over-range clamps to max");
  assert.equal(clean.velocidad, 4, "garbage falls back to default");
  assert.equal(clean.semilla, 1, "under-range clamps to min");
  assert.equal(findExpressionRule("nope"), undefined);
  assert.equal(expressionLabel("exp-pulse"), "Latido (pulse)");
  assert.equal(expressionLabel("mystery-id"), "mystery-id", "unknown ids pass through");
});

test("P43-2 wiggle: deterministic per seed, canonical values, rest at both ends", () => {
  const params = { amplitud: 8, velocidad: 4, semilla: 7 };
  const a = compileExpressionClip("exp-wiggle", params, 0, 3);
  const b = compileExpressionClip("exp-wiggle", params, 0, 3);
  assert.deepEqual(a.tweens[0].keyframes, b.tweens[0].keyframes, "same seed + params = byte-identical motion");
  const c = compileExpressionClip("exp-wiggle", { ...params, semilla: 8 }, 0, 3);
  assert.notDeepEqual(a.tweens[0].keyframes, c.tweens[0].keyframes, "a different seed moves differently");
  const kfs = a.tweens[0].keyframes;
  assert.equal(kfs[0].t, 0);
  assert.equal(kfs[kfs.length - 1].t, 1);
  assert.match(kfs[0].value, /rotate\(0deg\)$/, "starts at rest");
  assert.match(kfs[kfs.length - 1].value, /rotate\(0deg\)$/, "ends at rest (no jump at clip end)");
  for (const kf of kfs) assert.match(kf.value, XFORM, "canonical transform format only");
  // The excursions actually reach the requested amplitude range.
  const rots = kfs.map(k => Number(k.value.match(/rotate\((-?[\d.]+)deg\)/)[1]));
  assert.ok(Math.max(...rots.map(Math.abs)) > 1, "wiggle actually wiggles");
  // Faster wiggle = more keyframes over the same window.
  const fast = compileExpressionClip("exp-wiggle", { ...params, velocidad: 12 }, 0, 3);
  assert.ok(fast.tweens[0].keyframes.length > kfs.length, "speed scales the step count");
});

test("P43-3 loop & pulse: clean ping-pong that lands back at rest", () => {
  const loop = compileExpressionClip("exp-loop", { distancia: 24, ciclos: 3 }, 0.5, 3.5);
  const loopKfs = loop.tweens[0].keyframes;
  assert.equal(loopKfs.length, 2 * 3 + 1, "2 points per cycle + the return home");
  assert.match(loopKfs[0].value, /translateX\(0px\)/);
  assert.match(loopKfs[loopKfs.length - 1].value, /translateX\(0px\)/, "ends at rest");
  assert.match(loopKfs[1].value, /translateX\(24px\)/, "first excursion hits the distance");
  const pulse = compileExpressionClip("exp-pulse", { intensidad: 20, ciclos: 2 }, 0, 2);
  const pulseKfs = pulse.tweens[0].keyframes;
  assert.equal(pulseKfs.length, 2 * 2 + 1);
  assert.match(pulseKfs[1].value, /scale\(1\.2\)/, "intensity % becomes the scale peak");
  assert.match(pulseKfs[pulseKfs.length - 1].value, /scale\(1\)/, "ends at rest");
  for (const kf of pulseKfs) assert.match(kf.value, XFORM);
  // A compile outside any window is rejected.
  assert.equal(compileExpressionClip("exp-loop", null, 2, 2), null, "empty window");
  assert.equal(compileExpressionClip("nope", null, 0, 2), null, "unknown rule");
});

test("P43-4 apply: one clip per layer + live record; replacement consistent", () => {
  // From nothing: full-timeline window, tagged clip, recorded params.
  const res = applyExpressionToSchema(null, "L1", "exp-pulse", { intensidad: 20, ciclos: 2 });
  assert.ok(res.ok);
  assert.equal(res.instanceId, instanceIdFor("L1", "exp-pulse"));
  const norm = normalizeAnimation(res.schema);
  assert.equal(norm.clips.length, 1);
  assert.equal(norm.clips[0].layerId, "L1");
  assert.equal(norm.clips[0].instanceId, res.instanceId);
  assert.equal(norm.clips[0].startSec, 0);
  assert.equal(norm.clips[0].endSec, 5, "no window given = full timeline");
  assert.equal(norm.instances.length, 1);
  assert.deepEqual(norm.instances[0].params, { intensidad: 20, ciclos: 2 });
  // Replacing a preset clip: the old clip AND its instance record are gone.
  const withPreset = applyPresetToSchema(null, "L1", "fade-in");
  const tagged = { ...withPreset.clips[0], instanceId: "inst-fade-in-L1" };
  const prev = normalizeAnimation({ ...withPreset, clips: [tagged], instances: [{ id: "inst-fade-in-L1", presetId: "fade-in", layerId: "L1", params: {} }] });
  const res2 = applyExpressionToSchema(prev, "L1", "exp-wiggle", null);
  assert.ok(res2.ok);
  const norm2 = normalizeAnimation(res2.schema);
  assert.equal(norm2.clips.length, 1, "the preset clip was replaced");
  assert.equal(norm2.clips[0].instanceId, instanceIdFor("L1", "exp-wiggle"));
  assert.equal(norm2.instances.length, 1, "the sibling instance record was dropped");
  assert.equal(norm2.instances[0].presetId, "exp-wiggle");
  // Refusals explain themselves; a too-short window is CLAMPED up to the
  // 0.2s minimum (same ergonomic as applyPresetToSchema), never misapplied.
  assert.equal(applyExpressionToSchema(null, "L1", "nope").ok, false);
  const short = applyExpressionToSchema(null, "L1", "exp-loop", null, { startSec: 1, endSec: 1.02 });
  assert.ok(short.ok, "short windows clamp instead of failing");
  assert.equal(normalizeAnimation(short.schema).clips[0].endSec, 1.2, "clamped to the 0.2s minimum");
});

test("P43-5 updateExpressionParams: recompiles the owned clip only", () => {
  const res = applyExpressionToSchema(null, "L1", "exp-loop", { distancia: 24, ciclos: 2 });
  assert.ok(res.ok);
  // A hand-authored clip on ANOTHER layer must survive the param edit.
  const withOther = normalizeAnimation({ ...res.schema, clips: [...res.schema.clips, { layerId: "L2", startSec: 0, endSec: 1, tweens: [{ prop: "opacity", easing: "linear", keyframes: [{ t: 0, value: "0" }, { t: 1, value: "1" }] }] }] });
  const upd = updateExpressionParams(withOther, res.instanceId, { distancia: 60, ciclos: 4 });
  assert.ok(upd.ok);
  const norm = normalizeAnimation(upd.schema);
  assert.equal(norm.clips.length, 2, "the other layer's clip is untouched");
  const mine = norm.clips.find(c => c.instanceId === res.instanceId);
  assert.equal(mine.tweens[0].keyframes.length, 2 * 4 + 1, "ciclos recompiled");
  assert.match(mine.tweens[0].keyframes[1].value, /translateX\(60px\)/, "distancia recompiled");
  assert.equal(mine.layerId, "L1");
  // A NON-expression instance is refused (presets have their own path) —
  // the fixture gives it an owned clip so the rule check is what fires.
  const fake = normalizeAnimation({
    ...withOther,
    clips: [...withOther.clips, { layerId: "L9", startSec: 0, endSec: 2, instanceId: "inst-wallBounce-L9", tweens: [{ prop: "opacity", easing: "linear", keyframes: [{ t: 0, value: "0" }, { t: 1, value: "1" }] }] }],
    instances: [...withOther.instances, { id: "inst-wallBounce-L9", presetId: "wallBounce", layerId: "L9", params: {} }],
  });
  const nope = updateExpressionParams(fake, "inst-wallBounce-L9", {});
  assert.equal(nope.ok, false);
  assert.match(nope.reason, /no es una expresi/);
  assert.equal(updateExpressionParams(withOther, "ghost", {}).ok, false);
});

test("P43-6 lookup + bake: the P2.3 contract closes the loop", () => {
  const res = applyExpressionToSchema(null, "L1", "exp-wiggle", { amplitud: 5, velocidad: 3, semilla: 7 });
  assert.ok(res.ok);
  const found = expressionOfLayer(res.schema, "L1");
  assert.equal(found.id, res.instanceId);
  assert.equal(expressionOfLayer(res.schema, "LX"), null);
  const baked = bakePresetInstance(res.schema, res.instanceId);
  const norm = normalizeAnimation(baked.schema);
  assert.equal((norm.instances || []).length, 0, "record removed (field omitted when empty)");
  assert.equal(norm.clips.length, 1, "clip survives");
  assert.equal(norm.clips[0].instanceId, undefined, "tag stripped — hand-authored now");
});

test("P43-7 AnimationPanel: Expresiones section with live params + bake", () => {
  const t = src("src/components/AnimationPanel.tsx");
  assert.match(t, /import \{[\s\S]*EXPRESSION_RULES[\s\S]*\} from "\.\.\/lib\/expressionRules";/);
  assert.match(t, /<Section label="Expresiones">/);
  assert.match(t, /EXPRESSION_RULES\.map\(rule => \(/);
  assert.match(t, /Aplicar expresi/);
  assert.match(t, /requestApplyExp\(rule\.id\)/);
  assert.match(t, /const activeExp = layerMode && layerId \? expressionOfLayer\(schema, layerId\) : null;/);
  assert.match(t, /Activa: \{rule\.label\}/);
  assert.match(t, /patchExpParams\(activeExp\.id, def\.key,/);
  assert.match(t, /Convertir a keyframes/);
  assert.match(t, /bakeExp\(activeExp\.id\)/);
  // Replacement confirm mirrors the preset library's copy.
  assert.match(t, /reemplaza la animaci/);
  assert.match(t, /Aplicar y reemplazar/);
});

test("P43-8 VideoInspector: expression instances get their human label", () => {
  const t = src("src/components/video/VideoInspector.tsx");
  assert.match(t, /import \{ expressionLabel \} from "\.\.\/\.\.\/lib\/expressionRules";/);
  assert.match(t, /inst\.presetId === "wallBounce" \? "Rebotar contra bordes" : expressionLabel\(inst\.presetId\)/);
});
