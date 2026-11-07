// i18n/es-en.json (fuente editable: español → inglés) → public/i18n/en.json (lo que carga i18n.js).
// Agrega variantes con números como plantilla: «hace 3 días» → «hace {0} días» ↔ «{0} days ago».
import { readFileSync, writeFileSync } from "node:fs";
const root = new URL("../../", import.meta.url);
const src = JSON.parse(readFileSync(new URL("i18n/es-en.json", root), "utf8"));
const NUM = /\d+(?:[.,:\u00a0 ]\d+)*/g;
const norm = (s) => s.replace(/\s+/g, " ").trim();
const out = {};
if (src.__re) out.__re = src.__re;
for (let [es, en] of Object.entries(src)) {
  if (es === "__re") continue;
  es = norm(es); en = norm(en);
  if (!es || !en || es === en) continue;
  out[es] = en;
  const a = es.match(NUM), b = en.match(NUM);
  if (a && b && a.length === b.length && !/\{\d\}/.test(es)) {
    // mapear cada número del español a su posición en el inglés
    let i = 0; const tEs = es.replace(NUM, () => "{" + i++ + "}");
    const idx = b.map((n) => a.indexOf(n));
    if (idx.every((x) => x >= 0)) { let j = 0; const tEn = en.replace(NUM, () => "{" + idx[j++] + "}"); if (!(tEs in out)) out[tEs] = tEn; }
  }
}
writeFileSync(new URL("public/i18n/en.json", root), JSON.stringify(out));
console.log("entradas:", Object.keys(out).length);
