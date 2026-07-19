// s03_crlf.mjs - ITEM 3 (CRLF):
// create_template con css conteniendo CRLF -> espera error -32000 "css2.match is not a function" o exito?
// Contraste con LF puro. Borra lo creado al final.
import { tool, saveEvidence, summarizeToolResp, truncate, verdict, loadState, EFFECTIVE_KEY } from "./lib/client.mjs";

console.log("== s03 CRLF ==");
const { workspaceId } = loadState();
const ev = {};
const createdIds = [];

// a) CSS con CRLF
const cssCrlf = ".verify-a {\r\n  color: #ff0000;\r\n}\r\n.verify-b {\r\n  margin: 0;\r\n}";
const rCrlf = await tool("create_template", {
  name: "verify-b-crlf", workspaceId, engine: "html",
  html: "<div class='verify-a'>CRLF probe</div>", css: cssCrlf,
}, { apiKey: EFFECTIVE_KEY || undefined });
ev.crlf = summarizeToolResp(rCrlf, 2000);
const crlfMatchBug = rCrlf.error && /\.match is not a function/i.test(rCrlf.error.message || "");
console.log("  create(css CRLF) -> HTTP", rCrlf.httpStatus, rCrlf.error ? ("error " + rCrlf.error.code + ": " + truncate(rCrlf.error.message, 250)) : ("OK id=" + rCrlf.parsed?.id));
if (rCrlf.parsed?.id) createdIds.push(rCrlf.parsed.id);
verdict("match-is-not-a-function con CRLF?", crlfMatchBug, rCrlf.error ? truncate(rCrlf.error.message, 250) : "(sin error)");

// b) Contraste: CSS con LF puro
const cssLf = cssCrlf.replace(/\r\n/g, "\n");
const rLf = await tool("create_template", {
  name: "verify-b-crlf-lf", workspaceId, engine: "html",
  html: "<div class='verify-a'>LF probe</div>", css: cssLf,
}, { apiKey: EFFECTIVE_KEY || undefined });
ev.lf = summarizeToolResp(rLf, 1200);
console.log("  create(css LF)   -> HTTP", rLf.httpStatus, rLf.error ? ("error " + rLf.error.code + ": " + truncate(rLf.error.message, 250)) : ("OK id=" + rLf.parsed?.id));
if (rLf.parsed?.id) createdIds.push(rLf.parsed.id);

// Round-trip del css almacenado (si el create CRLF funciono)
if (rCrlf.parsed?.id) {
  const g = await tool("get_template", { id: rCrlf.parsed.id }, { apiKey: EFFECTIVE_KEY || undefined });
  const storedCss = g.parsed?.frames?.[0]?.css ?? g.parsed?.css ?? "";
  ev.crlf_stored_css = { hasCR: storedCss.includes("\r"), hasLF: storedCss.includes("\n"), preview: truncate(JSON.stringify(storedCss), 300) };
  console.log("  css almacenado (crlf): hasCR=" + ev.crlf_stored_css.hasCR + " hasLF=" + ev.crlf_stored_css.hasLF);
}

// Cleanup inmediato de lo creado en este test
for (const id of createdIds) {
  const d = await tool("delete_template", { id }, { apiKey: EFFECTIVE_KEY || undefined });
  ev["delete_" + id] = summarizeToolResp(d, 400);
  console.log("  delete", id, "->", d.error ? ("error " + d.error.code + ": " + truncate(d.error.message, 120)) : "OK");
}

ev.conclusion = crlfMatchBug
  ? "VERIFICADO: bug CRLF sigue abierto (.match is not a function)"
  : rCrlf.error
    ? "INCONCLUSO: fallo con otro error: " + truncate(rCrlf.error.message, 200)
    : "REFUTADO: create_template con CRLF en css funciona";
saveEvidence("03-crlf.json", ev);
console.log("  RESULTADO ITEM 3:", ev.conclusion);
