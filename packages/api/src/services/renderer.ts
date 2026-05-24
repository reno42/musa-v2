// packages/api/src/services/renderer.ts
// Complete renderer with SVG export, storage upload, path/line/group support

import puppeteer, { Browser } from "puppeteer";
import type { DesignTemplate, RenderRequest, RenderResponse } from "@futuraria/shared";
import { getTemplate } from "./templates";
import { fireWebhooks } from "./webhooks";
import { getSupabase } from "./supabase";
import { v4 as uuid } from "uuid";

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return browser;
}

/** Close the Puppeteer browser instance (call on graceful shutdown). */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Build CSS for a layer ──
function layerBaseStyle(layer: any): string {
  return [
    `position:absolute`,
    `left:${layer.x}px`,
    `top:${layer.y}px`,
    `width:${layer.width}px`,
    `height:${layer.height}px`,
    `opacity:${layer.opacity ?? 1}`,
    `transform:rotate(${layer.rotation || 0}deg)`,
    `z-index:${layer.zIndex ?? 0}`,
  ].join("; ");
}

// ── Build HTML for a single layer ──
function renderLayerHTML(layer: any): string {
  if (layer.visible === false) return "";

  const base = layerBaseStyle(layer);

  switch (layer.type) {
    case "rect":
      return `<div style="${base}; background:${layer.fill || "#000"}; border:${layer.strokeWidth || 0}px solid ${layer.stroke || "transparent"}; border-radius:${layer.cornerRadius || 0}px;"></div>`;

    case "ellipse":
      return `<div style="${base}; background:${layer.fill || "#000"}; border-radius:50%; border:${layer.strokeWidth || 0}px solid ${layer.stroke || "transparent"};"></div>`;

    case "text":
    case "textbox": {
      const text = layer.text || "";
      return `<div style="${base}; font-family:${layer.fontFamily || "sans-serif"}; font-size:${layer.fontSize || 16}px; font-weight:${layer.fontWeight || "normal"}; color:${layer.fill || "#000"}; text-align:${layer.align || "left"}; line-height:${layer.lineHeight || 1.2}; display:flex; align-items:center; word-break:break-word;">${escapeHtml(text)}</div>`;
    }

    case "image": {
      const filters = layer.filters
        ? `filter:${[
            layer.filters.brightness != null ? `brightness(${1 + layer.filters.brightness})` : "",
            layer.filters.contrast != null ? `contrast(${1 + layer.filters.contrast})` : "",
            layer.filters.saturation != null ? `saturate(${1 + layer.filters.saturation})` : "",
            layer.filters.blur != null ? `blur(${layer.filters.blur}px)` : "",
            layer.filters.grayscale ? "grayscale(1)" : "",
            layer.filters.sepia ? "sepia(1)" : "",
          ]
            .filter(Boolean)
            .join(" ")};`
          : "";
      return `<img src="${layer.src}" style="${base}; object-fit:${layer.fit || "cover"}; ${filters}" />`;
    }

    case "group": {
      const children = (layer.children || [])
        .map((child: any) => {
          // Children positions are relative to group
          child = { ...child, x: (child.x || 0) + layer.x, y: (child.y || 0) + layer.y };
          return renderLayerHTML(child);
        })
        .join("\n");
      return `<div style="${base}; overflow:hidden;">${children}</div>`;
    }

    case "path": {
      // Render path as inline SVG
      const fill = layer.fill || "none";
      const stroke = layer.stroke || "none";
      const strokeWidth = layer.strokeWidth || 1;
      return `<svg style="${base}" viewBox="0 0 ${layer.width} ${layer.height}" xmlns="http://www.w3.org/2000/svg"><path d="${layer.d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" fill-rule="${layer.fillRule || "nonzero"}" /></svg>`;
    }

    case "line": {
      // Render line as inline SVG
      const stroke = layer.stroke || "#000";
      const strokeWidth = layer.strokeWidth || 1;
      const x1 = 0;
      const y1 = 0;
      const lx2 = (layer.x2 ?? layer.width) - layer.x;
      const ly2 = (layer.y2 ?? layer.height) - layer.y;
      return `<svg style="${base}" viewBox="0 0 ${layer.width} ${layer.height}" xmlns="http://www.w3.org/2000/svg"><line x1="${x1}" y1="${y1}" x2="${lx2}" y2="${ly2}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="${layer.strokeLinecap || "round"}" /></svg>`;
    }

    default:
      return "";
  }
}

// ── Canvas-objects → Layer[] fallback ──
// Editor-saved templates store layers in canvas.objects, not tpl.layers.
// This helper walks canvas.objects recursively to build a flat layer list.
function canvasObjectsToLayers(canvas: any): any[] {
  const result: any[] = [];
  const walk = (objs: any[], parentX = 0, parentY = 0) => {
    for (const o of objs) {
      const layer = {
        ...o,
        x: (o.left ?? 0) + parentX,
        y: (o.top ?? 0) + parentY,
        width: (o.width ?? 0) * ((o.scaleX as number) ?? 1),
        height: (o.height ?? 0) * ((o.scaleY as number) ?? 1),
        rotation: o.angle ?? 0,
        opacity: o.opacity ?? 1,
        visible: o.visible !== false,
        zIndex: 0,
        // Map Fabric.js properties to renderer layer names
        fill: o.fill,
        stroke: o.stroke,
        strokeWidth: o.strokeWidth,
        cornerRadius: (o as any).rx,
        fontFamily: o.fontFamily,
        fontSize: o.fontSize,
        fontWeight: o.fontWeight,
        text: o.text,
        align: o.textAlign,
        lineHeight: o.lineHeight,
        src: (o as any).src,
        d: (o as any).path ? (typeof (o as any).path === "string" ? (o as any).path : (o as any).path?.join?.(" ") || "") : "",
        fillRule: (o as any).fillRule,
        strokeLinecap: (o as any).strokeLineCap,
        x2: (o as any).x2,
        y2: (o as any).y2,
        children: [],
      };
      if (o.objects && Array.isArray(o.objects)) {
        (layer as any).children = canvasObjectsToLayers({ objects: o.objects });
      }
      result.push(layer);
    }
  };
  if (canvas?.objects && Array.isArray(canvas.objects)) {
    walk(canvas.objects);
  }
  return result;
}

function getEffectiveLayers(template: DesignTemplate): any[] {
  if (template.layers && template.layers.length > 0) return template.layers;
  return canvasObjectsToLayers(template.canvas);
}

// ── Build full HTML for Puppeteer rendering ──
function buildRenderHTML(template: DesignTemplate, scale: number): string {
  const { canvas } = template;
  const layers = getEffectiveLayers(template);

  // Sort by zIndex (populate from array index if missing)
  const sorted = layers
    .map((l, i) => ({ ...l, zIndex: (l as any).zIndex ?? i }))
    .sort((a, b) => a.zIndex - b.zIndex);

  const layerElements = sorted.map(renderLayerHTML).join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: ${canvas.width * scale}px; height: ${canvas.height * scale}px; background: ${canvas.background}; overflow: hidden; }
    .canvas { position: relative; width: ${canvas.width}px; height: ${canvas.height}px; transform: scale(${scale}); transform-origin: 0 0; }
    svg { overflow: visible; }
  </style>
</head>
<body>
  <div class="canvas">
    ${layerElements}
  </div>
</body>
</html>`;
}

// ── Direct SVG generation (no Puppeteer) ──
function buildSVG(template: DesignTemplate): string {
  const { canvas } = template;
  const layers = getEffectiveLayers(template);

  const sorted = layers
    .map((l, i) => ({ ...l, zIndex: (l as any).zIndex ?? i }))
    .sort((a, b) => a.zIndex - b.zIndex);

  const defs: string[] = [];
  const elements: string[] = [];

  for (const layer of sorted) {
    if ((layer as any).visible === false) continue;

    const transform = `translate(${layer.x}, ${layer.y})${layer.rotation ? ` rotate(${layer.rotation}, ${layer.width / 2}, ${layer.height / 2})` : ""}`;
    const opacity = layer.opacity != null && layer.opacity !== 1 ? ` opacity="${layer.opacity}"` : "";

    switch (layer.type) {
      case "rect": {
        const fill = (layer as any).fill || "#000";
        const stroke = (layer as any).stroke || "none";
        const sw = (layer as any).strokeWidth || 0;
        const rx = (layer as any).cornerRadius || 0;
        elements.push(`<rect x="0" y="0" width="${layer.width}" height="${layer.height}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" rx="${rx}" transform="${transform}"${opacity} />`);
        break;
      }

      case "ellipse": {
        const fill = (layer as any).fill || "#000";
        const stroke = (layer as any).stroke || "none";
        const sw = (layer as any).strokeWidth || 0;
        const cx = layer.width / 2;
        const cy = layer.height / 2;
        elements.push(`<ellipse cx="${cx}" cy="${cy}" rx="${cx}" ry="${cy}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" transform="${transform}"${opacity} />`);
        break;
      }

      case "text":
      case "textbox": {
        const text = (layer as any).text || "";
        const fill = (layer as any).fill || "#000";
        const fontSize = (layer as any).fontSize || 16;
        const fontFamily = (layer as any).fontFamily || "sans-serif";
        const fontWeight = (layer as any).fontWeight || "normal";
        const align = (layer as any).align || "left";
        const anchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
        const xPos = align === "center" ? layer.width / 2 : align === "right" ? layer.width : 0;

        // Split text into lines for multi-line support
        const lines = escapeHtml(text).split("\n");
        const lineHeight = ((layer as any).lineHeight || 1.2) * fontSize;
        const tspans = lines
          .map((line, i) => `<tspan x="${xPos}" dy="${i === 0 ? 0 : lineHeight}">${line}</tspan>`)
          .join("");

        elements.push(
          `<g transform="${transform}"${opacity}><text font-family="${fontFamily}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="hanging">${tspans}</text></g>`
        );
        break;
      }

      case "image": {
        const fit = (layer as any).fit || "cover";
        let preserveAspect = "xMidYMid slice";
        if (fit === "contain") preserveAspect = "xMidYMid meet";
        else if (fit === "fill") preserveAspect = "none";
        else if (fit === "none") preserveAspect = "none";

        elements.push(
          `<image href="${(layer as any).src}" x="0" y="0" width="${layer.width}" height="${layer.height}" preserveAspectRatio="${preserveAspect}" transform="${transform}"${opacity} />`
        );
        break;
      }

      case "path": {
        const fill = (layer as any).fill || "none";
        const stroke = (layer as any).stroke || "none";
        const sw = (layer as any).strokeWidth || 1;
        const fillRule = (layer as any).fillRule || "nonzero";
        elements.push(
          `<path d="${(layer as any).d}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" fill-rule="${fillRule}" transform="${transform}"${opacity} />`
        );
        break;
      }

      case "line": {
        const stroke = (layer as any).stroke || "#000";
        const sw = (layer as any).strokeWidth || 1;
        const cap = (layer as any).strokeLinecap || "round";
        const lx2 = ((layer as any).x2 ?? layer.width) - layer.x;
        const ly2 = ((layer as any).y2 ?? layer.height) - layer.y;
        elements.push(
          `<line x1="0" y1="0" x2="${lx2}" y2="${ly2}" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="${cap}" transform="${transform}"${opacity} />`
        );
        break;
      }

      case "group": {
        const children = ((layer as any).children || [])
          .filter((c: any) => c.visible !== false)
          .map((child: any) => {
            const cx = child.x || 0;
            const cy = child.y || 0;
            const ct = `translate(${cx}, ${cy})${child.rotation ? ` rotate(${child.rotation}, ${(child.width || 0) / 2}, ${(child.height || 0) / 2})` : ""}`;
            const co = child.opacity != null && child.opacity !== 1 ? ` opacity="${child.opacity}"` : "";
            switch (child.type) {
              case "rect":
                return `<rect x="0" y="0" width="${child.width}" height="${child.height}" fill="${child.fill || "#000"}" stroke="${child.stroke || "none"}" stroke-width="${child.strokeWidth || 0}" rx="${child.cornerRadius || 0}" transform="${ct}"${co} />`;
              case "ellipse":
                return `<ellipse cx="${(child.width || 0) / 2}" cy="${(child.height || 0) / 2}" rx="${(child.width || 0) / 2}" ry="${(child.height || 0) / 2}" fill="${child.fill || "#000"}" stroke="${child.stroke || "none"}" stroke-width="${child.strokeWidth || 0}" transform="${ct}"${co} />`;
              case "text":
              case "textbox":
                return `<text x="0" y="0" font-family="${child.fontFamily || "sans-serif"}" font-size="${child.fontSize || 16}" fill="${child.fill || "#000"}" transform="${ct}"${co}>${escapeHtml(child.text || "")}</text>`;
              case "path":
                return `<path d="${child.d}" fill="${child.fill || "none"}" stroke="${child.stroke || "none"}" stroke-width="${child.strokeWidth || 1}" transform="${ct}"${co} />`;
              case "line":
                return `<line x1="0" y1="0" x2="${(child.x2 ?? child.width) - cx}" y2="${(child.y2 ?? child.height) - cy}" stroke="${child.stroke || "#000"}" stroke-width="${child.strokeWidth || 1}" transform="${ct}"${co} />`;
              default:
                return "";
            }
          })
          .filter(Boolean)
          .join("\n    ");
        elements.push(`<g transform="${transform}"${opacity}>\n    ${children}\n  </g>`);
        break;
      }
    }
  }

  const defsBlock = defs.length ? `\n  <defs>\n    ${defs.join("\n    ")}\n  </defs>` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">${defsBlock}
  <rect width="100%" height="100%" fill="${canvas.background}" />
  ${elements.join("\n  ")}
</svg>`;
}

// ── Upload to Supabase Storage ──
async function uploadToStorage(
  buffer: Buffer,
  renderId: string,
  mimeType: string
): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const ext = mimeType.includes("svg") ? "svg" : mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
  const path = `renders/${renderId}.${ext}`;

  try {
    const { error } = await supabase.storage
      .from("design-exports")
      .upload(path, buffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (error) {
      console.error("[STORAGE] Upload failed:", error.message);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from("design-exports")
      .getPublicUrl(path);

    return urlData?.publicUrl || null;
  } catch (err: any) {
    console.error("[STORAGE] Upload error:", err.message);
    return null;
  }
}

// ── Cleanup old renders (call periodically) ──
export async function cleanupOldRenders(olderThanHours = 24): Promise<number> {
  const supabase = getSupabase();
  if (!supabase) return 0;

  const cutoff = new Date(Date.now() - olderThanHours * 3600 * 1000).toISOString();

  const { data: oldRenders } = await supabase
    .from("render_logs")
    .select("id, url")
    .eq("status", "completed")
    .lt("created_at", cutoff);

  if (!oldRenders?.length) return 0;

  let cleaned = 0;
  for (const render of oldRenders) {
    if (render.url?.includes("renders/")) {
      const match = render.url.match(/renders\/[^?]+/);
      if (match) {
        await supabase.storage.from("design-exports").remove([match[0]]);
      }
    }
    await supabase.from("render_logs").delete().eq("id", render.id);
    cleaned++;
  }

  return cleaned;
}

// ── Main render function ──
export async function renderTemplate(
  templateId: string,
  request: RenderRequest
): Promise<RenderResponse> {
  const renderId = `rnd_${uuid().slice(0, 8)}`;
  const now = new Date().toISOString();

  // Get template
  const template = await getTemplate(templateId);
  if (!template) {
    return {
      id: renderId,
      status: "failed",
      templateId,
      format: request.format || "png",
      error: "Template not found",
      createdAt: now,
      completedAt: now,
    };
  }

  // Create render log entry
  const supabase = getSupabase();
  if (supabase) {
    await supabase.from("render_logs").insert({
      id: renderId,
      template_id: templateId,
      status: "processing",
      format: request.format,
    });
  }

  try {
    // ── SVG: Generate directly, no Puppeteer ──
    if (request.format === "svg") {
      const svg = buildSVG(template);
      const buffer = Buffer.from(svg, "utf-8");
      const mimeType = "image/svg+xml";

      let url: string | undefined;

      const storageUrl = await uploadToStorage(buffer, renderId, mimeType);
      if (storageUrl) {
        url = storageUrl;
      } else {
        url = `data:${mimeType};base64,${buffer.toString("base64")}`;
      }

      const result: RenderResponse = {
        id: renderId,
        status: "completed",
        templateId,
        format: "svg",
        width: template.canvas.width,
        height: template.canvas.height,
        url,
        createdAt: now,
        completedAt: new Date().toISOString(),
      };

      if (supabase) {
        await supabase
          .from("render_logs")
          .update({ status: "completed", url, completed_at: result.completedAt })
          .eq("id", renderId);
      }

      fireWebhooks("render.complete", result).catch(() => {});
      return result;
    }

    // ── PNG/JPG: Use Puppeteer ──
    const scale = request.scale || 1;
    const html = buildRenderHTML(template, scale);
    const b = await getBrowser();
    const page = await b.newPage();

    await page.setViewport({
      width: template.canvas.width * scale,
      height: template.canvas.height * scale,
      deviceScaleFactor: 1,
    });

    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });

    const isJpeg = request.format === "jpg";
    const screenshotOpts: any = {
      type: isJpeg ? "jpeg" : "png",
      fullPage: false,
      clip: {
        x: 0,
        y: 0,
        width: template.canvas.width * scale,
        height: template.canvas.height * scale,
      },
    };

    if (isJpeg && request.quality) {
      screenshotOpts.quality = request.quality;
    }

    const buffer = await page.screenshot(screenshotOpts) as unknown as Buffer;
    await page.close();

    const mimeType = isJpeg ? "image/jpeg" : "image/png";

    let url: string | undefined;
    const storageUrl = await uploadToStorage(buffer, renderId, mimeType);
    if (storageUrl) {
      url = storageUrl;
    } else {
      const base64 = Buffer.from(buffer).toString("base64");
      url = `data:${mimeType};base64,${base64}`;
    }

    const result: RenderResponse = {
      id: renderId,
      status: "completed",
      templateId,
      format: request.format || "png",
      width: template.canvas.width * scale,
      height: template.canvas.height * scale,
      url,
      createdAt: now,
      completedAt: new Date().toISOString(),
    };

    if (supabase) {
      await supabase
        .from("render_logs")
        .update({ status: "completed", url, completed_at: result.completedAt })
        .eq("id", renderId);
    }

    fireWebhooks("render.complete", result).catch((err) =>
      console.error("[WEBHOOK] Failed:", err.message)
    );

    if (request.webhookUrl) {
      try {
        await fetch(request.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event: "render.complete",
            payload: result,
            timestamp: new Date().toISOString(),
          }),
          signal: AbortSignal.timeout(10000),
        });
      } catch (err: any) {
        console.error("[WEBHOOK] Direct webhook failed:", err.message);
      }
    }

    return result;
  } catch (err: any) {
    const errorResult: RenderResponse = {
      id: renderId,
      status: "failed",
      templateId,
      format: request.format || "png",
      error: err.message,
      createdAt: now,
      completedAt: new Date().toISOString(),
    };

    if (supabase) {
      await supabase
        .from("render_logs")
        .update({ status: "failed", error: err.message, completed_at: errorResult.completedAt })
        .eq("id", renderId);
    }

    fireWebhooks("render.failed", errorResult).catch(() => {});
    return errorResult;
  }
}
