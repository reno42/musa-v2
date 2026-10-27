/**
 * srtVtt — parse y serialización de subtítulos SRT/VTT (REQ-063, fase 2).
 * 100% puro: node-testable con strip-types; lo usan el import/export de la
 * pestaña Subtítulos y el arnés QA. Los tiempos SON SEGUNDOS (float) en
 * todo Musa — la conversión a µs es trabajo del llamador.
 *
 * Tolerancia: acepta , o . como separador de milisegundos en ambos formatos,
 * finales CRLF, BOM y espacios raros. El roundtrip parse→serialize conserva
 * tiempos dentro de ±1 ms (los formatos solo expresan milisegundos).
 */

export interface SubtitleCue {
  startSec: number;
  endSec: number;
  text: string;
}

function pad(n: number, size: number): string {
  return String(Math.floor(n)).padStart(size, "0");
}

/** Segundos → "HH:MM:SS,mmm" (SRT) o "HH:MM:SS.mmm" (VTT). */
export function formatSubtitleClock(sec: number, comma: boolean): string {
  const clamped = Math.max(0, sec);
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000);
  // 999 ms redondeo → carry al segundo siguiente.
  const total = ms === 1000 ? Math.floor(clamped) + 1 : Math.floor(clamped);
  const shown = ms === 1000 ? 0 : ms;
  return `${pad(total / 3600, 2)}:${pad((total % 3600) / 60, 2)}:${pad(total % 60, 2)}${comma ? "," : "."}${pad(shown, 3)}`;
}

/** "HH:MM:SS,mmm" | "MM:SS.mmm" | "H:MM:SS.mmm" → segundos. Null si no matchea. */
export function parseSubtitleClock(raw: string): number | null {
  const m = /^\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?([.,](\d{1,3}))?\s*$/.exec(raw);
  if (!m) return null;
  const h = m[3] !== undefined ? Number(m[1]) : 0;
  const min = m[3] !== undefined ? Number(m[2]) : Number(m[1]);
  const s = m[3] !== undefined ? Number(m[3]) : Number(m[2]);
  if (min > 59 || s > 59) return null;
  const ms = m[5] ? Number(m[5].padEnd(3, "0")) : 0;
  return h * 3600 + min * 60 + s + ms / 1000;
}

const SRT_BLOCK_RE = /\r?\n\r?\n/;

/** Parse SRT: bloques "índice \n start --> end \n texto". */
export function parseSrt(input: string): SubtitleCue[] {
  const clean = input.replace(/^\uFEFF/, "");
  const out: SubtitleCue[] = [];
  for (const block of clean.split(SRT_BLOCK_RE)) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) continue;
    // La línea de tiempos es la primera que contiene "-->".
    const tIdx = lines.findIndex((l) => l.includes("-->"));
    if (tIdx < 0) continue;
    const [rawStart, rawEnd] = lines[tIdx].split("-->");
    const startSec = parseSubtitleClock(rawStart || "");
    const endSec = parseSubtitleClock((rawEnd || "").trim().split(/\s+/)[0] || "");
    const text = lines.slice(tIdx + 1).join("\n").trim();
    if (startSec === null || endSec === null || !text) continue;
    out.push({ startSec, endSec: Math.max(endSec, startSec), text });
  }
  return out.sort((a, b) => a.startSec - b.startSec);
}

/** Parse WebVTT: igual que SRT + cabecera WEBVTT + notas/estilos. */
export function parseVtt(input: string): SubtitleCue[] {
  const clean = input.replace(/^\uFEFF/, "").replace(/^WEBVTT[^\n]*\n/, "");
  return parseSrt(clean);
}

/** Detecta el formato por cabecera (VTT) y parsea; SRT es el fallback. */
export function parseSubtitles(input: string): SubtitleCue[] {
  return /^\uFEFF?WEBVTT/m.test(input) ? parseVtt(input) : parseSrt(input);
}

/** Cues → SRT (índice explícito 1..n). */
export function serializeSrt(cues: SubtitleCue[]): string {
  return [...cues]
    .sort((a, b) => a.startSec - b.startSec)
    .map((c, i) => `${i + 1}\n${formatSubtitleClock(c.startSec, true)} --> ${formatSubtitleClock(c.endSec, true)}\n${c.text}`)
    .join("\n\n") + "\n";
}

/** Cues → WebVTT (con cabecera). */
export function serializeVtt(cues: SubtitleCue[]): string {
  return "WEBVTT\n\n" + [...cues]
    .sort((a, b) => a.startSec - b.startSec)
    .map((c) => `${formatSubtitleClock(c.startSec, false)} --> ${formatSubtitleClock(c.endSec, false)}\n${c.text}`)
    .join("\n\n") + "\n";
}
