// lib/client.mjs — Cliente MCP compartido para la verificación en vivo.
// - Lee keys del .env del repo via dotenv. NUNCA imprime valores de keys.
// - Guarda evidencia (respuestas raw truncadas) en ./evidence/.
import { config } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const VERIFY_DIR = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(VERIFY_DIR, "../../..");

config({ path: path.join(REPO_ROOT, ".env") }); // no-op si no existe

export const BASE = (process.env.VERIFY_BASE_URL || "https://design.futuraria.com").replace(/\/$/, "");
export const MCP_URL = `${BASE}/mcp`;

export const API_KEY = process.env.API_KEY || "";
export const ADMIN_KEY = process.env.MCP_ADMIN_KEY || "";
// Key "efectiva" para llamadas autenticadas: admin si existe, si no API_KEY.
export const EFFECTIVE_KEY = ADMIN_KEY || API_KEY || "";
export const KEY_INFO = {
  API_KEY_present: Boolean(API_KEY),
  MCP_ADMIN_KEY_present: Boolean(ADMIN_KEY),
  // Nunca loguear valores.
};

const EVIDENCE_DIR = path.join(VERIFY_DIR, "evidence");
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

// ── Pacing: máx ~3 req/s para no hacer burst contra prod ──
const MIN_GAP_MS = 350;
let lastReq = 0;
async function pace() {
  const wait = MIN_GAP_MS - (Date.now() - lastReq);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReq = Date.now();
}

export function truncate(str, max = 1500) {
  const s = typeof str === "string" ? str : JSON.stringify(str);
  if (s.length <= max) return s;
  return s.slice(0, max) + `…[TRUNCADO ${s.length - max} chars de ${s.length} totales]`;
}

export function saveEvidence(filename, obj) {
  const p = path.join(EVIDENCE_DIR, filename);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

// Redacción defensiva: por si alguna respuesta incluyera una key, la enmascara.
export function redact(str) {
  let out = String(str);
  for (const k of [API_KEY, ADMIN_KEY]) {
    if (k) out = out.split(k).join("<KEY>");
  }
  return out;
}

let rpcId = 1;

/** Llamada JSON-RPC cruda. Devuelve { httpStatus, json, rawBody, contentType }. */
export async function mcpCall(method, params, { apiKey } = {}) {
  await pace();
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  const body = JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params });
  const res = await fetch(MCP_URL, { method: "POST", headers, body });
  const rawBody = await res.text();
  let json = null;
  try { json = JSON.parse(rawBody); } catch { /* no-JSON */ }
  return { httpStatus: res.status, json, rawBody, contentType: res.headers.get("content-type") || "" };
}

/** tools/call con parseo del content[0].text (patrón de test_mcp.mjs / healthcheck_mcp.mjs). */
export async function tool(name, args, opts = {}) {
  const r = await mcpCall("tools/call", { name, arguments: args }, opts);
  const text = r.json?.result?.content?.[0]?.text;
  let parsed = null;
  if (typeof text === "string") {
    try { parsed = JSON.parse(text); } catch { parsed = text; }
  }
  const error = r.json?.error || null;
  return { ...r, text, parsed, error };
}

/** Resumen compacto de una respuesta de tool para evidencia. */
export function summarizeToolResp(r, maxText = 1500) {
  return {
    httpStatus: r.httpStatus,
    rpcError: r.error || null,
    textTruncated: r.text !== undefined ? truncate(redact(r.text ?? ""), maxText) : undefined,
    rawBodyTruncated: r.text === undefined ? truncate(redact(r.rawBody ?? ""), maxText) : undefined,
  };
}

// ── Estado compartido entre scripts ──
const STATE_PATH = path.join(VERIFY_DIR, "state.json");
export function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); } catch { return {}; }
}
export function saveState(patch) {
  const s = { ...loadState(), ...patch };
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
  return s;
}

export function verdict(label, cond, detail = "") {
  const mark = cond ? "✅" : "❌";
  console.log(`  ${mark} ${label}${detail ? " — " + detail : ""}`);
  return cond;
}
