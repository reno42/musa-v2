// Validates the IDE agent's PROPOSED fix (delimiter-based matching) as a
// standalone reimplementation — repo file untouched.
import { ensureDesignFontImports as healCurrent } from "../src/lib/googleFonts.ts";

// ── The agent's proposed matching, transcribed from their message ──
function requestableFamily(family) { return family; }
function encodeFamily(f) { return encodeURIComponent(f.trim()).replace(/%20/g, "+"); }
function googleFontHref(family) {
  return `https://fonts.googleapis.com/css2?family=${encodeFamily(family)}&display=swap`;
}
function ensureGoogleFontImportFixed(css, family) {
  const requestable = requestableFamily(family);
  const href = googleFontHref(requestable);
  if (!href) return css;
  const wanted = `@import url('${href}');`;
  const enc = encodeFamily(requestable);
  const opener = `@import url('https://fonts.googleapis.com/css2?family=`;
  const lines = css.split("\n");
  let sawImport = false;
  const merged = lines.map(line => {
    const rest = line.startsWith(opener) ? line.slice(opener.length) : null;
    if (rest === null || !rest.startsWith(enc)) return line;
    const next = rest.slice(enc.length);
    if (!/^[&:'']/.test(next)) return line;           // delimiter check: +, &, :, or closing quote
    sawImport = true;
    return line === wanted ? line : wanted;
  });
  if (sawImport) return merged.join("\n");
  // guard with same delimiter discipline
  const needle = `family=${enc}`;
  let idx = css.indexOf(needle);
  while (idx !== -1) {
    const next = css.slice(idx + needle.length, idx + needle.length + 1);
    if (/^[&:'']/.test(next)) return css;
    idx = css.indexOf(needle, idx + 1);
  }
  return `${wanted}\n${css}`;
}
function healFixed(css, html = "") {
  const fams = new Set();
  for (const m of (css || "").matchAll(/font-family\s*:\s*([^;{}]+)/gi)) {
    const v = m[1].trim().replace(/['"]/g, "");
    if (v && !/[()]/.test(v)) fams.add(v);
  }
  let healed = css || "";
  for (const f of fams) healed = ensureGoogleFontImportFixed(healed, f);
  return { css: healed };
}

let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!cond) failures++;
};

// Scenario 4 (the crash): collision, both declared
const css4 = `@import url('https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,300;0,400;0,500;1,300;1,400&display=swap');
.label { font-family: 'Roboto Mono'; }
.title { font-family: Roboto; }`;

// current code, for contrast
let cur = css4, curEmits = 0;
for (let i = 0; i < 8; i++) { const h = healCurrent(cur, ""); if (h.css !== cur) curEmits++; cur = h.css; }
check("CURRENT converges <=2 emits (expect FAIL)", curEmits <= 2, `emits=${curEmits}`);

// fixed version
let fix = css4, fixEmits = 0;
const lens = [];
for (let i = 0; i < 6; i++) {
  const h = healFixed(fix, "");
  if (h.css !== fix) fixEmits++;
  fix = h.css;
  lens.push(fix.length);
}
check("FIXED converges <=2 emits", fixEmits <= 2, `emits=${fixEmits}`);
check("FIXED byte-stable by pass 3", lens[2] === lens[5], `lens=${lens.join(",")}`);
check("FIXED keeps Roboto Mono import", fix.includes("family=Roboto+Mono"));
check("FIXED has exactly one Roboto import", (fix.match(/family=Roboto&/g) || []).length === 1);
check("FIXED has exactly one Roboto Mono import", (fix.match(/family=Roboto\+Mono/g) || []).length === 1);
console.log("\nFixed css at fixpoint:\n" + fix);

console.log(failures === 0 ? "\nFIX VALIDATED" : `\n${failures} FAILURES`);
process.exit(failures ? 1 : 0);
