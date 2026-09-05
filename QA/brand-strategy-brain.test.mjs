import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Static invariants for the Design Systems phases (v47):
//   containers (Fase 2) · plantillas curation (Fase 3) · strategy canvas
//   (Fase 4) · merge proposals (Fase 5) · asset orchestrator (Fase 6) ·
//   second brain (Fase 7) · IA defaults (Fase 8).

const container = readFileSync(new URL("../api/src/services/brandContainer.ts", import.meta.url), "utf8");
const brainNotes = readFileSync(new URL("../api/src/services/brainNotes.ts", import.meta.url), "utf8");
const brandsService = readFileSync(new URL("../api/src/services/brands.ts", import.meta.url), "utf8");
const saas = readFileSync(new URL("../api/src/routes/saas.ts", import.meta.url), "utf8");
const brandGraph = readFileSync(new URL("../api/src/services/brandGraph.ts", import.meta.url), "utf8");
const mcp = readFileSync(new URL("../netlify/functions/mcp.mjs", import.meta.url), "utf8");
const types = readFileSync(new URL("../api/src/types.ts", import.meta.url), "utf8");

const TOOL_NAMES = [
  "get_brand_strategy", "update_brand_strategy", "create_from_plantilla",
  "diff_brand_tokens", "resolve_brand_token_proposal", "create_design_system_from_asset",
  "read_note", "search_notes", "brain_digest", "resolve_brand",
];

describe("Fase 2 · contenedores por marca", () => {
  it("declares the three container kinds and keeps them out of Archivos", () => {
    assert.match(container, /export const CONTAINER_KINDS = \["ds", "plantillas", "communication"\] as const;/);
    assert.match(types, /brandContainerKind\?: string;/);
    assert.match(container, /isBrandManual: true,\s*brandId: brand\.id,\s*brandContainerKind: kind/);
  });

  it("persists the kind into the physical column (unique index support)", () => {
    assert.match(container, /\.update\(\{ brand_container_kind: kind \}\)\.eq\("id", templateId\)/);
  });

  it("ensureBrandContainerFiles is idempotent and seeds the DS skeleton", () => {
    assert.match(container, /export async function ensureBrandContainerFiles/);
    assert.match(container, /createdPlantillas: false,\s*createdCommunication: false/);
    assert.match(container, /frames\.length === 0\)\) updates\.frames = seedDsFrames/);
    assert.match(container, /seedDsFrames\(brand\.name, brand\.tokensJson\)/);
    assert.match(brandsService, /await ensureBrandContainerFiles\(saved, userId\)\.catch\(\(\) => null\)/);
  });

  it("canonical frames 01–08 + V-frames + plantillas seed exist", () => {
    assert.match(container, /mk\("01 — Portada"/);
    assert.match(container, /mk\("08 — Do & Don't"/);
    assert.match(container, /mk\("V-01 — Esencia"/);
    assert.match(container, /mk\("V-03 — Voz"/);
    assert.match(container, /name: "00 — Cómo usar plantillas"/);
  });

  it("completeness is deterministic (no frame reads for the list view)", () => {
    assert.match(container, /export function computeDsCompleteness/);
    assert.match(container, /export function computeStrategyCompleteness/);
    assert.match(container, /export function computePlantillasCompleteness/);
    assert.match(container, /export function combineCompleteness/);
  });
});

describe("Fase 4 · Brand Strategy Canvas (BRAND_STRATEGY_V1)", () => {
  it("validates tone axes (0–100 ints) and enums without silent coercion", () => {
    assert.match(container, /tone\.axes\.\$\{axis\} must be an integer 0–100/);
    assert.match(container, /tone\.person must be tu \| usted \| nosotros/);
    assert.match(container, /tone\.emojiPolicy must be never \| occasional \| free/);
  });

  it("merges by section: provided sections replace, others survive", () => {
    assert.match(container, /export function mergeStrategy/);
    assert.match(container, /essence: incoming\.essence \?\? prev\.essence/);
  });

  it("strategyJson travels through the brand service (data JSONB)", () => {
    assert.match(types, /strategyJson\?: string;/);
    assert.match(brandsService, /strategyJson: value\.strategyJson,/);
  });

  it("REST routes: GET reads, PUT validates + re-renders V-frames", () => {
    assert.match(saas, /workspaceSaasRoutes\.get\("\/:id\/brands\/:brandId\/strategy", requireWorkspaceRole\("viewer"\)/);
    assert.match(saas, /workspaceSaasRoutes\.put\("\/:id\/brands\/:brandId\/strategy", requireWorkspaceRole\("editor"\)/);
    assert.match(saas, /const validation = validateStrategy\(req\.body\?\.strategy\);/);
    assert.match(saas, /frames: generateStrategyFrames\(saved\.name, strategyJson\),/);
  });

  it("strategy digest feeds playbook and notes", () => {
    assert.match(container, /export function strategyDigest/);
    assert.match(brandGraph, /brandVoice: strategyDigest\(style\.strategyJson\)/);
  });
});

describe("Fase 3 · curaduría de plantillas", () => {
  it("add_frame_to_brand gains the collection param (ds | plantillas)", () => {
    assert.match(mcp, /const frameCollection = params\.collection === "plantillas" \? "plantillas" : "ds";/);
    assert.match(mcp, /clonedFrame\.name = \(clonedFrame\.name \|\| sourceFrame\.name\) \+ " — de " \+ sourceTpl\.name;/);
  });

  it("create_from_plantilla clones curated frames into a batch file", () => {
    assert.match(mcp, /case "create_from_plantilla": \{/);
    assert.match(mcp, /Math\.min\(20, Number\(params\.count\) \|\| 1\)/);
    assert.match(mcp, /batchamatorReady: true,/);
  });
});

describe("Fase 5 + 6 · merge proposals y orquestador asset→DS", () => {
  it("diff is deterministic and proposals suggest, never apply silently", () => {
    assert.match(container, /export function diffTokens/);
    assert.match(container, /export function buildTokenProposal/);
    assert.match(container, /export async function applyTokenDecisions/);
    assert.match(container, /decision\.action === "combine"/);
    assert.match(container, /alternativa/);
  });

  it("MCP diff/resolve pair asks the human before writing", () => {
    assert.match(mcp, /case "diff_brand_tokens": \{/);
    assert.match(mcp, /¿Los usamos, mantenemos los guardados o combinamos\?/);
    assert.match(mcp, /case "resolve_brand_token_proposal": \{/);
    assert.match(mcp, /silence is never consent/);
  });

  it("create_design_system_from_asset publishes only into EMPTY brands", () => {
    assert.match(mcp, /case "create_design_system_from_asset": \{/);
    assert.match(mcp, /if \(!assetBrand\.tokensJson \|\| !assetBrand\.tokensJson\.trim\(\)\) \{/);
    assert.match(mcp, /nunca sobrescribo sin preguntar/);
  });
});

describe("Fase 7 · second brain", () => {
  it("notes carry protected human/agent blocks across regeneration", () => {
    assert.match(brainNotes, /export function protectHumanBlocks/);
    assert.match(brainNotes, /<!--\\s\*human\\s\*-->/);
    assert.match(brainNotes, /\$\{nextBody\}\\n\\n\$\{protectedBlocks\}/);
    assert.match(brainNotes, /protectHumanBlocks\(existing\?\.body_md, input\.bodyMd\)/);
  });

  it("upsert is idempotent by (workspace_id, slug)", () => {
    assert.match(brainNotes, /onConflict: "workspace_id,slug"/);
  });

  it("emitters cover brand, DS publish, plantillas and strategy", () => {
    assert.match(brainNotes, /export async function emitBrandCreatedNote/);
    assert.match(brainNotes, /export async function emitDsPublishedNote/);
    assert.match(brainNotes, /export async function emitPlantillasNote/);
    assert.match(brainNotes, /export async function emitStrategyNote/);
    assert.match(mcp, /brainNotes\.emitDsPublishedNote\(brandRecord,/);
    assert.match(mcp, /brainNotes\.emitPlantillasNote\(targetBrand,/);
    assert.match(mcp, /brainNotes\.emitStrategyNote\(savedStrategyBrand,/);
  });

  it("IA access tools: read_note, search_notes, brain_digest", () => {
    assert.match(mcp, /case "read_note": \{/);
    assert.match(mcp, /case "search_notes": \{/);
    assert.match(mcp, /case "brain_digest": \{/);
    assert.match(brainNotes, /export async function searchBrainNotes/);
    assert.match(brainNotes, /export async function listBrainNotes/);
  });
});

describe("Fase 8 · defaults para IAs", () => {
  it("all new tools are registered in TOOLS with schemas", () => {
    for (const name of TOOL_NAMES) {
      assert.match(mcp, new RegExp(`name: "${name}",`), `missing TOOLS entry: ${name}`);
    }
  });

  it("style tools resolve the tenant before dispatch", () => {
    assert.match(mcp, /"get_brand_strategy", "update_brand_strategy", "create_from_plantilla",/);
    assert.match(mcp, /"diff_brand_tokens", "resolve_brand_token_proposal", "create_design_system_from_asset",/);
  });

  it("get_template carries brandContext (palette, fonts, voice, containers)", () => {
    assert.match(mcp, /let brandContext;/);
    assert.match(mcp, /voice: strategyDigest\(ctxBrand\.strategyJson\),/);
    assert.match(mcp, /\.\.\.\(brandContext \? \{ brandContext \} : \{\}\),/);
  });

  it("resolve_brand returns the full on-brand context", () => {
    assert.match(mcp, /case "resolve_brand": \{/);
    assert.match(mcp, /strategyDigest: strategyDigest\(match\.strategyJson\),/);
    assert.match(mcp, /ds: computeDsCompleteness\(match\),/);
  });

  it("playbook exposes containers, digest and completeness", () => {
    assert.match(brandGraph, /containers: \{\s*ds: containerByKind\.get\("ds"\)/);
    assert.match(brandGraph, /plantillasFrameCount/);
    assert.match(brandGraph, /completeness: style \? \{/);
  });
});
