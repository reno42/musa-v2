/**
 * Design Import — converts files from external tools (SVG, PSD, AI, FIG)
 * into Futuraria frames (HTML + CSS).
 *
 * - SVG: Full client-side parsing → inline SVG in HTML frame. Vector-perfect.
 * - PSD: Uses ag-psd (dynamic import, loaded on demand) → absolutely positioned HTML layers.
 * - AI: AI files are PDF-based. Extracts embedded raster preview → image frame.
 * - FIG: Proprietary binary. No public parser exists. Returns guidance message.
 * - PNG/JPG: Imports as full-frame image.
 */

export interface ImportResult {
  html: string;
  css: string;
  width: number;
  height: number;
  name: string;
  /** Warning message to show user (e.g., "FIG not supported, use SVG export") */
  warning?: string;
}

// ── SVG Import ──────────────────────────────────────────────────

export function importSvg(svgText: string, fileName: string): ImportResult {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  const svgEl = doc.querySelector("svg");
  if (!svgEl) throw new Error("No <svg> element found in file");

  // Extract dimensions
  let width = 1080;
  let height = 1080;
  const wAttr = svgEl.getAttribute("width");
  const hAttr = svgEl.getAttribute("height");
  if (wAttr && hAttr) {
    width = parseFloat(wAttr) || width;
    height = parseFloat(hAttr) || height;
  } else {
    const vb = svgEl.getAttribute("viewBox");
    if (vb) {
      const parts = vb.split(/[\s,]+/);
      if (parts.length >= 4) {
        width = parseFloat(parts[2]) || width;
        height = parseFloat(parts[3]) || height;
      }
    }
  }

  // Clean SVG: remove scripts, external references
  svgEl.querySelectorAll("script").forEach(s => s.remove());
  svgEl.querySelectorAll("[href^='javascript:']").forEach(e => e.remove());

  // Inline the SVG as the frame HTML
  const svgString = new XMLSerializer().serializeToString(svgEl);

  const html = `<div class="svg-import-wrapper" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">${svgString}</div>`;
  const css = `.svg-import-wrapper svg { width: 100%; height: 100%; display: block; }`;

  return {
    html,
    css,
    width: Math.round(width),
    height: Math.round(height),
    name: fileName.replace(/\.svg$/i, ""),
  };
}

// ── Image Import (PNG/JPG) ──────────────────────────────────────

export async function importImage(file: File): Promise<ImportResult> {
  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImage(dataUrl);
  return {
    html: `<img src="${dataUrl}" alt="${file.name}" style="width:100%;height:100%;object-fit:contain;" />`,
    css: `img { display: block; }`,
    width: img.naturalWidth || 1080,
    height: img.naturalHeight || 1080,
    name: file.name.replace(/\.[^.]+$/, ""),
  };
}

// ── PSD Import (via ag-psd, dynamically loaded) ─────────────────

export async function importPsd(file: File): Promise<ImportResult> {
  try {
    const PsdModule: any = await import("ag-psd");
    const buffer = await file.arrayBuffer();
    const psd = PsdModule.readPsd(buffer);

    const width = psd.width || 1080;
    const height = psd.height || 1080;

    // Convert PSD layers to absolutely positioned HTML elements
    const layerHtml: string[] = [];
    const layerCss: string[] = [];
    let layerIdx = 0;

    function processLayer(layer: any, parentOffsetX = 0, parentOffsetY = 0) {
      if (!layer.visible && layer.visible !== undefined) return;
      const lx = (layer.left || 0);
      const ly = (layer.top || 0);
      const lw = (layer.right || lx) - lx;
      const lh = (layer.bottom || ly) - ly;

      // Text layer
      if (layer.text && layer.text.text) {
        const text = String(layer.text.text).replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const fontSize = layer.text.style?.fontSize?.[0]?.value || 16;
        const fontColor = layer.text.style?.fillColor?.[0] || "#000";
        const colorStr = Array.isArray(fontColor)
          ? `rgb(${Math.round(fontColor[0])},${Math.round(fontColor[1])},${Math.round(fontColor[2])})`
          : "#000";
        const className = `psd-layer-${layerIdx}`;
        layerHtml.push(`<div class="${className}">${text}</div>`);
        layerCss.push(`.${className} { position:absolute; left:${lx}px; top:${ly}px; width:${lw}px; height:${lh}px; font-size:${fontSize}px; color:${colorStr}; overflow:hidden; }`);
        layerIdx++;
      }
      // Image layer (has canvas)
      else if (layer.canvas) {
        const dataUrl = layer.canvas.toDataURL("image/png");
        const className = `psd-layer-${layerIdx}`;
        layerHtml.push(`<div class="${className}"><img src="${dataUrl}" style="width:100%;height:100%;" /></div>`);
        layerCss.push(`.${className} { position:absolute; left:${lx}px; top:${ly}px; width:${lw}px; height:${lh}px; overflow:hidden; }`);
        layerIdx++;
      }

      // Process children
      if (layer.children) {
        for (const child of layer.children) {
          processLayer(child, lx, ly);
        }
      }
    }

    if (psd.children) {
      for (const child of psd.children) {
        processLayer(child);
      }
    }

    // Fallback: if no layers were extracted, use the merged preview
    if (layerHtml.length === 0 && psd.image) {
      const dataUrl = psd.image.toDataURL("image/png");
      return {
        html: `<img src="${dataUrl}" alt="${file.name}" style="width:100%;height:100%;object-fit:contain;" />`,
        css: `img { display:block; }`,
        width,
        height,
        name: file.name.replace(/\.psd$/i, ""),
      };
    }

    return {
      html: layerHtml.join("\n"),
      css: layerCss.join("\n"),
      width,
      height,
      name: file.name.replace(/\.psd$/i, ""),
    };
  } catch (err: any) {
    throw new Error(`PSD import failed: ${err?.message || "unknown error"}`);
  }
}

// ── AI Import (Adobe Illustrator) ───────────────────────────────

export async function importAi(file: File): Promise<ImportResult> {
  // AI files are PDF-based binary files. They contain embedded raster previews.
  // Strategy: Try to extract the embedded image. If that fails, read as ArrayBuffer
  // and look for embedded PNG/JPEG signatures.
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());

    // Search for PNG signature: 89 50 4E 47
    const pngSig = [0x89, 0x50, 0x4e, 0x47];
    // Search for JPEG signature: FF D8 FF
    const jpegSig = [0xff, 0xd8, 0xff];

    // Find the largest embedded image (usually the preview)
    let bestStart = -1;
    let bestEnd = -1;
    let bestSig: "png" | "jpeg" | null = null;

    // Look for JPEG (more common in AI previews)
    for (let i = 0; i < buffer.length - 3; i++) {
      if (buffer[i] === jpegSig[0] && buffer[i + 1] === jpegSig[1] && buffer[i + 2] === jpegSig[2]) {
        // Find JPEG end marker (FF D9)
        for (let j = i + 3; j < buffer.length - 1; j++) {
          if (buffer[j] === 0xff && buffer[j + 1] === 0xd9) {
            const size = j - i;
            if (size > (bestEnd - bestStart)) {
              bestStart = i;
              bestEnd = j + 2;
              bestSig = "jpeg";
            }
            break;
          }
        }
      }
    }

    // Look for PNG
    if (bestStart === -1) {
      for (let i = 0; i < buffer.length - 4; i++) {
        if (buffer[i] === pngSig[0] && buffer[i + 1] === pngSig[1] &&
            buffer[i + 2] === pngSig[2] && buffer[i + 3] === pngSig[3]) {
          // PNG ends with IEND chunk: 00 00 00 00 49 45 4E 44 AE 42 60 82
          const iendSig = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
          for (let j = i + 4; j < buffer.length - 8; j++) {
            if (buffer[j] === iendSig[0] && buffer[j + 1] === iendSig[1] &&
                buffer[j + 2] === iendSig[2] && buffer[j + 3] === iendSig[3]) {
              const size = j - i;
              if (size > (bestEnd - bestStart)) {
                bestStart = i;
                bestEnd = j + 8;
                bestSig = "png";
              }
              break;
            }
          }
        }
      }
    }

    if (bestStart >= 0 && bestSig) {
      const imageBytes = buffer.slice(bestStart, bestEnd);
      const blob = new Blob([imageBytes], { type: `image/${bestSig}` });
      const dataUrl = await blobToDataURL(blob);
      const img = await loadImage(dataUrl);
      return {
        html: `<img src="${dataUrl}" alt="${file.name}" style="width:100%;height:100%;object-fit:contain;" />`,
        css: `img { display:block; }`,
        width: img.naturalWidth || 1080,
        height: img.naturalHeight || 1080,
        name: file.name.replace(/\.ai$/i, ""),
        warning: "Imported as raster preview from .ai file. For vector fidelity, export as SVG from Illustrator first.",
      };
    }

    throw new Error("Could not extract preview image from .ai file. Please export as SVG from Illustrator.");
  } catch (err: any) {
    throw new Error(`AI import failed: ${err?.message || "unknown error"}`);
  }
}

// ── FIG Import (Figma) ──────────────────────────────────────────

export function importFigGuidance(fileName: string): ImportResult {
  // Figma .fig files are proprietary binary with no public parser.
  // We provide guidance instead.
  return {
    html: "",
    css: "",
    width: 0,
    height: 0,
    name: fileName.replace(/\.fig$/i, ""),
    warning: "Figma .fig files use a proprietary binary format that cannot be parsed directly. " +
      "To import from Figma: (1) Select your design in Figma, (2) Right-click → Export as SVG, " +
      "(3) Import the SVG file here. Alternatively, paste a Figma URL if you have the Figma MCP configured.",
  };
}

// ── Main entry point ────────────────────────────────────────────

export async function importDesignFile(file: File): Promise<ImportResult> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "svg":
      return importSvg(await file.text(), file.name);
    case "png":
    case "jpg":
    case "jpeg":
    case "webp":
      return importImage(file);
    case "psd":
      return importPsd(file);
    case "ai":
      return importAi(file);
    case "fig":
      return importFigGuidance(file.name);
    default:
      throw new Error(`Unsupported format: .${ext}. Supported: SVG, PSD, AI, FIG, PNG, JPG`);
  }
}

// ── Helpers ─────────────────────────────────────────────────────

function readFileAsDataURL(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export const SUPPORTED_IMPORT_FORMATS = ".svg,.psd,.ai,.fig,.png,.jpg,.jpeg,.webp";
export const SUPPORTED_IMPORT_LABELS = ["SVG", "PSD (Photoshop)", "AI (Illustrator)", "FIG (Figma)", "PNG", "JPG", "WEBP"];
