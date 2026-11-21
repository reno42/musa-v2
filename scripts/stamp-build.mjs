// Estampa el build id de Musa (cache-busting de bridge-*.js + banner de nueva versión).
// Uso: node scripts/stamp-build.mjs   (antes de cada deploy)
import { readFileSync, writeFileSync } from "node:fs";

const HTML = "public/musa/index.html";
const ID = new Date()
  .toISOString()
  .replace(/[-:T]/g, "")
  .slice(0, 12); // YYYYMMDDHHMM

let html = readFileSync(HTML, "utf8");
const stamp = `<script>window.__MUSA_BUILD__="${ID}";</script>`;
if (html.includes("window.__MUSA_BUILD__")) {
  html = html.replace(/<script>window\.__MUSA_BUILD__="[^"]*";<\/script>/, stamp);
} else {
  html = html.replace("<head>", `<head>\n    ${stamp}`);
}
writeFileSync(HTML, html);
writeFileSync("public/musa/build-id.txt", ID + "\n");
console.log("[stamp-build] build id:", ID);
