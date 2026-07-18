import { EditorHarness } from "./lib/harness.mjs";
import { createNestedTemplate, deleteTemplate } from "./lib/mcp.mjs";
const h = new EditorHarness();
const { templateId, frameId } = await createNestedTemplate();
await h.start();
await h.open(templateId, frameId);
const layers = await h.page.evaluate((fid) => window.futurariaAgent.inspectFrame(fid).layers.map(l => ({id:l.layerId, name:l.name, x:l.x, y:l.y})), frameId);
console.log("LAYERS:", JSON.stringify(layers));
// Click the h1 inside the card, see what gets selected
await h.qa("clickChild", frameId, '[data-layer-id="card"] h1'); await h.settle();
const sel = await h.selectedLayerId(frameId);
console.log("clicked h1 → selectedLayerId:", sel);
// Record all layer positions, drag the h1, see which moved
const before = await h.page.evaluate((fid) => Object.fromEntries(window.futurariaAgent.inspectFrame(fid).layers.map(l => [l.layerId, l.x+","+l.y])), frameId);
await h.qa("dragChild", frameId, '[data-layer-id="card"] h1', 100, 0); await h.settle();
const after = await h.page.evaluate((fid) => Object.fromEntries(window.futurariaAgent.inspectFrame(fid).layers.map(l => [l.layerId, l.x+","+l.y])), frameId);
const moved = Object.keys(before).filter(k => before[k] !== after[k]);
console.log("dragged h1 +100x → moved layers:", JSON.stringify(moved), "before/after:", JSON.stringify(before), JSON.stringify(after));
await h.close();
await deleteTemplate(templateId);
