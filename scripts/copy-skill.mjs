/**
 * Copy SKILL.md into public/ so the built site actually serves it.
 *
 * SKILL.md lives at the repo root, but Netlify publishes `dist`, which only
 * receives what Vite copies from `public/`. Without this step
 * https://design.futuraria.com/SKILL.md fell through to the SPA fallback and
 * returned index.html — the Settings download handed people an HTML file, and
 * any agent trying to read its own manual from the deployed site got markup.
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "SKILL.md");
const target = resolve(root, "public", "SKILL.md");

mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log("[build] SKILL.md → public/SKILL.md");
