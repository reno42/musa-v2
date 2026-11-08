/**
 * Cifrado de tokens del Publisher: AES-256-GCM con WebCrypto.
 * La llave vive en el secret PUBLISHER_ENC_KEY del worker (32 bytes en base64).
 * Formato guardado: "p1.<iv base64url>.<cifrado+tag base64url>".
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
let cached: Promise<CryptoKey> | null = null;

function b64urlEncode(bytes: Uint8Array) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64Decode(s: string) {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "===".slice((norm.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function key(): Promise<CryptoKey> {
  if (cached) return cached;
  const raw = process.env.PUBLISHER_ENC_KEY || "";
  const bytes = raw ? b64Decode(raw.trim()) : new Uint8Array();
  if (bytes.length !== 32) throw new Error("Falta PUBLISHER_ENC_KEY (32 bytes en base64) en el servidor");
  cached = crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  return cached;
}

export async function seal(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), enc.encode(value)));
  return `p1.${b64urlEncode(iv)}.${b64urlEncode(ct)}`;
}

export async function open(payload: string | null | undefined): Promise<string | null> {
  if (!payload) return null;
  const [v, iv, ct] = payload.split(".");
  if (v !== "p1" || !iv || !ct) throw new Error("Token cifrado con un formato desconocido");
  const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64Decode(iv) }, await key(), b64Decode(ct));
  return dec.decode(clear);
}

export function randomToken(bytes = 32) {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verifier)));
  return b64urlEncode(digest);
}
