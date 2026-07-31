/**
 * matchesCompoundSelector — the SVG vector exporter's CSS selector resolver.
 *
 * The original matcher only understood bare tag / .class / #id. This app
 * styles every layer via its own `[data-layer-id="…"]` rule — the ONE
 * selector shape actually used throughout the codebase — so that matcher
 * silently failed on every real design: size, color, and `filter` (the
 * grayscale photo treatment used on every design in this project) never
 * resolved, and an `<img>` with no resolved width/height was skipped by the
 * exporter entirely, which is what "SVG export drops the photo" actually was.
 *
 * Run: node --test QA/css-selector-match.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const modPath = "file://" + resolve(__dirname, "..", "src", "lib", "cssSelectorMatch.ts");

const { matchesCompoundSelector } = await import(modPath);

/** A DOM-free stand-in for the three element facts a match can depend on. */
function el({ tag = "div", id = "", classes = [], attrs = {} } = {}) {
  return {
    tagName: tag.toUpperCase(),
    id,
    classList: { contains: (c) => classes.includes(c) },
    hasAttribute: (name) => Object.prototype.hasOwnProperty.call(attrs, name),
    getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null),
  };
}

describe("matchesCompoundSelector", () => {
  it("matches an attribute selector — the app's actual per-layer convention", () => {
    const img = el({ tag: "img", attrs: { "data-layer-id": "photo1" } });
    assert.equal(matchesCompoundSelector(img, '[data-layer-id="photo1"]'), true);
  });

  it("rejects an attribute selector with the wrong value", () => {
    const img = el({ tag: "img", attrs: { "data-layer-id": "photo1" } });
    assert.equal(matchesCompoundSelector(img, '[data-layer-id="other"]'), false);
  });

  it("matches tag + attribute combined (img[data-layer-id=...])", () => {
    const img = el({ tag: "img", attrs: { "data-layer-id": "photo1" } });
    assert.equal(matchesCompoundSelector(img, 'img[data-layer-id="photo1"]'), true);
    assert.equal(matchesCompoundSelector(img, 'div[data-layer-id="photo1"]'), false);
  });

  it("matches presence-only attribute selectors ([attr] with no value)", () => {
    const img = el({ tag: "img", attrs: { "data-layer-id": "x" } });
    assert.equal(matchesCompoundSelector(img, "[data-layer-id]"), true);
    assert.equal(matchesCompoundSelector(img, "[data-missing]"), false);
  });

  it("still matches bare tag, .class and #id selectors", () => {
    const node = el({ tag: "div", id: "topnav", classes: ["card", "active"] });
    assert.equal(matchesCompoundSelector(node, "div"), true);
    assert.equal(matchesCompoundSelector(node, "#topnav"), true);
    assert.equal(matchesCompoundSelector(node, ".card"), true);
    assert.equal(matchesCompoundSelector(node, ".missing"), false);
  });

  it("matches a compound of tag + multiple classes + id together", () => {
    const node = el({ tag: "div", id: "topnav", classes: ["card", "active"] });
    assert.equal(matchesCompoundSelector(node, "div.card.active#topnav"), true);
    assert.equal(matchesCompoundSelector(node, "div.card.inactive#topnav"), false);
  });

  it("rejects descendant and combinator selectors rather than mismatching them", () => {
    const node = el({ tag: "div" });
    assert.equal(matchesCompoundSelector(node, "body div"), false);
    assert.equal(matchesCompoundSelector(node, ".card > img"), false);
    assert.equal(matchesCompoundSelector(node, ".card + img"), false);
    assert.equal(matchesCompoundSelector(node, ".card ~ img"), false);
  });

  it("rejects an empty or unparseable selector", () => {
    const node = el({ tag: "div" });
    assert.equal(matchesCompoundSelector(node, ""), false);
    assert.equal(matchesCompoundSelector(node, "   "), false);
  });

  it("supports single- and double-quoted attribute values", () => {
    const node = el({ tag: "div", attrs: { "data-x": "y" } });
    assert.equal(matchesCompoundSelector(node, '[data-x="y"]'), true);
    assert.equal(matchesCompoundSelector(node, "[data-x='y']"), true);
  });
});
