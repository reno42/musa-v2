import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

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

test("a page link preserves complete frame exports, backgrounds and dimensions", async () => {
  const { result, calls } = await imported([first, second]);
  assert.deepEqual(result.artboards.map(a => [a.name, a.width, a.height]), [["1:1", 320, 180], ["2:1", 1440, 900]]);
  assert.deepEqual(result.artboards.map(a => [a.layers[0].x, a.layers[0].y, a.layers[0].width, a.layers[0].height]), [[0, 0, 320, 180], [0, 0, 1440, 900]]);
  assert.match(result.artboards[0].layers[0].html, /Content 1:2/);
  assert.match(result.artboards[1].layers[0].html, /Content 2:2/);
  assert.match(result.artboards[0].layers[0].html, /fill="#000000" rx="16"/);
  assert.match(result.artboards[0].layers[0].html, /fill="#ffffff"/);
  assert.match(result.artboards[1].layers[0].html, /<linearGradient/);
  assert.match(result.artboards[1].layers[0].html, /fill="url\(#gradient\)"/);
  assert.ok(calls.some(url => url.includes("/images/") && new URL(url).searchParams.get("ids") === "1:1,2:1"));
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
  assert.equal(result.artboards[0].layers[0].kind, "vector");
  assert.equal(result.artboards[0].layers[1].kind, "text");
  assert.match(result.artboards[0].layers[1].html, /Content 4:2/);
  assert.ok(calls.some(url => url.includes("/images/") && new URL(url).searchParams.get("ids") === "1:1"));
});

test("loose text, groups and empty frames survive a mixed page", async () => {
  const group = { ...frame("5:1", box(0, 0, 200, 100), [text("5:2", box(10, 10, 20, 20))]), type: "GROUP" };
  const empty = frame("6:1", box(0, 0, 400, 200));
  const loose = text("7:1", box(-100, -100, 80, 20));
  const { result } = await imported([first, group, empty, loose]);
  assert.equal(result.artboards.length, 4);
  assert.match(result.artboards[1].layers[0].html, /Content 5:2/);
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
