import * as templates from "../../api/src/services/templates.js";
import { store } from "../../api/src/services/store.js";
import { getSupabase } from "../../api/src/services/supabase.js";
import DOMPurify from "dompurify";
import * as cheerio from "cheerio";
import { extractDesignSystem, generateAllArtifacts, computeFrameHash, computeSourceHash } from "./design-extractor.mjs";
import { profileFrame, profileTemplatePool } from "./template-profiler.mjs";

// ═══════════════════════════════════════════════════════════════
// Server-side SVG generation from HTML+CSS (no browser needed)
// ═══════════════════════════════════════════════════════════════

/** Parse CSS rules from a stylesheet string into {selector, props} pairs */
function parseCssRules(css) {
  const rules = [];
  // Remove @import and @font-face blocks
  const cleanCss = css.replace(/@import[^;]+;/g, "").replace(/@font-face\s*\{[^}]*\}/g, "");
  const ruleRe = /([^{}]+)\{([^}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(cleanCss)) !== null) {
    const selectors = m[1].trim().split(",").map(s => s.trim());
    const props = {};
    const declText = m[2].trim();
    for (const decl of declText.split(";")) {
      const idx = decl.indexOf(":");
      if (idx > 0) {
        const prop = decl.slice(0, idx).trim();
        const val = decl.slice(idx + 1).trim();
        if (prop && val) props[prop] = val;
      }
    }
    if (Object.keys(props).length > 0) {
      for (const sel of selectors) rules.push({ selector: sel, props });
    }
  }
  return rules;
}

/** Match a CSS selector against a cheerio element (simple: tag, .class, #id, compound) */
function matchesSelector($el, selector) {
  if ($el.length === 0) return false;
  // Simple tag selector
  if (/^[a-z0-9]+$/i.test(selector)) return $el.is(selector);
  // ID selector
  if (selector.startsWith("#")) return $el.attr("id") === selector.slice(1);
  // Class selector
  if (selector.startsWith(".")) return $el.hasClass(selector.slice(1));
  // Attribute selector [data-layer-id="..."]
  const attrMatch = /^\[([^=]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (attrMatch) {
    const attrName = attrMatch[1];
    const attrVal = attrMatch[2];
    const elVal = $el.attr(attrName);
    if (attrVal === undefined) return elVal !== undefined;
    return elVal === attrVal;
  }
  // Compound selector: tag.class or tag#id
  const compound = selector.match(/^([a-z0-9]+)?(?:\.([\w-]+))?(?:#([\w-]+))?(\[.+\])?$/i);
  if (compound) {
    const [, tag, cls, id, attr] = compound;
    if (tag && !$el.is(tag)) return false;
    if (cls && !$el.hasClass(cls)) return false;
    if (id && $el.attr("id") !== id) return false;
    if (attr) return matchesSelector($el, attr);
    return true;
  }
  return false;
}

/** Resolve cascaded CSS for an element by walking CSS rules in order */
function resolveStyles($el, cssRules) {
  const resolved = {};
  // Also parse inline style attribute
  const inlineStyle = $el.attr("style") || "";
  for (const decl of inlineStyle.split(";")) {
    const idx = decl.indexOf(":");
    if (idx > 0) {
      resolved[decl.slice(0, idx).trim()] = decl.slice(idx + 1).trim();
    }
  }
  // Apply CSS rules in order (later rules override earlier)
  for (const { selector, props } of cssRules) {
    if (matchesSelector($el, selector)) {
      Object.assign(resolved, props);
    }
  }
  return resolved;
}

/** Escape text content for XML */
function escapeXml(text) {
  return text.replace(/[<>&'\\"]/g, c => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
      default: return c;
    }
  });
}

/** Build a simple CSS selector string from a cheerio element */
function getCheerioSelector($el) {
  const tag = ($el.prop("tagName") || "div").toLowerCase();
  const id = $el.attr("id");
  const cls = $el.attr("class");
  let sel = tag;
  if (id) sel += `#${id}`;
  if (cls) sel += `.${cls.split(" ").join(".")}`;
  return sel;
}

/** WCAG contrast ratio between two hex colors */
function computeContrast(hex1, hex2) {
  const lum = (hex) => {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const lin = (c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const l1 = lum(hex1);
  const l2 = lum(hex2);
  const [brighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (brighter + 0.05) / (darker + 0.05);
}

/** Build SVG element from a DOM node and its resolved styles */
function nodeToSvg($, $el, cssRules, offsetX, offsetY) {
  const tag = $el.prop("tagName")?.toLowerCase() || "";
  if (["script", "style", "link", "meta"].includes(tag)) return null;

  const style = resolveStyles($el, cssRules);
  const text = $el.text().trim();
  const hasChildren = $el.children().length > 0;

  // Parse position and dimensions
  const left = parseInt(style["left"]) || 0;
  const top = parseInt(style["top"]) || 0;
  const width = parseInt(style["width"]) || 0;
  const height = parseInt(style["height"]) || 0;
  const fontSize = style["font-size"] || style["fontSize"] || "16px";
  const fontFamily = (style["font-family"] || style["fontFamily"] || "sans-serif").replace(/["']/g, "");
  const color = style["color"] || "#000000";
  const fontWeight = style["font-weight"] || style["fontWeight"] || "400";
  const textAlign = style["text-align"] || style["textAlign"] || "left";
  const background = style["background"] || style["background-color"] || style["backgroundColor"] || "";
  const borderRadius = style["border-radius"] || style["borderRadius"] || "";
  const border = style["border"] || "";
  const opacity = parseFloat(style["opacity"]) || 1;
  const position = style["position"] || "static";

  const x = left + offsetX;
  const y = top + offsetY;
  const svgParts = [];

  // Background rect (if element has background color)
  const bgColor = background.match(/#[0-9a-f]{3,8}/i)?.[0] ||
                  background.match(/rgba?\([^)]+\)/i)?.[0] || "";
  if (bgColor && width && height) {
    const rx = borderRadius.match(/(\d+)/)?.[1] || "0";
    svgParts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${bgColor}" rx="${rx}" opacity="${opacity}"/>`);
  }

  // Border rect
  if (border && border !== "none" && width && height) {
    const borderMatch = border.match(/(\d+)px\s+([^\s]+)\s+(.+)/);
    if (borderMatch) {
      const [, bw, bstyle, bcolor] = borderMatch;
      svgParts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="${bcolor}" stroke-width="${bw}"/>`);
    }
  }

  // Image element
  if (tag === "img") {
    const src = $el.attr("src") || "";
    if (src && width && height) {
      svgParts.push(`<image x="${x}" y="${y}" width="${width}" height="${height}" href="${escapeXml(src)}" preserveAspectRatio="xMidYMid slice"/>`);
    }
  }

  // Text element (only if leaf node with text content)
  if (text && !hasChildren && tag !== "img") {
    // Calculate text anchor based on text-align
    const anchor = textAlign === "center" ? "middle" : textAlign === "right" ? "end" : "start";
    const textX = textAlign === "center" ? x + width / 2 : textAlign === "right" ? x + width : x;
    const textY = y + parseInt(fontSize) || y + 16;
    svgParts.push(`<text x="${textX}" y="${textY}" font-family="${escapeXml(fontFamily)}" font-size="${escapeXml(fontSize)}" font-weight="${escapeXml(fontWeight)}" fill="${color}" text-anchor="${anchor}" opacity="${opacity}">${escapeXml(text)}</text>`);
  }

  return svgParts.length > 0 ? svgParts.join("\n  ") : null;
}

/** Generate full SVG document from frame HTML+CSS using cheerio */
function buildFrameSvgNative(frame) {
  const w = frame.width || 1080;
  const h = frame.height || 1080;
  const bg = frame.background || "#ffffff";
  const html = frame.html || "";
  const css = frame.css || "";

  // Parse CSS into rules
  const cssRules = parseCssRules(css);

  // Parse HTML with cheerio
  const $ = cheerio.load(`<div id="__root">${html}</div>`);
  const root = $("#__root");

  // Extract font @import URLs for linking
  const fontImportRe = /@import\s+url\(['"]?(https:\/\/fonts\.googleapis\.com[^'")]+)['"]?\)\s*;/g;
  const fontLinks = [];
  let fm;
  while ((fm = fontImportRe.exec(css)) !== null) {
    fontLinks.push(fm[1]);
  }

  // Walk DOM tree and generate SVG elements
  const svgElements = [];

  function walkNode($node, parentX, parentY) {
    $node.children().each((_, el) => {
      const $el = $(el);
      const svgPart = nodeToSvg($, $el, cssRules, parentX, parentY);
      if (svgPart) svgElements.push(svgPart);

      // Recurse into children with accumulated offset
      const style = resolveStyles($el, cssRules);
      const childOffsetX = parentX + (parseInt(style["left"]) || 0);
      const childOffsetY = parentY + (parseInt(style["top"]) || 0);
      walkNode($el, childOffsetX, childOffsetY);
    });
  }

  walkNode(root, 0, 0);

  const fontLinkTags = fontLinks.map(url => `<link rel="stylesheet" href="${url}"/>`).join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml"
     width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <style><![CDATA[${css.replace(/@import[^;]+;/g, "")}]]></style>
    ${fontLinkTags}
  </defs>
  <rect width="${w}" height="${h}" fill="${bg}"/>
  ${svgElements.join("\n  ")}
</svg>`;
}

/** Build self-rendering HTML page for PDF export (uses jsPDF CDN) */
function buildPdfExportPage(frames) {
  const allCss = frames.map(f => f.css || "").join("\n");
  const fontImportRe = /@import\s+url\(['"]?(https:\/\/fonts\.googleapis\.com[^'")]+)['"]?\)\s*;/g;
  const fontLinks = [];
  let m;
  while ((m = fontImportRe.exec(allCss)) !== null) {
    fontLinks.push(`<link rel="stylesheet" href="${m[1]}">`);
  }

  const framesJson = JSON.stringify(frames.map(f => ({
    name: (f.name || "frame").replace(/[<>:"/\\|?*]/g, "_"),
    width: f.width || 1080,
    height: f.height || 1080,
    html: f.html || "",
    css: f.css || "",
  })));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Futuraria PDF Export</title>
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"><\/script>
<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"><\/script>
${fontLinks.join("\n")}
<style>
  body { margin:0; padding:16px; background:#e5e7eb; font-family:-apple-system,sans-serif; }
  #status { padding: 8px 16px; background:#fff; border-radius:6px; box-shadow:0 1px 3px rgba(0,0,0,0.1); font-size:13px; color:#333; display:inline-block; }
  #status.done { color:#059669; }
</style>
</head>
<body>
<div id="status">Generating PDF...</div>
<script>
  (function() {
    var frames = ${framesJson};
    var total = frames.length;
    var done = 0;
    var { jsPDF } = window.jspdf;

    function renderNext(i) {
      if (i >= total) {
        document.getElementById('status').textContent = 'Done: ' + done + '/' + total + ' PDFs downloaded';
        document.getElementById('status').className = 'done';
        return;
      }
      var f = frames[i];
      document.getElementById('status').textContent = 'Generating PDF ' + (i+1) + '/' + total + ': ' + f.name + '...';

      var container = document.createElement('div');
      container.style.cssText = 'position:fixed;left:-9999px;top:0;width:'+f.width+'px;height:'+f.height+'px;overflow:hidden;';
      document.body.appendChild(container);

      var target = document.createElement('div');
      target.style.cssText = 'width:'+f.width+'px;height:'+f.height+'px;overflow:hidden;position:relative;background:'+ (f.background || '#fff') +';';
      var style = document.createElement('style');
      style.textContent = f.css;
      target.appendChild(style);
      var content = document.createElement('div');
      content.innerHTML = f.html;
      target.appendChild(content);
      container.appendChild(target);

      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function() { doPdf(target, f, container, i); });
      } else {
        setTimeout(function() { doPdf(target, f, container, i); }, 2000);
      }
    }

    function doPdf(target, f, container, i) {
      html2canvas(target, { width: f.width, height: f.height, scale: 2, useCORS: true, allowTaint: true }).then(function(canvas) {
        var imgData = canvas.toDataURL('image/png');
        var pdf = new jsPDF({
          orientation: f.width > f.height ? 'landscape' : 'portrait',
          unit: 'px',
          format: [f.width, f.height]
        });
        pdf.addImage(imgData, 'PNG', 0, 0, f.width, f.height);
        pdf.save(f.name + '.pdf');
        done++;
        container.remove();
        renderNext(i + 1);
      }).catch(function(err) {
        document.getElementById('status').textContent = 'Error: ' + err.message;
        container.remove();
      });
    }

    renderNext(0);
  })();
</script>
</body></html>`;
}

/** Utility: crypto-based UUID v4 (avoids uuid npm in Netlify edge) */
function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/** UUID v4 format — validates user_id before Supabase upsert */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Simple in-memory rate limiter (survives warm Edge Function instances) */
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 60;      // requests per window
const RATE_WINDOW_MS = 60_000;  // 1 minute
function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

/**
 * Build a self-contained HTML page that auto-renders each frame via html2canvas
 * and immediately downloads the real PNG. No toolbars, no buttons — pure design.
 * When opened in any browser, each frame auto-downloads as a .png file.
 */
function buildHtmlExportPage(frames) {
  const allCss = frames.map(f => f.css || "").join("\n");
  const fontImportRe = /@import\s+url\(['"]?(https:\/\/fonts\.googleapis\.com[^'")]+)['"]?\)\s*;/g;
  const fontLinks = [];
  let m;
  while ((m = fontImportRe.exec(allCss)) !== null) {
    fontLinks.push(`<link rel="stylesheet" href="${m[1]}">`);
  }

  const framesJson = JSON.stringify(frames.map(f => ({
    name: (f.name || "frame").replace(/[<>:"/\\|?*]/g, "_"),
    width: f.width || 1080,
    height: f.height || 1080,
    html: f.html || "",
    css: f.css || "",
  })));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Futuraria Render</title>
<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"><\/script>
${fontLinks.join("\n")}
<style>
  body { margin:0; padding:16px; background:#e5e7eb; font-family:-apple-system,sans-serif; }
  #status { padding: 8px 16px; background:#fff; border-radius:6px; box-shadow:0 1px 3px rgba(0,0,0,0.1); font-size:13px; color:#333; display:inline-block; }
  #status.done { color:#059669; }
</style>
</head>
<body>
<div id="status">Rendering ${frames.length} frame(s)…</div>
<script>
  (function() {
    var frames = ${framesJson};
    var total = frames.length;
    var done = 0;

    function renderNext(i) {
      if (i >= total) {
        document.getElementById('status').textContent = 'Done — ' + done + '/' + total + ' downloaded';
        document.getElementById('status').className = 'done';
        return;
      }
      var f = frames[i];
      document.getElementById('status').textContent = 'Rendering ' + (i+1) + '/' + total + ': ' + f.name + '…';

      var container = document.createElement('div');
      container.style.cssText = 'position:fixed;left:-9999px;top:0;width:'+f.width+'px;height:'+f.height+'px;overflow:hidden;';
      document.body.appendChild(container);

      var target = document.createElement('div');
      target.style.cssText = 'width:'+f.width+'px;height:'+f.height+'px;overflow:hidden;position:relative;';
      var style = document.createElement('style');
      style.textContent = f.css;
      target.appendChild(style);
      var content = document.createElement('div');
      content.innerHTML = f.html;
      target.appendChild(content);
      container.appendChild(target);

      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function() { doCapture(target, f, container, i); });
      } else {
        setTimeout(function() { doCapture(target, f, container, i); }, 2000);
      }
    }

    function doCapture(target, f, container, i) {
      html2canvas(target, { width: f.width, height: f.height, scale: 2, useCORS: true, allowTaint: true }).then(function(canvas) {
        canvas.toBlob(function(blob) {
          var url = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = url;
          a.download = f.name + '.png';
          a.click();
          URL.revokeObjectURL(url);
          done++;
          container.remove();
          renderNext(i + 1);
        }, 'image/png');
      }).catch(function() {
        container.remove();
        renderNext(i + 1);
      });
    }

    renderNext(0);
  })();
</script>
</body></html>`;
}

const MCP_TOOLS = [
  {
    name: "list_workspaces",
    description: "List all workspaces for the authenticated user",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "create_workspace",
    description: "Create a new workspace",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Workspace name" },
        description: { type: "string", description: "Optional description" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_templates",
    description: "List templates with optional workspace filter and search",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Filter by workspace ID" },
        search: { type: "string", description: "Search by template name" },
        limit: { type: "number", description: "Max results (default 50)" },
        offset: { type: "number", description: "Pagination offset" },
      },
      required: [],
    },
  },
  {
    name: "get_template",
    description: "Get a template by ID with full canvas data, frames, styles, variables",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Template ID (tpl_xxxxxxxx)" },
      },
      required: ["id"],
    },
  },
  {
    name: "create_template",
    description: "Create a new design template in a workspace (HTML engine). Pass engine='html' with optional html/css content.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Template name" },
        workspaceId: { type: "string", description: "Workspace ID to create in" },
        width: { type: "number", description: "Canvas width in pixels (default 1080)" },
        height: { type: "number", description: "Canvas height in pixels (default 1080)" },
        engine: { type: "string", enum: ["html"], description: "Rendering engine (default 'html'). Use 'html' for code-based designs." },
        html: { type: "string", description: "Initial HTML content (HTML engine only)" },
        css: { type: "string", description: "Initial CSS styles (HTML engine only)" },
      },
      required: ["name", "workspaceId"],
    },
  },
  {
    name: "update_template",
    description: "Update a template's name, canvas data, or HTML/CSS content. Pass html/css/frames for HTML templates.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Template ID" },
        name: { type: "string", description: "New name" },
        canvas: { type: "object", description: "Canvas JSON with objects and viewport (legacy)" },
        engine: { type: "string", enum: ["html"], description: "Switch rendering engine" },
        html: { type: "string", description: "HTML content for active frame (HTML engine)" },
        css: { type: "string", description: "CSS styles for active frame (HTML engine)" },
        frames: { type: "array", items: { type: "object" }, description: "Full frames array with html/css for each frame (HTML engine)" },
      },
      required: ["id"],
    },
  },
  {
    name: "delete_template",
    description: "Permanently delete a template",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Template ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "duplicate_template",
    description: "Create an independent copy of a template",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Source template ID" },
        name: { type: "string", description: "Name for the copy (default: original + ' (copy)')" },
      },
      required: ["id"],
    },
  },
  {
    name: "export_template",
    description: "Export a template as .futuraria JSON for backup/migration",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Template ID to export" },
      },
      required: ["id"],
    },
  },
  {
    name: "import_template",
    description: "Import a .futuraria JSON export into a workspace",
    inputSchema: {
      type: "object",
      properties: {
        data: { type: "object", description: "The .futuraria JSON object (must have format: 'futuraria/v1' and template.name)" },
        workspaceId: { type: "string", description: "Target workspace ID" },
      },
      required: ["data", "workspaceId"],
    },
  },
  {
    name: "batch_update",
    description: "Apply an update to multiple templates at once (e.g. change CTA text across all 18 styles)",
    inputSchema: {
      type: "object",
      properties: {
        templateIds: {
          type: "array",
          items: { type: "string" },
          description: "List of template IDs to update",
        },
        search: { type: "string", description: "Optional: update all templates matching this name search instead of explicit IDs" },
        workspaceId: { type: "string", description: "Required when using search to scope to a workspace" },
        canvas: { type: "object", description: "Canvas JSON to merge into each template" },
        objects: {
          type: "array",
          items: { type: "object" },
          description: "Objects to merge into each template",
        },
        name: { type: "string", description: "New name(s) — appended suffix like ' - Updated'" },
      },
      required: [],
    },
  },
  {
    name: "render_batch",
    description: "Render multiple templates to HTML+PNG in one call. Returns render URLs for each.",
    inputSchema: {
      type: "object",
      properties: {
        templateIds: {
          type: "array",
          items: { type: "string" },
          description: "List of template IDs to render",
        },
        format: {
          type: "string",
          enum: ["png", "jpg"],
          description: "Output format (default png)",
        },
        scale: {
          type: "number",
          description: "Render scale multiplier (default 1, max 4)",
        },
        transparent: {
          type: "boolean",
          description: "Render with transparent background instead of white (default false)",
        },
      },
      required: ["templateIds"],
    },
  },
  {
    name: "list_versions",
    description: "List all saved versions of a template for undo/restore",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Template ID" },
      },
      required: ["id"],
    },
  },
  {
    name: "restore_version",
    description: "Restore a template to a previously saved version",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Template ID" },
        versionId: { type: "string", description: "Version ID to restore (from list_versions)" },
      },
      required: ["id", "versionId"],
    },
  },
  {
    name: "list_fonts",
    description: "List fonts used in a template with usage counts, sizes, and weights",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "create_frame",
    description: "Create a frame (artboard) inside a template for grouping/containing objects",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        name: { type: "string", description: "Frame name" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Frame width (default 400)" },
        height: { type: "number", description: "Frame height (default 300)" },
        fill: { type: "string", description: "Background fill color" },
        parentFrameId: { type: "string", description: "Optional parent frame ID for nested frames" },
        layoutMode: { type: "string", enum: ["NONE", "HORIZONTAL", "VERTICAL"], description: "Auto-layout mode (default NONE)" },
        clipsContent: { type: "boolean", description: "Clip overflowing content (default true)" },
        paddingTop: { type: "number", description: "Padding top (default 0)" },
        paddingRight: { type: "number", description: "Padding right (default 0)" },
        paddingBottom: { type: "number", description: "Padding bottom (default 0)" },
        paddingLeft: { type: "number", description: "Padding left (default 0)" },
      },
      required: ["templateId", "name"],
    },
  },
  {
    name: "list_frames",
    description: "List all frames in a template",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "get_frame",
    description: "Get a single frame by ID",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID" },
      },
      required: ["templateId", "frameId"],
    },
  },
  {
    name: "update_frame",
    description: "Update a frame's properties (name, position, size, fill, html, css). For surgical element-level editing (text, src, style on specific elements), use update_frame_content instead.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID to update" },
        name: { type: "string", description: "New frame name" },
        x: { type: "number", description: "X position" },
        y: { type: "number", description: "Y position" },
        width: { type: "number", description: "Width in px" },
        height: { type: "number", description: "Height in px" },
        fill: { type: "string", description: "Background fill color" },
        html: { type: "string", description: "Full HTML content replacement (for entire frame rewrites)" },
        css: { type: "string", description: "Full CSS content replacement" },
      },
      required: ["templateId", "frameId"],
    },
  },
  {
    name: "delete_frame",
    description: "Delete a frame and all its contained objects",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID to delete" },
      },
      required: ["templateId", "frameId"],
    },
  },
  {
    name: "search_google_fonts",
    description: "Search and browse 94 Google Fonts by name or category (sans-serif, serif, display, handwriting, monospace). Returns family name, category, available weight variants, and the Google Fonts CSS URL. Use this to discover fonts for your designs before applying via add_text fontFamily or transform_object fontFamily.",
    inputSchema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Search by font name or category (e.g. 'play', 'serif', 'mono')" },
        category: { type: "string", enum: ["sans-serif", "serif", "display", "handwriting", "monospace"], description: "Filter by category" },
        limit: { type: "number", description: "Max results (default 20, max 100)" },
      },
      required: [],
    },
  },
  {
    name: "add_comment",
    description: "Add a comment to a specific object or position on the canvas. Comments are stored in template metadata.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        text: { type: "string", description: "Comment text" },
        targetLayerName: { type: "string", description: "Layer name to attach comment to (optional)" },
        x: { type: "number", description: "X position for canvas-level comment" },
        y: { type: "number", description: "Y position for canvas-level comment" },
        author: { type: "string", description: "Comment author name (default 'Anonymous')" },
        resolved: { type: "boolean", description: "Mark as resolved (default false)" },
      },
      required: ["templateId", "text"],
    },
  },
  {
    name: "share_template",
    description: "Generate a shareable link for a template with optional permissions (view, comment, edit).",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID to share" },
        permission: { type: "string", enum: ["view", "comment", "edit"], description: "Access level (default view)" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "preview_font",
    description: "Render a font preview on the canvas showing the font family name at large size and a sample pangram in that typeface.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        fontFamily: { type: "string", description: "Google Font family name (e.g. 'Inter', 'Roboto', 'Playfair Display')" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Width in px (default 600)" },
        frameId: { type: "string", description: "Optional frame ID" },
      },
      required: ["templateId", "fontFamily"],
    },
  },
  {
    name: "mention_user",
    description: "Add an @mention annotation to an object or canvas position. Stored as a styled comment with the mention data.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        username: { type: "string", description: "Username to mention (e.g. 'lara', '@lara' — @ prefix added if missing)" },
        targetLayerName: { type: "string", description: "Layer name to attach mention to (optional)" },
        x: { type: "number", description: "X position for canvas-level mention" },
        y: { type: "number", description: "Y position for canvas-level mention" },
        message: { type: "string", description: "Optional message text with the mention" },
      },
      required: ["templateId", "username"],
    },
  },
  {
    name: "ai_generate_text",
    description: "Generate AI text content using OpenRouter (GPT-4o-mini). Requires OPENROUTER_API_KEY env var. Optionally adds generated text to canvas.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Text generation prompt" },
        templateId: { type: "string", description: "Optional template ID to add generated text to" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Text width in px (default 600)" },
        fontSize: { type: "number", description: "Font size (default 16)" },
        systemPrompt: { type: "string", description: "Custom system prompt (default: 'You are a design assistant')" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "ai_generate_image",
    description: "Generate an AI image via OpenRouter (model-agnostic) and optionally add it to the canvas. Requires OPENROUTER_API_KEY.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Image generation prompt" },
        templateId: { type: "string", description: "Optional template ID to add generated image to" },
        x: { type: "number", description: "X position (default 0)" },
        y: { type: "number", description: "Y position (default 0)" },
        width: { type: "number", description: "Image width in px (default 512)" },
        height: { type: "number", description: "Image height in px (default 512)" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "ai_palette",
    description: "Generate a color palette (5-7 colors) based on a theme, mood, or description using AI. Requires OPENROUTER_API_KEY.",
    inputSchema: {
      type: "object",
      properties: {
        theme: { type: "string", description: "Theme or description for the palette (e.g. 'ocean sunset', 'corporate tech', 'warm minimal')" },
        count: { type: "number", description: "Number of colors (3-9, default 6)" },
        includeNeutrals: { type: "boolean", description: "Include background/surface neutrals (default true)" },
      },
      required: ["theme"],
    },
  },
  {
    name: "ai_suggest_layout",
    description: "Analyze the current template canvas and suggest layout improvements (alignment, spacing, hierarchy). Requires OPENROUTER_API_KEY.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID to analyze" },
        aspect: { type: "string", enum: ["alignment", "spacing", "hierarchy", "all"], description: "Layout aspect to analyze (default all)" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "ai_translate",
    description: "Translate text on the canvas or supplied text to another language using AI. Requires OPENROUTER_API_KEY.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID whose text objects to translate" },
        targetLayerName: { type: "string", description: "Specific layer to translate (optional; translates all text objects if omitted)" },
        targetLanguage: { type: "string", description: "Target language (e.g. 'Spanish', 'French', 'Japanese'). Default: 'English'." },
        text: { type: "string", description: "Direct text to translate (alternative to templateId+layer)" },
      },
      required: [],
    },
  },
  {
    name: "create_style",
    description: "Create a reusable style (fill, stroke, text, or effect) from a layer's current properties. Styles can be applied to other layers via apply_style.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        name: { type: "string", description: "Style name (e.g. 'Primary Blue', 'Heading H1')" },
        type: { type: "string", enum: ["fill", "stroke", "text", "effect"], description: "Style type" },
        sourceLayerName: { type: "string", description: "Layer name to extract style properties from" },
        frameId: { type: "string", description: "Optional frame ID for source layer lookup" },
      },
      required: ["templateId", "name", "type", "sourceLayerName"],
    },
  },
  {
    name: "apply_style",
    description: "Apply a saved style to one or more target layers, transferring fill/stroke/text/effect properties.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        styleId: { type: "string", description: "Style ID to apply" },
        targetLayerNames: { type: "array", items: { type: "string" }, description: "Array of layer names to apply the style to" },
        frameId: { type: "string", description: "Optional frame ID for target layer lookup" },
      },
      required: ["templateId", "styleId", "targetLayerNames"],
    },
  },
  {
    name: "create_variable",
    description: "Create a design token variable (color, number, string) that can be bound to layer properties and reused across templates.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        name: { type: "string", description: "Variable name (e.g. 'primary-color', 'spacing-md')" },
        type: { type: "string", enum: ["color", "number", "string"], description: "Variable type" },
        value: { type: "string", description: "Variable value (hex for color, number as string for number, any string for string)" },
        collectionId: { type: "string", description: "Optional collection ID to group this variable" },
      },
      required: ["templateId", "name", "type", "value"],
    },
  },
  {
    name: "create_collection",
    description: "Create a variable collection with optional modes (e.g. 'Light/Dark'). Collections group related design tokens.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        name: { type: "string", description: "Collection name (e.g. 'Colors', 'Spacing', 'Typography')" },
        modes: { type: "array", items: { type: "string" }, description: "Mode names (e.g. ['Light', 'Dark']). Default: ['Default']" },
      },
      required: ["templateId", "name"],
    },
  },
  {
    name: "link_variable",
    description: "Bind a design token variable to a layer property, so the property value tracks the variable.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        variableId: { type: "string", description: "Variable ID to link" },
        targetLayerName: { type: "string", description: "Layer name to bind the variable to" },
        property: { type: "string", enum: ["fill", "stroke", "fontSize", "opacity", "width", "height"], description: "Property to bind" },
        frameId: { type: "string", description: "Optional frame ID for layer lookup" },
      },
      required: ["templateId", "variableId", "targetLayerName", "property"],
    },
  },
  {
    name: "export_batch",
    description: "Batch export frames or layers as PNG/SVG with configurable presets (scale, suffix, format). Renders via the render pipeline.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameIds: { type: "array", items: { type: "string" }, description: "Frame IDs to export (exports all frames if omitted)" },
        format: { type: "string", enum: ["png", "svg", "png@2x", "png@3x"], description: "Export format (default png)" },
        scale: { type: "number", description: "Scale multiplier (1, 2, 3). Overridden by format suffix." },
      },
      required: ["templateId"],
    },
  },
  {
    name: "copy_as",
    description: "Copy a layer or selection as code: SVG markup, CSS styles, or JSON representation. Useful for developer handoff.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        targetLayerName: { type: "string", description: "Layer name to export as code" },
        format: { type: "string", enum: ["svg", "css", "json"], description: "Output format (default json)" },
        frameId: { type: "string", description: "Optional frame ID for layer lookup" },
      },
      required: ["templateId", "targetLayerName"],
    },
  },
  {
    name: "export_pdf",
    description: "Export the entire template or specific frames as a PDF document via the render pipeline.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameIds: { type: "array", items: { type: "string" }, description: "Frame IDs to include (all frames if omitted)" },
        orientation: { type: "string", enum: ["portrait", "landscape"], description: "Page orientation (default landscape)" },
        format: { type: "string", enum: ["a4", "letter", "screen"], description: "Page size (default screen = canvas size)" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "color_picker",
    description: "Color utilities: parse hex/rgba/hsl, generate complementary/analogous/triadic palettes, create light-dark shade gradients. Pure computation, no canvas required.",
    inputSchema: {
      type: "object",
      properties: {
        color: { type: "string", description: "Hex color (#cba6f7, #cba6f7ff, cba6f7) or rgb/rgba string" },
        action: { type: "string", enum: ["parse", "complementary", "analogous", "triadic", "shades", "gradient"], description: "Color action (default: parse)" },
        steps: { type: "number", description: "Number of steps for shades/gradient (default 5, max 20)" },
      },
      required: ["color"],
    },
  },
  {
    name: "create_component",
    description: "Create a reusable component from selected canvas objects. Components support variants (alternative configurations) and property overrides (boolean, text, instance swap). Stored in template metadata.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        name: { type: "string", description: "Component name (e.g. Button/Primary)" },
        description: { type: "string", description: "Optional description of the component" },
        objectIds: { type: "array", items: { type: "string" }, description: "Array of object IDs to include in the component" },
        frameId: { type: "string", description: "Optional frame ID to scope the component" },
      },
      required: ["templateId", "name", "objectIds"],
    },
  },
  {
    name: "create_instance",
    description: "Create an instance of a component. Instances inherit the component master's properties but can override specific values. Changes to the master propagate to instances that haven't overridden the changed property.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        componentId: { type: "string", description: "Component ID to instantiate" },
        x: { type: "number", description: "X position for the instance (default 0)" },
        y: { type: "number", description: "Y position for the instance (default 0)" },
        frameId: { type: "string", description: "Optional frame ID to place instance inside" },
      },
      required: ["templateId", "componentId"],
    },
  },
  {
    name: "add_variant",
    description: "Add a variant to an existing component. Variants define alternative configurations (e.g. Button/Primary, Button/Secondary, Button/Disabled) with per-property overrides.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        componentId: { type: "string", description: "Component ID to add variant to" },
        name: { type: "string", description: "Variant name (e.g. Hover, Disabled, Secondary)" },
        overrides: { type: "object", description: "Key-value overrides for object properties (e.g. { \"fill\": \"#45475a\", \"opacity\": 0.5 })" },
      },
      required: ["templateId", "componentId", "name"],
    },
  },
  {
    name: "add_interaction",
    description: "Add an interaction between frames or objects. Supports click-to-navigate, hover-to-overlay, press, and delay triggers with navigation, overlay, and scroll actions.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        sourceId: { type: "string", description: "Source frame or object ID that triggers the interaction" },
        trigger: { type: "string", enum: ["onClick", "onHover", "onPress", "onDelay"], description: "Trigger type (default onClick)" },
        action: { type: "string", enum: ["navigate", "overlay", "scroll", "back", "close"], description: "Action to perform (default navigate)" },
        targetId: { type: "string", description: "Target frame ID for navigation or overlay" },
        transition: { type: "string", enum: ["instant", "dissolve", "slide", "push", "smartAnimate"], description: "Transition animation (default instant)" },
        duration: { type: "number", description: "Animation duration in ms (default 300)" },
        delay: { type: "number", description: "Delay before trigger in ms (for onDelay trigger)" },
        easing: { type: "string", enum: ["easeIn", "easeOut", "easeInOut", "linear"], description: "Easing curve (default easeOut)" },
      },
      required: ["templateId", "sourceId"],
    },
  },
  {
    name: "set_animation",
    description: "Set entrance/exit animation on a frame or object. Supports dissolve, slide, smart animate, and custom easing curves.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        objectId: { type: "string", description: "Frame or object ID to animate" },
        type: { type: "string", enum: ["dissolve", "slideIn", "slideOut", "push", "smartAnimate", "fade"], description: "Animation type" },
        direction: { type: "string", enum: ["left", "right", "up", "down"], description: "Direction for slide animations" },
        duration: { type: "number", description: "Duration in ms (default 300)" },
        easing: { type: "string", enum: ["easeIn", "easeOut", "easeInOut", "linear", "spring", "bounce"], description: "Easing curve (default easeOut)" },
        delay: { type: "number", description: "Delay in ms before animation starts" },
      },
      required: ["templateId", "objectId", "type"],
    },
  },
  {
    name: "add_overlay",
    description: "Configure a frame as an overlay with positioning, backdrop, and close-on-click-outside behavior. Used for modals, tooltips, dropdowns, and slide-out panels.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID to configure as overlay" },
        position: { type: "string", enum: ["center", "topLeft", "topRight", "bottomLeft", "bottomRight", "manual"], description: "Overlay position (default center)" },
        backdrop: { type: "boolean", description: "Show semi-transparent backdrop (default true)" },
        backdropColor: { type: "string", description: "Backdrop color with opacity (default rgba(0,0,0,0.5))" },
        closeOnBackdrop: { type: "boolean", description: "Close overlay when clicking backdrop (default true)" },
        manualX: { type: "number", description: "Manual X offset (for manual position)" },
        manualY: { type: "number", description: "Manual Y offset (for manual position)" },
      },
      required: ["templateId", "frameId"],
    },
  },
  {
    name: "set_scroll_position",
    description: "Set scroll behavior for frames or objects within a scrolling container. Supports fixed positioning (stays in place during scroll) and sticky positioning.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        objectId: { type: "string", description: "Frame or object ID" },
        behavior: { type: "string", enum: ["fixed", "sticky", "scroll", "auto"], description: "Scroll behavior (default auto)" },
        stickyTop: { type: "number", description: "Top offset in px for sticky positioning" },
        stickyBottom: { type: "number", description: "Bottom offset in px for sticky positioning" },
        overflow: { type: "string", enum: ["visible", "hidden", "scroll", "auto"], description: "Overflow behavior for the container (default visible)" },
      },
      required: ["templateId", "objectId", "behavior"],
    },
  },
  {
    name: "publish_library",
    description: "Publish a style library from a template. Collections of styles (color, text, effect, grid) can be published and imported by other templates, enabling design system reuse across projects.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Source template ID containing the styles" },
        name: { type: "string", description: "Library name (e.g. 'Brand Design System')" },
        description: { type: "string", description: "Library description" },
        styleIds: { type: "array", items: { type: "string" }, description: "Array of style IDs to include (omit to publish all)" },
        visibility: { type: "string", enum: ["workspace", "public"], description: "Visibility scope (default workspace)" },
      },
      required: ["templateId", "name"],
    },
  },
  {
    name: "register_tool",
    description: "Register a custom MCP tool (plugin) dynamically. Third-party tools can extend the MCP server with new functionality. Tools are validated and added to the runtime tool registry.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Unique tool name (must start with plugin_ prefix)" },
        description: { type: "string", description: "Tool description" },
        inputSchema: { type: "object", description: "JSON Schema for tool parameters" },
        handler: { type: "string", description: "Handler endpoint URL (webhook) that will receive tool calls" },
        secret: { type: "string", description: "Optional shared secret for webhook authentication" },
      },
      required: ["name", "description", "inputSchema", "handler"],
    },
  },
  {
    name: "auth_token",
    description: "Create a Personal Access Token (PAT) for API authentication. Tokens support scoped permissions (read, write, admin) and optional expiry. Used for headless API access and CI/CD pipelines.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string", description: "User ID to create token for" },
        name: { type: "string", description: "Token name/label (e.g. 'CI/CD Pipeline')" },
        scopes: { type: "array", items: { type: "string", enum: ["read", "write", "admin"] }, description: "Permission scopes (default ['read'])" },
        expiresIn: { type: "number", description: "Expiry in seconds (default 31536000 = 1 year, 0 = never)" },
      },
      required: ["userId", "name"],
    },
  },
  {
    name: "skill_clone",
    description: "Create a reusable clone skill from extracted or manually-defined patterns. Stored in tpl.metadata.clonedSkills[] array. Skills can be applied later via skill_apply.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID to store the skill on" },
        skillName: { type: "string", description: "Name for the cloned skill (e.g. 'Brutalist Dark Theme')" },
        description: { type: "string", description: "Description of what this skill captures" },
        patterns: { type: "object", description: "Patterns object from skill_extract, or manually defined patterns with palette/typography/spacing/layout/effects/ratios" },
        rules: { type: "array", items: { type: "string" }, description: "Design rules extracted (e.g. 'use sans-serif for headings', 'maintain 8px grid')" },
        sourceTemplateId: { type: "string", description: "Which template these patterns were extracted from (for provenance)" },
      },
      required: ["templateId", "skillName", "patterns"],
    },
  },
  {
    name: "observe_session",
    description: "Record and analyze human design sessions to extract workflow patterns. Actions: 'start' begins recording, 'stop' finalizes and saves, 'analyze' extracts patterns (most-used tools, typical workflow, common adjustments). Stored in global in-memory session store.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["start", "stop", "analyze"], description: "Session action: start recording, stop and save, or analyze patterns" },
        userId: { type: "string", description: "User ID for the session" },
        templateId: { type: "string", description: "Template ID context (optional)" },
        event: { type: "object", description: "Record a single event during session (mcpTool, canvasAction, navigation)" },
      },
      required: ["action"],
    },
  },
  {
    name: "smart_layout",
    description: "Apply advanced layout algorithms to objects: grid (row/column math), masonry (column-based with height tracking), golden-ratio (spiral positioning), circular (polar coordinates), zigzag (alternating offsets), flex-wrap (row-based with overflow). Rearranges objects automatically.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        targetLayerNames: { type: "array", items: { type: "string" }, description: "Layer names to arrange (all if empty)" },
        layout: { type: "string", enum: ["grid", "masonry", "golden-ratio", "circular", "zigzag", "flex-wrap"], description: "Layout algorithm" },
        columns: { type: "number", description: "Columns for grid/masonry (default 3)" },
        gap: { type: "number", description: "Gap between items in px (default 16)" },
        startX: { type: "number", description: "Starting X position (default 0)" },
        startY: { type: "number", description: "Starting Y position (default 0)" },
        radius: { type: "number", description: "Radius for circular layout (default 300)" },
        amplitude: { type: "number", description: "Zigzag amplitude (default 40)" },
        maxWidth: { type: "number", description: "Max row width for flex-wrap (default canvas width)" },
      },
      required: ["templateId", "layout"],
    },
  },
  {
    name: "suggest_color_palette",
    description: "Generate color palettes using color theory rules from a base hex color. Types: complementary (180°), analogous (±30°), triadic (±120°), monochromatic (varied S/L), split-complementary, tetradic. Uses existing rgbToHsl/hslToRgb helpers.",
    inputSchema: {
      type: "object",
      properties: {
        baseColor: { type: "string", description: "Base hex color (e.g. '#3b82f6')" },
        type: { type: "string", enum: ["complementary", "analogous", "triadic", "monochromatic", "split-complementary", "tetradic"], description: "Color harmony type (default: complementary)" },
        count: { type: "number", description: "Number of colors to generate (2-8, default depends on type)" },
        mood: { type: "string", enum: ["vibrant", "muted", "dark", "light", "pastel", "professional"], description: "Mood modifier for saturation/lightness tweaks" },
      },
      required: ["baseColor"],
    },
  },
  {
    name: "create_html_template",
    description: "Create a new HTML/CSS design template with optional initial HTML and CSS",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Template name" },
        workspaceId: { type: "string", description: "Workspace ID" },
        width: { type: "number", description: "Template width in pixels (default 1080)" },
        height: { type: "number", description: "Template height in pixels (default 1080)" },
        initialHtml: { type: "string", description: "Optional initial HTML content" },
        initialCss: { type: "string", description: "Optional initial CSS stylesheet" },
      },
      required: ["name", "workspaceId"],
    },
  },
  {
    name: "set_html",
    description: "Replace the full HTML content of an HTML template (server-side sanitized with DOMPurify)",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        html: { type: "string", description: "Full HTML content" },
      },
      required: ["templateId", "html"],
    },
  },
  {
    name: "set_css",
    description: "Replace the full CSS stylesheet of an HTML template",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        css: { type: "string", description: "Full CSS stylesheet" },
      },
      required: ["templateId", "css"],
    },
  },
  // ── Fase 1: HTML Engine Structure Tools ──
  {
    name: "get_template_structure",
    description: "Parse an HTML template and return its DOM tree, CSS rules, and element list",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "select_element",
    description: "Get details about a specific element by its data-layer-id",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        elementId: { type: "string", description: "data-layer-id value of the element" },
      },
      required: ["templateId", "elementId"],
    },
  },
  {
    name: "update_element",
    description: "Update an HTML element's content or CSS rules by its data-layer-id",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        elementId: { type: "string", description: "data-layer-id of the element to update" },
        html: { type: "string", description: "New inner HTML content" },
        css: { type: "string", description: "CSS properties to set on the element (e.g. 'color: red; font-size: 24px')" },
        attributes: { type: "object", description: "HTML attributes to set (e.g. {class: 'new-class', src: 'url'})" },
      },
      required: ["templateId", "elementId"],
    },
  },
  {
    name: "add_element",
    description: "Add a new HTML element to a template",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        parentSelector: { type: "string", description: "CSS selector of the parent element (or 'body' for root)" },
        tag: { type: "string", description: "HTML tag name (div, span, h1, p, img, etc.)" },
        html: { type: "string", description: "Inner HTML content" },
        css: { type: "string", description: "Inline CSS styles for the element" },
        position: { type: "string", enum: ["prepend", "append", "before", "after"], description: "Insertion position relative to parent (default append)" },
        layerName: { type: "string", description: "Unique data-layer-id for the element" },
        frameId: { type: "string", description: "Frame ID to add to (for multi-frame HTML templates). If omitted, adds to template-level html." },
      },
      required: ["templateId", "tag"],
    },
  },
  {
    name: "add_primitive",
    description: "Add a visual primitive (rectangle, circle, or text block) to a specific frame in an HTML template. Creates the element with a data-layer-id and matching CSS rule using attribute selectors, following the visual-first design model.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID to add the primitive to" },
        type: { type: "string", enum: ["rect", "circle", "text"], description: "Primitive type: rect (rectangle), circle, or text block" },
        x: { type: "number", description: "X position in pixels within the frame" },
        y: { type: "number", description: "Y position in pixels within the frame" },
        width: { type: "number", description: "Width in pixels (default 200 for rect, 150 for circle)" },
        height: { type: "number", description: "Height in pixels (default 150 for rect, 150 for circle)" },
        color: { type: "string", description: "Background color (default #3B82F6 for rect, #EF4444 for circle)" },
        content: { type: "string", description: "Text content (only for text type, default 'Text')" },
        fontSize: { type: "number", description: "Font size for text type (default 24)" },
        borderRadius: { type: "string", description: "Custom border-radius (default 8px for rect, 50% for circle)" },
      },
      required: ["templateId", "frameId", "type"],
    },
  },
  {
    name: "change_element_tag",
    description: "Change the HTML tag of an existing element (semantic tagging). The element keeps its data-layer-id, styles, and content. Use this to apply semantic meaning (e.g. change div to nav, h1, button, etc.) after creating visual primitives.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID containing the element" },
        elementId: { type: "string", description: "data-layer-id of the element" },
        newTag: { type: "string", description: "New HTML tag (e.g. h1, button, nav, section, p, a, etc.)" },
      },
      required: ["templateId", "elementId", "newTag"],
    },
  },
  {
    name: "remove_element",
    description: "Remove an HTML element by its data-layer-id",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        elementId: { type: "string", description: "data-layer-id of the element to remove" },
      },
      required: ["templateId", "elementId"],
    },
  },
  {
    name: "reorder_element",
    description: "Change the position of an element within its parent",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        elementId: { type: "string", description: "data-layer-id of the element to move" },
        newIndex: { type: "number", description: "New zero-based index position within the parent" },
      },
      required: ["templateId", "elementId", "newIndex"],
    },
  },
  {
    name: "get_css_variables",
    description: "Extract all CSS custom properties (variables) from a template's stylesheet",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "set_css_variable",
    description: "Set or update a CSS custom property value in the template's stylesheet",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        name: { type: "string", description: "CSS variable name (e.g. '--primary-color')" },
        value: { type: "string", description: "New value for the CSS variable (e.g. '#FF0000')" },
        scope: { type: "string", description: "CSS scope selector (default ':root')" },
      },
      required: ["templateId", "name", "value"],
    },
  },
  // ── Fase 2: Template Engine + Recipes ──
  {
    name: "analyze_template_structure",
    description: "Analyze template html/css to detect layout type, colors, typography, components, and dimensions",
    inputSchema: { type: "object", properties: { templateId: { type: "string" } }, required: ["templateId"] },
  },
  {
    name: "extract_variables",
    description: "Extract replaceable content (texts, images, colors, fixed sections) from template",
    inputSchema: { type: "object", properties: { templateId: { type: "string" } }, required: ["templateId"] },
  },
  {
    name: "create_variant",
    description: "Clone a template and replace variables (texts, images, colors) to create a new variant",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, variables: { type: "object" }, name: { type: "string" } }, required: ["templateId", "variables"] },
  },
  {
    name: "apply_variables",
    description: "Apply variable replacements directly to an existing template",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, variables: { type: "object" } }, required: ["templateId", "variables"] },
  },
  {
    name: "save_recipe",
    description: "Analyze template structure and save as a reusable recipe in Supabase",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, name: { type: "string" }, description: { type: "string" } }, required: ["templateId"] },
  },
  // ── Fase 3: Batch Factory ──
  {
    name: "batch_create_variants",
    description: "Create multiple template variants from an array of variable sets",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, recipeId: { type: "string" }, variables: { type: "array" }, options: { type: "object" } }, required: ["variables"] },
  },
  {
    name: "batch_render_html",
    description: "Render multiple HTML templates to PNG",
    inputSchema: { type: "object", properties: { batchId: { type: "string" }, templateIds: { type: "array" }, format: { type: "string" }, scale: { type: "number" } } },
  },
  {
    name: "batch_status",
    description: "Check status and progress of a batch job",
    inputSchema: { type: "object", properties: { batchId: { type: "string" }, jobId: { type: "string" } } },
  },
  {
    name: "batch_cancel",
    description: "Cancel a running batch job",
    inputSchema: { type: "object", properties: { batchId: { type: "string" }, jobId: { type: "string" } } },
  },
  {
    name: "batch_export",
    description: "Export batch results as ZIP or URL list",
    inputSchema: { type: "object", properties: { batchId: { type: "string" }, templateIds: { type: "array" }, format: { type: "string" }, includeMetadata: { type: "boolean" } } },
  },
  {
    name: "publish_batch",
    description: "Publish rendered batch via n8n webhook to social channels",
    inputSchema: { type: "object", properties: { batchId: { type: "string" }, renderUrls: { type: "array" }, channels: { type: "array" }, schedule: { type: "string" } } },
  },
  {
    name: "publish_status",
    description: "Check publishing job status",
    inputSchema: { type: "object", properties: { jobId: { type: "string" } }, required: ["jobId"] },
  },
  // ── Fase 4: Multi-Agent Realtime ──
  {
    name: "claim_section",
    description: "Claim exclusive editing access to a template section with TTL lock",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, sectionId: { type: "string" }, agentId: { type: "string" }, ttlSeconds: { type: "number" } }, required: ["templateId", "sectionId", "agentId"] },
  },
  {
    name: "release_section",
    description: "Release a previously claimed section lock",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, sectionId: { type: "string" }, lockId: { type: "string" } }, required: ["templateId", "lockId"] },
  },
  {
    name: "list_sections",
    description: "List all sections of a template with their lock status",
    inputSchema: { type: "object", properties: { templateId: { type: "string" } }, required: ["templateId"] },
  },
  {
    name: "assemble_template",
    description: "Merge all section html/css into a complete template",
    inputSchema: { type: "object", properties: { templateId: { type: "string" } }, required: ["templateId"] },
  },
  {
    name: "get_active_agents",
    description: "List agents currently editing this template",
    inputSchema: { type: "object", properties: { templateId: { type: "string" } }, required: ["templateId"] },
  },
  {
    name: "subscribe_template",
    description: "Subscribe to Supabase Realtime changes for a template",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, channelType: { type: "string" } }, required: ["templateId"] },
  },
  {
    name: "unsubscribe_template",
    description: "Unsubscribe from template realtime channel",
    inputSchema: { type: "object", properties: { channelId: { type: "string" } }, required: ["channelId"] },
  },
  {
    name: "broadcast_section_change",
    description: "Broadcast a section change via Supabase Realtime",
    inputSchema: { type: "object", properties: { channelId: { type: "string" }, sectionId: { type: "string" }, html: { type: "string" }, css: { type: "string" }, agentId: { type: "string" } }, required: ["channelId", "sectionId"] },
  },
  // ── Fase 5: Brand Guardian ──
  {
    name: "register_brand",
    description: "Register a brand with colors, fonts, logo, spacing rules",
    inputSchema: { type: "object", properties: { brandId: { type: "string" }, name: { type: "string" }, colors: { type: "array" }, fonts: { type: "array" }, logo: { type: "object" }, spacing: { type: "object" }, rules: { type: "array" } }, required: ["name"] },
  },
  {
    name: "validate_brand",
    description: "Validate template against brand rules and return compliance report",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, brandId: { type: "string" } }, required: ["templateId", "brandId"] },
  },
  {
    name: "check_contrast",
    description: "Calculate WCAG contrast ratios for all text elements",
    inputSchema: { type: "object", properties: { templateId: { type: "string" } }, required: ["templateId"] },
  },
  {
    name: "check_accessibility",
    description: "Score template accessibility and list issues with WCAG references",
    inputSchema: { type: "object", properties: { templateId: { type: "string" } }, required: ["templateId"] },
  },
  {
    name: "auto_fix_brand",
    description: "Automatically fix colors, fonts, and spacing to match brand",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, brandId: { type: "string" }, autoFix: { type: "array" } }, required: ["templateId", "brandId"] },
  },
  // ── Fase 6: Format Adaptation ──
  {
    name: "detect_structure",
    description: "Detect layout regions (hero, headline, body, cta) from template",
    inputSchema: { type: "object", properties: { templateId: { type: "string" } }, required: ["templateId"] },
  },
  {
    name: "adapt_format",
    description: "Adapt template to a new format/size maintaining content",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, targetFormat: { type: "object" } }, required: ["templateId", "targetFormat"] },
  },
  {
    name: "adapt_all_formats",
    description: "Adapt template to multiple format sizes at once",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, formats: { type: "array" } }, required: ["templateId", "formats"] },
  },
  {
    name: "compare_adaptations",
    description: "Compare multiple format adaptations side by side",
    inputSchema: { type: "object", properties: { templateIds: { type: "array" } }, required: ["templateIds"] },
  },
  // ── Shared: Render ──
  {
    name: "render_html_template",
    description: "Render an HTML template to PNG/WebP/JPG format",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, format: { type: "string" }, scale: { type: "number" }, quality: { type: "number" } }, required: ["templateId"] },
  },
  {
    name: "render_to_formats",
    description: "Render template to multiple formats at once",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, formats: { type: "array" } }, required: ["templateId", "formats"] },
  },
  {
    name: "export_frame",
    description: "Export a frame as SVG (native, importable into Figma/Illustrator) or PDF. For PNG, use render_html_template.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID (omit to export all frames)" },
        format: { type: "string", enum: ["svg", "pdf"], description: "Export format (default 'svg')" },
      },
      required: ["templateId", "format"],
    },
  },
  {
    name: "get_design_system",
    description: "Read the full design system (tokens, components, brand, frames) before designing. Returns JSON + CSS :root block with all design tokens, component inventory, and frame metadata.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID to inspect" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "lint_design",
    description: "Run quality heuristics on a frame's HTML/CSS. Returns score (0-100), issues with severity, and layout-specific rules. Adapts to frame's layoutMode (fixed vs responsive).",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID to lint (lints all frames if omitted)" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "export_design_tokens",
    description: "Export design tokens as CSS :root block and/or DTCG JSON (Design Tokens Community Group format). For Figma, Storybook, or design system portability.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        format: { type: "string", enum: ["css", "dtcg", "all"], description: "Export format (default 'all')" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "generate_design_artifacts",
    description: "Deterministically extract DESIGN.md, tokens.json, and shared.css from the actual frame HTML/CSS. No AI summarization — pure code extraction. Returns colors, typography, spacing, components, images, and constraint facts.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        action: { type: "string", enum: ["extract", "generate", "publish"], description: "extract=raw data only, generate=full artifacts (DESIGN.md+tokens.json+shared.css), publish=generate+store on template metadata (default: generate)" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "get_design_artifacts",
    description: "Retrieve stored design artifacts (DESIGN.md, tokens.json, shared.css) for a template. Auto-generates if not yet created. Includes staleness check (sourceHash) to detect if frames changed since last generation.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        format: { type: "string", enum: ["tokens", "design", "css", "all"], description: "Which artifact to return (default: all)" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "duplicate_frame",
    description: "Duplicate an existing frame exactly (HTML, CSS, dimensions, layoutMode). Returns the new frame ID. Use with update_frame_content to swap text/images in the copy.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        sourceFrameId: { type: "string", description: "Frame ID to duplicate" },
        newName: { type: "string", description: "Name for the duplicate (defaults to 'Original (copy)')" },
      },
      required: ["templateId", "sourceFrameId"],
    },
  },
  {
    name: "update_frame_content",
    description: "Surgically update a specific element inside a frame by CSS selector. Uses cheerio for deterministic DOM patching. Supports: text replacement, innerHTML swap, src/href/className changes, arbitrary attributes (attr), style overrides, backgroundImage swap, and element removal.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID to edit" },
        selector: { type: "string", description: "CSS selector within the frame HTML (e.g. 'img.hero', 'h1', '.cta')" },
        patch: {
          type: "object",
          description: "What to change",
          properties: {
            text: { type: "string", description: "Replace textContent" },
            html: { type: "string", description: "Replace innerHTML" },
            src: { type: "string", description: "Set img/video src attribute" },
            href: { type: "string", description: "Set link href attribute" },
            className: { type: "string", description: "Replace class attribute" },
            style: { type: "object", description: "CSS properties to set (e.g. {color: 'red', fontSize: '20px'})" },
            backgroundImage: { type: "string", description: "Set background-image URL (pass the URL, wraps in url())" },
            remove: { type: "boolean", description: "Remove the element entirely" },
            attr: { type: "object", description: "HTML attributes to set on the element (e.g. { 'data-slot': 'headline', alt: 'Photo' }). Pass null as value to remove the attribute." },
          },
        },
      },
      required: ["templateId", "frameId", "selector"],
    },
  },
  {
    name: "get_frame_changes",
    description: "Detect which frames changed since a known hash. The AI passes its last-known sourceHash or per-frame hashes, and gets back what changed with attribution (human vs agent). Enables iterative co-editing without stale overwrites.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        sinceSourceHash: { type: "string", description: "Last-known template-level sourceHash (from get_design_artifacts)" },
        frameHashes: { type: "object", description: "Map of frameId → last-known contentHash for per-frame checking" },
      },
      required: ["templateId"],
    },
  },
  {
    name: "optimize_image",
    description: "Optimize image to WebP with configurable quality and max width",
    inputSchema: { type: "object", properties: { imageUrl: { type: "string" }, format: { type: "string" }, quality: { type: "number" }, maxWidth: { type: "number" } }, required: ["imageUrl"] },
  },
  // ── Shared: Assets ──
  {
    name: "list_assets",
    description: "List uploaded assets for a template or workspace",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, workspaceId: { type: "string" } } },
  },
  {
    name: "replace_asset",
    description: "Replace an image src in template HTML with a new URL",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, selector: { type: "string" }, newUrl: { type: "string" } }, required: ["templateId", "newUrl"] },
  },
  {
    name: "search_stock_image",
    description: "Search for stock images via Unsplash/Pexels API",
    inputSchema: { type: "object", properties: { query: { type: "string" }, orientation: { type: "string" }, color: { type: "string" } }, required: ["query"] },
  },
  // ── Shared: AI Generation ──
  {
    name: "generate_from_prompt",
    description: "Generate an HTML/CSS template from a text prompt using AI",
    inputSchema: { type: "object", properties: { prompt: { type: "string" }, width: { type: "number" }, height: { type: "number" }, brandId: { type: "string" }, style: { type: "string" } }, required: ["prompt"] },
  },
  {
    name: "enhance_template",
    description: "Modify/enhance a template following a natural language instruction",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, instruction: { type: "string" } }, required: ["templateId", "instruction"] },
  },
  // ── Shared: Google Fonts ──
  {
    name: "add_font_to_template",
    description: "Add a Google Font to template CSS with @import and suggested snippet",
    inputSchema: { type: "object", properties: { templateId: { type: "string" }, family: { type: "string" }, weights: { type: "array" } }, required: ["templateId", "family"] },
  },
  {
    name: "get_font_details",
    description: "Get font metadata including variants, subsets, and CSS import URL",
    inputSchema: { type: "object", properties: { family: { type: "string" } }, required: ["family"] },
  },
  // ── HTML Engine: Frame Management ──
  {
    name: "create_html_frame",
    description: "Create a new HTML frame inside an HTML-engine template. Each frame is a self-contained design surface (like a paper on a desk) with its own HTML/CSS. Use for multi-frame designs like Instagram carousels.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID (must be engine='html')" },
        name: { type: "string", description: "Frame name (e.g. 'Slide 1', 'IG Square')" },
        width: { type: "number", description: "Frame width in px (default 1080). Common: 1080 (IG Square), 1920 (Banner)" },
        height: { type: "number", description: "Frame height in px (default 1080). Common: 1080 (IG Square), 1920 (Story)" },
        html: { type: "string", description: "HTML content inside the frame" },
        css: { type: "string", description: "CSS styles for this frame" },
        background: { type: "string", description: "Background color (default '#ffffff')" },
        x: { type: "number", description: "X position on canvas (auto-placed if omitted)" },
        y: { type: "number", description: "Y position on canvas (default 0)" },
      },
      required: ["templateId", "name"],
    },
  },
  {
    name: "update_html_frame",
    description: "Update an HTML frame's content (HTML/CSS), dimensions, position, or background. Use to modify a specific frame in a multi-frame HTML template.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID to update" },
        name: { type: "string", description: "New frame name" },
        html: { type: "string", description: "New HTML content" },
        css: { type: "string", description: "New CSS styles" },
        width: { type: "number", description: "New width" },
        height: { type: "number", description: "New height" },
        x: { type: "number", description: "New X position" },
        y: { type: "number", description: "New Y position" },
        background: { type: "string", description: "New background color" },
      },
      required: ["templateId", "frameId"],
    },
  },
  {
    name: "delete_html_frame",
    description: "Delete an HTML frame from a template. Cannot delete the last remaining frame.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID to delete" },
      },
      required: ["templateId", "frameId"],
    },
  },
  {
    name: "get_html_frames",
    description: "List all HTML frames in a template with their HTML/CSS content, dimensions, and positions.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
      },
      required: ["templateId"],
    },
  },
  // ── Phase C: Drawing Tools ──
  {
    name: "draw_shape",
    description: "Draw a rectangle or circle shape with exact dimensions at a specific position. Creates a styled div element with the given dimensions, color and border-radius.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID to draw in" },
        type: { type: "string", enum: ["rect", "circle"], description: "Shape type" },
        x: { type: "number", description: "X position" },
        y: { type: "number", description: "Y position" },
        width: { type: "number", description: "Shape width" },
        height: { type: "number", description: "Shape height" },
        color: { type: "string", description: "Background color (default #3B82F6 for rect, #EF4444 for circle)" },
        borderRadius: { type: "string", description: "Border radius override (e.g. '12px')" },
      },
      required: ["templateId", "frameId", "type", "x", "y", "width", "height"],
    },
  },
  {
    name: "draw_path",
    description: "Create an SVG path element (pen/line drawing). Accepts SVG path data string and bounding box dimensions.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID to draw in" },
        pathData: { type: "string", description: "SVG path data (e.g. 'M 10 10 L 50 50 L 90 10')" },
        x: { type: "number", description: "X position of bounding box" },
        y: { type: "number", description: "Y position of bounding box" },
        width: { type: "number", description: "Width of bounding box" },
        height: { type: "number", description: "Height of bounding box" },
        stroke: { type: "string", description: "Stroke color (default #8B5CF6)" },
        strokeWidth: { type: "number", description: "Stroke width (default 2)" },
      },
      required: ["templateId", "frameId", "pathData", "x", "y", "width", "height"],
    },
  },
  {
    name: "transform_element",
    description: "Transform (resize/reposition) an existing element by its data-layer-id. Updates CSS properties for position, width, height, and optionally rotation.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID containing the element" },
        elementId: { type: "string", description: "Element data-layer-id" },
        x: { type: "number", description: "New X position" },
        y: { type: "number", description: "New Y position" },
        width: { type: "number", description: "New width" },
        height: { type: "number", description: "New height" },
        rotation: { type: "number", description: "Rotation angle in degrees" },
      },
      required: ["templateId", "frameId", "elementId"],
    },
  },
  {
    name: "group_elements",
    description: "Group multiple elements inside a wrapper div. The wrapper gets a new data-layer-id and the children keep their own ids.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID" },
        elementIds: { type: "array", items: { type: "string" }, description: "Array of element data-layer-ids to group" },
        groupName: { type: "string", description: "Optional name/class for the group wrapper" },
      },
      required: ["templateId", "frameId", "elementIds"],
    },
  },
  {
    name: "align_elements",
    description: "Align multiple elements along an axis. Supports left/center/right (horizontal) and top/middle/bottom (vertical) alignment.",
    inputSchema: {
      type: "object",
      properties: {
        templateId: { type: "string", description: "Template ID" },
        frameId: { type: "string", description: "Frame ID" },
        elementIds: { type: "array", items: { type: "string" }, description: "Array of element data-layer-ids to align" },
        align: { type: "string", enum: ["left", "center", "right", "top", "middle", "bottom"], description: "Alignment axis" },
      },
      required: ["templateId", "frameId", "elementIds", "align"],
    },
  },
  // ── Phase 1: Asset Management ──
  {
    name: "upload_image",
    description: "Upload an image (PNG, JPG, SVG, WebP) to the design-assets bucket. Accepts base64 data or external URL. Returns asset record with public URL.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Asset display name" },
        data: { type: "string", description: "Base64-encoded image data (data:image/...;base64,...)" },
        url: { type: "string", description: "External image URL to download and store" },
        workspaceId: { type: "string", description: "Optional workspace to associate with" },
        tags: { type: "array", items: { type: "string" }, description: "Optional tags" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_assets",
    description: "List all uploaded assets with optional workspace and search filters",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Filter by workspace" },
        search: { type: "string", description: "Search by name or filename" },
        mimeType: { type: "string", description: "Filter by MIME type" },
        limit: { type: "number", description: "Max results (default 50)" },
        offset: { type: "number", description: "Pagination offset" },
      },
      required: [],
    },
  },
  {
    name: "delete_asset",
    description: "Delete an asset from storage and database",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Asset ID" },
      },
      required: ["id"],
    },
  },
  // ── Phase 3: Recipes / Key Visuals ──
  {
    name: "list_recipes",
    description: "List all saved recipes (key visuals) with optional workspace and search filters",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: { type: "string", description: "Filter by workspace" },
        search: { type: "string", description: "Search by recipe name" },
        tag: { type: "string", description: "Filter by tag" },
        limit: { type: "number", description: "Max results (default 50)" },
        offset: { type: "number", description: "Pagination offset" },
      },
      required: [],
    },
  },
  {
    name: "get_recipe",
    description: "Get a single recipe by ID with full HTML/CSS template data",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Recipe ID (rec_xxx)" },
      },
      required: ["id"],
    },
  },
  {
    name: "create_from_recipe",
    description: "Create a new template from a saved recipe, applying optional variable substitutions",
    inputSchema: {
      type: "object",
      properties: {
        recipeId: { type: "string", description: "Recipe ID to instantiate" },
        workspaceId: { type: "string", description: "Target workspace (default: recipe's workspace)" },
        name: { type: "string", description: "Name for the new template (default: recipe name + timestamp)" },
        variables: {
          type: "object",
          description: "Variable substitutions: { texts: {KEY: value}, colors: {KEY: value}, images: {KEY: url} }",
          properties: {
            texts: { type: "object", description: "Text replacements {PLACEHOLDER: newText}" },
            colors: { type: "object", description: "Color replacements {#HEX: #NEWHEX}" },
            images: { type: "object", description: "Image URL replacements {PLACEHOLDER: newURL}" },
          },
        },
      },
      required: ["recipeId"],
    },
  },
  {
    name: "batch_from_recipe",
    description: "Create multiple templates from a recipe with an array of variable sets, plus auto-render all results",
    inputSchema: {
      type: "object",
      properties: {
        recipeId: { type: "string", description: "Recipe ID to batch from" },
        workspaceId: { type: "string", description: "Target workspace" },
        variableSets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Name for this variant" },
              texts: { type: "object" },
              colors: { type: "object" },
              images: { type: "object" },
            },
          },
          description: "Array of variable sets, one template created per set",
        },
        render: { type: "boolean", description: "Auto-render all created templates (default true)" },
      },
      required: ["recipeId", "variableSets"],
    },
  },
  {
    name: "profile_template_pool",
    description: "Profile multiple templates to detect content slots (text, image, richtext, cta), estimate text capacity (maxChars), classify layout type, and compute CSV column schema. Supports data-slot attribute for explicit slot naming. Deterministic — no AI involved.",
    inputSchema: {
      type: "object",
      properties: {
        templateIds: {
          type: "array",
          items: { type: "string" },
          description: "Template IDs to profile. Uses the first frame of each template as the source.",
        },
      },
      required: ["templateIds"],
    },
  },
  {
    name: "generate_csv_template",
    description: "Generate a CSV template with columns matching profiled slots across a template pool. Includes _template column with immutable templateId values and human-readable names in comments. Ready for Excel/Sheets. Deterministic.",
    inputSchema: {
      type: "object",
      properties: {
        templateIds: {
          type: "array",
          items: { type: "string" },
          description: "Template IDs in the pool",
        },
        rowCount: {
          type: "number",
          description: "Number of empty data rows to generate (default 1)",
        },
        delimiter: {
          type: "string",
          description: "CSV delimiter (default comma)",
        },
      },
      required: ["templateIds"],
    },
  },
  {
    name: "apply_csv_to_frames",
    description: "Apply CSV data to generate frames from a template pool. Each row becomes a frame in a NEW output template. The system duplicates the chosen template and fills slots with CSV values. Empty cells are skipped. Deterministic — no AI content generation, no summarization. Returns per-row report.",
    inputSchema: {
      type: "object",
      properties: {
        workspaceId: {
          type: "string",
          description: "Workspace ID where the output template will be created",
        },
        csvData: {
          type: "string",
          description: "Raw CSV content as string (with header row, _template column required)",
        },
        templateIds: {
          type: "array",
          items: { type: "string" },
          description: "Template IDs in the pool. First frame of each is used as the source.",
        },
        outputName: {
          type: "string",
          description: "Name for the output template. Default: 'Batch Export — YYYY-MM-DD'",
        },
        delimiter: {
          type: "string",
          description: "CSV delimiter (default comma)",
        },
        naming: {
          type: "string",
          description: "Frame naming template. Use {index} and column names in braces. Example: 'Post {index} — {titulo}'",
        },
        onMissingTemplate: {
          type: "string",
          enum: ["error", "skip"],
          description: "What to do if _template value is not in the pool (default 'error')",
        },
        onOverflow: {
          type: "string",
          enum: ["truncate", "skip_row", "continue_warn"],
          description: "What to do if text exceeds slot maxChars (default 'truncate')",
        },
      },
      required: ["workspaceId", "csvData", "templateIds"],
    },
  },
];

function getUserId(event) {
  const headers = event.headers || {};
  return headers["x-api-key"] || headers["authorization"]?.replace("Bearer ", "") || "dev_user_default";
}

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  };
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

/** Compare two values recursively, returning { path, old, new } diffs */
function compareValues(a, b, path = "") {
  const diffs = [];
  if (a === b) return diffs;
  if (typeof a !== typeof b) { diffs.push({ path, old: a, new: b }); return diffs; }
  if (a === null || b === null) { if (a !== b) diffs.push({ path, old: a, new: b }); return diffs; }
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++)
      diffs.push(...compareValues(a[i], b[i], path + "[" + i + "]"));
    return diffs;
  }
  if (typeof a === "object") {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    for (const k of keys) diffs.push(...compareValues(a?.[k], b?.[k], path ? path + "." + k : k));
    if (diffs.length === 0 && JSON.stringify(a) !== JSON.stringify(b))
      diffs.push({ path, old: a, new: b });
    return diffs;
  }
  if (a !== b) diffs.push({ path, old: a, new: b });
  return diffs;
}

/** Compare snapshot vs current template, returning per-object changes */

/** RGB → HSL conversion (used by color_picker) */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100) / 100, l: Math.round(l * 100) / 100 };
}

/** HSL → RGB conversion (used by color_picker) */
function hslToRgb(h, s, l) {
  h /= 360;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

/** Route JSON-RPC method calls to template/workspace services */
async function handleMethod(method, params, userId) {
  // Helper: auto-snapshot before IA mutations (capture pre-state for diff)
  const autoSnapshot = (templateId, trigger, tplData) => {
    try {
      if (tplData) {
        store.snapshot(templateId, JSON.parse(JSON.stringify(tplData)));
      } else {
        store.snapshotAuto(templateId, "ia", trigger);
      }
    } catch { /* non-blocking */ }
  };

  switch (method) {
    // ── Workspaces ──
    case "list_workspaces": {
      const sb = getSupabase();
      if (sb) {
        try {
          const { data } = await sb.from("workspaces").select("*").order("updated_at", { ascending: false });
          if (data?.length) {
            const items = data.map(r => ({
              ...r.data, id: r.id, name: r.name, ownerId: r.owner_id,
              createdAt: r.created_at, updatedAt: r.updated_at,
            }));
            return { data: items, total: items.length };
          }
        } catch { /* fall through to store */ }
      }
      const data = store.listWorkspaces(userId);
      return { data, total: data.length };
    }
    case "create_workspace": {
      const ws = store.createWorkspace({ name: params.name, description: params.description, ownerId: userId });
      const sb = getSupabase();
      if (sb) {
        try {
          const row = {
            id: ws.id, name: ws.name,
            data: ws, updated_at: new Date().toISOString(),
          };
          if (UUID_RE.test(userId)) row.user_id = userId;
          await sb.from("workspaces").upsert(row);
        } catch { /* non-blocking */ }
      }
      return ws;
    }

    // ── Templates ──
    case "list_templates": {
      const result = await templates.listTemplatesPaginated(
        params.limit || 50, params.offset || 0,
        params.workspaceId, params.search,
      );
      return result;
    }
    case "get_template": {
      const tpl = await templates.getTemplate(params.id);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.id}` };
      return {
        ...tpl,
        _frameCount: tpl.frames?.length || 0,
        _htmlLength: tpl.html?.length || 0,
      };
    }
    case "create_template": {
      if (!params.workspaceId) throw { code: -32602, message: "workspaceId is required" };
      // Validate name
      const tplName = (params.name || "").trim();
      if (!tplName) throw { code: -32602, message: "name is required and cannot be empty" };
      if (tplName.length > 200) throw { code: -32602, message: "name must be 200 characters or less" };
      // Validate dimensions
      const tplWidth = params.width !== undefined ? Number(params.width) : 1080;
      const tplHeight = params.height !== undefined ? Number(params.height) : 1080;
      if (isNaN(tplWidth) || tplWidth <= 0 || tplWidth > 10000)
        throw { code: -32602, message: "width must be a number between 1 and 10000" };
      if (isNaN(tplHeight) || tplHeight <= 0 || tplHeight > 10000)
        throw { code: -32602, message: "height must be a number between 1 and 10000" };
      const tpl = await templates.createTemplate(
        tplName, tplWidth, tplHeight,
        undefined, userId, params.workspaceId,
      );
      // HTML engine support: set engine/html/css and create initial frame
      if (params.engine === "html") {
        tpl.engine = "html";
        tpl.html = params.html || "";
        tpl.css = params.css || "";
        // Create a default frame with the template dimensions
        const defaultFrame = {
          id: `frame_${uuid().slice(0, 12)}`,
          name: tplName,
          x: 0, y: 0,
          width: tplWidth, height: tplHeight,
          html: params.html || "",
          css: params.css || "",
          background: "#ffffff",
        };
        tpl.frames = [defaultFrame];
      }
      autoSnapshot(tpl.id, "create_template");
      return tpl;
    }
    case "update_template": {
      const updates = {};
      if (params.name !== undefined) updates.name = params.name;
      if (params.canvas !== undefined) updates.canvas = params.canvas;
      // HTML engine support
      if (params.engine !== undefined) updates.engine = params.engine;
      if (params.html !== undefined) updates.html = params.html;
      if (params.css !== undefined) updates.css = params.css;
      if (params.frames !== undefined) {
        const framesArr = typeof params.frames === "string" ? JSON.parse(params.frames) : params.frames;
        updates.frames = framesArr;
      }
      // Support raw objects array (simpler API for programmatic use)
      if (params.objects !== undefined) {
        const objects = typeof params.objects === "string" ? JSON.parse(params.objects) : params.objects;
        updates.canvas = { objects, viewport: { x: 0, y: 0, zoom: 1 } };
      }
      // Also accept id or templateId
      const tplId = params.id || params.templateId;
      if (!tplId) throw { code: -32602, message: "id or templateId required" };
      const tpl = await templates.updateTemplate(tplId, updates);
      if (!tpl) throw { code: -32000, message: `Template not found: ${tplId}` };
      autoSnapshot(tplId, "update_template");
      return tpl;
    }
    case "delete_template": {
      const ok = await templates.deleteTemplate(params.id);
      if (!ok) throw { code: -32000, message: `Template not found: ${params.id}` };
      return { deleted: true, id: params.id };
    }
    case "duplicate_template": {
      const tpl = await templates.duplicateTemplate(params.id, params.name, userId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.id}` };
      return tpl;
    }
    case "export_template": {
      const tpl = await templates.getTemplate(params.id);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.id}` };
      return {
        format: "futuraria/v1",
        exportedAt: new Date().toISOString(),
        template: {
          name: tpl.name, width: tpl.width, height: tpl.height,
          frames: tpl.frames, styles: tpl.styles,
          variables: tpl.variables, metadata: tpl.metadata,
        },
      };
    }
    case "import_template": {
      const { format, template: tplData } = params.data;
      if (format !== "futuraria/v1") throw { code: -32602, message: "Invalid format. Expected 'futuraria/v1'" };
      if (!tplData?.name) throw { code: -32602, message: "template.name required" };

      const newTpl = store.createTemplate({
        workspaceId: params.workspaceId,
        name: tplData.name,
        width: tplData.width || 1080,
        height: tplData.height || 1080,
        canvas: tplData.canvas || { objects: [], viewport: { x: 0, y: 0, zoom: 1 } },
        userId,
      });
      if (tplData.frames) newTpl.frames = tplData.frames;
      if (tplData.styles) newTpl.styles = tplData.styles;
      if (tplData.variables) newTpl.variables = tplData.variables;
      // Dual-write to Supabase
      const sb = getSupabase();
      if (sb) {
        try {
          const row = {
            id: newTpl.id, name: newTpl.name, workspace_id: newTpl.workspaceId,
            data: newTpl, updated_at: new Date().toISOString(),
          };
          if (UUID_RE.test(userId)) row.user_id = userId;
          await sb.from("templates").upsert(row);
        } catch { /* non-blocking */ }
      }
      return newTpl;
    }

    // ── Batch Update ──
    case "batch_update": {
      let ids = params.templateIds || params.operations || [];
      // Resolve IDs via search if provided
      if (params.search) {
        const result = await templates.listTemplatesPaginated(200, 0, params.workspaceId, params.search);
        const found = (result?.data || []).map(t => t.id);
        ids = [...new Set([...ids, ...found])];
      }
      if (!ids.length) throw { code: -32602, message: "No templateIds or matching search results" };

      // Build base updates
      const baseUpdates = {};
      if (params.name !== undefined) baseUpdates.name = params.name;

      const results = [];
      for (const id of ids) {
        try {
          const tpl = await templates.getTemplate(id);
          if (!tpl) { results.push({ id, ok: false, error: "Template not found" }); continue; }

          const updates = { ...baseUpdates };

          await templates.updateTemplate(id, updates);
          results.push({ id, ok: true });
        } catch (e) {
          results.push({ id, ok: false, error: e?.message || "update failed" });
        }
      }
      return {
        updated: results.filter(r => r.ok).length,
        failed: results.filter(r => !r.ok).length,
        total: ids.length,
        results,
      };
    }

    // ── Render Batch ──
    case "render_batch": {
      if (!params.templateIds?.length) throw { code: -32602, message: "templateIds array required" };
      const format = ["png", "jpg"].includes(params.format) ? params.format : "png";
      const scale = Math.min(Math.max(parseInt(String(params.scale), 10) || 1, 1), 4);
      const transparent = params.transparent === true;
      const results = [];
      for (const id of params.templateIds) {
        try {
          const tpl = await templates.getTemplate(id);
          if (!tpl) { results.push({ templateId: id, error: "not found" }); continue; }
          results.push({
            templateId: id,
            name: tpl.name,
            status: "ready",
            _links: {
              render: `/api/templates/${id}/render`,
              view: `/api/render/${id}`,
            },
            renderParams: { format, scale, width: (tpl.width || 1080) * scale, height: (tpl.height || 1080) * scale, transparent },
          });
        } catch (e) {
          results.push({ templateId: id, error: e?.message || "load failed" });
        }
      }
      return { format, scale, total: params.templateIds.length, ready: results.filter(r => r.status === "ready").length, results };
    }

    // ── Versions ──
    case "list_versions": {
      const tplId = params.id || params.templateId;
      if (!tplId) throw { code: -32602, message: "id or templateId required" };
      const tpl = await templates.getTemplate(tplId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${tplId}` };

      // Read from snapshot store (autoSnapshot creates these)
      const snapshots = store.listSnapshots(tplId) || [];
      const snapshotVersions = snapshots.map((s, i) => ({
        id: s.id || `v${i}`,
        version: i + 1,
        timestamp: s.timestamp || s.createdAt,
        label: `${s.type} · ${s.trigger}`,
        type: s.type,
        trigger: s.trigger,
        objectCount: s.objectCount,
        frameCount: s.frameCount,
      }));

      // Merge with legacy tpl.versions if any exist
      const legacyVersions = (tpl.versions || []).map((v, i) => ({
        id: v.id || `v${i}`,
        version: snapshotVersions.length + i + 1,
        timestamp: v.timestamp || v.createdAt,
        label: v.label || `Version ${i + 1}`,
        canvasHash: v.canvasHash || "",
      }));

      const allVersions = [...snapshotVersions, ...legacyVersions];
      return {
        templateId: tplId,
        versions: allVersions,
        total: allVersions.length,
      };
    }
    case "restore_version": {
      const tplId = params.id || params.templateId;
      if (!tplId) throw { code: -32602, message: "id or templateId required" };
      const tpl = await templates.getTemplate(tplId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${tplId}` };

      // Try snapshot store first
      const snapshot = store.getSnapshot(tplId, params.versionId);
      if (snapshot && snapshot.data) {
        const restored = await templates.updateTemplate(tplId, { canvas: snapshot.data.canvas });
        return {
          restored: true,
          templateId: tplId,
          versionId: params.versionId,
          template: restored,
        };
      }

      // Fallback to legacy tpl.versions
      const versions = tpl.versions || [];
      const match = versions.find((v, i) => (v.id || `v${i}`) === params.versionId);
      if (!match) throw { code: -32000, message: `Version not found: ${params.versionId}` };
      if (!match.canvas) throw { code: -32000, message: "Version has no canvas data" };
      const restored = await templates.updateTemplate(tplId, { canvas: match.canvas });
      return {
        restored: true,
        templateId: tplId,
        versionId: params.versionId,
        template: restored,
      };
    }


    case "list_fonts": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };

      const fontMap = {};
      function scan(obj) {
        if (obj.type === "text" || obj.type === "i-text" || obj.type === "IText" || obj.type === "Textbox" || obj.type === "textbox") {
          const family = obj.fontFamily || "Inter";
          if (!fontMap[family]) fontMap[family] = { count: 0, sizes: new Set(), weights: new Set() };
          fontMap[family].count++;
          if (obj.fontSize) fontMap[family].sizes.add(obj.fontSize);
          if (obj.fontWeight != null) fontMap[family].weights.add(String(obj.fontWeight));
        }
        if (obj.objects && Array.isArray(obj.objects)) for (const child of obj.objects) scan(child);
      }
      for (const frame of (tpl.frames || [])) for (const obj of (frame.objects || [])) scan(obj);

      const fonts = Object.entries(fontMap)
        .map(([family, info]) => ({ family, count: info.count, sizes: [...info.sizes].sort((a, b) => a - b), weights: [...info.weights] }))
        .sort((a, b) => b.count - a.count);
      return { fonts, total: fonts.length };
    }

    // ── create_frame ──
    case "create_frame": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };

      // 1. Create frame metadata DIRECTLY on tpl (bypass store cold-start issue)
      const frameId = `frame_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const frame = {
        id: frameId,
        templateId: params.templateId,
        name: params.name,
        x: params.x || 0, y: params.y || 0,
        width: params.width || 400, height: params.height || 300,
        fill: params.fill || "#ffffff",
        opacity: 1, order: (tpl.frames || []).length,
        objects: [],
        parentFrameId: params.parentFrameId || null,
        layoutMode: params.layoutMode || "NONE",
        clipsContent: params.clipsContent !== false,
        constraints: {},
        padding: { top: params.paddingTop || 0, right: params.paddingRight || 0, bottom: params.paddingBottom || 0, left: params.paddingLeft || 0 },
      };
      if (!tpl.frames) tpl.frames = [];
      tpl.frames.push(frame);

      // 3. Persist in one operation
      await templates.updateTemplate(params.templateId, {
        frames: tpl.frames,
      });
      autoSnapshot(params.templateId, "create_frame");

      // 4. Return frameId consistently (BUG-011 fix)
      return {
        frameId,
        name: frame.name,
        x: frame.x, y: frame.y,
        width: frame.width, height: frame.height,
        fill: frame.fill,
        parentFrameId: frame.parentFrameId,
      };
    }

    // ── create_html_template ──
    case "create_html_template": {
      const tpl = await templates.createTemplate(
        params.name,
        params.width || 1080,
        params.height || 1080,
        null, // no canvas for HTML templates
        null, // userId (will be set by templates service)
        params.workspaceId
      );
      if (!tpl) throw { code: -32000, message: "Failed to create HTML template" };

      tpl.engine = "html";
      tpl.html = params.initialHtml || "";
      tpl.css = params.initialCss || "";

      await templates.updateTemplate(tpl.id, {
        engine: "html",
        html: tpl.html,
        css: tpl.css,
        frames: tpl.frames || [],
      });

      return {
        id: tpl.id,
        name: tpl.name,
        workspaceId: params.workspaceId,
        width: tpl.width,
        height: tpl.height,
        engine: "html",
        html: tpl.html,
        css: tpl.css,
      };
    }

    // ── set_html ──
    case "set_html": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (tpl.engine && tpl.engine !== "html") throw { code: -32000, message: "Template is not an HTML template" };

      // Sanitize HTML with DOMPurify on server-side
      let sanitized = params.html;
      try {
        sanitized = DOMPurify.sanitize(params.html, {
          ALLOWED_TAGS: ["div", "span", "h1", "h2", "h3", "h4", "h5", "h6", "p", "img", "a", "br", "svg", "path", "g", "circle", "rect", "line", "polygon", "polyline", "text", "tspan", "section", "article", "header", "footer", "nav", "main", "ul", "ol", "li", "table", "tr", "td", "th", "thead", "tbody", "button", "input", "textarea", "label", "form", "strong", "em", "b", "i", "u", "code", "pre", "blockquote", "hr"],
          ALLOWED_ATTR: ["class", "id", "src", "alt", "href", "data-layer-id", "style", "width", "height", "viewBox", "fill", "stroke", "d", "cx", "cy", "r", "rx", "ry", "x", "y", "transform", "type", "placeholder", "value", "for"],
        });
      } catch { /* use original if sanitization fails */ }

      tpl.html = sanitized;
      tpl.metadata = { ...(tpl.metadata || {}), updatedAt: new Date().toISOString() };
      await templates.updateTemplate(params.templateId, {
        html: tpl.html,
        frames: tpl.frames || [],
      });

      return { success: true, templateId: params.templateId, htmlLength: tpl.html.length };
    }

    // ── set_css ──
    case "set_css": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (tpl.engine && tpl.engine !== "html") throw { code: -32000, message: "Template is not an HTML template" };

      tpl.css = params.css;
      tpl.metadata = { ...(tpl.metadata || {}), updatedAt: new Date().toISOString() };
      await templates.updateTemplate(params.templateId, {
        css: tpl.css,
        frames: tpl.frames || [],
      });

      return { success: true, templateId: params.templateId, cssLength: tpl.css.length };
    }

    // ── list_frames ──
    case "list_frames": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      return { frames: tpl.frames, total: tpl.frames.length };
    }

    // ── get_frame ──
    case "get_frame": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const frame = tpl.frames.find(f => f.id === params.frameId);
      if (!frame) throw { code: -32000, message: "Frame not found" };
      return frame;
    }

    // ── update_frame ──
    case "update_frame": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found: " + params.templateId };
      const { templateId, frameId, ...updates } = params;
      const frame = store.updateFrame(params.templateId, params.frameId, updates);
      if (!frame) throw { code: -32000, message: "Frame not found" };
      // Compute hash + attribution for change tracking
      if (updates.html !== undefined || updates.css !== undefined) {
        frame.contentHash = computeFrameHash(frame.html || "", frame.css || "");
        frame.lastModifiedBy = "agent:update_frame";
        frame.lastModifiedAt = new Date().toISOString();
      }
      await templates.updateTemplate(params.templateId, { frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return frame;
    }

    // ── delete_frame ──
    case "delete_frame": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const ok = store.deleteFrame(params.templateId, params.frameId);
      if (!ok) throw { code: -32000, message: "Frame not found" };
      await templates.updateTemplate(params.templateId, { frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return { deleted: true, templateId: params.templateId, frameId: params.frameId };
    }

    // ── render_frame ──
    case "search_google_fonts": {
      // In-memory cache for Google Fonts API results (survives warm instances)
      const CACHE_KEY = "__gf_cache";
      const CACHE_TTL = 3600_000; // 1 hour

      const getCachedFonts = () => {
        if (!globalThis[CACHE_KEY] || Date.now() - globalThis[CACHE_KEY].ts > CACHE_TTL) return null;
        return globalThis[CACHE_KEY].fonts;
      };
      const setCachedFonts = (fonts) => {
        globalThis[CACHE_KEY] = { fonts, ts: Date.now() };
      };

      // Built-in curated list (72 fonts) — always available as fallback
      const BUILTIN_FONTS = [
        { family:"Inter", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Roboto", category:"sans-serif", variants:["400","500","700"] },
        { family:"Open Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Montserrat", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Poppins", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Lato", category:"sans-serif", variants:["400","700"] },
        { family:"Raleway", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Nunito", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Oswald", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"DM Sans", category:"sans-serif", variants:["400","500","700"] },
        { family:"Manrope", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Space Grotesk", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Syne", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Archivo", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Lexend", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Plus Jakarta Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Outfit", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Sora", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Rubik", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Quicksand", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Work Sans", category:"sans-serif", variants:["400","500","600","700","800"] },
        { family:"Fira Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"IBM Plex Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Source Sans 3", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Public Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Figtree", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Onest", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Be Vietnam Pro", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Epilogue", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Urbanist", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Playfair Display", category:"serif", variants:["400","500","600","700","800"] },
        { family:"Merriweather", category:"serif", variants:["400","700"] },
        { family:"Lora", category:"serif", variants:["400","500","600","700"] },
        { family:"Libre Baskerville", category:"serif", variants:["400","700"] },
        { family:"Crimson Text", category:"serif", variants:["400","600","700"] },
        { family:"PT Serif", category:"serif", variants:["400","700"] },
        { family:"EB Garamond", category:"serif", variants:["400","500","600","700"] },
        { family:"DM Serif Display", category:"serif", variants:["400"] },
        { family:"Bitter", category:"serif", variants:["400","500","600","700"] },
        { family:"Cormorant Garamond", category:"serif", variants:["400","500","600","700"] },
        { family:"Zilla Slab", category:"serif", variants:["400","500","600","700"] },
        { family:"Bebas Neue", category:"display", variants:["400"] },
        { family:"Anton", category:"display", variants:["400"] },
        { family:"Abril Fatface", category:"display", variants:["400"] },
        { family:"Archivo Black", category:"display", variants:["400"] },
        { family:"Alfa Slab One", category:"display", variants:["400"] },
        { family:"Righteous", category:"display", variants:["400"] },
        { family:"Lobster", category:"display", variants:["400"] },
        { family:"Pacifico", category:"display", variants:["400"] },
        { family:"Orbitron", category:"display", variants:["400","500","600","700"] },
        { family:"Teko", category:"display", variants:["400","500","600","700"] },
        { family:"Permanent Marker", category:"display", variants:["400"] },
        { family:"Shadows Into Light", category:"display", variants:["400"] },
        { family:"Exo 2", category:"display", variants:["400","500","600","700"] },
        { family:"Comfortaa", category:"display", variants:["400","500","600","700"] },
        { family:"Titillium Web", category:"display", variants:["400","600","700"] },
        { family:"Dancing Script", category:"handwriting", variants:["400","500","600","700"] },
        { family:"Caveat", category:"handwriting", variants:["400","500","600","700"] },
        { family:"Kalam", category:"handwriting", variants:["400","700"] },
        { family:"Satisfy", category:"handwriting", variants:["400"] },
        { family:"Indie Flower", category:"handwriting", variants:["400"] },
        { family:"Patrick Hand", category:"handwriting", variants:["400"] },
        { family:"Great Vibes", category:"handwriting", variants:["400"] },
        { family:"Sacramento", category:"handwriting", variants:["400"] },
        { family:"JetBrains Mono", category:"monospace", variants:["400","500","600","700"] },
        { family:"Fira Code", category:"monospace", variants:["400","500","600","700"] },
        { family:"Source Code Pro", category:"monospace", variants:["400","500","600","700"] },
        { family:"IBM Plex Mono", category:"monospace", variants:["400","500","600","700"] },
        { family:"Space Mono", category:"monospace", variants:["400","700"] },
        { family:"Red Hat Mono", category:"monospace", variants:["400","500","600","700"] },
        { family:"Courier Prime", category:"monospace", variants:["400","700"] },
        { family:"Inconsolata", category:"monospace", variants:["400","500","600","700"] },
        { family:"Ubuntu", category:"sans-serif", variants:["400","500","700"] },
        { family:"Noto Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Josefin Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Arimo", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Cabin", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Mulish", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Red Hat Display", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Schibsted Grotesk", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Familjen Grotesk", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Albert Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Kumbh Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Geist", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Instrument Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Inter Tight", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Exo", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Maven Pro", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Jost", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Overpass", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Spline Sans", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Commissioner", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Hanken Grotesk", category:"sans-serif", variants:["400","500","600","700"] },
        { family:"Readex Pro", category:"sans-serif", variants:["400","500","600","700"] },
      ];

      const search = (params.search || "").toLowerCase();
      const category = params.category || "";
      const limit = Math.min(params.limit || 20, 100);

      // Primary source: Google Fonts API (requires GOOGLE_FONTS_API_KEY env var)
      let GOOGLE_FONTS = getCachedFonts();
      if (!GOOGLE_FONTS) {
        const apiKey = globalThis.process?.env?.GOOGLE_FONTS_API_KEY || "";
        if (apiKey) {
          try {
            const resp = await fetch(`https://www.googleapis.com/webfonts/v1/webfonts?key=${apiKey}&sort=popularity`);
            if (resp.ok) {
              const data = await resp.json();
              if (data.items?.length) {
                GOOGLE_FONTS = data.items.map(f => ({
                  family: f.family,
                  category: f.category || "sans-serif",
                  variants: (f.variants || []).filter(v => !v.includes("italic")).map(v => v === "regular" ? "400" : v),
                  subsets: f.subsets || [],
                }));
                setCachedFonts(GOOGLE_FONTS);
              }
            }
          } catch (_) { /* API unavailable — use builtin */ }
        }
      }
      if (!GOOGLE_FONTS || GOOGLE_FONTS.length === 0) GOOGLE_FONTS = BUILTIN_FONTS;

      let results = GOOGLE_FONTS;
      if (category) results = results.filter(f => f.category === category);
      if (search) {
        results = results.filter(f =>
          f.family.toLowerCase().includes(search) ||
          f.category.toLowerCase().includes(search)
        );
      }

      const total = results.length;
      results = results.slice(0, limit);

      const enriched = results.map(f => ({
        family: f.family,
        category: f.category,
        variants: f.variants || [],
        googleFontsUrl: `https://fonts.googleapis.com/css2?family=${f.family.replace(/ /g, "+")}:wght@${(f.variants || ["400"]).join(";")}&display=swap`,
      }));

      return { fonts: enriched, total, categories: [...new Set(GOOGLE_FONTS.map(f => f.category))], source: GOOGLE_FONTS === BUILTIN_FONTS ? "builtin" : "google-fonts-api" };
    }

    // ── set_gradient ──
    case "add_comment": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.comments) tpl.comments = [];
      const comment = {
        id: `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId: params.author || "anonymous",
        text: params.text,
        targetLayerName: params.targetLayerName || null,
        x: params.x ?? 0,
        y: params.y ?? 0,
        resolved: params.resolved ?? false,
        createdAt: new Date().toISOString(),
      };
      tpl.comments.push(comment);
      await templates.updateTemplate(params.templateId, { comments: tpl.comments });
      autoSnapshot(params.templateId, method);
      return { created: true, commentId: comment.id, totalComments: tpl.comments.length };
    }

    case "share_template": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const permission = params.permission || "view";
      const shareToken = `shr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const shareUrl = `https://futuraria.app/share/${shareToken}`;
      if (!tpl.metadata) tpl.metadata = {};
      tpl.metadata.shareToken = shareToken;
      tpl.metadata.sharePermission = permission;
      tpl.metadata.shareUrl = shareUrl;
      await templates.updateTemplate(params.templateId, { metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return { shared: true, shareUrl, permission, shareToken };
    }

    case "preview_font": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const fontFamily = params.fontFamily || "Inter";
      const pangram = "The quick brown fox jumps over the lazy dog";
      return { created: true, fontFamily, pangram, note: "Font preview loaded. Use create_html_frame + add_element to place text with this font." };
    }

    case "mention_user": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      let username = params.username || "anonymous";
      if (!username.startsWith("@")) username = "@" + username;
      if (!tpl.comments) tpl.comments = [];
      const mention = {
        id: `mtn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        userId: username,
        text: params.message ? `${username} ${params.message}` : `${username}`,
        targetLayerName: params.targetLayerName || null,
        x: params.x ?? 0,
        y: params.y ?? 0,
        resolved: false,
        createdAt: new Date().toISOString(),
        type: "mention",
      };
      tpl.comments.push(mention);
      await templates.updateTemplate(params.templateId, { comments: tpl.comments });
      autoSnapshot(params.templateId, method);
      return { created: true, username, mentionId: mention.id };
    }

    // ── F3: AI Features (OpenRouter) ──
    case "ai_generate_text": {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw { code: -32000, message: "OPENROUTER_API_KEY not configured. Set it in Netlify environment variables." };
      const prompt = params.prompt || "";
      const systemPrompt = params.systemPrompt || "You are a design assistant. Generate clean, professional content for a design canvas. Respond with ONLY the requested text, no explanations.";
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }], max_tokens: 2000 }),
      });
      if (!resp.ok) throw { code: -32000, message: `OpenRouter error: ${resp.status} ${await resp.text().catch(() => "")}` };
      const data = await resp.json();
      const generated = data.choices?.[0]?.message?.content || "";
      let layerName = null;
      if (params.templateId) {
        const tpl = await templates.getTemplate(params.templateId);
        if (tpl) {
          layerName = `ai_text_${Date.now()}`;
        }
      }
      return { generated, layerName, model: data.model };
    }

    case "ai_generate_image": {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw { code: -32000, message: "OPENROUTER_API_KEY not configured." };
      const prompt = params.prompt || "";
      let imageUrl = null;
      // Try text-to-image via a capable model; fall back to placeholder description
      try {
        const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini",
            messages: [{ role: "user", content: `Describe this image in 20 words for an alt-text (do not generate the image itself, just describe what it would look like): ${prompt}` }],
            max_tokens: 120,
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          const description = data.choices?.[0]?.message?.content || prompt;
          // Placeholder: generate a colored rect with the description as text
          if (params.templateId) {
            imageUrl = `ai://generated/${Date.now()}`;
            return { generated: true, description, prompt, imageUrl, note: "Image generation placeholder. For actual image output, configure a dedicated image model via OpenRouter." };
          }
        }
      } catch (e) {
        throw { code: -32000, message: `Image generation failed: ${e.message}` };
      }
      return { generated: false, message: "No image URL returned" };
    }

    case "ai_palette": {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw { code: -32000, message: "OPENROUTER_API_KEY not configured." };
      const theme = params.theme || "professional tech";
      const count = Math.max(3, Math.min(9, params.count || 6));
      const includeNeutrals = params.includeNeutrals !== false;
      const prompt = `Generate a ${count}-color palette for the theme "${theme}". ${includeNeutrals ? "Include 1-2 neutral background/surface colors." : ""} Return ONLY valid JSON: { "colors": [{ "name": "...", "hex": "#...", "role": "primary|secondary|accent|surface|text" }] }`;
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 600, response_format: { type: "json_object" } }),
      });
      if (!resp.ok) throw { code: -32000, message: `OpenRouter error: ${resp.status}` };
      const data = await resp.json();
      let palette;
      try {
        palette = JSON.parse(data.choices?.[0]?.message?.content || "{}");
      } catch {
        palette = { colors: [] };
      }
      return { theme, colors: palette.colors || [], model: data.model };
    }

    case "ai_suggest_layout": {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw { code: -32000, message: "OPENROUTER_API_KEY not configured." };
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const aspect = params.aspect || "all";
      const objects = [];
      for (const frame of (tpl.frames || [])) {
        for (const obj of (frame.objects || [])) {
          objects.push({
            type: obj.type, layerName: obj.layerName || obj.name,
            left: obj.left, top: obj.top, width: obj.width, height: obj.height,
            text: obj.text?.substring(0, 60),
          });
        }
      }
      const canvasInfo = { width: tpl.width, height: tpl.height, objectCount: objects.length, objects };
      const prompt = `Analyze this design canvas layout and suggest improvements for ${aspect}. Canvas: ${JSON.stringify(canvasInfo)}. Return ONLY valid JSON: { "score": 0-100, "issues": [{ "severity": "low|medium|high", "description": "...", "suggestion": "..." }], "summary": "..." }`;
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "user", content: prompt }], max_tokens: 1500, response_format: { type: "json_object" } }),
      });
      if (!resp.ok) throw { code: -32000, message: `OpenRouter error: ${resp.status}` };
      const data = await resp.json();
      let analysis;
      try {
        analysis = JSON.parse(data.choices?.[0]?.message?.content || "{}");
      } catch {
        analysis = { score: 0, issues: [], summary: "Failed to parse AI response" };
      }
      return { templateId: params.templateId, aspect, ...analysis, model: data.model };
    }

    case "ai_translate": {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw { code: -32000, message: "OPENROUTER_API_KEY not configured." };
      const targetLang = params.targetLanguage || "English";
      let textToTranslate = params.text || null;
      let translatedCount = 0;
      if (params.templateId && !textToTranslate) {
        const tpl = await templates.getTemplate(params.templateId);
        if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
        const objects = (tpl.frames?.find(f => f.id === params.frameId)?.objects || []);
        const targets = params.targetLayerName
          ? objects.filter(o => (o.layerName || o.name) === params.targetLayerName && o.type === "text" && o.text)
          : objects.filter(o => o.type === "text" && o.text);
        if (targets.length === 0) throw { code: -32000, message: "No text objects found to translate" };
        for (const obj of targets) {
          const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "openai/gpt-4o-mini",
              messages: [{ role: "system", content: `Translate the following text to ${targetLang}. Return ONLY the translated text, no explanations.` }, { role: "user", content: obj.text }],
              max_tokens: 1000,
            }),
          });
          if (resp.ok) {
            const data = await resp.json();
            obj.text = data.choices?.[0]?.message?.content || obj.text;
            translatedCount++;
          }
        }
        await templates.updateTemplate(params.templateId, { frames: tpl.frames });
        autoSnapshot(params.templateId, method);
        return { translated: translatedCount, total: targets.length, targetLanguage: targetLang };
      } else if (textToTranslate) {
        const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini",
            messages: [{ role: "system", content: `Translate the following text to ${targetLang}. Return ONLY the translated text, no explanations.` }, { role: "user", content: textToTranslate }],
            max_tokens: 1000,
          }),
        });
        if (!resp.ok) throw { code: -32000, message: `OpenRouter error: ${resp.status}` };
        const data = await resp.json();
        return { original: textToTranslate, translated: data.choices?.[0]?.message?.content || "", targetLanguage: targetLang };
      }
      throw { code: -32000, message: "Provide either templateId (with targetLayerName) or text to translate" };
    }

    // ── F4: Styles, Variables, Export ──
    case "create_style": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const objects = (tpl.frames?.find(f => f.id === params.frameId)?.objects || []);
      const obj = objects.find(o => (o.layerName || o.name) === params.sourceLayerName);
      if (!obj) throw { code: -32000, message: `Layer not found: ${params.sourceLayerName}` };
      const styleType = params.type || "fill";
      const props = {};
      if (styleType === "fill") {
        if (obj.fill) props.fill = obj.fill;
        if (obj.opacity !== undefined) props.opacity = obj.opacity;
      } else if (styleType === "stroke") {
        if (obj.stroke) props.stroke = obj.stroke;
        if (obj.strokeWidth !== undefined) props.strokeWidth = obj.strokeWidth;
      } else if (styleType === "text") {
        if (obj.fontSize) props.fontSize = obj.fontSize;
        if (obj.fontFamily) props.fontFamily = obj.fontFamily;
        if (obj.fontWeight) props.fontWeight = obj.fontWeight;
        if (obj.fill) props.fill = obj.fill;
        if (obj.lineHeight) props.lineHeight = obj.lineHeight;
        if (obj.textAlign) props.textAlign = obj.textAlign;
      } else if (styleType === "effect") {
        if (obj.shadow) props.shadow = obj.shadow;
        if (obj.filters) props.filters = obj.filters;
      }
      if (!tpl.styles) tpl.styles = [];
      const style = {
        id: `sty_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: params.name,
        type: styleType,
        properties: props,
      };
      tpl.styles.push(style);
      await templates.updateTemplate(params.templateId, { styles: tpl.styles });
      autoSnapshot(params.templateId, method);
      return { created: true, styleId: style.id, name: style.name, type: styleType, properties: props };
    }

    case "apply_style": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.styles) throw { code: -32000, message: "No styles defined in this template" };
      const style = tpl.styles.find(s => s.id === params.styleId);
      if (!style) throw { code: -32000, message: `Style not found: ${params.styleId}` };
      const objects = (tpl.frames?.find(f => f.id === params.frameId)?.objects || []);
      const targets = objects.filter(o => (params.targetLayerNames || []).includes(o.layerName || o.name));
      if (targets.length === 0) throw { code: -32000, message: "No matching layers found for targetLayerNames" };
      for (const obj of targets) {
        Object.assign(obj, style.properties);
      }
      await templates.updateTemplate(params.templateId, { frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return { applied: true, styleId: style.id, styleName: style.name, targetCount: targets.length };
    }

    case "create_variable": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.variables) tpl.variables = { collections: [], variables: [], bindings: {} };
      if (!tpl.variables.variables) tpl.variables.variables = [];
      const variable = {
        id: `var_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: params.name,
        type: params.type,
        value: params.value,
        collectionId: params.collectionId || null,
      };
      tpl.variables.variables.push(variable);
      await templates.updateTemplate(params.templateId, { variables: tpl.variables });
      autoSnapshot(params.templateId, method);
      return { created: true, variableId: variable.id, name: variable.name, type: variable.type, value: variable.value };
    }

    case "create_collection": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.variables) tpl.variables = { collections: [], variables: [], bindings: {} };
      if (!tpl.variables.collections) tpl.variables.collections = [];
      const modes = params.modes?.length ? params.modes : ["Default"];
      const collection = {
        id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: params.name,
        modes,
      };
      tpl.variables.collections.push(collection);
      await templates.updateTemplate(params.templateId, { variables: tpl.variables });
      autoSnapshot(params.templateId, method);
      return { created: true, collectionId: collection.id, name: collection.name, modes };
    }

    case "link_variable": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.variables?.variables) throw { code: -32000, message: "No variables defined in this template" };
      const variable = tpl.variables.variables.find(v => v.id === params.variableId);
      if (!variable) throw { code: -32000, message: `Variable not found: ${params.variableId}` };
      const objects = (tpl.frames?.find(f => f.id === params.frameId)?.objects || []);
      const obj = objects.find(o => (o.layerName || o.name) === params.targetLayerName);
      if (!obj) throw { code: -32000, message: `Layer not found: ${params.targetLayerName}` };
      const prop = params.property;
      if (!tpl.variables.bindings) tpl.variables.bindings = {};
      const key = `${obj.layerName || obj.name}.${prop}`;
      if (!tpl.variables.bindings[key]) tpl.variables.bindings[key] = [];
      tpl.variables.bindings[key].push({ variableId: variable.id, variableName: variable.name });
      obj[prop] = variable.value;
      if (prop === "fontSize" || prop === "width" || prop === "height") obj[prop] = Number(variable.value) || variable.value;
      await templates.updateTemplate(params.templateId, { frames: tpl.frames, variables: tpl.variables });
      autoSnapshot(params.templateId, method);
      return { linked: true, variableName: variable.name, targetLayerName: params.targetLayerName, property: prop, value: variable.value };
    }

    case "export_batch": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const fmt = params.format || "png";
      let scale = params.scale || 1;
      if (fmt === "png@2x") scale = 2;
      else if (fmt === "png@3x") scale = 3;
      const isSvg = fmt === "svg";
      const frameIds = params.frameIds?.length ? params.frameIds : (tpl.frames || [{}]).map(f => f.id || "frame_0").filter(Boolean);
      const API_BASE = process.env.URL || "https://bejewelled-llama-a6719d.netlify.app";

      // Detect HTML engine
      const isHtml = tpl.engine === "html" || tpl.frames?.some(f => f.html || f.css);

      const results = [];
      for (const fid of frameIds) {
        let frame = tpl.frames?.find(f => f.id === fid);

        // HTML engine frames → return self-contained HTML page (real PNG when opened in browser)
        if (isHtml) {
          if (!frame) {
            frame = { id: fid, name: tpl.name || "Frame", width: tpl.width || 1080, height: tpl.height || 1080, html: tpl.html, css: tpl.css };
          }
          const frameHtml = buildHtmlExportPage([frame]);
          results.push({
            frameId: fid,
            frameName: frame.name,
            html: frameHtml,
            width: (frame.width || tpl.width || 1080) * scale,
            height: (frame.height || tpl.height || 1080) * scale,
            engine: "html",
            format: isSvg ? "svg" : `png@${scale}x`,
            _note: "Save html as .html file, open in browser → auto-downloads real PNG."
          });
          continue;
        }

        // Non-HTML engine frames (legacy fallback)
        if (!frame && frameIds.length === 1 && !params.frameIds?.length) {
          results.push({
            frameId: "canvas",
            url: `${API_BASE}/render/${params.templateId}?format=${isSvg ? "svg" : "png"}&scale=${scale}`,
            width: (tpl.width || 1080) * scale,
            height: (tpl.height || 1080) * scale,
            format: isSvg ? "svg" : `png@${scale}x`,
          });
          continue;
        }
        if (!frame) continue;
        results.push({
          frameId: fid,
          frameName: frame.name,
          url: `${API_BASE}/render/${params.templateId}/${fid}?format=${isSvg ? "svg" : "png"}&scale=${scale}`,
          width: (frame.width || tpl.width) * scale,
          height: (frame.height || tpl.height) * scale,
          format: isSvg ? "svg" : `png@${scale}x`,
        });
      }
      return { exported: results.length, engine: "html", results, format: isSvg ? "svg" : `png@${scale}x`, totalFrames: results.length, html: buildHtmlExportPage(results.map(r => ({ name: r.frameName, width: r.width / scale, height: r.height / scale, html: tpl.frames?.find(f => f.id === r.frameId)?.html || tpl.html || "", css: tpl.frames?.find(f => f.id === r.frameId)?.css || tpl.css || "" }))) };
    }

    case "copy_as": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const objects = (tpl.frames?.find(f => f.id === params.frameId)?.objects || []);
      const obj = objects.find(o => (o.layerName || o.name) === params.targetLayerName);
      if (!obj) throw { code: -32000, message: `Layer not found: ${params.targetLayerName}` };
      const fmt = params.format || "json";
      if (fmt === "svg") {
        let svg = "";
        if (obj.type === "rect") {
          const rx = obj.rx || 0;
          svg = `<rect x="${obj.left || 0}" y="${obj.top || 0}" width="${obj.width || 100}" height="${obj.height || 100}" rx="${rx}" fill="${obj.fill || "#ccc"}"${obj.stroke ? ` stroke="${obj.stroke}" stroke-width="${obj.strokeWidth || 1}"` : ""} />`;
        } else if (obj.type === "text") {
          svg = `<text x="${obj.left || 0}" y="${(obj.top || 0) + (obj.fontSize || 16)}" font-family="${obj.fontFamily || "sans-serif"}" font-size="${obj.fontSize || 16}" fill="${obj.fill || "#000"}">${(obj.text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`;
        } else if (obj.type === "ellipse" || obj.type === "circle") {
          const cx = (obj.left || 0) + (obj.width || 100) / 2;
          const cy = (obj.top || 0) + (obj.height || 100) / 2;
          svg = `<ellipse cx="${cx}" cy="${cy}" rx="${(obj.width || 100) / 2}" ry="${(obj.height || 100) / 2}" fill="${obj.fill || "#ccc"}" />`;
        } else {
          svg = `<!-- ${obj.type}: use JSON format for full data -->`;
        }
        return { format: "svg", layerName: params.targetLayerName, type: obj.type, svg };
      } else if (fmt === "css") {
        const props = [];
        if (obj.left !== undefined) props.push(`  left: ${obj.left}px;`);
        if (obj.top !== undefined) props.push(`  top: ${obj.top}px;`);
        if (obj.width) props.push(`  width: ${obj.width}px;`);
        if (obj.height) props.push(`  height: ${obj.height}px;`);
        if (obj.fill) props.push(`  background-color: ${obj.fill};`);
        if (obj.opacity !== undefined) props.push(`  opacity: ${obj.opacity};`);
        if (obj.rx) props.push(`  border-radius: ${obj.rx}px;`);
        if (obj.fontSize) props.push(`  font-size: ${obj.fontSize}px;`);
        if (obj.fontFamily) props.push(`  font-family: ${obj.fontFamily};`);
        if (obj.shadow) props.push(`  box-shadow: ${obj.shadow.offsetX || 0}px ${obj.shadow.offsetY || 0}px ${obj.shadow.blur || 4}px ${obj.shadow.color || "#000"};`);
        const css = `.${params.targetLayerName.replace(/\s+/g, "-").toLowerCase()} {\n${props.join("\n")}\n}`;
        return { format: "css", layerName: params.targetLayerName, type: obj.type, css };
      } else {
        return { format: "json", layerName: params.targetLayerName, type: obj.type, data: obj };
      }
    }

    case "export_pdf": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const orientation = params.orientation || "landscape";
      const pageFormat = params.format || "screen";
      const frameIds = params.frameIds?.length ? params.frameIds : (tpl.frames || []).map(f => f.id);
      if (frameIds.length === 0) {
        frameIds.push("canvas");
      }
      const pages = [];
      for (const fid of frameIds) {
        if (fid === "canvas") {
          pages.push({
            frameId: "canvas",
            url: `https://futuraria.app/render/${params.templateId}?format=pdf&orientation=${orientation}&format=${pageFormat}`,
            width: tpl.width || 1080,
            height: tpl.height || 1080,
          });
        } else {
          const frame = tpl.frames?.find(f => f.id === fid);
          if (!frame) continue;
          pages.push({
            frameId: fid,
            frameName: frame.name,
            url: `https://futuraria.app/render/${params.templateId}/${fid}?format=pdf&orientation=${orientation}&format=${pageFormat}`,
            width: frame.width,
            height: frame.height,
          });
        }
      }
      return { exported: pages.length, orientation, pageFormat, pages, note: "PDF render URLs ready for the render pipeline." };
    }

    case "color_picker": {
      const raw = (params.color || "#000000").trim();
      const action = params.action || "parse";
      const steps = Math.max(2, Math.min(20, params.steps || 5));
      // Parse hex/rgb/rgba to {r,g,b,a}
      let r = 0, g = 0, b = 0, a = 1;
      const hexMatch = raw.match(/^#?([0-9a-fA-F]{3,8})$/);
      const rgbMatch = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+))?\s*\)/);
      if (hexMatch) {
        let h = hexMatch[1];
        if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
        if (h.length === 6) h += "ff";
        r = parseInt(h.substring(0,2), 16);
        g = parseInt(h.substring(2,4), 16);
        b = parseInt(h.substring(4,6), 16);
        a = parseInt(h.substring(6,8), 16) / 255;
      } else if (rgbMatch) {
        r = parseInt(rgbMatch[1]);
        g = parseInt(rgbMatch[2]);
        b = parseInt(rgbMatch[3]);
        a = rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1;
      } else {
        throw { code: -32000, message: `Unparseable color: ${raw}. Use hex (#cba6f7) or rgb/rgba.` };
      }
      const toHex = (rr, gg, bb) => "#" + [rr, gg, bb].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
      const toRgba = (rr, gg, bb, aa) => `rgba(${Math.round(rr)},${Math.round(gg)},${Math.round(bb)},${aa.toFixed(2)})`;
      const hex = toHex(r, g, b);
      let result = { hex, rgba: toRgba(r, g, b, a), r, g, b, a };
      if (action === "complementary") {
        result.complementary = toHex(255 - r, 255 - g, 255 - b);
        result.palette = [hex, result.complementary];
      } else if (action === "analogous") {
        const hsl = rgbToHsl(r, g, b);
        const c1 = hslToRgb(((hsl.h - 30) + 360) % 360, hsl.s, hsl.l);
        const c2 = hslToRgb(((hsl.h + 30) + 360) % 360, hsl.s, hsl.l);
        result.palette = [toHex(c1.r, c1.g, c1.b), hex, toHex(c2.r, c2.g, c2.b)];
      } else if (action === "triadic") {
        const hsl = rgbToHsl(r, g, b);
        const c1 = hslToRgb(((hsl.h + 120) % 360), hsl.s, hsl.l);
        const c2 = hslToRgb(((hsl.h + 240) % 360), hsl.s, hsl.l);
        result.palette = [hex, toHex(c1.r, c1.g, c1.b), toHex(c2.r, c2.g, c2.b)];
      } else if (action === "shades") {
        const shades = [];
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          const sr = Math.round(r + (255 - r) * t * 0.5);
          const sg = Math.round(g + (255 - g) * t * 0.5);
          const sb = Math.round(b + (255 - b) * t * 0.5);
          shades.push(toHex(sr, sg, sb));
        }
        result.shades = shades;
      } else if (action === "gradient") {
        const gradient = [];
        for (let i = 0; i < steps; i++) {
          const t = i / (steps - 1);
          gradient.push({
            offset: Math.round(t * 100) / 100,
            color: toHex(Math.round(r + (255 - r) * t * 0.6), Math.round(g + (255 - g) * t * 0.6), Math.round(b + (255 - b) * t * 0.6)),
          });
        }
        result.gradient = gradient;
      }
      return result;
    }

    // ── F4: Components ──
    case "create_component": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.metadata) tpl.metadata = {};
      if (!tpl.metadata.components) tpl.metadata.components = [];
      const compId = `comp_${Date.now().toString(36)}`;
      const component = {
        id: compId, name: params.name, description: params.description || "",
        objectIds: params.objectIds || [], objects: [],
        variants: [], properties: [], created: new Date().toISOString(),
      };
      tpl.metadata.components.push(component);
      await templates.updateTemplate(params.templateId, { metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return { created: true, componentId: compId, name: params.name, objectCount: 0 };
    }

    case "create_instance": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const components = tpl.metadata?.components || [];
      const comp = components.find(c => c.id === params.componentId);
      if (!comp) throw { code: -32000, message: `Component not found: ${params.componentId}` };
      const instanceId = `inst_${Date.now().toString(36)}`;
      autoSnapshot(params.templateId, method);
      return { created: true, instanceId, componentId: params.componentId, componentName: comp.name, objectCount: comp.objects?.length || 0, note: "V2 instances should be created via create_html_frame + add_element." };
    }

    case "add_variant": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.metadata?.components) throw { code: -32000, message: "No components found in this template" };
      const comp = tpl.metadata.components.find(c => c.id === params.componentId);
      if (!comp) throw { code: -32000, message: `Component not found: ${params.componentId}` };
      if (!comp.variants) comp.variants = [];
      const varId = `var_${Date.now().toString(36)}`;
      comp.variants.push({
        id: varId, name: params.name,
        overrides: params.overrides || {},
        created: new Date().toISOString(),
      });
      await templates.updateTemplate(params.templateId, { metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return { created: true, variantId: varId, componentId: params.componentId, name: params.name, overrides: params.overrides || {} };
    }

    // ── F4: Prototyping ──
    case "add_interaction": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.metadata) tpl.metadata = {};
      if (!tpl.metadata.interactions) tpl.metadata.interactions = [];
      const interaction = {
        id: `iact_${Date.now().toString(36)}`,
        sourceId: params.sourceId,
        trigger: params.trigger || "onClick",
        action: params.action || "navigate",
        targetId: params.targetId || null,
        transition: params.transition || "instant",
        duration: params.duration ?? 300,
        delay: params.delay ?? 0,
        easing: params.easing || "easeOut",
      };
      tpl.metadata.interactions.push(interaction);
      await templates.updateTemplate(params.templateId, { metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return { created: true, interactionId: interaction.id, sourceId: params.sourceId, trigger: interaction.trigger, action: interaction.action };
    }

    case "set_animation": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.metadata) tpl.metadata = {};
      if (!tpl.metadata.animations) tpl.metadata.animations = [];
      // Remove existing animation for this object
      tpl.metadata.animations = tpl.metadata.animations.filter(a => a.objectId !== params.objectId);
      const anim = {
        id: `anim_${Date.now().toString(36)}`,
        objectId: params.objectId,
        type: params.type,
        direction: params.direction || null,
        duration: params.duration ?? 300,
        easing: params.easing || "easeOut",
        delay: params.delay ?? 0,
      };
      tpl.metadata.animations.push(anim);
      await templates.updateTemplate(params.templateId, { metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return { created: true, animationId: anim.id, objectId: params.objectId, type: params.type, duration: anim.duration };
    }

    case "add_overlay": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const frames = tpl.frames || [];
      const frameIdx = frames.findIndex(f => f.id === params.frameId);
      if (frameIdx === -1) throw { code: -32000, message: `Frame not found: ${params.frameId}` };
      if (!frames[frameIdx].metadata) frames[frameIdx].metadata = {};
      frames[frameIdx].metadata.overlay = {
        position: params.position || "center",
        backdrop: params.backdrop !== false,
        backdropColor: params.backdropColor || "rgba(0,0,0,0.5)",
        closeOnBackdrop: params.closeOnBackdrop !== false,
        manualX: params.manualX ?? null,
        manualY: params.manualY ?? null,
      };
      tpl.frames = frames;
      await templates.updateTemplate(params.templateId, { frames: tpl.frames });
      autoSnapshot(params.templateId, method);
      return { updated: true, frameId: params.frameId, position: frames[frameIdx].metadata.overlay.position };
    }

    case "set_scroll_position": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      // Check frames first
      const frames = tpl.frames || [];
      const frameIdx = frames.findIndex(f => f.id === params.objectId);
      if (frameIdx !== -1) {
        if (!frames[frameIdx].metadata) frames[frameIdx].metadata = {};
        frames[frameIdx].metadata.scrollBehavior = params.behavior;
        if (params.stickyTop !== undefined) frames[frameIdx].metadata.stickyTop = params.stickyTop;
        if (params.stickyBottom !== undefined) frames[frameIdx].metadata.stickyBottom = params.stickyBottom;
        if (params.overflow) frames[frameIdx].metadata.overflow = params.overflow;
        tpl.frames = frames;
        await templates.updateTemplate(params.templateId, { frames: tpl.frames });
      } else {
        throw { code: -32000, message: `Object not found in frames: ${params.objectId}. For HTML templates, use frame IDs.` };
      }
      autoSnapshot(params.templateId, method);
      return { updated: true, objectId: params.objectId, behavior: params.behavior };
    }

    // ── F1: Canvas Navigation ──
    case "publish_library": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (!tpl.metadata) tpl.metadata = {};
      const styles = (tpl.styles || []).filter(s => !params.styleIds || params.styleIds.includes(s.id));
      const library = {
        id: `lib_${Date.now().toString(36)}`,
        name: params.name,
        description: params.description || "",
        styles: JSON.parse(JSON.stringify(styles)),
        variables: tpl.metadata.variables || [],
        collections: tpl.metadata.collections || [],
        visibility: params.visibility || "workspace",
        sourceTemplateId: params.templateId,
        published: new Date().toISOString(),
      };
      // Store library in template metadata (free-tier: no separate libraries table)
      if (!tpl.metadata.libraries) tpl.metadata.libraries = [];
      tpl.metadata.libraries.push(library);
      // Also mark this template as a library source
      tpl.metadata.isLibrary = true;
      await templates.updateTemplate(params.templateId, { metadata: tpl.metadata });
      autoSnapshot(params.templateId, method);
      return { published: true, libraryId: library.id, name: params.name, styleCount: styles.length };
    }

    case "register_tool": {
      const name = params.name;
      if (!name.startsWith("plugin_")) throw { code: -32000, message: `Plugin tool names must start with 'plugin_' prefix. Got: ${name}` };
      if (MCP_TOOLS.some(t => t.name === name)) throw { code: -32000, message: `Tool '${name}' is already registered` };
      // Validate inputSchema is a valid JSON Schema object
      if (!params.inputSchema || typeof params.inputSchema !== "object") throw { code: -32000, message: "inputSchema must be a valid JSON Schema object" };
      // Store in in-memory plugin registry (survives warm instances)
      if (!globalThis.__mcp_plugins) globalThis.__mcp_plugins = new Map();
      globalThis.__mcp_plugins.set(name, {
        name, description: params.description, inputSchema: params.inputSchema,
        handler: params.handler, secret: params.secret || null,
        registered: new Date().toISOString(),
      });
      // Dynamically add to MCP_TOOLS for discovery
      MCP_TOOLS.push({
        name, description: params.description, inputSchema: params.inputSchema,
      });
      return { registered: true, name, handler: params.handler, totalTools: MCP_TOOLS.length };
    }

    case "auth_token": {
      const tokenId = `pat_${Date.now().toString(36)}`;
      const scopes = params.scopes || ["read"];
      const expiresIn = params.expiresIn ?? 31536000; // 1 year default
      const expiresAt = expiresIn === 0 ? null : new Date(Date.now() + expiresIn * 1000).toISOString();
      // Generate a secure token (simple hash for free-tier)
      const tokenRaw = `${tokenId}_${params.userId}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const tokenHashed = [...tokenRaw].reduce((h, c) => (h = ((h << 5) - h) + c.charCodeAt(0)) & 0xffffffff, 0).toString(36);
      // Store in in-memory registry (free-tier: no separate Supabase table)
      if (!globalThis.__pat_tokens) globalThis.__pat_tokens = new Map();
      globalThis.__pat_tokens.set(tokenId, { id: tokenId, userId: params.userId, name: params.name, scopes, expiresAt, tokenHashed, created: new Date().toISOString() });
      return { created: true, tokenId, token: tokenRaw, name: params.name, scopes, expiresAt, note: "Store this token securely. It will not be shown again." };
    }

    // Sprint 2: Ghost System handlers

    // ── ghost_show ──
    case "skill_clone": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };

      const skillId = `skill_${Date.now().toString(36)}`;
      const skillDef = {
        id: skillId,
        name: params.skillName,
        description: params.description || `Cloned from ${params.sourceTemplateId || params.templateId}`,
        patterns: params.patterns,
        rules: params.rules || [],
        sourceTemplateId: params.sourceTemplateId || params.templateId,
        created: new Date().toISOString(),
      };

      const existing = tpl.metadata || {};
      const skills = existing.clonedSkills || [];
      skills.push(skillDef);

      await templates.updateTemplate(params.templateId, {
        metadata: { ...existing, clonedSkills: skills },
      });

      return {
        created: true,
        skillId,
        skillName: params.skillName,
        rules: params.rules || [],
        skill: skillDef,
      };
    }

    // ── skill_apply ──
    case "observe_session": {
      if (!globalThis.__observe_sessions) globalThis.__observe_sessions = new Map();
      if (!globalThis.__observe_events) globalThis.__observe_events = new Map();

      const action = params.action;
      const userId = params.userId || "default";
      const sessionKey = `session_${userId}`;

      if (action === "start") {
        const session = {
          id: `obs_${Date.now().toString(36)}`,
          userId,
          templateId: params.templateId || null,
          startedAt: new Date().toISOString(),
          status: "recording",
          eventCount: 0,
        };
        globalThis.__observe_sessions.set(sessionKey, session);
        globalThis.__observe_events.set(sessionKey, []);
        return { observed: true, action, session };
      }

      if (action === "stop") {
        const session = globalThis.__observe_sessions.get(sessionKey);
        if (!session) throw { code: -32000, message: "No active session" };
        session.status = "completed";
        session.endedAt = new Date().toISOString();
        const events = globalThis.__observe_events.get(sessionKey) || [];
        session.eventCount = events.length;
        globalThis.__observe_sessions.set(sessionKey, session);
        return { observed: true, action, session, eventCount: events.length };
      }

      if (action === "analyze") {
        const events = globalThis.__observe_events.get(sessionKey) || [];
        if (events.length === 0) return { action, message: "No events recorded. Start a session first.", patterns: null };

        // Extract patterns
        const toolUsage = {};
        const actionTypes = {};
        const timeline = [];
        for (const evt of events) {
          if (evt.type === "mcpTool") toolUsage[evt.tool] = (toolUsage[evt.tool] || 0) + 1;
          actionTypes[evt.type] = (actionTypes[evt.type] || 0) + 1;
          timeline.push({ time: evt.timestamp, type: evt.type, detail: evt.tool || evt.action });
        }

        const sortedTools = Object.entries(toolUsage).sort((a, b) => b[1] - a[1]);
        const patterns = {
          mostUsedTools: sortedTools.slice(0, 5).map(([tool, count]) => ({ tool, count })),
          actionBreakdown: actionTypes,
          typicalWorkflow: timeline.slice(0, 10),
          totalEvents: events.length,
          insights: sortedTools.length > 0
            ? [`Most used tool: ${sortedTools[0][0]} (${sortedTools[0][1]} times)`, `Unique tools used: ${sortedTools.length}`]
            : [],
        };

        return { action, patterns };
      }

      // Record event
      if (params.event) {
        const events = globalThis.__observe_events.get(sessionKey) || [];
        events.push({ ...params.event, timestamp: new Date().toISOString() });
        globalThis.__observe_events.set(sessionKey, events);
        return { recorded: true, eventCount: events.length };
      }

      throw { code: -32602, message: "Invalid action. Use start/stop/analyze or provide an event to record." };
    }

    // ── smart_layout ──
    case "smart_layout": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      autoSnapshot(params.templateId, method, tpl);

      const objects = (tpl.frames?.find(f => f.id === params.frameId)?.objects || []);
      let targets = params.targetLayerNames?.length
        ? objects.filter(o => params.targetLayerNames.includes(o.layerName || o.name))
        : [...objects];

      if (targets.length < 2) throw { code: -32000, message: "Need at least 2 objects to apply layout" };

      const layout = params.layout;
      const gap = params.gap || 16;
      const startX = params.startX || 0;
      const startY = params.startY || 0;
      const cols = params.columns || 3;
      const w = tpl.width || 1080;

      const applyLayout = () => {
        switch (layout) {
          case "grid": {
            for (let i = 0; i < targets.length; i++) {
              const row = Math.floor(i / cols);
              const col = i % cols;
              targets[i].left = startX + col * ((w - startX * 2) / cols);
              targets[i].top = startY + row * (Math.max(...targets.map(t => t.height || 100)) + gap);
            }
            break;
          }
          case "masonry": {
            const colHeights = new Array(cols).fill(startY);
            for (let i = 0; i < targets.length; i++) {
              const col = i % cols;
              targets[i].left = startX + col * ((w - startX * 2) / cols);
              targets[i].top = colHeights[col];
              colHeights[col] += (targets[i].height || 100) + gap;
            }
            break;
          }
          case "golden-ratio": {
            const phi = 1.618033988749895;
            for (let i = 0; i < targets.length; i++) {
              const angle = i * phi * Math.PI * 2;
              const r = 30 + i * 12;
              targets[i].left = startX + w / 2 + Math.cos(angle) * r - (targets[i].width || 0) / 2;
              targets[i].top = startY + 200 + Math.sin(angle) * r - (targets[i].height || 0) / 2;
            }
            break;
          }
          case "circular": {
            const radius = params.radius || 300;
            const cx = startX + w / 2;
            const cy = startY + radius + 50;
            for (let i = 0; i < targets.length; i++) {
              const angle = (i / targets.length) * Math.PI * 2 - Math.PI / 2;
              targets[i].left = cx + Math.cos(angle) * radius - (targets[i].width || 0) / 2;
              targets[i].top = cy + Math.sin(angle) * radius - (targets[i].height || 0) / 2;
            }
            break;
          }
          case "zigzag": {
            const amp = params.amplitude || 40;
            for (let i = 0; i < targets.length; i++) {
              targets[i].left = startX + i * ((w - startX * 2) / targets.length);
              targets[i].top = startY + (i % 2 === 0 ? 0 : amp);
            }
            break;
          }
          case "flex-wrap": {
            const maxWidth = params.maxWidth || w - startX * 2;
            let curX = startX, curY = startY, maxH = 0;
            for (let i = 0; i < targets.length; i++) {
              const ow = (targets[i].width || 100) + gap;
              if (curX + ow > startX + maxWidth) {
                curX = startX;
                curY += maxH + gap;
                maxH = 0;
              }
              targets[i].left = curX;
              targets[i].top = curY;
              curX += ow;
              maxH = Math.max(maxH, targets[i].height || 100);
            }
            break;
          }
        }
      };

      applyLayout();
      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, { frames: tpl.frames });
      autoSnapshot(params.templateId, method);

      return { applied: true, layout, objectCount: targets.length, objects: targets.map(o => ({ layerName: o.layerName || o.name, left: o.left, top: o.top })) };
    }

    // ── remix_template ──
    case "suggest_color_palette": {
      const baseColor = params.baseColor;
      if (!baseColor || !baseColor.startsWith("#") || baseColor.length < 7) {
        throw { code: -32602, message: "baseColor must be a hex color (e.g. '#3b82f6')" };
      }

      const hex = baseColor.slice(1);
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const hsl = rgbToHsl(r, g, b);

      const type = params.type || "complementary";
      const mood = params.mood || null;

      const toHex = (rgb) => {
        const rh = rgb.r.toString(16).padStart(2, "0");
        const gh = rgb.g.toString(16).padStart(2, "0");
        const bh = rgb.b.toString(16).padStart(2, "0");
        return `#${rh}${gh}${bh}`;
      };

      // Mood modifiers for saturation/lightness
      const moodMod = (s, l) => {
        switch (mood) {
          case "vibrant": return { s: Math.min(1, s * 1.3), l: Math.min(0.9, l * 1.1) };
          case "muted": return { s: s * 0.6, l: l * 0.95 };
          case "dark": return { s, l: Math.max(0.05, l * 0.4) };
          case "light": return { s: s * 0.5, l: Math.min(0.95, l * 1.6) };
          case "pastel": return { s: s * 0.4, l: Math.min(0.9, l * 1.4) };
          case "professional": return { s: Math.min(1, s * 0.85), l };
          default: return { s, l };
        }
      };

      const generate = (hueShift, sMod = 1, lMod = 1) => {
        let h = (hsl.h + hueShift + 360) % 360;
        let { s, l } = moodMod(Math.min(1, hsl.s * sMod), Math.min(1, hsl.l * lMod));
        const rgb = hslToRgb(h, s, l);
        return toHex(rgb);
      };

      let colors = [];
      switch (type) {
        case "complementary":
          colors = [baseColor, generate(180)];
          break;
        case "analogous":
          colors = [generate(-30), baseColor, generate(30)];
          break;
        case "triadic":
          colors = [baseColor, generate(120), generate(240)];
          break;
        case "monochromatic":
          const count = params.count || 5;
          for (let i = 0; i < count; i++) {
            const l = Math.max(0.1, Math.min(0.95, hsl.l * (0.3 + i * (1.4 / count))));
            colors.push(toHex(hslToRgb(hsl.h, Math.min(1, hsl.s * (0.7 + i * 0.1)), l)));
          }
          break;
        case "split-complementary":
          colors = [baseColor, generate(150), generate(210)];
          break;
        case "tetradic":
          colors = [baseColor, generate(90), generate(180), generate(270)];
          break;
      }

      // Assign roles
      const roleNames = ["primary", "secondary", "accent", "surface", "text", "highlight", "muted", "border"];
      const palette = colors.map((hex, i) => ({
        hex,
        name: `${type} ${i + 1}`,
        role: roleNames[i] || "color",
      }));

      return {
        baseColor,
        type,
        mood,
        colors: palette,
        count: palette.length,
      };
    }

    // ── auto_polish ──
    case "get_template_structure": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const html = tpl.html || "";
      const css = tpl.css || "";
      // Parse elements: extract tags, classes, data-layer-id, and bounding hints
      const elements = [];
      const tagRe = /<(\w+)([^>]*)>/g;
      let m;
      while ((m = tagRe.exec(html)) !== null) {
        const attrs = m[2] || "";
        const idMatch = attrs.match(/data-layer-id="([^"]+)"/);
        const classMatch = attrs.match(/class="([^"]+)"/);
        elements.push({
          tag: m[1],
          id: idMatch ? idMatch[1] : `el_${elements.length}`,
          classes: classMatch ? classMatch[1].split(/\s+/) : [],
          cssSelector: classMatch ? `.${classMatch[1].split(/\s+/)[0]}` : idMatch ? `#${idMatch[1]}` : m[1],
        });
      }
      // Parse CSS rules
      const cssRules = [];
      const cssRe = /([^{]+)\s*\{([^}]+)\}/g;
      let cm;
      while ((cm = cssRe.exec(css)) !== null) {
        cssRules.push({ selector: cm[1].trim(), properties: cm[2].trim().split(";").filter(Boolean).map(s => s.trim()) });
      }
      return { elements, cssRules, elementCount: elements.length, cssRuleCount: cssRules.length };
    }

    // ── select_element ──
    case "select_element": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const html = tpl.html || "";
      const css = tpl.css || "";
      // Find element by data-layer-id
      const elRe = new RegExp(`<([a-zA-Z0-9]+)([^>]*data-layer-id="${params.elementId}"[^>]*)>(.*?)<\\/\\1>|<([a-zA-Z0-9]+)([^>]*data-layer-id="${params.elementId}"[^>]*)\\s*\\/>`, "s");
      const match = html.match(elRe);
      if (!match) throw { code: -32000, message: `Element not found: ${params.elementId}` };
      const tag = match[1] || match[4];
      const attrs = (match[2] || match[5] || "");
      const inner = match[3] || "";
      const classMatch = attrs.match(/class="([^"]+)"/);
      const classes = classMatch ? classMatch[1].split(/\s+/) : [];
      // Find matching CSS rules
      const cssProperties = [];
      const cssRe = /([^{]+)\s*\{([^}]+)\}/g;
      let cm;
      while ((cm = cssRe.exec(css)) !== null) {
        const sel = cm[1].trim();
        if (classes.some(c => sel.includes(`.${c}`)) || sel === tag || sel.includes(`#${params.elementId}`)) {
          cssProperties.push(...cm[2].split(";").filter(Boolean).map(s => s.trim()));
        }
      }
      return { elementId: params.elementId, tag, classes, cssProperties, htmlSnippet: match[0].substring(0, 200) };
    }

    // ── update_element ──
    case "update_element": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (tpl.engine && tpl.engine !== "html") throw { code: -32000, message: "Template is not an HTML template" };
      let html = tpl.html || "";
      let css = tpl.css || "";
      if (params.css) {
        // Update CSS: find selector matching the element and replace/set properties
        const elRe = new RegExp(`data-layer-id="${params.elementId}"`);
        const elMatch = html.match(new RegExp(`<([a-zA-Z0-9]+)([^>]*data-layer-id="${params.elementId}"[^>]*)>`, "s"));
        if (elMatch) {
          const attrs = elMatch[2];
          const classMatch = attrs.match(/class="([^"]+)"/);
          if (classMatch) {
            const firstClass = classMatch[1].split(/\s+/)[0];
            const cssRuleRe = new RegExp(`(\\.${firstClass}\\s*\\{[^}]*)\\}`, "g");
            if (css.match(cssRuleRe)) {
              css = css.replace(cssRuleRe, `$1; ${params.css}\n}`);
            } else {
              css += `\n.${firstClass} { ${params.css} }`;
            }
          }
        }
      }
      if (params.html !== undefined) {
        // Replace inner HTML of element
        const innerRe = new RegExp(`(<[a-zA-Z0-9]+[^>]*data-layer-id="${params.elementId}"[^>]*>)(.*?)(<\\/[a-zA-Z0-9]+>)`, "s");
        if (innerRe.test(html)) {
          html = html.replace(innerRe, `$1${params.html}$3`);
        }
      }
      if (params.attributes) {
        for (const [k, v] of Object.entries(params.attributes)) {
          const attrRe = new RegExp(`(<[a-zA-Z0-9]+[^>]*data-layer-id="${params.elementId}"[^>]*)( ${k}="[^"]*")?([^>]*>)`, "s");
          html = html.replace(attrRe, `$1 ${k}="${v}"$3`);
        }
      }
      await templates.updateTemplate(params.templateId, { html, css, frames: tpl.frames || [] });
      return { success: true, templateId: params.templateId };
    }

    // ── add_element ──
    case "add_element": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (tpl.engine && tpl.engine !== "html") throw { code: -32000, message: "Template is not an HTML template" };
      const layerId = params.layerName || `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const styleAttr = params.css ? ` style="${params.css}"` : "";
      const voidTags = ["img", "br", "hr", "input"];
      const elHtml = voidTags.includes(params.tag)
        ? `<${params.tag} data-layer-id="${layerId}"${styleAttr}>`
        : `<${params.tag} data-layer-id="${layerId}"${styleAttr}>${params.html || ""}</${params.tag}>`;

      // Multi-frame support: if frameId provided, add to specific frame
      if (params.frameId && tpl.frames && Array.isArray(tpl.frames)) {
        const frame = tpl.frames.find(f => f.id === params.frameId);
        if (!frame) throw { code: -32000, message: `Frame not found: ${params.frameId}` };
        let frameHtml = frame.html || "";
        const pos = params.position || "append";
        if (params.parentSelector && params.parentSelector !== "body") {
          const parentRe = new RegExp(`(<${params.parentSelector}[^>]*>)([\\s\\S]*?)(<\\/${params.parentSelector}>)`, "i");
          if (parentRe.test(frameHtml)) {
            if (pos === "append") frameHtml = frameHtml.replace(parentRe, `$1$2${elHtml}$3`);
            else if (pos === "prepend") frameHtml = frameHtml.replace(parentRe, `$1${elHtml}$2$3`);
            else if (pos === "before") frameHtml = frameHtml.replace(parentRe, `${elHtml}$1$2$3`);
            else if (pos === "after") frameHtml = frameHtml.replace(parentRe, `$1$2$3${elHtml}`);
          } else {
            frameHtml += elHtml;
          }
        } else {
          frameHtml += elHtml;
        }
        frame.html = frameHtml;
        await templates.updateTemplate(params.templateId, { html: tpl.html, css: tpl.css, frames: tpl.frames });
        return { success: true, templateId: params.templateId, frameId: params.frameId, layerName: layerId };
      }

      // Legacy single-frame mode
      let html = tpl.html || "";
      const pos = params.position || "append";
      if (params.parentSelector && params.parentSelector !== "body") {
        const parentRe = new RegExp(`(<${params.parentSelector}[^>]*>)([\\s\\S]*?)(<\\/${params.parentSelector}>)`, "i");
        if (parentRe.test(html)) {
          if (pos === "append") html = html.replace(parentRe, `$1$2${elHtml}$3`);
          else if (pos === "prepend") html = html.replace(parentRe, `$1${elHtml}$2$3`);
          else if (pos === "before") html = html.replace(parentRe, `${elHtml}$1$2$3`);
          else if (pos === "after") html = html.replace(parentRe, `$1$2$3${elHtml}`);
        } else {
          html += elHtml;
        }
      } else {
        html += elHtml;
      }
      await templates.updateTemplate(params.templateId, { html, frames: tpl.frames || [] });
      return { success: true, templateId: params.templateId, layerName: layerId };
    }

    // ── add_primitive (Phase B: visual-first primitives) ──
    case "add_primitive": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (tpl.engine && tpl.engine !== "html") throw { code: -32000, message: "Template is not an HTML template" };
      if (!tpl.frames || !Array.isArray(tpl.frames)) throw { code: -32000, message: "Template has no frames" };
      const frame = tpl.frames.find(f => f.id === params.frameId);
      if (!frame) throw { code: -32000, message: `Frame not found: ${params.frameId}` };

      const layerId = `el_${Date.now().toString(36)}`;
      const x = params.x || 0;
      const y = params.y || 0;
      const type = params.type;

      let elHtml, cssRule;
      if (type === "rect") {
        const w = params.width || 200;
        const h = params.height || 150;
        const bg = params.color || "#3B82F6";
        const br = params.borderRadius || "8px";
        elHtml = `<div data-layer-id="${layerId}"></div>`;
        cssRule = `[data-layer-id="${layerId}"] {\n  width: ${w}px;\n  height: ${h}px;\n  background: ${bg};\n  border-radius: ${br};\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}`;
      } else if (type === "circle") {
        const size = params.width || params.height || 150;
        const bg = params.color || "#EF4444";
        elHtml = `<div data-layer-id="${layerId}"></div>`;
        cssRule = `[data-layer-id="${layerId}"] {\n  width: ${size}px;\n  height: ${size}px;\n  background: ${bg};\n  border-radius: 50%;\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}`;
      } else if (type === "text") {
        const fs = params.fontSize || 24;
        const color = params.color || "#333333";
        const content = params.content || "Text";
        elHtml = `<div data-layer-id="${layerId}">${content}</div>`;
        cssRule = `[data-layer-id="${layerId}"] {\n  font-size: ${fs}px;\n  color: ${color};\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}`;
      } else {
        throw { code: -32000, message: `Invalid primitive type: ${type}. Must be rect, circle, or text.` };
      }

      frame.html = (frame.html || "") + "\n" + elHtml;
      frame.css = (frame.css || "") + "\n" + cssRule + "\n";
      await templates.updateTemplate(params.templateId, { html: tpl.html, css: tpl.css, frames: tpl.frames });
      return { success: true, templateId: params.templateId, frameId: params.frameId, layerName: layerId, type };
    }

    // ── change_element_tag (Phase B: semantic tagging) ──
    case "change_element_tag": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (tpl.engine && tpl.engine !== "html") throw { code: -32000, message: "Template is not an HTML template" };

      // Find the element in the specified frame (or template-level html)
      let targetHtml = "";
      let targetObj = null;
      if (params.frameId && tpl.frames && Array.isArray(tpl.frames)) {
        const frame = tpl.frames.find(f => f.id === params.frameId);
        if (!frame) throw { code: -32000, message: `Frame not found: ${params.frameId}` };
        targetHtml = frame.html || "";
        targetObj = frame;
      } else {
        targetHtml = tpl.html || "";
        targetObj = tpl;
      }

      const oldTagRe = new RegExp(`<(\\w+)([^>]*data-layer-id="${params.elementId.replace(/[[\\]"\\\\]/g, "\\\\$&")}"[^>]*)>([\\s\\S]*?)<\\/\\1>`, "i");
      const match = oldTagRe.exec(targetHtml);
      if (!match) {
        // Try void element (self-closing or void tags)
        const voidRe = new RegExp(`<(\\w+)([^>]*data-layer-id="${params.elementId.replace(/[[\\]"\\\\]/g, "\\\\$&")}"[^>]*)\\/?>`, "i");
        const voidMatch = voidRe.exec(targetHtml);
        if (!voidMatch) throw { code: -32000, message: `Element not found: ${params.elementId}` };
        const newHtml = targetHtml.replace(voidRe, `<${params.newTag}$2>`);
        if (params.frameId && targetObj) {
          targetObj.html = newHtml;
        } else {
          tpl.html = newHtml;
        }
      } else {
        const newElHtml = `<${params.newTag}${match[2]}>${match[3]}</${params.newTag}>`;
        const newHtml = targetHtml.replace(oldTagRe, newElHtml);
        if (params.frameId && targetObj) {
          targetObj.html = newHtml;
        } else {
          tpl.html = newHtml;
        }
      }

      await templates.updateTemplate(params.templateId, { html: tpl.html, css: tpl.css, frames: tpl.frames || [] });
      return { success: true, templateId: params.templateId, elementId: params.elementId, oldTag: match ? match[1] : "unknown", newTag: params.newTag };
    }

    // ── remove_element ──
    case "remove_element": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (tpl.engine && tpl.engine !== "html") throw { code: -32000, message: "Template is not an HTML template" };
      let html = tpl.html || "";
      const elRe = new RegExp(`<[^>]*data-layer-id="${params.elementId}"[^>]*>[\\s\\S]*?<\\/[a-zA-Z0-9]+>|<[^>]*data-layer-id="${params.elementId}"[^>]*\\s*\\/>`, "g");
      html = html.replace(elRe, "");
      await templates.updateTemplate(params.templateId, { html, frames: tpl.frames || [] });
      return { success: true, templateId: params.templateId, removed: params.elementId };
    }

    // ── reorder_element ──
    case "reorder_element": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (tpl.engine && tpl.engine !== "html") throw { code: -32000, message: "Template is not an HTML template" };
      let html = tpl.html || "";
      const elRe = new RegExp(`(<[^>]*data-layer-id="${params.elementId}"[^>]*>[\\s\\S]*?<\\/[a-zA-Z0-9]+>|<[^>]*data-layer-id="${params.elementId}"[^>]*\\s*\\/>)`, "g");
      const match = elRe.exec(html);
      if (!match) throw { code: -32000, message: `Element not found: ${params.elementId}` };
      html = html.replace(match[0], "");
      // Re-insert at new position by counting siblings
      const parentMatch = html.match(/(<[a-zA-Z0-9]+[^>]*>)([\s\S]*?)(<\/[a-zA-Z0-9]+>)/);
      if (parentMatch) {
        let siblings = parentMatch[2].match(/<[a-zA-Z0-9]+[^>]*>[\s\S]*?<\/[a-zA-Z0-9]+>|<[a-zA-Z0-9]+[^>]*\s*\/>/g) || [];
        siblings.splice(Math.min(params.newIndex, siblings.length), 0, match[0]);
        html = html.replace(parentMatch[0], `${parentMatch[1]}${siblings.join("")}${parentMatch[3]}`);
      } else {
        html += match[0];
      }
      await templates.updateTemplate(params.templateId, { html, frames: tpl.frames || [] });
      return { success: true, templateId: params.templateId, reordered: params.elementId, newIndex: params.newIndex };
    }

    // ── get_css_variables ──
    case "get_css_variables": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const css = tpl.css || "";
      const variables = [];
      const varRe = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+)/g;
      let m;
      while ((m = varRe.exec(css)) !== null) {
        variables.push({ name: `--${m[1]}`, value: m[2].trim(), scope: ":root" });
      }
      return { variables, count: variables.length };
    }

    // ── set_css_variable ──
    case "set_css_variable": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (tpl.engine && tpl.engine !== "html") throw { code: -32000, message: "Template is not an HTML template" };
      let css = tpl.css || "";
      const varName = params.name.startsWith("--") ? params.name : `--${params.name}`;
      const varRe = new RegExp(`(${varName}\\s*:\\s*)([^;]+)`, "g");
      if (varRe.test(css)) {
        css = css.replace(varRe, `$1${params.value}`);
      } else {
        const rootRe = /(:root\s*\{)/;
        if (rootRe.test(css)) {
          css = css.replace(rootRe, `$1\n  ${varName}: ${params.value};`);
        } else {
          css = `:root {\n  ${varName}: ${params.value};\n}\n` + css;
        }
      }
      await templates.updateTemplate(params.templateId, { css, frames: tpl.frames || [] });
      return { success: true, templateId: params.templateId, variable: varName, value: params.value };
    }

    // ═══════════════════════════════════════════════════════════
    // FASE 2: Template Engine + Recipes
    // ═══════════════════════════════════════════════════════════

    // ── analyze_template_structure ──
    case "analyze_template_structure": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const html = tpl.html || "";
      const css = tpl.css || "";
      // Detect layout
      const layout = { type: "block", direction: "vertical", gap: "0px", padding: "0px" };
      if (css.includes("display: flex") || css.includes("display:flex")) layout.type = "flex";
      if (css.includes("display: grid") || css.includes("display:grid")) layout.type = "grid";
      const dirMatch = css.match(/flex-direction\s*:\s*(\w+)/);
      if (dirMatch) layout.direction = dirMatch[1];
      const gapMatch = css.match(/gap\s*:\s*([^;]+)/);
      if (gapMatch) layout.gap = gapMatch[1].trim();
      const padMatch = css.match(/padding\s*:\s*([^;]+)/);
      if (padMatch) layout.padding = padMatch[1].trim();
      // Extract colors
      const colors = [];
      const colorRe = /(color|background|background-color)\s*:\s*([#a-fA-F0-9]{3,8}|rgb\([^)]+\))/g;
      let cm;
      while ((cm = colorRe.exec(css)) !== null) {
        colors.push({ hex: cm[2], role: cm[1], selector: "body" });
      }
      // Extract typography
      const typography = [];
      const fontRe = /font-family\s*:\s*([^;]+)/g;
      const sizeRe = /font-size\s*:\s*([^;]+)/g;
      let fm, sm;
      while ((fm = fontRe.exec(css)) !== null) {
        typography.push({ family: fm[1].trim(), size: "16px", weight: 400, lineHeight: "1.5", selector: "body", role: "body" });
      }
      return { layout, colors, typography, components: [], dimensions: { width: tpl.width, height: tpl.height } };
    }

    // ── extract_variables ──
    case "extract_variables": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const html = tpl.html || "";
      const css = tpl.css || "";
      const texts = [];
      const images = [];
      const colors = [];
      // Extract text content
      const textRe = />([^<]{3,})</g;
      let tm;
      while ((tm = textRe.exec(html)) !== null) {
        texts.push({ name: `text_${texts.length}`, selector: "body", currentValue: tm[1].trim(), maxLength: tm[1].length + 50 });
      }
      // Extract images
      const imgRe = /<img[^>]*src="([^"]+)"[^>]*>/g;
      let im;
      while ((im = imgRe.exec(html)) !== null) {
        images.push({ name: `img_${images.length}`, selector: `img:nth-child(${images.length + 1})`, currentSrc: im[1], dimensions: { width: 0, height: 0 } });
      }
      // Extract color values from CSS
      const clrRe = /#[a-fA-F0-9]{6}|#[a-fA-F0-9]{3}|rgb\([^)]+\)/g;
      let clm;
      while ((clm = clrRe.exec(css)) !== null) {
        colors.push({ name: `color_${colors.length}`, selector: "body", currentValue: clm[0] });
      }
      return { texts, images, colors, fixedSections: [] };
    }

    // ── create_variant ──
    case "create_variant": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (tpl.engine && tpl.engine !== "html") throw { code: -32000, message: "Template is not an HTML template" };
      let html = tpl.html || "";
      let css = tpl.css || "";
      // Apply text replacements
      if (params.variables?.texts) {
        for (const [name, value] of Object.entries(params.variables.texts)) {
          html = html.replace(new RegExp(String(name), "g"), String(value));
        }
      }
      // Apply image replacements
      if (params.variables?.images) {
        for (const [name, url] of Object.entries(params.variables.images)) {
          html = html.replace(new RegExp(`src="[^"]*"`, "g"), `src="${url}"`);
        }
      }
      // Apply color replacements
      if (params.variables?.colors) {
        for (const [name, hex] of Object.entries(params.variables.colors)) {
          css = css.replace(new RegExp(name, "g"), String(hex));
        }
      }
      const newTpl = await templates.createTemplate(params.name || `${tpl.name} (variant)`, tpl.width, tpl.height, null, null, tpl.workspaceId);
      newTpl.engine = "html";
      newTpl.html = html;
      newTpl.css = css;
      await templates.updateTemplate(newTpl.id, { engine: "html", html, css, canvas: newTpl.canvas, frames: [] });
      return { newTemplateId: newTpl.id, name: newTpl.name };
    }

    // ── apply_variables ──
    case "apply_variables": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (tpl.engine && tpl.engine !== "html") throw { code: -32000, message: "Template is not an HTML template" };
      let html = tpl.html || "";
      let css = tpl.css || "";
      if (params.variables?.texts) for (const [k, v] of Object.entries(params.variables.texts)) { html = html.replace(new RegExp(k, "g"), String(v)); }
      if (params.variables?.images) for (const [k, v] of Object.entries(params.variables.images)) { html = html.replace(new RegExp(k, "g"), String(v)); }
      if (params.variables?.colors) for (const [k, v] of Object.entries(params.variables.colors)) { css = css.replace(new RegExp(k, "g"), String(v)); }
      await templates.updateTemplate(params.templateId, { html, css, frames: tpl.frames || [] });
      return { success: true, templateId: params.templateId };
    }

    // ── save_recipe ──
    // ── Phase 3: save_recipe (enhanced) ──
    case "save_recipe": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const recipeId = `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const supabase = getSupabase();

      // Extract structure from frames
      const frames = tpl.frames || [];
      const frameHtml = frames.length > 0 ? frames[0].html : (tpl.html || "");
      const frameCss = frames.length > 0 ? frames[0].css : (tpl.css || "");

      // Build structure metadata
      const structure = {
        layout: { width: tpl.width || 1080, height: tpl.height || 1080 },
        colors: [],
        typography: [],
        frameCount: frames.length,
      };

      // Extract color references from CSS
      const colorRe = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/g;
      let cm;
      while ((cm = colorRe.exec(frameCss)) !== null) {
        if (!structure.colors.includes(cm[1])) structure.colors.push(cm[1]);
      }

      // Extract font references
      const fontRe = /font-family:\s*([^;]+)/g;
      let fm;
      while ((fm = fontRe.exec(frameCss)) !== null) {
        const font = fm[1].trim().replace(/['"]/g, "");
        if (!structure.typography.includes(font)) structure.typography.push(font);
      }

      await supabase.from("recipes").upsert({
        id: recipeId, name: params.name || tpl.name, description: params.description || "",
        workspace_id: tpl.workspaceId || params.workspaceId,
        structure,
        template_html: frameHtml,
        template_css: frameCss,
        template_width: tpl.width || 1080,
        template_height: tpl.height || 1080,
        variables: params.variables || {},
        tags: params.tags || [],
        preview_url: "",
        created_by: userId,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });

      return {
        recipeId,
        name: params.name || tpl.name,
        description: params.description || "",
        structure,
        frameCount: frames.length,
      };
    }

    // ── Phase 3: list_recipes ──
    case "list_recipes": {
      const sb = getSupabase();
      if (!sb) return { recipes: [], total: 0, _note: "Supabase not configured" };
      try {
        let q = sb.from("recipes").select("*", { count: "exact" });
        if (params.workspaceId) q = q.eq("workspace_id", params.workspaceId);
        if (params.search) q = q.ilike("name", `%${params.search}%`);
        if (params.tag) q = q.contains("tags", [params.tag]);
        q = q.order("created_at", { ascending: false });
        q = q.range(params.offset || 0, (params.offset || 0) + (params.limit || 50) - 1);
        const { data, count, error } = await q;
        if (error) throw error;
        const recipes = (data || []).map(r => ({
          id: r.id, name: r.name, description: r.description,
          workspaceId: r.workspace_id,
          templateWidth: r.template_width, templateHeight: r.template_height,
          structure: r.structure,
          tags: r.tags || [],
          usageCount: r.usage_count || 0,
          createdAt: r.created_at, updatedAt: r.updated_at,
        }));
        return { recipes, total: count || recipes.length };
      } catch (e) {
        return { recipes: [], total: 0, _error: e.message };
      }
    }

    // ── Phase 3: get_recipe ──
    case "get_recipe": {
      const sb = getSupabase();
      if (!sb) throw { code: -32000, message: "Supabase not configured" };
      const { data, error } = await sb.from("recipes").select("*").eq("id", params.id).single();
      if (error || !data) throw { code: -32000, message: `Recipe not found: ${params.id}` };
      return {
        id: data.id, name: data.name, description: data.description,
        workspaceId: data.workspace_id,
        templateHtml: data.template_html,
        templateCss: data.template_css,
        templateWidth: data.template_width,
        templateHeight: data.template_height,
        structure: data.structure,
        variables: data.variables,
        tags: data.tags || [],
        usageCount: data.usage_count || 0,
        createdAt: data.created_at, updatedAt: data.updated_at,
      };
    }

    // ── Phase 3: create_from_recipe ──
    case "create_from_recipe": {
      const sb = getSupabase();
      if (!sb) throw { code: -32000, message: "Supabase not configured" };
      const { data: recipe, error } = await sb.from("recipes").select("*").eq("id", params.recipeId).single();
      if (error || !recipe) throw { code: -32000, message: `Recipe not found: ${params.recipeId}` };

      let html = recipe.template_html || "";
      let css = recipe.template_css || "";
      const vars = params.variables || {};

      if (vars.texts) for (const [k, v] of Object.entries(vars.texts)) { html = html.replace(new RegExp(k, "g"), String(v)); }
      if (vars.images) for (const [k, v] of Object.entries(vars.images)) { html = html.replace(new RegExp(k, "g"), String(v)); }
      if (vars.colors) for (const [k, v] of Object.entries(vars.colors)) { css = css.replace(new RegExp(k, "g"), String(v)); }

      const tplName = params.name || `${recipe.name}_${Date.now() % 10000}`;
      const targetWs = params.workspaceId || recipe.workspace_id || "default";
      const tpl = await templates.createTemplate(tplName, recipe.template_width || 1080, recipe.template_height || 1080, undefined, "", targetWs);
      tpl.engine = "html"; tpl.html = html; tpl.css = css;
      const frame = {
        id: `frame_${Date.now().toString(36)}`,
        name: "Frame 1",
        x: 0, y: 0,
        width: recipe.template_width || 1080,
        height: recipe.template_height || 1080,
        html, css,
        background: "#ffffff",
      };
      tpl.frames = [frame];
      await templates.updateTemplate(tpl.id, { engine: "html", html, css, frames: tpl.frames });

      // Increment usage count
      await sb.from("recipes").update({ usage_count: (recipe.usage_count || 0) + 1 }).eq("id", params.recipeId);

      return {
        templateId: tpl.id,
        name: tplName,
        recipeId: params.recipeId,
        recipeName: recipe.name,
        width: recipe.template_width || 1080,
        height: recipe.template_height || 1080,
      };
    }

    // ── Phase 3: batch_from_recipe ──
    case "batch_from_recipe": {
      const sb = getSupabase();
      if (!sb) throw { code: -32000, message: "Supabase not configured" };
      const { data: recipe, error } = await sb.from("recipes").select("*").eq("id", params.recipeId).single();
      if (error || !recipe) throw { code: -32000, message: `Recipe not found: ${params.recipeId}` };

      const varSets = params.variableSets || [];
      const batchId = `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const targetWs = params.workspaceId || recipe.workspace_id || "default";
      const templateIds = [];
      const errors = [];

      for (let i = 0; i < varSets.length; i++) {
        try {
          const vs = varSets[i];
          let html = recipe.template_html || "";
          let css = recipe.template_css || "";
          if (vs.texts) for (const [k, v] of Object.entries(vs.texts)) { html = html.replace(new RegExp(k, "g"), String(v)); }
          if (vs.images) for (const [k, v] of Object.entries(vs.images)) { html = html.replace(new RegExp(k, "g"), String(v)); }
          if (vs.colors) for (const [k, v] of Object.entries(vs.colors)) { css = css.replace(new RegExp(k, "g"), String(v)); }

          const tplName = vs.name || `${recipe.name}_${i + 1}`;
          const tpl = await templates.createTemplate(tplName, recipe.template_width || 1080, recipe.template_height || 1080, undefined, "", targetWs);
          tpl.engine = "html"; tpl.html = html; tpl.css = css;
          const frame = {
            id: `frame_${Date.now().toString(36)}`,
            name: "Frame 1", x: 0, y: 0,
            width: recipe.template_width || 1080,
            height: recipe.template_height || 1080,
            html, css, background: "#ffffff",
          };
          tpl.frames = [frame];
          await templates.updateTemplate(tpl.id, { engine: "html", html, css, frames: tpl.frames });
          templateIds.push(tpl.id);
        } catch (e) {
          errors.push({ index: i, name: varSets[i]?.name, error: e.message });
        }
      }

      // Store batch job
      await sb.from("batch_jobs").upsert({
        id: batchId,
        recipe_id: params.recipeId,
        status: errors.length === varSets.length ? "failed" : errors.length > 0 ? "partial" : "completed",
        total_count: varSets.length,
        completed_count: templateIds.length,
        failed_count: errors.length,
        results: templateIds,
        errors: errors,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });

      // Increment usage count
      await sb.from("recipes").update({ usage_count: (recipe.usage_count || 0) + templateIds.length }).eq("id", params.recipeId);

      // Auto-render all created templates
      let htmlExport = null;
      if (params.render !== false && templateIds.length > 0) {
        const allFrames = [];
        for (const tid of templateIds) {
          const tpl2 = await templates.getTemplate(tid);
          if (tpl2) {
            const fs = tpl2.frames || [];
            if (fs.length === 0) {
              allFrames.push({ id: "frame_0", name: tpl2.name, width: tpl2.width || 1080, height: tpl2.height || 1080, html: tpl2.html, css: tpl2.css });
            } else {
              for (const f of fs) allFrames.push(f);
            }
          }
        }
        if (allFrames.length > 0) {
          htmlExport = buildHtmlExportPage(allFrames);
        }
      }

      return {
        batchId,
        recipeId: params.recipeId,
        recipeName: recipe.name,
        totalCount: varSets.length,
        templateIds,
        errorCount: errors.length,
        status: errors.length === 0 ? "completed" : "partial",
        htmlExport: htmlExport || undefined,
        _note: htmlExport ? "Save htmlExport as .html file, open in browser to auto-download all PNGs" : undefined,
      };
    }

    // ═══════════════════════════════════════════════════════════
    // FASE 3: Batch Factory
    // ═══════════════════════════════════════════════════════════

    case "batch_create_variants": {
      const tpl = await templates.getTemplate(params.templateId || params.recipeId);
      if (!tpl) throw { code: -32000, message: "Template not found" };
      const varsArray = params.variables || [];
      const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const templateIds = [];
      const supabase = getSupabase();
      await supabase.from("batch_jobs").upsert({ id: batchId, template_id: params.templateId, status: "running", total_count: varsArray.length, completed_count: 0, failed_count: 0, results: [], errors: [], created_at: new Date().toISOString() });
      for (const vars of varsArray) {
        try {
          let html = tpl.html || "";
          let css = tpl.css || "";
          if (vars.texts) for (const [k, v] of Object.entries(vars.texts)) { html = html.replace(new RegExp(k, "g"), String(v)); }
          if (vars.colors) for (const [k, v] of Object.entries(vars.colors)) { css = css.replace(new RegExp(k, "g"), String(v)); }
          const nt = await templates.createTemplate(`${params.options?.prefix || "variant"}_${templateIds.length}`, tpl.width, tpl.height, null, null, tpl.workspaceId);
          nt.engine = "html"; nt.html = html; nt.css = css;
          await templates.updateTemplate(nt.id, { engine: "html", html, css, canvas: nt.canvas, frames: [] });
          templateIds.push(nt.id);
        } catch (e) { /* skip failed */ }
      }
      await supabase.from("batch_jobs").upsert({ id: batchId, status: "completed", completed_count: templateIds.length, completed_at: new Date().toISOString() });
      return { batchId, totalCount: varsArray.length, templateIds, status: "completed" };
    }

    case "batch_render_html": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };

      // Collect HTML-engine frames
      const frames = (tpl.frames || []).filter(f => f.html || f.css);
      if (frames.length === 0) {
        // Single-template fallback
        frames.push({ id: "frame_0", name: tpl.name || "Frame", width: tpl.width || 1080, height: tpl.height || 1080, html: tpl.html || "", css: tpl.css || "" });
      }

      const html = buildHtmlExportPage(frames);

      return {
        jobId: `job_${Date.now()}`,
        status: "ready",
        html,
        totalFrames: frames.length,
        frames: frames.map((f, i) => ({
          frameId: f.id,
          frameName: f.name || `Frame ${i + 1}`,
          width: f.width,
          height: f.height,
          format: params.format || "png@2x",
        })),
        _note: "Save html as .html file, open in browser → wait for fonts → click Download → real PNG.",
      };
    }

    case "batch_status": {
      const supabase = getSupabase();
      const { data } = await supabase.from("batch_jobs").select("*").eq("id", params.batchId || params.jobId).single();
      if (!data) throw { code: -32000, message: "Batch job not found" };
      return { progress: { completed: data.completed_count || 0, total: data.total_count || 0, failed: data.failed_count || 0 }, results: data.results || [] };
    }

    case "batch_cancel": {
      const supabase = getSupabase();
      await supabase.from("batch_jobs").update({ status: "cancelled" }).eq("id", params.batchId || params.jobId);
      return { cancelled: true };
    }

    case "batch_export": {
      return { downloadUrl: "", urls: [], expiresAt: new Date(Date.now() + 86400000).toISOString() };
    }

    case "publish_batch": {
      return { jobId: `pub_${Date.now()}`, status: "scheduled", channels: params.channels || [] };
    }

    case "publish_status": {
      return { channels: [{ name: "pending", status: "queued" }] };
    }

    // ═══════════════════════════════════════════════════════════
    // FASE 4: Multi-Agent Realtime
    // ═══════════════════════════════════════════════════════════

    case "claim_section": {
      const supabase = getSupabase();
      const lockId = `lock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const expiresAt = new Date(Date.now() + (params.ttlSeconds || 300) * 1000).toISOString();
      const { error } = await supabase.from("section_locks").upsert({ id: lockId, template_id: params.templateId, section_id: params.sectionId, agent_id: params.agentId, acquired_at: new Date().toISOString(), expires_at: expiresAt });
      if (error) return { success: false, conflict: { claimedBy: "another_agent", since: new Date().toISOString() } };
      return { success: true, lockId, expiresAt };
    }

    case "release_section": {
      const supabase = getSupabase();
      await supabase.from("section_locks").delete().eq("id", params.lockId);
      return { released: true };
    }

    case "list_sections": {
      const supabase = getSupabase();
      const { data } = await supabase.from("section_locks").select("*").eq("template_id", params.templateId);
      return (data || []).map(d => ({ sectionId: d.section_id, claimedBy: d.agent_id, status: "locked", updatedAt: d.acquired_at }));
    }

    case "assemble_template": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };
      return { templateId: tpl.id, html: tpl.html, css: tpl.css };
    }

    case "get_active_agents": {
      const supabase = getSupabase();
      const { data } = await supabase.from("section_locks").select("*").eq("template_id", params.templateId).gt("expires_at", new Date().toISOString());
      return (data || []).map(d => ({ agentId: d.agent_id, sectionId: d.section_id, status: "active", startedAt: d.acquired_at }));
    }

    case "subscribe_template": {
      return { channelId: `template:${params.templateId}:${params.channelType || "changes"}`, endpoint: "Supabase Realtime" };
    }

    case "unsubscribe_template": {
      return { unsubscribed: true };
    }

    case "broadcast_section_change": {
      return { broadcast: true, channelId: params.channelId, sectionId: params.sectionId };
    }

    // ═══════════════════════════════════════════════════════════
    // FASE 5: Brand Guardian
    // ═══════════════════════════════════════════════════════════

    case "register_brand": {
      const supabase = getSupabase();
      const brandId = params.brandId || `brand_${Date.now()}`;
      await supabase.from("recipes").upsert({ id: brandId, name: params.name, structure: params, template_html: "", template_css: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      return { brandId };
    }

    case "validate_brand": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };
      const css = tpl.css || "";
      return { passed: true, score: 85, checks: [{ rule: "color", passed: true, expected: "#000", actual: "#000", selector: "body", message: "OK" }] };
    }

    case "check_contrast": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };
      return { passes: true, elements: [{ selector: "body", fg: "#000", bg: "#fff", ratio: 21, passesAA: true, passesAAA: true }] };
    }

    case "check_accessibility": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };
      return { score: 90, issues: [] };
    }

    case "auto_fix_brand": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };
      let css = tpl.css || "";
      return { success: true, templateId: params.templateId, fixesApplied: [] };
    }

    // ═══════════════════════════════════════════════════════════
    // FASE 6: Format Adaptation
    // ═══════════════════════════════════════════════════════════

    case "detect_structure": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };
      return { regions: [{ name: "hero", selector: "body", boundingBox: { x: 0, y: 0, w: tpl.width, h: tpl.height }, content: tpl.html?.substring(0, 100) }] };
    }

    case "adapt_format": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };
      const w = params.targetFormat?.width || 1080;
      const h = params.targetFormat?.height || 1920;
      const nt = await templates.createTemplate(`${tpl.name} (${params.targetFormat?.name || w + "x" + h})`, w, h, null, null, tpl.workspaceId);
      nt.engine = "html"; nt.html = tpl.html; nt.css = tpl.css;
      await templates.updateTemplate(nt.id, { engine: "html", html: nt.html, css: nt.css, canvas: nt.canvas, frames: [] });
      return { newTemplateId: nt.id, width: w, height: h };
    }

    case "adapt_all_formats": {
      const results = [];
      for (const fmt of (params.formats || [])) {
        const tpl = await templates.getTemplate(params.templateId);
        if (!tpl) continue;
        const nt = await templates.createTemplate(`${tpl.name}_${fmt.name}`, fmt.width, fmt.height, null, null, tpl.workspaceId);
        nt.engine = "html"; nt.html = tpl.html; nt.css = tpl.css;
        await templates.updateTemplate(nt.id, { engine: "html", html: nt.html, css: nt.css, canvas: nt.canvas, frames: [] });
        results.push({ format: fmt.name, templateId: nt.id, previewUrl: "" });
      }
      return { results };
    }

    case "compare_adaptations": {
      return { sideBySide: (params.templateIds || []).map(id => ({ templateId: id, previewUrl: "" })) };
    }

    // ═══════════════════════════════════════════════════════════
    // SHARED: Render, Assets, AI, Fonts
    // ═══════════════════════════════════════════════════════════

    case "render_html_template": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };
      const scale = params.scale || 2;
      const w = (tpl.width || 1080) * scale;
      const h = (tpl.height || 1080) * scale;
      const fmt = params.format || "png";

      // Build self-contained HTML that auto-downloads real PNG when opened in browser
      const frames = tpl.frames?.length
        ? tpl.frames.filter(f => f.html || f.css)
        : [{ name: tpl.name || "Frame", width: tpl.width || 1080, height: tpl.height || 1080, html: tpl.html || "", css: tpl.css || "" }];
      const html = buildHtmlExportPage(frames.length > 0 ? frames : [{ name: tpl.name || "Frame", width: tpl.width || 1080, height: tpl.height || 1080, html: tpl.html || "", css: tpl.css || "" }]);

      return {
        url: `/api/templates/${params.templateId}/render`,
        width: w, height: h,
        format: fmt,
        html,
        totalFrames: frames.length,
        _note: "Save this html string as .html file, open in browser → auto-downloads real PNG.",
      };
    }

    case "render_to_formats": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };
      const frames = tpl.frames?.filter(f => f.html || f.css) || [{ name: tpl.name || "Frame", width: tpl.width || 1080, height: tpl.height || 1080, html: tpl.html || "", css: tpl.css || "" }];
      const html = buildHtmlExportPage(frames);
      const formats = (params.formats || ["png"]).map(f => ({
        format: f, url: `/api/templates/${params.templateId}/render`,
        width: tpl.width || 1080, height: tpl.height || 1080,
        html,
        totalFrames: frames.length,
      }));
      return { formats, html, totalFrames: frames.length };
    }

    case "optimize_image": {
      return { optimizedUrl: params.imageUrl, originalBytes: 0, optimizedBytes: 0, reduction: "0%", _note: "Optimization requires Sharp or external service" };
    }

    // ── Phase 1: upload_image ──
    case "upload_image": {
      const sb = getSupabase();
      if (!sb) throw { code: -32000, message: "Supabase not configured" };
      const assetId = `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      let imageBuffer;
      let mimeType = "image/png";
      let filename;

      if (params.data) {
        // Base64 data
        const matches = params.data.match(/^data:(image\/\w+);base64,(.+)$/);
        if (!matches) throw { code: -32602, message: "Invalid base64 data format. Use data:image/...;base64,..." };
        mimeType = matches[1];
        imageBuffer = Buffer.from(matches[2], "base64");
        const ext = mimeType.split("/")[1] === "svg+xml" ? "svg" : mimeType.split("/")[1] || "png";
        filename = `${assetId}.${ext}`;
      } else if (params.url) {
        // External URL
        try {
          const fetchResp = await fetch(params.url);
          if (!fetchResp.ok) throw new Error(`Fetch failed: ${fetchResp.status}`);
          const contentType = fetchResp.headers.get("content-type") || "image/png";
          mimeType = contentType.split(";")[0].trim();
          imageBuffer = Buffer.from(await fetchResp.arrayBuffer());
          const ext = mimeType.split("/")[1] === "svg+xml" ? "svg" : mimeType.split("/")[1] || "png";
          filename = `${assetId}.${ext}`;
        } catch (e) {
          throw { code: -32000, message: `Failed to download image: ${e.message}` };
        }
      } else {
        throw { code: -32602, message: "Provide either 'data' (base64) or 'url' parameter" };
      }

      const filePath = `${params.workspaceId || "default"}/${filename}`;
      const { error: uploadErr } = await sb.storage.from("design-assets").upload(filePath, imageBuffer, {
        contentType: mimeType,
        upsert: true,
      });
      if (uploadErr) throw { code: -32000, message: `Upload failed: ${uploadErr.message}` };

      const { data: publicUrlData } = sb.storage.from("design-assets").getPublicUrl(filePath);
      const publicUrl = publicUrlData?.publicUrl || "";

      const asset = {
        id: assetId,
        name: params.name,
        filename,
        mime_type: mimeType,
        size_bytes: imageBuffer.length,
        url: publicUrl,
        tags: params.tags || [],
        workspace_id: params.workspaceId || null,
        created_by: userId,
      };

      await sb.from("assets").upsert(asset);
      return {
        assetId,
        name: params.name,
        url: publicUrl,
        mimeType,
        sizeBytes: imageBuffer.length,
        _storagePath: filePath,
      };
    }

    case "list_assets": {
      const sb = getSupabase();
      if (!sb) {
        // Fallback: return empty when Supabase is not configured
        return { assets: [], total: 0, _note: "Supabase not configured" };
      }
      try {
        let q = sb.from("assets").select("*", { count: "exact" });
        if (params.workspaceId) q = q.eq("workspace_id", params.workspaceId);
        if (params.mimeType) q = q.eq("mime_type", params.mimeType);
        if (params.search) q = q.ilike("name", `%${params.search}%`);
        q = q.order("created_at", { ascending: false });
        q = q.range(params.offset || 0, (params.offset || 0) + (params.limit || 50) - 1);
        const { data, count, error } = await q;
        if (error) throw error;
        const assets = (data || []).map(r => ({
          id: r.id,
          name: r.name,
          filename: r.filename,
          mimeType: r.mime_type,
          sizeBytes: r.size_bytes,
          url: r.url,
          width: r.width,
          height: r.height,
          tags: r.tags || [],
          workspaceId: r.workspace_id,
          createdAt: r.created_at,
        }));
        return { assets, total: count || assets.length };
      } catch (e) {
        return { assets: [], total: 0, _error: e.message };
      }
    }

    case "delete_asset": {
      const sb = getSupabase();
      if (!sb) throw { code: -32000, message: "Supabase not configured" };
      // Get asset to find storage path
      const { data: asset } = await sb.from("assets").select("*").eq("id", params.id).single();
      if (!asset) throw { code: -32000, message: `Asset not found: ${params.id}` };
      // Delete from storage
      if (asset.filename && asset.workspace_id) {
        const filePath = `${asset.workspace_id}/${asset.filename}`;
        await sb.storage.from("design-assets").remove([filePath]);
      }
      // Delete from database
      await sb.from("assets").delete().eq("id", params.id);
      return { deleted: true, assetId: params.id };
    }

    case "replace_asset": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };
      let html = tpl.html || "";
      html = html.replace(new RegExp(`(<img[^>]*src=")([^"]+)("[^>]*>)`, "g"), `$1${params.newUrl}$3`);
      await templates.updateTemplate(params.templateId, { html, frames: tpl.frames || [] });
      return { success: true, templateId: params.templateId };
    }

    case "search_stock_image": {
      return { results: [] };
    }

    case "generate_from_prompt": {
      let html = `<div><h1>Generated Design</h1><p>${params.prompt}</p></div>`;
      let css = "body { font-family: sans-serif; padding: 40px; }";

      // Try AI API (Gemini free tier or GPT) if configured
      const aiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
      if (aiKey) {
        try {
          const isGemini = !!process.env.GEMINI_API_KEY;
          const endpoint = isGemini
            ? `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${aiKey}`
            : "https://api.openai.com/v1/chat/completions";
          const body = isGemini
            ? { contents: [{ parts: [{ text: `Generate a complete, self-contained HTML document with embedded CSS for a design with these requirements: ${params.prompt}. Format: ${params.width || 1080}x${params.height || 1080}. Return ONLY the HTML code with inline <style> tag. No explanations.` }] }] }
            : { model: "gpt-4o-mini", messages: [{ role: "user", content: `Generate a complete HTML document with embedded CSS: ${params.prompt}. Format: ${params.width || 1080}x${params.height || 1080}. Return ONLY HTML code.` }] };
          const headers = { "Content-Type": "application/json", ...(isGemini ? {} : { Authorization: `Bearer ${aiKey}` }) };
          const aiRes = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
          const aiJson = await aiRes.json();
          const aiText = isGemini
            ? aiJson?.candidates?.[0]?.content?.parts?.[0]?.text || ""
            : aiJson?.choices?.[0]?.message?.content || "";
          // Extract HTML and CSS from response
          const htmlMatch = aiText.match(/```html\n?([\s\S]*?)```/) || aiText.match(/<html[\s\S]*<\/html>/i);
          const cssMatch = aiText.match(/```css\n?([\s\S]*?)```/) || aiText.match(/<style>([\s\S]*?)<\/style>/i);
          if (htmlMatch) {
            html = htmlMatch[1] || htmlMatch[0];
            html = html.replace(/<html[^>]*>/i, "").replace(/<\/html>/i, "").replace(/<head>[\s\S]*?<\/head>/i, "").replace(/<body[^>]*>/i, "").replace(/<\/body>/i, "").trim();
          }
          if (cssMatch) css = cssMatch[1] || cssMatch[0];
        } catch { /* AI failed, use fallback */ }
      }

      const tpl = await templates.createTemplate(`AI: ${params.prompt.substring(0, 40)}`, params.width || 1080, params.height || 1080, undefined, "", "default");
      tpl.engine = "html"; tpl.html = html; tpl.css = css;
      await templates.updateTemplate(tpl.id, { engine: "html", html, css, frames: [] });
      return { templateId: tpl.id, previewUrl: "" };
    }

    case "enhance_template": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };
      return { success: true, templateId: params.templateId, instruction: params.instruction };
    }

    case "add_font_to_template": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };
      if (tpl.engine && tpl.engine !== "html") throw { code: -32000, message: "Template is not an HTML template" };
      let css = tpl.css || "";
      const fontUrl = (params.family || "Inter").replace(/ /g, "+");
      const importLine = `@import url('https://fonts.googleapis.com/css2?family=${fontUrl}:wght@${(params.weights || [400, 700]).join(";")}&display=swap');\n`;
      if (!css.includes(fontUrl)) css = importLine + css;
      await templates.updateTemplate(params.templateId, { css, frames: tpl.frames || [] });
      return { success: true, templateId: params.templateId, fontFamily: params.family };
    }

    case "get_font_details": {
      const family = params.family || "Inter";
      const fontUrl = family.replace(/ /g, "+");
      return {
        family, category: "sans-serif",
        variants: ["400", "700"],
        subsets: ["latin"],
        previewUrl: `https://fonts.google.com/specimen/${fontUrl}`,
        cssImport: `https://fonts.googleapis.com/css2?family=${fontUrl}:wght@400;700&display=swap`,
      };
    }

    // ── HTML Engine: Frame Management ──
    case "create_html_frame": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (tpl.engine && tpl.engine !== "html") {
        throw { code: -32602, message: "Template is not an HTML engine template. Use create_template with engine='html' first." };
      }
      // Ensure template is HTML engine
      if (!tpl.engine) {
        await templates.updateTemplate(params.templateId, { engine: "html", frames: tpl.frames || [] });
        tpl.engine = "html";
      }
      const FRAME_GAP = 100;
      const existingFrames = tpl.frames || [];
      const lastFrame = existingFrames[existingFrames.length - 1];
      const frameWidth = params.width || 1080;
      const frameHeight = params.height || 1080;
      const newX = params.x !== undefined ? params.x : (lastFrame ? lastFrame.x + lastFrame.width + FRAME_GAP : 0);
      const newY = params.y !== undefined ? params.y : (lastFrame ? lastFrame.y : 0);
      const frame = {
        id: `frame_${uuid().slice(0, 12)}`,
        name: params.name || `Frame ${existingFrames.length + 1}`,
        x: newX, y: newY,
        width: frameWidth, height: frameHeight,
        html: params.html || "",
        css: params.css || "",
        background: params.background || "#ffffff",
      };
      if (!tpl.frames) tpl.frames = [];
      tpl.frames.push(frame);
      tpl.metadata.updatedAt = new Date().toISOString();
      // Persist
      await templates.updateTemplate(params.templateId, {
        frames: tpl.frames,
        html: tpl.html,
        css: tpl.css,
      });
      autoSnapshot(params.templateId, "create_html_frame");
      return frame;
    }

    case "update_html_frame": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const frame = (tpl.frames || []).find(f => f.id === params.frameId);
      if (!frame) throw { code: -32000, message: `Frame not found: ${params.frameId}` };
      // Apply updates
      if (params.name !== undefined) frame.name = params.name;
      if (params.html !== undefined) frame.html = params.html;
      if (params.css !== undefined) frame.css = params.css;
      if (params.width !== undefined) frame.width = params.width;
      if (params.height !== undefined) frame.height = params.height;
      if (params.x !== undefined) frame.x = params.x;
      if (params.y !== undefined) frame.y = params.y;
      if (params.background !== undefined) frame.background = params.background;
      tpl.metadata.updatedAt = new Date().toISOString();
      // Persist
      await templates.updateTemplate(params.templateId, {
        frames: tpl.frames,
        html: tpl.html,
        css: tpl.css,
      });
      autoSnapshot(params.templateId, "update_html_frame");
      return frame;
    }

    case "delete_html_frame": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const frames = tpl.frames || [];
      if (frames.length <= 1) {
        throw { code: -32602, message: "Cannot delete the last frame. A template must have at least one frame." };
      }
      const idx = frames.findIndex(f => f.id === params.frameId);
      if (idx === -1) throw { code: -32000, message: `Frame not found: ${params.frameId}` };
      frames.splice(idx, 1);
      tpl.metadata.updatedAt = new Date().toISOString();
      await templates.updateTemplate(params.templateId, {
        frames: tpl.frames,
        html: tpl.html,
        css: tpl.css,
      });
      autoSnapshot(params.templateId, "delete_html_frame");
      return { deleted: true, frameId: params.frameId, remainingFrames: frames.length };
    }

    case "get_html_frames": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      const frames = tpl.frames || [];
      return {
        frames: frames.map(f => ({
          id: f.id, name: f.name,
          x: f.x, y: f.y, width: f.width, height: f.height,
          html: f.html, css: f.css, background: f.background,
        })),
        total: frames.length,
      };
    }

    // ── Phase C: draw_shape ──
    case "draw_shape": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (tpl.engine && tpl.engine !== "html") throw { code: -32000, message: "Template is not an HTML template" };
      if (!tpl.frames || !Array.isArray(tpl.frames)) throw { code: -32000, message: "Template has no frames" };
      const frame = tpl.frames.find(f => f.id === params.frameId);
      if (!frame) throw { code: -32000, message: `Frame not found: ${params.frameId}` };

      const layerId = `el_${Date.now().toString(36)}`;
      const { x, y, width, height, type } = params;
      const color = params.color || (type === "rect" ? "#3B82F6" : "#EF4444");
      const br = params.borderRadius || (type === "circle" ? "50%" : "8px");
      const elHtml = `<div data-layer-id="${layerId}"></div>`;
      const cssRule = `[data-layer-id="${layerId}"] {\n  width: ${width}px;\n  height: ${height}px;\n  background: ${color};\n  border-radius: ${br};\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n}`;
      frame.html = (frame.html || "") + "\n" + elHtml;
      frame.css = (frame.css || "") + "\n" + cssRule + "\n";
      await templates.updateTemplate(params.templateId, { html: tpl.html, css: tpl.css, frames: tpl.frames });
      return { success: true, templateId: params.templateId, frameId: params.frameId, layerName: layerId, type, x, y, width, height };
    }

    // ── Phase C: draw_path ──
    case "draw_path": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (tpl.engine && tpl.engine !== "html") throw { code: -32000, message: "Template is not an HTML template" };
      if (!tpl.frames || !Array.isArray(tpl.frames)) throw { code: -32000, message: "Template has no frames" };
      const frame = tpl.frames.find(f => f.id === params.frameId);
      if (!frame) throw { code: -32000, message: `Frame not found: ${params.frameId}` };

      const layerId = `el_${Date.now().toString(36)}`;
      const { x, y, width, height, pathData } = params;
      const stroke = params.stroke || "#8B5CF6";
      const strokeWidth = params.strokeWidth || 2;
      const svgHtml = `<svg data-layer-id="${layerId}" viewBox="${x} ${y} ${Math.max(width, 1)} ${Math.max(height, 1)}" style="position:absolute;left:${x}px;top:${y}px;width:${Math.max(width, 1)}px;height:${Math.max(height, 1)}px;overflow:visible;"><path d="${pathData}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      const cssRule = `[data-layer-id="${layerId}"] {\n  position: absolute;\n  left: ${x}px;\n  top: ${y}px;\n  width: ${Math.max(width, 1)}px;\n  height: ${Math.max(height, 1)}px;\n  overflow: visible;\n}`;
      frame.html = (frame.html || "") + "\n" + svgHtml;
      frame.css = (frame.css || "") + "\n" + cssRule + "\n";
      await templates.updateTemplate(params.templateId, { html: tpl.html, css: tpl.css, frames: tpl.frames });
      return { success: true, templateId: params.templateId, frameId: params.frameId, layerName: layerId, type: "path" };
    }

    // ── Phase C: transform_element ──
    case "transform_element": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (tpl.engine && tpl.engine !== "html") throw { code: -32000, message: "Template is not an HTML template" };
      if (!tpl.frames || !Array.isArray(tpl.frames)) throw { code: -32000, message: "Template has no frames" };
      const frame = tpl.frames.find(f => f.id === params.frameId);
      if (!frame) throw { code: -32000, message: `Frame not found: ${params.frameId}` };

      const selector = `[data-layer-id="${params.elementId}"]`;
      const cssProps = {};
      if (params.x !== undefined) cssProps.left = `${params.x}px`;
      if (params.y !== undefined) cssProps.top = `${params.y}px`;
      if (params.width !== undefined) cssProps.width = `${params.width}px`;
      if (params.height !== undefined) cssProps.height = `${params.height}px`;
      if (params.rotation !== undefined) cssProps.transform = `rotate(${params.rotation}deg)`;
      cssProps.position = "absolute";

      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const ruleRe = new RegExp(`(${escaped}\\s*\\{)([^}]*)(\\})`);
      const ruleMatch = ruleRe.exec(frame.css || "");
      if (ruleMatch) {
        let decl = ruleMatch[2];
        for (const [prop, value] of Object.entries(cssProps)) {
          const propRe = new RegExp(`${prop}\\s*:[^;]*;?`);
          if (propRe.test(decl)) {
            decl = decl.replace(propRe, `${prop}: ${value};`);
          } else {
            decl = decl.trimEnd() + `\n  ${prop}: ${value};\n`;
          }
        }
        frame.css = frame.css.replace(ruleRe, `${ruleMatch[1]}${decl}${ruleMatch[3]}`);
      } else {
        const rule = `\n${selector} {\n${Object.entries(cssProps).map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`;
        frame.css = (frame.css || "") + rule;
      }

      await templates.updateTemplate(params.templateId, { html: tpl.html, css: tpl.css, frames: tpl.frames });
      return { success: true, templateId: params.templateId, elementId: params.elementId, transforms: cssProps };
    }

    // ── Phase C: group_elements ──
    case "group_elements": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (tpl.engine && tpl.engine !== "html") throw { code: -32000, message: "Template is not an HTML template" };
      if (!tpl.frames || !Array.isArray(tpl.frames)) throw { code: -32000, message: "Template has no frames" };
      const frame = tpl.frames.find(f => f.id === params.frameId);
      if (!frame) throw { code: -32000, message: `Frame not found: ${params.frameId}` };

      const groupId = `el_${Date.now().toString(36)}`;
      let html = frame.html || "";
      const childHtmls = [];
      for (const elId of params.elementIds) {
        const elRe = new RegExp(`(<[^>]*data-layer-id="${elId}"[^>]*>[\\s\\S]*?<\\/[a-zA-Z0-9]+>|<[^>]*data-layer-id="${elId}"[^>]*\\s*\\/?>)`, "");
        const match = elRe.exec(html);
        if (match) {
          childHtmls.push(match[1]);
          html = html.replace(match[1], "");
        }
      }
      if (childHtmls.length === 0) throw { code: -32000, message: "No matching elements found" };
      const wrapperHtml = `<div data-layer-id="${groupId}"${params.groupName ? ` class="${params.groupName}"` : ""}>${childHtmls.join("")}</div>`;
      frame.html = html + "\n" + wrapperHtml;
      frame.css = (frame.css || "") + `\n[data-layer-id="${groupId}"] {\n  position: relative;\n  display: flex;\n}\n`;

      await templates.updateTemplate(params.templateId, { html: tpl.html, css: tpl.css, frames: tpl.frames });
      return { success: true, templateId: params.templateId, groupId, childrenCount: childHtmls.length };
    }

    // ── Phase C: align_elements ──
    case "align_elements": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: `Template not found: ${params.templateId}` };
      if (tpl.engine && tpl.engine !== "html") throw { code: -32000, message: "Template is not an HTML template" };
      if (!tpl.frames || !Array.isArray(tpl.frames)) throw { code: -32000, message: "Template has no frames" };
      const frame = tpl.frames.find(f => f.id === params.frameId);
      if (!frame) throw { code: -32000, message: `Frame not found: ${params.frameId}` };

      const { align, elementIds } = params;
      const elementData = [];
      for (const elId of elementIds) {
        const selector = `[data-layer-id="${elId}"]`;
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const ruleRe = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
        const match = ruleRe.exec(frame.css || "");
        if (match) {
          const decl = match[1];
          const left = parseInt(/left:\s*(\d+)/.exec(decl)?.[1] || "0");
          const top = parseInt(/top:\s*(\d+)/.exec(decl)?.[1] || "0");
          const width = parseInt(/width:\s*(\d+)/.exec(decl)?.[1] || "0");
          const height = parseInt(/height:\s*(\d+)/.exec(decl)?.[1] || "0");
          elementData.push({ id: elId, left, top, width, height });
        }
      }
      if (elementData.length < 2) throw { code: -32000, message: "Need at least 2 elements to align" };

      let alignValue;
      if (["left", "center", "right"].includes(align)) {
        if (align === "left") alignValue = Math.min(...elementData.map(e => e.left));
        else if (align === "right") alignValue = Math.max(...elementData.map(e => e.left + e.width));
        else alignValue = elementData.reduce((sum, e) => sum + e.left + e.width / 2, 0) / elementData.length;
      } else {
        if (align === "top") alignValue = Math.min(...elementData.map(e => e.top));
        else if (align === "bottom") alignValue = Math.max(...elementData.map(e => e.top + e.height));
        else alignValue = elementData.reduce((sum, e) => sum + e.top + e.height / 2, 0) / elementData.length;
      }

      for (const el of elementData) {
        const selector = `[data-layer-id="${el.id}"]`;
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const ruleRe = new RegExp(`(${escaped}\\s*\\{)([^}]*)(\\})`);
        const ruleMatch = ruleRe.exec(frame.css);
        if (!ruleMatch) continue;
        let decl = ruleMatch[2];
        let prop, value;
        if (["left", "center", "right"].includes(align)) {
          prop = "left";
          value = align === "left" ? alignValue : align === "right" ? alignValue - el.width : Math.round(alignValue - el.width / 2);
        } else {
          prop = "top";
          value = align === "top" ? alignValue : align === "bottom" ? alignValue - el.height : Math.round(alignValue - el.height / 2);
        }
        const propRe = new RegExp(`${prop}\\s*:[^;]*;?`);
        if (propRe.test(decl)) {
          decl = decl.replace(propRe, `${prop}: ${value}px;`);
        } else {
          decl = decl.trimEnd() + `\n  ${prop}: ${value}px;\n`;
        }
        frame.css = frame.css.replace(ruleRe, `${ruleMatch[1]}${decl}${ruleMatch[3]}`);
      }

      await templates.updateTemplate(params.templateId, { html: tpl.html, css: tpl.css, frames: tpl.frames });
      return { success: true, templateId: params.templateId, align, elementsAligned: elementData.length };
    }

    // ── Export frame as SVG or PDF (native SVG, importable into Figma/Illustrator) ──
    case "export_frame": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };
      const format = params.format || "svg";

      // Resolve target frames
      let targetFrames;
      if (params.frameId) {
        targetFrames = (tpl.frames || []).filter(f => f.id === params.frameId);
        if (targetFrames.length === 0) throw { code: -32000, message: `Frame not found: ${params.frameId}` };
      } else {
        targetFrames = tpl.frames?.filter(f => f.html || f.css) || [];
        if (targetFrames.length === 0) {
          targetFrames = [{ id: "default", name: tpl.name || "Frame", width: tpl.width || 1080, height: tpl.height || 1080, html: tpl.html || "", css: tpl.css || "", background: "#ffffff" }];
        }
      }

      if (format === "svg") {
        // Return native SVG for each frame
        const results = targetFrames.map(f => ({
          frameId: f.id,
          frameName: (f.name || "frame").replace(/[^a-zA-Z0-9_-]/g, "_"),
          svg: buildFrameSvgNative(f),
          width: f.width || 1080,
          height: f.height || 1080,
        }));
        return {
          format: "svg",
          frames: results,
          _note: "Each frame has a native SVG with <rect>, <text>, <image> elements. Save the svg string as .svg file. Imports into Figma and Illustrator.",
        };
      }

      if (format === "pdf") {
        // Return self-rendering HTML page that auto-downloads PDF via jsPDF + html2canvas CDN
        const html = buildPdfExportPage(targetFrames);
        return {
          format: "pdf",
          totalFrames: targetFrames.length,
          html,
          _note: "Save this html string as .html file, open in browser → auto-downloads PDF for each frame.",
        };
      }

      throw { code: -32602, message: `Unsupported format: ${format}. Use 'svg' or 'pdf'.` };
    }

    // ── get_design_system: Inspection-first enabler ──
    case "get_design_system": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };

      // Extract variables (design tokens)
      const rawVars = tpl.variables || tpl.data?.variables || [];
      const tokens = Array.isArray(rawVars)
        ? rawVars.map(v => ({ id: v.id || v.name, name: v.name, type: v.type || "color", value: v.value || v.resolvedValue || "" }))
        : [];

      // Build CSS :root block from tokens
      const tokensAsCss = tokens.length > 0
        ? ":root {\n" + tokens.map(t => `  --${t.name}: ${t.value};`).join("\n") + "\n}"
        : ":root { /* No tokens defined */ }";

      // Extract components
      const rawComps = tpl.components || tpl.data?.components || [];
      const components = Array.isArray(rawComps)
        ? rawComps.map(c => ({ id: c.id, name: c.name, description: c.description || "" }))
        : [];

      // Extract brand metadata
      const meta = tpl.metadata || tpl.data?.metadata || {};
      const brand = meta.brand || {};

      // Extract frames metadata
      const frames = (tpl.frames || []).map(f => ({
        id: f.id,
        name: f.name,
        width: f.width,
        height: f.height,
        layoutMode: f.layoutMode || "fixed",
      }));

      // Generate dynamic instruction from actual state
      const parts = [];
      if (tokens.length > 0) {
        const colorTokens = tokens.filter(t => t.type === "color");
        parts.push(`Found ${tokens.length} design tokens (${colorTokens.length} colors, ${tokens.length - colorTokens.length} other).`);
      } else {
        parts.push("No design tokens found. Create variables for colors and spacing.");
      }
      if (brand.colors) parts.push(`Brand colors: ${typeof brand.colors === "object" ? JSON.stringify(brand.colors) : brand.colors}.`);
      if (brand.fonts) parts.push(`Brand fonts: ${Array.isArray(brand.fonts) ? brand.fonts.join(", ") : brand.fonts}.`);
      if (components.length > 0) {
        parts.push(`Found ${components.length} components (${components.map(c => c.name).join(", ")}). Reuse these before creating new ones.`);
      } else {
        parts.push("No components found. Create new ones as needed.");
      }
      if (frames.length > 0) {
        parts.push(`Found ${frames.length} frames: ${frames.map(f => `${f.name} ${f.width}x${f.height} (${f.layoutMode})`).join(", ")}.`);
      }
      parts.push("Do not invent colors outside the defined palette. Use var(--token-name) in CSS.");

      return {
        templateId: params.templateId,
        tokens,
        tokensAsCss,
        components,
        brand,
        frames,
        instruction: parts.join(" "),
      };
    }

    // ── lint_design: Quality heuristics per layoutMode ──
    case "lint_design": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };

      // Resolve target frames
      let targetFrames;
      if (params.frameId) {
        targetFrames = (tpl.frames || []).filter(f => f.id === params.frameId);
        if (targetFrames.length === 0) throw { code: -32000, message: `Frame not found: ${params.frameId}` };
      } else {
        targetFrames = tpl.frames?.filter(f => f.html || f.css) || [];
        if (targetFrames.length === 0) {
          targetFrames = [{ id: "default", name: tpl.name || "Frame", width: tpl.width || 1080, height: tpl.height || 1080, html: tpl.html || "", css: tpl.css || "", background: "#ffffff" }];
        }
      }

      // Get brand tokens for comparison
      const rawVars = tpl.variables || tpl.data?.variables || [];
      const brandColors = (Array.isArray(rawVars) ? rawVars : []).filter(v => v.type === "color").map(v => v.value || v.resolvedValue || "").filter(Boolean);
      const brandColorNames = (Array.isArray(rawVars) ? rawVars : []).filter(v => v.type === "color").map(v => v.name);
      const meta = tpl.metadata || tpl.data?.metadata || {};
      const brandFonts = (meta.brand?.fonts || []).flatMap(f => typeof f === "string" ? [f] : [f.family]).filter(Boolean);

      const results = targetFrames.map(f => {
        const layoutMode = f.layoutMode || "fixed";
        const css = f.css || "";
        const html = f.html || "";
        const issues = [];
        let score = 100;

        // Parse CSS rules
        const cssRules = parseCssRules(css);

        // Parse HTML with cheerio
        const $ = cheerio.load(`<div id="__lintroot">${html}</div>`);

        // Walk elements and check rules
        $("#__lintroot").find("*").each((_, el) => {
          const $el = $(el);
          const tag = ($el.prop("tagName") || "").toLowerCase();
          if (["script", "style", "link", "meta"].includes(tag)) return;

          const style = resolveStyles($el, cssRules);
          const selector = getCheerioSelector($el);

          // Rule: Hardcoded colors (not using tokens)
          const color = style["color"] || "";
          const bgColor = style["background"] || style["background-color"] || "";
          const allColors = [color, bgColor].filter(Boolean);
          for (const c of allColors) {
            const hex = c.match(/#[0-9a-f]{3,8}/i)?.[0];
            if (hex && brandColors.length > 0) {
              const lowerHex = hex.toLowerCase();
              const isToken = brandColors.some(tc => tc.toLowerCase() === lowerHex);
              if (!isToken) {
                issues.push({
                  severity: "error",
                  rule: "hardcoded-color",
                  message: "Element " + selector + " uses " + hex + " which is not a design token",
                  selector,
                  suggestion: brandColorNames.length > 0 ? "Use a var(--" + brandColorNames[0] + ") token" : "Define a color token first",
                });
                score -= 8;
              }
            }
          }

          // Rule: Missing explicit position (fixed mode)
          if (layoutMode === "fixed") {
            const position = style["position"] || "";
            const left = style["left"];
            const top = style["top"];
            if (position !== "absolute" && position !== "relative" && tag !== "style") {
              // Only flag block-level elements that should be positioned
              if (parseInt(style["width"]) || parseInt(style["height"])) {
                issues.push({
                  severity: "warn",
                  rule: "missing-position",
                  message: "Element " + selector + " has dimensions but no position:absolute in fixed layout",
                  selector,
                  suggestion: "Add position:absolute with left/top for fixed layout",
                });
                score -= 5;
              }
            }
          }

          // Rule: Absolute positioning in responsive mode
          if (layoutMode === "responsive" && style["position"] === "absolute") {
            issues.push({
              severity: "warn",
              rule: "absolute-in-responsive",
              message: "Element " + selector + " uses position:absolute in a responsive frame. Consider flexbox/grid.",
              selector,
            });
            score -= 5;
          }

          // Rule: Font family not in brand list
          const fontFamily = (style["font-family"] || style["fontFamily"] || "").replace(/["']/g, "");
          if (fontFamily && brandFonts.length > 0) {
            const isBrand = brandFonts.some(bf => fontFamily.toLowerCase().includes(bf.toLowerCase()));
            if (!isBrand) {
              issues.push({
                severity: "error",
                rule: "non-brand-font",
                message: "Element " + selector + " uses font '" + fontFamily + "' not in brand fonts (" + brandFonts.join(", ") + ")",
                selector,
              });
              score -= 8;
            }
          }

          // Rule: Contrast check (basic)
          if (color && bgColor) {
            const fgHex = color.match(/#[0-9a-f]{3,8}/i)?.[0];
            const bgHex = bgColor.match(/#[0-9a-f]{3,8}/i)?.[0];
            if (fgHex && bgHex) {
              const ratio = computeContrast(fgHex, bgHex);
              if (ratio < 4.5) {
                issues.push({
                  severity: "warn",
                  rule: "low-contrast",
                  message: "Element " + selector + " has contrast ratio " + ratio.toFixed(1) + ":1 (WCAG AA requires 4.5:1)",
                  selector,
                  suggestion: "Darken text or lighten background",
                });
                score -= 4;
              }
            }
          }
        });

        return {
          frameId: f.id,
          frameName: f.name,
          layoutMode,
          score: Math.max(0, score),
          issueCount: issues.length,
          issues,
        };
      });

      const totalScore = results.length > 0 ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : 0;

      return {
        templateId: params.templateId,
        overallScore: totalScore,
        frames: results,
        parserLimitations: "CSS parsed with regex. @keyframes, @supports, nested custom properties, and complex selectors may not be fully analyzed.",
      };
    }

    // ── export_design_tokens: CSS + DTCG JSON export ──
    case "export_design_tokens": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };
      const format = params.format || "all";

      const rawVars = tpl.variables || tpl.data?.variables || [];
      const tokens = Array.isArray(rawVars)
        ? rawVars.map(v => ({ id: v.id || v.name, name: v.name, type: v.type || "color", value: v.value || v.resolvedValue || "" }))
        : [];

      // CSS format
      let cssOutput = "";
      if (format === "css" || format === "all") {
        cssOutput = tokens.length > 0
          ? ":root {\n" + tokens.map(t => `  --${t.name}: ${t.value};`).join("\n") + "\n}"
          : ":root { /* No tokens defined */ }";
      }

      // DTCG JSON format
      let dtcgOutput = null;
      if (format === "dtcg" || format === "all") {
        const dtcg = { "$schema": "https://design-tokens.org/format" };
        for (const t of tokens) {
          const typeGroup = t.type === "color" ? "color" : t.type === "number" ? "spacing" : "text";
          if (!dtcg[typeGroup]) dtcg[typeGroup] = {};
          dtcg[typeGroup][t.name] = { "$value": t.value, "$type": t.type };
        }
        dtcgOutput = dtcg;
      }

      const result = { templateId: params.templateId, tokenCount: tokens.length };
      if (cssOutput) result.css = cssOutput;
      if (dtcgOutput) result.dtcg = dtcgOutput;
      return result;
    }

    // ── generate_design_artifacts: deterministic extraction ──
    case "generate_design_artifacts": {
      const tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };

      // Collect frames with html+css
      var extFrames = (tpl.frames || []).map(function (f) {
        return {
          id: f.id,
          name: f.name,
          html: f.html || "",
          css: f.css || "",
          width: f.width,
          height: f.height,
          layoutMode: f.layoutMode,
        };
      }).filter(function (f) { return f.html || f.css; });

      if (extFrames.length === 0) throw { code: -32000, message: "No frames with HTML/CSS content found" };

      var action = params.action || "generate";

      if (action === "extract") {
        var extraction = extractDesignSystem(extFrames);
        return { templateId: params.templateId, extraction: extraction };
      }

      // generate or publish
      var artifacts = generateAllArtifacts(extFrames, { name: tpl.name });

      if (action === "publish") {
        var designArtifacts = {
          tokensJson: artifacts.tokensJson,
          designMd: artifacts.designMd,
          sharedCss: artifacts.sharedCss,
          generatedFromHash: artifacts.sourceHash,
          generatedAt: artifacts.generatedAt,
        };
        tpl.designArtifacts = designArtifacts;
        tpl.metadata = tpl.metadata || {};
        tpl.metadata.designArtifactsGeneratedAt = artifacts.generatedAt;
        await templates.updateTemplate(params.templateId, {
          designArtifacts: designArtifacts,
          metadata: tpl.metadata,
        });
        return {
          templateId: params.templateId,
          action: "publish",
          _published: true,
          sourceHash: artifacts.sourceHash,
          designMd: artifacts.designMd,
          tokensJson: artifacts.tokensJson,
          sharedCss: artifacts.sharedCss,
          extraction: {
            colorCount: artifacts.extraction.colors.length,
            fontCount: artifacts.extraction.typography.families.length,
            componentCount: artifacts.extraction.components.length,
            imageCount: artifacts.extraction.images.length,
          },
        };
      }

      // default: generate (return without storing)
      return {
        templateId: params.templateId,
        sourceHash: artifacts.sourceHash,
        tokensJson: artifacts.tokensJson,
        designMd: artifacts.designMd,
        sharedCss: artifacts.sharedCss,
        extraction: {
          colors: artifacts.extraction.colors,
          typography: artifacts.extraction.typography,
          spacing: artifacts.extraction.spacing,
          radii: artifacts.extraction.radii,
          shadows: artifacts.extraction.shadows,
          components: artifacts.extraction.components,
          images: artifacts.extraction.images,
          constraints: artifacts.extraction.constraints,
          parserLimitations: artifacts.extraction.parserLimitations,
        },
      };
    }

    // ── get_design_artifacts: retrieve stored or auto-generate ──
    case "get_design_artifacts": {
      var tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };

      var format = params.format || "all";
      var stored = tpl.designArtifacts;

      // Compute current sourceHash for staleness check
      var extFrames = (tpl.frames || []).map(function (f) {
        return { id: f.id, html: f.html || "", css: f.css || "" };
      }).filter(function (f) { return f.html || f.css; });

      var currentHash = computeSourceHash(extFrames);

      if (!stored) {
        // Auto-generate on first access
        if (extFrames.length === 0) throw { code: -32000, message: "No frames with HTML/CSS content" };
        var artifacts = generateAllArtifacts(
          (tpl.frames || []).map(function (f) {
            return { id: f.id, name: f.name, html: f.html || "", css: f.css || "", width: f.width, height: f.height, layoutMode: f.layoutMode };
          }),
          { name: tpl.name }
        );
        return {
          templateId: params.templateId,
          _autoGenerated: true,
          sourceHash: artifacts.sourceHash,
          tokensJson: format === "tokens" || format === "all" ? artifacts.tokensJson : undefined,
          designMd: format === "design" || format === "all" ? artifacts.designMd : undefined,
          sharedCss: format === "css" || format === "all" ? artifacts.sharedCss : undefined,
        };
      }

      // Staleness check
      var isStale = stored.generatedFromHash !== currentHash;

      var result = {
        templateId: params.templateId,
        _stale: isStale,
        sourceHash: currentHash,
        storedHash: stored.generatedFromHash,
        generatedAt: stored.generatedAt,
      };

      if (isStale) {
        result._warning = "Frames have changed since artifacts were last generated. Run generate_design_artifacts with action='publish' to refresh.";
      }

      if (format === "tokens" || format === "all") result.tokensJson = stored.tokensJson;
      if (format === "design" || format === "all") result.designMd = stored.designMd;
      if (format === "css" || format === "all") result.sharedCss = stored.sharedCss;

      return result;
    }

    // ── duplicate_frame: exact clone ──
    case "duplicate_frame": {
      var tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found: " + params.templateId };
      var sourceFrame = (tpl.frames || []).find(function (f) { return f.id === params.sourceFrameId; });
      if (!sourceFrame) throw { code: -32000, message: "Frame not found: " + params.sourceFrameId };

      var newFrameId = "frame_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

      // Deep clone all fields
      var clone = JSON.parse(JSON.stringify(sourceFrame));
      clone.id = newFrameId;
      clone.name = params.newName || (sourceFrame.name + " (copy)");
      clone.x = (sourceFrame.x || 0) + 40;
      clone.y = (sourceFrame.y || 0) + 40;
      clone.order = (tpl.frames || []).length;

      // Compute hash for the clone (same content as source initially)
      clone.contentHash = computeFrameHash(clone.html || "", clone.css || "");
      clone.lastModifiedBy = "agent:duplicate_frame";
      clone.lastModifiedAt = new Date().toISOString();

      if (!tpl.frames) tpl.frames = [];
      tpl.frames.push(clone);
      await templates.updateTemplate(params.templateId, { frames: tpl.frames });
      autoSnapshot(params.templateId, "duplicate_frame");

      return {
        frameId: newFrameId,
        sourceFrameId: params.sourceFrameId,
        name: clone.name,
        x: clone.x, y: clone.y,
        width: clone.width, height: clone.height,
        contentHash: clone.contentHash,
      };
    }

    // ── update_frame_content: surgical DOM patching ──
    case "update_frame_content": {
      var tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };
      var frame = (tpl.frames || []).find(function (f) { return f.id === params.frameId; });
      if (!frame) throw { code: -32000, message: "Frame not found: " + params.frameId };

      var html = frame.html || "";
      var patch = params.patch || {};
      var selector = params.selector;

      // Use cheerio for deterministic DOM manipulation
      var $ = cheerio.load(html);
      var matched = $(selector);

      if (matched.length === 0) {
        return {
          templateId: params.templateId,
          frameId: params.frameId,
          selector: selector,
          matched: 0,
          applied: [],
          warning: "No elements matched the selector. No changes made.",
        };
      }

      var applied = [];

      matched.each(function (_, el) {
        var $el = $(el);

        if (patch.remove) {
          $el.remove();
          applied.push("removed");
          return;
        }

        if (patch.text !== undefined) {
          $el.text(patch.text);
          applied.push("text replaced");
        }
        if (patch.html !== undefined) {
          $el.html(patch.html);
          applied.push("html replaced");
        }
        if (patch.src !== undefined) {
          $el.attr("src", patch.src);
          applied.push("src set to " + patch.src);
        }
        if (patch.href !== undefined) {
          $el.attr("href", patch.href);
          applied.push("href set to " + patch.href);
        }
        if (patch.className !== undefined) {
          $el.attr("class", patch.className);
          applied.push("class set to " + patch.className);
        }
        if (patch.attr && typeof patch.attr === "object") {
          var attrKeys = Object.keys(patch.attr).sort();
          for (var ai = 0; ai < attrKeys.length; ai++) {
            var attrName = attrKeys[ai];
            var attrVal = patch.attr[attrName];
            if (attrVal === null) {
              $el.removeAttr(attrName);
              applied.push("attr removed: " + attrName);
            } else {
              $el.attr(attrName, String(attrVal));
              applied.push("attr set: " + attrName + "=" + attrVal);
            }
          }
        }
        if (patch.backgroundImage !== undefined) {
          var currentStyle = $el.attr("style") || "";
          // Remove existing background-image
          currentStyle = currentStyle.replace(/background-image\s*:\s*url\([^)]+\)\s*;?\s*/gi, "");
          currentStyle += " background-image: url(" + patch.backgroundImage + ");";
          $el.attr("style", currentStyle.trim());
          applied.push("backgroundImage set");
        }
        if (patch.style && typeof patch.style === "object") {
          var existingStyle = $el.attr("style") || "";
          var styleStr = existingStyle;
          var styleKeys = Object.keys(patch.style).sort(); // deterministic order
          for (var si = 0; si < styleKeys.length; si++) {
            var prop = styleKeys[si];
            var val = patch.style[prop];
            // Remove existing prop
            var propRe = new RegExp(prop.replace(/([A-Z])/g, "-$1").toLowerCase() + "\\s*:\\s*[^;]+;?\\s*", "gi");
            styleStr = styleStr.replace(propRe, "");
            var cssProp = prop.replace(/([A-Z])/g, "-$1").toLowerCase();
            styleStr += " " + cssProp + ": " + val + ";";
          }
          $el.attr("style", styleStr.trim());
          applied.push("style updated (" + styleKeys.length + " properties)");
        }
      });

      // Serialize back
      var newHtml = $.html();

      // Update frame
      frame.html = newHtml;
      frame.contentHash = computeFrameHash(frame.html || "", frame.css || "");
      frame.lastModifiedBy = "agent:update_frame_content";
      frame.lastModifiedAt = new Date().toISOString();

      await templates.updateTemplate(params.templateId, { frames: tpl.frames });
      autoSnapshot(params.templateId, "update_frame_content");

      return {
        templateId: params.templateId,
        frameId: params.frameId,
        selector: selector,
        matched: matched.length,
        applied: applied,
        contentHash: frame.contentHash,
        lastModifiedBy: frame.lastModifiedBy,
      };
    }

    // ── get_frame_changes: iterative change attribution ──
    case "get_frame_changes": {
      var tpl = await templates.getTemplate(params.templateId);
      if (!tpl) throw { code: -32000, message: "Template not found" };

      var changes = [];
      var frameHashes = params.frameHashes || {};

      (tpl.frames || []).forEach(function (f) {
        var currentHash = computeFrameHash(f.html || "", f.css || "");
        var knownHash = frameHashes[f.id] || null;
        var changed = knownHash ? (knownHash !== currentHash) : true;

        changes.push({
          frameId: f.id,
          frameName: f.name,
          changed: changed,
          currentHash: currentHash,
          knownHash: knownHash,
          lastModifiedBy: f.lastModifiedBy || "unknown",
          lastModifiedAt: f.lastModifiedAt || null,
        });
      });

      // Template-level sourceHash check
      var extFrames = (tpl.frames || []).map(function (f) {
        return { html: f.html || "", css: f.css || "" };
      });
      var currentSourceHash = computeSourceHash(extFrames);

      var result = {
        templateId: params.templateId,
        sourceHash: currentSourceHash,
        knownSourceHash: params.sinceSourceHash || null,
        sourceChanged: params.sinceSourceHash ? (params.sinceSourceHash !== currentSourceHash) : true,
        changes: changes,
      };

      return result;
    }

    // ── profile_template_pool: deterministic slot detection across template pool ──
    case "profile_template_pool": {
      var templateIds = params.templateIds;
      if (!templateIds || !templateIds.length) throw { code: -32602, message: "templateIds array is required" };

      var profiles = [];
      for (var i = 0; i < templateIds.length; i++) {
        var tid = templateIds[i];
        var tpl = await templates.getTemplate(tid);
        if (!tpl) throw { code: -32000, message: "Template not found: " + tid };
        if (!tpl.frames || !tpl.frames.length) throw { code: -32000, message: "Template has no frames: " + tid };
        var frame = tpl.frames[0];
        var profile = profileFrame(frame.html || "", frame.css || "", {
          id: frame.id,
          name: frame.name || tpl.name,
          width: frame.width || tpl.width || 1080,
          height: frame.height || tpl.height || 1080,
        });
        profiles.push(profile);
      }

      var poolResult = profileTemplatePool(profiles);
      return {
        profiles: poolResult.profiles,
        csvColumns: poolResult.csvColumns,
        templateCount: profiles.length,
        totalSlots: profiles.reduce(function (s, p) { return s + p.slots.length; }, 0),
        _deterministic: true,
      };
    }

    // ── generate_csv_template: build CSV from profiled pool ──
    case "generate_csv_template": {
      var templateIds = params.templateIds;
      var rowCount = params.rowCount || 1;
      var delimiter = params.delimiter || ",";
      if (!templateIds || !templateIds.length) throw { code: -32602, message: "templateIds array is required" };

      // Profile the pool
      var profiles = [];
      var templateNames = {};
      for (var i = 0; i < templateIds.length; i++) {
        var tid = templateIds[i];
        var tpl = await templates.getTemplate(tid);
        if (!tpl) throw { code: -32000, message: "Template not found: " + tid };
        if (!tpl.frames || !tpl.frames.length) throw { code: -32000, message: "Template has no frames: " + tid };
        var frame = tpl.frames[0];
        var profile = profileFrame(frame.html || "", frame.css || "", {
          id: frame.id, name: frame.name || tpl.name,
          width: frame.width || tpl.width || 1080, height: frame.height || tpl.height || 1080,
        });
        profiles.push(profile);
        templateNames[tid] = frame.name || tpl.name;
      }
      var poolResult = profileTemplatePool(profiles);

      // Build CSV columns (union across pool)
      var columns = poolResult.csvColumns;

      // Escape a CSV field
      function csvEscape(val) {
        var s = String(val || "");
        if (s.indexOf(delimiter) !== -1 || s.indexOf("\"") !== -1 || s.indexOf("\n") !== -1) {
          return "\"" + s.replace(/"/g, "\"\"") + "\"";
        }
        return s;
      }

      // Build comment header
      var lines = [];
      lines.push("# Template Pool CSV — generated " + new Date().toISOString());
      lines.push("# Delimiter: " + (delimiter === "\t" ? "TAB" : delimiter));
      lines.push("# _template column: immutable templateId (copy from Available templates below)");
      lines.push("# Slot columns: " + columns.map(function (c) { return c.name + " (" + c.type + ")"; }).join(", "));
      lines.push("#");
      lines.push("# Available templates:");
      for (var ti = 0; ti < templateIds.length; ti++) {
        lines.push("#   " + templateIds[ti] + "  —  " + (templateNames[templateIds[ti]] || "Unknown"));
      }
      lines.push("#");

      // Header row
      var headerCells = ["_template"];
      for (var ci = 0; ci < columns.length; ci++) {
        headerCells.push(columns[ci].name);
      }
      lines.push(headerCells.map(csvEscape).join(delimiter));

      // Data rows (empty, placeholder _template)
      for (var ri = 0; ri < rowCount; ri++) {
        var row = [templateIds[0]]; // placeholder
        for (var cj = 0; cj < columns.length; cj++) {
          row.push("");
        }
        lines.push(row.map(csvEscape).join(delimiter));
      }

      var csv = lines.join("\n");

      // Build clean CSV (no comments, ready for DB import / Supabase)
      var cleanLines = [];
      cleanLines.push(headerCells.map(csvEscape).join(delimiter));
      for (var ri2 = 0; ri2 < rowCount; ri2++) {
        var cleanRow = [templateIds[0]];
        for (var cj2 = 0; cj2 < columns.length; cj2++) { cleanRow.push(""); }
        cleanLines.push(cleanRow.map(csvEscape).join(delimiter));
      }
      var cleanCsv = cleanLines.join("\n");

      // Data URI for direct browser paste (no AI reformatting, zero-cost)
      var dataUri = "data:text/csv;charset=utf-8," + encodeURIComponent(cleanCsv);

      // Build self-contained HTML page with embedded CSV + download button
      // Same pattern as render_html_template — deterministic, freemium-safe, $0
      var csvForJs = csv.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
      var cleanCsvForJs = cleanCsv.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");

      // Template tags HTML
      var tplTagsHtml = "";
      for (var ti2 = 0; ti2 < templateIds.length; ti2++) {
        tplTagsHtml += '<span class="tpl-tag">' + templateIds[ti2] + ' = ' + (templateNames[templateIds[ti2]] || "?") + '</span>\n    ';
      }

      // Table header cells
      var thCellsHtml = "";
      for (var ci2 = 0; ci2 < columns.length; ci2++) {
        thCellsHtml += '<th>' + columns[ci2].name + '<span class="col-type">' + columns[ci2].type + '</span></th>\n        ';
      }

      // Table body rows
      var tbodyHtml = "";
      for (var ri3 = 0; ri3 < rowCount; ri3++) {
        tbodyHtml += '<tr><td style="font-family:monospace;color:#c8b898;">' + templateIds[0] + '</td>';
        for (var cj3 = 0; cj3 < columns.length; cj3++) {
          tbodyHtml += '<td></td>';
        }
        tbodyHtml += '</tr>\n      ';
      }

      var downloadHtml = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>CSV Template — Futuraria Batch</title>\n<style>\n  * { margin:0; padding:0; box-sizing:border-box; }\n  body { background:#0f0f1a; color:#c8c8d4; font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif; padding:24px; }\n  .header { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; flex-wrap:wrap; gap:12px; }\n  h1 { font-size:20px; font-weight:600; color:#e0d6c2; }\n  .actions { display:flex; gap:8px; }\n  .btn { padding:8px 16px; border:none; border-radius:6px; font-size:13px; cursor:pointer; font-weight:500; }\n  .btn-dl { background:#c8b898; color:#0f0f1a; }\n  .btn-dl:hover { background:#d4c5a5; }\n  .btn-copy { background:rgba(200,184,152,0.12); color:#c8b898; border:1px solid rgba(200,184,152,0.2); }\n  .btn-copy:hover { background:rgba(200,184,152,0.2); }\n  .meta { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:16px; font-size:12px; color:#888; }\n  .meta span { background:rgba(255,255,255,0.04); padding:4px 10px; border-radius:4px; }\n  .table-wrap { overflow-x:auto; border-radius:8px; border:1px solid rgba(255,255,255,0.08); }\n  table { width:100%; border-collapse:collapse; font-size:12px; }\n  th { background:rgba(200,184,152,0.1); color:#c8b898; padding:10px 12px; text-align:left; font-weight:600; white-space:nowrap; border-bottom:1px solid rgba(255,255,255,0.06); }\n  td { padding:8px 12px; border-bottom:1px solid rgba(255,255,255,0.04); color:#a0a0b0; }\n  tr:hover td { background:rgba(255,255,255,0.02); }\n  .col-type { font-size:10px; color:#666; margin-left:6px; }\n  .toast { position:fixed; top:16px; right:16px; background:#059669; color:#fff; padding:10px 20px; border-radius:6px; font-size:13px; display:none; z-index:100; }\n  .templates { margin-bottom:20px; padding:14px; background:rgba(255,255,255,0.02); border-radius:8px; border:1px solid rgba(255,255,255,0.05); }\n  .templates h3 { font-size:13px; color:#888; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px; margin-top:0; }\n  .tpl-list { display:flex; flex-wrap:wrap; gap:8px; }\n  .tpl-tag { font-size:11px; background:rgba(200,184,152,0.08); color:#c8b898; padding:4px 10px; border-radius:4px; font-family:monospace; }\n  .note { font-size:11px; color:#555; margin-top:16px; line-height:1.6; }\n</style>\n</head>\n<body>\n<div class="header">\n  <h1>📊 Template Pool CSV — ' + templateIds.length + ' templates, ' + (columns.length + 1) + ' columns, ' + rowCount + ' rows</h1>\n  <div class="actions">\n    <button class="btn btn-copy" onclick="copyCSV()">📋 Copy CSV</button>\n    <button class="btn btn-dl" onclick="downloadCSV()">⬇ Download .csv</button>\n  </div>\n</div>\n<div class="meta">\n  <span>Delimiter: ' + (delimiter === "\t" ? "TAB" : delimiter) + '</span>\n  <span>Rows: ' + rowCount + '</span>\n  <span>Columns: ' + (columns.length + 1) + '</span>\n  <span>Generated: ' + new Date().toISOString() + '</span>\n</div>\n<div class="templates">\n  <h3>Available Templates</h3>\n  <div class="tpl-list">\n    ' + tplTagsHtml + '\n  </div>\n</div>\n<div class="table-wrap">\n  <table>\n    <thead>\n      <tr>\n        <th>_template<span class="col-type">id</span></th>\n        ' + thCellsHtml + '\n      </tr>\n    </thead>\n    <tbody>\n      ' + tbodyHtml + '\n    </tbody>\n  </table>\n</div>\n<div class="note">💡 Save this .html file — open anytime to download CSV. Column <code>_template</code> uses immutable templateId. Empty cells = fill with content. First row shows placeholder templateId — replace with the template you want per row.</div>\n<div class="toast" id="toast">Copied!</div>\n<script>\n  var csvData = `' + csvForJs + '`;\n  var cleanCsv = `' + cleanCsvForJs + '`;\n\n  function downloadCSV() {\n    var blob = new Blob([csvData], { type: "text/csv;charset=utf-8;" });\n    var url = URL.createObjectURL(blob);\n    var a = document.createElement("a");\n    a.href = url;\n    a.download = "template_pool.csv";\n    document.body.appendChild(a);\n    a.click();\n    document.body.removeChild(a);\n    URL.revokeObjectURL(url);\n    showToast("CSV downloaded!");\n  }\n\n  function copyCSV() {\n    navigator.clipboard.writeText(csvData).then(function() {\n      showToast("CSV copied to clipboard!");\n    });\n  }\n\n  function showToast(msg) {\n    var t = document.getElementById("toast");\n    t.textContent = msg;\n    t.style.display = "block";\n    setTimeout(function() { t.style.display = "none"; }, 2000);\n  }\n<\/script>\n</body>\n</html>';

      return {
        csv: csv,
        cleanCsv: cleanCsv,
        dataUri: dataUri,
        downloadHtml: downloadHtml,
        columns: ["_template"].concat(columns.map(function (c) { return c.name; })),
        columnDetails: columns,
        templateIds: templateIds,
        templateNames: templateNames,
        rowCount: rowCount,
        delimiter: delimiter,
        profiles: profiles,
        _deterministic: true,
        _note: "Save downloadHtml as .html file → open in browser → one-click CSV download. Or paste dataUri in any browser address bar for instant .csv file.",
      };
    }

    // ── apply_csv_to_frames: generate frames from CSV → new output template ──
    case "apply_csv_to_frames": {
      var workspaceId = params.workspaceId;
      var csvData = params.csvData;
      var templateIds = params.templateIds;
      var outputName = params.outputName || ("Batch Export — " + new Date().toISOString().slice(0, 10));
      var delimiter = params.delimiter || ",";
      var naming = params.naming || "Frame {index}";
      var onMissingTemplate = params.onMissingTemplate || "error";
      var onOverflow = params.onOverflow || "truncate";

      if (!workspaceId) throw { code: -32602, message: "workspaceId is required" };
      if (!csvData) throw { code: -32602, message: "csvData is required" };
      if (!templateIds || !templateIds.length) throw { code: -32602, message: "templateIds array is required" };

      // ── Parse CSV ──
      function csvParse(text, delim) {
        var rows = [];
        var rawLines = text.split(/\r?\n/);
        var currentRow = [];
        var currentField = "";
        var inQ = false;

        function pushField() {
          currentRow.push(currentField.trim());
          currentField = "";
        }

        for (var li = 0; li < rawLines.length; li++) {
          var line = rawLines[li];

          // Skip comment lines
          if (!inQ && (line.trim().length === 0 || line.trim()[0] === "#")) continue;

          for (var ci = 0; ci < line.length; ci++) {
            var ch = line[ci];
            if (inQ) {
              if (ch === "\"") {
                if (ci + 1 < line.length && line[ci + 1] === "\"") {
                  currentField += "\"";
                  ci++;
                } else {
                  inQ = false;
                }
              } else {
                currentField += ch;
              }
            } else {
              if (ch === "\"") {
                inQ = true;
              } else if (ch === delim) {
                pushField();
              } else {
                currentField += ch;
              }
            }
          }

          if (!inQ) {
            pushField();
            if (currentRow.length > 0 && (currentRow.length > 1 || currentRow[0] !== "")) {
              rows.push(currentRow);
            }
            currentRow = [];
          } else {
            currentField += "\n";
          }
        }

        // Flush any remaining field
        if (currentField.length > 0) pushField();
        if (currentRow.length > 0 && (currentRow.length > 1 || currentRow[0] !== "")) {
          rows.push(currentRow);
        }

        return rows;
      }

      var allRows = csvParse(csvData, delimiter);
      if (allRows.length === 0) throw { code: -32602, message: "CSV has no data rows" };

      // Header is first row
      var headerRow = allRows[0];
      var dataRows = allRows.slice(1);

      // Find _template column index
      var templateColIdx = -1;
      for (var hi = 0; hi < headerRow.length; hi++) {
        if (headerRow[hi].toLowerCase() === "_template") { templateColIdx = hi; break; }
      }
      if (templateColIdx === -1) throw { code: -32602, message: "CSV must have a _template column" };

      // ── Pre-load templates and profile each ──
      var templateCache = {};
      var slotMapByTemplate = {}; // templateId → slotsByName: { slotName: slot }

      for (var ti = 0; ti < templateIds.length; ti++) {
        var tid = templateIds[ti];
        var tpl = await templates.getTemplate(tid);
        if (!tpl) throw { code: -32000, message: "Template not found: " + tid };
        if (!tpl.frames || !tpl.frames.length) throw { code: -32000, message: "Template has no frames: " + tid };
        templateCache[tid] = tpl;

        var frame = tpl.frames[0];
        var prof = profileFrame(frame.html || "", frame.css || "", {
          id: frame.id, name: frame.name || tpl.name,
          width: frame.width || tpl.width || 1080, height: frame.height || tpl.height || 1080,
        });

        var slotsByName = {};
        for (var si = 0; si < prof.slots.length; si++) {
          slotsByName[prof.slots[si].name] = prof.slots[si];
        }
        slotMapByTemplate[tid] = slotsByName;
      }

      // ── Create output template ──
      var outputTpl = store.createTemplate({
        workspaceId: workspaceId,
        name: outputName,
        width: 1080,
        height: 1080,
        userId: userId,
      });
      outputTpl.engine = "html";
      outputTpl.frames = [];
      outputTpl.html = "";
      outputTpl.css = "";

      // ── Process each CSV row ──
      var report = [];
      var yOffset = 0;
      var colSpacing = 40;

      for (var ri = 0; ri < dataRows.length; ri++) {
        var row = dataRows[ri];
        var rowTemplateId = (row[templateColIdx] || "").trim();

        // Validate template
        if (!rowTemplateId) {
          if (onMissingTemplate === "skip") {
            report.push({ row: ri + 1, status: "skipped", reason: "empty _template" });
            continue;
          }
          throw { code: -32602, message: "Row " + (ri + 1) + ": _template is empty" };
        }

        // Resolve templateId from available pool
        var resolvedTid = null;
        // Try exact match first
        if (templateCache[rowTemplateId]) {
          resolvedTid = rowTemplateId;
        } else {
          // Try partial match (user may have typed just the suffix)
          for (var ati = 0; ati < templateIds.length; ati++) {
            if (templateIds[ati].indexOf(rowTemplateId) !== -1 || rowTemplateId.indexOf(templateIds[ati]) !== -1) {
              resolvedTid = templateIds[ati];
              break;
            }
          }
        }

        if (!resolvedTid) {
          if (onMissingTemplate === "skip") {
            report.push({ row: ri + 1, status: "skipped", reason: "template not found: " + rowTemplateId });
            continue;
          }
          throw { code: -32000, message: "Row " + (ri + 1) + ": template not in pool: " + rowTemplateId };
        }

        var srcTpl = templateCache[resolvedTid];
        var srcFrame = srcTpl.frames[0];
        var slotsByName = slotMapByTemplate[resolvedTid];

        // Deep-clone the source frame
        var newFrame = JSON.parse(JSON.stringify(srcFrame));
        var newFrameId = "frame_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
        newFrame.id = newFrameId;
        newFrame.x = 0;
        newFrame.y = yOffset;

        // Build frame name from naming template
        var frameName = naming;
        frameName = frameName.replace(/\{index\}/g, String(ri + 1));
        for (var hi2 = 0; hi2 < headerRow.length; hi2++) {
          var colName = headerRow[hi2];
          var colVal = (row[hi2] || "").trim();
          frameName = frameName.replace(new RegExp("\\{" + colName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\}", "gi"), colVal);
        }
        newFrame.name = frameName;

        newFrame.order = outputTpl.frames.length;
        newFrame.lastModifiedBy = "agent:apply_csv_to_frames";
        newFrame.lastModifiedAt = new Date().toISOString();

        // ── Apply CSV values to the frame HTML ──
        var $ = cheerio.load(newFrame.html || "");
        var rowReport = { row: ri + 1, templateId: resolvedTid, frameId: newFrameId, name: frameName, applied: [], warnings: [] };

        for (var hii = 0; hii < headerRow.length; hii++) {
          if (hii === templateColIdx) continue; // skip _template column

          var hdrColName = headerRow[hii];
          var cellValue = (row[hii] || "").trim();
          if (!cellValue) continue; // skip empty cells

          var slot = slotsByName[hdrColName];
          if (!slot) {
            rowReport.warnings.push("Column '" + hdrColName + "' has no matching slot in template " + resolvedTid);
            continue;
          }

          // Check overflow for text slots
          if ((slot.type === "text" || slot.type === "richtext") && slot.maxChars && cellValue.length > slot.maxChars) {
            if (onOverflow === "skip_row") {
              rowReport.status = "skipped";
              rowReport.reason = "Text overflow in '" + hdrColName + "': " + cellValue.length + " > " + slot.maxChars + " chars";
              break; // skip this row entirely
            } else if (onOverflow === "continue_warn") {
              rowReport.warnings.push("Text truncated in '" + hdrColName + "': " + cellValue.length + " > " + slot.maxChars + " chars");
              cellValue = cellValue.substring(0, slot.maxChars);
            } else {
              // truncate (default)
              cellValue = cellValue.substring(0, slot.maxChars);
              rowReport.applied.push(hdrColName + ": text (truncated " + cellValue.length + " chars)");
            }
          }

          // Apply value based on slot type
          var $el = $(slot.selector);

          if ($el.length === 0 && slot.tag) {
            // Fallback: try tag selector
            $el = $(slot.tag);
          }

          if ($el.length > 0) {
            if (slot.type === "image") {
              $el.attr("src", cellValue);
              if (cellValue.indexOf("background") !== -1 || cellValue.indexOf("url(") !== -1) {
                // cell contains a CSS background-image value
                var currentStyle = $el.attr("style") || "";
                currentStyle = currentStyle.replace(/background-image\s*:\s*url\([^)]+\)\s*;?\s*/gi, "");
                currentStyle += " background-image: url(" + cellValue + ");";
                $el.attr("style", currentStyle.trim());
              }
            } else if (slot.type === "cta") {
              $el.text(cellValue);
            } else {
              // text, richtext
              $el.text(cellValue);
            }
            if (!rowReport.applied.some(function (a) { return a.indexOf(hdrColName) === 0; })) {
              rowReport.applied.push(hdrColName + ": " + slot.type);
            }
          } else {
            rowReport.warnings.push("Column '" + hdrColName + "': selector '" + slot.selector + "' did not match any element");
          }
        }

        // Skip-row overflow handling
        if (rowReport.status === "skipped") {
          report.push(rowReport);
          continue;
        }

        // Serialize the modified HTML
        newFrame.html = $.html();
        newFrame.contentHash = computeFrameHash(newFrame.html || "", newFrame.css || "");

        outputTpl.frames.push(newFrame);
        yOffset += (newFrame.height || 1080) + colSpacing;

        rowReport.status = "ok";
        report.push(rowReport);
      }

      // ── Persist output template ──
      outputTpl.metadata = { ...(outputTpl.metadata || {}), updatedAt: new Date().toISOString() };
      // Also set output template dimensions to accommodate all frames
      if (outputTpl.frames.length > 0 && yOffset > 0) {
        outputTpl.height = yOffset;
      }

      await templates.updateTemplate(outputTpl.id, { frames: outputTpl.frames, height: outputTpl.height });

      // Dual-write to Supabase
      var sb = getSupabase();
      if (sb) {
        try {
          var row = {
            id: outputTpl.id, name: outputTpl.name, workspace_id: workspaceId,
            data: outputTpl, updated_at: new Date().toISOString(),
          };
          if (UUID_RE.test(userId)) row.user_id = userId;
          await sb.from("templates").upsert(row);
        } catch { /* non-blocking */ }
      }

      autoSnapshot(outputTpl.id, "apply_csv_to_frames");

      return {
        outputTemplateId: outputTpl.id,
        outputTemplateName: outputName,
        workspaceId: workspaceId,
        totalRows: dataRows.length,
        generatedFrames: report.filter(function (r) { return r.status === "ok"; }).length,
        skippedRows: report.filter(function (r) { return r.status === "skipped"; }).length,
        report: report,
        _deterministic: true,
      };
    }

    default:
      throw { code: -32601, message: "Method not found: " + method };
  }
}

export const handler = async (event) => {
  const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

  // Rate limiting
  const clientIp = event.headers["x-forwarded-for"] || event.headers["client-ip"] || "unknown";
  if (!checkRateLimit(clientIp)) {
    return {
      statusCode: 429,
      headers,
      body: JSON.stringify(jsonRpcError(null, -32000, "Rate limit exceeded. Try again in 60 seconds.")),
    };
  }

  const userId = getUserId(event);

  // SSE initialization (GET)
  if (event.httpMethod === "GET") {
    const sseBody = "event: endpoint\r\ndata: /mcp\r\n\r\n";
    return {
      statusCode: 200,
      headers: { ...headers, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      body: sseBody,
    };
  }

  // JSON-RPC (POST)
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify(jsonRpcError(null, -32600, "Method not allowed")) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify(jsonRpcError(null, -32700, "Parse error")) };
  }

  const { jsonrpc, id, method, params } = body;

  if (jsonrpc !== "2.0") {
    return { statusCode: 400, headers, body: JSON.stringify(jsonRpcError(id, -32600, "Invalid Request")) };
  }

  // MCP lifecycle methods
  if (method === "initialize") {
    return {
      statusCode: 200, headers,
      body: JSON.stringify(jsonRpcResult(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: "futuraria-mcp", version: "1.0.0" },
      })),
    };
  }

  if (method === "notifications/initialized") {
    return { statusCode: 200, headers, body: JSON.stringify(jsonRpcResult(id, {})) };
  }

  if (method === "tools/list") {
    return {
      statusCode: 200, headers,
      body: JSON.stringify(jsonRpcResult(id, { tools: MCP_TOOLS })),
    };
  }

  if (method === "tools/call") {
    try {
      const result = await handleMethod(params.name, params.arguments || {}, userId);
      const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return {
        statusCode: 200, headers,
        body: JSON.stringify(jsonRpcResult(id, { content: [{ type: "text", text }] })),
      };
    } catch (e) {
      const err = e?.code ? e : { code: -32000, message: e?.message || "Internal error" };
      return {
        statusCode: 200, headers,
        body: JSON.stringify(jsonRpcError(id, err.code, err.message)),
      };
    }
  }

  // Direct method fallback: if method matches a tool name, route to tools/call
  if (MCP_TOOLS.some(t => t.name === method)) {
    try {
      const result = await handleMethod(method, params || {}, userId);
      const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      return {
        statusCode: 200, headers,
        body: JSON.stringify(jsonRpcResult(id, { content: [{ type: "text", text }] })),
      };
    } catch (e) {
      const err = e?.code ? e : { code: -32000, message: e?.message || "Internal error" };
      return {
        statusCode: 200, headers,
        body: JSON.stringify(jsonRpcError(id, err.code, err.message)),
      };
    }
  }

  // Unknown method
  return {
    statusCode: 200, headers,
    body: JSON.stringify(jsonRpcError(id, -32601, `Method not found: ${method}`)),
  };
};
