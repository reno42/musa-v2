import test from "node:test";
import assert from "node:assert/strict";
import { chooseMusaModules, searchMusaTools } from "../src/lib/musaToolRouting.ts";

test("a cross-module request retains both phases", () => {
  assert.deepEqual(chooseMusaModules("Arma la grilla de tres meses y diseña cada post"), ["copywriting", "design"]);
});

test("CRM and configuration requests do not load design tools", () => {
  assert.deepEqual(chooseMusaModules("Actualiza el prospecto del CRM"), ["contacts"]);
  assert.deepEqual(chooseMusaModules("Configura una API key"), ["config"]);
});

test("motion is independent, but explicit design plus animation retains both phases", () => {
  assert.deepEqual(chooseMusaModules("Anima este diseño"), ["motion"]);
  assert.deepEqual(chooseMusaModules("Anima este carrusel"), ["motion"]);
  assert.deepEqual(chooseMusaModules("Diseña un carrusel y luego anímalo"), ["design", "motion"]);
});

test("unclear requests keep the general fallback", () => {
  assert.deepEqual(chooseMusaModules("Hazlo como hablamos"), []);
});

test("discovery can find a tool outside the initial profile", () => {
  const tools = [
    { function: { name: "list_templates", description: "Lista diseños" } },
    { function: { name: "harness_create_cronjob", description: "Programa una automatización" } },
  ];
  assert.equal(searchMusaTools(tools, "cronjob")[0]?.function.name, "harness_create_cronjob");
  assert.deepEqual(searchMusaTools(tools, ""), []);
});
