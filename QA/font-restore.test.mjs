// QA: reopening a file must restore every webfont its frames reference at
// DOCUMENT level — the only surface the editor canvas reliably resolves.
//
// Bug (Test Instinct report, 2026-10-23): the font binding persisted in the
// model, but no open-path loaded the font file — `document.fonts` only ever
// held Instrument Serif and every referenced family fell back to serif. A
// picker click fixed the session (it loads document-level), and Present mode
// worked (its iframe puts font links in a real <head>).
//
// Run: node --experimental-strip-types --test QA/font-restore.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { collectDesignFontRefs, familyFromFontShorthand } from "../src/lib/fontRestore.ts";
import { css2FamilyParam, css2AxisCoverage, googleHrefWidens, googleFontHref } from "../src/lib/googleFonts.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf-8");

// The wordmark layer from the report, verbatim shape.
const REPORT_HTML = [
  "<link href=\"https://fonts.googleapis.com/css2?family=Archivo+Black&display=swap\" rel=\"stylesheet\">",
  "<div data-layer-id=\"wordmark\" data-layer-name=\"Wordmark\"",
  "     style=\"position:absolute;left:82px;top:470px;font:400 220px 'Archivo Black';color:#111\">MUSA</div>",
  "<div data-layer-id=\"mono\" style=\"font-family: 'Space Mono'; font-size: 18px\">XP</div>",
].join("\n");

test("collect: hrefs from @import, <link> and families from shorthand + quoted declarations", () => {
  const refs = collectDesignFontRefs([
    {
      css: "@import url('https://fonts.googleapis.com/css2?family=Archivo+Black:wght@400&display=swap');\nbody { font-family: Arial, Helvetica, sans-serif; }",
      html: REPORT_HTML,
    },
  ]);
  assert.ok(refs.hrefs.includes("https://fonts.googleapis.com/css2?family=Archivo+Black:wght@400&display=swap"), "the css @import is hoisted verbatim (axes survive)");
  assert.ok(refs.hrefs.includes("https://fonts.googleapis.com/css2?family=Archivo+Black&display=swap"), "the imported document's <link> is hoisted verbatim");
  assert.ok(refs.families.includes("Archivo Black"), "font: shorthand quotes yield the family");
  assert.ok(refs.families.includes("Space Mono"), "quoted font-family in a style attribute is not cut at its quote");
  assert.ok(refs.families.includes("Arial, Helvetica, sans-serif"), "stacks are kept whole — the gate needs them to skip installed fonts");
});

test("collect: adjacent font: shorthands and serialized quote shapes all parse", () => {
  const refs = collectDesignFontRefs([{
    css: "h1{font: 700 16px/1.2 One;font: 400 32px Two}",
    // Round-tripped html carries embedded quotes as &quot; entities; freshly
    // imported html may hold them raw inside a single-quoted attribute.
    html: [
      "<div style=\"font: 400 210px &quot;1 ArchivoBlack&quot;\">MUSA</div>",
      "<div style='font: 400 96px \"Space Grotesk\"'>XP</div>",
    ].join("\n"),
  }]);
  assert.ok(refs.families.includes("One"), "the shorthand after the first one is not eaten");
  assert.ok(refs.families.includes("Two"));
  assert.ok(refs.families.includes("1 ArchivoBlack"), "&quot; entities decode before parsing — Musa's renamed upload family is matched");
  assert.ok(refs.families.includes("Space Grotesk"), "raw quotes inside a single-quoted style attribute parse");
});

test("shorthand parser: quoted wins, unquoted takes everything after the size", () => {
  assert.equal(familyFromFontShorthand("400 220px 'Archivo Black'"), "Archivo Black");
  assert.equal(familyFromFontShorthand("italic 700 16px/1.2 Source Sans 3, serif"), "Source Sans 3, serif");
  assert.equal(familyFromFontShorthand("210px Marker"), "Marker");
  assert.equal(familyFromFontShorthand("bold"), ""); // no size → not parseable, never guessed
});

test("css2 href helpers: full-run family param, axis coverage, only-widen guard", () => {
  assert.equal(css2FamilyParam("https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,400&display=swap"), "Roboto+Mono:ital,wght@0,400");
  assert.equal(css2FamilyParam("https://fonts.googleapis.com/css2?family=Roboto&display=swap"), "Roboto");
  assert.deepEqual([...css2AxisCoverage("https://fonts.googleapis.com/css2?family=X:wght@400;700")].sort(), ["wght:400", "wght:700"]);
  assert.equal(css2AxisCoverage("https://fonts.googleapis.com/css2?family=X&display=swap").size, 0, "bare family → empty coverage");
  const weighted = "https://fonts.googleapis.com/css2?family=Syne:wght@700;800&display=swap";
  const bare = googleFontHref("Syne");
  assert.equal(googleFontHref("Archivo Black"), "https://fonts.googleapis.com/css2?family=Archivo+Black&display=swap");
  assert.equal(googleHrefWidens(weighted, bare), false, "a bare href must never strip the axes a weighted link already has");
  assert.equal(googleHrefWidens(bare, weighted), true, "a weighted href widens a bare link");
  assert.equal(googleHrefWidens(weighted, weighted), false);
});

test("wiring: the editor restores fonts on open and on frame arrival, uploads before Google", () => {
  const editor = read("src/pages/EditorV2.tsx");
  assert.match(editor, /import \{ restoreDesignFonts \} from "\.\.\/lib\/fontRestore";/);
  assert.match(editor, /framesFontSignature/);
  assert.match(editor, /void restoreDesignFonts\(framesRef\.current\);/);
  const restore = read("src/lib/fontRestore.ts");
  assert.match(restore, /accountCustomFonts\(\)/, "uploads resolve against the account list first");
  assert.match(restore, /ensureGoogleHrefInDocument\(href\)/, "exact hrefs are hoisted, preserving axes");
  assert.match(restore, /ensureGoogleHrefInDocument\(googleFontHref\(family\)\)/, "orphan families get a bare-family link");
  assert.match(restore, /import\("\.\/customFonts"\)/, "the api-key chain stays out of the module's static imports");
});
