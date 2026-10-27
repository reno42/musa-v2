/**
 * fillerWords — detección de muletillas y motor de cortes (REQ-063, fase 4).
 *
 * Todo el "Descript-style" vive acá en puro: sobre los words[] de Scribe
 * (timestamps por palabra) se detectan muletillas por diccionario (es/en +
 * lista custom del usuario) y se derivan REGIONES DE CORTE que el export y
 * la preview remapean igual (paridad por construcción).
 *
 * Decisiones de diseño:
 *  - Normalización: minúsculas + sin diacríticos + sin puntuación — "Eh…",
 *    "eh," y "EH" son la misma muletilla. Los multi-word ("o sea", "you
 *    know") matchean por secuencia consecutiva de palabras.
 *  - Cada muletilla se expande con padding (50 ms por lado) y las regiones
 *    que se tocan se FUNDEN: el corte resultante es uno solo, no un
 *    metrallado de micro-cortes.
 *  - `sourceTimeAt`/`outputTimeAt` son la ÚNICA fuente de verdad del remapeo
 *    timeline con cortes ↔ medio original. El export (audio + video) y la
 *    preview llaman a la misma función: paridad garantizada.
 *
 * Honesty rules: nunca se corta dentro de una palabra conservada — si una
 * región invadiera la siguiente palabra real, se recorta al borde de esa
 * palabra (menos padding, no más).
 */

import type { ScribeWord } from "./elevenlabsMappers";
import type { SubtitleCue } from "./srtVtt";

/** Diccionario base (tokens NORMALIZADOS, sin acentos): es + en unidos. */
const FILLER_SINGLE: ReadonlySet<string> = new Set([
  // es
  "eh", "em", "mm", "mmm", "ah", "ahm", "ehm", "este", "pues", "vale",
  // en
  "uh", "um", "er", "hm", "hmm", "like", "basically", "literally", "actually",
]);

/** Muletillas de DOS palabras (matchean por secuencia consecutiva). */
const FILLER_SEQUENCES: readonly (readonly string[])[] = [
  ["o", "sea"],
  ["es", "que"],
  ["you", "know"],
  ["i", "mean"],
  ["sort", "of"],
  ["kind", "of"],
];

/** Minúsculas + sin diacríticos + sin puntuación envolvente. */
export function normalizeToken(raw: string): string {
  return String(raw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

export interface FillerDetectionOptions {
  /** Lista custom del usuario (tokens sueltos o frases de 2+ palabras). */
  customWords?: string[];
  /** Expansión por lado en segundos (default 50 ms). */
  paddingSec?: number;
  /** Cortar además las pausas de más de N segundos entre palabras. */
  trimSilencesOverSec?: number | null;
}

export interface TimeCut {
  startSec: number;
  endSec: number;
}

/** Marca por palabra para el editor visual (¿es muletilla?). */
export interface FillerMark {
  index: number;
  words: number;
}

function customSets(customWords: string[]): { single: Set<string>; seqs: string[][] } {
  const single = new Set<string>();
  const seqs: string[][] = [];
  for (const raw of customWords || []) {
    const parts = String(raw || "").trim().split(/\s+/).map(normalizeToken).filter(Boolean);
    if (parts.length === 0) continue;
    if (parts.length === 1) single.add(parts[0]);
    else seqs.push(parts);
  }
  return { single, seqs };
}

/** ¿En i empieza una muletilla? Devuelve cuántas palabras consecutivas cubre. */
function fillerSpanAt(normalized: string[], i: number, custom: { single: Set<string>; seqs: string[][] }): number {
  const w = normalized[i];
  if (!w) return 0;
  if (FILLER_SINGLE.has(w) || custom.single.has(w)) return 1;
  for (const seq of [...FILLER_SEQUENCES, ...custom.seqs]) {
    if (i + seq.length > normalized.length) continue;
    if (seq.every((part, k) => normalized[i + k] === part)) return seq.length;
  }
  return 0;
}

/**
 * Detecta muletillas → regiones de corte fundidas. `words` debe estar en
 * orden temporal (como viene de Scribe). Solo se cortan type="word".
 */
export function detectFillerCuts(words: ScribeWord[], options: FillerDetectionOptions = {}): TimeCut[] {
  const padding = Math.max(0, options.paddingSec ?? 0.05);
  const custom = customSets(options.customWords || []);
  const normalized = words.map((w) => normalizeToken(w.text));

  const regions: TimeCut[] = [];
  for (let i = 0; i < words.length;) {
    const span = fillerSpanAt(normalized, i, custom);
    if (span > 0 && words[i].kind === "word") {
      const last = words[i + span - 1];
      // Borde derecho honesto: no invadir la siguiente palabra conservada.
      const next = words[i + span];
      const maxEnd = next ? next.startSec : last.endSec;
      regions.push({
        startSec: Math.max(0, words[i].startSec - padding),
        endSec: Math.min(last.endSec + padding, Math.max(last.endSec, maxEnd)),
      });
      i += span;
      continue;
    }
    i += 1;
  }

  // Pausas largas opcionales (gap entre palabras consecutivas).
  const silenceOver = options.trimSilencesOverSec;
  if (silenceOver != null && silenceOver > 0) {
    for (let i = 0; i < words.length - 1; i++) {
      const gap = words[i + 1].startSec - words[i].endSec;
      if (gap > silenceOver) regions.push({ startSec: words[i].endSec, endSec: words[i + 1].startSec });
    }
  }

  return mergeCuts(regions);
}

/** Marca las palabras que detectFillerCuts cortaría (editor visual). */
export function markFillers(words: ScribeWord[], options: FillerDetectionOptions = {}): FillerMark[] {
  const custom = customSets(options.customWords || []);
  const normalized = words.map((w) => normalizeToken(w.text));
  const marks: FillerMark[] = [];
  for (let i = 0; i < words.length;) {
    const span = fillerSpanAt(normalized, i, custom);
    if (span > 0 && words[i].kind === "word") {
      marks.push({ index: i, words: span });
      i += span;
      continue;
    }
    i += 1;
  }
  return marks;
}

/** Fusiona regiones superpuestas/adyacentes y las ordena. */
export function mergeCuts(regions: TimeCut[]): TimeCut[] {
  const sorted = [...regions].sort((a, b) => a.startSec - b.startSec);
  const out: TimeCut[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.startSec <= last.endSec + 0.001) {
      last.endSec = Math.max(last.endSec, r.endSec);
    } else {
      out.push({ ...r });
    }
  }
  return out;
}

/** Duración total eliminada (para "ahorrás N segundos"). */
export function totalCutDuration(cuts: TimeCut[]): number {
  return cuts.reduce((acc, c) => acc + Math.max(0, c.endSec - c.startSec), 0);
}

/**
 * Remapeo salida→source: `outputSec` vive en el timeline CON cortes ya
 * aplicados; el resultado es el segundo equivalente del medio ORIGINAL.
 * Cada corte que quedó atrás del punto suma su duración (el medio original
 * avanzó `dur` extra). Los cortes NO tienen duración de salida: no existe
 * "adentro de un corte" en tiempo de salida — el borde exacto mapea al
 * punto de reanudación (jump cut exacto, sin zona muerta).
 */
export function sourceTimeAt(outputSec: number, cuts: TimeCut[]): number {
  let source = Math.max(0, outputSec);
  for (const c of cuts) {
    const dur = Math.max(0, c.endSec - c.startSec);
    if (dur === 0) continue;
    // Los cortes previos ya devolvieron `source` al eje ORIGINAL, el mismo
    // eje de c.startSec — por eso la comparación directa funciona.
    if (source >= c.startSec) source += dur;
    else break;
  }
  return source;
}

/**
 * Inverso: source (medio original) → salida (timeline con cortes).
 * Monótono no-decreciente: los puntos de SOURCE que caen ADENTRO de un corte
 * (contenido eliminado) se colapsan al instante de reanudación del corte
 * (`c.startSec - removed`), nunca producen un retroceso. `removed` acumula la
 * duración de los cortes YA superados, comparando contra el `source` original
 * (no contra el output reducido) para que la comparación sea del mismo eje.
 */
export function outputTimeAt(sourceSec: number, cuts: TimeCut[]): number {
  const t = Math.max(0, sourceSec);
  let removed = 0;
  for (const c of [...cuts].sort((a, b) => a.startSec - b.startSec)) {
    const dur = Math.max(0, c.endSec - c.startSec);
    if (t >= c.endSec) removed += dur;
    else if (t > c.startSec) return Math.max(0, c.startSec - removed); // adentro del corte
    else break;
  }
  return Math.max(0, t - removed);
}

// ── Words → cues de subtítulos (fase 3) ─────────────────────────────────────

export interface CueBuildOptions {
  maxWords?: number;
  maxChars?: number;
  maxDurSec?: number;
  /** Tail agregado al final de cada cue (legibilidad). */
  tailSec?: number;
}

const CUE_END_PUNCT = /[.!?…]$/;

/** Words con timestamp → cues de subtítulos cortados por puntuación/límites. */
export function buildCuesFromWords(words: ScribeWord[], options: CueBuildOptions = {}): SubtitleCue[] {
  const maxWords = options.maxWords ?? 7;
  const maxChars = options.maxChars ?? 42;
  const maxDurSec = options.maxDurSec ?? 3.5;
  const tail = options.tailSec ?? 0.2;
  const spoken = words.filter((w) => w.kind === "word" && normalizeToken(w.text).length > 0);
  const cues: SubtitleCue[] = [];

  let startIdx = 0;
  const pushCue = (endIdxExclusive: number) => {
    if (endIdxExclusive <= startIdx) return;
    const slice = spoken.slice(startIdx, endIdxExclusive);
    const text = slice.map((w) => w.text.trim()).join(" ").replace(/\s+([,.!?…;:])/g, "$1").trim();
    if (!text) { startIdx = endIdxExclusive; return; }
    const start = slice[0].startSec;
    const rawEnd = slice[slice.length - 1].endSec;
    const nextStart = spoken[endIdxExclusive]?.startSec;
    const end = Math.min(rawEnd + tail, nextStart != null ? Math.max(rawEnd, nextStart - 0.02) : rawEnd + tail);
    cues.push({ startSec: start, endSec: end, text });
    startIdx = endIdxExclusive;
  };

  for (let i = startIdx; i < spoken.length; i++) {
    const count = i - startIdx + 1;
    const chars = spoken.slice(startIdx, i + 1).reduce((acc, w) => acc + w.text.length + 1, 0);
    const dur = spoken[i].endSec - spoken[startIdx].startSec;
    const endsSentence = CUE_END_PUNCT.test(spoken[i].text.trim());
    const bigGap = i + 1 < spoken.length && spoken[i + 1].startSec - spoken[i].endSec > 0.8;
    if (endsSentence || count >= maxWords || chars >= maxChars || dur >= maxDurSec || (bigGap && count >= 3)) {
      pushCue(i + 1);
    }
  }
  pushCue(spoken.length);
  return cues;
}

// ── Motor de cortes: remapeo de CLIPS (fase 4) ──────────────────────────────

/**
 * Sub-intervalos VISIBLES de `[startSec, endSec)` con su lugar en el timeline
 * DE SALIDA (con cortes aplicados). Es la única pieza que necesita el export
 * para partir un clip: cada span se agenda como un clip propio (mismo medio,
 * trim avanzado, start de salida mapeado) y NADA se agenda dentro de un
 * corte — el empalme de audio/video sale por construcción. La preview logra
 * la paridad con el par sourceTimeAt/outputTimeAt sobre el playhead.
 */
export interface VisibleSpan {
  /** Segundo del MEDIO ORIGINAL donde arranca el tramo visible. */
  sourceStartSec: number;
  /** Cuánto dura el tramo visible. */
  durSec: number;
  /** Segundo del timeline DE SALIDA donde entra el tramo. */
  outputStartSec: number;
}

export function visibleSpans(startSec: number, endSec: number, cuts: TimeCut[]): VisibleSpan[] {
  const from = Math.max(0, startSec);
  const to = Math.max(from, endSec);
  const spans: VisibleSpan[] = [];
  let cursor = from;
  // `removed` arranca con lo cortado ANTES del clip: así outputStartSec es la
  // posición GLOBAL en el timeline de salida, no relativa al clip (paridad
  // con outputTimeAt: un clip que empieza después de un corte se agenda
  // corrido, no en t=0).
  let removed = cuts.reduce((acc, c) => (c.endSec <= from ? acc + Math.max(0, c.endSec - c.startSec) : acc), 0);
  for (const c of [...cuts].sort((a, b) => a.startSec - b.startSec)) {
    if (c.endSec <= cursor || c.startSec >= to) continue;
    const cutIn = Math.max(cursor, c.startSec);
    if (cutIn > cursor) {
      spans.push({ sourceStartSec: cursor, durSec: cutIn - cursor, outputStartSec: cursor - removed });
    }
    removed += Math.min(to, c.endSec) - cutIn;
    cursor = Math.max(cursor, c.endSec);
    if (cursor >= to) break;
  }
  if (cursor < to) {
    spans.push({ sourceStartSec: cursor, durSec: to - cursor, outputStartSec: cursor - removed });
  }
  // Spans de menos de ~1 frame son ruido de redondeo: fuera.
  return spans.filter((s) => s.durSec > 0.001);
}

/** Duración total de salida de un timeline que terminaba en `endSec`. */
export function outputDurationSec(endSec: number, cuts: TimeCut[]): number {
  return Math.max(0.001, endSec - totalCutDuration(cuts));
}
