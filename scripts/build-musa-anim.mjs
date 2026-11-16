/* prebuild: public/musa/vendor/musa-anim.js (IIFE) = shared/animationSchema.ts para el editor de diseño */
import { build } from "esbuild";
await build({ entryPoints: ["scripts/musa-anim-entry.mjs"], bundle: true, format: "iife", platform: "browser", target: ["es2019"], minify: true, outfile: "public/musa/vendor/musa-anim.js", legalComments: "none", logLevel: "warning" });
console.log("musa-anim.js listo");
