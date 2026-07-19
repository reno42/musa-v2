// Ítem 5 — RESTORE-REST: POST /api/templates/:id/versions/:versionId/restore
// sobre el template del ítem 4 (engine=html, versiones con html/css, canvas=null)
import { readFileSync } from "node:fs";

const BASE = "http://localhost:3002";
const H = {
  "Content-Type": "application/json",
  "x-api-key": "dev-key",
  "x-forwarded-for": "10.66.1.5",
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

const { templateId: id } = JSON.parse(
  readFileSync(new URL("./state.json", import.meta.url), "utf8")
);
console.log(`template del ítem 4: ${id}`);

// 1) estado actual
const g0 = await req("GET", `/api/templates/${id}`);
const cur = JSON.parse(g0.text).data;
console.log(`\n[1] html actual: length=${cur.html?.length} (esperado ~210011, del PUT grande)`);

// 2) elegir la versión más antigua conservada (html="<div>v3</div>")
const lv = await req("GET", `/api/templates/${id}/versions`);
const versions = JSON.parse(lv.text).data;
const v = versions[0];
console.log(`\n[2] versión a restaurar: id=${v.id} html=${JSON.stringify(v.html)} css=${JSON.stringify(v.css)} canvas=${JSON.stringify(v.canvas)}`);

// 3) restore por REST
const r = await req("POST", `/api/templates/${id}/versions/${v.id}/restore`);
console.log(`\n[3] POST /versions/${v.id}/restore → ${r.status}`);
console.log(`    body: ${r.text}`);

// 4) ¿restauró algo útil?
const g1 = await req("GET", `/api/templates/${id}`);
const after = JSON.parse(g1.text).data;
console.log(`\n[4] html tras restore REST: ${JSON.stringify(after.html)}`);
console.log(`    ¿html restaurado a la versión? ${after.html === v.html}`);
console.log(`    ¿canvas del template? ${JSON.stringify(after.canvas)}`);

// 5) la misma operación por MCP restore_version (el análisis dice: solo restaura canvas)
const m = await req("POST", "/mcp", {
  jsonrpc: "2.0", id: 3, method: "tools/call",
  params: { name: "restore_version", arguments: { id, versionId: v.id } },
});
console.log(`\n[5] MCP restore_version → ${m.status}`);
console.log(`    body (truncado): ${m.text.slice(0, 400)}`);

// 6) estado final del html
const g2 = await req("GET", `/api/templates/${id}`);
const fin = JSON.parse(g2.text).data;
console.log(`\n[6] html final tras intento MCP: ${JSON.stringify(fin.html)}`);
