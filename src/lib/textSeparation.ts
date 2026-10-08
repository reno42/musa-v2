/**
 * textSeparation — REQ039 P2.5: per-letter separation of a text layer with
 * the original kept editable (hidden, tagged, restorable) and explicit
 * limits.
 *
 * Limits (surfaced verbatim in the UI):
 *  - each letter becomes an INDEPENDENT text layer: editing the original
 *    afterwards does NOT update the letters (restore + re-separate);
 *  - positions are measured at separation time with the current font,
 *    size and spacing — they never reflow;
 *  - no glyph vectorization: letters stay real text (one char per layer).
 *
 * Pure string-in/string-out via DOMParser — no el.style access, so the QA
 * suite runs the same code under a minimal DOM shim. Measurement
 * (measureLetterBoxes) is the only DOM-live part and runs in the editor.
 */

/** Per-character box relative to the layer's top-left, measured at separation
 *  time. Whitespace chars never become layers (they only shape the layout). */
export interface LetterBox {
  char: string;
  dx: number;
  dy: number;
  w: number;
  h: number;
}

/** Letters carry this attribute pointing at their source layer id. */
export const SEP_OF_ATTR = "data-sep-of";
/** The hidden original carries this marker while letters exist. */
export const SEP_SOURCE_ATTR = "data-text-sep";

/** User-perceived characters (surrogate pairs stay whole). */
export function splitChars(text: string): string[] {
  return Array.from(text);
}

/** Concatenated CSS rule blocks the editor wrote for this layer (used by the
 *  measurement host so fonts/spacing match the canvas exactly). */
export function extractLayerCssBlocks(css: string, layerId: string): string {
  const re = new RegExp(`\\[data-layer-id="${layerId}"\\]\\s*\\{[^}]*\\}`, "g");
  return (css.match(re) || []).join("\n");
}

/** Inline style minus the declarations letters must not inherit (position is
 *  recomputed per letter; box constraints would wrap single chars). */
function letterBaseStyle(styleAttr: string): string {
  return styleAttr
    .split(";")
    .map(d => d.trim())
    .filter(Boolean)
    .filter(d => !/^(left|top|right|bottom|width|height|overflow|visibility)\s*:/i.test(d))
    .join(";");
}

function readPx(styleAttr: string, prop: string): number | null {
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(-?[\\d.]+)px`, "i").exec(styleAttr);
  return m ? Number(m[1]) : null;
}

function appendDecl(styleAttr: string, decl: string): string {
  const style = styleAttr.trim().replace(/;$/, "");
  return style ? `${style};${decl}` : decl;
}

function removeDecl(styleAttr: string, propRe: RegExp): string {
  const kept = styleAttr
    .split(";")
    .map(d => d.trim())
    .filter(Boolean)
    .filter(d => !propRe.test(d));
  return kept.join(";");
}

/** Separability contract: a text layer whose content is exactly one text
 *  node, positioned absolutely (inline left+top). Everything else is
 *  rejected — the UI surfaces the limit instead of guessing. */
export function layerIsSeparable(html: string, layerId: string): boolean {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const el = [...doc.body.querySelectorAll("[data-layer-id]")]
    .find(e => e.getAttribute("data-layer-id") === layerId);
  if (!el) return false;
  if (el.getAttribute("data-layer-kind") !== "text") return false;
  const hasElementChildren = [...el.childNodes].some(n => n.nodeType === 1);
  if (hasElementChildren) return false;
  const style = el.getAttribute("style") || "";
  return readPx(style, "left") !== null && readPx(style, "top") !== null;
}

export interface SeparationResult {
  html: string;
  letterIds: string[];
}

/** Rewrite ONE text layer into: the original (hidden, tagged with
 *  SEP_SOURCE_ATTR) followed by one absolute text layer per visible char at
 *  (left+dx, top+dy). Re-separation of the same source replaces its previous
 *  letters first. Returns null when the layer is missing or not positioned. */
export function separateTextLayer(
  html: string,
  layerId: string,
  boxes: LetterBox[],
  createId: () => string,
): SeparationResult | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const el = [...doc.body.querySelectorAll("[data-layer-id]")]
    .find(e => e.getAttribute("data-layer-id") === layerId);
  if (!el) return null;
  const style = el.getAttribute("style") || "";
  const baseLeft = readPx(style, "left");
  const baseTop = readPx(style, "top");
  if (baseLeft === null || baseTop === null) return null;

  // Re-separation: previous letters of THIS source go first.
  for (const old of [...doc.body.querySelectorAll(`[${SEP_OF_ATTR}="${layerId}"]`)]) {
    old.remove();
  }

  const baseStyle = letterBaseStyle(style);
  el.setAttribute(SEP_SOURCE_ATTR, "1");
  if (!/visibility\s*:/i.test(style)) {
    el.setAttribute("style", appendDecl(style, "visibility:hidden"));
  }

  const letterIds: string[] = [];
  let anchor: Element = el;
  for (const box of boxes) {
    if (!box.char || !box.char.trim()) continue; // whitespace shapes, never layers
    const letter = doc.createElement(el.tagName.toLowerCase());
    const id = createId();
    letter.setAttribute("data-layer-id", id);
    letter.setAttribute("data-layer-kind", "text");
    letter.setAttribute("data-layer-name", `letra: ${box.char}`.slice(0, 30));
    letter.setAttribute(SEP_OF_ATTR, layerId);
    letter.setAttribute(
      "style",
      `${baseStyle ? baseStyle + ";" : ""}position:absolute;left:${Math.round((baseLeft + box.dx) * 100) / 100}px;top:${Math.round((baseTop + box.dy) * 100) / 100}px;`,
    );
    letter.textContent = box.char;
    anchor.after(letter);
    anchor = letter;
    letterIds.push(id);
  }
  return { html: doc.body.innerHTML, letterIds };
}

/** "Unir letras": delete every letter of this source and unhide the original
 *  (its content was never touched — editing resumes exactly where it was). */
export function restoreSeparatedText(html: string, layerId: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const el = [...doc.body.querySelectorAll("[data-layer-id]")]
    .find(e => e.getAttribute("data-layer-id") === layerId);
  if (!el) return null;
  for (const letter of [...doc.body.querySelectorAll(`[${SEP_OF_ATTR}="${layerId}"]`)]) {
    letter.remove();
  }
  if (el.getAttribute(SEP_SOURCE_ATTR) !== null) {
    el.removeAttribute(SEP_SOURCE_ATTR);
    const style = el.getAttribute("style") || "";
    const cleaned = removeDecl(style, /^visibility\s*:/i);
    if (cleaned) el.setAttribute("style", cleaned);
    else el.removeAttribute("style");
  }
  return doc.body.innerHTML;
}

/** The live part (editor-only): measure one layer's characters in a hidden
 *  host that replicates its html + css blocks. Spans are inline-block, which
 *  drops kerning ACROSS letters — by design, since separated letters are
 *  standalone elements anyway (limit made explicit in the UI). */
export function measureLetterBoxes(layerHtml: string, cssBlocks: string): LetterBox[] | null {
  if (typeof document === "undefined" || !layerHtml) return null;
  const host = document.createElement("div");
  host.setAttribute("data-text-measure-host", "1");
  host.style.cssText = "position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;";
  if (cssBlocks) {
    const style = document.createElement("style");
    style.textContent = cssBlocks;
    host.appendChild(style);
  }
  // Parsed + imported node instead of raw HTML injection: same trust level
  // as the rest of the editor (this is the frame's persisted html), but no
  // parser-injection API in the path.
  const parsed = new DOMParser().parseFromString(layerHtml, "text/html");
  const imported = parsed.body.firstElementChild;
  if (imported) host.appendChild(document.importNode(imported, true));
  document.body.appendChild(host);
  try {
    const el = host.querySelector("[data-layer-id]") as HTMLElement | null;
    if (!el) return null;
    const textNode = Array.from(el.childNodes).find(n => n.nodeType === 3) as Text | null;
    const text = textNode?.textContent ?? el.textContent ?? "";
    if (!text) return null;
    const frag = document.createDocumentFragment();
    const spans: HTMLElement[] = [];
    for (const ch of splitChars(text)) {
      if (ch === "\n") {
        frag.appendChild(document.createElement("br"));
        continue;
      }
      const span = document.createElement("span");
      span.style.cssText = "display:inline-block;";
      span.textContent = ch;
      frag.appendChild(span);
      spans.push(span);
    }
    textNode?.replaceWith(frag);
    return spans.map(span => ({
      char: span.textContent || "",
      dx: span.offsetLeft,
      dy: span.offsetTop,
      w: span.offsetWidth,
      h: span.offsetHeight,
    }));
  } finally {
    host.remove();
  }
}
