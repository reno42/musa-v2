/**
 * QA REQ036 — P2.1 value/speed curves (handles) + P2.2 Bézier trajectories.
 * Plain .mjs (node --experimental-strip-types); explicit .ts extensions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { normalizeAnimation, compileAnimation, sampleAnimationAt, evalBezier, bezierOf } from "../shared/animationSchema.ts";
import { parseTransform, composeTransform, quadAt, isCanonicalTransform } from "../shared/transformValue.ts";
import { setKeyframeCtrl, retimeLayerClips } from "../src/lib/layerKeyframes.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const src = (p) => readFileSync(join(ROOT, p), "utf8");

const T0 = "translateX(0px) translateY(0px) scale(1) rotate(0deg)";
const TX100 = "translateX(100px) translateY(0px) scale(1) rotate(0deg)";

const clip2k = (kf0 = {}) => ({
  layerId: "pelota",
  startSec: 0,
  endSec: 2,
  tweens: [{
    prop: "transform",
    easing: "linear",
    keyframes: [{ t: 0, value: T0, ...kf0 }, { t: 1, value: TX100 }],
  }],
});
const schema2 = (kf0 = {}) => normalizeAnimation({
  timeline: { durationSec: 2, fps: 30, width: 1080, height: 1080, loop: "once" },
  clips: [clip2k(kf0)],
  transitions: [],
});

// ── P2.2: quadratic path math ───────────────────────────────────────────

test("P22-1 quadAt: midpoint of (0,0)-(50,100)-(100,0) is (50,50); endpoints exact", () => {
  const m = quadAt({ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }, 0.5);
  assert.equal(m.x, 50);
  assert.equal(m.y, 50);
  const a = quadAt({ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }, 0);
  const b = quadAt({ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }, 1);
  assert.deepEqual([a.x, a.y, b.x, b.y], [0, 0, 100, 0]);
});

test("P22-2 sampler bends translate through ctrl; straight stays straight", () => {
  const curved = sampleAnimationAt(schema2({ ctrl: { x: 50, y: 100 } }), 1).get("pelota");
  const pc = parseTransform(curved.transform);
  assert.equal(pc.x, 50);
  assert.equal(pc.y, 50);
  const straight = sampleAnimationAt(schema2(), 1).get("pelota");
  const ps = parseTransform(straight.transform);
  assert.equal(ps.x, 50);
  assert.equal(ps.y, 0);
});

test("P22-3 non-canonical values degrade to straight token lerp (skew survives)", () => {
  const s = normalizeAnimation({
    timeline: { durationSec: 2, fps: 30, width: 1080, height: 1080, loop: "once" },
    clips: [{
      layerId: "x", startSec: 0, endSec: 2,
      tweens: [{
        prop: "transform", easing: "linear",
        keyframes: [
          { t: 0, value: "translateX(0px) skewX(30deg)", ctrl: { x: 50, y: 100 } },
          { t: 1, value: "translateX(100px) skewX(30deg)" },
        ],
      }],
    }],
    transitions: [],
  });
  const mid = sampleAnimationAt(s, 1).get("x");
  assert.ok(mid.transform.includes("skewX(30deg)"));
  assert.ok(mid.transform.includes("translateX(50px)"));
});

test("P22-4 normalize keeps finite ctrl (clamped), drops garbage, legacy output untouched", () => {
  const kept = schema2({ ctrl: { x: 12.3456, y: -4 } });
  assert.deepEqual(kept.clips[0].tweens[0].keyframes[0].ctrl, { x: 12.3456, y: -4 });
  const clamped = schema2({ ctrl: { x: 1e9, y: -1e9 } });
  assert.equal(clamped.clips[0].tweens[0].keyframes[0].ctrl.x, 10000);
  assert.equal(clamped.clips[0].tweens[0].keyframes[0].ctrl.y, -10000);
  const garbage = schema2({ ctrl: { x: "abc", y: null } });
  assert.equal(garbage.clips[0].tweens[0].keyframes[0].ctrl, undefined);
  const legacy = normalizeAnimation({
    timeline: { durationSec: 2, fps: 30, width: 1080, height: 1080, loop: "once" },
    clips: [clip2k()], transitions: [],
  });
  assert.ok(!JSON.stringify(legacy).includes('"ctrl"'));
});

// ── P2.2: ctrl authoring helper ─────────────────────────────────────────

test("P22-5 setKeyframeCtrl: set, clear, last-key rejected, neighbors untouched", () => {
  const s0 = schema2();
  const set = setKeyframeCtrl(s0, "pelota", "transform", 0, { x: 33.333, y: 77.7 }, 0);
  assert.ok(set.schema);
  const kf0 = set.schema.clips[0].tweens[0].keyframes[0];
  assert.deepEqual(kf0.ctrl, { x: 33.33, y: 77.7 });
  assert.equal(kf0.t, 0);
  assert.equal(set.schema.clips[0].tweens[0].keyframes[1].t, 1);
  const cleared = setKeyframeCtrl(set.schema, "pelota", "transform", 0, null, 0);
  assert.equal(cleared.schema.clips[0].tweens[0].keyframes[0].ctrl, undefined);
  assert.equal(setKeyframeCtrl(s0, "pelota", "transform", 1, { x: 1, y: 1 }, 0).schema, null);
  assert.equal(setKeyframeCtrl(s0, "otra", "transform", 0, { x: 1, y: 1 }, 0).schema, null);
});

test("P22-6 retime preserves ctrl (path shape survives rhythm changes)", () => {
  const withCtrl = schema2({ ctrl: { x: 50, y: 100 } });
  const rt = retimeLayerClips(withCtrl, "pelota", 4);
  assert.ok(rt.schema);
  assert.deepEqual(rt.schema.clips[0].tweens[0].keyframes[0].ctrl, { x: 50, y: 100 });
});

// ── P2.2: WAAPI compilation (preview parity) ────────────────────────────

test("P22-7 compileAnimation bakes curved segments into linear samples; straight stays 2 keys", () => {
  const curved = compileAnimation(schema2({ ctrl: { x: 50, y: 100 } }))[0];
  assert.equal(curved.keyframes.length, 15); // start + 14 samples
  const offs = curved.keyframes.map(k => k.offset);
  for (let i = 1; i < offs.length; i++) assert.ok(offs[i] > offs[i - 1]);
  assert.ok(curved.keyframes.slice(0, -1).every(k => k.easing === "linear"));
  assert.equal(curved.keyframes[curved.keyframes.length - 1].easing, undefined);
  const mid = curved.keyframes.find(k => Math.abs(k.offset - 0.5) < 0.001);
  assert.equal(parseTransform(mid.transform).y, 50);
  const plain = compileAnimation(schema2())[0];
  assert.equal(plain.keyframes.length, 2);
  assert.equal(plain.keyframes[0].easing, "linear");
  // Mixed: curved first segment + straight second stays monotonic, exact end.
  const three = normalizeAnimation({
    timeline: { durationSec: 2, fps: 30, width: 1080, height: 1080, loop: "once" },
    clips: [{
      layerId: "pelota", startSec: 0, endSec: 2,
      tweens: [{
        prop: "transform", easing: "linear",
        keyframes: [
          { t: 0, value: T0, ctrl: { x: 0, y: 80 } },
          { t: 0.5, value: "translateX(50px) translateY(0px) scale(1) rotate(0deg)" },
          { t: 1, value: TX100 },
        ],
      }],
    }],
    transitions: [],
  });
  const mixed = compileAnimation(three)[0];
  const mOffs = mixed.keyframes.map(k => k.offset);
  for (let i = 1; i < mOffs.length; i++) assert.ok(mOffs[i] > mOffs[i - 1]);
  assert.equal(mOffs[mOffs.length - 1], 1);
  assert.equal(parseTransform(mixed.keyframes[mixed.keyframes.length - 1].transform).x, 100);
});

// ── P2.1: easing curve plumbing ─────────────────────────────────────────

test("P21-1 evalBezier: endpoints exact, monotonic (no-overshoot), custom bezier passes through bezierOf", () => {
  const b = [0.34, 1.56, 0.64, 1];
  assert.equal(evalBezier(b, 0), 0);
  assert.equal(evalBezier(b, 1), 1);
  // Monotonicity only holds for curves without y-overshoot (ease-in-out).
  const mono = [0.42, 0, 0.58, 1];
  let prev = -1;
  for (let i = 0; i <= 20; i++) {
    const v = evalBezier(mono, i / 20);
    assert.ok(v >= prev - 1e-9);
    prev = v;
  }
  // The overshoot curve DOES exceed 1 somewhere in the middle.
  const maxV = Math.max(...Array.from({ length: 21 }, (_, i) => evalBezier(b, i / 20)));
  assert.ok(maxV > 1.01);
  assert.deepEqual(bezierOf("cubic-bezier(0.34, 1.56, 0.64, 1)"), b);
});

test("P21-2 isCanonicalTransform gates curve interpolation", () => {
  assert.ok(isCanonicalTransform(T0));
  assert.ok(isCanonicalTransform("  translateX(3.5px)  translateY(-2px) scale(1.2) rotate(45deg) "));
  assert.ok(!isCanonicalTransform("translateX(0px) skewX(30deg)"));
  assert.ok(!isCanonicalTransform(""));
  assert.ok(!isCanonicalTransform(null));
});

test("P21-3 curve editor round-trips through the easing op (compose/parse stability)", () => {
  const s0 = schema2();
  const set = setKeyframeCtrl(s0, "pelota", "transform", 0, { x: 50, y: 100 }, 0);
  // Re-parse the sampled curve end-to-end: compose(parse(v)) stays canonical.
  const mid = sampleAnimationAt(set.schema, 1).get("pelota").transform;
  assert.ok(isCanonicalTransform(mid));
  assert.deepEqual(parseTransform(composeTransform(parseTransform(mid))), parseTransform(mid));
});

// ── Source assertions (UI wiring) ───────────────────────────────────────

test("P21-4 VideoInspector: curve editor with handles, readout, presets, ctrl row", () => {
  const s = src("src/components/video/VideoInspector.tsx");
  assert.match(s, /data-video-curve-editor/);
  assert.match(s, /data-video-curve-readout/);
  assert.match(s, /bezierOf\(/);
  assert.match(s, /evalBezier\(/);
  assert.match(s, /setPointerCapture/);
  assert.match(s, /EASING_PRESETS\.slice\(0, 6\)/);
  assert.match(s, /cubic-bezier\(\$\{next\[0\]\}, \$\{next\[1\]\}, \$\{next\[2\]\}, \$\{next\[3\]\}\)/);
  assert.match(s, /\| \{ kind: "ctrl"; clipIndex: number; prop: string; kfIndex: number; ctrl: \{ x: number; y: number \} \| null \}/);
  assert.match(s, /data-video-traj-ctrl-row/);
  assert.match(s, /Enderezar/);
  assert.match(s, /Curva del carril \(valor\/velocidad\)/);
});

test("P22-8 VideoModeOverlay: ctrl op case, draggable square handle, dblclick straighten", () => {
  const s = src("src/components/VideoModeOverlay.tsx");
  assert.match(s, /setKeyframeCtrl/);
  assert.match(s, /case "ctrl": res = setKeyframeCtrl\(schema, layerId, op\.prop, op\.kfIndex, op\.ctrl, op\.clipIndex\)/);
  assert.match(s, /data-video-traj-ctrl/);
  assert.match(s, /mode: "dot" \| "ctrl"/);
  assert.match(s, /handleTrajPointerDown\(c\.clipIndex, c\.kfIndex, "ctrl"\)/);
  assert.match(s, /onDoubleClick/);
  assert.match(s, /ctrlPts/);
});
