/**
 * Shared HTML document parser.
 * Accepts a complete HTML document (like Gemini outputs) and extracts:
 *   - body innerHTML (strips <script>)
 *   - all <style> contents merged
 *   - <link> font imports → @import
 *   - detected dimensions from CSS body { width/height }
 */

export interface ParsedHtmlDoc {
  html: string;
  css: string;
  /** Detected width from body CSS, or null */
  width: number | null;
  /** Detected height from body CSS, or null */
  height: number | null;
}

/**
 * Parse a raw HTML document string into { html, css, width, height }.
 * Uses DOMParser — works in browser and jsdom environments.
 */
export function parseHtmlDocument(raw: string): ParsedHtmlDoc {
  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, "text/html");

  // ── Extract CSS: all <style> contents + convert <link> font imports to @import ──
  const styleParts: string[] = [];
  doc.querySelectorAll("style").forEach(s => {
    const text = s.textContent || "";
    if (text.trim()) styleParts.push(text);
  });
  doc.querySelectorAll('link[rel="stylesheet"][href]').forEach(link => {
    const href = (link as HTMLLinkElement).getAttribute("href") || "";
    if (href.includes("fonts.googleapis.com")) {
      styleParts.unshift(`@import url('${href}');`);
    }
  });
  const css = styleParts.join("\n");

  // ── Extract body inner HTML (strip script tags for safety) ──
  doc.querySelectorAll("script").forEach(s => s.remove());
  const bodyHtml =
    doc.body?.innerHTML?.trim() ||
    doc.documentElement?.innerHTML ||
    raw;

  // ── Detect dimensions from body CSS ──
  let width: number | null = null;
  let height: number | null = null;

  const bodyMatch = css.match(/body\s*\{[^}]*\}/s);
  if (bodyMatch) {
    const bodyBlock = bodyMatch[0];
    const wm = bodyBlock.match(/width\s*:\s*(\d+(?:\.\d+)?)px/);
    const hm = bodyBlock.match(/height\s*:\s*(\d+(?:\.\d+)?)px/);
    if (wm) width = parseFloat(wm[1]);
    if (hm) height = parseFloat(hm[1]);
  }

  return { html: bodyHtml, css, width, height };
}
