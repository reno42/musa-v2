/**
 * QA — REQ-PHOTO-FASE4 · F4.2d "Compose Pro" (paridad Photoshop, tanda 2).
 *
 * Alcance entregado:
 *   1. Undo/redo de la composición (Ctrl+Z/Y en Componer + botones, 12 pasos,
 *      snapshots de capas + masters + máscaras).
 *   2. Máscaras de capa por sesión (añadir/pintar/quitar; trazo oculta · Alt
 *      revela) respetadas por espejos DOM y aplanado de exportación.
 *   3. Pincel: Dureza continua 0-100, presión de lápiz óptico, `[` `]`,
 *      cursor circular de tamaño real, tamaño hasta 400 px.
 *   4. Transformación libre (Ctrl+T): manijas de escala/rotación, movimiento
 *      en vivo del espejo, Enter aplica · Esc cancela, flechas desplazan.
 *   5. Texto VIVO: capas kind "text" re-editables, persistidas (additivo).
 *   6. Selecciones: añadir (Shift) / quitar (Alt) / invertir
 *      (Ctrl+Shift+I) / feather al commit; hormigas animadas.
 *   7. Enfocar REAL (máscara de desenfoque unsharp sobre el estado previo).
 *   8. Blends 8 → 16 (todos los que CSS mix-blend-mode soporta nativamente).
 *   9. QoL: espacio = mano temporal · Alt+rueda zoom rápido · Shift+letra
 *      cicla variantes · X/D colores frontal/fondo · auto-selección de capa
 *      con la tool Mover.
 *
 * Estrategia: contrato puro (shared) con asserts reales + regexes de
 * integración sobre el fuente del overlay/rail (mismo estilo que las suites
 * req-photo previas). Sin red, sin render, sin canvas real.
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

// ── 1. Contrato shared: blends 16 ─────────────────────────────────────────

test("F4.2d: shared declara los 16 blends y documenta los 11 sin primitiva", () => {
  assert.match(sharedSrc, /export const COMPOSITION_BLENDS: readonly CompositionBlend\[\] = \[/);
  for (const b of ["exclusion", "hard-light", "color-dodge", "color-burn", "hue", "saturation", "color", "luminosity"]) {
    assert.ok(sharedSrc.includes(`"${b}"`), `falta el blend ${b}`);
  }
  // honestidad: los modos PS sin equivalente CSS/canvas quedan documentados fuera
  assert.match(sharedSrc, /dissolve, linear-burn/);
  assert.match(sharedSrc, /shader\s*\n?\s*\* multi-textura|shader multi-textura/);
});

test("F4.2d: normalize acepta hard-light y rechaza linear-burn (sin primitiva)", async () => {
  // importa el módulo TS real vía strip-types
  const mod = await import(pathToFileURL(join(root, "shared/photoComposition.ts")).href);
  const ok = mod.normalizeCompositionLayers([{ id: "a", blend: "hard-light", dataUrl: "data:image/png;base64,AA" }]);
  assert.equal(ok[0].blend, "hard-light");
  const bad = mod.normalizeCompositionLayers([{ id: "b", blend: "linear-burn", dataUrl: "data:image/png;base64,AA" }]);
  assert.equal(bad[0].blend, "normal");
  assert.equal(mod.COMPOSITION_BLENDS.length, 16);
});

// ── 2. Contrato shared: texto vivo ────────────────────────────────────────

test("F4.2d: createTextLayer produce capa kind text re-editable", async () => {
  const mod = await import(pathToFileURL(join(root, "shared/photoComposition.ts")).href);
  const l = mod.createTextLayer(0, { value: "Hola\nmundo", size: 48, color: "#e8e2d4", font: "Inter, system-ui, sans-serif", x: 0.1, y: 0.2 });
  assert.equal(l.kind, "text");
  assert.equal(l.name, "Texto");
  assert.equal(l.text.value, "Hola\nmundo");
  assert.equal(l.blend, "normal");
  const back = mod.normalizeCompositionLayers([l]);
  assert.equal(back[0].kind, "text");
  assert.deepEqual(back[0].text, l.text);
});

test("F4.2d: normalize clampa los campos del texto y tolera kind text sin objeto", async () => {
  const mod = await import(pathToFileURL(join(root, "shared/photoComposition.ts")).href);
  const [t] = mod.normalizeCompositionLayers([{
    id: "t1", kind: "text", dataUrl: "data:image/png;base64,AA",
    text: { value: "x".repeat(9000), size: 9999, color: "rojo", font: 42, x: 9, y: -4 },
  }]);
  assert.equal(t.text.value.length, 5000);
  assert.equal(t.text.size, 800);
  assert.equal(t.text.color, "#e8e2d4");
  assert.equal(typeof t.text.font, "string");
  assert.equal(t.text.x, 2);
  assert.equal(t.text.y, -1);
  const [bare] = mod.normalizeCompositionLayers([{ id: "t2", kind: "text", dataUrl: "data:image/png;base64,AA" }]);
  assert.equal(bare.text, undefined);
  // capa persistida kind text sin dataUrl sigue siendo inválida (mismo guard)
  const dead = mod.normalizeCompositionLayers([{ id: "t3", kind: "text", persisted: true }]);
  assert.equal(dead.length, 0);
});

// ── 3. Overlay: motor de pintura ──────────────────────────────────────────

test("F4.2d: paintLayerAt acepta opts.mask y fuerza tinta blanca + composite de máscara", () => {
  assert.match(overlaySrc, /const paintLayerAt = \(e: React\.PointerEvent, layerId: string, opts\?: \{ mask\?: boolean \}\)/);
  assert.match(overlaySrc, /const onMask = !!opts\?\.mask/);
  assert.match(overlaySrc, /const master = onMask \? ensureLayerMask\(layerId\) : \(layerCanvasesRef\.current\.get\(layerId\) \|\| ensureMasterCanvas\(layerId\)\)/);
  assert.match(overlaySrc, /const srcMode: "ink" \| "clone" \| "heal" \| "history" \| "fx" = onMask \? "ink"/);
  assert.match(overlaySrc, /const ink = onMask \? "rgba\(255,255,255,1\)"/);
  // trazo normal oculta (destination-out) · Alt revela (source-over)
  assert.match(overlaySrc, /ctx\.globalCompositeOperation = e\.altKey \? "source-over" : "destination-out"/);
});

test("F4.2d: Dureza continua + presión de lápiz óptico en el motor", () => {
  assert.match(overlaySrc, /const plateau = v === "pencil" \? 0\.94 : clamp\(paintHardness \/ 100, 0\.02, 0\.94\)/);
  assert.match(overlaySrc, /const pressureK = e\.pointerType === "pen" && e\.pressure > 0 \? 0\.35 \+ 0\.65 \* e\.pressure : 1;/);
  assert.match(overlaySrc, /paintOpacity \* Math\.max\(0\.05, paintFlow\) \* pressureK/);
});

test("F4.2d: Enfocar real — clone previo, bbox acumulado y unsharp al soltar", () => {
  assert.match(overlaySrc, /const applyUnsharpRegion = \(\) =>/);
  assert.match(overlaySrc, /out\.data\[i\] = clampByte\(base\.data\[i\] \+ amount \* \(base\.data\[i\] - soft\.data\[i\]\)\)/);
  assert.match(overlaySrc, /if \(fxVariant === "sharpen" && sharpenStroke\.current\) \{/);
  assert.match(overlaySrc, /before: cloneCanvas\(layerCanvasesRef\.current\.get\(layer\.id\) \|\| ensureMasterCanvas\(layer\.id\)\), layerId: layer\.id/);
  assert.match(overlaySrc, /if \(d\?\.kind === "layer-paint"\) \{ lastPaintPt\.current = null; applyUnsharpRegion\(\); setComposeTick\(t => t \+ 1\); \}/);
});

// ── 4. Undo/redo de la composición ────────────────────────────────────────

test("F4.2d: snapshot/restore/undo/redo propios de Componer (capas+masters+máscaras)", () => {
  assert.match(overlaySrc, /type ComposeSnap = \{/);
  assert.match(overlaySrc, /const snapCompose = \(metaOnly = false\): ComposeSnap => \(\{/);
  assert.match(overlaySrc, /activeId: activeLayerId,/);
  assert.match(overlaySrc, /const restoreCompose = \(s: ComposeSnap\) => \{/);
  assert.match(overlaySrc, /const composeUndo = \(\) => \{/);
  assert.match(overlaySrc, /const composeRedo = \(\) => \{/);
  assert.match(overlaySrc, /if \(composePast\.current\.length > 12\) composePast\.current\.shift\(\)/);
  // ráfaga de sliders: un solo paso de historial
  assert.match(overlaySrc, /const pushComposeHistoryMeta = \(\) => \{/);
});

test("F4.2d: Ctrl+Z/Y deshacen la COMPOSICIÓN en modo compose (no la receta)", () => {
  assert.match(overlaySrc, /if \(mod && e\.key\.toLowerCase\(\) === "z" && !e\.shiftKey\) \{ e\.preventDefault\(\); if \(mode === "compose"\) composeUndo\(\); else undo\(\); \}/);
  assert.match(overlaySrc, /if \(mode === "compose"\) composeRedo\(\); else redo\(\);/);
});

test("F4.2d: cada trazo/commit empuja historial — pintura, máscara, bote, degradado, forma, texto, pluma, parche, mágico, Supr, borrado de capa", () => {
  const n = (re) => (overlaySrc.match(re) || []).length;
  assert.equal(n(/pushComposeHistory\(\); \/\/ F4\.2d: un paso de undo por trazo/g), 1);
  assert.equal(n(/pushComposeHistory\(\); \/\/ F4\.2d/g), 8); // máscara, mágico, degradado, forma, pluma, bote, parche, Supr
  assert.match(overlaySrc, /pushComposeHistory\(\); \/\/ F4\.2d: undo de borrado necesita el master/);
  assert.match(overlaySrc, /pushComposeHistory\(true\); \/\/ F4\.2d/); // añadir capa
});

test("F4.2d: flechas desplazan la capa activa con historial agrupado", () => {
  assert.match(overlaySrc, /e\.key\.startsWith\("Arrow"\) && mode === "compose" && activeLayerId/);
  assert.match(overlaySrc, /const step = e\.shiftKey \? 0\.01 : 0\.002;/);
});

// ── 5. Máscaras de capa ───────────────────────────────────────────────────

test("F4.2d: máscara de capa — blanca opaca, espejo destination-in, flatten la respeta", () => {
  assert.match(overlaySrc, /const ensureLayerMask = \(layerId: string\): HTMLCanvasElement => \{/);
  assert.match(overlaySrc, /c\.fillStyle = "#ffffff"; c\.fillRect\(0, 0, cv\.width, cv\.height\)/);
  // espejo DOM
  assert.match(overlaySrc, /const mk = layerMasksRef\.current\.get\(layer\.id\);\r?\n\s+if \(mk\) \{\r?\n\s+ctx\.globalCompositeOperation = "destination-in";/);
  // aplanado de exportación
  assert.match(overlaySrc, /const mk = layerMasksRef\.current\.get\(layer\.id\); \/\/ F4\.2d: respeta la máscara de capa/);
});

test("F4.2d: reroute de pintura a máscara (clone\/heal\/history excluidos) + botones del panel", () => {
  assert.match(overlaySrc, /if \(isPaintTool\(tool\) && maskEditId && tool !== "clone" && tool !== "heal" && tool !== "history"\) \{/);
  assert.match(overlaySrc, /drag\.current = \{ kind: "mask-paint", startX: e\.clientX, startY: e\.clientY, base: \{ layerId: maskEditId \} \}/);
  assert.match(overlaySrc, /\+ Añadir máscara de capa/);
  assert.match(overlaySrc, /"Pintando máscara…"/);
  assert.match(overlaySrc, /Quitar máscara/);
  // el borrado de capa limpia su máscara y el modo de pintura
  assert.match(overlaySrc, /layerMasksRef\.current\.delete\(id\);/);
  assert.match(overlaySrc, /setMaskEditId\(m => \(m === id \? null : m\)\);/);
});

// ── 6. Transformación libre ───────────────────────────────────────────────

test("F4.2d: Ctrl+T con manijas, previsualización viva, Enter aplica · Esc cancela", () => {
  assert.match(overlaySrc, /const enterTfDraft = \(\) => \{/);
  assert.match(overlaySrc, /const commitTfDraft = \(\) => \{/);
  assert.match(overlaySrc, /else if \(mod && e\.key\.toLowerCase\(\) === "t"\) \{ e\.preventDefault\(\); enterTfDraft\(\); \}/);
  assert.match(overlaySrc, /else if \(tfDraft\) \{ e\.preventDefault\(\); commitTfDraft\(\); \}/);
  assert.match(overlaySrc, /else if \(tfDraft\) setTfDraft\(null\);/);
  // drag kinds propios + manija de rotación
  assert.match(overlaySrc, /d\.kind === "tf-move" && activeLayerId/);
  assert.match(overlaySrc, /d\.kind === "tf-drag" && d\.corner/);
  assert.match(overlaySrc, /d\.corner === "rot"/);
  assert.match(overlaySrc, /Arrastra para rotar/);
  // previsualización EN VIVO en el espejo de la capa activa
  assert.match(overlaySrc, /const t = activeLayerId === l\.id && tfDraft \? tfDraft : l\.transform;/);
});

test("F4.2d: sliders del inspector agrupan historial (max 1 paso por ráfaga)", () => {
  assert.match(overlaySrc, /const composePatchLayer = \(id: string, patch: Partial<CompositionLayer>\) => \{\r?\n\s+pushComposeHistoryMeta\(\);/);
  assert.match(overlaySrc, /const composePatchTransform = \(patch: Partial<CompositionLayerTransform>\) => \{\r?\n\s+if \(!activeLayerId\) return;\r?\n\s+pushComposeHistoryMeta\(\);/);
});

// ── 7. Selecciones: añadir/quitar/invertir/feather + hormigas ─────────────

test("F4.2d: Shift añade · Alt quita en marco/lazo/varita; commit une/resta con bbox", () => {
  const n = (overlaySrc.match(/selModeRef\.current = e\.shiftKey \? "add" : e\.altKey \? "sub" : "new";/g) || []).length;
  assert.equal(n, 3); // marco, lazo libre, varita
  assert.match(overlaySrc, /const commitSelection = \(mode: "new" \| "add" \| "sub" = "new"\) => \{/);
  assert.match(overlaySrc, /const mask = mode !== "new" && selectionMaskRef\.current \? selectionMaskRef\.current : ensureSelectionMask\(\)/);
  assert.match(overlaySrc, /if \(mode === "sub"\) ctx\.globalCompositeOperation = "destination-out";/);
  assert.match(overlaySrc, /setSelectionBBox\(mode === "sub" \? \(prevBBox \|\| shapeBBox\) : unionBBox\(prevBBox, shapeBBox\)\)/);
  assert.match(overlaySrc, /const buildWandMask = \(p: \{ x: number; y: number \}, selMode: "new" \| "add" \| "sub" = "new"\) => \{/);
  assert.match(overlaySrc, /commitSelection\(selModeRef\.current\)/);
});

test("F4.2d: invertir (Ctrl+Shift+I) y feather al commit", () => {
  assert.match(overlaySrc, /const invertSelection = \(\) => \{/);
  assert.match(overlaySrc, /else if \(mod && e\.shiftKey && e\.key\.toLowerCase\(\) === "i"\) \{ e\.preventDefault\(\); invertSelection\(\); \}/);
  assert.match(overlaySrc, /const applyFeatherToMask = \(\) => \{/);
  assert.match(overlaySrc, /const blurPx = Math\.max\(0\.5, selFeather \* \(mask\.width \/ Math\.max\(1, imgRect\.width\)\)\)/);
  assert.equal((overlaySrc.match(/applyFeatherToMask\(\);/g) || []).length, 2); // 2 llamadas reales: varita + commit de selección
  assert.match(overlaySrc, /\{\(tool === "marquee" \|\| tool === "lasso" \|\| tool === "quicksel"\) && \(/);
  assert.match(overlaySrc, /Feather: difumina el borde de la selección al confirmarla/);
});

test("F4.2d: hormigas animadas en las previsualizaciones y bbox de selección", () => {
  const n = (overlaySrc.match(/<animate attributeName="stroke-dashoffset" from="0" to="-9" dur="0\.6s" repeatCount="indefinite" \/>/g) || []).length;
  assert.equal(n, 4); // rect preview, ellipse preview, poly preview, bbox
});

// ── 8. Texto vivo en el overlay ───────────────────────────────────────────

test("F4.2d: commitType crea/reedita capa kind text y rasterTextLayer la pinta", () => {
  assert.match(overlaySrc, /const rasterTextLayer = \(layer: CompositionLayer\) => \{/);
  assert.match(overlaySrc, /const nl = createTextLayer\(composeLayers\.length, text\);/);
  assert.match(overlaySrc, /const existingIdx = composeLayers\.findIndex\(l => l\.kind === "text" && l\.text/);
  assert.match(overlaySrc, /Texto actualizado \(capa viva\)\./);
  assert.match(overlaySrc, /Capa de texto viva creada/);
  // clic sobre texto existente lo reedita
  assert.match(overlaySrc, /const hitText = \[\.\.\.composeLayers\]\.reverse\(\)\.find\(l => l\.kind === "text" && l\.text/);
  assert.match(overlaySrc, /Aplicar texto \(Enter\)/);
  // selector de fuentes del sistema
  assert.match(overlaySrc, /<option value="Georgia, serif">Georgia<\/option>/);
  assert.match(overlaySrc, /<option value="Impact, sans-serif">Impact<\/option>/);
});

// ── 9. QoL: espacio, Alt+rueda, corchetes, X\/D, Shift+ciclo, auto-selección ──

test("F4.2d: espacio = mano temporal + Alt acelera la rueda", () => {
  assert.match(overlaySrc, /if \(e\.code === "Space" && !isTyping\(e\.target\)\) \{ e\.preventDefault\(\); setSpaceDown\(true\); \}/);
  assert.match(overlaySrc, /\/\/ F4\.2d: espacio mantiene la mano temporal con cualquier tool activa/);
  assert.match(overlaySrc, /e\.deltaY \* \(e\.altKey \? 0\.0024 : 0\.0012\)/);
});

test("F4.2d: [ ] tamaño, X\/D colores, Shift+letra cicla variantes usables", () => {
  assert.match(overlaySrc, /setPaintSize\(s => clamp\(s \+ \(e\.key === "\]" \? 4 : -4\), 1, 400\)\)/);
  assert.match(overlaySrc, /else if \(e\.key\.toLowerCase\(\) === "x"\) \{ setPaintColor\(bgColor\); setBgColor\(paintColor\); \}/);
  assert.match(overlaySrc, /else if \(e\.key\.toLowerCase\(\) === "d"\) \{ setPaintColor\("#ffffff"\); setBgColor\("#000000"\); \}/);
  assert.match(overlaySrc, /if \(e\.shiftKey && g === tool\) \{/);
  assert.match(overlaySrc, /const usable = grp \? grp\.variants\.filter\(x => x\.status !== "soon"\) : \[\];/);
});

test("F4.2d: auto-selección por alpha con la tool Mover", () => {
  assert.match(overlaySrc, /if \(tool === "move" && mode === "compose"\) \{\r?\n\s+\/\/ F4\.2d: auto-selección — la capa visible más alta con pintura bajo el puntero/);
  assert.match(overlaySrc, /if \(alpha > 8\) \{ if \(activeLayerId !== l\.id\) setActiveLayerId\(l\.id\); break; \}/);
});

test("F4.2d: cursor circular del pincel (div por ref, sin re-render)", () => {
  assert.match(overlaySrc, /const brushCursorRef = useRef<HTMLDivElement \| null>\(null\);/);
  assert.match(overlaySrc, /bc\.style\.width = `\$\{paintSize\}px`;/);
  assert.match(overlaySrc, /ref=\{brushCursorRef\} style=\{\{ display: "none", position: "absolute", border: "1px solid rgba\(255,255,255,0\.85\)"/);
});

test("F4.2d: tamaño del trazo hasta 400 px en la barra de opciones", () => {
  assert.match(overlaySrc, /<input type="range" min=\{1\} max=\{400\} value=\{paintSize\}/);
});

// ── 10. Rail: dúo de colores frontal/fondo ────────────────────────────────

test("F4.2d: rail expone bgColor\/onBgColor y el overlay se los pasa (X\/D reales)", () => {
  assert.match(railSrc, /bgColor: string;/);
  assert.match(railSrc, /onBgColor: \(color: string\) => void;/);
  assert.match(railSrc, /Dúo frontal\/fondo estilo Photoshop/);
  assert.match(railSrc, /X alterna, D restablece/);
  assert.match(overlaySrc, /bgColor=\{bgColor\}/);
  assert.match(overlaySrc, /onBgColor=\{setBgColor\}/);
});

// ── 11. Integración: botones de historial y UI de transformar ────────────

test("F4.2d: botones Deshacer\/Rehacer y Transformar en barra de opciones + panel", () => {
  assert.match(overlaySrc, /onClick=\{composeUndo\} title="Deshacer la composición \(Ctrl\+Z\)"/);
  assert.match(overlaySrc, /onClick=\{composeRedo\} title="Rehacer \(Ctrl\+Y\)"/);
  assert.match(overlaySrc, /onClick=\{enterTfDraft\} title="Transformación libre \(Ctrl\+T\)"/);
  assert.match(overlaySrc, /Aplicar \(Enter\)/);
  assert.match(overlaySrc, /Cancelar \(Esc\)/);
  assert.match(overlaySrc, /Historial de la composición/);
  // escudo anti-tools fantasma intacto: el aviso de "pronto" sigue viva
  assert.match(overlaySrc, /llega en F4\.5 — sigue activa la variante actual\./);
});

// ── 12. Alcance F4.2d: anti-scope-creep ───────────────────────────────────

test("F4.2d: lo NO entregado sigue sin existir (cero tools fantasma)", () => {
  // sin PSD (ag-psd queda para F4.5+), sin licuar, sin relleno según contenido
  assert.doesNotMatch(overlaySrc, /licuar|liquify|contentAwareFill|psd/i);
  // máscaras de capa declaradas honestamente como vivas en la sesión
  assert.match(overlaySrc, /viva en la sesión — la exportación la respeta al aplanar/);
});
