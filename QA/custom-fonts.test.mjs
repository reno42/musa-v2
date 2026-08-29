// Custom fonts: per-user uploads end to end (picker, API, MCP, capture,
// settings). Source-invariant regex tests in the ppt-native-text style:
// they pin the wiring that regressions actually break, not the formatting.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf-8");

test("nothing is bundled: the catalog comes from the live API only", () => {
  const index = read("api/src/index.ts");
  assert.doesNotMatch(index, /google-fonts\.json/, "the curated fallback JSON is gone");
  assert.match(index, /const \{ fonts: allFonts, live \} = await buildCatalog\(\);/);
  assert.match(index, /fonts: paged, total, limit, offset, note, live/);
  const catalog = read("api/src/services/fontCatalog.ts");
  assert.match(catalog, /Promise<\{ fonts: CatalogFont\[\]; live: boolean \}>/);
  assert.match(catalog, /FAILURE_RETRY_MS/, "a Google outage must not be retried per keystroke");
});

test("every Google variant reaches css2 — italics included", () => {
  const fonts = read("src/lib/googleFonts.ts");
  assert.match(fonts, /export function buildCss2Axis/);
  assert.match(fonts, /:ital,wght@\$\{sorted\.map/);
  assert.match(fonts, /ensureGoogleFontImport\(css: string, family: string, variants: string\[\] = \[\]\)/);
  assert.match(fonts, /injectGoogleFontIntoFrames\(family: string, variants: string\[\] = \[\]\)/);
  // The picker hands its variants to the editor; the editor threads them
  // into BOTH the persisted import and the live frame links.
  const picker = read("src/components/GoogleFontPicker.tsx");
  assert.match(picker, /onChange\(f\.stack \|\| f\.family, \{ variants: f\.variants \}\)/);
  const editor = read("src/pages/EditorV2.tsx");
  assert.match(editor, /ensureGoogleFontImport\(newCss, family, meta\?\.variants\)/);
  assert.match(editor, /injectGoogleFontIntoFrames\(family, meta\?\.variants\)/);
});

test("the picker shows the catalog source and a retry when reduced", () => {
  const picker = read("src/components/GoogleFontPicker.tsx");
  assert.match(picker, /Catálogo reducido/);
  assert.match(picker, /Reintentar/);
  assert.match(picker, /Google Fonts API/);
  assert.doesNotMatch(picker, /Search 94 fonts/, "the hardcoded bundled count is gone");
});

test("custom fonts migration: public-read bucket, owner-only table", () => {
  const migration = read("supabase_migrations_v37.sql");
  assert.match(migration, /'custom-fonts', 'custom-fonts', true, 2097152/);
  assert.match(migration, /create table if not exists custom_fonts/);
  assert.match(migration, /auth\.uid\(\)::text = \(storage\.foldername\(name\)\)\[1\]/);
  assert.match(migration, /for all using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/);
});

test("custom fonts API routes are user-scoped and validate the bytes", () => {
  const routes = read("api/src/routes/customFonts.ts");
  assert.match(routes, /\.eq\("user_id", req\.auth!\.userId\)/);
  assert.match(routes, /OTTO/, "magic-byte sniffing beats a renamed extension");
  assert.match(routes, /wOF2/);
  assert.match(routes, /MAX_FONT_BYTES = 2 \* 1024 \* 1024/);
  assert.match(routes, /access_plan/, "limits come from the account's plan");
  assert.match(routes, /object\/public\/\$\{BUCKET\}/, "stable public URLs, not signed ones");
});

test("the editor persists a custom face into css, document and frames", () => {
  const lib = read("src/lib/customFonts.ts");
  assert.match(lib, /new FontFace\(font\.familyName/);
  assert.match(lib, /export function ensureCustomFontImport/);
  assert.match(lib, /export function injectCustomFontIntoFrames/);
  assert.match(lib, /registerCustomFontFamily/);
  const registry = read("src/lib/fontFamily.ts");
  assert.match(registry, /!isCustomFontFamily\(family\)/, "needsWebfont must never send an upload to Google");
  const editor = read("src/pages/EditorV2.tsx");
  assert.match(editor, /ensureCustomFontImport\(newCss, meta\.custom\)/);
  assert.match(editor, /injectCustomFontIntoFrames\(meta\.custom\)/);
});

test("capture inlines custom-font urls in BOTH raster paths", () => {
  const capture = read("src/lib/frameCapture.ts");
  assert.match(capture, /export async function inlineCustomFontUrls|function inlineCustomFontUrls/);
  assert.match(capture, /custom-fonts/, "the bucket URL pattern is recognized");
  const count = (capture.match(/inlineCustomFontUrls\(withImages\)/g) || []).length;
  assert.equal(count, 2, "rasterizeFrame AND extractFrameTextBlocks must both inline");
});

test("MCP exposes the four user-scoped font tools", () => {
  const mcp = read("netlify/functions/mcp.mjs");
  for (const name of ["font_list_custom", "font_upload_custom", "font_delete_custom", "font_usage_custom"]) {
    assert.match(mcp, new RegExp(`name: "${name}"`), `tool def missing: ${name}`);
    assert.match(mcp, new RegExp(`case "${name}"`), `dispatch missing: ${name}`);
  }
  assert.match(mcp, /\.eq\("user_id", userId\)/, "every query is scoped to the authenticated user");
});

test("settings shows usage against the plan limits", () => {
  const card = read("src/components/FontsUsageCard.tsx");
  assert.match(card, /api\/fonts\/custom\/usage/);
  assert.match(card, /bento-card/);
  const dashboard = read("src/components/Dashboard.tsx");
  assert.match(dashboard, /<FontsUsageCard \/>/);
});
