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
// .ts extensions on runtime relative imports — vid-qa imports this module
// under plain Node type-stripping (registry-parity check).
import { rasterizeFrame, type FrameSource } from "./frameCapture.ts";
import { WebMMuxer, type WebMuxAudioChunk, type WebMuxerAudioOptions } from "./webmMuxer.ts";
import { buildReelTimeline, sampleReelAt, resolveTakeLocal, type ReelFrameInput, type ReelTimeline } from "./sequencePlayback.ts";
import { placeTake, type ReelTakeLayout } from "./reelLayout.ts";
import {
  TAKE_FX, dirVec, dissolveTiles, pinwheelWedges, resolveTransitionParams, seeded,
  type TransitionParams,
} from "../../shared/videoEffectsCatalog.ts";
import { drawParticleFx } from "../../shared/particleFx.ts";
import { drawCaption } from "../components/video/captions.ts";
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

/** Loop/pingpong resolution — V4: delegates to the ONE copy in
 *  sequencePlayback (previously a private duplicate). */
function resolveTimelineTime(schema: AnimationSchema, tSec: number): number {
  return resolveTakeLocal(schema, tSec);
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

// ── RF-035 0.3: pre-export compatibility probe ──
// The user sees codec compatibility BEFORE starting a render, not at the
// end. Mirrors the EXACT candidate order the two export paths use, so the
// verdict is the route the exporter will really take.

export interface ExportSupport {
  ok: boolean;
  /** Verified route that will be used (already probed, not guessed). */
  route: string;
  /** When ok=false, the human explanation + the way out. */
  reason?: string;
}

export async function probeExportSupport(
  format: "webm" | "mp4",
  width: number,
  height: number,
  fps: number,
): Promise<ExportSupport> {
  const w = Math.max(16, Math.round(width));
  const h = Math.max(16, Math.round(height));
  const bitrate = bitrateFor(w, h, fps);
  const EncoderCtor = (globalThis as unknown as { VideoEncoder?: { isConfigSupported: (cfg: Record<string, unknown>) => Promise<{ supported?: boolean }> } }).VideoEncoder;
  const Recorder = typeof MediaRecorder !== "undefined" ? MediaRecorder : null;

  if (format === "webm") {
    // Primary path: WebCodecs VP9 → VP8 (same candidates as exportWithWebCodecs).
    if (EncoderCtor) {
      for (const codec of ["vp09.00.10.08", "vp8"] as const) {
        try {
          const s = await EncoderCtor.isConfigSupported({ codec, width: w, height: h, bitrate, framerate: fps });
          if (s?.supported) return { ok: true, route: `WebM · ${codec === "vp8" ? "VP8" : "VP9"} (WebCodecs)` };
        } catch { /* try next */ }
      }
    }
    // Fallback: MediaRecorder webm (same candidates as the recorder path).
    if (Recorder?.isTypeSupported("video/webm;codecs=vp9") || Recorder?.isTypeSupported("video/webm")) {
      return { ok: true, route: "WebM · MediaRecorder (fallback)" };
    }
    return { ok: false, route: "", reason: "Este navegador no puede renderizar WebM: sin WebCodecs VP9/VP8 y sin MediaRecorder webm." };
  }

  // mp4: the exporter muxes MP4 through MediaRecorder avc1 (no WebCodecs MP4).
  if (Recorder) {
    const mp4Mimes = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4;codecs=avc1.42E01E", "video/mp4"];
    if (mp4Mimes.some(m => Recorder.isTypeSupported(m))) {
      return { ok: true, route: "MP4 · H.264 (MediaRecorder)" };
    }
    const canWebm = Recorder.isTypeSupported("video/webm;codecs=vp9") || Recorder.isTypeSupported("video/webm")
      || (EncoderCtor ? true : false);
    if (canWebm) {
      return { ok: false, route: "", reason: "Este navegador no graba MP4 (sin MediaRecorder avc1). Cambia a WebM — el archivo MP4 saldría como WebM." };
    }
  }
  return { ok: false, route: "", reason: "Este navegador no soporta exportación de video (sin MediaRecorder ni WebCodecs)." };
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
 *  Sizes may differ since V4.0 — each take is contain-fit onto the project
 *  canvas (letterboxed) and re-framed by its optional `layout`. Optional
 *  per-take CSS filter (V3.2 reel look). V5: `fx` = animated take effect,
 *  `overlayFx` = static overlay ids (grain/vignette/scanlines/leak). */
  frames: ReelExportFrame[];
  /** V4.0: the output canvas. Absent = take 1's size (pre-V4 behavior). */
  project?: { width: number; height: number; bg: string };
  /** V5: beat timestamps (s, global) for the beat-punch take fx. */
  beats?: number[];
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

// ═════════════ V5: transition + fx rendering (canvas side) ═════════════

type ReelExportFrame = ReelFrameInput & FrameSource & {
  filter?: string; layout?: ReelTakeLayout | null;
  fx?: { id: string; intensity: number } | null;
  overlayFx?: string[];
  /** REQ044: animated particle overlay (shared/particleFx). */
  particles?: { id: string; density: number } | null;
};

export interface Rect { x: number; y: number; w: number; h: number }
export interface PoseSpec {
  dx?: number; dy?: number; scale?: number; rot?: number; alpha?: number;
  filter?: string; blend?: GlobalCompositeOperation;
  /** "center" (transitions: scale/rot around the take center) or "topleft"
   *  (take fx: dx/dy arrive pre-compensated for a top-left origin). */
  origin?: "center" | "topleft";
}

/** One posed drawImage of a take raster — the canvas mirror of setting a CSS
 *  transform on a preview wrapper. Call order mirrors the CSS matrix: point
 *  sees scale → rotate → translate. */
export function drawPosed(ctx: CanvasRenderingContext2D, raster: CanvasImageSource, rect: Rect, s: PoseSpec = {}): void {
  const scale = s.scale ?? 1;
  const rot = s.rot ?? 0;
  let dx = s.dx ?? 0, dy = s.dy ?? 0;
  if ((s.origin ?? "center") === "center" && scale !== 1) {
    dx += (1 - scale) * rect.w / 2;
    dy += (1 - scale) * rect.h / 2;
  }
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, s.alpha ?? 1));
  if (s.filter) ctx.filter = s.filter;
  if (s.blend) ctx.globalCompositeOperation = s.blend;
  ctx.translate(rect.x + dx, rect.y + dy);
  if ((s.origin ?? "center") === "center") {
    ctx.translate(rect.w / 2, rect.h / 2);
    ctx.rotate(rot * Math.PI / 180);
    ctx.scale(scale, scale);
    ctx.translate(-rect.w / 2, -rect.h / 2);
  } else {
    ctx.rotate(rot * Math.PI / 180);
    ctx.scale(scale, scale);
  }
  ctx.drawImage(raster, 0, 0, rect.w, rect.h);
  ctx.restore();
}

/** The transition's own params (V5) for a slot — fetched from the FROM
 *  frame's authored transition toward the TO frame. */
function transitionParamsFor(frames: ReelExportFrame[], fromTake: number, toFrameId?: string) {
  const anim = frames[fromTake]?.animation;
  if (!anim || !toFrameId) return undefined;
  return anim.transitions.find(tr => tr.toFrameId === toFrameId);
}

export interface ExportTransitionCtx {
  ctx: CanvasRenderingContext2D;
  /** Canvas px (already scaled). */
  W: number; H: number;
  /** Smoothed progress 0..1 (same smoothing as the preview). */
  p: number;
  /** Fully resolved params (defaults filled) from the catalog. */
  pr: TransitionParams;
  /** Output frame index — seeds deterministic jitter (glitch). */
  frameIndex: number;
  bg: string;
  /** Posed draws of the outgoing/incoming take (default pose = full rect). */
  from: (spec?: PoseSpec) => void;
  to: (spec?: PoseSpec) => void;
  rasterFrom: HTMLCanvasElement; rasterTo: HTMLCanvasElement;
  rectFrom: Rect; rectTo: Rect;
}

// Lazy scratch canvases (browser-only; never touched at import time).
let noiseCanvasEl: HTMLCanvasElement | null = null;
function getNoiseCanvas(): HTMLCanvasElement {
  if (noiseCanvasEl) return noiseCanvasEl;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const x = c.getContext("2d")!;
  const img = x.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() * 127 - 63);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  noiseCanvasEl = c;
  return c;
}
let scanCanvasEl: HTMLCanvasElement | null = null;
function getScanCanvas(): HTMLCanvasElement {
  if (scanCanvasEl) return scanCanvasEl;
  const c = document.createElement("canvas");
  c.width = 4; c.height = 4;
  const x = c.getContext("2d")!;
  x.fillStyle = "rgba(0,0,0,0.14)";
  x.fillRect(0, 0, 4, 1);
  scanCanvasEl = c;
  return c;
}
let pixCanvasEl: HTMLCanvasElement | null = null;

function hexToRgba(hex: string, a: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function drawNoiseOverlay(ctx: CanvasRenderingContext2D, W: number, H: number, alpha: number): void {
  if (alpha <= 0.01) return;
  const pat = ctx.createPattern(getNoiseCanvas(), "repeat");
  if (!pat) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** Static overlay fx (grain/vignette/scanlines/leak) — canvas mirror of
 *  overlayFxStyle() in the catalog (same look, canvas primitives). */
export function drawOverlayFxExport(ctx: CanvasRenderingContext2D, id: string, W: number, H: number, frameIndex: number): void {
  if (id === "grain") {
    const pat = ctx.createPattern(getNoiseCanvas(), "repeat");
    if (!pat) return;
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.globalCompositeOperation = "overlay";
    ctx.translate(-(frameIndex * 53) % 256, -(frameIndex * 97) % 256);
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W + 256, H + 256);
    ctx.restore();
  } else if (id === "vignette") {
    ctx.save();
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  } else if (id === "scanlines") {
    const pat = ctx.createPattern(getScanCanvas(), "repeat");
    if (!pat) return;
    ctx.save();
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  } else if (id === "leak") {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const g = ctx.createRadialGradient(W * 0.85, H * 0.12, 0, W * 0.85, H * 0.12, Math.max(W, H) * 0.45);
    g.addColorStop(0, "rgba(255,179,107,0.5)");
    g.addColorStop(1, "rgba(255,179,107,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

const fillTiles = (c: ExportTransitionCtx, kind: "columns" | "rows" | "checker" | "grid", count: number) => {
  for (const t of dissolveTiles(kind, count, c.W, c.H, c.p)) {
    c.ctx.globalAlpha = t.alpha;
    c.ctx.fillStyle = c.bg;
    c.ctx.fillRect(t.x, t.y, t.w, t.h);
  }
  c.ctx.globalAlpha = 1;
};

/** Pixelated posed draw — downscale to a small canvas, upscale with smoothing
 *  off. The preview approximates with stepped SVG filters; both read as
 *  growing pixel blocks. */
function drawPixelized(c: ExportTransitionCtx, which: "from" | "to", block: number, spec: PoseSpec): void {
  const raster = which === "from" ? c.rasterFrom : c.rasterTo;
  const rect = which === "from" ? c.rectFrom : c.rectTo;
  const bw = Math.max(8, Math.round(rect.w / block));
  const bh = Math.max(8, Math.round(rect.h / block));
  if (!pixCanvasEl) pixCanvasEl = document.createElement("canvas");
  pixCanvasEl.width = bw; pixCanvasEl.height = bh;
  const sctx = pixCanvasEl.getContext("2d")!;
  sctx.clearRect(0, 0, bw, bh);
  sctx.drawImage(raster, 0, 0, bw, bh);
  const ctx = c.ctx;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  drawPosed(ctx, pixCanvasEl, rect, spec);
  ctx.restore();
}

/**
 * THE canvas registry — one implementation per catalog transition id. vid-qa
 * asserts these keys === PREVIEW keys === TRANSITIONS ids (WYSIWYG contract).
 */
export const EXPORT_TRANSITIONS: Record<string, (c: ExportTransitionCtx) => void> = {
  fade: c => { c.from(); c.to({ alpha: c.p }); },
  slide: c => {
    const d = dirVec(String(c.pr.dir ?? "left"));
    c.from({ dx: d.x * c.p * c.W, dy: d.y * c.p * c.H });
    c.to({ dx: -d.x * (1 - c.p) * c.W, dy: -d.y * (1 - c.p) * c.H });
  },
  "slide-up": c => { c.from({ dy: -c.p * c.H }); c.to({ dy: (1 - c.p) * c.H }); },
  wipe: c => {
    const dir = String(c.pr.dir ?? "left");
    const band = Number(c.pr.softness ?? 0) * (dir === "left" || dir === "right" ? c.W : c.H);
    const axis = dir === "left" || dir === "right" ? c.W : c.H;
    const horizontal = dir === "left" || dir === "right";
    c.from();
    const reveal = (x: number, y: number, w: number, h: number, alpha: number) => {
      if (w <= 0.5 || h <= 0.5 || alpha <= 0.01) return;
      c.ctx.save();
      c.ctx.beginPath();
      c.ctx.rect(x, y, w, h);
      c.ctx.clip();
      c.to({ alpha });
      c.ctx.restore();
    };
    const lead = c.p * axis;
    const bandStart = Math.max(0, lead - band);
    const strip = (a: number, b: number, alpha: number) => {
      if (b <= a) return;
      const x = horizontal ? (dir === "left" ? a : axis - b) : 0;
      const y = horizontal ? 0 : (dir === "up" ? a : axis - b);
      reveal(x, y, horizontal ? b - a : c.W, horizontal ? c.H : b - a, alpha);
    };
    strip(0, bandStart, 1);
    for (let i = 0; i < 6; i++) strip(bandStart + (band * i) / 6, bandStart + (band * (i + 1)) / 6, (i + 1) / 6);
  },
  push: c => {
    const d = dirVec(String(c.pr.dir ?? "left"));
    c.from();
    c.to({ dx: -d.x * (1 - c.p) * c.W, dy: -d.y * (1 - c.p) * c.H });
    // Soft shadow on the incoming take's leading edge.
    const ctx = c.ctx;
    const gw = 34;
    if (d.x !== 0) {
      const ex = d.x < 0 ? (1 - c.p) * c.W : c.W - (1 - c.p) * c.W;
      const gx = d.x < 0 ? ex - gw : ex;
      const g = ctx.createLinearGradient(gx, 0, gx + gw, 0);
      g.addColorStop(d.x < 0 ? 0 : 1, "rgba(0,0,0,0)");
      g.addColorStop(d.x < 0 ? 1 : 0, "rgba(0,0,0,0.3)");
      ctx.save(); ctx.fillStyle = g; ctx.fillRect(gx, 0, gw, c.H); ctx.restore();
    } else {
      const ey = d.y < 0 ? (1 - c.p) * c.H : c.H - (1 - c.p) * c.H;
      const gy = d.y < 0 ? ey - gw : ey;
      const g = ctx.createLinearGradient(0, gy, 0, gy + gw);
      g.addColorStop(d.y < 0 ? 0 : 1, "rgba(0,0,0,0)");
      g.addColorStop(d.y < 0 ? 1 : 0, "rgba(0,0,0,0.3)");
      ctx.save(); ctx.fillStyle = g; ctx.fillRect(0, gy, c.W, gw); ctx.restore();
    }
  },
  "fade-black": c => {
    if (c.p < 0.5) c.from({ alpha: 1 - 2 * c.p });
    else c.to({ alpha: 2 * c.p - 1 });
  },
  tint: c => {
    c.from();
    c.to({ alpha: c.p });
    const f = Math.sin(c.p * Math.PI);
    if (f > 0.01) {
      c.ctx.save();
      c.ctx.globalAlpha = 0.35 * f;
      c.ctx.fillStyle = String(c.pr.color ?? "#e0b57a");
      c.ctx.fillRect(0, 0, c.W, c.H);
      c.ctx.restore();
    }
  },
  zoom: c => {
    const k = Number(c.pr.strength ?? 0.25);
    c.from({ scale: 1 + k * c.p, alpha: 1 - c.p });
    c.to({ scale: 1 + k * (1 - c.p), alpha: c.p });
  },
  "zoom-out": c => {
    const k = Number(c.pr.strength ?? 0.4);
    c.to();
    c.from({ scale: 1 + k * c.p, alpha: 1 - c.p });
  },
  pan: c => {
    const d = dirVec(String(c.pr.dir ?? "left"));
    c.from({ dx: d.x * c.p * 0.35 * c.W, dy: d.y * c.p * 0.35 * c.H, alpha: 1 - c.p });
    c.to({ dx: -d.x * (1 - c.p) * 0.35 * c.W, dy: -d.y * (1 - c.p) * 0.35 * c.H, alpha: c.p });
  },
  spin: c => {
    const deg = Number(c.pr.degrees ?? 180);
    c.from({ scale: 1 - 0.3 * c.p, rot: deg * c.p, alpha: 1 - c.p });
    c.to({ scale: 0.7 + 0.3 * c.p, rot: -deg * (1 - c.p), alpha: c.p });
  },
  "whip-pan": c => {
    const d = dirVec(String(c.pr.dir ?? "left"));
    const b = 24 * Math.sin(c.p * Math.PI);
    const f = b > 0.3 ? `blur(${b.toFixed(1)}px)` : undefined;
    c.from({ dx: d.x * c.p * c.W, dy: d.y * c.p * c.H, filter: f });
    c.to({ dx: -d.x * (1 - c.p) * c.W, dy: -d.y * (1 - c.p) * c.H, filter: f });
  },
  "simple-zoom": c => {
    const k = Number(c.pr.strength ?? 1.5);
    c.from();
    c.to({ scale: k - (k - 1) * c.p, alpha: c.p });
  },
  "cross-zoom": c => {
    const k = Number(c.pr.strength ?? 0.35);
    c.from({ scale: 1 + k * c.p, alpha: 1 - c.p });
    c.to({ scale: 1 - k + k * c.p, alpha: c.p });
  },
  blur: c => {
    const k = Number(c.pr.strength ?? 1);
    const f = (v: number) => (v > 0.05 ? `blur(${v.toFixed(2)}px)` : undefined);
    c.from({ filter: f(c.p * 14 * k) });
    c.to({ filter: f((1 - c.p) * 14 * k), alpha: c.p });
  },
  "linear-blur": c => {
    const d = dirVec(String(c.pr.dir ?? "left"));
    const b = 16 * Math.sin(c.p * Math.PI);
    const f = b > 0.3 ? `blur(${b.toFixed(1)}px)` : undefined;
    c.from({ dx: d.x * c.p * 0.25 * c.W, dy: d.y * c.p * 0.25 * c.H, filter: f, alpha: 1 - 0.5 * c.p });
    c.to({ dx: -d.x * (1 - c.p) * 0.25 * c.W, dy: -d.y * (1 - c.p) * 0.25 * c.H, filter: f, alpha: 0.5 + 0.5 * c.p });
  },
  pixelize: c => {
    const k = Number(c.pr.strength ?? 1);
    const block = Math.max(2, (4 + 44 * Math.sin(c.p * Math.PI)) * k);
    drawPixelized(c, "from", block, { alpha: 1 - c.p });
    drawPixelized(c, "to", block, { alpha: c.p });
  },
  "mosaic-grid": c => {
    c.to();
    fillTiles(c, "grid", Number(c.pr.count ?? 5));
    c.from({ alpha: 1 - c.p });
  },
  "gaussian-dissolve": c => {
    const k = Number(c.pr.strength ?? 1);
    const f = (v: number) => (v > 0.05 ? `blur(${v.toFixed(2)}px)` : undefined);
    c.from({ filter: f(10 * k * c.p), alpha: 1 - c.p });
    c.to({ filter: f(10 * k * (1 - c.p)), alpha: c.p });
  },
  flash: c => {
    c.from();
    c.to({ alpha: c.p });
    const f = Math.sin(c.p * Math.PI);
    if (f > 0.01) {
      c.ctx.save();
      c.ctx.globalAlpha = f;
      c.ctx.fillStyle = String(c.pr.color ?? "#ffffff");
      c.ctx.fillRect(0, 0, c.W, c.H);
      c.ctx.restore();
    }
  },
  "luma-burn": c => {
    c.from({ filter: `brightness(${(1 + 7 * c.p).toFixed(2)})` });
    c.to({ filter: `brightness(${(1 + 7 * (1 - c.p)).toFixed(2)})`, alpha: c.p });
  },
  "leak-sweep": c => {
    const col = String(c.pr.color ?? "#ffb36b");
    c.from();
    c.to({ alpha: c.p });
    const f = Math.sin(c.p * Math.PI);
    if (f > 0.01) {
      const bw = c.W * 0.6;
      const x0 = (c.p * 1.6 - 0.3) * c.W;
      const g = c.ctx.createLinearGradient(x0, 0, x0 + bw, 0);
      g.addColorStop(0, hexToRgba(col, 0));
      g.addColorStop(0.5, hexToRgba(col, 0.85));
      g.addColorStop(1, hexToRgba(col, 0));
      c.ctx.save();
      c.ctx.globalCompositeOperation = "screen";
      c.ctx.globalAlpha = f;
      c.ctx.fillStyle = g;
      c.ctx.fillRect(x0, 0, bw, c.H);
      c.ctx.restore();
    }
  },
  "exposure-cut": c => {
    if (c.p < 0.5) c.from();
    else {
      const spike = Math.max(0, 1 - Math.abs(2 * c.p - 1) * 4);
      c.to({ filter: spike > 0.02 ? `brightness(${(1 + 2 * spike).toFixed(2)})` : undefined });
    }
  },
  "glow-blend": c => {
    c.from();
    c.to({ blend: "screen", alpha: Math.min(0.85, c.p) });
    if (c.p > 0.5) c.to({ alpha: (c.p - 0.5) / 0.5 });
  },
  "circle-open": c => {
    const maxR = Math.hypot(c.W, c.H) / 2;
    if (String(c.pr.mode ?? "in") === "out") {
      c.to();
      c.ctx.save();
      c.ctx.beginPath();
      c.ctx.arc(c.W / 2, c.H / 2, maxR * (1 - c.p), 0, Math.PI * 2);
      c.ctx.clip();
      c.from();
      c.ctx.restore();
    } else {
      c.from();
      c.ctx.save();
      c.ctx.beginPath();
      c.ctx.arc(c.W / 2, c.H / 2, maxR * c.p, 0, Math.PI * 2);
      c.ctx.clip();
      c.to();
      c.ctx.restore();
    }
  },
  "diamond-open": c => {
    const d = Math.max(c.W, c.H) * 0.75 * c.p;
    c.from();
    c.ctx.save();
    c.ctx.beginPath();
    c.ctx.moveTo(c.W / 2, c.H / 2 - d);
    c.ctx.lineTo(c.W / 2 + d, c.H / 2);
    c.ctx.lineTo(c.W / 2, c.H / 2 + d);
    c.ctx.lineTo(c.W / 2 - d, c.H / 2);
    c.ctx.closePath();
    c.ctx.clip();
    c.to();
    c.ctx.restore();
  },
  blinds: c => { c.to(); fillTiles(c, "columns", Number(c.pr.count ?? 5)); c.from({ alpha: 1 - c.p }); },
  checker: c => { c.to(); fillTiles(c, "checker", Number(c.pr.count ?? 4)); c.from({ alpha: 1 - c.p }); },
  "bars-horizontal": c => { c.to(); fillTiles(c, "rows", Number(c.pr.count ?? 3)); c.from({ alpha: 1 - c.p }); },
  "square-crop": c => {
    const s = Math.max(c.W, c.H) * 1.15 * c.p;
    c.from();
    c.ctx.save();
    c.ctx.beginPath();
    c.ctx.rect((c.W - s) / 2, (c.H - s) / 2, s, s);
    c.ctx.clip();
    c.to();
    c.ctx.restore();
  },
  pinwheel: c => {
    c.to();
    for (const w of pinwheelWedges(Number(c.pr.count ?? 6), c.W / 2, c.H / 2, Math.hypot(c.W, c.H) / 2, c.p)) {
      c.ctx.globalAlpha = w.alpha;
      c.ctx.fillStyle = c.bg;
      c.ctx.beginPath();
      w.points.forEach(([x, y], i) => (i ? c.ctx.lineTo(x, y) : c.ctx.moveTo(x, y)));
      c.ctx.closePath();
      c.ctx.fill();
    }
    c.ctx.globalAlpha = 1;
    c.from({ alpha: 1 - c.p });
  },
  glitch: c => {
    const k = Number(c.pr.strength ?? 1);
    const amp = 26 * k * Math.sin(c.p * Math.PI);
    const sh = Math.floor(c.frameIndex * 1.7);
    c.from({ alpha: 1 - c.p * 0.4 });
    const K = 7;
    for (let i = 0; i < K; i++) {
      const dx = (seeded(i, sh) * 2 - 1) * amp;
      if (Math.abs(dx) < 0.5) continue;
      c.ctx.save();
      c.ctx.beginPath();
      c.ctx.rect(0, (c.H * i) / K, c.W, c.H / K);
      c.ctx.clip();
      c.to({ dx });
      c.ctx.restore();
    }
    for (const i of [2, 5]) {
      const y = c.H * seeded(i, sh + 9);
      c.ctx.save();
      c.ctx.globalAlpha = 0.55 * Math.sin(c.p * Math.PI);
      c.ctx.fillStyle = c.bg;
      c.ctx.fillRect(0, y, c.W, 3 + 6 * seeded(i, sh + 3));
      c.ctx.restore();
    }
  },
  echo: c => {
    const k = Number(c.pr.strength ?? 1);
    const off = 18 * k * Math.sin(c.p * Math.PI);
    c.from();
    c.to({ alpha: c.p });
    if (off > 0.5) {
      c.to({ alpha: c.p * 0.35, dx: off, blend: "screen" });
      c.to({ alpha: c.p * 0.35, dx: -off, blend: "screen" });
    }
  },
  "static-fade": c => {
    c.from();
    c.to({ alpha: c.p });
    drawNoiseOverlay(c.ctx, c.W, c.H, Math.sin(c.p * Math.PI) * 0.9);
  },
  swap: c => {
    const d = dirVec(String(c.pr.dir ?? "up"));
    c.from({ dx: d.x * c.p * 0.8 * c.W, dy: d.y * c.p * 0.8 * c.H, alpha: 1 - c.p });
    c.to({ dx: -d.x * (1 - c.p) * 0.8 * c.W, dy: -d.y * (1 - c.p) * 0.8 * c.H, alpha: Math.min(1, c.p * 1.5) });
  },
};

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

// ═════════════ RF-04 (Fase 1.2): ONE export-side frame renderer ═════════════

/** Everything needed to paint any timeline instant: the canvas, the
 *  built timeline, and drawAt — the same closures the encoders drive.
 *  Exported so the RF-04 parity test renders export frames directly,
 *  guaranteeing player-vs-export comparisons run the REAL pipeline. */
export interface ReelRenderer {
  canvas: HTMLCanvasElement;
  tl: ReelTimeline;
  fps: number;
  totalFrames: number;
  drawAt: (tSec: number) => Promise<void>;
  /** Resolved media clip inputs (exportReelVideo muxes their audio). */
  mediaClips: ReelExportMediaClip[];
}

/** Build the reel renderer: project canvas, timeline, media pool and the
 *  full draw stack (base takes + transitions + media + captions). Loads the
 *  media pool (async) — no pixels drawn until drawAt. */
export async function createReelRenderer(opts: ReelExportOptions): Promise<ReelRenderer> {
  if (opts.frames.length === 0) throw new Error("Sin tomas en el reel");
  const scale = opts.scale ?? 1;
  const frames = opts.frames;
  // V4.0: the project canvas IS the output. Takes of ANY size are
  // contain-fit onto it (letterboxed with project.bg) and re-framable
  // per take via frames[i].layout - the old mixed-size hard error is gone.
  const project = opts.project ?? { width: frames[0].width, height: frames[0].height, bg: "#000000" };
  const W = project.width, H = project.height;

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

  // ---- V4.0: per-take placement on the project canvas (contain + re-frame) ----
  const placed = (fi: number) => {
    const f = frames[fi];
    const rect = placeTake(project, { width: f.width, height: f.height }, f.layout);
    return { x: rect.left * scale, y: rect.top * scale, w: rect.width * scale, h: rect.height * scale };
  };
  const drawPlaced = (raster: HTMLCanvasElement, fi: number) => {
    const b = placed(fi);
    ctx.drawImage(raster, b.x, b.y, b.w, b.h);
  };
  /** drawImage of a placed take scaled by factor around its own center. */
  const zoomDraw = (raster: HTMLCanvasElement, fi: number, factor: number) => {
    const b = placed(fi);
    const w = b.w * factor, h = b.h * factor;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    ctx.drawImage(raster, cx - w / 2, cy - h / 2, w, h);
  };
  const clearToBg = () => {
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.fillStyle = project.bg || "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  const takeStartOf = (fi: number) => tl.segments[fi]?.startSec ?? 0;

  /** V5: draw a take raster with its animated fx (reelFx) + static overlay
   *  fx (reelOverlayFx) — the exact canvas mirror of the preview stage. */
  const drawPlacedWithFx = (raster: HTMLCanvasElement, fi: number, localT: number, frameIndex: number) => {
    const f = frames[fi];
    const b = placed(fi);
    let spec: PoseSpec = { origin: "topleft" };
    const fx = f.fx;
    if (fx && fx.intensity > 0.001) {
      const def = TAKE_FX.find(t => t.id === fx.id);
      if (def) {
        const st = def.at(localT, Math.min(1, Math.max(0, fx.intensity)), {
          w: b.w, h: b.h, beats: opts.beats, takeStartSec: takeStartOf(fi),
        });
        spec = { origin: "topleft", dx: st.dx, dy: st.dy, scale: st.scale, rot: st.rotate, alpha: st.opacity };
      }
    }
    drawPosed(ctx, raster, b, spec);
    for (const id of f.overlayFx ?? []) drawOverlayFxExport(ctx, id, canvas.width, canvas.height, frameIndex);
    // REQ044: animated particle overlay — the same shared catalog call the
    // preview's tick loop makes (stateless f(localT) → free parity).
    if (f.particles && f.particles.density > 0.001) {
      drawParticleFx(ctx, f.particles.id, canvas.width, canvas.height, localT, f.particles.density);
    }
  };

  const drawTransition = async (slotIndex: number, type: string, pRaw: number, frameIndex = 0) => {
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
    // V5: resolve the transition's own params (defaults filled by the catalog).
    const tr = transitionParamsFor(frames, slot.fromTake, frames[slot.toTake]?.id);
    const pr = resolveTransitionParams(type, tr?.params);
    clearToBg();
    (EXPORT_TRANSITIONS[type] ?? EXPORT_TRANSITIONS.fade)({
      ctx,
      W: canvas.width,
      H: canvas.height,
      p,
      pr,
      frameIndex,
      bg: project.bg || "#000000",
      from: spec => drawPosed(ctx, r!.from, placed(slot.fromTake), spec),
      to: spec => drawPosed(ctx, r!.to, placed(slot.toTake), spec),
      rasterFrom: r.from,
      rasterTo: r.to,
      rectFrom: placed(slot.fromTake),
      rectTo: placed(slot.toTake),
    });
    // Safety reset — registry fns are save/restore-clean, but never leak state.
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = true;
  };

  const drawBase = async (tSec: number, frameIndex = 0) => {
    const s = sampleReelAt(tl, tSec);
    if (s.kind === "transition") {
      await drawTransition(s.slotIndex, s.type, s.progress, frameIndex);
      return;
    }
    const raster = await rasterizeFrameAt(frames[s.takeIndex], scratch, s.localT, scale);
    clearToBg();
    drawPlacedWithFx(raster, s.takeIndex, s.localT, frameIndex);
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
    await drawBase(tSec, Math.max(0, Math.round(tSec * fps)));
    await drawMediaOverlays(tSec);
    drawTextOverlays(tSec);
  };
  return { canvas, tl, fps, totalFrames, drawAt, mediaClips };
}

/** RF-04: render ONE timeline instant through the EXACT export pipeline
 *  (same samplers, foreignObject rasterizer, transition/fx/caption code
 *  the encoders drive). The player-parity test captures the live stage at
 *  the same tSec and block-compares the two rasters against drift. */
export async function renderReelFrameAt(opts: ReelExportOptions, tSec: number): Promise<HTMLCanvasElement> {
  const r = await createReelRenderer(opts);
  await r.drawAt(tSec);
  return r.canvas;
}

/**
 * Export the multi-frame reel to ONE video file (REQ-VID2). Walks the
 * sequence timeline (takes + transitions from sequencePlayback) and encodes
 * with a single continuous clock — one encode, no concatenation. Transitions
 * composite the two takes' rasters per output frame (fade/slide/zoom/wipe).
 */
export async function exportReelVideo(opts: ReelExportOptions): Promise<ReelExportResult> {
  const r = await createReelRenderer(opts);
  const { canvas, tl, fps, totalFrames, drawAt } = r;
  const mediaClips = r.mediaClips;
  const frames = opts.frames;

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
