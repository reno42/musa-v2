/**
 * webmMuxer — minimal WebM (Matroska subset) muxer for WebCodecs VP8/VP9
 * output. Frame-perfect video export (spec F1) needs deterministic frame
 * timestamps, which MediaRecorder cannot give; WebCodecs encodes frames
 * offline and this muxer writes them as SimpleBlocks.
 *
 * Scope (deliberately narrow — this is not a general Matroska writer):
 *  • one video track (VP8/VP9) + one optional Opus audio track (REQ-VID5)
 *  • in-order frames only (WebCodecs VP8/VP9 output is complete frames)
 *  • keyframe-driven clusters, so seeking and duration read correctly
 *
 * All sizes are computed bottom-up (children serialized before parents), so
 * no byte patching is needed and the output is deterministic.
 */

export interface WebMuxFrame {
  data: Uint8Array;
  /** Presentation timestamp in microseconds (ascending across addFrame calls). */
  timestampUs: number;
  keyframe: boolean;
}

export interface WebMuxAudioChunk {
  data: Uint8Array;
  /** Presentation timestamp in microseconds (ascending across addAudioChunk calls). */
  timestampUs: number;
}

export interface WebMuxerAudioOptions {
  sampleRate: number;
  channels: number;
  /** OpusHead bytes — the encoder's decoderConfig.description when available;
   * synthesized when absent. REQUIRED by Matroska for A_OPUS tracks. */
  codecPrivate?: Uint8Array;
}

export interface WebMuxerOptions {
  width: number;
  height: number;
  codec: "V_VP8" | "V_VP9";
  /** Total video duration in seconds (written into Segment > Info > Duration). */
  durationSec: number;
  /** Present → a second (track 2) A_OPUS track is written. */
  audio?: WebMuxerAudioOptions;
}

/** EBML variable-length integer with minimal width (marker bit = width). */
function vintSize(value: number): Uint8Array {
  if (value < 0) throw new Error("webmMuxer: negative size");
  let width = 1;
  while (value >= 1 << (7 * width) && width < 8) width++;
  const out = new Uint8Array(width);
  let v = value;
  for (let i = width - 1; i >= 0; i--) { out[i] = v & 0xff; v = Math.floor(v / 256); }
  out[0] |= 1 << (8 - width);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Unsigned integer element — value as minimal big-endian bytes. */
function uintEl(id: number[], value: number): Uint8Array {
  const bytes: number[] = [];
  let v = Math.max(0, Math.round(value));
  do { bytes.unshift(v & 0xff); v = Math.floor(v / 256); } while (v > 0);
  return concat([new Uint8Array(id), vintSize(bytes.length), new Uint8Array(bytes)]);
}

/** Float element as big-endian float64 (Duration accepts 4/8 bytes; 8 is safest). */
function floatEl(id: number[], value: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, false);
  return concat([new Uint8Array(id), vintSize(8), new Uint8Array(buf)]);
}

function stringEl(id: number[], value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat([new Uint8Array(id), vintSize(bytes.length), bytes]);
}

/** Master element — id + size(children) + children payload. */
function master(id: number[], children: Uint8Array[]): Uint8Array {
  const payload = concat(children);
  return concat([new Uint8Array(id), vintSize(payload.length), payload]);
}

interface PendingCluster {
  baseMs: number;
  blocks: Uint8Array[];
}

export class WebMMuxer {
  private readonly opts: WebMuxerOptions;
  private readonly clusters: PendingCluster[] = [];
  private current: PendingCluster | null = null;
  private frameCount = 0;
  private audioChunks: Array<{ tsMs: number; data: Uint8Array }> = [];

  constructor(opts: WebMuxerOptions) {
    this.opts = opts;
  }

  /** Add one encoded frame. Timestamps must be non-decreasing. */
  addFrame(frame: WebMuxFrame): void {
    if (!frame.data || frame.data.length === 0) return;
    const tsMs = Math.round(frame.timestampUs / 1000);

    // A new cluster starts at the first frame, on every keyframe (clean
    // seek points), and whenever the 16-bit relative timecode would wrap.
    let cluster = this.current;
    if (!cluster || (frame.keyframe && cluster.blocks.length > 0) || tsMs - cluster.baseMs > 32767) {
      cluster = { baseMs: tsMs, blocks: [] };
      this.clusters.push(cluster);
      this.current = cluster;
    }

    const rel = tsMs - cluster.baseMs;
    const flags = frame.keyframe ? 0x80 : 0x00; // bit 7 = keyframe, no lacing
    const header = new Uint8Array([0x81, (rel >> 8) & 0xff, rel & 0xff, flags]); // track vint 1, int16 BE
    cluster.blocks.push(concat([new Uint8Array([0xA3]), vintSize(header.length + frame.data.length), header, frame.data]));
    this.frameCount++;
  }

  /** Add one encoded audio packet (track 2). Timestamps must be non-decreasing
   *  and are distributed into the time windows of the video clusters at finish(). */
  addAudioChunk(chunk: WebMuxAudioChunk): void {
    if (!chunk.data || chunk.data.length === 0) return;
    this.audioChunks.push({ tsMs: Math.round(chunk.timestampUs / 1000), data: chunk.data });
  }

  /** Audio SimpleBlock: track vint 0x82 (track 2), int16 BE rel time, no lacing. */
  private audioBlock(rel: number, data: Uint8Array): Uint8Array {
    const header = new Uint8Array([0x82, (rel >> 8) & 0xff, rel & 0xff, 0x00]);
    return concat([new Uint8Array([0xA3]), vintSize(header.length + data.length), header, data]);
  }

  /** Distribute buffered audio packets into cluster time windows. Video clusters
   *  stay untouched (their keyframe cadence defines seek points); audio joins
   *  the cluster whose [baseMs, ∞) window contains it, with extra audio-only
   *  clusters past the last video frame so 16-bit relative times never wrap. */
  private distributeAudio(): void {
    if (!this.opts.audio || this.audioChunks.length === 0) return;
    this.audioChunks.sort((a, b) => a.tsMs - b.tsMs);
    let ci = 0;
    for (const chunk of this.audioChunks) {
      while (ci < this.clusters.length - 1 && chunk.tsMs >= this.clusters[ci + 1].baseMs) ci++;
      let cluster = this.clusters[ci];
      if (!cluster || chunk.tsMs - cluster.baseMs > 32767) {
        cluster = { baseMs: Math.max(0, chunk.tsMs), blocks: [] };
        // Audio-only clusters must stay in time order relative to the rest.
        const insertAt = Math.min(this.clusters.length, ci + 1);
        this.clusters.splice(insertAt, 0, cluster);
        ci = insertAt;
      }
      cluster.blocks.push(this.audioBlock(Math.max(0, chunk.tsMs - cluster.baseMs), chunk.data));
    }
    this.audioChunks = [];
  }

  /** Synthesize the 19-byte OpusHead when the encoder did not provide one. */
  private opusHead(): Uint8Array {
    const provided = this.opts.audio?.codecPrivate;
    if (provided && provided.length > 0) return provided;
    const head = new Uint8Array(19);
    head.set(new TextEncoder().encode("OpusHead"), 0);
    head[8] = 1; // version
    head[9] = this.opts.audio?.channels ?? 2;
    head[10] = 0x38; head[11] = 0x01; // pre-skip 312 (LE)
    const rate = this.opts.audio?.sampleRate ?? 48000;
    head[12] = rate & 0xff; head[13] = (rate >> 8) & 0xff; head[14] = (rate >> 16) & 0xff; head[15] = (rate >> 24) & 0xff;
    // output gain 0, mapping family 0
    return head;
  }

  /** Serialize to the final WebM blob. */
  finish(): Blob {
    if (this.frameCount === 0) throw new Error("webmMuxer: no frames added");
    this.distributeAudio();

    const durationMs = this.opts.durationSec * 1000;

    const ebml = master([0x1A, 0x45, 0xDF, 0xA3], [
      uintEl([0x42, 0x86], 1), // EBMLVersion
      uintEl([0x42, 0xF7], 1), // EBMLReadVersion
      uintEl([0x42, 0xF2], 4), // EBMLMaxIDLength
      uintEl([0x42, 0xF3], 8), // EBMLMaxSizeLength
      stringEl([0x42, 0x82], "webm"), // DocType
      uintEl([0x42, 0x87], 2), // DocTypeVersion
      uintEl([0x42, 0x85], 2), // DocTypeReadVersion
    ]);

    const info = master([0x15, 0x49, 0xA9, 0x66], [
      uintEl([0x2A, 0xD7, 0xB1], 1_000_000), // TimecodeScale: 1ms
      floatEl([0x44, 0x89], durationMs),    // Duration
      stringEl([0x4D, 0x80], "futuraria"),  // MuxingApp
      stringEl([0x57, 0x41], "futuraria-video-export"), // WritingApp
    ]);

    const video = master([0xE0], [
      uintEl([0xB0], this.opts.width),  // PixelWidth
      uintEl([0xBA], this.opts.height), // PixelHeight
    ]);
    const trackEntry = master([0xAE], [
      uintEl([0xD7], 1),          // TrackNumber
      uintEl([0x73, 0xC5], 1),    // TrackUID
      uintEl([0x83], 1),          // TrackType: video
      stringEl([0x86], this.opts.codec), // CodecID
      video,
    ]);
    const trackEntries = [trackEntry];
    if (this.opts.audio) {
      const audioEl = master([0xE1], [
        floatEl([0xB5], this.opts.audio.sampleRate), // SamplingFrequency
        uintEl([0x9F], this.opts.audio.channels),    // Channels
      ]);
      trackEntries.push(master([0xAE], [
        uintEl([0xD7], 2),       // TrackNumber
        uintEl([0x73, 0xC5], 2), // TrackUID
        uintEl([0x83], 2),       // TrackType: audio
        stringEl([0x86], "A_OPUS"),
        concat([new Uint8Array([0x63, 0xA2]), vintSize(this.opusHead().length), this.opusHead()]), // CodecPrivate
        audioEl,
      ]));
    }
    const tracks = master([0x16, 0x54, 0xAE, 0x6B], trackEntries);

    const clusterEls = this.clusters.map(c =>
      master([0x1F, 0x43, 0xB6, 0x75], [uintEl([0xE7], c.baseMs), ...c.blocks]));

    const segment = master([0x18, 0x53, 0x80, 0x67], [info, tracks, ...clusterEls]);
    // Cast: TS 5.7 models Uint8Array as Uint8Array<ArrayBufferLike>, which
    // BlobPart rejects; our arrays are always plain-ArrayBuffer backed.
    return new Blob([ebml as unknown as BlobPart, segment as unknown as BlobPart], { type: "video/webm" });
  }
}
