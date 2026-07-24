import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const modulePath = "file://" + resolve(__dirname, "..", "src", "lib", "appRoute.ts");
const { readAppRoute, routeRequiresAccount } = await import(modulePath);

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
