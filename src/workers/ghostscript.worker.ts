/**
 * ghostscript.worker — Fase 2/3 del export de imprenta. Corre el motor
 * Ghostscript (WASM, Emscripten MEMFS) FUERA del hilo de UI:
 *
 *   convert: PDF RGB (Fase 1, en memoria) → PDF DeviceCMYK con OutputIntent
 *            del perfil ICC elegido (pdfwrite + -sColorConversionStrategy).
 *   proof:   convert + segundo pase de render a PNG (png16m) — al rasterizar
 *            el PDF CMYK, que ya lleva el OutputIntent incrustado, el PNG
 *            muestra los colores tal como caerán a imprenta (soft-proof
 *            ICC-preciso sin mutar nada del diseño).
 *
 * El motor NO se importa en el bundle: se importa por URL cruda desde
 * /assets/print-engine/gs.mjs (tal como Emscripten lo generó — evitar el
 * puente globalThis.exports del paquete dentro de Rollup) y el .wasm se
 * baja aparte con progreso real (fetch + reader) para pasar wasmBinary.
 *
 * callMain es re-ejecutable en este build (EXIT_RUNTIME=0, retorno por
 * unwind), así que una sola instancia sirve a todos los frames del job.
 * Si un job falla de forma fatal, la instancia se descarta y la próxima
 * carga limpia — jamás un spinner infinito (REQ F2).
 */
/// <reference lib="webworker" />
import type { PrintWorkerRequest, PrintWorkerResponse } from "../lib/printProtocol.ts";
import { PRINT_ENGINE_BASE } from "../lib/printExport.ts";
import { embedOutputIntent } from "../lib/pdfOutputIntent.ts";

interface GsModule {
  FS: {
    writeFile(path: string, data: Uint8Array): void;
    readFile(path: string): Uint8Array;
    unlink(path: string): void;
  };
  callMain(args: string[]): number;
}

let enginePromise: Promise<GsModule> | null = null;

function post(msg: PrintWorkerResponse, transfer?: Transferable[]): void {
  (self as unknown as Worker).postMessage(msg, transfer || []);
}

async function loadEngine(): Promise<GsModule> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const res = await fetch(`${PRINT_ENGINE_BASE}/gs.wasm`);
      if (!res.ok) throw new Error(`Motor de imprenta no disponible (HTTP ${res.status})`);
      const total = Number(res.headers.get("content-length")) || 0;
      let wasmBinary: ArrayBuffer;
      if (res.body && total) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let loaded = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.length;
          post({ kind: "engine-progress", jobId: -1, loaded, total });
        }
        wasmBinary = await new Blob(chunks as BlobPart[]).arrayBuffer();
      } else {
        wasmBinary = await res.arrayBuffer();
      }
      const factory = ((await import(/* @vite-ignore */ `${PRINT_ENGINE_BASE}/gs.mjs`)) as { default: (opts: unknown) => Promise<GsModule> }).default;
      const errors: string[] = [];
      // instantiateWasm con los bytes YA descargados: el glue sin esto
      // re-fetchearía gs.wasm por su cuenta (doble descarga de 15MB) porque
      // el branch de streaming no consulta Module.wasmBinary.
      const wasmU8 = new Uint8Array(wasmBinary);
      const mod = await factory({
        instantiateWasm: (imports: WebAssembly.Imports, success: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) => {
<<<<<<< HEAD
          // REQ-027 (causa raíz del hang): hay que DEVOLVER la promesa. Antes
          // era fire-and-forget: si WebAssembly.instantiate rechazaba, nadie
          // rechazaba la factory y loadEngine quedaba colgado para siempre
          // (el diálogo, clavado en "Preparando…"). Devuelta, el rechazo sube
          // por el await de loadEngine hasta el job-error del onmessage y la
          // UI muestra el fallo; enginePromise.catch resetea el cache para
          // permitir reintento.
          return WebAssembly.instantiate(wasmU8, imports).then(out => {
            success(out.instance, out.module);
            return out.instance.exports;
          });
=======
          WebAssembly.instantiate(wasmU8, imports).then(out => success(out.instance, out.module));
          return {};
>>>>>>> 052554d (fix(worker): express-shim stall en success-path de asyncRoute (60s al crear API keys desde UI) + probes de fonts y shim)
        },
        print: () => { /* stdout de gs: ruido normal, no se reporta */ },
        printErr: (line: string) => { if (errors.length < 40) errors.push(line); },
      });
      (mod as GsModule & { __gsErrors?: string[] }).__gsErrors = errors;
      return mod;
    })();
    enginePromise.catch(() => { enginePromise = null; });
  }
  return enginePromise;
}

/** ArrayBuffer exacto para transferir (readFile puede devolver views). */
function exactBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength
    ? u8.buffer as ArrayBuffer
    : u8.slice().buffer as ArrayBuffer;
}

/** PDF RGB → CMYK. Devuelve el PDF convertido + el ICC tal como quedó en
 *  MEMFS: incrustar el OutputIntent (pdfOutputIntent) necesita el perfil
 *  DESPUÉS de pdfwrite, así que se lee antes del unlink. */
function runConvert(mod: GsModule, pdfBytes: ArrayBuffer, iccBytes: ArrayBuffer): { out: Uint8Array; icc: Uint8Array } {
  mod.FS.writeFile("/in.pdf", new Uint8Array(pdfBytes));
  mod.FS.writeFile("/icc.icc", new Uint8Array(iccBytes));
  const code = mod.callMain([
    "-dSAFER", "-dBATCH", "-dNOPAUSE",
    "-sDEVICE=pdfwrite",
    "-dProcessColorModel=/DeviceCMYK",
    "-sColorConversionStrategy=CMYK",
    "-sOutputICCProfile=/icc.icc",
    "-o", "/out.pdf",
    "/in.pdf",
  ]);
  // (este build no trae FS.analyzePath — readFile con try es el check)
  let out: Uint8Array | null = null;
  try { out = mod.FS.readFile("/out.pdf"); } catch { out = null; }
  let iccLeft: Uint8Array | null = null;
  try { iccLeft = mod.FS.readFile("/icc.icc"); } catch { iccLeft = null; }
  const usable = out !== null && code === 0;
  for (const f of ["/in.pdf", "/icc.icc", "/out.pdf"]) { try { mod.FS.unlink(f); } catch { /* ya no está */ } }
  if (!usable || !out) throw new Error(`Ghostscript no produjo salida (código ${code})`);
  if (!iccLeft) throw new Error("Ghostscript perdió el ICC en MEMFS");
  return { out, icc: iccLeft };
}

/** PAM P7 (salida de pamcmyk32): header ASCII "P7…ENDHDR\n" + w*h*4 bytes
 *  CMYK. Parte la tira en 4 placas de cobertura (0 = sin tinta) listas
 *  para transferir al hilo principal. */
function splitPamCmyk(pam: Uint8Array): { width: number; height: number; c: ArrayBuffer; m: ArrayBuffer; y: ArrayBuffer; k: ArrayBuffer } {
  const head = new TextDecoder("latin1").decode(pam.subarray(0, 1024));
  if (head.charCodeAt(0) !== 0x50 /* "P" de P7 */ || !head.includes("ENDHDR")) {
    throw new Error("PAM inesperado (sin header P7/ENDHDR)");
  }
  const field = (key: string): number => {
    const m = new RegExp("^" + key + "[ \\t]+(\\d+)", "m").exec(head);
    return m ? Number(m[1]) : NaN;
  };
  const width = field("WIDTH");
  const height = field("HEIGHT");
  const depth = field("DEPTH");
  if (!width || !height || depth !== 4) {
    throw new Error(`PAM CMYK inválido (${width}x${height} depth ${depth})`);
  }
  const dataStart = head.indexOf("\n", head.indexOf("ENDHDR")) + 1;
  const px = width * height;
  if (pam.length < dataStart + px * 4) throw new Error("PAM truncado (placas incompletas)");
  const c = new Uint8Array(px);
  const m = new Uint8Array(px);
  const y = new Uint8Array(px);
  const k = new Uint8Array(px);
  for (let i = 0, o = dataStart; i < px; i++, o += 4) {
    c[i] = pam[o];
    m[i] = pam[o + 1];
    y[i] = pam[o + 2];
    k[i] = pam[o + 3];
  }
  return { width, height, c: c.buffer as ArrayBuffer, m: m.buffer as ArrayBuffer, y: y.buffer as ArrayBuffer, k: k.buffer as ArrayBuffer };
}

async function handle(req: PrintWorkerRequest): Promise<PrintWorkerResponse> {
  const mod = await loadEngine();
  if (req.kind === "init") return { kind: "ready", jobId: req.jobId };

  const errorsRef = (mod as GsModule & { __gsErrors?: string[] }).__gsErrors;
  try {
    const { out: cmyk, icc } = runConvert(mod, req.pdfBytes, req.iccBytes);
    if (req.kind === "convert") {
      // REQ F2: el PDF debe DECLARAR su condición de impresión — el spike
      // verificó que pdfwrite convierte colores pero NO incrusta el intent.
      // Update incremental puro (pdfOutputIntent); el original queda intacto.
      const final = req.outputConditionIdentifier
        ? embedOutputIntent(cmyk, icc, {
            outputConditionIdentifier: req.outputConditionIdentifier,
            info: req.outputConditionInfo,
          })
        : cmyk;
      return { kind: "job-done", jobId: req.jobId, bytes: exactBuffer(final), mime: "application/pdf" };
    }
    if (req.kind === "proof") {
      mod.FS.writeFile("/cmyk.pdf", cmyk);
      const code = mod.callMain([
        "-dSAFER", "-dBATCH", "-dNOPAUSE",
        "-sDEVICE=png16m",
        "-r" + String(req.renderDpi),
        "-o", "/proof.png",
        "/cmyk.pdf",
      ]);
      let png: Uint8Array | null = null;
      try { png = mod.FS.readFile("/proof.png"); } catch { png = null; }
      for (const f of ["/cmyk.pdf", "/proof.png"]) { try { mod.FS.unlink(f); } catch { /* ya no está */ } }
      if (!png || code !== 0) throw new Error(`Ghostscript no produjo el preview (código ${code})`);
      return { kind: "job-done", jobId: req.jobId, bytes: exactBuffer(png), mime: "image/png" };
    }
    // separations: rasterizar el PDF CMYK a PAM de 4 canales (pamcmyk32) y
    // partir la tira en placas C/M/Y/K — cada placa ES la tinta que caerá a
    // imprenta (paridad parcial con Separations Preview de Illustrator).
    mod.FS.writeFile("/cmyk.pdf", cmyk);
    const sepCode = mod.callMain([
      "-dSAFER", "-dBATCH", "-dNOPAUSE",
      "-sDEVICE=pamcmyk32",
      "-r" + String(req.renderDpi),
      "-o", "/plates.pam",
      "/cmyk.pdf",
    ]);
    let pam: Uint8Array | null = null;
    try { pam = mod.FS.readFile("/plates.pam"); } catch { pam = null; }
    for (const f of ["/cmyk.pdf", "/plates.pam"]) { try { mod.FS.unlink(f); } catch { /* ya no está */ } }
    if (!pam || sepCode !== 0) {
      throw new Error(`Ghostscript no separó placas (código ${sepCode}) — el build puede no incluir pamcmyk32`);
    }
    const plates = splitPamCmyk(pam);
    return { kind: "separations-done", jobId: req.jobId, result: { width: plates.width, height: plates.height, plates: { c: plates.c, m: plates.m, y: plates.y, k: plates.k } } };
  } catch (err) {
    // Fatal: descartar la instancia (la próxima job recarga limpia) —
    // MEMFS puede quedar corrupto tras un OOM de wasm.
    enginePromise = null;
    const tail = errorsRef?.length ? ` — ${errorsRef.slice(-3).join(" | ")}` : "";
    return { kind: "job-error", jobId: req.jobId, error: (err instanceof Error ? err.message : String(err)) + tail };
  }
}

self.onmessage = (e: MessageEvent<PrintWorkerRequest>) => {
  const req = e.data;
  handle(req)
    .then(res => {
      if (res.kind === "separations-done") {
        const p = res.result.plates;
        post(res, [p.c, p.m, p.y, p.k]);
      } else if (res.kind === "job-done") post(res, [res.bytes]);
      else post(res);
    })
    .catch(err => post({ kind: "job-error", jobId: req.jobId, error: err instanceof Error ? err.message : String(err) }));
};
