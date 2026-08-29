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

export function loadGoogleFontInDocument(family: string, variants: string[] = []): void {
  const href = googleFontHref(family, variants);
  if (!href) return;
  const id = `gf-${requestableFamily(family).replace(/\s+/g, "-").toLowerCase()}`;
  const existing = document.getElementById(id) as HTMLLinkElement | null;
  // Same family, wider axes (e.g. bold added later): refreshing the href
  // re-fetches the stylesheet. Returning early here would freeze the family
  // at whatever weights it was first picked with.
  if (existing) {
    if (existing.href !== href) existing.href = href;
    return;
  }
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

export function injectGoogleFontIntoFrames(family: string, variants: string[] = []): void {
  const href = googleFontHref(family, variants);
  if (!href) return;
  for (const frame of document.querySelectorAll("[data-frame-id]")) {
    const host = [...frame.querySelectorAll("*")].find(element => (element as HTMLElement).shadowRoot) as HTMLElement | undefined;
    const shadow = host?.shadowRoot;
    if (!shadow) continue;
    const existing = [...shadow.querySelectorAll("link")].find(link => (link as HTMLLinkElement).href === href);
    if (existing) continue;
    // An older, narrower link for the same family stays: font-face
    // declarations merge across stylesheets, and the fuller one wins.
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    shadow.insertBefore(link, shadow.firstChild);
  }
}
