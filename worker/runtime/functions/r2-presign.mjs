/**
 * REQ-058 — Presign SigV4 para R2 vía el endpoint S3-compatible.
 *
 * Por qué y no un binding R2: los handlers standalone (worker/runtime/functions)
 * no reciben `env` (callHandler no lo pasa) — solo process.env. Con el
 * endpoint S3 (`https://{account}.r2.cloudflarestorage.com/{bucket}/...`) y
 * secretos R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY, presignar URLs y operar
 * objetos no necesita binding NI cambios en wrangler.toml — y el MISMO
 * módulo sirve al barrido manual de `scripts/purge-expired-takes.mjs`
 * (Node ≥18 tiene globalThis.crypto.subtle igual que el Workers runtime).
 *
 * Solo presign por query string (X-Amz-Signature en URL): es lo que el
 * navegador necesita para el PUT directo y lo más simple para HEAD/DELETE
 * server-side. Región "auto" es la única que R2 reconoce.
 *
 * Honesty rules: sin I/O salvo quien llama; los secretos jamás van en la
 * URL firmada (solo el credential prefijo y la firma del request).
 */

/** Credenciales desde env — null si falta algo (el caller responde 503). */
export function r2ConfigFromEnv(env = process.env) {
  const accountId = env.R2_ACCOUNT_ID || "";
  const accessKeyId = env.R2_ACCESS_KEY_ID || "";
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY || "";
  const bucket = env.R2_TAKES_BUCKET || "video-takes";
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    host: `${accountId}.r2.cloudflarestorage.com`,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  };
}

const enc = new TextEncoder();

async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, "sign");
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
  return new Uint8Array(sig);
}

async function sha256Hex(data) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(data));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** URI-encode estilo SigV4: todo excepto A-Za-z0-9-._~ se %XX-escapea. */
function uriEncode(value, encodeSlash = true) {
  let out = "";
  for (const ch of value) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) out += ch;
    else if (ch === "/") out += encodeSlash ? "%2F" : "/";
    else out += [...new TextEncoder().encode(ch)].map(b => `%${b.toString(16).padStart(2, "0").toUpperCase()}`).join("");
  }
  return out;
}

function amzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/**
 * Construye una URL presigned (query-string SigV4) para el método y llave.
 * method: "PUT" | "GET" | "HEAD" | "DELETE". expiresInSeg: máximo 7 días.
 */
export async function presignR2Url(config, method, r2Key, expiresInSeg, nowDate = new Date()) {
  const dateStamp = amzDate(nowDate).slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const canonicalUri = `/${config.bucket}/${uriEncode(r2Key, false)}`;
  const query = new Map([
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${config.accessKeyId}/${scope}`],
    ["X-Amz-Date", amzDate(nowDate)],
    ["X-Amz-Expires", String(Math.min(Math.max(1, expiresInSeg), 604800))],
    ["X-Amz-SignedHeaders", "host"],
  ]);
  const canonicalQuery = [...query.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    `host:${config.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    query.get("X-Amz-Date"),
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const kDate = await hmac(`AWS4${config.secretAccessKey}`, dateStamp);
  const kRegion = await hmac(new TextDecoder().decode(kDate), "auto");
  const kService = await hmac(new TextDecoder().decode(kRegion), "s3");
  const kSigning = await hmac(new TextDecoder().decode(kService), "aws4_request");
  const kHex = [...kSigning].map(b => b.toString(16).padStart(2, "0")).join("");
  const k = await crypto.subtle.importKey("raw", enc.encode(kHex), { name: "HMAC", hash: "SHA-256" }, false, "sign");
  const signature = [...new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(stringToSign)))]
    .map(b => b.toString(16).padStart(2, "0")).join("");
  return `${config.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** DELETE server-side de un objeto (barrido manual / delete del usuario). */
export async function deleteR2Object(config, r2Key) {
  const url = await presignR2Url(config, "DELETE", r2Key, 120);
  const res = await fetch(url, { method: "DELETE" });
  // 204 esperado; 404 tolerable (objeto ya no existe — el resultado pedido).
  if (!res.ok && res.status !== 404) {
    throw new Error(`R2_DELETE_FAILED (${res.status})`);
  }
  return true;
}

/** HEAD server-side para verificar que el PUT del navegador terminó bien. */
export async function headR2Object(config, r2Key) {
  const url = await presignR2Url(config, "HEAD", r2Key, 120);
  const res = await fetch(url, { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2_HEAD_FAILED (${res.status})`);
  return { size: Number(res.headers.get("content-length") || 0) };
}
