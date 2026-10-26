/**
 * REQ-058 — Motor de grabación de tomas (Take Studio).
 *
 * Qué resuelve:
 *  - Elegir el mejor mime que MediaRecorder soporte (WebM VP9/VP8, MP4 en
 *    Safari) con función de soporte inyectable para QA en Node.
 *  - Grabar MULTI-TOMA: cada start() produce una toma independiente; el
 *    caller conserva la anterior o la descarta — el estudio decide.
 *  - Tope de duración (3 min) con auto-stop: la UI muestra countdown.
 *  - Upload directo al bucket vía XHR (progreso real) a la URL presigned
 *    del server — PUT DESNUDO: sin headers de auth (la firma SigV4 va en
 *    la query y solo cubre host; auth de Musa NO va a R2).
 *
 * Teleprompter: es overlay DOM del componente y NUNCA entra al stream.
 * La captura es getUserMedia (cámara/mic); jamás getDisplayMedia de la
 * misma pestaña — así el prompter "solo lo ve quien graba".
 *
 * Honesty rules: helpers puros arriba (node-testables con strip-types);
 * la clase solo toca MediaRecorder/performance dentro de métodos.
 */

/** Techo duro de duración por toma (promesa del producto: "máximo 3 min"). */
export const MAX_TAKE_DURATION_MS = 3 * 60_000;

// ── Formatos de toma (REQ-059, bloque B) ────────────────────────────────────
// La webcam entrega lo que entrega: el canvas compone al formato EXACTO, así
// que lo que sale del MediaRecorder mide lo que el usuario eligió en el
// dropdown. Presets fijos (preferencia de Ren: dropdown, no input manual).

export type TakeFormatId = "vertical" | "square" | "portrait" | "horizontal";
export type TakeFitMode = "cover" | "contain";

export interface TakeFormat {
  id: TakeFormatId;
  label: string;
  hint: string;
  width: number;
  height: number;
  videoBitsPerSecond: number;
}

export const TAKE_FORMATS: readonly TakeFormat[] = [
  { id: "vertical", label: "Vertical 1080×1920 (9:16)", hint: "reels · stories · tiktok", width: 1080, height: 1920, videoBitsPerSecond: 8_000_000 },
  { id: "square", label: "Post 1080×1080 (1:1)", hint: "feed cuadrado", width: 1080, height: 1080, videoBitsPerSecond: 5_000_000 },
  // IG usa 1080×1350 (4:5 vertical); se fija así para que el label, la
  // geometría del canvas y el aspect_ratio de HeyGen digan lo mismo.
  { id: "portrait", label: "Post 1080×1350 (4:5)", hint: "feed retrato", width: 1080, height: 1350, videoBitsPerSecond: 6_000_000 },
  { id: "horizontal", label: "Horizontal 1920×1080 (16:9)", hint: "YouTube · landing", width: 1920, height: 1080, videoBitsPerSecond: 6_000_000 },
];

export const DEFAULT_TAKE_FORMAT_ID: TakeFormatId = "horizontal";

export function takeFormatById(id: string | null | undefined): TakeFormat {
  return TAKE_FORMATS.find(f => f.id === id) || TAKE_FORMATS.find(f => f.id === DEFAULT_TAKE_FORMAT_ID)!;
}

/** Constraints para getUserMedia: se pide el formato directo; muchas webcams
 *  ignoran el ideal vertical y devuelven landscape — el canvas recorta igual,
 *  por eso el sistema no depende de esto. */
export function cameraConstraintsFor(fmt: TakeFormat): { width: { ideal: number }; height: { ideal: number } } {
  return { width: { ideal: fmt.width }, height: { ideal: fmt.height } };
}

export interface FitRects {
  sx: number; sy: number; sw: number; sh: number;
  dx: number; dy: number; dw: number; dh: number;
}

/** Matemática de composición cámara→canvas. cover = llena y recorta centrado
 *  (dw/dh >= dst, offsets <= 0 — el canvas clippea); contain = entra entero
 *  centrado con bandas (el caller pinta fondo negro antes). */
export function fitRects(srcW: number, srcH: number, dstW: number, dstH: number, mode: TakeFitMode): FitRects {
  if (!srcW || !srcH || !dstW || !dstH) {
    return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx: 0, dy: 0, dw: dstW, dh: dstH };
  }
  const scale = mode === "cover" ? Math.max(dstW / srcW, dstH / srcH) : Math.min(dstW / srcW, dstH / srcH);
  const dw = Math.round(srcW * scale);
  const dh = Math.round(srcH * scale);
  return { sx: 0, sy: 0, sw: srcW, sh: srcH, dx: Math.round((dstW - dw) / 2), dy: Math.round((dstH - dh) / 2), dw, dh };
}

/** Peso estimado de una toma (video elegido + audio 96 kbps) para avisar en
 *  el dropdown cuánto come del cupo de 8 GB antes de grabar. */
export function estimateTakeBytes(fmt: TakeFormat, durationMs: number): number {
  return Math.round((fmt.videoBitsPerSecond / 8 + 12_000) * (durationMs / 1000));
}

/** Ritmo de locución neutro en español (~150 palabras/min) para estimar
 *  cuánto dura un guion leído en voz alta. */
export const SPEECH_WORDS_PER_MIN = 150;

export function estimateSpeechSeconds(words: number): number {
  if (!Number.isFinite(words) || words <= 0) return 0;
  return Math.ceil((words / SPEECH_WORDS_PER_MIN) * 60);
}

/** Palabras del guion (whitespace-delimited, cuenta lo que se ve). */
export function countWords(text: string): number {
  const trimmed = (text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export interface RecorderMimeOption {
  mime: string;
  ext: string;
  label: string;
}

/** Preferencia descendente: VP9 comprime mejor; MP4 es el fallback de Safari. */
export const MIME_CANDIDATES: readonly RecorderMimeOption[] = [
  { mime: "video/webm;codecs=vp9,opus", ext: "webm", label: "WebM VP9" },
  { mime: "video/webm;codecs=vp8,opus", ext: "webm", label: "WebM VP8" },
  { mime: "video/webm", ext: "webm", label: "WebM" },
  { mime: "video/mp4", ext: "mp4", label: "MP4" },
];

/** Primer mime soportado según el predicador (MediaRecorder.isTypeSupported). */
export function pickRecorderMime(isTypeSupported: (mime: string) => boolean): RecorderMimeOption | null {
  for (const candidate of MIME_CANDIDATES) {
    try {
      if (isTypeSupported(candidate.mime)) return candidate;
    } catch { /* navegador exótico: sigue al siguiente */ }
  }
  return null;
}

/** Cronómetro de grabación para la UI: "0:07", "2:31". */
export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Combina cámara + mic (los que existan) en un stream para MediaRecorder. */
export function combineStreams(...streams: Array<MediaStream | null | undefined>): MediaStream {
  const out = new MediaStream();
  for (const stream of streams) {
    for (const track of stream?.getTracks() || []) out.addTrack(track);
  }
  return out;
}

export interface TakeRecorderCallbacks {
  /** Cada trozo de MediaRecorder (timeslice) — para progreso/size live. */
  onChunk?: (info: { chunkBytes: number; totalBytes: number; elapsedMs: number }) => void;
  /** Reloj de la UI (~4 Hz) con el elapsed ACTIVO (sin pausas). */
  onTick?: (elapsedMs: number) => void;
  /** Se disparó el techo de 3 min — la toma ya se está cerrando sola. */
  onAutoStop?: (reason: "max-duration") => void;
  onError?: (error: Error) => void;
}

export interface TakeRecording {
  blob: Blob;
  /** Mime exacto con el que grabó MediaRecorder (p.ej. "video/webm;codecs=vp9,opus"). */
  mime: string;
  ext: string;
  sizeBytes: number;
  durationMs: number;
  /** Formato compuesto (REQ-059): dimensiones EXACTAS del archivo. */
  width?: number;
  height?: number;
  formatId?: TakeFormatId;
}

type RecorderState = "idle" | "recording" | "paused";

const TIMESLICE_MS = 1_000;
const TICK_MS = 250;

export class TakeRecorder {
  private callbacks: TakeRecorderCallbacks;
  private recorder: MediaRecorder | null = null;
  private mimeOption: RecorderMimeOption | null = null;
  private chunks: Blob[] = [];
  private totalBytes = 0;
  private startedAtMs = 0;
  private pausedAccumMs = 0;
  private pausedSinceMs: number | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped: TakeRecording | null = null;
  private stopPromise: Promise<TakeRecording> | null = null;
  private state: RecorderState = "idle";
  // Composer (REQ-059): canvas al formato exacto + <video> oculto de cámara.
  private composerCanvas: HTMLCanvasElement | null = null;
  private composerVideo: HTMLVideoElement | null = null;
  private composerRaf: number | null = null;
  private sourceStream: MediaStream | null = null;
  private format: TakeFormat = takeFormatById(DEFAULT_TAKE_FORMAT_ID);

  constructor(callbacks: TakeRecorderCallbacks = {}) {
    this.callbacks = callbacks;
  }

  getState(): RecorderState {
    return this.state;
  }

  getMime(): RecorderMimeOption | null {
    return this.mimeOption;
  }

  /** ms ACTIVOS de grabación (las pausas no cuentan). */
  elapsedMs(): number {
    if (this.state === "idle" || !this.startedAtMs) return 0;
    const now = performance.now();
    const pausedNow = this.pausedSinceMs ? now - this.pausedSinceMs : 0;
    return Math.max(0, now - this.startedAtMs - this.pausedAccumMs - pausedNow);
  }

  /** Formato con el que se está grabando la toma activa. */
  getFormat(): TakeFormat {
    return this.format;
  }

  /**
   * Empieza una toma nueva sobre el stream de cámara (+mic). El video NO se
   * graba crudo: se compone frame a frame sobre un canvas del formato EXACTO
   * (fitRects cover/contain) y MediaRecorder graba `canvas.captureStream(30)`
   * + las pistas de audio originales. Así el archivo mide lo que el usuario
   * eligió sin importar qué entrega la webcam.
   */
  start(stream: MediaStream, format: TakeFormat = this.format, fitMode: TakeFitMode = "cover"): void {
    if (this.state !== "idle") throw new Error("TAKE_ALREADY_ACTIVE");
    if (typeof MediaRecorder === "undefined") {
      throw new Error("TAKE_MEDIARECORDER_UNSUPPORTED");
    }
    const mimeOption = pickRecorderMime(m => MediaRecorder.isTypeSupported(m));
    if (!mimeOption) throw new Error("TAKE_MIME_UNSUPPORTED");

    this.chunks = [];
    this.totalBytes = 0;
    this.stopped = null;
    this.stopPromise = null;
    this.pausedAccumMs = 0;
    this.pausedSinceMs = null;
    this.mimeOption = mimeOption;
    this.format = format;

    // ── Composer cámara → canvas (format.width × format.height) ──
    const canvas = document.createElement("canvas");
    canvas.width = format.width;
    canvas.height = format.height;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    void video.play().catch(() => { /* autoplay bloqueado: el rAF igual espera readyState */ });
    const ctx = canvas.getContext("2d");
    const draw = () => {
      this.composerRaf = requestAnimationFrame(draw);
      if (!ctx || video.readyState < 2 || !video.videoWidth) return;
      const r = fitRects(video.videoWidth, video.videoHeight, canvas.width, canvas.height, fitMode);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
    };
    this.composerCanvas = canvas;
    this.composerVideo = video;
    this.sourceStream = stream;
    this.composerRaf = requestAnimationFrame(draw);

    const canvasStream = canvas.captureStream(30);
    const recStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...stream.getAudioTracks(),
    ]);

    const recorder = new MediaRecorder(recStream, {
      mimeType: mimeOption.mime,
      videoBitsPerSecond: format.videoBitsPerSecond,
      audioBitsPerSecond: 96_000,
    });
    recorder.ondataavailable = (ev: BlobEvent) => {
      if (!ev.data || ev.data.size === 0) return;
      this.chunks.push(ev.data);
      this.totalBytes += ev.data.size;
      this.callbacks.onChunk?.({
        chunkBytes: ev.data.size,
        totalBytes: this.totalBytes,
        elapsedMs: this.elapsedMs(),
      });
    };
    this.recorder = recorder;
    recorder.start(TIMESLICE_MS);

    this.startedAtMs = performance.now();
    this.state = "recording";

    this.tickTimer = setInterval(() => {
      const elapsed = this.elapsedMs();
      this.callbacks.onTick?.(elapsed);
      if (elapsed >= MAX_TAKE_DURATION_MS) this.stop("max-duration");
    }, TICK_MS);
    // Red de seguridad del techo (por si el tick se retrasa en background tab).
    this.maxTimer = setTimeout(() => this.stop("max-duration"), MAX_TAKE_DURATION_MS + TICK_MS);
  }

  pause(): void {
    if (this.state !== "recording" || !this.recorder) return;
    this.recorder.pause();
    this.pausedSinceMs = performance.now();
    this.state = "paused";
  }

  resume(): void {
    if (this.state !== "paused" || !this.recorder) return;
    this.recorder.resume();
    if (this.pausedSinceMs) {
      this.pausedAccumMs += performance.now() - this.pausedSinceMs;
      this.pausedSinceMs = null;
    }
    this.state = "recording";
  }

  /** Cierra la toma y apaga los tracks del stream (luz de cámara off). */
  async stop(reason: "user" | "max-duration" = "user"): Promise<TakeRecording> {
    if (this.state === "idle") throw new Error("TAKE_NOT_ACTIVE");
    if (this.stopPromise) return this.stopPromise;

    if (reason === "max-duration") this.callbacks.onAutoStop?.(reason);
    if (this.state === "paused" && this.recorder) this.recorder.resume();

    const recorder = this.recorder;
    if (!recorder) throw new Error("TAKE_NOT_ACTIVE");

    this.stopPromise = new Promise<TakeRecording>((resolveStop) => {
      recorder.onstop = () => {
        const durationMs = this.elapsedMs();
        this.clearTimers();
        this.teardownComposer();
        this.state = "idle";
        this.recorder = null;
        this.stopped = {
          blob: new Blob(this.chunks, { type: this.mimeOption?.mime || "video/webm" }),
          mime: this.mimeOption?.mime || "video/webm",
          ext: this.mimeOption?.ext || "webm",
          sizeBytes: this.totalBytes,
          durationMs,
          width: this.format.width,
          height: this.format.height,
          formatId: this.format.id,
        };
        resolveStop(this.stopped);
      };
      try {
        recorder.requestData?.();
      } catch { /* algunos navegadores lanzan si no hay data — ignorable */ }
      try {
        recorder.stop();
      } catch (e) {
        this.callbacks.onError?.(e instanceof Error ? e : new Error(String(e)));
        this.clearTimers();
        this.teardownComposer();
        this.state = "idle";
        this.recorder = null;
        resolveStop({
          blob: new Blob(this.chunks, { type: this.mimeOption?.mime || "video/webm" }),
          mime: this.mimeOption?.mime || "video/webm",
          ext: this.mimeOption?.ext || "webm",
          sizeBytes: this.totalBytes,
          durationMs: this.elapsedMs(),
          width: this.format.width,
          height: this.format.height,
          formatId: this.format.id,
        });
      }
    });
    return this.stopPromise;
  }

  /** Descarta la toma en curso sin producir recording (cámara off igual). */
  async abort(): Promise<void> {
    if (this.state === "idle") return;
    const recorder = this.recorder;
    this.clearTimers();
    this.chunks = [];
    this.totalBytes = 0;
    this.stopPromise = null;
    this.state = "idle";
    this.recorder = null;
    if (recorder) {
      recorder.onstop = null;
      try { recorder.stop(); } catch { /* ya muerto */ }
    }
    this.teardownComposer();
  }

  /** Apaga el composer: sin rAF, sin <video> colgado y — clave — con los
   *  tracks de la FUENTE detenidos (la luz de la cámara se apaga; detener
   *  solo los tracks del canvas no basta). */
  private teardownComposer() {
    if (this.composerRaf !== null && typeof cancelAnimationFrame !== "undefined") {
      cancelAnimationFrame(this.composerRaf);
    }
    this.composerRaf = null;
    if (this.composerVideo) {
      try { this.composerVideo.pause(); } catch { /* ok */ }
      this.composerVideo.srcObject = null;
      this.composerVideo = null;
    }
    this.composerCanvas = null;
    for (const track of this.sourceStream?.getTracks() || []) track.stop();
    this.sourceStream = null;
  }

  private clearTimers() {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    if (this.maxTimer) { clearTimeout(this.maxTimer); this.maxTimer = null; }
  }
}

/**
 * PUT a la URL presigned con progreso real (XHR — fetch no da upload progress
 * sin streams). DESNUDO: nada de Authorization/x-api-key acá, la autorización
 * es la firma SigV4 que ya viaja en la URL.
 */
export function uploadTake(
  blob: Blob,
  upload: { url: string; method?: string; headers?: Record<string, string> },
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolveUpload, rejectUpload) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method || "PUT", upload.url);
    for (const [key, value] of Object.entries(upload.headers || {})) {
      try { xhr.setRequestHeader(key, value); } catch { /* header prohibido: seguir */ }
    }
    if (xhr.upload) {
      xhr.upload.onprogress = (ev: ProgressEvent) => {
        if (ev.lengthComputable && onProgress) onProgress(Math.min(1, ev.loaded / ev.total));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolveUpload();
      else rejectUpload(new Error(`TAKE_UPLOAD_FAILED (${xhr.status})`));
    };
    xhr.onerror = () => rejectUpload(new Error("TAKE_UPLOAD_NETWORK"));
    xhr.onabort = () => rejectUpload(new Error("TAKE_UPLOAD_ABORTED"));
    xhr.send(blob);
  });
}
