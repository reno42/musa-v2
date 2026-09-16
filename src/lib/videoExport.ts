/**
 * videoExport — F1 client-side video export (spec §5): the browser IS the
 * render engine. Each frame of the timeline is rasterized through the same
 * foreignObject pipeline used by static frame capture (WYSIWYG by
 * construction), with the animation applied by the SAME sampler the preview
 * engine uses (shared/animationSchema.ts) — so the video reproduces the
 * preview exactly, with zero server invocations and zero LLM tokens.
 *
 * Two encoders, best available wins:
 *  • WebCodecs + webmMuxer (frame-perfect): offline encode with exact
 *    microsecond timestamps — no wall-clock drift, export faster than
 *    realtime on capable machines.
 *  • MediaRecorder fallback (realtime pacing): universal support, incl. MP4
 *    on browsers whose recorder can't produce WebM.
 */

import { cssPropertyOf, sampleAnimationAt, type AnimationSchema } from "../../shared/animationSchema.ts";
import { rasterizeFrame, type FrameSource } from "./frameCapture";
import { WebMMuxer, type WebMuxAudioChunk, type WebMuxerAudioOptions } from "./webmMuxer";
import { buildReelTimeline, sampleReelAt, type ReelFrameInput, type ReelTimeline } from "./sequencePlayback";
import { drawCaption } from "../components/video/captions";
import type { ReelTextClip } from "./videoTimelineDoc";

/** Encoded Opus track, ready for the muxer (REQ-VID5). */
export interface ReelAudioTrackData { chunks: WebMuxAudioChunk[]; sampleRate: number; channels: number; codecPrivate?: Uint8Array }
/** Lazy audio encoder — invoked only on the WebCodecs path. */
export type ReelAudioProvider = (durationSec: number) => Promise<ReelAudioTrackData | null>;
/** User-supplied music: raw bytes of any browser-decodable audio file. */
export interface ReelAudioInput { data: ArrayBuffer }
/** One placed clip on the reel's audio track (Video Mode v2 timeline). */
export interface ReelAudioClipInput extends ReelAudioInput {
  startSec: number;
  durationSec: number;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
  /** Skip the first N seconds of the decoded source (video trim-in). */
  offsetSec?: number;
  /** Loop a short source to fill durationSec (default true). Video-clip
   *  audio passes false so trimmed windows stay aligned. */
  loopWhenShort?: boolean;
}

/** One real video/image clip composited ON TOP of the take track (V3.4). */
export interface ReelExportMediaClip {
  kind: "video" | "image";
  url: string;
  startSec: number;
  durationSec: number;
  trimInSec: number;
  sourceDurationSec: number;
  volume: number;
  filter: string;
}

export interface VideoExportOptions {
  frame: FrameSource & { animation?: AnimationSchema | null; filter?: string };
  /** Pixel scale (1 = frame's own resolution). Default 1. */
  scale?: number;
  onProgress?: (fraction: number) => void;
}

export interface VideoExportResult {
  blob: Blob;
  mimeType: string;
  frameCount: number;
  durationSec: number;
  method: "webcodecs" | "mediarecorder";
}

/** Loop/pingpong resolution — identical math to the preview engine's
 *  resolveTime (src/lib/animationEngine.ts); keep the two in sync. */
function resolveTimelineTime(schema: AnimationSchema, tSec: number): number {
  const dur = schema.timeline.durationSec;
  if (schema.timeline.loop === "once") return Math.min(tSec, dur);
  if (schema.timeline.loop === "loop") return tSec % dur;
  const cycle = tSec % (dur * 2); // pingpong: forward-backward triangle
  return cycle <= dur ? cycle : dur * 2 - cycle;
}

/** Rasterize the frame at a timeline position: parse the authored html,
 *  apply the sampled animation values as inline styles, paint via the
 *  foreignObject pipeline. The authored html/css are never mutated. */
async function rasterizeFrameAt(
  frame: VideoExportOptions["frame"],
  scratch: HTMLElement,
  tSec: number,
  scale: number,
): Promise<HTMLCanvasElement> {
  const animation = frame.animation || null;
  const samples = animation ? sampleAnimationAt(animation, resolveTimelineTime(animation, tSec)) : null;
  scratch.innerHTML = frame.html;
  if (samples) {
    for (const [layerId, props] of samples) {
      const el = scratch.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(layerId)}"]`);
      if (!el) continue; // layer deleted since the clip was authored
      for (const [prop, value] of Object.entries(props)) {
        el.style.setProperty(cssPropertyOf(prop), value);
      }
    }
  }
  return rasterizeFrame(
    { html: scratch.innerHTML, css: frame.filter ? `${frame.css}\nbody{filter:${frame.filter};}` : frame.css, width: frame.width, height: frame.height, background: frame.background },
    scale,
  );
}

function bitrateFor(width: number, height: number, fps: number): number {
  // ~0.15 bits per pixel per frame, clamped to a sane 2–20 Mbps band.
  return Math.round(Math.min(20_000_000, Math.max(2_000_000, width * height * fps * 0.15)));
}

// ── WebCodecs path (frame-perfect) ──

interface EncodedChunk { timestampUs: number; keyframe: boolean; data: Uint8Array }

async function exportWithWebCodecs(
  canvas: HTMLCanvasElement,
  drawAt: (tSec: number) => Promise<void>,
  totalFrames: number,
  fps: number,
  exportDuration: number,
  onProgress?: (f: number) => void,
  audio?: ReelAudioProvider,
): Promise<VideoExportResult | null> {
  const EncoderCtor = (globalThis as unknown as { VideoEncoder?: new (init: { output: (chunk: { timestamp: number; type: string; byteLength: number; copyTo: (dst: Uint8Array) => void }) => void; error: (e: unknown) => void }) => { configure: (cfg: Record<string, unknown>) => void; encode: (frame: unknown, opts?: { keyFrame?: boolean }) => void; flush: () => Promise<void>; close: () => void; encodeQueueSize: number } }).VideoEncoder;
  const FrameCtor = (globalThis as unknown as { VideoFrame?: new (source: HTMLCanvasElement, init: { timestamp: number; duration: number }) => { close: () => void } }).VideoFrame;
  if (!EncoderCtor || !FrameCtor) return null;

  // VP9 first (better quality/bitrate), plain "vp8" as the safe fallback.
  const codecCandidates: Array<{ codec: string; codecId: "V_VP9" | "V_VP8" }> = [
    { codec: "vp09.00.10.08", codecId: "V_VP9" },
    { codec: "vp8", codecId: "V_VP8" },
  ];
  let chosen: { codec: string; codecId: "V_VP9" | "V_VP8" } | null = null;
  for (const cand of codecCandidates) {
    try {
      const support = await (EncoderCtor as unknown as { isConfigSupported: (cfg: Record<string, unknown>) => Promise<{ supported?: boolean }> }).isConfigSupported({
        codec: cand.codec, width: canvas.width, height: canvas.height, bitrate: bitrateFor(canvas.width, canvas.height, fps), framerate: fps,
      });
      if (support.supported) { chosen = cand; break; }
    } catch { /* try next */ }
  }
  if (!chosen) return null;

  const chunks: EncodedChunk[] = [];
  let encodeError: unknown = null;
  const encoder = new EncoderCtor({
    output(chunk) {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ timestampUs: chunk.timestamp, keyframe: chunk.type === "key", data });
    },
    error(e) { encodeError = e; },
  });
  encoder.configure({
    codec: chosen.codec,
    width: canvas.width,
    height: canvas.height,
    bitrate: bitrateFor(canvas.width, canvas.height, fps),
    framerate: fps,
  });

  const frameDurUs = 1_000_000 / fps;
  for (let i = 0; i < totalFrames; i++) {
    if (encodeError) break;
    await drawAt(i / fps);
    const videoFrame = new FrameCtor(canvas, { timestamp: Math.round(i * frameDurUs), duration: Math.round(frameDurUs) });
    encoder.encode(videoFrame, { keyFrame: i % Math.max(1, Math.round(fps)) === 0 }); // keyframe ~every 1s
    videoFrame.close();
    onProgress?.(0.9 * (i + 1) / totalFrames);
    // Light backpressure so rasterization and encoding overlap without
    // buffering the whole video in encoder queues.
    if (encoder.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 8));
  }
  await encoder.flush();
  encoder.close();
  if (encodeError) throw encodeError instanceof Error ? encodeError : new Error("VideoEncoder failed");
  if (chunks.length === 0) return null;

  // REQ-VID5: optional Opus track — encoded after video so a codecPrivate
  // (OpusHead) from the encoder's first-chunk metadata can reach the muxer.
  let audioCfg: WebMuxerAudioOptions | undefined;
  let audioPackets: WebMuxAudioChunk[] = [];
  if (audio) {
    try {
      const track = await audio(exportDuration);
      if (track && track.chunks.length > 0) {
        audioCfg = { sampleRate: track.sampleRate, channels: track.channels, codecPrivate: track.codecPrivate };
        audioPackets = track.chunks;
      }
    } catch { /* audio is best-effort — video must still export */ }
  }

  onProgress?.(0.95);
  const muxer = new WebMMuxer({ width: canvas.width, height: canvas.height, codec: chosen.codecId, durationSec: exportDuration, ...(audioCfg ? { audio: audioCfg } : {}) });
  for (const chunk of chunks) muxer.addFrame(chunk);
  for (const packet of audioPackets) muxer.addAudioChunk(packet);
  const blob = muxer.finish();
  onProgress?.(1);
  return { blob, mimeType: "video/webm", frameCount: chunks.length, durationSec: exportDuration, method: "webcodecs" };
}

// ── MediaRecorder path (universal fallback) ──

async function exportWithMediaRecorder(
  canvas: HTMLCanvasElement,
  drawAt: (tSec: number) => Promise<void>,
  totalFrames: number,
  fps: number,
  exportDuration: number,
  onProgress?: (f: number) => void,
  /** V3.7: "mp4" tries the avc1 candidates first (Chrome/Safari mux MP4).
   *  "webm" keeps the classic order. */
  format: "webm" | "mp4" = "webm",
  /** V3.7: pre-mixed audio played in realtime into the recording — this is
   *  how MP4 (and the webm fallback) get sound. */
  mixedAudio?: AudioBuffer | null,
): Promise<VideoExportResult> {
  const mimeCandidates = format === "mp4"
    ? ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm"]
    : ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4;codecs=avc1.42E01E", "video/mp4"];
  const mimeType = mimeCandidates.find(m => MediaRecorder.isTypeSupported(m)) || "";

  const stream = canvas.captureStream(0); // frames only on requestFrame()
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  // Realtime audio: the pre-mixed buffer plays alongside the frame loop —
  // MediaRecorder muxes whatever tracks the stream carries.
  let audioSrc: AudioBufferSourceNode | null = null;
  let audioAC: AudioContext | null = null;
  if (mixedAudio) {
    try {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        audioAC = new AC();
        const dest = audioAC.createMediaStreamDestination();
        audioSrc = audioAC.createBufferSource();
        audioSrc.buffer = mixedAudio;
        audioSrc.connect(dest);
        for (const t of dest.stream.getAudioTracks()) stream.addTrack(t);
      }
    } catch { audioSrc = null; audioAC = null; }
  }
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: bitrateFor(canvas.width, canvas.height, fps),
  });
  const parts: Blob[] = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) parts.push(e.data); };
  const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
  recorder.start();
  if (audioSrc) { try { audioSrc.start(); } catch { /* audio was best-effort */ } }

  // Realtime pacing: MediaRecorder timestamps frames by wall clock, so each
  // frame is drawn just before its moment, then explicitly requested.
  const frameMs = 1000 / fps;
  const startWall = performance.now();
  for (let i = 0; i < totalFrames; i++) {
    const wait = startWall + i * frameMs - performance.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    await drawAt(i / fps);
    track.requestFrame();
    onProgress?.(0.9 * (i + 1) / totalFrames);
  }
  // Tail so the final requested frame reaches the encoder before stop.
  await new Promise(r => setTimeout(r, Math.max(150, frameMs * 2)));
  if (audioSrc) { try { audioSrc.stop(); } catch { /* already ended */ } }
  recorder.stop();
  await stopped;
  if (audioAC) { try { void audioAC.close(); } catch { /* cosmetic */ } }

  onProgress?.(1);
  return {
    blob: new Blob(parts, { type: mimeType || "video/webm" }),
    mimeType: mimeType || "video/webm",
    frameCount: totalFrames,
    durationSec: exportDuration,
    method: "mediarecorder",
  };
}

// ── Public entry ──

/**
 * Export one frame's animation timeline to a video blob, entirely in the
 * browser. Export length follows the loop mode: "once" → durationSec,
 * "pingpong" → 2×durationSec, "loop" → one full cycle (looping is the
 * player's job, not the file's).
 */
export async function exportFrameVideo(opts: VideoExportOptions): Promise<VideoExportResult> {
  const scale = opts.scale ?? 1;
  const animation = opts.frame.animation || null;
  const fps = animation?.timeline.fps ?? 30;
  const duration = animation?.timeline.durationSec ?? 5;
  const exportDuration = animation?.timeline.loop === "pingpong" ? duration * 2 : duration;
  const totalFrames = Math.max(1, Math.round(exportDuration * fps));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(opts.frame.width * scale);
  canvas.height = Math.round(opts.frame.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  const scratch = document.createElement("div");
  const drawAt = async (tSec: number) => {
    const raster = await rasterizeFrameAt(opts.frame, scratch, tSec, scale);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(raster, 0, 0, canvas.width, canvas.height);
  };

  // Prime caches (fonts/images) with frame 0 before choosing a path, so the
  // MediaRecorder realtime pacing doesn't eat first-frame hiccups.
  await drawAt(0);

  try {
    const result = await exportWithWebCodecs(canvas, drawAt, totalFrames, fps, exportDuration, opts.onProgress);
    if (result) return result;
  } catch {
    // A WebCodecs failure (codec denied, OOM, …) must not kill the export —
    // fall through to MediaRecorder.
  }
  return exportWithMediaRecorder(canvas, drawAt, totalFrames, fps, exportDuration, opts.onProgress);
}

// ── Multi-frame reel export (REQ-VID2) ──

export interface ReelExportOptions {
  /** Ordered frames that participate in the reel (order = take order).
   *  Homogeneous width/height is validated here. Optional per-take CSS
   *  filter (V3.2 reel look). */
  frames: Array<ReelFrameInput & FrameSource & { filter?: string }>;
  scale?: number;
  fps?: number;
  onProgress?: (fraction: number) => void;
  /** Placed music clips (Video Mode v2 audio track) — muxed only on the
   *  WebCodecs path. Each clip loops its source for its own duration. */
  audioTracks?: ReelAudioClipInput[];
  /** V3.4: real video/image clips composited ON TOP of the takes. */
  mediaClips?: ReelExportMediaClip[];
  /** V3.5: caption/sticker text windows drawn over everything. */
  texts?: ReelTextClip[];
  /** V3.7: container preference. "mp4" goes straight to the MediaRecorder
   *  path with avc1 candidates + realtime audio. */
  format?: "webm" | "mp4";
}

export interface ReelExportResult {
  blob: Blob;
  mimeType: string;
  frameCount: number;
  durationSec: number;
  method: "webcodecs" | "mediarecorder";
  takeCount: number;
  withAudio: boolean;
}

/** Decode raw bytes into an AudioBuffer via a throwaway AudioContext. */
async function decodeAudioBytes(data: ArrayBuffer): Promise<AudioBuffer> {
  const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) throw new Error("Web Audio unavailable");
  const tmp = new AC();
  try {
    return await tmp.decodeAudioData(data);
  } finally {
    void tmp.close();
  }
}

/** Mix every placed clip into ONE offline render at the reel's length.
 *  Each clip loops its source for its own duration, sits at its own offset,
 *  and gets volume + fade in/out envelopes (the “muere en fade” reels
 *  expect). */
export async function mixReelAudioTracks(tracks: ReelAudioClipInput[], durationSec: number): Promise<AudioBuffer | null> {
  if (tracks.length === 0) return null;
  const sampleRate = 48000;
  const channels = 2;
  const totalSamples = Math.max(1, Math.ceil(durationSec * sampleRate));
  const offline = new OfflineAudioContext(channels, totalSamples, sampleRate);
  for (const clip of tracks) {
    let decoded: AudioBuffer;
    try {
      decoded = await decodeAudioBytes(clip.data);
    } catch {
      continue; // one undecodable clip must not kill the export
    }
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.loop = (clip.loopWhenShort ?? true) && decoded.duration < clip.durationSec - 0.05;
    const gain = offline.createGain();
    const t0 = Math.max(0, Math.min(clip.startSec, durationSec - 0.05));
    const tEnd = Math.min(durationSec, t0 + Math.max(0.05, clip.durationSec));
    const len = Math.max(0.05, tEnd - t0);
    const v = Math.max(0, Math.min(1.5, clip.volume));
    const fi = Math.min(Math.max(0, clip.fadeInSec), len / 4);
    const fo = Math.min(Math.max(0, clip.fadeOutSec), len / 4);
    gain.gain.setValueAtTime(fi > 0 ? 0.0001 : v, t0);
    if (fi > 0) gain.gain.linearRampToValueAtTime(v, t0 + fi);
    if (fo > 0 && len > fi + fo) {
      gain.gain.setValueAtTime(v, tEnd - fo);
      gain.gain.linearRampToValueAtTime(0.0001, tEnd);
    }
    src.connect(gain).connect(offline.destination);
    const off = Math.max(0, Math.min(clip.offsetSec ?? 0, Math.max(0, decoded.duration - 0.05)));
    src.start(t0, off);
    src.stop(tEnd + 0.01);
  }
  return offline.startRendering();
}

/** Encode a rendered AudioBuffer to Opus chunks for the WebM muxer. */
async function encodeRenderedAudioBuffer(rendered: AudioBuffer): Promise<ReelAudioTrackData | null> {
  const AudioEncoderCtor = (globalThis as unknown as { AudioEncoder?: typeof AudioEncoder }).AudioEncoder;
  const AudioDataCtor = (globalThis as unknown as { AudioData?: typeof AudioData }).AudioData;
  if (!AudioEncoderCtor || !AudioDataCtor) return null;

  const sampleRate = rendered.sampleRate;
  const channels = Math.min(2, Math.max(1, rendered.numberOfChannels));
  const totalSamples = rendered.length;

  const support = await AudioEncoderCtor.isConfigSupported({ codec: "opus", sampleRate, numberOfChannels: channels, bitrate: 128_000 });
  if (!support.supported) return null;

  const chunks: WebMuxAudioChunk[] = [];
  let codecPrivate: Uint8Array | undefined;
  let encodeError: unknown = null;
  const encoder = new AudioEncoderCtor({
    output(chunk, meta) {
      const desc = (meta as { decoderConfig?: { description?: ArrayBuffer | Uint8Array } } | undefined)?.decoderConfig?.description;
      if (desc && !codecPrivate) codecPrivate = desc instanceof Uint8Array ? desc : new Uint8Array(desc);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({ timestampUs: chunk.timestamp, data });
    },
    error(e) { encodeError = e; },
  });
  encoder.configure({ codec: "opus", sampleRate, numberOfChannels: channels, bitrate: 128_000 });

  // Feed the rendered PCM in ~20ms planar slices.
  const slice = Math.floor(sampleRate * 0.02);
  const channelData = Array.from({ length: channels }, (_, c) => rendered.getChannelData(c));
  for (let off = 0; off < totalSamples; off += slice) {
    if (encodeError) break;
    const n = Math.min(slice, totalSamples - off);
    const planar = new Float32Array(n * channels);
    for (let c = 0; c < channels; c++) planar.set(channelData[c].subarray(off, off + n), c * n);
    const ad = new AudioDataCtor({
      format: "f32-planar", sampleRate, numberOfFrames: n, numberOfChannels: channels,
      timestamp: Math.round((off / sampleRate) * 1_000_000), data: planar,
    });
    encoder.encode(ad);
    ad.close();
    if (encoder.encodeQueueSize > 8) await new Promise(r => setTimeout(r, 4));
  }
  await encoder.flush();
  encoder.close();
  if (encodeError) throw encodeError instanceof Error ? encodeError : new Error("AudioEncoder failed");
  if (chunks.length === 0) return null;
  return { chunks, sampleRate, channels, codecPrivate };
}

/** Legacy single-track entry (starts at 0, auto fades) — kept for tests. */
export async function encodeReelAudioTrack(input: ReelAudioInput, durationSec: number): Promise<ReelAudioTrackData | null> {
  const rendered = await mixReelAudioTracks(
    [{ ...input, startSec: 0, durationSec, volume: 1, fadeInSec: 0.05, fadeOutSec: 1.2 }],
    durationSec,
  );
  if (!rendered) return null;
  return encodeRenderedAudioBuffer(rendered);
}

export async function encodeReelAudioTracks(tracks: ReelAudioClipInput[], durationSec: number): Promise<ReelAudioTrackData | null> {
  const rendered = await mixReelAudioTracks(tracks, durationSec);
  if (!rendered) return null;
  return encodeRenderedAudioBuffer(rendered);
}

function makeReelAudioProvider(tracks: ReelAudioClipInput[]): ReelAudioProvider {
  return async (durationSec) => encodeReelAudioTracks(tracks, durationSec);
}

// ── V3.4 media-clip compositing helpers ──

type MediaPoolEntry = { kind: "video" | "image"; el: HTMLVideoElement | HTMLImageElement };

/** Load one pooled media element. crossOrigin="anonymous" is mandatory: the
 *  export canvas must stay untainted for WebCodecs VideoFrame extraction. */
async function loadMediaEl(kind: "video" | "image", url: string): Promise<MediaPoolEntry> {
  if (kind === "image") {
    const img = document.createElement("img");
    img.crossOrigin = "anonymous";
    await new Promise<void>((res) => {
      const fin = () => res();
      img.onload = fin;
      img.onerror = fin;
      setTimeout(fin, 6000);
      img.src = url;
    });
    return { kind, el: img };
  }
  const v = document.createElement("video");
  v.crossOrigin = "anonymous";
  v.preload = "auto";
  v.muted = true;
  await new Promise<void>((res) => {
    const fin = () => res();
    v.addEventListener("loadeddata", fin, { once: true });
    v.addEventListener("error", fin, { once: true });
    setTimeout(fin, 6000);
    v.src = url;
  });
  return { kind, el: v };
}

/** Seek a pooled video and wait (bounded) until the frame is presentable. */
async function seekMedia(v: HTMLVideoElement, target: number): Promise<void> {
  if (v.readyState < 1) return;
  const dur = v.duration;
  const t = dur > 0 && Number.isFinite(dur) ? Math.min(Math.max(0, target), dur - 0.05) : Math.max(0, target);
  if (Math.abs(v.currentTime - t) < 0.01 && v.readyState >= 2) return;
  await new Promise<void>((res) => {
    let done = false;
    const fin = () => { if (!done) { done = true; res(); } };
    v.addEventListener("seeked", fin, { once: true });
    v.addEventListener("error", fin, { once: true });
    setTimeout(fin, 400);
    try { v.currentTime = t; } catch { fin(); }
  });
}

/** drawImage with object-fit:contain letterbox math — mirrors the preview. */
function drawContain(ctx: CanvasRenderingContext2D, media: HTMLVideoElement | HTMLImageElement, w: number, h: number) {
  const mw = media instanceof HTMLVideoElement ? (media.videoWidth || 0) : (media.naturalWidth || 0);
  const mh = media instanceof HTMLVideoElement ? (media.videoHeight || 0) : (media.naturalHeight || 0);
  if (!mw || !mh) return;
  const s = Math.min(w / mw, h / mh);
  const dw = mw * s, dh = mh * s;
  ctx.drawImage(media, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/**
 * Export the multi-frame reel to ONE video file (REQ-VID2). Walks the
 * sequence timeline (takes + transitions from sequencePlayback) and encodes
 * with a single continuous clock — one encode, no concatenation. Transitions
 * composite the two takes' rasters per output frame (fade/slide/zoom/wipe).
 */
export async function exportReelVideo(opts: ReelExportOptions): Promise<ReelExportResult> {
  if (opts.frames.length === 0) throw new Error("Sin tomas en el reel");
  const scale = opts.scale ?? 1;
  const frames = opts.frames;
  const W = frames[0].width, H = frames[0].height;
  const mixed = frames.some(f => f.width !== W || f.height !== H);
  if (mixed) throw new Error("Las tomas tienen tamaños distintos — iguala el aspect ratio antes de exportar");

  const tl: ReelTimeline = buildReelTimeline(frames, opts.fps);
  const fps = tl.fps;
  const totalFrames = Math.max(1, Math.round(tl.totalDurationSec * fps));

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  const scratch = document.createElement("div");
  // Both transition poses are CONSTANT during a slot — rasterize once per slot.
  const slotRasters = new Map<number, { from: HTMLCanvasElement; to: HTMLCanvasElement }>();

  // ── V3.4: pooled media elements (load once, seek per frame) ──
  const mediaClips = opts.mediaClips ?? [];
  const textClips = opts.texts ?? [];
  const pool = new Map<string, MediaPoolEntry>();
  await Promise.all(mediaClips.map(async mc => {
    const key = `${mc.kind}:${mc.url}`;
    if (pool.has(key)) return;
    try {
      pool.set(key, await loadMediaEl(mc.kind, mc.url));
    } catch { /* a dead URL skips that clip — the reel still exports */ }
  }));

  const smooth = (p: number) => p * p * (3 - 2 * p);

  const drawTransition = async (slotIndex: number, type: string, pRaw: number) => {
    const slot = tl.slots[slotIndex];
    let r = slotRasters.get(slotIndex);
    if (!r) {
      r = {
        from: await rasterizeFrameAt(frames[slot.fromTake], scratch, tl.takes[slot.fromTake].durationSec, scale),
        to: await rasterizeFrameAt(frames[slot.toTake], scratch, 0, scale),
      };
      slotRasters.set(slotIndex, r);
    }
    const p = smooth(Math.min(1, Math.max(0, pRaw)));
    const cw = canvas.width, ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);
    ctx.globalAlpha = 1;
    if (type === "slide") {
      ctx.drawImage(r.from, -p * cw, 0, cw, ch);
      ctx.drawImage(r.to, (1 - p) * cw, 0, cw, ch);
    } else if (type === "zoom") {
      const zwA = cw * (1 + 0.25 * p), zhA = ch * (1 + 0.25 * p);
      ctx.globalAlpha = 1 - p;
      ctx.drawImage(r.from, (cw - zwA) / 2, (ch - zhA) / 2, zwA, zhA);
      ctx.globalAlpha = p;
      const zwB = cw * (1.25 - 0.25 * p), zhB = ch * (1.25 - 0.25 * p);
      ctx.drawImage(r.to, (cw - zwB) / 2, (ch - zhB) / 2, zwB, zhB);
      ctx.globalAlpha = 1;
    } else if (type === "wipe") {
      ctx.drawImage(r.from, 0, 0, cw, ch);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, p * cw, ch);
      ctx.clip();
      ctx.drawImage(r.to, 0, 0, cw, ch);
      ctx.restore();
    } else { // fade (default)
      ctx.drawImage(r.from, 0, 0, cw, ch);
      ctx.globalAlpha = p;
      ctx.drawImage(r.to, 0, 0, cw, ch);
      ctx.globalAlpha = 1;
    }
  };

  const drawBase = async (tSec: number) => {
    const s = sampleReelAt(tl, tSec);
    if (s.kind === "transition") {
      await drawTransition(s.slotIndex, s.type, s.progress);
      return;
    }
    const raster = await rasterizeFrameAt(frames[s.takeIndex], scratch, s.localT, scale);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(raster, 0, 0, canvas.width, canvas.height);
  };

  // V3.4: real video/image windows composited over the take raster.
  const drawMediaOverlays = async (tSec: number) => {
    for (const mc of mediaClips) {
      if (tSec < mc.startSec || tSec >= mc.startSec + mc.durationSec) continue;
      const entry = pool.get(`${mc.kind}:${mc.url}`);
      if (!entry) continue;
      if (entry.kind === "video") {
        await seekMedia(entry.el as HTMLVideoElement, mc.trimInSec + (tSec - mc.startSec));
      }
      ctx.save();
      if (mc.filter) ctx.filter = mc.filter;
      drawContain(ctx, entry.el, canvas.width, canvas.height);
      ctx.restore();
    }
  };

  // V3.5: captions/stickers — same renderer as the preview (captions.ts).
  const drawTextOverlays = (tSec: number) => {
    for (const clip of textClips) {
      if (tSec < clip.startSec || tSec >= clip.startSec + clip.durationSec) continue;
      drawCaption(ctx, clip, canvas.width, canvas.height, tSec - clip.startSec);
    }
  };

  const drawAt = async (tSec: number) => {
    await drawBase(tSec);
    await drawMediaOverlays(tSec);
    drawTextOverlays(tSec);
  };

  // Prime caches with the first output frame before choosing a path (same
  // reasoning as the single-frame export).
  await drawAt(0);

  const base: Omit<ReelExportResult, "blob" | "mimeType" | "method"> = {
    frameCount: totalFrames, durationSec: tl.totalDurationSec, takeCount: frames.length, withAudio: false,
  };

  // V3.4: video clips carry their own sound — fetch, decode (Chrome extracts
  // the audio track from video containers) and trim to the clip's window.
  const mediaAudio: ReelAudioClipInput[] = [];
  for (const mc of mediaClips) {
    if (mc.kind !== "video" || mc.volume <= 0) continue;
    try {
      const res = await fetch(mc.url);
      if (!res.ok) continue;
      const data = await res.arrayBuffer();
      const maxLen = mc.sourceDurationSec > 0
        ? Math.max(0.05, mc.sourceDurationSec - mc.trimInSec)
        : mc.durationSec;
      mediaAudio.push({
        data, startSec: mc.startSec,
        durationSec: Math.min(mc.durationSec, maxLen),
        volume: Math.min(1.5, Math.max(0, mc.volume)),
        fadeInSec: 0.1, fadeOutSec: 0.25,
        offsetSec: mc.trimInSec, loopWhenShort: false,
      });
    } catch { /* one dead clip must not kill the export */ }
  }
  const allAudio = [...(opts.audioTracks ?? []), ...mediaAudio];

  // V3.7: MP4 goes straight to the MediaRecorder path — avc1 candidates plus
  // the audio pre-mixed and played in realtime into the recording.
  if (opts.format === "mp4") {
    const mp4Audio = allAudio.length
      ? await mixReelAudioTracks(allAudio, tl.totalDurationSec).catch(() => null)
      : null;
    const result = await exportWithMediaRecorder(canvas, drawAt, totalFrames, fps, tl.totalDurationSec, opts.onProgress, "mp4", mp4Audio);
    return { ...result, ...base, withAudio: !!mp4Audio };
  }

  try {
    const provider = allAudio.length ? makeReelAudioProvider(allAudio) : undefined;
    const result = await exportWithWebCodecs(canvas, drawAt, totalFrames, fps, tl.totalDurationSec, opts.onProgress, provider);
    if (result) return { ...result, ...base, withAudio: !!provider };
  } catch {
    // Fall through to MediaRecorder — with the same audio mix, now audible.
  }
  const fallbackAudio = allAudio.length
    ? await mixReelAudioTracks(allAudio, tl.totalDurationSec).catch(() => null)
    : null;
  const result = await exportWithMediaRecorder(canvas, drawAt, totalFrames, fps, tl.totalDurationSec, opts.onProgress, "webm", fallbackAudio);
  return { ...result, ...base, withAudio: !!fallbackAudio };
}

/** Trigger the browser's local download for an exported video. */
export function downloadVideoBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
