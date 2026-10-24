/**
 * Restores, when a file opens and whenever its frames change, every webfont
 * the design references — at the level the editor's canvas actually resolves:
 * the main document.
 *
 * The bug this fixes (Test Instinct report, 2026-10-23): the font-family
 * binding persists fine in the saved model, but nothing loaded the font FILE
 * on open. `document.fonts` only ever held Instrument Serif, every referenced
 * family rendered as fallback serif, and the fix only ever arrived through
 * user interaction — one picker click loaded the family document-level and
 * instantly repaired every layer using it. Present mode always worked because
 * its iframe renders font `<link>`s in a real document head. The editor
 * canvas resolves against THIS document: stylesheets and FontFaces that live
 * only inside the frame's shadow tree do not reach it.
 *
 * Three reference sources per frame, in priority order:
 *   1. Custom uploads — matched against the account's TUS FUENTES list and
 *      loaded as FontFaces. Must resolve BEFORE the Google pass: Musa names
 *      uploads on its own ("1 ArchivoBlack"), which is nobody's Google family.
 *   2. Exact css2 hrefs — @imports in the css (and inline <style> of imported
 *      html) plus `<link>`s the import kept, hoisted verbatim so the axes the
 *      design asked for survive.
 *   3. Orphan families — `font-family:` declarations and `font:` shorthands
 *      no href covers, requested as bare families (css2 serves the family
 *      default; never synthesize weights, css2 400s families lacking them).
 */

import type { CustomFont } from "./customFonts";
import { css2FamilyParam, ensureGoogleHrefInDocument, googleFontHref } from "./googleFonts.ts";
import { needsWebfont, primaryFamily } from "./fontFamily.ts";

/** The slice of FrameData the scanner needs — keeps the module node-testable. */
export interface FrameFontInput { html?: string; css?: string }

const ENTITY_TEXT: Record<string, string> = {
  "&quot;": '"', "&#34;": '"', "&apos;": "'", "&#39;": "'",
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&#60;": "<", "&#62;": ">",
};

export interface DesignFontRefs {
  /** Exact css2 URLs to hoist (deduped, in first-seen order). */
  hrefs: string[];
  /** Raw font-family/font-shorthand values — possibly whole fallback stacks,
   *  which is information the Google gate needs (a stack = installed font). */
  families: string[];
}

/** Collects every font reference a set of frames makes. Pure — no DOM, no
 *  network — so the QA test imports it directly. */
export function collectDesignFontRefs(frames: FrameFontInput[]): DesignFontRefs {
  const hrefs = new Set<string>();
  const families = new Set<string>();
  // Declaration scans. `\bfont` cannot match `font-family:` (the hyphen
  // breaks the word boundary before `:`), and it survives adjacent shorthands
  // where a delimiter-consuming group would eat the `;` the next one needs.
  // Entities first: round-tripped html carries embedded quotes as &quot;,
  // and a family scanned as `&quot;1 ArchivoBlack&quot;` matches nothing.
  const scanCss = (rawText: string) => {
    const text = rawText.replace(/&(quot|#34|apos|#39|amp|lt|gt|#60|#62);/g, entity => ENTITY_TEXT[entity] ?? entity);
    for (const m of text.matchAll(/font-family\s*:\s*([^;{}]+)/gi)) families.add(unquote(m[1].replace(/!important/ig, "").trim()));
    for (const m of text.matchAll(/\bfont\s*:\s*([^;{}]+)/gi)) families.add(familyFromFontShorthand(m[1]));
  };
  for (const frame of frames || []) {
    const css = frame.css || "";
    const html = frame.html || "";
    scanCss(css);
    // Inline style attributes and <style> blocks kept in imported html are
    // css too — scanned as css so quoted families (style="font-family:
    // 'Archivo Black'") stop at their own quotes, not at the first one.
    for (const m of html.matchAll(/style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/gi)) scanCss(m[1] || m[2] || "");
    for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) scanCss(m[1]);
    // @import hrefs — the css, and any inline <style> block (scanned again
    // here as raw text; a second hit only dedupes into the same Set).
    for (const text of [css, html]) {
      for (const m of text.matchAll(/@import\s+url\(\s*(['"]?)(https:\/\/fonts\.googleapis\.com\/[^'"\)\s]+)\1\s*\)/gi)) {
        hrefs.add(m[2]);
      }
    }
    // <link rel=stylesheet> to css2 that the imported document kept in its html.
    for (const m of html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']*fonts\.googleapis\.com\/css2[^"']*)["'][^>]*>/gi)) {
      hrefs.add(m[1]);
    }
  }
  families.delete("");
  return { hrefs: [...hrefs], families: [...families] };
}

/** Strips one pair of surrounding quotes — `'Space Mono'` as written in a
 *  style attribute must match the picker's unquoted family name. */
function unquote(value: string): string {
  const m = /^(['"])([\s\S]*)\1$/.exec(value.trim());
  return m ? m[2].trim() : value.trim();
}

/** The family named by a `font:` shorthand value. A quoted string can only be
 *  the family; otherwise it is everything after the size (and optional
 *  /line-height). Weight/style prefixes are unitless and never match. */
export function familyFromFontShorthand(value: string): string {
  const v = (value || "").replace(/!important/ig, "").trim();
  if (!v) return "";
  const quoted = /(['"])(.*?)\1/.exec(v);
  if (quoted) return quoted[2].trim();
  const afterSize = /(?:^|\s)[\d.]+(?:px|pt|pc|em|rem|ex|ch|vw|vh|vmin|vmax|cm|mm|q|in|%)(?:\s*\/\s*(?:[\d.]+[a-z%]*|[\d.]+))?\s+(.+)$/i.exec(v);
  return afterSize ? afterSize[1].trim() : "";
}

/** The account's uploads, fetched once per session. Fonts applied later ride
 *  the picker's own apply path, so a stale list costs nothing. */
let customFontsPromise: Promise<CustomFont[]> | null = null;
function accountCustomFonts(): Promise<CustomFont[]> {
  if (!customFontsPromise) {
    // Lazy import keeps this module (and its pure scanner) loadable under
    // node --test, which cannot evaluate the api-key/supabase chain.
    customFontsPromise = import("./customFonts")
      .then(m => m.listCustomFonts())
      .catch(() => []); // signed out or offline — the Google pass still runs
  }
  return customFontsPromise.then(fonts => (Array.isArray(fonts) ? fonts : []));
}

function familyFromParam(param: string): string {
  const spaced = param.replace(/\+/g, " ").trim().toLowerCase();
  try { return decodeURIComponent(spaced); } catch { return spaced; }
}

/**
 * Idempotent: every action dedupes (link ids, the custom-face cache, the
 * custom-font style per shadow), so running it on every frame arrival — file
 * open, MCP reload, collaborator polling — only ever fills what is missing.
 */
export async function restoreDesignFonts(frames: FrameFontInput[]): Promise<void> {
  const refs = collectDesignFontRefs(frames);
  if (!refs.hrefs.length && !refs.families.length) return;

  // Uploads first — registering them is also what keeps needsWebfont from
  // mistaking a custom family for a Google one below.
  const customs = await accountCustomFonts();
  const byFamily = new Map(customs.map(font => [font.familyName.trim().toLowerCase(), font]));
  if (byFamily.size > 0) {
    const { loadCustomFontInDocument, injectCustomFontIntoFrames } = await import("./customFonts");
    for (const value of refs.families) {
      const custom = byFamily.get(primaryFamily(value).trim().toLowerCase());
      if (!custom) continue;
      injectCustomFontIntoFrames(custom);
      try { await loadCustomFontInDocument(custom); } catch { /* cached or blocked — the persisted css still applies */ }
    }
  }

  // Exact hrefs first, so the hoist decides what "already covered" means…
  const hoisted = new Set<string>();
  for (const href of refs.hrefs) {
    ensureGoogleHrefInDocument(href);
    const family = familyFromParam(css2FamilyParam(href).split(":")[0]);
    if (family) hoisted.add(family);
  }
  // …then orphan families as bare-family links (css2 default weight —
  // synthesized weights are how css2 400s collapse a whole load).
  for (const value of refs.families) {
    const family = primaryFamily(value);
    if (!family || hoisted.has(family.trim().toLowerCase())) continue;
    if (!needsWebfont(value)) continue; // stacks/generics are installed; customs were handled above
    ensureGoogleHrefInDocument(googleFontHref(family));
  }
}
