/**
 * Copy SKILL.md and docs/*.md into public/ so the built site actually serves them.
 *
 * These files live at the repo root, but Netlify publishes `dist`, which only
 * receives what Vite copies from `public/`. Without this step
 * https://design.futuraria.com/SKILL.md fell through to the SPA fallback and
 * returned index.html — the Settings download handed people an HTML file, and
 * any agent trying to read its own manual from the deployed site got markup.
 *
 * Same for docs/GRAPH_PLAYBOOK_*.md — agents discover playbooks via MCP
 * initialize but need static HTTP URLs to download the full content.
 */
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ── SKILL.md ──
const skillSource = resolve(root, "SKILL.md");
const skillTarget = resolve(root, "public", "SKILL.md");
mkdirSync(dirname(skillTarget), { recursive: true });
copyFileSync(skillSource, skillTarget);
console.log("[build] SKILL.md → public/SKILL.md");

// ── docs/ directory ──
const docsSource = resolve(root, "docs");
const docsTarget = resolve(root, "public", "docs");
mkdirSync(docsTarget, { recursive: true });

function copyDir(src, dest) {
  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

try {
  copyDir(docsSource, docsTarget);
  const files = readdirSync(docsTarget);
  console.log(`[build] docs/ → public/docs/ (${files.length} files)`);
} catch (e) {
  console.error("[build] Failed to copy docs/:", e.message);
}
