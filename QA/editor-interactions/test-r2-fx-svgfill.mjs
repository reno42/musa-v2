/**
 * R2 — "Efectos del panel no aplican/no se quitan" + "degradado en figuras
 * con vértices editados".
 *
 * Drives the REAL properties panel (light DOM) against layers rendered in the
 * frame's shadow DOM:
 *
 *   R2.1  Sombra exterior added from the Efectos popup reaches the layer's
 *         computed style, the row appears, and × removes both.
 *   R2.2  Same add/remove round-trip on a plain div shape.
 *   R2.3  Degradado on an svg <path> shape paints via svg defs
 *         (fill="url(#musa-fill-…)") and the picker reads it back.
 *   R2.4  Same gradient flow on a trapezoid path — the shape a user gets by
 *         dragging vertices (only `d` changes, classification doesn't).
 *
 * Standalone: `node QA/editor-interactions/test-r2-fx-svgfill.mjs`
 */
import { makeReport } from "./lib/assert.mjs";
import { ensureServers, API_URL } from "./lib/servers.mjs";
import { EditorHarness } from "./lib/harness.mjs";
import { deleteTemplate } from "./lib/mcp.mjs";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

let rpcId = 0;

/** MCP auth: MCP_ADMIN_KEY from the repo env file (admin), R2_MCP_KEY, or
 * "dev-key" for the zero-config api. Keeps secrets off the command line. */
export function resolveMcpKey() {
  if (process.env.R2_MCP_KEY) return process.env.R2_MCP_KEY;
  try {
    const env = readFileSync(new URL("../../.env.design-supabase", import.meta.url), "utf8");
    const line = env.split(/\r?\n/).find(l => l.startsWith("MCP_ADMIN_KEY="));
    if (line) return line.slice("MCP_ADMIN_KEY=".length).trim();
  } catch { /* no env file — zero-config api */ }
  return "dev-key";
}

async function mcp(method, params) {
  const res = await fetch(`${API_URL}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": resolveMcpKey() },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: ++rpcId }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  const text = body.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : body.result;
}

/** Sign a real browser session into the editor: /api/auth/config gives the
 * supabase project, the QA user (QA/.env.qa-oauth) gives identity, and the
 * session is seeded into localStorage before the app boots. */
export async function authenticate(harness) {
  const cfg = await fetch(`${API_URL}/api/auth/config`).then(r => r.json()).catch(() => null);
  const url = cfg?.data?.url;
  const key = cfg?.data?.publishableKey || cfg?.data?.anonKey;
  if (!cfg?.data?.configured || !url || !key) return { ok: false, reason: "auth not configured" };

  let env = "";
  try { env = readFileSync(new URL("../.env.qa-oauth", import.meta.url), "utf8"); } catch { /* missing */ }
  const getVar = (name) => {
    const line = env.split(/\r?\n/).find(l => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : (process.env[name] || "");
  };
  const email = getVar("FDR_EMAIL"), password = getVar("FDR_PASSWORD");
  if (!email || !password) return { ok: false, reason: "no QA credentials (QA/.env.qa-oauth)" };

  const session = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify({ email, password }),
  }).then(r => r.json());
  if (!session?.access_token) {
    return { ok: false, reason: `password grant failed: ${session?.error_description || session?.msg || "unknown"}` };
  }

  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  await harness.page.evaluateOnNewDocument(({ k, s }) => {
    localStorage.setItem(k, JSON.stringify(s));
  }, { k: storageKey, s: session });
  return { ok: true, userId: session.user?.id || null };
}

/** div shape + two svg path shapes (triangle, trapezoid = post-vertex-edit). */
export function r2FrameHtml() {
  return [
    '<div data-layer-id="r2box" data-layer-name="Box" data-layer-kind="shape" style="position:absolute;left:80px;top:640px;width:220px;height:140px;background:#3B82F6;border-radius:8px;"></div>',
    '<svg data-layer-id="r2tri" data-layer-name="Triangle" data-layer-kind="svg" viewBox="0 0 150 150" style="position:absolute;left:80px;top:80px;width:150px;height:150px;overflow:visible;"><path d="M75 0 L0 150 L150 150 Z" fill="#10B981" stroke="#059669" stroke-width="0"></path></svg>',
    '<svg data-layer-id="r2trap" data-layer-name="Trapezoid" data-layer-kind="svg" viewBox="0 0 160 120" style="position:absolute;left:320px;top:80px;width:160px;height:120px;overflow:visible;"><path d="M30 0 L130 0 L160 120 L0 120 Z" fill="#8B5CF6" stroke="#7C3AED" stroke-width="0"></path></svg>',
  ].join("\n");
}

async function createR2Template(userId) {
  const list = await mcp("list_workspaces", {});
  const workspaces = list.data || list.workspaces || list || [];
  if (!Array.isArray(workspaces) || workspaces.length === 0) {
    throw new Error("No workspaces found — create one from the dashboard first.");
  }
  // The browser session belongs to this user, so the template must live in a
  // workspace they can read (their own personal workspace, not the admin's).
  const mine = userId && workspaces.find(w => w.ownerId === userId);
  const workspaceId = (mine || workspaces[0]).id;
  const created = await mcp("create_template", {
    workspaceId, name: "QA — r2 fx + svg fill", width: 1080, height: 1080, engine: "html",
  });
  const id = created.templateId || (created.data || created).id;
  await mcp("update_template", {
    templateId: id,
    frames: [{
      id: "frame_qa_r2", name: "QA r2", x: 0, y: 0,
      width: 1080, height: 1080, background: "#0E0D0B",
      html: r2FrameHtml(), css: "",
    }],
  });
  return { templateId: id, frameId: "frame_qa_r2" };
}

export async function run(harness) {
  const report = makeReport("R2 · efectos aplican/quitan + degradado svg");
  const auth = await authenticate(harness);
  if (!auth.ok) console.warn(`[r2] browser auth skipped: ${auth.reason} (el editor puede redirigir a login)`);
  const { templateId, frameId } = await createR2Template(auth.userId);
  try {
    await harness.open(templateId, frameId);

    // Page-side drivers (the panel is light DOM; portals land at body's end).
    harness.page._r2 = {
      async clickButton(text) {
        return harness.page.evaluate((t) => {
          const els = [...document.querySelectorAll("button")].filter(el => (el.textContent || "").trim() === t);
          if (!els.length) return false;
          els[els.length - 1].click();
          return true;
        }, text);
      },
      async clickSwatch() {
        return harness.page.evaluate(() => {
          const sw = [...document.querySelectorAll('div[title^="Click: abrir el picker"]')].pop();
          if (!sw) return false;
          sw.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          return true;
        });
      },
      async shadowState(layerId) {
        return harness.page.evaluate((id) => {
          const wrapper = document.querySelector(`[data-frame-id="${window.__r2FrameId}"]`);
          const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
          const content = host.shadowRoot.getElementById("__df_content");
          const layer = content.querySelector(`[data-layer-id="${id}"]`);
          if (!layer) return null;
          const path = layer.matches("path") ? layer : layer.querySelector("path");
          return {
            boxShadow: getComputedStyle(layer).boxShadow,
            pathFill: path ? path.getAttribute("fill") : null,
            hasDefs: !!(layer.querySelector("defs")),
          };
        }, layerId);
      },
      async hasFxRow(label) {
        return harness.page.evaluate((t) =>
          [...document.querySelectorAll("button")].some(el => (el.textContent || "").trim() === t), label);
      },
    };
    await harness.page.evaluate((fid) => { window.__r2FrameId = fid; }, frameId);

    // ── R2.1 · shadow add/remove on the svg triangle ──
    await harness.clickChild(frameId, 'svg[data-layer-id="r2tri"] path');
    const openedFx = await harness.page._r2.clickButton("+ Añadir efecto");
    await harness.settle(200);
    const pickedFx = await harness.page._r2.clickButton("Sombra exterior");
    await harness.settle(350);

    let st = await harness.page._r2.shadowState("r2tri");
    const rowShown = await harness.page._r2.hasFxRow("Sombra 1");
    report.ok(
      "R2.1a sombra exterior aplica a la figura svg",
      openedFx && pickedFx && st && st.boxShadow !== "none" && rowShown,
      `css="${st && st.boxShadow}" fila=${rowShown} opened=${openedFx} picked=${pickedFx}`,
    );

    const removed = await harness.page.evaluate(() => {
      const x = [...document.querySelectorAll('button[title="Quitar"]')].pop();
      if (!x) return false;
      x.click();
      return true;
    });
    await harness.settle(350);
    st = await harness.page._r2.shadowState("r2tri");
    const rowGone = !(await harness.page._r2.hasFxRow("Sombra 1"));
    report.ok(
      "R2.1b × quita la sombra (estilo + fila)",
      removed && st && st.boxShadow === "none" && rowGone,
      `css="${st && st.boxShadow}" filaVisible=${rowGone === false} clicked=${removed}`,
    );

    // ── R2.2 · same round-trip on the div box ──
    await harness.clickLayer(frameId, "r2box");
    await harness.page._r2.clickButton("+ Añadir efecto");
    await harness.settle(200);
    await harness.page._r2.clickButton("Sombra exterior");
    await harness.settle(350);
    st = await harness.page._r2.shadowState("r2box");
    report.ok(
      "R2.2a sombra aplica al div",
      st && st.boxShadow !== "none",
      `css="${st && st.boxShadow}"`,
    );
    await harness.page.evaluate(() => { [...document.querySelectorAll('button[title="Quitar"]')].pop()?.click(); });
    await harness.settle(350);
    st = await harness.page._r2.shadowState("r2box");
    report.ok("R2.2b × quita la sombra del div", st && st.boxShadow === "none", `css="${st && st.boxShadow}"`);

    // ── R2.3 · degradado on the svg triangle (defs + readback) ──
    await harness.clickChild(frameId, 'svg[data-layer-id="r2tri"] path');
    await harness.page._r2.clickSwatch();
    await harness.settle(250);
    await harness.page._r2.clickButton("Degradado");
    await harness.settle(250);
    await harness.page._r2.clickButton("+ Crear degradado");
    await harness.settle(500);

    st = await harness.page._r2.shadowState("r2tri");
    const gradientReadback = await harness.page._r2.hasFxRow("Lineal · 2 nodos")
      || (await harness.page.evaluate(() =>
        [...document.querySelectorAll("button")].some(el => /Lineal · 2 nodos/.test(el.textContent || ""))));
    report.ok(
      "R2.3 degradado pinta el path via defs y el picker lo lee",
      st && typeof st.pathFill === "string" && st.pathFill.startsWith("url(#musa-fill-") && st.hasDefs && gradientReadback,
      `fill="${st && st.pathFill}" defs=${st && st.hasDefs} readback=${gradientReadback}`,
    );

    // Back to solid: the pattern def must be dropped.
    await harness.page._r2.clickSwatch();
    await harness.settle(250);
    await harness.page._r2.clickButton("Sólido");
    await harness.settle(500);
    st = await harness.page._r2.shadowState("r2tri");
    report.ok(
      "R2.3b volver a sólido limpia el def",
      st && st.pathFill && !st.pathFill.startsWith("url(") && !st.hasDefs,
      `fill="${st && st.pathFill}" defs=${st && st.hasDefs}`,
    );

    // ── R2.4 · degradado on the trapezoid (vertex-modified shape) ──
    await harness.clickChild(frameId, 'svg[data-layer-id="r2trap"] path');
    await harness.page._r2.clickSwatch();
    await harness.settle(250);
    await harness.page._r2.clickButton("Degradado");
    await harness.settle(250);
    await harness.page._r2.clickButton("+ Crear degradado");
    await harness.settle(500);
    st = await harness.page._r2.shadowState("r2trap");
    report.ok(
      "R2.4 degradado en trapecio (shape editada por vértices)",
      st && typeof st.pathFill === "string" && st.pathFill.startsWith("url(#musa-fill-") && st.hasDefs,
      `fill="${st && st.pathFill}" defs=${st && st.hasDefs}`,
    );

    return report;
  } finally {
    await deleteTemplate(templateId);
  }
}

// Standalone execution: `node QA/editor-interactions/test-r2-fx-svgfill.mjs`
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const servers = await ensureServers();
  const harness = new EditorHarness();
  try {
    await harness.start();
    const report = await run(harness);
    for (const r of report.results) {
      console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    }
    console.log(`\n${report.passed ? "SUITE PASS" : "SUITE FAIL"}  ${report.suiteName}`);
    process.exit(report.passed ? 0 : 1);
  } finally {
    await harness.close();
    if (servers.startedCount > 0) await servers.stop();
  }
}
