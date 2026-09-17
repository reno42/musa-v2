/**
 * printUnits — conversión de unidades físicas del export de imprenta.
 * El puente px ↔ físico es el dpi fijo de producto (PRINT_DPI): sin eso,
 * "1080px" no dice nada sobre papel. Junto con la geometría con escala
 * (printExport), resuelve el feedback de producto: ver las medidas en
 * mm/cm/in/px y escalar el trabajo a un tamaño físico concreto.
 *
 * Run: node --experimental-strip-types --test --test-reporter tap QA/print-units.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const unitsPath = "file://" + resolve(__dirname, "..", "src", "lib", "printUnits.ts");
const exportPath = "file://" + resolve(__dirname, "..", "src", "lib", "printExport.ts");

const { convertUnit, formatInUnit, parseTargetValue, scaleForPageWidth, PRINT_UNITS } = await import(unitsPath);
const { clampScale, MIN_SCALE, MAX_SCALE, PRINT_DPI, MM_PER_INCH } = await import(exportPath);

const approx = (actual, expected, eps = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < eps, `se esperaba ~${expected}, llegó ${actual}`);

describe("convertUnit — el puente px ↔ físico es el dpi de producto", () => {
  it("1080px ≡ 91.44mm a 300dpi (la base de 'medidas del archivo')", () => {
    approx(convertUnit(1080, "px", "mm"), (1080 / PRINT_DPI) * MM_PER_INCH);
    approx(convertUnit(91.44, "mm", "px"), 1080, 1e-4);
  });

  it("mm ↔ cm ↔ in son absolutos (no dependen del dpi)", () => {
    approx(convertUnit(10, "cm", "mm"), 100);
    approx(convertUnit(1, "in", "cm"), 2.54);
    approx(convertUnit(254, "mm", "in"), 10);
  });

  it("misma unidad = identidad incluso con NaN", () => {
    assert.ok(Number.isNaN(convertUnit(NaN, "mm", "mm")));
    approx(convertUnit(7, "cm", "cm"), 7);
  });

  it("ida y vuelta px → cm → px no acumula error", () => {
    const v = convertUnit(convertUnit(1080, "px", "cm"), "cm", "px");
    approx(v, 1080, 1e-6);
  });

  it("cataloga las 4 unidades", () => {
    assert.deepEqual(PRINT_UNITS, ["px", "mm", "cm", "in"]);
  });
});

describe("scaleForPageWidth — escalar a un tamaño físico pedido", () => {
  it("1080px pedido a 100mm → 100/91.44", () => {
    approx(scaleForPageWidth(100, 1080), 100 / ((1080 / PRINT_DPI) * MM_PER_INCH));
  });

  it("pedir el tamaño natural da escala 1", () => {
    approx(scaleForPageWidth((1080 / PRINT_DPI) * MM_PER_INCH, 1080), 1);
  });
});

describe("clampScale — límites 0.1×–5×", () => {
  it("acota por abajo y por arriba", () => {
    approx(clampScale(0.001), MIN_SCALE);
    approx(clampScale(50), MAX_SCALE);
    approx(clampScale(1.5), 1.5);
  });
});

describe("parseTargetValue — input humano (coma decimal, espacios)", () => {
  it("acepta coma decimal y espacios", () => {
    approx(parseTargetValue("10,5"), 10.5);
    approx(parseTargetValue(" 21,0 "), 21);
    approx(parseTargetValue("3.5"), 3.5);
  });

  it("basura → NaN (el dialog lo ignora, no explota)", () => {
    assert.ok(Number.isNaN(parseTargetValue("abc")));
    assert.ok(Number.isNaN(parseTargetValue("")));
  });
});

describe("formatInUnit — decimales sensatos por unidad", () => {
  it("mm/px con 1 decimal; cm/in con 2", () => {
    assert.equal(formatInUnit(91.44, "mm"), "91.4");
    assert.equal(formatInUnit(91.44, "px"), "1080.0");
    assert.equal(formatInUnit(91.44, "cm"), "9.14");
    assert.equal(formatInUnit(91.44, "in"), "3.60");
  });
});
