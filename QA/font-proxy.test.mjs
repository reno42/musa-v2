// Google Fonts same-origin proxy — the RENDER path must never depend on the
// browser completing a direct connection to fonts.googleapis.com: corporate
// filters, HTTPS-scanning antivirus and privacy extensions close that
// connection in the wild (net::ERR_CONNECTION_CLOSED), and a stylesheet that
// never arrives silently collapses the design to serif. Pins the proxy route,
// its public exposure, and the render-time rewrite in every consumer.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(resolve(root, p), "utf-8");

test("proxiedFontCssUrl rewrites css2 to same-origin and leaves everything else", async () => {
  const { proxiedFontCssUrl } = await import("../src/lib/googleFonts.ts");
  const canonical = "https://fonts.googleapis.com/css2?family=Nunito+Sans&display=swap";
  assert.equal(proxiedFontCssUrl(canonical), "/api/fonts/css2?family=Nunito+Sans&display=swap");
  // The deck-axis signature is stripped AND proxied in one hop.
  const broken = "https://fonts.googleapis.com/css2?family=Space+Grotesk:ital,wght@0,300..800;1,300..800&display=swap";
  assert.equal(proxiedFontCssUrl(broken), "/api/fonts/css2?family=Space+Grotesk&display=swap");
  // Non-Google @imports (icon CDNs) pass through untouched.
  const icons = "https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.1/src/regular/style.css";
  assert.equal(proxiedFontCssUrl(icons), icons);
  // Custom-font bucket files are never proxied.
  const bucket = "https://example.supabase.co/storage/v1/object/public/custom-fonts/u/f.woff2";
  assert.equal(proxiedFontCssUrl(bucket), bucket);
});

test("the proxy route is strict: allowlisted params, versioned gstatic files, cacheable", () => {
  const route = read("api/src/routes/googleFontsProxy.ts");
  assert.match(route, /ALLOWED_CSS2_PARAMS = new Set\(\["family", "display", "text", "subset"\]\)/);
  assert.match(route, /GSTATIC_FILE = \/\^s/);
  assert.match(route, /woff2\|woff\|ttf\|otf/);
  assert.match(route, /"https:\/\/fonts\.gstatic\.com",/);
  assert.match(route, /x-forwarded-proto/);
  assert.match(route, /"user-agent": BROWSER_UA/);
  assert.match(route, /max-age=31536000, immutable/);
  assert.match(route, /Cache-Control", "no-store/);
});

test("css2 and gstatic are public — <link> tags cannot carry auth headers", () => {
  const auth = read("api/src/middleware/auth.ts");
  assert.match(auth, /"\/api\/fonts\/css2"/);
  assert.match(auth, /startsWith\("\/api\/fonts\/gstatic\/"\)/);
  const index = read("api/src/index.ts");
  assert.match(index, /app\.use\("\/api\/fonts", googleFontProxyRoutes\)/);
});

test("the loaders render through the proxy while persistence stays canonical", () => {
  const fonts = read("src/lib/googleFonts.ts");
  assert.match(fonts, /export function proxiedFontCssUrl/);
  assert.match(fonts, /proxiedFontCssUrl\(googleFontHref\(family, variants\)\)/);
  // ensureGoogleFontImport — what gets PERSISTED — keeps the canonical host.
  assert.match(fonts, /wanted = `@import url\('\$\{href\}'\);`/);
  const gen = read("netlify/functions/deck-generator.mjs");
  assert.doesNotMatch(gen, /api\/fonts/);
});
