// QA: the font auto-heal must converge — at most one import per family,
// byte-stable from the second pass on.
//
// Regression: "Roboto Mono" declared BEFORE "Roboto" (the scan order in the
// crashing template) made ensureGoogleFontImport match `family=Roboto` against
// the `family=Roboto+Mono` import line: pass 1 destroyed Mono's import, pass 2
// re-prepended it and Roboto's step ate it AGAIN while adding a second Roboto
// import — one extra Roboto import per heal pass, and the editor crashed with
// "Maximum update depth exceeded" on load (tpl_11cbed9a).
//
// Note: fallback stacks ("X, monospace") mean a locally-installed font, so
// needsWebfont skips them — candidates must be declared as single families.
//
// Run: node --experimental-strip-types --test QA/google-font-heal.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureDesignFontImports } from "../src/lib/googleFonts.ts";

const importLines = css => css.split("\n").filter(l => l.startsWith("@import"));
const importsFor = (css, familyParam) =>
  importLines(css).filter(l => l.includes(`family=${familyParam}`));

// Mono first — the candidate order that made the old code destroy and regrow.
const COLLIDING_CSS = [
  "@import url('https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,400;0,700&display=swap');",
  "code { font-family: Roboto Mono; }",
  "body { font-family: Roboto; }",
].join("\n");

test("prefix collision: Roboto does not eat Roboto Mono's import and converges", () => {
  const first = ensureDesignFontImports(COLLIDING_CSS, "");
  const twice = ensureDesignFontImports(first.css, "").css;
  const thrice = ensureDesignFontImports(twice, "").css;
  assert.equal(twice, thrice, "byte-stable from the second pass on");
  assert.deepEqual(
    ensureDesignFontImports(twice, "").families, [],
    "second pass emits nothing — exactly one heal emit in the editor",
  );
  assert.equal(
    importsFor(first.css, "Roboto+Mono").length, 1,
    "Roboto Mono keeps exactly its own import",
  );
  assert.equal(
    importsFor(first.css, "Roboto&").length, 1,
    "exactly one Roboto import, never duplicated",
  );
});

test("no unbounded growth: repeated heals never add import lines", () => {
  let cur = COLLIDING_CSS;
  const counts = [];
  for (let i = 0; i < 8; i++) {
    cur = ensureDesignFontImports(cur, "").css;
    counts.push(importLines(cur).length);
  }
  assert.deepEqual(
    counts, Array(8).fill(counts[0]),
    `import line count never grows (old bug: +1 per pass): ${counts.join(",")}`,
  );
  assert.ok(counts[0] <= 2, "one import per family at most");
});

test("right-delimited guard: family=Roboto does not satisfy Roboto Mono", () => {
  const css = [
    "@import url('https://fonts.googleapis.com/css2?family=Roboto&display=swap');",
    "code { font-family: Roboto Mono; }",
  ].join("\n");
  const healed = ensureDesignFontImports(css, "").css;
  assert.ok(
    healed.includes("family=Roboto+Mono"),
    "Roboto Mono still receives its own import",
  );
});
