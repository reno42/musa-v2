/**
 * Agent Bridge — gives AI agents driving the editor "eyes" and layout lint.
 *
 * Exposed on `window.futurariaAgent` by EditorV2:
 *   listFrames()                     → frame ids, names and sizes
 *   renderFrame(frameId, scale?)     → PNG data URL of one frame (fonts embedded)
 *   inspectFrame(frameId)            → layer boxes + collision/overflow report
 *
 * renderFrame serializes the frame's shadow DOM into a self-contained
 * SVG foreignObject (Google Fonts inlined as data URIs) and rasterizes it
 * through a canvas — no server round-trip, no external requests at draw time.
 */

export interface AgentLayerBox {
  layerId: string;
  name: string;
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when the layer sticks out of the frame bounds. */
  outsideFrame: boolean;
  /** Text content is clipped by its own fixed-size box. */
  clippedText: boolean;
  /** Layer ids of TEXT layers this layer visually overlaps. */
  overlapsText: string[];
}

export interface AgentFrameReport {
  frameId: string;
  width: number;
  height: number;
  layers: AgentLayerBox[];
  issues: string[];
}

interface FrameDom {
  wrapper: Element;
  host: HTMLElement;
  shadow: ShadowRoot;
  content: HTMLElement;
  zoom: number;
}

const fontCssCache = new Map<string, string>();

function findFrameDom(frameId: string): FrameDom | null {
  const wrapper = document.querySelector(`[data-frame-id="${frameId}"]`);
  if (!wrapper) return null;
  const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content")) as HTMLElement | undefined;
  const shadow = host?.shadowRoot;
  const content = shadow?.getElementById("__df_content") as HTMLElement | null;
  if (!host || !shadow || !content) return null;
  // Derive the effective zoom from layout vs rendered size — robust even
  // when the canvas transform is scale(0) (viewport not laid out yet).
  const layoutWidth = host.offsetWidth || 1;
  const zoom = host.getBoundingClientRect().width / layoutWidth;
  return { wrapper, host, shadow, content, zoom };
}

/** Fetch a Google Fonts stylesheet and inline every font file as a data URI. */
async function inlineFontCss(importUrls: string[]): Promise<string> {
  const parts: string[] = [];
  for (const cssUrl of importUrls) {
    if (!fontCssCache.has(cssUrl)) {
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
    }
    parts.push(fontCssCache.get(cssUrl)!);
  }
  return parts.join("\n");
}

export function listAgentFrames(): Array<{ frameId: string; width: number; height: number }> {
  return [...document.querySelectorAll("[data-frame-id]")].flatMap(wrapper => {
    const frameId = wrapper.getAttribute("data-frame-id")!;
    const dom = findFrameDom(frameId);
    if (!dom) return [];
    return [{
      frameId,
      width: dom.host.offsetWidth,
      height: dom.host.offsetHeight,
    }];
  });
}

export async function renderAgentFrame(frameId: string, scale = 0.5): Promise<string> {
  const dom = findFrameDom(frameId);
  if (!dom) throw new Error(`Frame not found: ${frameId}`);

  const rawCss = dom.shadow.querySelector("style")?.textContent || "";
  const importUrls = [...rawCss.matchAll(/@import\s+url\(['"]?([^'")]+)['"]?\)/g)].map(m => m[1]);
  const fontCss = await inlineFontCss(importUrls);
  const css = rawCss
    .replace(/@import\s+url\([^)]*\)[^;]*;/g, "")
    .replace(/&(?!(amp|lt|gt|quot|apos|#)\w*;)/g, "&amp;");

  // Layout size is transform-independent — renderFrame works even when the
  // on-screen canvas is zoomed out to (near) zero.
  const width = dom.host.offsetWidth;
  const height = dom.host.offsetHeight;
  const background = (dom.host.firstElementChild as HTMLElement | null)?.style.background || "#ffffff";
  const xhtml = new XMLSerializer().serializeToString(dom.content);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<foreignObject width="100%" height="100%">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${width}px;height:${height}px;position:relative;background:${background};overflow:hidden">`
    + `<style>${fontCss}\n${css}</style>${xhtml}</div></foreignObject></svg>`;

  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const parseError = parsed.querySelector("parsererror");
  if (parseError) throw new Error(`Frame markup is not XML-serializable: ${parseError.textContent?.slice(0, 200)}`);

  const image = new Image();
  image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Frame snapshot failed to load"));
  });
  // Fonts decode asynchronously inside the SVG image; give them a beat.
  await new Promise(resolve => setTimeout(resolve, 350));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export function inspectAgentFrame(frameId: string): AgentFrameReport {
  const dom = findFrameDom(frameId);
  if (!dom) throw new Error(`Frame not found: ${frameId}`);
  if (dom.zoom < 0.01) {
    throw new Error("Canvas zoom is ~0 — zoom in (or re-run auto-fit) before inspecting; on-screen boxes are unmeasurable at scale(0)");
  }

  const frameWidth = dom.host.offsetWidth;
  const frameHeight = dom.host.offsetHeight;
  const contentRect = dom.content.getBoundingClientRect();

  // SVG containers often extend past their drawn shapes (overflow: visible);
  // measure the union of their graphical children instead of the container box.
  const visualRect = (el: Element): DOMRect => {
    if (el.tagName.toLowerCase() !== "svg") return el.getBoundingClientRect();
    const shapes = [...el.querySelectorAll("path, circle, rect, line, ellipse, polygon, polyline, text")]
      .map(shape => shape.getBoundingClientRect())
      .filter(rect => rect.width > 0 || rect.height > 0);
    if (shapes.length === 0) return el.getBoundingClientRect();
    const left = Math.min(...shapes.map(rect => rect.left));
    const top = Math.min(...shapes.map(rect => rect.top));
    const right = Math.max(...shapes.map(rect => rect.right));
    const bottom = Math.max(...shapes.map(rect => rect.bottom));
    return new DOMRect(left, top, right - left, bottom - top);
  };

  const topLayers = [...dom.content.children].filter(el => el.hasAttribute("data-layer-id"));
  const boxes: AgentLayerBox[] = topLayers.map(el => {
    const rect = visualRect(el);
    const x = (rect.left - contentRect.left) / dom.zoom;
    const y = (rect.top - contentRect.top) / dom.zoom;
    const width = rect.width / dom.zoom;
    const height = rect.height / dom.zoom;
    const style = el.ownerDocument.defaultView!.getComputedStyle(el);
    const isText = (el.getAttribute("data-layer-kind") || "") === "text"
      || (el.textContent || "").trim().length > 0 && el.children.length === 0;
    const clippedText = isText && style.overflow === "hidden"
      && ((el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 1
        || (el as HTMLElement).scrollWidth > (el as HTMLElement).clientWidth + 1);
    return {
      layerId: el.getAttribute("data-layer-id")!,
      name: el.getAttribute("data-layer-name") || el.tagName.toLowerCase(),
      kind: el.getAttribute("data-layer-kind") || (isText ? "text" : el.tagName.toLowerCase()),
      x: Math.round(x), y: Math.round(y),
      width: Math.round(width), height: Math.round(height),
      outsideFrame: x < -1 || y < -1 || x + width > frameWidth + 1 || y + height > frameHeight + 1,
      clippedText,
      overlapsText: [],
    };
  });

  // Flag decorative/shape layers that sit on top of text layers.
  const textBoxes = boxes.filter(box => box.kind === "text" || /text|headline|body|title/i.test(box.name));
  for (const box of boxes) {
    if (textBoxes.includes(box)) continue;
    for (const text of textBoxes) {
      const overlapX = Math.min(box.x + box.width, text.x + text.width) - Math.max(box.x, text.x);
      const overlapY = Math.min(box.y + box.height, text.y + text.height) - Math.max(box.y, text.y);
      if (overlapX > 8 && overlapY > 8) box.overlapsText.push(text.layerId);
    }
  }

  const issues: string[] = [];
  for (const box of boxes) {
    if (box.outsideFrame) issues.push(`Layer "${box.name}" (${box.layerId}) extends outside the ${Math.round(frameWidth)}x${Math.round(frameHeight)} frame.`);
    if (box.clippedText) issues.push(`Text layer "${box.name}" (${box.layerId}) is clipped by its fixed-size box.`);
    for (const textId of box.overlapsText) issues.push(`Layer "${box.name}" (${box.layerId}) overlaps text layer ${textId}.`);
  }

  return {
    frameId,
    width: Math.round(frameWidth),
    height: Math.round(frameHeight),
    layers: boxes,
    issues,
  };
}

export interface FuturariaAgentApi {
  listFrames: typeof listAgentFrames;
  renderFrame: typeof renderAgentFrame;
  inspectFrame: typeof inspectAgentFrame;
}

export function installAgentBridge(): void {
  (window as Window & { futurariaAgent?: FuturariaAgentApi }).futurariaAgent = {
    listFrames: listAgentFrames,
    renderFrame: renderAgentFrame,
    inspectFrame: inspectAgentFrame,
  };
}
