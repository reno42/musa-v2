// s01_auth_nokey.mjs — ITEM 1 (AUTH-NOKEY):
// tools/call list_workspaces SIN header x-api-key → ¿401/-32001 (enforcement) o 200 (accept-all)?
import { tool, saveEvidence, summarizeToolResp, verdict } from "./lib/client.mjs";

console.log("== s01 AUTH-NOKEY ==");
const r = await tool("list_workspaces", {}); // SIN apiKey
saveEvidence("01-auth-nokey.json", summarizeToolResp(r, 2500));

const enforced = r.httpStatus === 401 && r.error?.code === -32001;
const acceptAll = r.httpStatus === 200 && !r.error;

verdict("HTTP status", true, String(r.httpStatus));
if (enforced) {
  console.log("  → ENFORCEMENT ACTIVO: 401 + -32001. MCP_ADMIN_KEY está definida en prod.");
} else if (acceptAll) {
  console.log("  → ACCEPT-ALL: 200 sin key. MCP_ADMIN_KEY NO está definida en prod (hallazgo grave).");
} else {
  console.log("  → Respuesta inesperada:", JSON.stringify(summarizeToolResp(r)));
}
console.log("  RESULTADO ITEM 1:", enforced ? "enforcement activo (afirmación de accept-all REFUTADA)" : acceptAll ? "accept-all (hallazgo grave CONFIRMADO)" : "inconcluso");
