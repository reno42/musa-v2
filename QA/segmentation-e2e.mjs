/**
 * FASE 6 — QA segmentation-e2e: criterios de aceptación automatizados
 * para Calado + Máscaras + Selección de imágenes (F1-F4), tal como los
 * define el plan:
 *
 *   1. remove_background sobre una foto real → cutout + mask + path   (live)
 *   2. mask → edit_path_points → re-bake sigue la curva corregida     (offline + live)
 *   3. render PNG conserva alpha                                      (offline)
 *   4. 0 llamadas LLM — verificable por ausencia de endpoints de LLM  (offline)
 *      en el flujo + logs del job
 *
 * ── Modo offline (default) ──
 *   node --experimental-strip-types --test QA/segmentation-e2e.mjs
 *
 * ── Modo live (contra un MCP desplegado) ──
 *   node --experimental-strip-types QA/segmentation-e2e.mjs \
 *     <MCP_URL> <API_KEY> <WORKSPACE_ID> [PHOTO_URL]
 *
 * Live ejecuta: remove_background(foto) → segment_click(prompt CLIPSeg,
 * con payload UTF-8 real) → applyTo sobre un template nuevo → get_template
 * → edit_path_points sobre el path de máscara → maskRebaked === true.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// ── Live-mode wiring (skipped without argv) ──
const [MCP_URL, API_KEY, WORKSPACE_ID, PHOTO_URL_ARG] = process.argv.slice(2).map(a => a?.trim());
const LIVE = Boolean(MCP_URL && API_KEY && WORKSPACE_ID);
const PHOTO_URL = PHOTO_URL_ARG || "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop";

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callMCP(name, argumentsObj) {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: argumentsObj } }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`[${json.error.code}] ${json.error.message}`);
  const text = json.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : json.result;
}

// ═══════════════════════════════════════════════════════════════
// Criterio 2 (offline): mask → edit_path_points → re-bake
// Real production code: shared/maskBake.ts (pure TS, zero imports).
// ═══════════════════════════════════════════════════════════════

const maskBakeP = import("../shared/maskBake.ts");

// Image at 50/40 200×150; mask svg pinned to the FRAME ORIGIN (1×1,
// overflow:visible) with d in frame coords — the arc's convention.
const FRAME_BAKE = {
  pathData: "M70 70 L230 70 L230 160 L70 160 Z",
  pathBox: { left: 0, top: 0, width: 1, height: 1 },
  viewBox: null,
  imageBox: { left: 50, top: 40, width: 200, height: 150 },
  mode: "include",
};

test("e2e: bakePathMask turns a frame-space path into an image-local clip", async () => {
  const { bakePathMask } = await maskBakeP;
  const baked = bakePathMask(FRAME_BAKE);
  assert.ok(baked, "bake must produce a declaration");
  assert.equal(baked.property, "clip-path");
  // frame (70,70) − image origin (50,40) = local (20,30).
  assert.match(baked.value, /^path\("evenodd, M20 30 /);
});

test("e2e: edit_path_points re-bake — a corrected d re-bakes a corrected clip", async () => {
  const { bakePathMask } = await maskBakeP;
  const before = bakePathMask(FRAME_BAKE);
  // What edit_path_points does server-side: swap the path's d, then
  // re-run the bake so the clip follows the corrected curve.
  const corrected = bakePathMask({ ...FRAME_BAKE, pathData: "M60 50 L240 60 L220 170 L80 180 Z" });
  assert.ok(corrected, "re-bake must produce a declaration");
  assert.notEqual(corrected.value, before.value, "the clip follows the corrected d");
  assert.match(corrected.value, /^path\("evenodd, M10 10 /, "frame→image local translation is reapplied");
  assert.doesNotMatch(corrected.value, /url\(#/, "still self-contained (no fragment refs)");
});

test("e2e: inverted/brushed masks bake self-contained data-URI masks (survive foreignObject)", async () => {
  const { bakePathMask } = await maskBakeP;
  const baked = bakePathMask({
    ...FRAME_BAKE,
    mode: "exclude",
    brushes: [{ points: [{ x: 20, y: 30 }, { x: 80, y: 70 }], size: 24, mode: "erase" }],
  });
  assert.ok(baked);
  assert.equal(baked.property, "mask-image");
  assert.match(baked.value, /^url\("data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(baked.value.slice(baked.value.indexOf(",") + 1, -2), "base64").toString("utf8");
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<rect [^>]*fill="#ffffff"/, "exclude base = all visible");
  assert.match(svg, /<path d="M20 30 [^"]*" fill="#000000" fill-rule="evenodd"/, "subject hole in image-local coords");
  assert.match(svg, /stroke="#000000" stroke-width="24"/, "erase stroke rides along");
  assert.deepEqual(baked.companions, { "mask-size": "100% 100%", "mask-repeat": "no-repeat" });
});

// ═══════════════════════════════════════════════════════════════
// Criterio 3 (offline): render PNG conserva alpha
// ═══════════════════════════════════════════════════════════════

const readRepo = rel => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("e2e: the capture renderer paints no background and exports PNG (alpha survives)", () => {
  const mcp = readRepo("netlify/functions/mcp.mjs");
  // The capture target carries NO background — unlike the PDF flow that
  // flattens onto f.background || '#fff'. Transparent stays transparent.
  assert.match(mcp, /target\.style\.cssText = 'width:'\+f\.width\+'px;height:'\+f\.height\+'px;overflow:hidden;position:relative;';/);
  assert.match(mcp, /'image\/png'/);
  // Scope the no-background check to the capture function itself (the file
  // legitimately contains "background:" in unrelated flows, e.g. the PDF one).
  const doCapture = mcp.slice(mcp.indexOf("function doCapture"), mcp.indexOf("renderNext(0);", mcp.indexOf("function doCapture")) + "renderNext(0);".length);
  assert.ok(doCapture.includes("html2canvas"), "capture body extracted");
  assert.doesNotMatch(doCapture, /background/i, "capture paints nothing behind the frame");
});

test("e2e: the job cutout PNG re-joins the mask as the alpha channel (no flatten)", () => {
  const core = readRepo("netlify/segment/segment-core.mjs");
  const maskToPngs = core.match(/async function maskToPngs[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(maskToPngs, "maskToPngs exists");
  assert.match(maskToPngs, /\.joinChannel\(Buffer\.from\(mask\)/, "mask becomes the PNG alpha channel");
  assert.match(maskToPngs, /\.png\(\)/);
  // loadInputImage flattens for MODEL INPUT (correct: RGB inference); the
  // OUTPUT path must never flatten/remove alpha again.
  assert.doesNotMatch(maskToPngs, /flatten\(|removeAlpha\(/);
});

// ═══════════════════════════════════════════════════════════════
// Criterio 4 (offline): 0 llamadas LLM en el flujo de calado
// ═══════════════════════════════════════════════════════════════

const LLM_ENDPOINTS = /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.groq\.com|chat\/completions|generateContent|createChatCompletion/i;

test("e2e: segment-core runs pure local ONNX — no LLM endpoint anywhere", () => {
  const core = readRepo("netlify/segment/segment-core.mjs");
  assert.match(core, /import \* as ort from "onnxruntime-web"/);
  assert.doesNotMatch(core, LLM_ENDPOINTS, "no LLM host is reachable from the engine");
});

test("e2e: the background function is a thin wrapper over segment-core (no LLM side-channel)", () => {
  const bg = readRepo("netlify/functions/image-segment-background.mjs");
  assert.match(bg, /from "\.\.\/segment\/segment-core\.mjs"/);
  assert.doesNotMatch(bg, LLM_ENDPOINTS);
  assert.doesNotMatch(bg, /fetch\(/, "no external fetches at all in the background wrapper");
});

test("e2e: the MCP calado tools route only to the local job table (no LLM path)", () => {
  const mcp = readRepo("netlify/functions/mcp.mjs");
  const cases = mcp.match(/case "(remove_background|segment_click|segment_status|create_mask_from_path|invert_mask|fill_mask|mask_brush)":[\s\S]*?(?=\n\s*\/\/ ──|\n\s*case ")/g) || [];
  assert.ok(cases.length >= 7, `expected the 7 calado cases, found ${cases.length}`);
  for (const block of cases) {
    assert.doesNotMatch(block, LLM_ENDPOINTS, "no case in the calado flow touches an LLM host");
  }
  // The engine routing is by job kind — never by a text-completion call.
  assert.match(mcp, /createSegmentJob\("/);
  assert.match(mcp, /dispatchSegmentJob\(/);
});

// ═══════════════════════════════════════════════════════════════
// Criterios de encadenamiento (offline): las 8 tools del arco
// ═══════════════════════════════════════════════════════════════

test("e2e: the 8 arc tools are catalogued, cased and documented", () => {
  const mcp = readRepo("netlify/functions/mcp.mjs");
  const names = ["create_mask_from_path", "invert_mask", "fill_mask", "edit_path_points", "mask_brush", "remove_background", "segment_click", "segment_status"];
  for (const n of names) {
    assert.match(mcp, new RegExp(`name: "${n}"`), `${n} in the catalog`);
    assert.match(mcp, new RegExp(`case "${n}":`), `${n} has a handler`);
  }
  const cat = readRepo("docs/MCP_TOOL_CATALOG_V2.md");
  for (const n of names) assert.match(cat, new RegExp(`\`${n}\``), `${n} documented in the catalog`);
  // The UTF-8 pitfall is documented (payloads with accents in bash).
  assert.match(cat, /ensure_ascii/);
  const playbook = readRepo("docs/PLAYBOOK_MCP_MIRA.md");
  assert.match(playbook, /CALADO, MÁSCARAS Y SELECCIÓN/);
  assert.match(playbook, /segment_click/);
});

// ═══════════════════════════════════════════════════════════════
// Modo live (solo con credenciales por argv)
// ═══════════════════════════════════════════════════════════════

if (LIVE) {
  test("LIVE: remove_background sobre foto real → cutout + mask + path", { timeout: 120_000 }, async () => {
    const r = await callMCP("remove_background", { url: PHOTO_URL, workspaceId: WORKSPACE_ID });
    assert.equal(r.success, true);
    if (r.status !== "done") {
      // Cold start: poll with segment_status until it settles.
      let status = r;
      for (let i = 0; i < 30 && status.status !== "done" && status.status !== "error"; i++) {
        await sleep(2000);
        status = await callMCP("segment_status", { jobId: r.jobId });
      }
      assert.equal(status.status, "done", "job must finish: " + (status.error || ""));
      assert.ok(status.result?.cutoutUrl, "cutout PNG url present");
      assert.ok(status.result?.maskUrl, "mask PNG url present");
      assert.ok(status.result?.svgPath?.d, "traced svg path present");
    } else {
      assert.ok(r.result?.cutoutUrl, "cutout PNG url present");
      assert.ok(r.result?.maskUrl, "mask PNG url present");
      assert.ok(r.result?.svgPath?.d, "traced svg path present");
    }
  });

  test("LIVE: segment_click con prompt CLIPSeg → path + máscara aplicada → edit_path_points re-bakea", { timeout: 180_000 }, async () => {
    // 1. Template + frame + img layer whose src is the photo.
    const tpl = await callMCP("create_template", {
      name: `QA calado ${Date.now()}`,
      workspaceId: WORKSPACE_ID,
      engine: "html",
      width: 400,
      height: 400,
      html: `<img data-layer-id="img_qa" src="${PHOTO_URL}" style="position:absolute;left:50px;top:50px;width:300px;height:300px;">`,
      css: '[data-layer-id="img_qa"] {\n  position: absolute;\n  left: 50px;\n  top: 50px;\n  width: 300px;\n  height: 300px;\n}',
    });
    const frameId = tpl.frames?.[0]?.id || tpl.frameId;
    assert.ok(tpl.id && frameId, "template + frame created");

    // 2. Text segmentation with a real UTF-8 payload (the pitfall path).
    const seg = await callMCP("segment_click", {
      url: PHOTO_URL,
      workspaceId: WORKSPACE_ID,
      prompt: "la persona",
      applyTo: { templateId: tpl.id, frameId, layerId: "img_qa" },
    });
    assert.equal(seg.success, true);
    if (seg.status !== "done") {
      let status = seg;
      for (let i = 0; i < 45 && status.status !== "done" && status.status !== "error"; i++) {
        await sleep(2000);
        status = await callMCP("segment_status", { jobId: seg.jobId });
      }
      assert.equal(status.status, "done", "segment job must finish: " + (status.error || ""));
      assert.ok(status.result?.svgPath?.dNorm, "normalized traced path present");
    } else {
      assert.ok(seg.result?.svgPath?.dNorm, "normalized traced path present");
    }
    assert.ok(seg.applied !== false, "mask applied to the template layer");

    // 3. Recover the mask path layer id and re-bake through edit_path_points.
    const after = await callMCP("get_template", { templateId: tpl.id });
    const frameHtml = after.frames?.find(f => f.id === frameId)?.html || "";
    const pathId = frameHtml.match(/svg[^>]*data-layer-id="([^"]+)"[^>]*data-layer-kind="mask"|data-layer-id="([^"]+)"[^>]*>[\s\S]*?data-mask-for="img_qa"/)?.[1] || null;
    assert.ok(pathId, "mask path layer exists in the template");
    const edited = await callMCP("edit_path_points", {
      templateId: tpl.id,
      frameId,
      elementId: pathId,
      newPathData: "M0.1 0.1 L0.9 0.1 L0.9 0.9 L0.1 0.9 Z",
    });
    assert.equal(edited.success, true);
    assert.equal(edited.maskRebaked, true, "the mask CSS follows the corrected path");
  });
}
