// Stub: sharp no disponible en Workers (binario nativo). El motor de
// segmentacion vive en un backend dedicado (ver wrangler.toml SEGMENT_ENGINE).
export function __unavailable() { throw new Error("Segmentation engine unavailable on this deployment (SEGMENT_ENGINE=off)"); }
export default function sharpStub() { return __unavailable(); }
