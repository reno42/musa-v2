// s09_versions.mjs - ITEM 9 (VERSIONS):
// create verify-b-ver + 2 updates via frames[] -> list_versions -> hay versiones?
// restore_version con versionId -> que responde? restore_version con version (numerico, lo del panel UI) -> que responde?
// El template se crea aca (no en setup) para maximizar chance de misma instancia (snapshots en memoria).
import { tool, saveEvidence, summarizeToolResp, truncate, verdict, loadState, saveState, EFFECTIVE_KEY } from "./lib/client.mjs";

console.log("== s09 VERSIONS ==");
const { workspaceId } = loadState();
const ev = {};

// create
const c = await tool("create_template", {
  name: "verify-b-ver", workspaceId, engine: "html",
  html: "<div>V1</div>", css: ".v{color:#111}",
}, { apiKey: EFFECTIVE_KEY || undefined });
ev.create = summarizeToolResp(c, 600);
const verId = c.parsed?.id;
if (!verId) { console.log("  No se pudo crear verify-b-ver:", JSON.stringify(c.error)); process.exit(1); }
saveState({ verId });
console.log("  creado verify-b-ver:", verId);

// 2 updates via frames[]
for (const n of [2, 3]) {
  const u = await tool("update_template", {
    id: verId,
    frames: [{ id: c.parsed?.frames?.[0]?.id, name: "F1", x: 0, y: 0, width: 1080, height: 1080, html: "<div>V" + n + "</div>", css: ".v{color:#11" + n + "}", background: "#ffffff" }],
  }, { apiKey: EFFECTIVE_KEY || undefined });
  ev["update_v" + n] = { httpStatus: u.httpStatus, rpcError: u.error || null };
  console.log("  update V" + n + " -> HTTP " + u.httpStatus + (u.error ? (" RPC-" + u.error.code) : " OK"));
}

// list_versions
const lv = await tool("list_versions", { id: verId }, { apiKey: EFFECTIVE_KEY || undefined });
ev.list_versions = summarizeToolResp(lv, 2000);
const versions = lv.parsed?.versions || [];
console.log("  list_versions -> total:", lv.parsed?.total ?? "?", "entradas:", versions.length);
if (versions.length) console.log("      " + truncate(JSON.stringify(versions), 400).replace(/\n/g, " "));
verdict("hay versiones?", versions.length > 0, versions.length + " versiones");

// restore_version con versionId (string de list_versions)
const firstVersionId = versions[0]?.id;
if (firstVersionId) {
  const rv = await tool("restore_version", { id: verId, versionId: firstVersionId }, { apiKey: EFFECTIVE_KEY || undefined });
  ev.restore_by_versionId = summarizeToolResp(rv, 900);
  console.log("  restore_version(versionId=" + firstVersionId + ") -> HTTP " + rv.httpStatus + (rv.error ? (" RPC-" + rv.error.code + ": " + truncate(rv.error.message, 200)) : " OK"));
} else {
  ev.restore_by_versionId = { skipped: "no habia versionId (lista vacia)" };
  console.log("  restore_version(versionId): SKIP - lista vacia");
}

// restore_version con version NUMERICO (lo que envia el panel UI, segun la afirmacion)
const rv2 = await tool("restore_version", { id: verId, version: 1 }, { apiKey: EFFECTIVE_KEY || undefined });
ev.restore_by_numeric_version = summarizeToolResp(rv2, 900);
console.log("  restore_version(version=1 numerico) -> HTTP " + rv2.httpStatus + (rv2.error ? (" RPC-" + rv2.error.code + ": " + truncate(rv2.error.message, 200)) : " OK"));

ev.conclusion = "ver informe";
saveEvidence("09-versions.json", ev);
