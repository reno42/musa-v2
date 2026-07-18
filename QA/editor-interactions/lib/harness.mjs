/**
 * Node-side wrapper around a puppeteer page for driving the editor.
 * Every mutating action is followed by a settle() so React's setState +
 * the DesignFrame effects (css/html sync, overlay refresh) finish before
 * the next observation.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { launchBrowser } from "./browser.mjs";
import { VITE_URL } from "./servers.mjs";
import { PAGE_HELPERS } from "./page-helpers.mjs";

export class EditorHarness {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async start() {
    this.browser = await launchBrowser();
    this.page = await this.browser.newPage();
    this.page.on("pageerror", err => console.error("[page error]", err.message));
  }

  async open(templateId, frameId) {
    await this.page.goto(`${VITE_URL}/?template=${templateId}&v=2`, { waitUntil: "networkidle2", timeout: 45000 });
    await this.page.evaluate(PAGE_HELPERS);
    // Wait until the agent bridge + frame shadow DOM are ready and zoom is real.
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await this.page.evaluate(PAGE_HELPERS); // re-inject after any reload
      const ok = await this.page.evaluate(fid => window.__qa && window.__qa.ready(fid), frameId);
      if (ok) { await this.settle(); return; }
      await sleep(400);
    }
    throw new Error(`Editor for ${templateId}/${frameId} never became ready`);
  }

  /** Let React flush + effects run. Two rAFs + a tick covers setState→effect→DOM. */
  async settle(ms = 120) {
    await this.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await sleep(ms);
  }

  qa(fn, ...args) {
    return this.page.evaluate(new Function("args", `return window.__qa.${fn}(...args);`), args);
  }

  async markNodes(frameId) { return this.qa("markNodes", frameId); }
  async countSurvivors(frameId) { return this.qa("countSurvivors", frameId); }
  async selectionBox(frameId) { return this.qa("selectionBox", frameId); }
  async selectedLayerId(frameId) { return this.qa("selectedLayerId", frameId); }
  async fingerprint(frameId) { return this.qa("fingerprint", frameId); }
  async layerRect(frameId, layerId) { return this.qa("layerRect", frameId, layerId); }
  async beginMutationSpy(frameId) { return this.qa("beginMutationSpy", frameId); }
  async endMutationSpy() { return this.qa("endMutationSpy"); }

  async clickLayer(frameId, layerId) { const r = await this.qa("clickLayer", frameId, layerId); await this.settle(); return r; }
  async clickChild(frameId, selector) { const r = await this.qa("clickChild", frameId, selector); await this.settle(); return r; }
  async dragLayer(frameId, layerId, dx, dy) { const r = await this.qa("dragLayer", frameId, layerId, dx, dy); await this.settle(); return r; }
  async dragChild(frameId, selector, dx, dy) { const r = await this.qa("dragChild", frameId, selector, dx, dy); await this.settle(); return r; }
  async altDragLayer(frameId, layerId, dx, dy) { const r = await this.qa("altDragLayer", frameId, layerId, dx, dy); await this.settle(); return r; }
  async undo() { await this.qa("undo"); await this.settle(); }
  async redo() { await this.qa("redo"); await this.settle(); }

  async close() {
    if (this.browser) await this.browser.close();
  }
}
