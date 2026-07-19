/**
 * lib.mjs — utilidades compartidas para la verificación EN VIVO de producción.
 * Reusa el launcher de QA/editor-interactions (puppeteer-core + Chrome del sistema)
 * y los page-helpers (window.__qa) que son independientes de la URL.
 * Sin secretos: la API prod acepta writes sin x-api-key hoy (ver logs/00-probe.log).
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { resolveBrowserPath } from "../../editor-interactions/lib/browser.mjs";
import { PAGE_HELPERS } from "../../editor-interactions/lib/page-helpers.mjs";

export const PROD = "https://design.futuraria.com";
export const HERE = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
export const SHOTS = path.join(HERE, "shots");
export const PROFILES = path.join(HERE, "profiles");
mkdirSync(SHOTS, { recursive: true });

export const ts = () => new Date().toISOString();
export const log = (...a) => console.log(`[${ts()}]`, ...a);
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── API prod (sin key: auth.ts acepta todo cuando MCP_ADMIN_KEY no está set) ──
export async function api(method, p, body) {
  const res = await fetch(`${PROD}${p}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* no-json */ }
  return { status: res.status, json };
}

export async function ensureWorkspace() {
  const list = await api("GET", "/api/workspaces");
  const found = (list.json?.data || []).find(w => w.name === "verify-a2-ws");
  if (found) return found.id;
  const created = await api("POST", "/api/workspaces", { name: "verify-a2-ws", description: "QA live verification 2026-07-19" });
  if (!created.json?.data?.id) throw new Error("workspace create failed: " + JSON.stringify(created.json));
  return created.json.data.id;
}

export async function createTemplate(name, frames, { width = 1080, height = 1080 } = {}) {
  const wsId = await ensureWorkspace();
  const created = await api("POST", "/api/templates", { workspaceId: wsId, name, width, height, engine: "html" });
  const id = created.json?.data?.id;
  if (!id) throw new Error(`create ${name} failed: ` + JSON.stringify(created.json));
  if (frames) {
    const put = await api("PUT", `/api/templates/${id}`, { frames, name });
    if (put.status !== 200) throw new Error(`seed PUT ${name} failed: HTTP ${put.status}`);
  }
  log(`template creado ${name} → ${id}`);
  return id;
}

export const getTemplate = (id) => api("GET", `/api/templates/${id}`);

/** Borrado total: soft-delete + purge permanente. */
export async function purgeTemplate(id) {
  const d1 = await api("DELETE", `/api/templates/${id}`);
  const d2 = await api("DELETE", `/api/templates/${id}/permanent`);
  return { soft: d1.status, purge: d2.status };
}

/** Lista ids de templates verify-a2-* vivos y en papelera (para verificación de limpieza). */
export async function verifyLeftovers() {
  const all = await api("GET", "/api/templates?limit=200");
  const live = (all.json?.data || []).filter(t => (t.name || "").startsWith("verify-a2-")).map(t => ({ id: t.id, name: t.name }));
  const trash = await api("GET", "/api/templates/trash");
  const trashed = (trash.json?.data || []).filter(t => (t.name || "").startsWith("verify-a2-")).map(t => ({ id: t.id, name: t.name }));
  return { live, trashed };
}

// ── Browser ──
export async function launchProfile(profileDir) {
  const executablePath = resolveBrowserPath();
  return puppeteer.launch({
    executablePath,
    headless: "new",
    userDataDir: profileDir,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
    defaultViewport: { width: 1600, height: 1000 },
  });
}

/** Adjunta log de red para /api/ (con timestamps ms). Devuelve el array acumulador.
 *  captureBody=true guarda un snippet (300 chars) del body de writes — sin secretos,
 *  es el html/css del template verify-a2-*. */
export function attachNetLog(page, tag, { captureBody = false } = {}) {
  const entries = [];
  page.on("request", r => {
    const u = r.url();
    if (!u.includes("/api/")) return;
    const e = { tag, t: ts(), ms: Date.now(), phase: "req", method: r.method(), url: u.replace(PROD, ""), bytes: (r.postData() || "").length };
    if (captureBody && r.postData()) e.bodySnippet = r.postData().slice(0, 300);
    entries.push(e);
  });
  page.on("response", r => {
    const u = r.url();
    if (u.includes("/api/")) entries.push({ tag, t: ts(), ms: Date.now(), phase: "res", method: r.request().method(), url: u.replace(PROD, ""), status: r.status() });
  });
  return entries;
}

/** Abre el editor prod para un template y espera a que el shadow DOM esté listo. */
export async function openEditor(page, templateId, frameId, { timeoutMs = 45000 } = {}) {
  await page.goto(`${PROD}/?template=${templateId}&v=2`, { waitUntil: "domcontentloaded", timeout: 60000 });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.evaluate(PAGE_HELPERS); // re-inyectar tras cualquier recarga
    const ok = await page.evaluate(fid => window.__qa && window.__qa.ready(fid), frameId).catch(() => false);
    if (ok) return;
    await sleep(400);
  }
  throw new Error(`Editor ${templateId}/${frameId} no quedó listo en ${timeoutMs}ms`);
}

export async function shot(page, name) {
  const p = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: p });
  log("screenshot", `shots/${name}.png`);
  return p;
}

/** Tamaños de localStorage relevantes (chars; UTF-16 ≈ x2 bytes en Chrome). */
export async function lsInfo(page) {
  return page.evaluate(() => {
    const out = { totalChars: 0, localTemplatesChars: 0, templateIds: [], perTemplateChars: {} };
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        const v = localStorage.getItem(k) || "";
        out.totalChars += k.length + v.length;
      }
      const raw = localStorage.getItem("futuraria_local_templates") || "{}";
      out.localTemplatesChars = raw.length;
      const all = JSON.parse(raw);
      out.templateIds = Object.keys(all);
      for (const [id, v] of Object.entries(all)) out.perTemplateChars[id] = JSON.stringify(v).length;
    } catch (e) { out.error = String(e); }
    return out;
  });
}

/** Rect de una capa según el agent bridge (posición lógica en el documento). */
export async function layerRect(page, frameId, layerId) {
  await page.evaluate(PAGE_HELPERS);
  return page.evaluate((f, l) => window.__qa.layerRect(f, l), frameId, layerId);
}

export { PAGE_HELPERS };
