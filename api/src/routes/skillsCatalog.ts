import { Router } from "express";
// Parser compartido (fuente única de verdad: los SKILL.md) — el mismo que
// genera el JSON estático del prebuild, así Node en caliente y el fallback
// estático de prod nunca divergen.
import { buildSkillsCatalog } from "../../../shared/skillsCatalog.mjs";

export const skillsCatalogRoutes = Router();

/** Cache en memoria: vitrina de solo lectura, 5 min de holgura sobra. */
let cache: { data: unknown; expiresAt: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

async function readCatalog() {
  // fs LAZY y bajo try: en CF Workers no hay fs — la ruta responde 404 y el
  // frontend cae al JSON estático (public/skills-catalog.json, que viaja con
  // los assets de dist). Solo lectura de .agents/skills: ni rutas de sistema
  // ni contenido fuera de esa carpeta.
  const [{ readdirSync, readFileSync }, { join, dirname }, { fileURLToPath }] = await Promise.all([
    import("node:fs"),
    import("node:path"),
    import("node:url"),
  ]);
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const skillsRoot = join(repoRoot, ".agents", "skills");
  const filesById: Record<string, string> = {};
  for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    filesById[entry.name] = readFileSync(join(skillsRoot, entry.name, "SKILL.md"), "utf8");
  }
  return buildSkillsCatalog(filesById);
}

// GET /api/skills-catalog — catálogo público (vitrina: no expone datos de
// usuario, permite allowlist en auth igual que /api/fonts/catalog).
skillsCatalogRoutes.get("/", async (_req, res) => {
  try {
    if (!cache || cache.expiresAt < Date.now()) {
      cache = { data: await readCatalog(), expiresAt: Date.now() + TTL_MS };
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ success: true, data: cache.data });
  } catch {
    cache = null;
    res.status(404).json({ success: false, error: "skills-catalog no disponible vía fs; usar JSON estático" });
  }
});
