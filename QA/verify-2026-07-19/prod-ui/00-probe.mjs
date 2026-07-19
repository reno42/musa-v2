/**
 * 00-probe.mjs — Probe de la API de PRODUCCIÓN (https://design.futuraria.com)
 * Ciclo de vida completo con objetos verify-a2-*: workspace → template → PUT → GET →
 * soft-delete → purge → delete workspace. NO usa secretos (la API prod no exige key
 * en writes hoy — auth.ts acepta todo si MCP_ADMIN_KEY no está seteada).
 */
const BASE = "https://design.futuraria.com";
const ts = () => new Date().toISOString();
const log = (...a) => console.log(`[${ts()}]`, ...a);

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json };
}

const ids = { ws: null, tpl: null };
try {
  // Reusar workspace verify-a2-ws si quedó de una corrida anterior
  const wsList = await req("GET", "/api/workspaces");
  const existing = (wsList.json?.data || []).find(w => w.name === "verify-a2-ws");
  if (existing) {
    ids.ws = existing.id;
    log("workspace reuse", ids.ws);
  } else {
    const ws = await req("POST", "/api/workspaces", { name: "verify-a2-ws", description: "QA live verification 2026-07-19" });
    log("workspace create", ws.status, ws.json?.data?.id || ws.json?.error);
    ids.ws = ws.json?.data?.id;
  }

  const tpl = await req("POST", "/api/templates", {
    workspaceId: ids.ws, name: "verify-a2-probe", width: 1080, height: 1080, engine: "html",
  });
  log("template create", tpl.status, tpl.json?.data?.id || tpl.json?.error);
  ids.tpl = tpl.json?.data?.id;

  const frames = [{
    id: "frame_a2_probe", name: "Probe", x: 0, y: 0, width: 1080, height: 1080,
    background: "#0E0D0B",
    html: '<div data-layer-id="box1" data-layer-name="Box1" style="position:absolute;left:100px;top:100px;width:200px;height:200px;background:#C8B898;"></div>',
    css: "",
  }];
  const put = await req("PUT", `/api/templates/${ids.tpl}`, { frames, name: "verify-a2-probe" });
  log("template PUT", put.status, put.json?.success ?? put.json?.error);

  const get = await req("GET", `/api/templates/${ids.tpl}`);
  const gotFrames = get.json?.data?.frames || [];
  log("template GET", get.status, "frames:", gotFrames.length, "layer box1 presente:", JSON.stringify(gotFrames).includes("box1"));
} catch (err) {
  log("FATAL", err.message);
} finally {
  // Limpieza: soft-delete + purge + delete workspace
  if (ids.tpl) {
    const d1 = await req("DELETE", `/api/templates/${ids.tpl}`);
    const d2 = await req("DELETE", `/api/templates/${ids.tpl}/permanent`);
    log("template cleanup", "soft:", d1.status, "purge:", d2.status);
  }
  const trash = await req("GET", "/api/templates/trash");
  const trashVerify = (trash.json?.data || []).filter(t => (t.name || "").startsWith("verify-a2-")).length;
  log("trash verify-a2-* restantes:", trashVerify);
}
log("DONE writesPossible:", Boolean(ids.tpl));
