// s07_stubs.mjs - ITEM 7 (STUBS): respuestas de 9 tools sospechosas de exito falso.
import { tool, saveEvidence, truncate, redact, loadState, EFFECTIVE_KEY } from "./lib/client.mjs";

console.log("== s07 STUBS ==");
const { noopId } = loadState();
const ev = {};

const calls = [
  ["enhance_template", { templateId: noopId, instruction: "Hazlo mas moderno" }],
  ["preview_font", { templateId: noopId, fontFamily: "Inter" }],
  ["optimize_image", { imageUrl: "https://example.com/pic.png" }],
  ["search_stock_image", { query: "mountain" }],
  ["ai_generate_image", { prompt: "a blue square" }],
  ["export_pdf", { templateId: noopId }],
  ["get_font_details", { family: "Zxyq Notarealfont" }],
  ["subscribe_template", { templateId: noopId, channelType: "changes" }],
  ["broadcast_section_change", { channelId: "template:" + noopId + ":changes", sectionId: "sec1", html: "<div>x</div>" }],
];

for (const [name, args] of calls) {
  const r = await tool(name, args, { apiKey: EFFECTIVE_KEY || undefined });
  ev[name] = {
    httpStatus: r.httpStatus,
    rpcError: r.error || null,
    responseTruncated: truncate(redact(r.text ?? r.rawBody ?? ""), 900),
  };
  console.log("  " + name + " -> HTTP " + r.httpStatus + (r.error ? (" RPC-" + r.error.code + ": " + truncate(r.error.message, 160)) : " OK"));
  console.log("      " + truncate(redact(r.text ?? ""), 220).replace(/\n/g, " "));
}

saveEvidence("07-stubs.json", ev);
console.log("  Evidencia guardada en evidence/07-stubs.json");
