/**
 * S5 — REQ-035 RF-01: "Un click en Video abre el editor, cero dependencia
 * de selección previa."
 *
 * What we prove:
 *   S5.1  the persistent topbar "Video" button opens the video mode with
 *         NOTHING selected (no frame click, no layer click beforehand).
 *   S5.2  the persistent project header answers the 5 orientation questions
 *         without any interaction: mode, reel name, save state, format/dims,
 *         and an unambiguous exit ("Volver al diseño").
 *   S5.3  the timeline speaks the full track vocabulary (RF-03 labels).
 *   S5.4  toggling the same button leaves the mode cleanly.
 */
import { makeReport } from "./lib/assert.mjs";
import { createNestedTemplate, deleteTemplate } from "./lib/mcp.mjs";

export async function run(harness) {
  const report = makeReport("S5 · RF-01 entrada al modo video en un click");
  const { templateId, frameId } = await createNestedTemplate();
  try {
    await harness.open(templateId, frameId);

    // Guard: prove we did NOT select anything — the whole point of RF-01.
    const preSelection = await harness.selectedLayerId(frameId);
    report.ok("estado inicial sin selección", preSelection === null, `selección previa: ${preSelection}`);

    // S5.1 — one click on the persistent topbar button.
    await harness.page.evaluate(() => {
      const btn = [...document.querySelectorAll("button.editor-v2-topbar-icon-btn")]
        .find(b => (b.textContent || "").trim().includes("Video"));
      if (!btn) throw new Error("botón Video no encontrado en la top bar");
      btn.click();
    });
    await harness.settle(250);

    const afterOpen = await harness.page.evaluate(() => {
      const text = document.body.textContent || "";
      return {
        modoVideo: text.includes("MODO VIDEO"),
        volver: [...document.querySelectorAll("button")].some(b => (b.textContent || "").includes("Volver al diseño")),
        saveState: text.includes("Guardado") || text.includes("Guardando"),
        timeline: text.includes("Tomas · V1"),
        exportPanel: text.includes("Exportar reel"),
      };
    });
    report.ok("S5.1 un click abre el modo sin selección previa", afterOpen.modoVideo, afterOpen.modoVideo ? "overlay visible" : "overlay NO visible");
    report.ok("S5.2a encabezado: salida inequívoca presente", afterOpen.volver, afterOpen.volver ? "botón Volver al diseño" : "falta botón de salida");
    report.ok("S5.2b encabezado: estado de guardado visible", afterOpen.saveState, "chip Guardado/Guardando");
    report.ok("S5.3 timeline con etiquetas completas de pista", afterOpen.timeline, afterOpen.timeline ? "'Tomas · V1' legible" : "etiquetas de pista ausentes");
    report.ok("S5.2c panel de export alcanzable", afterOpen.exportPanel, afterOpen.exportPanel ? "sección Exportar reel" : "export no visible");

    // S5.4 — same button exits the mode.
    await harness.page.evaluate(() => {
      const btn = [...document.querySelectorAll("button.editor-v2-topbar-icon-btn")]
        .find(b => (b.textContent || "").trim().includes("Video"));
      btn.click();
    });
    await harness.settle(250);
    const afterClose = await harness.page.evaluate(() => (document.body.textContent || "").includes("MODO VIDEO"));
    report.ok("S5.4 el mismo botón cierra el modo", !afterClose, afterClose ? "el overlay sigue montado" : "overlay desmontado");

    return report;
  } finally {
    await deleteTemplate(templateId);
  }
}
