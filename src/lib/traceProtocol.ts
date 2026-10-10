/**
 * Mensajes entre el hilo principal y trace.worker.ts (buscatrazos local,
 * REQ-043 Fase 1). Contrato único compartido por traceClient.ts y el worker —
 * sin duplicar formas en ambos lados.
 */

import type { TraceParams } from "./trace/params.ts";
import type { TraceOutcome } from "./trace/index.ts";

export interface TraceRequestRaster {
  width: number;
  height: number;
  /** RGBA8, row-major (se transfiere, no se copia). */
  rgba: Uint8ClampedArray;
}

export type TraceWorkerRequest =
  /** Lanza un trace; el raster se transfiere al worker. */
  | { kind: "trace"; jobId: number; raster: TraceRequestRaster; params: TraceParams; maxAnchors: number }
  /** Cancela el job en curso (el worker lo comprueba entre capas). */
  | { kind: "cancel"; jobId: number };

export type TraceWorkerResponse =
  | { kind: "progress"; jobId: number; fraction: number }
  | { kind: "done"; jobId: number; outcome: TraceOutcome }
  | { kind: "error"; jobId: number; error: string };
