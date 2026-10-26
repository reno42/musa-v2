// REQ-051 — Research en Copywriting: fuentes RSS/Nitter → tarjetas → encargo
// «un click» que la IA del usuario conectada atiende (research_ai_tasks /
// research_ai_complete, espejo del contrato D1 de REQ-042).
//
// Estilo req042/req047: unit de la librería de ingesta (research-ingest.mjs es
// ESM puro) + del clasificador de scopes (flows-core) + asserts de fuente para
// lo que no importa directo (mcp.mjs, REST, migración, cron, frontend).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  articlePassesFilters,
  buildResearchBriefing,
  linkHash,
  newResumeToken,
  normalizeKeywords,
  normalizeRequestArgs,
  RESEARCH_LIMITS,
  ResearchArgsError,
} from "../worker/runtime/functions/research-ingest.mjs";
import { scopeForMethod, scopesAllowMethod } from "../worker/runtime/functions/flows-core.mjs";
import { RESEARCH_FORMATS, RESEARCH_NETWORKS } from "../shared/researchNetworks.ts";
import { COPY_PANES, DEFAULT_COPY_PANE, isCopyPane } from "../src/lib/appRoute.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mcp = readFileSync(join(root, "worker", "runtime", "functions", "mcp.mjs"), "utf8");
const rest = readFileSync(join(root, "api", "src", "routes", "research.ts"), "utf8");
const apiIndex = readFileSync(join(root, "api", "src", "index.ts"), "utf8");
const migration = readFileSync(join(root, "supabase_migrations_v78.sql"), "utf8");
const workerIndex = readFileSync(join(root, "worker", "index.js"), "utf8");
const contentTab = readFileSync(join(root, "src", "components", "ContentTab.tsx"), "utf8");
const researchTab = readFileSync(join(root, "src", "components", "ResearchTab.tsx"), "utf8");
const skill = readFileSync(join(root, "SKILL.md"), "utf8");

/** Cuerpo del array MCP_TOOLS por escaneo de corchetes (estilo req032). */
function mcpToolsBody(src) {
  const at = src.indexOf("const MCP_TOOLS");
  assert.ok(at >= 0, "MCP_TOOLS existe en mcp.mjs");
  const open = src.indexOf("[", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]") { depth--; if (depth === 0) return src.slice(open + 1, i); }
  }
  return "";
}

/** La entrada de UNA tool: desde `name: "<n>"` hasta el siguiente `name: "`. */
function toolEntry(src, name) {
  const start = src.indexOf(`name: "${name}"`);
  if (start < 0) return null;
  const next = src.indexOf('\n  {\n    name: "', start + name.length);
  return src.slice(start, next > start ? next : src.length);
}

const RESEARCH_TOOLS = [
  "research_list_sources", "research_add_source", "research_update_source",
  "research_delete_source", "research_refresh_sources", "research_list_items",
  "research_update_item", "research_create_request", "research_ai_tasks",
  "research_ai_complete",
];

// ── 1. Ingesta (unit real) ──────────────────────────────────────────────────

test("P051-1 normalizeKeywords: lowercase, trim, dedupe y caps", () => {
  assert.deepEqual(normalizeKeywords([" IA ", "ia", "Marketing", "", "MARKETING"]), ["ia", "marketing"]);
  assert.deepEqual(normalizeKeywords("no-array"), []);
  assert.deepEqual(normalizeKeywords(null), []);
  const many = Array.from({ length: 30 }, (_, i) => `k${i}`);
  assert.equal(normalizeKeywords(many).length, 20, "cap de 20 keywords");
  assert.equal(normalizeKeywords(["x".repeat(100)])[0].length, 60, "cap de 60 chars");
});

test("P051-2 articlePassesFilters: include ANY (vacío pasa todo) y exclude ANY descarta", () => {
  const article = { title: "OpenAI lanza modelo", summary: "novedades de IA generativa" };
  assert.equal(articlePassesFilters(article, [], []), true, "sin filtros pasa todo");
  assert.equal(articlePassesFilters(article, ["ia"], []), true, "include matchea en summary");
  assert.equal(articlePassesFilters(article, ["fútbol"], []), false, "include sin match filtra");
  assert.equal(articlePassesFilters(article, ["ia", "fútbol"], []), true, "include es ANY");
  assert.equal(articlePassesFilters(article, [], ["lanza"]), false, "exclude descarta por título");
  assert.equal(articlePassesFilters(article, ["ia"], ["generativa"]), false, "exclude gana tras include");
});

test("P051-3 linkHash: sha256 estable por link normalizado", () => {
  const h = linkHash("https://example.com/nota");
  assert.equal(h, linkHash("https://example.com/nota "), "trim aplica");
  assert.equal(h, linkHash("https://example.com/nota"), "mismo link mismo hash");
  assert.notEqual(h, linkHash("https://example.com/otra"));
  assert.match(h, /^[0-9a-f]{64}$/, "sha256 hex");
});

test("P051-4 newResumeToken: capability rrq_ + base36 aleatorio", () => {
  const t = newResumeToken();
  assert.match(t, /^rrq_[0-9a-z]{24}$/);
  assert.notEqual(t, newResumeToken(), "dos tokens nunca iguales");
});

test("P051-5 normalizeRequestArgs: valida redes/formatos contra shared/, dedupe y defaults", () => {
  const args = normalizeRequestArgs({
    networks: ["LinkedIn", "x", "linkedin"],
    formats: ["post", "story"],
    includeDesign: "true",
    brandId: "  ",
    notes: "  ángulo propio  ",
    scheduledDate: "2026-02-01",
  });
  assert.deepEqual(args.networks, ["linkedin", "x"], "lowercase + dedupe");
  assert.deepEqual(args.formats, ["post", "story"]);
  assert.equal(args.includeDesign, true, "el string 'true' también cuenta");
  assert.equal(args.brandId, null, "vacío → null");
  assert.equal(args.notes, "ángulo propio");
  assert.equal(args.scheduledDate, "2026-02-01");
});

test("P051-6 normalizeRequestArgs rechaza basura con ResearchArgsError accionable", () => {
  assert.throws(() => normalizeRequestArgs({ networks: [], formats: ["post"] }),
    (e) => e instanceof ResearchArgsError && /networks/.test(e.message));
  assert.throws(() => normalizeRequestArgs({ networks: ["bebo"], formats: ["post"] }),
    (e) => e instanceof ResearchArgsError && /bebo/.test(e.message) && /linkedin/.test(e.message),
    "el error lista las redes válidas");
  assert.throws(() => normalizeRequestArgs({ networks: ["x"], formats: [] }),
    ResearchArgsError, "formats vacío rechaza");
  assert.throws(() => normalizeRequestArgs({ networks: "x", formats: ["post"] }),
    ResearchArgsError, "networks no-array rechaza");
  assert.throws(() => normalizeRequestArgs({ networks: ["x"], formats: ["post"], scheduledDate: "feb" }),
    (e) => /YYYY-MM-DD/.test(e.message));
});

test("P051-7 buildResearchBriefing: noticia adjunta, matrix elegida y contrato de entrega", () => {
  const briefing = buildResearchBriefing({
    item: { title: "La noticia", summary: "resumen", link: "https://n.com/1", image_url: "https://n.com/i.jpg", published_at: "2026-02-01T00:00:00Z", source_name: "TechCrunch" },
    networks: ["linkedin", "x"],
    formats: ["carrusel"],
    includeDesign: true,
    brandName: "Futuraria",
    notes: "tono serio",
    scheduledDate: "2026-02-02",
    resumeToken: "rrq_TEST123",
    sourceName: "TechCrunch",
  });
  assert.ok(briefing.includes("La noticia"), "título adjunto");
  assert.ok(briefing.includes("https://n.com/1"), "link adjunto");
  assert.ok(briefing.includes("rrq_TEST123"), "token en el contrato");
  assert.ok(briefing.includes("research_ai_complete"), "tool de entrega");
  assert.ok(briefing.includes('"entries"'), "requiredKeys documentado");
  assert.ok(briefing.includes("linkedin") && briefing.includes("x"), "redes elegidas");
  assert.ok(briefing.includes("1080x1350"), "medidas del formato");
  assert.ok(briefing.includes("duplicate_template"), "estrategia master template");
  assert.ok(briefing.includes("add_content_idea") && briefing.includes("update_content"), "creación de entradas");
  assert.ok(briefing.includes("publish_content no"), "NO publica (decisión humana)");
  assert.ok(briefing.includes("tono serio"), "notas del humano viajan");
  const sinDiseno = buildResearchBriefing({
    item: { title: "t", link: "https://n.com/2" }, networks: ["x"], formats: ["post"],
    includeDesign: false, resumeToken: "rrq_X",
  });
  assert.ok(sinDiseno.includes("solo copy"), "sin diseños lo dice explícito");
  assert.ok(!sinDiseno.includes("duplicate_template"), "sin diseños no pide clonar");
});

test("P051-8 límites freemium coherentes con la migración", () => {
  assert.equal(RESEARCH_LIMITS.minRefreshMinutes, 30);
  assert.ok(RESEARCH_LIMITS.maxSourcesPerWorkspace <= 20);
  assert.ok(RESEARCH_LIMITS.maxItemsPerWorkspace >= RESEARCH_LIMITS.maxItemsPerIngest);
  assert.match(migration, /refresh_minutes >= 30/, "el CHECK de la BD coincide con el floor");
  assert.equal(RESEARCH_NETWORKS.length, 5);
  assert.equal(RESEARCH_FORMATS.length, 3);
});

// ── 2. Scopes (unit real, REQ-047) ──────────────────────────────────────────

test("P051-9 scopeForMethod clasifica research: bandeja read/resume, CRUD assets", () => {
  assert.equal(scopeForMethod("research_list_sources"), "assets:read");
  assert.equal(scopeForMethod("research_list_items"), "assets:read");
  assert.equal(scopeForMethod("research_add_source"), "assets:write");
  assert.equal(scopeForMethod("research_refresh_sources"), "assets:write");
  assert.equal(scopeForMethod("research_create_request"), "assets:write");
  assert.equal(scopeForMethod("research_ai_tasks"), "flows:read", "la bandeja es flows:read igual que flow_ai_tasks");
  assert.equal(scopeForMethod("research_ai_complete"), "flows:resume", "la entrega es flows:resume igual que flow_ai_complete");
});

test("P051-10 presets de «Conecta tu IA» pueden atender research", () => {
  const atendedor = ["flows:read", "flows:resume"];
  assert.equal(scopesAllowMethod(atendedor, "research_ai_tasks"), true);
  assert.equal(scopesAllowMethod(atendedor, "research_ai_complete"), true);
  assert.equal(scopesAllowMethod(atendedor, "research_add_source"), false, "el atendedor no administra fuentes");
  const agente = ["flows:read", "flows:write", "flows:resume", "assets:read", "assets:write"];
  for (const t of RESEARCH_TOOLS) assert.equal(scopesAllowMethod(agente, t), true, t);
});

// ── 3. Registro MCP (source asserts) ────────────────────────────────────────

test("P051-11 las 10 tools research_* están en MCP_TOOLS con schema y dispatch", () => {
  const body = mcpToolsBody(mcp);
  for (const name of RESEARCH_TOOLS) {
    const entry = toolEntry(body, name);
    assert.ok(entry, `entrada MCP_TOOLS de ${name}`);
    assert.ok(entry.includes("inputSchema"), `${name} declara inputSchema`);
    assert.ok(entry.includes("description"), `${name} declara description`);
    assert.ok(mcp.includes(`case "${name}":`), `${name} tiene case de dispatch`);
  }
  assert.ok(toolEntry(body, "research_create_request").includes('"networks"'), "create pide networks");
  assert.ok(toolEntry(body, "research_create_request").includes('"formats"'), "create pide formats");
  assert.ok(toolEntry(body, "research_ai_complete").includes('"entries"'), "complete declara entries requerido");
});

test("P051-12 la bandeja y la entrega van auditadas y la librería se importa una sola vez", () => {
  assert.match(mcp, /AUDITED_METHODS = new Set\(\[[^\]]*"research_ai_tasks"[^\]]*"research_ai_complete"/s),
    "bandeja + entrega auditadas como flow_ai_*";
  assert.match(mcp, /from "\.\/research-ingest\.mjs"/, "mcp importa la librería compartida");
  assert.match(mcp, /ingestDueSources\(sb, \{ forceSourceIds/, "refresh/primera ingesta reusan el sweep");
  assert.match(mcp, /normalizeRequestArgs\(params\)/, "create_request valida con la MISMA librería que la REST");
});

test("P051-13 research_ai_complete: requiredKeys con el MISMO token (estilo REQ-042)", () => {
  const entry = mcp.slice(mcp.indexOf('case "research_ai_complete":'));
  assert.match(entry, /payloadRejected: true/, "rechazo explícito");
  assert.match(entry, /missingKeys/, "lista las claves que faltan");
  assert.match(entry, /resumeToken: token/, "el MISMO token vuelve válido");
  assert.match(entry, /payload debe ser un OBJETO/, "array al tope rechazado");
  assert.match(entry, /status: "done"/, "entrega válida marca done");
  assert.match(entry, /status: "used"/, "la tarjeta pasa a usada");
});

// ── 4. REST (source asserts) ────────────────────────────────────────────────

test("P051-14 /api/research expone las rutas del pane con tenancy checkeada", () => {
  for (const route of [
    'researchRoutes.get("/sources"', 'researchRoutes.post("/sources"',
    'researchRoutes.patch("/sources/:id"', 'researchRoutes.delete("/sources/:id"',
    'researchRoutes.post("/sources/refresh"', 'researchRoutes.get("/items"',
    'researchRoutes.patch("/items/:id"', 'researchRoutes.post("/requests"',
    'researchRoutes.get("/requests"',
  ]) assert.ok(rest.includes(route), route);
  assert.match(rest, /canAccessWorkspace\(req\.auth, workspaceId, "editor"\)/, "escritura pide editor");
  assert.match(rest, /canAccessWorkspace\(req\.auth, workspaceId, "viewer"\)/, "lectura pide viewer");
  assert.match(rest, /item\.workspace_id !== workspaceId/, "el item se valida por fila, no por body");
  assert.match(rest, /supabase_migrations_v78/, "el setup error apunta a la migración correcta");
  assert.match(apiIndex, /app\.use\("\/api\/research", researchRoutes\)/, "montada en api/src/index.ts");
});

// ── 5. Migración v78 ────────────────────────────────────────────────────────

test("P051-15 v78: tres tablas, dedupe por link_hash y RLS como copy_recipes", () => {
  for (const table of ["research_sources", "research_items", "research_requests"]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), table);
    assert.match(migration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`), `RLS ${table}`);
  }
  assert.match(migration, /UNIQUE \(workspace_id, link_hash\)/, "dedupe por workspace+link");
  assert.match(migration, /url LIKE 'https:\/\/%'/, "solo feeds https");
  assert.match(migration, /ON DELETE CASCADE/, "items cuelgan de su fuente");
  assert.match(migration, /resume_token\s+TEXT NOT NULL UNIQUE/, "el token es capability única");
  assert.match(migration, /briefing\s+TEXT NOT NULL/, "el briefing viaja resuelto en la fila");
});

// ── 6. Cron (sweep en el tick de 5 min) ─────────────────────────────────────

test("P051-16 el sweep de research vive en el scheduled con kill switch", () => {
  assert.match(workerIndex, /import \{ ingestDueSources \} from "\.\/runtime\/functions\/research-ingest\.mjs"/);
  assert.match(workerIndex, /RESEARCH_INGEST_ENABLED/, "kill switch como el sweep de webhooks");
  assert.match(workerIndex, /ingestDueSources\(sbAdmin\)/, "el cron barre global (sin workspaceId)");
});

// ── 7. Frontend ─────────────────────────────────────────────────────────────

test("P051-17 COPY_PANES: research primero (intake), default sigue calendar", () => {
  assert.equal(COPY_PANES[0], "research");
  assert.ok(COPY_PANES.includes("calendar"));
  assert.equal(DEFAULT_COPY_PANE, "calendar");
  assert.equal(isCopyPane("research"), true);
});

test("P051-18 ContentTab: el pane research está en la nav, fuera del loading gate y renderizado", () => {
  assert.match(contentTab, /type Pane = "research" \|/, "union de panes");
  assert.match(contentTab, /\["research", "calendar"/, "PANES con research primero");
  assert.match(contentTab, /label: "Research"/, "PANE_META.research");
  assert.match(contentTab, /pane !== "research" && pane !== "copies"/, "fuera del loading gate");
  assert.match(contentTab, /import \{ ResearchTab \} from "\.\/ResearchTab"/);
  assert.match(contentTab, /pane === "research" \? \(/, "rama de render");
  assert.match(contentTab, /<ResearchTab workspaceId=\{workspaceId\} actions=\{connControl\} \/>/);
});

test("P051-19 ResearchTab: genera vía REST (sin LLM), modal con redes/formatos de shared/", () => {
  assert.match(researchTab, /from "\.\.\/\.\.\/shared\/researchNetworks"/, "constantes compartidas");
  assert.match(researchTab, /RESEARCH_NETWORKS\.map/, "toggles de redes desde shared/");
  assert.match(researchTab, /RESEARCH_FORMATS\.map/, "toggles de formatos desde shared/");
  assert.match(researchTab, /\/api\/research\/requests/, "el encargo va por la REST");
  assert.match(researchTab, /\/api\/research\/sources\/refresh/, "refresh manual");
  assert.match(researchTab, /research_ai_tasks/, "explica el contrato de la bandeja");
  assert.match(researchTab, /Copiar briefing/, "fallback manual del briefing");
  assert.doesNotMatch(researchTab, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "sin emojis (póliza UI)");
});

// ── 8. Documentación ────────────────────────────────────────────────────────

test("P051-20 SKILL.md documenta las tools nuevas (regla del proyecto)", () => {
  for (const name of RESEARCH_TOOLS) {
    assert.ok(skill.includes(name), `SKILL.md menciona ${name}`);
  }
});
