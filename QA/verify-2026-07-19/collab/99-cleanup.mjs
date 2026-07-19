/**
 * 99-cleanup.mjs — borra verify-c-collab y verifica con list_templates que ya no existe.
 */
import { mcp, log, logJson } from "./lib.mjs";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const { templateId, workspaceId } = JSON.parse(readFileSync(join(HERE, "state.json"), "utf8"));

async function main() {
  log("═══ CLEANUP ═══");
  const before = await mcp("list_templates", { workspaceId, search: "verify-c-collab" });
  const arrBefore = before.data || before.templates || before || [];
  log(`templates 'verify-c-collab' antes de borrar: ${arrBefore.length}`);

  await mcp("delete_template", { id: templateId });
  log(`delete_template(${templateId}) OK`);

  const after = await mcp("list_templates", { workspaceId, search: "verify-c-collab" });
  const arrAfter = after.data || after.templates || after || [];
  const stillThere = arrAfter.some((t) => t.id === templateId);
  logJson("RESULTADO CLEANUP", {
    encontradosAntes: arrBefore.length,
    encontradosDespues: arrAfter.length,
    sigueExistiendo: stillThere,
    veredicto: !stillThere ? "LIMPIEZA OK" : "FALLO — el template sigue existiendo",
  });

  // verificación extra por get_template (debe fallar)
  try {
    await mcp("get_template", { id: templateId });
    log("get_template tras borrado: ¡todavía responde! (revisar soft-delete)");
  } catch (e) {
    log(`get_template tras borrado falla como esperado: ${e.message}`);
  }
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
