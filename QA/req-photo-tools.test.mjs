/**
 * QA — REQ-PHOTO-FASE4.2b: rail de herramientas estilo Photoshop.
 *
 * Cubre:
 *   1. PhotoToolRail.tsx — 18 tools, atajos únicos, iconos SVG (cero emojis).
 *   2. PhotoModeOverlay.tsx — dispatch por herramienta (marco/lazo/varita/
 *      cuentagotas/zoom/mano), motor de trazos (pincel/goma/correcor/parche/
 *      tampón/relleno/desenfoque/exponer/quemar), máscara de selección,
 *      barra de opciones contextual, atajos de teclado y cursor.
 *
 * Run: npm run test:regression (o: node --test QA/req-photo-tools.test.mjs)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const rail = read("src/components/PhotoToolRail.tsx");
const overlay = read("src/components/PhotoModeOverlay.tsx");

// ── 1. PhotoToolRail.tsx ──────────────────────────────────────────────────

test("F4.2b: rail define exactamente las 18 herramientas de Photoshop v1", () => {
  const ids = [...rail.matchAll(/\{ id: "([a-z]+)", label: "[^"]*", key: "([A-Z])"/g)].map(m => m[1]);
  assert.deepEqual(ids, [
    "move", "marquee", "lasso", "wand",
    "crop", "eyedropper",
    "heal", "patch", "clone",
    "brush", "eraser", "fill", "blur", "dodge", "burn",
    "masks",
    "hand", "zoom",
  ]);
});

test("F4.2b: atajos de teclado únicos (sin colisiones)", () => {
  const keys = [...rail.matchAll(/\{ id: "([a-z]+)", label: "[^"]*", key: "([A-Z])"/g)].map(m => m[2].toLowerCase());
  assert.equal(keys.length, 18);
  assert.equal(new Set(keys).size, 18, `atajos duplicados: ${keys.join(",")}`);
});

test("F4.2b: iconos SVG inline — cero emojis en UI (regla del repo)", () => {
  assert.match(rail, /data-testid="photo-tool-rail"/);
  assert.match(rail, /TOOL_ICONS: Record<PhotoTool, React\.ReactNode>/);
  assert.match(rail, /viewBox="0 0 24 24"/);
  assert.doesNotMatch(rail, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "el rail no debe contener emojis");
});

test("F4.2b: familia de pintura y tooling exports", () => {
  assert.match(rail, /export const isPaintTool = \(t: PhotoTool\) => !!PHOTO_TOOLS\.find\(x => x\.id === t\)\?\.paint;/);
  assert.match(rail, /export const TOOL_BY_KEY = new Map\(PHOTO_TOOLS\.map\(t => \[t\.key\.toLowerCase\(\), t\.id\]\)\);/);
});

// ── 2. PhotoModeOverlay.tsx — integración ─────────────────────────────────

test("F4.2b: el overlay monta el rail a la izquierda del layout", () => {
  assert.match(overlay, /import \{ PhotoToolRail, PHOTO_TOOLS, TOOL_BY_KEY, isPaintTool, type PhotoTool \} from "\.\/PhotoToolRail";/);
  const railIdx = overlay.indexOf("<PhotoToolRail");
  const filmstripIdx = overlay.indexOf("{/* ── Izquierda: filmstrip + histograma ── */}");
  assert.ok(railIdx > 0 && filmstripIdx > railIdx, "el rail debe ir antes de la columna izquierda");
});

test("F4.2b: dispatch de herramientas de selección y navegación", () => {
  // marco/lazo: arrastra previsualización y commitea al soltar
  assert.match(overlay, /if \(tool === "marquee" \|\| tool === "lasso"\) \{\s*\n\s*clearSelection\(\);/);
  assert.match(overlay, /kind: tool === "marquee" \? "sel-rect" : "sel-lasso"/);
  // varita: flood-fill inmediato; cuentagotas: 1px del snapshot
  assert.match(overlay, /if \(tool === "wand"\) \{ buildWandMask\(displayPointToNorm\(e\)\); return; \}/);
  assert.match(overlay, /if \(tool === "eyedropper"\) \{ pickColorAt\(displayPointToNorm\(e\)\); return; \}/);
  // zoom ±1.3 (Alt aleja) y mano: pan
  assert.match(overlay, /zoom: clamp\(v\.zoom \* \(e\.altKey \? 1 \/ 1\.3 : 1\.3\), 0\.2, 12\)/);
  assert.match(overlay, /if \(tool === "hand"\) \{\s*\n\s*drag\.current = \{ kind: "pan"/);
});

test("F4.2b: motor de trazos estampa en scratch y vuelca al master", () => {
  assert.match(overlay, /const paintLayerAt = \(e: React\.PointerEvent, layerId: string\) => \{/);
  // estampado interpolado: distancia / (radio*0.35)
  assert.match(overlay, /Math\.ceil\(dist \/ Math\.max\(1, radius \* 0\.35\)\)/);
  // goma destination-out; exponer/quemar via color-dodge/color-burn
  assert.match(overlay, /tool === "eraser" \? "destination-out"/);
  assert.match(overlay, /tool === "dodge" \? "color-dodge"/);
  assert.match(overlay, /tool === "burn" \? "color-burn"/);
  // selección activa recorta el trazo (destination-in con la máscara)
  assert.match(overlay, /sctx\.globalCompositeOperation = "destination-in";\s*\n\s*sctx\.drawImage\(selectionMaskRef\.current, 0, 0\);/);
});

test("F4.2b: tampón de clonar — origen Alt+clic con offset alineado", () => {
  assert.match(overlay, /if \(tool === "clone" && e\.altKey\) \{/);
  assert.match(overlay, /cloneSrcRef\.current\.x \* master\.width - x/);
  assert.match(overlay, /if \(tool === "clone" && !cloneSrcRef\.current\) \{/);
});

test("F4.2b: pincel corrector y parche — v1 con costura difuminada", () => {
  // heal: desenfoque proporcional al radio al muestrear el entorno
  assert.match(overlay, /if \(tool === "heal"\) sctx\.filter = `blur\(\$\{Math\.max\(0\.6, radius \* 0\.08\)\.toFixed\(2\)\}px\)`;/);
  // parche exige selección y rellena con el snapshot desplazado
  assert.match(overlay, /if \(tool === "patch" && !selectionMaskRef\.current\) \{/);
  assert.match(overlay, /const commitPatch = \(startX: number, startY: number, e: React\.PointerEvent\) => \{/);
  assert.match(overlay, /sctx\.filter = "blur\(2px\)"; \/\/ difumina la costura del parche/);
});

test("F4.2b: varita mágica — flood-fill BFS con tolerancia", () => {
  assert.match(overlay, /const buildWandMask = \(p: \{ x: number; y: number \}\) => \{/);
  assert.match(overlay, /new Uint8Array\(W \* H\)/);
  assert.match(overlay, /dr \* dr \+ dg \* dg \+ db \* db > tol2/);
  // la máscara resultante se escala al tamaño master
  assert.match(overlay, /mctx\.drawImage\(hitCv, 0, 0, W, H, 0, 0, mask\.width, mask\.height\);/);
});

test("F4.2b: marco/lazo commitean máscara + bbox (polyBBox)", () => {
  assert.match(overlay, /const commitSelection = \(\) => \{/);
  assert.match(overlay, /setSelectionBBox\(polyBBox\(prev\.pts\)\);/);
  assert.match(overlay, /const polyBBox = \(pts: Array<\[number, number\]>\)/);
});

test("F4.2b: relleno respeta la selección (bote de pintura)", () => {
  assert.match(overlay, /const fillSelection = \(layerId: string\) => \{/);
  assert.match(overlay, /if \(tool === "fill"\) \{\s*\n\s*fillSelection\(layer\.id\);/);
});

test("F4.2b: snapshot del revelado para retoque (render identidad mismo tick)", () => {
  assert.match(overlay, /const ensureSnapshot = \(\): HTMLCanvasElement \| null => \{/);
  // restauración de la vista real tras el snapshot
  assert.match(overlay, /renderer\.update\(recipe, \{ view, split, original: showOriginal \}\); \/\/ restaura la vista real/);
  // la carga de composición habilita pintar aunque falle
  assert.match(overlay, /\} finally \{\s*\n\s*composeLoadedRef\.current = true;/);
});

test("F4.2b: primera pincelada crea capa síncrona (createLayerNow)", () => {
  assert.match(overlay, /const createLayerNow = \(\): CompositionLayer => \{/);
  assert.match(overlay, /const layer = activeComposeLayer \|\| createLayerNow\(\);/);
  assert.match(overlay, /drag\.current = \{ kind: "layer-paint", startX: e\.clientX, startY: e\.clientY, base: \{ layerId: layer\.id \} \};/);
});

test("F4.2b: barra de opciones contextual + indicador de selección", () => {
  assert.match(overlay, /data-testid="photo-options-bar"/);
  assert.match(overlay, /\{STROKE_TOOLS\.has\(tool\) && \(/);
  assert.match(overlay, /\{tool === "wand" && \(/);
  assert.match(overlay, /Tolerancia/);
  assert.match(overlay, /<button type="button" style=\{smallBtn\} onClick=\{clearSelection\}>Deseleccionar<\/button>/);
});

test("F4.2b: hormigas de selección (rect, poly y bbox confirmada)", () => {
  assert.match(overlay, /selPreview\?\.kind === "rect" && \(/);
  assert.match(overlay, /<polyline points=\{selPreview\.pts\.map\(\(\[px, py\]\) => `\$\{px \* imgRect\.width\},\$\{py \* imgRect\.height\}`\)\.join\(" "\)\}/);
  assert.match(overlay, /strokeDasharray="5 4"/);
});

test("F4.2b: atajos de teclado mapean por TOOL_BY_KEY y Supr borra selección", () => {
  assert.match(overlay, /else if \(!mod && TOOL_BY_KEY\.has\(e\.key\.toLowerCase\(\)\)\) \{ e\.preventDefault\(\); pickTool\(TOOL_BY_KEY\.get\(e\.key\.toLowerCase\(\)\)!\); \}/);
  // Escape limpia la selección antes de cambiar de modo
  assert.match(overlay, /else if \(e\.key === "Escape"\) \{ clearSelection\(\);/);
  // Delete/Backspace: destination-out de la máscara en la capa activa
  assert.match(overlay, /else if \(e\.key === "Delete" \|\| e\.key === "Backspace"\) \{/);
});

test("F4.2b: cursor por herramienta (crosshair/zoom-in/grab)", () => {
  assert.match(overlay, /cursor: mode === "brush" \|\| isPaintTool\(tool\) \|\| tool === "wand"/);
  assert.match(overlay, /tool === "zoom" \? "zoom-in"/);
});

test("F4.2b: pickTool orquesta modos (crop, máscaras, pintura→compose)", () => {
  assert.match(overlay, /const pickTool = \(t: PhotoTool\) => \{/);
  assert.match(overlay, /if \(t === "crop"\) \{ enterCropMode\(\); return; \}/);
  assert.match(overlay, /if \(t === "masks"\) \{\s*\n\s*setMode\("edit"\);\s*\n\s*setTab\("mascaras"\);/);
  assert.match(overlay, /if \(isPaintTool\(t\) && mode !== "compose"\) \{\s*\n\s*setMode\("compose"\);/);
});

test("F4.2b: reset por foto — selección/tampón/snapshot no arrastran entre fotos", () => {
  assert.match(overlay, /snapshotRef\.current = null;\s*\n\s*selectionMaskRef\.current = null;\s*\n\s*cloneSrcRef\.current = null;/);
  assert.match(overlay, /composeLoadedRef\.current = false;\s*\n\s*setSelectionBBox\(null\);\s*\n\s*setSelPreview\(null\);\s*\n\s*setTool\("move"\);/);
});

test("F4.2b: sin emojis en la nueva UI del overlay (rail + ants + options bar)", () => {
  // alcance: SOLO los bloques nuevos — el resto del overlay (máscaras/recetas
  // de Fases 1-3) tiene glifos preexistentes fuera del alcance de este req
  const railJsx = overlay.slice(overlay.indexOf("{/* ── Rail de herramientas"), overlay.indexOf("{/* ── Izquierda: filmstrip"));
  const stageUi = overlay.slice(overlay.indexOf("Fase 4.2b: selección (hormigas"), overlay.indexOf("{glError && ("));
  for (const [name, ui] of [["rail JSX", railJsx], ["stage UI", stageUi]]) {
    assert.ok(ui.length > 0, `${name}: slice vacío`);
    assert.doesNotMatch(ui, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u, `${name} no debe contener emojis`);
  }
});
