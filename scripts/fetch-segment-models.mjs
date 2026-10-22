// ═══════════════════════════════════════════════════════════════════
// fetch-segment-models.mjs — one-time model provisioning for the
// calado/máscaras pipeline (brief "Calado y Mascaras - Design Tool").
//
// What it does:
//   1. Downloads the ONNX weights to ./models-cache/ (gitignored):
//      - u2netp.onnx        (rembg background removal,  ~4.5MB)
//      - MobileSAM quant    (click-to-segment encoder+decoder zip)
//      - CLIPSeg int8       (text-prompt segmentation, ~85MB)
//      - CLIP BPE vocab/merges (tokenizer for CLIPSeg text input)
//   2. VERIFIES each ONNX by loading it with onnxruntime-web (WASM) and
//      printing input/output tensor names — the inference code in
//      worker/runtime/segment/segment-core.mjs is written against these.
//   3. Uploads everything to the Supabase `ml-models` bucket (created by
//      supabase_migrations/musa_segment.sql) with stable names.
//
// Usage:
//   node scripts/fetch-segment-models.mjs              # download + verify + upload
//   node scripts/fetch-segment-models.mjs --verify-only # skip upload
//
// Upload credentials (bucket is public-read, writes need service key):
//   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY  (or SUPABASE_PAT for the
//   management API). Without them the script still downloads + verifies.
// ═══════════════════════════════════════════════════════════════════
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CACHE = resolve(ROOT, "models-cache");
const verifyOnly = process.argv.includes("--verify-only");

const FILES = [
  {
    key: "u2netp",
    uploadAs: "u2netp.onnx",
    url: "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx",
    minBytes: 3_500_000,
  },
  {
    key: "mobile_sam",
    uploadAs: null, // zip → extracted below
    url: "https://huggingface.co/vietanhdev/segment-anything-onnx-models/resolve/main/mobile_sam_20230629_quant.zip",
    minBytes: 10_000_000,
  },
  {
    key: "clipseg",
    uploadAs: "clipseg-rd64-int8.onnx",
    url: "https://huggingface.co/Xenova/clipseg-rd64-refined/resolve/main/onnx/model_quantized.onnx",
    minBytes: 60_000_000,
  },
  {
    key: "clip-vocab",
    uploadAs: "clipseg-vocab.json",
    url: "https://huggingface.co/Xenova/clipseg-rd64-refined/resolve/main/vocab.json",
    minBytes: 500_000,
  },
  {
    key: "clip-merges",
    uploadAs: "clipseg-merges.txt",
    url: "https://huggingface.co/Xenova/clipseg-rd64-refined/resolve/main/merges.txt",
    minBytes: 100_000,
  },
];

function log(msg) { console.log(`[fetch-models] ${msg}`); }

async function download(url, dest) {
  if (existsSync(dest) && statSync(dest).size > 0) {
    log(`cached: ${dest} (${statSync(dest).size} bytes)`);
    return;
  }
  log(`downloading ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error(`Suspiciously small (${buf.length}B) for ${url}`);
  writeFileSync(dest, buf);
  log(`saved ${dest} (${(buf.length / 1e6).toFixed(1)}MB)`);
}

// ── Step 1: download ────────────────────────────────────────────
mkdirSync(CACHE, { recursive: true });
for (const f of FILES) {
  // Stable cache name = uploadAs when set, so segment-core.mjs's dev
  // override (models-cache/<name>) finds the same file the bucket gets.
  const dest = resolve(CACHE, f.uploadAs || f.url.split("/").pop());
  await download(f.url, dest);
  const size = statSync(dest).size;
  if (size < f.minBytes) throw new Error(`${f.key}: expected ≥${f.minBytes}B, got ${size}B — URL layout changed?`);
}

// ── Step 2: extract MobileSAM zip → encoder/decoder ─────────────
// bsdtar (`tar`) ships with Windows 10+ and every Linux; it reads zips.
const samDir = resolve(CACHE, "mobile_sam");
const encPath = resolve(CACHE, "mobile_sam_encoder.onnx");
const decPath = resolve(CACHE, "mobile_sam_decoder.onnx");
if (!existsSync(encPath) || !existsSync(decPath)) {
  rmSync(samDir, { recursive: true, force: true });
  mkdirSync(samDir, { recursive: true });
  execSync(`tar -xf "${resolve(CACHE, "mobile_sam_20230629_quant.zip")}" -C "${samDir}"`);
}
const ort = await import("onnxruntime-web");
{
  // Mismo bootstrap WASM que worker/runtime/segment/segment-core.mjs (Node sin DOM).
  const wasmFile = resolve(process.cwd(), "node_modules", "onnxruntime-web", "dist", "ort-wasm-simd-threaded.wasm");
  if (existsSync(wasmFile)) ort.env.wasm.wasmBinary = readFileSync(wasmFile);
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "warning";
}
async function sessionIo(path) {
  const buf = readFileSync(path);
  const sess = await ort.InferenceSession.create(buf);
  return { sess, inputs: sess.inputNames, outputs: sess.outputNames };
}
const samFiles = readdirSync(samDir).filter(f => f.endsWith(".onnx"));
if (samFiles.length < 2) throw new Error(`Expected 2 ONNX files in the MobileSAM zip, found: ${samFiles.join(", ")}`);
let encFile = null, decFile = null;
for (const f of samFiles) {
  const io = await sessionIo(resolve(samDir, f));
  const isDecoder = io.inputs.some(n => /point/i.test(n));
  log(`MobileSAM ${f}: inputs=[${io.inputs}] outputs=[${io.outputs}] → ${isDecoder ? "DECODER" : "ENCODER"}`);
  if (isDecoder) decFile = f; else encFile = f;
}
if (!encFile || !decFile) throw new Error("Could not identify encoder/decoder by input names");
// Stable names for the runtime
writeFileSync(encPath, readFileSync(resolve(samDir, encFile)));
writeFileSync(decPath, readFileSync(resolve(samDir, decFile)));

// ── Step 3: verify remaining models (print IO contract) ─────────
for (const f of [{ k: "u2netp", p: "u2netp.onnx" }, { k: "clipseg", p: "clipseg-rd64-int8.onnx" }]) {
  const io = await sessionIo(resolve(CACHE, f.p));
  log(`${f.k}: inputs=[${io.inputs}] outputs=[${io.outputs}]`);
}

// ── Step 4: vocab sanity (CLIP BPE, 49407 must exist) ───────────
const vocab = JSON.parse(readFileSync(resolve(CACHE, "clipseg-vocab.json"), "utf-8"));
if (!("<|endoftext|>" in vocab)) throw new Error("vocab.json is not a CLIP vocab (no <|endoftext|>)");
log(`clip vocab ok: ${Object.keys(vocab).length} tokens, eot=${vocab["<|endoftext|>"]}`);

if (verifyOnly) { log("--verify-only → skipping upload."); process.exit(0); }

// ── Step 5: upload to ml-models bucket ──────────────────────────
// Project convention (like QA/e2e-batch-v23.mjs): secrets live in
// .env.design-supabase when not exported in the shell.
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
// URL and key MUST come from the same source — the shell may export a
// SUPABASE_URL for a different project than the .env key (probe-verified
// mismatch → “Invalid Compact JWS” on otherwise-valid credentials).
const shellKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PAT || "";
const SUPABASE_URL = shellKey ? process.env.SUPABASE_URL : envFile.SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = shellKey || envFile.SUPABASE_SECRET_KEY || envFile.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !KEY) {
  console.error("\n[fetch-models] Download + verify OK. To UPLOAD, re-run with SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set.\n");
  process.exit(2);
}
// Upload via raw Storage REST, NOT @supabase/supabase-js: the project uses
// new-format sb_secret_ keys and the SDK's object-write path rejects them
// with "Invalid Compact JWS" (JWT-only parsing), while raw REST with the
// key in BOTH apikey + Authorization headers works (probe-verified).
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// Ensure the bucket exists (public read) — mirrors musa_segment.sql.
const rBuckets = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { headers: H });
if (rBuckets.ok) {
  const ids = (await rBuckets.json()).map(b => b.id);
  if (!ids.includes("ml-models")) {
    const rCreate = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      method: "POST",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "ml-models", name: "ml-models", public: true }),
    });
    log(`create bucket ml-models: ${rCreate.status} ${(await rCreate.text()).slice(0, 80)}`);
  }
} else {
  log(`bucket list failed (HTTP ${rBuckets.status}) — continuing; upload may 404 if the bucket is missing`);
}
// CLIPSeg int8 is 139MB. Supabase Storage enforces a PLAN-LEVEL 50MB
// object cap on this project (bucket file_size_limit cannot raise it —
// the create/update API itself answers 413), so large weights ship as
// 45MB .p1..pN parts that segment-core.mjs concatenates on cold start.
const PART_BYTES = 45_000_000;

const UPLOADS = [
  ["u2netp.onnx", "u2netp.onnx"],
  ["mobile_sam_encoder.onnx", "mobile_sam_encoder.onnx"],
  ["mobile_sam_decoder.onnx", "mobile_sam_decoder.onnx"],
  ["clipseg-rd64-int8.onnx", "clipseg-rd64-int8.onnx"],
  ["clipseg-vocab.json", "clipseg-vocab.json"],
  ["clipseg-merges.txt", "clipseg-merges.txt"],
];
for (const [local, remote] of UPLOADS) {
  const buf = readFileSync(resolve(CACHE, local));
  if (buf.length > PART_BYTES) {
    const parts = Math.ceil(buf.length / PART_BYTES);
    for (let p = 1; p <= parts; p++) {
      const chunk = buf.subarray((p - 1) * PART_BYTES, p * PART_BYTES);
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/ml-models/${remote}.p${p}`, {
        method: "POST",
        headers: { ...H, "Content-Type": "application/octet-stream", "x-upsert": "true" },
        body: chunk,
      });
      if (!r.ok) throw new Error(`upload ${remote}.p${p}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
    }
    log(`uploaded ${remote} as ${parts} parts (${(buf.length / 1e6).toFixed(1)}MB total)`);
    continue;
  }
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/ml-models/${remote}`, {
    method: "POST",
    headers: { ...H, "Content-Type": "application/octet-stream", "x-upsert": "true" },
    body: buf,
  });
  if (!r.ok) throw new Error(`upload ${remote}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
  log(`uploaded ${remote} (${(buf.length / 1e6).toFixed(1)}MB)`);
}
// Public-read sanity: HEAD the smallest file back.
const rHead = await fetch(`${SUPABASE_URL}/storage/v1/object/public/ml-models/u2netp.onnx`, { method: "HEAD" });
if (!rHead.ok) throw new Error(`public read check failed: HTTP ${rHead.status}`);
log(`public read OK (u2netp.onnx, ${rHead.headers.get("content-length")}B)`);
log("DONE ✓");
