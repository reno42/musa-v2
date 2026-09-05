/**
 * dev:all — Start Vite frontend AND API server (:3001) concurrently.
 * No dependencies required. Cross-platform (Windows, macOS, Linux).
 *
 * Usage: node scripts/dev-all.mjs
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const API_DIR = resolve(ROOT, "api");

// ── Local env contract ──────────────────────────────────────────
// Vite reads VITE_* from the root .env natively, but tsx (the API child)
// does NOT read .env files — so without injection the API always ran in
// zero-config mode locally. We parse the root .env (and an optional
// api/.env, merged after so it wins) and inject every var into both
// children. Empty placeholders count as "not configured yet". Names are
// logged, never values.
function loadEnvFile(path, label) {
  if (!existsSync(path)) return {};
  const vars = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!value) continue;
    if (!(key in vars)) vars[key] = value;
  }
  const names = Object.keys(vars);
  console.log(`[dev:all] ${label}: ${names.length ? names.join(", ") : "(sin claves todavía — modo cero-config)"}`);
  return vars;
}

const fileEnv = {
  ...loadEnvFile(resolve(ROOT, ".env"), "env raíz (.env)"),
  ...loadEnvFile(resolve(API_DIR, ".env"), "env API (api/.env)"),
};

const isWindows = process.platform === "win32";
const shell = isWindows;

function run(label, command, args, cwd, extraEnv = {}) {
  console.log(`[dev:all] Starting ${label}…`);
  const child = spawn(command, args, {
    cwd,
    shell,
    stdio: "inherit",
    env: { ...process.env, FORCE_COLOR: "1", ...extraEnv },
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

// PORT must be pinned: launchers (preview harnesses, IDEs) often inject their
// own PORT env, and the API honors process.env.PORT — without this it steals
// Vite's port and the whole proxy chain breaks.
const api = run("API (:3001)", apiCmd, apiArgs, API_DIR, { PORT: "3001", ...fileEnv });

// Small delay so the API starts before Vite
setTimeout(() => {
  const viteArgs = isWindows
    ? ["/d", "/s", "/c", "npm run dev"]
    : ["run", "dev"];
  const viteCmd = isWindows ? "cmd" : "npm";

  run("Vite (:5173)", viteCmd, viteArgs, ROOT, { ...fileEnv });
}, 1500);

// Graceful shutdown: kill both when this process exits
function cleanup() {
  console.log("\n[dev:all] Shutting down…");
  api.kill();
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
