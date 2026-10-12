import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// REQ-047 «Conecta tu IA»: scopes de tokens de agente (matriz pura en
// flows-core), enforcement en los dos choke points del MCP, migración v71,
// llavero con scopes en la API SaaS y las superficies UI (#connect, editor,
// enlaces desde Invita IAs y Flows).

import { scopeForMethod, scopesAllowMethod } from "../netlify/functions/flows-core.mjs";

const read = (rel) => readFile(new URL(rel, import.meta.url), "utf8");

test("REQ-047: scopeForMethod clasifica los sets de flow", () => {
  for (const m of ["flow_list", "flow_get", "flow_history", "flow_export", "flow_ai_tasks", "flow_wake_get", "flow_due_check", "flow_library_list", "flow_credentials_list", "flow_static_data_get"]) {
    assert.equal(scopeForMethod(m), "flows:read", m);
  }
  for (const m of ["flow_save", "flow_delete", "flow_run", "flow_import", "flow_wake_set", "flow_wake_test", "flow_library_instantiate", "flow_credentials_save", "flow_credentials_delete", "flow_static_data_set", "flow_webhook_rotate", "flow_oauth2_connect"]) {
    assert.equal(scopeForMethod(m), "flows:write", m);
  }
  for (const m of ["flow_resume", "flow_ai_complete"]) {
    assert.equal(scopeForMethod(m), "flows:resume", m);
  }
});

test("REQ-047: scopeForMethod clasifica assets por dominio (aunque el verbo vaya primero)", () => {
  // Lectura: verbo de lectura al frente + dominio de asset en el nombre.
  assert.equal(scopeForMethod("get_html_frames"), "assets:read");
  assert.equal(scopeForMethod("list_templates"), "assets:read");
  assert.equal(scopeForMethod("get_brand_guideline"), "assets:read");
  assert.equal(scopeForMethod("render_html"), "assets:read");
  // Escritura: dominio de asset sin verbo de lectura al frente.
  assert.equal(scopeForMethod("save_template"), "assets:write");
  assert.equal(scopeForMethod("generate_chart"), "assets:write");
  assert.equal(scopeForMethod("create_content_calendar"), "assets:write");
});

test("REQ-047: scopeForMethod deja null lo que queda FUERA del alcance", () => {
  // CRM, social y desconocidos: un token CON scopes no los llama nunca.
  assert.equal(scopeForMethod("create_contact"), null);
  assert.equal(scopeForMethod("list_workspace_members"), null);
  assert.equal(scopeForMethod("totally_made_up_tool"), null);
  assert.equal(scopeForMethod(""), null);
  assert.equal(scopeForMethod(undefined), null);
});

test("REQ-047: scopesAllowMethod — sin scopes todo pasa (compat)", () => {
  assert.equal(scopesAllowMethod(undefined, "flow_save"), true);
  assert.equal(scopesAllowMethod([], "create_contact"), true);
  assert.equal(scopesAllowMethod(null, "flow_run"), true);
});

test("REQ-047: scopesAllowMethod — '*' es owner", () => {
  assert.equal(scopesAllowMethod(["*"], "flow_delete"), true);
  assert.equal(scopesAllowMethod(["*"], "create_contact"), true);
});

test("REQ-047: scopesAllowMethod — preset atendedor (flows:read + flows:resume)", () => {
  const atendedor = ["flows:read", "flows:resume"];
  assert.equal(scopesAllowMethod(atendedor, "flow_list"), true);
  assert.equal(scopesAllowMethod(atendedor, "flow_ai_tasks"), true);
  assert.equal(scopesAllowMethod(atendedor, "flow_ai_complete"), true);
  assert.equal(scopesAllowMethod(atendedor, "flow_resume"), true);
  assert.equal(scopesAllowMethod(atendedor, "flow_save"), false);
  assert.equal(scopesAllowMethod(atendedor, "flow_run"), false);
  assert.equal(scopesAllowMethod(atendedor, "list_templates"), false);
  // flows:write implica flows:read, pero no al revés ni alcanza resume.
  assert.equal(scopesAllowMethod(["flows:write"], "flow_list"), true);
  assert.equal(scopesAllowMethod(["flows:write"], "flow_resume"), false);
});

test("REQ-047: scopesAllowMethod — preset agente (todo flows+assets) y desconocidos fuera", () => {
  const agente = ["flows:read", "flows:write", "flows:resume", "assets:read", "assets:write"];
  assert.equal(scopesAllowMethod(agente, "flow_list"), true);
  assert.equal(scopesAllowMethod(agente, "flow_save"), true);
  assert.equal(scopesAllowMethod(agente, "flow_run"), true);
  assert.equal(scopesAllowMethod(agente, "flow_resume"), true);
  assert.equal(scopesAllowMethod(agente, "list_templates"), true);
  assert.equal(scopesAllowMethod(agente, "save_template"), true);
  assert.equal(scopesAllowMethod(agente, "create_contact"), false);
  assert.equal(scopesAllowMethod(agente, "method_que_no_existe"), false);
});

test("REQ-047: mcp.mjs enforce en AMBOS choke points + rate limit + códigos", async () => {
  const src = await read("../netlify/functions/mcp.mjs");
  assert.match(src, /enforceKeyPolicy\(auth,\s*params\.name\)/);
  assert.match(src, /enforceKeyPolicy\(auth,\s*method\)/);
  assert.match(src, /KEY_RATE_LIMIT\s*=\s*120/);
  assert.match(src, /-32008/); // RATE_LIMITED
  assert.match(src, /-32003/); // SCOPE_DENIED
  assert.match(src, /mcp_token_calls/); // auditoría
  // El llavero trae scopes y se propaga al auth del workspace_key.
  assert.match(src, /scopes/);
  // flow_history expone expiresAt de runs waiting (Fase D).
  assert.match(src, /pending_state\.expiresAt \? \{ expiresAt/);
});

test("REQ-047: migración v71 — columna scopes + tabla de auditoría", async () => {
  const sql = await read("../supabase_migrations_v71.sql");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS scopes text\[\]/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS mcp_token_calls/);
  assert.match(sql, /idx_mcp_token_calls_key_created/);
});

test("REQ-047: API SaaS valida y persiste scopes en el llavero", async () => {
  const saas = await read("../api/src/routes/saas.ts");
  assert.match(saas, /"flows:read".*"flows:write".*"flows:resume"/);
  assert.match(saas, /\.\.\.\(parsed\.scopes\?\.length \? \{ scopes: parsed\.scopes \} : \{\}\)/);
  assert.match(saas, /Pre-v71/); // fallback sin columna, nunca rompe el llavero
});

test("REQ-047: #connect existe y es ruta pública", async () => {
  const route = await read("../src/lib/appRoute.ts");
  assert.match(route, /\| \{ kind: "connect" \}/);
  assert.match(route, /if \(hash === "connect"\) return \{ kind: "connect" \};/);
  // routeRequiresAccount NO lista connect (pública, igual que agents).
  const requiresBlock = route.slice(route.indexOf("export function routeRequiresAccount"));
  assert.doesNotMatch(requiresBlock, /connect/);

  const app = await read("../src/App.tsx");
  assert.match(app, /import \{ ConnectLanding \}/);
  assert.match(app, /route\.kind === "connect"/);
  assert.match(app, /<ConnectLanding onEnter=\{enterWorkspace\} onOpenHuman=\{showLanding\} \/>/);
});

test("REQ-047: ConnectLanding — presets, bandeja, wake, prueba con token y prompts", async () => {
  const page = await read("../src/components/ConnectLanding.tsx");
  assert.match(page, /export function ConnectLanding/);
  assert.match(page, /"flows:read", "flows:write", "flows:resume", "assets:read", "assets:write"/); // preset agente
  assert.match(page, /"flows:read", "flows:resume"/); // preset atendedor
  assert.match(page, /flow_ai_tasks/);
  assert.match(page, /flow_ai_complete/);
  assert.match(page, /flow_wake_set/);
  assert.match(page, /flow_wake_test/);
  assert.match(page, /x-api-key/); // prueba de conexión con el token crudo
  assert.match(page, /staleMinutes/);
  assert.match(page, /Prompt sistema/);
});

test("REQ-047: enlaces a #connect desde Invita IAs y la tarjeta de despertar", async () => {
  const invite = await read("../src/components/InviteAisCatalog.tsx");
  assert.match(invite, /href="\/#connect"/);
  const flows = await read("../src/components/FlowsTab.tsx");
  assert.match(flows, /href="\/#connect"/);
});
