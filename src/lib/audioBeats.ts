/**
 * audioBeats — client-side beat detection for the Video Mode timeline
 * (V3.8). A tiny energy-flux onset detector over the decoded PCM: no
 * dependencies, no network — good enough to snap cuts and clips to the
 * pulse of a music track. The result is a sorted list of onset times the
 * timeline joins to its snap points.
 */

export interface BeatDetectionResult {
  /** Onset times (s), sorted, rounded to ms, within [0, duration]. */
  beats: number[];
  /** Mean loudness 0..1 — a confidence hint for the UI. */
  energy: number;
}

/** Offline-decode any browser-supported audio/video container. */
export async function decodeAudioForBeats(data: ArrayBuffer): Promise<AudioBuffer> {
  const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) throw new Error("Web Audio no disponible");
  const tmp = new AC();
  try {
    return await tmp.decodeAudioData(data);
  } finally {
    void tmp.close();
  }
}

/**
 * Energy-flux onset detection: hop the mono mix in ~21ms windows, measure
 * RMS energy, and flag rises (flux = max(0, e[i] - e[i-1])) that exceed an
 * adaptive local threshold (neighborhood mean + 1.3 sigma) with a min gap.
 */
export function detectBeats(buffer: AudioBuffer, opts?: { minGapSec?: number }): BeatDetectionResult {
  const minGapSec = opts?.minGapSec ?? 0.25;
  const rate = buffer.sampleRate;
  const hop = Math.max(256, Math.round(rate * 0.021)); // ~21ms
  const n = Math.min(buffer.length, Math.ceil((buffer.duration || 0) * rate));
  if (n === 0) return { beats: [], energy: 0 };

  // Mono mix.
  const mono = new Float32Array(n);
  const chCount = buffer.numberOfChannels;
  for (let c = 0; c < chCount; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += data[i];
  }
  if (chCount > 1) for (let i = 0; i < n; i++) mono[i] /= chCount;

  // Windowed RMS energy (window = 2 hops).
  const win = hop * 2;
  const frames = Math.max(1, Math.floor(n / hop));
  const energy = new Float32Array(frames);
  let total = 0;
  for (let f = 0; f < frames; f++) {
    const start = f * hop;
    const end = Math.min(n, start + win);
    let sum = 0;
    for (let i = start; i < end; i++) sum += mono[i] * mono[i];
    const rms = Math.sqrt(sum / Math.max(1, end - start));
    energy[f] = rms;
    total += rms;
  }
  const meanEnergy = total / frames;

  // Positive energy deltas.
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) flux[f] = Math.max(0, energy[f] - energy[f - 1]);

  const beats: number[] = [];
  const minGapFrames = Math.max(1, Math.round((minGapSec * rate) / hop));
  const winRadius = 12; // ~0.25s of local context
  let lastHit = -minGapFrames;
  for (let f = 1; f < frames; f++) {
    if (f - lastHit < minGapFrames) continue;
    const x = flux[f];
    if (x <= 0) continue;
    // Local mean + sigma threshold over a sliding neighborhood.
    let sum = 0, sum2 = 0, count = 0;
    const a = Math.max(1, f - winRadius), b = Math.min(frames - 1, f + winRadius);
    for (let i = a; i <= b; i++) { sum += flux[i]; sum2 += flux[i] * flux[i]; count++; }
    const mean = sum / count;
    const std = Math.sqrt(Math.max(0, sum2 / count - mean * mean));
    if (x > mean + 1.3 * std && x > meanEnergy * 0.05) {
      beats.push(Math.round(((f * hop) / rate) * 1000) / 1000);
      lastHit = f;
    }
  }
  return { beats, energy: Math.min(1, meanEnergy * 4) };
}
