// Stub: ag-psd (import PSD) no disponible en Workers - feature deshabilitada en CF.
function unavailable() { throw new Error("PSD import no disponible en Cloudflare (fase migracion)"); }
export default new Proxy({}, { get() { return unavailable; } });
export { unavailable as readPsd };
