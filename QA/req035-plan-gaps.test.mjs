/**
 * REQ035 — the gaps the plan-vs-repo contrast found in
 * Propuesta_UI_motion_graphics (2026-10-07): P1.4 direct trajectory editing,
 * P1.5 retime, P1.6 layer z-reorder, P1.1 Capas list, P0.5 sanitized errors
 * and the P0.1 restore contract.
 *
 * Contracts under test:
 *  - setKeyframeValue rewrites a keyframe's VALUE with its TIME untouched
 *    (A-04: "mover un nodo conserva su tiempo"); neighbors and other lanes
 *    stay byte-identical.
 *  - retimeLayerClips rescales the layer's windows AND the times keyframes
 *    land on, keeping every VALUE (destino) and the contact count (A-06),
 *    with clips left contiguous; clamped to [0.2, 600]s.
 *  - reorderedLayerZ turns a DOM-order swap into a total explicit z map;
 *    layerZStyleText scopes it to one wrapper scope class.
 *  - VideoDocStore restores the journal from localStorage after a simulated
 *    reload and drops stale trailing commands (P0.1 acceptance).
 *  - UI wiring: draggable trajectory dots (space edit, never time), retime
 *    row in the lanes panel, Capas list + z buttons, safeErrToast (P0.5:
 *    raw exception text never reaches a user toast).
 *
 * Run: node --experimental-strip-types --test QA/req035-plan-gaps.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildWallBounce } from "../shared/wallBounce.ts";
import { normalizeAnimation } from "../shared/animationSchema.ts";
import { buildTimelineLanes } from "../shared/timelineLanes.ts";
import { reorderedLayerZ, layerZStyleText } from "../shared/layerOrder.ts";
import {
  setKeyframeValue, retimeLayerClips, layerAnimationSpan, parseTransform, composeTransform,
} from "../src/lib/layerKeyframes.ts";
import { VideoDocStore } from "../src/lib/videoDocStore.ts";
import { emptyVideoTimelineDoc } from "../src/lib/videoTimelineDoc.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

// Flujo 1 wall-bounce (same fixture as REQ033/034): three clips on one layer.
const base = {
  layerId: "pelota", width: 1080, height: 1080,
  startCenter: { x: 540, y: 540 }, origin: { x: 440, y: 500 },
  radius: 40, margin: 0, contacts: 20, durationSec: 4, dirDeg: 37,
  rhythm: "velocity", endMode: "center", arrivalSec: 0.8, exitMode: "fade", fadeSec: 0.6,
};

function bounceSchema() {
  const r = buildWallBounce(base);
  const schema = normalizeAnimation({
    timeline: { durationSec: 6, fps: 30, width: 1080, height: 1080, loop: "once" },
    clips: r.clips,
    transitions: [],
  });
  return { r, schema };
}

// ── P1.4: trajectory node drags edit SPACE, never TIME ──

test("REQ035-P14-1: setKeyframeValue cambia el valor con el tiempo intacto y vecinos byte-identicos", () => {
  const { schema } = bounceSchema();
  const lanes = buildTimelineLanes(schema, "pelota");
  const llegada = lanes.find(l => l.clipIndex === 1);
  const kf1 = llegada.keyframes.find(k => k.index === 1);
  const cur = parseTransform(kf1.value);
  const res = setKeyframeValue(schema, "pelota", "transform", 1, composeTransform({ ...cur, x: 12.5, y: -30 }), 1);
  assert.ok(res.schema, "la edicion de valor aplica");
  const after = buildTimelineLanes(res.schema, "pelota");
  const llegada2 = after.find(l => l.clipIndex === 1);
  const kf1b = llegada2.keyframes.find(k => k.index === 1);
  assert.equal(kf1b.t, kf1.t, "A-04: el tiempo del nodo no se mueve al editar el espacio");
  const parts = parseTransform(kf1b.value);
  assert.equal(parts.x, 12.5);
  assert.equal(parts.y, -30);
  assert.equal(parts.scale, cur.scale, "escala preservada");
  assert.equal(parts.rotate, cur.rotate, "rotacion preservada");
  assert.deepEqual(
    llegada2.keyframes.filter(k => k.index !== 1),
    llegada.keyframes.filter(k => k.index !== 1),
    "los vecinos quedan intactos",
  );
  assert.equal(
    JSON.stringify(after.filter(l => l.clipIndex !== 1)),
    JSON.stringify(lanes.filter(l => l.clipIndex !== 1)),
    "las demas carriles (rebote, fade) quedan byte-identicos",
  );
  assert.equal(setKeyframeValue(schema, "pelota", "transform", 99, "x", 1).schema, null, "indice invalido no cambia nada");
  assert.equal(setKeyframeValue(schema, "otra", "transform", 1, "x", 1).schema, null, "capa equivocada no cambia nada");
});

test("REQ035-P14-2: los rombos de trayectoria son interactivos y mapean puntero→frame sin tocar el tiempo", () => {
  const src = read("src/components/VideoModeOverlay.tsx");
  assert.match(src, /data-video-traj-dot/, "los nodos llevan identidad de drag");
  assert.match(src, /pointerEvents: "auto", cursor: "grab"/, "solo los nodos capturan el puntero (el svg sigue siendo none)");
  assert.match(src, /setPointerCapture/, "el drag captura el puntero para no perderlo fuera del nodo");
  assert.match(src, /conserva su tiempo/, "el tooltip declara la separacion espacio/tiempo");
  assert.match(src, /kind: "value", clipIndex: dr\.clipIndex, prop: "transform", kfIndex: dr\.kfIndex/, "el drag emite la operacion value lane-addressed");
  assert.match(src, /composeTransform\(\{ \.\.\.cur, x: fx - layerBox\.cx, y: fy - layerBox\.cy \}\)/, "puntero display → frame px → valor relativo al origen de la capa");
  const insp = read("src/components/video/VideoInspector.tsx");
  assert.match(insp, /\| \{ kind: "value"; clipIndex: number; prop: string; kfIndex: number; value: string \}/, "KeyframeOp incluye value");
});

// ── P1.5: retime sin alterar el destino ──

test("REQ035-P15-1: retime reescala ventanas y tiempos conservando valores, destino y contactos", () => {
  const { schema } = bounceSchema();
  const before = buildTimelineLanes(schema, "pelota");
  const res = retimeLayerClips(schema, "pelota", 10.8); // x2
  assert.ok(res.schema);
  const slow = buildTimelineLanes(res.schema, "pelota");
  assert.deepEqual(slow.map(l => [l.startSec, l.endSec]), [[0, 8], [8, 9.6], [9.6, 10.8]], "ventanas reescaladas x2");
  assert.deepEqual(
    slow.map(l => l.keyframes.map(k => k.t)),
    before.map(l => l.keyframes.map(k => k.t)),
    "los t normalizados (tiempos relativos) se conservan",
  );
  assert.deepEqual(
    slow.map(l => l.keyframes.map(k => k.value)),
    before.map(l => l.keyframes.map(k => k.value)),
    "ningun valor cambia: mismo destino (llegada al centro) y mismos contactos",
  );
  for (let i = 0; i < slow.length - 1; i++) {
    assert.equal(slow[i + 1].startSec, slow[i].endSec, "los clips siguen contiguos tras retimar");
  }
  assert.equal(slow[0].keyframes.length, 21, "A-06: el conteo de contactos no cambia al retimar");
  assert.equal(normalizeAnimation(res.schema).timeline.fps, 30);
  // x0.5 sobre el schema ya retimado
  const res2 = retimeLayerClips(res.schema, "pelota", 2.7);
  const fast = buildTimelineLanes(res2.schema, "pelota");
  assert.deepEqual(fast.map(l => [l.startSec, l.endSec]), [[0, 2], [2, 2.4], [2.4, 2.7]]);
  // clamps: nunca por debajo de 0.2s ni por encima de 600s. En compresión
  // extrema el piso de 50ms por clip de normalizeAnimation puede estirar el
  // total un poco — lo que NUNCA se rompe es la contigüidad y los valores.
  const maxed = buildTimelineLanes(retimeLayerClips(schema, "pelota", 99999).schema, "pelota");
  assert.equal(maxed[maxed.length - 1].endSec, 600);
  for (let i = 0; i < maxed.length - 1; i++) assert.equal(maxed[i + 1].startSec, maxed[i].endSec);
  const minRes = retimeLayerClips(schema, "pelota", 0.001);
  const minned = buildTimelineLanes(minRes.schema, "pelota");
  const minTotal = minned[minned.length - 1].endSec;
  assert.ok(minTotal >= 0.2 && minTotal <= 0.3, `el span mínimo queda en el rango del piso de 50ms (${minTotal})`);
  for (let i = 0; i < minned.length - 1; i++) assert.equal(minned[i + 1].startSec, minned[i].endSec, "contiguo incluso comprimido al piso");
  assert.deepEqual(
    minned.map(l => l.keyframes.map(k => k.value)),
    before.map(l => l.keyframes.map(k => k.value)),
    "valores intactos también en compresión extrema",
  );
  // capa sin clips / capa desconocida → sin cambio
  assert.equal(retimeLayerClips(schema, "nadie", 5).schema, null);
  // el span utilitario coincide con las ventanas
  assert.deepEqual(layerAnimationSpan(schema, "pelota"), { startSec: 0, endSec: 5.4 });
  assert.equal(layerAnimationSpan(schema, "nadie"), null);
});

test("REQ035-P15-2: la fila de ritmo del panel de carriles emite la operacion retime", () => {
  const insp = read("src/components/video/VideoInspector.tsx");
  assert.match(insp, /data-video-retime-row/, "fila de ritmo presente");
  assert.match(insp, /Ritmo total/, "lee el span actual");
  assert.match(insp, /×2 vel/);
  assert.match(insp, /×0\.5 vel/);
  assert.match(insp, /kind: "retime", newSpanSec/, "los controles emiten retime");
  assert.match(insp, /sin alterar el destino/, "el tooltip explica el contrato");
  const overlay = read("src/components/VideoModeOverlay.tsx");
  assert.match(overlay, /retimeLayerClips\(schema, layerId, op\.newSpanSec\)/, "el overlay ejecuta la operacion");
});

// ── P1.6: reordenamiento z de capas ──

test("REQ035-P16-1: reorderedLayerZ convierte un swap de orden DOM en mapa z total", () => {
  assert.deepEqual(reorderedLayerZ(["a", "b", "c", "d"], "b", 1), { a: 0, c: 1, b: 2, d: 3 }, "subir b lo pone encima de c");
  assert.deepEqual(reorderedLayerZ(["a", "b", "c", "d"], "c", -1), { a: 0, c: 1, b: 2, d: 3 }, "bajar c lo pone debajo de b");
  assert.equal(reorderedLayerZ(["a", "b"], "a", -1), null, "no se puede bajar del fondo");
  assert.equal(reorderedLayerZ(["a", "b"], "b", 1), null, "no se puede subir del tope");
  assert.equal(reorderedLayerZ(["a", "b"], "x", 1), null, "capa desconocida");
});

test("REQ035-P16-2: layerZStyleText scopea las reglas al scope class del wrapper", () => {
  assert.equal(
    layerZStyleText("vm-scope-2", { a: 0, b: 3 }),
    '.vm-scope-2 [data-layer-id="a"]{z-index:0 !important;}.vm-scope-2 [data-layer-id="b"]{z-index:3 !important;}',
  );
  assert.equal(layerZStyleText("vm-scope-0", null), "", "sin override no hay CSS");
  assert.equal(layerZStyleText("vm-scope-0", {}), "");
});

test("REQ035-P16-3: pintado scoped + botones z en timeline y Capas + persistencia por frame", () => {
  const overlay = read("src/components/VideoModeOverlay.tsx");
  assert.match(overlay, /style\[data-video-layerz\]/, "el overlay inyecta el style tag por wrapper");
  assert.match(overlay, /layerZStyleText\(`vm-scope-\$\{i\}`/, "reglas scopeadas por frame para no filtrar entre tomas");
  assert.match(overlay, /handleLayerZReorder/, "handler de reorden presente");
  assert.match(overlay, /querySelectorAll\("\[data-layer-id\]"\)/, "el orden base sale del DOM del wrapper");
  assert.match(overlay, /onFrameLayerZChange: \(frameId: string, layerZ: Record<string, number> \| null\) => void/, "prop hacia el editor");
  const editor = read("src/pages/EditorV2.tsx");
  assert.match(editor, /handleFrameLayerZChange/, "EditorV2 persiste el override (undo + autosave)");
  assert.match(editor, /onFrameLayerZChange=\{handleFrameLayerZChange\}/);
  const frame = read("src/components/DesignFrame.tsx");
  assert.match(frame, /layerZ\?: Record<string, number>/, "FrameData carry the override via JSONB autosave");
  const tl = read("src/components/video/VideoTimeline.tsx");
  assert.match(tl, /data-z-dir="up"/);
  assert.match(tl, /data-z-dir="down"/);
  assert.match(tl, /onLayerZReorder\(fid, track\.layerId, 1\)/);
  assert.match(tl, /Traer hacia el frente/);
  assert.match(tl, /Enviar hacia el fondo/);
});

// ── P1.1: tercera superficie de seleccion (Capas) ──

test("REQ035-P11-1: la lista Capas selecciona y reordena desde el inspector", () => {
  const insp = read("src/components/video/VideoInspector.tsx");
  assert.match(insp, /data-video-layer-list/, "lista Capas presente");
  assert.match(insp, /layerList: Array<\{ id: string; kind: string \}>/, "prop desde el overlay");
  assert.match(insp, /apilar \(solo video\)/, "deja claro que no muta el diseno");
  assert.match(insp, /onSelect\(\{ kind: "layer", frameId: frame\.id, layerId: lid \}\)/, "click selecciona la capa");
  assert.match(insp, /z:\{layerZ\?\.\[l\.id\] \?\? "·"\}/, "el z se muestra como texto, nunca solo color");
  const overlay = read("src/components/VideoModeOverlay.tsx");
  assert.match(overlay, /data-layer-kind/, "el tipo de capa etiqueta la lista");
});

// ── P0.5: errores sensibles fuera de la UI ──

test("REQ035-P05-1: los toasts de error son estaticos; el detalle va solo a consola", () => {
  const overlay = read("src/components/VideoModeOverlay.tsx");
  assert.match(overlay, /const safeErrToast/, "helper P0.5 presente");
  assert.match(overlay, /console\.warn\(`\[video\] \$\{userMessage\}`, err\)/, "detalle solo en consola de desarrollador");
  assert.ok(!/addToast\(`[^`]*\$\{err/.test(overlay), "ningun toast interpola el error crudo (URLs/keys)");
  assert.match(overlay, /La exportación falló — intenta de nuevo/);
  assert.match(overlay, /No se pudo aplicar el preset — revisa los parámetros e intenta de nuevo/);
  assert.match(overlay, /La subida a URL pública falló — verifica tu conexión e intenta de nuevo/);
});

// ── P0.1: restauracion del documento de video ──

test("REQ035-P01-1: el journal sobrevive la recarga y concilia comandos obsoletos", async () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
  };
  const doc0 = emptyVideoTimelineDoc();
  const a = new VideoDocStore(doc0);
  a.syncFromTemplate("tpl-req035", doc0);
  const doc1 = { ...doc0, audioClips: [{ id: "a1" }] };
  const doc2 = { ...doc1, audioClips: [{ id: "a2" }] };
  a.apply(doc1, { label: "primer cambio" });
  a.apply(doc2, { label: "segundo cambio" });
  await new Promise(r => setTimeout(r, 420)); // flush del debounce de persistencia (300ms)
  assert.ok(mem.has("musa:videoJournal:tpl-req035"), "el journal persiste por template");
  // "recarga": store nuevo apuntando al mismo template y al doc persistido
  const b = new VideoDocStore(emptyVideoTimelineDoc());
  b.syncFromTemplate("tpl-req035", doc2);
  assert.equal(b.canUndo, true, "tras recargar se puede deshacer");
  assert.equal(b.undoLabel, "segundo cambio");
  assert.deepEqual(JSON.parse(JSON.stringify(b.getSnapshot())), doc2);
  assert.equal(b.undo(), true);
  assert.deepEqual(b.getSnapshot(), doc1);
  assert.equal(b.redo(), true);
  assert.deepEqual(b.getSnapshot(), doc2);
  // comando obsoleto (el autosave quedo atras): la conciliacion lo descarta
  const raw = JSON.parse(mem.get("musa:videoJournal:tpl-req035"));
  raw.cmds[raw.cmds.length - 1].after = "\"bogus\"";
  mem.set("musa:videoJournal:tpl-req035", JSON.stringify(raw));
  const c = new VideoDocStore(emptyVideoTimelineDoc());
  c.syncFromTemplate("tpl-req035", doc2);
  assert.equal(c.canUndo, false, "comandos cuyo after no coincide con el doc se descartan al recargar");
});

test("REQ035-P01-2: el modo video monta el store con save state persistente", () => {
  const editor = read("src/pages/EditorV2.tsx");
  assert.match(editor, /videoDocStore=\{videoDocStore\}/);
  assert.match(editor, /saveState=\{saving \? "saving" : "saved"\}/);
  assert.match(editor, /onVideoUndoFallback=\{handleUndo\}/, "el undo cae al documento de diseno cuando el journal esta vacio");
});
