// QA/req063-elevenlabs-subs.test.mjs — REQ-063 (voces ElevenLabs, subtítulos,
// muletillas). Lo PURO se testea de verdad: srtVtt (roundtrip SRT/VTT),
// fillerWords (detección, cortes, remapeo source↔output con paridad
// preview/export), cue chunking y chunkScriptForTts. Los contratos de los
// módulos con DOM/browser se afirman sobre el source (convención del repo:
// req-vid10/vid11). Corre con:
//   node --experimental-strip-types --test QA/req063-elevenlabs-subs.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  formatSubtitleClock,
  parseSrt,
  parseSubtitleClock,
  parseSubtitles,
  parseVtt,
  serializeSrt,
  serializeVtt,
} from "../shared/srtVtt.ts";
import {
  buildCuesFromWords,
  detectFillerCuts,
  markFillers,
  mergeCuts,
  normalizeToken,
  outputDurationSec,
  outputTimeAt,
  sourceTimeAt,
  totalCutDuration,
  visibleSpans,
} from "../shared/fillerWords.ts";
import {
  chunkScriptForTts,
  elevenlabsErrorPayload,
  normalizeModels,
  normalizeVoices,
} from "../shared/elevenlabsMappers.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (rel) => readFileSync(here + rel, "utf8");

// ── srtVtt ───────────────────────────────────────────────────────────────────

test("srtVtt: parse SRT con BOM, CRLF y coma decimal", () => {
  const input = "\uFEFF1\r\n00:00:01,500 --> 00:00:03,000\r\nHola mundo\r\n\r\n2\r\n00:00:03,500 --> 00:00:05,250\r\nSegunda línea\r\ncon dos filas\r\n";
  const cues = parseSrt(input);
  assert.equal(cues.length, 2);
  assert.deepEqual(cues[0], { startSec: 1.5, endSec: 3, text: "Hola mundo" });
  assert.equal(cues[1].startSec, 3.5);
  assert.equal(cues[1].text, "Segunda línea\ncon dos filas");
});

test("srtVtt: parse VTT con cabecera y punto decimal; autodetección", () => {
  const input = "WEBVTT\n\n00:00.000 --> 00:02.000\nUno\n\n00:02.500 --> 00:04.000\nDos\n";
  const cues = parseVtt(input);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].startSec, 0);
  assert.equal(cues[1].endSec, 4);
  assert.equal(parseSubtitles(input).length, 2);
  assert.equal(parseSubtitles("1\n00:00:00,000 --> 00:00:01,000\nx\n").length, 1);
});

test("srtVtt: roundtrip SRT/VTT conserva tiempos dentro de ±1 ms", () => {
  const cues = [
    { startSec: 0, endSec: 1.999, text: "a" },
    { startSec: 2.0005, endSec: 3661.25, text: "b\nc" },
  ];
  for (const serialize of [serializeSrt, serializeVtt]) {
    const back = parseSubtitles(serialize(cues));
    assert.equal(back.length, 2);
    for (let i = 0; i < cues.length; i++) {
      assert.ok(Math.abs(back[i].startSec - cues[i].startSec) <= 0.001);
      assert.ok(Math.abs(back[i].endSec - cues[i].endSec) <= 0.001);
      assert.equal(back[i].text, cues[i].text);
    }
  }
});

test("srtVtt: formatSubtitleClock carry de 999 ms y parse espejo", () => {
  assert.equal(formatSubtitleClock(1.999, true), "00:00:01,999");
  assert.equal(formatSubtitleClock(1.9999, true), "00:00:02,000");
  assert.equal(parseSubtitleClock("01:02:03,250"), 3723.25);
  assert.equal(parseSubtitleClock("02:03.5"), 123.5, "MM:SS.mmm también parsea");
  assert.equal(parseSubtitleClock("no es un reloj"), null);
});

// ── fillerWords: normalización + detección ──────────────────────────────────

const word = (text, startSec, endSec) => ({ text, startSec, endSec, kind: "word" });

test("fillerWords: normalizeToken quita diacríticos, mayúsculas y puntuación", () => {
  assert.equal(normalizeToken("Eh…"), "eh");
  assert.equal(normalizeToken("¡Estúpido!"), "estupido");
  assert.equal(normalizeToken("EH,"), "eh");
  assert.equal(normalizeToken("  "), "");
});

test("fillerWords: detectFillerCuts corta muletillas con padding y funde vecinas", () => {
  const words = [
    word("Hola", 0, 0.4),
    word("eh", 0.5, 0.6),
    word("eh", 0.65, 0.75),   // vecina: se funde en una región
    word("mundo", 0.8, 1.2),
    word("o", 1.5, 1.55),
    word("sea", 1.56, 1.7),   // secuencia de dos palabras
    word("chau", 2.0, 2.4),
  ];
  const cuts = detectFillerCuts(words, { paddingSec: 0.05 });
  assert.equal(cuts.length, 2);
  assert.deepEqual(cuts[0], { startSec: 0.45, endSec: 0.8 });
  assert.deepEqual(cuts[1], { startSec: 1.45, endSec: 1.75 });
  const marks = markFillers(words);
  assert.equal(marks.length, 3); // "eh", "eh" y "o sea"
  assert.deepEqual(marks[0], { index: 1, words: 1 });
  assert.deepEqual(marks[1], { index: 2, words: 1 });
  assert.deepEqual(marks[2], { index: 4, words: 2 });
});

test("fillerWords: lista custom y borde derecho honesto", () => {
  const words = [word("dale", 0, 0.3), word("todo", 0.32, 0.6)];
  const cuts = detectFillerCuts(words, { customWords: ["DALE!"], paddingSec: 0.05 });
  assert.equal(cuts.length, 1);
  // No invade la palabra conservada que empieza en 0.32.
  assert.equal(cuts[0].startSec, 0);
  assert.equal(cuts[0].endSec, 0.32);
});

test("fillerWords: trim de pausas largas opcional", () => {
  const words = [word("uno", 0, 0.3), word("dos", 2.0, 2.3)];
  const cuts = detectFillerCuts(words, { trimSilencesOverSec: 0.8, paddingSec: 0 });
  assert.deepEqual(cuts, [{ startSec: 0.3, endSec: 2.0 }]);
});

// ── fillerWords: motor de cortes (paridad preview/export) ───────────────────

const SAMPLE_CUTS = [
  { startSec: 1.0, endSec: 1.5 },
  { startSec: 3.0, endSec: 3.2 },
];

test("fillerWords: sourceTimeAt y outputTimeAt son inversos fuera de cortes", () => {
  for (const t of [0, 0.5, 0.999, 1.5, 2, 2.75, 3.2, 5.5]) {
    const back = sourceTimeAt(outputTimeAt(t, SAMPLE_CUTS), SAMPLE_CUTS);
    assert.ok(Math.abs(back - t) < 1e-9, `t=${t} → ${back}`);
  }
});

test("fillerWords: el output acorta exactamente lo cortado y es monótono", () => {
  const removed = totalCutDuration(SAMPLE_CUTS);
  assert.ok(Math.abs(removed - 0.7) < 1e-9, `removed=${removed}`);
  assert.ok(Math.abs(outputDurationSec(10, SAMPLE_CUTS) - 9.3) < 1e-9);
  let prev = -1;
  for (let t = 0; t <= 6; t += 0.05) {
    const out = outputTimeAt(t, SAMPLE_CUTS);
    assert.ok(out >= prev - 1e-9);
    assert.ok(out <= t + 1e-9);
    prev = out;
  }
});

test("fillerWords: sourceTimeAt cruza los cortes sin zona muerta", () => {
  // Los cortes no ocupan tiempo de salida: el reloj de playback los salta y
  // el borde de entrada mapea directo al punto de reanudación (jump cut).
  const at = (t) => sourceTimeAt(t, SAMPLE_CUTS);
  assert.ok(Math.abs(at(0.999) - 0.999) < 1e-9, "antes del corte 1 no cambia");
  assert.ok(Math.abs(at(1.0) - 1.5) < 1e-9, "borde de entrada = reanudación");
  assert.ok(Math.abs(at(1.2) - 1.7) < 1e-9, "el output \"dentro\" es contenido post-corte");
  assert.ok(Math.abs(at(1.5) - 2.0) < 1e-9, "salida del corte 1");
  assert.ok(Math.abs(at(2.5) - 3.2) < 1e-9, "borde de entrada del corte 2");
  assert.ok(Math.abs(at(2.55) - 3.25) < 1e-9);
  assert.ok(Math.abs(at(2.7) - 3.4) < 1e-9, "ya cruzó el corte 2");
});

test("fillerWords: visibleSpans parte clips y cubre exactamente lo visible", () => {
  // Clip que cruza los dos cortes.
  const spans = visibleSpans(0, 4, SAMPLE_CUTS);
  const expect = [
    { sourceStartSec: 0, durSec: 1.0, outputStartSec: 0 },
    { sourceStartSec: 1.5, durSec: 1.5, outputStartSec: 1.0 },
    { sourceStartSec: 3.2, durSec: 0.8, outputStartSec: 2.5 },
  ];
  assert.equal(spans.length, expect.length);
  for (let i = 0; i < spans.length; i++) {
    assert.ok(Math.abs(spans[i].sourceStartSec - expect[i].sourceStartSec) < 1e-9, `span ${i} sourceStartSec=${spans[i].sourceStartSec}`);
    assert.ok(Math.abs(spans[i].durSec - expect[i].durSec) < 1e-9, `span ${i} durSec=${spans[i].durSec}`);
    assert.ok(Math.abs(spans[i].outputStartSec - expect[i].outputStartSec) < 1e-9, `span ${i} outputStartSec=${spans[i].outputStartSec}`);
  }
  const visible = spans.reduce((acc, s) => acc + s.durSec, 0);
  assert.ok(Math.abs(visible - outputDurationSec(4, SAMPLE_CUTS)) < 1e-9);
  // El último outputStartSec + durSec == outputDurationSec(end).
  const last = spans[spans.length - 1];
  assert.ok(Math.abs(last.outputStartSec + last.durSec - outputDurationSec(4, SAMPLE_CUTS)) < 1e-9);
  // Clip totalmente dentro de un corte: sin spans.
  assert.deepEqual(visibleSpans(1.1, 1.4, SAMPLE_CUTS), []);
  // Clip que no toca cortes: un solo span desplazado.
  const after = visibleSpans(3.2, 4.2, SAMPLE_CUTS);
  assert.equal(after.length, 1);
  assert.equal(after[0].outputStartSec, 2.5);
});

test("fillerWords: mergeCuts funde superpuestas y ordena", () => {
  const merged = mergeCuts([
    { startSec: 5, endSec: 6 },
    { startSec: 0, endSec: 1.2 },
    { startSec: 1.1, endSec: 2 },
  ]);
  assert.deepEqual(merged, [
    { startSec: 0, endSec: 2 },
    { startSec: 5, endSec: 6 },
  ]);
});

// ── fillerWords: words → cues ────────────────────────────────────────────────

test("fillerWords: buildCuesFromWords corta por límites y no pisa el cue siguiente", () => {
  const words = [];
  for (let i = 0; i < 20; i++) {
    const s = i * 0.5;
    words.push(word(i === 9 ? "listo." : `p${i}`, s, s + 0.4));
  }
  const cues = buildCuesFromWords(words, { maxWords: 4, maxChars: 999, maxDurSec: 999, tailSec: 0.2 });
  assert.ok(cues.length >= 5);
  for (let i = 0; i < cues.length - 1; i++) {
    assert.ok(cues[i].endSec <= cues[i + 1].startSec + 1e-9, "un cue no puede empezar antes de que termine el anterior");
  }
  assert.equal(cues[0].text, "p0 p1 p2 p3");
  // Corte por puntuación: el cue que contiene "listo." termina ahí.
  const sentence = cues.find((c) => c.text.includes("listo."));
  assert.ok(sentence);
  assert.ok(!sentence.text.includes("p10"));
});

// ── elevenlabsMappers ───────────────────────────────────────────────────────

test("chunkScriptForTts: respeta el máximo y corta por oración/coma/espacio", () => {
  const text = "Primera oración corta. Segunda oración, con una coma, y sigue. Tercera! ¿Cuarta qué tal? Final.";
  const chunks = chunkScriptForTts(text, 40);
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 40, `chunk de ${chunk.length} se pasa del máximo`);
    assert.ok(chunk.trim().length > 0);
  }
  const rejoined = chunks.map((c) => c.trim()).join(" ");
  for (const piece of ["Primera", "Tercera", "Final."]) {
    assert.ok(rejoined.includes(piece), `perdió «${piece}» al trocear`);
  }
  // Un texto corto NO se trocea.
  assert.equal(chunkScriptForTts("Hola mundo", 40).length, 1);
});

test("normalizeVoices mapea el payload de ElevenLabs al DTO de Musa", () => {
  const voices = normalizeVoices({
    voices: [
      {
        voice_id: "v1",
        name: "Matías",
        labels: { accent: "argentine", gender: "male" },
        preview_url: "https://api.elevenlabs.io/previews/v1.mp3",
        category: "premade",
      },
      { voice_id: null, name: "roto" },
    ],
  });
  assert.equal(voices.length, 1);
  assert.equal(voices[0].id, "v1");
  assert.equal(voices[0].name, "Matías");
  assert.equal(voices[0].labels.accent, "argentine");
  assert.equal(voices[0].previewUrl, "https://api.elevenlabs.io/previews/v1.mp3");
});

test("normalizeModels: filtra canTts, deduplica y pone los curados primero", () => {
  const models = normalizeModels({
    models: [
      { model_id: "eleven_claude", name: "Claude", can_do_text_to_speech: true },
      { model_id: "eleven_multilingual_v2", name: "Multilingual v2", can_do_text_to_speech: true },
      { model_id: "eleven_sound_effects", name: "SFX", can_do_text_to_speech: false },
      { model_id: "eleven_flash_v2_5", name: "Flash", can_do_text_to_speech: true },
      { model_id: "eleven_multilingual_v2", name: "dup", can_do_text_to_speech: true },
      { model_id: "", can_do_text_to_speech: true },
    ],
  });
  // Solo canTts, sin vacío/duplicado: curados primero (multilingual, flash), extra al final.
  assert.deepEqual(models.map((m) => m.id), [
    "eleven_multilingual_v2",
    "eleven_flash_v2_5",
    "eleven_claude",
  ]);
  // Sin flag can_do_text_to_speech NO entra (honestidad: no se asume).
  assert.equal(normalizeModels({ models: [{ model_id: "x", name: "X" }] }).length, 0);
});

test("elevenlabsErrorPayload: códigos estables, nunca el mensaje verbatim", () => {
  assert.equal(elevenlabsErrorPayload(401, {}).error, "ELEVENLABS_KEY_INVALID");
  assert.equal(elevenlabsErrorPayload(403, { error: { status: "forbidden" } }).error, "ELEVENLABS_KEY_INVALID");
  assert.equal(elevenlabsErrorPayload(402, { detail: { status: "quota_exceeded" } }).error, "ELEVENLABS_NO_CREDITS");
  assert.equal(elevenlabsErrorPayload(422, {}).error, "ELEVENLABS_BAD_REQUEST");
  assert.equal(elevenlabsErrorPayload(429, {}).error, "ELEVENLABS_RATE_LIMITED");
  assert.equal(elevenlabsErrorPayload(404, {}).error, "ELEVENLABS_NOT_FOUND");
  const unknown = elevenlabsErrorPayload(500, { message: "detonate the key sk-abc123" });
  assert.equal(unknown.error, "ELEVENLABS_UPSTREAM");
  assert.ok(!unknown.message.includes("sk-abc123"), "el mensaje del upstream no se filtra");
});

// ── Contratos de source (módulos con browser/DOM no importables en node) ──

test("worker elevenlabs.mjs: proxy con key server-side y endpoints v1", () => {
  const src = read("../worker/runtime/functions/elevenlabs.mjs");
  assert.ok(src.includes("xi-api-key"), "el upstream necesita el header xi-api-key");
  assert.ok(src.includes("/v1/text-to-speech/"), "TTS");
  assert.ok(src.includes("/v1/speech-to-text"), "STT (Scribe)");
  assert.ok(src.includes("/v1/voices"), "voces");
  assert.ok(src.includes("/v1/models"), "modelos TTS");
  assert.ok(src.includes("/v1/user"), "validación");
  assert.ok(src.includes("isBase64Encoded"), "el binario TTS sale como base64");
});

test("elevenlabs.ts: cache de voces (TTL + en vuelo) y endpoint de modelos", () => {
  const src = read("../src/lib/elevenlabs.ts");
  assert.ok(src.includes("VOICES_TTL_MS"), "cache TTL de voces");
  assert.ok(src.includes("voicesInflight"), "dedupe de llamadas en vuelo");
  assert.ok(src.includes("force"), "opción para saltar el cache");
  assert.ok(src.includes("clearElevenlabsVoicesCache"), "invalidación explícita");
  assert.ok(src.includes("/api/elevenlabs/models"), "listElevenlabsModels usa el proxy");
});

test("videoTranscripts: WAV 16 kHz mono, chunks con solape e id determinístico", () => {
  const src = read("../src/lib/videoTranscripts.ts");
  assert.ok(src.includes("SAMPLE_RATE = 16_000"));
  assert.ok(src.includes("vidtrn_"));
  assert.ok(src.includes("upsert"));
  assert.ok(src.includes("v86"), "el error de tabla faltante nombra la migración");
});

test("SubtitlesTab: cues server-first con caption=true + SRT + muletillas", () => {
  const src = read("../src/components/video/SubtitlesTab.tsx");
  assert.ok(src.includes("caption: true"), "los cues se marcan caption en el payload");
  assert.ok(src.includes("ensureTrack("), "track de texto server-first");
  assert.ok(src.includes("parseSubtitles"), "import SRT/VTT");
  assert.ok(src.includes("serializeSrt"));
  assert.ok(src.includes("saveTranscript"), "persistencia del transcript");
  assert.ok(src.includes("buildCuesFromWords"), "subtítulos automáticos");
  assert.ok(src.includes("onActiveCutsChange"), "los cortes suben al editor");
});

test("standaloneVideoExport: los cortes remapean el plan con visibleSpans", () => {
  const src = read("../src/lib/standaloneVideoExport.ts");
  assert.ok(src.includes("cuts?: TimeCut[]"));
  assert.ok(src.includes("visibleSpans("));
  assert.ok(src.includes("CUTS_APPLIED"), "warning de fidelidad con cortes");
  assert.ok(src.includes("outputDurationSec"));
});

test("VideoProjectEditor: reloj de playback remapeado con sourceTimeAt", () => {
  const src = read("../src/pages/VideoProjectEditor.tsx");
  assert.ok(src.includes("sourceTimeAt("));
  assert.ok(src.includes("outputTimeAt("));
  assert.ok(src.includes("cuts: activeCuts"), "el export recibe los cortes");
});

test("MediaBin: tres pestañas (Materiales, Voz IA, Subtítulos)", () => {
  const src = read("../src/components/video/MediaBin.tsx");
  for (const tab of ["materiales", "voz", "subtitulos"]) {
    assert.ok(src.includes(`"${tab}"`), `falta la pestaña ${tab}`);
  }
  assert.ok(src.includes("<VoiceTab"));
  assert.ok(src.includes("<SubtitlesTab"));
});

test("TakeStudio: sección Voz IA montada con el guion del teleprompter", () => {
  const src = read("../src/components/video/TakeStudio.tsx");
  assert.ok(src.includes("<TakeStudioVoice script={script} />"));
});

test("IntegrationsCatalog: card de ElevenLabs con providerId BYOK", () => {
  const src = read("../src/components/IntegrationsCatalog.tsx");
  assert.ok(src.includes("elevenlabs"));
  assert.ok(src.includes("elevenlabs.io"), "getKeyUrl apunta al proveedor");
});

test("worker index: ruta /api/elevenlabs registrada", () => {
  const src = read("../worker/index.js");
  assert.ok(src.includes("api\\/elevenlabs"), "patrón de ruta /api/elevenlabs");
  assert.ok(src.includes("elevenlabsHandler"));
});
