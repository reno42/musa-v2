// The deck generator's hardcoded css2 axis 400s for families without those
// axes (Space Grotesk: no italic, wght 300-700) — fonts collapse to serif on
// every reload. Pins the URL sanitizer, its wiring into every css2 consumer,
// the generator fix, and the swap declaration on custom @font-face.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf-8");

test("sanitizeGoogleFontUrl strips the deck axis signature", async () => {
  const { sanitizeGoogleFontUrl } = await import("../src/lib/googleFonts.ts");
  const broken = "https://fonts.googleapis.com/css2?family=Space+Grotesk:ital,wght@0,300..800;1,300..800&display=swap";
  assert.equal(sanitizeGoogleFontUrl(broken), "https://fonts.googleapis.com/css2?family=Space+Grotesk&display=swap");
  const multi = "https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300..800;1,300..800&family=Space+Grotesk:ital,wght@0,300..800;1,300..800&display=swap";
  assert.equal(sanitizeGoogleFontUrl(multi), "https://fonts.googleapis.com/css2?family=Fraunces&family=Space+Grotesk&display=swap");
  // A valid picker-built URL passes through untouched.
  const fine = "https://fonts.googleapis.com/css2?family=Inter:wght@300;700&display=swap";
  assert.equal(sanitizeGoogleFontUrl(fine), fine);
});

test("every css2 consumer routes rendering through the same-origin proxy", () => {
  const frame = read("src/components/DesignFrame.tsx");
  // Extraction now lives in lib/googleFonts (extractFontCssLinks), shared
  // with HtmlCanvas — DesignFrame only calls it.
  assert.match(frame, /extractFontCssLinks\(frame\.css\)/);
  assert.doesNotMatch(frame, /fonts\.googleapis\.com/);
  const capture = read("src/lib/frameCapture.ts");
  assert.match(capture, /\.map\(m => proxiedFontCssUrl\(m\[1\]\)\)/);
  const agent = read("src/lib/agentBridge.ts");
  assert.match(agent, /\.map\(m => proxiedFontCssUrl\(m\[1\]\)\)/);
  const editor = read("src/pages/EditorV2.tsx");
  // SVG export is a portable artifact — it keeps the canonical Google URL.
  assert.match(editor, /escXml\(sanitizeGoogleFontUrl\(fm\[1\]\)\)/);
  assert.doesNotMatch(editor, /proxiedFontCssUrl/);
});

test("new decks never write the broken axis again", () => {
  const gen = read("netlify/functions/deck-generator.mjs");
  assert.doesNotMatch(gen, /300\.\.800/);
  assert.match(gen, /family=\$\{name\.trim\(\)\.replace\(\/\\s\+\/g, "\+"\)\}/);
});

test("custom @font-face swaps in instead of flashing serif", () => {
  const fonts = read("src/lib/customFonts.ts");
  assert.match(fonts, /font-display:swap/);
  assert.match(fonts, /\{ display: "swap" \}/);
});
