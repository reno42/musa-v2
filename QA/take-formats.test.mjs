// REQ-059 (bloque B) — Formatos reales del estudio de tomas. Run with:
// node --experimental-strip-types --test QA/take-formats.test.mjs
//
// El requisito del producto es que lo que se elige en el dropdown sea la medida
// EXACTA del archivo. Estos tests cierran la clase de bug que ya pasó: label
// diciendo 4:5 y canvas dibujado en 1350×1080 (apaisado).
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TAKE_FORMAT_ID,
  MAX_TAKE_DURATION_MS,
  TAKE_FORMATS,
  cameraConstraintsFor,
  countWords,
  estimateSpeechSeconds,
  estimateTakeBytes,
  fitRects,
  takeFormatById,
} from "../src/lib/takeRecorder.ts";
import { aspectForTakeFormat } from "../shared/heygenMappers.ts";

/** 1080×1350 → "4:5"; usa el mismo gcd que se lee en la UI. */
function reducedAspect(w, h) {
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(w, h) || 1;
  return `${w / d}:${h / d}`;
}

test("los cuatro formatos son las medidas exactas del archivo", () => {
  const byId = Object.fromEntries(TAKE_FORMATS.map(f => [f.id, f]));
  assert.deepEqual(
    {
      vertical: [byId.vertical.width, byId.vertical.height],
      square: [byId.square.width, byId.square.height],
      portrait: [byId.portrait.width, byId.portrait.height],
      horizontal: [byId.horizontal.width, byId.horizontal.height],
    },
    {
      vertical: [1080, 1920],
      square: [1080, 1080],
      portrait: [1080, 1350],
      horizontal: [1920, 1080],
    },
  );
});

test("el label del dropdown coincide con la geometría (anti-drift)", () => {
  for (const fmt of TAKE_FORMATS) {
    assert.ok(fmt.label.includes(`${fmt.width}×${fmt.height}`), `${fmt.id}: label sin medida real`);
    assert.ok(fmt.label.includes(reducedAspect(fmt.width, fmt.height)), `${fmt.id}: label sin aspect real`);
    assert.ok(fmt.width % 2 === 0 && fmt.height % 2 === 0, `${fmt.id}: dimensiones non-even para encode`);
  }
});

test("aspect_ratio de HeyGen dice lo mismo que el canvas", () => {
  for (const fmt of TAKE_FORMATS) {
    assert.equal(aspectForTakeFormat(fmt.id), reducedAspect(fmt.width, fmt.height), fmt.id);
  }
  // Desconocido cae a horizontal: nunca se manda un aspect inválido a HeyGen.
  assert.equal(aspectForTakeFormat("noexiste"), "16:9");
  assert.equal(aspectForTakeFormat(null), "16:9");
});

test("takeFormatById: id válido pasa, basura cae al default", () => {
  assert.equal(takeFormatById("portrait").height, 1350);
  assert.equal(takeFormatById("").id, DEFAULT_TAKE_FORMAT_ID);
  assert.equal(takeFormatById(undefined).id, DEFAULT_TAKE_FORMAT_ID);
  assert.equal(DEFAULT_TAKE_FORMAT_ID, "horizontal");
});

test("cameraConstraintsFor pide el tamaño del formato (muchas webcams lo ignoran y da igual)", () => {
  const fmt = takeFormatById("vertical");
  assert.deepEqual(cameraConstraintsFor(fmt), { width: { ideal: 1080 }, height: { ideal: 1920 } });
});

test("fitRects cover: llena el destino y recorta centrado (offsets <= 0)", () => {
  // Webcam landscape 1920×1080 → archivo vertical 1080×1920.
  const r = fitRects(1920, 1080, 1080, 1920, "cover");
  assert.ok(r.dw >= 1080 && r.dh >= 1920, "cover debe cubrir todo el canvas");
  assert.equal(r.dy, 0);
  assert.ok(r.dx < 0, "cover horizontal recorta por lados");
  assert.equal(r.sw, 1920);
  assert.equal(r.sh, 1080);
});

test("fitRects contain: entra entero, centrado, con una dimensión exacta", () => {
  const r = fitRects(1920, 1080, 1080, 1920, "contain");
  assert.ok(r.dw <= 1080 && r.dh <= 1920, "contain no puede desbordar");
  assert.equal(r.dw, 1080, "ancho ajustado al canvas");
  assert.equal(r.dx, 0);
  assert.ok(r.dy > 0, "bandas arriba y abajo");
  assert.equal(r.dy, Math.round((1920 - r.dh) / 2));
});

test("fitRects: mismo tamaño → identidad; dimensiones 0 no explotan", () => {
  const same = fitRects(1080, 1080, 1080, 1080, "cover");
  assert.deepEqual(same, { sx: 0, sy: 0, sw: 1080, sh: 1080, dx: 0, dy: 0, dw: 1080, dh: 1080 });
  const zero = fitRects(0, 0, 1080, 1920, "cover");
  assert.equal(zero.dw, 1080);
  assert.equal(zero.dh, 1920);
});

test("estimateTakeBytes: el peso que muestra el dropdown (video + audio 96 kbps)", () => {
  const fmt = takeFormatById("horizontal");
  // (6 Mbps / 8 + 12 000 B/s de audio) * 180 s.
  assert.equal(estimateTakeBytes(fmt, 180_000), Math.round((6_000_000 / 8 + 12_000) * 180));
  const vertical = takeFormatById("vertical");
  assert.ok(estimateTakeBytes(vertical, 180_000) > estimateTakeBytes(fmt, 180_000), "8 Mbps pesa más que 6");
  assert.equal(estimateTakeBytes(fmt, 0), 0);
});

test("techo de grabación: 3 minutos, y el peso estimado de ese techo es acotado", () => {
  assert.equal(MAX_TAKE_DURATION_MS, 180_000);
  const worst = Math.max(...TAKE_FORMATS.map(f => estimateTakeBytes(f, MAX_TAKE_DURATION_MS)));
  // El cupo vivo es de 8 GB: una toma al techo no puede pasar de ~200 MB.
  assert.ok(worst < 200 * 1024 * 1024, `toma al techo pesa ${(worst / 1024 / 1024).toFixed(0)} MB`);
});

test("countWords y estimateSpeechSeconds: el prompter avisa cuánto se tarda", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   hola\tmundo \n otra  "), 3);
  assert.equal(estimateSpeechSeconds(0), 0);
  assert.equal(estimateSpeechSeconds(-5), 0);
  // 150 palabras = 1 minuto justo.
  assert.equal(estimateSpeechSeconds(150), 60);
  assert.equal(estimateSpeechSeconds(1), 1);
});
