/**
 * QA shell-v2 (REQ-069 F0 / REQ-070): el inventario de navegación del shell v2
 * debe estar COMPLETO — 10 módulos, 41 rutas únicas navegables, 7 roles con
 * homes válidos — y sus hashes no pueden colisionar con las rutas v1.
 *
 * Run: node --experimental-strip-types --test --test-reporter tap QA/shell-v2-routes.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const nav = await import("file://" + resolve(__dirname, "..", "src", "shell-v2", "navConfig.ts"));
const { MODULES, ROLES, ROUTES, ROUTE_BY_ID, defaultNavPrefs, V2_HASH_SOURCE } = nav;

describe("shell-v2 route inventory (41 vistas)", () => {
  it("registra exactamente 10 módulos", () => {
    assert.equal(MODULES.length, 10);
    assert.deepEqual(
      MODULES.map(m => m.id),
      ["inicio", "organizacion", "planear", "crear", "conversar", "anunciar", "vender", "agentes", "medir", "configuracion"],
    );
  });

  it("registra exactamente 41 rutas únicas (mod/sub)", () => {
    assert.equal(ROUTES.length, 41);
    const ids = new Set(ROUTES.map(r => r.id));
    assert.equal(ids.size, 41, "route ids duplicados");
  });

  it("cada ruta tiene módulo y sub no vacíos", () => {
    for (const r of ROUTES) {
      assert.ok(r.mod.length > 0 && r.sub.length > 0 && r.label.length > 0, `ruta inválida: ${r.id}`);
      assert.ok(ROUTE_BY_ID.has(r.id), `falta en ROUTE_BY_ID: ${r.id}`);
    }
  });

  it("define los 7 roles del prototipo con homes válidos", () => {
    assert.equal(ROLES.length, 7);
    const roleIds = ROLES.map(r => r.id);
    assert.deepEqual(
      roleIds.sort(),
      ["automatizador", "community", "copy", "disenador", "global", "motion", "video"],
    );
    for (const role of ROLES) {
      assert.ok(ROUTE_BY_ID.has(role.home), `home inválido para ${role.id}: ${role.home}`);
      for (const modId of role.pin) {
        assert.ok(MODULES.some(m => m.id === modId), `pin inválido para ${role.id}: ${modId}`);
      }
    }
  });

  it("los pins por defecto no dejan módulos fuera de pin+rest", () => {
    const all = MODULES.map(m => m.id).sort();
    for (const role of ROLES) {
      const prefs = defaultNavPrefs(role.id);
      const covered = [...prefs.pin, ...prefs.rest, ...prefs.hid].sort();
      assert.deepEqual(covered, all, `rol ${role.id} pierde módulos`);
      assert.equal(new Set(covered).size, all.length, `rol ${role.id} duplica módulos`);
    }
  });

  it("ningún hash v2 colisiona con rutas v1 (#workspace, #agents, #connect, #video)", () => {
    const v1Hashes = ["workspace", "agents", "connect", "video"];
    const re = new RegExp(V2_HASH_SOURCE);
    for (const h of v1Hashes) {
      assert.equal(re.test(h), false, `el hash v1 "${h}" sería capturado por v2`);
    }
    // Y una ruta v2 sí matchea, con y sin sub.
    assert.equal(re.test("inicio"), true);
    assert.equal(re.test("crear/disenos"), true);
  });
});
