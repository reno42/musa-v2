/**
 * QA REQ038 — P2.4 destination markers + layer links (no-code vínculos).
 * Plain .mjs (node --experimental-strip-types); explicit .ts extensions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { normalizeAnimation, sampleAnimationAt } from "../shared/animationSchema.ts";
import {
  deleteDestMarker,
  deleteLayerLink,
  linkForFollower,
  moveDestMarker,
  newMarkerId,
  setLayerLink,
  upsertDestMarker,
} from "../src/lib/destMarkers.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const src = (p) => readFileSync(join(ROOT, p), "utf8");

const XFORM = (x, y) => `translateX(${x}px) translateY(${y}px) scale(1) rotate(0deg)`;

/** Leader moves 0→200px over 0..2s (linear); "otra" is untouched filler. */
const baseSchema = () => normalizeAnimation({
  timeline: { durationSec: 4, fps: 30, width: 1080, height: 1080, loop: "once" },
  clips: [
    {
      layerId: "lider", startSec: 0, endSec: 2,
      tweens: [{ prop: "transform", easing: "linear", keyframes: [{ t: 0, value: XFORM(0, 0) }, { t: 1, value: XFORM(200, 0) }] }],
    },
    {
      layerId: "otra", startSec: 0, endSec: 1,
      tweens: [{ prop: "opacity", easing: "linear", keyframes: [{ t: 0, value: "1" }, { t: 1, value: "0" }] }],
    },
  ],
  transitions: [],
});

test("P24-1 normalize: markers/links passthrough, garbage dropped, legacy JSON untouched", () => {
  const good = normalizeAnimation({
    timeline: { durationSec: 2, fps: 30, width: 100, height: 100, loop: "once" },
    clips: [], transitions: [],
    markers: [
      { id: "m1", layerId: "L1", label: "llegada", tSec: 1.5, x: 120, y: -40 },
      { id: "", layerId: "L2", x: 1, y: 2 },
      { id: "m3", layerId: "L3", x: "NaN", y: 2 },
      "garbage",
    ],
    links: [
      { id: "k1", followerId: "F1", leaderId: "L1", dx: 12, dy: -3 },
      { id: "k2", followerId: "F2", leaderId: "F2", dx: 1, dy: 1 }, // self
      { nope: true },
    ],
  });
  assert.equal(good.markers.length, 1);
  assert.equal(good.markers[0].label, "llegada");
  assert.equal(good.markers[0].tSec, 1.5);
  assert.equal(good.links.length, 1);
  assert.equal(good.links[0].dx, 12);
  const legacy = normalizeAnimation({
    timeline: { durationSec: 2, fps: 30, width: 100, height: 100, loop: "once" },
    clips: [], transitions: [],
  });
  const json = JSON.stringify(legacy);
  assert.ok(!json.includes("markers"));
  assert.ok(!json.includes("links"));
});

test("P24-2 normalize: single-hop — a leader that is itself a follower is dropped", () => {
  const s = normalizeAnimation({
    timeline: { durationSec: 2, fps: 30, width: 100, height: 100, loop: "once" },
    clips: [], transitions: [],
    links: [
      { id: "k1", followerId: "F1", leaderId: "L1", dx: 0, dy: 0 },
      { id: "k2", followerId: "F2", leaderId: "F1", dx: 0, dy: 0 }, // leader F1 is a follower
    ],
  });
  assert.equal(s.links.length, 1);
  assert.equal(s.links[0].followerId, "F1");
});

test("P24-3 sampler: follower rides leader + offset; own motion composes; cycle safe", () => {
  // Follower with NO transform clip: pure ride.
  const s1 = normalizeAnimation({
    ...baseSchema(),
    links: [{ id: "k1", followerId: "otra", leaderId: "lider", dx: 10, dy: 5 }],
  });
  const at1 = sampleAnimationAt(s1, 1); // leader at x=100 (mid, linear)
  assert.equal(at1.get("lider").transform, XFORM(100, 0));
  assert.equal(at1.get("otra").transform, XFORM(110, 5));
  // Follower WITH its own transform motion: leader + own + offset.
  const s2 = normalizeAnimation({
    ...baseSchema(),
    clips: [
      ...baseSchema().clips,
      {
        layerId: "fan", startSec: 0, endSec: 2,
        tweens: [{ prop: "transform", easing: "linear", keyframes: [{ t: 0, value: XFORM(0, 0) }, { t: 1, value: XFORM(0, 20) }] }],
      },
    ],
    links: [{ id: "k1", followerId: "fan", leaderId: "lider", dx: 10, dy: 5 }],
  });
  const fan = sampleAnimationAt(s2, 1).get("fan");
  assert.equal(fan.transform, XFORM(110, 15)); // 100 + 0 + 10 / 0 + 20 + 5
  // Chain link (leader is a follower) was dropped at normalize: unaffected.
  const s3 = normalizeAnimation({
    ...s2,
    links: [
      ...(s2.links || []),
      { id: "k2", followerId: "lider", leaderId: "fan", dx: 1, dy: 1 },
    ],
  });
  assert.equal(sampleAnimationAt(s3, 1).get("lider").transform, XFORM(100, 0));
});

test("P24-4 destMarkers CRUD + link replace-per-follower + rejection feedback", () => {
  const base = baseSchema();
  const id = newMarkerId();
  const withM = upsertDestMarker(base, { id, layerId: "lider", label: "llegada", tSec: 1.5, x: 300, y: 120 });
  assert.equal(withM.markers.length, 1);
  const moved = moveDestMarker(withM, id, 310, 130);
  assert.equal(moved.markers[0].x, 310);
  assert.equal(moved.markers[0].tSec, 1.5); // only x/y move
  const gone = deleteDestMarker(moved, id);
  assert.ok(!gone || !gone.markers);
  // One link per follower: a new leader replaces the old rule.
  const l1 = setLayerLink(base, { id: "k1", followerId: "otra", leaderId: "lider", dx: 10, dy: 5 });
  assert.equal(l1.links.length, 1);
  const l2 = setLayerLink(l1, { id: "k2", followerId: "otra", leaderId: "lider2", dx: 1, dy: 2 });
  assert.equal(l2.links.length, 1);
  assert.equal(l2.links[0].id, "k2");
  // Chain: leader "otra" is already a follower → normalize drops → null.
  const chain = setLayerLink(l1, { id: "k3", followerId: "lider", leaderId: "otra", dx: 0, dy: 0 });
  assert.equal(chain, null);
  assert.equal(linkForFollower(l1, "otra").id, "k1");
  const unlinked = deleteLayerLink(l1, "k1");
  assert.ok(!unlinked || !unlinked.links);
});

test("P24-5 markers/links survive clip edits (retime roundtrip) intact", () => {
  const withBoth = normalizeAnimation({
    ...baseSchema(),
    markers: [{ id: "m1", layerId: "lider", label: "d1", tSec: 1.5, x: 300, y: 120 }],
    links: [{ id: "k1", followerId: "otra", leaderId: "lider", dx: 10, dy: 5 }],
    clips: baseSchema().clips.map(c => ({ ...c, endSec: c.endSec * 2 })),
  });
  assert.equal(withBoth.markers.length, 1);
  assert.equal(withBoth.links.length, 1);
  assert.deepEqual(withBoth.markers[0], { id: "m1", layerId: "lider", label: "d1", tSec: 1.5, x: 300, y: 120 });
});

test("P24-6 source: engine composes links inline and clears them on teardown", () => {
  const eng = src("src/lib/animationEngine.ts");
  assert.match(eng, /sampleAnimationAt/);
  assert.match(eng, /followerIds = new Set\(\(next\?\.links \|\| \[\]\)\.map\(l => l\.followerId\)\)/);
  assert.match(eng, /if \(followerIds\.has\(ct\.layerId\) && ct\.keyframes\.some\(k => "transform" in k\)\) continue;/);
  assert.match(eng, /function applyLinks\(timeMs: number\)/);
  assert.match(eng, /el\.style\.transform = ""/);
});

test("P24-7 source: overlay marker ops, draggable crosses, wiring", () => {
  const ov = src("src/components/VideoModeOverlay.tsx");
  assert.match(ov, /const handleMarkerOp/);
  assert.match(ov, /const handleLinkOp/);
  assert.match(ov, /upsertDestMarker\(schema, marker\)/);
  assert.match(ov, /setKeyframeAt\(schema, layerId, "transform", marker\.tSec, value, takeDur\)/);
  assert.match(ov, /const destMarkers = useMemo/);
  assert.match(ov, /data-video-dest-marker="1"/);
  assert.match(ov, /onMarkerOp=\{handleMarkerOp\}/);
  assert.match(ov, /onLinkOp=\{handleLinkOp\}/);
  assert.match(ov, /solo un nivel de vínculo/);
});

test("P24-8 source: inspector Destinos y vínculos panel", () => {
  const insp = src("src/components/video/VideoInspector.tsx");
  assert.match(insp, /export type MarkerOp/);
  assert.match(insp, /export type LinkOp/);
  assert.match(insp, /function DestLinksPanel/);
  assert.match(insp, /data-video-markers-row/);
  assert.match(insp, /\+ Crear destino aquí \(playhead\)/);
  assert.match(insp, /onMarkerOp: \(frameId: string, layerId: string, op: MarkerOp\) => void/);
  assert.match(insp, /onLinkOp: \(frameId: string, layerId: string, op: LinkOp\) => void/);
});
