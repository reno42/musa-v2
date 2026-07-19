// s08_render.mjs - ITEM 8 (RENDER):
// render_batch sobre verify-b-noop -> PNG binario o solo JSON/_links?
// Sigue _links.render y documenta content-type de lo que responde.
import { tool, saveEvidence, summarizeToolResp, truncate, redact, verdict, loadState, EFFECTIVE_KEY, BASE } from "./lib/client.mjs";

console.log("== s08 RENDER ==");
const { noopId } = loadState();
const ev = {};

const r = await tool("render_batch", { templateIds: [noopId], format: "png", scale: 1 }, { apiKey: EFFECTIVE_KEY || undefined });
ev.render_batch = summarizeToolResp(r, 2000);
console.log("  render_batch -> HTTP", r.httpStatus, r.error ? ("RPC-" + r.error.code) : "OK");
console.log("      " + truncate(redact(r.text ?? ""), 400).replace(/\n/g, " "));

const result0 = r.parsed?.results?.[0];
const renderLink = result0?._links?.render;
const viewLink = result0?._links?.view;
ev._links = result0?._links || null;
ev.isBinaryPng = false;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Seguir _links.render (GET) y mirar content-type + primeros bytes
if (renderLink) {
  await sleep(400);
  const url = BASE + renderLink;
  const res = await fetch(url, { headers: EFFECTIVE_KEY ? { "x-api-key": EFFECTIVE_KEY } : {} });
  const ct = res.headers.get("content-type") || "";
  const buf = Buffer.from(await res.arrayBuffer());
  const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50; // %PNG
  ev.follow_render = {
    url, httpStatus: res.status, contentType: ct, bytes: buf.length,
    isPngBinary: isPng,
    bodyPreview: isPng ? "<PNG binario>" : truncate(redact(buf.toString("utf8")), 1200),
  };
  ev.isBinaryPng = isPng;
  console.log("  GET " + renderLink + " -> " + res.status + " " + ct + " (" + buf.length + " bytes)" + (isPng ? " PNG BINARIO" : " no-binario"));
  // Pistas de html2canvas client-side
  const bodyStr = isPng ? "" : buf.toString("utf8");
  ev.follow_render.mentions_html2canvas = bodyStr.includes("html2canvas");
  console.log("      menciona html2canvas?", ev.follow_render.mentions_html2canvas);
}

// Tambien documentar _links.view por completitud
if (viewLink) {
  await sleep(400);
  const res = await fetch(BASE + viewLink, { headers: EFFECTIVE_KEY ? { "x-api-key": EFFECTIVE_KEY } : {} });
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  ev.follow_view = { url: BASE + viewLink, httpStatus: res.status, contentType: ct, bytes: text.length, bodyPreview: truncate(redact(text), 600) };
  console.log("  GET " + viewLink + " -> " + res.status + " " + ct + " (" + text.length + " bytes)");
}

ev.conclusion = ev.isBinaryPng
  ? "REFUTADO: hay PNG binario server-side"
  : "VERIFICADO: no hay PNG binario; render_batch devuelve JSON con _links a pagina HTML (html2canvas client-side: " + Boolean(ev.follow_render?.mentions_html2canvas) + ")";
saveEvidence("08-render.json", ev);
verdict("PNG binario por alguna via?", ev.isBinaryPng);
console.log("  RESULTADO ITEM 8:", ev.conclusion);
