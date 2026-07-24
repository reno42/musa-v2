/**
 * toHexColor unit tests.
 *
 * `<input type="color">` accepts only "#rrggbb". Feeding it a 3-digit hex made
 * the browser reject the value and log 'The specified value "#000" does not
 * conform to the required format' — design CSS is full of short hex.
 *
 * Run: node --test QA/color-utils.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");
const modPath = "file://" + resolve(__dirname, "..", "src", "lib", "colorUtils.ts");

const { toHexColor } = await import(modPath);

describe("toHexColor", () => {
  it("expands 3-digit hex to the 6-digit form the color input requires", () => {
    assert.equal(toHexColor("#000"), "#000000");
    assert.equal(toHexColor("#abc"), "#aabbcc");
    assert.equal(toHexColor("#FFF"), "#ffffff");
  });

  it("expands 4-digit hex, dropping the alpha nibble", () => {
    assert.equal(toHexColor("#0f08"), "#00ff00");
  });

  it("passes 6-digit hex through and trims 8-digit alpha", () => {
    assert.equal(toHexColor("#1a2b3c"), "#1a2b3c");
    assert.equal(toHexColor("#1a2b3cff"), "#1a2b3c");
  });

  it("converts rgb()/rgba() to hex", () => {
    assert.equal(toHexColor("rgb(108, 198, 68)"), "#6cc644");
    assert.equal(toHexColor("rgba(0, 0, 0, 0.5)"), "#000000");
  });

  it("falls back for empty or unparseable values", () => {
    assert.equal(toHexColor(""), "#000000");
    assert.equal(toHexColor(undefined), "#000000");
    assert.equal(toHexColor(null, "#ffffff"), "#ffffff");
  });

  it("always returns a value the color input accepts", () => {
    const accepted = /^#[0-9a-f]{6}$/;
    for (const input of ["#000", "#abc", "transparent", "rgb(1,2,3)", "", "not-a-color"]) {
      assert.match(toHexColor(input), accepted, `failed for ${JSON.stringify(input)}`);
    }
  });
});
