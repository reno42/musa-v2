import { readFileSync, writeFileSync } from "fs";

const path = "c:/Users/Renzo/.openclaw/workspace/design-main/src/pages/EditorV2.tsx";
let content = readFileSync(path, "utf8");
let count = 0;

// 1. Remove pushUndo(frames); lines (but keep the const updated = ... that follows)
content = content.replace(/pushUndo\(frames\);\n(\s*)(const\s+(updated|reordered)\s*=)/g, (m, indent, decl) => {
  count++;
  return indent + decl;
});

// 2. Replace setFrames(updated); with store.replaceAllWithUndo(updated, "edit");
const reSetFramesUpdated = /^(\s*)setFrames\(updated\);/gm;
const matches1 = content.match(reSetFramesUpdated);
if (matches1) {
  content = content.replace(reSetFramesUpdated, '$1store.replaceAllWithUndo(updated, "edit");');
  count += matches1.length;
}

// 3. Replace setFrames(reordered); 
const reSetFramesReordered = /^(\s*)setFrames\(reordered\);/gm;
const matches2 = content.match(reSetFramesReordered);
if (matches2) {
  content = content.replace(reSetFramesReordered, '$1store.replaceAllWithUndo(reordered, "edit");');
  count += matches2.length;
}

// 4. Replace any remaining setFrames(anyVar); with store.replaceAllWithUndo(anyVar, "edit");
const reSetFramesAny = /^(\s*)setFrames\((\w+)\);/gm;
const matches3 = content.match(reSetFramesAny);
if (matches3) {
  content = content.replace(reSetFramesAny, (m, indent, varName) => {
    count++;
    return `${indent}store.replaceAllWithUndo(${varName}, "edit");`;
  });
}

// 5. Remove any remaining standalone pushUndo(frames); 
const rePushUndo = /^(\s*)pushUndo\(frames\);\s*$/gm;
const matches4 = content.match(rePushUndo);
if (matches4) {
  content = content.replace(rePushUndo, '');
  count += matches4.length;
}

writeFileSync(path, content, "utf8");
console.log(`Replacements made: ${count} patterns`);
