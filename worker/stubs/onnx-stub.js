// Stub: onnxruntime (segmentacion de fondo IA) no corre en Workers free (limite CPU 10ms).
function unavailable() { throw new Error("AI background removal no disponible en Cloudflare (limite CPU free tier)"); }
export const InferenceSession = { create: unavailable };
export const Tensor = unavailable;
export const env = {};
export default { InferenceSession, Tensor, env };
