import assert from "node:assert/strict";
import test from "node:test";
import { enforceGroupsDoNotPaint, paintsABox } from "../api/src/services/groupPaint.ts";

test("recognises the ways a box gets painted", () => {
  assert.equal(paintsABox("background-color: #fff"), true);
  assert.equal(paintsABox("background: linear-gradient(red, blue)"), true);
  assert.equal(paintsABox("box-shadow: 0 2px 8px rgba(0,0,0,.2)"), true, "a shadow may start at zero offset");
  assert.equal(paintsABox("border-width: 2px"), true);
  assert.equal(paintsABox("backdrop-filter: blur(4px)"), true);
});

test("does not mistake a blank value for paint", () => {
  for (const style of ["background-color: transparent", "background: none", "border-width: 0", "border: 0px", ""]) {
    assert.equal(paintsABox(style), false, `${JSON.stringify(style)} paints nothing`);
  }
});

test("a property is not found inside a longer one", () => {
  assert.equal(paintsABox("background-clip: text"), false);
  assert.equal(paintsABox("color: red; font-size: 12px"), false);
});

test("!important does not hide a blank value", () => {
  assert.equal(paintsABox("background-color: transparent !important"), false);
  assert.equal(paintsABox("background-color: #fff !important"), true);
});

// ── The invariant ──

test("a group that paints through the stylesheet becomes a container", () => {
  // The bug in one case: an agent marks a wrapper a group and paints it, then
  // ungrouping dissolves the scaffolding and the backdrop goes with it.
  const html = `<div data-layer-id="g1" data-layer-kind="group"><p data-layer-id="t">Hi</p></div>`;
  const css = `[data-layer-id="g1"] { background-color: #101010; padding: 24px; }`;

  const result = enforceGroupsDoNotPaint(html, css);
  assert.match(result.html, /data-layer-kind="container"/);
  assert.doesNotMatch(result.html, /data-layer-kind="group"/);
  assert.deepEqual(result.retagged, ["g1"]);
});

test("a group that paints inline becomes a container too", () => {
  const html = `<div data-layer-id="g1" data-layer-kind="group" style="background:#222"></div>`;
  const result = enforceGroupsDoNotPaint(html, "");
  assert.match(result.html, /data-layer-kind="container"/);
});

test("the paint itself is never touched — only the mark that lied about it", () => {
  const html = `<div data-layer-id="g1" data-layer-kind="group" style="background:#222;border-radius:8px"></div>`;
  const css = `[data-layer-id="g1"] { background-color: #101010; }`;
  const result = enforceGroupsDoNotPaint(html, css);
  assert.match(result.html, /background:#222/, "the inline paint survives");
  assert.match(result.html, /border-radius:8px/);
  // The stylesheet is not rewritten at all; the caller keeps it as it was.
  assert.equal(css.includes("#101010"), true);
});

test("a group that paints nothing stays a group", () => {
  const html = `<div data-layer-id="g1" data-layer-kind="group"><p data-layer-id="t">Hi</p></div>`;
  const css = `[data-layer-id="g1"] { position: absolute; left: 10px; }`;
  const result = enforceGroupsDoNotPaint(html, css);
  assert.match(result.html, /data-layer-kind="group"/);
  assert.deepEqual(result.retagged, []);
});

test("a transparent group is still scaffolding", () => {
  const html = `<div data-layer-id="g1" data-layer-kind="group"></div>`;
  const css = `[data-layer-id="g1"] { background-color: transparent; border: 0; }`;
  assert.deepEqual(enforceGroupsDoNotPaint(html, css).retagged, []);
});

test("only the painting group is re-tagged, not its neighbours", () => {
  const html = [
    `<div data-layer-id="clean" data-layer-kind="group"><p data-layer-id="a">A</p></div>`,
    `<div data-layer-id="painted" data-layer-kind="group"><p data-layer-id="b">B</p></div>`,
  ].join("");
  const css = `[data-layer-id="painted"] { background-color: #fff; }`;

  const result = enforceGroupsDoNotPaint(html, css);
  assert.deepEqual(result.retagged, ["painted"]);
  assert.match(result.html, /data-layer-id="clean" data-layer-kind="group"/);
  assert.match(result.html, /data-layer-id="painted" data-layer-kind="container"/);
});

test("a painting group nested inside a clean one is caught", () => {
  const html = `<div data-layer-id="outer" data-layer-kind="group">`
    + `<div data-layer-id="inner" data-layer-kind="group"></div></div>`;
  const css = `[data-layer-id="inner"] { box-shadow: 0 2px 8px rgba(0,0,0,.3); }`;
  const result = enforceGroupsDoNotPaint(html, css);
  assert.deepEqual(result.retagged, ["inner"]);
  assert.match(result.html, /data-layer-id="outer" data-layer-kind="group"/);
});

test("a layer painted by a second rule elsewhere is still caught", () => {
  const html = `<div data-layer-id="g1" data-layer-kind="group"></div>`;
  const css = `[data-layer-id="g1"] { position: absolute; }\n`
    + `[data-layer-id="g1"] { background-color: #abcdef; }`;
  assert.deepEqual(enforceGroupsDoNotPaint(html, css).retagged, ["g1"]);
});

test("only the layer's own rule counts, not a similarly named one", () => {
  const html = `<div data-layer-id="g1" data-layer-kind="group"></div>`;
  const css = `[data-layer-id="g10"] { background-color: #fff; }`;
  assert.deepEqual(enforceGroupsDoNotPaint(html, css).retagged, []);
});

test("markup with no groups is returned untouched and cheaply", () => {
  const html = `<div data-layer-id="a" data-layer-kind="shape"></div>`;
  const result = enforceGroupsDoNotPaint(html, `[data-layer-id="a"] { background: red; }`);
  assert.equal(result.html, html);
  assert.deepEqual(result.retagged, []);
});

test("empty input does not throw", () => {
  assert.deepEqual(enforceGroupsDoNotPaint("", ""), { html: "", retagged: [] });
  assert.deepEqual(enforceGroupsDoNotPaint(undefined, undefined), { html: "", retagged: [] });
});

test("attributes carrying angle brackets do not derail the scan", () => {
  const html = `<div data-layer-id="g1" data-layer-kind="group" title="a > b"></div>`;
  const css = `[data-layer-id="g1"] { background: #fff; }`;
  const result = enforceGroupsDoNotPaint(html, css);
  assert.deepEqual(result.retagged, ["g1"]);
  assert.match(result.html, /title="a > b"/);
});

// The invariant also has to hold through the real save path — that is the whole
// reason it lives at the persistence boundary rather than in each of the
// eighty-odd tools that write a template. That leg cannot run here: importing
// templates.ts pulls in `./store.js`, and resolving that to a .ts file is a
// bundler feature node does not have. It is checked against the running API in
// debug/group-paint-live.mjs instead.
