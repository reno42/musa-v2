#!/usr/bin/env node
/**
 * fetch-print-assets — deja en public/assets/print-engine/ todo lo que el
 * export de imprenta (Fase 2/3) carga lazy desde el navegador:
 *
 *   gs.wasm + gs.mjs + gs.js + browser.js   motor Ghostscript (WASM)
 *   icc/<perfil>.icc                        perfiles FOGRA39 / FOGRA29 / (GRACoL)
 *   manifest.json                           qué hay disponible (UI lo consulta)
 *
 * Idempotente: si un archivo ya está, no lo baja de nuevo. Las fuentes del
 * wasm son los archivos del paquete npm @jspawn/ghostscript-wasm (devDep) —
 * el worker los importa por URL cruda (sin bundler), igual que fueron
 * generados por Emscripten.
 *
 * LICENCIAS:
 * - Ghostscript es AGPL-3.0: este script copia su LICENSE junto al binario;
 *   el motor se distribuye como obra separada que el navegador del usuario
 *   descarga de /assets (no se enlaza en el bundle de la app).
 * - FOGRA39 (ISOcoated_v2_300_eci) y FOGRA29 (UncoatedFOGRA29): ECI los
 *   publica libremente; aquí se espejan desde un mirror público verificado.
 * - GRACoL2013 (CGATS21_CRPC7, Idealliance): redistribución con licencia —
 *   NO se descarga; si un operador coloca el .icc manualmente en icc/, el
 *   script lo detecta y el manifest lo habilita.
 *
 * Uso: node scripts/fetch-print-assets.mjs [--soft]
 *   --soft: si algo falta y no se puede descargar, WARN y manifest ok:false
 *           (usado desde prebuild); sin --soft falla duro.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT = resolve(ROOT, "public", "assets", "print-engine");
const PKG = resolve(ROOT, "node_modules", "@jspawn", "ghostscript-wasm");
const SOFT = process.argv.includes("--soft");

/** Perfil → candidatos [url, nombreFinal]. Primer 200 OK gana. */
const ICC_SOURCES = {
  fogra39: [{
    url: "https://raw.githubusercontent.com/adamcooke/lizard/master/colorspaces/CMYK/ISOcoated_v2_300_eci.icc",
    file: "ISOcoated_v2_300_eci.icc",
  }],
  iso_uncoated: [{
    url: "https://raw.githubusercontent.com/adamcooke/lizard/master/colorspaces/CMYK/UncoatedFOGRA29.icc",
    file: "UncoatedFOGRA29.icc",
  }],
  // Sin candidatos: solo colocación manual (licencia Idealliance).
  gracol2013: [],
};

const ENGINE_FILES = ["gs.wasm", "gs.mjs", "gs.js", "browser.js", "LICENSE"];

function fail(msg) {
  if (SOFT) {
    console.warn(`[fetch-print-assets] WARN: ${msg}`);
    return false;
  }
  console.error(`[fetch-print-assets] ERROR: ${msg}`);
  process.exitCode = 1;
  return false;
}

async function downloadTo(url, destFile) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error(`archivo sospechosamente chico (${buf.length}B) desde ${url}`);
  writeFileSync(destFile, buf);
  return buf.length;
}

async function main() {
  mkdirSync(resolve(OUT, "icc"), { recursive: true });
  const manifest = { engine: { file: "gs.wasm", ok: false }, profiles: {} };

  // ── Motor Ghostscript: copia local desde node_modules (sin red) ──
  for (const f of ENGINE_FILES) {
    const src = resolve(PKG, f);
    const dst = resolve(OUT, f);
    if (existsSync(dst)) continue;
    if (!existsSync(src)) {
      fail(`falta ${f} — instalá @jspawn/ghostscript-wasm (npm install)`);
      continue;
    }
    copyFileSync(src, dst);
  }
  const wasmBytes = existsSync(resolve(OUT, "gs.wasm")) ? 1 : 0;
  const glueOk = ["gs.mjs", "gs.js", "browser.js"].every(f => existsSync(resolve(OUT, f)));
  manifest.engine.ok = Boolean(wasmBytes && glueOk);
  if (!manifest.engine.ok) {
    fail("motor Ghostscript incompleto en public/assets/print-engine/");
  } else {
    console.log(`[fetch-print-assets] motor OK (gs.wasm ${(existsSync(resolve(OUT, "gs.wasm")) ? (readFileSync(resolve(OUT, "gs.wasm")).length / 1048576).toFixed(1) : "?")} MB)`);
  }

  // ── Perfiles ICC: download-once, con detección de colocación manual ──
  for (const [profileId, candidates] of Object.entries(ICC_SOURCES)) {
    const preferredFile = candidates[0]?.file;
    const probed = preferredFile || (profileId === "gracol2013" ? "CGATS21_CRPC7.icc" : `${profileId}.icc`);
    const dest = resolve(OUT, "icc", probed);
    if (existsSync(dest)) {
      manifest.profiles[profileId] = { file: probed, ok: true, bytes: readFileSync(dest).length };
      console.log(`[fetch-print-assets] icc ${profileId}: ${probed} (presente)`);
      continue;
    }
    let done = false;
    for (const { url, file } of candidates) {
      const dst = resolve(OUT, "icc", file);
      try {
        const bytes = await downloadTo(url, dst);
        manifest.profiles[profileId] = { file, ok: true, bytes };
        console.log(`[fetch-print-assets] icc ${profileId}: ${file} descargado (${(bytes / 1024).toFixed(0)} KB)`);
        done = true;
        break;
      } catch (err) {
        console.warn(`[fetch-print-assets] candidato falló: ${err.message}`);
      }
    }
    if (!done) {
      fail(`perfil ${profileId} no disponible — colocá el .icc manualmente en public/assets/print-engine/icc/${probed}`);
      manifest.profiles[profileId] = { file: probed, ok: false };
    }
  }

  writeFileSync(resolve(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`[fetch-print-assets] manifest.json escrito → public/assets/print-engine/`);
}

main().catch(err => {
  console.error(`[fetch-print-assets] ERROR inesperado: ${err.message}`);
  process.exitCode = 1;
});
