/**
 * match_color — deterministic color-extraction core (shared/colorExtract.ts).
 * The math is pure TS, so these are REAL behavioral tests, not structural pins.
 * Run: node --experimental-strip-types QA/color-matcher.test.mjs
 */
import assert from "node:assert/strict";
import {
  hexToRgb, rgbToHex, parseColorString, rgbToLab, labToRgb, labToHex,
  deltaE2000, kMeansLab, sanitizeRegions, sampleRegionPixels,
  extractColors, brandColorTokens, nameColor, gradientToCss,
} from "../shared/colorExtract.ts";

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log(`  ok ${name}`); };

// ── hex / rgb parsing ──

t("hex round-trips, 3-digit form expands", () => {
  assert.deepEqual(hexToRgb("#FF8800"), { r: 255, g: 136, b: 0 });
  assert.deepEqual(hexToRgb("#f80"), { r: 255, g: 136, b: 0 });
  assert.equal(rgbToHex({ r: 255, g: 136, b: 0 }), "#ff8800");
  assert.equal(hexToRgb("nope"), null);
  assert.equal(hexToRgb(""), null);
});

t("parseColorString accepts hex and rgb()/rgba()", () => {
  assert.deepEqual(parseColorString("#7C3AED"), { r: 124, g: 58, b: 237 });
  assert.deepEqual(parseColorString("rgb(124, 58, 237)"), { r: 124, g: 58, b: 237 });
  assert.deepEqual(parseColorString("rgba(255,0,0,0.5)"), { r: 255, g: 0, b: 0 });
  assert.equal(parseColorString("solid red"), null);
});

// ── Lab round-trip ──

t("rgb -> lab -> rgb round-trips within 1 unit", () => {
  for (const hex of ["#000000", "#ffffff", "#7c3aed", "#224466", "#ff7f50", "#10b981"]) {
    const rgb = hexToRgb(hex);
    const back = labToRgb(rgbToLab(rgb));
    assert.ok(Math.abs(back.r - rgb.r) <= 1 && Math.abs(back.g - rgb.g) <= 1 && Math.abs(back.b - rgb.b) <= 1, hex);
  }
});

// ── CIEDE2000 (Sharma 2005 verification pairs) ──

t("deltaE2000 identical colors = 0", () => {
  const lab = rgbToLab({ r: 124, g: 58, b: 237 });
  assert.equal(deltaE2000(lab, lab), 0);
});

t("deltaE2000 matches Sharma reference pairs", () => {
  const pair = (a, b) => deltaE2000(
    { L: a[0], a: a[1], b: a[2] },
    { L: b[0], a: b[1], b: b[2] },
  );
  // Sharma et al. 2005, test data pairs 1 and 2.
  assert.ok(Math.abs(pair([50.0, 2.6772, -79.7751], [50.0, 0.0, -82.7485]) - 2.0425) < 0.01);
  assert.ok(Math.abs(pair([50.0, 3.1571, -77.2803], [50.0, 0.0, -82.7485]) - 2.8615) < 0.01);
  // Blue vs red is a huge perceptual gap.
  const blue = rgbToLab({ r: 0, g: 0, b: 255 });
  const red = rgbToLab({ r: 255, g: 0, b: 0 });
  assert.ok(deltaE2000(blue, red) > 20);
});

// ── Deterministic k-means ──

t("k-means is reproducible (fixed seed semantics)", () => {
  const pts = Array.from({ length: 300 }, (_, i) => {
    const g = i % 3;
    return { L: 30 + g * 25, a: g * 8 - 8, b: (i * 7919) % 13 - 6 };
  });
  const a = kMeansLab(pts, 3);
  const b = kMeansLab(pts, 3);
  assert.deepEqual(a, b);
  assert.equal(a.centroids.length, 3);
});

// ── Region sanitization ──

t("sanitizeRegions rejects degenerate, out-of-bounds, tiny and duplicate boxes", () => {
  const ctx = { width: 800, height: 600 };
  const { accepted, rejected } = sanitizeRegions([
    { role: "ok", x: 0.1, y: 0.1, w: 0.5, h: 0.3 },
    { role: "zero", x: 0.5, y: 0.5, w: 0.001, h: 0.001 },
    { role: "nan", x: NaN, y: 0.1, w: 0.2, h: 0.2 },
    { role: "oob", x: 0.5, y: 0.5, w: 0.9, h: 0.9 },
    { role: "dupe", x: 0.12, y: 0.11, w: 0.48, h: 0.28 },
    { role: "thin", x: 0.0, y: 0.97, w: 0.5, h: 0.02 },
  ], ctx);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].input.role, "ok");
  assert.equal(rejected.length, 5);
  assert.ok(rejected.every(r => r.reason && r.reason.length > 10));
  // erosion shrinks the accepted box by ~5% per side
  const bx = accepted[0].boxPx;
  assert.ok(bx.w < 0.5 * ctx.width && bx.w > 0.8 * 0.5 * ctx.width);
});

// ── Synthetic image classification ──

const solidImage = (hex, w = 64, h = 64) => {
  const { r, g, b } = hexToRgb(hex);
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 255; }
  return { data, width: w, height: h, channels: 4 };
};

const gradientImage = (from, to, w = 128, h = 64) => {
  const A = hexToRgb(from), B = hexToRgb(to);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const wgt = x / (w - 1);
      const o = (y * w + x) * 4;
      data[o] = Math.round(A.r + (B.r - A.r) * wgt);
      data[o + 1] = Math.round(A.g + (B.g - A.g) * wgt);
      data[o + 2] = Math.round(A.b + (B.b - A.b) * wgt);
      data[o + 3] = 255;
    }
  }
  return { data, width: w, height: h, channels: 4 };
};

const noiseImage = (w = 96, h = 96, seed = 7) => {
  const data = new Uint8Array(w * h * 4);
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = Math.floor(rnd() * 256);
    data[i * 4 + 1] = Math.floor(rnd() * 256);
    data[i * 4 + 2] = Math.floor(rnd() * 256);
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h, channels: 4 };
};

t("solid region classifies solid with the exact hex, high confidence", () => {
  const img = solidImage("#224466");
  const out = extractColors({ ...img, regions: [{ role: "background", x: 0.1, y: 0.1, w: 0.8, h: 0.8 }] });
  assert.equal(out.regions.length, 1);
  const r = out.regions[0];
  assert.equal(r.type, "solid");
  assert.equal(r.confidence, "high");
  assert.equal(r.colors[0].hex, "#224466");
  assert.ok(r.colors[0].coverage > 0.9);
  assert.equal(r.fitScore <= 1.5, true);
});

t("horizontal black->white gradient emits linear-gradient(90deg, ...) with low fitScore", () => {
  const img = gradientImage("#000000", "#ffffff");
  const out = extractColors({ ...img, regions: [{ role: "hero", x: 0.05, y: 0.1, w: 0.9, h: 0.8 }] });
  const r = out.regions[0];
  assert.equal(r.type, "gradient");
  assert.ok(r.gradientCss.startsWith("linear-gradient(90deg"), r.gradientCss);
  assert.ok(r.gradient.stops.length >= 2 && r.gradient.stops.length <= 5);
  // Endpoint positions are pinned to 0/100 (CSS renders identically); endpoint
  // colors are robust medians of what the region actually contains — near the
  // extremes but never extrapolated/invented.
  assert.equal(r.gradient.stops[0].position, 0);
  assert.equal(r.gradient.stops[r.gradient.stops.length - 1].position, 100);
  const first = hexToRgb(r.gradient.stops[0].hex);
  const last = hexToRgb(r.gradient.stops[r.gradient.stops.length - 1].hex);
  assert.ok(Math.max(first.r, first.g, first.b) < 60, `first stop not near-black: ${r.gradient.stops[0].hex}`);
  assert.ok(Math.min(last.r, last.g, last.b) > 200, `last stop not near-white: ${r.gradient.stops[r.gradient.stops.length - 1].hex}`);
  assert.ok(r.fitScore <= 3, `fitScore ${r.fitScore}`);
  assert.equal(r.confidence, "high");
});

t("three-stop diagonal gradient fits with stops at both ends", () => {
  // Diagonal (45deg-ish) 3-stop gradient; PCA should find the axis.
  const w = 128, h = 128;
  const stops = [hexToRgb("#1e3a8a"), hexToRgb("#7c3aed"), hexToRgb("#db2777")];
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = (x / (w - 1) + y / (h - 1)) / 2; // 0..1 along the diagonal
      const seg = v < 0.5 ? 0 : 1;
      const local = (v - seg * 0.5) / 0.5;
      const A = stops[seg], B = stops[seg + 1];
      const o = (y * w + x) * 4;
      data[o] = Math.round(A.r + (B.r - A.r) * local);
      data[o + 1] = Math.round(A.g + (B.g - A.g) * local);
      data[o + 2] = Math.round(A.b + (B.b - A.b) * local);
      data[o + 3] = 255;
    }
  }
  const out = extractColors({ data, width: w, height: h, channels: 4, regions: [{ role: "cover", x: 0, y: 0, w: 1, h: 1 }] });
  const r = out.regions[0];
  assert.equal(r.type, "gradient");
  // top-left → bottom-right = "to bottom right" = 135deg in CSS terms
  assert.ok(r.gradientCss.startsWith("linear-gradient(135deg"), r.gradientCss);
  assert.ok(r.fitScore <= 3, `fitScore ${r.fitScore}`);
  const first = hexToRgb(r.gradient.stops[0].hex);
  const last = hexToRgb(r.gradient.stops[r.gradient.stops.length - 1].hex);
  // first ≈ #1e3a8a (blue-dominant dark), last ≈ #db2777 (red/pink) — medians, not exact.
  assert.ok(first.b > 90 && first.b > first.r + 20 && first.r < 90, JSON.stringify(first));
  assert.ok(last.r > 150 && last.r > last.g + 60, JSON.stringify(last));
});

t("noise classifies as photo/texture, never invents a gradient", () => {
  const img = noiseImage();
  const out = extractColors({ ...img, regions: [{ role: "art", x: 0, y: 0, w: 1, h: 1 }] });
  const r = out.regions[0];
  assert.ok(["photo", "texture"].includes(r.type), r.type);
  assert.ok(r.gradientCss === null);
  assert.ok(r.fitScore > 3, `fitScore ${r.fitScore}`);
});

t("semi-transparent region reports alpha hypothesis", () => {
  const w = 64, h = 64;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 20; data[i * 4 + 1] = 40; data[i * 4 + 2] = 80; data[i * 4 + 3] = 128; }
  const out = extractColors({ data, width: w, height: h, channels: 4, regions: [{ role: "overlay", x: 0.2, y: 0.2, w: 0.6, h: 0.6 }] });
  const r = out.regions[0];
  assert.equal(r.type, "solid");
  assert.ok(r.alpha && r.alpha.semiTransparent === true, "expected alpha hypothesis");
  assert.ok(r.alpha.alphaEstimate > 0.3 && r.alpha.alphaEstimate < 0.7);
});

t("brandMatch reports closest token with deltaE", () => {
  const img = solidImage("#7c3aed");
  const out = extractColors({
    ...img,
    regions: [{ role: "accent", x: 0, y: 0, w: 1, h: 1 }],
    brandTokens: [{ path: "color.accent", hex: "#7c3aed" }, { path: "color.bg", hex: "#0b1020" }],
  });
  const m = out.regions[0].colors[0].brandMatch;
  assert.equal(m.token, "color.accent");
  assert.ok(m.deltaE < 1);
});

// ── Naming ──

t("nameColor recognizes CSS-named colors and falls back to hue names", () => {
  assert.equal(nameColor("#008080"), "teal");
  assert.equal(nameColor("#ff0000"), "red");
  const named = nameColor("#3366ff");
  assert.ok(typeof named === "string" && named.length > 2, named);
  assert.ok(/(deep|dark|soft|pale|vivid|muted|bright)?\s?(red|orange|amber|lime|green|teal|cyan|azure|blue|indigo|violet|magenta|rose)/.test(named), named);
});

// ── DTCG brand token parsing ──

t("brandColorTokens walks DTCG color group and tolerates flat maps", () => {
  const dtcg = JSON.stringify({
    color: {
      accent: { $type: "color", $value: "#7C3AED" },
      background: { $type: "color", $value: "#0B1020" },
      muted: { $type: "color", $value: "rgb(148, 163, 184)" },
    },
    typography: { body: { $type: "dimension", $value: "16px" } },
  });
  const tokens = brandColorTokens(dtcg);
  assert.equal(tokens.length, 3);
  assert.ok(tokens.some(tk => tk.path === "color.accent" && tk.hex === "#7c3aed"));
  assert.ok(tokens.some(tk => tk.hex === "#94a3b8"));

  const flat = brandColorTokens(JSON.stringify({ color: { accent: "#ff0000", bg: "#00ff00" } }));
  assert.equal(flat.length, 2);

  assert.deepEqual(brandColorTokens("not json"), []);
  assert.deepEqual(brandColorTokens(null), []);
});

// ── Gradient CSS emission ──

t("gradientToCss emits valid CSS for linear and radial", () => {
  const lin = gradientToCss({ kind: "linear", angleDeg: 135, stops: [{ hex: "#000000", position: 0 }, { hex: "#ffffff", position: 100 }] });
  assert.equal(lin, "linear-gradient(135deg, #000000 0%, #ffffff 100%)");
  const rad = gradientToCss({ kind: "radial", center: { x: 0.5, y: 0.3 }, stops: [{ hex: "#123456", position: 0 }, { hex: "#654321", position: 100 }] });
  assert.equal(rad, "radial-gradient(circle at 50% 30%, #123456 0%, #654321 100%)");
});

console.log(`\ncolor-matcher: ${passed} tests passed`);
