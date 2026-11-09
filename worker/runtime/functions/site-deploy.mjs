/* site-deploy.mjs — utilidades para subir un website a hosting externo y leer Google, sin dependencias.
 *   blake3Hex     hash BLAKE3 (el que usa Cloudflare Pages para identificar cada archivo; igual que blake3-wasm de wrangler)
 *   zipStore      zip sin compresión (Netlify acepta el sitio entero en un solo POST application/zip)
 *   googleToken   token de acceso de una cuenta de servicio de Google (JWT RS256 firmado con WebCrypto)
 */

/* ───────────── BLAKE3 (hash de 32 bytes) ───────────── */
const IV = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
const PERM = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
const CHUNK_START = 1, CHUNK_END = 2, PARENT = 4, ROOT = 8;
const rotr = (x, n) => (x >>> n) | (x << (32 - n));
function g(s, a, b, c, d, x, y) {
  s[a] = (s[a] + s[b] + x) | 0; s[d] = rotr(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) | 0; s[b] = rotr(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b] + y) | 0; s[d] = rotr(s[d] ^ s[a], 8);
  s[c] = (s[c] + s[d]) | 0; s[b] = rotr(s[b] ^ s[c], 7);
}
function compress(cv, m0, counter, len, flags) {
  const s = new Uint32Array(16);
  s.set(cv, 0); s.set(IV.subarray(0, 4), 8);
  s[12] = counter >>> 0; s[13] = Math.floor(counter / 4294967296) >>> 0; s[14] = len; s[15] = flags;
  let m = Uint32Array.from(m0);
  for (let r = 0; r < 7; r++) {
    g(s, 0, 4, 8, 12, m[0], m[1]); g(s, 1, 5, 9, 13, m[2], m[3]); g(s, 2, 6, 10, 14, m[4], m[5]); g(s, 3, 7, 11, 15, m[6], m[7]);
    g(s, 0, 5, 10, 15, m[8], m[9]); g(s, 1, 6, 11, 12, m[10], m[11]); g(s, 2, 7, 8, 13, m[12], m[13]); g(s, 3, 4, 9, 14, m[14], m[15]);
    if (r < 6) { const p = new Uint32Array(16); for (let i = 0; i < 16; i++) p[i] = m[PERM[i]]; m = p; }
  }
  for (let i = 0; i < 8; i++) { s[i] ^= s[i + 8]; s[i + 8] ^= cv[i]; }
  return s;
}
function words(bytes) {
  const w = new Uint32Array(16);
  for (let i = 0; i < bytes.length; i++) w[i >> 2] |= bytes[i] << ((i & 3) * 8);
  return w;
}
const chain = (n) => compress(n.cv, n.m, n.counter, n.len, n.flags).slice(0, 8);
const parent = (l, r) => { const m = new Uint32Array(16); m.set(l, 0); m.set(r, 8); return { cv: IV, m, counter: 0, len: 64, flags: PARENT }; };
export function blake3(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const nChunks = Math.max(1, Math.ceil(bytes.length / 1024));
  const stack = [];
  for (let ci = 0; ci < nChunks; ci++) {
    const chunk = bytes.subarray(ci * 1024, Math.min(bytes.length, (ci + 1) * 1024));
    const nBlocks = Math.max(1, Math.ceil(chunk.length / 64));
    let cv = IV, node = null;
    for (let bi = 0; bi < nBlocks; bi++) {
      const blk = chunk.subarray(bi * 64, Math.min(chunk.length, (bi + 1) * 64));
      const flags = (bi === 0 ? CHUNK_START : 0) | (bi === nBlocks - 1 ? CHUNK_END : 0);
      if (bi === nBlocks - 1) node = { cv, m: words(blk), counter: ci, len: blk.length, flags };
      else cv = compress(cv, words(blk), ci, 64, flags).slice(0, 8);
    }
    if (ci === nChunks - 1) {
      while (stack.length) node = parent(stack.pop(), chain(node));
      const out = compress(node.cv, node.m, 0, node.len, node.flags | ROOT);
      const res = new Uint8Array(32);
      for (let i = 0; i < 8; i++) { res[i * 4] = out[i] & 255; res[i * 4 + 1] = (out[i] >>> 8) & 255; res[i * 4 + 2] = (out[i] >>> 16) & 255; res[i * 4 + 3] = out[i] >>> 24; }
      return res;
    }
    let cvNew = chain(node), total = ci + 1;
    while ((total & 1) === 0) { cvNew = chain(parent(stack.pop(), cvNew)); total >>= 1; }
    stack.push(cvNew);
  }
}
export const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
export const blake3Hex = (input) => hex(blake3(input));

/* ───────────── base64 de texto o bytes ───────────── */
export function b64(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
/** Hash de Cloudflare Pages para un archivo: blake3(base64(contenido) + extensión).slice(0, 32) */
export function pagesHash(path, content) {
  const ext = (path.match(/\.([^./]+)$/) || [, ""])[1];
  return blake3Hex(b64(content) + ext).slice(0, 32);
}
export function mimeOf(path) {
  const ext = (path.match(/\.([^./]+)$/) || [, ""])[1].toLowerCase();
  return { html: "text/html", xml: "application/xml", txt: "text/plain", css: "text/css", js: "application/javascript", json: "application/json", svg: "image/svg+xml", md: "text/markdown" }[ext] || "application/octet-stream";
}

/* ───────────── zip sin compresión ───────────── */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
/** files: { "ruta/archivo.html": "contenido" } → Uint8Array con el .zip */
export function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const [name, content] of Object.entries(files)) {
    const nb = enc.encode(name), data = typeof content === "string" ? enc.encode(content) : content, crc = crc32(data);
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)];
    const local = new Uint8Array([...u32(0x04034b50), ...common]);
    parts.push(local, nb, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nb);
    offset += local.length + nb.length + data.length;
  }
  const cdSize = central.reduce((a, p) => a + p.length, 0), count = Object.keys(files).length;
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(count), ...u16(count), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

/* ───────────── Google: cuenta de servicio → token ───────────── */
const b64url = (input) => b64(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function parseServiceAccount(raw) {
  let sa = raw;
  if (typeof raw === "string") { try { sa = JSON.parse(raw); } catch { throw new Error("El JSON de la cuenta de servicio no es válido"); } }
  if (!sa || sa.type !== "service_account" || !sa.client_email || !/BEGIN PRIVATE KEY/.test(sa.private_key || "")) throw new Error("Eso no parece la llave JSON de una cuenta de servicio de Google (falta type, client_email o private_key)");
  return { client_email: sa.client_email, private_key: sa.private_key, project_id: sa.project_id || null };
}
export async function signJwtRS256(claims, pem) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const data = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." + b64url(JSON.stringify(claims));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(data)));
  return data + "." + b64url(sig);
}
export async function googleToken(sa, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await signJwtRS256({ iss: sa.client_email, scope: scopes.join(" "), aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }, sa.private_key);
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + jwt });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error("Google rechazó la cuenta de servicio: " + (j.error_description || j.error || r.status));
  return j.access_token;
}
