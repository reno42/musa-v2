/**
 * When a wrapper is a group, and when it is a thing.
 *
 * Two failures cost real time in this editor. Calling every wrapper a "group"
 * meant ungrouping your way down to anything you wanted to touch. And
 * ungrouping a wrapper that was really a painted card dropped its background,
 * because the paint lived on the wrapper and the wrapper was treated as
 * scaffolding.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { classifyLayer, paintsABox, isTextBlock } from "../src/lib/layerKind.ts";

const text = (tag = "span") => ({ tag, hasChildren: false });
const box = (tag = "div") => ({ tag, hasChildren: true });

// ── Paint detection ──

test("a background makes a box painted", () => {
  assert.equal(paintsABox("background: #fff"), true);
  assert.equal(paintsABox("background-color: rgb(10,20,30)"), true);
  assert.equal(paintsABox("background-image: url(a.png)"), true);
});

test("borders and shadows count as paint too", () => {
  assert.equal(paintsABox("border: 1px solid #000"), true);
  assert.equal(paintsABox("box-shadow: 0 2px 8px rgba(0,0,0,.3)"), true);
});

test("the absence of paint is not paint", () => {
  assert.equal(paintsABox(""), false);
  assert.equal(paintsABox(null), false);
  assert.equal(paintsABox("background: none"), false);
  assert.equal(paintsABox("background-color: transparent"), false);
  assert.equal(paintsABox("box-shadow: none"), false);
  assert.equal(paintsABox("border: 0 solid #000"), false);
});

test("a property that merely starts with a paint name is not paint", () => {
  // background-clip is not a background.
  assert.equal(paintsABox("background-clip: text"), false);
  assert.equal(paintsABox("display: flex; color: red"), false);
});

// ── Text blocks ──

test("a heading over a subheading is one text block", () => {
  assert.equal(isTextBlock([text("h1"), text("p")]), true);
});

test("a wrapper holding a box is not a text block", () => {
  assert.equal(isTextBlock([text("h1"), box("div")]), false);
});

test("a text run with its own children is not a plain run", () => {
  assert.equal(isTextBlock([{ tag: "p", hasChildren: true }]), false);
});

test("nothing inside is not a text block", () => {
  assert.equal(isTextBlock([]), false);
});

// ── Classification ──

test("a painted wrapper is a container, never a group", () => {
  // This is the rule that stops an ungroup from throwing the card's
  // background away: paint means somebody drew that box on purpose.
  assert.equal(classifyLayer({ tag: "div", styleAttr: "background:#111;border-radius:8px", children: [text("h1")] }), "container");
});

test("a wrapper of only text runs is a text block, not a group", () => {
  assert.equal(classifyLayer({ tag: "div", children: [text("h1"), text("p")] }), "container");
});

test("an unpainted wrapper of unrelated elements is a real group", () => {
  // The only case where flattening loses nothing.
  assert.equal(classifyLayer({ tag: "div", children: [box("div"), { tag: "img", hasChildren: false }] }), "group");
});

test("leaves keep their own identity", () => {
  assert.equal(classifyLayer({ tag: "p", children: [] }), "text");
  assert.equal(classifyLayer({ tag: "div", children: [] }), "container");
  assert.equal(classifyLayer({ tag: "img", children: [] }), "image");
  assert.equal(classifyLayer({ tag: "svg", children: [] }), "shape");
});

test("an image is an image even with children", () => {
  // <picture> holds <source> elements and is still one image.
  assert.equal(classifyLayer({ tag: "picture", children: [{ tag: "source", hasChildren: false }] }), "image");
});

test("a painted text tag is a container, so its fill survives", () => {
  assert.equal(classifyLayer({ tag: "p", styleAttr: "background:#eee", children: [text("span")] }), "container");
});
