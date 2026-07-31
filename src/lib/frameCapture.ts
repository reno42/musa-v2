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
    .map(m => m[1])
    .filter(url => url.includes("fonts.googleapis.com"));
  const [{ html, css }, fontCss] = await Promise.all([
    inlineFrameImages(source.html, source.css),
    inlineGoogleFontCss(importUrls),
  ]);
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

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob), mimeType, quality));
}
