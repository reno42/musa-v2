// MCP Test Suite - Tests all 10 tools
const BASE = "https://bejewelled-llama-a6719d.netlify.app/mcp";

async function call(method, params = {}, id = 1) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return res.json();
}

let passed = 0;
let failed = 0;
const bugs = [];

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; bugs.push(msg); console.log(`  ❌ ${msg}`); }
}

// ---- Init ----
console.log("\n=== INIT ===\n");
const init = await call("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "test", version: "1.0" },
});
assert(init?.result?.serverInfo?.name === "futuraria-mcp", "Initialize returns server info");

const toolsRes = await call("tools/list");
const tools = toolsRes?.result?.tools || [];
console.log(`  Tools listed: ${tools.length}`);
assert(tools.length === 10, "tools/list returns 10 tools");

// ---- Workspaces ----
console.log("\n=== WORKSPACES ===\n");
let wsId = null;

const listWs = await call("tools/call", { name: "list_workspaces", arguments: {} });
assert(listWs?.result?.content?.[0]?.text, "list_workspaces returns content");
let wsData = [];
try { wsData = JSON.parse(listWs.result.content[0].text); } catch(e) {}
console.log(`  Workspaces found: ${wsData?.data?.length || wsData?.length || 0}`);

const testWsName = "MCP Test WS " + Date.now();
const createWs = await call("tools/call", { name: "create_workspace", arguments: { name: testWsName } });
let newWs = null;
try { newWs = JSON.parse(createWs?.result?.content?.[0]?.text || "null"); } catch(e) {}
assert(newWs?.id && newWs?.name === testWsName, "create_workspace creates workspace with correct name");
wsId = newWs?.id;
if (wsId) console.log(`  Created workspace: ${wsId}`);

// Re-list to confirm persistence
const listWs2 = await call("tools/call", { name: "list_workspaces", arguments: {} });
let wsData2 = [];
try { wsData2 = JSON.parse(listWs2.result.content[0].text); } catch(e) {}
const found = wsData2?.data?.find(w => w.id === wsId) || wsData2?.find(w => w.id === wsId);
assert(!!found, "list_workspaces returns newly created workspace");

// ---- Templates ----
console.log("\n=== TEMPLATES ===\n");
let tplId = null;

const createTpl = await call("tools/call", { name: "create_template", arguments: { name: "Test Template", workspaceId: wsId } });
let newTpl = null;
try { newTpl = JSON.parse(createTpl?.result?.content?.[0]?.text || "null"); } catch(e) {}
assert(newTpl?.id?.startsWith("tpl_"), "create_template returns tpl_ prefixed id");
assert(newTpl?.name === "Test Template", "create_template has correct name");
assert(newTpl?.workspaceId === wsId, "create_template has correct workspaceId");
assert(newTpl?.width === 1080 && newTpl?.height === 1080, "create_template default dimensions are 1080x1080");
tplId = newTpl?.id;
if (tplId) console.log(`  Created template: ${tplId}`);

// List templates
const listTpl = await call("tools/call", { name: "list_templates", arguments: { workspaceId: wsId } });
let listData = [];
try { listData = JSON.parse(listTpl?.result?.content?.[0]?.text || "null"); } catch(e) {}
assert(listData?.data?.length >= 1, "list_templates finds template in workspace");
assert(listData?.data?.some?.(t => t.id === tplId), "list_templates includes created template");

// Get template
const getTpl = await call("tools/call", { name: "get_template", arguments: { id: tplId } });
let getTplData = null;
try { getTplData = JSON.parse(getTpl?.result?.content?.[0]?.text || "null"); } catch(e) {}
assert(getTplData?.id === tplId, "get_template returns correct template");
assert(getTplData?.canvas?.objects !== undefined, "get_template has canvas.objects");
assert(getTplData?.frames !== undefined, "get_template has frames array");
assert(getTplData?.styles !== undefined, "get_template has styles array");
assert(getTplData?.variables !== undefined, "get_template has variables");

// Update template
const updateTpl = await call("tools/call", { name: "update_template", arguments: { id: tplId, name: "Updated Template" } });
let updTpl = null;
try { updTpl = JSON.parse(updateTpl?.result?.content?.[0]?.text || "null"); } catch(e) {}
assert(updTpl?.name === "Updated Template", "update_template changes name");

// Update with objects
const testObjects = [{ type: "rect", left: 100, top: 100, width: 200, height: 150, fill: "#ff0000", layerName: "red-box" }];
const updateObj = await call("tools/call", { name: "update_template", arguments: { id: tplId, objects: testObjects } });
let updObj = null;
try { updObj = JSON.parse(updateObj?.result?.content?.[0]?.text || "null"); } catch(e) {}
assert(updObj?.canvas?.objects?.length === 1, "update_template with objects adds objects to canvas");
assert(updObj?.canvas?.objects?.[0]?.fill === "#ff0000", "update_template objects have correct properties");

// Update with full canvas
const fullCanvas = { objects: testObjects, viewport: { x: 0, y: 0, zoom: 1 }, background: "#ffffff" };
const updateCanvas = await call("tools/call", { name: "update_template", arguments: { id: tplId, canvas: fullCanvas } });
let updCanvas = null;
try { updCanvas = JSON.parse(updateCanvas?.result?.content?.[0]?.text || "null"); } catch(e) {}
assert(updCanvas?.canvas?.background === "#ffffff", "update_template with canvas sets background");

// Duplicate template
const dupTpl = await call("tools/call", { name: "duplicate_template", arguments: { id: tplId, name: "Duplicate Copy" } });
let dup = null;
try { dup = JSON.parse(dupTpl?.result?.content?.[0]?.text || "null"); } catch(e) {}
assert(dup?.id !== tplId && dup?.id?.startsWith("tpl_"), "duplicate_template creates new template with different id");
assert(dup?.name === "Duplicate Copy", "duplicate_template uses provided name");
assert(dup?.canvas?.objects?.length >= 1, "duplicate_template preserves canvas objects");

// Export template
const expTpl = await call("tools/call", { name: "export_template", arguments: { id: tplId } });
let exp = null;
try { exp = JSON.parse(expTpl?.result?.content?.[0]?.text || "null"); } catch(e) {}
assert(exp?.format === "futuraria/v1", "export_template has correct format");
assert(exp?.template?.name !== undefined, "export_template has template.name");
assert(exp?.template?.canvas !== undefined, "export_template has template.canvas");

// Import template
const importTpl = await call("tools/call", { name: "import_template", arguments: { data: exp, workspaceId: wsId } });
let imp = null;
try { imp = JSON.parse(importTpl?.result?.content?.[0]?.text || "null"); } catch(e) {}
assert(imp?.id?.startsWith("tpl_"), "import_template creates template with valid id");
assert(imp?.name === exp.template.name, "import_template preserves name");
assert(imp?.workspaceId === wsId, "import_template sets workspaceId");

// Delete templates
const delDup = await call("tools/call", { name: "delete_template", arguments: { id: dup?.id } });
let delRes = null;
try { delRes = JSON.parse(delDup?.result?.content?.[0]?.text || "null"); } catch(e) {}
assert(delRes?.deleted === true, "delete_template confirms deletion");
assert(delRes?.id === dup?.id, "delete_template returns correct id");

const delImp = await call("tools/call", { name: "delete_template", arguments: { id: imp?.id } });
assert(delImp?.error === undefined && delImp?.result !== undefined, "delete_template works for imported template");

const delTpl = await call("tools/call", { name: "delete_template", arguments: { id: tplId } });
assert(delTpl?.error === undefined, "delete_template works for original template");

// Get deleted template - should fail
const getDel = await call("tools/call", { name: "get_template", arguments: { id: tplId } });
assert(getDel?.error?.code === -32000, "get_template returns error for deleted template");

// ---- Error Cases ----
console.log("\n=== ERROR CASES ===\n");

const badGet = await call("tools/call", { name: "get_template", arguments: { id: "tpl_nonexistent" } });
assert(badGet?.error?.code === -32000, "get_template returns -32000 for missing template");

const badCreate = await call("tools/call", { name: "create_template", arguments: { name: "NoWS" } });
assert(badCreate?.error?.code !== undefined, "create_template fails without workspaceId");

const badUpdate = await call("tools/call", { name: "update_template", arguments: {} });
assert(badUpdate?.error?.code === -32602, "update_template returns -32602 with no id");

const badDelete = await call("tools/call", { name: "delete_template", arguments: { id: "tpl_fake12345" } });
assert(badDelete?.error?.code === -32000, "delete_template returns -32000 for missing template");

const badDup = await call("tools/call", { name: "duplicate_template", arguments: { id: "tpl_nonexistent" } });
assert(badDup?.error?.code === -32000, "duplicate_template returns -32000 for missing source");

const badExp = await call("tools/call", { name: "export_template", arguments: { id: "tpl_nonexistent" } });
assert(badExp?.error?.code === -32000, "export_template returns -32000 for missing template");

const badImportFmt = await call("tools/call", { name: "import_template", arguments: { data: { format: "bad", template: { name: "x" } }, workspaceId: wsId } });
assert(badImportFmt?.error?.code === -32602, "import_template rejects invalid format");

const badImportNoName = await call("tools/call", { name: "import_template", arguments: { data: { format: "futuraria/v1", template: {} }, workspaceId: wsId } });
assert(badImportNoName?.error?.code === -32602, "import_template rejects missing template.name");

const unknownMethod = await call("tools/call", { name: "nonexistent_tool", arguments: {} });
assert(unknownMethod?.error?.code === -32601, "Unknown method returns -32601");

// ---- Summary ----
console.log(`\n=== RESULTS ===\n`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Score: ${passed}/${passed + failed}`);
if (bugs.length) {
  console.log(`\n🐛 BUGS FOUND:`);
  bugs.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));
}
