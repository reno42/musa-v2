import * as cheerio from "cheerio";

const LAYER_KINDS = new Set(["text", "shape", "image", "button", "svg", "bezier"]);
const INTENTIONAL_CONTAINER_KINDS = new Set(["group", "container", "component"]);
const TEXT_TAGS = new Set(["div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6"]);
const RESERVED_LAYOUT_PROPERTIES = new Set(["position", "left", "top", "right", "bottom", "width", "height"]);
const UNITLESS_PROPERTIES = new Set(["font-weight", "line-height", "opacity", "z-index", "order", "flex-grow", "flex-shrink"]);

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
  const $ = cheerio.load(`<div id="__editability_root">${html}</div>`, null, false);
  const root = $("#__editability_root");
  const errors = [];
  const warnings = [];
  const seenIds = new Set();

  root.children().each((_, element) => {
    const layer = $(element);
    if (!layer.attr("data-layer-id")) {
      errors.push("Every top-level design object must have data-layer-id, data-layer-name, and data-layer-kind.");
    }
  });

  root.find("[data-layer-id]").each((_, element) => {
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
    if (!INTENTIONAL_CONTAINER_KINDS.has(kind) && kind !== "svg" && kind !== "bezier" && layer.children().length > 0) {
      errors.push(`Layer ${id} contains child elements. Split each visible/text object into its own positioned sibling layer.`);
    }
  });

  root.children("[data-layer-id]").each((_, element) => {
    const layer = $(element);
    const id = layer.attr("data-layer-id");
    const declarations = `${layer.attr("style") || ""};${findLayerRule(css || "", id)}`.toLowerCase();
    if (!/position\s*:\s*(absolute|fixed)/.test(declarations)) {
      errors.push(`Layer ${id} needs position:absolute (or fixed).`);
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
  if (layer.kind === "shape" && !layer.style?.background && !layer.style?.["background-color"]) {
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
