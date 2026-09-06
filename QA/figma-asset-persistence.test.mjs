import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";

const require = createRequire(new URL("../api/package.json", import.meta.url));
const repo = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ entryPoints: [fileURLToPath(new URL("../api/src/routes/designImports.ts", import.meta.url))], bundle: true, packages: "external", platform: "node", format: "cjs", write: false, logLevel: "silent" });
const module = { exports: {} };
vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require, Buffer, URL, AbortSignal, fetch, setTimeout, clearTimeout, console, process: { cwd: () => repo, env: {} } });

const dataA = "data:image/png;base64,AQID";
const dataB = "data:image/png;base64,BAUG";
const fixture = () => ({
  version: "futuraria-import/v1", name: "Assets", source: "figma", warnings: [], report: { editable: 0, approximate: 0, raster: 2 },
  artboards: [{ id: "a", name: "a", width: 100, height: 100, background: "#fff", layers: [{ id: "parent", name: "Parent", kind: "group", x: 0, y: 0, width: 100, height: 100, fidelity: "editable", html: `<img src="${dataA}">`, children: [{ id: "child", name: "Child", kind: "image", x: 0, y: 0, width: 10, height: 10, fidelity: "raster", html: `<img src="${dataB}">` }] }] }],
});

function fakeDb(saved, removed = []) {
  return { from: table => ({
    upsert: async row => { assert.equal(table, "assets"); saved.push(row); return { error: null }; },
    delete: () => ({ eq: (column, value) => ({ eq: async () => { assert.equal(column, "id"); removed.push(value); return { error: null }; } }) }),
  }) };
}

test("asset persistence replaces nested data URLs only after every upload succeeds", async () => {
  const document = fixture();
  const saved = [];
  let uploads = 0;
  const result = await module.exports.persistDocumentAssets(fakeDb(saved), document, "workspace", async filename => {
    uploads++;
    return `https://assets.invalid/${filename}`;
  });
  assert.equal(result, document);
  assert.equal(uploads, 2);
  assert.equal(saved.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /data:image/);
  assert.match(result.artboards[0].layers[0].html, /https:\/\/assets\.invalid\//);
  assert.match(result.artboards[0].layers[0].children[0].html, /https:\/\/assets\.invalid\//);
  const reloaded = JSON.parse(JSON.stringify(result));
  assert.deepEqual(reloaded, result);
});

test("a failed second asset leaves the import document unchanged", async () => {
  const document = fixture();
  const before = structuredClone(document);
  const saved = [];
  const removed = [];
  const cleaned = [];
  let uploads = 0;
  await assert.rejects(() => module.exports.persistDocumentAssets(fakeDb(saved, removed), document, "workspace", async filename => {
    uploads++;
    if (uploads === 2) throw new Error(`failed ${filename}`);
    return `https://assets.invalid/${filename}`;
  }, async filename => { cleaned.push(filename); }), /failed/);
  assert.equal(uploads, 2);
  assert.equal(saved.length, 1);
  assert.deepEqual(removed, [saved[0].id]);
  assert.deepEqual(cleaned, [saved[0].filename]);
  assert.deepEqual(document, before);
});
