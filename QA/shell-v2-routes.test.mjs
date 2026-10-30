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
const appRoute = await import("file://" + resolve(__dirname, "..", "src", "lib", "appRoute.ts"));
const { readAppRoute } = appRoute;

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

describe("appRoute reconoce los hashes del shell v2", () => {
  const loc = (hash) => ({ pathname: "/", search: "", hash });

  it("#inicio/resumen es una ruta shell-v2 con módulo y sub", () => {
    assert.deepEqual(readAppRoute(loc("#inicio/resumen")), { kind: "shell-v2", mod: "inicio", sub: "resumen" });
  });

  it("#crear sin sub es shell-v2 y el shell resuelve su primer sub", () => {
    assert.deepEqual(readAppRoute(loc("#crear")), { kind: "shell-v2", mod: "crear" });
  });

  it("un sub desconocido NO invalida la ruta (el shell muestra su placeholder)", () => {
    const route = readAppRoute(loc("#crear/no-existe"));
    assert.equal(route.kind, "shell-v2");
  });

  it("los hashes v1 siguen parseando igual tras el cambio", () => {
    assert.equal(readAppRoute(loc("#workspace")).kind, "workspace");
    assert.equal(readAppRoute(loc("#workspace/flows/board/f1")).kind, "workspace");
    assert.equal(readAppRoute(loc("#agents")).kind, "agents");
    assert.equal(readAppRoute(loc("#video/proj_1")).kind, "video");
    assert.equal(readAppRoute(loc("#hash-desconocido")).kind, "root");
  });

  it("todas las 41 rutas del inventario parsean como shell-v2", () => {
    for (const r of ROUTES) {
      const route = readAppRoute(loc(`#${r.id}`));
      assert.equal(route.kind, "shell-v2", `ruta no reconocida: ${r.id}`);
      assert.equal(route.mod, r.mod);
      assert.equal(route.sub, r.sub);
    }
  });
});
