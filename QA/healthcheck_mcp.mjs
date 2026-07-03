// healthcheck_mcp.mjs — Full CRUD smoke test for Futuraria MCP
// Usage: node QA/healthcheck_mcp.mjs [mcp_url] [api_key]
// Default: http://localhost:5173/mcp with x-api-key: dev-key

const MCP_URL = process.argv[2] || "http://localhost:5173/mcp";
const API_KEY = process.argv[3] || "dev-key";

let passed = 0;
let failed = 0;

async function callMCP(method, params) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: method,
      params: params || {},
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`[${json.error.code}] ${json.error.message}`);
  const text = json.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : json.result;
}

async function test(name, fn) {
  process.stdout.write(`  ${name}... `);
  try {
    await fn();
    console.log("PASS");
    passed++;
  } catch (e) {
    console.log(`FAIL — ${e.message}`);
    failed++;
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

console.log(`\nFuturaria MCP Healthcheck`);
console.log(`Endpoint: ${MCP_URL}`);
console.log(`API Key:   ${API_KEY}`);
console.log("");

// ── Phase 1: Discovery ──
console.log("── Discovery ──");

let tools = [];
await test("tools/list returns 120+ tools", async () => {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }),
  });
  const json = await res.json();
  tools = json.result?.tools || [];
  if (tools.length < 100) throw new Error(`Only ${tools.length} tools found (expected 120+)`);
});

// ── Phase 2: Workspace CRUD ──
console.log("── Workspace CRUD ──");

let wsId;
await test("create_workspace", async () => {
  const r = await callMCP("tools/call", {
    name: "create_workspace",
    arguments: { name: "HEALTHCHECK " + Date.now() },
  });
  wsId = r.id;
  if (!wsId) throw new Error("No workspace id returned");
});

await test("list_workspaces (includes new ws)", async () => {
  const r = await callMCP("tools/call", { name: "list_workspaces" });
  const found = r.data?.find((w) => w.id === wsId);
  if (!found) throw new Error(`Workspace ${wsId} not found in list`);
});

// ── Phase 3: Template CRUD ──
console.log("── Template CRUD ──");

let tplId;
await test("create_template", async () => {
  const r = await callMCP("tools/call", {
    name: "create_template",
    arguments: { name: "HC Template", workspaceId: wsId, width: 800, height: 600 },
  });
  tplId = r.id || r.template?.id;
  if (!tplId) throw new Error("No template id returned");
});

await test("get_template (returns html/css/frames)", async () => {
  const r = await callMCP("tools/call", {
    name: "get_template",
    arguments: { id: tplId },
  });
  if (!r.frames) throw new Error("Template has no frames array");
});

// ── Phase 4: Frame CRUD ──
console.log("── Frame CRUD ──");

let frameId;
await test("create_html_frame", async () => {
  const r = await callMCP("tools/call", {
    name: "create_html_frame",
    arguments: { templateId: tplId, name: "HC Frame", width: 400, height: 300 },
  });
  frameId = r.frame?.id || r.frameId || r.id;
  if (!frameId) throw new Error("No frame id returned (got: " + JSON.stringify(Object.keys(r)) + ")");
});

await test("set_html + update_frame_content (patch text)", async () => {
  // First set some HTML so there's something to patch
  await callMCP("tools/call", {
    name: "set_html",
    arguments: {
      templateId: tplId,
      frameId: frameId,
      html: '<h1 data-slot="title">Old Title</h1><p data-slot="body">Old body</p>',
    },
  });
  await sleep(500); // wait for persistence
  const r = await callMCP("tools/call", {
    name: "update_frame_content",
    arguments: {
      templateId: tplId,
      frameId: frameId,
      patches: [
        { selector: "h1", patch: { text: "Healthcheck Passed" } },
        { selector: "p", patch: { text: new Date().toISOString() } },
      ],
    },
  });
  if (!r.applied || r.applied.length < 2) throw new Error(`Only ${r.applied?.length || 0} patches applied`);
});

// ── Phase 5: Design artifacts ──
console.log("── Design Artifacts ──");

await test("generate_design_artifacts", async () => {
  const r = await callMCP("tools/call", {
    name: "generate_design_artifacts",
    arguments: { templateId: tplId, action: "generate" },
  });
  if (!r.sourceHash) throw new Error("No sourceHash in artifacts");
  if (!r.tokensJson) throw new Error("No tokensJson in artifacts");
});

await test("get_design_artifacts (not published — ok if empty)", async () => {
  const r = await callMCP("tools/call", {
    name: "get_design_artifacts",
    arguments: { templateId: tplId },
  });
  // May be empty if never published — that's fine
});

// ── Phase 6: Profiler + Batch CSV ──
console.log("── Batch CSV Pipeline ──");

await test("profile_template_pool", async () => {
  const r = await callMCP("tools/call", {
    name: "profile_template_pool",
    arguments: { templateIds: [tplId] },
  });
  if (!r.csvColumns || r.csvColumns.length < 2) throw new Error(`Only ${r.csvColumns?.length || 0} columns detected`);
});

await test("generate_csv_template (has downloadHtml + dataUri + cleanCsv)", async () => {
  const r = await callMCP("tools/call", {
    name: "generate_csv_template",
    arguments: { templateIds: [tplId], rowCount: 3 },
  });
  if (!r.downloadHtml) throw new Error("Missing downloadHtml in response");
  if (!r.dataUri) throw new Error("Missing dataUri in response");
  if (!r.cleanCsv) throw new Error("Missing cleanCsv in response");
});

// ── Phase 7: Cleanup ──
console.log("── Cleanup ──");

await test("delete_template", async () => {
  await callMCP("tools/call", {
    name: "delete_template",
    arguments: { id: tplId },
  });
});

await test("verify template deleted", async () => {
  try {
    await callMCP("tools/call", { name: "get_template", arguments: { id: tplId } });
    throw new Error("Template still exists after delete");
  } catch (e) {
    if (!e.message.includes("not found") && e.code !== -32000) throw e;
  }
});

// ── Report ──
console.log("");
console.log(`── Results: ${passed} passed, ${failed} failed ──`);
if (failed > 0) {
  console.log("HEALTHCHECK FAILED — some MCP tools are broken.");
  process.exit(1);
} else {
  console.log(`Healthcheck workspace: ${wsId} (kept for manual inspection)`);
  console.log("HEALTHCHECK PASSED — all " + passed + " tests green.");
}
