/**
 * REQ033 — Motion presets: the flagship "Rebotar contra bordes" (P1.7) and
 * the verifiable export result (B-02), from Propuesta_UI_motion_graphics
 * (2026-10-07).
 *
 * Contract under test:
 *  - buildWallBounce produces EXACTLY N wall contacts (the verifiable
 *    count), respecting the object size (radius + margin) inside the frame
 *    walls; a corner touch is ONE contact with both surfaces noted.
 *  - "Llegada" (center) and fade-out are separate clips and add no contacts.
 *  - Deterministic geometry: same params → byte-identical result.
 *  - The editor wires the preset panel (VideoInspector), the numbered
 *    trajectory overlay and the persistent re-downloadable export result.
 *
 * Run: node --experimental-strip-types --test QA/req033-motion-presets.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildWallBounce } from "../shared/wallBounce.ts";
import { normalizeAnimation } from "../shared/animationSchema.ts";
import { parseTransform } from "../src/lib/layerKeyframes.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");

// Flujo 1 base params (proposal §14): square post, red circle "Pelota".
const base = {
  layerId: "pelota",
  width: 1080,
  height: 1080,
  startCenter: { x: 540, y: 540 },
  origin: { x: 440, y: 500 },
  radius: 40,
  margin: 0,
  contacts: 20,
  durationSec: 4,
  dirDeg: 37,
  rhythm: "velocity",
  endMode: "center",
  arrivalSec: 0.8,
  exitMode: "fade",
  fadeSec: 0.6,
};

test("REQ033-BOUNCE-1: exactamente N contactos, ordenados y sobre el envelope del radio", () => {
  const r = buildWallBounce(base);
  assert.equal(r.contacts.length, 20, "el número de contactos es el contrato del preset");
  assert.equal(r.bounceDur, 4);
  // Cronología estricta.
  for (let i = 1; i < r.contacts.length; i++) {
    assert.ok(r.contacts[i].tSec > r.contacts[i - 1].tSec, `contacto ${i + 1} después del ${i}`);
  }
  // Cada contacto respeta bounds = [margin+r, size-margin-r] (con tolerancia de snap).
  const lo = base.margin + base.radius - 0.01;
  const hiX = base.width - base.margin - base.radius + 0.01;
  const hiY = base.height - base.margin - base.radius + 0.01;
  for (const c of r.contacts) {
    assert.ok(c.x >= lo && c.x <= hiX, `contacto ${c.index} x=${c.x} dentro de [${lo},${hiX}]`);
    assert.ok(c.y >= lo && c.y <= hiY, `contacto ${c.index} y=${c.y} dentro de [${lo},${hiY}]`);
    // El contacto TOCA una pared: al menos una coordenada en el envelope.
    const touches = (c.x <= lo + 0.02 || c.x >= hiX - 0.02 || c.y <= lo + 0.02 || c.y >= hiY - 0.02);
    assert.ok(touches, `contacto ${c.index} toca el envelope`);
    assert.ok(c.surfaces.length >= 1 && c.surfaces.length <= 2);
  }
  // El bounce clip tiene un keyframe por punto de ruta (inicio + N contactos).
  const bounce = r.clips[0];
  assert.equal(bounce.tweens[0].prop, "transform");
  assert.equal(bounce.tweens[0].easing, "linear");
  assert.equal(bounce.tweens[0].keyframes.length, 21);
  assert.equal(bounce.tweens[0].keyframes[0].t, 0);
  assert.equal(bounce.tweens[0].keyframes[20].t, 1);
});

test("REQ033-BOUNCE-2: esquina = UN contacto con dos superficies anotadas", () => {
  const r = buildWallBounce({ ...base, dirDeg: 45 });
  assert.equal(r.contacts[0].side, "corner", "45° desde el centro golpea la esquina right-bottom");
  assert.deepEqual([...r.contacts[0].surfaces].sort(), ["bottom", "right"]);
  assert.equal(r.contacts.length, 20, "la esquina cuenta UNA vez — el total no cambia");
});

test("REQ033-BOUNCE-3: radio y margen empujan el envelope (objeto grande no cruza)", () => {
  const r = buildWallBounce({ ...base, radius: 100, margin: 30 });
  for (const c of r.contacts) {
    assert.ok(c.x >= 129.99 && c.x <= 950.01, `x=${c.x} respeta margen 30 + radio 100`);
    assert.ok(c.y >= 129.99 && c.y <= 950.01, `y=${c.y} respeta margen 30 + radio 100`);
  }
});

test("REQ033-BOUNCE-4: determinismo — mismos params, resultado byte-idéntico", () => {
  const a = buildWallBounce(base);
  const b = buildWallBounce(base);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("REQ033-BOUNCE-5: ritmo intervals = tiempo igual por tramo; velocity termina en durationSec", () => {
  const iv = buildWallBounce({ ...base, rhythm: "intervals" });
  iv.contacts.forEach((c, i) => {
    assert.ok(Math.abs(c.tSec - (4 * (i + 1)) / 20) < 0.011, `contacto ${c.index} en el tramo i+1 de 20`);
  });
  const vel = buildWallBounce({ ...base, rhythm: "velocity" });
  assert.ok(Math.abs(vel.contacts[19].tSec - 4) < 0.01, "el último contacto cae al final del rebote");
});

test("REQ033-BOUNCE-6: Llegada al centro en clip aparte ease-out, sin sumar contactos", () => {
  const r = buildWallBounce(base);
  assert.equal(r.clips.length, 3, "bounce + llegada + fade");
  const arrival = r.clips[1];
  assert.equal(arrival.startSec, r.bounceDur);
  assert.equal(arrival.tweens[0].easing, "ease-out");
  assert.equal(arrival.tweens[0].keyframes.length, 2);
  const end = parseTransform(arrival.tweens[0].keyframes[1].value);
  assert.ok(Math.abs(end.x + base.origin.x - 540) < 0.01, "arrival termina en el centro X del frame");
  assert.ok(Math.abs(end.y + base.origin.y - 540) < 0.01, "arrival termina en el centro Y del frame");
  assert.equal(r.contacts.length, 20, "la llegada NUNCA añade contactos");
  // Continuidad: la llegada arranca donde el rebote terminó.
  const bounceEnd = parseTransform(r.clips[0].tweens[0].keyframes[r.clips[0].tweens[0].keyframes.length - 1].value);
  const arrivalStart = parseTransform(arrival.tweens[0].keyframes[0].value);
  assert.equal(bounceEnd.x, arrivalStart.x);
  assert.equal(bounceEnd.y, arrivalStart.y);
});

test("REQ033-BOUNCE-7: fade out final en clip de opacidad 1→0", () => {
  const r = buildWallBounce({ ...base, endMode: "stay", exitMode: "fade" });
  const fade = r.clips[1];
  assert.equal(fade.tweens[0].prop, "opacity");
  assert.deepEqual(fade.tweens[0].keyframes.map(k => k.value), ["1", "0"]);
  assert.equal(fade.startSec, r.bounceDur);
  assert.ok(Math.abs(r.totalDurationSec - (r.bounceDur + 0.6)) < 1e-9);
  const full = buildWallBounce(base);
  assert.ok(Math.abs(full.totalDurationSec - (4 + 0.8 + 0.6)) < 1e-9);
});

test("REQ033-BOUNCE-8: los clips sobreviven normalizeAnimation (una tween por prop por clip)", () => {
  const r = buildWallBounce(base);
  const schema = normalizeAnimation({
    timeline: { durationSec: Math.max(5, r.totalDurationSec), fps: 30, width: 1080, height: 1080, loop: "once" },
    clips: r.clips,
    transitions: [],
  });
  assert.ok(schema);
  assert.equal(schema.clips.length, 3);
  for (const clip of schema.clips) {
    const props = clip.tweens.map(t => String(t.prop));
    assert.equal(new Set(props).size, props.length, "sin props duplicadas dentro del clip");
  }
  const kept = schema.clips.map(c => c.tweens.map(t => t.easing).join("/")).join("|");
  assert.match(kept, /linear\|ease-out\|ease-in/);
});

test("REQ033-BOUNCE-9: objeto que no cabe → error accionable, no path roto", () => {
  assert.throws(() => buildWallBounce({ ...base, radius: 600 }), /no cabe en 1080×1080/);
});

test("REQ033-UI-1: el inspector expone el preset parametrizado y su lectura verificable", () => {
  const src = read("src/components/video/VideoInspector.tsx");
  assert.match(src, /Rebotar contra bordes/);
  assert.match(src, /recorrido: \{dry\.r\.contacts\.length\} contacto/);
  assert.match(src, /numerado/);
  assert.match(src, /onApplyWallBounce: \(frameId: string, layerId: string, params: WallBounceUiParams\) => void/);
  assert.match(src, /buildWallBounce/);
  assert.match(src, /endMode|Al terminar/);
});

test("REQ033-UI-2: export verificado — resultado persistente con Descargar (B-02)", () => {
  const insp = read("src/components/video/VideoInspector.tsx");
  assert.match(insp, /lastExport: \{ filename: string; size: number; durationSec: number; method: string \} \| null/);
  assert.match(insp, /lastExport && !exporting/, "Listo solo cuando existe el archivo y no hay render en curso");
  assert.match(insp, /onDownloadLast/);
  assert.match(insp, /Descargar/);
  const overlay = read("src/components/VideoModeOverlay.tsx");
  assert.match(overlay, /setLastExport\(\{ blob: result\.blob/);
  assert.match(overlay, /downloadVideoBlob\(cur\.blob, cur\.filename\)/);
});

test("REQ033-UI-3: trayectoria numerada en el escenario (canvas, nunca en el export)", () => {
  const overlay = read("src/components/VideoModeOverlay.tsx");
  assert.match(overlay, /data-video-trajectory/, "overlay SVG de trayectoria");
  assert.match(overlay, /buildWallBounce/);
  assert.match(overlay, /setLayerBox/);
  assert.match(overlay, /setShowTraj/, "toggle de visibilidad de la trayectoria");
  assert.match(overlay, /playing \|\| !selection/, "solo en pausa y con selección");
});
