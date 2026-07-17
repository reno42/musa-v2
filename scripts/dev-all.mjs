/**
 * dev:all — Start Vite frontend AND API server (:3001) concurrently.
 * No dependencies required. Cross-platform (Windows, macOS, Linux).
 *
 * Usage: node scripts/dev-all.mjs
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const API_DIR = resolve(ROOT, "api");

const isWindows = process.platform === "win32";
const shell = isWindows;

function run(label, command, args, cwd) {
  console.log(`[dev:all] Starting ${label}…`);
  const child = spawn(command, args, {
    cwd,
    shell,
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1" },
  });

  child.on("error", (err) => {
    console.error(`[dev:all] ${label} failed:`, err.message);
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[dev:all] ${label} exited with code ${code}`);
    }
  });

  return child;
}

// Start API server first (it's needed by the Vite proxy)
const apiArgs = isWindows
  ? ["/d", "/s", "/c", "npm run dev"]
  : ["run", "dev"];
const apiCmd = isWindows ? "cmd" : "npm";

const api = run("API (:3001)", apiCmd, apiArgs, API_DIR);

// Small delay so the API starts before Vite
setTimeout(() => {
  const viteArgs = isWindows
    ? ["/d", "/s", "/c", "npm run dev"]
    : ["run", "dev"];
  const viteCmd = isWindows ? "cmd" : "npm";

  run("Vite (:5173)", viteCmd, viteArgs, ROOT);
}, 1500);

// Graceful shutdown: kill both when this process exits
function cleanup() {
  console.log("\n[dev:all] Shutting down…");
  api.kill();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
