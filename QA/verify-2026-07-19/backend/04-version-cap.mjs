// Ítem 4 — VERSION-CAP: 12 PUTs pequeños (cap 10) + 1 PUT >200KB (skip snapshot)
import { writeFileSync } from "node:fs";

const BASE = "http://localhost:3002";
const H = {
  "Content-Type": "application/json",
  "x-api-key": "dev-key",
  "x-forwarded-for": "10.66.1.4",
};

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, text };
}

// 0) crear template engine=html
const c = await req("POST", "/api/templates", {
  name: "qa-version-cap",
  workspaceId: "ws_qa_verify",
  engine: "html",
  html: "<div>v0</div>",
  css: "",
});
const tpl = JSON.parse(c.text).data;
const id = tpl.id;
console.log(`[0] POST create → ${c.status} id=${id}`);
writeFileSync(new URL("./state.json", import.meta.url), JSON.stringify({ templateId: id }, null, 2));

// 1) 12 PUTs consecutivos con cambios pequeños
let versionsInPut = 0;
for (let i = 1; i <= 12; i++) {
  const r = await req("PUT", `/api/templates/${id}`, {
    engine: "html",
    html: `<div>v${i}</div>`,
    css: "",
  });
  const d = JSON.parse(r.text).data;
  versionsInPut = d?.versions?.length ?? -1;
  console.log(`[1] PUT #${i} → ${r.status} versions en respuesta: ${versionsInPut}`);
}

// 2) listar versiones vía REST
const lv = await req("GET", `/api/templates/${id}/versions`);
const lvd = JSON.parse(lv.text);
console.log(`\n[2] GET /versions → ${lv.status} total=${lvd.total}`);
console.log(`    primera conservada: id=${lvd.data[0]?.id} html=${JSON.stringify(lvd.data[0]?.html)} label=${JSON.stringify(lvd.data[0]?.label)}`);
console.log(`    última conservada:  id=${lvd.data.at(-1)?.id} html=${JSON.stringify(lvd.data.at(-1)?.html)}`);

// 2b) cross-check vía MCP list_versions
const m = await req("POST", "/mcp", {
  jsonrpc: "2.0", id: 2, method: "tools/call",
  params: { name: "list_versions", arguments: { id } },
});
const mText = JSON.parse(m.text)?.result?.content?.[0]?.text ?? m.text;
console.log(`\n[2b] MCP list_versions → ${m.status} (truncado): ${mText.slice(0, 220).replace(/\n/g, " ")}`);

// 3) PUT con html > 200KB → debería saltarse el snapshot
const bigHtml = "<div>" + "B".repeat(210_000) + "</div>";
console.log(`\n[3] PUT grande: html.length=${bigHtml.length} (>200000)`);
const rb = await req("PUT", `/api/templates/${id}`, { engine: "html", html: bigHtml, css: "" });
const db = JSON.parse(rb.text).data;
console.log(`    PUT grande → ${rb.status}; versions en respuesta: ${db?.versions?.length}; html almacenado length=${db?.html?.length}`);

// 4) contar de nuevo
const lv2 = await req("GET", `/api/templates/${id}/versions`);
const lvd2 = JSON.parse(lv2.text);
console.log(`\n[4] GET /versions tras PUT grande → total=${lvd2.total}`);
console.log(`    primera: html=${JSON.stringify(lvd2.data[0]?.html)}`);
console.log(`    última:  html=${JSON.stringify(lvd2.data.at(-1)?.html)} label=${JSON.stringify(lvd2.data.at(-1)?.label)}`);
const g = await req("GET", `/api/templates/${id}`);
const gd = JSON.parse(g.text).data;
console.log(`    template actual html.length=${gd.html?.length} (el PUT grande SÍ se aplicó)`);
