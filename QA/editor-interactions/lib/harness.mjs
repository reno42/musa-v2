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

  async ensureSignedIn() {
    const hasForm = await this.page.evaluate(() => Boolean(document.querySelector("form.auth-form")));
    const hadSession = await this.page.evaluate(() => Object.keys(localStorage).some(k => k.includes("auth-token")));
    if (!hasForm) {
      if (!hadSession) console.log("[auth] sin form y sin sesión — la app entró igual (¿modo dev?)");
      return;
    }
    console.log(`[auth] login wall en ${this.page.url().slice(0, 60)} — sesión previa: ${hadSession ? "sí (murió)" : "no"} — firmando como QA user`);
    const { qaCredentials } = await import("./mcp.mjs");
    const { email, password } = qaCredentials();
    if (!email || !password) {
      throw new Error("El editor exige sesión y no hay credenciales QA (corré node QA/oauth-qa-user-setup.mjs una vez).");
    }
    await this.page.type('form.auth-form input[type="email"]', email, { delay: 5 });
    await this.page.type('form.auth-form input[type="password"]', password, { delay: 5 });
    await this.page.click("button.auth-submit");
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const gone = await this.page.evaluate(() => !document.querySelector("form.auth-form"));
      if (gone) return;
      await sleep(400);
    }
    throw new Error("El login del QA user no completó — revisá FDR_EMAIL/FDR_PASSWORD en QA/.env.qa-oauth.");
  }

  async open(templateId, frameId) {
    // about:blank hop first: the SPA reads ?template= once per mount, so a
    // same-origin goto from a previous suite's editor keeps the OLD template
    // mounted and ready(frameId) never fires. A fresh document forces the
    // app to boot with THIS template's URL.
    await this.page.goto("about:blank", { waitUntil: "load", timeout: 15000 }).catch(() => {});
    await this.page.goto(`${VITE_URL}/?template=${templateId}&v=2`, { waitUntil: "networkidle2", timeout: 45000 });
    // With Supabase configured the SPA walls the editor behind the login —
    // sign in as the QA user, then reload the same template URL signed-in.
    await this.ensureSignedIn();
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
