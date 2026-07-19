/**
 * 07-restore-rescate.mjs — ÍTEM 7: RESTORE-RESCATE
 * Afirmación: tras romper el template vía MCP, el rescate por versiones NO funciona
 * (restore escribe `canvas`, que es null/no-op en templates HTML; y hay mismatch
 * de parámetros si se usa `version` en vez de `versionId`).
 *
 *  1. Reset a estado limpio ("PRE-BREAK"). list_versions baseline.
 *  2. Romper vc_frame1 vía update_html_frame (html destrozado). Confirmar.
 *  3. list_versions → ¿hay versiones?
 *  4. Intento A: restore_version con versionId → ¿restaura los frames HTML?
 *  5. Intento B: restore_version con `version` (param equivocado) → ¿error?
 *  6. (Control) rescate manual re-escribiendo frames vía update_template → eso sí funciona.
 */
import { mcp, log, logJson } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const { templateId } = JSON.parse(readFileSync(join(HERE, "state.json"), "utf8"));
const F1 = "vc_frame1", F2 = "vc_frame2", F3 = "vc_frame3";

const cleanFrames = () => [
  { id: F1, name: "VC Frame 1", x: 0, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: '<div data-layer-id="c1" data-layer-name="Card1" style="position:absolute;left:40px;top:40px;width:520px;height:300px;background:#12203a;border-radius:20px;padding:32px;"><h1 data-layer-id="h1c1" data-layer-name="T" style="margin:0;font-family:sans-serif;font-size:40px;color:#EDE8DC;">PRE-BREAK-OK</h1></div>', css: "" },
  { id: F2, name: "VC Frame 2", x: 1200, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: '<div data-layer-id="c2" data-layer-name="Card2" style="position:absolute;left:40px;top:40px;width:520px;height:300px;background:#1a2f1a;border-radius:20px;padding:32px;"><h1 data-layer-id="h1c2" data-layer-name="T" style="margin:0;font-family:sans-serif;font-size:40px;color:#EDE8DC;">AI-BASE</h1></div>', css: "" },
  { id: F3, name: "VC Frame 3", x: 2400, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: '<div data-layer-id="c3" data-layer-name="Card3" style="position:absolute;left:40px;top:40px;width:300px;height:200px;background:#2f1a1a;border-radius:20px;"></div>', css: "" },
];

const BROKEN_HTML = '<div><span style="x">###ROK3N###<section><unclosed><p class=>@@@';

async function f1Html() {
  const tpl = await mcp("get_template", { id: templateId });
  const f1 = (tpl.frames || []).find((f) => f.id === F1);
  return { html: f1?.html || "", tpl };
}

async function main() {
  log("═══ ÍTEM 7: RESTORE-RESCATE ═══");
  const r = { intentos: [] };

  // 1. Reset limpio
  await mcp("update_template", { id: templateId, frames: cleanFrames() });
  let cur = await f1Html();
  log(`reset limpio: frame1 tiene PRE-BREAK-OK: ${cur.html.includes("PRE-BREAK-OK")}`);

  const v0 = await mcp("list_versions", { id: templateId });
  logJson("list_versions ANTES de romper", { total: v0.total, versions: (v0.versions || []).slice(-5) });
  r.versionesAntes = v0.total;

  // 2. Romper
  log("rompiendo vc_frame1 vía MCP (html destrozado)...");
  await mcp("update_html_frame", { templateId, frameId: F1, html: BROKEN_HTML });
  cur = await f1Html();
  const confirmadoRoto = cur.html.includes("###ROK3N###");
  log(`frame1 roto confirmado server-side: ${confirmadoRoto}`);
  r.rotoConfirmado = confirmadoRoto;

  // 3. versions después
  const v1 = await mcp("list_versions", { id: templateId });
  logJson("list_versions DESPUÉS de romper", { total: v1.total, versions: (v1.versions || []).slice(-5) });
  r.versionesDespues = v1.total;

  // 4. Intento A: restore con versionId (el último disponible)
  const candidatos = (v1.versions || []);
  if (candidatos.length > 0) {
    const target = candidatos[candidatos.length - 1];
    log(`Intento A: restore_version(versionId=${target.id}) [${target.label || ""}]`);
    try {
      const ra = await mcp("restore_version", { id: templateId, versionId: target.id });
      logJson("  respuesta restore_version", { restored: ra.restored, versionId: ra.versionId });
      cur = await f1Html();
      const recuperado = cur.html.includes("PRE-BREAK-OK");
      const sigueRoto = cur.html.includes("###ROK3N###");
      log(`  tras restore A: frame1 recuperado (PRE-BREAK-OK): ${recuperado} | sigue roto: ${sigueRoto}`);
      r.intentos.push({ intento: "A-versionId", respuestaOk: !!ra.restored, framesRecuperados: recuperado, sigueRoto });
    } catch (e) {
      log(`  restore A → ERROR: ${e.message} (code ${e.code})`);
      r.intentos.push({ intento: "A-versionId", error: e.message, code: e.code });
    }
  } else {
    log("Intento A: IMPOSIBLE — list_versions devolvió 0 versiones");
    r.intentos.push({ intento: "A-versionId", error: "sin versiones disponibles" });
  }

  // 5. Intento B: param mismatch `version`
  log("Intento B: restore_version con param `version` (mismatch de parámetros)");
  try {
    const rb = await mcp("restore_version", { id: templateId, version: 1 });
    logJson("  respuesta (inesperadamente OK)", rb);
    r.intentos.push({ intento: "B-version", respuestaOk: true });
  } catch (e) {
    log(`  restore B → ERROR: ${e.message} (code ${e.code})`);
    r.intentos.push({ intento: "B-version", error: e.message, code: e.code });
  }

  cur = await f1Html();
  r.estadoTrasIntentos = { sigueRoto: cur.html.includes("###ROK3N###"), recuperado: cur.html.includes("PRE-BREAK-OK") };

  // 6. Control: rescate manual (re-escribir frames) — eso sí funciona
  log("Control: rescate MANUAL re-escribiendo frames vía update_template...");
  await mcp("update_template", { id: templateId, frames: cleanFrames() });
  cur = await f1Html();
  r.rescateManualFunciona = cur.html.includes("PRE-BREAK-OK");
  log(`rescate manual OK: ${r.rescateManualFunciona}`);

  const restoreFunciono = r.intentos.some((i) => i.framesRecuperados === true);
  r.afirmacion = "restore_version NO devuelve el template HTML al estado previo (restaura canvas, no frames)";
  r.veredicto = restoreFunciono ? "REFUTADO — restore_version sí recuperó los frames" : "VERIFICADO — el rescate por versiones no recupera los frames HTML";
  logJson("RESULTADO ÍTEM 7", r);
}

main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
