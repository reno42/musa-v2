/**
 * FASE 2 (F3) — remove-background QA selftest
 *
 * Covers the Node-testable surface of the remove-background pipeline:
 *  1. The htmlMutations attribute helpers (setLayerAttributes /
 *     getLayerAttribute / removeLayerAttribute) — the non-destructive
 *     src→cutout swap + "Restaurar" contract, executed as REAL production
 *     code (not a copy).
 *  2. Static wiring guards so a future edit cannot silently drop the MCP
 *     tools, the tenant gate, the REST endpoints or the UI buttons.
 *
 * Node has no DOMParser and the browser-side TS modules use extensionless
 * imports, so this file installs a minimal cheerio-backed DOMParser shim
 * (covering exactly the DOM surface parseFragment/findLayer/serializeFragment
 * use) and a resolver hook that maps the two extensionless specifiers of
 * htmlMutations.ts to their .ts files.
 *
 * Run: node --experimental-strip-types --test QA/segmentation-flow.test.mjs
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { load } from "cheerio";
import { registerHooks } from "node:module";

// ── Browser-DOM shim (parse + query + attributes + serialize) ──
// Only the DOM surface the attribute helpers touch is implemented; anything
// else throws so a helper that starts needing more DOM fails loudly here
// instead of passing on a fake.
globalThis.DOMParser = class {
  parseFromString(html) {
    const $ = load(html);
    return {
      body: {
        querySelectorAll: selector => [...$(selector)].map(node => ({
          getAttribute: name => (node.attribs && name in node.attribs ? node.attribs[name] : null),
          setAttribute: (name, value) => { node.attribs = node.attribs || {}; node.attribs[name] = String(value); },
          removeAttribute: name => { if (node.attribs) delete node.attribs[name]; },
        })),
        get innerHTML() { return $("body").html() || ""; },
      },
      createElement() { throw new Error("createElement is not used by the attribute helpers"); },
    };
  }
};

// htmlMutations.ts imports "./cssMutations", "./layerKind" and "./gradient"
// without an extension (fine for the browser toolchains, not for Node ESM).
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "./cssMutations" || specifier === "./layerKind" || specifier === "./gradient") {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});

const htmlMutationsP = import("../src/lib/htmlMutations.ts");

/** Canonical body-HTML form — serialization differences (self-closing <img/>, attribute order) are noise. */
const canon = html => load(html)("body").html() || "";

// ── 1. Attribute helpers (real production code under the shim) ──

const FRAME = `<div><img data-layer-id="img1" src="https://cdn.x/a.png" width="100"><img data-layer-id="img2" src="https://cdn.x/b.png"></div>`;

test("F3: setLayerAttributes swaps src and remembers the original in data-orig-src", async () => {
  const { setLayerAttributes } = await htmlMutationsP;
  const out = setLayerAttributes(FRAME, "img1", { src: "https://cdn.x/cutout.png", "data-orig-src": "https://cdn.x/a.png" });
  assert.ok(out, "swap must produce html");
  const $ = load(out);
  const img1 = $('img[data-layer-id="img1"]');
  assert.equal(img1.attr("src"), "https://cdn.x/cutout.png");
  assert.equal(img1.attr("data-orig-src"), "https://cdn.x/a.png");
  // The second layer is untouched.
  assert.equal($('img[data-layer-id="img2"]').attr("src"), "https://cdn.x/b.png");
  assert.equal($('img[data-layer-id="img2"]').attr("data-orig-src"), undefined);
});

test("F3: getLayerAttribute reads the stored original", async () => {
  const { getLayerAttribute, setLayerAttributes } = await htmlMutationsP;
  const swapped = setLayerAttributes(FRAME, "img1", { src: "https://cdn.x/cutout.png", "data-orig-src": "https://cdn.x/a.png" });
  assert.equal(getLayerAttribute(swapped, "img1", "data-orig-src"), "https://cdn.x/a.png");
  assert.equal(getLayerAttribute(swapped, "img1", "src"), "https://cdn.x/cutout.png");
});

test("F3: removeLayerAttribute clears the marker", async () => {
  const { removeLayerAttribute, setLayerAttributes } = await htmlMutationsP;
  const swapped = setLayerAttributes(FRAME, "img1", { src: "https://cdn.x/cutout.png", "data-orig-src": "https://cdn.x/a.png" });
  const cleared = removeLayerAttribute(swapped, "img1", "data-orig-src");
  assert.ok(cleared, "removal must produce html");
  const $ = load(cleared);
  assert.equal($('img[data-layer-id="img1"]').attr("data-orig-src"), undefined);
  assert.equal($('img[data-layer-id="img1"]').attr("src"), "https://cdn.x/cutout.png");
});

test("F3: swap → restore round-trip returns the frame HTML to its original form", async () => {
  const { getLayerAttribute, removeLayerAttribute, setLayerAttributes } = await htmlMutationsP;
  // Swap (what the panel does after the job is done)
  const swapped = setLayerAttributes(FRAME, "img1", { src: "https://cdn.x/cutout.png", "data-orig-src": "https://cdn.x/a.png" });
  // Restore (what the Restaurar button does)
  const orig = getLayerAttribute(swapped, "img1", "data-orig-src");
  assert.equal(orig, "https://cdn.x/a.png");
  const restored = removeLayerAttribute(setLayerAttributes(swapped, "img1", { src: orig }), "img1", "data-orig-src");
  assert.equal(canon(restored), canon(FRAME));
});

test("F3: attribute helpers return null for an unknown layer (no silent mutation)", async () => {
  const { getLayerAttribute, removeLayerAttribute, setLayerAttributes } = await htmlMutationsP;
  assert.equal(setLayerAttributes(FRAME, "ghost", { src: "x" }), null);
  assert.equal(getLayerAttribute(FRAME, "ghost", "src"), null);
  assert.equal(removeLayerAttribute(FRAME, "ghost", "src"), null);
});

// ── 2. Static wiring guards ──

const readRepo = rel => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("F3 MCP: catalog exposes remove_background and segment_status, with dispatch+poll cases", () => {
  const src = readRepo("worker/runtime/functions/mcp.mjs");
  assert.match(src, /name: "remove_background"/);
  assert.match(src, /name: "segment_status"/);
  assert.match(src, /case "remove_background"/);
  assert.match(src, /case "segment_status"/);
  // The ~8s in-band poll with a segment_status fallback for cold starts.
  assert.match(src, /Date\.now\(\) \+ 8000/);
  assert.match(src, /segment_status\(jobId\)/);
});

test("F3 MCP: remove_background re-validates an asset-derived workspace; segment_status gates non-admin pollers", () => {
  const src = readRepo("worker/runtime/functions/mcp.mjs");
  // assetId-only calls derive the workspace from the asset row.
  assert.match(src, /derivedWs && !\(await canAccessWorkspace\(auth, derivedWs, "editor"\)\)/);
  // Job ids are guessable; a non-admin poller must hold access to the job's workspace.
  assert.match(src, /job\.workspace_id && !auth\?\.isAdmin && !\(await canAccessWorkspace\(auth, job\.workspace_id, "viewer"\)\)/);
});

test("F3 REST: routes expose POST remove-background and GET jobs/:id with idempotent cutout lookup", () => {
  const route = readRepo("api/src/routes/segmentation.ts");
  assert.match(route, /\.post\("\/remove-background"/);
  assert.match(route, /\.get\("\/jobs\/:id"/);
  assert.match(route, /findExistingCutout/);
  const service = readRepo("api/src/services/segmentation.ts");
  // Idempotency key: assets tagged ["cutout", "src:<id>"] + companion mask row.
  assert.match(service, /contains\("tags", \["cutout", `src:\$\{srcAssetId\}`\]\)/);
  assert.match(service, /contains\("tags", \["mask", `src:\$\{srcAssetId\}`\]\)/);
});

test("F3 UI: panel offers Quitar fondo + Restaurar driven by data-orig-src", () => {
  const panel = readRepo("src/components/HtmlContextualPanel.tsx");
  assert.match(panel, /Quitar fondo/);
  assert.match(panel, /Restaurar/);
  assert.match(panel, /data-orig-src/);
  assert.match(panel, /\/api\/segment\/remove-background/);
  assert.match(panel, /\/api\/segment\/jobs\//);
});

test("F3 UI: EditorV2 wires the src-swap and restore handlers through the panel", () => {
  const editor = readRepo("src/pages/EditorV2.tsx");
  assert.match(editor, /onImageSrcChange=\{handleImageSrcChange\}/);
  assert.match(editor, /onImageRestore=\{handleImageRestore\}/);
  assert.match(editor, /setLayerAttributes\(frame\.html, layerId, attrs\)/);
  assert.match(editor, /getLayerAttribute\(frame\.html, layerId, "data-orig-src"\)/);
});
