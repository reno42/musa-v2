/**
 * Musa Hands — classifier + calibration math (REQ Gesture Mode §5/§6).
 *
 * Pure modules only: the consensus/dwell/cooldown state machine, the
 * wizard's threshold math and the One-Euro filter. A regression here is
 * felt in the HANDS — a layer glued to a dead pinch, or a pan firing while
 * the user talks on a Meets call. These assertions pin the SAFETY
 * properties, not the feel.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { GestureClassifier } from "../src/lib/gesture/classifier.ts";
import { computeCalibration, DEFAULT_CALIBRATION } from "../src/lib/gesture/calibration.ts";
import { OneEuroFilter } from "../src/lib/gesture/smoothing.ts";

const DT = 33; // ~30fps frame interval
let t = 0;

function makeHand(name, opts = {}) {
  const pinch = opts.pinch ?? 0.3;
  const wrist = { x: opts.wristX ?? 0.5, y: opts.wristY ?? 0.5, z: 0 };
  const tip = { x: opts.tipX ?? wrist.x, y: opts.tipY ?? wrist.y - 0.12, z: 0 };
  const landmarks = Array.from({ length: 21 }, () => ({ ...wrist }));
  landmarks[0] = wrist;
  landmarks[8] = tip;
  landmarks[4] = { x: tip.x + pinch / 2, y: tip.y + 0.01, z: 0 };
  return { landmarks, handedness: "Right", name, score: 0.9, pinch };
}

function obs(...hands) {
  t += DT;
  return { t, hands };
}

function freshClassifier(canScrub = () => false, opts = {}) {
  t = 0;
  return new GestureClassifier({ profile: DEFAULT_CALIBRATION, canScrub, ...opts });
}

// ── calibration math ──

test("calibration derives grab/release with hysteresis inside the sampled span", () => {
  const p = computeCalibration("test", { pinchOpen: 0.3, pinchClosed: 0.04, stillness: 0.01 });
  assert.ok(p.pinchGrab > 0.04 && p.pinchGrab < 0.3, `grab inside span (got ${p.pinchGrab})`);
  assert.ok(p.pinchRelease > p.pinchGrab, "release above grab (hysteresis)");
  const shaky = computeCalibration("test", { pinchOpen: 0.3, pinchClosed: 0.04, stillness: 0.04 });
  assert.ok(shaky.minCutoff < p.minCutoff, "stillness lowers minCutoff");
  assert.ok(shaky.beta < p.beta, "stillness lowers beta");
});

// ── suspended mode: silence is the feature ──

test("suspended mode emits nothing while the user talks and gesticulates", () => {
  const c = freshClassifier();
  for (let i = 0; i < 20; i++) {
    const intents = c.update(obs(makeHand("Open_Palm", { wristX: 0.4 + i * 0.01 })));
    assert.equal(intents.filter((x) => x.kind !== "toggle").length, 0);
  }
});

test("both palms held ~500ms toggle; the classifier waits for setMode", () => {
  const c = freshClassifier();
  let toggled = false;
  while (t < 600) {
    const intents = c.update(obs(makeHand("Open_Palm", { wristX: 0.4 }), makeHand("Open_Palm", { wristX: 0.7 })));
    if (intents.some((x) => x.kind === "toggle")) {
      toggled = true;
      break;
    }
  }
  assert.ok(toggled, "toggle fires before 600ms of steady both-palms");
  assert.equal(c.getMode(), "suspended", "the mode flips only when the bridge calls setMode");
  c.setMode("armed");
  assert.equal(c.getMode(), "armed");
});

// ── armed mode ──

test("open palm after dwell pans; deltas follow the hand", () => {
  const c = freshClassifier();
  c.setMode("armed");
  // Consensus commits on f3 (t=99); the 150ms dwell completes on f8 → panStart.
  for (let i = 0; i < 8; i++) c.update(obs(makeHand("Open_Palm", { wristX: 0.5 })));
  const intents = c.update(obs(makeHand("Open_Palm", { wristX: 0.54 })));
  const pans = intents.filter((x) => x.kind === "pan");
  assert.ok(pans.length >= 1, "a pan delta is emitted after the dwell");
  assert.ok(pans[0].dx > 0, "hand moved right in image space → positive dx (bridge mirrors)");
});

test("fist = rest: cancels an active pan and emits panEnd", () => {
  const c = freshClassifier();
  c.setMode("armed");
  for (let i = 0; i < 8; i++) c.update(obs(makeHand("Open_Palm", { wristX: 0.5 }))); // panActive on f8
  const intents = c.update(obs(makeHand("Closed_Fist")));
  assert.ok(intents.some((x) => x.kind === "panEnd"), "fist ends the pan");
});

test("pinch grabs after hysteresis dwell and releases above pinchRelease", () => {
  const c = freshClassifier();
  c.setMode("armed");
  const closed = () => makeHand("", { pinch: 0.03, tipX: 0.5 });
  for (let i = 0; i < 6; i++) c.update(obs(closed())); // closed-pinch candidate at f2
  const intents = c.update(obs(closed())); // t=231: 165ms ≥ dwell → dragStart
  assert.ok(intents.some((x) => x.kind === "dragStart"), "closed pinch dwell grabs");
  const move = c.update(obs(makeHand("", { pinch: 0.03, tipX: 0.53 })));
  assert.ok(move.some((x) => x.kind === "drag"), "drag delta while held");
  const end = c.update(obs(makeHand("", { pinch: 0.2, tipX: 0.53 })));
  assert.ok(end.some((x) => x.kind === "dragEnd"), "opening past pinchRelease ends the drag");
});

test("hands lost >300ms during a drag ends it cleanly (no glued layer)", () => {
  const c = freshClassifier();
  c.setMode("armed");
  const closed = () => makeHand("", { pinch: 0.03 });
  for (let i = 0; i < 6; i++) c.update(obs(closed()));
  assert.ok(c.update(obs(closed())).some((x) => x.kind === "dragStart")); // grabs at t=231
  t += 350;
  const intents = c.update(obs());
  assert.ok(intents.some((x) => x.kind === "dragEnd"), "dropout cancels the drag");
});

test("fist→open fires playStop once and the cooldown blocks the repeat", () => {
  const c = freshClassifier();
  c.setMode("armed");
  for (let i = 0; i < 4; i++) c.update(obs(makeHand("Closed_Fist")));
  const openFrames = [1, 2, 3].map(() => c.update(obs(makeHand("Open_Palm"))));
  assert.ok(
    openFrames.some((ints) => ints.some((x) => x.kind === "playStop")),
    "fist→open = play/stop",
  );
  // Back to fist, open again inside the 600ms cooldown → suppressed.
  for (let i = 0; i < 4; i++) c.update(obs(makeHand("Closed_Fist")));
  const repeat = [1, 2, 3].map(() => c.update(obs(makeHand("Open_Palm"))));
  assert.ok(
    !repeat.some((ints) => ints.some((x) => x.kind === "playStop")),
    "cooldown suppresses the immediate repeat",
  );
});

test("victory scrubs only when the gate says a frame is playing", () => {
  let playing = false;
  const c = freshClassifier(() => playing);
  c.setMode("armed");
  for (let i = 0; i < 6; i++) {
    const intents = c.update(obs(makeHand("Victory", { tipY: 0.5 })));
    assert.ok(!intents.some((x) => x.kind === "scrubStart"), "no scrub without playback");
  }
  playing = true;
  let started = false;
  for (let i = 0; i < 10 && !started; i++) {
    started = c.update(obs(makeHand("Victory", { tipY: 0.5 }))).some((x) => x.kind === "scrubStart");
  }
  assert.ok(started, "gate open → scrubStart after dwell");
  const move = c.update(obs(makeHand("Victory", { tipY: 0.54 })));
  assert.ok(move.some((x) => x.kind === "scrub"), "vertical victory movement scrubs");
});

test("fast lateral palm fling becomes a frame swipe, not a pan burst", () => {
  const c = freshClassifier();
  c.setMode("armed");
  for (let i = 0; i < 8; i++) c.update(obs(makeHand("Open_Palm", { wristX: 0.4 }))); // panActive on f8
  const intents = c.update(obs(makeHand("Open_Palm", { wristX: 0.62 })));
  assert.ok(
    intents.some((x) => x.kind === "frame" && x.delta === 1),
    "fling right → next frame",
  );
  assert.ok(intents.some((x) => x.kind === "panEnd"), "pan cancels before the swipe");
});

test("both palms still = toggle dwell (no zoom); spreading palms zoom", () => {
  const c = freshClassifier();
  c.setMode("armed");
  let zoomed = false;
  for (let i = 0; i < 8 && !zoomed; i++) {
    zoomed = c
      .update(obs(makeHand("Open_Palm", { wristX: 0.4 }), makeHand("Open_Palm", { wristX: 0.6 })))
      .some((x) => x.kind === "zoom");
  }
  assert.ok(!zoomed, "still palms → toggle dwell, not zoom");

  zoomed = false;
  for (let i = 0; i < 10 && !zoomed; i++) {
    const spread = 0.2 + i * 0.025;
    zoomed = c
      .update(
        obs(
          makeHand("Open_Palm", { wristX: 0.5 - spread / 2 }),
          makeHand("Open_Palm", { wristX: 0.5 + spread / 2 }),
        ),
      )
      .some((x) => x.kind === "zoom");
  }
  assert.ok(zoomed, "spreading palms zoom");
});

// ── One-Euro: the smoothing contract ──

test("One-Euro converges to a constant and damps a spike", () => {
  const f = new OneEuroFilter(1.2, 0.25);
  let ms = 0;
  let out = 0;
  for (let i = 0; i < 60; i++) {
    ms += 33;
    out = f.filter(0.5, ms);
  }
  assert.ok(Math.abs(out - 0.5) < 0.005, `converges to the constant (got ${out})`);
  ms += 33;
  const spiked = f.filter(0.7, ms);
  assert.ok(Math.abs(spiked - 0.5) < 0.15, `spike damped (got ${spiked})`);
});

// ── cursor route (Pointing_Up = the mouse) ──

test("pointing streams the cursor; a pinch taps press and release", () => {
  const c = freshClassifier(() => false, { cursorMode: true });
  c.setMode("armed");
  const point = (pinch, tipX = 0.3) => c.update(obs(makeHand("Pointing_Up", { pinch, tipX })));
  for (let i = 0; i < 3; i++) point(0.3); // consensus commits on f3
  assert.ok(point(0.3).some((x) => x.kind === "cursor"), "pointing streams the cursor");
  assert.ok(point(0.03).some((x) => x.kind === "cursorDown"), "pinch closes = button down");
  const held = point(0.03, 0.33);
  assert.ok(held.some((x) => x.kind === "cursor"), "hold streams move events");
  assert.ok(!held.some((x) => x.kind === "cursorUp"), "still held — no release yet");
  assert.ok(point(0.3, 0.33).some((x) => x.kind === "cursorUp"), "pinch reopens = button up");
});

test("cursor mode: the pinch is the mouse button, never a layer grab", () => {
  const c = freshClassifier(() => false, { cursorMode: true });
  c.setMode("armed");
  let pressed = false;
  for (let i = 0; i < 10; i++) {
    const intents = c.update(obs(makeHand("Pointing_Up", { pinch: 0.03, tipX: 0.3 + i * 0.005 })));
    if (intents.some((x) => x.kind === "cursorDown")) pressed = true;
    assert.ok(!intents.some((x) => x.kind === "dragStart" || x.kind === "drag"), "no legacy layer grab while pointing");
  }
  assert.ok(pressed, "the button did engage during the hold");
});

test("second-hand pinch is the zoom clutch while the cursor hand aims", () => {
  const c = freshClassifier(() => false, { cursorMode: true });
  c.setMode("armed");
  for (let i = 0; i < 4; i++) c.update(obs(makeHand("Pointing_Up", { pinch: 0.3, tipX: 0.3 })));
  const zooms = [];
  for (let i = 0; i < 6; i++) {
    zooms.push(...c.update(
      obs(
        makeHand("Pointing_Up", { pinch: 0.3, tipX: 0.3 }),
        makeHand("", { pinch: i === 0 ? 0.06 : 0.06 + i * 0.04 }),
      ),
    ));
  }
  assert.ok(zooms.some((x) => x.kind === "zoom"), "opening the second-hand pinch zooms");
});

test("hands lost mid-cursor-drag sends the blind-release sentinel", () => {
  const c = freshClassifier(() => false, { cursorMode: true });
  c.setMode("armed");
  const point = () => makeHand("Pointing_Up", { pinch: 0.03 });
  for (let i = 0; i < 6; i++) c.update(obs(point()));
  t += 350;
  const intents = c.update(obs());
  assert.ok(intents.some((x) => x.kind === "cursorUp" && x.x === -1), "sentinel cursorUp hides the cursor");
});
