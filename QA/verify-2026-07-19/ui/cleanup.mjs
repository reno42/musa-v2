/**
 * Limpieza: borra cualquier plantilla verify-a1-* que haya quedado (p.ej. si un
 * test murió a mitad). Uso: node cleanup.mjs
 */
import { mcp } from "./lib.mjs";

async function main() {
  const ws = await mcp("list_workspaces", {});
  const arr = ws.data || ws.workspaces || ws || [];
  const w = (Array.isArray(arr) ? arr : []).find(x => x.name === "editor-qa");
  if (!w) { console.log("workspace editor-qa no existe; nada que limpiar"); return; }

  let templates = [];
  try {
    const list = await mcp("list_templates", { workspaceId: w.id });
    templates = list.data || list.templates || list || [];
  } catch (e) {
    console.log("list_templates falló:", e.message);
    return;
  }
  const victims = (Array.isArray(templates) ? templates : []).filter(t => /^verify-a1-/.test(t.name || ""));
  console.log(`verify-a1-* encontradas: ${victims.length}`);
  for (const t of victims) {
    try {
      await mcp("delete_template", { id: t.id });
      console.log(`  borrada ${t.id} (${t.name})`);
    } catch (e) {
      console.log(`  no se pudo borrar ${t.id}: ${e.message}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
