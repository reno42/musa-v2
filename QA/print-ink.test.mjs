/**
 * inkAudit + spotColors — auditoría de tinta (TAC/cobertura por placa sobre
 * las separaciones C/M/Y/K) y tintas planas del frame (--spot-ink en el CSS).
 * Paridad inspectora con el Ink Manager / Spot Colors de Illustrator.
 *
 * Run: node --experimental-strip-types --test --test-reporter tap QA/print-ink.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const auditPath = "file://" + resolve(__dirname, "..", "src", "lib", "inkAudit.ts");
const spotsPath = "file://" + resolve(__dirname, "..", "src", "lib", "spotColors.ts");

const { auditInk, tacLimitFor, TAC_LIMITS } = await import(auditPath);
const { SPOT_INKS, SPOT_NONE, findSpotInk, scanSpotInks } = await import(spotsPath);

const approx = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `se esperaba ~${expected}, llegó ${actual}`);

/** SeparationsResult de prueba: planos como ArrayBuffer (el contrato real). */
function makeRes(width, height, c, m, y, k) {
  const n = width * height;
  const pad = arr => Uint8Array.from(arr.length === n ? arr : Array(n).fill(arr[0])).buffer;
  return { width, height, plates: { c: pad(c), m: pad(m), y: pad(y), k: pad(k) } };
}

describe("tacLimitFor — el límite es propiedad del perfil ICC", () => {
  it("FOGRA39/ISOcoated_v2_300 limita en 300%, GRACoL2013 (CRPC7) en 320%", () => {
    assert.equal(tacLimitFor("fogra39"), 300);
    assert.equal(tacLimitFor("iso_uncoated"), 300);
    assert.equal(tacLimitFor("gracol2013"), 320);
    assert.equal(TAC_LIMITS.fogra39, 300);
  });
  it("perfil desconocido → 300 conservador (incluye srgb, que no audita)", () => {
    assert.equal(tacLimitFor("srgb"), 300);
    assert.equal(tacLimitFor("no-existe"), 300);
  });
});

describe("auditInk — estadística por placa y TAC sobre los planos", () => {
  it("planos vacíos → todo cero y nada fuera de límite", () => {
    const a = auditInk(makeRes(2, 1, [0, 0], [0, 0], [0, 0], [0, 0]), 300);
    assert.equal(a.maxTacPct, 0);
    assert.equal(a.avgTacPct, 0);
    assert.equal(a.overLimitPct, 0);
    assert.equal(a.plates.k.maxPct, 0);
  });

  it("negro K puro: placa K al 100%, TAC máximo 100%", () => {
    const a = auditInk(makeRes(2, 1, [0, 0], [0, 0], [0, 0], [255, 128]), 300);
    approx(a.plates.k.maxPct, 100);
    approx(a.plates.k.avgPct, ((255 + 128) / 2) * 100 / 255);
    approx(a.maxTacPct, 100);
    assert.equal(a.overLimitPct, 0);
  });

  it("registro de 4 tintas al tope → TAC 400%, 100% de píxeles fuera de límite", () => {
    const a = auditInk(makeRes(1, 1, [255], [255], [255], [255]), 300);
    approx(a.maxTacPct, 400);
    assert.equal(a.overLimitPct, 100);
  });

  it("el límite es estricto: TAC exactamente 300% NO se marca", () => {
    // 100+100+100+0 = 300% → dentro.
    const a = auditInk(makeRes(1, 1, [255], [255], [255], [0]), 300);
    approx(a.maxTacPct, 300);
    assert.equal(a.overLimitPct, 0);
  });

  it("un píxel cargado de dos → overLimitPct 50%", () => {
    const a = auditInk(makeRes(2, 1, [255, 0], [255, 0], [255, 0], [255, 0]), 300);
    assert.equal(a.overLimitPct, 50);
  });

  it("los porcentajes por placa escalan v*100/255 y promedian sobre el área", () => {
    const a = auditInk(makeRes(1, 2, [255, 0], [0, 0], [0, 0], [0, 0]), 300);
    approx(a.plates.c.maxPct, 100);
    approx(a.plates.c.avgPct, 50);
    approx(a.plates.m.avgPct, 0);
  });
});

describe("spotColors — catálogo de tintas planas", () => {
  it("ids y nombres únicos, hex válido, CMYK en rango", () => {
    const ids = new Set(SPOT_INKS.map(i => i.id));
    const names = new Set(SPOT_INKS.map(i => i.name));
    assert.equal(ids.size, SPOT_INKS.length);
    assert.equal(names.size, SPOT_INKS.length);
    for (const ink of SPOT_INKS) {
      assert.match(ink.hex, /^#[0-9a-fA-F]{6}$/);
      assert.equal(ink.cmyk.length, 4);
      for (const v of ink.cmyk) assert.ok(v >= 0 && v <= 100);
    }
  });

  it("findSpotInk: por id, por nombre; centinela y desconocidos → null", () => {
    assert.equal(findSpotInk("pantone-185-c").name, "PANTONE 185 C");
    assert.equal(findSpotInk("PANTONE 185 C").id, "pantone-185-c");
    assert.equal(findSpotInk(SPOT_NONE), null);
    assert.equal(findSpotInk(""), null);
    assert.equal(findSpotInk("PANTONE Inventada X"), null);
  });
});

describe("scanSpotInks — el nombre viaja en el CSS del frame", () => {
  it("lee --spot-ink de una regla CSS con nombre con espacios", () => {
    const css = '[data-l="a"] { color: red; --spot-ink: PANTONE 185 C; }';
    const out = scanSpotInks(css, "");
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "PANTONE 185 C");
    assert.equal(out[0].hex, "#E10600");
    assert.deepEqual(out[0].cmyk, [0, 100, 85, 0]);
  });

  it("lee --spot-ink de un style inline en el html", () => {
    const html = '<div style="--spot-ink: PANTONE 288 C; color: #002D72"></div>';
    const out = scanSpotInks("", html);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "PANTONE 288 C");
  });

  it("deduplica entre css y html e ignora el centinela 0", () => {
    const css = '[data-l="a"] { --spot-ink: PANTONE 185 C; } [data-l="b"] { --spot-ink: 0; }';
    const html = '<i style="--spot-ink: PANTONE 185 C"></i><i style="--spot-ink: 0"></i>';
    const out = scanSpotInks(css, html);
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "PANTONE 185 C");
  });

  it("una tinta desconocida pasa con nombre y sin build (tinta custom)", () => {
    const out = scanSpotInks('[data-l="a"] { --spot-ink: TINTA DEL CLIENTE 7; }', "");
    assert.equal(out.length, 1);
    assert.equal(out[0].name, "TINTA DEL CLIENTE 7");
    assert.equal(out[0].hex, "");
  });

  it("frame sin tintas → []", () => {
    assert.deepEqual(scanSpotInks("body { color: red }", "<p>hola</p>"), []);
    assert.deepEqual(scanSpotInks("", ""), []);
  });
});
