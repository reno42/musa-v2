/**
 * Shrinking an image before it is stored.
 *
 * No service, no native binary, no Python: the browser already ships a full
 * image decoder and encoder, and this repo already leans on it to rasterize
 * frames. Decode to a canvas, draw it smaller, ask for the bytes back at a
 * lower quality. It runs on the machine that already has the file, costs
 * nothing to operate, and adds no dependency.
 *
 * What it cannot do is compress a file it never sees. An image pasted as a URL
 * is fetched by the server precisely because the browser is not allowed to
 * read pixels from another origin — so that path is capped rather than
 * compressed, and re-compressed opportunistically once the bytes are in our
 * own bucket.
 *
 * The sizing maths is separate and pure so QA/image-compress.test.mjs can
 * cover it without a DOM.
 */

/** Past this, a design file is carrying someone else's problem. */
export const TARGET_BYTES = 1_500_000;
/** Nothing in a 1080×1350 post needs more pixels than this. */
export const MAX_EDGE = 2000;
/** Below this the picture starts to look like a mistake. */
const MIN_QUALITY = 0.5;
const QUALITY_LADDER = [0.85, 0.75, 0.65, 0.55, MIN_QUALITY];

export interface Fitted { width: number; height: number; scaled: boolean }

/** Longest edge capped, aspect ratio kept, never upscaled. */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): Fitted {
  if (width <= 0 || height <= 0) return { width: 0, height: 0, scaled: false };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height, scaled: false };
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
  };
}

/**
 * WebP is roughly a third smaller than JPEG at the same perceived quality, so
 * it is worth using where it is understood. PNG is kept for anything with
 * transparency — re-encoding a logo to JPEG paints a black box behind it.
 */
export function chooseFormat(sourceType: string, canEncodeWebp: boolean): string {
  if (sourceType === "image/svg+xml") return sourceType; // vector: already small, do not rasterize
  if (sourceType === "image/gif") return sourceType;     // may be animated; canvas would flatten it
  if (canEncodeWebp) return "image/webp";
  if (sourceType === "image/png") return "image/png";
  return "image/jpeg";
}

/** True when this browser can actually produce the format, not just accept it. */
export function canvasSupportsWebp(): boolean {
  try {
    const probe = document.createElement("canvas");
    probe.width = 1; probe.height = 1;
    return probe.toDataURL("image/webp").startsWith("data:image/webp");
  } catch { return false; }
}

export interface CompressResult {
  blob: Blob;
  width: number;
  height: number;
  /** False when the original was already small enough and was left alone. */
  changed: boolean;
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>(resolve => canvas.toBlob(b => resolve(b), type, quality));

/**
 * Downscales and re-encodes until the result fits the budget, or until quality
 * would drop below the point where the image stops being worth having.
 * Returns the original untouched when it is already small enough, when the
 * format should not be re-encoded, or when anything at all goes wrong —
 * a failed optimisation must never cost the user their image.
 */
export async function compressImage(
  file: Blob,
  { targetBytes = TARGET_BYTES, maxEdge = MAX_EDGE }: { targetBytes?: number; maxEdge?: number } = {},
): Promise<CompressResult> {
  const untouched = (): CompressResult => ({ blob: file, width: 0, height: 0, changed: false });

  const format = chooseFormat(file.type, canvasSupportsWebp());
  if (format === "image/svg+xml" || format === "image/gif") return untouched();

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return untouched();
  }

  try {
    const fit = fitWithin(bitmap.width, bitmap.height, maxEdge);
    // Already small on both counts: re-encoding would only lose information.
    if (!fit.scaled && file.size <= targetBytes) return untouched();

    const canvas = document.createElement("canvas");
    canvas.width = fit.width;
    canvas.height = fit.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return untouched();
    ctx.drawImage(bitmap, 0, 0, fit.width, fit.height);

    let best: Blob | null = null;
    for (const quality of QUALITY_LADDER) {
      const blob = await toBlob(canvas, format, quality);
      if (!blob) continue;
      best = blob;
      if (blob.size <= targetBytes) break;
    }
    // Handing back something larger than we were given would be absurd.
    if (!best || best.size >= file.size) return untouched();
    return { blob: best, width: fit.width, height: fit.height, changed: true };
  } catch {
    return untouched();
  } finally {
    bitmap.close?.();
  }
}

/** Reads a Blob as a data: URL, the shape /api/assets/upload expects. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(blob);
  });
}

/**
 * The whole browser-side path in one call: shrink, then hand back the data URL
 * that /api/assets/upload expects, plus a line describing what happened for
 * anywhere that wants to tell the user.
 */
export async function prepareImageForUpload(
  file: Blob,
  options?: { targetBytes?: number; maxEdge?: number },
): Promise<{ dataUrl: string; bytes: number; note: string }> {
  const before = file.size;
  const result = await compressImage(file, options);
  const dataUrl = await blobToDataUrl(result.blob);
  const note = result.changed
    ? `Optimizada: ${formatBytes(before)} → ${formatBytes(result.blob.size)} (${result.width}×${result.height})`
    : `Sin cambios: ${formatBytes(before)}`;
  return { dataUrl, bytes: result.blob.size, note };
}

/** Human-readable size, for messages that have to justify what just happened. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
