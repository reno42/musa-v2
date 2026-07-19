// s02_crypto_bug.mjs — ITEM 2 (CRYPTO-BUG):
// create_api_key → ¿error -32000 "crypto.createHash is not a function"?
// Si devuelve una key: probarla en tools/call (¿200 o 401?) y revocarla.
// Sin admin key local: solo es alcanzable si prod está en accept-all (dev mode → isAdmin=true).
import { tool, saveEvidence, summarizeToolResp, truncate, redact, verdict, KEY_INFO, EFFECTIVE_KEY } from "./lib/client.mjs";

console.log("== s02 CRYPTO-BUG ==");
console.log("  Keys locales:", JSON.stringify(KEY_INFO));

const ev = {};

// 1) create_api_key con la key efectiva si existe; si no, sin key (cubre ambos modos).
const r = await tool("create_api_key", { label: "verify-b-crypto-probe" }, { apiKey: EFFECTIVE_KEY || undefined });
ev.create_api_key = summarizeToolResp(r, 2000);
console.log("  create_api_key → HTTP", r.httpStatus, r.error ? `error ${r.error.code}: ${truncate(r.error.message, 200)}` : "sin error RPC");

const cryptoBug = r.error && /crypto\.createHash is not a function/i.test(r.error.message || "");
verdict("¿Error crypto.createHash?", cryptoBug, r.error ? truncate(r.error.message, 200) : "(sin error)");

let createdKey = r.parsed?.key || null;
let createdKeyId = r.parsed?.id || null;

if (createdKey) {
  console.log("  → create_api_key DEVOLVIÓ una key (bug del createHash NO reproduce en esta ruta). Probándola…");
  // 2) Usar la key recién creada en un tools/call normal
  const probe = await tool("list_workspaces", {}, { apiKey: createdKey });
  ev.use_created_key = { httpStatus: probe.httpStatus, rpcError: probe.error || null, textTruncated: probe.text ? truncate(redact(probe.text), 800) : undefined };
  verdict("tools/call con key creada", true, `HTTP ${probe.httpStatus}${probe.error ? " RPC " + probe.error.code : ""}`);
  console.log("  → Afirmación 'keys no-admin siempre 401':", probe.httpStatus === 401 ? "VERIFICADA" : "REFUTADA (200)");

  // 3) Revocar lo creado (con la key efectiva/admin)
  const rev = await tool("revoke_api_key", { keyId: createdKeyId }, { apiKey: EFFECTIVE_KEY || undefined });
  ev.revoke = summarizeToolResp(rev, 800);
  verdict("revoke_api_key", !rev.error, rev.error ? truncate(rev.error.message, 150) : "ok");
} else {
  console.log("  → No se creó ninguna key; nada que probar ni revocar.");
  if (r.httpStatus === 401) {
    console.log("  → 401: se requiere admin key y NO hay key local disponible → item parcialmente NO VERIFICADO.");
  }
}

ev.conclusion = cryptoBug
  ? "VERIFICADO: create_api_key falla con crypto.createHash is not a function"
  : r.httpStatus === 401
    ? "NO VERIFICADO (sin admin key local; 401)"
    : createdKey
      ? "REFUTADO: create_api_key devolvió key"
      : "INCONCLUSO: " + truncate(r.error?.message || r.rawBody || "", 200);

saveEvidence("02-crypto-bug.json", ev);
console.log("  RESULTADO ITEM 2:", ev.conclusion);
