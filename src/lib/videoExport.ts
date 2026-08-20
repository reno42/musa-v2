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
import { WebMMuxer } from "./webmMuxer";

export interface VideoExportOptions {
  frame: FrameSource & { animation?: AnimationSchema | null };
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
    { html: scratch.innerHTML, css: frame.css, width: frame.width, height: frame.height, background: frame.background },
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

  onProgress?.(0.95);
  const muxer = new WebMMuxer({ width: canvas.width, height: canvas.height, codec: chosen.codecId, durationSec: exportDuration });
  for (const chunk of chunks) muxer.addFrame(chunk);
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
): Promise<VideoExportResult> {
  const mimeCandidates = [
    "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm",
    "video/mp4;codecs=avc1.42E01E", "video/mp4", // Safari-only environments
  ];
  const mimeType = mimeCandidates.find(m => MediaRecorder.isTypeSupported(m)) || "";

  const stream = canvas.captureStream(0); // frames only on requestFrame()
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: bitrateFor(canvas.width, canvas.height, fps),
  });
  const parts: Blob[] = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) parts.push(e.data); };
  const stopped = new Promise<void>(resolve => { recorder.onstop = () => resolve(); });
  recorder.start();

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
  recorder.stop();
  await stopped;

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
