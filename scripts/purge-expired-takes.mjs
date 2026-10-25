/**
 * REQ-058 — Barrido manual de tomas vencidas (decisión: NO cronjob).
 *
 * Ren lo corre los fines de semana (o cuando quiera liberar el cupo):
 *
 *   node scripts/purge-expired-takes.mjs             # purga real
 *   node scripts/purge-expired-takes.mjs --dry-run   # solo lista
 *
 * Qué hace:
 *   1. Lista musa_video_takes con state <> 'purged' AND expires_at < NOW()
 *      (incluye zombies 'uploading' cuyo PUT nunca llegó — el DELETE en R2
 *      tolera el 404 y la fila queda como tumba).
 *   2. Borra cada objeto en R2 (SigV4, r2-presign.mjs — mismo módulo del
 *      handler, sin binding).
 *   3. Marca state='purged' (tumba de auditoría; los bytes ya no existen).
 *
 * La expiración es LAZY: entre sweeps la toma vencida ya desaparece del
 * listado y no se puede descargar (video-takes.mjs), así la promesa de 24 h
 * se cumple aunque este script corrase una vez al mes.
 *
 * Secretos: shell primero, luego .env.design-supabase (convención de
 * fetch-segment-models.mjs). Necesita SUPABASE_URL + clave service y las
 * cuatro R2_* (ver docs/REQ-058). PostgREST REST crudo — NO el SDK:
 * las claves sb_secret_ nuevas rompen el path de objeto del SDK
 * ("Invalid Compact JWS"); la clave en apikey + Authorization funciona
 * (probe-verified).
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { r2ConfigFromEnv, deleteR2Object } from "../worker/runtime/functions/r2-presign.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DRY_RUN = process.argv.includes("--dry-run");

function log(msg) {
  console.log(`[purge-takes] ${msg}`);
}

function humanBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function readEnvFile() {
  try {
    const txt = readFileSync(resolve(ROOT, ".env.design-supabase"), "utf-8");
    const out = {};
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].trim();
    }
    return out;
  } catch { return {}; }
}

const envFile = readEnvFile();
const mergedEnv = { ...envFile, ...process.env };

// URL y clave de la MISMA fuente (convención probe-verified: shell puede
// exportar una SUPABASE_URL de otro proyecto que no matchea la key del file).
const shellKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PAT || "";
const SUPABASE_URL = shellKey ? process.env.SUPABASE_URL : envFile.SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = shellKey || envFile.SUPABASE_SECRET_KEY || envFile.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("[purge-takes] Faltan SUPABASE_URL + clave service (shell o .env.design-supabase).");
  process.exit(2);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

const r2Config = r2ConfigFromEnv(mergedEnv);
if (!r2Config && !DRY_RUN) {
  console.error("[purge-takes] Faltan R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY (shell o .env.design-supabase).");
  process.exit(2);
}

// 1. Vencidas no purgadas (más viejas primero).
const nowIso = new Date().toISOString();
const q = `${SUPABASE_URL}/rest/v1/musa_video_takes` +
  `?select=id,workspace_id,r2_key,state,size_bytes,expires_at` +
  `&state=neq.purged&expires_at=lt.${encodeURIComponent(nowIso)}` +
  `&order=expires_at.asc`;
const res = await fetch(q, { headers: H });
if (!res.ok) {
  console.error(`[purge-takes] Query falló: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}
const expired = await res.json();
if (!expired.length) {
  log("Nada que purgar: no hay tomas vencidas.");
  process.exit(0);
}

const totalBytes = expired.reduce((acc, t) => acc + (Number(t.size_bytes) || 0), 0);
log(`${expired.length} toma(s) vencida(s), ${humanBytes(totalBytes)} en disco${DRY_RUN ? " (--dry-run: no se borra nada)" : ""}`);

let purged = 0;
let failed = 0;

for (const take of expired) {
  const size = Number(take.size_bytes) || 0;
  if (DRY_RUN) {
    log(`  [dry] ${take.id} (${take.state}, ${humanBytes(size)}) — ${take.r2_key}`);
    continue;
  }
  try {
    // 2. Borra el objeto (404 tolerado — zombies uploading).
    await deleteR2Object(r2Config, take.r2_key);
  } catch (e) {
    failed += 1;
    log(`  ERROR borrando ${take.id}: ${e.message} — la fila NO se marca purged`);
    continue;
  }
  // 3. Tumba de auditoría.
  const patch = await fetch(
    `${SUPABASE_URL}/rest/v1/musa_video_takes?id=eq.${encodeURIComponent(take.id)}`,
    { method: "PATCH", headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify({ state: "purged" }) },
  );
  if (!patch.ok) {
    failed += 1;
    log(`  ERROR marcando purged ${take.id}: HTTP ${patch.status} (objeto ya borrado en R2)`);
    continue;
  }
  purged += 1;
  log(`  purgada ${take.id} (${take.state}, ${humanBytes(size)})`);
}

if (DRY_RUN) {
  log(`Dry-run listo: ${expired.length} purgable(s). Quita --dry-run para purgar.`);
} else {
  log(`Listo: ${purged} purgada(s), ${failed} falla(s). Cupo liberado: ${humanBytes(totalBytes)} en el peor caso.`);
}
