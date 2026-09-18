// Probe: reproduce the font auto-heal loop with the REAL repo functions.
import { ensureDesignFontImports, ensureGoogleFontImport } from "../src/lib/googleFonts.ts";

let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!cond) failures++;
};

// ── Scenario 1: collision — "Roboto" declared + existing "Roboto Mono" import ──
// The illustration's situation: font-family: Roboto in css, Roboto Mono import present.
const css1 = `@import url('https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,400;1,400&display=swap');
body { font-family: Roboto; }`;

let css = css1;
const lengths = [];
for (let i = 0; i < 5; i++) {
  const { css: healed } = ensureDesignFontImports(css, "");
  css = healed;
  lengths.push(css.length);
  console.log(`  pass ${i + 1}: len=${css.length}`);
}
const stable = lengths[3] === lengths[4];
const monoKept = css.includes("family=Roboto+Mono");
const robotoOnce = (css.match(/family=Roboto&/g) || css.match(/family=Roboto[&:'']/g) || []).length;
check("S1 converges (byte-stable by pass 4-5)", stable, `lengths=${lengths.join(",")}`);
check("S1 Roboto Mono import survives", monoKept);
check("S1 no duplicate Roboto imports", robotoOnce <= 1, `count=${robotoOnce}`);

// ── Scenario 2: ensureGoogleFontImport direct — prefix collision ──
// Asking for Roboto must NOT treat the Roboto Mono import line as Roboto's own.
const css2 = `@import url('https://fonts.googleapis.com/css2?family=Roboto+Mono&display=swap');\n.x{}`;
const out2 = ensureGoogleFontImport(css2, "Roboto", ["400"]);
const hasMono = out2.includes("family=Roboto+Mono");
const hasBare = out2.includes("family=Roboto&") || out2.includes("family=Roboto'");
check("S2 Roboto import added when only Roboto Mono present", hasBare);
check("S2 Roboto Mono import NOT eaten", hasMono);
// and the reverse: asking for Roboto Mono must not be satisfied by bare Roboto import
const css3 = `@import url('https://fonts.googleapis.com/css2?family=Roboto&display=swap');\n.x{font-family:'Roboto Mono';}`;
const out3 = ensureGoogleFontImport(css3, "Roboto Mono", ["400"]);
check("S3 Roboto Mono import added when only Roboto present", out3.includes("family=Roboto+Mono"));
check("S3 bare Roboto import NOT eaten", out3.split("family=Roboto&").length + out3.split("family=Roboto'").length >= 2);

// ── Scenario 4: the reported crash — both families with mono imported first w/ axis ──
// Simulate what DesignFrame does: heal repeatedly, emitting when changed (the loop).
const css4 = `@import url('https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,300;0,400;0,500;1,300;1,400&display=swap');
.label { font-family: 'Roboto Mono'; }
.title { font-family: Roboto; }`;
let c4 = css4;
let emits = 0;
for (let i = 0; i < 8; i++) {
  const { css: healed } = ensureDesignFontImports(c4, "");
  if (healed !== c4) emits++;
  c4 = healed;
}
check("S4 heals converge within 2 passes", emits <= 2, `emits=${emits}`);
check("S4 both imports present at fixpoint", c4.includes("family=Roboto+Mono") && /family=Roboto[&:'']/.test(c4));
console.log("\\nFinal S4 css:\\n" + c4);

console.log(failures === 0 ? "\\nALL PASS" : `\\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
