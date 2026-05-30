/**
 * Integration test: MCP Phase 1-5 features
 */
const BASE = "https://bejewelled-llama-a6719d.netlify.app/mcp";

async function mcp(method, params) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  const text = json.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : json.result;
}

async function main() {
  let passed = 0, failed = 0;
  const ok = (label, cond) => { if (cond) { passed++; console.log(`  ✅ ${label}`); } else { failed++; console.log(`  ❌ ${label}`); } };

  // Setup
  console.log("── Setup ──");
  const ws = await mcp("tools/call", { name: "create_workspace", arguments: { name: "Test MCP" } });
  console.log(`  Workspace: ${ws.id}`);

  const tplA = await mcp("tools/call", { name: "create_template", arguments: { name: "Test A", workspaceId: ws.id } });
  const idA = typeof tplA === "string" ? tplA : tplA.id;
  console.log(`  Template A: ${idA}`);

  // Test 1: Text with Google Font, underline, letterSpacing, lineHeight, shadow
  console.log("\n── Test 1: Text properties ──");
  await mcp("tools/call", { name: "update_template", arguments: {
    id: idA,
    objects: [{
      type: "Textbox", text: "Hello World!", fontFamily: "Montserrat", fontWeight: 700, fontStyle: "italic",
      underline: true, charSpacing: 4, lineHeight: 1.5, fontSize: 48, fill: "#111111",
      left: 100, top: 100, width: 400,
      shadow: { color: "rgba(0,0,0,0.3)", blur: 8, offsetX: 3, offsetY: 3, affectStroke: false }
    }]
  }});

  const tpl1 = await mcp("tools/call", { name: "get_template", arguments: { id: idA } });
  const text = (tpl1.canvas?.objects || [])[0];
  ok("type is Textbox", text?.type === "Textbox");
  ok("fontFamily", text?.fontFamily === "Montserrat");
  ok("fontWeight 700", text?.fontWeight === 700);
  ok("underline true", text?.underline === true);
  ok("charSpacing 4", text?.charSpacing === 4);
  ok("lineHeight 1.5", text?.lineHeight === 1.5);
  ok("shadow blur 8", text?.shadow?.blur === 8);

  // Test 2: Rect with gradient + box shadow
  console.log("\n── Test 2: Rect gradient + shadow ──");
  await mcp("tools/call", { name: "update_template", arguments: {
    id: idA,
    canvas: { objects: [
      { type: "Rect", left: 50, top: 200, width: 300, height: 200, rx: 16, ry: 16,
        fill: { type: "linear", gradientUnits: "percentage", coords: { x1: 0, y1: 0, x2: 1, y2: 1 },
          colorStops: [{ offset: 0, color: "#4ade80" }, { offset: 1, color: "#7c3aed" }] },
        shadow: { color: "rgba(124,58,237,0.4)", blur: 20, offsetX: 0, offsetY: 8, affectStroke: false } }
    ], viewport: { x: 0, y: 0, zoom: 1 } }
  }});

  const tpl2 = await mcp("tools/call", { name: "get_template", arguments: { id: idA } });
  const rect = (tpl2.canvas?.objects || [])[0];
  ok("type is Rect", rect?.type === "Rect");
  ok("fill is gradient", rect?.fill?.type === "linear");
  ok("gradient stop 1", rect?.fill?.colorStops?.[0]?.color === "#4ade80");
  ok("gradient stop 2", rect?.fill?.colorStops?.[1]?.color === "#7c3aed");
  ok("border radius rx", rect?.rx === 16);
  ok("shadow blur 20", rect?.shadow?.blur === 20);

  // Test 3: batch_update
  console.log("\n── Test 3: batch_update ──");
  const tplB = await mcp("tools/call", { name: "create_template", arguments: { name: "Test B", workspaceId: ws.id } });
  const idB = typeof tplB === "string" ? tplB : tplB.id;
  console.log(`  Template B: ${idB}`);

  const batchRes = await mcp("tools/call", { name: "batch_update", arguments: {
    templateIds: [idA, idB],
    name: "Batch Updated"
  }});
  ok("batch 2 updated", batchRes.updated === 2);
  ok("batch 0 failed", batchRes.failed === 0);
  console.log(`     ${batchRes.updated} updated, ${batchRes.failed} failed`);

  // Test 4: render_batch
  console.log("\n── Test 4: render_batch ──");
  const renderRes = await mcp("tools/call", { name: "render_batch", arguments: {
    templateIds: [idA], format: "png", scale: 1
  }});
  ok("render ready", renderRes.ready >= 1);
  if (renderRes.results?.[0]?._links) {
    console.log(`     Link: ${renderRes.results[0]._links.render}`);
  }

  // Test 5: list_versions / restore_version
  console.log("\n── Test 5: versions ──");
  const vers = await mcp("tools/call", { name: "list_versions", arguments: { id: idA } });
  ok("list_versions returns", Array.isArray(vers?.versions));
  console.log(`     ${vers.versions?.length || 0} versions`);

  console.log(`\n── ${passed} passed, ${failed} failed ──`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
