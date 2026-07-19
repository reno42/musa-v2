// s04_update_noop.mjs - ITEM 4 (UPDATE-NOOP):
// update_template {id, html, css} a nivel top -> get_template -> MARCADOR-NOOP-123 esta en frames[0].html?
// Afirmacion: NO esta (no-op silencioso con 200). Luego update con frames[] completo -> esa ruta SI escribe.
import { tool, saveEvidence, summarizeToolResp, truncate, verdict, loadState, EFFECTIVE_KEY } from "./lib/client.mjs";

console.log("== s04 UPDATE-NOOP ==");
const { noopId } = loadState();
if (!noopId) { console.log("  FALTA noopId en state.json (corre s00 primero)"); process.exit(1); }
const ev = {};

// 0) Estado inicial
const before = await tool("get_template", { id: noopId }, { apiKey: EFFECTIVE_KEY || undefined });
ev.before = { frameCount: before.parsed?.frames?.length, frame0html: truncate(before.parsed?.frames?.[0]?.html || "", 200) };
console.log("  frames[0].html inicial:", ev.before.frame0html);

// 1) update a nivel TOP con html/css
const upd = await tool("update_template", {
  id: noopId,
  html: "<div>MARCADOR-NOOP-123</div>",
  css: ".x{color:red}",
}, { apiKey: EFFECTIVE_KEY || undefined });
ev.update_toplevel = summarizeToolResp(upd, 1200);
console.log("  update_template(top html/css) -> HTTP", upd.httpStatus, upd.error ? ("error " + upd.error.code) : "200 sin error");

// 2) get_template -> buscar el marcador en frames[0].html
const after = await tool("get_template", { id: noopId }, { apiKey: EFFECTIVE_KEY || undefined });
const frameHtml = after.parsed?.frames?.[0]?.html || "";
const inFrame = frameHtml.includes("MARCADOR-NOOP-123");
const inTopLevel = (after.parsed?.html || "").includes("MARCADOR-NOOP-123");
ev.after_toplevel = {
  marker_in_frames0_html: inFrame,
  marker_in_toplevel_html: inTopLevel,
  frame0html: truncate(frameHtml, 250),
  toplevel_html: truncate(after.parsed?.html || "", 250),
};
verdict("MARCADOR-NOOP-123 en frames[0].html?", inFrame, "(afirmacion: NO esta = no-op silencioso)");
console.log("  marker en tpl.html top-level?", inTopLevel);

// 3) Ruta frames[] completa (con id de frame) -> SI deberia escribir
const framesFull = [{
  id: after.parsed?.frames?.[0]?.id,
  name: after.parsed?.frames?.[0]?.name || "Frame 1",
  x: 0, y: 0, width: 800, height: 600,
  html: "<div>MARCADOR-NOOP-123-VIA-FRAMES</div>",
  css: ".x{color:red}",
  background: "#ffffff",
}];
const upd2 = await tool("update_template", { id: noopId, frames: framesFull }, { apiKey: EFFECTIVE_KEY || undefined });
ev.update_frames = summarizeToolResp(upd2, 800);
const after2 = await tool("get_template", { id: noopId }, { apiKey: EFFECTIVE_KEY || undefined });
const frameHtml2 = after2.parsed?.frames?.[0]?.html || "";
const framesWrote = frameHtml2.includes("MARCADOR-NOOP-123-VIA-FRAMES");
ev.after_frames = { marker_via_frames: framesWrote, frame0html: truncate(frameHtml2, 250) };
verdict("ruta frames[] escribe?", framesWrote);

ev.conclusion = !inFrame && framesWrote
  ? "VERIFICADO: update top-level html/css es no-op silencioso (200); frames[] si escribe"
  : inFrame
    ? "REFUTADO: update top-level si escribe en frames[0].html"
    : "PARCIAL: top-level " + (inFrame ? "escribe" : "no escribe") + ", frames[] " + (framesWrote ? "escribe" : "TAMPOCO escribe");
saveEvidence("04-update-noop.json", ev);
console.log("  RESULTADO ITEM 4:", ev.conclusion);
