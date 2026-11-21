// Proxy de assets de Supabase Storage con URL estable + cache del navegador.
// ROOT CAUSE (egress 12.41 GB / 5.5 GB, deadline 23-nov-2026): cada visualización
// de un asset pedía una signed URL NUEVA (token distinto cada vez) → el navegador
// nunca cachea → el MISMO archivo se re-embarca desde Supabase cientos de veces.
// FIX: el worker devuelve /sa/<bucket>/<path>?t=<hmac>&e=<exp>. La URL es estable
// por archivo (mismo path + mismo hmac hasta expirar) → el navegador la cachea con
// Cache-Control immutable → segundas vistas = 0 bytes desde Supabase.
// Seguridad: equivalente al signed URL de Supabase — el acceso sigue limitado por
// tiempo (HMAC con secreto del worker) y el bucket sigue privado.
//
// GET /sa/design-assets/ws_xxx/asset_y.png?t=...&e=179...
//   e  = expiración (unix seg). t = HMAC-SHA256(secret, `${bucket}/${path}@${e}`)[0..31 hex]

const enc = new TextEncoder();

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
}

export function assetSecret(env) {
  return env.MUSA_ASSET_SECRET || env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY || "musa-dev";
}

/** URL estable que el worker sirve con cache inmutable. TTL default 30 días. */
export async function stableAssetUrl(env, bucket, path, ttlSec = 2_592_000) {
  const e = Math.floor(Date.now() / 1000) + ttlSec;
  const t = await hmac(assetSecret(env), `${bucket}/${path}@${e}`);
  return `/sa/${bucket}/${path}?t=${t}&e=${e}`;
}

export async function handleAssetProxy(request, env, url) {
  const m = /^\/sa\/([a-z0-9-]+)\/(.+)$/.exec(url.pathname);
  if (!m) return new Response("Bad asset path", { status: 400, headers: { "cache-control": "no-store" } });
  const [, bucket, path] = m;
  if (!["design-assets", "design-covers", "custom-fonts"].includes(bucket)) {
    return new Response("Bucket not allowed", { status: 403, headers: { "cache-control": "no-store" } });
  }
  const t = url.searchParams.get("t") || "";
  const e = Number(url.searchParams.get("e") || 0);
  if (!t || !e) return new Response("Missing token", { status: 403, headers: { "cache-control": "no-store" } });
  if (e < Math.floor(Date.now() / 1000)) return new Response("Link expired", { status: 410, headers: { "cache-control": "no-store" } });
  const expect = (await hmac(assetSecret(env), `${bucket}/${path}@${e}`)).slice(0, 32);
  if (t !== expect) return new Response("Bad token", { status: 403, headers: { "cache-control": "no-store" } });

  const sk = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_KEY;
  const base = env.SUPABASE_URL || "";
  if (!sk || !base) return new Response("Storage not configured", { status: 500, headers: { "cache-control": "no-store" } });
  const upstream = await fetch(`${base}/storage/v1/object/${bucket}/${path}`, {
    headers: { Authorization: `Bearer ${sk}` },
  });
  if (!upstream.ok || !upstream.body) {
    return new Response(upstream.ok ? "Empty asset" : "Asset not found", {
      status: upstream.status === 400 ? 404 : upstream.status,
      headers: { "cache-control": "no-store" },
    });
  }
  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") || "application/octet-stream");
  const len = upstream.headers.get("content-length");
  if (len) headers.set("content-length", len);
  // Path determinista (asset_<ts>_<rand>): el contenido NUNCA cambia → immutable seguro.
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("etag", `"${t}"`);
  headers.set("x-robots-tag", "noindex");
  return new Response(upstream.body, { status: 200, headers });
}
