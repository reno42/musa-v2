import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
import { replaceImportFonts } from "../shared/designImport.ts";

const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../api/src/services/designImports.ts", import.meta.url))], bundle: true, platform: "node", format: "cjs", write: false, logLevel: "silent" });
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require, Buffer, URL, AbortSignal, fetch, setTimeout, clearTimeout, console, process: { cwd: () => repo, env: {} } });

const box = (x, y, width, height) => ({ x, y, width, height });
const text = (id, bounds) => ({ id, name: id, type: "TEXT", characters: `Content ${id}`, absoluteBoundingBox: bounds });
const frame = (id, bounds, children = []) => ({ id, name: id, type: "FRAME", absoluteBoundingBox: bounds, children });
const first = { ...frame("1:1", box(-600, 300, 320, 180), [text("1:2", box(-588, 322, 100, 30))]), fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] };
const second = frame("2:1", box(1600, -800, 1440, 900), [text("2:2", box(1630, -760, 180, 40))]);
const frameExports = {
  "1:1": '<svg width="320" height="180"><rect width="320" height="180" fill="#000000" rx="16"/><text x="12" y="22" fill="#ffffff">Content 1:2</text></svg>',
  "2:1": '<svg width="1440" height="900"><defs><linearGradient id="gradient"><stop stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs><rect width="1440" height="900" fill="url(#gradient)"/><text x="30" y="40">Content 2:2</text></svg>',
  "5:1": '<svg width="200" height="100"><text x="10" y="10">Content 5:2</text></svg>',
};

async function imported(children, nodeId = "0-1") {
  const document = { id: "0:0", type: "DOCUMENT", children: [{ id: "0:1", type: "CANVAS", name: "Page", children }] };
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes("/files/")) return Response.json({ name: "Fixture", document });
    if (String(url).includes("/images/")) {
      const ids = new URL(url).searchParams.get("ids").split(",");
      return Response.json({ images: Object.fromEntries(ids.map(id => [id, `https://fixture.invalid/${id}.svg`])) });
    }
    assert.equal(new URL(url).hostname, "fixture.invalid");
    const id = new URL(url).pathname.slice(1, -4);
    return new Response(frameExports[id] || '<svg width="10" height="10"><rect width="10" height="10"/></svg>', { headers: { "content-type": "image/svg+xml" } });
  };
  const result = await module.exports.importFigmaUrl(`https://www.figma.com/design/fixture/Test${nodeId ? `?node-id=${nodeId}` : ""}`, "fixture-token", fakeFetch);
  return { result: JSON.parse(JSON.stringify(result)), calls };
}

test("a page link preserves separate frames, editable children, backgrounds and dimensions", async () => {
  const { result, calls } = await imported([first, second]);
  assert.deepEqual(result.artboards.map(a => [a.name, a.width, a.height]), [["1:1", 320, 180], ["2:1", 1440, 900]]);
  assert.deepEqual([result.artboards[0].layers[1].x, result.artboards[0].layers[1].y, result.artboards[0].layers[1].width, result.artboards[0].layers[1].height], [12, 22, 100, 30]);
  assert.deepEqual([result.artboards[1].layers[0].x, result.artboards[1].layers[0].y, result.artboards[1].layers[0].width, result.artboards[1].layers[0].height], [30, 40, 180, 40]);
  assert.match(result.artboards[0].layers[1].html, /Content 1:2/);
  assert.match(result.artboards[1].layers[0].html, /Content 2:2/);
  assert.equal(result.artboards[0].layers[0].name, "1:1 background");
  assert.equal(result.artboards[0].layers[1].kind, "text");
  assert.equal(result.artboards[1].layers[0].kind, "text");
  assert.equal(result.artboards[0].background, "rgba(0,0,0,1)");
  assert.ok(!calls.some(url => url.includes("/images/")), "native nodes do not need a full-frame SVG export");
});

test("Figma scan lists selectable top-level frames and batches their previews", async () => {
  const document = { id: "0:0", type: "DOCUMENT", children: [{ id: "0:1", type: "CANVAS", children: [first, second] }] };
  const calls = [];
  const result = await module.exports.scanFigmaUrl("https://www.figma.com/design/fixture/Test", "token", async url => {
    calls.push(String(url));
    if (String(url).includes("/files/")) return Response.json({ name: "Scanned", document });
    const ids = new URL(url).searchParams.get("ids").split(",");
    return Response.json({ images: Object.fromEntries(ids.map(id => [id, `https://preview.invalid/${id}.png`])) });
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.frames.map(frame => [frame.id, frame.width, frame.height]))), [["1:1", 320, 180], ["2:1", 1440, 900]]);
  assert.equal(result.frames[0].thumbnailUrl, "https://preview.invalid/1:1.png");
  assert.equal(calls.filter(url => url.includes("/images/")).length, 1);
});

test("nested sections and whole-file imports expose frames in source order", async () => {
  const section = { id: "3:1", type: "SECTION", children: [first, { id: "3:2", type: "SECTION", children: [second] }] };
  for (const selection of ["3-1", "0-0", ""]) {
    const { result } = await imported([section], selection);
    assert.deepEqual(result.artboards.map(a => a.name), ["1:1", "2:1"]);
  }
});

test("a real selected frame retains its nested frame as a visual layer", async () => {
  const outer = frame("4:1", box(100, 100, 2000, 1200), [first, text("4:2", box(120, 130, 80, 20))]);
  const { result, calls } = await imported([outer], "4-1");
  assert.equal(result.artboards.length, 1);
  assert.equal(result.artboards[0].width, 2000);
  assert.equal(result.artboards[0].layers.length, 2);
  assert.equal(result.artboards[0].layers[0].kind, "group");
  assert.equal(result.artboards[0].layers[0].children[0].name, "1:1 background");
  assert.equal(result.artboards[0].layers[0].children[1].kind, "text");
  assert.equal(result.artboards[0].layers[1].kind, "text");
  assert.match(result.artboards[0].layers[1].html, /Content 4:2/);
  assert.ok(!calls.some(url => url.includes("/images/")));
});

test("loose text, groups and empty frames survive a mixed page", async () => {
  const group = { ...frame("5:1", box(0, 0, 200, 100), [text("5:2", box(10, 10, 20, 20))]), type: "GROUP" };
  const empty = frame("6:1", box(0, 0, 400, 200));
  const loose = text("7:1", box(-100, -100, 80, 20));
  const { result } = await imported([first, group, empty, loose]);
  assert.equal(result.artboards.length, 4);
  assert.match(result.artboards[1].layers[0].children[0].html, /Content 5:2/);
  assert.equal(result.artboards[2].width, 400);
  assert.equal(result.artboards[2].layers[0].kind, "vector");
  assert.match(result.artboards[3].layers[0].html, /Content 7:1/);
  const direct = await imported([loose], "7-1");
  assert.equal(direct.result.artboards[0].width, 80);
  assert.equal(direct.result.artboards[0].layers[0].x, 0);
  const directEmpty = await imported([empty], "6-1");
  assert.equal(directEmpty.result.artboards[0].width, 400);
  assert.ok(directEmpty.result.warnings.some(w => w.code === "figma_empty_frame"));
});

test("hidden structural branches are excluded and unknown selection is rejected", async () => {
  const hidden = { id: "8:1", type: "SECTION", visible: false, children: [second] };
  const { result } = await imported([first, hidden, { ...second, visible: false }]);
  assert.deepEqual(result.artboards.map(a => a.name), ["1:1"]);
  await assert.rejects(imported([first], "99-99"), /node-id no existe/);
});

test("editable import preserves hierarchy, styled text, geometry, gradients, images and minimal mask fallback", async () => {
  const rich = frame("10:1", box(0, 0, 600, 400), [
    { id: "10:2", name: "Card", type: "GROUP", absoluteBoundingBox: box(20, 30, 300, 200), children: [
      { id: "10:3", name: "Gradient", type: "RECTANGLE", size: { x: 100, y: 80 }, absoluteBoundingBox: box(30, 40, 100, 80), cornerRadius: 12, fills: [{ type: "GRADIENT_LINEAR", gradientHandlePositions: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }, { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } }] }] },
      { id: "10:4", name: "Logo path", type: "VECTOR", absoluteBoundingBox: box(150, 40, 60, 40), fillGeometry: [{ path: "M0 0L60 0L30 40Z", windingRule: "NONZERO" }], fills: [{ type: "SOLID", color: { r: 0, g: 1, b: 0 } }] },
      { id: "10:5", name: "Photo", type: "RECTANGLE", absoluteBoundingBox: box(30, 130, 90, 70), fills: [{ type: "IMAGE", imageRef: "photo-ref" }] },
      { id: "10:6", name: "Mixed", type: "TEXT", characters: "AB", absoluteBoundingBox: box(140, 130, 100, 30), style: { fontFamily: "Inter", fontSize: 18 }, characterStyleOverrides: [0, 1], styleOverrideTable: { 1: { fontFamily: "Missing Display", fontSize: 22 } } },
    ] },
    { id: "10:7", name: "Masked logo", type: "GROUP", absoluteBoundingBox: box(350, 30, 100, 100), children: [{ id: "10:8", type: "ELLIPSE", isMask: true, absoluteBoundingBox: box(350, 30, 100, 100) }] },
  ]);
  const document = { id: "0:0", type: "DOCUMENT", children: [{ id: "0:1", type: "CANVAS", children: [rich] }] };
  const calls = [];
  const fakeFetch = async url => {
    calls.push(String(url));
    const value = String(url);
    if (value.includes("/files/fixture/images")) return Response.json({ images: { "photo-ref": "https://fixture.invalid/photo.png" } });
    if (value.includes("/files/")) return Response.json({ name: "Rich", document });
    if (value.includes("/images/")) {
      const ids = new URL(value).searchParams.get("ids").split(",");
      return Response.json({ images: Object.fromEntries(ids.map(id => [id, `https://fixture.invalid/${id}.svg`])) });
    }
    if (value.endsWith("photo.png")) return new Response(Uint8Array.from([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
    return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="50"/></svg>', { headers: { "content-type": "image/svg+xml" } });
  };
  const result = JSON.parse(JSON.stringify(await module.exports.importFigmaUrl("https://www.figma.com/design/fixture/Rich?node-id=10-1", "token", fakeFetch)));
  const group = result.artboards[0].layers[0];
  assert.equal(group.kind, "group");
  assert.deepEqual(group.children.map(layer => layer.name), ["Gradient", "Logo path", "Photo", "Mixed"]);
  assert.deepEqual([group.children[0].x, group.children[0].y], [10, 10]);
  assert.match(group.children[0].html, /linearGradient/);
  assert.match(group.children[0].html, /x1="0" y1="0" x2="100" y2="80"/);
  assert.match(group.children[1].html, /M0 0L60 0L30 40Z/);
  assert.match(group.children[2].html, /data:image\/png;base64/);
  assert.match(group.children[3].html, /contenteditable="true"/);
  assert.deepEqual(group.children[3].fontFamilies, ["Inter", "Missing Display"]);
  assert.deepEqual(result.fonts, { used: ["Inter", "Missing Display"], missing: ["Inter", "Missing Display"] });
  assert.equal(result.artboards[0].layers[1].kind, "group");
  assert.equal(result.artboards[0].layers[1].children[0].children[0].name, "Mask");
  assert.ok(result.warnings.some(warning => warning.code === "figma_mask_group" && warning.layerId === "10:8"));
  assert.ok(calls.some(url => url.includes("/files/fixture/images")));
});

test("font replacement is exact, supports CSS stacks and leaves the pending document untouched", () => {
  const source = { version: "futuraria-import/v1", name: "Fonts", source: "figma", warnings: [], report: { editable: 1, approximate: 0, raster: 0 }, fonts: { used: ["Inter", "Inter Tight"], missing: ["Inter", "Inter Tight"] }, artboards: [{ id: "a", name: "a", width: 10, height: 10, background: "#fff", layers: [{ id: "t", name: "t", kind: "text", x: 0, y: 0, width: 10, height: 10, fidelity: "editable", fontFamilies: ["Inter", "Inter Tight"], html: '<span data-figma-font="Inter" style="font-family:&quot;Inter&quot;">A</span><span data-figma-font="Inter Tight" style="font-family:&quot;Inter Tight&quot;">B</span>' }] }] };
  const replaced = replaceImportFonts(source, { Inter: "Arial, Helvetica, sans-serif", "Inter Tight": "Roboto" });
  assert.match(replaced.artboards[0].layers[0].html, /font-family:Arial, Helvetica, sans-serif/);
  assert.match(replaced.artboards[0].layers[0].html, /font-family:Roboto/);
  assert.doesNotMatch(replaced.artboards[0].layers[0].html, /Inter(?: Tight)?/);
  assert.match(source.artboards[0].layers[0].html, /Inter Tight/);
  assert.throws(() => replaceImportFonts(source, { Inter: "Arial; color:red" }), /no es válida/);
});

test("FILL and FIT image paints remain raster layers and repeated imageRefs download once", async () => {
  const root = frame("30:1", box(0, 0, 300, 200), [
    { id: "30:2", name: "Fill", type: "RECTANGLE", size: { x: 100, y: 80 }, absoluteBoundingBox: box(0, 0, 100, 80), fills: [{ type: "IMAGE", imageRef: "shared-ref", scaleMode: "FILL" }] },
    { id: "30:3", name: "Fit", type: "RECTANGLE", size: { x: 100, y: 80 }, absoluteBoundingBox: box(120, 0, 100, 80), fills: [{ type: "IMAGE", imageRef: "shared-ref", scaleMode: "FIT" }] },
  ]);
  let downloads = 0;
  const fakeFetch = async url => {
    const value = String(url);
    if (value.includes("/files/fixture/images")) return Response.json({ images: { "shared-ref": "https://fixture.invalid/shared.png" } });
    if (value.includes("/files/")) return Response.json({ name: "Images", document: { id: "0:0", type: "DOCUMENT", children: [{ id: "0:1", type: "CANVAS", children: [root] }] } });
    downloads++;
    return new Response(Uint8Array.from([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
  };
  const result = JSON.parse(JSON.stringify(await module.exports.importFigmaUrl("https://www.figma.com/design/fixture/Images?node-id=30-1", "token", fakeFetch)));
  assert.deepEqual(result.artboards[0].layers.map(layer => [layer.kind, layer.fidelity]), [["image", "raster"], ["image", "raster"]]);
  assert.match(result.artboards[0].layers[0].html, /object-fit:cover/);
  assert.match(result.artboards[0].layers[1].html, /object-fit:contain/);
  assert.equal(downloads, 1);
});

test("complex transforms stay editable while unsupported paints and crop fall back per node", async () => {
  const root = frame("20:1", box(0, 0, 800, 500), [
    { id: "20:2", name: "Before", type: "RECTANGLE", size: { x: 40, y: 30 }, absoluteBoundingBox: box(10, 10, 40, 30), fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }] },
    { id: "20:3", name: "Rotated", type: "RECTANGLE", size: { x: 100, y: 40 }, absoluteBoundingBox: box(80, 20, 90, 90), relativeTransform: [[0.707, -0.707, 80], [0.707, 0.707, 20]], fills: [{ type: "SOLID", color: { r: 0, g: 1, b: 0 } }] },
    { id: "20:11", name: "Scaled", type: "RECTANGLE", size: { x: 30, y: 20 }, absoluteBoundingBox: box(80, 120, 60, 60), relativeTransform: [[2, 0, 80], [0, 3, 120]], fills: [{ type: "SOLID", color: { r: 0, g: 1, b: 0 } }] },
    { id: "20:12", name: "Flipped", type: "RECTANGLE", size: { x: 30, y: 20 }, absoluteBoundingBox: box(150, 120, 30, 20), relativeTransform: [[-1, 0, 180], [0, 1, 120]], fills: [{ type: "SOLID", color: { r: 0, g: 1, b: 0 } }] },
    { id: "20:13", name: "Skewed group", type: "GROUP", size: { x: 80, y: 60 }, absoluteBoundingBox: box(200, 120, 100, 60), relativeTransform: [[1, .4, 200], [0, 1, 120]], children: [{ id: "20:14", name: "Nested", type: "RECTANGLE", size: { x: 20, y: 20 }, absoluteBoundingBox: box(220, 130, 20, 20), fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }] }] },
    { id: "20:15", name: "Multicolor logo", type: "VECTOR", size: { x: 80, y: 40 }, absoluteBoundingBox: box(310, 120, 80, 40), fillGeometry: [{ path: "M0 0H40V40H0Z", overrideId: 1 }, { path: "M40 0H80V40H40Z", overrideId: 2 }], fillOverrideTable: { 1: { fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }] }, 2: { fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }] } } },
    { id: "20:16", name: "Polygon without path", type: "POLYGON", size: { x: 50, y: 50 }, absoluteBoundingBox: box(400, 120, 50, 50), fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }] },
    { id: "20:4", name: "Mask A", type: "VECTOR", isMask: true, maskType: "ALPHA", size: { x: 100, y: 100 }, absoluteBoundingBox: box(200, 20, 100, 100), fillGeometry: [{ path: "M0 0H100V100H0Z" }] },
    { id: "20:5", name: "Masked one", type: "ELLIPSE", size: { x: 120, y: 120 }, absoluteBoundingBox: box(190, 10, 120, 120), fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }] },
    { id: "20:6", name: "Masked two", type: "RECTANGLE", size: { x: 50, y: 50 }, absoluteBoundingBox: box(220, 40, 50, 50), fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 0 } }] },
    { id: "20:7", name: "Mask B", type: "VECTOR", isMask: true, maskType: "LUMINANCE", size: { x: 80, y: 80 }, absoluteBoundingBox: box(400, 20, 80, 80), fillGeometry: [{ path: "M0 0H80V80H0Z" }] },
    { id: "20:8", name: "Second range", type: "RECTANGLE", size: { x: 90, y: 90 }, absoluteBoundingBox: box(395, 15, 90, 90), fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 1 } }] },
    { id: "20:9", name: "Angular", type: "RECTANGLE", size: { x: 80, y: 80 }, absoluteBoundingBox: box(520, 20, 80, 80), fills: [{ type: "GRADIENT_ANGULAR", gradientHandlePositions: [{ x: .5, y: .5 }, { x: 1, y: .5 }, { x: .5, y: 1 }], gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0 } }] }] },
    { id: "20:10", name: "Crop", type: "RECTANGLE", size: { x: 100, y: 80 }, absoluteBoundingBox: box(620, 20, 100, 80), fills: [{ type: "IMAGE", imageRef: "crop-ref", scaleMode: "CROP", imageTransform: [[1, 0, .2], [0, 1, .1]] }] },
  ]);
  const document = { id: "0:0", type: "DOCUMENT", children: [{ id: "0:1", type: "CANVAS", children: [root] }] };
  const requested = [];
  const fakeFetch = async url => {
    const value = String(url);
    if (value.includes("/files/")) return Response.json({ name: "Adversarial", document });
    if (value.includes("/images/")) {
      const ids = new URL(value).searchParams.get("ids").split(",");
      requested.push(...ids);
      return Response.json({ images: Object.fromEntries(ids.map(id => [id, `https://fixture.invalid/${id}.svg`])) });
    }
    return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>', { headers: { "content-type": "image/svg+xml" } });
  };
  const result = JSON.parse(JSON.stringify(await module.exports.importFigmaUrl("https://www.figma.com/design/fixture/Adversarial?node-id=20-1", "token", fakeFetch)));
  assert.deepEqual(result.artboards[0].layers.map(layer => layer.name), ["Before", "Rotated", "Scaled", "Flipped", "Skewed group", "Multicolor logo", "Polygon without path", "Mask A · masked content", "Mask B · masked content"]);
  assert.equal(result.artboards[0].layers[0].fidelity, "editable");
  for (const layer of result.artboards[0].layers.slice(1, 5)) assert.equal(layer.fidelity, "editable");
  assert.deepEqual([result.artboards[0].layers[1].x, result.artboards[0].layers[1].y, result.artboards[0].layers[1].width, result.artboards[0].layers[1].height], [80, 20, 100, 40]);
  assert.match(result.artboards[0].layers[1].style, /matrix\(0\.707,0\.707,-0\.707,0\.707,0,0\)/);
  assert.match(result.artboards[0].layers[2].style, /matrix\(2,0,0,3,0,0\)/);
  assert.match(result.artboards[0].layers[3].style, /matrix\(-1,0,0,1,0,0\)/);
  assert.match(result.artboards[0].layers[4].style, /matrix\(1,0,0\.4,1,0,0\)/);
  assert.deepEqual([result.artboards[0].layers[4].children[0].x, result.artboards[0].layers[4].children[0].y], [20, 10]);
  for (const layer of result.artboards[0].layers.slice(5, 7)) assert.equal(layer.fidelity, "approximate");
  assert.deepEqual(result.artboards[0].layers[7].children.map(layer => layer.name), ["Mask A", "Masked one", "Masked two"]);
  assert.match(result.artboards[0].layers[8].style, /mask-mode:luminance/);
  assert.deepEqual(result.artboards[0].layers[8].children.map(layer => layer.name), ["Mask B", "Second range", "Angular", "Crop"]);
  assert.equal(result.artboards[0].layers[8].children[2].fidelity, "approximate");
  assert.equal(result.artboards[0].layers[8].children[3].fidelity, "approximate");
  assert.ok(["20:15", "20:16", "20:4", "20:7", "20:9", "20:10"].every(id => requested.includes(id)));
  assert.ok(["20:3", "20:11", "20:12", "20:13"].every(id => !requested.includes(id)), "CSS-compatible transforms stay native");
  assert.ok(!requested.includes("20:1"), "the root frame is never flattened");
});

test("root image fills, gradient handles and unsupported strokes never disappear", async () => {
  const gradient = {
    type: "GRADIENT_LINEAR",
    gradientHandlePositions: [{ x: .1, y: .2 }, { x: .9, y: .8 }, { x: .1, y: .8 }],
    gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0 } }, { position: 1, color: { r: 0, g: 0, b: 1 } }],
  };
  const nested = { ...frame("31:2", box(20, 30, 200, 100), [text("31:3", box(30, 40, 50, 20))]), size: { x: 200, y: 100 }, fills: [gradient] };
  const badStroke = { id: "31:4", name: "Unsupported stroke", type: "RECTANGLE", size: { x: 80, y: 40 }, absoluteBoundingBox: box(250, 30, 80, 40), fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }], strokes: [gradient, { type: "SOLID", color: { r: 0, g: 0, b: 0 } }], strokeWeight: 2 };
  const root = { ...frame("31:1", box(0, 0, 400, 240), [nested, badStroke]), fills: [{ type: "IMAGE", imageRef: "root-image", scaleMode: "FILL" }] };
  const gradientRoot = { ...frame("32:1", box(500, 0, 300, 150)), size: { x: 300, y: 150 }, fills: [gradient] };
  const document = { id: "0:0", type: "DOCUMENT", children: [{ id: "0:1", type: "CANVAS", children: [root, gradientRoot] }] };
  const requested = [];
  const fakeFetch = async url => {
    const value = String(url);
    if (value.includes("/files/fixture/images")) return Response.json({ images: { "root-image": "https://fixture.invalid/root.png" } });
    if (value.includes("/files/")) return Response.json({ name: "Root paints", document });
    if (value.includes("/images/")) {
      const ids = new URL(value).searchParams.get("ids").split(",");
      requested.push(...ids);
      return Response.json({ images: Object.fromEntries(ids.map(id => [id, `https://fixture.invalid/${id}.svg`])) });
    }
    if (value.endsWith("root.png")) return new Response(Uint8Array.from([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
    return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40"/></svg>', { headers: { "content-type": "image/svg+xml" } });
  };
  const result = JSON.parse(JSON.stringify(await module.exports.importFigmaUrl("https://www.figma.com/design/fixture/Root?node-id=0-1", "token", fakeFetch)));
  assert.equal(result.artboards[0].layers[0].kind, "image");
  assert.match(result.artboards[0].layers[0].html, /data:image\/png;base64/);
  assert.equal(result.artboards[0].layers[1].kind, "group");
  assert.match(result.artboards[0].layers[1].children[0].html, /x1="20" y1="20" x2="180" y2="80"/);
  assert.equal(result.artboards[0].layers[1].children[1].kind, "text");
  assert.equal(result.artboards[0].layers[2].fidelity, "approximate");
  assert.ok(requested.includes("31:4"));
  assert.ok(!requested.includes("31:1"), "the root stays layered even when its fill is raster");
  assert.equal(result.artboards[1].layers[0].fidelity, "editable");
  assert.match(result.artboards[1].layers[0].html, /x1="30" y1="30" x2="270" y2="120"/);
});

test("compound and angular or diamond frame fills become isolated SVG backgrounds", async () => {
  const stops = [{ position: 0, color: { r: 1, g: 0, b: 0 } }, { position: 1, color: { r: 0, g: 0, b: 1 } }];
  const angular = { type: "GRADIENT_ANGULAR", gradientHandlePositions: [{ x: .5, y: .5 }, { x: 1, y: .5 }, { x: .5, y: 1 }], gradientStops: stops };
  const diamond = { type: "GRADIENT_DIAMOND", gradientHandlePositions: [{ x: .5, y: .5 }, { x: 1, y: .5 }, { x: .5, y: 1 }], gradientStops: stops };
  const nested = { ...frame("41:2", box(20, 20, 200, 120), [text("41:3", box(30, 30, 80, 20))]), size: { x: 200, y: 120 }, fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }, angular] };
  const root = { ...frame("41:1", box(0, 0, 400, 240), [nested, text("41:4", box(250, 30, 80, 20))]), fills: [diamond] };
  const document = { id: "0:0", type: "DOCUMENT", children: [{ id: "0:1", type: "CANVAS", children: [root] }] };
  const calls = [];
  const fakeFetch = async url => {
    calls.push(String(url));
    if (String(url).includes("/files/")) return Response.json({ name: "Complex backgrounds", document });
    throw new Error(`unexpected export ${url}`);
  };
  const result = JSON.parse(JSON.stringify(await module.exports.importFigmaUrl("https://www.figma.com/design/fixture/Backgrounds?node-id=41-1", "token", fakeFetch)));
  const rootBackground = result.artboards[0].layers[0];
  const nestedGroup = result.artboards[0].layers[1];
  assert.equal(rootBackground.fidelity, "approximate");
  assert.match(rootBackground.html, /<polygon/);
  assert.equal(nestedGroup.kind, "group");
  assert.equal(nestedGroup.children[0].name, "41:2 background");
  assert.match(nestedGroup.children[0].html, /<path/);
  assert.match(nestedGroup.children[0].html, /<rect/);
  assert.equal(nestedGroup.children[1].kind, "text");
  assert.equal(result.artboards[0].layers[2].kind, "text");
  assert.equal(result.warnings.filter(warning => warning.code === "figma_frame_background_fallback").length, 2);
  assert.ok(!calls.some(url => url.includes("/images/")), "background fallback is generated without flattening either frame");
});
