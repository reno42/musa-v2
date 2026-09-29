/**
 * QA — REQ-PHOTO-FASE4 · F4.2e "Compose Max" (paridad Photoshop, tanda final).
 *
 * Alcance entregado:
 *   1. Operaciones de capa: duplicar (Ctrl+J) · fusionar hacia abajo (Ctrl+E)
 *      · aplanar imagen (Ctrl+Shift+E) — respetando blends, transform,
 *      máscaras y ajustes no destructivos.
 *   2. Portapapeles de selección: Ctrl+C copia (recortada por la selección)
 *      · Ctrl+V pega como capa nueva.
 *   3. Slot de selección guardada: Guardar sel. / Cargar sel.
 *   4. Máscaras de capa PERSISTENTES (v60): save embarca el dataUrl dentro de
 *      la capa; load lo decodifica de vuelta a canvas.
 *   5. Ajustes NO destructivos por capa (brillo/contraste/saturación/matiz)
 *      vía ctx.filter en espejo DOM, fusión, aplanado y exportación.
 *   6. Menú Filtro: gaussiano · ruido · mosaico · paso alto · nubes
 *      (recortan por la selección activa).
 *   7. Máscara rápida (Q): overlay rojo, pintar (Alt = borrar), al salir se
 *      convierte en selección; toast honesto si quedó vacía.
 *   8. Panel Historia: etiqueta por paso + saltos directos (undo en cadena).
 *   9. Selección rápida SAM: POST /api/segment/click → poll de jobs →
 *      maskUrl se vuelve selección; timeout honesto que sugiere la varita.
 *      (Sin feather a propósito: el contorno del modelo ya es suave.)
 *  10. Tampón de patrón (cuadros/puntos/diagonal/ruido) con tesela 8-80.
 *  11. Polígono de N lados (3-20) + 5 formas custom (estrella/corazón/
 *      flecha/rayo/gota).
 *  12. Texto vertical (rota 90° por línea) + máscara de texto (rasteriza a
 *      selección para rellenar).
 *  13. Pluma a mano alzada (freeform: arrastra y suelta).
 *  14. Barra de estado: zoom % · dimensiones · herramienta · flags de modo.
 *
 * Deferrals honestos (FUERA de alcance, siguen "soon" en el rail): curvatura,
 * pluma vectorial (pathsel), lazo magnético, licuar, pincel mezclador, PSD,
 * refine edge, modos Edit>Transform (skew/distort/perspectiva), texto en
 * trayecto, artboard, slice, regla, reemplazo de color, historial del arte,
 * borrador de fondo, rotar vista, recorte en perspectiva.
 *
 * Estrategia: contrato shared real (import strip-types) + regexes de
 * integración sobre el fuente del overlay/rail. Sin red, sin render.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const sharedSrc = read("shared/photoComposition.ts");
const overlaySrc = read("src/components/PhotoModeOverlay.tsx");
const railSrc = read("src/components/PhotoToolRail.tsx");

// ── 1. Contrato shared: ajustes por capa + máscara persistente ────────────

test("F4.2e: shared declara adjust por capa y lo documenta como no destructivo", () => {
  assert.match(sharedSrc, /export interface CompositionLayerAdjust \{/);
  assert.match(sharedSrc, /mask\?: string;\s*\r?\n\s*\/\*\* F4\.2e: ajustes no destructivos por capa \(absent = identidad\)\. \*\/\s*\r?\n\s*adjust\?: CompositionLayerAdjust;/);
  assert.match(sharedSrc, /\/\*\* F4\.2e: texto vertical \(rotado 90° por línea\) \*\/\s*\r?\n\s*vertical\?: boolean;/);
});

test("F4.2e: normalize clampa el adjust (identidad no se persiste)", async () => {
  const mod = await import(pathToFileURL(join(root, "shared/photoComposition.ts")).href);
  const [a] = mod.normalizeCompositionLayers([{ id: "a", dataUrl: "data:image/png;base64,AA", adjust: { brightness: 99, contrast: -5, saturation: 2, hue: 999 } }]);
  assert.equal(a.adjust.brightness, 3);
  assert.equal(a.adjust.contrast, 0.2);
  assert.equal(a.adjust.saturation, 2);
  assert.equal(a.adjust.hue, 180);
  // identidad ⇒ undefined (JSON más liviano)
  const [b] = mod.normalizeCompositionLayers([{ id: "b", dataUrl: "data:image/png;base64,AA", adjust: { brightness: 1, contrast: 1, saturation: 1, hue: 0 } }]);
  assert.equal(b.adjust, undefined);
  const [c] = mod.normalizeCompositionLayers([{ id: "c", dataUrl: "data:image/png;base64,AA", adjust: "junk" }]);
  assert.equal(c.adjust, undefined);
});

test("F4.2e: normalize embarca la máscara persistente (truncada) y el texto vertical", async () => {
  const mod = await import(pathToFileURL(join(root, "shared/photoComposition.ts")).href);
  const good = "data:image/png;base64," + "A".repeat(mod.MAX_LAYER_DATAURL_CHARS + 50);
  const [l] = mod.normalizeCompositionLayers([{ id: "l", dataUrl: "data:image/png;base64,AA", mask: good }]);
  assert.equal(l.mask.length, mod.MAX_LAYER_DATAURL_CHARS);
  const [no] = mod.normalizeCompositionLayers([{ id: "n", dataUrl: "data:image/png;base64,AA", mask: "http://no-es-dataurl" }]);
  assert.equal(no.mask, undefined);
  const [t] = mod.normalizeCompositionLayers([{ id: "t", kind: "text", dataUrl: "data:image/png;base64,AA", text: { value: "V", size: 48, x: 0.1, y: 0.1, vertical: true } }]);
  assert.equal(t.text.vertical, true);
  const [h] = mod.normalizeCompositionLayers([{ id: "h", kind: "text", dataUrl: "data:image/png;base64,AA", text: { value: "H", size: 48, x: 0.1, y: 0.1, vertical: false } }]);
  assert.equal(h.text.vertical, undefined);
});

// ── 2. Operaciones de capa ────────────────────────────────────────────────

test("F4.2e: motores duplicar/fusionar/aplanar con honestidad y blends", () => {
  assert.match(overlaySrc, /const composeDuplicateLayer = \(id: string\) => \{/);
  assert.match(overlaySrc, /const composeMergeDown = \(id: string\) => \{/);
  assert.match(overlaySrc, /if \(idx <= 0\) \{ addToast\("No hay capa debajo hacia la que fusionar\.", "info"\); return; \}/);
  assert.match(overlaySrc, /const composeFlattenLayers = \(\) => \{/);
  assert.match(overlaySrc, /if \(ls\.length < 2\) \{ addToast\("Solo hay una capa — nada que aplanar\.", "info"\); return; \}/);
  assert.match(overlaySrc, /flat\.name = "Aplanada";/);
  // fusión y aplanado respetan blend + alpha + ajustes + máscara
  assert.match(overlaySrc, /blendToCanvasOp\(top\.blend\)/);
  assert.match(overlaySrc, /if \(top\.adjust\) sctx\.filter = adjustFilterOf\(top\.adjust\);/);
  assert.match(overlaySrc, /if \(layer\.adjust\) sctx\.filter = adjustFilterOf\(layer\.adjust\);/);
});

test("F4.2e: atajos Ctrl+J · Ctrl+E · Ctrl+Shift+E y botones del panel", () => {
  assert.match(overlaySrc, /else if \(mod && !e\.shiftKey && e\.key\.toLowerCase\(\) === "j"\) \{ e\.preventDefault\(\); if \(mode === "compose" && activeComposeLayer\) composeDuplicateLayer\(activeComposeLayer\.id\); \} \/\/ F4\.2e: duplicar capa/);
  assert.match(overlaySrc, /else if \(mod && e\.shiftKey && e\.key\.toLowerCase\(\) === "e"\) \{ e\.preventDefault\(\); if \(mode === "compose"\) composeFlattenLayers\(\); \} \/\/ F4\.2e: aplanar imagen/);
  assert.match(overlaySrc, /else if \(mod && e\.key\.toLowerCase\(\) === "e"\) \{ e\.preventDefault\(\); if \(mode === "compose" && activeComposeLayer\) composeMergeDown\(activeComposeLayer\.id\); \} \/\/ F4\.2e: fusionar hacia abajo/);
  assert.match(overlaySrc, /onClick=\{\(\) => composeDuplicateLayer\(activeComposeLayer\.id\)\} title="Duplicar capa \(Ctrl\+J\)">Duplicar<\/button>/);
  assert.match(overlaySrc, /onClick=\{\(\) => composeMergeDown\(activeComposeLayer\.id\)\} title="Fusionar hacia abajo \(Ctrl\+E\)">Fusionar<\/button>/);
  assert.match(overlaySrc, /onClick=\{composeFlattenLayers\} title="Aplanar imagen \(Ctrl\+Shift\+E\)">Aplanar<\/button>/);
});

// ── 3. Portapapeles + slot de selección ───────────────────────────────────

test("F4.2e: Ctrl+C copia la selección · Ctrl+V pega como capa", () => {
  assert.match(overlaySrc, /const copySelectionToClipboard = \(\) => \{/);
  assert.match(overlaySrc, /const pasteClipboardAsLayer = \(\) => \{/);
  assert.match(overlaySrc, /if \(!layer \|\| !master\) \{ addToast\("Selecciona una capa con contenido \(modo Componer\) para copiar\.", "info"\); return; \}/);
  assert.match(overlaySrc, /else if \(mod && e\.key\.toLowerCase\(\) === "c"\) \{ e\.preventDefault\(\); if \(mode === "compose"\) copySelectionToClipboard\(\); \} \/\/ F4\.2e: copiar/);
  assert.match(overlaySrc, /else if \(mod && e\.key\.toLowerCase\(\) === "v"\) \{ e\.preventDefault\(\); if \(mode === "compose"\) pasteClipboardAsLayer\(\); \} \/\/ F4\.2e: pegar/);
});

test("F4.2e: Guardar sel. / Cargar sel. — slot de selección reutilizable", () => {
  assert.match(overlaySrc, /const saveSelectionSlot = \(\) => \{/);
  assert.match(overlaySrc, /const loadSelectionSlot = \(\) => \{/);
  assert.match(overlaySrc, /addToast\("Selección guardada — «Cargar sel\.» la restaura en cualquier momento\.", "info"\)/);
  assert.match(overlaySrc, /onClick=\{saveSelectionSlot\} title="Guarda la selección actual en un slot">Guardar sel\.<\/button>/);
  assert.match(overlaySrc, /disabled=\{!hasSavedSel\} onClick=\{loadSelectionSlot\} title="Restaura la selección guardada">Cargar sel\.<\/button>/);
});

// ── 4. Máscaras persistentes (v60) ────────────────────────────────────────

test("F4.2e: save embarca la máscara en la capa · load la decodifica a canvas", () => {
  // guardado: la máscara viaja dentro de la capa y cuenta para el techo de 8MB
  assert.match(overlaySrc, /\/\/ F4\.2e: la máscara viaja dentro de la capa \(migración v60\)\s*\r?\n\s*return \{ \.\.\.l, dataUrl: cv \? cv\.toDataURL\("image\/png"\) : l\.dataUrl, \.\.\.\(mk \? \{ mask: mk\.toDataURL\("image\/png"\) \} : \{\}\) \};/);
  assert.match(overlaySrc, /const total = payload\.reduce\(\(s, l\) => s \+ l\.dataUrl\.length \+ \(l\.mask\?\.length \|\| 0\), 0\);/);
  // carga: limpia y decodifica cada máscara persistida
  assert.match(overlaySrc, /layerMasksRef\.current\.clear\(\);\s*\r?\n\s*setComposeLayers\(layers\);\s*\r?\n\s*\/\/ F4\.2e: decodifica las máscaras persistidas \(v60\) en sus canvas/);
});

test("F4.2e: ajustes de capa aplicados en espejo, fusión, aplanado y exportación", () => {
  // espejo DOM
  assert.match(overlaySrc, /\/\/ F4\.2e: ajustes no destructivos por capa \(ctx\.filter\)\s*\r?\n\s*if \(layer\.adjust\) ctx\.filter = adjustFilterOf\(layer\.adjust\);\s*\r?\n\s*ctx\.drawImage\(master, 0, 0\);\s*\r?\n\s*if \(layer\.adjust\) ctx\.filter = "none";/);
  // exportación (aplanado de la receta)
  assert.match(overlaySrc, /if \(layer\.adjust\) ctx\.filter = adjustFilterOf\(layer\.adjust\); \/\/ F4\.2e: ajustes de capa/);
  // panel con 4 sliders que parchean adjust (agrupan historial vía composePatchLayer)
  assert.match(overlaySrc, /<Group title="Ajustes de capa \(no destructivos\)">/);
  assert.match(overlaySrc, /const patchAdj = \(p: Partial<CompositionLayerAdjust>\) => composePatchLayer\(lid, \{ adjust: \{ \.\.\.adj, \.\.\.p \} \}\);/);
  for (const s of ["Brillo", "Contraste", "Saturación", "Matiz (°)"]) {
    assert.ok(overlaySrc.includes(`<Slider label="${s}"`), `falta slider de adjust: ${s}`);
  }
});

// ── 5. Menú Filtro ────────────────────────────────────────────────────────

test("F4.2e: Filtro con 5 efectos que respetan la selección activa", () => {
  assert.match(overlaySrc, /const applyLayerFilter = \(kind: "gauss" \| "noise" \| "mosaic" \| "highpass" \| "clouds"\) => \{/);
  assert.match(overlaySrc, /<Group title="Filtros \(respeta la selección\)">/);
  assert.match(overlaySrc, /onClick=\{\(\) => applyLayerFilter\("gauss"\)\}>Gaussiano<\/button>/);
  assert.match(overlaySrc, /onClick=\{\(\) => applyLayerFilter\("noise"\)\}>Ruido<\/button>/);
  assert.match(overlaySrc, /onClick=\{\(\) => applyLayerFilter\("mosaic"\)\}>Mosaico<\/button>/);
  assert.match(overlaySrc, /onClick=\{\(\) => applyLayerFilter\("highpass"\)\}>Paso alto<\/button>/);
  assert.match(overlaySrc, /onClick=\{\(\) => applyLayerFilter\("clouds"\)\}>Nubes<\/button>/);
  // recorte por selección (destination-in) dentro del motor
  const engine = overlaySrc.slice(overlaySrc.indexOf("const applyLayerFilter"), overlaySrc.indexOf("const ensureQmaskCanvas"));
  assert.ok(engine.length > 200, "motor de filtros vacío");
  assert.match(engine, /globalCompositeOperation = "destination-in"/);
});

// ── 6. Máscara rápida (Q) ─────────────────────────────────────────────────

test("F4.2e: máscara rápida — motor, overlay rojo, Q y reroute de pintura", () => {
  assert.match(overlaySrc, /const toggleQuickMask = \(\) => \{/);
  assert.match(overlaySrc, /const ensureQmaskCanvas = \(\): HTMLCanvasElement => \{/);
  assert.match(overlaySrc, /const qmaskPaintAt = \(p: \{ x: number; y: number \}, erase: boolean\) => \{/);
  // overlay rojo tinte source-in
  assert.match(overlaySrc, /ctx\.fillStyle = "rgba\(255,64,64,0\.55\)";/);
  assert.match(overlaySrc, /\}, \[qmask, composeTick, histTick\]\);/);
  // Q entra/sale
  assert.match(overlaySrc, /else if \(!mod && e\.key\.toLowerCase\(\) === "q"\) \{ e\.preventDefault\(\); toggleQuickMask\(\); \} \/\/ F4\.2e: máscara rápida/);
  // las tools de pintura pintan la máscara rápida (Alt borra) — 2 reroutes
  assert.equal((overlaySrc.match(/qmaskPaintAt\(displayPointToNorm\(e\), e\.altKey\);/g) || []).length, 2);
  assert.match(overlaySrc, /kind: "qmask-paint"/);
  // al entrar, la selección actual queda editable dentro de la máscara
  assert.match(overlaySrc, /if \(selectionMaskRef\.current\) cv\.getContext\("2d"\)\?\.drawImage\(selectionMaskRef\.current, 0, 0\); \/\/ la selección entra editable/);
});

test("F4.2e: máscara rápida — al salir convierte en selección con honestidad", () => {
  assert.match(overlaySrc, /if \(maxX < 0\) \{ addToast\("Máscara rápida vacía — no se creó selección\.", "info"\); return; \}/);
  assert.match(overlaySrc, /selectionMaskRef\.current = cv;/);
  assert.match(overlaySrc, /addToast\("Máscara rápida convertida en selección\.", "info"\)/);
  assert.match(overlaySrc, /addToast\("Máscara rápida: pinta para añadir · Alt borra · Q confirma la selección\.", "info"\)/);
});

// ── 7. Panel Historia ─────────────────────────────────────────────────────

test("F4.2e: Historia con etiqueta por paso y saltos directos (undo en cadena)", () => {
  assert.match(overlaySrc, /const jumpComposeHistory = \(targetIdx: number\) => \{/);
  assert.match(overlaySrc, /<Group title=\{`Historial de la composición \(\$\{composePast\.current\.length\}\)`\}\>/);
  assert.match(overlaySrc, /● Estado actual</);
  assert.match(overlaySrc, /\{\[\.\.\.composePast\.current\]\.map\(\(s, i\) => \(\{ s, i \}\)\)\.reverse\(\)\.map\(\(\{ s, i \}\) => \(/);
  assert.match(overlaySrc, /title="Salta a este paso \(deshace en cadena\)"/);
});

// ── 8. Selección rápida SAM ───────────────────────────────────────────────

test("F4.2e: SAM — pipeline click→jobs→maskUrl con timeout honesto", () => {
  assert.match(overlaySrc, /const samQuickSelect = async \(p: \{ x: number; y: number \}, selMode: "new" \| "add" \| "sub"\) => \{/);
  assert.match(overlaySrc, /if \(!active \|\| samBusy\) return;/);
  assert.match(overlaySrc, /apiFetch<any>\("\/api\/segment\/click", \{/);
  assert.match(overlaySrc, /apiFetch<any>\(`\/api\/segment\/jobs\/\$\{encodeURIComponent\(jobId\)\}`\)/);
  assert.match(overlaySrc, /"Segmentación sigue en cola \(el worker no corre en local\) — usa la varita mágica \(W\)\."/);
  // dispatch antes del bloque de varita (contrato de req-photo-tools) + hint
  assert.match(overlaySrc, /void samQuickSelect\(displayPointToNorm\(e\), e\.shiftKey \? "add" : e\.altKey \? "sub" : "new"\);/);
  assert.match(overlaySrc, /\{samBusy \? "SAM analizando…" : "clic: objeto bajo el puntero \(SAM\) · Shift añade · Alt resta"\}/);
  // decisión documentada: SAM no aplica feather (el modelo ya da contorno suave)
  assert.equal((overlaySrc.match(/applyFeatherToMask\(\);/g) || []).length, 2);
});

// ── 9. Tampón de patrón ───────────────────────────────────────────────────

test("F4.2e: tampón de patrón — bypass sin tocar el srcMode bloqueado por QA", () => {
  assert.match(overlaySrc, /const isPattern = tool === "clone" && v === "pattern" && !onMask;/);
  assert.match(overlaySrc, /const snap = isPattern \? null : ensureSnapshot\(\);/);
  assert.match(overlaySrc, /const getPatternTile = \(masterWidth: number\): HTMLCanvasElement => \{/);
  assert.match(overlaySrc, /const pat = sctx\.createPattern\(getPatternTile\(master\.width\), "repeat"\);/);
  // 4 patrones procedurales + tesela ajustable
  assert.match(overlaySrc, /<option value="cuadros">Cuadros<\/option>/);
  assert.match(overlaySrc, /<option value="puntos">Puntos<\/option>/);
  assert.match(overlaySrc, /<option value="diagonal">Diagonal<\/option>/);
  assert.match(overlaySrc, /<option value="ruido">Ruido<\/option>/);
  assert.match(overlaySrc, /Tesela/);
  assert.match(overlaySrc, /min=\{8\} max=\{80\} value=\{patternTile\}/);
  assert.match(overlaySrc, /estampa el patrón elegido — no necesita origen/);
});

// ── 10. Polígono + formas custom ──────────────────────────────────────────

test("F4.2e: polígono N lados y 5 formas custom con opciones en la barra", () => {
  assert.match(overlaySrc, /const polygonPoints = \(sides: number, cx: number, cy: number, rx: number, ry: number\): Array<\[number, number\]> => \{/);
  assert.match(overlaySrc, /const drawCustomShapePath = \(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, w: number, h: number\)/);
  assert.match(overlaySrc, /kind: variant === "polygon" \? "shape-poly" : "shape-custom",/);
  assert.match(overlaySrc, /Lados/);
  assert.match(overlaySrc, /min=\{3\} max=\{20\} value=\{shapeSides\}/);
  for (const [id, label] of [["estrella", "Estrella"], ["corazon", "Corazón"], ["flecha", "Flecha"], ["rayo", "Rayo"], ["gota", "Gota"]]) {
    assert.ok(overlaySrc.includes(`<option value="${id}">${label}</option>`), `falta forma custom: ${id}`);
  }
  assert.ok(overlaySrc.includes("CUSTOM_SHAPES"), "falta la tabla CUSTOM_SHAPES");
});

// ── 11. Texto vertical + máscara de texto ─────────────────────────────────

test("F4.2e: texto vertical persistido y máscara de texto a selección", () => {
  assert.match(overlaySrc, /const \[typeVertical, setTypeVertical\] = useState\(false\);/);
  assert.match(overlaySrc, /checked=\{typeVertical \|\| toolVariant === "typevert"\} onChange=\{e => setTypeVertical\(e\.target\.checked\)\} \/> Vertical/);
  // el texto vivo embarca vertical: true dentro del objeto text (contrato shared)
  assert.match(overlaySrc, /\.\.\.\(typeVertical \|\| toolVariant === "typevert" \? \{ vertical: true \} : \{\}\)/);
  // rasterTextLayer rota las líneas verticales
  assert.match(overlaySrc, /text\.vertical/);
  // typemask: rasteriza el texto blanco a selección (sin paso de historial)
  assert.match(overlaySrc, /toolVariant === "typemask"/);
  assert.match(overlaySrc, /"Texto convertido en selección — rellénala \(G → Bote\) o pinta dentro\."/);
});

// ── 12. Pluma libre ───────────────────────────────────────────────────────

test("F4.2e: pluma a mano alzada — drag propio y cierre al soltar", () => {
  assert.match(overlaySrc, /if \(tool === "pen" && variant === "freeform"\) \{ \/\/ F4\.2e: pluma libre/);
  assert.match(overlaySrc, /drag\.current = \{ kind: "pen-free", startX: e\.clientX, startY: e\.clientY, base: null \};/);
  assert.match(overlaySrc, /if \(d\?\.kind === "pen-free"\) closePenPath\(\);/);
  assert.match(overlaySrc, /arrastra para dibujar a mano alzada · al soltar se cierra el trazado/);
});

// ── 13. Barra de estado ───────────────────────────────────────────────────

test("F4.2e: barra de estado — zoom %, dimensiones, herramienta y flags", () => {
  assert.match(overlaySrc, /<span>\{Math\.round\(view\.zoom \* 100\)\}%<\/span>/);
  assert.match(overlaySrc, /\{imgDims && <span>\{outSize\.w\}×\{outSize\.h\}px<\/span>\}/);
  assert.match(overlaySrc, /\{GROUP_BY_ID\.get\(tool\)\?\.label \|\| tool\}/);
  assert.match(overlaySrc, /\{qmask && <span style=\{\{ color: "#e08a8a" \}\}>MÁSCARA RÁPIDA<\/span>\}/);
  assert.match(overlaySrc, /\{maskEditId && <span style=\{\{ color: "#d8b08a" \}\}>PINTANDO MÁSCARA<\/span>\}/);
});

// ── 14. Rail: 7 variantes nuevas usables + deferrals honestos ─────────────

test("F4.2e: 7 variantes salen de 'soon' con labels honestos", () => {
  for (const s of [
    '{ id: "quick", label: "Selección rápida (SAM)" }',
    '{ id: "pattern", label: "Tampón de patrón (cuadros/puntos/diagonal/ruido)" }',
    '{ id: "typevert", label: "Texto vertical" }',
    '{ id: "typemask", label: "Máscara de texto (rasteriza a selección)" }',
    '{ id: "freeform", label: "Pluma libre (arrastra y suelta)" }',
    '{ id: "polygon", label: "Polígono (N lados)" }',
    '{ id: "custom", label: "Forma personalizada" }',
  ]) {
    assert.ok(railSrc.includes(s), `falta la variante usable: ${s}`);
  }
});

test("F4.2e: deferrals documentados siguen 'soon' (cero scope creep silencioso)", () => {
  for (const id of ["artboard", "magnetic", "perspective", "slice", "sampler", "ruler", "colorreplace", "mixer", "arthistory", "bgeraser", "curvature", "path", "rotate"]) {
    assert.match(railSrc, new RegExp(`\\{ id: "${id}", label: "[^"]*", status: "soon" \\}`), `${id} debe seguir 'soon'`);
  }
});

// ── 15. Anti-regresión de contratos previos ───────────────────────────────

test("F4.2e: sin scope creep — ni licuar ni PSD; historial sigue capado en 12", () => {
  assert.doesNotMatch(overlaySrc, /licuar|liquify|contentAwareFill|psd/i);
  assert.match(overlaySrc, /if \(composePast\.current\.length > 12\) composePast\.current\.shift\(\)/);
});
