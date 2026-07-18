/**
 * Ensure the dev servers the editor needs are reachable:
 *   - vite   on :5173  (the app)
 *   - api    on :3001  (REST + MCP; vite proxies /api and /mcp to it)
 *
 * Probes first. Only servers this module starts are torn down at the end — a
 * dev server the developer already had running is left untouched.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const REPO_ROOT = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

export const VITE_URL = "http://localhost:5173";
export const API_URL = "http://localhost:3001";

async function probe(url, timeoutMs = 2000) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function waitFor(url, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    if (await probe(url)) return true;
    await sleep(1000);
  }
  throw new Error(`${label} never became reachable at ${url}`);
}

function startProcess(command, args, cwd, label) {
  const child = spawn(command, args, {
    cwd,
    shell: true,
    stdio: "ignore",
    detached: false,
    env: { ...process.env },
  });
  child.on("error", err => console.error(`[servers] ${label} failed to spawn:`, err.message));
  return child;
}

export async function ensureServers() {
  const started = [];
  const viteUp = await probe(VITE_URL);
  const apiUp = await probe(`${API_URL}/api/health`);

  if (!apiUp) {
    console.log("[servers] api :3001 down — starting (npx tsx src/server.ts)…");
    started.push(startProcess("npx", ["tsx", "src/server.ts"], `${REPO_ROOT}api`, "api"));
    await waitFor(`${API_URL}/api/health`, "api server");
  } else {
    console.log("[servers] api :3001 already up ✓");
  }

  if (!viteUp) {
    console.log("[servers] vite :5173 down — starting (npm run dev)…");
    started.push(startProcess("npm", ["run", "dev"], REPO_ROOT, "vite"));
    await waitFor(VITE_URL, "vite dev server");
  } else {
    console.log("[servers] vite :5173 already up ✓");
  }

  return {
    async stop() {
      for (const child of started) {
        try { process.kill(child.pid); } catch { /* already gone */ }
      }
    },
    startedCount: started.length,
  };
}
