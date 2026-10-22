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
const OPENER = "@import url('https://fonts.googleapis.com/css2?family=";

/** Whether a css line is an @import FOR THIS EXACT family: `encoded` is the
 *  family name as it appears in the query (OPENER already ends in `family=`,
 *  so the name starts right after it) and must end at a segment delimiter
 *  (`:` axis, `&` next param, `'` closing the url, or end of line). A bare
 *  startsWith("…family=Roboto") also matched "family=Roboto+Mono", so the
 *  upgrade below rewrote ANOTHER family's import into this one's on every
 *  heal pass — the css grew one line per pass and the editor died with
 *  "Maximum update depth exceeded" on load (tpl_11cbed9a). */
function isFamilyImportLine(line: string, encoded: string): boolean {
  if (!line.startsWith(OPENER)) return false;
  const rest = line.slice(OPENER.length);
  if (!rest.startsWith(encoded)) return false;
  const next = rest.charAt(encoded.length);
  return next === "" || next === "&" || next === ":" || next === "'";
}

/** Whether the css mentions this family's query param as a SEGMENT (right-
 *  delimited), not as a prefix of a longer family name — indexOf + next-char
 *  check, so `family=Roboto` no longer satisfies `family=Roboto+Mono`. */
function cssNamesFamily(css: string, familyParam: string): boolean {
  let idx = css.indexOf(familyParam);
  while (idx !== -1) {
    const next = css.charAt(idx + familyParam.length);
    if (next === "" || next === "&" || next === ":" || next === "'") return true;
    idx = css.indexOf(familyParam, idx + 1);
  }
  return false;
}

/** The axis tuples an import line requests — `:wght@400;700` → {"wght:400",
 *  "wght:700"}, `:ital,wght@0,400;1,700` → {"ital:0|wght:400", …}; an empty
 *  set for a bare family-only import (css2 then serves the family default). */
function axisCoverage(line: string, encoded: string): Set<string> {
  const rest = line.slice(OPENER.length + encoded.length);
  const m = /^:([a-z,]+)@([^&']+)/.exec(rest);
  if (!m) return new Set();
  const keys = m[1].split(",");
  return new Set(m[2].split(";").map(tuple => {
    const values = tuple.split(",");
    return values.map((value, i) => `${keys[i] ?? keys[0]}:${value}`).join("|");
  }));
}

export function ensureGoogleFontImport(css: string, family: string, variants: string[] = []): string {
  const requestable = requestableFamily(family);
  if (!requestable) return css;
  const href = googleFontHref(requestable, variants);
  if (!href) return css;
  const wanted = `@import url('${href}');`;
  const encoded = encodeFamily(requestable);
  const familyParam = `family=${encoded}`;
  const lines = css.split("\n");
  let sawImport = false;
  const merged = lines.map(line => {
    if (!isFamilyImportLine(line, encoded)) return line;
    sawImport = true;
    if (line === wanted) return line;
    // REQ-048 F1: only ever WIDEN. The css-arrival heal pass
    // (ensureDesignFontImports) calls this with no variants, and it used to
    // rewrite a weighted import like family=Syne:wght@700;800 down to the
    // bare family — Google then served only Syne 400 and every heavier
    // weight rendered as synthetic bold. If the existing line already
    // covers every tuple the wanted one asks for, keep it as-is.
    const have = axisCoverage(line, encoded);
    const want = axisCoverage(wanted, encoded);
    if ([...want].every(tuple => have.has(tuple))) return line;
    return wanted;
  });
  return sawImport ? merged.join("\n")
    // Not on its own line — an import embedded mid-line still counts (the
    // delimiter check keeps it family-exact), so it can never stack a second.
    : cssNamesFamily(css, familyParam) ? css
    : `${wanted}\n${css}`;
}

/**
 * The deck generator (worker/runtime/functions/deck-generator.mjs) used to hardcode
 * a wide ital+wght axis onto every family. css2 answers HTTP 400 for families
 * that lack those axes — Space Grotesk has no italic and stops at 700 — so
 * the stylesheet never arrives and any fresh page load collapses the design
 * to its serif fallback. Stripping the axis leaves `family=<Name>` — the one
 * form css2 always serves, with the family's own default/range.
 */
export function sanitizeGoogleFontUrl(url: string): string {
  return url.split(":ital,wght@0,300..800;1,300..800").join("");
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

/**
 * MCP/AI write paths (add_element, set_css, transform…) persist
 * `font-family: Nunito` without the Google Fonts import that the human picker
 * always writes (handleFontSelect). An unmatched family is not an error — the
 * browser silently falls back while the contextual panel honestly repeats the
 * declaration, which is exactly the "the panel says Nunito but nothing
 * changes" bug. Scan every declared font-family (stylesheets AND inline
 * style="…" attributes in the HTML) and prepend the missing css2 import for
 * each single-family webfont value. Idempotent: already-imported families
 * leave the css untouched and off the returned list, so callers can diff to
 * detect what actually healed.
 */
export function ensureDesignFontImports(css: string, html: string = ""): { css: string; families: string[] } {
  const candidates = new Set<string>();
  const scan = (text: string, pattern: RegExp) => {
    for (const match of (text || "").matchAll(pattern)) {
      const value = match[1].replace(/!important/ig, "").trim();
      // var()/calc() and friends name nothing a webfont host could serve.
      if (!value || /[()]/.test(value)) continue;
      const family = primaryFamily(value);
      if (family && needsWebfont(value)) candidates.add(family);
    }
  };
  scan(css, /font-family\s*:\s*([^;{}]+)/gi);
  scan(html, /font-family\s*:\s*([^;"'}]+)/gi);
  let healed = css || "";
  const families: string[] = [];
  for (const family of candidates) {
    const before = healed;
    healed = ensureGoogleFontImport(healed, family);
    if (healed !== before) families.push(family);
  }
  return { css: healed, families };
}
