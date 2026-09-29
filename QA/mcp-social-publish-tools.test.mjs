/**
 * MCP parity for everything the Contenidos UI and the editor viewport can do.
 *
 * The publish pipeline is singular: MCP tools MUST ride the same /api/content
 * endpoints the human dialog uses (forwardApiHeaders loopback), and the
 * in-app agent must see the same surface (calendar schemas + local editor
 * viewport tools). A regression here doesn't crash anything — it silently
 * splits "what humans can do" from "what AIs can do", which is the product's
 * core promise.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const readRepo = rel => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const mcp = readRepo("netlify/functions/mcp.mjs");

// ── Loopback plumbing (one pipeline, no reimplementation) ──

test("mcp server forwards caller credentials to the workspace api", () => {
  assert.match(mcp, /function forwardApiHeaders\(auth\)/);
  assert.match(mcp, /auth\?\.authType === "user" && auth\.accessToken/);
  assert.match(mcp, /auth\?\.authType === "workspace_key" && auth\.keyRaw/);
  assert.match(mcp, /keyRaw: apiKey/); // checkAuth threads the raw key in-memory
  assert.match(mcp, /function apiBaseUrl\(\)/);
  assert.match(mcp, /async function callWorkspaceApi\(/);
});

test("the three social tools are registered with defs AND handler cases", () => {
  const catalogStart = mcp.indexOf("const MCP_TOOLS = [");
  const dispatch = mcp.indexOf("async function handleMethod");
  const catalog = mcp.slice(catalogStart, dispatch);
  for (const name of ["list_social_accounts", "set_publish_defaults", "publish_content"]) {
    assert.ok(catalog.includes(`name: "${name}"`), `missing tool def: ${name}`);
    assert.ok(mcp.includes(`case "${name}"`), `missing handler case: ${name}`);
  }
});

test("social handlers never touch credential columns", () => {
  const social = mcp.slice(mcp.indexOf('case "list_social_accounts"'), mcp.indexOf('case "list_copy_recipes"'));
  assert.doesNotMatch(social, /credentials_encrypted/);
  assert.match(social, /public_config/);
});

test("publish_content rides the same POST /api/content/:id/publish the UI uses", () => {
  const publish = mcp.slice(mcp.indexOf('case "publish_content"'), mcp.indexOf('case "list_copy_recipes"'));
  assert.match(publish, /\/api\/content\/\$\{encodeURIComponent\(contentId\)\}\/publish/);
  assert.match(publish, /callWorkspaceApi\(auth/);
  assert.match(publish, /mode must be 'now' or 'schedule'/);
  assert.match(publish, /Content not found/); // read-back tenancy guard
  assert.match(publish, /accountIds/);
  assert.match(publish, /scheduledFor/);
});

test("set_publish_defaults merges per brand and can clear one", () => {
  const setDefaults = mcp.slice(mcp.indexOf('case "set_publish_defaults"'), mcp.indexOf('case "publish_content"'));
  assert.match(setDefaults, /brandAccounts\[String\(params\.brandId\)\] = accountIds/);
  assert.match(setDefaults, /delete brandAccounts\[String\(params\.brandId\)\]/);
  assert.match(setDefaults, /method: "PUT"/);
});

test("list_social_accounts exposes cached accounts, defaults and live refresh", () => {
  const listAccounts = mcp.slice(mcp.indexOf('case "list_social_accounts"'), mcp.indexOf('case "set_publish_defaults"'));
  assert.match(listAccounts, /knownAccounts/);
  assert.match(listAccounts, /brandDefaultAccountIds: cfg\.brandAccounts/);
  assert.match(listAccounts, /integrations\/social\/\$\{p\}\/accounts/);
});

test("list_calendar_entries filters by one brand or a multi-brand union", () => {
  assert.match(mcp, /brandIds: \{ type: "array", items: \{ type: "string" \}/);
  assert.match(mcp, /\.in\("brand_id", params\.brandIds/);
  assert.match(mcp, /\.eq\("brand_id", String\(params\.brandId\)\)/);
});

// ── The api side: one PUT, merge semantics ──

test("api PUT keeps other brands' defaults (per-brand merge, not replace)", () => {
  const routes = readRepo("api/src/routes/contentCalendar.ts");
  assert.match(routes, /brandAccounts = \{ \.\.\.saved \};/);
  assert.match(routes, /else delete brandAccounts\[brandId\];/);
});

// ── In-app agent: same gestures, same calendar ──

test("ChatFAB exposes the content family and the local viewport tools", () => {
  const fab = readRepo("src/components/ChatFAB.tsx");
  for (const name of [
    "list_calendar_entries", "add_content_idea", "update_content", "delete_content",
    "list_copy_recipes", "list_social_accounts", "set_publish_defaults", "publish_content",
    "editor_zoom", "editor_pan",
  ]) {
    assert.ok(fab.includes(`name: "${name}"`), `ChatFAB schema missing: ${name}`);
    assert.ok(fab.includes(`"${name}"`), `ChatFAB leader toolset missing: ${name}`);
  }
});

test("editor viewport tools execute locally, never through mcpCall", () => {
  const fab = readRepo("src/components/ChatFAB.tsx");
  const execute = fab.slice(
    fab.indexOf("async function executeToolCall"),
    fab.indexOf("/**\n * Spawn a subagent"),
  );
  assert.match(execute, /editor_zoom" \|\| name === "editor_pan/);
  assert.match(execute, /runEditorViewportTool\(name, args\)/);
  assert.doesNotMatch(execute, /mcpCall\(`?editor_/);
  assert.match(readRepo("src/lib/editorViewport.ts"), /futuraria:editor-viewport/);
});

test("EditorV2 zooms through the same handlers the trackpad uses", () => {
  const editor = readRepo("src/pages/EditorV2.tsx");
  const at = editor.indexOf("futuraria:editor-viewport");
  const effect = editor.slice(at - 300, at + 700);
  assert.match(effect, /handleZoomToFit\(\)/);
  assert.match(effect, /handleZoomSet\(detail\.zoom\)/);
});

test("InfiniteHtmlCanvas pans through the same setPan as two-finger scroll", () => {
  const canvas = readRepo("src/components/InfiniteHtmlCanvas.tsx");
  assert.match(canvas, /detail\.type !== "pan"/);
  assert.match(canvas, /p\.x \+ \(Number\(detail\.dx\) \|\| 0\)/);
  assert.match(canvas, /p\.y \+ \(Number\(detail\.dy\) \|\| 0\)/);
});
