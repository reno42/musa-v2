#!/usr/bin/env node
/**
 * flows-mcp — servidor MCP stdio que expone el flow builder de Ren (motor xiaozhi-musa
 * portado) + el newsroom, para que Eco/Mira lo usen como tools.
 *
 * Tools:
 *  - flow_list                      → flujos del builder visual
 *  - flow_run    {flowId, input?}   → ejecuta un flujo (nodos http/ai/tool)
 *  - flow_history {flowId?, limit?}  → historial de ejecuciones
 *  - newsroom_list                  → flujos de newsroom y último run
 *  - newsroom_build {flowId?}       → ejecuta la edición (RSS → diseño Musa → template)
 *  - newsroom_report {flowId?}      → reporte del último run (→ Telegram + texto)
 *
 * Env: MUSA_MCP_URL (default https://design.futuraria.com/mcp), MUSA_API_KEY (x-api-key),
 *      TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (notificaciones, opcional),
 *      FLOWS_WORKSPACE (default /home/ubuntu/flows-eco).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Cron } from "croner";
import { createAutomationFlowEngine } from "./automation-flow-engine.mjs";
import { createNewsroomPipeline } from "./newsroom-pipeline.mjs";
import { getNewsroomFlows } from "./newsroom-flows.mjs";
import { runtimePaths, readJson } from "./runtime-store.mjs";
import { workspaceDir } from "./config.mjs";
import path from "node:path";

const MUSA_URL = process.env.MUSA_MCP_URL ?? "https://design.futuraria.com/mcp";
const MUSA_KEY = process.env.MUSA_API_KEY ?? "";

async function musaCall(toolName, args) {
  if (!MUSA_KEY) throw new Error("MUSA_API_KEY no configurada.");
  const payload = { jsonrpc: "2.0", method: "tools/call", params: { name: toolName, arguments: args ?? {} }, id: Date.now() };
  const res = await fetch(MUSA_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": MUSA_KEY, "user-agent": "Mozilla/5.0 flows-eco" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Musa HTTP ${res.status} en ${toolName}`);
  const data = await res.json();
  if (data.error) throw new Error(`Musa RPC: ${JSON.stringify(data.error).slice(0, 300)}`);
  return { content: data.result?.content ?? [], isError: Boolean(data.result?.isError) };
}

async function telegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: message, disable_web_page_preview: true }),
    });
  } catch (error) {
    console.error(`[flows-eco] telegram fallo: ${error.message}`);
  }
}

const notify = (title, message) => { telegram(`📰 ${title}\n${message}`); };

const engine = await createAutomationFlowEngine({
  credentialFilePath: path.join(workspaceDir, ".secrets", "automation-credentials.json"),
  getAvailableTools: () => ["musa__list_workspaces", "musa__create_template", "musa__create_html_frame",
    "musa__get_html_frames", "musa__upload_image", "musa__render_html_template"],
  callTool: musaCall,
  logger: console,
});

const newsroom = createNewsroomPipeline(musaCall, { notify });

/* ── scheduler newsroom: buildTime / reportTime de cada flujo (America/Lima) ── */
async function scheduleNewsroom() {
  const store = await getNewsroomFlows();
  for (const flow of store.flows ?? []) {
    if (flow.enabled === false) continue;
    const sched = (flow.nodes ?? []).find((n) => n.type === "schedule" && n.enabled !== false);
    if (!sched) continue;
    const { buildTime = "08:00", reportTime = "09:00" } = sched.config ?? {};
    const [bh, bm] = String(buildTime).split(":").map(Number);
    const [rh, rm] = String(reportTime).split(":").map(Number);
    if (Number.isFinite(bh)) new Cron(`${bm ?? 0} ${bh} * * *`, { timezone: "America/Lima", protect: true },
      () => newsroom.build(flow.id).catch((e) => console.error(`[newsroom] build ${flow.id}: ${e.message}`)));
    if (Number.isFinite(rh)) new Cron(`${rm ?? 0} ${rh} * * *`, { timezone: "America/Lima", protect: true },
      () => newsroom.report(flow.id).catch((e) => console.error(`[newsroom] report ${flow.id}: ${e.message}`)));
    console.log(`[newsroom] ${flow.name}: build ${buildTime}, report ${reportTime} (Lima)`);
  }
}
await scheduleNewsroom();

/* ── MCP ── */
const TOOLS = [
  { name: "flow_list", description: "Lista los flujos del builder visual (id, nombre, trigger, nodos, activo).", inputSchema: { type: "object", properties: {} } },
  { name: "flow_run", description: "Ejecuta un flujo del builder visual. Los nodos http/ai/tool corren en orden.", inputSchema: { type: "object", properties: { flowId: { type: "string" }, input: { type: "object" } }, required: ["flowId"] } },
  { name: "flow_history", description: "Historial de ejecuciones del builder (últimas N).", inputSchema: { type: "object", properties: { flowId: { type: "string" }, limit: { type: "number" } } } },
  { name: "newsroom_list", description: "Flujos de newsroom con su último run (día, estado, templateId, nº de noticias).", inputSchema: { type: "object", properties: {} } },
  { name: "newsroom_build", description: "Ejecuta la edición de newsroom: lee RSS/Nitter, redacta y crea los diseños en Musa (template nuevo).", inputSchema: { type: "object", properties: { flowId: { type: "string" } } } },
  { name: "newsroom_report", description: "Reporta el último run de newsroom (resume noticias creadas/errores) y lo manda a Telegram.", inputSchema: { type: "object", properties: { flowId: { type: "string" } } } },
];

const server = new Server({ name: "flows-eco", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: a = {} } = req.params;
  const out = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 1).slice(0, 28_000) }] });
  try {
    switch (name) {
      case "flow_list": return out(await engine.call({ operation: "flow_list" }));
      case "flow_get": return out(await engine.call({ operation: "flow_get", flowId: a.flowId }));
      case "flow_run": return out(await engine.call({ operation: "flow_run", flowId: a.flowId, input: a.input ?? {} }));
      case "flow_history": return out(await engine.call({ operation: "flow_history", flowId: a.flowId, limit: a.limit ?? 10 }));
      case "newsroom_list": {
        const store = await getNewsroomFlows();
        const runs = await readJson(runtimePaths.newsroomRuns, { runs: [] });
        const latest = {};
        for (const run of runs.runs ?? []) if (!latest[run.flowId] || latest[run.flowId].startedAt < run.startedAt) latest[run.flowId] = run;
        return out({
          flows: (store.flows ?? []).map((f) => ({ id: f.id, name: f.name, enabled: f.enabled, maxItems: f.maxItems,
            nodes: (f.nodes ?? []).map((n) => `${n.type}${n.enabled === false ? " (off)" : ""}`) })),
          latestRuns: Object.fromEntries(Object.entries(latest).map(([id, r]) => [id, { day: r.day, status: r.status, templateId: r.templateId ?? null, articles: r.articles?.length ?? 0, errors: r.errors?.length ?? 0 }])),
        });
      }
      case "newsroom_build": return out(await newsroom.build(a.flowId));
      case "newsroom_report": return out(await newsroom.report(a.flowId));
      default: return { content: [{ type: "text", text: `Tool desconocida: ${name}` }], isError: true };
    }
  } catch (error) {
    return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
console.error("[flows-eco] MCP listo (stdio). Newsroom agendado.");
