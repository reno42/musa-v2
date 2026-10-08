/**
 * QA REQ044 — animated particle overlays (confetti/rain/snow/sparks/fireflies).
 * The catalog is exercised in plain Node through a RECORDING stub context:
 * every canvas op is captured, so determinism (stateless f(t)), density
 * scaling, op signatures per kind and save/restore hygiene are all asserted
 * without a browser. Persistence + player/inspector/export wiring are
 * asserted as source contracts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { PARTICLE_FX, particleFxDef, drawParticleFx } = await import("../shared/particleFx.ts");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const src = (p) => readFileSync(join(ROOT, p), "utf8");

/** CanvasRenderingContext2D stub that records every op with its args. */
const recorder = () => {
  const ops = [];
  const rec = (name) => (...args) => ops.push([name, ...args]);
  return {
    ops,
    save: rec("save"), restore: rec("restore"),
    beginPath: rec("beginPath"), arc: rec("arc"), fill: rec("fill"),
    moveTo: rec("moveTo"), lineTo: rec("lineTo"), stroke: rec("stroke"),
    fillRect: rec("fillRect"), translate: rec("translate"), rotate: rec("rotate"),
  };
};
const draw = (id, t, density, W = 1080, H = 1920) => {
  const ctx = recorder();
  drawParticleFx(ctx, id, W, H, t, density);
  return ctx.ops;
};
const countOp = (ops, name) => ops.filter(o => o[0] === name).length;

test("P44-1 catalog: five fx, sane defs, drawParticleFx guards", () => {
  assert.deepEqual(PARTICLE_FX.map(p => p.id), ["confetti", "rain", "snow", "sparks", "fireflies"]);
  for (const p of PARTICLE_FX) {
    assert.ok(p.label && p.icon, `${p.id} has label+icon`);
    assert.ok(p.base >= 20, `${p.id} has a usable base count`);
    assert.equal(typeof p.draw, "function");
  }
  assert.equal(particleFxDef("snow")?.id, "snow");
  assert.equal(particleFxDef("meteor"), undefined);
  // Guards: unknown id and zero density paint NOTHING (not even save).
  assert.equal(draw("meteor", 1, 1).length, 0, "unknown id is a silent no-op");
  assert.equal(draw("confetti", 1, 0).length, 0, "density 0 paints nothing");
  assert.equal(draw("snow", 1, -3).length, 0, "negative density clamps to nothing");
});

test("P44-2 determinism: stateless f(t) — same inputs, identical op log", () => {
  for (const p of PARTICLE_FX) {
    const a = draw(p.id, 1.37, 0.8);
    const b = draw(p.id, 1.37, 0.8);
    assert.deepEqual(a, b, `${p.id} is deterministic`);
    assert.notDeepEqual(a, draw(p.id, 2.9, 0.8), `${p.id} actually moves with t`);
    // Every frame is internally balanced: the wrapper + per-particle state
    // must leave the context exactly as it was found.
    assert.equal(countOp(a, "save"), countOp(a, "restore"), `${p.id} save/restore balanced`);
  }
});

test("P44-3 density scales the particle COUNT, per-kind op signatures hold", () => {
  for (const p of PARTICLE_FX) {
    const sparse = draw(p.id, 1, 0.3);
    const dense = draw(p.id, 1, 1);
    const paint = (ops) => ops.filter(o => ["fillRect", "fill", "stroke"].includes(o[0])).length;
    assert.ok(paint(dense) > paint(sparse), `${p.id}: more density = more paint ops`);
  }
  // Kind signatures: confetti rects, rain/snow geometry, sparks streaks,
  // fireflies double-glow arcs.
  assert.ok(countOp(draw("confetti", 1, 1), "fillRect") > 0, "confetti paints rects");
  const rain = draw("rain", 1, 1);
  assert.ok(countOp(rain, "lineTo") > 0 && countOp(rain, "stroke") > 0, "rain strokes streaks");
  const snow = draw("snow", 1, 1);
  assert.ok(countOp(snow, "arc") > 0 && countOp(snow, "fill") > 0, "snow fills dots");
  const sparks = draw("sparks", 1, 1);
  assert.ok(countOp(sparks, "lineTo") > 0 && countOp(sparks, "stroke") > 0, "sparks streak upward");
  const flies = draw("fireflies", 1, 1);
  // Double glow = two arcs per firefly; base 22 at density 1 → 44 arcs.
  assert.equal(countOp(flies, "arc"), 44, "fireflies draw glow + core per dot");
  assert.ok(countOp(flies, "fill") > 0, "fireflies fill their dots");
});

test("P44-4 persistence: FrameData field + load + EditorV2 handler", () => {
  const df = src("src/components/DesignFrame.tsx");
  assert.match(df, /reelParticles\?: \{ id: string; density: number \};/);
  const ev = src("src/pages/EditorV2.tsx");
  assert.match(ev, /reelParticles: f\.reelParticles \?\? undefined,/);
  assert.match(ev, /const handleFrameReelParticlesChange = useCallback\(\(frameId: string, fx: \{ id: string; density: number \} \| null\) =>/);
  assert.match(ev, /reelParticles: fx \?\? undefined/);
  assert.match(ev, /onFrameReelParticlesChange=\{handleFrameReelParticlesChange\}/);
});

test("P44-5 player: canvas plane + tick paint + transition clear + threading", () => {
  const t = src("src/components/VideoModeOverlay.tsx");
  assert.match(t, /import \{ drawParticleFx \} from "\.\.\/\.\.\/shared\/particleFx\.ts";/);
  assert.match(t, /onFrameReelParticlesChange: \(frameId: string, fx: \{ id: string; density: number \} \| null\) => void;/);
  assert.match(t, /onFrameReelFxChange, onFrameReelOverlayFxChange, onFrameReelParticlesChange,/);
  assert.match(t, /const pfxCanvasRef = useRef<HTMLCanvasElement>\(null\);/);
  assert.match(t, /<canvas ref=\{pfxCanvasRef\} width=\{project\.width\} height=\{project\.height\}/);
  // The take branch paints with localT — the SAME time the export samples.
  assert.match(t, /drawParticleFx\(pctx, p\.id, pfx\.width, pfx\.height, s\.localT, p\.density\)/);
  assert.match(t, /else pctx\.clearRect\(0, 0, pfx\.width, pfx\.height\);/);
  // Transitions clear the plane (no lingering particles under the wipe).
  assert.match(t, /REQ044: transitions show no particles/);
  // Forwarded to the inspector.
  assert.match(t, /onFrameReelParticlesChange=\{onFrameReelParticlesChange\}/);
});

test("P44-6 inspector: Partículas section with density control", () => {
  const t = src("src/components/video/VideoInspector.tsx");
  assert.match(t, /import \{ PARTICLE_FX \} from "\.\.\/\.\.\/\.\.\/shared\/particleFx\.ts";/);
  assert.match(t, /onFrameReelFxChange, onFrameReelOverlayFxChange, onFrameReelParticlesChange,/);
  assert.match(t, /Partículas — capa animada sobre la toma/);
  assert.match(t, /PARTICLE_FX\.map\(p => \(/);
  assert.match(t, /onFrameReelParticlesChange\(selTake\.id, null\)/);
  assert.match(t, /onFrameReelParticlesChange\(selTake\.id, \{ id: p\.id, density: selTake\.reelParticles\?\.density \?\? 0\.7 \}\)/);
  assert.match(t, /Densidad/);
  assert.match(t, /id: selTake\.reelParticles!\.id, density: clamp\(/);
});

test("P44-7 export parity: ReelExportFrame.particles + drawPlacedWithFx hook", () => {
  const t = src("src/lib/videoExport.ts");
  assert.match(t, /import \{ drawParticleFx \} from "\.\.\/\.\.\/shared\/particleFx\.ts";/);
  assert.match(t, /particles\?: \{ id: string; density: number \} \| null;/);
  assert.match(t, /drawParticleFx\(ctx, f\.particles\.id, canvas\.width, canvas\.height, localT, f\.particles\.density\)/);
  // AND the V5 parity fix: doExport must actually FEED the renderer, which
  // never received fx/overlayFx/particles before REQ044.
  const overlay = src("src/components/VideoModeOverlay.tsx");
  assert.match(overlay, /fx: f\.reelFx \?\? undefined,/);
  assert.match(overlay, /overlayFx: f\.reelOverlayFx\?\.length \? f\.reelOverlayFx : undefined,/);
  assert.match(overlay, /particles: f\.reelParticles \?\? undefined,/);
});
