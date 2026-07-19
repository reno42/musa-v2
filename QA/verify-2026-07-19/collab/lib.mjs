/**
 * lib.mjs — helpers compartidos para la verificación EN VIVO de colaboración humano+IA.
 * Producción: https://design.futuraria.com (MCP en /mcp, API en /api).
 * NUNCA imprime la API key. La carga del .env del workspace (4 niveles arriba).
 */
import { existsSync, readFileSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import puppeteer from "puppeteer-core";

export const BASE = "https://design.futuraria.com";
export const MCP_URL = `${BASE}/mcp`;
export const LS_KEY = "futuraria-api-key"; // src/lib/apiKey.ts → STORAGE_KEY

const HERE = dirname(fileURLToPath(import.meta.url));
export const SHOTS = join(HERE, "shots");
export const LOGS = join(HERE, "logs");
mkdirSync(SHOTS, { recursive: true });
mkdirSync(LOGS, { recursive: true });

// ── .env loading (dotenv manual, tolerante a espacios/comillas/CRLF) ──
function loadEnv() {
  const candidates = [
    join(HERE, "..", "..", "..", ".env"),          // design-main/.env (si existiera)
    join(HERE, "..", "..", "..", "..", ".env"),    // workspace/.env (real)
  ];
  const env = {};
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1] in env)) env[m[1]] = v;
    }
  }
  return env;
}

const ENV = loadEnv();

/**
 * API key para producción. Busca var explícita o la primera fdr_* en .env.
 * Fallback: "dev-key" — producción corre en modo dev accept-all (MCP_ADMIN_KEY
 * no seteada; verificado empíricamente 2026-07-19: tools/call responde sin key).
 */
export function getApiKey() {
  const explicit = process.env.FUTURARIA_API_KEY || ENV.FUTURARIA_API_KEY || ENV.API_KEY || ENV.MCP_ADMIN_KEY;
  if (explicit) return explicit;
  for (const [k, v] of Object.entries(ENV)) {
    if (v && v.startsWith("fdr_")) return v;
  }
  return "dev-key";
}

// ── logging con timestamps ──
const logFile = join(LOGS, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
export function ts() { return new Date().toISOString(); }
export function log(msg) {
  const line = `[${ts()}] ${msg}`;
  console.log(line);
  appendFileSync(logFile, line + "\n");
}
export function logJson(msg, obj) {
  log(`${msg}: ${JSON.stringify(obj)}`);
}

// ── MCP JSON-RPC ──
let rpcId = 0;
export async function mcp(name, args = {}, { timeoutMs = 30000 } = {}) {
  const key = getApiKey();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(MCP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
      signal: ctl.signal,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status} ${JSON.stringify(body)?.slice(0, 300)}`);
    if (body.error) {
      const e = new Error(`${name}: [${body.error.code}] ${body.error.message}`);
      e.code = body.error.code;
      throw e;
    }
    const text = body.result?.content?.[0]?.text;
    return text ? JSON.parse(text) : body.result;
  } finally { clearTimeout(t); }
}

export async function mcpToolsList() {
  const key = getApiKey();
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/list" }),
  });
  const body = await res.json();
  return body.result?.tools || [];
}

// ── Browser ──
const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  `${process.env.LOCALAPPDATA || ""}\\Google\\Chrome\\Application\\chrome.exe`,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];
export function resolveBrowserPath() {
  const found = CANDIDATES.filter(Boolean).find((p) => existsSync(p));
  if (!found) throw new Error("No system Chrome/Edge found");
  return found;
}

export async function launchBrowser() {
  return puppeteer.launch({
    executablePath: resolveBrowserPath(),
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
    defaultViewport: { width: 1600, height: 1000 },
  });
}

/** Abre el editor de un template con la API key ya sembrada en localStorage. */
export async function openEditor(browser, templateId, { context = null } = {}) {
  const ctx = context || browser;
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  await page.evaluateOnNewDocument((lsKey, key) => {
    try { localStorage.setItem(lsKey, key); } catch {}
  }, LS_KEY, getApiKey());
  const url = `${BASE}/?template=${templateId}&v=2`;
  await page.goto(url, { waitUntil: "networkidle2", timeout: 90000 });
  return page;
}

/** Espera a que el editor haya cargado el frame (shadow content presente). */
export async function waitEditorReady(page, frameId, timeoutMs = 60000) {
  await page.waitForFunction(
    (fid) => {
      const wrapper = document.querySelector('[data-frame-id="' + fid + '"]');
      if (!wrapper) return false;
      const host = [...wrapper.querySelectorAll("div")].find((el) => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
      return !!(host && host.shadowRoot.getElementById("__df_content"));
    },
    { timeout: timeoutMs },
    frameId
  );
}

/** Lee el texto contenido en el shadow DOM de un frame. */
export async function readFrameText(page, frameId) {
  return page.evaluate((fid) => {
    const wrapper = document.querySelector('[data-frame-id="' + fid + '"]');
    if (!wrapper) return null;
    const host = [...wrapper.querySelectorAll("div")].find((el) => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
    if (!host) return null;
    return host.shadowRoot.getElementById("__df_content").innerText;
  }, frameId);
}

let shotN = 0;
export async function shot(page, label) {
  const n = String(++shotN).padStart(2, "0");
  const file = join(SHOTS, `${n}-${label}.png`);
  await page.screenshot({ path: file });
  log(`SCREENSHOT ${n}-${label}.png`);
  return file;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
