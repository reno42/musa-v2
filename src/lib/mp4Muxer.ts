/**
 * mp4Muxer — minimal ISO-BMFF (MP4) muxer for WebCodecs H.264 (+ optional
 * AAC) output. G17: MP4 export was MediaRecorder-only (realtime pacing,
 * browser-dependent); the frame-perfect offline route needs a muxer that
 * writes deterministic microsecond timestamps, same as webmMuxer does for
 * VP8/VP9.
 *
 * Route decision (G17, criteria = memory @1080p / cold load / worker CPU):
 * own ~350-line muxer, zero deps, zero cold load — ffmpeg.wasm rejected
 * (~25 MB download before first export), render server rejected (breaks the
 * F1 "the browser IS the render engine" contract).
 *
 * Scope (deliberately narrow — not a general MP4 writer):
 *  • one H.264 video track (avc1) written as AVCC samples (length-prefixed
 *    NALUs) + the encoder's avcC (decoderConfig.description)
 *  • one optional AAC (mp4a.40.2) audio track via esds/AudioSpecificConfig
 *  • faststart layout: ftyp + moov + mdat (single chunk per track)
 *  • uniform frame cadence (the encode loop owns the timestamps)
 *
 * All boxes are built bottom-up; stco offsets are resolved with a two-pass
 * moov build (same length both passes), so no byte patching is needed.
 */

export interface Mp4Frame {
  /** AVCC bytes exactly as VideoEncoder emitted them (avc: {format:"avc"}). */
  data: Uint8Array;
  /** Presentation timestamp in microseconds (ascending across addFrame). */
  timestampUs: number;
  keyframe: boolean;
}

export interface Mp4AudioChunk {
  /** One raw AAC frame (no ADTS header). */
  data: Uint8Array;
  timestampUs: number;
  /** Sample duration in microseconds — REQUIRED for MP4 stts entries. */
  durationUs: number;
}

export interface Mp4MuxerAudioOptions {
  sampleRate: number;
  channels: number;
  /** AudioSpecificConfig — the AudioEncoder decoderConfig.description. */
  aasc?: Uint8Array;
}

export interface Mp4MuxerOptions {
  width: number;
  height: number;
  /** Video timescale factor: per-frame delta is exactly 1000 units. */
  fps: number;
  /** Total video duration in seconds (tkhd/mvhd). */
  durationSec: number;
  /** avcC record (AVCDecoderConfigurationRecord) from the encoder. */
  avcC: Uint8Array;
  /** Present → a second (track 2) mp4a.40.2 track is written. */
  audio?: Mp4MuxerAudioOptions;
}

function u16(v: number): Uint8Array { return new Uint8Array([(v >> 8) & 0xff, v & 0xff]); }
function u24(v: number): Uint8Array { return new Uint8Array([(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]); }
function u32(v: number): Uint8Array {
  return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}

/** 4-byte size + type + payload. */
function box(type: string, payload: Uint8Array[]): Uint8Array {
  const body = payload.length === 1 ? payload[0] : concat(payload);
  const head = concat([u32(8 + body.length), new TextEncoder().encode(type)]);
  return concat([head, body]);
}

/** FullBox: size + type + version(1) + flags(3) + payload. */
function fullBox(type: string, version: number, flags: number, payload: Uint8Array[]): Uint8Array {
  return box(type, [concat([new Uint8Array([version]), u24(flags & 0xffffff)]), ...payload]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const IDENTITY_MATRIX = concat([
  u32(0x00010000), u32(0), u32(0),
  u32(0), u32(0x00010000), u32(0),
  u32(0), u32(0), u32(0x40000000),
]);

/** Fixed-point 16.16. */
function fixed16(v: number): Uint8Array { return u32(Math.round(v * 65536)); }

/** MPEG descriptor: tag + single-byte length + payload (payloads stay < 256). */
function descriptor(tag: number, payload: Uint8Array): Uint8Array {
  if (payload.length > 255) throw new Error("mp4Muxer: descriptor > 255 bytes");
  return concat([new Uint8Array([tag, payload.length]), payload]);
}

function esdsBox(audio: Mp4MuxerAudioOptions): Uint8Array {
  const asc = audio.aasc && audio.aasc.length > 0 ? audio.aasc : null;
  // AudioSpecificConfig fallback: AOT=2 (AAC-LC), frequency index 3 (48 kHz),
  // channel config — Chrome always provides it; this only guards the shape.
  const aasc = asc ?? new Uint8Array([(2 << 3) | 3, (audio.channels === 2 ? 2 : 1) << 6]);
  const decoderConfig = descriptor(0x04, concat([
    new Uint8Array([
      0x40, // objectTypeIndication: MPEG-4 Audio
      0x15, // streamType: audio (5) << 2 | reserved
    ]),
    u24(6144), // bufferSizeDB — one AAC frame window, generous
    u32(128_000), u32(128_000), // max/avg bitrate
  ]));
  const decSpecific = descriptor(0x05, aasc);
  const slConfig = descriptor(0x06, new Uint8Array([0x02]));
  const es = descriptor(0x03, concat([
    u16(1), // ES_ID
    new Uint8Array([0]), // flags: none
    decoderConfig, slConfig,
  ]));
  return fullBox("esds", 0, 0, [es]);
}

/** Run-length compress equal deltas for stts. */
function sttsEntries(deltas: number[]): Uint8Array[] {
  const entries: Array<{ count: number; delta: number }> = [];
  for (const d of deltas) {
    const last = entries[entries.length - 1];
    if (last && last.delta === d) last.count++;
    else entries.push({ count: 1, delta: d });
  }
  return [u32(entries.length), ...entries.map(e => concat([u32(e.count), u32(e.delta)]))];
}

export class MP4Muxer {
  private readonly opts: Mp4MuxerOptions;
  private readonly frames: Mp4Frame[] = [];
  private readonly audioChunks: Mp4AudioChunk[] = [];

  constructor(opts: Mp4MuxerOptions) {
    if (!opts.avcC || opts.avcC.length === 0) throw new Error("mp4Muxer: avcC required (encoder description missing)");
    this.opts = opts;
  }

  addFrame(frame: Mp4Frame): void {
    if (frame.data && frame.data.length > 0) this.frames.push(frame);
  }

  addAudioChunk(chunk: Mp4AudioChunk): void {
    if (chunk.data && chunk.data.length > 0 && chunk.durationUs > 0) this.audioChunks.push(chunk);
  }

  private get audio(): Mp4MuxerAudioOptions | undefined {
    // Every chunk needs a duration for stts — drop the track (not the file)
    // when the encoder did not provide usable ones.
    return this.audioChunks.length > 0 ? this.opts.audio : undefined;
  }

  /** Serialize to the final MP4 blob (faststart: ftyp, moov, mdat). */
  finish(): Blob {
    if (this.frames.length === 0) throw new Error("mp4Muxer: no frames added");

    const videoSamples = this.frames.map(f => f.data);
    const audioSamples = this.audio ? this.audioChunks.map(c => c.data) : [];
    const videoBytes = videoSamples.reduce((n, s) => n + s.length, 0);
    const audioBytes = audioSamples.reduce((n, s) => n + s.length, 0);
    if (8 + videoBytes + audioBytes > 0xffff_ffff - 16) {
      throw new Error("mp4Muxer: mdat overflows 32-bit box size");
    }

    const ftyp = box("ftyp", [
      new TextEncoder().encode("isom"),
      u32(0x200),
      new TextEncoder().encode("isom"),
      new TextEncoder().encode("iso2"),
      new TextEncoder().encode("avc1"),
      new TextEncoder().encode("mp41"),
    ]);

    // Two-pass: moov length is offset-independent, so build once with zero
    // offsets to learn the real mdat positions, then rebuild.
    const moovLen = this.buildMoov(0, 0).length;
    const videoOffset = ftyp.length + moovLen + 8;
    const audioOffset = videoOffset + videoBytes;
    const moov = this.buildMoov(videoOffset, audioOffset);

    const mdat = concat([u32(8 + videoBytes + audioBytes), new TextEncoder().encode("mdat"), ...videoSamples, ...audioSamples]);

    // Cast: TS models Uint8Array as Uint8Array<ArrayBufferLike>, which BlobPart
    // rejects; our arrays are always plain-ArrayBuffer backed.
    return new Blob([ftyp as unknown as BlobPart, moov as unknown as BlobPart, mdat as unknown as BlobPart], { type: "video/mp4" });
  }

  private buildMoov(videoChunkOffset: number, audioChunkOffset: number): Uint8Array {
    const { width, height, fps, durationSec } = this.opts;
    const nVideo = this.frames.length;
    const audio = this.audio;
    const durationMs = Math.max(1, Math.round(durationSec * 1000));

    // ── video sample tables ──
    const frameDelta = 1000; // video timescale = fps * 1000
    const videoTimescale = Math.max(600, Math.round(fps * 1000));
    const keyframes = this.frames.map((f, i) => (f.keyframe ? i + 1 : 0)).filter(n => n > 0);
    const videoStbl = [
      fullBox("stsd", 0, 0, [
        u32(1),
        box("avc1", [
          concat([new Uint8Array(6), u16(1)]), // reserved + data_ref_index
          concat([u16(0), u16(0), new Uint8Array(12)]), // pre_defined/reserved
          u16(width), u16(height),
          u32(0x00480000), u32(0x00480000), // 72 dpi
          u32(0), u16(1), // reserved, frame_count
          concat([new Uint8Array(32)]), // compressorname (empty)
          concat([u16(0x0018), u16(0xffff)]), // depth 24, pre_defined -1
          box("avcC", [this.opts.avcC]),
        ]),
      ]),
      fullBox("stts", 0, 0, sttsEntries(new Array(nVideo).fill(frameDelta))),
      ...(keyframes.length > 0 && keyframes.length < nVideo
        ? [fullBox("stss", 0, 0, [u32(keyframes.length), ...keyframes.map(u32)])]
        : []),
      fullBox("stsc", 0, 0, [u32(1), concat([u32(1), u32(nVideo), u32(1)])]),
      fullBox("stsz", 0, 0, [u32(0), u32(nVideo), ...this.frames.map(f => u32(f.data.length))]),
      fullBox("stco", 0, 0, [u32(1), u32(videoChunkOffset)]),
    ];

    const videoTrak = box("trak", [
      fullBox("tkhd", 0, 0x000003, [
        u32(0), u32(0), // creation, modification
        u32(1), u32(0), // track_ID, reserved
        u32(durationMs),
        new Uint8Array(8), // reserved
        u16(0), u16(0), // layer, alternate_group
        u16(0), u16(0), // volume (video: silent), reserved
        IDENTITY_MATRIX,
        fixed16(width), fixed16(height),
      ]),
      box("mdia", [
        fullBox("mdhd", 0, 0, [
          u32(0), u32(0),
          u32(videoTimescale), u32(nVideo * frameDelta),
          concat([u16(0x55c4), u16(0)]), // language "und"
        ]),
        fullBox("hdlr", 0, 0, [
          u32(0), new TextEncoder().encode("vide"), new Uint8Array(12),
          new TextEncoder().encode("futuraria-video\0"),
        ]),
        box("minf", [
          fullBox("vmhd", 0, 1, [u16(0), new Uint8Array(6)]),
          box("dinf", [fullBox("dref", 0, 0, [u32(1), fullBox("url ", 0, 1, [])])]),
          box("stbl", videoStbl),
        ]),
      ]),
    ]);

    const tracks = [videoTrak];

    if (audio) {
      // ── audio sample tables ──
      const deltas = this.audioChunks.map(c => Math.max(1, Math.round((c.durationUs * audio.sampleRate) / 1_000_000)));
      const audioDuration = deltas.reduce((n, d) => n + d, 0);
      const nAudio = this.audioChunks.length;
      const audioStbl = [
        fullBox("stsd", 0, 0, [
          u32(1),
          box("mp4a", [
            concat([new Uint8Array(6), u16(1)]), // reserved + data_ref_index
            new Uint8Array(8), // reserved
            u16(audio.channels), u16(16),
            u16(0), u16(0), // pre_defined, reserved
            u32((audio.sampleRate << 16) | 0),
            esdsBox(audio),
          ]),
        ]),
        fullBox("stts", 0, 0, sttsEntries(deltas)),
        fullBox("stsc", 0, 0, [u32(1), concat([u32(1), u32(nAudio), u32(1)])]),
        fullBox("stsz", 0, 0, [u32(0), u32(nAudio), ...this.audioChunks.map(c => u32(c.data.length))]),
        fullBox("stco", 0, 0, [u32(1), u32(audioChunkOffset)]),
      ];
      tracks.push(box("trak", [
        fullBox("tkhd", 0, 0x000003, [
          u32(0), u32(0),
          u32(2), u32(0),
          u32(durationMs),
          new Uint8Array(8),
          u16(0), u16(0),
          u16(0x0100), u16(0), // full volume
          IDENTITY_MATRIX,
          u32(0), u32(0), // presentation size 0 for audio
        ]),
        box("mdia", [
          fullBox("mdhd", 0, 0, [
            u32(0), u32(0),
            u32(audio.sampleRate), u32(audioDuration),
            concat([u16(0x55c4), u16(0)]),
          ]),
          fullBox("hdlr", 0, 0, [
            u32(0), new TextEncoder().encode("soun"), new Uint8Array(12),
            new TextEncoder().encode("futuraria-audio\0"),
          ]),
          box("minf", [
            fullBox("smhd", 0, 0, [u16(0), u16(0)]),
            box("dinf", [fullBox("dref", 0, 0, [u32(1), fullBox("url ", 0, 1, [])])]),
            box("stbl", audioStbl),
          ]),
        ]),
      ]));
    }

    const moov = box("moov", [
      fullBox("mvhd", 0, 0, [
        u32(0), u32(0),
        u32(1000), u32(durationMs), // movie timescale 1ms
        u32(0x00010000), // rate 1.0
        concat([u16(0x0100), u16(0)]), // volume 1.0 + reserved
        new Uint8Array(8), // reserved
        IDENTITY_MATRIX,
        new Uint8Array(24), // pre_defined[6]
        u32(audio ? 3 : 2), // next_track_ID
      ]),
      ...tracks,
    ]);
    return moov;
  }
}
