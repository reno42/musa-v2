/**
 * Create disposable test templates via the local MCP endpoint.
 * The local server speaks plain JSON-RPC (method = tool name), header x-api-key: dev-key.
 */
import { API_URL } from "./servers.mjs";

let rpcId = 0;

async function mcp(method, params) {
  const res = await fetch(`${API_URL}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": "dev-key" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: ++rpcId }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  const text = body.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : body.result;
}

async function ensureWorkspace() {
  const list = await mcp("list_workspaces", {});
  const workspaces = list.data || list.workspaces || list || [];
  const existing = (Array.isArray(workspaces) ? workspaces : []).find(w => w.name === "editor-qa");
  if (existing) return existing.id;
  const created = await mcp("create_workspace", { name: "editor-qa" });
  return (created.data || created).id;
}

/**
 * A frame with a nested card: a container WITH data-layer-id holding a heading
 * WITHOUT one (to reproduce the mid-click id-assignment mutation, S2a) plus a
 * couple of independent top-level layers to move around.
 */
function nestedFrameHtml() {
  return [
    '<div data-layer-id="card" data-layer-name="Card" style="position:absolute;left:80px;top:80px;width:520px;height:360px;background:#12203a;border-radius:24px;padding:40px;box-sizing:border-box;">',
    '  <h1 style="margin:0;font-family:sans-serif;font-size:44px;color:#EDE8DC;">Sin layer-id</h1>',
    '  <p style="margin:16px 0 0;font-family:sans-serif;font-size:20px;color:#8A8375;">Hijo sin data-layer-id.</p>',
    '</div>',
    '<div data-layer-id="pill" data-layer-name="Pill" style="position:absolute;left:80px;top:520px;width:220px;height:64px;background:#C8B898;border-radius:999px;"></div>',
    '<div data-layer-id="dot" data-layer-name="Dot" style="position:absolute;left:700px;top:120px;width:120px;height:120px;background:#EF4444;border-radius:50%;"></div>',
  ].join("\n");
}

export async function createNestedTemplate() {
  const workspaceId = await ensureWorkspace();
  const created = await mcp("create_template", {
    workspaceId, name: "QA — nested selection", width: 1080, height: 1080, engine: "html",
  });
  const id = (created.data || created).id;
  await mcp("update_template", {
    id,
    frames: [{
      id: "frame_qa_nested", name: "QA nested", x: 0, y: 0,
      width: 1080, height: 1080, background: "#0E0D0B",
      html: nestedFrameHtml(), css: "",
    }],
  });
  return { templateId: id, frameId: "frame_qa_nested" };
}

/** A frame packed with N absolutely-positioned layers for perf budgets. */
export async function createHeavyTemplate(layerCount = 200, base64Images = 10) {
  const workspaceId = await ensureWorkspace();
  const created = await mcp("create_template", {
    workspaceId, name: `QA — heavy ${layerCount}`, width: 1920, height: 1080, engine: "html",
  });
  const id = (created.data || created).id;

  // A small opaque base64 PNG (1x1) blown up — stands in for the batch's inlined images.
  const px = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const layers = [];
  for (let i = 0; i < layerCount; i++) {
    const x = 40 + (i % 20) * 92;
    const y = 40 + Math.floor(i / 20) * 92;
    if (i < base64Images) {
      layers.push(`<img data-layer-id="img_${i}" data-layer-name="Img ${i}" src="${px}" style="position:absolute;left:${x}px;top:${y}px;width:80px;height:80px;object-fit:cover;border-radius:8px;">`);
    } else {
      const hue = (i * 47) % 360;
      layers.push(`<div data-layer-id="box_${i}" data-layer-name="Box ${i}" style="position:absolute;left:${x}px;top:${y}px;width:80px;height:80px;background:hsl(${hue} 60% 55%);border-radius:8px;"></div>`);
    }
  }
  await mcp("update_template", {
    id,
    frames: [{
      id: "frame_qa_heavy", name: "QA heavy", x: 0, y: 0,
      width: 1920, height: 1080, background: "#0E0D0B",
      html: layers.join("\n"), css: "",
    }],
  });
  return { templateId: id, frameId: "frame_qa_heavy", layerCount };
}

export async function deleteTemplate(templateId) {
  try { await mcp("delete_template", { id: templateId }); } catch { /* best effort */ }
}
