// QA/req-vid14-video-effects.test.mjs — REQ-VID14 efectos como plugins.
// PRUEBA CENTRAL: el catálogo cliente (CLIENT_BUILTIN_EFFECTS) y el del
// service (BUILTIN_VIDEO_EFFECTS) jamás se separan — mismos ids, types y
// zorders. Además: helpers puros de preview (sanitizado CSS, keyframes con
// lerp) y contratos source de player/picker/ruta. Corre con:
//   node --experimental-strip-types --test QA/req-vid14-video-effects.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BUILTIN_VIDEO_EFFECTS,
  resolveEffectPayload,
} from "../api/src/services/videoProjects.ts";
import {
  CLIENT_BUILTIN_EFFECTS,
  TEXT_ANIM_MODES,
  effectPayloadOf,
  effectsForSegment,
  lutFilterCss,
  overlayStyle,
  stickerKeyframes,
  stickerPlacementStyle,
  stickerTransformAt,
  textAnimClass,
  textAnimInlineStyle,
} from "../src/lib/videoEffects.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const previewSource = read("src/components/video/VideoPreview.tsx");
const pickerSource = read("src/components/video/EffectPicker.tsx");
const binSource = read("src/components/video/MediaBin.tsx");
const editorSource = read("src/pages/VideoProjectEditor.tsx");
const apiRoutesSource = read("api/src/routes/videoProjects.ts");
const apiServiceSource = read("api/src/services/videoProjects.ts");
const cssSource = read("src/index.css");

// ── CERO DRIFT: catálogo cliente ≡ catálogo service ─────────────────────────

test("VID14 el espejo cliente y el catálogo del service son IDÉNTICOS (id/type/zorder)", () => {
  assert.ok(BUILTIN_VIDEO_EFFECTS.length >= 4);
  assert.equal(CLIENT_BUILTIN_EFFECTS.length, BUILTIN_VIDEO_EFFECTS.length);
  for (let i = 0; i < BUILTIN_VIDEO_EFFECTS.length; i++) {
    const server = BUILTIN_VIDEO_EFFECTS[i];
    const client = CLIENT_BUILTIN_EFFECTS[i];
    assert.equal(client.id, server.id, `orden/ids desincronizados en [${i}]`);
    assert.equal(client.type, server.type, `type de ${server.id} desincronizado`);
    assert.equal(client.zorder, server.zorder, `zorder de ${server.id} desincronizado`);
    // Los defaults del cliente cubren los mismos params que declara el server.
    for (const key of Object.keys(server.params)) {
      assert.ok(key in client.defaults, `default cliente falta para ${server.id}.${key}`);
    }
  }
});

test("VID14 catálogo: los 4 builtins en el ORDEN del service (z bajo = fondo al render)", () => {
  // El orden del espejo ES el orden del service (contrato de cero drift).
  assert.deepEqual(BUILTIN_VIDEO_EFFECTS.map((e) => e.id), ["fx-overlay", "fx-lut", "fx-text-anim", "fx-sticker-kf"]);
  assert.deepEqual(new Set(BUILTIN_VIDEO_EFFECTS.map((e) => e.zorder)), new Set([60, 55, 70, 65]));
});

// ── resolveEffectPayload (service, mismo que consume el MCP) ────────────────

test("VID14 builtin por id → payload {manifest, params, builtin: true}", () => {
  const payload = resolveEffectPayload("fx-lut", undefined, { css: "saturate(2)" });
  assert.deepEqual(payload.manifest, { name: "fx-lut", type: "AmazingFeature", zorder: 55 });
  assert.equal(payload.builtin, true);
  assert.deepEqual(payload.params, { css: "saturate(2)" });
});

test("VID14 manifest crudo estilo lumi {name, type, zorder?, resources?}; errores tipados", () => {
  const raw = resolveEffectPayload(undefined, { name: "vignette", type: "AmazingFeature", zorder: 80, resources: {} }, {});
  assert.equal(raw.builtin, false);
  assert.equal(raw.manifest.name, "vignette");
  assert.throws(() => resolveEffectPayload("no-existe", undefined, {}), /EFFECT_UNKNOWN/);
  assert.throws(() => resolveEffectPayload(undefined, { name: "x" }, {}), /EFFECT_MANIFEST_INVALID/);
  assert.throws(() => resolveEffectPayload(undefined, undefined, {}), /EFFECT_TARGET_INVALID/);
});

// ── Helpers puros de preview (sanitizado: nada de url() en style=) ──────────

const fxMaterial = (id, params) => ({ id, project_id: "p1", kind: "effect", payload: { manifest: { name: id, type: "draft" }, params, builtin: true }, slot: null });
const docWith = (materials, segOver = {}) => ({
  project: { id: "p1", workspace_id: "ws", name: "t", fps: 30, canvas_w: 1080, canvas_h: 1920, ratio: "9:16", duration_us: 0, is_template: false },
  tracks: [{ id: "trkV", project_id: "p1", type: "video", z_order: 0, segments: [{ id: "s1", track_id: "trkV", material_id: "m1", target_start_us: 0, target_dur_us: 2_000_000, source_start_us: 0, source_dur_us: 2_000_000, speed: 1, clip: null, extra_refs: ["fx1"], ...segOver }] }],
  materials,
});

test("VID14 effectsForSegment: companions por extra_refs, resueltos contra el dict", () => {
  const doc = docWith([fxMaterial("fx1", { css: "saturate(1.25)" })]);
  const seg = doc.tracks[0].segments[0];
  const effects = effectsForSegment(doc, seg);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].materialId, "fx1");
  assert.equal(effects[0].effect.manifest.name, "fx1");
  // ref roto o material no-efecto → no explota, solo no aparece
  assert.equal(effectsForSegment(docWith([fxMaterial("fx1", {})]), { ...seg, extra_refs: ["roto"] }).length, 0);
  assert.equal(effectPayloadOf({ ...fxMaterial("fx1", {}), kind: "video" }), null);
});

test("VID14 lutFilterCss: passthrough seguro; url()/comillas/200+ → null", () => {
  assert.equal(lutFilterCss({ css: "saturate(1.25) contrast(1.06)" }), "saturate(1.25) contrast(1.06)");
  assert.equal(lutFilterCss({ css: "url(https://evil.com/x.css)" }), null);
  assert.equal(lutFilterCss({ css: 'sepia(1); background-image: url("/x")' }), null);
  assert.equal(lutFilterCss({ css: "a".repeat(201) }), null);
  assert.equal(lutFilterCss({ css: "" }), null);
  assert.equal(lutFilterCss({}), null);
});

test("VID14 overlayStyle: color saneado + blend mode en lista blanca", () => {
  assert.deepEqual(overlayStyle({ color: "rgba(0,0,0,0.35)", blend: "multiply" }), { background: "rgba(0,0,0,0.35)", mixBlendMode: "multiply" });
  assert.equal(overlayStyle({ blend: "banana" }).mixBlendMode, "normal");
  assert.equal(overlayStyle({ color: 'url("/x")' }).background, "rgba(0,0,0,0.35)");
});

test("VID14 caption: modos exactos, clase vp-fx-anim-*, estilo clampado", () => {
  assert.deepEqual([...TEXT_ANIM_MODES], ["fade", "slide-up", "pop", "typewriter"]);
  assert.equal(textAnimClass({ anim: "slide-up" }), "vp-fx-anim-slide-up");
  assert.equal(textAnimClass({ anim: "3d-flip" }), "vp-fx-anim-fade");
  const style = textAnimInlineStyle({ style: { fontSize: 0.5, fontWeight: 5000, color: "#fff" } });
  assert.equal(style.fontSize, "28cqw"); // clamp 0.04..0.28
  assert.equal(style.fontWeight, 900);
  assert.equal(style.color, "#fff");
});

test("VID14 sticker: keyframes normalizados y lerp lineal clampeado", () => {
  const kfs = stickerKeyframes({ keyframes: [
    { tUs: 2_000_000, x: 1, scale: 2 },
    { tUs: 0, x: -1, scale: 0.5 },
  ] });
  assert.deepEqual(kfs.map((k) => k.tUs), [0, 2_000_000]); // ordenados
  const mid = stickerTransformAt(kfs, 1_000_000);
  assert.equal(mid.x, 0); // lerp(−1, 1) en el medio
  assert.equal(mid.scale, 1.25); // lerp(0.5, 2) en el medio
  assert.equal(stickerTransformAt(kfs, -5).x, -1); // clamp inferior
  assert.equal(stickerTransformAt(kfs, 99_000_000).x, 1); // clamp superior
  assert.equal(stickerKeyframes({}).length, 1); // identidad si no hay kfs
});

test("VID14 sticker placement: x/y −1..1 → % del stage, centro anclado", () => {
  assert.equal(stickerPlacementStyle({ tUs: 0, x: -1, y: 1, scale: 1, rotation: 0, alpha: 1 }).left, "0%");
  assert.equal(stickerPlacementStyle({ tUs: 0, x: 1, y: -1, scale: 1, rotation: 0, alpha: 1 }).left, "100%");
  assert.match(stickerPlacementStyle({ tUs: 0, x: 0, y: 0, scale: 2, rotation: 15, alpha: 0.5 }).transform, /rotate\(15deg\) scale\(2\)/);
  assert.equal(stickerPlacementStyle({ tUs: 0, x: 0, y: 0, scale: 1, rotation: 0, alpha: 0.5 }).opacity, 0.5);
});

// ── Contratos de player/picker/ruta (source asserts) ────────────────────────

test("VID14 player: el preview monta los 4 companions sobre el stage", () => {
  assert.match(previewSource, /effectsForSegment\(doc, seg\)/);
  assert.match(previewSource, /className="vp-fx-overlay"/);
  assert.match(previewSource, /vp-fx-caption \$\{textAnimClass\(params\)\}/);
  assert.match(previewSource, /stickerTransformAt\(stickerKeyframes\(params\), playheadUs - seg\.target_start_us\)/);
  assert.match(previewSource, /className="vp-fx-sticker vp-fx-sticker-missing"/);
  assert.match(previewSource, /className="vp-fx-badge"/);
  assert.match(previewSource, /variant === "fullscreen"/);
  assert.match(previewSource, /vp-stage-fullscreen/);
});

test("VID14 picker: POST /effects server-first y el doc vuelve absorbido (sin re-POST)", () => {
  assert.match(pickerSource, /\/effects`/);
  assert.match(pickerSource, /effectId: effect\.id/);
  assert.match(pickerSource, /onServerDocChange\(next, \{ label: `efecto \$\{effect\.id\}` \}\)/);
  assert.match(binSource, /<EffectPicker/); // sección Efectos en el bin
  // La absorción vive en el editor: apply + absorbSaved
  assert.match(editorSource, /store\.absorbSaved\(next\);/);
});

test("VID14 ruta+service: POST /:projectId/effects crea UN companion y lo linkea a extra_refs", () => {
  assert.match(apiRoutesSource, /videoProjectRoutes\.post\("\/:projectId\/effects"/);
  assert.match(apiRoutesSource, /applyVideoEffect\(projectId, \{/);
  assert.match(apiServiceSource, /export async function applyVideoEffect/);
  assert.match(apiServiceSource, /kind: "effect", payload/);
  assert.match(apiServiceSource, /extra_refs/);
  assert.match(apiServiceSource, /EFFECT_TARGET_INVALID/);
  assert.match(apiServiceSource, /EFFECT_MANIFEST_INVALID/);
});

test("VID14 CSS: overlay/caption/animaciones/sticker/badge existen para la fase 1", () => {
  assert.match(cssSource, /\.vp-fx-overlay \{ position: absolute; inset: 0;/);
  assert.match(cssSource, /\.vp-fx-caption \{/);
  assert.match(cssSource, /\.vp-fx-anim-fade \{ animation: vp-anim-fade/);
  assert.match(cssSource, /\.vp-fx-anim-typewriter \{/);
  assert.match(cssSource, /@keyframes vp-anim-slide-up/);
  assert.match(cssSource, /@keyframes vp-anim-pop/);
  assert.match(cssSource, /\.vp-fx-sticker \{/);
  assert.match(cssSource, /\.vp-fx-badge \{/);
});
