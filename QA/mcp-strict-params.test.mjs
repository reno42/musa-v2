/**
 * mcp-strict-params.test.mjs — REQ-049 contrato del MCP.
 *
 * Cubre la clase de bugs hallada en la auditoría MCP-first del 2026-10-15:
 *
 *   B1/F1 — params desconocidos se rechazan con -32602 ANTES de ejecutar el
 *           handler (antes: draw_bezier({points}) → 200 OK y HTML persistido
 *           con viewBox="undefined undefined NaN NaN").
 *   B2/F2 — pathfinder con UN solo registro (layerIds/op/strokeColor) y el
 *           contrato viejo (elementIdA/elementIdB/operation) canonicalizado
 *           con flag deprecated.
 *   B3/F3 — handleTraceSelectedImage llama autoSave tras replaceAllWithUndo.
 *   B4/F4 — render_frame_png/diff_overlay ya no referencian `event`.
 *   B5/F5 — paste_style/set_pseudo_state aceptan objeto y string (JSON).
 *
 * El server (worker/runtime/functions/mcp.mjs) importa src/lib/*.ts y módulos con
 * efectos de entorno, así que — igual que mcp-corner-radius.test.mjs — se
 * extraen las piezas reales por slicing balanceado de llaves y se evalúan.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MCP_SRC = join(root, "netlify", "functions", "mcp.mjs");
const EDITOR_SRC = join(root, "src", "pages", "EditorV2.tsx");
const mcpSource = readFileSync(MCP_SRC, "utf8");
const editorSource = readFileSync(EDITOR_SRC, "utf8");

/** Pull a top-level `function name(...) {...}` out of mcp.mjs. */
function sliceServerFunction(name) {
  const start = mcpSource.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found in mcp.mjs`);
  // El cuerpo empieza en la PRIMERA "{" DESPUÉS del ")" que cierra la firma —
  // los defaults como `optional = {}` contienen llaves propias.
  let parenDepth = 0;
  let bodyBrace = -1;
  for (let i = mcpSource.indexOf("(", start); i < mcpSource.length; i++) {
    const ch = mcpSource[i];
    if (ch === "(") parenDepth++;
    else if (ch === ")") {
      parenDepth--;
      if (parenDepth === 0) { bodyBrace = mcpSource.indexOf("{", i); break; }
    }
  }
  assert.ok(bodyBrace !== -1, `function ${name}: firma sin cuerpo`);
  const sliced = sliceBalanced(bodyBrace);
  assert.ok(sliced, `function ${name} is unbalanced in mcp.mjs`);
  // Header + cuerpo: sin el header el slice sería un bloque suelto que se
  // ejecuta al evaluar (params inexistentes → ReferenceError).
  return mcpSource.slice(start, bodyBrace) + sliced;
}

// Contador de profundidad CONSCIENTE de strings, template literals
// (incluye ${...}), escapes y comentarios: las llaves dentro de textos no
// cuentan (normalizeStyleDeclarations dice {propiedad: valor} en un mensaje).
function sliceBalanced(openIdx) {
  const CLOSER = { "{": "}", "[": "]", "(": ")" };
  const openCh = mcpSource[openIdx];
  assert.ok(CLOSER[openCh], `no es un apertura: ${openCh}`);
  const stack = [{ closeCh: CLOSER[openCh], resumeTemplate: false }];
  let mode = "code"; // code | "'" | '"' | "`"
  for (let i = openIdx + 1; i < mcpSource.length; i++) {
    const ch = mcpSource[i];
    const next = mcpSource[i + 1];
    if (mode === "'" || mode === '"') {
      if (ch === "\\") { i++; continue; }
      if (ch === mode) mode = "code";
      continue;
    }
    if (mode === "`") {
      if (ch === "\\") { i++; continue; }
      if (ch === "`") { mode = "code"; continue; }
      if (ch === "$" && next === "{") { stack.push({ closeCh: "}", resumeTemplate: true }); mode = "code"; i++; continue; }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { mode = ch; continue; }
    if (ch === "/" && next === "/") { while (i < mcpSource.length && mcpSource[i] !== "\n") i++; continue; }
    if (ch === "/" && next === "*") { const e = mcpSource.indexOf("*/", i); i = e === -1 ? mcpSource.length : e + 1; continue; }
    if (CLOSER[ch]) { stack.push({ closeCh: CLOSER[ch], resumeTemplate: false }); continue; }
    if (ch === "}" || ch === "]" || ch === ")") {
      const top = stack[stack.length - 1];
      if (top && top.closeCh === ch) {
        stack.pop();
        if (top.resumeTemplate) mode = "`";
        else if (stack.length === 0) return mcpSource.slice(openIdx, i + 1);
      }
    }
  }
  return null;
}

function sliceServerConst(name) {
  const start = mcpSource.indexOf(`const ${name} = `);
  assert.ok(start !== -1, `const ${name} not found in mcp.mjs`);
  const openCh = mcpSource[start + `const ${name} = `.length];
  assert.ok(openCh === "[" || openCh === "{", `const ${name} no es un literal`);
  if (openCh === "[") {
    // El catálogo es data plano: las descriptions son strings de una línea,
    // así que un "\n];" a columna 0 solo puede ser el terminador del array
    // (el balanceador de strings se pierde con ejemplos tipo regex dentro).
    const end = mcpSource.indexOf("\n];", start);
    assert.ok(end !== -1, `const ${name} is unbalanced in mcp.mjs`);
    return mcpSource.slice(start, end + 3);
  }
  // Objeto plano de un nivel (PATHFINDER_LEGACY_OPS).
  const openIdx = mcpSource.indexOf("{", start);
  const sliced = sliceBalanced(openIdx);
  assert.ok(sliced, `const ${name} is unbalanced in mcp.mjs`);
  return mcpSource.slice(start, openIdx) + sliced; // conserva "const NAME ="
}

// El catálogo interpola constantes del módulo (p. ej. ${NODE_SCHEMA_DOC}) en
// sus descriptions: se stubbean como "" solo para este eval.
function evalWithStubs(code) {
  const stubs = [...new Set([...code.matchAll(/\$\{([A-Z_][A-Z0-9_]*)\}/g)].map(m => m[1]))];
  const prelude = stubs.map(s => `const ${s} = "";`).join("\n");
  return new Function(`${prelude}\n${code}`)();
}

// Catálogo REAL de tools, tal como lo anuncia tools/list.
const MCP_TOOLS = evalWithStubs(`
  ${sliceServerConst("MCP_TOOLS")}
  return MCP_TOOLS;
`);

// Funciones reales del server bajo prueba (MCP_TOOLS en scope para validateToolParams).
const serverFns = evalWithStubs(`
  ${sliceServerConst("MCP_TOOLS")}
  ${sliceServerConst("PATHFINDER_LEGACY_OPS")}
  ${sliceServerFunction("validateToolParams")}
  ${sliceServerFunction("canonicalizeToolParams")}
  ${sliceServerFunction("assertCleanMarkup")}
  ${sliceServerFunction("normalizeStyleDeclarations")}
  return {
    validateToolParams,
    canonicalizeToolParams,
    assertCleanMarkup,
    normalizeStyleDeclarations,
  };
`);

const toolNames = MCP_TOOLS.map(t => t.name);
const caseSlice = (caseName, nextCaseName) => {
  const start = mcpSource.indexOf(`case "${caseName}": {`);
  const end = nextCaseName ? mcpSource.indexOf(`case "${nextCaseName}": {`, start) : mcpSource.length;
  assert.ok(start !== -1, `case "${caseName}" not found`);
  assert.ok(end > start, `slice end for "${caseName}" not found`);
  return mcpSource.slice(start, end);
};

// ── F2/B2: catálogo sin duplicados, pathfinder con contrato único ──
test("tools/list: catálogo sin nombres duplicados (pathfinder queda UNO)", () => {
  const dupes = toolNames.filter((n, i) => toolNames.indexOf(n) !== i);
  assert.deepEqual(dupes, [], "tools duplicadas en MCP_TOOLS");
  assert.equal(toolNames.filter(n => n === "pathfinder").length, 1);
  // La auditoría contaba 410 entradas CON el ghost duplicado; el catálogo
  // funcional real es 409 y así queda tras la dedup.
  assert.equal(toolNames.length, 409);
});

test("pathfinder anuncia SOLO el contrato nuevo (layerIds/op/strokeColor)", () => {
  const pf = MCP_TOOLS.find(t => t.name === "pathfinder");
  const props = pf.inputSchema.properties;
  assert.ok(props.layerIds, "falta layerIds");
  assert.ok(props.op, "falta op");
  assert.ok(props.strokeColor, "falta strokeColor");
  assert.equal(props.op.enum.includes("unite"), true);
  assert.equal(props.op.enum.includes("minus_front"), true);
  assert.equal(props.elementIdA, undefined, "elementIdA no debe estar en el schema");
  assert.equal(props.elementIdB, undefined, "elementIdB no debe estar en el schema");
  assert.equal(props.operation, undefined, "operation no debe estar en el schema");
  assert.deepEqual(pf.inputSchema.required, ["templateId", "frameId", "layerIds", "op"]);
});

// ── F1/B1: validación estricta para TODA la categoría ──
test("por cada tool del catálogo, un param inexistente → -32602 con válidos listados", () => {
  let checked = 0;
  for (const tool of MCP_TOOLS) {
    const props = tool.inputSchema?.properties;
    if (!props) continue; // sin properties no hay contrato que validar
    let err = null;
    try {
      serverFns.validateToolParams(tool.name, { __param_fantasma__: 1 });
    } catch (e) {
      err = e;
    }
    assert.ok(err, `${tool.name} aceptó un param inexistente`);
    assert.equal(err.code, -32602, `${tool.name}: código esperado -32602`);
    assert.ok(
      err.message.includes(`para ${tool.name}`) && err.message.includes("__param_fantasma__") && err.message.includes("Válidos:"),
      `${tool.name}: mensaje no accionable → ${err.message}`,
    );
    checked++;
  }
  assert.ok(checked > 400, `se esperaban >400 tools con schema, hubo ${checked}`);
});

test("caso B1 exacto: draw_bezier con points → -32602 y frame intacto", () => {
  assert.throws(
    () => serverFns.validateToolParams("draw_bezier", { points: [[0, 0], [10, 10]] }),
    (e) => {
      assert.equal(e.code, -32602);
      assert.ok(e.message.includes('Parámetro desconocido "points" para draw_bezier'), e.message);
      for (const valid of ["pathData", "x", "y", "width", "height", "fill", "stroke", "strokeWidth", "closed"]) {
        assert.ok(e.message.includes(valid), `mensaje no lista "${valid}": ${e.message}`);
      }
      return true;
    },
  );
  // El rechazo ocurre en el dispatcher, ANTES de handleMethod: el frame jamás
  // se muta (orden verificado estáticamente más abajo).
});

test("dispatch: canonicalize → validate → handleMethod, en las 4 rutas HTTP", () => {
  assert.equal((mcpSource.match(/validateToolParams\(params\.name, toolArgs\)/g) || []).length, 2, "ruta tools/call");
  assert.equal((mcpSource.match(/validateToolParams\(method, toolArgs\)/g) || []).length, 2, "fallback directo");
  // Cada sitio define toolArgs = canonicalizeToolParams(...) y valida ANTES
  // de que el siguiente sitio vuelva a canonicalizar.
  const sites = [...mcpSource.matchAll(/const toolArgs = canonicalizeToolParams\(/g)].map(m => m.index);
  assert.equal(sites.length, 4, "4 rutas HTTP canonicalizan");
  sites.forEach((site, i) => {
    const limit = i + 1 < sites.length ? sites[i + 1] : mcpSource.length;
    const validate = mcpSource.indexOf("validateToolParams(", site);
    assert.ok(validate > site && validate < limit, "canonicalizar antes de validar");
  });
  // Ambas llamadas a handleMethod con args validados van DESPUÉS de validar.
  const firstValidate = mcpSource.indexOf("validateToolParams(params.name, toolArgs)");
  const lastHandle = mcpSource.lastIndexOf("handleMethod(method, toolArgs, null, {})");
  assert.ok(firstValidate !== -1 && lastHandle > firstValidate);
  // El puente interno de flows (createFlowToolBridge) pasa por handleMethod
  // sin validación HTTP: el handler de pathfinder canonicaliza por su cuenta.
  const bridge = mcpSource.indexOf("createFlowToolBridge");
  const pfHandler = mcpSource.indexOf('case "pathfinder": {', mcpSource.indexOf("switch (method)"));
  assert.ok(bridge !== -1 && pfHandler > bridge);
  assert.ok(/canonicalizeToolParams\("pathfinder", params\)/.test(mcpSource.slice(pfHandler, pfHandler + 2000)));
});

test("smoke de familias: params válidos de schema pasan la validación sin rechazo", () => {
  const dummy = (schema) => {
    const args = {};
    for (const [k, prop] of Object.entries(schema.properties)) {
      if (prop.enum) { args[k] = prop.enum[0]; continue; }
      args[k] = prop.type === "number" ? 1
        : prop.type === "boolean" ? true
        : prop.type === "array" ? ["x", "y"]
        : prop.type === "object" ? {}
        : "x";
    }
    return args;
  };
  // draw / path ops / texto / align / export — una tool por familia.
  for (const name of ["draw_bezier", "draw_shape", "pathfinder", "text_metrics", "align_elements", "export_frame"]) {
    const tool = MCP_TOOLS.find(t => t.name === name);
    assert.ok(tool, `tool de familia no encontrada: ${name}`);
    assert.doesNotThrow(() => serverFns.validateToolParams(name, dummy(tool.inputSchema)), name);
  }
});

// ── F2/B2: canonicalización del contrato viejo ──
test("pathfinder legacy: elementIdA/B + operation → layerIds + op, sin claves viejas", () => {
  assert.deepEqual(
    serverFns.canonicalizeToolParams("pathfinder", { elementIdA: "a", elementIdB: "b", operation: "union" }),
    { layerIds: ["a", "b"], op: "unite" },
  );
  assert.equal(serverFns.canonicalizeToolParams("pathfinder", { elementIdA: "a", elementIdB: "b", operation: "subtract" }).op, "minus_front");
  assert.equal(serverFns.canonicalizeToolParams("pathfinder", { elementIdA: "a", elementIdB: "b", operation: "intersect" }).op, "intersect");
  assert.equal(serverFns.canonicalizeToolParams("pathfinder", { elementIdA: "a", elementIdB: "b", operation: "exclude" }).op, "exclude");
  // Contrato nuevo: intacto; op explícito gana si llegan ambos.
  assert.deepEqual(
    serverFns.canonicalizeToolParams("pathfinder", { layerIds: ["a", "b"], op: "divide" }),
    { layerIds: ["a", "b"], op: "divide" },
  );
  assert.equal(serverFns.canonicalizeToolParams("pathfinder", { layerIds: ["a", "b"], op: "trim", operation: "union" }).op, "trim");
  // Otras tools: identidad.
  assert.deepEqual(serverFns.canonicalizeToolParams("draw_bezier", { points: 1 }), { points: 1 });
});

test("pathfinder handler único: deprecated flag y compat local para el puente interno", () => {
  const handler = caseSlice("pathfinder", "scissors");
  assert.ok(handler.includes("legacyContract"), "handler no detecta contrato viejo");
  assert.ok(handler.includes("deprecated: true"), "respuesta sin flag deprecated");
  assert.ok(handler.includes("pathfinder(engineOp,"), "handler debe usar el motor puro pathBoolean");
  assert.ok(!handler.includes("elementIdA]"), "no debe indexar params.elementIdA directo");
  // El registro viejo desapareció: solo queda el schema nuevo en el catálogo.
  assert.equal((mcpSource.match(/name: "pathfinder"/g) || []).length, 1);
  assert.equal((mcpSource.match(/case "pathfinder": \{/g) || []).length, 1);
});

// ── F1: defensa en profundidad en draw_* ──
test("assertCleanMarkup rechaza undefined/NaN nombrando el param culpable", () => {
  assert.throws(
    () => serverFns.assertCleanMarkup("draw_path", { x: 0, y: 0, width: NaN, height: 100, pathData: "M0 0" }),
    (e) => e.code === -32602 && e.message.includes('el param "width"') && e.message.includes("NaN"),
  );
  assert.throws(
    () => serverFns.assertCleanMarkup("draw_bezier", { x: 0, y: 0, width: 10, height: 10, pathData: "Mundefined" }),
    (e) => e.code === -32602 && e.message.includes('el param "pathData"'),
  );
  assert.throws(
    () => serverFns.assertCleanMarkup("draw_shape", { x: undefined, y: 0, width: 10, height: 10 }),
    (e) => e.code === -32602 && e.message.includes('el param "x"'),
  );
  // Params opcionales ausentes NO bloquean; presentes y sucios sí.
  assert.doesNotThrow(() => serverFns.assertCleanMarkup("draw_shape", { x: 0, y: 0, width: 10, height: 10 }, { type: "rect", color: "#333", sides: undefined, borderRadius: undefined }));
  assert.throws(
    () => serverFns.assertCleanMarkup("draw_shape", { x: 0, y: 0, width: 10, height: 10 }, { color: "undefined" }),
    (e) => e.code === -32602 && e.message.includes('el param "color"'),
  );
});

test("los 3 handlers draw_* validan ANTES de persistir", () => {
  for (const [name, next] of [["draw_shape", "draw_path"], ["draw_path", "draw_bezier"], ["draw_bezier", "edit_path_points"]]) {
    const slice = caseSlice(name, next);
    const guard = slice.indexOf("assertCleanMarkup(");
    const persist = slice.indexOf("await templates.updateTemplate(");
    assert.ok(guard !== -1, `${name}: falta assertCleanMarkup`);
    assert.ok(persist !== -1 && guard < persist, `${name}: la defensa va ANTES de persistir`);
  }
});

// ── B5/F5: paste_style acepta objeto y string (JSON) ──
test("normalizeStyleDeclarations: string CSS, objeto y string JSON → declaraciones CSS", () => {
  assert.equal(serverFns.normalizeStyleDeclarations("color: red; font-size: 16px;"), "color: red; font-size: 16px");
  assert.equal(serverFns.normalizeStyleDeclarations({ color: "#ff3b00", opacity: 0.5 }), "color: #ff3b00; opacity: 0.5");
  assert.equal(serverFns.normalizeStyleDeclarations('{"color":"#ff3b00"}'), "color: #ff3b00");
  assert.throws(() => serverFns.normalizeStyleDeclarations(42), (e) => e.code === -32602);
  for (const name of ["paste_style", "set_pseudo_state"]) {
    const slice = caseSlice(name, name === "paste_style" ? "set_pseudo_state" : "create_brand_guideline");
    assert.ok(slice.includes("normalizeStyleDeclarations(params.styles)"), `${name} no normaliza styles`);
    assert.ok(!slice.includes("params.styles.trim()"), `${name} aún hace .trim() directo`);
  }
});

// ── B4/F4: ni render_frame_png ni diff_overlay referencian `event` ──
test("render_frame_png y diff_overlay ya no tocan la variable inexistente event", () => {
  for (const [name, next] of [["diff_overlay", "render_frame_png"], ["render_frame_png", "text_metrics"]]) {
    const slice = caseSlice(name, next);
    // El check es de CÓDIGO: se quitan comentarios (// y /* */) antes de
    // buscar referencias — los propios comentarios REQ-049 mencionan `event`
    // documentando el crash, y https:// de las URLs no es un comentario.
    const code = slice
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
    assert.ok(!/\bevent\b/.test(code), `${name} aún referencia event`);
    assert.ok(slice.includes("auth?.authType"), `${name} debe sacar la key de auth`);
    assert.ok(code.includes("MCP_ADMIN_KEY"), `${name} sin ruta de key admin`);
  }
});

// ── B3/F3: autoSave del busca-trazos ──
test("handleTraceSelectedImage persiste con autoSave tras replaceAllWithUndo", () => {
  const start = editorSource.indexOf("const handleTraceSelectedImage");
  const end = editorSource.indexOf("const handleBatchGenerate");
  assert.ok(start !== -1 && end > start, "no se encontró handleTraceSelectedImage/handleBatchGenerate");
  const slice = editorSource.slice(start, end);
  const undo = slice.indexOf("store.replaceAllWithUndo(updatedFrames");
  const save = slice.indexOf("autoSave(updatedFrames)");
  assert.ok(undo !== -1, "falta replaceAllWithUndo");
  assert.ok(save > undo, "autoSave debe ir DESPUÉS de replaceAllWithUndo");
  assert.ok(slice.includes("traceBusy, autoSave]"), "autoSave falta en el array de dependencias");
  // Mismo convenio que el handler de referencia handleBatchGenerate.
  const ref = editorSource.slice(end, end + 300);
  assert.ok(ref.includes("autoSave(updatedFrames)"), "handleBatchGenerate dejó de ser la referencia");
});
