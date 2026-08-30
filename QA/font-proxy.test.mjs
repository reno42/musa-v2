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
  assert.equal(proxiedFontCssUrl(canonical), "/api/fonts/css2?family=Nunito+Sans&display=swap&fv=2");
  // The deck-axis signature is stripped AND proxied in one hop.
  const broken = "https://fonts.googleapis.com/css2?family=Space+Grotesk:ital,wght@0,300..800;1,300..800&display=swap";
  assert.equal(proxiedFontCssUrl(broken), "/api/fonts/css2?family=Space+Grotesk&display=swap&fv=2");
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
  // Glyph files travel uncompressed and carry an explicit MIME: a compressed
  // hop between Google and the runtime is how a woff2 arrives as non-font
  // bytes ("OTS parsing error"), and immutable SHARED caching froze the
  // poison — so gstatic responses are browser-private now.
  assert.match(route, /"accept-encoding": "identity"/);
  assert.match(route, /gstatic\/v1/);
  assert.match(route, /private, max-age=31536000, immutable/);
  assert.match(route, /X-Content-Type-Options/);
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

test("the wire form to the proxy percent-encodes css2 axis specials", async () => {
  const { proxiedFontCssUrl } = await import("../src/lib/googleFonts.ts");
  // Netlify's gateway splits query params on ';' too — a raw semicolon never
  // survives the trip (family=Roboto:wght@400;700 arrived as a family plus a
  // bogus "700" key and 400ed at validation, before any upstream fetch).
  const tuple = "https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap";
  assert.equal(proxiedFontCssUrl(tuple), "/api/fonts/css2?family=Roboto%3Awght%40400%3B700&display=swap&fv=2");
  // Bare families keep the wire form they always had.
  const bare = "https://fonts.googleapis.com/css2?family=Nunito+Sans&display=swap";
  assert.equal(proxiedFontCssUrl(bare), "/api/fonts/css2?family=Nunito+Sans&display=swap&fv=2");
});

test("the Netlify adapter rebuilds the query from rawUrl, splitting ONLY on '&'", () => {
  const adapter = read("netlify/functions/api.mjs");
  assert.match(adapter, /event\.rawUrl/);
  assert.match(adapter, /rawQuery\.split\("&"\)/);
  assert.match(adapter, /decodeParam/);
  // Fallback: an undecoded multiValue '+' must not be re-encoded as %2B.
  assert.match(adapter, /replace\(\/\\\+\/g, " "\)/);
});

test("families referenced in font-family declarations load even without an import", async () => {
  const { extractReferencedFontFamilies } = await import("../src/lib/googleFonts.ts");
  // Production shape (tpl_11cbed9a): a later pick swapped the import to
  // Nunito while the text kept `"Nunito Sans"` — the lone import rendered,
  // everything else fell back to the generic font in total silence.
  const css = [
    "@import url('https://fonts.googleapis.com/css2?family=Nunito&display=swap');",
    "h1 { font-family: \"Nunito Sans\" !important; }",
    "p { font-family: 'Matcha Mint', sans-serif; }",
    "body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; }",
    "span { font-family: Nunito; }",
  ].join("\n");
  assert.deepEqual(extractReferencedFontFamilies(css), ["Nunito Sans", "Matcha Mint", "Nunito"]);
  // Self-hosted families (a persisted @font-face) render from their own src —
  // asking Google for a user upload 400s and spams the load-failure toast.
  const selfHosted = "@font-face { font-family: 'Matcha Mint'; src: url(https://example.supabase.co/storage/v1/object/public/custom-fonts/u/f.woff2); } p { font-family: 'Matcha Mint', sans-serif; }";
  assert.deepEqual(extractReferencedFontFamilies(selfHosted), []);
  // System stacks and generics never go to a webfont host.
  assert.deepEqual(extractReferencedFontFamilies("a { font-family: Helvetica, Arial, sans-serif; }"), []);
  // The renderers inject the union (imports + referenced), not imports alone.
  const fonts = read("src/lib/googleFonts.ts");
  assert.match(fonts, /export function fontLinksForCss/);
  const frame = read("src/components/DesignFrame.tsx");
  assert.match(frame, /fontLinksForCss\(frame\.css\)/);
  assert.doesNotMatch(frame, /extractFontCssLinks/);
  const canvas = read("src/components/HtmlCanvas.tsx");
  assert.match(canvas, /fontLinksForCss\(css\)/);
  assert.doesNotMatch(canvas, /extractFontCssLinks/);
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
  assert.match(shell, /href="\/api\/fonts\/css2\?family=Instrument\+Serif%3Aital%400%3B1&display=swap&fv=2"/);
  assert.doesNotMatch(shell, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  // HtmlCanvas srcdoc: proxied <link>s in the head (imports PLUS every
  // family the rules reference), inert @imports stripped, CSP without Google
  // hosts.
  const canvas = read("src/components/HtmlCanvas.tsx");
  assert.match(canvas, /fontLinksForCss\(css\)/);
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
