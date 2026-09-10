// Repro for the "cover came out empty" report: build a deck with the exact
// same pptxgenjs calls ContentTab.generatePpt makes (cover + one content
// slide with a native text box), then unzip it for XML inspection.
import pptxgen from "pptxgenjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const out = join(root, "debug", "repro.pptx");
const xdir = join(root, "debug", "repro-pptx-x");
rmSync(out, { force: true });
rmSync(xdir, { recursive: true, force: true });

const pptx = new pptxgen();
pptx.layout = "LAYOUT_16x9";
pptx.author = "Renzo";

const cover = pptx.addSlide();
cover.background = { color: "0B0D13" };
cover.addText("GRILLA DE CONTENIDO", { x: 0.7, y: 1.0, w: 8.6, h: 0.35, fontSize: 11, valign: "top", color: "6B7280", charSpacing: 4 });
cover.addText("Todas las marcas", { x: 0.7, y: 1.4, w: 8.6, h: 0.85, fontSize: 44, valign: "top", bold: true, color: "FFFFFF" });
cover.addText("Presentado por Renzo", { x: 0.7, y: 2.55, w: 8.6, h: 0.4, fontSize: 17, valign: "top", bold: true, color: "A5B4FC" });
cover.addText("2026-08-01  →  2026-08-29", { x: 0.7, y: 3.2, w: 8.6, h: 0.35, fontSize: 13, valign: "top", color: "9CA3AF" });
cover.addText("29 de agosto de 2026 · 3 piezas", { x: 0.7, y: 3.65, w: 8.6, h: 0.35, fontSize: 11.5, valign: "top", color: "6B7280" });

const slide = pptx.addSlide();
slide.background = { color: "0B0D13" };
slide.addText("2026-08-01   ·   instagram", { x: 0.5, y: 0.3, w: 9, fontSize: 12, color: "9CA3AF" });
slide.addImage({ data: "image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", x: 5.5, y: 0.85, w: 4, h: 4 });
slide.addText("NUEVO DROP", {
  x: 5.7, y: 1.2, w: 3.5, h: 0.6,
  fontSize: Math.max(1, 48 * (1 / 270) * 72),
  bold: true, italic: false,
  underline: { style: "sng" },
  color: "ffffff", fontFace: "Poppins",
  margin: 0, wrap: false, isTextBox: true,
});

writeFileSync(out, await pptx.write({ outputType: "nodebuffer" }));
console.log("wrote", out);

execFileSync("powershell", ["-NoProfile", "-Command",
  `Expand-Archive -LiteralPath '${out}' -DestinationPath '${xdir}' -Force`]);
console.log("extracted to", xdir);
