/** One-off: trace WHERE the svg shadow + gradient writes die. */
import { makeReport } from "./lib/assert.mjs";
import { ensureServers } from "./lib/servers.mjs";
import { EditorHarness } from "./lib/harness.mjs";
import { authenticate, resolveMcpKey, r2FrameHtml as r2FrameHtmlForDebug } from "./test-r2-fx-svgfill.mjs";
import { deleteTemplate } from "./lib/mcp.mjs";

void makeReport;

let rpcId = 0;
async function mcp(method, params) {
  const res = await fetch("http://localhost:3001/mcp", {
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

async function createTemplate(userId) {
  const list = await mcp("list_workspaces", {});
  const workspaces = list.data || list.workspaces || list || [];
  const mine = userId && workspaces.find(w => w.ownerId === userId);
  const created = await mcp("create_template", {
    workspaceId: (mine || workspaces[0]).id, name: "QA — r2 style trace", width: 1080, height: 1080, engine: "html",
  });
  await mcp("update_template", {
    templateId: created.templateId,
    frames: [{ id: "frame_qa_dbg", name: "QA dbg", x: 0, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: r2FrameHtmlForDebug(), css: "" }],
  });
  return { templateId: created.templateId, frameId: "frame_qa_dbg" };
}

const servers = await ensureServers();
const harness = new EditorHarness();
try {
  await harness.start();
  const auth = await authenticate(harness);
  const { templateId, frameId } = await createTemplate(auth.userId);
  await harness.open(templateId, frameId);

  const dump = async (label) => {
    const info = await harness.page.evaluate((fid) => {
      const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
      const shadow = host.shadowRoot;
      const content = shadow.getElementById("__df_content");
      const style = [...shadow.querySelectorAll("style")].map(s => s.textContent).join("\n---\n");
      const svg = content.querySelector('[data-layer-id="r2tri"]');
      return {
        styleHasBoxShadow: style.includes("box-shadow"),
        styleHasGradientMem: /--fill-gradient/.test(style),
        boxShadowContext: style.split("box-shadow").map((part, i, arr) => i < arr.length - 1 ? arr[i].slice(-220) + "box-shadow" + part.slice(0, 120) : null).filter(Boolean).join("\n@@@\n").slice(0, 1200) || "(none)",
        gradientRuleContext: (style.split("--fill-gradient")[0] || "").slice(-260) + " <-- [before --fill-gradient]",
        svgExists: !!svg,
        svgTag: svg?.tagName,
        svgBoxShadow: svg ? getComputedStyle(svg).boxShadow : "(no svg)",
        pathFill: svg?.querySelector("path")?.getAttribute("fill") || "(no path)",
        panelSelected: !document.body.innerText.includes("Select a frame or element"),
        fillRowExists: !!document.querySelector('div[title^="Click: abrir el picker"]'),
        fillButtons: [...document.querySelectorAll('div[title^="Click: abrir el picker"]')].map(d => {
          const row = d.parentElement;
          return [...row.querySelectorAll("button")].map(b => (b.textContent || "").trim()).join("|");
        }),
      };
    }, frameId);
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(info, null, 1));
  };

  // 1) shadow on the svg triangle
  await harness.clickChild(frameId, 'svg[data-layer-id="r2tri"] path');
  const clickBtn = (text) => harness.page.evaluate((t) => {
    const els = [...document.querySelectorAll("button")].filter(el => (el.textContent || "").trim() === t);
    if (!els.length) return false;
    els[els.length - 1].click();
    return true;
  }, text);
  console.log("+fx open:", await clickBtn("+ Añadir efecto"));
  await harness.settle(200);
  console.log("sombra pick:", await clickBtn("Sombra exterior"));
  await harness.settle(600);
  await dump("after Sombra exterior on r2tri");

  // 2) gradient on r2tri
  await harness.page.evaluate(() => {
    const sw = [...document.querySelectorAll('div[title^="Click: abrir el picker"]')].pop();
    sw?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await harness.settle(250);
  await clickBtn("Degradado");
  await harness.settle(250);
  await clickBtn("+ Crear degradado");
  await harness.settle(800);
  await dump("after Degradado on r2tri");

  // 3) solid back on r2tri
  await harness.page.evaluate(() => {
    const sw = [...document.querySelectorAll('div[title^="Click: abrir el picker"]')].pop();
    sw?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await harness.settle(250);
  await clickBtn("Sólido");
  await harness.settle(800);
  await dump("after Sólido on r2tri");

  await mcp("delete_template", { id: templateId });
} finally {
  await harness.close();
  if (servers.startedCount > 0) await servers.stop();
}
