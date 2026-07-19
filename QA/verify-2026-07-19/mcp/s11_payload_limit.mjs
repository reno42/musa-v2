// s11_payload_limit.mjs - ITEM 11 (PAYLOAD-LIMIT):
// create_template con html de ~6MB de junk generado in-script -> error limpio (codigo/mensaje) o crash/opaco?
// Nota: el limite declarado del handler es 5MB (MAX_PAYLOAD_BYTES) con 413 + -32000.
import { mcpCall, saveEvidence, truncate, redact, verdict, loadState, EFFECTIVE_KEY } from "./lib/client.mjs";

console.log("== s11 PAYLOAD-LIMIT ==");
const { workspaceId } = loadState();
const ev = {};

// Generar junk ~6MB (solo en memoria, sin archivos del usuario)
const CHUNK = "<div class='junk'>AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA</div>\n"; // ~100 bytes
const targetBytes = 6 * 1024 * 1024;
const junkHtml = CHUNK.repeat(Math.ceil(targetBytes / CHUNK.length));
console.log("  html junk generado:", (Buffer.byteLength(junkHtml, "utf8") / 1024 / 1024).toFixed(2), "MB");

const r = await mcpCall("tools/call", {
  name: "create_template",
  arguments: { name: "verify-b-payload", workspaceId, engine: "html", html: junkHtml, css: ".junk{}" },
}, { apiKey: EFFECTIVE_KEY || undefined });

ev.httpStatus = r.httpStatus;
ev.contentType = r.contentType;
ev.rawBodyTruncated = truncate(redact(r.rawBody ?? ""), 1500);
ev.rpcError = r.json?.error || null;

console.log("  -> HTTP", r.httpStatus, r.contentType);
console.log("  body:", truncate(redact(r.rawBody ?? ""), 400).replace(/\n/g, " "));

// Si por casualidad se creo (no deberia), borrarlo
const createdId = r.json?.result?.content?.[0]?.text ? (() => { try { return JSON.parse(r.json.result.content[0].text)?.id; } catch { return null; } })() : null;
if (createdId) {
  console.log("  INESPERADO: se creo template", createdId, "- borrandolo");
  const d = await mcpCall("tools/call", { name: "delete_template", arguments: { id: createdId } }, { apiKey: EFFECTIVE_KEY || undefined });
  ev.cleanup_delete = { httpStatus: d.httpStatus, body: truncate(redact(d.rawBody ?? ""), 300) };
}

const clean = r.httpStatus === 413 && ev.rpcError?.code === -32000;
ev.conclusion = clean
  ? "VERIFICADO: error limpio 413 + -32000: " + truncate(ev.rpcError.message, 150)
  : "OTRO: HTTP " + r.httpStatus + " " + truncate(ev.rpcError?.message || r.rawBody || "", 200);
saveEvidence("11-payload-limit.json", ev);
verdict("error limpio 413/-32000?", clean);
console.log("  RESULTADO ITEM 11:", ev.conclusion);
