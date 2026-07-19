/**
 * 99-cleanup.mjs — Limpieza final: purga TODOS los objetos verify-a2-* de producción
 * (templates vivos + papelera + workspace verify-a2-ws) y verifica que no quede nada.
 */
import { api, verifyLeftovers, log } from "./lib.mjs";

const purgeAll = async () => {
  const { live, trashed } = await verifyLeftovers();
  for (const t of [...live, ...trashed]) {
    const d1 = await api("DELETE", `/api/templates/${t.id}`);
    const d2 = await api("DELETE", `/api/templates/${t.id}/permanent`);
    log("purgado", t.name, t.id, `soft:${d1.status} permanent:${d2.status}`);
  }
  return live.length + trashed.length;
};

const n1 = await purgeAll();

// Workspace verify-a2-ws
const wsList = await api("GET", "/api/workspaces");
const wsTargets = (wsList.json?.data || []).filter(w => (w.name || "").startsWith("verify-a2-"));
for (const w of wsTargets) {
  const d = await api("DELETE", `/api/workspaces/${w.id}`);
  log("workspace borrado", w.name, w.id, d.status);
}

// Verificación final
const after = await verifyLeftovers();
const wsAfter = (await api("GET", "/api/workspaces")).json?.data || [];
const wsLeft = wsAfter.filter(w => (w.name || "").startsWith("verify-a2-"));
const result = {
  purgedTemplates: n1,
  deletedWorkspaces: wsTargets.length,
  leftovers: { live: after.live, trashed: after.trashed, workspaces: wsLeft.map(w => w.name) },
  clean: after.live.length === 0 && after.trashed.length === 0 && wsLeft.length === 0,
};
console.log("\n===== CLEANUP =====");
console.log(JSON.stringify(result, null, 2));
if (!result.clean) process.exit(1);
