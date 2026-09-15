import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboard = readFileSync(new URL("../src/components/Dashboard.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

describe("Diseño · Archivos", () => {
  it("keeps the header in normal page scroll instead of a fixed inner viewport", () => {
    assert.match(dashboard, /overflowY: designSubTab === "files" \? "auto" : "hidden"/);
    // v56: el modo flow (CoverFlow) es el único con scroll propio; la grilla
    // sigue en el scroll normal de la página.
    assert.match(dashboard, /data-tour="templates-grid"[\s\S]*?overflowY: cardMode === "flow" \? "hidden" : "visible"/);
  });

  it("removes the HTML badge and retired brand filters", () => {
    assert.doesNotMatch(dashboard, /t\.engine === "html"/);
    assert.doesNotMatch(dashboard, /Todas las marcas/);
    assert.doesNotMatch(dashboard, /Brand Manuals/);
  });

  it("starts the refreshed layout at three columns and spaces cards apart", () => {
    assert.match(dashboard, /futuraria-card-columns-version/);
    assert.match(dashboard, /localStorage\.setItem\("futuraria-card-columns", "3"\)/);
    assert.match(dashboard, /gridTemplateColumns: `repeat\(\$\{cardColumns\}, minmax\(0, 1fr\)\)`[\s\S]*?gap: 24/);
  });

  it("places an accessible monochrome column range before the view switch", () => {
    const range = dashboard.indexOf('className="df-column-range"');
    const viewSwitch = dashboard.indexOf('className="df-view-switch"');
    assert.ok(range >= 0 && viewSwitch > range, "column control must precede the view switch");
    assert.match(dashboard, /aria-label="Columnas por fila"/);
    assert.match(dashboard, /aria-valuetext=`?\{?`\$\{cardColumns\} columnas por fila`/);
    assert.match(dashboard, /aria-pressed=\{cardMode === "grid"\}/);
    assert.match(styles, /\.df-column-range[^}]*accent-color: #fff/);
    assert.match(styles, /\.df-column-range:focus-visible/);
    assert.match(styles, /\.df-view-switch \.df-chip \{ min-height: 40px; \}/);
  });
});

describe("Dashboard API route composition", () => {
  it("lets the local apiFetch helper add the only /api prefix", () => {
    assert.doesNotMatch(dashboard, /apiFetch(?:<[^;]+?>)?\s*\(\s*[`"]\/api\//);
  });

  it("does not fetch brands after removing every brand filter consumer", () => {
    assert.doesNotMatch(dashboard, /apiFetch[^\n]*\/brands/);
    assert.doesNotMatch(dashboard, /\/saas\/workspaces\/\$\{activeWorkspaceId\}\/brands/);
  });
});
