// Ítem 1 — PUT-BASE64-STRIP: PUT REST elimina data-URIs base64? ¿Y vía MCP?
// Instancia: http://localhost:3002 (memoria, sin Supabase)
import { randomBytes } from "node:crypto";

const BASE = "http://localhost:3002";
const H = {
  "Content-Type": "application/json",
  "x-api-key": "dev-key",
  "x-forwarded-for": "10.66.1.1",
};

const b64 = randomBytes(3840).toString("base64"); // 5120 chars ≈ 5KB
const dataUri = `data:image/png;base64,${b64}`;
const topHtml = `<div><img src="${dataUri}" alt="pixel"></div>`;
const frameHtml = `<section><img src="${dataUri}" alt="pixel"></section>`;

const snip = (s, n = 120) =>
  s == null ? String(s) : s.length > n ? `${s.slice(0, n)}…[${s.length} chars]` : s;

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text };
}

console.log(`[setup] base64 generado: ${b64.length} chars; dataUri: ${snip(dataUri, 60)}`);

// 1) Crear template engine=html vía REST
const c = await req("POST", "/api/templates", {
  name: "qa-base64-strip",
  workspaceId: "ws_qa_verify",
  engine: "html",
  html: topHtml,
  css: "",
});
console.log(`\n[1] POST /api/templates → ${c.status}`);
if (c.status !== 201) {
  console.log(`    FALLO: ${snip(c.text, 300)}`);
  process.exit(1);
}
const tpl = JSON.parse(c.text).data;
console.log(`    id=${tpl.id} engine=${tpl.engine}`);
const frameId = tpl.frames?.[0]?.id;
console.log(`    frameId=${frameId}`);
console.log(`    frame[0].html tras create: ${snip(tpl.frames?.[0]?.html, 80)}`);

// 2) PUT REST con el data-URI en html de nivel superior y en el frame
const putBody = {
  engine: "html",
  html: topHtml,
  css: "",
  frames: [
    { id: frameId, name: "F1", x: 0, y: 0, width: 1080, height: 1080, html: frameHtml, css: "" },
  ],
};
const p = await req("PUT", `/api/templates/${tpl.id}`, putBody);
console.log(`\n[2] PUT /api/templates/${tpl.id} → ${p.status}`);

// 3) GET y comprobar qué sobrevivió
const g = await req("GET", `/api/templates/${tpl.id}`);
const d = JSON.parse(g.text).data;
console.log(`\n[3] GET /api/templates/${tpl.id} → ${g.status}`);
console.log(`    top html: ${snip(d.html)}`);
console.log(`    top html contiene "data:image"? ${d.html?.includes("data:image")}`);
const fh = d.frames?.[0]?.html ?? "";
console.log(`    frame[0].html: ${snip(fh)}`);
console.log(`    frame[0] contiene "data:image"? ${fh.includes("data:image")}`);
console.log(`    frame[0] <img> resultante: ${fh.match(/<img[^>]*>/)?.[0]}`);

// 4) Misma operación vía MCP local (POST /mcp → netlify/functions/mcp.mjs update_template)
const mcpBody = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "update_template",
    arguments: {
      id: tpl.id,
      html: topHtml,
      frames: [
        { id: frameId, name: "F1", x: 0, y: 0, width: 1080, height: 1080, html: frameHtml, css: "" },
      ],
    },
  },
};
const m = await req("POST", "/mcp", mcpBody);
console.log(`\n[4] POST /mcp tools/call update_template → ${m.status}`);
console.log(`    respuesta MCP (truncada): ${snip(m.text, 250)}`);

// 5) GET de nuevo: ¿el MCP preservó el data-URI?
const g2 = await req("GET", `/api/templates/${tpl.id}`);
const d2 = JSON.parse(g2.text).data;
const fh2 = d2.frames?.[0]?.html ?? "";
console.log(`\n[5] GET tras MCP → ${g2.status}`);
console.log(`    top html contiene "data:image"? ${d2.html?.includes("data:image")}`);
console.log(`    frame[0] contiene "data:image"? ${fh2.includes("data:image")}`);
console.log(`    frame[0] <img> resultante: ${snip(fh2.match(/<img[^>]*>/)?.[0], 90)}`);
console.log(`    top html (truncado): ${snip(d2.html, 90)}`);
