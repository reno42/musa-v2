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

test("css2 wire form keeps axis punctuation raw and a 400 heals with a bare-family retry", () => {
  const route = read("api/src/routes/googleFontsProxy.ts");
  // URLSearchParams percent-encodes :@; and the serverless runtime re-encodes
  // the outgoing %3B, so Google reads a literal "%3B" inside the family name
  // and 400s every multi-value tuple (…@0;1, …@400;700) in production while
  // single-value tuples pass. The wire form must keep the specials raw.
  assert.match(route, /function encodeCss2Value/);
  assert.match(route, /replace\(\/%3B\/g, ";"\)/);
  assert.match(route, /replace\(\/%3A\/g, ":"\)/);
  assert.match(route, /function buildCss2Query/);
  // On a 400 the proxy retries once with `family=Name` (axes stripped) — the
  // one form css2 always serves — instead of collapsing the design to the
  // fallback font. The healed sheet is cached under the ORIGINAL query.
  assert.match(route, /upstream\.status === 400/);
  assert.match(route, /value\.split\(":"\)\[0\]/);
  // Multi-family css2 sheets need every family= repetition — the collapsed
  // single-value form silently dropped fonts in production.
  const adapter = read("netlify/functions/api.mjs");
  assert.match(adapter, /multiValueQueryStringParameters/);
  assert.match(adapter, /searchParams\.append/);
});

test("the load diagnostic logs the persisted import URLs verbatim", () => {
  // Family names alone hid this bug for a whole day — a poisoned
  // `:ital@0;1` import reads as a clean "Instrument Serif" in the log.
  const editor = read("src/pages/EditorV2.tsx");
  assert.match(editor, /imports persistidos/);
  assert.match(editor, /@import\\s\+url/);
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
  assert.match(fonts, /export function extractFontCssLinks/);
  assert.match(fonts, /proxiedFontCssUrl\(googleFontHref\(family, variants\)\)/);
  // ensureGoogleFontImport — what gets PERSISTED — keeps the canonical host.
  assert.match(fonts, /wanted = `@import url\('\$\{href\}'\);`/);
  const gen = read("netlify/functions/deck-generator.mjs");
  assert.doesNotMatch(gen, /api\/fonts/);
});

test("zero direct-to-Google fetches remain: shell, previews and failure reporting", () => {
  // The app shell's brand font rides the proxy too — the old direct
  // fonts.googleapis.com <link> in index.html died on restrictive networks
  // in silence (and showed up direct in the resource timing capture).
  const shell = read("index.html");
  assert.match(shell, /href="\/api\/fonts\/css2\?family=Instrument\+Serif:ital@0;1&display=swap"/);
  assert.doesNotMatch(shell, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  // HtmlCanvas srcdoc: proxied <link>s in the head, inert @imports stripped,
  // CSP without Google hosts.
  const canvas = read("src/components/HtmlCanvas.tsx");
  assert.match(canvas, /extractFontCssLinks\(css\)/);
  assert.match(canvas, /cssWithoutImports = css\.replace\(\/@import/);
  assert.doesNotMatch(canvas, /fonts\.googleapis\.com/);
  // Every font <link> is watched — a dead stylesheet speaks up (console +
  // editor toast) instead of silently collapsing to the fallback font.
  const fonts = read("src/lib/googleFonts.ts");
  assert.match(fonts, /export function watchFontLink/);
  assert.match(fonts, /link\.onerror = /);
  assert.match(fonts, /export function onFontLoadFailure/);
  const frame = read("src/components/DesignFrame.tsx");
  assert.match(frame, /watchFontLink\(link\)/);
  const editor = read("src/pages/EditorV2.tsx");
  assert.match(editor, /onFontLoadFailure\(/);
  assert.match(editor, /addToast\(`No se pudo cargar la fuente/);
});

test("the localStorage draft never shadows newer server data", () => {
  const api = read("src/lib/templateApi.ts");
  assert.match(api, /localIsNewer = localMs >= apiMs/);
  assert.doesNotMatch(api, /Math\.abs\(localMs - apiMs\)/);
  assert.doesNotMatch(api, /GRACE_MS/);
});
