// REQ-013 — design-extractor must resolve CSS custom properties (var()) before extraction.
// Red test: run against current code — fixtures (a) and (c) FAIL until the fix lands.
// Regression: fixture (b) fingerprint must stay identical after the fix (captured pre-fix).
import { extractDesignSystem, computeStyleFingerprint } from "../netlify/functions/design-extractor.mjs";

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; console.log("  PASS  " + name); }
  else { failed++; console.log("  FAIL  " + name + (detail ? " — " + detail : "")); }
}

// ── Fixture A: "Sweet Bread Card" — colors/fonts behind var() (REQ evidence) ──
const sweetBreadCss = `
.bread-card {
  --ds-color-bg: #FAF7EF;
  --ds-color-primary: #3252CB;
  --ds-font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  width: 400px; padding: 32px;
  background-color: var(--ds-color-bg);
  color: var(--ds-color-primary);
  font-family: var(--ds-font-family);
  font-size: 16px; line-height: 1.4;
  border-radius: 16px;
}
.bread-card h1 { color: var(--ds-color-primary); font-size: 28px; font-weight: 700; }
`;
const framesA = [{ id: "f1", name: "Card", html: "<div class='bread-card'><h1>Pan</h1></div>", css: sweetBreadCss, width: 400, height: 400 }];
const extA = extractDesignSystem(framesA);

console.log("Fixture A — var() resolution (Sweet Bread Card)");
const colorValsA = (extA.colors || []).map(c => (c.value || "").toLowerCase());
check("blue #3252cb extracted", colorValsA.includes("#3252cb"), "colors: " + JSON.stringify(colorValsA));
check("cream #faf7ef extracted", colorValsA.includes("#faf7ef"), "colors: " + JSON.stringify(colorValsA));
const famA = (extA.typography.families || []).map(f => f.name);
check("family resolved to real name", famA.some(n => n.indexOf("Helvetica Neue") !== -1), "families: " + JSON.stringify(famA));
check("no unresolved var() family", !famA.some(n => n.indexOf("var(") !== -1), "families: " + JSON.stringify(famA));
const constraintsA = (extA.constraints || []).join(" ").toLowerCase();
check("no 'monochrome' constraint", constraintsA.indexOf("monochrome") === -1, "constraints: " + JSON.stringify(extA.constraints));

// ── Fixture B: literal hex design — REGRESSION (fingerprint must never change) ──
const literalCss = `
.poster { width: 300px; padding: 24px; background-color: #FFFFFF; color: #111111; font-family: Georgia, serif; font-size: 18px; border-radius: 8px; }
.poster h2 { color: #E23A3A; font-size: 24px; font-weight: 700; }
`;
const framesB = [{ id: "f1", name: "Poster", html: "<div class='poster'><h2>Hola</h2></div>", css: literalCss, width: 300, height: 300 }];
const fpB = computeStyleFingerprint(extractDesignSystem(framesB));
console.log("Fixture B — literal hex regression");
check("fingerprint stable (pre/post-fix identical)", fpB === "fa112940647ae8d3", "got " + fpB + " — if the fix changed this, extraction of literal designs regressed");

// ── Fixture C: var(--x, fallback) ──
const fallbackCss = `
.card {
  --real: #00AA55;
  color: var(--real, #FF0000);
  background-color: var(--missing, #F0F0F0);
  font-family: var(--missing-font, "Courier New", monospace);
}
`;
const framesC = [{ id: "f1", name: "Card", html: "<div class='card'>x</div>", css: fallbackCss, width: 200, height: 200 }];
const extC = extractDesignSystem(framesC);
console.log("Fixture C — var() with fallback");
const colorValsC = (extA.colors && extC.colors || []).map(c => (c.value || "").toLowerCase());
check("defined var wins over fallback (#00aa55)", colorValsC.includes("#00aa55"), "colors: " + JSON.stringify(colorValsC));
check("fallback used when var missing (#f0f0f0)", colorValsC.includes("#f0f0f0"), "colors: " + JSON.stringify(colorValsC));
const famC = (extC.typography.families || []).map(f => f.name);
check("font fallback resolved (Courier New)", famC.some(n => n.indexOf("Courier New") !== -1), "families: " + JSON.stringify(famC));

// ── Fixture D: per-frame scoping — same prop name, different values per frame ──
const framesD = [
  { id: "fa", name: "A", html: "<div class='c'>a</div>", css: ".c { --bg: #112233; background-color: var(--bg); }", width: 100, height: 100 },
  { id: "fb", name: "B", html: "<div class='c'>b</div>", css: ".c { --bg: #CCDD44; background-color: var(--bg); }", width: 100, height: 100 },
];
const extD = extractDesignSystem(framesD);
console.log("Fixture D — per-frame scoping");
const colorValsD = (extD.colors || []).map(c => (c.value || "").toLowerCase());
check("frame A color resolved (#112233)", colorValsD.includes("#112233"), "colors: " + JSON.stringify(colorValsD));
check("frame B color resolved (#ccdd44)", colorValsD.includes("#ccdd44"), "colors: " + JSON.stringify(colorValsD));

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed > 0 ? 1 : 0);
