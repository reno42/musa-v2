// Stub: sharp no disponible en Workers (binario nativo/WASM pesado)
export function __unavailable() { throw new Error("Module unavailable in Cloudflare Workers"); }
export default new Proxy({}, { get() { return __unavailable; } });
