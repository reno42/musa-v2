/**
 * Cliente del buscatrazos local (REQ-043 Fase 1). Lanza traceImage en el
 * worker (fuera del hilo principal) con fallback síncrono cuando no hay
 * Worker (tests Node, entornos sin módulos de worker). La cancelación viaja
 * por un signal plano { aborted } — sin dependencias.
 */

import type { Raster } from "./trace/quantize.ts";
import type { TraceParams } from "./trace/params.ts";
import { traceImage, type TraceOutcome } from "./trace/index.ts";
import type { TraceWorkerRequest, TraceWorkerResponse } from "./traceProtocol.ts";

export interface TraceRunOptions {
  /** Techo de anchors totales (TooComplex al pasarse). */
  maxAnchors?: number;
  onProgress?: (fraction: number) => void;
  /** Cancelación cooperativa (se comprueba entre capas). */
  signal?: { aborted: boolean };
  /** Techo de tiempo del job en worker (ms). Default 120_000. */
  timeoutMs?: number;
}

/** Versión síncrona (misma lógica en el hilo llamador; útil en tests). */
export function traceRasterSync(img: Raster, params: TraceParams, opts: TraceRunOptions = {}): TraceOutcome {
  const signal = opts.signal;
  return traceImage(img, params, opts.maxAnchors, opts.onProgress, signal ? () => signal.aborted : undefined);
}

let worker: Worker | null = null;
let nextJobId = 1;

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("../workers/trace.worker.ts", import.meta.url), { type: "module" });
  return worker;
}

function dropWorker(): void {
  worker?.terminate();
  worker = null;
}

/**
 * Traza `img` según `params`. Usa el worker cuando existe; si no, corre
 * síncrono. Rechaza (no TraceFailure) solo en fallos de infraestructura:
 * worker caído o timeout — el resultado del trace viaja como TraceOutcome.
 */
export async function traceRaster(img: Raster, params: TraceParams, opts: TraceRunOptions = {}): Promise<TraceOutcome> {
  if (typeof Worker === "undefined") return traceRasterSync(img, params, opts);
  const jobId = nextJobId++;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return new Promise<TraceOutcome>((resolve, reject) => {
    const w = ensureWorker();
    let settled = false;
    const finish = (): void => {
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      w.removeEventListener("message", onMessage);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      finish();
      dropWorker();
      reject(new Error("El trace tardó demasiado y se detuvo (timeout del worker)."));
    }, timeoutMs);
    // Cancel: poll plano del signal (el worker también lo comprueba entre
    // capas; esto cubre la espera antes de que el job arranque).
    const poll = setInterval(() => {
      if (!opts.signal?.aborted) return;
      w.postMessage({ kind: "cancel", jobId } satisfies TraceWorkerRequest);
    }, 50);
    const onMessage = (e: MessageEvent<TraceWorkerResponse>) => {
      const msg = e.data;
      if (msg.jobId !== jobId) return;
      if (msg.kind === "progress") {
        opts.onProgress?.(msg.fraction);
        return;
      }
      finish();
      if (msg.kind === "done") {
        resolve(msg.outcome);
        return;
      }
      // Un worker que lanza queda en estado dudoso: se descarta.
      dropWorker();
      reject(new Error(msg.error));
    };
    w.addEventListener("message", onMessage);
    w.onerror = () => {
      if (settled) return;
      finish();
      dropWorker();
      reject(new Error("El worker de buscatrazos falló al arrancar."));
    };
    // Copia el raster: el buffer transferido queda detached y el llamador
    // puede querer reutilizar su imagen.
    const rgba = new Uint8ClampedArray(img.rgba);
    const req: TraceWorkerRequest = {
      kind: "trace",
      jobId,
      raster: { width: img.width, height: img.height, rgba },
      params,
      maxAnchors: opts.maxAnchors ?? 200_000,
    };
    w.postMessage(req, [rgba.buffer]);
  });
}
