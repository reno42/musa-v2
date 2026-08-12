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

function numericVariants(variants: string[]): string[] {
  return [...new Set(variants.filter(variant => /^\d{3}$/.test(variant)))];
}

/** Empty when the value names nothing a webfont host could serve. */
export function googleFontHref(family: string, variants: string[] = []): string {
  const requestable = requestableFamily(family);
  if (!requestable) return "";
  const weights = numericVariants(variants);
  const axis = weights.length ? `:wght@${weights.join(";")}` : "";
  return `https://fonts.googleapis.com/css2?family=${encodeFamily(requestable)}${axis}&display=swap`;
}

export function ensureGoogleFontImport(css: string, family: string): string {
  const requestable = requestableFamily(family);
  if (!requestable) return css;
  const encoded = encodeFamily(requestable);
  if (css.includes(`family=${encoded}`)) return css;
  return `@import url('${googleFontHref(requestable)}');\n${css}`;
}

export function loadGoogleFontInDocument(family: string, variants: string[] = []): void {
  const href = googleFontHref(family, variants);
  if (!href) return;
  const id = `gf-${requestableFamily(family).replace(/\s+/g, "-").toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

export function injectGoogleFontIntoFrames(family: string): void {
  const href = googleFontHref(family);
  if (!href) return;
  for (const frame of document.querySelectorAll("[data-frame-id]")) {
    const host = [...frame.querySelectorAll("*")].find(element => (element as HTMLElement).shadowRoot) as HTMLElement | undefined;
    const shadow = host?.shadowRoot;
    if (!shadow || [...shadow.querySelectorAll("link")].some(link => (link as HTMLLinkElement).href === href)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    shadow.insertBefore(link, shadow.firstChild);
  }
}
