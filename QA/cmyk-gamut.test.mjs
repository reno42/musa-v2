/**
 * cmykGamut — aproximación sin ICC del gamut coated para la UI (checkbox
 * "Solo CMYK" del picker + botón "Convertir a CMYK" del archivo). Aquí se
 * cubre: neutros siempre seguros, vivos fuera de gamut clampeados con matiz
 * preservado, idempotencia del clamp, amarillo/rojo coated intactos y el
 * walker de tokens de color en CSS/HTML (alpha de rgba preservado).
 *
 * Run: node --experimental-strip-types --test QA/cmyk-gamut.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const modPath = "file://" + resolve(__dirname, "..", "src", "lib", "cmykGamut.ts");

const {
  isCmykSafe, clampToCmykGamut, mapCssColors, rgbToHsv, hexToRgb,
} = await import(modPath);

describe("isCmykSafe — neutros y tintas coated", () => {
  it("neutros (blanco/negro/grises) siempre dentro", () => {
    assert.equal(isCmykSafe("#ffffff"), true);
    assert.equal(isCmykSafe("#000000"), true);
    assert.equal(isCmykSafe("#808080"), true);
    assert.equal(isCmykSafe("#111111"), true);
  });

  it("las tintas coated de referencia caben (anclas)", () => {
    assert.equal(isCmykSafe("#fff200"), true, "amarillo");
    assert.equal(isCmykSafe("#ed1c24"), true, "rojo");
    assert.equal(isCmykSafe("#ec008c"), true, "magenta");
    assert.equal(isCmykSafe("#00aeef"), true, "cian");
  });

  it("RGB puros de pantalla fuera del gamut", () => {
    assert.equal(isCmykSafe("#00ff00"), false, "verde puro");
    assert.equal(isCmykSafe("#0000ff"), false, "azul puro");
    assert.equal(isCmykSafe("#ff00ff"), false, "magenta pura");
    assert.equal(isCmykSafe("#00ffff"), false, "cian puro");
  });

  it("entrada que no es color → true (no rompe)", () => {
    assert.equal(isCmykSafe("transparent"), true);
    assert.equal(isCmykSafe("var(--x)"), true);
  });
});

describe("clampToCmykGamut — baja V, conserva matiz, idempotente", () => {
  it("verde puro: queda seguro, mismo matiz, más oscuro", () => {
    const out = clampToCmykGamut("#00ff00");
    assert.notEqual(out, "#00ff00");
    assert.equal(isCmykSafe(out), true);
    const hIn = Math.round(rgbToHsv(0, 255, 0).h);
    const o = hexToRgb(out);
    const hOut = Math.round(rgbToHsv(o.r, o.g, o.b).h);
    assert.ok(Math.abs(hIn - hOut) <= 2, `matiz ${hIn} → ${hOut}`);
    assert.ok(o.g < 255, "baja el canal dominante");
  });

  it("azul puro → azul marino impreso, matiz 240 preservado", () => {
    const out = clampToCmykGamut("#0000ff");
    assert.equal(isCmykSafe(out), true);
    const o = hexToRgb(out);
    const hsv = rgbToHsv(o.r, o.g, o.b);
    assert.ok(Math.abs(hsv.h - 240) <= 2, `matiz ${hsv.h}`);
    assert.ok(hsv.v < 0.7, "el valor baja (tinta azul es oscura)");
  });

  it("idempotente: clamp(clamp(x)) === clamp(x)", () => {
    for (const c of ["#00ff00", "#0000ff", "#ff00ff", "#ff1493", "#ff8000"]) {
      const once = clampToCmykGamut(c);
      assert.equal(clampToCmykGamut(once), once, c);
    }
  });

  it("colores ya imprimibles no se tocan", () => {
    assert.equal(clampToCmykGamut("#ffff00"), "#ffff00");
    assert.equal(clampToCmykGamut("#ed1c24"), "#ed1c24");
    assert.equal(clampToCmykGamut("#808080"), "#808080");
    assert.equal(clampToCmykGamut("#fff2e2"), "#fff2e2");
  });

  it("no-color pasa sin cambio", () => {
    assert.equal(clampToCmykGamut("transparent"), "transparent");
    assert.equal(clampToCmykGamut("var(--fill)"), "var(--fill)");
    assert.equal(clampToCmykGamut(""), "");
  });
});

describe("mapCssColors — walker de tokens CSS/HTML", () => {
  it("convierte hex y deja intacto el resto del texto", () => {
    const css = ".a { color: #00ff00; padding: 4px; }";
    const out = mapCssColors(css, clampToCmykGamut);
    assert.ok(out.includes("padding: 4px;"));
    const m = out.match(/color: (#[0-9a-f]{6});/i);
    assert.ok(m, "sigue habiendo un hex");
    assert.equal(isCmykSafe(m[1]), true);
    assert.notEqual(m[1].toLowerCase(), "#00ff00");
  });

  it("rgba conserva su alpha con canales clampeados", () => {
    const out = mapCssColors("border: 1px solid rgba(0, 255, 0, 0.5)", clampToCmykGamut);
    const m = out.match(/rgba\((\d+), (\d+), (\d+), 0\.5\)/);
    assert.ok(m, "alpha 0.5 preservada: " + out);
    assert.ok(Number(m[2]) < 255, "canal verde clampeado");
  });

  it("hsl se convierte igual que su hex equivalente", () => {
    const out = mapCssColors("color: hsl(120, 100%, 50%)", clampToCmykGamut);
    const m = out.match(/color: (#[0-9a-f]{6})/i);
    assert.ok(m);
    assert.equal(m[1].toLowerCase(), clampToCmykGamut("#00ff00"));
  });

  it("hex de 3 dígitos también se procesa", () => {
    const out = mapCssColors("fill: #0f0", clampToCmykGamut);
    assert.equal(isCmykSafe(out.replace("fill: ", "")), true);
  });

  it("non-colors intactos: transparent, var(), keywords", () => {
    const css = "background: transparent; color: var(--accent); content: 'hola'";
    assert.equal(mapCssColors(css, clampToCmykGamut), css);
  });

  it("un degradado con varios colores queda todo dentro del gamut", () => {
    const g = "linear-gradient(135deg, #00ff00 0%, #0000ff 50%, #ff00ff 100%)";
    const out = mapCssColors(g, clampToCmykGamut);
    for (const hex of out.match(/#[0-9a-f]{6}/gi) || []) {
      assert.equal(isCmykSafe(hex), true, hex);
    }
  });
});
