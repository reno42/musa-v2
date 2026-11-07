/** Prebuild de las skills de Musa (fuente única: .agents/skills/<id>/SKILL.md).
 *
 *  Las skills son FIJAS para todas las personas y planes: viajan con el código.
 *  Este script genera tres salidas desde los mismos SKILL.md (cero drift):
 *    1. public/skills-catalog.json  → vista Agentes › Skills de la web.
 *    2. public/skills/<id>.md       → URL estática por skill (/skills/musa-diseno.md).
 *    3. worker/runtime/functions/skills-bundle.mjs → lo que sirven las tools
 *       MCP list_skills / get_skill y el filtro /mcp?skills=.
 *
 *  Además cruza las herramientas citadas en cada skill contra MCP_TOOLS de
 *  mcp.mjs: avisa de tools sin skill (una tool nueva debe sumarse a la skill
 *  de su módulo) y falla si una skill nombra una tool que no existe. */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSkillsCatalog } from "../shared/skillsCatalog.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(repoRoot, ".agents", "skills");

// ── Tools reales del servidor MCP ──
const mcpSrc = readFileSync(join(repoRoot, "worker", "runtime", "functions", "mcp.mjs"), "utf8");
const toolsStart = mcpSrc.indexOf("const MCP_TOOLS = [");
// MCP_TOOLS literal + las tools de paridad v2 (mcp-v2-parity.mjs, se suman con push).
const paritySrc = readFileSync(join(repoRoot, "worker", "runtime", "functions", "mcp-v2-parity.mjs"), "utf8");
const TOOL_RX = /^  \{\s*\r?\n\s+name: "([a-z0-9_]+)"/gm;
const knownTools = new Set([
  ...[...mcpSrc.slice(toolsStart).matchAll(TOOL_RX)].map(m => m[1]),
  ...[...paritySrc.matchAll(TOOL_RX)].map(m => m[1]),
]);
if (knownTools.size < 100) {
  console.error(`[skills] no pude leer MCP_TOOLS (encontré ${knownTools.size})`);
  process.exit(1);
}

const filesById = {};
for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  filesById[entry.name] = readFileSync(join(skillsRoot, entry.name, "SKILL.md"), "utf8");
}

const catalog = buildSkillsCatalog(filesById, knownTools);

// ── Guardas ──
let failed = false;
for (const skill of catalog.skills) {
  if (!skill.description) { console.error(`[skills] ${skill.id}: falta description`); failed = true; }
  if (skill.examples.length < 3) { console.error(`[skills] ${skill.id}: ${skill.examples.length}/3 ejemplos`); failed = true; }
  // Nombres con forma de tool (snake_case en backticks) que no existen en MCP_TOOLS.
  const cited = [...filesById[skill.id].matchAll(/`([a-z]+_[a-z0-9_]+)`?\(/g)].map(m => m[1]);
  const unknown = [...new Set(cited.filter(n => !knownTools.has(n)))];
  if (unknown.length) { console.error(`[skills] ${skill.id} llama tools inexistentes: ${unknown.join(", ")}`); failed = true; }
}
if (failed) process.exit(1);

const covered = new Set(catalog.skills.flatMap(s => s.tools));
const orphan = [...knownTools].filter(t => !covered.has(t));
if (orphan.length) {
  console.warn(`[skills] AVISO: ${orphan.length} tools MCP sin skill (agrégalas a la skill de su módulo): ${orphan.join(", ")}`);
}

// ── 1. JSON para la web ──
mkdirSync(join(repoRoot, "public"), { recursive: true });
writeFileSync(join(repoRoot, "public", "skills-catalog.json"), JSON.stringify(catalog, null, 2) + "\n", "utf8");

// ── 2. Markdown estático por skill ──
const mdDir = join(repoRoot, "public", "skills");
rmSync(mdDir, { recursive: true, force: true });
mkdirSync(mdDir, { recursive: true });
for (const s of catalog.skills) writeFileSync(join(mdDir, `${s.id}.md`), s.content, "utf8");

// ── 3. Bundle para el worker ──
const bundle = catalog.skills.map(s => ({
  id: s.id, title: s.title, module: s.module, description: s.description,
  examples: s.examples, tools: s.tools, content: s.content,
}));
writeFileSync(
  join(repoRoot, "worker", "runtime", "functions", "skills-bundle.mjs"),
  "// GENERADO por scripts/generate-skills-catalog.mjs desde .agents/skills — no editar a mano.\n" +
    `export const MUSA_SKILLS = ${JSON.stringify(bundle)};\n`,
  "utf8",
);

console.log(`[skills] ${catalog.total} skills, ${covered.size}/${knownTools.size} tools cubiertas → public/skills-catalog.json, public/skills/*.md, worker skills-bundle.mjs`);
