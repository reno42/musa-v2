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
  const fontCss = await inlineGoogleFontCss(importUrls);
  const svg = buildFrameSvgMarkup(source, fontCss);

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
