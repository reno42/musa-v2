/**
 * FASE 4 (F2) — Varita (SAM click-to-segment) QA selftest
 *
 * Covers the Node-testable surface of the wand pipeline:
 *  1. normalizeSegmentPoints / normalizeSegmentBox (shared/segmentPoints.ts)
 *     — REAL production code: the one prompt contract every surface agrees
 *     on (REST /api/segment/click, MCP segment_click, the Varita UI).
 *  2. applySegmentMaskPath (src/lib/maskApply.ts) — the editor-side DOM
 *     surgery that lands the traced dNorm outline as an F1 mask path,
 *     executed as REAL production code under a minimal cheerio-backed tree
 *     DOM (same shim as brush-mask.test.mjs).
 *  3. Static wiring guards so a future edit cannot silently drop the wand
 *     tool, the segment_click REST/MCP surface, or the W keyboard shortcut.
 *
 * Node has no DOMParser and the browser-side TS modules use extensionless
 * imports, so this file installs the same cheerio-backed DOM shim and
 * resolver hook as the other mask QA files.
 *
 * Run: node --experimental-strip-types --test QA/wand-segment.test.mjs
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { load } from "cheerio";
import { registerHooks } from "node:module";

// ═══════════════════════════════════════════════════════════════
// Minimal tree DOM over cheerio (shared shim, see brush-mask.test.mjs)
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

// maskApply.ts imports "./cssMutations" (and friends) without an extension.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./cssMutations" || specifier === "./layerKind" || specifier === "./htmlMutations" || specifier === "./gradient") {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const segmentPoints = await import("../shared/segmentPoints.ts");
const maskBake = await import("../shared/maskBake.ts");
const maskApplyP = import("../src/lib/maskApply.ts");

// ═══════════════════════════════════════════════════════════════
// 1. Prompt normalization (pure shared code)
// ═══════════════════════════════════════════════════════════════

test("F2 points: normalized prompts pass through unchanged", () => {
  const out = segmentPoints.normalizeSegmentPoints([{ x: 0.2, y: 0.3, neg: false }]);
  assert.deepEqual(out, [{ x: 0.2, y: 0.3, neg: false }]);
});

test("F2 points: out-of-range values are clamped to 0..1", () => {
  const out = segmentPoints.normalizeSegmentPoints([{ x: -0.5, y: 1.7 }]);
  assert.deepEqual(out, [{ x: 0, y: 1, neg: false }]);
});

test("F2 points: px prompts divide by imageWidth/imageHeight", () => {
  const out = segmentPoints.normalizeSegmentPoints([{ x: 25, y: 30, neg: true }], 100, 60);
  assert.deepEqual(out, [{ x: 0.25, y: 0.5, neg: true }]);
});

test("F2 points: px is only assumed past the 1.25 threshold", () => {
  // 1.1 could be a normalized point, so it stays; 200 without dims clamps.
  const inside = segmentPoints.normalizeSegmentPoints([{ x: 1.1, y: 0.5 }], 100, 60);
  assert.deepEqual(inside, [{ x: 1, y: 0.5, neg: false }]);
  const noDims = segmentPoints.normalizeSegmentPoints([{ x: 200, y: 150 }]);
  assert.deepEqual(noDims, [{ x: 1, y: 1, neg: false }]);
});

test("F2 points: non-finite entries are dropped; nothing left → null", () => {
  const mixed = segmentPoints.normalizeSegmentPoints([
    { x: 0.5, y: 0.5 },
    { x: "bad", y: 0.2 },
  ]);
  assert.deepEqual(mixed, [{ x: 0.5, y: 0.5, neg: false }]);
  assert.equal(segmentPoints.normalizeSegmentPoints([{ x: NaN, y: 2 }]), null);
  assert.equal(segmentPoints.normalizeSegmentPoints("nope"), null);
  assert.equal(segmentPoints.normalizeSegmentPoints([]), null);
});

test("F2 box: normalized and px forms converge; degenerate/null → null", () => {
  assert.deepEqual(
    segmentPoints.normalizeSegmentBox({ x: 0.1, y: 0.2, w: 0.4, h: 0.2 }),
    { x: 0.1, y: 0.2, w: 0.4, h: 0.2 },
  );
  assert.deepEqual(
    segmentPoints.normalizeSegmentBox({ x: 10, y: 20, w: 40, h: 20 }, 100, 100),
    { x: 0.1, y: 0.2, w: 0.4, h: 0.2 },
  );
  assert.equal(segmentPoints.normalizeSegmentBox(null), null);
  assert.equal(segmentPoints.normalizeSegmentBox({ x: 0, y: 0, w: 0, h: 10 }), null);
});

// ═══════════════════════════════════════════════════════════════
// 2. applySegmentMaskPath (real production code under the shim)
// ═══════════════════════════════════════════════════════════════

// dNorm: normalized 0..1 over the image. Over an img at 50/40 200×150 the
// frame-space outline is (0.1·200+50, 0.2·150+40) → (70,70) etc.
const DNORM = "M0.1 0.2 L0.9 0.2 L0.9 0.8 L0.1 0.8 Z";
const FRAME_D = /^M70 70 L230 70 L230 160 L70 160 Z$/;

const BARE_FRAME = {
  html: '<div><img data-layer-id="img1" src="https://cdn.x/a.png" style="position:absolute;left:50px;top:40px;width:200px;height:150px;"><div data-layer-id="div1" style="position:absolute;left:0px;top:0px;width:10px;height:10px;"></div></div>',
  css: '[data-layer-id="img1"] {\n  position: absolute;\n  left: 50px;\n  top: 40px;\n  width: 200px;\n  height: 150px;\n}',
};

test("F2: wand on a bare image creates a frame-origin mask svg and bakes the clip", async () => {
  const { applySegmentMaskPath } = await maskApplyP;
  const result = applySegmentMaskPath(BARE_FRAME.html, BARE_FRAME.css, "img1", DNORM);
  assert.ok(result, "segment must apply");
  assert.equal(result.maskCreated, true);

  const $ = load(result.html);
  const maskSvg = $(`svg[data-layer-kind="mask"][data-layer-id="${result.pathLayerId}"]`);
  assert.equal(maskSvg.length, 1, "exactly one mask svg is created");
  // Pinned to the frame origin (1×1, overflow visible): d is frame coords.
  assert.match(maskSvg.attr("style"), /left:\s*0px/);
  assert.match(maskSvg.attr("style"), /width:\s*1px/);
  assert.match(maskSvg.attr("style"), /overflow:\s*visible/);
  assert.equal(maskSvg.attr("data-layer-name"), "Selección Varita");
  // The mask svg sits BEFORE the img so the img stays the hit-test target.
  const imgIndex = $('img[data-layer-id="img1"]').index();
  const svgIndex = maskSvg.index();
  assert.ok(svgIndex < imgIndex, "mask svg must precede the img in DOM order");

  const path = maskSvg.find("path");
  assert.match(path.attr("d"), FRAME_D, "dNorm is scaled into frame coordinates");
  assert.equal(path.attr("fill"), "none");
  assert.equal(path.attr("data-mask-for"), "img1");
  assert.equal(path.attr("data-mask-mode"), "include");

  // include + no brushes → self-contained clip-path (no url(#id) refs).
  assert.match(result.css, /clip-path:\s*path\("evenodd,/);
  assert.doesNotMatch(result.css, /url\(#/);
  assert.match(result.css, new RegExp(`\\[data-layer-id="${result.pathLayerId}"\\]`));
  assert.match(result.css, /pointer-events:\s*none/);
});

test("F2: wand over an F1 viewBox mask reuses it — d remapped into its space", async () => {
  const { applySegmentMaskPath } = await maskApplyP;
  const maskedHtml = '<div>'
    + '<svg data-layer-id="mask1" viewBox="0 0 200 150" style="position:absolute;left:50px;top:40px;width:200px;height:150px;overflow:visible;">'
    + '<path d="M10 10 L190 10 L190 140 L10 140 Z" fill="none" data-mask-for="img1" data-mask-mode="exclude"/>'
    + '</svg>'
    + '<img data-layer-id="img1" src="https://cdn.x/a.png" style="position:absolute;left:50px;top:40px;width:200px;height:150px;">'
    + '</div>';
  const css = '[data-layer-id="img1"] {\n  position: absolute;\n  left: 50px;\n  top: 40px;\n  width: 200px;\n  height: 150px;\n}\n[data-layer-id="mask1"] {\n  position: absolute;\n  left: 50px;\n  top: 40px;\n  width: 200px;\n  height: 150px;\n}';
  const result = applySegmentMaskPath(maskedHtml, css, "img1", DNORM);
  assert.ok(result);
  assert.equal(result.maskCreated, false);
  assert.equal(result.pathLayerId, "mask1");

  const $ = load(result.html);
  assert.equal($("svg[data-layer-kind='mask']").length, 0, "no second mask svg");
  // viewBox space: p = (frame − svgTopLeft)/scale + vbOrigin → (70−50, 70−40).
  assert.match($('path[data-mask-for="img1"]').attr("d"), /^M20 30 L180 30 L180 120 L20 120 Z$/);
  // The svg keeps its own positioning; only the path data changed.
  assert.match($('svg[data-layer-id="mask1"]').attr("style"), /left:\s*50px/);
  assert.equal($('path[data-mask-for="img1"]').attr("data-mask-mode"), "include", "the wand always lands in include mode");
  assert.match(result.css, /clip-path:\s*path\("evenodd,/);
});

test("F2: wand over a legacy no-viewBox mask re-pins it to the frame origin", async () => {
  const { applySegmentMaskPath } = await maskApplyP;
  const legacyHtml = '<div>'
    + '<svg data-layer-id="mask2" data-layer-kind="mask" style="position:absolute;left:50px;top:40px;width:200px;height:150px;overflow:visible;">'
    + '<path d="M50 40 L250 40 L250 190 L50 190 Z" fill="none" data-mask-for="img1" data-mask-mode="include"/>'
    + '</svg>'
    + '<img data-layer-id="img1" src="https://cdn.x/a.png" style="position:absolute;left:50px;top:40px;width:200px;height:150px;">'
    + '</div>';
  const css = '[data-layer-id="img1"] {\n  position: absolute;\n  left: 50px;\n  top: 40px;\n  width: 200px;\n  height: 150px;\n}\n[data-layer-id="mask2"] {\n  position: absolute;\n  left: 50px;\n  top: 40px;\n  width: 200px;\n  height: 150px;\n}';
  const result = applySegmentMaskPath(legacyHtml, css, "img1", DNORM);
  assert.ok(result);
  assert.equal(result.maskCreated, false);
  assert.equal(result.pathLayerId, "mask2");

  const $ = load(result.html);
  const svg = $('svg[data-layer-id="mask2"]');
  assert.match(svg.attr("style"), /left:\s*0px/, "svg is re-pinned to the frame origin");
  assert.match(svg.attr("style"), /width:\s*1px/);
  assert.match($('path[data-mask-for="img1"]').attr("d"), FRAME_D, "d is rewritten in frame coordinates");
  // The CSS rule follows the re-pin so the outline overlays the subject.
  assert.match(result.css, /\[data-layer-id="mask2"\]\s*\{[^}]*left:\s*0px/);
});

test("F2: degenerate inputs are rejected with null (no silent corruption)", async () => {
  const { applySegmentMaskPath } = await maskApplyP;
  assert.equal(applySegmentMaskPath(BARE_FRAME.html, BARE_FRAME.css, "img1", ""), null, "empty dNorm");
  assert.equal(applySegmentMaskPath(BARE_FRAME.html, BARE_FRAME.css, "img1", "   "), null, "whitespace dNorm");
  assert.equal(applySegmentMaskPath(BARE_FRAME.html, BARE_FRAME.css, "div1", DNORM), null, "non-img layer");
  const boxless = applySegmentMaskPath('<div><img data-layer-id="img1" src="https://cdn.x/a.png"></div>', "", "img1", DNORM);
  assert.equal(boxless, null, "img without a px box");
});

// ═══════════════════════════════════════════════════════════════
// 3. Static wiring guards
// ═══════════════════════════════════════════════════════════════

const readRepo = rel => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("F2 REST: /api/segment/click validates + queues a segment_click job", () => {
  const routes = readRepo("api/src/routes/segmentation.ts");
  assert.match(routes, /segmentationRoutes\.post\("\/click"/);
  assert.match(routes, /prompt \? "segment_text" : "segment_click"/);
  assert.match(routes, /normalizeSegmentPoints\(body\.points/);
  assert.match(routes, /normalizeSegmentBox\(body\.box/);
});

test("F2b REST: a prompt routes to a segment_text job with precedence over points/box", () => {
  const routes = readRepo("api/src/routes/segmentation.ts");
  assert.match(routes, /const prompt = typeof body\.prompt === "string" && body\.prompt\.trim\(\)/);
  assert.match(routes, /if \(!prompt && !points && !box\)/);
  assert.match(routes, /createSegmentJob\(/);
  // prompt takes precedence: points/box are not normalized when it is set.
  assert.match(routes, /const points = prompt \? null : normalizeSegmentPoints/);
  assert.match(routes, /const box = prompt \? null : normalizeSegmentBox/);
  // the job params carry the prompt.
  assert.match(routes, /\{ prompt, sourceAssetId: input\.sourceAssetId, sourceName: input\.sourceName \}/);
});

test("F2 shared: the normalization contract lives in shared/segmentPoints.ts", () => {
  const shared = readRepo("shared/segmentPoints.ts");
  assert.match(shared, /export function normalizeSegmentPoints/);
  assert.match(shared, /export function normalizeSegmentBox/);
});

test("F2 MCP: catalog exposes segment_click and applies the mask server-side", () => {
  const mcp = readRepo("netlify/functions/mcp.mjs");
  assert.match(mcp, /name: "segment_click"/);
  assert.match(mcp, /case "segment_click":/);
  assert.match(mcp, /normalizeSegmentPoints\(params\.points/);
  assert.match(mcp, /async function applySegmentMaskToLayer/);
  assert.match(mcp, /applySegmentMaskToLayer\(params\.applyTo, result\.svgPath\)/);
  assert.match(mcp, /neg:\s*\{\s*type:\s*"boolean"/);
});

test("F2b MCP: the tool accepts a text prompt and routes it to segment_text", () => {
  const mcp = readRepo("netlify/functions/mcp.mjs");
  assert.match(mcp, /prompt: \{ type: "string"/);
  assert.match(mcp, /const prompt = typeof params\.prompt === "string" && params\.prompt\.trim\(\)/);
  assert.match(mcp, /if \(!prompt && !normPoints && !normBox\)/);
  assert.match(mcp, /createSegmentJob\(prompt \? "segment_text" : "segment_click"/);
  assert.match(mcp, /\{ prompt, sourceAssetId, sourceName \}/);
});

test("F2 UI: wand is a first-class tool end to end", () => {
  const canvas = readRepo("src/components/InfiniteHtmlCanvas.tsx");
  assert.match(canvas, /"wand"/);
  assert.match(canvas, /onWandSegment\?/);
  assert.match(canvas, /wandLoading\?/);

  const toolbar = readRepo("src/components/FloatingToolbar.tsx");
  assert.match(toolbar, /WAND_TOOL/);
  assert.match(toolbar, /IconWand/);

  const frame = readRepo("src/components/DesignFrame.tsx");
  assert.match(frame, /if \(tool === "wand"\)/);
  assert.match(frame, /onWandSegmentRef\.current/);
  assert.match(frame, /wandLoadingRef/);
  assert.match(frame, /Segmentando…/);
  assert.match(frame, /img\[data-layer-id\]/);

  const editor = readRepo("src/pages/EditorV2.tsx");
  assert.match(editor, /applySegmentMaskPath/);
  assert.match(editor, /case "w": setActiveTool/);
  assert.match(editor, /onWandSegment=\{\(frameId, imageLayerId, src, points\)/);
  assert.match(editor, /wandLoading=\{wandBusy\}/);
  assert.match(editor, /api\/segment\/click/);
});

test("F2b UI: the wand flyout runs a CLIPSeg prompt over the selected image", () => {
  const toolbar = readRepo("src/components/FloatingToolbar.tsx");
  assert.match(toolbar, /wandPrompt\?: string/);
  assert.match(toolbar, /onWandPromptChange\?: \(value: string\) => void/);
  assert.match(toolbar, /onWandPromptRun\?: \(\) => void/);
  assert.match(toolbar, /tool === "wand" && onWandPromptRun/);
  assert.match(toolbar, /Segmentar por texto \(CLIPSeg\)/);

  const editor = readRepo("src/pages/EditorV2.tsx");
  assert.match(editor, /const \[wandPrompt, setWandPrompt\] = useState/);
  assert.match(editor, /const handleWandPromptRun = useCallback/);
  assert.match(editor, /selectedElement\.tag\.toLowerCase\(\) !== "img"/);
  assert.match(editor, /runSegmentJob\(\{ url: src, prompt \}/);
  assert.match(editor, /wandPrompt=\{wandPrompt\}/);
  assert.match(editor, /onWandPromptChange=\{setWandPrompt\}/);
  assert.match(editor, /onWandPromptRun=\{handleWandPromptRun\}/);
});

test("F2 engine: segment-core routes text jobs to CLIPSeg", () => {
  const core = readRepo("netlify/segment/segment-core.mjs");
  assert.match(core, /job\.kind === "segment_text"/);
  assert.match(core, /clipsegMask\(/);
  assert.match(core, /\(job\.params_json \|\| \{\}\)\.prompt/);
});
