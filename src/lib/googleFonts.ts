// Explicit extension so this stays runnable under `node --test`, which does
// not resolve extensionless relative imports the way the bundler does.
import { needsWebfont, primaryFamily } from "./fontFamily.ts";

/**
 * A whole fallback stack used to reach here, and its commas were encoded into
 * the query as though "Helvetica, Arial, sans-serif" were one family. The
 * request 404s and the browser falls back in silence, so nothing is logged and
 * the picker just looks broken.
 *
 * Carrying a stack at all means the font is already installed, so there is
 * nothing to fetch — taking just its first family would still request a font
 * the machine already has.
 */
function requestableFamily(family: string): string {
  return needsWebfont(family) ? primaryFamily(family) : "";
}

function encodeFamily(family: string): string {
  return encodeURIComponent(family.trim()).replace(/%20/g, "+");
}

/** One resolved css2 axis tuple: the ital flag plus a weight. */
interface AxisTuple { ital: 0 | 1; weight: number }

/**
 * The Webfonts API names variants "regular", "italic", "700", "300italic".
 * The old loader kept only the bare three-digit weights, so italics — and
 * bold italics — never loaded, and a faux-bold stood in for the real face.
 * Every variant maps to an ital+wght tuple, and css2 wants them sorted:
 * uprights first, then by weight.
 */
export function buildCss2Axis(variants: string[]): string {
  const tuples = new Map<string, AxisTuple>();
  for (const variant of variants) {
    const v = (variant || "").trim().toLowerCase();
    if (!v) continue;
    const italic = v.endsWith("italic");
    const weightPart = italic ? v.slice(0, -"italic".length) : v;
    const weight = /^\d{3}$/.test(weightPart) ? parseInt(weightPart, 10) : 400;
    if (weight < 1 || weight > 1000) continue;
    tuples.set(`${italic ? 1 : 0}-${weight}`, { ital: italic ? 1 : 0, weight });
  }
  if (tuples.size === 0) return "";
  const sorted = [...tuples.values()].sort((a, b) => a.ital - b.ital || a.weight - b.weight);
  // A lone upright regular is css2's default — requesting it is noise.
  if (sorted.length === 1 && sorted[0].ital === 0 && sorted[0].weight === 400) return "";
  if (sorted.every(t => t.ital === 0)) {
    return `:wght@${sorted.map(t => t.weight).join(";")}`;
  }
  return `:ital,wght@${sorted.map(t => `${t.ital},${t.weight}`).join(";")}`;
}

/** Empty when the value names nothing a webfont host could serve. */
export function googleFontHref(family: string, variants: string[] = []): string {
  const requestable = requestableFamily(family);
  if (!requestable) return "";
  const axis = buildCss2Axis(variants);
  return `https://fonts.googleapis.com/css2?family=${encodeFamily(requestable)}${axis}&display=swap`;
}

/**
 * Prepends the family's css2 import, or UPGRADES the import already there.
 *
 * A design picks a font once with the picker's full variant list, but older
 * paths (a template's own css, a previous session) may carry a bare-weight
 * import for the same family. Swapping that line for the fuller import keeps
 * one import per family with the widest axis set so far; calling twice with
 * the same arguments is an exact no-op.
 */
export function ensureGoogleFontImport(css: string, family: string, variants: string[] = []): string {
  const requestable = requestableFamily(family);
  if (!requestable) return css;
  const href = googleFontHref(requestable, variants);
  if (!href) return css;
  const wanted = `@import url('${href}');`;
  const prefix = `@import url('https://fonts.googleapis.com/css2?family=${encodeFamily(requestable)}`;
  const lines = css.split("\n");
  let sawImport = false;
  const merged = lines.map(line => {
    if (!line.startsWith(prefix)) return line;
    sawImport = true;
    return line === wanted ? line : wanted;
  });
  return sawImport ? merged.join("\n")
    // Not on its own line — the old includes() guard still applies, so an
    // import embedded mid-line can never stack a second one.
    : css.includes(`family=${encodeFamily(requestable)}`) ? css
    : `${wanted}\n${css}`;
}

/**
 * The deck generator (netlify/functions/deck-generator.mjs) used to hardcode
 * a wide ital+wght axis onto every family. css2 answers HTTP 400 for families
 * that lack those axes — Space Grotesk has no italic and stops at 700 — so
 * the stylesheet never arrives and any fresh page load collapses the design
 * to its serif fallback. Stripping the axis leaves `family=<Name>` — the one
 * form css2 always serves, with the family's own default/range.
 */
export function sanitizeGoogleFontUrl(url: string): string {
  return url.split(":ital,wght@0,300..800;1,300..800").join("");
}

/**
 * Render-time rewrite: css2 through our own origin.
 *
 * The persisted css and the exports keep the canonical fonts.googleapis.com
 * URLs, but every RENDER fetch (shadow-DOM links, the picker's document
 * loader, the raster inliner) goes through /api/fonts/css2 — same-origin —
 * because some browsers never complete the direct request: filters,
 * HTTPS-scanning antivirus and privacy extensions close the connection
 * before Google answers (net::ERR_CONNECTION_CLOSED in the wild), and when
 * the stylesheet never arrives the design silently collapses to its serif
 * fallback. The API re-serves css2 and its gstatic font files with the same
 * bytes, so rendering no longer depends on the browser reaching Google.
 */
export function proxiedFontCssUrl(url: string): string {
  const canonical = sanitizeGoogleFontUrl(url);
  const prefix = "https://fonts.googleapis.com/css2?";
  if (canonical.startsWith(prefix)) {
    // css2 axis tuples carry raw ';', ':', '@', ',' — the Netlify gateway
    // splits query params on ';' too, so a raw semicolon never reaches the
    // API intact. Percent-encode the specials; both sides decode identically
    // ('%' and '+' are left alone: they are already wire-legal here).
    const query = canonical.slice(prefix.length)
      .replace(/;/g, "%3B")
      .replace(/:/g, "%3A")
      .replace(/@/g, "%40")
      .replace(/,/g, "%2C");
    return "/api/fonts/css2?" + query;
  }
  return canonical;
}

/** link.href is always the browser-normalized absolute form, while the
 *  proxy rewrite produces a relative path — normalize before comparing or
 *  assigning so live-update dedup stays stable across re-renders. */
function absoluteFontUrl(href: string): string {
  return new URL(href, document.baseURI).href;
}

/**
 * Every @import url(...) in css — Google Fonts, Phosphor icons, any CDN — as
 * absolute, same-origin-proxied hrefs ready for <link rel="stylesheet">.
 * DesignFrame and the HtmlCanvas srcdoc share this, so a css2 URL can never
 * reach the network un-proxied through a second implementation.
 */
export function extractFontCssLinks(css: string): string[] {
  const re = /@import\s+url\(['"]?(https?:\/\/[^'"]+)['"]?\)/g;
  const hrefs: string[] = [];
  let m;
  while ((m = re.exec(css)) !== null) hrefs.push(new URL(proxiedFontCssUrl(m[1]), document.baseURI).href);
  return hrefs;
}

/** A font stylesheet that never arrived used to fail in total silence — the
 *  design just collapsed to its serif fallback with zero console output.
 *  Every font <link> is watched and reports through here: console.warn
 *  always, plus the editor toast while onFontLoadFailure is wired. */
export interface FontLoadFailure { family: string; href: string }

let fontFailureListener: ((failure: FontLoadFailure) => void) | null = null;

export function onFontLoadFailure(listener: ((failure: FontLoadFailure) => void) | null): void {
  fontFailureListener = listener;
}

/** Attach to every font <link> so a dead stylesheet speaks up. */
export function watchFontLink(link: HTMLLinkElement): void {
  link.onerror = () => {
    const family = decodeURIComponent((link.href.match(/family=([^&]+)/)?.[1] || "").replace(/\+/g, " ")) || "desconocida";
    console.warn(`[fonts] No se pudo cargar la hoja de la fuente "${family}" (${link.href})`);
    fontFailureListener?.({ family, href: link.href });
  };
}

export function loadGoogleFontInDocument(family: string, variants: string[] = []): void {
  const href = proxiedFontCssUrl(googleFontHref(family, variants));
  if (!href) return;
  const resolved = absoluteFontUrl(href);
  const id = `gf-${requestableFamily(family).replace(/\s+/g, "-").toLowerCase()}`;
  const existing = document.getElementById(id) as HTMLLinkElement | null;
  // Same family, wider axes (e.g. bold added later): refreshing the href
  // re-fetches the stylesheet. Returning early here would freeze the family
  // at whatever weights it was first picked with.
  if (existing) {
    if (existing.href !== resolved) existing.href = resolved;
    return;
  }
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = resolved;
  watchFontLink(link);
  document.head.appendChild(link);
}

export function injectGoogleFontIntoFrames(family: string, variants: string[] = []): void {
  const href = proxiedFontCssUrl(googleFontHref(family, variants));
  if (!href) return;
  const resolved = absoluteFontUrl(href);
  for (const frame of document.querySelectorAll("[data-frame-id]")) {
    const host = [...frame.querySelectorAll("*")].find(element => (element as HTMLElement).shadowRoot) as HTMLElement | undefined;
    const shadow = host?.shadowRoot;
    if (!shadow) continue;
    const existing = [...shadow.querySelectorAll("link")].find(link => (link as HTMLLinkElement).href === resolved);
    if (existing) continue;
    // An older, narrower link for the same family stays: font-face
    // declarations merge across stylesheets, and the fuller one wins.
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = resolved;
    watchFontLink(link);
    shadow.insertBefore(link, shadow.firstChild);
  }
}
