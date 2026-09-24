// FASE 2 — T7 FULL FLOW (post-migración v56): el único camino sin verificar
// de punta a punta. MCP inserta job → presencia detectada → la pestaña lo
// reclama (Realtime/poll + guard de carrera) → ghost ejecuta con teatro →
// done + burbuja en el chat. Verificación por DB + MCP poll + video + shots.
import { chromium } from "playwright-core";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(root, ".tmp", "fase2-tests");
const VID = path.join(OUT, "videos");
fs.mkdirSync(VID, { recursive: true });

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:5173";
const API = "http://localhost:3001";
const TPL = "tpl_bbac3d34-cd6";
const EDITOR_URL = `${BASE}/?template=${TPL}&v=2`;
const EMAIL = "qa.oauth.test@design.futuraria.com";
const PASS = "fdr_qa_0c02282e5a97f124ecd99abe";
const WS = "ws_user_8efa531720d842f1b864";
const TASK = "crea un frame rectangular llamado Demo Ghost T7";

const env = Object.fromEntries(fs.readFileSync(path.join(root, ".env"), "utf8")
  .split(/\r?\n/).filter(l => l.includes("=") && !l.trim().startsWith("#"))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
const tokenRes = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASS }),
});
const token = (await tokenRes.json())?.access_token;
if (!token) { console.error("✗ login QA falló"); process.exit(1); }
const qaSub = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).sub;
const skey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_KEY;
const rest = (p, opts = {}) => fetch(`${env.SUPABASE_URL}/rest/v1/${p}`, {
  ...opts, headers: { apikey: skey, Authorization: `Bearer ${skey}`, "Content-Type": "application/json", ...(opts.headers || {}) },
});
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── (0) pestaña abierta con sesión QA (bridge monto + heartbeat) ──────────
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: VID, size: { width: 1280, height: 720 } },
});
const res = { id: "T7-full" };
try {
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByText("Entrar al workspace").first().click();
  await page.waitForSelector(".auth-form input[type=email]", { timeout: 20000 });
  await page.fill(".auth-form input[type=email]", EMAIL);
  await page.fill(".auth-form input[type=password]", PASS);
  await page.click("button.auth-submit");
  await page.waitForSelector('button[title="Chat (Musa)"]', { timeout: 30000 });
  console.log("login OK");

  // Editor (el ghost actúa sobre tools de editor — precedente T1a). El bridge
  // está montado global (App.tsx): sirve igual en dashboard y editor.
  await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[title="Abrir chat"], button[title="Chat (Musa)"]', { timeout: 45000 });
  await page.waitForTimeout(2000);

  // ── (1) presencia: heartbeat <30s antes de insertar el job ──────────────
  let presenceAge = null;
  for (let i = 0; i < 15; i++) {
    const pr = await rest(`ghost_presence?user_id=eq.${qaSub}&select=page,updated_at`);
    const row = (await pr.json())[0];
    if (row) {
      presenceAge = Date.now() - new Date(row.updated_at).getTime();
      if (presenceAge < 30000) { res.presence = { ageMs: presenceAge, page: row.page }; break; }
    }
    await sleep(2000);
  }
  if (!res.presence) throw new Error(`sin presencia fresca (última edad: ${presenceAge}ms) — el bridge no latió`);
  console.log(`presencia OK (${res.presence.ageMs}ms, page=${res.presence.page})`);

  // ── (2) key MCP efímera atada al workspace QA (lección T7 run1) ─────────
  const rawKey = "fk_fase2_" + crypto.randomBytes(18).toString("hex");
  const ins = await rest("workspace_api_keys", {
    method: "POST", headers: { Prefer: "return=representation" },
    body: JSON.stringify({ workspace_id: WS, created_by: qaSub, key_hash: crypto.createHash("sha256").update(rawKey).digest("hex"), key_prefix: rawKey.slice(0, 12), label: "fase2-t7-full", role: "editor" }),
  });
  const keyRow = (await ins.json())[0];
  if (!keyRow?.id) throw new Error(`insert workspace_api_keys falló`);
  const mcp = async (name, argsTool) => {
    const r = await fetch(`${API}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": rawKey },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: argsTool } }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };

  // ── (3) armar pollers ANTES de la llamada (lección A1/A2: nunca después) ─
  const startedAt = new Date().toISOString();
  // Burbuja del chat: el bridge avisa DOS veces — "✕ Ghost (vía MCP): {task}"
  // al arrancar (running) y "✓ Ghost (vía MCP): {nota} (N pasos)" al terminar.
  // Captura POR CONJUNTO (textos distintos, no conteos): inmune a re-renders
  // que duplican nodos y a swaps con igual cantidad. Reload-safe: el historial
  // se re-repelaya desde localStorage y el ✓ seguiría en el set. Node-side
  // porque el editor puede recargar tras la mutación remota del ghost.
  const bubbleSeen = { texts: [], ms: 0 };
  const bubblePoll = (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 330000) {
      try {
        const cur = await page.evaluate(() => {
          const out = [];
          const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let t; (t = w.nextNode());) {
            const d = (t.data || "").trim();
            if (d.includes("Ghost (vía MCP)")) out.push(d);
          }
          return out;
        });
        const set = [...new Set(cur)];
        if (set.length > bubbleSeen.texts.length) bubbleSeen.texts = set;
        if (set.some(x => x.startsWith("✓ Ghost"))) { bubbleSeen.ms = Date.now() - t0; return; }
      } catch { /* navegación en curso */ }
      await sleep(1500);
    }
  })();

  // ── (4) MCP ghost_perform → {accepted, delivery:"tab", jobId} ────────────
  const call = await mcp("ghost_perform", { task: TASK, mode: "teacher", workspaceId: WS });
  res.call = JSON.stringify(call.body?.result?.content?.[0]?.text || call.body?.error || call.body).slice(0, 400);
  const parsed = (() => { try { return JSON.parse(call.body?.result?.content?.[0]?.text || "{}"); } catch { return {}; } })();
  res.accepted = parsed.accepted === true;
  res.delivery = parsed.delivery || null;
  const jobId = parsed.jobId;
  res.jobId = jobId || null;
  if (!res.accepted || !jobId) throw new Error(`ghost_perform no aceptó: ${res.call.slice(0, 200)}`);
  console.log(`job insertado: ${jobId} (delivery=${res.delivery})`);
  await page.screenshot({ path: path.join(OUT, "T7-full-inserted.png") }).catch(() => {});

  // ── (5) transiciones de fila: queued → running (claim) → done ────────────
  let queuedAt = null, runningAt = null, terminalAt = null, row = null;
  for (let i = 0; i < 150; i++) {
    const jr = await rest(`ghost_jobs?id=eq.${jobId}&select=*`);
    row = (await jr.json())[0];
    if (row) {
      if (!queuedAt) queuedAt = Date.now();
      if (row.status !== "queued" && !runningAt) { runningAt = Date.now(); res.claimLatencyMs = runningAt - queuedAt; console.log(`reclamado en ${res.claimLatencyMs}ms → ${row.status}`); await page.screenshot({ path: path.join(OUT, "T7-full-running.png") }).catch(() => {}); }
      if (["done", "failed", "aborted"].includes(row.status)) { terminalAt = Date.now(); break; }
    }
    await sleep(2000);
  }
  res.runLatencyMs = terminalAt ? terminalAt - queuedAt : null;
  res.finalStatus = row?.status || "timeout";
  res.result = row?.result || null;

  // ── (6) round-trip por el camino documentado: ghost_perform({jobId}) ─────
  const poll = await mcp("ghost_perform", { jobId });
  res.mcpPollStatus = poll.body?.result?.content?.[0]?.text ? JSON.parse(poll.body.result.content[0].text)?.status : null;

  // ── (7) burbujas del chat (bridge: running + done vía futuraria:ghost-job) ─
  await Promise.race([bubblePoll, sleep(15000)]);
  res.bubbles = bubbleSeen.texts.map(t => t.slice(0, 220));
  const doneBubble = bubbleSeen.texts.find(t => t.startsWith("✓ Ghost")) || null;
  res.doneBubble = doneBubble;
  res.bubbleMs = bubbleSeen.ms || null;

  // ── (8) evidencia: decisiones del brain (chatfab_decisions, sess ghost_*) ─
  try {
    const dr = await rest(`chatfab_decisions?created_at=gte.${startedAt}&order=created_at.desc&limit=10`);
    const drows = await dr.json();
    res.brainLogs = Array.isArray(drows) ? drows.filter(d => String(d.session_id || d.session || "").startsWith("ghost_")).length : `http ${dr.status}`;
  } catch (e) { res.brainLogs = `err ${String(e).slice(0, 80)}`; }

  await page.screenshot({ path: path.join(OUT, "T7-full-final.png") }).catch(() => {});
  res.ok = res.finalStatus === "done" && res.mcpPollStatus === "done"
    && res.doneBubble !== null
    && Number(res.result?.steps || 0) >= 1
    && String(res.result?.sessionId || "").startsWith("ghost_");
} catch (e) {
  res.error = String(e).slice(0, 400);
} finally {
  // limpieza: borrar key efímera por prefijo del label
  await rest(`workspace_api_keys?label=eq.fase2-t7-full`, { method: "DELETE" }).catch(() => {});
  res.keyDeleted = true;
}

// cerrar → guarda video
const pages = context.pages();
const video = pages[0]?.video();
await context.close();
if (video) { try { fs.renameSync(await video.path(), path.join(VID, "T7-full.webm")); } catch {} }
await browser.close();
fs.writeFileSync(path.join(OUT, "results-t7-full.json"), JSON.stringify({ results: [res] }, null, 2));
console.log(`\n${res.ok ? "✓" : "✗"} T7-full ${JSON.stringify(res).slice(0, 600)}`);
console.log(`video → ${path.join(VID, "T7-full.webm")}`);
