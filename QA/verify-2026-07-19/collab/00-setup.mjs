/**
 * 00-setup.mjs — crea el template verify-c-collab en producción (3 frames, texto simple)
 * y guarda su identidad en state.json para los scripts siguientes.
 */
import { mcp, log, logJson } from "./lib.mjs";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const FRAME_HTML = (title, body) => [
  `<div data-layer-id="card_${title.replace(/\W/g, "")}" data-layer-name="Card" style="position:absolute;left:40px;top:40px;width:520px;height:300px;background:#12203a;border-radius:20px;padding:32px;box-sizing:border-box;">`,
  `  <h1 data-layer-id="h1_${title.replace(/\W/g, "")}" data-layer-name="Title" style="margin:0;font-family:sans-serif;font-size:40px;color:#EDE8DC;">${title}</h1>`,
  `  <p data-layer-id="p_${title.replace(/\W/g, "")}" data-layer-name="Body" style="margin:16px 0 0;font-family:sans-serif;font-size:20px;color:#8A8375;">${body}</p>`,
  `</div>`,
].join("\n");

async function main() {
  const ws = await mcp("list_workspaces", {});
  const workspaces = ws.data || ws.workspaces || [];
  log(`workspaces disponibles: ${workspaces.length}`);
  const target = workspaces[0];
  log(`usando workspace: ${target.name} (${target.id})`);

  const created = await mcp("create_template", {
    name: "verify-c-collab",
    workspaceId: target.id,
    width: 1080,
    height: 1080,
    engine: "html",
  });
  const templateId = created.id || created.data?.id || created.template?.id;
  log(`template creado: ${templateId}`);

  const frames = [
    { id: "vc_frame1", name: "VC Frame 1", x: 0, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: FRAME_HTML("VC-ALPHA", "Texto original frame 1"), css: "" },
    { id: "vc_frame2", name: "VC Frame 2", x: 1200, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: FRAME_HTML("VC-BETA", "Texto original frame 2"), css: "" },
    { id: "vc_frame3", name: "VC Frame 3", x: 2400, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: FRAME_HTML("VC-GAMMA", "Texto original frame 3"), css: "" },
  ];
  await mcp("update_template", { id: templateId, frames });
  log("frames escritos: vc_frame1, vc_frame2, vc_frame3");

  // verificación de lectura
  const tpl = await mcp("get_template", { id: templateId });
  const got = (tpl.frames || []).map((f) => `${f.id}:${(f.html || "").includes("VC-") ? "ok" : "???"}`);
  logJson("verificación get_template", got);

  writeFileSync(join(HERE, "state.json"), JSON.stringify({
    templateId, workspaceId: target.id,
    frameIds: frames.map((f) => f.id),
    createdAt: new Date().toISOString(),
  }, null, 2));
  log("state.json escrito");
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
