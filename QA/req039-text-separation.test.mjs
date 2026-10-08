/**
 * QA REQ039 — P2.5 per-letter text separation with an editable original.
 * Plain .mjs (node --experimental-strip-types). textSeparation.ts touches
 * DOMParser, so a minimal cheerio-backed document shim covers exactly the
 * surface the lib uses (querySelectorAll with attribute selectors, attribute
 * read/write, after/remove, textContent, body.innerHTML serialization).
 * measureLetterBoxes is DOM-live: here we only assert it refuses to run
 * without a real document (the editor is its only caller).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load } from "cheerio";

// ── Minimal tree DOM over cheerio (pattern: QA/brush-mask.test.mjs) ──

const VOID_TAGS = new Set(["img", "br", "hr", "input", "meta", "link", "source"]);

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

class TextNode {
  constructor(text, parent) {
    this.nodeType = 3;
    this.text = text;
    this.parent = parent || null;
    this.children = [];
  }
}

class NodeEl {
  constructor(tagName, attribs, parent, children) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attribs = attribs || {};
    this.parent = parent || null;
    this.children = children || [];
  }
  get childNodes() { return this.children; }
  getAttribute(name) { return name in this.attribs ? this.attribs[name] : null; }
  hasAttribute(name) { return name in this.attribs; }
  setAttribute(name, value) { this.attribs[name] = String(value); }
  removeAttribute(name) { delete this.attribs[name]; }
  matches(selector) { return matchSelector(this, selector); }
  querySelector(selector) {
    return this.children.find(child => child.nodeType === 1 && child.matches(selector)) || null;
  }
  appendChild(child) {
    child.parent = this;
    this.children.push(child);
  }
  after(node) {
    if (!this.parent) throw new Error("after() needs a parent");
    const index = this.parent.children.indexOf(this);
    this.parent.children.splice(index + 1, 0, node);
    node.parent = this.parent;
  }
  remove() {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }
  set textContent(value) {
    this.children = [new TextNode(String(value), this)];
  }
  get textContent() {
    return this.children.map(c => (c.nodeType === 3 ? c.text : c.textContent)).join("");
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
  const attrs = Object.entries(node.attribs).map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("");
  const tag = node.tagName.toLowerCase();
  if (VOID_TAGS.has(tag)) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${node.children.map(serializeNode).join("")}</${tag}>`;
}

function allDescendants(roots) {
  const out = [];
  const walk = (node) => {
    for (const child of node.children) {
      if (child.nodeType === 1) out.push(child);
      walk(child);
    }
  };
  // Top-level layers ARE descendants of body — include the roots.
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
    // Real DOM elements always have a parent (body): model it so top-level
    // after()/remove() behave like the browser.
    const bodyEl = new NodeEl("body", {}, null);
    bodyEl.children = (bodyNode?.children || []).map(node => fromCheerio(node, bodyEl)).filter(Boolean);
    const body = {
      querySelectorAll: selector => allDescendants(bodyEl.children).filter(el => el.matches(selector)),
      get innerHTML() { return bodyEl.children.map(serializeNode).join(""); },
    };
    return { body, createElement: tag => new NodeEl(tag, {}, null, []) };
  }
};

const { splitChars, extractLayerCssBlocks, layerIsSeparable, separateTextLayer, restoreSeparatedText, measureLetterBoxes } =
  await import("../src/lib/textSeparation.ts");

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const src = (p) => readFileSync(join(ROOT, p), "utf8");

const seq = (() => { let n = 0; return () => `el_test_${++n}`; })();

const TEXT_HTML = '<div data-layer-id="T1" data-layer-name="Text" data-layer-kind="text" style="font-size:24px;color:#333;position:absolute;left:40px;top:60px;width:200px;">Hola</div>';
/** Measured boxes for "Hola" at a 24px font (dx ascending, single line). */
const HOLA_BOXES = [
  { char: "H", dx: 0, dy: 0, w: 16, h: 24 },
  { char: "o", dx: 16, dy: 0, w: 13, h: 24 },
  { char: "l", dx: 29, dy: 0, w: 7, h: 24 },
  { char: "a", dx: 36, dy: 0, w: 13, h: 24 },
];

test("P25-1 splitChars keeps surrogate pairs whole", () => {
  assert.deepEqual(splitChars("ho🎵"), ["h", "o", "🎵"]);
  assert.equal(splitChars("abc").length, 3);
});

test("P25-2 extractLayerCssBlocks picks only the layer's own rules", () => {
  const css = '[data-layer-id="T1"] {\n  font-size: 24px;\n}\n[data-layer-id="OTHER"] {\n  color: red;\n}\n[data-layer-id="T1"] {\n  letter-spacing: 1px;\n}';
  const blocks = extractLayerCssBlocks(css, "T1");
  assert.ok(blocks.includes("font-size: 24px"));
  assert.ok(blocks.includes("letter-spacing: 1px"));
  assert.ok(!blocks.includes("OTHER"));
});

test("P25-3 layerIsSeparable contract: simple positioned text only", () => {
  assert.equal(layerIsSeparable(TEXT_HTML, "T1"), true);
  // Non-text kind.
  assert.equal(layerIsSeparable('<img data-layer-id="I1" data-layer-kind="image" src="x.png" style="position:absolute;left:1px;top:1px;">', "I1"), false);
  // Has element children (rich text).
  assert.equal(layerIsSeparable('<div data-layer-id="R1" data-layer-kind="text" style="position:absolute;left:1px;top:1px;"><b>a</b></div>', "R1"), false);
  // No inline position.
  assert.equal(layerIsSeparable('<div data-layer-id="F1" data-layer-kind="text" style="color:red;">x</div>', "F1"), false);
  // Missing layer.
  assert.equal(layerIsSeparable(TEXT_HTML, "NOPE"), false);
});

test("P25-4 separateTextLayer: one layer per visible char, original hidden+tagged", () => {
  const res = separateTextLayer(TEXT_HTML, "T1", HOLA_BOXES, seq);
  assert.ok(res);
  assert.equal(res.letterIds.length, 4);
  const doc = res.html;
  // Original: hidden, tagged, content untouched.
  assert.match(doc, /data-layer-id="T1"[^>]*data-text-sep="1"/);
  assert.match(doc, /data-layer-id="T1"[^>]*style="[^"]*visibility:hidden/);
  assert.match(doc, /data-layer-id="T1"[^>]*>Hola</);
  // Letters: tagged, kind text, positioned base+dx, box constraints dropped.
  const letters = [...doc.matchAll(/<div data-layer-id="(el_test_\d+)"([^>]*)>([^<]*)<\/div>/g)]
    .filter(m => m[0].includes("data-sep-of"));
  assert.equal(letters.length, 4);
  assert.equal(letters[0][2].includes('data-layer-name="letra: H"'), true);
  assert.equal(letters[0][2].includes("data-layer-kind=\"text\""), true);
  assert.ok(letters[0][2].includes("left:40px"));
  assert.ok(letters[1][2].includes("left:56px")); // 40 + 16
  assert.ok(letters[3][2].includes("left:76px")); // 40 + 36
  assert.ok(!/width:200px/.test(letters[0][2])); // box constraints dropped
  assert.ok(letters[0][2].includes("font-size:24px")); // styling inherited
  assert.equal(letters[2][3], "l");
});

test("P25-5 re-separation replaces the previous letters first", () => {
  const first = separateTextLayer(TEXT_HTML, "T1", HOLA_BOXES, seq);
  const edited = first.html.replace(">Hola<", ">Adiós<"); // user re-edited the original
  const boxes2 = HOLA_BOXES.slice(0, 5).concat([{ char: "s", dx: 49, dy: 0, w: 12, h: 24 }]);
  const second = separateTextLayer(edited, "T1", boxes2, seq);
  assert.ok(second);
  assert.equal(second.letterIds.length, 5);
  assert.equal((second.html.match(/data-sep-of="T1"/g) || []).length, 5);
  // The old batch is gone: none of the first separation's ids survive.
  for (const oldId of first.letterIds) {
    assert.ok(!second.html.includes(oldId), `stale letter ${oldId} survived`);
  }
  assert.ok(second.html.includes(">s<"));
});

test("P25-6 restore: letters gone, original visible and untagged", () => {
  const separated = separateTextLayer(TEXT_HTML, "T1", HOLA_BOXES, seq);
  const restored = restoreSeparatedText(separated.html, "T1");
  assert.ok(restored);
  assert.ok(!restored.includes("data-sep-of"));
  assert.ok(!restored.includes("data-text-sep"));
  assert.ok(!restored.includes("visibility:hidden"));
  assert.match(restored, /data-layer-id="T1"[^>]*>Hola</);
  // Restore on a never-separated layer is a safe no-op on the original.
  const untouched = restoreSeparatedText(TEXT_HTML, "T1");
  assert.ok(untouched.includes('data-layer-id="T1"'));
});

test("P25-7 separateTextLayer rejects unpositioned or missing layers", () => {
  assert.equal(separateTextLayer('<div data-layer-id="F1" data-layer-kind="text" style="color:red;">x</div>', "F1", HOLA_BOXES, seq), null);
  assert.equal(separateTextLayer(TEXT_HTML, "NOPE", HOLA_BOXES, seq), null);
});

test("P25-8 measureLetterBoxes refuses to run without a real document", () => {
  // Node here has no `document`: the lib must guard instead of crash.
  assert.equal(measureLetterBoxes(TEXT_HTML, ""), null);
});

test("P25-9 source: editor handler + limits toast + panel menu items", () => {
  const ed = src("src/pages/EditorV2.tsx");
  assert.match(ed, /const handleSeparateText = useCallback\(\(frameId: string, layerId: string, mode: "separate" \| "restore"\)/);
  assert.match(ed, /measureLetterBoxes\(source\.layerHtml, extractLayerCssBlocks\(frame\.css, layerId\)\)/);
  assert.match(ed, /separateTextLayer\(frame\.html, layerId, boxes, createLayerId\)/);
  assert.match(ed, /restáuralas y vuelve a separar/); // explicit limit, verbatim
  assert.match(ed, /onSeparateText=\{handleSeparateText\}/);
  const panel = src("src/components/HtmlLayersPanel.tsx");
  assert.match(panel, /Separar en letras/);
  assert.match(panel, /Unir letras \(restaurar texto\)/);
  assert.match(panel, /onSeparateText\?\.\(actionMenu\.frameId, actionMenu\.layerId, isSepSource \? "restore" : "separate"\)/);
});
