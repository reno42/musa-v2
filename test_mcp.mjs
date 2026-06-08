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

  // Test 6: Canvas navigation (pan + zoom)
  console.log("\n── Test 6: Canvas navigation ──");
  const panRes = await mcp("tools/call", { name: "canvas_pan", arguments: { templateId: idA, x: 100, y: 200 } });
  ok("canvas_pan absolute", panRes.viewport?.x === 100 && panRes.viewport?.y === 200);
  const panDelta = await mcp("tools/call", { name: "canvas_pan", arguments: { templateId: idA, deltaX: 50, deltaY: -30 } });
  ok("canvas_pan delta", panDelta.viewport?.x === 150 && panDelta.viewport?.y === 170);
  const zoomRes = await mcp("tools/call", { name: "canvas_zoom", arguments: { templateId: idA, zoom: 1.5 } });
  ok("canvas_zoom absolute", zoomRes.viewport?.zoom === 1.5);
  const zoomDelta = await mcp("tools/call", { name: "canvas_zoom", arguments: { templateId: idA, delta: -0.5 } });
  ok("canvas_zoom delta", zoomDelta.viewport?.zoom === 1.0);

  // Test 7: Canvas controls (grid, rulers, snap)
  console.log("\n── Test 7: Canvas controls ──");
  const gridRes = await mcp("tools/call", { name: "canvas_grid", arguments: { templateId: idA, gridSize: 16, visible: true, snapToGrid: true, color: "#4488ff" } });
  ok("canvas_grid gridSize 16", gridRes.gridSize === 16);
  ok("canvas_grid visible", gridRes.visible === true);
  ok("canvas_grid snap", gridRes.snapToGrid === true);
  const rulersRes = await mcp("tools/call", { name: "canvas_rulers", arguments: { templateId: idA, visible: true } });
  ok("canvas_rulers visible", rulersRes.visible === true);
  const snapRes = await mcp("tools/call", { name: "canvas_snap", arguments: { templateId: idA, enabled: true, snapThreshold: 8 } });
  ok("canvas_snap enabled", snapRes.enabled === true);

  // Test 8: Color picker
  console.log("\n── Test 8: Color picker ──");
  const colorParse = await mcp("tools/call", { name: "color_picker", arguments: { color: "#cba6f7" } });
  ok("color_picker parse hex", colorParse.hex === "#cba6f7" && colorParse.r === 203);
  const colorCompl = await mcp("tools/call", { name: "color_picker", arguments: { color: "#cba6f7", action: "complementary" } });
  ok("color_picker complementary", colorCompl.palette?.length >= 2);
  const colorTriad = await mcp("tools/call", { name: "color_picker", arguments: { color: "#cba6f7", action: "triadic" } });
  ok("color_picker triadic", colorTriad.palette?.length === 3);

  // Test 9: Components
  console.log("\n── Test 9: Components ──");
  // First add objects to create a component from
  await mcp("tools/call", { name: "update_template", arguments: { id: idA, canvas: { objects: [{ type: "Rect", layerName: "btn_bg", left: 0, top: 0, width: 120, height: 40, rx: 8, ry: 8, fill: "#89b4fa" }, { type: "text", layerName: "btn_label", left: 10, top: 10, width: 100, fontSize: 14, fontFamily: "Inter", fill: "#1e1e2e", text: "Click me" }], viewport: { x: 0, y: 0, zoom: 1 } } } });
  const compRes = await mcp("tools/call", { name: "create_component", arguments: { templateId: idA, name: "Button", objectIds: ["btn_bg", "btn_label"] } });
  ok("create_component", compRes.created === true && compRes.name === "Button");
  const compId = compRes.componentId;
  const instRes = await mcp("tools/call", { name: "create_instance", arguments: { templateId: idA, componentId: compId, x: 300, y: 100 } });
  ok("create_instance", instRes.created === true && instRes.componentId === compId);
  const varRes = await mcp("tools/call", { name: "add_variant", arguments: { templateId: idA, componentId: compId, name: "Secondary", overrides: { fill: "#45475a" } } });
  ok("add_variant", varRes.created === true && varRes.name === "Secondary");
  const propRes = await mcp("tools/call", { name: "set_component_prop", arguments: { templateId: idA, componentId: compId, propName: "visible", propType: "boolean", value: true } });
  ok("set_component_prop", propRes.updated === true && propRes.propName === "visible");

  // Test 10: Prototyping
  console.log("\n── Test 10: Prototyping ──");
  // Create target frame for interaction
  await mcp("tools/call", { name: "create_frame", arguments: { templateId: idA, name: "Target Frame", x: 0, y: 300, width: 400, height: 300 } });
  const framesList = await mcp("tools/call", { name: "list_frames", arguments: { templateId: idA } });
  const targetFrameId = framesList.frames?.find(f => f.name === "Target Frame")?.id;
  ok("frame created for interaction", !!targetFrameId);
  if (targetFrameId) {
    const iactRes = await mcp("tools/call", { name: "add_interaction", arguments: { templateId: idA, sourceId: targetFrameId, trigger: "onClick", action: "navigate", targetId: idA, transition: "dissolve", duration: 400 } });
    ok("add_interaction", iactRes.created === true && iactRes.trigger === "onClick");
  }
  const animRes = await mcp("tools/call", { name: "set_animation", arguments: { templateId: idA, objectId: targetFrameId || idA, type: "fade", duration: 500, easing: "easeInOut" } });
  ok("set_animation", animRes.created === true);
  const overlayRes = await mcp("tools/call", { name: "add_overlay", arguments: { templateId: idA, frameId: targetFrameId || idA, position: "center", backdrop: true } });
  ok("add_overlay", overlayRes.updated === true);
  const scrollRes = await mcp("tools/call", { name: "set_scroll_position", arguments: { templateId: idA, objectId: targetFrameId || idA, behavior: "fixed" } });
  ok("set_scroll_position", scrollRes.behavior === "fixed");

  // Test 11: Paper-like blocks
  console.log("\n── Test 11: Paper-like blocks ──");
  const toggleRes = await mcp("tools/call", { name: "add_toggle", arguments: { templateId: idA, title: "FAQ Section", content: "This is hidden content", expanded: true } });
  ok("add_toggle expanded", toggleRes.created === true && toggleRes.expanded === true);
  const calloutRes = await mcp("tools/call", { name: "add_callout", arguments: { templateId: idA, type: "tip", title: "Pro Tip", text: "Use Keyboard shortcuts!" } });
  ok("add_callout tip", calloutRes.created === true && calloutRes.type === "tip");
  const quoteRes = await mcp("tools/call", { name: "add_quote", arguments: { templateId: idA, text: "Design is not just what it looks like", author: "Steve Jobs", source: "Apple" } });
  ok("add_quote with author", quoteRes.created === true && quoteRes.author === "Steve Jobs");

  // Test 12: Markdown + Gallery
  console.log("\n── Test 12: Markdown + Gallery ──");
  const mdRes = await mcp("tools/call", { name: "render_markdown", arguments: { templateId: idA, markdown: "# Title\n## Subtitle\n- Item 1\n- Item 2\n\nParagraph text here." } });
  ok("render_markdown", mdRes.rendered === true && mdRes.blocks >= 5);
  const galleryRes = await mcp("tools/call", { name: "gallery_create", arguments: { templateId: idA, images: [{ url: "https://picsum.photos/200" }, { url: "https://picsum.photos/201" }, { url: "https://picsum.photos/202", caption: "Sunset" }], columns: 2, imageWidth: 150, imageHeight: 150 } });
  ok("gallery_create", galleryRes.created === true && galleryRes.images === 3 && galleryRes.columns === 2);

  // Test 13: History (undo/redo)
  console.log("\n── Test 13: History ──");
  const undoRes = await mcp("tools/call", { name: "history_undo", arguments: { templateId: idA } });
  ok("history_undo returns", undoRes?.steps !== undefined || undoRes !== undefined);

  // Test 14: Canvas pages
  console.log("\n── Test 14: Canvas pages ──");
  const pagesRes = await mcp("tools/call", { name: "canvas_pages", arguments: { templateId: idA, action: "list" } });
  ok("canvas_pages list", Array.isArray(pagesRes?.pages));
  const pageAdd = await mcp("tools/call", { name: "canvas_pages", arguments: { templateId: idA, action: "add", name: "Page 2" } });
  ok("canvas_pages add", pageAdd?.pages?.length >= 2 || pageAdd?.created === true);

  // Test 15: Libraries & Auth
  console.log("\n── Test 15: Libraries & Auth ──");
  const libRes = await mcp("tools/call", { name: "publish_library", arguments: { templateId: idA, name: "Brand Kit", description: "Core design tokens" } });
  ok("publish_library", libRes.published === true && libRes.name === "Brand Kit");
  const regRes = await mcp("tools/call", { name: "register_tool", arguments: { name: "plugin_hello", description: "Test plugin", inputSchema: { type: "object", properties: {}, required: [] }, handler: "https://example.com/webhook" } });
  ok("register_tool", regRes.registered === true && regRes.name === "plugin_hello");
  const tokenRes = await mcp("tools/call", { name: "auth_token", arguments: { userId: "dev_user_default", name: "CI Token", scopes: ["read", "write"] } });
  ok("auth_token created", tokenRes.created === true && tokenRes.scopes?.includes("read"));

  // Test 16: Google Fonts search
  console.log("\n── Test 16: Google Fonts ──");
  const fontsRes = await mcp("tools/call", { name: "search_google_fonts", arguments: { search: "Inter", limit: 5 } });
  ok("search_google_fonts returns fonts", Array.isArray(fontsRes?.fonts) && fontsRes.fonts.length > 0);
  ok("search_google_fonts has categories", Array.isArray(fontsRes?.categories));

  console.log(`\n── ${passed} passed, ${failed} failed ──`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
