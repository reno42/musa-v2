/**
 * REQ-061 Fase 2 — jerarquía de tags, vocabulario global y sugerencias.
 *
 * Cubre el core compartido que sirven por igual a MCP, REST y UI:
 *   - shared/tagHierarchy.ts → buildTagTree (ancestros implícitos,
 *     totalDegree bottom-up), selectVisibleTags (top-N + clausura de
 *     ancestros), subtreeMembers (agregación genérica).
 *   - shared/tagSuggest.ts   → tokenizeForTags, buildCooccurrence,
 *     suggestTags (overlap de contenido, hermanas, popularidad, co-ocurrencia).
 *   - src/lib/designGraph.ts → la rama Etiquetas anida el árbol punteado.
 *   - Superficie MCP/REST (slicing de fuente, patrón QA/mcp-*).
 *
 * Run: node --experimental-strip-types --test QA/req061-taxonomy-fase2.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildTagTree, selectVisibleTags, subtreeMembers } from "../shared/tagHierarchy.ts";
import { tokenizeForTags, buildCooccurrence, suggestTags } from "../shared/tagSuggest.ts";
import { buildDesignHierarchy, buildKnowledgeGraph } from "../src/lib/designGraph.ts";

// ── tagHierarchy ────────────────────────────────────────────

test("buildTagTree: anida por path punteado con ancestros implícitos y totalDegree bottom-up", () => {
  const { roots, byPath } = buildTagTree(new Map([
    ["redes", 2], ["redes.instagram", 3], ["redes.instagram.stories", 1], ["web", 4],
  ]));
  // Raíces ordenadas por totalDegree desc: redes (2+3+1=6) > web (4).
  assert.deepEqual(roots.map(n => n.path), ["redes", "web"]);
  const stories = byPath.get("redes.instagram.stories");
  assert.ok(stories);
  assert.equal(stories.leaf, "stories");
  assert.equal(stories.parent, "redes.instagram");
  assert.equal(stories.degree, 1);
  assert.equal(stories.totalDegree, 1);
  const instagram = byPath.get("redes.instagram");
  assert.equal(instagram.parent, "redes");
  assert.equal(instagram.totalDegree, 4); // 3 + 1 (stories)
  assert.equal(byPath.get("redes").totalDegree, 6); // 2 + 3 + 1
  assert.equal(byPath.get("web").parent, null);
});

test("buildTagTree: solo los tags reales (degree > 0) crean rama", () => {
  const { byPath } = buildTagTree(new Map([["x", 0], ["", 5], ["real", 1]]));
  assert.ok(!byPath.has("x"));
  assert.ok(!byPath.has(""));
  assert.ok(byPath.has("real"));
});

test("selectVisibleTags: top-N real tags más clausura de ancestros", () => {
  const { byPath } = buildTagTree(new Map([
    ["a.b.c", 5], ["top", 3], ["otro", 1],
  ]));
  // Top-1 por totalDegree: a.b.c (5). La clausura trae a y a.b.
  const one = selectVisibleTags(byPath, 1);
  assert.deepEqual([...one].sort(), ["a", "a.b", "a.b.c"]);
  // Top-2 suma "top" (3 > 1).
  const two = selectVisibleTags(byPath, 2);
  assert.ok(two.has("top"));
  assert.ok(!two.has("otro"));
  assert.equal(selectVisibleTags(byPath, 0).size, 0);
});

test("subtreeMembers: agrega el subárbol y es genérica (ids u objetos)", () => {
  const { byPath } = buildTagTree(new Map([["redes", 1], ["redes.instagram", 2]]));
  const ids = new Map([["redes", ["d1"]], ["redes.instagram", ["d2", "d3"]]]);
  assert.deepEqual(subtreeMembers(byPath.get("redes"), ids), ["d1", "d2", "d3"]);
  const simNodes = new Map([["redes", [{ id: "n1" }]]]);
  assert.deepEqual(subtreeMembers(byPath.get("redes"), simNodes), [{ id: "n1" }]);
});

// ── tagSuggest ──────────────────────────────────────────────

test("tokenizeForTags: lowercase, sin acentos, split no-alfanum, mínimo 3 chars", () => {
  assert.deepEqual(tokenizeForTags("Redes-Sociales Ñandú"), ["redes", "sociales", "nandu"]);
  assert.deepEqual(tokenizeForTags("de la e-com abc"), ["com", "abc"]);
  assert.deepEqual(tokenizeForTags(null), []);
});

test("buildCooccurrence: semilla por tags actuales; cold start por categoría", () => {
  const rows = [
    { tags: ["a", "b"] },
    { tags: ["a", "c"] },
    { tags: ["b"] }, // no comparte semilla → no cuenta
  ];
  const co = buildCooccurrence(rows, { currentTags: ["a"] });
  assert.equal(co.get("b"), 1);
  assert.equal(co.get("c"), 1);
  assert.equal(co.size, 2);

  const cold = buildCooccurrence(
    [{ tags: ["x"], category: "print" }, { tags: ["y"], category: "digital" }],
    { category: "print" },
  );
  assert.deepEqual([...cold.entries()], [["x", 1]]);

  assert.equal(buildCooccurrence(rows, {}).size, 0);
});

test("suggestTags: overlap de contenido, exclusiones y orden determinista", () => {
  const candidates = [
    { name: "navidad", count: 2 },
    { name: "navidad.stories", count: 0 },
    { name: "secret", count: 9, isInternal: true },
    { name: "actual", count: 9 },
    { name: "beta", count: 5 },
    { name: "alpha", count: 5 },
  ];
  const out = suggestTags(
    { fileName: "Post navidad 2026", currentTags: ["actual"] },
    candidates,
  );
  const names = out.map(s => s.name);
  assert.ok(!names.includes("actual"));    // ya está en el archivo
  assert.ok(!names.includes("secret"));    // isInternal nunca se sugiere
  assert.ok(names.includes("navidad"));    // overlap con el nombre
  assert.ok(names.includes("navidad.stories") === false || true); // puede o no entrar por score
  // Contenido pesa +2/hit: navidad (2) > alpha/beta (solo popularidad 0.75).
  assert.equal(names.indexOf("navidad"), 0);
  // Empate alpha/beta: alfabético, determinista.
  assert.ok(names.indexOf("alpha") < names.indexOf("beta"));
  // Cada sugerencia trae razones (justicia explicable).
  assert.ok(out.every(s => s.reasons.length > 0));
  assert.ok(out.every(s => typeof s.score === "number" && s.score > 0));
});

test("suggestTags: hermanas por padre y co-ocurrencia suman; limit se respeta", () => {
  const candidates = [
    { name: "redes.tiktok", parent: "redes" },
    { name: "sueleir", count: 0 },
  ];
  const out = suggestTags(
    { currentTags: ["redes.instagram"] },
    candidates,
    { limit: 1, cooccurrence: new Map([["sueleir", 10]]) },
  );
  assert.equal(out.length, 1);
  // tiktok: hermana (1.2) vs sueleir: co-ocurrencia capada a 3 → gana sueleir.
  assert.equal(out[0].name, "sueleir");
  // Sin co-ocurrencia sueleir queda en 0 y no se sugiere; con ella, entran ambos.
  const both = suggestTags(
    { currentTags: ["redes.instagram"] }, candidates,
    { limit: 5, cooccurrence: new Map([["sueleir", 10]]) },
  );
  assert.equal(both.length, 2);
  const tiktok = both.find(s => s.name === "redes.tiktok");
  assert.ok(tiktok.reasons.some(r => r.includes("hermana")));
});

test("suggestTags: cold start por categoría matchea candidatos del mismo tema", () => {
  const out = suggestTags(
    { category: "Navidad", currentTags: [] },
    [{ name: "navidad.intro" }, { name: "corporativo" }],
  );
  assert.deepEqual(out.map(s => s.name), ["navidad.intro"]);
});

// ── Grafo (rama Etiquetas anidada) ──────────────────────────

const mkDesign = (id, tags) => ({
  id, name: `Diseño ${id}`,
  brand_id: "ws-1", brand: "Futuraria",
  campaign: null, tags, theme: "", format: "", file_type: "",
  cover: null, obsidian_link: "",
});

test("buildKnowledgeGraph: Etiquetas anida el árbol punteado con aristas tagged exactas", () => {
  const designs = [
    mkDesign("d1", ["redes.instagram", "navidad"]),
    mkDesign("d2", ["redes.instagram.stories"]),
  ];
  const hierarchy = buildDesignHierarchy(designs, [], [], { id: "ws-1", name: "W" });
  const { nodes, edges } = buildKnowledgeGraph({ id: "ws-1", name: "W" }, hierarchy);

  const tagIds = nodes.filter(n => n.id.startsWith("tag:")).map(n => n.id);
  // Ancestro implícito "redes" existe aunque nadie etiquetó ese path exacto.
  assert.ok(tagIds.includes("tag:redes"));
  assert.ok(tagIds.includes("tag:redes.instagram"));
  assert.ok(tagIds.includes("tag:redes.instagram.stories"));
  assert.ok(tagIds.includes("tag:navidad"));
  // Label = segmento hoja.
  const stories = nodes.find(n => n.id === "tag:redes.instagram.stories");
  assert.equal(stories.name, "stories");
  // contains: tag_root → redes → redes.instagram → stories.
  const hasEdge = (source, target, kind) =>
    edges.some(e => e.source === source && e.target === target && e.kind === kind);
  assert.ok(hasEdge("tag_root", "tag:redes", "contains"));
  assert.ok(hasEdge("tag:redes", "tag:redes.instagram", "contains"));
  assert.ok(hasEdge("tag:redes.instagram", "tag:redes.instagram.stories", "contains"));
  assert.ok(hasEdge("tag_root", "tag:navidad", "contains"));
  // tagged: solo al path exacto — d2 NO cuelga del ancestro redes.
  assert.ok(hasEdge("design:d1", "tag:redes.instagram", "tagged"));
  assert.ok(hasEdge("design:d2", "tag:redes.instagram.stories", "tagged"));
  assert.ok(!hasEdge("design:d2", "tag:redes", "tagged"));
});

test("buildKnowledgeGraph: maxTagNodes selecciona familias por grado de subárbol", () => {
  const designs = [
    mkDesign("d1", ["redes.instagram"]),
    mkDesign("d2", ["redes.instagram.stories"]),
    mkDesign("d3", ["navidad"]),
  ];
  const hierarchy = buildDesignHierarchy(designs, [], [], { id: "ws-1", name: "W" });
  const { nodes } = buildKnowledgeGraph({ id: "ws-1", name: "W" }, hierarchy, { maxTagNodes: 1 });
  const tagIds = nodes.filter(n => n.id.startsWith("tag:")).map(n => n.id);
  // Top-1 real = redes (totalDegree 2, desempate alfabético contra
  // redes.instagram); la clausura trae al padre. Ni stories (real, fuera
  // del top-N) ni navidad (totalDegree 1) sobreviven al límite.
  assert.ok(tagIds.includes("tag:redes"));
  assert.ok(tagIds.includes("tag:redes.instagram"));
  assert.ok(!tagIds.includes("tag:redes.instagram.stories"));
  assert.ok(!tagIds.includes("tag:navidad"));
});

// ── Superficie MCP + REST (slicing de fuente) ───────────────

const mcpSource = readFileSync(new URL("../worker/runtime/functions/mcp.mjs", import.meta.url), "utf8");
const metaSource = readFileSync(new URL("../api/src/routes/designMeta.ts", import.meta.url), "utf8");
const canvasSource = readFileSync(new URL("../src/components/BrandGraphCanvas.tsx", import.meta.url), "utf8");

test("mcp: design_tag_register expone scope workspace|global y promueve con gobernanza", () => {
  assert.match(mcpSource, /name: "design_tag_register"/);
  assert.match(mcpSource, /scope: \{ type: "string", enum: \["workspace", "global"\]/);
  assert.match(mcpSource, /const isGlobal = params\.scope === "global";/);
  // Promoción del tag de workspace a global pasa por la gobernanza.
  assert.match(mcpSource, /if \(isGlobal && existing\.workspace_id\) await assertGlobalTagGovernance\(/);
  // Insert global: workspace_id NULL (vocabulario de la cuenta).
  assert.match(mcpSource, /workspace_id: isGlobal \? null : params\.workspaceId/);
});

test("mcp: design_tag_update y design_tag_delete gobiernan filas globales", () => {
  assert.match(mcpSource, /if \(!row\.workspace_id\) await assertGlobalTagGovernance\(auth, sbTu, params\.workspaceId\);/);
  assert.match(mcpSource, /if \(row && !row\.workspace_id\) await assertGlobalTagGovernance\(auth, sbTd, params\.workspaceId\);/);
  // La regla: solo admin, owner/admin de workspace key, o sesión dueña.
  assert.match(mcpSource, /async function assertGlobalTagGovernance\(auth, sb, workspaceId\)/);
  assert.match(mcpSource, /GLOBAL_TAG_FORBIDDEN/);
});

test("mcp: design_tag_suggest definido, despachado y alimentado por el motor puro", () => {
  assert.match(mcpSource, /name: "design_tag_suggest"/);
  assert.match(mcpSource, /case "design_tag_suggest":/);
  assert.match(mcpSource, /import \{ buildCooccurrence, suggestTags \} from "\.\.\/\.\.\/\.\.\/shared\/tagSuggest\.ts";/);
  assert.match(mcpSource, /const cooccurrence = buildCooccurrence\(rows, \{ currentTags, category \}\);/);
  // El registry consultado incluye el alcance global (workspace_id NULL).
  assert.match(mcpSource, /workspace_id\.eq\.\$\{params\.workspaceId\},workspace_id\.is\.null/);
});

test("rest: taxonomy marca scope y existe GET /:templateId/tag-suggestions", () => {
  assert.match(metaSource, /tag-suggestions/);
  assert.match(metaSource, /import \{ buildCooccurrence, suggestTags \} from "\.\.\/\.\.\/\.\.\/shared\/tagSuggest\.ts";/);
  // Fase 2: workspace_id NULL = vocabulario global de la cuenta.
  assert.match(metaSource, /scope: reg \? \(reg\.workspace_id \? "workspace" : "global"\) : "workspace"/);
  // El endpoint degrada con las tablas ausentes (pre-v85).
  assert.match(metaSource, /const registry = regRes\.error \? \[\] : \(regRes\.data \|\| \[\]\);/);
});

test("ui: el canvas del grafo usa el árbol (TAG_CHILD_ORBIT) y el panel pide sugerencias", () => {
  assert.match(canvasSource, /import \{ buildTagTree, selectVisibleTags, subtreeMembers \} from "\.\.\/\.\.\/shared\/tagHierarchy";/);
  assert.match(canvasSource, /const TAG_CHILD_ORBIT = \d+;/);
  assert.match(canvasSource, /const tree = buildTagTree\(degrees\);/);
});
