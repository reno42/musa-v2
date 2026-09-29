/**
 * QA — REQ-PHOTO-FASE4.2c: rail estilo Photopea con ORDEN EXACTO, variantes
 * (flyout) por grupo y motor v1 para cada variante funcional.
 *
 * Cubre:
 *   1. PhotoToolRail.tsx — 21 grupos (20 de la referencia + Máscaras extra),
 *      atajos únicos, iconos SVG propios, honestidad de variantes "soon".
 *   2. PhotoModeOverlay.tsx — modelo GRUPO+variante, dispatch, motor de trazos
 *      con variantes (lápiz/historial/dedo/esponja/enfocar/ojos rojos),
 *      borrador mágico, degradado, formas, texto, pluma, lazo poligonal,
 *      marco de fila/columna, barra de opciones y atajos.
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

// ── 1. PhotoToolRail.tsx — orden exacto de la referencia ─────────────────

const GROUP_RE = /\{ id: "([a-z]+)", label: "[^"]+", key: "([A-Z])"(?:, (?:paint|selection): true)*, variants: \[/g;
const groupIds = [...rail.matchAll(GROUP_RE)].map(m => m[1]);
const groupKeys = [...rail.matchAll(GROUP_RE)].map(m => m[2].toLowerCase());

test("F4.2c: 21 grupos en el ORDEN EXACTO de Photopea + Máscaras extra al final", () => {
  assert.deepEqual(groupIds, [
    "move", "marquee", "lasso", "quicksel", "crop", "eyedropper",
    "heal", "brush", "clone", "history", "eraser", "gradient",
    "blur", "dodge", "type", "pen", "pathsel", "shapes",
    "hand", "zoom", "masks",
  ]);
});

test("F4.2c: atajos de grupo únicos (V M L W C I J B S Y E G U O T P A R H Z K)", () => {
  assert.equal(groupKeys.length, 21);
  assert.equal(new Set(groupKeys).size, 21, `atajos duplicados: ${groupKeys.join(",")}`);
});

test("F4.2c: variantes por grupo (flyout) — conteos y variantes clave", () => {
  // entradas de variante: terminan en "} " tras label/status; los grupos siguen con ", key:"
  const variantRe = /\{ id: "([a-z]+)", label: "[^"]*"(, status: "soon")? \}/g;
  const variants = [...rail.matchAll(variantRe)].map(m => ({ id: m[1], soon: !!m[2] }));
  const count = (id) => variants.filter(v => v.id === id).length;
  assert.equal(count("rect"), 2, '"rect" debe existir en marquee y shapes');
  assert.equal(count("ellipse"), 2, '"ellipse" debe existir en marquee y shapes');
  for (const id of ["spot", "heal", "patch", "redeye"]) assert.ok(count(id) >= 1, `falta variante heal: ${id}`);
  for (const id of ["brush", "pencil"]) assert.ok(count(id) >= 1, `falta variante brush: ${id}`);
  for (const id of ["eraser", "magic"]) assert.ok(count(id) >= 1, `falta variante eraser: ${id}`);
  for (const id of ["linear", "radial", "bucket"]) assert.ok(count(id) >= 1, `falta variante gradient: ${id}`);
  for (const id of ["blur", "sharpen", "smudge"]) assert.ok(count(id) >= 1, `falta variante blur: ${id}`);
  for (const id of ["dodge", "burn", "sponge"]) assert.ok(count(id) >= 1, `falta variante dodge: ${id}`);
  for (const id of ["history", "wand", "row", "col", "poly", "free", "type", "pen", "line", "hand", "zoom", "masks"]) {
    assert.ok(count(id) >= 1, `falta variante: ${id}`);
  }
});

test("F4.2c: honestidad — todo grupo con variantes 'soon' tiene al menos una usable (salvo pathsel)", () => {
  const allSoon = [];
  for (const g of rail.matchAll(GROUP_RE)) {
    const start = g.index + g[0].length;
    const body = rail.slice(start, rail.indexOf("] },", start)); // solo las variantes del grupo
    const nVar = (body.match(/\{ id: "/g) || []).length;
    const nSoon = (body.match(/status: "soon"/g) || []).length;
    if (nVar - nSoon === 0) allSoon.push(g[1]);
  }
  assert.deepEqual(allSoon, ["pathsel"], "solo pathsel es intencionalmente sin variante usable (botón que avisa)");
});

test("F4.2c: iconos SVG inline propios — cero emojis (regla del repo)", () => {
  assert.match(rail, /data-testid="photo-tool-rail"/);
  assert.match(rail, /TOOL_ICONS: Record<PhotoGroupId, ReactNode>/);
  assert.match(rail, /viewBox="0 0 24 24"/);
  assert.doesNotMatch(rail, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "el rail no debe contener emojis");
});

test("F4.2c: exports del modelo GRUPO+variante y flyout (triangulito + clic derecho)", () => {
  assert.match(rail, /export const GROUP_BY_ID = new Map\(PHOTO_TOOL_GROUPS\.map\(\(g\): \[PhotoGroupId, PhotoToolGroupDef\] => \[g\.id, g\]\)\);/);
  assert.match(rail, /export const GROUP_BY_KEY = new Map\(PHOTO_TOOL_GROUPS\.map\(\(g\): \[string, PhotoGroupId\] => \[g\.key\.toLowerCase\(\), g\.id\]\)\);/);
  assert.match(rail, /export const isPaintTool = \(g: PhotoGroupId\) => !!GROUP_BY_ID\.get\(g\)\?\.paint;/);
  assert.match(rail, /export const defaultVariantOf/);
  assert.match(rail, /export const findVariant/);
  assert.match(rail, /onPickVariant: \(group: PhotoGroupId, variant: string\) => void;/);
  assert.match(rail, /onContextMenu=\{e => \{ if \(hasMenu\) \{ e\.preventDefault\(\); setMenuFor/);
  assert.match(rail, /data-testid=\{`photo-tool-menu-\$\{g\.id\}`\}/);
});

// ── 2. PhotoModeOverlay.tsx — integración ────────────────────────────────

test("F4.2c: el overlay importa el modelo nuevo y monta el rail antes del panel izquierdo", () => {
  assert.match(overlay, /import \{\s*\n\s*PhotoToolRail, GROUP_BY_ID, GROUP_BY_KEY, defaultVariantOf, findVariant, isPaintTool,\s*\n\s*type PhotoGroupId,\s*\n\} from "\.\/PhotoToolRail";/);
  const railIdx = overlay.indexOf("<PhotoToolRail");
  const filmstripIdx = overlay.indexOf("{/* ── Izquierda: filmstrip + histograma ── */}");
  assert.ok(railIdx > 0 && filmstripIdx > railIdx, "el rail debe ir antes de la columna izquierda");
  assert.match(overlay, /variants=\{toolVariants\}/);
  assert.match(overlay, /onPick=\{pickGroup\}/);
  assert.match(overlay, /onPickVariant=\{pickGroup\}/);
});

test("F4.2c: estado GRUPO+variante + borradores (texto/pluma) y derivada toolVariant", () => {
  assert.match(overlay, /const \[tool, setTool\] = useState<PhotoGroupId>\("move"\);/);
  assert.match(overlay, /const \[toolVariants, setToolVariants\] = useState<Record<string, string>>\(\{\}\);/);
  assert.match(overlay, /const \[toolNotice, setToolNotice\] = useState<string \| null>\(null\);/);
  assert.match(overlay, /const \[paintFlow, setPaintFlow\] = useState\(1\);/);
  assert.match(overlay, /const \[paintSmooth, setPaintSmooth\] = useState\(0\);/);
  assert.match(overlay, /const \[typeSize, setTypeSize\] = useState\(48\);/);
  assert.match(overlay, /const \[typeDraft, setTypeDraft\] = useState<\{ x: number; y: number; value: string \} \| null>\(null\);/);
  assert.match(overlay, /const \[penPts, setPenPts\] = useState<Array<\[number, number\]>>\(\[\]\);/);
  assert.match(overlay, /const toolVariant = toolVariants\[tool\] \|\| defaultVariantOf\(tool\);/);
});

test("F4.2c: dispatch — marco (rect/elipse/fila/columna) y lazo (libre/poligonal)", () => {
  assert.match(overlay, /if \(variant === "row" \|\| variant === "col"\) \{ commitRowCol\(p0, variant\); return; \}/);
  assert.match(overlay, /kind: variant === "ellipse" \? "sel-ellipse" : "sel-rect"/);
  assert.match(overlay, /if \(tool === "lasso"\) \{/);
  assert.match(overlay, /if \(!selPreview \|\| selPreview\.kind !== "poly"\) clearSelection\(\);/);
});

test("F4.2c: dispatch — selección rápida, cuentagotas, zoom y mano por GRUPO", () => {
  assert.match(overlay, /if \(tool === "quicksel"\) \{ buildWandMask\(displayPointToNorm\(e\)\); return; \}/);
  assert.match(overlay, /if \(tool === "eyedropper"\) \{ pickColorAt\(displayPointToNorm\(e\)\); return; \}/);
  assert.match(overlay, /zoom: clamp\(v\.zoom \* \(e\.altKey \? 1 \/ 1\.3 : 1\.3\), 0\.2, 12\)/);
  assert.match(overlay, /if \(tool === "hand"\) \{\s*\n\s*drag\.current = \{ kind: "pan"/);
});

test("F4.2c: dispatch — texto, pluma, formas y degradado con compose guard", () => {
  assert.match(overlay, /if \(tool === "type"\) \{\s*\n\s*if \(typeDraft\) \{ commitType\(\); return; \}/);
  assert.match(overlay, /if \(tool === "pen"\) \{\s*\n\s*if \(!enterCompose\(\)\) return;\s*\n\s*const p0 = displayPointToNorm\(e\);\s*\n\s*setPenPts\(pts => \[\.\.\.pts, \[p0\.x, p0\.y\]\]\);/);
  assert.match(overlay, /kind: variant === "line" \? "shape-line" : variant === "ellipse" \? "shape-ellipse" : "shape-rect"/);
  assert.match(overlay, /if \(tool === "gradient" && variant !== "bucket"\) \{/);
  assert.match(overlay, /drag\.current = \{ kind: "gradient-drag", startX: e\.clientX, startY: e\.clientY, base: displayPointToNorm\(e\) \};/);
});

test("F4.2c: dispatch — tampón Alt+clic, parche por variante, bote y borrador mágico", () => {
  assert.match(overlay, /if \(tool === "clone" && e\.altKey\) \{/);
  assert.match(overlay, /if \(tool === "heal" && variant === "patch" && !selectionMaskRef\.current\) \{/);
  assert.match(overlay, /if \(tool === "gradient"\) \{ fillSelection\(layer\.id\); setComposeDirty\(true\); return; \} \/\/ bote/);
  assert.match(overlay, /if \(tool === "eraser" && variant === "magic"\) \{\s*\n\s*buildMagicErase\(displayPointToNorm\(e\), layer\.id\);/);
  assert.match(overlay, /drag\.current = \{ kind: "layer-paint", startX: e\.clientX, startY: e\.clientY, base: \{ layerId: layer\.id \} \};/);
});

test("F4.2c: motor de trazos — modos de fuente y variantes de pincel", () => {
  assert.match(overlay, /const paintLayerAt = \(e: React\.PointerEvent, layerId: string\) => \{/);
  assert.match(overlay, /const srcMode: "ink" \| "clone" \| "heal" \| "history" \| "fx" =/);
  // lápiz: borde duro (meseta hasta 0.94 del radio)
  assert.match(overlay, /const plateau = v === "pencil" \? 0\.94 : 0\.35;/);
  // suavizar: el trazo persigue al puntero
  assert.match(overlay, /if \(paintSmooth > 0 && lastPaintPt\.current && tool !== "clone"\) \{/);
  // flujo multiplica la opacidad del trazo
  assert.match(overlay, /Math\.min\(1, paintOpacity \* Math\.max\(0\.05, paintFlow\)\)/);
  // historial: snapshot en la misma posición (sin offset)
  assert.match(overlay, /tool === "history" \? "history"/);
  // dedo: arrastra desde detrás; esponja con Alt desatura; ojos rojos dessatura
  assert.match(overlay, /fxVariant === "smudge" && lastPaintPt\.current\) \{\s*\n\s*offX = lastPaintPt\.current\.x - x;/);
  assert.match(overlay, /saturate\(\$\{e\.altKey \? "0\.2" : "1\.6"\}\)/);
  assert.match(overlay, /"saturate\(0\.15\) brightness\(0\.9\)"/);
  assert.match(overlay, /"contrast\(1\.35\) saturate\(1\.08\)"/);
  // goma destination-out; exponer/quemar por variante
  assert.match(overlay, /tool === "eraser" \? "destination-out"/);
  assert.match(overlay, /tool === "dodge" && v === "burn" \? "color-burn"/);
  // selección activa recorta el trazo
  assert.match(overlay, /sctx\.globalCompositeOperation = "destination-in";\s*\n\s*sctx\.drawImage\(selectionMaskRef\.current, 0, 0\);/);
});

test("F4.2c: borrador mágico — BFS sobre la capa y destino-out", () => {
  assert.match(overlay, /const buildMagicErase = \(p: \{ x: number; y: number \}, layerId: string\) => \{/);
  assert.match(overlay, /dr \* dr \+ dg \* dg \+ db \* db \+ da \* da > tol2/);
  assert.match(overlay, /mctx\.globalCompositeOperation = "destination-out";\s*\n\s*mctx\.drawImage\(hitCv, 0, 0, W, H, 0, 0, master\.width, master\.height\);/);
});

test("F4.2c: degradado, formas, texto y pluma — commits v1", () => {
  assert.match(overlay, /const commitGradient = \(d: \{ startX: number; startY: number; base: any \}, e: React\.PointerEvent\) => \{/);
  assert.match(overlay, /sctx\.createRadialGradient\(x1, y1, 0, x1, y1, Math\.max\(2, Math\.hypot\(x1 - x0, y1 - y0\)\)\)/);
  assert.match(overlay, /const commitShape = \(d: \{ kind: string; startX: number; startY: number; base: any \}, e: React\.PointerEvent\) => \{/);
  assert.match(overlay, /sctx\.ellipse\(\(x0 \+ x1\) \/ 2, \(y0 \+ y1\) \/ 2/);
  assert.match(overlay, /const commitType = \(\) => \{/);
  assert.match(overlay, /draft\.value\.split\("\\n"\)\.forEach\(\(line, i\) => ctx\.fillText\(line, x, y \+ i \* px \* 1\.25\)\);/);
  assert.match(overlay, /const closePenPath = \(\) => \{/);
  assert.match(overlay, /ctx\.closePath\(\);/);
});

test("F4.2c: marco de fila/columna y selección elíptica (commits de máscara)", () => {
  assert.match(overlay, /const commitRowCol = \(p: \{ x: number; y: number \}, variant: string\) => \{/);
  assert.match(overlay, /if \(variant === "row"\) ctx\.fillRect\(0, Math\.round\(p\.y \* mask\.height\), mask\.width, 1\);/);
  assert.match(overlay, /\} else if \(prev\.kind === "ellipse"\) \{/);
  assert.match(overlay, /setSelectionBBox\(polyBBox\(prev\.pts\)\);/);
});

test("F4.2c: pickGroup — rechazo honesto de variantes 'soon' y orquestación de modos", () => {
  assert.match(overlay, /const pickGroup = \(g: PhotoGroupId, vId\?: string\) => \{/);
  assert.match(overlay, /if \(vdef\?\.status === "soon"\) \{\s*\n\s*setToolNotice\(/);
  assert.match(overlay, /if \(g === "crop"\) \{ enterCropMode\(\); return; \}/);
  assert.match(overlay, /if \(g === "masks"\) \{\s*\n\s*setMode\("edit"\);\s*\n\s*setTab\("mascaras"\);/);
  assert.match(overlay, /if \(grp\.paint && mode !== "compose"\) \{\s*\n\s*setMode\("compose"\);/);
});

test("F4.2c: atajos por GRUPO (GROUP_BY_KEY), Enter cierra borradores, Esc cancela", () => {
  assert.match(overlay, /else if \(!mod && GROUP_BY_KEY\.has\(e\.key\.toLowerCase\(\)\)\) \{ e\.preventDefault\(\); pickGroup\(GROUP_BY_KEY\.get\(e\.key\.toLowerCase\(\)\)!\); \}/);
  assert.match(overlay, /if \(typeDraft\) \{ e\.preventDefault\(\); commitType\(\); \}/);
  assert.match(overlay, /else if \(penPts\.length >= 3\) \{ e\.preventDefault\(\); closePenPath\(\); \}/);
  assert.match(overlay, /else if \(selPreview\?\.kind === "poly"\) \{ e\.preventDefault\(\); commitSelection\(\); \}/);
  assert.match(overlay, /if \(typeDraft\) setTypeDraft\(null\);\s*\n\s*else if \(penPts\.length\) setPenPts\(\[\]\);/);
  assert.match(overlay, /else if \(e\.key === "Delete" \|\| e\.key === "Backspace"\) \{/);
});

test("F4.2c: barra de opciones por grupo (Tamaño/Opacidad/Flujo/Suavizar/Tolerancia/color)", () => {
  assert.match(overlay, /data-testid="photo-options-bar"/);
  assert.match(overlay, /SIZE_GROUPS\.has\(tool\)/);
  assert.match(overlay, /OPACITY_GROUPS\.has\(tool\)/);
  assert.match(overlay, /FLOW_GROUPS\.has\(tool\)/);
  assert.match(overlay, /SMOOTH_GROUPS\.has\(tool\)/);
  assert.match(overlay, /COLOR_GROUPS\.has\(tool\)/);
  assert.match(overlay, /\(tool === "quicksel" \|\| \(tool === "eraser" && toolVariant === "magic"\)\) && \(/);
  assert.match(overlay, /<button type="button" style=\{smallBtn\} onClick=\{clearSelection\}>Deseleccionar<\/button>/);
  // input de texto del borrador + rasterizado
  assert.match(overlay, /<input autoFocus type="text" value=\{typeDraft\.value\}/);
  assert.match(overlay, /onClick=\{commitType\}>Rasterizar \(Enter\)<\/button>/);
});

test("F4.2c: hormigas — rect, elipse, poly, línea, puntos de pluma y cursor de texto", () => {
  assert.match(overlay, /selPreview\?\.kind === "ellipse" && \(/);
  assert.match(overlay, /selPreview\?\.kind === "line" && \(/);
  assert.match(overlay, /\{penPts\.length > 0 && \(/);
  assert.match(overlay, /\{typeDraft && \(/);
  assert.match(overlay, /strokeDasharray="5 4"/);
});

test("F4.2c: cursor por grupo + snapshot de retoque intacto", () => {
  assert.match(overlay, /cursor: mode === "brush" \|\| isPaintTool\(tool\) \|\| tool === "marquee"/);
  assert.match(overlay, /tool === "zoom" \? "zoom-in"/);
  assert.match(overlay, /const ensureSnapshot = \(\): HTMLCanvasElement \| null => \{/);
  assert.match(overlay, /renderer\.update\(recipe, \{ view, split, original: showOriginal \}\); \/\/ restaura la vista real/);
});

test("F4.2c: reset por foto — la selección/tampón/snapshot no arrastran entre fotos", () => {
  assert.match(overlay, /snapshotRef\.current = null;\s*\n\s*selectionMaskRef\.current = null;\s*\n\s*cloneSrcRef\.current = null;/);
  assert.match(overlay, /composeLoadedRef\.current = false;\s*\n\s*setSelectionBBox\(null\);\s*\n\s*setSelPreview\(null\);\s*\n\s*setTool\("move"\);/);
});

test("F4.2c: sin emojis en la nueva UI del overlay (rail + ants + options bar)", () => {
  // alcance: SOLO los bloques nuevos — máscaras/recetas de Fases 1-3 tienen
  // glifos preexistentes fuera del alcance de este req
  const railJsx = overlay.slice(overlay.indexOf("{/* ── Rail de herramientas"), overlay.indexOf("{/* ── Izquierda: filmstrip"));
  const stageUi = overlay.slice(overlay.indexOf("Fase 4.2c: selección/borradores"), overlay.indexOf("{glError && ("));
  for (const [name, ui] of [["rail JSX", railJsx], ["stage UI", stageUi]]) {
    assert.ok(ui.length > 0, `${name}: slice vacío`);
    assert.doesNotMatch(ui, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u, `${name} no debe contener emojis`);
  }
});
