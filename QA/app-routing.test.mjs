import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const modulePath = "file://" + resolve(__dirname, "..", "src", "lib", "appRoute.ts");
const routeModule = await import(modulePath);
const { readAppRoute, routeRequiresAccount, workspaceTabUrl } = routeModule;

function location(pathname = "/", search = "", hash = "") {
  return { pathname, search, hash };
}

describe("startup routing", () => {
  it("opens a template URL as a protected editor target", () => {
    const route = readAppRoute(location("/", "?template=tpl_123&v=2"));
    assert.deepEqual(route, { kind: "template", templateId: "tpl_123" });
    assert.equal(routeRequiresAccount(route), true);
  });

  it("preserves clean workspace and template slugs", () => {
    assert.deepEqual(
      readAppRoute(location("/w/mi-agencia/key-visual")),
      { kind: "workspace-slug", workspaceSlug: "mi-agencia", templateSlug: "key-visual" },
    );
  });

  it("routes workspace links to the account gate", () => {
    const route = readAppRoute(location("/", "", "#workspace"));
    assert.deepEqual(route, { kind: "workspace" });
    assert.equal(routeRequiresAccount(route), true);
  });

  it("keeps the public root separate from protected app routes", () => {
    const route = readAppRoute(location());
    assert.deepEqual(route, { kind: "root" });
    assert.equal(routeRequiresAccount(route), false);
  });

  // Panes used to live in React state alone, so refreshing the table or the
  // CRM dropped back to the graph — and losing the tab with it dropped all
  // the way back to Archivos.
  it("carries the pane inside a workspace tab", () => {
    assert.deepEqual(
      readAppRoute(location("/", "", "#workspace/agentes/accounts")),
      { kind: "workspace", tab: "agentes", pane: "accounts" },
    );
  });

  it("keeps the tab when the pane is unknown, since the tab is the bigger loss", () => {
    assert.deepEqual(
      readAppRoute(location("/", "", "#workspace/agentes/inventado")),
      { kind: "workspace", tab: "agentes", pane: "inventado" },
    );
  });

  it("falls back to the default tab when the tab itself is unknown", () => {
    assert.deepEqual(
      readAppRoute(location("/", "", "#workspace/inventado/accounts")),
      { kind: "workspace" },
    );
  });

  it("round-trips a tab and pane through the URL builder", () => {
    assert.equal(workspaceTabUrl("agentes", "accounts"), "/#workspace/agentes/accounts");
    assert.deepEqual(
      readAppRoute(location("/", "", "#workspace/agentes/accounts")),
      { kind: "workspace", tab: "agentes", pane: "accounts" },
    );
  });

  it("leaves the default pane out of the URL, the way the default tab is", () => {
    // Contactos owns the pipeline/accounts panes — it is where the Red de
    // Marcas graph lives.
    assert.equal(workspaceTabUrl("contactos", "pipeline"), "/#workspace/contactos");
    assert.equal(workspaceTabUrl("diseno"), "/#workspace");
  });

  it("prioritizes invitation and recovery flows over template params", () => {
    assert.deepEqual(
      readAppRoute(location("/", "?template=tpl_123&invite=invite_456")),
      { kind: "invitation", token: "invite_456" },
    );
    assert.deepEqual(
      readAppRoute(location("/", "?template=tpl_123&reset=1")),
      { kind: "password-recovery" },
    );
  });
});

/**
 * Panes belong to a tab, and each tab has its own default.
 *
 * These exist because the tabs were restructured and the pane logic still
 * compared against the graph's default for every tab — so Diseño wrote its
 * default into the URL and swallowed the one pane it should have kept.
 */
describe("panes per tab", () => {
  const {
    DEFAULT_DESIGN_PANE, DEFAULT_AGENT_PANE, DEFAULT_COPY_PANE, DEFAULT_SETTINGS_PANE,
    isDesignPane, isAgentPane, isCopyPane, isSettingsPane,
  } = routeModule;

  it("each tab omits its OWN default pane, not another tab's", () => {
    assert.equal(workspaceTabUrl("diseno", DEFAULT_DESIGN_PANE), "/#workspace");
    assert.equal(workspaceTabUrl("agentes", DEFAULT_AGENT_PANE), "/#workspace/agentes");
    assert.equal(workspaceTabUrl("copywriting", DEFAULT_COPY_PANE), "/#workspace/copywriting");
    assert.equal(workspaceTabUrl("configuracion", DEFAULT_SETTINGS_PANE), "/#workspace/configuracion");
  });

  it("a non-default pane survives into the URL", () => {
    assert.equal(workspaceTabUrl("diseno", "trash"), "/#workspace/trash");
    assert.equal(workspaceTabUrl("agentes", "agents"), "/#workspace/agentes/agents");
    assert.equal(workspaceTabUrl("copywriting", "inbox"), "/#workspace/copywriting/inbox");
    assert.equal(workspaceTabUrl("configuracion", "ais"), "/#workspace/configuracion/ais");
  });

  it("one tab's default is not mistaken for another's", () => {
    // "kanban" is meaningless under Diseño and must not be swallowed there.
    assert.equal(workspaceTabUrl("diseno", "kanban"), "/#workspace/kanban");
  });

  it("every pane a tab renders is one the tab recognises", () => {
    for (const pane of ["files", "graph", "table", "trash"]) {
      assert.equal(isDesignPane(pane), true, `Diseño must accept ${pane}`);
    }
    for (const pane of ["kanban", "table", "agents"]) {
      assert.equal(isAgentPane(pane), true, `Agentes must accept ${pane}`);
    }
    for (const pane of ["calendar", "sheet", "reports", "copies", "recipes", "inbox"]) {
      assert.equal(isCopyPane(pane), true, `Copywriting must accept ${pane}`);
    }
    for (const pane of ["account", "integrations", "humans", "ais"]) {
      assert.equal(isSettingsPane(pane), true, `Configuración must accept ${pane}`);
    }
  });

  it("a pane from the wrong tab is rejected rather than rendered blank", () => {
    assert.equal(isDesignPane("kanban"), false);
    assert.equal(isAgentPane("trash"), false);
    assert.equal(isCopyPane("pipeline"), false);
    assert.equal(isSettingsPane("files"), false);
  });
});
