/* prebuild: public/musa/vendor/musa-trace.js (IIFE, sin dependencias) */
import { build } from "esbuild";
await build({ entryPoints: ["scripts/musa-trace-entry.mjs"], bundle: true, format: "iife", platform: "browser", target: ["es2019"], minify: true, outfile: "public/musa/vendor/musa-trace.js", legalComments: "none", logLevel: "warning" });
console.log("musa-trace.js listo");
