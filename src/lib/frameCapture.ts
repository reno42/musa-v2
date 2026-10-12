/**
 * Frame rasterization — the one correct way to turn a frame's html/css into
 * a raster image, shared by every export path (PNG/JPG/PDF/thumbnails) and
 * by the AI "eyes" pipeline (agentBridge.ts).
 *
 * WHY NOT html2canvas: it reimplements CSS property-by-property and has
 * NEVER supported the `filter` property (grayscale, blur, brightness…) —
 * https://github.com/niklasvh/html2canvas/issues/1127, confirmed still true
 * in the library's own FAQ. Every export that relied on it silently dropped
 * photo filters. This renders through an SVG <foreignObject> instead: the
 * browser's OWN HTML/CSS engine paints the content, so anything the editor
 * can display (filters, gradients, shadows, blend modes) comes out correctly
 * — there is no property list to fall behind.
 *
 * The foreignObject SVG is loaded as a data: URI. Every browser treats a
 * data-URI SVG as "origin-clean" for canvas purposes, which sidesteps the
 * Firefox tainted-canvas restriction that affects url()-loaded SVGs
 * (https://bugzilla.mozilla.org/show_bug.cgi?id=1413978).
 *
 * A second, independent bug this fixes: frame.css is authored with `body {}`
 * / `html {}` selectors (the design's "page" styles — background, padding,
 * centering, ::before marks…). The live editor remaps those to `#__df_content`
 * so they target the frame's own content root (see mapBodySelectors below).
 * Every previous export path injected the RAW css into a plain, unscoped div
 * on the real page — so `body{}` rules leaked onto the actual page body
 * (invisible, off-screen) instead of styling the export target, and anything
 * that depended on them (background, layout padding, centering) silently
 * vanished, shifting the whole design toward the top-left corner.
 *
 * A third bug, specific to photos: when an SVG is used AS AN IMAGE (loaded
 * via `new Image().src = "data:image/svg+xml,…"`, exactly what this file
 * does), browsers are explicitly permitted — and Chromium/Firefox both do
 * this — to skip loading any EXTERNAL resource referenced inside it. A
 * `<foreignObject>` in that mode renders text and CSS painting fine, but an
 * `<img src="https://…">` pointing at Supabase Storage silently fails and
 * shows the broken-image icon. Confirmed via
 * https://bugzilla.mozilla.org/show_bug.cgi?id=628747,
 * https://bugzilla.mozilla.org/show_bug.cgi?id=789249, and the reference
 * write-up for this exact technique at
 * https://semisignal.com/rendering-web-content-to-image-with-svg-foreign-object/.
 * inlineFrameImages below fetches every external image ahead of time and
 * bakes it into the markup as a data: URI — the same treatment already
 * given to Google Fonts, for the same underlying reason.
 */

import { sanitizeGoogleFontUrl } from "./googleFonts.ts";

/** Remap `body`/`html` selectors to `#__df_content` — identical to the live
 *  editor's scoping (src/components/DesignFrame.tsx), so exported markup
 *  receives exactly the styles the user sees on screen. */
export function mapBodySelectors(css: string): string {
  return css
    .replace(/([{}]\s*|,\s*|^\s*)html\b/gm, "$1#__df_content")
    .replace(/([{}]\s*|,\s*|^\s*)body\b/gm, "$1#__df_content")
    .replace(/(\s)html\b/g, "$1#__df_content")
    .replace(/(\s)body\b/g, "$1#__df_content");
}

const fontCssCache = new Map<string, string>();

/** Fetch a Google Fonts stylesheet and inline every font file as a data URI,
 *  so the export never depends on a network request at draw time. */
export async function inlineGoogleFontCss(importUrls: string[]): Promise<string> {
  const parts: string[] = [];
  for (const cssUrl of importUrls) {
    if (!fontCssCache.has(cssUrl)) {
      try {
        const cssText = await (await fetch(cssUrl)).text();
        const fontUrls = [...new Set([...cssText.matchAll(/url\((https:[^)]+)\)/g)].map(m => m[1]))];
        let inlined = cssText;
        for (const fontUrl of fontUrls) {
          const buffer = await (await fetch(fontUrl)).arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
          }
          inlined = inlined.split(fontUrl).join(`data:font/woff2;base64,${btoa(binary)}`);
        }
        fontCssCache.set(cssUrl, inlined);
      } catch {
        fontCssCache.set(cssUrl, ""); // font fetch failed — export continues with fallback fonts
      }
    }
    parts.push(fontCssCache.get(cssUrl)!);
  }
  return parts.join("\n");
}

const imageDataUriCache = new Map<string, string>();

/**
 * Fetch one external image and convert it to a base64 data: URI. Cached by
 * URL so exporting several frames that share a logo/photo — or re-exporting
 * the same frame — never re-fetches. A failed fetch (network error, missing
 * CORS headers) returns the ORIGINAL url unchanged and is cached as such —
 * one broken image must degrade gracefully, not fail the whole export, and
 * must not be retried on every single export afterward.
 */
export async function inlineImageUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const cached = imageDataUriCache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") || "image/png";
    const bytes = new Uint8Array(await res.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
    }
    const dataUri = `data:${contentType};base64,${btoa(binary)}`;
    imageDataUriCache.set(url, dataUri);
    return dataUri;
  } catch {
    imageDataUriCache.set(url, url);
    return url;
  }
}

/** Every `url(http…)` in css, EXCLUDING `@import` statements (those are font
 *  stylesheets, handled separately by inlineGoogleFontCss — blindly treating
 *  them as images here would corrupt the font import). */
function collectCssImageUrls(css: string): string[] {
  const withoutImports = css.replace(/@import\s+url\([^)]*\)[^;]*;/g, "");
  const urls = new Set<string>();
  for (const m of withoutImports.matchAll(/url\((['"]?)(https?:\/\/[^'")]+)\1\)/g)) urls.add(m[2]);
  return [...urls];
}

/**
 * Custom (user-uploaded) fonts persist in the design css as @font-face rules
 * pointing at their bucket URL. An SVG <img> fetches no external resources —
 * the same constraint that data-URIs the Google fonts — so every such url()
 * is swapped for a data: URI before the frame is drawn or measured.
 */
const CUSTOM_FONT_URL_RE = /url\((['"]?)(https?:\/\/[^'")]+\/storage\/v1\/object\/public\/custom-fonts\/[^'")]+)\1\)/g;

async function inlineCustomFontUrls(css: string): Promise<string> {
  const urls = [...new Set([...css.matchAll(CUSTOM_FONT_URL_RE)].map(m => m[2]))];
  if (urls.length === 0) return css;
  let out = css;
  for (const url of urls) out = out.split(url).join(await inlineImageUrl(url));
  return out;
}

/**
 * Replace every external (http/https) image reference in a frame's html
 * (`<img src>`) and css (`background(-image): url(...)`, inline `style`
 * attributes) with its inlined data: URI. Must run before the markup is
 * embedded in an SVG used as an image — see the module doc comment for why.
 */
export async function inlineFrameImages(html: string, css: string): Promise<{ html: string; css: string }> {
  const container = document.createElement("div");
  container.innerHTML = html;

  const htmlUrls = new Set<string>();
  for (const img of container.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src") || "";
    if (/^https?:\/\//.test(src)) htmlUrls.add(src);
  }
  for (const el of container.querySelectorAll<HTMLElement>("[style*=url]")) {
    for (const m of (el.getAttribute("style") || "").matchAll(/url\((['"]?)(https?:\/\/[^'")]+)\1\)/g)) {
      htmlUrls.add(m[2]);
    }
  }
  const cssUrls = collectCssImageUrls(css);
  const allUrls = [...new Set([...htmlUrls, ...cssUrls])];
  if (allUrls.length === 0) return { html, css };

  const map = new Map<string, string>();
  await Promise.all(allUrls.map(async url => { map.set(url, await inlineImageUrl(url)); }));

  for (const img of container.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src") || "";
    const inlined = map.get(src);
    if (inlined && inlined !== src) img.setAttribute("src", inlined);
  }
  for (const el of container.querySelectorAll<HTMLElement>("[style*=url]")) {
    let style = el.getAttribute("style") || "";
    for (const [url, dataUri] of map) {
      if (dataUri === url) continue;
      style = style.split(url).join(dataUri);
    }
    el.setAttribute("style", style);
  }

  let nextCss = css;
  for (const [url, dataUri] of map) {
    if (dataUri === url) continue;
    nextCss = nextCss.split(url).join(dataUri);
  }

  return { html: container.innerHTML, css: nextCss };
}

/**
 * Normalize an arbitrary HTML string into well-formed XML by round-tripping
 * it through the browser's lenient HTML parser and re-serializing. Frame
 * html is authored HTML (unescaped `&`, void tags like `<br>`, boolean
 * attributes) — embedding it directly in an XML document (the SVG we build
 * below) throws a parser error; this guarantees it never does.
 */
function toXhtml(html: string, wrapperId: string): string {
  const container = document.createElement("div");
  container.id = wrapperId;
  container.innerHTML = html;
  return new XMLSerializer().serializeToString(container);
}

export interface FrameSource {
  html: string;
  css: string;
  width: number;
  height: number;
  /** Any valid CSS `background` value (color, gradient) or "transparent". */
  background: string;
}

/** Build the self-contained SVG markup for one frame. Pure — no DOM writes,
 *  easy to unit-test independent of canvas/Image loading. */
export function buildFrameSvgMarkup(
  source: FrameSource,
  fontCss: string,
): string {
  const { html, css, width, height, background } = source;
  const scopedCss = mapBodySelectors(css).replace(/@import\s+url\([^)]*\)[^;]*;/g, "");
  const xhtml = toXhtml(html, "__df_content");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<foreignObject width="100%" height="100%">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;position:relative;background:${background};overflow:hidden">`
    + `<style>${fontCss}\n#__df_content{width:${width}px;height:${height}px;overflow:hidden}\n${scopedCss}</style>${xhtml}</div></foreignObject></svg>`;
}

/**
 * Rasterize a frame (from its persisted html/css — no live DOM required, so
 * this works identically whether the design is open in the editor or being
 * batch-processed from the dashboard) into a canvas at the given pixel scale.
 */
export async function rasterizeFrame(source: FrameSource, scale = 2): Promise<HTMLCanvasElement> {
  const importUrls = [...source.css.matchAll(/@import\s+url\(['"]?([^'")]+)['"]?\)/g)]
    .map(m => sanitizeGoogleFontUrl(m[1]))
    .filter(url => url.includes("fonts.googleapis.com"));
  const [{ html, css: withImages }, fontCss] = await Promise.all([
    inlineFrameImages(source.html, source.css),
    inlineGoogleFontCss(importUrls),
  ]);
  const css = await inlineCustomFontUrls(withImages);
  const svg = buildFrameSvgMarkup({ ...source, html, css }, fontCss);

  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const parseError = parsed.querySelector("parsererror");
  if (parseError) throw new Error(`Frame markup is not renderable: ${parseError.textContent?.slice(0, 200)}`);

  const image = new Image();
  image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Frame failed to rasterize"));
  });
  // Fonts and images inside the foreignObject decode asynchronously; give
  // them a beat before the canvas draw freezes the frame.
  await new Promise(resolve => setTimeout(resolve, 350));
  // F2 (REQ-048): the beat alone raced font decode on cold caches and froze
  // the fallback face into the raster. Settling the document's font queue
  // first waits for the real faces whenever the main document knows them;
  // the beat stays as the floor for faces only the SVG knows.
  if (document.fonts?.ready) { try { await document.fonts.ready; } catch { /* the beat is the floor */ } }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), mimeType, quality));
}

// ═════════ Native-text export support (REQ-023 "texto copiable") ═════════
// The raster bakes the design's words into pixels. PowerPoint consumers need
// those words as real, selectable text — so the PPT export lays native text
// boxes over a raster whose own text layer was hidden. Two primitives here:
// the geometry (a live-layout twin of the SVG path) and the text-free paint.

/** Appended when rasterizing the art-only background: every character
 *  disappears (color, webkit fill, text shadows) while boxes, images and
 *  the rest of the design stay untouched. */
export const HIDE_TEXT_CSS =
  "\n#__df_content,#__df_content *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}";

/** One design TEXT LINE, in FRAME pixels, ready to become a native
 *  PowerPoint text box (px→inches and px→points are the caller's math).
 *  Per-line, not per-block: PowerPoint re-wraps by its own font metrics,
 *  so block-sized boxes break at different words and stack onto neighbors. */
export interface PptTextBlock {
  /** Whitespace-collapsed, text-transform-applied — what PPT should show. */
  text: string;
  /** Line ink rect, clamped to the frame bounds. */
  x: number; y: number; w: number; h: number;
  /** CSS px, as painted. */
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string; // #rrggbb
  fontFace: string; // first family of the computed stack
}

/**
 * Measure where the design's text actually sits. rasterizeFrame paints
 * through an SVG <foreignObject> — no live DOM to query — so this renders
 * the SAME markup (mapBodySelectors scoping, inlined fonts and images) into
 * a hidden same-origin iframe and reads the browser's own layout: one block
 * per element carrying direct text, with its computed style.
 *
 * Best-effort by contract: callers fall back to the classic text-baked
 * raster when this returns [] or throws, so a measurement miss can never
 * produce an empty-looking slide.
 */
export async function extractFrameTextBlocks(source: FrameSource): Promise<PptTextBlock[]> {
  const importUrls = [...source.css.matchAll(/@import\s+url\(['"]?([^'")]+)['"]?\)/g)]
    .map(m => sanitizeGoogleFontUrl(m[1]))
    .filter(url => url.includes("fonts.googleapis.com"));
  const [{ html, css: withImages }, fontCss] = await Promise.all([
    inlineFrameImages(source.html, source.css),
    inlineGoogleFontCss(importUrls),
  ]);
  // Same inlining as the raster path: measurement must happen with the real
  // glyphs, and an iframe document can no more reach the bucket URL than the
  // SVG <img> could.
  const css = await inlineCustomFontUrls(withImages);

  const iframe = document.createElement("iframe");
  // Off-screen but RENDERED — display:none would skip layout entirely.
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;left:-99999px;top:0;border:0;opacity:0;pointer-events:none";
  iframe.width = String(Math.ceil(source.width));
  iframe.height = String(Math.ceil(source.height));
  document.body.appendChild(iframe);

  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("No iframe document");
    doc.open();
    doc.write(
      `<!DOCTYPE html><html><head><style>${fontCss}</style>` +
      `<style>html,body{margin:0;padding:0}</style>` +
      `<style>${mapBodySelectors(css)}\n#__df_content{width:${source.width}px;height:${source.height}px;position:relative;background:${source.background};overflow:hidden}</style>` +
      `</head><body><div id="__df_content">${html}</div></body></html>`,
    );
    doc.close();

    // Same settle contract as rasterizeFrame: web fonts swap in late; give
    // them a beat so rects are measured against the final face.
    try { await iframe.contentDocument?.fonts?.ready; } catch { /* older engines */ }
    await new Promise(resolve => setTimeout(resolve, 400));

    const root = doc.getElementById("__df_content");
    const win = iframe.contentWindow;
    if (!root || !win) return [];

    // One box per VISUAL LINE, not per element-block (see PptTextBlock).
    // Characters are grouped into lines by their rect tops, each group is
    // trimmed and re-measured for its exact ink rect, and the PPT side
    // emits them with wrap:"none" so nothing is ever re-broken.
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const blocks: PptTextBlock[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const raw = node.textContent || "";
      if (!raw.trim()) continue;
      const parent = node.parentElement;
      if (!parent || /^(script|style|svg)$/i.test(parent.tagName)) continue;
      const cs = win.getComputedStyle(parent);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity || "1") === 0) continue;
      if (/rgba\([^)]*,\s*0\)/.test(cs.color)) continue; // invisible ink — the art hides it too

      const rgb = cs.color.match(/\d+(?:\.\d+)?/g)?.map(Number) || [0, 0, 0];
      const fontSize = parseFloat(cs.fontSize) || 16;
      const weight = cs.fontWeight === "bold" ? 700 : parseInt(cs.fontWeight, 10) || 400;
      const decoration = (cs as CSSStyleDeclaration & { textDecorationLine?: string }).textDecorationLine || cs.textDecoration || "";
      const fontFace = (cs.fontFamily || "").split(",")[0].replace(/["']/g, "").trim();

      interface LineGroup { top: number; from: number; to: number }
      const groups: LineGroup[] = [];
      for (let i = 0; i < raw.length; i++) {
        const r = doc.createRange();
        r.setStart(node, i); r.setEnd(node, i + 1);
        const rect = r.getBoundingClientRect();
        // A collapsed char (zero rect) is a space eaten by a wrap — glue
        // it to the current line so the split points stay word-safe.
        if (rect.width === 0 && rect.height === 0) {
          if (groups.length) groups[groups.length - 1].to = i + 1;
          continue;
        }
        const g = groups.find(gr => Math.abs(gr.top - rect.top) <= 2);
        if (g) g.to = i + 1;
        else groups.push({ top: rect.top, from: i, to: i + 1 });
      }

      for (const g of groups) {
        let from = g.from, to = g.to;
        while (from < to && /\s/.test(raw[from])) from++;
        while (to > from && /\s/.test(raw[to - 1])) to--;
        if (from >= to) continue;
        // The trimmed span's own rects are the authoritative ink rect —
        // the group bounds still include the trimmed edge spaces.
        const lr = doc.createRange();
        lr.setStart(node, from); lr.setEnd(node, to);
        const rects = Array.from(lr.getClientRects());
        if (!rects.length) continue;
        let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
        for (const r of rects) {
          x = Math.min(x, r.left); y = Math.min(y, r.top);
          right = Math.max(right, r.right); bottom = Math.max(bottom, r.bottom);
        }
        // Clamp to the frame: the live root has overflow:hidden, so
        // anything past the edges never reached the raster either.
        x = Math.max(0, x); y = Math.max(0, y);
        const w = Math.min(right, source.width) - x;
        const h = Math.min(bottom, source.height) - y;
        if (w <= 1 || h <= 1) continue;

        let value = raw.slice(from, to).replace(/\s+/g, " ").trim();
        if (cs.textTransform === "uppercase") value = value.toUpperCase();
        else if (cs.textTransform === "lowercase") value = value.toLowerCase();
        else if (cs.textTransform === "capitalize") value = value.replace(/\b\p{L}/gu, c => c.toUpperCase());
        if (!value) continue;

        blocks.push({
          text: value,
          x, y, w, h,
          fontSize,
          bold: weight >= 600,
          italic: cs.fontStyle === "italic" || cs.fontStyle === "oblique",
          underline: decoration.includes("underline"),
          color: rgb.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, "0")).join(""),
          fontFace,
        });
        if (blocks.length >= 200) break; // pathological frame — cap the box count
      }
      if (blocks.length >= 200) break;
    }
    return blocks;
  } finally {
    iframe.remove();
  }
}

/** rasterizeFrame, but the text layer is invisible — the clean "art only"
 *  background that native PPT text boxes are laid over. */
export async function rasterizeFrameWithoutText(source: FrameSource, scale = 2): Promise<HTMLCanvasElement> {
  return rasterizeFrame({ ...source, css: source.css + HIDE_TEXT_CSS }, scale);
}
