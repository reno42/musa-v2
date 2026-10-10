/**
 * Worker del buscatrazos local (REQ-043 Fase 1): corre traceImage fuera del
 * hilo principal para que trazos de muchos anchors no congelen el editor.
 * Cancelable entre capas vía mensaje { kind: "cancel" }.
 */

import { traceImage } from "../lib/trace/index.ts";
import type { TraceWorkerRequest, TraceWorkerResponse } from "../lib/traceProtocol.ts";

let activeJob = 0;
let cancelled = false;

self.onmessage = (e: MessageEvent<TraceWorkerRequest>) => {
  const msg = e.data;
  if (msg.kind === "cancel") {
    if (msg.jobId === activeJob) cancelled = true;
    return;
  }
  const { jobId, raster, params, maxAnchors } = msg;
  activeJob = jobId;
  cancelled = false;
  const post = (response: TraceWorkerResponse, transfer: Transferable[] = []): void => {
    (self as unknown as Worker).postMessage(response, transfer);
  };
  // Defer one tick so the cancel message for a previous job can't be
  // mistaken for this one (messages arrive in order, but be explicit).
  setTimeout(() => {
    try {
      const outcome = traceImage(
        { width: raster.width, height: raster.height, rgba: raster.rgba },
        params,
        maxAnchors,
        fraction => post({ kind: "progress", jobId, fraction }),
        () => cancelled,
      );
      post({ kind: "done", jobId, outcome });
    } catch (err) {
      post({ kind: "error", jobId, error: err instanceof Error ? err.message : String(err) });
    } finally {
      activeJob = 0;
    }
  }, 0);
};
