/**
 * Create disposable test templates via the local MCP endpoint.
 * The local server speaks plain JSON-RPC (method = tool name).
 *
 * Auth (REQ-035 0.5 fix): the API's /mcp no longer accepts a static
 * "dev-key" once Supabase is configured — auth.ts requires either
 * x-api-key === MCP_ADMIN_KEY or a valid Supabase bearer. The harness
 * logs in as the QA user (password grant) using:
 *   1. QA_MCP_BEARER env (CI can inject a ready token)
 *   2. QA/.env.qa-oauth (FDR_EMAIL/FDR_PASSWORD — run
 *      `node QA/oauth-qa-user-setup.mjs` once) + SUPABASE_URL /
 *      SUPABASE_PUBLISHABLE_KEY from the root .env (same local contract
 *      scripts/dev-all.mjs uses)
 *   3. legacy x-api-key dev-key (zero-config local without Supabase)
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { API_URL } from "./servers.mjs";

function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const QA_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_ENV = parseEnvFile(join(QA_DIR, "../../../.env"));
const QA_ENV = parseEnvFile(join(QA_DIR, "../../.env.qa-oauth"));

let cachedBearer = "";

/** QA user credentials for the BROWSER login (AuthScreen form). Same source
 *  as resolveBearer: QA/.env.qa-oauth, overridable via env. Never logged. */
export function qaCredentials() {
  return {
    email: process.env.FDR_EMAIL || QA_ENV.FDR_EMAIL || "",
    password: process.env.FDR_PASSWORD || QA_ENV.FDR_PASSWORD || "",
  };
}

/** MCP_ADMIN_KEY from the root .env (local contract). When present, the API
 *  accepts x-api-key === key as admin WITHOUT any Supabase call — the most
 *  robust path for local QA (bearer validation 503s if the API host can't
 *  reach Supabase Auth, which happens behind some system proxies). */
function resolveAdminKey() {
  if (process.env.QA_MCP_API_KEY) return process.env.QA_MCP_API_KEY;
  if (process.env.MCP_ADMIN_KEY) return process.env.MCP_ADMIN_KEY;
  const line = Object.entries(ROOT_ENV).find(([k]) => k === "MCP_ADMIN_KEY");
  return line ? line[1] : "";
}

async function resolveBearer() {
  if (process.env.QA_MCP_BEARER) return process.env.QA_MCP_BEARER;
  if (cachedBearer) return cachedBearer;
  const email = process.env.FDR_EMAIL || QA_ENV.FDR_EMAIL;
  const password = process.env.FDR_PASSWORD || QA_ENV.FDR_PASSWORD;
  // ROOT .env wins over process.env: the agent-tooling sandbox injects its
  // own SUPABASE_URL/KEY for unrelated projects (the API hits the same
  // trap — see servers.mjs CHILD_ENV) and logging into THAT project fails
  // or yields tokens the local API can't validate.
  const sbUrl = ROOT_ENV.SUPABASE_URL || process.env.SUPABASE_URL || "";
  const sbKey = ROOT_ENV.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "";
  if (!email || !password || !sbUrl || !sbKey) return ""; // zero-config local dev
  // The token is validated by the SAME Supabase project the local API is
  // configured with, so the password grant goes straight to that project's
  // GoTrue — the local API never sees the login itself.
  const res = await fetch(`${sbUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": sbKey, "Authorization": `Bearer ${sbKey}` },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(
      `QA login falló (HTTP ${res.status}). Ejecuta una vez: node QA/oauth-qa-user-setup.mjs — o exporta QA_MCP_BEARER.`,
    );
  }
  const json = await res.json().catch(() => null);
  const token = json?.access_token || json?.session?.access_token || "";
  if (!token) throw new Error("QA login sin access_token — revisa FDR_EMAIL/FDR_PASSWORD.");
  cachedBearer = token;
  return token;
}

let rpcId = 0;

async function mcp(method, params, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  const adminKey = resolveAdminKey();
  // opts.asUser: the call must carry the QA user's identity (workspace
  // scoping), so the admin shortcut is skipped even when available.
  if (adminKey && !opts.asUser) {
    headers["x-api-key"] = adminKey;
  } else {
    const bearer = await resolveBearer().catch(err => {
      // Unreachable GoTrue (network/proxy) → fall back to the api-key path
      // instead of killing the suite; bad credentials (400/401) DO abort.
      if (/fetch failed|network|ENOTFOUND|ECONN|timeout|socket/i.test(String(err.message))) {
        console.warn(`[mcp] QA login no disponible (${err.message}) — usando credenciales admin de respaldo`);
        return "";
      }
      throw new Error(`${method}: ${err.message}`);
    });
    if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
    else if (adminKey) headers["x-api-key"] = adminKey;
    else headers["x-api-key"] = "dev-key";
  }
  const res = await fetch(`${API_URL}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: ++rpcId }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  const text = body.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : body.result;
}

async function ensureWorkspace() {
  // The BROWSER opens the template with the QA user's session, so the
  // template must live in a workspace that user can access. Ask AS the QA
  // user first; the admin view is only a fallback (its first workspace may
  // belong to someone else). The create_workspace MCP tool is agent-guarded
  // by design — the dashboard's own REST endpoint is the sanctioned way to
  // bootstrap one for the QA user.
  let pool = [];
  try {
    const mine = await mcp("list_workspaces", {}, { asUser: true });
    pool = mine.data || mine.workspaces || [];
  } catch (err) {
    console.warn(`[mcp] list_workspaces como usuario QA falló: ${err.message}`);
  }
  if (!pool.length) {
    try {
      const bearer = await resolveBearer();
      const res = await fetch(`${API_URL}/api/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ name: "editor-qa" }),
      });
      if (res.ok) {
        const mine = await mcp("list_workspaces", {}, { asUser: true });
        pool = mine.data || mine.workspaces || [];
      } else {
        console.warn(`[mcp] POST /api/workspaces respondió ${res.status} — sigo con la vista admin`);
      }
    } catch (err) {
      console.warn(`[mcp] no se pudo crear el workspace QA: ${err.message}`);
    }
  }
  if (!pool.length) {
    const legacy = await mcp("list_workspaces", {});
    pool = legacy.data || legacy.workspaces || [];
  }
  // The server forbids agents from creating workspaces via MCP — QA reuses
  // an existing one; disposable templates are deleted in each finally.
  const poolArr = Array.isArray(pool) ? pool : [];
  const chosen = poolArr.find(w => w.name === "editor-qa") || poolArr[0];
  if (!chosen?.id) {
    throw new Error("list_workspaces devolvió 0 workspaces — creá uno desde el dashboard antes de correr la suite.");
  }
  return chosen.id;
}

/**
 * A frame with a nested card: a container WITH data-layer-id holding a heading
 * WITHOUT one (to reproduce the mid-click id-assignment mutation, S2a) plus a
 * couple of independent top-level layers to move around.
 */
function nestedFrameHtml() {
  return [
    '<div data-layer-id="card" data-layer-name="Card" style="position:absolute;left:80px;top:80px;width:520px;height:360px;background:#12203a;border-radius:24px;padding:40px;box-sizing:border-box;">',
    '  <h1 style="margin:0;font-family:sans-serif;font-size:44px;color:#EDE8DC;">Sin layer-id</h1>',
    '  <p style="margin:16px 0 0;font-family:sans-serif;font-size:20px;color:#8A8375;">Hijo sin data-layer-id.</p>',
    '</div>',
    '<div data-layer-id="pill" data-layer-name="Pill" style="position:absolute;left:80px;top:520px;width:220px;height:64px;background:#C8B898;border-radius:999px;"></div>',
    '<div data-layer-id="dot" data-layer-name="Dot" style="position:absolute;left:700px;top:120px;width:120px;height:120px;background:#EF4444;border-radius:50%;"></div>',
  ].join("\n");
}

export async function createNestedTemplate() {
  const workspaceId = await ensureWorkspace();
  const created = await mcp("create_template", {
    workspaceId, name: "QA — nested selection", width: 1080, height: 1080, engine: "html",
  });
  // create_template answers { templateId, frameId } — no { data } envelope.
  const id = created?.data?.id || created?.templateId || created?.id;
  await mcp("update_template", {
    id,
    frames: [{
      id: "frame_qa_nested", name: "QA nested", x: 0, y: 0,
      width: 1080, height: 1080, background: "#0E0D0B",
      html: nestedFrameHtml(), css: "",
    }],
  });
  return { templateId: id, frameId: "frame_qa_nested" };
}

/** A frame packed with N absolutely-positioned layers for perf budgets. */
export async function createHeavyTemplate(layerCount = 200, base64Images = 10) {
  const workspaceId = await ensureWorkspace();
  const created = await mcp("create_template", {
    workspaceId, name: `QA — heavy ${layerCount}`, width: 1920, height: 1080, engine: "html",
  });
  // Same shape as createNestedTemplate: { templateId, frameId }.
  const id = created?.data?.id || created?.templateId || created?.id;

  // A small opaque base64 PNG (1x1) blown up — stands in for the batch's inlined images.
  const px = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const layers = [];
  for (let i = 0; i < layerCount; i++) {
    const x = 40 + (i % 20) * 92;
    const y = 40 + Math.floor(i / 20) * 92;
    if (i < base64Images) {
      layers.push(`<img data-layer-id="img_${i}" data-layer-name="Img ${i}" src="${px}" style="position:absolute;left:${x}px;top:${y}px;width:80px;height:80px;object-fit:cover;border-radius:8px;">`);
    } else {
      const hue = (i * 47) % 360;
      layers.push(`<div data-layer-id="box_${i}" data-layer-name="Box ${i}" style="position:absolute;left:${x}px;top:${y}px;width:80px;height:80px;background:hsl(${hue} 60% 55%);border-radius:8px;"></div>`);
    }
  }
  await mcp("update_template", {
    id,
    frames: [{
      id: "frame_qa_heavy", name: "QA heavy", x: 0, y: 0,
      width: 1920, height: 1080, background: "#0E0D0B",
      html: layers.join("\n"), css: "",
    }],
  });
  return { templateId: id, frameId: "frame_qa_heavy", layerCount };
}

/**
 * RF-04 (Fase 1.2) — two-take reel fixture for the render-parity suite (S6):
 * layer animation + per-take look filters + a fade transition + an image
 * media clip + a text caption. Takes are 720×1280; the project canvas derives
 * from take 1 (no letterbox math in the comparison). mediaUrl must be
 * same-origin reachable from the editor (used by BOTH render paths).
 */
export async function createParityReelTemplate({ mediaUrl }) {
  const workspaceId = await ensureWorkspace();
  const created = await mcp("create_template", {
    workspaceId, name: "QA — render parity", width: 720, height: 1280, engine: "html",
  });
  const id = created?.data?.id || created?.templateId || created?.id;
  const frameA = {
    id: "frame_qa_par_a", name: "Toma A", x: 0, y: 0, width: 720, height: 1280,
    background: "#101418",
    html: [
      '<div data-layer-id="card" style="position:absolute;left:60px;top:120px;width:600px;height:420px;background:linear-gradient(135deg,#1d3a5f,#0e1c2e);border-radius:28px;"></div>',
      '<div data-layer-id="hero" style="position:absolute;left:120px;top:640px;width:480px;height:280px;background:radial-gradient(circle at 30% 30%,#c8b898,#7a5c2e);border-radius:24px;"></div>',
      '<div data-layer-id="tag" style="position:absolute;left:60px;top:980px;width:240px;height:80px;background:#ef4444;border-radius:16px;"></div>',
    ].join("\n"),
    css: "",
    reelFilter: "saturate(1.5)",
    animation: {
      timeline: { durationSec: 3, fps: 30, width: 720, height: 1280, loop: "once" },
      clips: [{
        layerId: "hero", startSec: 0, endSec: 3,
        tweens: [{
          prop: "transform", easing: "linear",
          keyframes: [
            { t: 0, value: "translateX(-140px) scale(0.9)" },
            { t: 1, value: "translateX(0px) scale(1)" },
          ],
        }],
      }],
      transitions: [{ toFrameId: "frame_qa_par_b", type: "fade", durationSec: 0.8 }],
    },
  };
  const frameB = {
    id: "frame_qa_par_b", name: "Toma B", x: 0, y: 0, width: 720, height: 1280,
    background: "#241012",
    html: [
      '<div data-layer-id="bcard" style="position:absolute;left:80px;top:200px;width:560px;height:300px;background:#3b1d24;border-radius:24px;"></div>',
      '<div data-layer-id="bdot" style="position:absolute;left:300px;top:640px;width:120px;height:120px;background:#22c55e;border-radius:50%;"></div>',
    ].join("\n"),
    css: "",
    reelFilter: "grayscale(0.7)",
    animation: {
      timeline: { durationSec: 3, fps: 30, width: 720, height: 1280, loop: "once" },
      clips: [], transitions: [],
    },
  };
  const videoTimeline = {
    version: 2,
    audioClips: [],
    mediaClips: [{
      id: "media_qa_img", kind: "image", name: "og", url: mediaUrl,
      startSec: 0.5, durationSec: 2, trimInSec: 0, sourceDurationSec: 0,
      volume: 1, filter: "",
    }],
    textClips: [{
      id: "text_qa_cap", text: "PARIDAD RF-04", startSec: 1, durationSec: 1.6,
      xPct: 50, yPct: 82, sizePct: 6, color: "#ffffff",
      font: "Arial, sans-serif", weight: 700, bg: "rgba(0,0,0,0.55)", anim: "fade",
    }],
  };
  await mcp("update_template", { id, frames: [frameA, frameB], videoTimeline });
  return { templateId: id };
}

export async function getTemplate(id) {
  const got = await mcp("get_template", { id });
  return got.data || got;
}

export async function deleteTemplate(templateId) {
  try { await mcp("delete_template", { id: templateId }); } catch { /* best effort */ }
}
