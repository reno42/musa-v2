import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createFallbackImportDocument,
  importSvgDocument,
  parseFigmaDesignUrl,
  renderImportArtboard,
  sanitizeImportedSvg,
} from "../shared/designImport.ts";

test("canonical SVG preserves visual structure and reports actual fidelity", () => {
  const source = `<svg width="320" height="180"><g transform="translate(2 3)"><rect width="10" height="10"/><text>x &amp; y</text></g></svg>`;
  const document = importSvgDocument(source, "safe.svg");
  assert.deepEqual(document.report, { editable: 0, approximate: 1, raster: 0 });
  assert.equal(document.artboards[0].width, 320);
  assert.equal(document.artboards[0].height, 180);
  assert.match(renderImportArtboard(document.artboards[0]).html, /data-import-fidelity="approximate"/);
});


test("SVG sanitizer rejects protocol-relative links, CSS fetches, animation and XML entities", () => {
  const hostile = [
    `<svg><image href=//evil.test/a.png /></svg>`,
    `<svg><image href="//evil.test/a.png" /></svg>`,
    `<svg><style>@import url(//evil.test/a.css);</style><rect/></svg>`,
    `<svg><rect style="fill:url(//evil.test/a.svg)"/></svg>`,
    `<svg><animate attributeName="x" values="0;1"/></svg>`,
    `<svg><set attributeName="href" to="//evil.test"/></svg>`,
    `<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg><text>&xxe;</text></svg>`,
    `<svg onload="alert(1)"></svg>`,
    `<svg><foreignObject><img src="x" onerror="alert(1)"></foreignObject></svg>`,
    `<svg><rect style="fill:u\\72l(//evil.test/a)"/></svg>`,
    `<svg><rect style="fill:&#117;rl(//evil.test/a)"/></svg>`,
    `<svg><script>alert(1)</script></svg>`,
    `<svg></svg><img src="x" onerror="alert(1)">`,
    `<svg><use href="&#106;avascript:alert(1)"/></svg>`,
    `<svg><g></svg>`,
  ];
  for (const svg of hostile) assert.throws(() => sanitizeImportedSvg(svg), /no permitid|extern|URL|animaci|XML/i);
  assert.doesNotThrow(() => sanitizeImportedSvg(`<svg><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/></svg>`));
});

test("proprietary fallback is non-empty and labels raster fidelity honestly", () => {
  const document = createFallbackImportDocument({ name: "archivo.fig", source: "fig", message: "Conecta Figma para recuperar capas." });
  assert.equal(document.report.raster, 1);
  assert.match(document.artboards[0].layers[0].html, /archivo\.fig/);
  assert.match(document.warnings[0].message, /Conecta Figma/);
});

test("Figma URL parser accepts design/file links and normalizes node-id", () => {
  assert.deepEqual(parseFigmaDesignUrl("https://www.figma.com/design/abc123/Test?node-id=12-34"), { fileKey: "abc123", nodeId: "12:34" });
  assert.throws(() => parseFigmaDesignUrl("https://example.com/design/abc"));
  assert.throws(() => parseFigmaDesignUrl("http://figma.com/design/abc"));
  assert.throws(() => parseFigmaDesignUrl("https://token@figma.com/design/abc"));
});

test("Illustrator class styles are preserved and scoped to their SVG", () => {
  const svg = sanitizeImportedSvg('<svg width="30" height="20"><style>.cls-1 {\nfill:red;\nstroke:#000; }</style><rect class="cls-1" width="30" height="20"/></svg>');
  const scope = svg.match(/data-import-svg-scope="(s\w+)"/)[1];
  assert.ok(svg.includes(`[data-import-svg-scope="${scope}"] .cls-1`));
  assert.match(svg, /fill:red/);
  assert.throws(() => sanitizeImportedSvg('<svg><style>.cls-1 { background-image:image-set("https://evil.test/a"); }</style></svg>'));
});

test("v46 and API enforce workspace-scoped jobs, private storage and durable asset URLs", async () => {
  const [migration, routes, service, modal, editor, dashboard, mcp, designImportLib, pdfModule] = await Promise.all([
    readFile(new URL("../supabase_migrations_v46.sql", import.meta.url), "utf8"),
    readFile(new URL("../api/src/routes/designImports.ts", import.meta.url), "utf8"),
    readFile(new URL("../api/src/services/designImports.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/DesignImportModal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/EditorV2.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../netlify/functions/mcp.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/designImport.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/pdfImport.ts", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /workspace_id TEXT NOT NULL REFERENCES workspaces\(id\)/);
  assert.match(migration, /has_workspace_role\(job\.workspace_id, 'editor'\)/);
  assert.match(migration, /job\.id::text = \(storage\.foldername\(name\)\)\[2\]/);
  assert.match(migration, /UNIQUE \(workspace_id, idempotency_key\)/);
  assert.match(routes, /\.eq\("id", req\.params\.id\)\.eq\("workspace_id", workspaceId\)/);
  assert.match(routes, /data:image\\\//);
  assert.match(service, /"X-Figma-Token": token/);
  assert.doesNotMatch(service, /return \{[^}]*token/s);
  assert.match(service, /fetchRemoteImage\(/);
  assert.match(modal, /persistEmbeddedImages/);
  assert.match(modal, /onImport: \(results: ImportResult\[\]\)/);
  assert.match(editor, /futuraria-import-source:/);
  assert.match(editor, /updated\.push\(frame\)/);
  assert.match(editor, /setRoutedImportFiles\(designFiles\)/);
  assert.match(editor, /initialFiles=\{routedImportFiles\.length \? routedImportFiles : null\}/);
  assert.match(dashboard, /const API_BASE = "\/api"/);
  assert.match(dashboard, /apiFetch[^\n]*`\/design-imports\/integrations\/figma/);
  for (const tool of ["import_design_source", "import_figma_design", "import_figma_file", "get_design_import_status", "retry_design_import", "commit_design_import"]) assert.match(mcp, new RegExp(`name: "${tool}"`));
  assert.match(routes, /designImportRoutes\.post\("\/fig-file"/);
  assert.match(routes, /\["svg", "psd", "ai", "pdf", "image", "fig"\]/);
  assert.match(mcp, /sourceType: \{ type: "string", enum: \["svg", "psd", "pdf", "ai", "image", "fig"\]/);
  // AI/PDF pipeline: dispatcher routes ai/pdf to the pdf.js converter, the
  // modal reuses the font-replacement flow and the editor keeps canvas drop.
  assert.match(designImportLib, /importPdfDocumentResults/);
  assert.match(designImportLib, /%!PS-Adobe/);
  assert.match(pdfModule, /parsePdfDocumentResults/);
  assert.match(pdfModule, /getOptionalContentConfig/);
  assert.match(pdfModule, /beginMarkedContentProps/);
  assert.match(modal, /parsePdfDocumentResults/);
  assert.match(modal, /completeDocumentFonts/);
  assert.match(editor, /handleAppDrop/);
});
