import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDeckFrames,
  colorLuminance,
  inkFor,
  DECK_FRAME_W,
  DECK_FRAME_H,
  DECK_FRAME_GAP,
} from "../netlify/functions/deck-generator.mjs";

const spec = {
  name: "Design System — Acme",
  brand: { name: "Acme", color: "#0A4B3E", titleFont: "Fraunces", bodyFont: "Inter" },
  slides: [
    { title: "Colores", html: "<div>paleta</div>", css: ".x{color:red}" },
    { title: "Tipografía" },
    { html: "<p>sin título</p>" },
  ],
};

test("lays frames side by side at 1920x1080 with no overlaps", () => {
  const { frames, total } = buildDeckFrames(spec);
  assert.equal(total, 4); // cover + 3 slides
  const stride = DECK_FRAME_W + DECK_FRAME_GAP;
  frames.forEach((frame, index) => {
    assert.equal(frame.width, DECK_FRAME_W);
    assert.equal(frame.height, DECK_FRAME_H);
    assert.equal(frame.x, index * stride);
    assert.equal(frame.y, 0);
  });
  // Deterministic: same spec → same output
  assert.deepEqual(buildDeckFrames(spec), buildDeckFrames(spec));
});

test("numbers every slide and names missing titles deterministically", () => {
  const { frames } = buildDeckFrames(spec);
  assert.equal(frames[0].name, "00 — Portada");
  assert.equal(frames[1].name, "01 — Colores");
  assert.equal(frames[3].name, "03 — Sección 03");
  assert.ok(frames[1].html.includes("01 / 03"));
  assert.ok(frames[3].html.includes("03 / 03"));
  // Cover carries no page number chrome
  assert.ok(!frames[0].html.includes('data-deck-chrome="page"'));
});

test("cover uses the corporate color and slides embed brand fonts", () => {
  const { frames } = buildDeckFrames(spec);
  assert.equal(frames[0].background, "#0A4B3E");
  for (const frame of frames) {
    assert.ok(frame.css.includes("fonts.googleapis.com"), `${frame.name} imports fonts`);
    assert.ok(frame.css.includes("Fraunces"), `${frame.name} has title font`);
    assert.ok(frame.css.includes("--deck-brand: #0A4B3E"), `${frame.name} exposes brand var`);
  }
  // Free composition lands inside the deterministic content zone
  assert.ok(frames[1].html.includes("<div>paleta</div>"));
  assert.ok(frames[1].css.includes(".x{color:red}"));
});

test("free cover composition keeps the deterministic background", () => {
  const withCover = buildDeckFrames({
    ...spec,
    cover: { html: "<h1>Mi portada libre</h1>", css: "h1{font-size:200px}" },
  });
  assert.equal(withCover.frames[0].background, "#0A4B3E");
  assert.ok(withCover.frames[0].html.includes("Mi portada libre"));
  assert.ok(withCover.frames[0].css.includes("h1{font-size:200px}"));
});

test("picks readable ink from the corporate color luminance", () => {
  assert.equal(inkFor("#0A4B3E"), "#F5F1E8"); // dark green → light ink
  assert.equal(inkFor("#F2EFE6"), "#141414"); // cream → dark ink
  assert.ok(colorLuminance("#FFFFFF") > 0.9);
  assert.ok(colorLuminance("#000000") < 0.1);
});

test("rejects invalid specs with actionable errors", () => {
  assert.throws(() => buildDeckFrames({ name: "X", brand: {}, slides: [{}] }), /brand\.color/);
  assert.throws(() => buildDeckFrames({ name: "X", brand: { color: "#111111" }, slides: [] }), /slides/);
  const tooMany = { name: "X", brand: { color: "#111111" }, slides: Array.from({ length: 41 }, () => ({})) };
  assert.throws(() => buildDeckFrames(tooMany), /40/);
});

test("escapes HTML in titles and brand names", () => {
  const { frames } = buildDeckFrames({
    name: "<script>alert(1)</script>",
    brand: { name: "A&B <Co>", color: "#123456" },
    slides: [{ title: "<img onerror=x>" }],
  });
  assert.ok(!frames[0].html.includes("<script>"));
  assert.ok(frames[1].html.includes("&lt;img onerror=x&gt;"));
  assert.ok(frames[1].html.includes("A&amp;B &lt;Co&gt;"));
});
