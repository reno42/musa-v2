/**
 * cmykEngine — cliente del worker de imprenta (lado UI). Un solo worker
 * vivo por pestaña, jobs con id correlativo, y el contrato de
 * printProtocol. El worker carga el motor lazy (descarga gs.wasm con
 * progreso la primera vez; el navegador lo cachea sin expiración — REQ F2:
 * sin gestión manual de cache, el fallback es re-descargar).
 *
 * loadPrintManifest consulta /assets/print-engine/manifest.json (escrito por
 * scripts/fetch-print-assets.mjs en build) para saber qué perfiles CMYK
 * están realmente disponibles — la UI deshabilita el resto en vez de fallar
 * a mitad del job.
 */
import type { PrintProfileId, PrintEngineManifest } from "./printExport.ts";
import { PRINT_ENGINE_BASE } from "./printExport.ts";
import type { PrintWorkerRequest, PrintWorkerResponse, SeparationsResult } from "./printProtocol.ts";

type Pending = {
  resolve: (bytes: ArrayBuffer, mime: string) => void;
  /** Jobs "separations" resuelven por aquí (4 placas, no bytes únicos). */
  resolvePlates?: (result: SeparationsResult) => void;
  reject: (err: Error) => void;
  onEngineProgress?: (loaded: number, total: number) => void;
};

let worker: Worker | null = null;
let nextJobId = 1;
const pending = new Map<number, Pending>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/ghostscript.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<PrintWorkerResponse>) => {
    const msg = e.data;
    if (msg.kind === "engine-progress") {
      // Progreso global: cualquier listener pendiente lo recibe (el worker
      // lo emite con jobId -1 durante la primera descarga).
      for (const p of pending.values()) p.onEngineProgress?.(msg.loaded, msg.total);
      return;
    }
    if (msg.kind !== "job-done" && msg.kind !== "job-error" && msg.kind !== "separations-done") return;
    const entry = pending.get(msg.jobId);
    if (!entry) return;
    pending.delete(msg.jobId);
    if (msg.kind === "job-done") entry.resolve(msg.bytes, msg.mime);
    else if (msg.kind === "separations-done") entry.resolvePlates?.(msg.result);
    else entry.reject(new Error(msg.error));
  };
  worker.onerror = e => {
    // Error no capturado del worker (carga del script, OOM del wasm…):
    // fallan todos los jobs pendientes y el worker se descarta.
    const err = new Error(e.message || "Fallo del motor de imprenta");
    for (const [, p] of pending) p.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function postJob(req: PrintWorkerRequest, onEngineProgress?: (loaded: number, total: number) => void): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const w = ensureWorker();
  return new Promise((resolve, reject) => {
    pending.set(req.jobId, { resolve: (bytes, mime) => resolve({ bytes, mime }), resolvePlates: () => { /* los jobs separations no pasan por postJob */ }, reject, onEngineProgress });
    if (req.kind === "init" || req.kind === "convert" || req.kind === "proof") {
      const transfer: Transferable[] = [];
      if (req.kind !== "init") { transfer.push(req.pdfBytes, req.iccBytes); }
      w.postMessage(req, transfer);
    }
  });
}

// REQ-027 BUG hang imprenta: techo de tiempo para jobs que pueden quedarse
// colgados sin rechazar (el caso raíz era el instantiateWasm fire-and-forget
// del worker, pero cualquier cuelgue futuro cae aquí). 60s cubre la primera
// descarga (~16MB) + compilación WASM en máquinas lentas; el navegador cachea
// lo ya descargado, así que el reintento retoma desde el cache.
export const PRINT_ENGINE_TIMEOUT_MS = 60_000;

/** Carrera contra un techo: rechaza con `message` si `promise` no resuelve
 *  en `ms`. Pure/apta para QA en Node (sin DOM). */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, ceiling]).finally(() => clearTimeout(timer));
}

/** Prepara el motor (descarga + init) sin convertir nada — para el estado
 *  "Preparando motor de imprenta…" antes del primer frame. Rechaza a los
 *  PRINT_ENGINE_TIMEOUT_MS si el motor no respondió, y deja el flag
 *  print_engine_ready en localStorage tras un init exitoso. */
export async function ensurePrintEngine(onProgress?: (loaded: number, total: number) => void): Promise<void> {
  try {
    await withTimeout(
      postJob({ kind: "init", jobId: nextJobId++ }, onProgress),
      PRINT_ENGINE_TIMEOUT_MS,
      `El motor de imprenta no respondió en ${Math.round(PRINT_ENGINE_TIMEOUT_MS / 1000)}s. La primera vez descarga ~16MB — revisa tu conexión y reintenta: lo ya descargado queda cacheado por el navegador.`,
    );
  } catch (err) {
    // El job puede seguir vivo por debajo (no hay cancelación); sólo
    // garantizamos que el flag de "listo" no mienta.
    try { localStorage.removeItem("print_engine_ready"); } catch { /* storage bloqueado */ }
    throw err;
  }
  try { localStorage.setItem("print_engine_ready", "1"); } catch { /* storage bloqueado */ }
}

export interface CmykJob {
  pdfBytes: ArrayBuffer;
  iccBytes: ArrayBuffer;
  iccName: string;
  /** REQ F2: condición de impresión a incrustar como /OutputIntents (ej.
   *  "ISO Coated v2 300% (ECI)"). Ausente = PDF tal como sale de pdfwrite. */
  outputConditionIdentifier?: string;
  outputConditionInfo?: string;
  onEngineProgress?: (loaded: number, total: number) => void;
}

/** PDF RGB 300dpi → PDF DeviceCMYK con el OutputIntent del perfil. */
export async function convertPdfToCmyk(job: CmykJob): Promise<ArrayBuffer> {
  const { bytes } = await postJob(
    {
      kind: "convert", jobId: nextJobId++,
      pdfBytes: job.pdfBytes, iccBytes: job.iccBytes, iccName: job.iccName,
      outputConditionIdentifier: job.outputConditionIdentifier,
      outputConditionInfo: job.outputConditionInfo,
    },
    job.onEngineProgress,
  );
  return bytes;
}

/** Soft-proof (Fase 3): render PNG del PDF CMYK — muestra los colores como
 *  caerán a imprenta. renderDpi controla el tamaño del preview. */
export async function renderSoftProof(job: CmykJob & { renderDpi: number }): Promise<Blob> {
  const { bytes } = await postJob(
    { kind: "proof", jobId: nextJobId++, pdfBytes: job.pdfBytes, iccBytes: job.iccBytes, iccName: job.iccName, renderDpi: job.renderDpi },
    job.onEngineProgress,
  );
  return new Blob([bytes], { type: "image/png" });
}

/** Separaciones C/M/Y/K (paridad parcial con Separations Preview): el PDF
 *  CMYK se rasteriza con pamcmyk32 y el worker parte la tira en 4 placas de
 *  cobertura de tinta. Falla amable si el build no trae el dispositivo. */
export function renderSeparations(job: CmykJob & { renderDpi: number }): Promise<SeparationsResult> {
  const w = ensureWorker();
  const jobId = nextJobId++;
  return new Promise<SeparationsResult>((resolve, reject) => {
    pending.set(jobId, {
      resolve: () => { /* separations resuelve por resolvePlates */ },
      resolvePlates: resolve,
      reject,
      onEngineProgress: job.onEngineProgress,
    });
    w.postMessage(
      { kind: "separations", jobId, pdfBytes: job.pdfBytes, iccBytes: job.iccBytes, iccName: job.iccName, renderDpi: job.renderDpi },
      [job.pdfBytes, job.iccBytes],
    );
  });
}

/** null = sin manifest (motor no instalado en este deploy). */
export async function loadPrintManifest(): Promise<PrintEngineManifest | null> {
  try {
    const res = await fetch(`${PRINT_ENGINE_BASE}/manifest.json`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json() as PrintEngineManifest;
  } catch {
    return null;
  }
}

export function engineAvailable(manifest: PrintEngineManifest | null): boolean {
  return Boolean(manifest?.engine.ok);
}

export function profileIccAvailable(manifest: PrintEngineManifest | null, profile: PrintProfileId): boolean {
  return Boolean(manifest?.profiles?.[profile]?.ok);
}
