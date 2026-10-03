/** Prebuild del catálogo de skills: congela los SKILL.md de .agents/skills en
 *  public/skills-catalog.json. En CF Workers la API no tiene fs — este JSON
 *  viaja con los assets de dist y es el fallback del endpoint Node (que sí
 *  lee en caliente). Mismo parser que el endpoint: cero drift. */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSkillsCatalog } from "../shared/skillsCatalog.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(repoRoot, ".agents", "skills");

const filesById = {};
for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  filesById[entry.name] = readFileSync(join(skillsRoot, entry.name, "SKILL.md"), "utf8");
}

const catalog = buildSkillsCatalog(filesById);

// Guard de vitrina: la vista promete 9 skills con 3 ejemplos copiables; si
// el repo deja de cumplirlo, el build avisa en vez de publicar una vitrina
// a medias.
if (catalog.total !== 9) {
  console.error(`[skills-catalog] se esperaban 9 skills, hay ${catalog.total}`);
  process.exit(1);
}
for (const skill of catalog.skills) {
  if (skill.examples.length !== 3) {
    console.error(`[skills-catalog] ${skill.id}: ${skill.examples.length}/3 ejemplos`);
    process.exit(1);
  }
}

const outPath = join(repoRoot, "public", "skills-catalog.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(catalog, null, 2) + "\n", "utf8");
console.log(`[skills-catalog] ${catalog.total} skills, orden ${catalog.skills.map(s => s.id).join(", ")} → public/skills-catalog.json`);
