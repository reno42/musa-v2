import assert from "node:assert/strict";
import test from "node:test";
import {
  cssFontFamily,
  isFontStack,
  isGenericFamily,
  needsWebfont,
  primaryFamily,
  repairMalformedFontDeclarations,
  registerCustomFontFamily,
} from "../src/lib/fontFamily.ts";
import { buildCss2Axis, ensureGoogleFontImport, googleFontHref } from "../src/lib/googleFonts.ts";

// Every system font in the catalogue carries its substitutes, because a design
// made on a Mac still has to render on a PC.
const HELVETICA = "Helvetica, Arial, sans-serif";
const GEORGIA = 'Georgia, "Times New Roman", serif';

test("a fallback stack survives as a stack, not as one absurd family name", () => {
  // Quoting the whole thing named a single family with commas in it. Nothing
  // has that installed, so the browser fell back to its own default serif —
  // and since every system font carries a stack, every one of them produced
  // that same serif, which is why changing fonts appeared to do nothing.
  const out = cssFontFamily(HELVETICA);
  assert.equal(out, "Helvetica, Arial, sans-serif");
  assert.doesNotMatch(out, /^['"]/, "the stack must not be wrapped in quotes");
  assert.equal(out.split(",").length, 3, "all three families must survive");
});

test("generic keywords stay unquoted so they still resolve", () => {
  assert.equal(cssFontFamily(HELVETICA).endsWith("sans-serif"), true);
  assert.doesNotMatch(cssFontFamily(HELVETICA), /"sans-serif"/);
  assert.equal(cssFontFamily("serif"), "serif");
  assert.equal(cssFontFamily("inherit"), "inherit");
});

test("a family with a space is quoted, one without is left bare", () => {
  assert.equal(cssFontFamily("Playfair Display"), '"Playfair Display"');
  assert.equal(cssFontFamily("Roboto"), "Roboto");
});

test("existing quotes inside a stack are normalised, not doubled", () => {
  assert.equal(cssFontFamily(GEORGIA), 'Georgia, "Times New Roman", serif');
  assert.equal(cssFontFamily("'Helvetica Neue', Helvetica, Arial, sans-serif"),
    '"Helvetica Neue", Helvetica, Arial, sans-serif');
});

test("a comma inside a quoted family name is not mistaken for a separator", () => {
  assert.equal(primaryFamily('"Foo, Bar", Arial'), "Foo, Bar");
  assert.equal(isFontStack('"Foo, Bar"'), false);
});

test("every catalogue font produces a value that differs from the others", () => {
  // The bug's signature: distinct fonts collapsing to the same rendered face.
  const stacks = [HELVETICA, GEORGIA, "Arial, Helvetica, sans-serif", "Roboto", "Playfair Display"];
  const rendered = new Set(stacks.map(cssFontFamily));
  assert.equal(rendered.size, stacks.length, "no two fonts may resolve alike");
});

test("the picker's label shows the family, not its substitutes", () => {
  assert.equal(primaryFamily(HELVETICA), "Helvetica");
  assert.equal(primaryFamily(GEORGIA), "Georgia");
  assert.equal(primaryFamily("Roboto"), "Roboto");
  assert.equal(primaryFamily(""), "");
});

test("a generic keyword is never taken for the chosen family", () => {
  assert.equal(primaryFamily("sans-serif, Arial"), "Arial");
  assert.equal(isGenericFamily("sans-serif"), true);
  assert.equal(isGenericFamily("Helvetica"), false);
});

test("an installed font is never requested from a webfont host", () => {
  // That request 404s, and the silent fallback reads as the picker ignoring
  // the click.
  assert.equal(needsWebfont(HELVETICA), false);
  assert.equal(needsWebfont(GEORGIA), false);
  assert.equal(needsWebfont("sans-serif"), false);
  assert.equal(needsWebfont("Roboto"), true);
  assert.equal(needsWebfont("Playfair Display"), true);
});

test("a stack can never be encoded into a webfont URL", () => {
  assert.equal(googleFontHref(HELVETICA), "");
  assert.equal(googleFontHref("sans-serif"), "");
  assert.match(googleFontHref("Playfair Display"), /family=Playfair\+Display/);
  assert.doesNotMatch(googleFontHref("Playfair Display"), /%2C/, "no commas may reach the query");
});

test("a stack adds no @import, and a real webfont adds exactly one", () => {
  const base = "body { color: red; }";
  assert.equal(ensureGoogleFontImport(base, HELVETICA), base, "installed fonts need no import");

  const once = ensureGoogleFontImport(base, "Roboto");
  assert.match(once, /@import url\('https:\/\/fonts\.googleapis\.com/);
  assert.equal(ensureGoogleFontImport(once, "Roboto"), once, "the same font must not stack up imports");
});

test("blank and whitespace values do not produce a stray comma", () => {
  assert.equal(cssFontFamily(""), "");
  assert.equal(cssFontFamily("   "), "");
  assert.equal(cssFontFamily("Arial, , sans-serif"), "Arial, sans-serif");
});

test("every variant flavor lands in the css2 axis — italics included", () => {
  // The old loader dropped every variant that was not a bare "NNN", so a
  // picked bold italic rendered as its regular face. Full tuples now.
  assert.equal(buildCss2Axis([]), "");
  assert.equal(buildCss2Axis(["regular"]), "");
  assert.equal(buildCss2Axis(["regular", "700"]), ":wght@400;700");
  assert.equal(buildCss2Axis(["italic"]), ":ital,wght@1,400");
  assert.equal(buildCss2Axis(["300italic", "regular", "700"]), ":ital,wght@0,400;0,700;1,300");
  assert.equal(buildCss2Axis(["nonsense"]), "", "an unrecognized variant degrades to the default, not a bogus request");
  assert.match(googleFontHref("Playfair Display", ["italic"]), /ital,wght@1,400/);
});

test("a narrow import is upgraded in place, never stacked", () => {
  const base = "body { color: red; }";
  const narrow = ensureGoogleFontImport(base, "Roboto");
  const wide = ensureGoogleFontImport(narrow, "Roboto", ["700", "italic"]);
  assert.match(wide, /ital,wght@/, "the fuller axis replaces the old import");
  assert.equal((wide.match(/@import/g) || []).length, 1, "one import per family");
  assert.equal(ensureGoogleFontImport(wide, "Roboto", ["700", "italic"]), wide, "same arguments are an exact no-op");
});

test("REQ-048 F1: a weighted import is never downgraded — the variants-less heal is byte-identical", () => {
  // The editor's heal pass (DesignFrame) calls ensureGoogleFontImport with NO
  // variants on every css arrival — that call used to REPLACE the weighted
  // import with a bare one, silently serving only the 400 face.
  const base = "body { color: red; }";
  const weighted = ensureGoogleFontImport(base, "Syne", ["700", "800"]);
  assert.match(weighted, /family=Syne:wght@700;800/);
  assert.equal(ensureGoogleFontImport(weighted, "Syne"), weighted, "the heal pass (no variants) must not touch a weighted import");
  assert.equal(ensureGoogleFontImport(weighted, "Syne", ["700"]), weighted, "a narrower axis request cannot shrink the import either");
  // A strictly wider request still upgrades in place (the picker's path).
  const wider = ensureGoogleFontImport(weighted, "Syne", ["400", "700", "800", "italic"]);
  assert.match(wider, /ital,wght@/);
  assert.equal((wider.match(/@import/g) || []).length, 1, "still one import per family");
  // The dogfood file carried TWO weighted families — healing one must leave
  // the other untouched.
  const twoFamilies = ensureGoogleFontImport(ensureGoogleFontImport(base, "Syne", ["700", "800"]), "Inter", ["400", "500", "600"]);
  assert.equal(ensureGoogleFontImport(twoFamilies, "Syne"), twoFamilies, "healing Syne leaves Inter's axis alone");
  assert.equal(ensureGoogleFontImport(twoFamilies, "Inter"), twoFamilies, "healing Inter leaves Syne's axis alone");
});

test("a custom upload never goes near a webfont host", () => {
  registerCustomFontFamily("MiFuente");
  assert.equal(needsWebfont("MiFuente"), false);
  assert.equal(googleFontHref("MiFuente"), "", "no request is even built");
});

test("legacy font declarations regain their missing separator without rewriting the family", () => {
  assert.equal(
    repairMalformedFontDeclarations(".title{font-family:'Helvetica Neue',Helvetica,Arial,sans-serifcolor:#111110;}"),
    ".title{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#111110;}",
  );
  assert.equal(
    repairMalformedFontDeclarations(".title{font-family:'My Brand Font';color:#111110;}"),
    ".title{font-family:'My Brand Font';color:#111110;}",
    "valid declarations remain byte-identical",
  );
});
