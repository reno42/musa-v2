// ═══════════════════════════════════════════════════════════════
// test_batch_generation.mjs — End-to-end tests for batch CSV tools
//
// Tests:
//   T1 – profile_template_pool: profiles N templates, returns columns
//   T2 – generate_csv_template: CSV with _template column + comments
//   T3 – apply_csv_to_frames: CSV → new output template with frames
//
// Run: node QA/test_batch_generation.mjs
// ═══════════════════════════════════════════════════════════════

const BASE = process.env.MCP_URL || "https://design.futuraria.com/mcp";
const API_KEY = process.env.API_KEY || "dev-key";

let testResults = { passed: 0, failed: 0, total: 0 };
const createdResources = { workspaces: [], templates: [] };

function record(name, ok, detail) {
  testResults.total++;
  if (ok) {
    testResults.passed++;
    console.log(`  ✅ ${name}`);
  } else {
    testResults.failed++;
    console.log(`  ❌ ${name} — ${detail || "failed"}`);
  }
}

async function mcpCall(tool, args = {}) {
  const res = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({
      jsonrpc: "2.0", id: Date.now(),
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "MCP error");
  try {
    return JSON.parse(json.result.content[0].text);
  } catch {
    return json.result.content[0].text;
  }
}

async function setup() {
  console.log("\n── Setup ──");

  // Create workspace
  const ws = await mcpCall("create_workspace", { name: "Batch Test — " + Date.now() });
  createdResources.workspaces.push(ws.id);
  record("Create workspace", !!ws.id, ws.id);
  const wsId = ws.id;

  // Create Template A: multi-block (headline + body + image + cta)
  const tplA = await mcpCall("create_template", {
    name: "News — Multi Block",
    workspaceId: wsId,
    width: 1080, height: 1350,
    engine: "html",
    html: `<div class="news-card">
  <h1 class="title" data-slot="headline">Sample Headline</h1>
  <p class="desc" data-slot="body">This is the body text of the news article. It contains multiple sentences to demonstrate text capacity estimation.</p>
  <img class="hero" data-slot="hero_image" src="" alt="Hero" style="width:100%;height:400px;object-fit:cover;" />
  <p class="cta-text" data-slot="cta">Read More →</p>
</div>`,
    css: `.news-card { font-family: sans-serif; padding: 40px; } .title { font-size: 32px; color: #1a1a2e; } .desc { font-size: 16px; color: #333; line-height: 1.6; } .cta-text { font-size: 14px; color: #e94560; font-weight: bold; }`,
  });
  createdResources.templates.push(tplA.id);
  record("Create template A (Multi Block)", !!tplA.id, tplA.id);

  // Create Template B: compact (headline + body only)
  const tplB = await mcpCall("create_template", {
    name: "News — Compact",
    workspaceId: wsId,
    width: 1080, height: 600,
    engine: "html",
    html: `<div class="compact-card">
  <h2 class="title" data-slot="headline">Compact Title</h2>
  <p class="desc" data-slot="body">Short description for compact layout.</p>
</div>`,
    css: `.compact-card { font-family: sans-serif; padding: 30px; } .title { font-size: 24px; color: #1a1a2e; } .desc { font-size: 14px; color: #555; }`,
  });
  createdResources.templates.push(tplB.id);
  record("Create template B (Compact)", !!tplB.id, tplB.id);

  return { workspaceId: wsId, tplAId: tplA.id, tplBId: tplB.id };
}

async function testProfilePool(ctx) {
  console.log("\n── T1: profile_template_pool ──");

  const result = await mcpCall("profile_template_pool", {
    templateIds: [ctx.tplAId, ctx.tplBId],
  });

  record("Has profiles array", Array.isArray(result.profiles) && result.profiles.length === 2);
  record("Has csvColumns", Array.isArray(result.csvColumns) && result.csvColumns.length > 0);
  record("Template count = 2", result.templateCount === 2);
  record("Deterministic flag", result._deterministic === true);

  // Check that multi-block template has more slots
  const tplAProfile = result.profiles.find(p => p.frameId);
  record("Template A has slots", tplAProfile && tplAProfile.slots.length > 0);

  // Check column names include data-slot names
  const colNames = result.csvColumns.map(c => c.name);
  record("CSV columns include 'headline'", colNames.includes("headline"));
  record("CSV columns include 'body'", colNames.includes("body"));

  console.log("  Profile columns:", colNames.join(", "));
  return result;
}

async function testGenerateCSV(ctx) {
  console.log("\n── T2: generate_csv_template ──");

  const result = await mcpCall("generate_csv_template", {
    templateIds: [ctx.tplAId, ctx.tplBId],
    rowCount: 5,
    delimiter: ",",
  });

  record("Has csv string", typeof result.csv === "string" && result.csv.length > 0);
  record("Has columns array", Array.isArray(result.columns) && result.columns.includes("_template"));
  record("Has templateNames", typeof result.templateNames === "object" && Object.keys(result.templateNames).length === 2);
  record("Row count = 5", result.rowCount === 5);
  record("Deterministic flag", result._deterministic === true);

  // CSV structure check
  const lines = result.csv.split("\n");
  const header = lines.filter(l => l && !l.startsWith("#"))[0];
  record("_template is first column", header && header.split(",")[0].trim() === "_template");

  // Template names in comments
  const comments = lines.filter(l => l.startsWith("#"));
  record("Comments mention template IDs", comments.some(c => c.includes(ctx.tplAId)));
  record("Comments mention template names", comments.some(c => c.includes("News")));

  console.log("  CSV header:", header);
  return result;
}

async function testApplyCSV(ctx, poolResult) {
  console.log("\n── T3: apply_csv_to_frames ──");

  // Build CSV string manually (simulating human-filled CSV)
  const columns = poolResult.csvColumns.map(c => c.name);
  const csvLines = [
    `_template,${columns.join(",")}`,
    `${ctx.tplAId},"Breaking News: System Works","This is the first generated article body text for testing the batch system. It should appear in the multi-block template.", "https://example.com/image1.jpg", "Learn More"`,
    `${ctx.tplBId},"Compact Update","Short update for compact layout.", "", ""`,
    `${ctx.tplAId},"Second Article","Another article body text here for the second post in the batch.", "https://example.com/image2.jpg", "Read Article"`,
  ];
  const csvData = csvLines.join("\n");

  const result = await mcpCall("apply_csv_to_frames", {
    workspaceId: ctx.workspaceId,
    csvData: csvData,
    templateIds: [ctx.tplAId, ctx.tplBId],
    outputName: "Batch Test Output",
    naming: "Post {index} — {headline}",
    onMissingTemplate: "error",
    onOverflow: "truncate",
  });

  record("Output template created", !!result.outputTemplateId);
  record("Workspace matches", result.workspaceId === ctx.workspaceId);
  record("Total rows = 3", result.totalRows === 3);
  record("Generated frames = 3", result.generatedFrames === 3);
  record("Skipped rows = 0", result.skippedRows === 0);
  record("Deterministic flag", result._deterministic === true);
  record("Has report array", Array.isArray(result.report) && result.report.length === 3);

  // Verify frame names
  const frameNames = result.report.map(r => r.name);
  record("Frame 1 named with headline", frameNames[0] && frameNames[0].includes("Breaking News"));
  record("Frame 2 named with headline", frameNames[1] && frameNames[1].includes("Compact Update"));

  // Verify content was actually applied by reading the output template
  const outputTpl = await mcpCall("get_template", { id: result.outputTemplateId });
  record("Output template has frames", Array.isArray(outputTpl.frames) && outputTpl.frames.length === 3);

  // Check first frame's HTML contains the applied headline
  const firstFrame = outputTpl.frames[0];
  record("Frame 1 HTML contains headline text", firstFrame.html && firstFrame.html.includes("Breaking News: System Works"));
  record("Frame 1 HTML contains body text", firstFrame.html && firstFrame.html.includes("first generated article body text"));
  record("Frame 1 HTML contains image src", firstFrame.html && firstFrame.html.includes("example.com/image1.jpg"));

  // Check second frame (compact)
  const secondFrame = outputTpl.frames[1];
  record("Frame 2 has correct name", secondFrame.name && secondFrame.name.includes("Compact Update"));
  record("Frame 2 HTML contains headline", secondFrame.html && secondFrame.html.includes("Compact Update"));

  console.log("  Output template:", result.outputTemplateId);
  console.log("  Report:", JSON.stringify(result.report.map(r => ({ row: r.row, status: r.status, name: r.name })), null, 2));

  return result;
}

async function cleanup() {
  console.log("\n── Cleanup ──");

  // Delete templates (workspace deletion not exposed as MCP tool)
  for (const tplId of createdResources.templates) {
    try { await mcpCall("delete_template", { id: tplId }); } catch { /* ok */ }
  }
  console.log("  Cleaned up:", createdResources.templates.length, "templates");
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║  Batch CSV Tools — Integration Tests    ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("MCP URL:", BASE);

  try {
    const ctx = await setup();

    // T1: Profile template pool
    const poolResult = await testProfilePool(ctx);

    // T2: Generate CSV template
    await testGenerateCSV(ctx);

    // T3: Apply CSV to frames
    await testApplyCSV(ctx, poolResult);

    await cleanup();
  } catch (err) {
    console.error("\n❌ FATAL:", err.message);
    testResults.failed++;
  }

  // Summary
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  Results: ${testResults.passed}/${testResults.total} passed`);
  if (testResults.failed > 0) {
    console.log(`  ❌ ${testResults.failed} failed`);
    process.exit(1);
  } else {
    console.log(`  ✅ ALL PASSED`);
    process.exit(0);
  }
}

main();
