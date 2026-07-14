#!/usr/bin/env node
/**
 * agent-design — publish an editable design to Futuraria in one command.
 *
 * Usage:
 *   node scripts/agent-design.mjs push <design.json> [options]
 *   node scripts/agent-design.mjs example > design.json
 *
 * Options:
 *   --api <url>        API base (default http://localhost:3001, or FUTURARIA_API env)
 *   --key <apiKey>     x-api-key header (default dev-key, or FUTURARIA_KEY env)
 *   --template <id>    Update an existing template instead of creating one
 *   --app <url>        Editor base URL for the printed link (default http://localhost:5173)
 *
 * design.json shape:
 *   {
 *     "workspace": "Brand",              // name (created if missing) or ws_ id
 *     "name": "Mi campaña",
 *     "frames": [
 *       { "id": "frame_post", "name": "Post", "x": 0, "y": 0,
 *         "width": 1080, "height": 1080, "background": "#0E0D0B",
 *         "html": "<div data-layer-id=\"t\" data-layer-name=\"Título\">Hola</div>",
 *         "css": "[data-layer-id=\"t\"] { position:absolute; left:80px; top:80px; font-size:64px; }" }
 *     ]
 *   }
 *
 * Every element should carry data-layer-id + data-layer-name so humans can
 * select and edit each piece in the visual editor afterwards.
 */
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const command = args[0];

function opt(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index !== -1 ? args[index + 1] : fallback;
}

const API = (opt("api", process.env.FUTURARIA_API || "http://localhost:3001")).replace(/\/$/, "");
const KEY = opt("key", process.env.FUTURARIA_KEY || "dev-key");
const APP = (opt("app", process.env.FUTURARIA_APP || "http://localhost:5173")).replace(/\/$/, "");

let rpcId = 0;
async function mcp(method, params) {
  const res = await fetch(`${API}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": KEY },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: ++rpcId }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  const payload = body.result?.content?.[0]?.text;
  return payload ? JSON.parse(payload) : body.result;
}

const EXAMPLE = {
  workspace: "Brand",
  name: "Ejemplo — Hola Futuraria",
  frames: [
    {
      id: "frame_hola",
      name: "Post 1080",
      x: 0, y: 0, width: 1080, height: 1080, background: "#0E0D0B",
      html: `<h1 data-layer-id="titulo" data-layer-name="Título">Hola, Futuraria</h1>\n<p data-layer-id="sub" data-layer-name="Subtítulo">Diseñado por un agente, editable por humanos.</p>`,
      css: `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300..700&display=swap');\n[data-layer-id="titulo"] { position: absolute; left: 84px; top: 420px; margin: 0; font-family: 'Inter', sans-serif; font-size: 96px; font-weight: 700; color: #EDE8DC; }\n[data-layer-id="sub"] { position: absolute; left: 84px; top: 560px; margin: 0; font-family: 'Inter', sans-serif; font-size: 34px; font-weight: 300; color: #8A8375; }`,
    },
  ],
};

async function resolveWorkspaceId(nameOrId) {
  if (/^ws_/.test(nameOrId)) return nameOrId;
  const list = await mcp("list_workspaces", {});
  const workspaces = list.data || list.workspaces || list;
  const found = (Array.isArray(workspaces) ? workspaces : []).find(w => w.name === nameOrId);
  if (found) return found.id;
  const created = await mcp("create_workspace", { name: nameOrId });
  return (created.data || created).id;
}

async function push(file) {
  const design = JSON.parse(readFileSync(file, "utf8"));
  if (!design.frames?.length) throw new Error("design.frames is required");
  const started = Date.now();

  let templateId = opt("template", null);
  if (!templateId) {
    const workspaceId = await resolveWorkspaceId(design.workspace || "Agent Designs");
    const created = await mcp("create_template", {
      workspaceId,
      name: design.name || "Untitled design",
      width: design.frames[0].width,
      height: design.frames[0].height,
      engine: "html",
    });
    templateId = (created.data || created).id;
  }

  await mcp("update_template", { id: templateId, frames: design.frames });

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`✔ ${design.frames.length} frame(s) publicados en ${seconds}s`);
  console.log(`  Template: ${templateId}`);
  console.log(`  Editor:   ${APP}/?template=${templateId}&v=2`);
}

if (command === "example") {
  console.log(JSON.stringify(EXAMPLE, null, 2));
} else if (command === "push" && args[1]) {
  push(args[1]).catch(error => { console.error(`✗ ${error.message}`); process.exit(1); });
} else {
  console.log("Uso: node scripts/agent-design.mjs push <design.json> [--api url] [--key k] [--template id]");
  console.log("     node scripts/agent-design.mjs example > design.json");
  process.exit(command ? 1 : 0);
}
