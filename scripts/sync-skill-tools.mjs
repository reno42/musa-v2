/**
 * sync-skill-tools.mjs — keep SKILL.md's tool catalog in sync with the real
 * MCP server definition.
 *
 * The single source of truth for the tool list is `const MCP_TOOLS = [...]`
 * in worker/runtime/functions/mcp.mjs (the same array the server returns on
 * tools/list). This script:
 *
 *   1. Parses that array (bracket-depth scan with string-literal skipping,
 *      then name/description extraction per tool).
 *   2. Regenerates the "Complete Tool Catalog" section of SKILL.md between
 *      the <!-- TOOL_CATALOG_AUTO_START --> / <!-- TOOL_CATALOG_AUTO_END -->
 *      markers (created on first run, right after the curated categories).
 *   2b. Regenerates tools_catalog.json (name + description + inputSchema)
 *      from the same parse, so the JSON snapshot can never drift either.
 *   3. Updates the standing counts in SKILL.md so they never drift:
 *        - "through <N> MCP tools" (Agent Discovery intro)
 *        - "Tengo acceso a <N> herramientas" (opening-move script)
 *        - the curated-categories note ("all <N> tools")
 *   4. Optionally cross-checks the count against the live production server
 *      (--check-live; non-fatal, useful pre-deploy).
 *
 * Idempotent: safe to run any number of times. Usage:
 *   node scripts/sync-skill-tools.mjs [--check-live]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MCP_SRC = resolve(root, "worker", "runtime", "functions", "mcp.mjs");
const SKILL_SRC = resolve(root, "SKILL.md");

const MARK_START = "<!-- TOOL_CATALOG_AUTO_START -->";
const MARK_END = "<!-- TOOL_CATALOG_AUTO_END -->";

// ── 1. Parse MCP_TOOLS from mcp.mjs ─────────────────────────────────────────
function parseMcpTools(source, nodeSchemaDoc) {
  const start = source.indexOf("const MCP_TOOLS = [");
  if (start === -1) throw new Error("MCP_TOOLS array not found in mcp.mjs");

  // Bracket-depth scan from the opening "[" — skip string literals so braces
  // inside descriptions/inputSchema never confuse the depth counter.
  let depth = 0;
  let i = source.indexOf("[", start);
  let end = -1;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === '"' || ch === "`") {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") { i += 2; continue; }
        if (source[i] === quote) break;
        i++;
      }
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) throw new Error("Could not find the end of MCP_TOOLS array");
  const body = source.slice(start, end + 1); // includes the outer [ ]

  // Split the array into its top-level objects (depth 0→1 on "{", 1→0 on "}")
  // and extract the FIRST name/description of each — nested inputSchema
  // property descriptions are ignored by construction.
  const tools = [];
  const raws = [];
  let objStart = -1;
  depth = 0;
  for (let j = 1; j < body.length - 1; j++) {
    const ch = body[j];
    if (ch === '"' || ch === "`") {
      const quote = ch;
      j++;
      while (j < body.length) {
        if (body[j] === "\\") { j += 2; continue; }
        if (body[j] === quote) break;
        j++;
      }
      continue;
    }
    if (ch === "{") {
      if (depth === 0) objStart = j;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart !== -1) {
        tools.push(extractTool(body.slice(objStart, j + 1), nodeSchemaDoc));
        raws.push(body.slice(objStart, j + 1));
        objStart = -1;
      }
    }
  }

  const failed = tools.filter(t => t === null);
  if (failed.length) {
    throw new Error(`Could not parse ${failed.length} tool object(s) in MCP_TOOLS — check formatting in mcp.mjs`);
  }
  return { tools, raws };
}

function extractTool(objText, nodeSchemaDoc) {
  const nameM = objText.match(/name:\s*"((?:[^"\\]|\\.)*)"/);
  // Description can be a double-quoted string OR a template literal (flows
  // interpolate ${NODE_SCHEMA_DOC}). Substitute the real doc text so the
  // catalog carries the same prompt the server actually serves.
  const descM = objText.match(/description:\s*(?:"((?:[^"\\]|\\.)*)"|`([^`]*)`)/);
  if (!nameM || !descM) return null;
  const description = descM[1] !== undefined
    ? descM[1].replace(/\\"/g, '"')
    : descM[2].replace(/\$\{NODE_SCHEMA_DOC\}/g, nodeSchemaDoc).trim();
  return {
    name: nameM[1].replace(/\\"/g, '"'),
    description,
  };
}

// ── 2. Build the auto-synced markdown section ───────────────────────────────
function buildCatalogSection(tools) {
  const lines = [];
  lines.push(MARK_START);
  lines.push("### Complete Tool Catalog (auto-synced)");
  lines.push("");
  lines.push(
    `> **Total: ${tools.length} tools.** This section is generated by ` +
    "`npm run sync:skill` (scripts/sync-skill-tools.mjs) directly from " +
    "`worker/runtime/functions/mcp.mjs` — exactly what `tools/list` returns, in " +
    "alphabetical order. Do not edit by hand; edit the MCP server and re-run."
  );
  lines.push("");
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  for (const t of sorted) {
    const desc = t.description.replace(/\s+/g, " ").trim();
    lines.push(`- \`${t.name}\` — ${desc}`);
  }
  lines.push("");
  lines.push(MARK_END);
  return lines.join("\n");
}

// ── 3. Patch SKILL.md ───────────────────────────────────────────────────────
function patchSkill(skill, tools, section) {
  let out = skill;
  const count = tools.length;

  // 3a. Insert/replace the auto-synced section.
  const startIdx = out.indexOf(MARK_START);
  const endIdx = out.indexOf(MARK_END);
  if (startIdx !== -1 && endIdx !== -1) {
    out = out.slice(0, startIdx) + section + out.slice(endIdx + MARK_END.length);
  } else {
    // First run: place it right after the curated categories table, before
    // "### Quick Tool Reference".
    const anchor = "### Quick Tool Reference";
    const at = out.indexOf(anchor);
    if (at === -1) throw new Error(`Anchor "${anchor}" not found in SKILL.md`);
    out = out.slice(0, at) + section + "\n" + out.slice(at);
  }

  // 3b. Curated-categories note (added once, then kept in sync).
  const catHeading = "### Key MCP Tool Categories";
  if (out.includes(catHeading) && !out.includes("_Curated highlights")) {
    out = out.replace(
      catHeading,
      `${catHeading}\n\n_Curated highlights — the complete auto-synced catalog (all ${count} tools) is in the section below._`
    );
  }

  // 3c. Standing counts (idempotent regexes, global — the same wording can
  // appear in several sections of SKILL.md).
  out = out.replace(/through \d+\+? MCP tools/gi, `through ${count} MCP tools`);
  out = out.replace(/Tengo acceso a \d+ herramientas/gi, `Tengo acceso a ${count} herramientas`);
  out = out.replace(/invoke \*\*\d+ tools\*\*/gi, `invoke **${count} tools**`);
  out = out.replace(/\(\d+ tools\)/g, `(${count} tools)`);
  out = out.replace(/, \d+ tools\)/g, `, ${count} tools)`);
  out = out.replace(
    /(_Curated highlights[^\n]*?all )\d+( tools[^\n]*?_\n?)/,
    `$1${count}$2`
  );
  // Variant phrasings that have drifted before (discovery steps, example
  // responses, the architecture table) — same rule: count follows the array.
  out = out.replace(/discover \d+ tools/gi, `discover ${count} tools`);
  out = out.replace(/\{\.\.\.\d+ tools\.\.\.\}/g, `{...${count} tools...}`);
  out = out.replace(/JSON-RPC, \d+ tools\)/g, `JSON-RPC, ${count} tools)`);

  return out;
}

// ── 4. Optional live cross-check against production ─────────────────────────
async function checkLive(count) {
  try {
    const res = await fetch("https://design.futuraria.com/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const json = await res.json();
    const live = json?.result?.tools?.length;
    if (live === count) {
      console.log(`[live] production tools/list agrees: ${live} tools`);
    } else {
      console.warn(`[live] WARNING: production reports ${live ?? "?"} tools — local mcp.mjs has ${count} (expected until next deploy)`);
    }
  } catch (e) {
    console.warn(`[live] WARNING: could not reach production tools/list: ${e.message}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
const mcpSource = readFileSync(MCP_SRC, "utf8");

// Tool descriptions may interpolate ${NODE_SCHEMA_DOC} (REQ-027 flows). Load
// the real text so extraction and the JSON eval stay faithful instead of
// silently degrading (flows-core is dependency-free and imports anywhere).
let nodeSchemaDoc = "";
try {
  const flowsCore = await import(pathToFileURL(resolve(root, "worker", "runtime", "functions", "flows-core.mjs")).href);
  nodeSchemaDoc = String(flowsCore.NODE_SCHEMA_DOC ?? "");
} catch (e) {
  console.warn(`[warn] could not load flows-core NODE_SCHEMA_DOC: ${e.message}`);
}
if (nodeSchemaDoc) console.log(`NODE_SCHEMA_DOC resolved (${nodeSchemaDoc.length} chars)`);

const { tools, raws } = parseMcpTools(mcpSource, nodeSchemaDoc);
console.log(`Parsed ${tools.length} tools from worker/runtime/functions/mcp.mjs`);

const skill = readFileSync(SKILL_SRC, "utf8");
const section = buildCatalogSection(tools);
const patched = patchSkill(skill, tools, section);
writeFileSync(SKILL_SRC, patched, "utf8");
console.log("SKILL.md updated (catalog section + standing counts)");

// tools_catalog.json — browsable JSON snapshot of the full catalog. Tool
// literals in MCP_TOOLS are plain object literals, so Function() can evaluate
// them; if one ever isn't (spread, computed key...), degrade gracefully to
// name+description instead of failing the sync.
const CATALOG_SRC = resolve(root, "tools_catalog.json");
const catalog = tools.map((t, i) => {
  try {
    // Bind NODE_SCHEMA_DOC so interpolated descriptions evaluate; plain
    // literals ignore the extra binding.
    return new Function("NODE_SCHEMA_DOC", "return (" + raws[i] + ")")(nodeSchemaDoc);
  } catch {
    return { name: t.name, description: t.description };
  }
});
writeFileSync(CATALOG_SRC, JSON.stringify(catalog, null, 2) + "\n", "utf8");
console.log(`tools_catalog.json regenerated (${catalog.length} tools)`);

if (process.argv.includes("--check-live")) await checkLive(tools.length);
