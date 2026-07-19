/**
 * 04-claim-no-enforce.mjs — ÍTEM 4: CLAIM-NO-ENFORCE
 * Afirmación: ningún path de escritura enforcea claims.
 *  1. claim_section sobre vc_frame1 como agente "verify-agent" → ok.
 *  2. update_html_frame sobre vc_frame1 SIN claim / sin identidad de agente → ¿éxito o 409?
 *  3. (extra) segundo claim de OTRO agente sobre el mismo frame → ¿409 o pisa?
 *  4. release_section al terminar.
 */
import { mcp, log, logJson } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const { templateId } = JSON.parse(readFileSync(join(HERE, "state.json"), "utf8"));
const F1 = "vc_frame1";

const HTML_SIN_CLAIM = [
  '<div data-layer-id="card_VCALPHA" data-layer-name="Card" style="position:absolute;left:40px;top:40px;width:520px;height:300px;background:#12203a;border-radius:20px;padding:32px;box-sizing:border-box;">',
  '  <h1 data-layer-id="h1_VCALPHA" data-layer-name="Title" style="margin:0;font-family:sans-serif;font-size:40px;color:#EDE8DC;">WRITE-SIN-CLAIM</h1>',
  '  <p data-layer-id="p_VCALPHA" data-layer-name="Body" style="margin:16px 0 0;font-family:sans-serif;font-size:20px;color:#8A8375;">Escrito sin claim vigente</p>',
  '</div>',
].join("\n");

async function main() {
  log("═══ ÍTEM 4: CLAIM-NO-ENFORCE ═══");
  const r = {};

  // 1. claim como verify-agent
  try {
    const claim = await mcp("claim_section", { templateId, frameId: F1, agentId: "verify-agent", agentName: "Verify Agent" });
    logJson("1. claim_section(verify-agent) → OK", claim);
    r.claimOk = true;
  } catch (e) {
    log(`1. claim_section(verify-agent) → ERROR: ${e.message} (code ${e.code})`);
    r.claimOk = false;
  }

  // 2. write SIN claim sobre el frame reclamado
  try {
    const w = await mcp("update_html_frame", { templateId, frameId: F1, html: HTML_SIN_CLAIM });
    logJson("2. update_html_frame SIN claim sobre frame reclamado → ÉXITO (no 409)", typeof w === "object" ? { id: w.id, htmlLen: (w.html || "").length } : w);
    r.writeSinClaim = "exito";
  } catch (e) {
    log(`2. update_html_frame SIN claim → RECHAZADO: ${e.message} (code ${e.code})`);
    r.writeSinClaim = `rechazado code=${e.code}`;
  }

  // 3. claim conflictivo de otro agente
  try {
    const claim2 = await mcp("claim_section", { templateId, frameId: F1, agentId: "intruder-agent", agentName: "Intruder" });
    logJson("3. claim_section(intruder-agent) sobre frame ya reclamado → OK (pisa o coexisten)", claim2);
    r.claimConflictivo = "aceptado";
  } catch (e) {
    log(`3. claim_section(intruder-agent) → RECHAZADO: ${e.message} (code ${e.code})`);
    r.claimConflictivo = `rechazado code=${e.code}`;
  }

  // 4. release de ambos (best effort)
  for (const ag of ["verify-agent", "intruder-agent"]) {
    try {
      const rel = await mcp("release_section", { templateId, frameId: F1, agentId: ag });
      logJson(`4. release_section(${ag}) → OK`, rel);
    } catch (e) {
      log(`4. release_section(${ag}) → ${e.message} (code ${e.code})`);
    }
  }

  // estado final del frame (debe mostrar WRITE-SIN-CLAIM si el write sin claim mordió)
  const tpl = await mcp("get_template", { id: templateId });
  const f1 = (tpl.frames || []).find((f) => f.id === F1);
  r.frame1ContieneWriteSinClaim = !!(f1 && (f1.html || "").includes("WRITE-SIN-CLAIM"));
  r.afirmacion = "update_html_frame tiene éxito aunque el frame esté reclamado por otro agente";
  r.veredicto = (r.writeSinClaim === "exito" && r.frame1ContieneWriteSinClaim) ? "VERIFICADO" : "REFUTADO";
  logJson("RESULTADO ÍTEM 4", r);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
