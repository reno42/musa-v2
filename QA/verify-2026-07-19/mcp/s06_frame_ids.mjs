// s06_frame_ids.mjs - ITEM 6 (FRAME-IDS):
// update_template con frames[] SIN campo id -> get_template -> los frames tienen id o se guardaron sin id?
import { tool, saveEvidence, summarizeToolResp, truncate, verdict, loadState, EFFECTIVE_KEY } from "./lib/client.mjs";

console.log("== s06 FRAME-IDS ==");
const { noopId } = loadState();
const ev = {};

const framesNoIds = [
  { name: "SinID-1", x: 0, y: 0, width: 800, height: 600, html: "<div>FRAME-SIN-ID-1</div>", css: ".a{color:#111}", background: "#ffffff" },
  { name: "SinID-2", x: 850, y: 0, width: 800, height: 600, html: "<div>FRAME-SIN-ID-2</div>", css: ".b{color:#222}", background: "#ffffff" },
];
const upd = await tool("update_template", { id: noopId, frames: framesNoIds }, { apiKey: EFFECTIVE_KEY || undefined });
ev.update = summarizeToolResp(upd, 800);
console.log("  update_template(frames sin id) -> HTTP", upd.httpStatus, upd.error ? ("error " + upd.error.code + ": " + truncate(upd.error.message, 150)) : "200 sin error");

const g = await tool("get_template", { id: noopId }, { apiKey: EFFECTIVE_KEY || undefined });
const frames = g.parsed?.frames || [];
ev.frames_after = frames.map(f => ({ id: f.id ?? null, name: f.name, hasHtml: Boolean(f.html) }));
const withId = frames.filter(f => f.id).length;
console.log("  frames guardados:", JSON.stringify(ev.frames_after));
verdict("frames con id?", withId === frames.length && frames.length > 0, withId + "/" + frames.length + " tienen id");

ev.conclusion = frames.length > 0 && withId === 0
  ? "VERIFICADO: frames guardados SIN id"
  : withId === frames.length && frames.length > 0
    ? "REFUTADO: el servidor asigna ids a los frames"
    : "PARCIAL: " + withId + " de " + frames.length + " con id";
saveEvidence("06-frame-ids.json", ev);
console.log("  RESULTADO ITEM 6:", ev.conclusion);
