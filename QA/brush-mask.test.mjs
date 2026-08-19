/**
 * FASE 3 (F4) — Borrador brush-mask QA selftest
 *
 * Covers the Node-testable surface of the eraser pipeline:
 *  1. bakePathMask's brush painting (erase = black, restore = white, sizes)
 *     — REAL production code from shared/maskBake.ts (pure, no DOM).
 *  2. applyBrushStroke (src/lib/maskApply.ts) — the editor-side DOM surgery
 *     that appends a stroke, auto-creates the full-rect mask on a bare image,
 *     reuses an existing mask path, and re-bakes — executed as REAL
 *     production code under a minimal cheerio-backed tree DOM.
 *  3. Static wiring guards so a future edit cannot silently drop the eraser
 *     tool, the mask_brush MCP tool, or the [ ]/E keyboard shortcuts.
 *
 * Node has no DOMParser and the browser-side TS modules use extensionless
 * imports, so this file installs a cheerio-backed DOM shim covering exactly
 * the surface parseFragment/bakeOnDocument/applyBrushStroke use (tree
 * walking, attribute reads/writes, createElementNS, before/appendChild,
 * closest/matches, serialization) and a resolver hook that maps the
 * extensionless specifiers of maskApply/htmlMutations to their .ts files.
 *
 * Run: node --experimental-strip-types --test QA/brush-mask.test.mjs
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { load } from "cheerio";
import { registerHooks } from "node:module";

// ═══════════════════════════════════════════════════════════════
// Minimal tree DOM over cheerio
// ═══════════════════════════════════════════════════════════════

const VOID_TAGS = new Set(["img", "br", "hr", "input", "meta", "link", "source"]);

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function matchSelector(el, selector) {
  if (el.nodeType !== 1) return false;
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(selector);
  if (tagMatch && el.tagName !== tagMatch[0].toUpperCase()) return false;
  const rest = tagMatch ? selector.slice(tagMatch[0].length) : selector;
  const condRe = /\[([^\]=]+)(?:=("([^"]*)"|'([^']*)'))?\]/g;
  let m;
  while ((m = condRe.exec(rest)) !== null) {
    const attr = m[1];
    const value = m[3] !== undefined ? m[3] : m[4];
    if (value === undefined) {
      if (!(attr in el.attribs)) return false;
    } else if (el.attribs[attr] !== value) {
      return false;
    }
  }
  return true;
}

class NodeEl {
  constructor(tagName, attribs, parent, children) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attribs = attribs || {};
    this.parent = parent || null;
    this.children = children || [];
  }
  getAttribute(name) { return name in this.attribs ? this.attribs[name] : null; }
  setAttribute(name, value) { this.attribs[name] = String(value); }
  removeAttribute(name) { delete this.attribs[name]; }
  matches(selector) { return matchSelector(this, selector); }
  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parent;
    }
    return null;
  }
  querySelector(selector) {
    return this.children.find(child => child.nodeType === 1 && child.matches(selector)) || null;
  }
  appendChild(child) {
    child.parent = this;
    this.children.push(child);
  }
  before(node) {
    if (!this.parent) throw new Error("before() needs a parent");
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 0, node);
    node.parent = this.parent;
  }
}

class TextNode {
  constructor(text, parent) {
    this.nodeType = 3;
    this.text = text;
    this.parent = parent || null;
    this.children = [];
  }
}

function fromCheerio(node, parent) {
  if (node.type === "text") return new TextNode(node.data || "", parent);
  if (node.type !== "tag" && node.type !== "script" && node.type !== "style") return null;
  const el = new NodeEl(node.name || "div", { ...(node.attribs || {}) }, parent);
  el.children = (node.children || []).map(child => fromCheerio(child, el)).filter(Boolean);
  return el;
}

function serializeNode(node) {
  if (node.nodeType === 3) {
    return String(node.text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  const attrs = Object.entries(node.attribs)
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join("");
  const tag = node.tagName.toLowerCase();
  if (VOID_TAGS.has(tag)) return `<${tag}${attrs}>`;
  const inner = node.children.map(serializeNode).join("");
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

function allDescendants(roots) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (child.nodeType === 1) out.push(child);
      walk(child);
    }
  };
  for (const root of roots) {
    if (root.nodeType === 1) out.push(root);
    walk(root);
  }
  return out;
}

globalThis.DOMParser = class {
  parseFromString(html) {
    const $ = load(html);
    const bodyNode = $("body").get(0);
    const roots = (bodyNode?.children || []).map(node => fromCheerio(node, null)).filter(Boolean);
    const body = {
      querySelectorAll: selector => allDescendants(roots).filter(el => el.matches(selector)),
      get innerHTML() { return roots.map(serializeNode).join(""); },
    };
    return {
      body,
      createElementNS(_ns, tag) { return new NodeEl(tag, {}, null, []); },
      createElement(tag) { return new NodeEl(tag, {}, null, []); },
    };
  }
};

// maskApply.ts / htmlMutations.ts import "./cssMutations", "./layerKind" and
// "./htmlMutations" without an extension (fine for the browser toolchains,
// not for Node ESM).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./cssMutations" || specifier === "./layerKind" || specifier === "./htmlMutations") {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const maskBake = await import("../shared/maskBake.ts");
const maskApplyP = import("../src/lib/maskApply.ts");

/** Canonical body-HTML form — serialization differences (self-closing tags, attribute order) are noise. */
const canon = html => load(html)("body").html() || "";

// ═══════════════════════════════════════════════════════════════
// 1. Brush painting in the bake (pure shared code)
// ═══════════════════════════════════════════════════════════════

const BAKED = maskBake.bakePathMask({
  pathData: "M10 10 L90 10 L90 90 L10 90 Z",
  pathBox: { left: 10, top: 10, width: 80, height: 80 },
  viewBox: null,
  imageBox: { left: 0, top: 0, width: 100, height: 100 },
  mode: "include",
  brushes: [
    { points: [{ x: 20, y: 20 }, { x: 40, y: 40 }], size: 24, mode: "erase" },
    { points: [{ x: 60, y: 60 }, { x: 80, y: 60 }], size: 8, mode: "restore" },
  ],
});

const decodeMask = baked => Buffer.from(baked.value.replace(/^url\("data:image\/svg\+xml;base64,/, "").replace(/"\)$/, ""), "base64").toString("utf8");

test("F4 bake: brushed include mask uses mask-image with erase=black, restore=white trails", () => {
  assert.equal(BAKED.property, "mask-image");
  const svg = decodeMask(BAKED);
  assert.ok(svg.includes('stroke="#000000"'), "erase stroke must paint black");
  assert.ok(svg.includes('stroke="#ffffff"'), "restore stroke must paint white");
  assert.ok(svg.includes('stroke-width="24"'), "brush size is carried through");
  assert.ok(svg.includes('stroke-width="8"'));
  assert.ok(svg.includes('stroke-linecap="round"'));
  assert.equal(BAKED.companions["mask-size"], "100% 100%");
  assert.equal(BAKED.companions["mask-repeat"], "no-repeat");
  // Black (erase) must come before white (restore) — paint order matters.
  assert.ok(svg.indexOf("#000000") < svg.indexOf("#ffffff"));
});

test("F4 bake: base rect is hidden for include, visible for exclude", () => {
  const exclude = maskBake.bakePathMask({
    pathData: "M10 10 L90 10 L90 90 L10 90 Z",
    pathBox: { left: 10, top: 10, width: 80, height: 80 },
    viewBox: null,
    imageBox: { left: 0, top: 0, width: 100, height: 100 },
    mode: "exclude",
    brushes: [{ points: [{ x: 20, y: 20 }], size: 24, mode: "erase" }],
  });
  const svg = decodeMask(exclude);
  assert.ok(svg.includes('fill="#ffffff"'), "exclude world must start all-visible");
  const includeSvg = decodeMask(BAKED);
  assert.ok(includeSvg.includes('fill="#000000"'), "include world must start all-hidden");
});

// ═══════════════════════════════════════════════════════════════
// 2. applyBrushStroke (real production code under the shim)
// ═══════════════════════════════════════════════════════════════

const BARE_FRAME = {
  html: '<div><img data-layer-id="img1" src="https://cdn.x/a.png" style="position:absolute;left:50px;top:40px;width:200px;height:150px;"><div data-layer-id="div1" style="position:absolute;left:0px;top:0px;width:10px;height:10px;"></div></div>',
  css: '[data-layer-id="img1"] {\n  position: absolute;\n  left: 50px;\n  top: 40px;\n  width: 200px;\n  height: 150px;\n}',
};

test("F4: first stroke on a bare image auto-creates the full-rect mask and bakes it", async () => {
  const { applyBrushStroke } = await maskApplyP;
  const result = applyBrushStroke(
    BARE_FRAME.html,
    BARE_FRAME.css,
    "img1",
    { points: [{ x: 25, y: 30 }, { x: 60, y: 80 }], size: 24, mode: "erase" },
  );
  assert.ok(result, "stroke must apply");
  assert.equal(result.maskCreated, true);

  const $ = load(result.html);
  const maskSvg = $(`svg[data-layer-kind="mask"][data-layer-id="${result.pathLayerId}"]`);
  assert.equal(maskSvg.length, 1, "exactly one mask svg is created");
  // The mask svg sits BEFORE the img so the img stays the hit-test target.
  const imgIndex = $('img[data-layer-id="img1"]').index();
  const svgIndex = maskSvg.index();
  assert.ok(svgIndex < imgIndex, "mask svg must precede the img in DOM order");

  const path = maskSvg.find("path");
  assert.equal(path.attr("data-mask-for"), "img1");
  assert.equal(path.attr("data-mask-mode"), "include");
  // Full-rect d in frame coordinates (no viewBox).
  assert.match(path.attr("d"), /^M50 40 L250 40 L250 190 L50 190 Z/);

  // The stroke is persisted on the img for re-edition.
  const brushes = maskBake.parseBrushesAttr($('img[data-layer-id="img1"]').attr("data-mask-brushes"));
  assert.equal(brushes.length, 1);
  assert.equal(brushes[0].mode, "erase");
  assert.deepEqual(brushes[0].points, [{ x: 25, y: 30 }, { x: 60, y: 80 }]);

  // The img rule now carries the baked mask + companions.
  assert.match(result.css, /mask-image:\s*url\("data:image\/svg\+xml;base64,/);
  assert.match(result.css, /mask-size:\s*100% 100%/);
  assert.match(result.css, /mask-repeat:\s*no-repeat/);
  // The mask layer rule exists and is pointer-events: none.
  assert.match(result.css, new RegExp(`\\[data-layer-id="${result.pathLayerId}"\\]`));
  assert.match(result.css, /pointer-events:\s*none/);
});

test("F4: second stroke appends to the same mask — no duplicate svg, strokes accumulate", async () => {
  const { applyBrushStroke } = await maskApplyP;
  const first = applyBrushStroke(BARE_FRAME.html, BARE_FRAME.css, "img1",
    { points: [{ x: 25, y: 30 }, { x: 60, y: 80 }], size: 24, mode: "erase" });
  const second = applyBrushStroke(first.html, first.css, "img1",
    { points: [{ x: 100, y: 100 }, { x: 120, y: 120 }], size: 12, mode: "restore" });
  assert.ok(second);
  assert.equal(second.maskCreated, false);
  assert.equal(second.pathLayerId, first.pathLayerId);

  const $ = load(second.html);
  assert.equal($("svg[data-layer-kind='mask']").length, 1, "still exactly one mask svg");
  const brushes = maskBake.parseBrushesAttr($('img[data-layer-id="img1"]').attr("data-mask-brushes"));
  assert.equal(brushes.length, 2);
  assert.equal(brushes[1].mode, "restore");
  assert.equal(brushes[1].size, 12);
});

test("F4: stroke on an image with an existing F1 mask reuses it and keeps its mode", async () => {
  const { applyBrushStroke } = await maskApplyP;
  const maskedHtml = '<div>'
    + '<svg data-layer-id="mask1" viewBox="0 0 200 150" style="position:absolute;left:50px;top:40px;width:200px;height:150px;overflow:visible;">'
    + '<path d="M10 10 L190 10 L190 140 L10 140 Z" fill="none" data-mask-for="img1" data-mask-mode="exclude"/>'
    + '</svg>'
    + '<img data-layer-id="img1" src="https://cdn.x/a.png" style="position:absolute;left:50px;top:40px;width:200px;height:150px;">'
    + '</div>';
  const css = '[data-layer-id="img1"] {\n  position: absolute;\n  left: 50px;\n  top: 40px;\n  width: 200px;\n  height: 150px;\n}\n[data-layer-id="mask1"] {\n  position: absolute;\n  left: 50px;\n  top: 40px;\n  width: 200px;\n  height: 150px;\n}';
  const result = applyBrushStroke(maskedHtml, css, "img1",
    { points: [{ x: 30, y: 30 }, { x: 90, y: 90 }], size: 20, mode: "erase" });
  assert.ok(result);
  assert.equal(result.maskCreated, false);
  assert.equal(result.pathLayerId, "mask1");

  const $ = load(result.html);
  assert.equal($("svg[data-layer-kind='mask']").length, 0, "no auto mask is created");
  assert.equal($('path[data-mask-for="img1"]').attr("data-mask-mode"), "exclude", "exclude mode is preserved");
  assert.match(result.css, /mask-image:/, "exclude + brushes must bake a mask-image, not a clip-path");
});

test("F4: non-image targets are rejected with null (delete is the tool's other verb)", async () => {
  const { applyBrushStroke } = await maskApplyP;
  const result = applyBrushStroke(BARE_FRAME.html, BARE_FRAME.css, "div1",
    { points: [{ x: 0, y: 0 }], size: 24, mode: "erase" });
  assert.equal(result, null);
});

test("F4: an image without a px box is rejected with null (no silent corruption)", async () => {
  const { applyBrushStroke } = await maskApplyP;
  const html = '<div><img data-layer-id="img1" src="https://cdn.x/a.png"></div>';
  const result = applyBrushStroke(html, "", "img1",
    { points: [{ x: 0, y: 0 }], size: 24, mode: "erase" });
  assert.equal(result, null);
});

// ═══════════════════════════════════════════════════════════════
// 3. Static wiring guards
// ═══════════════════════════════════════════════════════════════

const readRepo = rel => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("F4 MCP: catalog exposes mask_brush with strokes schema, and the case bakes server-side", () => {
  const mcp = readRepo("netlify/functions/mcp.mjs");
  assert.match(mcp, /name: "mask_brush"/);
  assert.match(mcp, /case "mask_brush":/);
  assert.match(mcp, /data-mask-brushes/);
  assert.match(mcp, /applyMaskServer\(\$, frame, pathLayerId, params\.imageLayerId, mode\)/);
  assert.match(mcp, /required: \["templateId", "frameId", "imageLayerId", "strokes"\]/);
});

test("F4 UI: eraser is a first-class tool end to end", () => {
  const canvas = readRepo("src/components/InfiniteHtmlCanvas.tsx");
  assert.match(canvas, /"eraser"/);
  assert.match(canvas, /onBrushStroke\?/);
  assert.match(canvas, /brushSize\?/);

  const toolbar = readRepo("src/components/FloatingToolbar.tsx");
  assert.match(toolbar, /ERASER_TOOL/);
  assert.match(toolbar, /IconEraser/);
  assert.match(toolbar, /Tamaño de brocha/);

  const frame = readRepo("src/components/DesignFrame.tsx");
  assert.match(frame, /if \(tool === "eraser"\)/);
  assert.match(frame, /onBrushStrokeRef\.current/);
  assert.match(frame, /img\[data-layer-id\]/);

  const editor = readRepo("src/pages/EditorV2.tsx");
  assert.match(editor, /applyBrushStroke/);
  assert.match(editor, /case "e": setActiveTool\("eraser"\)/);
  assert.match(editor, /setBrushSize/);
});

test("F4 maskApply: applyBrushStroke lives beside the F1 functions", () => {
  const maskApply = readRepo("src/lib/maskApply.ts");
  assert.match(maskApply, /export function applyBrushStroke/);
  assert.match(maskApply, /serializeBrushesAttr/);
  assert.match(maskApply, /setAttribute\("data-layer-kind", "mask"\)/);
  assert.match(maskApply, /pointer-events:\s*none/);
});
