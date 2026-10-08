/**
 * QA REQ037 — P2.3 non-destructive preset instances + convert-to-keyframes.
 * Plain .mjs (node --experimental-strip-types); explicit .ts extensions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { normalizeAnimation } from "../shared/animationSchema.ts";
import { buildWallBounce } from "../shared/wallBounce.ts";
import {
  bakePresetInstance,
  instanceIdFor,
  instanceOfLayer,
  removePresetInstance,
  upsertPresetInstance,
} from "../src/lib/presetInstances.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const src = (p) => readFileSync(join(ROOT, p), "utf8");

const baseSchema = () => normalizeAnimation({
  timeline: { durationSec: 6, fps: 30, width: 1080, height: 1080, loop: "once" },
  clips: [
    {
      layerId: "otra", startSec: 0, endSec: 1,
      tweens: [{ prop: "opacity", easing: "linear", keyframes: [{ t: 0, value: "1" }, { t: 1, value: "0" }] }],
    },
  ],
  transitions: [],
});

const freshClips = (layerId) => [
  {
    layerId, startSec: 0, endSec: 4,
    tweens: [{ prop: "transform", easing: "linear", keyframes: [
      { t: 0, value: "translateX(0px) translateY(0px) scale(1) rotate(0deg)" },
      { t: 1, value: "translateX(200px) translateY(0px) scale(1) rotate(0deg)" },
    ] }],
  },
];

const inst = (layerId, contacts) => ({
  id: instanceIdFor(layerId, "wallBounce"),
  presetId: "wallBounce",
  layerId,
  params: { contacts, durationSec: 4 },
});

test("P23-1 normalize: instances passthrough, garbage dropped, legacy JSON untouched", () => {
  const good = normalizeAnimation({
    timeline: { durationSec: 2, fps: 30, width: 100, height: 100, loop: "once" },
    clips: [], transitions: [],
    instances: [
      { id: "inst-a", presetId: "wallBounce", layerId: "L1", params: { contacts: 12, label: "hola", flag: true, bad: {} } },
      { presetId: "no-id", layerId: "L2", params: {} },
      "garbage",
    ],
  });
  assert.equal(good.instances.length, 1);
  assert.equal(good.instances[0].params.contacts, 12);
  assert.equal(good.instances[0].params.flag, true);
  assert.equal(good.instances[0].params.bad, undefined);
  const legacy = normalizeAnimation({
    timeline: { durationSec: 2, fps: 30, width: 100, height: 100, loop: "once" },
    clips: [], transitions: [],
  });
  assert.ok(!JSON.stringify(legacy).includes("instances"));
  assert.ok(!JSON.stringify(legacy).includes("instanceId"));
});

test("P23-2 clip.instanceId survives normalize; garbage dropped", () => {
  const s = normalizeAnimation({
    timeline: { durationSec: 2, fps: 30, width: 100, height: 100, loop: "once" },
    clips: [{
      layerId: "L", startSec: 0, endSec: 1, instanceId: "inst-x",
      tweens: [{ prop: "opacity", easing: "linear", keyframes: [{ t: 0, value: "1" }, { t: 1, value: "0" }] }],
    }, {
      layerId: "M", startSec: 0, endSec: 1, instanceId: 42,
      tweens: [{ prop: "opacity", easing: "linear", keyframes: [{ t: 0, value: "1" }, { t: 1, value: "0" }] }],
    }],
    transitions: [],
  });
  assert.equal(s.clips[0].instanceId, "inst-x");
  assert.equal(s.clips[1].instanceId, undefined);
});

test("P23-3 upsert tags fresh clips, records once, re-apply regenerates owned clips only", () => {
  const r1 = upsertPresetInstance(baseSchema(), inst("pelota", 5), freshClips("pelota"));
  assert.ok(r1.schema);
  assert.equal(r1.schema.clips.length, 2); // otra + owned
  assert.ok(r1.schema.clips.every(c => c.layerId !== "pelota" || c.instanceId === r1.instance.id));
  assert.equal(r1.schema.instances.length, 1);
  assert.equal(r1.schema.clips.find(c => c.layerId === "otra").instanceId, undefined);
  // Re-apply with different params: owned clips replaced, "otra" intact.
  const r2 = upsertPresetInstance(r1.schema, inst("pelota", 10), [
    {
      layerId: "pelota", startSec: 0, endSec: 2,
      tweens: [{ prop: "transform", easing: "linear", keyframes: [
        { t: 0, value: "translateX(0px) translateY(0px) scale(1) rotate(0deg)" },
        { t: 1, value: "translateX(999px) translateY(0px) scale(1) rotate(0deg)" },
      ] }],
    },
  ]);
  assert.equal(r2.schema.clips.length, 2);
  assert.equal(r2.schema.instances.length, 1);
  assert.equal(r2.schema.instances[0].params.contacts, 10);
  const owned = r2.schema.clips.find(c => c.layerId === "pelota");
  assert.equal(owned.endSec, 2);
  assert.ok(owned.tweens[0].keyframes[1].value.includes("999"));
  assert.equal(r2.schema.clips.find(c => c.layerId === "otra").instanceId, undefined);
});

test("P23-4 bake keeps clips identical, strips tags, drops the record", () => {
  const applied = upsertPresetInstance(baseSchema(), inst("pelota", 5), freshClips("pelota")).schema;
  const before = JSON.stringify(applied.clips.find(c => c.layerId === "pelota").tweens);
  const baked = bakePresetInstance(applied, instanceIdFor("pelota", "wallBounce"));
  assert.ok(baked.schema);
  const owned = baked.schema.clips.find(c => c.layerId === "pelota");
  assert.equal(JSON.stringify(owned.tweens), before);
  assert.equal(owned.instanceId, undefined);
  assert.equal(baked.schema.instances, undefined);
  assert.equal(instanceOfLayer(baked.schema, "pelota"), null);
});

test("P23-5 remove withClips deletes owned clips; other layers survive", () => {
  const applied = upsertPresetInstance(baseSchema(), inst("pelota", 5), freshClips("pelota")).schema;
  const removed = removePresetInstance(applied, instanceIdFor("pelota", "wallBounce"), true);
  assert.ok(removed.schema);
  assert.ok(!removed.schema.clips.some(c => c.layerId === "pelota"));
  assert.ok(removed.schema.clips.some(c => c.layerId === "otra"));
  assert.equal(removed.schema.instances, undefined);
});

test("P23-6 wallBounce integration: apply as instance, retime, still owned", () => {
  const base = baseSchema();
  const r = buildWallBounce({
    layerId: "pelota", width: 1080, height: 1080,
    startCenter: { x: 540, y: 540 }, origin: { x: 440, y: 500 },
    radius: 40, margin: 0, contacts: 8, durationSec: 4,
    dirDeg: 37, rhythm: "velocity", endMode: "center", arrivalSec: 0.8,
    exitMode: "fade", fadeSec: 0.6,
  });
  const applied = upsertPresetInstance(base, inst("pelota", 8), r.clips).schema;
  assert.equal(applied.clips.filter(c => c.layerId === "pelota").length, r.clips.length);
  assert.ok(applied.clips.filter(c => c.layerId === "pelota").every(c => c.instanceId === applied.instances[0].id));
  // Retiming the layer keeps the ownership tags (params stay live).
  const retimed = normalizeAnimation({
    ...applied,
    clips: applied.clips.map(c => (c.layerId === "pelota"
      ? { ...c, startSec: c.startSec * 2, endSec: c.endSec * 2 }
      : c)),
  });
  assert.ok(retimed.clips.filter(c => c.layerId === "pelota").every(c => c.instanceId));
});

test("P23-7 source: overlay applies via upsert + lifecycle handler; inspector panel", () => {
  const ov = src("src/components/VideoModeOverlay.tsx");
  assert.match(ov, /upsertPresetInstance/);
  assert.match(ov, /instanceIdFor\(layerId, "wallBounce"\)/);
  assert.match(ov, /const handleInstanceOp/);
  assert.match(ov, /bakePresetInstance\(schema, op\.instanceId\)/);
  assert.match(ov, /removePresetInstance\(schema, op\.instanceId, true\)/);
  assert.match(ov, /onInstanceOp=\{handleInstanceOp\}/);
  assert.match(ov, /instancia activa \(editable y convertible a keyframes\)/);
  const insp = src("src/components/video/VideoInspector.tsx");
  assert.match(insp, /data-video-instance-row/);
  assert.match(insp, /instanceOfLayer\(schema, selection\.layerId\)/);
  assert.match(insp, /Convertir a keyframes/);
  assert.match(insp, /onInstanceOp: \(frameId: string, layerId: string, op: \{ kind: "bake" \| "remove"; instanceId: string \}\) => void/);
});
