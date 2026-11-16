/* Motor de vectorizado para el navegador (editor de video de la maqueta): el mismo que usa el servidor
   (src/lib/trace + vectorize-modes). Así vectorizar no depende de los límites del plan gratis de Workers. */
import { traceImage } from "../src/lib/trace/index.ts";
import { normalizeTraceParams } from "../src/lib/trace/params.ts";
import { traceParams, colorLayers } from "../worker/runtime/functions/vectorize-modes.mjs";
self.MusaTrace = { traceImage, normalizeTraceParams, traceParams, colorLayers };
