/**
 * Font Matcher (v54.3) — «¿Qué fuente es?»
 *
 * In-house, deterministic font identification: the user frames a word in an
 * image, the matcher renders every candidate from OUR catalog (Google live +
 * system + the account's custom uploads) with that same text and ranks by
 * perceptual hash. No AI names the typeface — the math proposes, the human
 * confirms. System fonts ARE candidates: a design may genuinely use Arial;
 * what is forbidden is defaulting to it without verifying.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const catalog = read("api/src/services/fontCatalog.ts");
const matcher = read("src/lib/fontMatcher.ts");
const picker = read("src/components/GoogleFontPicker.tsx");

test("the catalog carries scripts (subsets) so a Korean design shortlists Korean families", () => {
  // Dongle case: the matcher must filter by script BEFORE rendering.
  assert.match(catalog, /subsets\?: string\[\]/);
  assert.match(catalog, /subsets: item\.subsets \|\| \[\]/);
  assert.match(catalog, /subsets: \["latin"\]/);
});

test("the matcher ranks in-house: aHash vs rendered specimens, no AI, no external API", () => {
  // Deterministic core — perceptual hash + Hamming distance.
  assert.match(matcher, /export const MAX_CANDIDATES = \d+/);
  assert.match(matcher, /function hamming\(a: Uint8Array, b: Uint8Array\): number/);
  assert.match(matcher, /1 - hamming\(cropBits, bits\) \/ \(HASH_GRID \* HASH_GRID\)/);
  assert.match(matcher, /export async function matchFontFromCrop/);
  // The candidate pool is our own catalog — paginated, script-filtered —
  // plus the account's custom uploads; system fonts stay in the race
  // (confirming Arial is a legitimate answer; guessing it is not).
  assert.match(matcher, /export async function loadMatchCandidates/);
  assert.match(matcher, /source: "custom"/);
  assert.match(matcher, /if \(script !== "any" && Array\.isArray\(font\.subsets\)/);
  assert.match(matcher, /if \(font\.source === "system"\) \{ pool\.push\(font\); continue; \}/);
  assert.match(matcher, /for \(let offset = 0; offset < 2000; offset \+= 500\)/);
  // A blank crop or a family without glyphs for the text never competes.
  assert.match(matcher, /if \(dark < 4\) return null;/);
  assert.doesNotMatch(matcher, /generativelanguage|api\.openai|anthropic/);
});

test("the matcher lives INSIDE the font picker — no new button in the editor top bar", () => {
  // The picker is already hosted by existing top-bar categories and the
  // contextual panel; adding a top-bar button would only cost space.
  assert.match(picker, /¿Qué fuente es\?/);
  assert.match(picker, /function FontMatcherPanel/);
  assert.match(picker, /\{matcherOpen && <FontMatcherPanel customFonts=\{customFonts\} onPick=\{applyMatch\} \/>\}/);
  // A match applies exactly like a manual pick (system: name it; google:
  // load the webfont; custom: register the face).
  assert.match(picker, /const applyMatch = \(m: FontMatchCandidate\)/);
  assert.match(picker, /loadGoogleFontInDocument\(m\.family, m\.variants\?\.length \? m\.variants : \["regular"\]\)/);
  // SVG icon policy — no emoji in the trigger.
  assert.doesNotMatch(picker, /🎯|🔍/);
});
