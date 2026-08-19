// prune-native-deps.mjs — podado de binarios nativos para el deploy de
// Netlify (corre en el build container, linux x64 glibc, justo después
// de `npm install` y antes de que Netlify empaquete las funciones).
//
// onnxruntime-node y sharp instalan prebuilds de TODAS las plataformas
// (win32/darwin/linux x arm64/x64, ~300MB en total). Como están listados
// en [functions.external_modules], Netlify copia el módulo completo al
// zip de cada función y limita la subida (~50MB comprimido): un zip con
// 6 plataformas lo revienta. Aquí dejamos solo lo que puede ejecutarse
// en Netlify (linux x64) y, de paso, quitamos símbolos de depuración.
import { rmSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const rm = (p) => {
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    console.log("pruned", p);
  }
};

// onnxruntime-node: conservar solo linux/x64 dentro de bin/napi-v7.
const ortBin = join("node_modules", "onnxruntime-node", "bin", "napi-v7");
if (existsSync(ortBin)) {
  for (const os of readdirSync(ortBin)) {
    if (os === "linux") {
      for (const arch of readdirSync(join(ortBin, "linux"))) {
        if (arch !== "x64") rm(join(ortBin, "linux", arch));
      }
    } else {
      rm(join(ortBin, os));
    }
  }
}

// sharp: conservar solo @img/sharp-linux-x64.
const img = join("node_modules", "@img");
if (existsSync(img)) {
  for (const pkg of readdirSync(img)) {
    if (pkg !== "sharp-linux-x64") rm(join(img, pkg));
  }
}

// Best-effort: strip de símbolos sobre los .so (rebaja ~30% el zip).
// Solo en linux; si strip no está, no es fatal.
if (process.platform === "linux") {
  try {
    const walk = (dir) => {
      const out = [];
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        statSync(full).isDirectory() ? out.push(...walk(full)) : out.push(full);
      }
      return out;
    };
    const ortLinux = join(ortBin, "linux", "x64");
    if (existsSync(ortLinux)) {
      const soFiles = walk(ortLinux).filter(f => f.endsWith(".so"));
      if (soFiles.length) {
        const r = spawnSync("strip", ["--strip-unneeded", ...soFiles], { stdio: "ignore" });
        if (r.error) throw r.error;
        console.log(`stripped ${soFiles.length} onnxruntime .so`);
      }
    }
  } catch {
    /* strip no disponible — no es fatal */
  }
}

console.log("prune-native-deps done");
