import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboard = readFileSync(new URL("../src/components/Dashboard.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const apiRoute = readFileSync(new URL("../api/src/routes/templates.ts", import.meta.url), "utf8");
const apiService = readFileSync(new URL("../api/src/services/templates.ts", import.meta.url), "utf8");
const designMeta = readFileSync(new URL("../api/src/routes/designMeta.ts", import.meta.url), "utf8");

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

describe("Filtro de facetas de Archivos (REQ-061 fix)", () => {
  it("filters facets SQL-side in the list service, never post-slice", () => {
    // El embed !inner convierte el listado en INNER JOIN contra
    // design_file_meta: sin fila meta = fuera (misma semántica que tenía el
    // filtro client-side sobre su página de 72).
    assert.match(apiService, /design_file_meta!inner\(brand_id\)/);
    assert.match(apiService, /\.in\("design_file_meta\.brand_id", facets\.brandIds\)/);
    assert.match(apiService, /\.in\("design_file_meta\.brand", facets\.brands\)/);
    assert.match(apiService, /\.in\("design_file_meta\.category", facets\.categories\)/);
    // overlap (OR dentro de la faceta); el método correcto de postgrest-js es
    // overlaps — `ov` solo existe como operador crudo del string de .or().
    assert.match(apiService, /\.overlaps\("design_file_meta\.tags", facets\.tags\)/);
    assert.doesNotMatch(apiService, /\.ov\(/);
  });

  it("route parses repeated facet params and forwards them in every branch", () => {
    assert.match(apiRoute, /qList\(req\.query\.brandId\)/);
    assert.match(apiRoute, /qList\(req\.query\.brand\)/);
    assert.match(apiRoute, /qList\(req\.query\.category\)/);
    assert.match(apiRoute, /qList\(req\.query\.tag\)/);
    // Las 3 ramas del listado (workspace / admin / multi-workspace).
    const forwarded = apiRoute.match(/hasFacets \? facets : undefined/g) || [];
    assert.strictEqual(forwarded.length, 3);
    // El filtro brandId POST-paginación murió con este fix: la ruta ya no
    // consulta design_file_meta (eso vive en el service) ni declara el
    // const muerto.
    assert.doesNotMatch(apiRoute, /\.from\("design_file_meta"\)/);
    assert.doesNotMatch(apiRoute, /const brandId = /);
  });

  it("dashboard sends facets to GET /templates and reloads on facet change", () => {
    // loadTemplates serializa facetas por ref (params repetidos).
    assert.match(dashboard, /for \(const b of fileFacetsRef\.current\.brands\) params\.append\("brand", b\)/);
    assert.match(dashboard, /for \(const c of fileFacetsRef\.current\.categories\) params\.append\("category", c\)/);
    assert.match(dashboard, /for \(const t of fileFacetsRef\.current\.tags\) params\.append\("tag", t\)/);
    // El efecto recarga la página 0 al cambiar la faceta; el cambio de
    // workspace solo actualiza refs (esa carga ya viaja por su lado).
    const effect = dashboard.slice(dashboard.indexOf("prevFacetsKeyRef"));
    assert.ok(effect.includes("loadTemplatesRef.current(activeWorkspaceId)"), "facet change must reload page 0");
    assert.match(effect, /if \(wsChanged \|\| !activeWorkspaceId\) return;/);
  });

  it("empty state clears facets, not only the search box", () => {
    // Con facetas activas el vacío viene del filtro server-side: un botón
    // que solo limpiara tplSearch sería un botón muerto.
    assert.match(dashboard, /setTplSearch\(""\); setFileFacets\(\{ brands: \[\], categories: \[\], tags: \[\] \}\);/);
  });
});

describe("Universo de facetas = universo del grid (REQ-061 fix 2)", () => {
  it("graph scope=archivos excludes trash and brand containers like the listing", () => {
    assert.match(designMeta, /req\.query\.scope === "archivos" \|\| req\.query\.scope === "archivos_contenedores"/);
    assert.match(designMeta, /\.is\("templates\.deleted_at", null\)/);
    // Misma definición de contenedor que el listado, con columnas apuntadas
    // al embed templates. — sin eso «Marca (7)» contaba trash/contenedores.
    assert.match(designMeta, /brandContainerExcludeClauses\("templates\."\)/);
  });

  it("container exclusion clauses are defined once and parameterized by embed prefix", () => {
    assert.match(apiService, /export function brandContainerExcludeClauses\(prefix = ""\)/);
    assert.match(apiService, /const EXCLUDE_BRAND_CONTAINER_CLAUSES = brandContainerExcludeClauses\(\);/);
  });

  it("dashboard sends the grid scope to /graph and only caches plain listings", () => {
    assert.match(dashboard, /params\.set\("scope", includeContainersRef\.current \? "archivos_contenedores" : "archivos"\)/);
    // Una página filtrada (búsqueda/facetas/contenedores) no es el universo
    // del workspace: cachearla pintaba parciales al remontar («a veces
    // funciona y otras no»).
    assert.match(dashboard, /const plainListing = !searchRef\.current && !brandId && !includeContainersRef\.current/);
    assert.match(dashboard, /if \(plainListing\) writeTemplateCache/);
    const coverCalls = dashboard.match(/void loadMetaCovers\(activeWorkspaceId \|\| undefined\)/g) || [];
    assert.ok(coverCalls.length >= 2, "containers toggle must refresh facet covers");
  });
});
