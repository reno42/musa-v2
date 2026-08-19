// prune-native-deps.mjs — podado para el deploy de Netlify (corre en el
// build container justo después de `npm install`, antes de que Netlify
// empaquete las funciones).
//
// onnxruntime-web instala TODAS las variantes de wasm en dist/ (~120MB:
// webgl, webgpu, asyncify, jspi, jsep, threaded…). El entry "node" solo
// necesita ort.node.min.{mjs,js} + el glue ort-wasm-simd-threaded.mjs +
// su binario ort-wasm-simd-threaded.wasm (~13.5MB). sharp instala
// prebuilds de todas las plataformas; en Netlify solo sirve linux-x64.
// El límite de subida de funciones de Netlify es ~50MB comprimido, así
// que aquí dejamos solo lo que la función de segmentación usa.
import { rmSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const rm = (p) => {
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    console.log("pruned", p);
  }
};

// onnxruntime-web/dist: conservar solo el runtime WASM single-thread
// (simd-threaded corre con numThreads=1 sin workers) + el entry node.
const ortDist = join("node_modules", "onnxruntime-web", "dist");
if (existsSync(ortDist)) {
  const KEEP = new Set([
    "ort.node.min.mjs",
    "ort.node.min.js",
    "ort-wasm-simd-threaded.mjs",
    "ort-wasm-simd-threaded.wasm",
  ]);
  for (const f of readdirSync(ortDist)) {
    if (!KEEP.has(f)) rm(join(ortDist, f));
  }
}

// sharp: conservar solo @img/sharp-linux-x64.
const img = join("node_modules", "@img");
if (existsSync(img)) {
  for (const pkg of readdirSync(img)) {
    if (pkg !== "sharp-linux-x64") rm(join(img, pkg));
  }
}

console.log("prune-native-deps done");
