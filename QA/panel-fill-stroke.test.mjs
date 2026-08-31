/**
 * Unit tests for the contextual panel's F1/F2 libs:
 *  - F2 fill system: gradient parse/build (incl. the diamond conic trick),
 *    interpolated stop color, and the picker's color formats (colorUtils).
 *  - F1 buscatrazos: pathBoolean (union/subtract/intersect/exclude) over
 *    flattened shape rings.
 *
 * Run: node --test QA/panel-fill-stroke.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const load = (rel) => import("file://" + resolve(__dirname, "..", rel));

const { splitTopLevelCommas, parseGradientValue, buildGradientCss, gradientColorAt } = await load("src/lib/gradient.ts");
const { parseColorText, formatColor } = await load("src/lib/colorUtils.ts");
const { sampleShapeRing, booleanShapeOp, ringsToPathD, ringsBounds } = await load("src/lib/pathBoolean.ts");

// ── F2: gradient lib ──

describe("splitTopLevelCommas", () => {
  it("keeps commas inside rgb() as part of one stop", () => {
    const parts = splitTopLevelCommas("rgb(102, 126, 234) 0%, rgb(118, 75, 162) 100%");
    assert.equal(parts.length, 2);
    assert.match(parts[0], /^rgb\(102, 126, 234\)/);
  });
});

describe("parseGradientValue", () => {
  it("parses an authored linear gradient with deg angle", () => {
    const g = parseGradientValue("linear-gradient(90deg, #667eea 0%, #764ba2 100%)");
    assert.equal(g.type, "linear");
    assert.equal(g.angle, 90);
    assert.deepEqual(g.stops.map(s => s.pos), [0, 100]);
    assert.equal(g.stops[0].color, "#667eea");
  });

  it("parses the computed form the browser always reports (rgb stops)", () => {
    const g = parseGradientValue("linear-gradient(45deg, rgb(102, 126, 234) 0%, rgb(118, 75, 162) 100%)");
    assert.equal(g.angle, 45);
    assert.equal(g.stops[0].color, "#667eea");
    assert.equal(g.stops[1].color, "#764ba2");
  });

  it("reads rgba stop alpha and converts keyword direction", () => {
    const g = parseGradientValue("linear-gradient(to right, rgba(255, 0, 0, 0.5) 0%, rgb(0, 0, 255) 100%)");
    assert.equal(g.angle, 90);
    assert.equal(g.stops[0].color, "#ff0000");
    assert.equal(g.stops[0].alpha, 0.5);
    assert.equal(g.stops[1].color, "#0000ff");
    assert.equal(g.stops[1].alpha, 1);
  });

  it("parses conic from-angle", () => {
    const g = parseGradientValue("conic-gradient(from 30deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)");
    assert.equal(g.type, "conic");
    assert.equal(g.angle, 30);
  });

  it("rejects non-gradients", () => {
    assert.equal(parseGradientValue("none"), null);
    assert.equal(parseGradientValue('url("photo.png") center/cover no-repeat'), null);
  });
});

describe("buildGradientCss", () => {
  it("round-trips a parsed linear gradient", () => {
    const g = parseGradientValue("linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)");
    const css = buildGradientCss(g);
    assert.match(css, /^linear-gradient\(90deg, /);
    const back = parseGradientValue(css);
    assert.equal(back.type, "linear");
    assert.equal(back.stops[0].color, "#ff0000");
  });

  it("serializes diamond as a conic with the stop list repeated 4×", () => {
    const css = buildGradientCss({
      type: "diamond", angle: 0,
      stops: [
        { color: "#ffffff", alpha: 1, pos: 0 },
        { color: "#000000", alpha: 1, pos: 100 },
      ],
    });
    assert.match(css, /^conic-gradient\(/);
    // conic descriptor part + 2 stops × 4 repeats + closing first stop = 10
    const inner = css.slice(css.indexOf("(") + 1, css.lastIndexOf(")"));
    assert.equal(splitTopLevelCommas(inner).length, 10);
  });

  it("emits rgba for sub-1 stop alpha", () => {
    const css = buildGradientCss({
      type: "linear", angle: 90,
      stops: [
        { color: "#ff0000", alpha: 0.25, pos: 0 },
        { color: "#0000ff", alpha: 1, pos: 100 },
      ],
    });
    assert.match(css, /rgba\(255, 0, 0, 0\.25\) 0%/);
  });
});

describe("gradientColorAt", () => {
  const stops = [
    { color: "#000000", alpha: 1, pos: 0 },
    { color: "#ffffff", alpha: 1, pos: 100 },
  ];
  it("interpolates the mid color", () => {
    assert.equal(gradientColorAt(stops, 50).color, "#808080");
  });
  it("clamps outside the stop range", () => {
    assert.equal(gradientColorAt(stops, -10).color, "#000000");
    assert.equal(gradientColorAt(stops, 150).color, "#ffffff");
  });
});

// ── F2: color formats for the picker's value field ──

describe("parseColorText", () => {
  it("expands short hex and reads 8-digit alpha", () => {
    assert.deepEqual(parseColorText("#abc"), { hex: "#aabbcc", alpha: 1 });
    const eight = parseColorText("#ff000080");
    assert.equal(eight.hex, "#ff0000");
    assert.ok(Math.abs(eight.alpha - 128 / 255) < 0.01);
  });

  it("parses rgb/rgba (the computed-style shape)", () => {
    assert.equal(parseColorText("rgb(255, 0, 0)").hex, "#ff0000");
    assert.deepEqual(parseColorText("rgba(255, 0, 0, 0.5)"), { hex: "#ff0000", alpha: 0.5 });
  });

  it("parses hsl/hsb/cmyk", () => {
    assert.equal(parseColorText("hsl(120, 100%, 50%)").hex, "#00ff00");
    assert.equal(parseColorText("hsb(0, 100%, 100%)").hex, "#ff0000");
    assert.equal(parseColorText("cmyk(0%, 100%, 100%, 0%)").hex, "#ff0000");
  });

  it("parses modern space-separated rgb and rejects garbage", () => {
    assert.equal(parseColorText("rgb(255 0 0)").hex, "#ff0000");
    assert.equal(parseColorText("not-a-color"), null);
    assert.equal(parseColorText(""), null);
  });

  it("resolves named css colors via the canvas (browser only; Node has none)", () => {
    if (typeof document === "undefined") {
      assert.equal(parseColorText("white"), null);
    } else {
      assert.equal(parseColorText("white").hex, "#ffffff");
    }
  });
});

describe("formatColor", () => {
  it("formats rgb and rgba", () => {
    assert.equal(formatColor("#ff0000", "rgb"), "rgb(255, 0, 0)");
    assert.equal(formatColor("#ff0000", "rgb", 0.5), "rgba(255, 0, 0, 0.5)");
  });
  it("formats cmyk", () => {
    assert.equal(formatColor("#ff0000", "cmyk"), "cmyk(0%, 100%, 100%, 0%)");
  });
});

// ── F1: buscatrazos over flattened shape rings ──

const squareA = sampleShapeRing("M0 0L100 0L100 100L0 100Z");
const squareB = sampleShapeRing("M50 50L150 50L150 150L50 150Z");

describe("sampleShapeRing", () => {
  it("flattens a closed path into a usable ring", () => {
    assert.ok(squareA.length >= 3);
    assert.deepEqual(ringsBounds([squareA]), [0, 0, 100, 100]);
  });

  it("densely samples cubic curves", () => {
    const blob = sampleShapeRing("M0 50C0 22.4 22.4 0 50 0C77.6 0 100 22.4 100 50C100 77.6 77.6 100 50 100C22.4 100 0 77.6 0 50Z");
    assert.ok(blob.length >= 4 * 8, `expected dense ring, got ${blob.length} points`);
  });

  it("returns null for degenerate input", () => {
    assert.equal(sampleShapeRing("M5 5L10 10"), null);
    assert.equal(sampleShapeRing("total garbage"), null);
  });
});

describe("booleanShapeOp", () => {
  const area = (rings) => Math.abs(rings.reduce((acc, ring) => {
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return acc + a / 2;
  }, 0));

  it("needs at least two shapes", () => {
    assert.equal(booleanShapeOp("union", [squareA]), null);
  });

  it("union merges the overlap once", () => {
    const rings = booleanShapeOp("union", [[squareA], [squareB]]);
    assert.ok(Math.abs(area(rings) - 17500) < 2, `union area ${area(rings)}`);
    assert.deepEqual(ringsBounds(rings), [0, 0, 150, 150]);
  });

  it("subtract carves the overlap out of the first shape", () => {
    const rings = booleanShapeOp("subtract", [[squareA], [squareB]]);
    assert.ok(Math.abs(area(rings) - 7500) < 2, `subtract area ${area(rings)}`);
  });

  it("intersect keeps only the overlap", () => {
    const rings = booleanShapeOp("intersect", [[squareA], [squareB]]);
    assert.ok(Math.abs(area(rings) - 2500) < 2, `intersect area ${area(rings)}`);
  });

  it("exclude drops the overlap from both", () => {
    const rings = booleanShapeOp("exclude", [[squareA], [squareB]]);
    assert.ok(Math.abs(area(rings) - 15000) < 4, `exclude area ${area(rings)}`);
  });
});

describe("ringsToPathD", () => {
  it("serializes rings as closed subpaths", () => {
    const d = ringsToPathD([squareA]);
    assert.match(d, /^M/);
    assert.ok(d.includes("Z"));
    // the clipper's closed rings must not emit a duplicated closing point
    assert.ok(!d.includes("ZL") && !/L[\d.]+ [\d.]+ZL/.test(d));
  });
});
