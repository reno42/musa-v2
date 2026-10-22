// REQ-048 — Content Machines dogfood: fixes P0+P1+P2 en un pase.
// F1 no-downgrade de fonts (QA extendido en font-family.test.mjs) · F2 repaint
// de canvas (verificación manual en deploy local) · F3 nombres con espacios ·
// FL1 create_html_template híbrido · FL2 defaults server-side · FL3 errores
// accionables · FL4 whitespace + .root · FL5 source_rss con placeholder ·
// FL6 channels (ya soportado — cubierto por req042 P042-7/9) · FL7
// update_content frameName · FL8+FL9 aiConnected.
//
// Estilo req040/req041/req042: unit de engine + asserts de fuente para lo que
// no importa directo desde node:test (mcp.mjs, FlowsTab.tsx, htmlMutations.ts).
// Run: node --experimental-strip-types --test QA/req048-content-machines-dogfood.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { NODE_SCHEMA_DOC, validateFlowDefinition, executeFlow } from "../worker/runtime/functions/flows-core.mjs";
import { normalizeLayersFirstFrame, auditEditableFrame } from "../worker/runtime/functions/editable-layers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mcp = readFileSync(join(root, "netlify", "functions", "mcp.mjs"), "utf8");
const htmlMutations = readFileSync(join(root, "src", "lib", "htmlMutations.ts"), "utf8");
const flowsTab = readFileSync(join(root, "src", "components", "FlowsTab.tsx"), "utf8");

// ── FL2: defaults server-side en flow_run ───────────────────────────────────

test("P048-FL2 executeFlow aplica defaults: sin input, con \"\" y con whitespace el default NO se pisa", async () => {
  const flow = {
    id: "flow_fl2", name: "fl2", trigger: { type: "manual" },
    inputs: [
      { key: "tema", label: "Tema", type: "text", required: true, default: "café de especialidad" },
      { key: "dias", label: "Días", type: "number", default: 7 },
    ],
    nodes: [{ id: "m1", type: "map", config: { value: { tema: "{{input.tema}}", dias: "{{input.dias}}" } }, position: { x: 0, y: 0 } }],
    edges: [],
  };
  // Sin input: defaults completos (antes el briefing de ai_task salía con
  // los huecos vacíos — "EXACTAMENTE  día(s)… tema: \"\"").
  const sinInput = await executeFlow(flow, {}, { workspaceId: "ws1" });
  assert.equal(sinInput.status, "success");
  assert.equal(sinInput.outputs.m1.tema, "café de especialidad");
  assert.equal(sinInput.outputs.m1.dias, 7);
  // El run API con placeholders sin resolver llegaba como "" — el default gana.
  const blank = await executeFlow(flow, { tema: "", dias: "" }, { workspaceId: "ws1" });
  assert.equal(blank.outputs.m1.tema, "café de especialidad", "un string vacío del payload NO pisa el default");
  assert.equal(blank.outputs.m1.dias, 7);
  const ws = await executeFlow(flow, { tema: "   " }, { workspaceId: "ws1" });
  assert.equal(ws.outputs.m1.tema, "café de especialidad", "whitespace-only tampoco pisa el default");
  // Valor real del payload manda sobre el default.
  const real = await executeFlow(flow, { tema: "feria", dias: 3 }, { workspaceId: "ws1" });
  assert.equal(real.outputs.m1.tema, "feria");
  assert.equal(real.outputs.m1.dias, 3);
  // required sin default y ausente → INPUT_REQUIRED en el trigger (no en el nodo 2).
  await assert.rejects(
    executeFlow({ ...flow, inputs: [{ key: "tema", required: true }] }, {}, { workspaceId: "ws1" }),
    (e) => e?.flowCode === "INPUT_REQUIRED",
  );
});

// ── FL3: errores accionables ────────────────────────────────────────────────

test("P048-FL3 el fallo del nodo tool trae 'recibido:' con las args RESUELTAS del nodo", async () => {
  const run = await executeFlow(
    {
      id: "flow_fl3", name: "fl3", trigger: { type: "manual" },
      nodes: [{ id: "cal1", type: "tool", config: { tool: "add_content_idea", args: { topic: "{{input.tema}}", scheduledDate: "{{input.fecha}}" } }, position: { x: 0, y: 0 } }],
      edges: [],
    },
    { tema: "evento", fecha: "2026-10-31" },
    { workspaceId: "ws1", callTool: async () => { throw new Error("scheduledDate must be a valid YYYY-MM-DD date"); } },
  );
  assert.equal(run.status, "failed");
  assert.ok(run.error?.includes("NODE_TOOL_ERROR"), `código estable: ${run.error}`);
  assert.ok(run.error?.includes("recibido:"), "el error nombra qué se recibió");
  assert.ok(run.error?.includes('"topic":"evento"'), `las args resueltas viajan: ${run.error}`);
  assert.ok(run.error?.includes('"scheduledDate":"2026-10-31"'), `todas las args: ${run.error}`);
  assert.ok(run.error?.includes("cal1 → add_content_idea"), "nodo y tool identificados");
});

test("P048-FL3 add_content_idea lista las llaves recibidas en sus dos validaciones", () => {
  // El mismatch llave-payload/{{item.x}} (topic vs titulo) se depuraba a ciegas.
  const hits = mcp.split("recibido: ${JSON.stringify(Object.keys(params))}").length - 1;
  assert.ok(hits >= 2, `scheduledDate y topic llevan recibido: (hits=${hits})`);
});

// ── FL5: source_rss con {{input.x}} en url ──────────────────────────────────

test("P048-FL5 el save acepta {{input.x}} en source_rss/source_nitter url y sigue rechazando http plano", () => {
  const rss = validateFlowDefinition(
    { name: "t", trigger: { type: "manual" }, nodes: [{ id: "r1", type: "source_rss", config: { url: "{{input.feed}}", limit: 5 } }], edges: [] },
    { enabled: false },
  );
  assert.equal(rss.nodes[0].config.url, "{{input.feed}}", "el feed como input del flow sobrevive al save");
  const nitter = validateFlowDefinition(
    { name: "t", trigger: { type: "manual" }, nodes: [{ id: "n1", type: "source_nitter", config: { url: "{{input.feed}}" } }], edges: [] },
    { enabled: false },
  );
  assert.equal(nitter.nodes[0].config.url, "{{input.feed}}");
  assert.throws(
    () => validateFlowDefinition(
      { name: "t", trigger: { type: "manual" }, nodes: [{ id: "r2", type: "source_rss", config: { url: "http://inseguro.example/f.xml" } }], edges: [] },
      { enabled: false },
    ),
    /https/i,
    "sin placeholder, la URL sigue exigiendo https",
  );
  assert.ok(NODE_SCHEMA_DOC.includes("acepta {{input.x}}"), "NODE_SCHEMA_DOC documenta el placeholder");
});

// ── FL4 + F3: editable-layers (import real) ─────────────────────────────────

test("P048-FL4 CSS multilinea y con \\n literales normaliza; el wrapper .root es raíz estructural", () => {
  const html = '<div class="root"><h1>Taller de IA</h1><p>Tu cliente<br>vive en una<br>casa inteligente</p></div>';
  const cssMultiline = [
    ".root {",
    "  position: absolute;",
    "  left: 0;",
    "  top: 0;",
    "  width: 1080px;",
    "  height: 1080px;",
    "  background: #ffffff;",
    "}",
    "",
    "h1 { color: #111111; font-size: 48px; }",
    "p { color: #333333; }",
  ].join("\n");
  const norm = normalizeLayersFirstFrame(html, cssMultiline, { width: 1080, height: 1080, background: "#ffffff" });
  assert.ok(norm.audit.valid, `multilinea pasa el contrato: ${norm.audit.errors.join(" ")}`);
  // La variante con \n LITERALES (doble escape JSON) produce el MISMO resultado.
  const cssLiteral = cssMultiline.replace(/\n/g, "\\n");
  const normLiteral = normalizeLayersFirstFrame(html, cssLiteral, { width: 1080, height: 1080, background: "#ffffff" });
  assert.ok(normLiteral.audit.valid, `\\n literales pasan: ${normLiteral.audit.errors.join(" ")}`);
  assert.equal(normLiteral.css, norm.css, "la normalización converge al mismo CSS");
  assert.equal(normLiteral.background, norm.background, "el fondo migra igual en ambas variantes");
});

test("P048-F3 el nombre de capa multi-línea conserva los espacios (no 'clientevive')", () => {
  // cheerio .text() concatenaba los nodos de texto SIN separador; con br entre
  // líneas el nombre quedaba "Tu clientevive en unacasainteligente".
  const html = '<div class="root"><p>Tu cliente<br>vive en una<br>casa inteligente</p></div>';
  const css = ".root{position:absolute;left:0;top:0;width:1080px;height:1080px;background:#ffffff}";
  const norm = normalizeLayersFirstFrame(html, css, { width: 1080, height: 1080, background: "#ffffff" });
  assert.ok(norm.audit.valid, `contrato ok: ${norm.audit.errors.join(" ")}`);
  assert.ok(
    norm.html.includes('data-layer-name="Tu cliente vive en una casa inteligente"'),
    `nombre con espacios: ${(norm.html.match(/data-layer-name="[^"]*"/g) ?? []).join(" | ")}`,
  );
});

test("P048-FL4 auditEditableFrame directo: wrapper .root con inline + css multilinea con \\n literales pasa", () => {
  const auditHtml = '<div data-layer-id="w1" data-layer-name="Portada" data-layer-kind="group" class="root" style="position:absolute;left:0;top:0;width:1080px;height:1080px;"><p data-layer-id="t1" data-layer-name="Hola mundo" data-layer-kind="text">Hola</p></div>';
  const audit = auditEditableFrame(
    auditHtml,
    '.root{position:absolute;left:0;top:0;width:1080px;height:1080px;}\\np{color:#111111}',
    { allowGroups: true },
  );
  assert.ok(audit.valid, `el audit acepta la receta .root: ${audit.errors.join(" ")}`);
});

test("P048-F3 htmlMutations colapsa whitespace en data-layer-name (fuente)", () => {
  assert.ok(
    htmlMutations.includes('textContent.replace(/\\s+/g, " ").trim()'),
    "htmlMutations.ts normaliza el nombre del text layer",
  );
});

// ── FL1: create_html_template híbrido (fuente) ──────────────────────────────

test("P048-FL1 create_html_template siembra el PRIMER frame y avisa si el contrato falla", () => {
  const caseIdx = mcp.indexOf('case "create_html_template"');
  assert.ok(caseIdx > -1);
  const body = mcp.slice(caseIdx, mcp.indexOf("case \"set_html\"", caseIdx));
  assert.ok(body.includes("normalizeLayersFirstWrite"), "la siembra usa el normalizador layers-first");
  assert.ok(body.includes("computeFramePosition([], "), "posición del frame sin overlap");
  assert.ok(body.includes("frameWarning = \"sin frames — llama create_html_frame"), "warning accionable si el contrato falla");
  assert.ok(body.includes("frames: (tpl.frames || []).map"), "la response SIEMPRE declara el estado de frames");
});

// ── FL7: update_content frameName (fuente) ──────────────────────────────────

test("P048-FL7 update_content: frameName de confirmación rechaza el pin equivocado con -32602", () => {
  const schemaIdx = mcp.indexOf('name: "update_content"');
  const schema = mcp.slice(schemaIdx, mcp.indexOf("name:", schemaIdx + 10));
  assert.ok(schema.includes("frameName"), "el schema expone frameName");
  const checkIdx = mcp.indexOf("REQ-048 FL7");
  assert.ok(checkIdx > -1);
  const check = mcp.slice(checkIdx, checkIdx + 900);
  assert.ok(check.includes("-32602"), "el mismatch rechaza con -32602");
  assert.ok(check.includes("frameName mismatch"), "el error dice el nombre REAL del frame");
});

// ── FL8+FL9: aiConnected (fuente) ───────────────────────────────────────────

test("P048-FL9 flow_history expone aiConnected (mcp_token_calls, 30min) y la bandeja colorea el waiting", () => {
  assert.ok(mcp.includes("aiConnected"), "flow_history calcula la señal");
  assert.ok(mcp.includes('from("mcp_token_calls")'), "fuente: la tabla de llamadas MCP (v71)");
  assert.ok(flowsTab.includes("setAiConnected(res?.aiConnected === true)"), "la UI la consume del historial");
  assert.ok(flowsTab.includes("IA conectada"), "badge verde cuando hay IA");
  assert.ok(flowsTab.includes("Sin IA conectada"), "badge ámbar cuando nadie va a atender");
});
