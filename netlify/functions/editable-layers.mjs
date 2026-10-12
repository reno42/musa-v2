import * as cheerio from "cheerio";
import { classifyLayer } from "../../shared/layerKind.ts";
import { paintsABox } from "../../shared/paintDetection.ts";
import { removeCssDeclarations } from "./css-rules.mjs";

const LAYER_KINDS = new Set(["text", "shape", "image", "button", "svg", "bezier"]);
const INTENTIONAL_CONTAINER_KINDS = new Set(["group", "container", "component"]);
const TEXT_TAGS = new Set(["div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6"]);
const RESERVED_LAYOUT_PROPERTIES = new Set(["position", "left", "top", "right", "bottom", "width", "height"]);
const UNITLESS_PROPERTIES = new Set(["font-weight", "line-height", "opacity", "z-index", "order", "flex-grow", "flex-shrink"]);
const VALID_LAYER_KINDS = new Set([...LAYER_KINDS, ...INTENTIONAL_CONTAINER_KINDS]);
const ATOMIC_LAYER_KINDS = new Set(["text", "image", "button", "svg", "bezier"]);
const SOLID_BACKGROUND = /^(?:#[0-9a-f]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\)|[a-z]+)$/i;
const CANVAS_SELECTORS = new Set(["html", "body", ":root", "#__df_content"]);

function cssRules(css) {
  const rules = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(css || ""))) {
    const selector = match[1].trim();
    if (selector && !selector.startsWith("@")) rules.push({ selector, declarations: match[2] });
  }
  return rules;
}

/** REQ-048 FL4: normalize the css text before any parsing. JSON
 *  double-escaping turns real newlines into literal "\n" sequences, and the
 *  selector chunks then stop matching (cheerio .is("\n.card") throws) —
 *  layers looked position-less even though the rule was right there, and the
 *  audit answered with a cryptic EDITABILITY_CONTRACT_ERROR. */
function normalizeCssText(css) {
  return String(css || "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\[nr]/g, "\n")
    .replace(/\r\n?/g, "\n");
}

function matchingDeclarations(layer, css) {
  const declarations = [layer.attr("style") || ""];
  for (const rule of cssRules(css)) {
    const matches = rule.selector.split(",").some(selector => {
      try { return layer.is(selector.trim()); } catch { return false; }
    });
    if (matches) declarations.push(rule.declarations);
  }
  return declarations.filter(Boolean).join(";");
}

function readDeclaration(declarations, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hit = new RegExp(`(?:^|[;{\\s])${escaped}\\s*:\\s*([^;]+)`, "i").exec(declarations || "");
  return hit?.[1]?.trim() || "";
}

function removeInlineDeclarations(style, properties) {
  let next = style || "";
  for (const property of properties) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(`(^|;)\\s*${escaped}\\s*:[^;]*;?`, "gi"), "$1");
  }
  return next.replace(/;{2,}/g, ";").replace(/^;+|;+$/g, "").trim();
}

function setInlineDeclaration(style, property, value) {
  const cleaned = removeInlineDeclarations(style, [property]);
  return `${cleaned}${cleaned ? ";" : ""}${property}:${value}`;
}

function directText(layer) {
  // Cheerio's .text() concatenates sibling text nodes with NO separator, so a
  // line-broken headline ("Tu cliente" / "vive en una" / …) collapsed into
  // "clienteviveenuna…" in data-layer-name (REQ-048 F3). Join each text
  // node's own text with spaces instead.
  const parts = [];
  layer.contents().each((_, node) => {
    if (node.type !== "text") return;
    const text = String(node.data ?? "").replace(/\s+/g, " ").trim();
    if (text) parts.push(text);
  });
  return parts.join(" ").trim();
}

function humanLayerName(layer, kind, index) {
  const explicit = layer.attr("data-layer-name") || layer.attr("aria-label") || layer.attr("title");
  if (explicit?.trim()) return explicit.trim().slice(0, 80);
  const text = directText(layer);
  if (text) return text.slice(0, 80);
  const identifier = layer.attr("id") || String(layer.attr("class") || "").split(/\s+/)[0];
  if (identifier) return identifier.replace(/[-_]+/g, " ").replace(/\b\w/g, char => char.toUpperCase()).slice(0, 80);
  if (kind === "group") return `Group ${index + 1}`;
  if (kind === "container") return `Container ${index + 1}`;
  return `${kind[0].toUpperCase()}${kind.slice(1)} ${index + 1}`;
}

function isFrameSizedRoot(layer, css, width, height) {
  const declarations = matchingDeclarations(layer, css);
  const declaredWidth = Number.parseFloat(readDeclaration(declarations, "width"));
  const declaredHeight = Number.parseFloat(readDeclaration(declarations, "height"));
  return Number.isFinite(declaredWidth) && Number.isFinite(declaredHeight)
    && Math.abs(declaredWidth - width) < 0.5
    && Math.abs(declaredHeight - height) < 0.5;
}

function migrateRootBackground(rootLayer, css, currentBackground) {
  const declarations = matchingDeclarations(rootLayer, css);
  const backgroundColor = readDeclaration(declarations, "background-color");
  const backgroundShorthand = readDeclaration(declarations, "background");
  const candidate = backgroundColor || backgroundShorthand;
  if (!candidate || !SOLID_BACKGROUND.test(candidate) || /^(?:none|transparent|inherit|initial|unset)$/i.test(candidate)) {
    return { css, background: currentBackground, migrated: false };
  }

  let nextCss = css;
  for (const rule of cssRules(css)) {
    if (rule.selector.includes(",")) continue;
    let matches = false;
    try { matches = rootLayer.is(rule.selector); } catch { /* unsupported selector */ }
    if (!matches) continue;
    nextCss = removeCssDeclarations(nextCss, rule.selector, ["background", "background-color"]);
  }
  const inline = removeInlineDeclarations(rootLayer.attr("style"), ["background", "background-color"]);
  if (inline) rootLayer.attr("style", inline); else rootLayer.removeAttr("style");
  return { css: nextCss, background: candidate, migrated: true };
}

function migrateCanvasBackground(css, currentBackground) {
  let nextCss = css || "";
  let background = currentBackground;
  let migrated = false;
  for (const rule of cssRules(css)) {
    const selectors = rule.selector.split(",").map(selector => selector.trim().toLowerCase());
    if (selectors.length === 0 || !selectors.every(selector => CANVAS_SELECTORS.has(selector))) continue;
    const candidate = readDeclaration(rule.declarations, "background-color")
      || readDeclaration(rule.declarations, "background");
    if (!candidate || !SOLID_BACKGROUND.test(candidate) || /^(?:none|transparent|inherit|initial|unset)$/i.test(candidate)) continue;
    nextCss = removeCssDeclarations(nextCss, rule.selector, ["background", "background-color"]);
    background = candidate;
    migrated = true;
  }
  return { css: nextCss, background, migrated };
}

/**
 * Turns permissive imported HTML into a layers-first document. Full-artboard
 * solid paint becomes frame paint; every remaining visible object gets one
 * semantic layer, while rich-text internals stay private to their text root.
 */
export function normalizeLayersFirstFrame(html, css, { width = 1080, height = 1080, background = "#ffffff" } = {}) {
  css = normalizeCssText(css);
  const canvasMigration = migrateCanvasBackground(css || "", background || "#ffffff");
  if (!html?.trim()) {
    return {
      html: html || "",
      css: canvasMigration.css,
      background: canvasMigration.background,
      changed: canvasMigration.migrated,
      warnings: canvasMigration.migrated ? ["Moved a solid canvas background to frame.background."] : [],
      audit: auditEditableFrame(html || "", canvasMigration.css, { allowGroups: true }),
    };
  }
  const $ = cheerio.load(`<div id="__layers_first_root">${html}</div>`, null, false);
  const root = $("#__layers_first_root");
  let nextCss = canvasMigration.css;
  let nextBackground = canvasMigration.background;
  const warnings = [];
  let changed = canvasMigration.migrated;
  if (canvasMigration.migrated) warnings.push("Moved a solid canvas background to frame.background.");

  const roots = root.children();
  let structuralFrameRoot = null;
  // REQ-048 FL4: a lone wrapper carrying the conventional "root" class is the
  // frame root even when its box comes from that class rather than matching
  // the frame dimensions — counting it as layer 0 made the audit demand
  // position:absolute from a wrapper the human never drew as a layer.
  const wrapperIsRootClass = roots.length === 1
    && String(roots.first().attr("class") || "").trim().split(/\s+/).some(c => /^root$/i.test(c));
  if (roots.length === 1 && (isFrameSizedRoot(roots.first(), nextCss, Number(width), Number(height)) || wrapperIsRootClass)) {
    const migration = migrateRootBackground(roots.first(), nextCss, nextBackground);
    if (migration.migrated) {
      nextCss = migration.css;
      nextBackground = migration.background;
      warnings.push("Moved a full-frame solid background from the root wrapper to frame.background.");
      changed = true;
    }
    let style = roots.first().attr("style") || "";
    for (const [property, value] of [["position", "absolute"], ["left", "0px"], ["top", "0px"], ["width", `${width}px`], ["height", `${height}px`]]) {
      style = setInlineDeclaration(style, property, value);
    }
    if (style !== roots.first().attr("style")) { roots.first().attr("style", style); changed = true; }
    if (!paintsABox(matchingDeclarations(roots.first(), nextCss))) structuralFrameRoot = roots.first().get(0);
  }

  const usedIds = new Set();
  let sequence = 0;
  const freshId = path => {
    let candidate = `layer_${path.join("_") || sequence++}`;
    while (usedIds.has(candidate)) candidate = `layer_${path.join("_")}_${sequence++}`;
    return candidate;
  };

  const visit = (element, path) => {
    const layer = $(element);
    const tag = String(element.tagName || element.name || "div").toLowerCase();
    if (tag === "br") {
      // br es rich-text, nunca una capa: si un frame legado le puso data-layer-*
      // se remueven para que el audit no lo exija como capa sin nombre.
      for (const attribute of ["data-layer-id", "data-layer-name", "data-layer-kind"]) {
        if (layer.attr(attribute) !== undefined) { layer.removeAttr(attribute); changed = true; }
      }
      return;
    }
    const children = layer.children().toArray();
    const inferred = classifyLayer({
      tag,
      styleAttr: matchingDeclarations(layer, nextCss),
      hasDirectText: Boolean(directText(layer)),
      children: children.map(child => ({
        tag: String(child.tagName || child.name || "div"),
        hasChildren: $(child).children().length > 0,
        styleAttr: matchingDeclarations($(child), nextCss),
      })),
    });
    const declared = String(layer.attr("data-layer-kind") || "").toLowerCase();
    let canonicalInferred = inferred;
    if (element === structuralFrameRoot) canonicalInferred = "group";
    else if (tag === "svg") canonicalInferred = "svg";

    let kind = VALID_LAYER_KINDS.has(declared) ? declared : canonicalInferred;
    if (declared === "group" && canonicalInferred === "container") kind = "container";
    else if (tag === "svg" && declared === "shape") kind = "svg";

    let id = String(layer.attr("data-layer-id") || "").trim();
    if (!id || usedIds.has(id)) {
      id = freshId(path);
      layer.attr("data-layer-id", id);
      changed = true;
    }
    usedIds.add(id);
    const name = humanLayerName(layer, kind, sequence++);
    if (layer.attr("data-layer-name") !== name) { layer.attr("data-layer-name", name); changed = true; }
    if (layer.attr("data-layer-kind") !== kind) { layer.attr("data-layer-kind", kind); changed = true; }

    if (ATOMIC_LAYER_KINDS.has(kind)) {
      layer.find("*").each((_, child) => {
        const nested = $(child);
        for (const attribute of ["data-layer-id", "data-layer-name", "data-layer-kind"]) {
          if (nested.attr(attribute) !== undefined) { nested.removeAttr(attribute); changed = true; }
        }
      });
      return;
    }
    children.forEach((child, index) => visit(child, [...path, index]));
  };

  roots.each((index, element) => visit(element, [index]));
  const normalizedHtml = root.html() || "";
  const audit = auditEditableFrame(normalizedHtml, nextCss, { allowGroups: true });
  if (!audit.valid) {
    const error = new Error(`EDITABILITY_CONTRACT_ERROR: ${audit.errors.join(" ")}`);
    error.audit = audit;
    throw error;
  }
  return { html: normalizedHtml, css: nextCss, background: nextBackground, changed, warnings, audit };
}

export function buildEditableFrameLayers(layers) {
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new Error("layers must be a non-empty array");
  }

  const ids = new Set();
  const html = [];
  const css = [];
  for (const [index, layer] of layers.entries()) {
    validateLayer(layer, index, ids);
    const id = layer.id.trim();
    const name = layer.name.trim();
    const kind = layer.kind;
    const tag = resolveTag(layer);
    const attributes = [
      `data-layer-id="${escapeAttribute(id)}"`,
      `data-layer-name="${escapeAttribute(name)}"`,
      `data-layer-kind="${kind}"`,
    ];

    let content = "";
    if (kind === "image") {
      attributes.push(`src="${escapeAttribute(layer.src)}"`);
      attributes.push(`alt="${escapeAttribute(layer.alt || name)}"`);
      attributes.push('draggable="false"');
    } else if (kind === "svg" || kind === "bezier") {
      content = layer.svg;
    } else {
      content = escapeHtml(layer.text || "");
    }

    html.push(tag === "img"
      ? `<img ${attributes.join(" ")}>`
      : `<${tag} ${attributes.join(" ")}>${content}</${tag}>`);
    css.push(buildLayerCss(id, layer));
  }

  return { html: html.join("\n"), css: css.join("\n\n"), layerIds: [...ids] };
}

export function buildEditableCanvasLayers(layers) {
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new Error("layers must be a non-empty array");
  }

  const ids = new Set();
  return layers.map((layer, index) => {
    validateLayer(layer, index, ids);
    const localLayer = { ...layer, x: 0, y: 0 };
    const built = buildEditableFrameLayers([localLayer]);
    return {
      id: layer.id.trim(),
      name: layer.name.trim(),
      kind: layer.kind,
      frameId: null,
      html: built.html,
      css: built.css,
      x: Number(layer.x),
      y: Number(layer.y),
      width: Number(layer.width),
      height: Number(layer.height),
      zIndex: index,
    };
  });
}

export function auditEditableFrame(html, css, { allowGroups = false } = {}) {
  if (!html?.trim()) return { valid: true, errors: [], warnings: [], layerCount: 0 };
  css = normalizeCssText(css);
  const $ = cheerio.load(`<div id="__editability_root">${html}</div>`, null, false);
  const root = $("#__editability_root");
  const errors = [];
  const warnings = [];
  const seenIds = new Set();

  for (const rule of cssRules(css || "")) {
    const selectors = rule.selector.split(",").map(selector => selector.trim().toLowerCase());
    if (selectors.some(selector => CANVAS_SELECTORS.has(selector)) && paintsABox(rule.declarations)) {
      errors.push("Canvas-level CSS owns visible paint. Use frame.background for a solid canvas color or an explicit Background layer for complex paint.");
    }
    const generatedContent = readDeclaration(rule.declarations, "content").replace(/\s*!important\s*$/i, "").trim();
    const createsGeneratedObject = generatedContent
      && !/^(?:none|normal|["']{2})$/i.test(generatedContent);
    if (selectors.some(selector => /::(?:before|after)\b/.test(selector))
      && (paintsABox(rule.declarations) || createsGeneratedObject)) {
      errors.push("Pseudo-elements cannot own visible design content because they are not selectable layers. Replace ::before/::after with explicit layers.");
    }
  }

  root.children().each((_, element) => {
    const tag = String(element.tagName || element.name || "div").toLowerCase();
    if (tag === "br") return; // br es rich-text, no un objeto de diseño
    const layer = $(element);
    if (!layer.attr("data-layer-id")) {
      errors.push("Every top-level design object must have data-layer-id, data-layer-name, and data-layer-kind.");
    }
  });

  root.find("[data-layer-id]").each((_, element) => {
    if (String(element.tagName || element.name || "div").toLowerCase() === "br") return; // rich-text
    const layer = $(element);
    const id = layer.attr("data-layer-id")?.trim() || "";
    const name = layer.attr("data-layer-name")?.trim() || "";
    const kind = layer.attr("data-layer-kind")?.trim().toLowerCase() || "";
    if (!id) errors.push("A layer has an empty data-layer-id.");
    else if (seenIds.has(id)) errors.push(`Duplicate data-layer-id: ${id}.`);
    else seenIds.add(id);
    if (!name) errors.push(`Layer ${id || "(unknown)"} is missing data-layer-name.`);
    if (!kind) errors.push(`Layer ${id || "(unknown)"} is missing data-layer-kind.`);
    else if (!LAYER_KINDS.has(kind) && !INTENTIONAL_CONTAINER_KINDS.has(kind)) {
      errors.push(`Layer ${id || "(unknown)"} has unsupported data-layer-kind: ${kind}.`);
    }

    const declarations = matchingDeclarations(layer, css || "");
    if (kind === "group" && paintsABox(declarations)) {
      errors.push(`Layer ${id || "(unknown)"} is a group but owns visible paint. Move full-artboard paint to frame.background or classify the box as a container/shape.`);
    }
    if (kind === "text" && layer.find("[data-layer-id]").length > 0) {
      errors.push(`Text layer ${id || "(unknown)"} contains nested layer IDs. Inline spans and br elements are rich-text content, not layers.`);
    }

    const parentLayer = layer.parentsUntil(root, "[data-layer-id]").first();
    if (parentLayer.length) {
      const parentKind = parentLayer.attr("data-layer-kind")?.toLowerCase() || "";
      if (!INTENTIONAL_CONTAINER_KINDS.has(parentKind)) {
        errors.push(`Layer ${id} is nested inside ${parentLayer.attr("data-layer-id")}; make both layers siblings with explicit coordinates.`);
      }
    }

    if (INTENTIONAL_CONTAINER_KINDS.has(kind) && !allowGroups) {
      errors.push(`Layer ${id} is a ${kind}. Flat editable layers are required unless allowGroupedLayers=true is intentional.`);
    }
    if (!INTENTIONAL_CONTAINER_KINDS.has(kind) && !ATOMIC_LAYER_KINDS.has(kind) && layer.children().length > 0) {
      errors.push(`Layer ${id} contains child elements. Split each visible/text object into its own positioned sibling layer.`);
    }
  });

  root.children("[data-layer-id]").each((_, element) => {
    const layer = $(element);
    const id = layer.attr("data-layer-id");
    const declarations = `${matchingDeclarations(layer, css || "")};${findLayerRule(css || "", id)}`.toLowerCase();
    if (!/position\s*:\s*(absolute|fixed)/.test(declarations)) {
      errors.push(`Layer ${id} needs position:absolute (or fixed). Use inline styles on the wrapper root (position:absolute;left:0;top:0;width:…;height:…) with the rest of the css single-line, or drop its .root class.`);
    }
    if (!/left\s*:/.test(declarations) || !/top\s*:/.test(declarations)) {
      errors.push(`Layer ${id} needs explicit left and top coordinates.`);
    }
    if (!/width\s*:/.test(declarations) || !/height\s*:/.test(declarations)) {
      warnings.push(`Layer ${id} should declare width and height for predictable human editing.`);
    }
  });

  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    layerCount: seenIds.size,
  };
}

export function assertEditableFrame(html, css, options) {
  const audit = auditEditableFrame(html, css, options);
  if (!audit.valid) {
    throw new Error(
      `EDITABILITY_CONTRACT_ERROR: ${audit.errors.join(" ")} `
      + "Use set_frame_layers with one sibling per text, image, button, SVG, or shape and explicit x/y/width/height.",
    );
  }
  return audit;
}

function validateLayer(layer, index, ids) {
  if (!layer || typeof layer !== "object") throw new Error(`layers[${index}] must be an object`);
  for (const field of ["id", "name", "kind", "x", "y", "width", "height"]) {
    if (layer[field] === undefined || layer[field] === null || layer[field] === "") {
      throw new Error(`layers[${index}].${field} is required`);
    }
  }
  for (const field of ["id", "name", "kind"]) {
    if (typeof layer[field] !== "string") throw new Error(`layers[${index}].${field} must be a string`);
  }
  if (!/^[A-Za-z][A-Za-z0-9_.:-]*$/.test(layer.id)) {
    throw new Error(`layers[${index}].id must start with a letter and contain only letters, numbers, _, ., :, or -`);
  }
  if (ids.has(layer.id)) throw new Error(`Duplicate layer id: ${layer.id}`);
  ids.add(layer.id);
  if (!LAYER_KINDS.has(layer.kind)) throw new Error(`Unsupported layer kind: ${layer.kind}`);
  for (const field of ["x", "y", "width", "height"]) {
    if (!Number.isFinite(Number(layer[field]))) throw new Error(`layers[${index}].${field} must be a number`);
  }
  if (Number(layer.width) <= 0 || Number(layer.height) <= 0) {
    throw new Error(`layers[${index}] width and height must be greater than zero`);
  }
  if (layer.kind === "image" && !layer.src) throw new Error(`layers[${index}].src is required for image layers`);
  if ((layer.kind === "svg" || layer.kind === "bezier") && !/^\s*<svg[\s>]/i.test(layer.svg || "")) {
    throw new Error(`layers[${index}].svg must contain one SVG root`);
  }
}

function resolveTag(layer) {
  if (layer.kind === "image") return "img";
  if (layer.kind === "button") return "button";
  if (layer.kind === "svg" || layer.kind === "bezier") return "div";
  if (layer.kind === "text" && TEXT_TAGS.has(layer.tag)) return layer.tag;
  return "div";
}

const BACKGROUND_PROPERTIES = new Set([
  "background", "background-color", "background-image",
  "backgroundColor", "backgroundImage",
]);

function hasBackgroundProperty(style) {
  if (!style || typeof style !== "object") return false;
  return Object.keys(style).some(key => BACKGROUND_PROPERTIES.has(key));
}

function buildLayerCss(id, layer) {
  const declarations = [
    "position: absolute",
    `left: ${Number(layer.x)}px`,
    `top: ${Number(layer.y)}px`,
    `width: ${Number(layer.width)}px`,
    `height: ${Number(layer.height)}px`,
    "box-sizing: border-box",
  ];
  if (layer.kind === "text") declarations.push("margin: 0");
  if (layer.kind === "image") declarations.push("display: block", "object-fit: cover");
  if (layer.kind === "shape" && !hasBackgroundProperty(layer.style)) {
    declarations.push("background: #8B5CF6");
  }
  for (const [rawProperty, rawValue] of Object.entries(layer.style || {})) {
    const property = toCssProperty(rawProperty);
    if (!/^(--[A-Za-z0-9_-]+|[a-z][a-z0-9-]*)$/.test(property)) throw new Error(`Invalid style property: ${rawProperty}`);
    if (RESERVED_LAYOUT_PROPERTIES.has(property)) continue;
    const value = formatCssValue(property, rawValue);
    if (/[{};]/.test(value)) throw new Error(`Invalid style value for ${rawProperty}`);
    declarations.push(`${property}: ${value}`);
  }
  return `[data-layer-id="${escapeCssString(id)}"] {\n  ${declarations.join(";\n  ")};\n}`;
}

function findLayerRule(css, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\[data-layer-id=["']${escaped}["']\\]\\s*\\{([^}]*)\\}`, "i").exec(css);
  return match?.[1] || "";
}

function toCssProperty(property) {
  return property.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`);
}

function formatCssValue(property, value) {
  if (typeof value === "number" && !UNITLESS_PROPERTIES.has(property)) return `${value}px`;
  return String(value).trim();
}

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function escapeCssString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
