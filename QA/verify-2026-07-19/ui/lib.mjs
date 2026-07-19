/**
 * Shared helpers for the 2026-07-19 live bug-verification suite.
 * Reuses the editor-interactions harness (puppeteer + shadow-DOM synthetic input)
 * and adds: verify-a1-* template factory, screenshots, result collection.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { EditorHarness } from "../../editor-interactions/lib/harness.mjs";
import { ensureServers } from "../../editor-interactions/lib/servers.mjs";

export const DIR = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
export const API_URL = "http://localhost:3001";
export { EditorHarness, ensureServers, sleep };

// ── MCP (plain JSON-RPC, x-api-key: dev-key — same as the QA suite) ──
let rpcId = 0;
export async function mcp(method, params) {
  const res = await fetch(`${API_URL}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": "dev-key" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: ++rpcId }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  const text = body.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : body.result;
}

async function ensureWorkspace() {
  const list = await mcp("list_workspaces", {});
  const workspaces = list.data || list.workspaces || list || [];
  const existing = (Array.isArray(workspaces) ? workspaces : []).find(w => w.name === "editor-qa");
  if (existing) return existing.id;
  const created = await mcp("create_workspace", { name: "editor-qa" });
  return (created.data || created).id;
}

/** Create a disposable verify-a1-* template with a single frame. */
export async function createVerifyTemplate(suffix, { html, css = "", width = 1080, height = 1080, background = "#0E0D0B" }) {
  const workspaceId = await ensureWorkspace();
  const frameId = `frame_${suffix}`;
  const created = await mcp("create_template", {
    workspaceId, name: `verify-a1-${suffix}`, width, height, engine: "html",
  });
  const templateId = (created.data || created).id;
  await mcp("update_template", {
    id: templateId,
    frames: [{ id: frameId, name: `QA ${suffix}`, x: 0, y: 0, width, height, background, html, css }],
  });
  return { templateId, frameId };
}

/** Replace the html/css of the single frame (simulates a remote REST/MCP update). */
export async function remoteUpdateFrame(templateId, frameId, { html, css = "", width = 1080, height = 1080, background = "#0E0D0B", name }) {
  await mcp("update_template", {
    id: templateId,
    frames: [{ id: frameId, name: name || "QA frame", x: 0, y: 0, width, height, background, html, css }],
  });
}

export async function deleteTemplate(templateId) {
  try { await mcp("delete_template", { id: templateId }); } catch { /* best effort */ }
}

// ── Screenshots + results ──
export async function shot(page, name, clip) {
  const file = `${DIR}${name}.png`;
  await page.screenshot({ path: file, ...(clip ? { clip } : {}) });
  console.log(`  [shot] ${name}.png`);
  return file;
}

const RESULTS_FILE = `${DIR}results.json`;
let results = [];
try {
  results = JSON.parse(readFileSync(RESULTS_FILE, "utf8"));
  if (!Array.isArray(results)) results = [];
} catch { results = []; }
export function record(item, status, evidence, notes = "") {
  results = results.filter(r => r.item !== item); // re-ejecuciones pisan el ítem
  results.push({ item, status, evidence, notes });
  writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`  [${status}] ${item}`);
}
appendFileSync(`${DIR}run.log`, `\n=== run ${new Date().toISOString()} ===\n`);
export function log(line) {
  appendFileSync(`${DIR}run.log`, String(line) + "\n");
  console.log(line);
}

// ── Page-context probes (passed to page.evaluate as functions) ──

/** Locate the frame's shadow DOM the same way the QA suite does. */
export function frameDomProbe(frameId) {
  const wrapper = document.querySelector(`[data-frame-id="${frameId}"]`);
  if (!wrapper) return null;
  const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
  if (!host) return null;
  const content = host.shadowRoot.getElementById("__df_content");
  return {
    html: content.innerHTML.slice(0, 400),
    childCount: content.children.length,
  };
}

/** Geometry + style state of one layer: inline vs computed vs bounding box. */
export function layerState(frameId, layerId) {
  const wrapper = document.querySelector(`[data-frame-id="${frameId}"]`);
  if (!wrapper) return null;
  const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
  if (!host) return null;
  const shadow = host.shadowRoot;
  const content = shadow.getElementById("__df_content");
  const el = content.querySelector(`[data-layer-id="${layerId}"]`);
  if (!el) return null;
  const cRect = content.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  const zoom = host.getBoundingClientRect().width / (host.offsetWidth || 1);
  return {
    inlineLeft: el.style.left || null,
    inlineTop: el.style.top || null,
    inlineTranslate: el.style.translate || null,
    computedLeft: cs.left,
    computedTop: cs.top,
    box: {
      x: Math.round((r.left - cRect.left) / zoom),
      y: Math.round((r.top - cRect.top) / zoom),
      w: Math.round(r.width / zoom),
      h: Math.round(r.height / zoom),
    },
    styleTag: (shadow.querySelector("style") || {}).textContent || "",
  };
}

/** Ordered list of top-level layer ids inside the frame content. */
export function domOrder(frameId) {
  const wrapper = document.querySelector(`[data-frame-id="${frameId}"]`);
  if (!wrapper) return null;
  const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
  if (!host) return null;
  const content = host.shadowRoot.getElementById("__df_content");
  return [...content.children].map(c => c.getAttribute("data-layer-id") || c.tagName.toLowerCase());
}

/** Undo/Redo button state in FloatingToolbar. */
export function undoButtons() {
  const u = document.querySelector('button[title="Undo (Ctrl+Z)"]');
  const r = document.querySelector('button[title="Redo (Ctrl+Shift+Z)"]');
  const info = (b) => {
    if (!b) return null;
    const cs = b.ownerDocument.defaultView.getComputedStyle(b);
    const q = b.getBoundingClientRect();
    return { disabled: b.disabled, opacity: cs.opacity, color: cs.color, rect: { x: q.x, y: q.y, w: q.width, h: q.height } };
  };
  return { undo: info(u), redo: info(r) };
}
