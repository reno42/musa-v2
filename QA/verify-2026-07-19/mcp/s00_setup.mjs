// s00_setup.mjs — initialize, tools/list, workspace, y creación de templates verify-b-*
// (verify-b-cold se crea ACÁ, al inicio de la corrida, para el test COLD-DELETE del final).
import { tool, mcpCall, saveEvidence, saveState, summarizeToolResp, KEY_INFO, MCP_URL, EFFECTIVE_KEY, verdict } from "./lib/client.mjs";

console.log("== s00 SETUP ==");
console.log("  Endpoint:", MCP_URL);
console.log("  Keys disponibles:", JSON.stringify(KEY_INFO));

// initialize (sin auth — es método de lifecycle, no pasa por checkAuth)
const init = await mcpCall("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "verify-2026-07-19", version: "0.1" } });
saveEvidence("00-initialize.json", { httpStatus: init.httpStatus, body: init.rawBody });
verdict("initialize", init.httpStatus === 200 && init.json?.result?.serverInfo?.name === "futuraria-mcp");

// tools/list
const list = await mcpCall("tools/list");
const toolCount = list.json?.result?.tools?.length || 0;
saveEvidence("00-tools-list.json", { httpStatus: list.httpStatus, toolCount, first5: (list.json?.result?.tools || []).slice(0, 5).map(t => t.name) });
verdict(`tools/list (${toolCount} tools)`, toolCount > 100);

// list_workspaces CON key efectiva (si hay). Necesitamos un workspaceId existente.
const wsResp = await tool("list_workspaces", {}, { apiKey: EFFECTIVE_KEY || undefined });
saveEvidence("00-list-workspaces.json", summarizeToolResp(wsResp, 3000));
const workspaces = wsResp.parsed?.data || wsResp.parsed || [];
const ws = Array.isArray(workspaces) ? workspaces[0] : null;
if (!ws?.id) {
  console.log("  ❌ No se pudo obtener workspace. Respuesta:", JSON.stringify(summarizeToolResp(wsResp)));
  saveState({ fatal: "no-workspace" });
  process.exit(1);
}
console.log("  Workspace elegido (solo id, no se toca nada del usuario):", ws.id);

// verify-b-cold — se crea al INICIO y se borra al FINAL (item 10)
const cold = await tool("create_template", {
  name: "verify-b-cold", workspaceId: ws.id, engine: "html",
  html: "<div>cold-delete probe</div>", css: ".x{color:#000}",
}, { apiKey: EFFECTIVE_KEY || undefined });
saveEvidence("00-create-cold.json", summarizeToolResp(cold));
const coldId = cold.parsed?.id;
verdict("create verify-b-cold", Boolean(coldId), coldId || JSON.stringify(cold.error));

// verify-b-noop — para items 4, 5, 6, 8 (frame inicial con contenido)
const noop = await tool("create_template", {
  name: "verify-b-noop", workspaceId: ws.id, engine: "html", width: 800, height: 600,
  html: "<div class='box'>CONTENIDO-INICIAL-NOOP</div>", css: ".box{color:#123456}",
}, { apiKey: EFFECTIVE_KEY || undefined });
saveEvidence("00-create-noop.json", summarizeToolResp(noop));
const noopId = noop.parsed?.id;
const noopFrameId = noop.parsed?.frames?.[0]?.id;
verdict("create verify-b-noop", Boolean(noopId), `${noopId} frame=${noopFrameId}`);

saveState({
  workspaceId: ws.id,
  coldId,
  noopId,
  noopFrameId,
  toolCount,
  startedAt: new Date().toISOString(),
});
console.log("  Estado guardado en state.json");
