// s05_export_empty.mjs - ITEM 5 (EXPORT-EMPTY):
// export_template de verify-b-noop (tiene frames con contenido) -> incluye frames/html/css o solo metadata?
import { tool, saveEvidence, truncate, redact, verdict, loadState, EFFECTIVE_KEY } from "./lib/client.mjs";

console.log("== s05 EXPORT-EMPTY ==");
const { noopId } = loadState();
const ev = {};

const r = await tool("export_template", { id: noopId }, { apiKey: EFFECTIVE_KEY || undefined });
const rawText = r.text || "";
ev.httpStatus = r.httpStatus;
ev.rpcError = r.error || null;
ev.bytes = rawText.length;
ev.keys = r.parsed && typeof r.parsed === "object" ? Object.keys(r.parsed) : null;
ev.templateKeys = r.parsed?.template ? Object.keys(r.parsed.template) : null;
ev.has_frames = Boolean(r.parsed?.template?.frames || r.parsed?.frames);
ev.has_html = Boolean(r.parsed?.template?.html || r.parsed?.html);
ev.has_css = Boolean(r.parsed?.template?.css || r.parsed?.css);
ev.full_json_truncated = truncate(redact(rawText), 2500);

console.log("  export_template -> HTTP", r.httpStatus, "bytes(text):", ev.bytes);
console.log("  keys:", JSON.stringify(ev.keys), "template keys:", JSON.stringify(ev.templateKeys));
verdict("incluye frames/html/css?", ev.has_frames || ev.has_html || ev.has_css, "(afirmacion: solo metadata ~438 bytes)");

ev.conclusion = (!ev.has_frames && !ev.has_html && !ev.has_css)
  ? "VERIFICADO: export_template devuelve solo metadata (" + ev.bytes + " bytes), sin frames/html/css"
  : "REFUTADO: export incluye contenido";
saveEvidence("05-export-empty.json", ev);
console.log("  RESULTADO ITEM 5:", ev.conclusion);
