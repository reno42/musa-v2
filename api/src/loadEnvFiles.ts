/**
 * Local-dev env loader — MUST be imported before anything else in server.ts.
 *
 * tsx does not read .env files, and the launcher contract
 * (scripts/dev-all.mjs) only covers `npm run dev:all`: booting the API any
 * other way (bare tsx watch, node dist/server.bundle.js, a wrapper dying
 * mid-boot) left MCP_ADMIN_KEY unset, so every x-api-key call 401'd with
 * key_not_found while Supabase calls worked — the exact mix that made the
 * bug look like "auth randomly broke".
 *
 * Fills MISSING process.env keys from the repo root .env and api/.env.
 * Existing env always wins: Netlify/CI/Docker inject their own values and
 * must never be overridden by files that only exist on dev machines.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// api/src (dev) and api/dist (bundled) both sit two levels under the repo
// root, one level above api/ — the same relative paths work for both.
const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  resolve(here, "../../.env"), // repo root .env
  resolve(here, "../.env"), // api/.env — API-specific keys (MCP_ADMIN_KEY)
];

let loaded = 0;
for (const path of candidates) {
  if (!existsSync(path)) continue;
  try {
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
      if (!value || key in process.env) continue;
      process.env[key] = value;
      loaded++;
    }
  } catch {
    // A malformed/unreadable .env must never block boot — the launcher or
    // the platform env may already provide everything important.
  }
}
if (loaded) console.log(`[api] env: loaded ${loaded} missing keys from .env files (existing env untouched)`);
