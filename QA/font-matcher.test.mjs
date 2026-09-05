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
const mcp = read("netlify/functions/mcp.mjs");
const skill = read("SKILL.md");
const catalogJson = JSON.parse(read("tools_catalog.json"));

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

test("mcp: match_font is a registered def, synced with tools_catalog.json and SKILL.md", () => {
  assert.match(mcp, /name: "match_font"/);
  const def = catalogJson.find(t => t.name === "match_font");
  assert.ok(def, "tools_catalog.json must list match_font");
  assert.deepEqual(
    Object.keys(def.inputSchema.properties),
    ["textRead", "script", "style", "weight", "width", "traits", "pick", "vision", "callerVision", "imageUrl", "imageBase64", "assetId", "sampleText", "hint", "visionModel", "geminiModel", "geminiApiKey", "templateId", "brandId"],
  );
  // Documented in the alphabetical tool list (color sibling included) and
  // the Fonts category row.
  assert.match(skill, /- `match_font` —/);
  assert.match(skill, /- `match_color` —/);
  assert.match(skill, /`list_fonts`, `search_google_fonts`, `match_font`, `add_font_to_template`/);
});

test("mcp: match_font ranks in-house — traits read, shortlist from OUR catalog, constrained pick", () => {
  // Tier 2 server vision is provider-agnostic (openai → anthropic → google);
  // a BYOK google key forces google. The key chain lives in
  // resolveVisionProvider: account BYOK first, then deployment env.
  assert.match(mcp, /resolveVisionProvider\(auth, params\.geminiApiKey \? "google" : params\.vision\)/);
  assert.match(mcp, /const visionModel = params\.geminiModel \|\| params\.visionModel;/);
  assert.match(mcp, /const envKey = process\.env\[VISION_ENV_KEYS\[provider\]\]/);
  // The model never free-names: step 1 forbids naming, step 2 answers only
  // with shortlist families and the server drops anything outside it.
  assert.match(mcp, /TYPEFACE OBSERVER, not a namer/);
  assert.match(mcp, /the ONLY allowed answers/);
  assert.match(mcp, /\.filter\(m => m && sl\.shortlistMeta\[m\.family\]\)/);
  // Shortlist: catalog loopback (paginated), script filter via the live
  // subsets field (the Dongle case), custom uploads FIRST, capped.
  assert.match(mcp, /callWorkspaceApi\(auth, `\/api\/fonts\/catalog\?limit=500&offset=\$\{offset\}`\)/);
  assert.match(mcp, /subsetByScript\[traits\.script\]/);
  assert.match(mcp, /customFamilies\.forEach\(f => pushCandidate\(f, "custom"\)\)/);
  assert.match(mcp, /const MAX_SHORTLIST = \d+;/);
  // Image bytes: original asset bytes leave the bucket untouched — the tool
  // never recompresses (pixelated letterforms kill the identification).
  assert.match(mcp, /from\("design-assets"\)\.download/);
});

test("mcp: match_font follows the vision protocol — observations first, guided errors, never a silent guess", () => {
  // Tier 1 gate: observations in the args mean the CALLER already saw the
  // image — the server does deterministic shortlisting with zero API calls.
  assert.match(mcp, /const hasObservations = !!\(params\.textRead \|\| params\.script \|\| params\.style \|\| params\.weight/);
  assert.match(mcp, /awaitingPick: true/);
  // Round 2 validates the pick against the catalog: hallucinated families
  // get notInCatalog + a sample to re-choose from, never acceptance.
  assert.match(mcp, /const meta = sl\.shortlistMeta\[params\.pick\];/);
  assert.match(mcp, /notInCatalog: true/);
  assert.match(mcp, /status: "not_in_catalog"/);
  // Tier 3: nothing observable and no server vision → a guided error with
  // unblock paths (describe / vision:"auto" / editor panel), never a guess.
  assert.match(mcp, /if \(!imageBuf \|\| params\.vision === "caller"\)/);
  assert.match(mcp, /NO_OBSERVATIONS: match_font works with ZERO AI API/);
  assert.match(mcp, /NO_VISION_KEY: server-side vision needs a key/);
  // Responses always carry the vision block so callers can relay advisories.
  assert.match(mcp, /status: "ok_caller"/);
  assert.match(mcp, /status: "ok_server"/);
  // SKILL.md documents the protocol and every unblock path.
  assert.match(skill, /Vision Capability Protocol/);
  assert.match(skill, /declare `callerVision`/);
});

test("mcp: match_font persists matches into the brand graph — template metadata + brand tokens", () => {
  // Templates are the design-graph nodes: metadata.fontMatches makes the
  // identification visible to every future replication of that design.
  assert.match(mcp, /meta\.fontMatches = \[\{/);
  assert.match(mcp, /templates\.updateTemplate\(params\.templateId, \{ metadata: meta \}\)/);
  // The brand accumulates families as fontCandidates — curated families in
  // tokensJson are read, extended, never replaced; dedup by family.
  assert.match(mcp, /tokens\.typography\.fontCandidates = \[/);
  assert.match(mcp, /!candidates\.some\(c => c && c\.family === best\.family\)/);
  assert.match(mcp, /brands\.updateBrand\(brandId, \{ tokensJson: JSON\.stringify\(tokens\) \}\)/);
  // brandId falls back to the template's linked brand (the graph edge).
  assert.match(mcp, /if \(!brandId && targetTemplate\.brandId\) brandId = targetTemplate\.brandId;/);
  // Best-effort: identification never fails because persistence did.
  assert.match(mcp, /const persisted = \{ template: false, brand: false \};/);
  assert.match(mcp, /persisted,$/m);
});

test("import_design carries a typography TELL naming system stacks back for verification", () => {
  // Fase 0: the caller sees what it wrote. System stacks get a verify note
  // pointing at match_font — NOT an anti-Arial ban: verified Arial is fine.
  assert.match(mcp, /const MCP_SYSTEM_FONT_STACKS = new Set/);
  assert.match(mcp, /const typographyTell = \{/);
  assert.match(mcp, /verify the real families with match_font before finishing/);
  // Both return paths (update + create) carry the audit.
  assert.match(mcp, /typography: typographyTell,/);
});

test("SKILL.md states the two replication rules: verify typography, place original images", () => {
  assert.match(skill, /Rules That Make or Break a Replication/);
  assert.match(skill, /never guess a font name from pixels/);
  assert.match(skill, /place the ORIGINAL, never a recompressed copy/);
  assert.match(skill, /If replicating an image: fonts verified via `match_font`/);
});
