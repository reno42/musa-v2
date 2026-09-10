// One-shot: remove the local gradient model + GradientBuilder from
// HtmlContextualPanel (moved to src/lib/gradient.ts) and the local
// splitTopLevelCommas (now imported from the lib). Verifies anchors first.
import { readFileSync, writeFileSync } from "node:fs";

const file = "src/components/HtmlContextualPanel.tsx";
let src = readFileSync(file, "utf8");

// 1) local splitTopLevelCommas (lives inside the Box-shadow helper section;
//    parseBoxShadows right after it keeps using the imported name).
const s1 = "function splitTopLevelCommas(str: string): string[] {";
const a1 = src.indexOf(s1);
const end1Marker = "function parseBoxShadows";
const b1 = src.indexOf(end1Marker);
if (a1 === -1 || b1 === -1 || b1 <= a1) throw new Error("splitTopLevelCommas anchors not found");
const slice1 = src.slice(a1, b1);
if (!slice1.includes("return out;")) throw new Error("splitTopLevelCommas slice unexpected");
src = src.slice(0, a1) + src.slice(b1);

// 2) gradient model + GradientBuilder block
const s2 = "// ── Gradient parsing ──";
const a2 = src.indexOf(s2);
const end2Marker = "// ── Section Head ──";
const b2 = src.indexOf(end2Marker);
if (a2 === -1 || b2 === -1 || b2 <= a2) throw new Error("gradient anchors not found");
const slice2 = src.slice(a2, b2);
for (const must of ["function parseGradientValue", "function buildGradientCss", "const DEFAULT_NEW_GRADIENT", "function GradientBuilder"]) {
  if (!slice2.includes(must)) throw new Error(`gradient slice missing ${must}`);
}
if (slice2.includes("function SectionHead")) throw new Error("gradient slice would eat SectionHead");
src = src.slice(0, a2) + src.slice(b2);

writeFileSync(file, src);
console.log("stripped OK; new length", src.length);
