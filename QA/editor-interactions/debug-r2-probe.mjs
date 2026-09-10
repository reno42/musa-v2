/** One-off: authenticate + open the editor for a template and dump what renders. */
import { ensureServers, API_URL } from "./lib/servers.mjs";
import { EditorHarness } from "./lib/harness.mjs";
import { authenticate, resolveMcpKey } from "./test-r2-fx-svgfill.mjs";

let rpcId = 0;
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

const servers = await ensureServers();
const harness = new EditorHarness();
try {
  await harness.start();
  const auth = await authenticate(harness);
  console.log("AUTH:", JSON.stringify(auth));

  const ws = await mcp("list_workspaces", {});
  const wid = (ws.data || ws)[0].id;
  const created = await mcp("create_template", { workspaceId: wid, name: "QA — probe", width: 800, height: 600, engine: "html" });
  console.log("CREATED:", created.templateId, created.frameId);

  const page = harness.page;
  page.on("console", m => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 220)); });
  await page.goto(`http://localhost:5173/?template=${created.templateId}&v=2`, { waitUntil: "networkidle2", timeout: 45000 });
  await new Promise(r => setTimeout(r, 5000));
  console.log("URL:", page.url());
  console.log("TITLE:", await page.title());
  console.log("BODY:", await page.evaluate(() => document.body.innerText.slice(0, 300).replace(/\n+/g, " | ")));
  console.log("LS_KEYS:", await page.evaluate(() => Object.keys(localStorage).join(",")));
  console.log("HAS_FRAME:", await page.evaluate(() => !!document.querySelector("[data-frame-id]")));
  console.log("HAS_AGENT:", await page.evaluate(() => !!window.futurariaAgent));
  await page.screenshot({ path: "QA/r2-debug.png", fullPage: false });
  console.log("screenshot -> QA/r2-debug.png");
  await mcp("delete_template", { id: created.templateId });
} finally {
  await harness.close();
  if (servers.startedCount > 0) await servers.stop();
}
