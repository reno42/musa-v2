/**
 * Building a valid CSS `font-family` value.
 *
 * The picker hands back either a single family ("Roboto") or a whole fallback
 * stack ("Helvetica, Arial, sans-serif"), because a system font has to name its
 * substitutes — a design made on a Mac still has to render on a PC.
 *
 * Every call site wrapped that in quotes: `'Helvetica, Arial, sans-serif'`.
 * Quoting a stack turns it into one family with a comma in its name, which no
 * machine has installed, so the browser fell back to its own default — a serif.
 * Every system font in the catalogue carries a stack, so every one of them
 * produced that same serif, which is why picking a different font appeared to
 * change nothing at all. No error is logged for this: an unmatched font-family
 * is not an error, it is just a fallback.
 */

/** Generic families are CSS keywords. Quoting one stops it resolving. */
const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy",
  "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
  "math", "emoji", "fangsong",
]);

/** CSS-wide keywords, which are values rather than family names. */
const CSS_WIDE_KEYWORDS = new Set(["inherit", "initial", "revert", "revert-layer", "unset"]);

/**
 * Families the user uploaded themselves, registered at runtime as @font-face
 * by the picker. Asking a webfont host for one 404s into the same silent
 * fallback that made system stacks look broken — so a custom family must be
 * recognized here, in the pure module both the editor and the node tests
 * import, and never sent to Google.
 */
const customFontFamilies = new Set<string>();

export function registerCustomFontFamily(family: string): void {
  const bare = stripQuotes(family || "");
  if (bare) customFontFamilies.add(bare);
}

export function isCustomFontFamily(family: string): boolean {
  return customFontFamilies.has(stripQuotes(family || ""));
}

const stripQuotes = (name: string) => name.trim().replace(/^['"]|['"]$/g, "").trim();

/**
 * An unquoted family name must be a sequence of CSS identifiers, so anything
 * with a space, a digit-leading word or punctuation needs quoting.
 */
const isBareIdentifier = (name: string) => /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name);

/** Quotes one family name, leaving keywords bare so they still resolve. */
function normalizeFamily(name: string): string {
  const bare = stripQuotes(name);
  if (!bare) return "";
  const lower = bare.toLowerCase();
  if (GENERIC_FAMILIES.has(lower) || CSS_WIDE_KEYWORDS.has(lower)) return lower;
  return isBareIdentifier(bare) ? bare : `"${bare}"`;
}

/** Splits a stack on its top-level commas, ignoring commas inside quotes. */
function splitStack(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of value) {
    if (quote) {
      if (char === quote) quote = null;
      current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ",") {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map(part => part.trim()).filter(Boolean);
}

/**
 * Turns whatever the picker emitted into a valid CSS `font-family` value.
 *
 * A stack passes through with each family quoted only as needed; a lone family
 * is quoted only if it is not a bare identifier. What it never does is quote
 * the whole thing.
 */
export function cssFontFamily(value: string): string {
  if (!value?.trim()) return "";
  return splitStack(value).map(normalizeFamily).filter(Boolean).join(", ");
}

/**
 * The first real family in a stack, unquoted — what to show in the picker and
 * what to ask a webfont host for. Generic keywords are skipped: nobody wants to
 * request "sans-serif" from Google.
 */
export function primaryFamily(value: string): string {
  if (!value?.trim()) return "";
  for (const part of splitStack(value)) {
    const bare = stripQuotes(part);
    const lower = bare.toLowerCase();
    if (bare && !GENERIC_FAMILIES.has(lower) && !CSS_WIDE_KEYWORDS.has(lower)) return bare;
  }
  return "";
}

/**
 * Whether a value names its own fallbacks. Only fonts already on the machine
 * carry a stack, so this is also the signal that no webfont should be fetched:
 * that request 404s, and the silent fallback looks like the picker ignoring the
 * click.
 */
export function isFontStack(value: string): boolean {
  return splitStack(value || "").length > 1;
}

/** True for a value that no webfont host could serve. */
export function isGenericFamily(value: string): boolean {
  const lower = stripQuotes(value || "").toLowerCase();
  return GENERIC_FAMILIES.has(lower) || CSS_WIDE_KEYWORDS.has(lower);
}

/**
 * Whether to fetch this font from a webfont host. A stack means it is
 * installed locally, a generic keyword is not a font at all, and a custom
 * upload already lives at its own @font-face — none of them go to Google.
 */
export function needsWebfont(value: string): boolean {
  const family = primaryFamily(value);
  return Boolean(family) && !isFontStack(value) && !isGenericFamily(family) && !isCustomFontFamily(family);
}
