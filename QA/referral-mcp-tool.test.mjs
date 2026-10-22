/**
 * Contratos MCP del tool get_referral_status (v76 referidos):
 * registro en MCP_TOOLS + paridad de cálculo con GET /api/account/referral/summary
 * (api/src/routes/saas.ts), read-only estricto y superficies sincronizadas
 * (tools_catalog.json + SKILL.md vía npm run sync:skill).
 * Corre: node --experimental-strip-types --test QA/referral-mcp-tool.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const mcp = read("worker/runtime/functions/mcp.mjs");

test("mcp: get_referral_status está registrado en MCP_TOOLS y es read-only", () => {
  const defStart = mcp.indexOf('name: "get_referral_status"');
  assert.ok(defStart > -1, "falta la definición del tool");
  assert.ok(defStart < mcp.indexOf("const handler = async"), "la def debe vivir en MCP_TOOLS, no en el dispatch");
  const defBody = mcp.slice(defStart, defStart + 1200);
  assert.match(defBody, /read-only/);
  // Sin params: la sesión ES el usuario — nada que el caller pueda apuntar a otro.
  const schemaIdx = defBody.indexOf("inputSchema");
  assert.ok(schemaIdx > -1);
  assert.match(defBody.slice(schemaIdx, schemaIdx + 80), /properties: \{\}, required: \[\]/);
});

test("mcp: paridad de cálculo con GET /api/account/referral/summary", () => {
  const caseStart = mcp.indexOf('case "get_referral_status"');
  assert.ok(caseStart > -1, "falta el case del dispatch");
  const body = mcp.slice(caseStart, caseStart + 3500);
  // El default del switch es el único "Method not found" — el case debe quedar antes.
  const switchDefault = mcp.indexOf('"Method not found: " + method');
  assert.ok(switchDefault > caseStart, "el case debe estar dentro del switch de tools/call");
  // Misma fuente de verdad: user_profiles.
  assert.match(body, /from\("user_profiles"\)/);
  assert.match(body, /referral_code, referred_by, referred_at/);
  // Acreditado = además aceptó el NDA (idéntico al API).
  assert.match(body, /\.eq\("referred_by", userId\)/);
  assert.match(body, /\.not\("nda_accepted_at", "is", null\)/);
  // Economía idéntica: 30 por acreditado, tope 365.
  assert.match(body, /REFERRAL_REWARD_DAYS = 30/);
  assert.match(body, /REFERRAL_REWARD_CAP_DAYS = 365/);
  assert.match(body, /Math\.min\(creditedCount \* REFERRAL_REWARD_DAYS, REFERRAL_REWARD_CAP_DAYS\)/);
  // Misma escala gamificada que la tarjeta del Dashboard (1/3/6/12).
  assert.match(body, /\[1, 3, 6, 12\]/);
  // shareUrl relativo, mismo formato que el copy del Dashboard.
  assert.match(body, /\/\?ref=\$\{code\}/);
});

test("mcp: sesiones no humanas y pre-v76 degradan sin romper", () => {
  const caseStart = mcp.indexOf('case "get_referral_status"');
  const body = mcp.slice(caseStart, caseStart + 3500);
  // Admin/key sin dueño: nota explicativa, nunca throw.
  assert.match(body, /auth\.userId === "admin"/);
  assert.match(body, /no está ligada a un usuario humano/);
  // Columnas ausentes (pre-v76): profileFieldsAvailable: false + hint de migración.
  assert.match(body, /profileFieldsAvailable = false/);
  assert.match(body, /supabase_migrations_v76\.sql/);
});

test("mcp: el canje NO se expone por IA (atribución irreversible, acto humano)", () => {
  const caseStart = mcp.indexOf('case "get_referral_status"');
  const body = mcp.slice(caseStart, caseStart + 3500);
  assert.ok(!/referral\/redeem/.test(body), "el tool no debe llamar al canje");
  assert.match(body, /irreversible/, "la descripción/comentario debe documentar la decisión");
});

test("mcp: get_ prefix cae en MCP_READ_PREFIX (viewer keys pueden leer su propio estado)", () => {
  const prefixSrc = mcp.match(/const MCP_READ_PREFIX = \/\^\(get\|list\|[\s\S]*?\)\_\/;/)?.[0] || "";
  assert.ok(prefixSrc.includes("MCP_READ_PREFIX"), "MCP_READ_PREFIX no encontrado");
  assert.ok(prefixSrc.startsWith("const MCP_READ_PREFIX = /^(get|list|"), "get_ debe seguir siendo la primera alternativa read-only");
});

test("sync: superficies de catálogo sincronizadas (post npm run sync:skill)", () => {
  const catalog = JSON.parse(read("tools_catalog.json"));
  const entry = catalog.find((t) => t.name === "get_referral_status");
  assert.ok(entry, "tools_catalog.json sin get_referral_status");
  assert.ok(entry.description.includes("read-only"));
  assert.ok(entry.inputSchema, "tools_catalog.json sin inputSchema");
  const skill = read("SKILL.md");
  assert.ok(skill.includes("`get_referral_status` — "), "SKILL.md sin la entrada del catálogo");
});

test("sync: rutas del generador apuntan a archivos que existen (regresión netlify→worker)", () => {
  const sync = read("scripts/sync-skill-tools.mjs");
  assert.ok(!/resolve\(root, "netlify"/.test(sync), "sync-skill-tools.mjs aún referencia la era Netlify");
  const mcpSrc = sync.match(/const MCP_SRC = resolve\(root, ([^;]+)\);/)?.[1] || "";
  const parts = mcpSrc.match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)) || [];
  assert.ok(parts.length >= 2, "MCP_SRC malformado");
  const resolved = join(root, ...parts);
  assert.ok(existsSync(resolved), `MCP_SRC no existe: ${resolved}`);
});
