import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboard = readFileSync(new URL("../src/components/Dashboard.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../src/lib/appRoute.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../src/components/BrandSystemsView.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase_migrations_v47.sql", import.meta.url), "utf8");

describe("Diseño · Design Systems (tab)", () => {
  it("adds the ds pane between Archivos and Second Brain, in the URL", () => {
    assert.match(route, /export const DESIGN_PANES = \["files", "ds", "graph", "table", "trash"\] as const;/);
    assert.match(dashboard, /\{ id: "ds", label: "Design Systems" \}/);
    // v59: la pestaña del grafo se renombró «Grafo» → «Second Brain» (id intacto).
    const filesIdx = dashboard.indexOf('id: "files", label: "Archivos"');
    const dsIdx = dashboard.indexOf('id: "ds", label: "Design Systems"');
    const graphIdx = dashboard.indexOf('id: "graph", label: "Second Brain"');
    assert.ok(filesIdx > -1 && dsIdx > filesIdx && graphIdx > dsIdx, "ds must sit between files and graph");
  });

  it("renders BrandSystemsView for the ds pane", () => {
    assert.match(dashboard, /designSubTab === "ds" \? [\s\S]*?<BrandSystemsView workspaceId=\{activeWorkspaceId\}/);
  });

  it("keeps brand container files out of the Archivos grid", () => {
    assert.match(dashboard, /const designFiles = useMemo\(\(\) => templates\.filter\(t => !t\.isBrandManual\), \[templates\]\)/);
    assert.match(dashboard, /: shownFiles\s*\)\.map\(t => renderTemplateCard\(t\)\)/);
    assert.match(dashboard, /items=\{shownFiles\.map\(t => \(\{/);
  });

  it("searches Archivos by name from the box toolbar (left), controls right", () => {
    assert.match(dashboard, /const \[tplSearch, setTplSearch\] = useState\(""\)/);
    assert.match(dashboard, /placeholder="Buscar archivos por nombre…"/);
    assert.match(dashboard, /return designFiles\.filter\(t => t\.name\.toLowerCase\(\)\.includes\(q\)\)/);
    // A search miss shows its own state with a clear action, never the
    // "no templates yet" empty state.
    assert.match(dashboard, /Sin resultados para «\{tplSearch\.trim\(\)\}»/);
    assert.match(dashboard, /Limpiar búsqueda/);
    // The add button shares the switch's 40px line instead of align-self:end.
    assert.match(dashboard, /style=\{\{ alignSelf: "center", minHeight: 40 \}\}>/);
  });
});

describe("BrandSystemsView · regla de marca primero", () => {
  it("the popup asks for the brand name — never for dimensions", () => {
    // v59: «+ Nueva Marca» es el ÚNICO alta y pide nombre + relación; abrir un
    // DS existente vive en el slot de la marca, no en el popup.
    assert.match(view, /\+ Nueva Marca/);
    assert.match(view, /Nombre de la marca/);
    assert.doesNotMatch(view, /SOCIAL_FORMATS|CUSTOM_FORMAT_ID|newTplW/);
  });

  it("creates via the CRM endpoints (brand + DS stay in sync)", () => {
    assert.match(view, /\/api\/workspaces\/\$\{workspaceId\}\/brands`,\s*\{ method: "POST", body: JSON\.stringify\(\{ name, relationshipStatus: relationship \}\) \}/);
    // v59: un solo POST nace marca + tres contenedores server-side; el cliente
    // recarga con GET /brands y aterriza en el DS auto-sanado.
    assert.match(view, /const reloadAndOpen = useCallback/);
    assert.match(view, /if \(target\?\.design_system_template_id\) onOpenTemplate\(target\.design_system_template_id\)/);
  });

  it("lists brand files through /api/templates (bare /templates hits the SPA fallback)", () => {
    assert.match(view, /\/api\/templates\?workspaceId=\$\{workspaceId\}&limit=200&offset=0/);
    assert.doesNotMatch(view, /`\/templates\?/);
  });

  it("opens the one DS file — containers self-heal server-side (una marca = un contenedor)", () => {
    // v59: ya no hay alta por marca existente ni duplicados — el servidor
    // auto-sana contenedores al leer; el slot siempre abre EL archivo.
    assert.match(view, /const openDsSlot = \(brand: BrandRow\) =>/);
    assert.match(view, /if \(brand\.design_system_template_id\) onOpenTemplate\(brand\.design_system_template_id\)/);
    assert.match(view, /El contenedor se genera automáticamente/);
  });

  it("exposes the three container slots", () => {
    assert.match(view, /const slotBottomLabel: React\.CSSProperties = \{/);
    // Filled captions ride the shared gradient strip.
    assert.match(view, /<span style=\{slotBottomLabel\}>\s*Design System\s*<\/span>/);
    assert.match(view, /Plantillas · \{brand\.plantillas_frame_count\}/);
    // Estrategia de Marca renders a merged style (label pinned to the slot bottom).
    assert.match(view, /Estrategia de Marca\{brand\.has_strategy \? " ✓" : ""\}\s*<\/span>/);
  });

  it("empty DS/Plantillas slots stay non-interactive while the server heals them", () => {
    // v59: no hay estado «Crear» — el slot vacío es no-interactive y muestra
    // la pista de auto-sanado; ningún botón pill dentro de los slots.
    assert.doesNotMatch(view, /className="workspace-button"\s*\n\s*disabled=\{busy\}/);
    assert.match(view, /aria-disabled=\{!brand\.design_system_template_id\}/);
    assert.match(view, /aria-disabled=\{!brand\.plantillas_template_id\}/);
    assert.equal((view.match(/<span style=\{slotHint\}>Generando…<\/span>/g) || []).length, 2, "DS and Plantillas both show the self-heal hint");
    // The caption strip stays unique to slotBottomLabel (all three slots equal).
    const strips = view.split("linear-gradient(transparent, rgba(0,0,0,0.75))").length - 1;
    assert.equal(strips, 1, "gradient strip must come from slotBottomLabel only");
  });

  it("opens the Brand Strategy Canvas from the Comunicación slot", () => {
    assert.match(view, /setCanvasBrand\(brand\)/);
    assert.match(view, /\/api\/workspaces\/\$\{workspaceId\}\/brands\/\$\{brand\.id\}\/strategy`/);
    assert.match(view, /method: "PUT", body: JSON\.stringify\(\{ strategy: draft \}\)/);
  });

  it("shows container completeness and real Plantillas state", () => {
    assert.match(view, /plantillas_frame_count/);
    assert.match(view, /brand\.completeness\.score \?\}|completeness\.score \}\/\{completeness\.total\}|\{brand\.completeness\.score\}\/\{brand\.completeness\.total\}/);
    assert.match(view, /if \(brand\.plantillas_template_id\) onOpenTemplate\(brand\.plantillas_template_id\)/);
  });
});

describe("Fase 0 · migración v47", () => {
  it("defines the brand container kind, strategy_json and brain_notes idempotently", () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS brand_container_kind TEXT/);
    assert.match(migration, /ADD COLUMN IF NOT EXISTS strategy_json JSONB/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.brain_notes/);
    assert.match(migration, /has_workspace_role\(workspace_id, 'viewer'\)/);
  });
});
