import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEEPSEEK_MAX_TOOLS,
  MAX_SUBAGENT_ROUNDS,
  buildWorkManifest,
  canParallelizeReadTools,
  captureArtifactIds,
  captureCreatedFrameCount,
  classifyHttpError,
  compactConversationAtomic,
  compactConversationForBudget,
  collectMutationStyleEvidence,
  createSerialPromiseQueue,
  evaluateCompleteness,
  estimateFullRequestTokens,
  extractVisibleText,
  extractStyleReferences,
  fetchWithRetry,
  formatDuration,
  formatTokens,
  parseToolArguments,
  parseReviewerVerdict,
  readProviderUsage,
  readAnthropicMessageStream,
  readOpenAiChatStream,
  responseStoppedIncomplete,
  sanitizeRuntimeText,
  selectProviderTools,
  serializeValidJson,
  toolResultForModel,
  validateDesignToolPayload,
  validateWorkContract,
} from "../src/lib/agentRuntime.ts";
import { buildHtmlCarousel } from "../netlify/functions/html-carousel.mjs";
import { applyBrandCss, applyBrandCssToFrames } from "../netlify/functions/brand-css.mjs";
import { assertHarnessAccess, selectLatestReviewSubmission } from "../netlify/functions/harness-access.mjs";

const SUBSTANTIAL_HTML = "<main><h1>Substantial final design content</h1></main>";
const SUBSTANTIAL_CSS = "main { display: grid; color: #111111; }";

function assertNoOrphanedOpenAiResults(messages) {
  const calls = new Set(messages.flatMap(message => message.tool_calls || []).map(call => call.id));
  for (const message of messages) {
    if (message.role === "tool") assert.ok(calls.has(message.tool_call_id), `orphaned ${message.tool_call_id}`);
  }
}

test("OpenAI tool calls and all tool results survive compaction atomically", () => {
  const messages = Array.from({ length: 18 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `turn ${index}` }));
  messages.push({ role: "assistant", content: null, tool_calls: [
    { id: "call_a", function: { name: "set_html", arguments: "{}" } },
    { id: "call_b", function: { name: "set_css", arguments: "{}" } },
  ] });
  messages.push({ role: "tool", tool_call_id: "call_a", content: "ok" });
  messages.push({ role: "tool", tool_call_id: "call_b", content: "ok" });
  messages.push({ role: "assistant", content: "finished" });

  const result = compactConversationAtomic(messages, {
    maxMessages: 8,
    preserveFirstMessages: 1,
    manifest: buildWorkManifest({ expectedTemplateCount: 1 }, ["tpl_one"]),
  });
  assert.equal(result.compacted, true);
  assertNoOrphanedOpenAiResults(result.messages);
  const kept = JSON.stringify(result.messages);
  assert.equal(kept.includes("call_a"), kept.includes("call_b"));
  assert.match(kept, /Work manifest/);
});

test("Anthropic assistant wrapper and grouped tool_results remain adjacent", () => {
  const assistant = { role: "assistant", content: [
    { type: "text", text: "working" },
    { type: "tool_use", id: "tool_a", name: "set_html", input: {} },
    { type: "tool_use", id: "tool_b", name: "set_css", input: {} },
  ] };
  const results = { role: "user", content: [
    { type: "tool_result", tool_use_id: "tool_a", content: "ok" },
    { type: "tool_result", tool_use_id: "tool_b", content: "ok" },
  ] };
  const messages = [
    { role: "user", content: "brief" },
    ...Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: `old ${index}` })),
    assistant,
    results,
  ];
  const compacted = compactConversationAtomic(messages, { maxMessages: 6, preserveFirstMessages: 1 }).messages;
  const assistantIndex = compacted.indexOf(assistant);
  assert.ok(assistantIndex >= 0);
  assert.equal(compacted[assistantIndex + 1], results);
});

test("early context compaction keeps the active request, tool results and artifact manifest", () => {
  const messages = [{ role: "user", content: "Create one carousel" }];
  for (let i = 0; i < 15; i++) {
    messages.push({ role: "assistant", content: null, tool_calls: [{ id: `call_${i}`, function: { name: "get_template", arguments: "{}" } }] });
    messages.push({ role: "tool", tool_call_id: `call_${i}`, content: "x".repeat(5_000) });
  }
  messages.push({ role: "user", content: "Make the final title red" });
  const manifest = buildWorkManifest({ expectedTemplateCount: 1 }, ["tpl_real"]);
  const before = estimateFullRequestTokens("system", messages, []);
  const result = compactConversationForBudget("system", messages, [], { maxTokens: 8_000, preserveFirstMessages: 1, manifest });
  assert.equal(result.compacted, true);
  assert.ok(result.inputTokens < before);
  assertNoOrphanedOpenAiResults(result.messages);
  const serialized = JSON.stringify(result.messages);
  assert.match(serialized, /Create one carousel/);
  assert.match(serialized, /Make the final title red/);
  assert.match(serialized, /tpl_real/);
});

test("read tool IDs are never captured as artifacts", () => {
  assert.deepEqual(captureArtifactIds("get_template", { templateId: "tpl_reference" }, { id: "tpl_reference" }), []);
});

test("parallel batches contain only independent reads", () => {
  assert.equal(canParallelizeReadTools(["get_template", "get_brand_guideline"]), true);
  assert.equal(canParallelizeReadTools(["get_template", "set_html"]), false);
  assert.equal(canParallelizeReadTools(["get_template", "musa_find_tools"]), false);
  assert.equal(canParallelizeReadTools(["get_template"]), false);
});

test("large lists are compacted only for the model", () => {
  const original = JSON.stringify({ entries: Array.from({ length: 90 }, (_, i) => ({ id: `cc_${i}`, caption: "x".repeat(600) })) });
  const modelView = toolResultForModel("list_calendar_entries", original);
  assert.ok(modelView.length < original.length);
  assert.ok(modelView.length <= 8_000);
  assert.match(modelView, /cc_0/);
  assert.equal(toolResultForModel("get_template", original), original);
});

test("provider usage includes cache hits without double counting totals", () => {
  const usage = readProviderUsage({ usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 60 } }, false);
  assert.equal(usage?.cachedInputTokens, 60);
  assert.equal(usage?.totalTokens, 120);
});

test("streamed text and fragmented tool arguments assemble before execution", async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Voy a "},"finish_reason":null}]}\n\n',
    'data: {"choices":[{"delta":{"content":"crear.","tool_calls":[{"index":0,"id":"call_1","function":{"name":"create_template","arguments":"{\\"name\\":\\""}}]},"finish_reason":null}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"Pieza\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":100,"completion_tokens":20}}\n\n',
    'data: [DONE]\n\n',
  ];
  const body = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } });
  const seen = [];
  const completion = await readOpenAiChatStream(new Response(body), delta => seen.push(delta));
  assert.equal(seen.join(""), "Voy a crear.");
  assert.equal(completion.choices[0].finish_reason, "tool_calls");
  assert.deepEqual(JSON.parse(completion.choices[0].message.tool_calls[0].function.arguments), { name: "Pieza" });
  assert.equal(completion.usage.prompt_tokens, 100);
});

test("interrupted stream cannot produce executable tool calls", async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"set_html","arguments":"{\\"html\\":"}}]},"finish_reason":null}]}\n\n')); controller.close(); } });
  await assert.rejects(() => readOpenAiChatStream(new Response(body)), /ended before completion/);
});

test("SSE parser accepts event boundaries split across byte chunks", async () => {
  const wire = 'data: {"choices":[{"delta":{"content":"Listo"},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n';
  const bytes = new TextEncoder().encode(wire);
  const body = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close(); } });
  const completion = await readOpenAiChatStream(new Response(body));
  assert.equal(completion.choices[0].message.content, "Listo");
});

test("Anthropic stream assembles text, tool JSON and usage before use", async () => {
  const events = [
    { type: "message_start", message: { usage: { input_tokens: 120, output_tokens: 1, cache_read_input_tokens: 40 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Listo" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tool_1", name: "create_template", input: {} } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"name":"' } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'Pieza"}' } },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 30 } },
    { type: "message_stop" },
  ];
  const wire = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\r\n\r\n`).join("");
  const bytes = new TextEncoder().encode(wire);
  const body = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } });
  const seen = [];
  const response = await readAnthropicMessageStream(new Response(body), text => seen.push(text));
  assert.equal(seen.join(""), "Listo");
  assert.equal(response.stop_reason, "tool_use");
  assert.deepEqual(response.content[1].input, { name: "Pieza" });
  assert.deepEqual(readProviderUsage(response, true), { inputTokens: 120, outputTokens: 30, totalTokens: 150, cachedInputTokens: 40 });
});

test("Anthropic interrupted tool stream cannot produce executable input", async () => {
  const wire = [
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool_1", name: "set_html", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"html":' } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("");
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(wire)); controller.close(); } });
  await assert.rejects(() => readAnthropicMessageStream(new Response(body)), /ended before completion/);
});

test("creator and mutation tools capture deliverable IDs", () => {
  assert.deepEqual(captureArtifactIds("create_html_template", {}, { id: "tpl_created" }), ["tpl_created"]);
  assert.deepEqual(captureArtifactIds("set_css", { templateId: "tpl_created" }, { success: true }), ["tpl_created"]);
});

test("creator results preserve real frame counts for work manifests", () => {
  assert.equal(captureCreatedFrameCount("create_html_carousel", { templateId: "tpl_one", totalFrames: 3 }), 3);
  assert.equal(captureCreatedFrameCount("create_deck", JSON.stringify({ templateId: "tpl_two", totalFrames: 4 })), 4);
  assert.equal(captureCreatedFrameCount("set_css", { totalFrames: 99 }), 0);
});

test("invalid or truncated tool args are not executable", () => {
  assert.equal(parseToolArguments('{"templateId":').ok, false);
  assert.equal(parseToolArguments("{}").ok, true);
});

test("subagent design payload validation rejects empty creation calls", () => {
  const blankTemplate = validateDesignToolPayload("create_html_template", { html: "<div></div>", css: "" });
  assert.equal(blankTemplate.ok, false);

  const blankDeck = validateDesignToolPayload("create_deck", { slides: [{ html: "", css: "" }] });
  assert.equal(blankDeck.ok, false);
});

test("a three-frame deck means one generated cover plus two content slides", () => {
  const slide = { html: SUBSTANTIAL_HTML, css: SUBSTANTIAL_CSS };
  assert.equal(validateDesignToolPayload("create_deck", { slides: [slide, slide] }, { expectedFrameCount: 3 }).ok, true);
  const tooMany = validateDesignToolPayload("create_deck", { slides: [slide, slide, slide] }, { expectedFrameCount: 3 });
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /would create 4 frames/);
});

test("custom carousel builder preserves exact 1080x1350 geometry for three frames", () => {
  let id = 0;
  const carousel = buildHtmlCarousel({
    workspaceId: "ws_one",
    name: "Social carousel",
    width: 1080,
    height: 1350,
    frames: [1, 2, 3].map(index => ({ name: `Slide ${index}`, html: SUBSTANTIAL_HTML, css: SUBSTANTIAL_CSS })),
  }, () => `frame_${++id}`);
  assert.equal(carousel.frames.length, 3);
  assert.deepEqual(carousel.frames.map(frame => [frame.x, frame.y, frame.width, frame.height]), [
    [0, 0, 1080, 1350],
    [1080, 0, 1080, 1350],
    [2160, 0, 1080, 1350],
  ]);
});

test("custom carousel validation rejects empty content before allocating or persisting", () => {
  let frameIdsAllocated = 0;
  assert.throws(() => buildHtmlCarousel({
    workspaceId: "ws_one",
    name: "Invalid carousel",
    width: 1080,
    height: 1350,
    frames: [
      { name: "Empty", html: "", css: "" },
      { name: "Valid", html: SUBSTANTIAL_HTML, css: SUBSTANTIAL_CSS },
    ],
  }, () => { frameIdsAllocated += 1; return `frame_${frameIdsAllocated}`; }), /html must contain at least 40 characters/);
  assert.equal(frameIdsAllocated, 0);
});

test("provider length stop is incomplete", () => {
  assert.equal(responseStoppedIncomplete({ choices: [{ finish_reason: "length" }] }, false), true);
  assert.equal(responseStoppedIncomplete({ stop_reason: "max_tokens" }, true), true);
  assert.equal(responseStoppedIncomplete({ choices: [{ finish_reason: "tool_calls" }] }, false), false);
});

test("subagent round budget is exactly 15", () => {
  assert.equal(MAX_SUBAGENT_ROUNDS, 15);
});

test("expected three templates but one artifact fails verification", () => {
  const result = evaluateCompleteness({
    contract: { expectedTemplateCount: 3 },
    artifacts: [{ id: "tpl_one", html: "<main>This is substantial real content for the requested post.</main>", css: "main { display: grid; color: black; }" }],
    madeMutationToolCall: true,
  });
  assert.equal(result.verification_failed, true);
  assert.match(result.errors.join(" "), /Expected 3 template\(s\), got 1/);
});

test("consulting a requested style does not prove it was applied", () => {
  const result = evaluateCompleteness({
    contract: { requiredStyle: "Futuraria" },
    artifacts: [{ id: "tpl_one", html: "<main>This mutation has substantial content but no applied brand.</main>", css: "main { display: grid; color: black; }", styleEvidence: [] }],
    madeMutationToolCall: true,
  });
  assert.equal(result.verification_failed, true);
  assert.match(result.errors.join(" "), /Missing style evidence: Futuraria/);
});

test("a consulted brands wrapper resolves carousel brandId to applied style name", () => {
  const consulted = extractStyleReferences({ brands: [{ id: "brand_1", name: "Futuraria" }] });
  assert.deepEqual(consulted, [{ id: "brand_1", name: "Futuraria" }]);
  const styleEvidence = collectMutationStyleEvidence(
    "create_html_carousel",
    { brandId: "brand_1" },
    consulted,
  );
  assert.deepEqual(styleEvidence, ["brand_1", "Futuraria"]);
  const result = evaluateCompleteness({
    contract: { requiredStyle: "Futuraria" },
    artifacts: [{
      id: "tpl_one",
      brandId: "brand_1",
      designArtifacts: { sharedCss: ":root { --brand: #123456; }" },
      html: SUBSTANTIAL_HTML,
      css: applyBrandCss(SUBSTANTIAL_CSS, "brand_1", ":root { --brand: #123456; }"),
      styleEvidence,
      styleReferences: consulted,
    }],
    madeMutationToolCall: true,
  });
  assert.equal(result.verification_failed, false);
});

test("style verification requires the same brand marker in every effective frame", () => {
  const sharedCss = ":root { --brand-color: #123456; }";
  const baseFrames = [1, 2, 3].map(() => ({ html: SUBSTANTIAL_HTML, css: SUBSTANTIAL_CSS }));
  const onlyDeclarative = evaluateCompleteness({
    contract: { requiredStyle: "Futuraria" },
    artifacts: [{ id: "tpl_white", frames: baseFrames, styleEvidence: ["Futuraria"] }],
    madeMutationToolCall: true,
  });
  assert.equal(onlyDeclarative.verification_failed, true);

  const brandedFrames = applyBrandCssToFrames(baseFrames, "brand_1", sharedCss);
  const complete = evaluateCompleteness({
    contract: { requiredStyle: "Futuraria" },
    artifacts: [{ id: "tpl_branded", brandId: "brand_1", designArtifacts: { sharedCss }, frames: brandedFrames, styleEvidence: ["Futuraria"], styleReferences: [{ id: "brand_1", name: "Futuraria" }] }],
    madeMutationToolCall: true,
  });
  assert.equal(complete.verification_failed, false);

  const missingOne = evaluateCompleteness({
    contract: { requiredStyle: "Futuraria" },
    artifacts: [{ id: "tpl_partial", brandId: "brand_1", designArtifacts: { sharedCss }, frames: [brandedFrames[0], baseFrames[1], brandedFrames[2]], styleEvidence: ["Futuraria"], styleReferences: [{ id: "brand_1", name: "Futuraria" }] }],
    madeMutationToolCall: true,
  });
  assert.equal(missingOne.verification_failed, true);
  assert.match(missingOne.errors.join(" "), /frame 2 is missing applied brand CSS marker/);
});

test("brand CSS application is idempotent and refuses empty sharedCss", () => {
  const once = applyBrandCss(SUBSTANTIAL_CSS, "brand_1", ":root { --brand: red; }");
  const twice = applyBrandCss(once, "brand_1", ":root { --brand: red; }");
  assert.equal(twice, once);
  assert.equal((twice.match(/futuraria-brand:brand_1:start/g) || []).length, 1);
  assert.throws(() => applyBrandCss(SUBSTANTIAL_CSS, "brand_1", ""), /has no sharedCss/);
});

test("apply_brand owns brand CSS transformation without contaminating duplicate_frame", () => {
  const source = readFileSync(new URL("../netlify/functions/mcp.mjs", import.meta.url), "utf8");
  const duplicateFrame = source.slice(source.indexOf('case "duplicate_frame"'), source.indexOf('case "update_frame_content"'));
  assert.doesNotMatch(duplicateFrame, /brand\.workspaceId|applyBrandCss/);
  const applyBrand = source.slice(source.indexOf('case "apply_brand_to_template"'), source.indexOf('case "get_active_styles"'));
  const tenantIndex = applyBrand.indexOf("brand.workspaceId !== tpl.workspaceId");
  const cssIndex = applyBrand.indexOf("brandedCss = applyBrandCss");
  const updateIndex = applyBrand.indexOf("templates.updateTemplate");
  assert.ok(tenantIndex >= 0 && tenantIndex < cssIndex);
  assert.ok(cssIndex >= 0 && cssIndex < updateIndex);
  assert.match(applyBrand, /brandedFrames = applyBrandCssToFrames/);
});

test("create contract enforces dimensions, per-frame text distribution and creator provenance", () => {
  assert.equal(validateWorkContract({ mode: "create", expectedTemplateCount: 1, expectedFrameCount: 3, requiredWidth: 1080, requiredHeight: 1350, requiredTexts: ["a", "b", "c"], requiredTextsByFrame: [["a"], ["b"], ["c"]], requiredStyle: "__free_style__" }).ok, true);
  assert.equal(validateWorkContract({ mode: "create", expectedFrameCount: 3, requiredWidth: 1080, requiredHeight: 1350, requiredTextsByFrame: [["a"]] }).ok, false);
  const artifacts = ["tpl_new", "tpl_old_1", "tpl_old_2"].map(id => ({ id, html: SUBSTANTIAL_HTML, css: SUBSTANTIAL_CSS }));
  const provenance = evaluateCompleteness({
    contract: { mode: "create", expectedTemplateCount: 3, requiredWidth: 1080, requiredHeight: 1350 },
    artifacts,
    createdArtifactIds: ["tpl_new"],
    madeMutationToolCall: true,
  });
  assert.equal(provenance.verification_failed, true);
  assert.match(provenance.errors.join(" "), /without creator provenance: tpl_old_1, tpl_old_2/);
});

test("create contract rejects every partial or malformed required field fail-closed", () => {
  const valid = { mode: "create", expectedTemplateCount: 1, expectedFrameCount: 1, requiredWidth: 1080, requiredHeight: 1350, requiredTexts: ["Hello"], requiredTextsByFrame: [["Hello"]], requiredStyle: "__free_style__" };
  assert.equal(validateWorkContract(valid).ok, true);
  for (const key of ["expectedTemplateCount", "expectedFrameCount", "requiredWidth", "requiredHeight", "requiredTexts", "requiredStyle"]) {
    const partial = { ...valid };
    delete partial[key];
    assert.equal(validateWorkContract(partial).ok, false, `missing ${key} must fail`);
  }
  assert.equal(validateWorkContract({ ...valid, expectedTemplateCount: 0 }).ok, false);
  assert.equal(validateWorkContract({ ...valid, expectedFrameCount: 1.5 }).ok, false);
  assert.equal(validateWorkContract({ ...valid, requiredWidth: 10001 }).ok, false);
  assert.equal(validateWorkContract({ ...valid, requiredTextsByFrame: [] }).ok, false);
  assert.equal(validateWorkContract({ ...valid, requiredStyle: "" }).ok, false);
  assert.equal(validateWorkContract({ mode: "edit", requiredWidth: -1 }).ok, false);
});

test("requested style must bind to the exact applied brandId", () => {
  const sharedCss = ":root { --brand: #123456; }";
  const css = applyBrandCss(SUBSTANTIAL_CSS, "brand_other", sharedCss);
  const base = { id: "tpl_one", brandId: "brand_other", designArtifacts: { sharedCss }, html: SUBSTANTIAL_HTML, css, styleEvidence: ["Futuraria", "brand_other"] };
  const mismatch = evaluateCompleteness({
    contract: { requiredStyle: "Futuraria" },
    artifacts: [{ ...base, styleReferences: [{ id: "brand_other", name: "Otra Marca" }, { id: "brand_futuraria", name: "Futuraria" }] }],
    madeMutationToolCall: true,
  });
  assert.equal(mismatch.verification_failed, true);
  assert.match(mismatch.errors.join(" "), /brand_other is not bound to requested style Futuraria/);
  const correct = evaluateCompleteness({
    contract: { requiredStyle: "Futuraria" },
    artifacts: [{ ...base, styleReferences: [{ id: "brand_other", name: "Futuraria_SocialMedia" }] }],
    madeMutationToolCall: true,
  });
  assert.equal(correct.verification_failed, false);
});

test("required text must be visible in its assigned frame, not hidden or in a placeholder", () => {
  assert.equal(extractVisibleText('<div style="display:none">Secret</div><input placeholder="Secret"><p>Visible</p>'), "Visible");
  const result = evaluateCompleteness({
    contract: { expectedFrameCount: 2, requiredTextsByFrame: [["Secret"], ["Second"]] },
    artifacts: [{ id: "tpl_one", frames: [
      { html: '<main><div style="opacity:0">Secret</div><p>Visible enough final text for this frame</p></main>', css: SUBSTANTIAL_CSS },
      { html: '<main><p>Second is visibly present in its proper frame</p></main>', css: SUBSTANTIAL_CSS },
    ] }],
    madeMutationToolCall: true,
  });
  assert.equal(result.verification_failed, true);
  assert.match(result.errors.join(" "), /Frame 1 is missing required text: Secret/);
});

test("hitting the round limit can never be success", () => {
  const result = evaluateCompleteness({ artifacts: [], madeMutationToolCall: true, hitRoundLimit: true });
  assert.equal(result.outcome, "verification_failed");
});

test("an unrelated HTTP 400 preserves its body and is not called context_limit", () => {
  const result = classifyHttpError(400, "Invalid tool schema: expected object");
  assert.equal(result.category, "bad_request");
  assert.equal(result.body, "Invalid tool schema: expected object");
});

test("JSON compaction always returns parseable JSON", () => {
  const serialized = serializeValidJson({ tokensJson: "x".repeat(50_000), styles: Array.from({ length: 200 }, (_, index) => ({ index, css: "y".repeat(500) })) }, 5_000);
  assert.doesNotThrow(() => JSON.parse(serialized));
  assert.ok(serialized.length <= 5_000);
});

test("full request estimation includes system prompt and tool schemas", () => {
  const messagesOnly = estimateFullRequestTokens("", [{ role: "user", content: "brief" }], []);
  const complete = estimateFullRequestTokens("s".repeat(4_000), [{ role: "user", content: "brief" }], [{ function: { name: "create", description: "d".repeat(4_000) } }]);
  assert.ok(complete > messagesOnly + 1_500);
});

test("DeepSeek toolset is deterministically capped and keeps required creation tools", () => {
  const tools = Array.from({ length: 180 }, (_, index) => ({ function: { name: `tool_${index}` } }));
  tools[150] = { function: { name: "create_deck" } };
  tools[151] = { function: { name: "get_active_styles" } };
  const selected = selectProviderTools(tools, "deepseek");
  assert.equal(selected.length, DEEPSEEK_MAX_TOOLS);
  assert.ok(selected.some(tool => tool.function.name === "create_deck"));
  assert.ok(selected.some(tool => tool.function.name === "get_active_styles"));
});

test("MCP rejects blank HTML template identity before persistence", () => {
  const source = readFileSync(new URL("../netlify/functions/mcp.mjs", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf('case "create_html_template"'), source.indexOf('case "set_html"'));
  assert.match(handler, /requires a non-empty name/);
  assert.match(handler, /requires workspaceId/);
  assert.ok(handler.indexOf("requires workspaceId") < handler.indexOf("templates.createTemplate"));
});

test("MCP completion gate requires explicit C1 through C5", () => {
  const source = readFileSync(new URL("../netlify/functions/mcp.mjs", import.meta.url), "utf8");
  const handler = source.slice(source.lastIndexOf('case "harness_complete_feature"'));
  assert.match(handler, /\["C1", "C2", "C3", "C4", "C5"\]/);
  assert.match(handler, /passed !== true/);
});

test("MCP carousel validates before persistence and prevents cross-workspace brand links", () => {
  const source = readFileSync(new URL("../netlify/functions/mcp.mjs", import.meta.url), "utf8");
  const handler = source.slice(source.indexOf('case "create_html_carousel"'), source.indexOf('case "create_deck"'));
  assert.ok(handler.indexOf("buildHtmlCarousel") < handler.indexOf("templates.createTemplate"));
  assert.match(handler, /linkedBrand\.workspaceId !== carousel\.workspaceId/);
  assert.match(handler, /code: -32003/);
});

test("service-role harness handlers enforce tenant access and fresh review lifecycle", () => {
  const source = readFileSync(new URL("../netlify/functions/mcp.mjs", import.meta.url), "utf8");
  const helper = readFileSync(new URL("../netlify/functions/harness-access.mjs", import.meta.url), "utf8");
  assert.match(helper, /auth\?\.isAdmin/);
  assert.match(helper, /canAccessWorkspace\(auth, task\.workspace_id\)/);
  assert.match(helper, /task\.workspace_id !== auth\.workspaceId/);
  for (const name of ["harness_dump_context", "harness_get_entries", "harness_evaluate_checkpoint", "harness_submit_for_review", "harness_complete_feature"]) {
    const start = source.indexOf(`case "${name}"`);
    const end = source.indexOf("\n    case ", start + 10);
    assert.match(source.slice(start, end), /assertHarnessAccess/);
  }
  const submit = source.slice(source.indexOf('case "harness_submit_for_review"'), source.indexOf('case "harness_complete_feature"'));
  assert.match(submit, /harness_checkpoints"\)\.delete\(\)\.eq\("task_id"/);
  assert.match(submit, /status: "completed"/);
  assert.match(submit, /entry_type: "review"/);
  assert.match(submit, /created_at: submittedAt/);
  const complete = source.slice(source.indexOf('case "harness_complete_feature"'), source.indexOf('case "harness_list_cronjobs"'));
  assert.match(complete, /reviewed_at/);
  assert.match(complete, /selectLatestReviewSubmission/);
  assert.match(complete, /latestSubmit\.reviewCycleAt/);
  assert.match(complete, /\.eq\("entry_type", "review"\)/);
  assert.match(complete, /\.eq\("id", params\.taskId\)\.eq\("status", "review"\)\.select\(\)\.maybeSingle\(\)/);
  assert.match(complete, /\.eq\("task_id", params\.taskId\)\.eq\("status", "active"\)/);
});

test("a generic completed implementer session cannot substitute for submit_for_review", () => {
  const sessions = [{ id: "sess_impl", role: "implementer", status: "completed", ended_at: "2026-08-07T10:00:00.000Z" }];
  assert.equal(selectLatestReviewSubmission(sessions, []), null);
  assert.equal(selectLatestReviewSubmission(sessions, [{ session_id: "sess_other", entry_type: "review", created_at: "2026-08-07T10:00:01.000Z" }]), null);
  const submission = selectLatestReviewSubmission(sessions, [{ session_id: "sess_impl", entry_type: "review", created_at: "2026-08-07T10:00:01.000Z" }]);
  assert.equal(submission.session.id, "sess_impl");
  assert.equal(submission.reviewCycleAt, "2026-08-07T10:00:01.000Z");
  const newerGenericSession = { id: "sess_generic", role: "implementer", status: "completed", ended_at: "2026-08-07T11:00:00.000Z" };
  assert.equal(selectLatestReviewSubmission(
    [...sessions, newerGenericSession],
    [{ session_id: "sess_impl", entry_type: "review", created_at: "2026-08-07T10:00:01.000Z" }],
  ), null, "an older real submit must not authorize a newer unmarked review cycle");
});

test("finish_session is reviewer-only for completed and uses compare-and-set", () => {
  const source = readFileSync(new URL("../netlify/functions/mcp.mjs", import.meta.url), "utf8");
  const finish = source.slice(source.indexOf('case "harness_finish_session"'), source.indexOf('case "harness_list_cronjobs"'));
  assert.match(finish, /params\.status === "completed" && access\.session\.role !== "reviewer"/);
  assert.match(finish, /Implementers must call harness_submit_for_review/);
  assert.match(finish, /\.eq\("id", params\.sessionId\)\.in\("status", \["active", "paused"\]\)\.select\(\)\.maybeSingle\(\)/);
  assert.match(finish, /if \(!session\)[\s\S]*currentSession[\s\S]*idempotent: true/);
  const schema = source.slice(source.indexOf('name: "harness_finish_session"'), source.indexOf("\n  },", source.indexOf('name: "harness_finish_session"')));
  assert.match(schema, /completed is reviewer-only/);
});

test("harness access behavior isolates accounts, sessions and workspace keys", async () => {
  const accountA = "00000000-0000-4000-8000-000000000001";
  const accountB = "00000000-0000-4000-8000-000000000002";
  const rows = {
    design_kanban_tasks: [
      { id: "task_a", account_id: accountA, workspace_id: "ws_a", status: "design" },
      { id: "task_b", account_id: accountB, workspace_id: "ws_b", status: "design" },
      { id: "task_shared", account_id: null, workspace_id: "ws_a", status: "design" },
    ],
    harness_sessions: [{ id: "sess_b", account_id: accountB, task_id: "task_b", role: "implementer", status: "active" }],
  };
  const sb = { from(table) {
    const filters = {};
    const query = {
      select() { return query; },
      eq(key, value) { filters[key] = value; return query; },
      async maybeSingle() {
        const data = (rows[table] || []).find(row => Object.entries(filters).every(([key, value]) => row[key] === value)) || null;
        return { data, error: null };
      },
    };
    return query;
  } };
  const userAuth = { authType: "user", userId: accountA };
  await assert.rejects(() => assertHarnessAccess(sb, userAuth, accountA, { taskId: "task_b" }, async () => false), error => error.code === -32003);
  await assert.rejects(() => assertHarnessAccess(sb, userAuth, accountA, { sessionId: "sess_b" }, async () => false), error => error.code === -32003);
  await assert.doesNotReject(() => assertHarnessAccess(sb, userAuth, accountA, { taskId: "task_shared" }, async (_auth, workspaceId) => workspaceId === "ws_a"));
  const workspaceKey = { authType: "workspace_key", workspaceId: "ws_a" };
  await assert.doesNotReject(() => assertHarnessAccess(sb, workspaceKey, "key-user", { taskId: "task_a" }, async () => false));
  await assert.rejects(() => assertHarnessAccess(sb, workspaceKey, "key-user", { taskId: "task_b" }, async () => false), error => error.code === -32003);
});

test("MCP calls and subagent tools forward AbortSignal", () => {
  const client = readFileSync(new URL("../src/lib/mcpClient.ts", import.meta.url), "utf8");
  assert.match(client, /mcpCall\(method: string, params: Record<string, any>, signal\?: AbortSignal\)/);
  assert.match(client, /method: "POST",\s*signal,/);
  const chat = readFileSync(new URL("../src/components/ChatFAB.tsx", import.meta.url), "utf8");
  assert.match(chat, /mcpCall\(name, resolveArgs\(name, args\), signal\)/);
  assert.match(chat, /mcpCall\("get_template", \{ templateId: tid \}, signal\)/);
  assert.match(chat, /signal\?\.addEventListener\("abort", forwardParentAbort, \{ once: true \}\)/);
  assert.match(chat, /if \(runSignal\.aborted\) throw runSignal\.reason/);
  assert.match(chat, /executeToolCall\(tc\.name, tc\.args, runSignal\)/);
  assert.match(chat, /const runSignal = runController\.signal/);
});

test("ChatFAB create_deck schema requires explicit brand and structured slides", () => {
  const source = readFileSync(new URL("../src/components/ChatFAB.tsx", import.meta.url), "utf8");
  const schema = source.slice(source.indexOf('name: "create_deck"'), source.indexOf('name: "update_template"'));
  assert.match(schema, /required: \["workspaceId", "name", "brand", "slides"\]/);
  assert.match(schema, /brand: \{ type: "object"/);
  assert.match(schema, /titleFont/);
  assert.match(schema, /slides: \{ type: "array".*items: \{ type: "object", required: \["html", "css"\]/s);
  assert.match(schema, /total frames = slides\.length \+ 1/);
  assert.match(schema, /brandId/);
});

test("ChatFAB exposes the atomic custom-dimension carousel to implementers", () => {
  const source = readFileSync(new URL("../src/components/ChatFAB.tsx", import.meta.url), "utf8");
  const schema = source.slice(source.indexOf('name: "create_html_carousel"'), source.indexOf('name: "create_deck"'));
  assert.match(schema, /required: \["workspaceId", "name", "width", "height", "frames"\]/);
  assert.match(schema, /minItems: 2, maxItems: 40/);
  assert.match(schema, /required: \["name", "html", "css"\]/);
  assert.match(source, /"create_html_template", "create_html_carousel", "create_template", "create_deck"/);
});

test("provider usage prefers actual counters and labels estimates honestly", () => {
  assert.deepEqual(readProviderUsage({ usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } }, false), {
    inputTokens: 120,
    outputTokens: 30,
    totalTokens: 150,
    cachedInputTokens: 0,
  });
  assert.deepEqual(readProviderUsage({ usage: { input_tokens: 80, output_tokens: 20 } }, true), {
    inputTokens: 80,
    outputTokens: 20,
    totalTokens: 100,
    cachedInputTokens: 0,
  });
  assert.equal(readProviderUsage({}, false), null);
  assert.equal(formatDuration(125_000), "2m 5s");
  assert.equal(formatTokens(12_500), "13k");
});

test("runtime text sanitization redacts secrets and design payloads", () => {
  const sanitized = sanitizeRuntimeText('Bearer abc.def-123 sk-secretvalue <style>.x{color:red}</style><main>private</main>');
  assert.doesNotMatch(sanitized, /abc\.def|sk-secret|color:red|<main>/);
  assert.match(sanitized, /redacted/);
  assert.match(sanitized, /style omitted/);
  assert.match(sanitized, /html omitted/);
});

test("provider timeout performs at most one timeout retry within the total deadline", async () => {
  let calls = 0;
  const notices = [];
  const startedAt = Date.now();
  const neverCompletes = (_url, options) => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("attempt aborted", "AbortError")), { once: true });
    });
  };
  await assert.rejects(
    () => fetchWithRetry("https://provider.invalid", {}, {
      timeoutMs: 5,
      maxRetries: 2,
      maxTimeoutRetries: 1,
      // Margen holgado: en el sweep paralelo el timer de 5ms puede retrasarse
      // >95ms por carga del event loop y agotar un deadline corto sin reintentar.
      totalDeadlineMs: 1_000,
      fetchImpl: neverCompletes,
      onRetry: notice => notices.push(notice),
    }),
    error => error?.name === "TimeoutError",
  );
  assert.equal(calls, 2);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].reason, "timeout");
  assert.ok(Date.now() - startedAt < 1_300, "deadline must bound retries");
});

test("an already-aborted provider request never starts a fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    () => fetchWithRetry("https://provider.invalid", {}, {
      signal: controller.signal,
      fetchImpl: async () => { calls += 1; return new Response(null, { status: 200 }); },
    }),
    error => error?.name === "AbortError",
  );
  assert.equal(calls, 0);
});

test("abort during an in-flight provider fetch stops immediately without retry", async () => {
  const controller = new AbortController();
  let calls = 0;
  const notices = [];
  const request = fetchWithRetry("https://provider.invalid", {}, {
    signal: controller.signal,
    maxRetries: 2,
    fetchImpl: (_url, options) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    },
    onRetry: notice => notices.push(notice),
  });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(() => request, error => error?.name === "AbortError");
  assert.equal(calls, 1);
  assert.deepEqual(notices, []);
});

test("abort at the start of retry backoff prevents the next fetch", async () => {
  const controller = new AbortController();
  let calls = 0;
  const notices = [];
  await assert.rejects(
    () => fetchWithRetry("https://provider.invalid", {}, {
      signal: controller.signal,
      maxRetries: 2,
      fetchImpl: async () => {
        calls += 1;
        return new Response("retry", { status: 500 });
      },
      onRetry: notice => {
        notices.push(notice);
        controller.abort();
      },
    }),
    error => error?.name === "AbortError",
  );
  assert.equal(calls, 1);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].reason, "server_error");
});

test("serial promise queue preserves logical telemetry order", async () => {
  const queue = createSerialPromiseQueue();
  const order = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  const first = queue.enqueue(async () => {
    order.push("start:1");
    await firstGate;
    order.push("end:1");
  });
  const second = queue.enqueue(async () => {
    order.push("start:2");
    order.push("end:2");
  });
  await Promise.resolve();
  assert.deepEqual(order, ["start:1"]);
  releaseFirst();
  await Promise.all([first, second, queue.drain()]);
  assert.deepEqual(order, ["start:1", "end:1", "start:2", "end:2"]);
});

test("REQ-006 UI uses stable event IDs and accessible disclosures with copy feedback", () => {
  const source = readFileSync(new URL("../src/components/ChatFAB.tsx", import.meta.url), "utf8");
  assert.match(source, /interface ToolEvent \{\s*id: string;/);
  assert.doesNotMatch(source, /i === prev\.length - 1/);
  assert.match(source, /aria-expanded=\{isExpanded\}/);
  assert.match(source, /aria-controls=\{detailsId\}/);
  assert.match(source, /role="status" aria-live="polite"/);
  assert.match(source, /await navigator\.clipboard\.writeText/);
  assert.match(source, /setCopyStatus\("error"\)/);
  assert.match(source, /setInterval\(\(\) => setClockNow\(Date\.now\(\)\), 1000\)/);
  assert.match(source, /const finalIsError = finalResultStr\.includes/);
  assert.match(source, /event\.id === eventId[\s\S]*status: finalIsError \? "error"/);
  assert.match(source, /result: sanitizeRuntimeText\(finalResultStr, 4000\)/);
});

test("runtime events and terminal session close share one per-run queue", () => {
  const source = readFileSync(new URL("../src/components/ChatFAB.tsx", import.meta.url), "utf8");
  const spawn = source.slice(source.indexOf("async function spawnSubagent"), source.indexOf("interface ToolEvent"));
  assert.match(spawn, /const telemetryQueue = createSerialPromiseQueue\(\)/);
  assert.match(spawn, /telemetryQueue\.enqueue\(\(\) => mcpCall\(method, args\)\)/);
  assert.match(spawn, /enqueueTelemetry\("harness_record_runtime_event"/);
  assert.match(spawn, /enqueueTelemetry\("harness_finish_session"/);
  assert.doesNotMatch(spawn, /void mcpCall\("harness_record_runtime_event"/);
  const finishStart = spawn.indexOf("const finishResult");
  const finishBody = spawn.slice(finishStart, spawn.indexOf("emitProgress(\"starting\")", finishStart));
  assert.ok(finishBody.indexOf("emitProgress(state") < finishBody.indexOf("finishSessionBestEffort"));
  assert.doesNotMatch(finishBody, /state === "done" && params\.role === "reviewer"/);
  assert.match(finishBody, /else if \(closeReviewerCompleted\)/);
});

test("reviewer verdict lifecycle closes only CHANGES_REQUESTED", () => {
  assert.equal(parseReviewerVerdict("CHANGES_REQUESTED -> C2 failed"), "CHANGES_REQUESTED");
  assert.equal(parseReviewerVerdict("APPROVED"), "APPROVED");
  assert.equal(parseReviewerVerdict("APPROVED but CHANGES_REQUESTED"), "unknown");
  assert.equal(parseReviewerVerdict("Looks good"), "unknown");
  const source = readFileSync(new URL("../src/components/ChatFAB.tsx", import.meta.url), "utf8");
  const noTools = source.slice(source.indexOf("// No more tool calls → subagent finished"), source.indexOf("madeAnyToolCall = true"));
  assert.match(noTools, /parseReviewerVerdict\(textContent\)/);
  assert.match(noTools, /reviewerVerdict === "CHANGES_REQUESTED"/);
  assert.doesNotMatch(noTools, /reviewerVerdict === "APPROVED"/);
  const mcp = readFileSync(new URL("../netlify/functions/mcp.mjs", import.meta.url), "utf8");
  const complete = mcp.slice(mcp.indexOf('case "harness_complete_feature"'), mcp.indexOf('case "harness_record_runtime_event"'));
  assert.match(complete, /completeAccess\.session\.status !== "active"/);
});

test("runtime telemetry schemas are tenant-derived and never accept accountId", () => {
  const source = readFileSync(new URL("../netlify/functions/mcp.mjs", import.meta.url), "utf8");
  for (const name of ["harness_record_runtime_event", "harness_get_runtime_events", "harness_list_sessions", "harness_finish_session"]) {
    const schemaStart = source.indexOf(`name: "${name}"`);
    const schemaEnd = source.indexOf("\n  },", schemaStart) + 5;
    const schema = source.slice(schemaStart, schemaEnd);
    assert.ok(schemaStart >= 0, `${name} schema missing`);
    assert.doesNotMatch(schema, /accountId|account_id/);
    const handlerStart = source.indexOf(`case "${name}"`);
    const handlerEnd = source.indexOf("\n    case ", handlerStart + 10);
    assert.match(source.slice(handlerStart, handlerEnd), /assertHarnessAccess/);
  }
});

test("runtime telemetry is idempotent, cursor-ordered and server-sanitized", () => {
  const source = readFileSync(new URL("../netlify/functions/mcp.mjs", import.meta.url), "utf8");
  const record = source.slice(source.indexOf('case "harness_record_runtime_event"'), source.indexOf('case "harness_get_runtime_events"'));
  assert.match(record, /eq\("client_event_id", clientEventId\)/);
  assert.match(record, /idempotent: true/);
  assert.match(record, /sanitizeRuntimeServerText\(params\.error/);
  assert.match(record, /sanitizeRuntimeMetadata\(params\.metadata\)/);
  assert.doesNotMatch(record, /params\.prompt|params\.arguments|params\.html|params\.css/);
  const getEvents = source.slice(source.indexOf('case "harness_get_runtime_events"'), source.indexOf('case "harness_list_sessions"'));
  assert.match(getEvents, /gt\("cursor", afterId\)/);
  assert.match(getEvents, /order\("cursor", \{ ascending: true \}\)/);
  assert.match(getEvents, /\.eq\("account_id", accountId\)\.eq\("session_id", params\.sessionId\)/);
  assert.match(getEvents, /nextCursor/);
  const listSessions = source.slice(source.indexOf('case "harness_list_sessions"'), source.indexOf('case "harness_finish_session"'));
  assert.match(listSessions, /\.eq\("account_id", accountId\)\.eq\("task_id", params\.taskId\)/);
  const finish = source.slice(source.indexOf('case "harness_finish_session"'), source.indexOf('case "harness_list_cronjobs"'));
  assert.match(finish, /\["active", "paused"\]\.includes\(access\.session\.status\)/);
  assert.match(finish, /idempotent: true/);
  const startSession = source.slice(source.indexOf('case "harness_start_session"'), source.indexOf('case "harness_log_entry"'));
  assert.match(startSession, /const accountId = startAccess\.task\.account_id \|\| callerAccountId/);
  assert.match(startSession, /account_id: accountId/);
});

test("migration v17 makes runtime telemetry append-only and tenant-isolated", () => {
  const sql = readFileSync(new URL("../supabase_migrations_v17.sql", import.meta.url), "utf8");
  assert.match(sql, /create table if not exists public\.harness_runtime_events/i);
  assert.match(sql, /cursor\s+bigint generated always as identity unique/i);
  assert.match(sql, /alter column cursor set generated always/i);
  assert.match(sql, /unique \(account_id, client_event_id\)/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /for select[\s\S]*account_id = auth\.uid\(\)/i);
  assert.match(sql, /for insert[\s\S]*account_id = auth\.uid\(\)[\s\S]*harness_runtime_event_owned\(account_id, session_id, task_id, role\)/i);
  assert.match(sql, /security definer[\s\S]*hs\.session_id|security definer/i);
  assert.match(sql, /hs\.id = p_session_id[\s\S]*hs\.task_id = p_task_id[\s\S]*hs\.account_id = p_account_id[\s\S]*ht\.account_id = p_account_id/i);
  assert.match(sql, /before insert on public\.harness_runtime_events[\s\S]*enforce_harness_runtime_event_ownership/i);
  assert.match(sql, /raise exception 'runtime event tenant\/session\/task ownership mismatch'/i);
  const tableDefinition = sql.slice(sql.indexOf("CREATE TABLE"), sql.indexOf(");", sql.indexOf("CREATE TABLE")));
  assert.doesNotMatch(tableDefinition, /\n\s+(?:prompt|tool_args|arguments|html|css|api_key)\b/i);
  assert.doesNotMatch(sql, /for update|for delete/i);
  assert.match(sql, /drop constraint if exists harness_sessions_status_check/i);
  assert.doesNotMatch(sql, /from pg_constraint|pg_get_constraintdef|ilike '%status%'/i);
});

test("v17 rejects a cross-tenant runtime insert before service-role persistence", () => {
  const sql = readFileSync(new URL("../supabase_migrations_v17.sql", import.meta.url), "utf8");
  const ownership = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.harness_runtime_event_owned"), sql.indexOf("REVOKE ALL ON FUNCTION public.harness_runtime_event_owned"));
  for (const requiredBinding of [
    "hs.id = p_session_id",
    "hs.task_id = p_task_id",
    "hs.role = p_role",
    "hs.account_id = p_account_id",
    "ht.account_id = p_account_id",
  ]) assert.match(ownership, new RegExp(requiredBinding.replaceAll(".", "\\.")));
  const trigger = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.enforce_harness_runtime_event_ownership"), sql.indexOf("DROP POLICY IF EXISTS"));
  assert.match(trigger, /IF NOT public\.harness_runtime_event_owned\(NEW\.account_id, NEW\.session_id, NEW\.task_id, NEW\.role\)/);
  assert.match(trigger, /ERRCODE = '23514'/);
  assert.match(sql, /SECURITY DEFINER/);
});
