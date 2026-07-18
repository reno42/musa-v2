import { EditorHarness } from "./lib/harness.mjs";
import { createNestedTemplate, deleteTemplate } from "./lib/mcp.mjs";
const h = new EditorHarness();
const { templateId, frameId } = await createNestedTemplate();
await h.start();
await h.open(templateId, frameId);
const before = await h.page.evaluate((fid) => {
  const wrap = document.querySelector(`[data-frame-id="${fid}"]`);
  const host = [...wrap.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
  const c = host.shadowRoot.getElementById("__df_content");
  const h1 = c.querySelector('[data-layer-id="card"] h1');
  return { h1HasId: h1?.hasAttribute("data-layer-id"), childCount: c.children.length };
}, frameId);
console.log("BEFORE:", JSON.stringify(before));
await h.beginMutationSpy(frameId);
await h.qa("clickChild", frameId, '[data-layer-id="card"] h1');
await h.settle(400);
const mut = await h.endMutationSpy();
const after = await h.page.evaluate((fid) => {
  const wrap = document.querySelector(`[data-frame-id="${fid}"]`);
  const host = [...wrap.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
  const c = host.shadowRoot.getElementById("__df_content");
  const h1 = c.querySelector('[data-layer-id="card"] h1');
  return { h1HasId: h1?.hasAttribute("data-layer-id") };
}, frameId);
console.log("MUT:", JSON.stringify(mut), "AFTER:", JSON.stringify(after));
await h.close();
await deleteTemplate(templateId);
