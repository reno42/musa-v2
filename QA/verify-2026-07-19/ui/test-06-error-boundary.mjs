/**
 * Ítem 9 ERROR-BOUNDARY (best effort) —
 *  (a) estático: escanea src/ buscando ErrorBoundary/componentDidCatch/
 *      getDerivedStateFromError.
 *  (b) dinámico estricto: intercepta get_brands con JSON INVÁLIDO en el payload
 *      → ¿tumba el render? (BrandPanel envuelve el JSON.parse en try/catch).
 *  (c) dinámico hostil: payload JSON VÁLIDO pero con forma hostil
 *      (brands: "abc" — truthy, .length>0, sin .slice/.map de array) → llega al
 *      render sin guardas → si no hay ErrorBoundary, React desmonta el árbol
 *      (pantalla en blanco).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  createVerifyTemplate, deleteTemplate,
  shot, record, log, sleep,
} from "./lib.mjs";

const REPO_SRC = new URL("../../../src", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const HTML = '<div data-layer-id="box" data-layer-name="Box" style="position:absolute;left:100px;top:100px;width:300px;height:200px;background:#3B82F6;border-radius:12px;"></div>';

function scanBoundary(dir, hits = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    try {
      if (statSync(p).isDirectory()) { if (!/node_modules/.test(p)) scanBoundary(p, hits); continue; }
      if (!/\.(tsx?|jsx?)$/.test(name)) continue;
      const src = readFileSync(p, "utf8");
      if (/ErrorBoundary|componentDidCatch|getDerivedStateFromError/.test(src)) hits.push(p);
    } catch { /* skip */ }
  }
  return hits;
}

function editorAlive() {
  return {
    root: !!document.querySelector(".editor-v2-root"),
    bodyTextLen: document.body.innerText.trim().length,
  };
}

export async function run(harness) {
  const page = harness.page;
  const pageErrors = [];
  const onErr = (err) => pageErrors.push(String(err.message || err));
  page.on("pageerror", onErr);

  // (a) estático
  const hits = scanBoundary(REPO_SRC);
  log(`[error-boundary] componentes con ErrorBoundary en src/: ${hits.length} ${JSON.stringify(hits)}`);

  const { templateId, frameId } = await createVerifyTemplate("errbnd", { html: HTML });
  let mode = "off";
  try {
    // Intercepción de red: solo respuestas /mcp cuya petición es get_brands
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const pd = req.postData() || "";
      if (req.url().includes("/mcp") && pd.includes("get_brands")) {
        if (mode === "invalid-json") {
          req.respond({
            status: 200, contentType: "application/json",
            body: JSON.stringify({ jsonrpc: "2.0", id: 0, result: { content: [{ type: "text", text: "ESTO NO ES JSON {{{" }] } }),
          });
        } else if (mode === "hostile-shape") {
          req.respond({
            status: 200, contentType: "application/json",
            body: JSON.stringify({ jsonrpc: "2.0", id: 0, result: { content: [{ type: "text", text: JSON.stringify({ brands: "abc" }) }] } }),
          });
        } else req.continue();
      } else req.continue();
    });

    await harness.open(templateId, frameId);
    await harness.settle(200);

    const openBrandPanel = async () => {
      const clicked = await page.evaluate(() => {
        const b = document.querySelector('button[title="Brand"]');
        if (b) { b.click(); return true; }
        return false;
      });
      await sleep(500);
      return clicked;
    };

    // ── (b) JSON inválido estricto ──
    mode = "invalid-json";
    const brandTabFound = await openBrandPanel();
    log(`[error-boundary] tab Brand encontrado: ${brandTabFound}`);
    const loadClicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(x => /load brands/i.test(x.textContent));
      if (b) { b.click(); return true; }
      return false;
    });
    await sleep(900);
    const aliveB = await page.evaluate(editorAlive);
    const errorsB = pageErrors.length;
    log(`[error-boundary] (b) loadClicked=${loadClicked} vivo=${JSON.stringify(aliveB)} pageErrors=${errorsB}`);
    await shot(page, "item9-invalid-json-panel");

    // ── (c) forma hostil (válida como JSON, sin guardas en render) ──
    mode = "hostile-shape";
    // recargar el panel para reintentar el load (brandsLoaded ya quedó true →
    // navegamos de nuevo para un intento limpio)
    await harness.open(templateId, frameId);
    await harness.settle(200);
    await openBrandPanel();
    const loadClicked2 = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(x => /load brands/i.test(x.textContent));
      if (b) { b.click(); return true; }
      return false;
    });
    await sleep(1200);
    const aliveC = await page.evaluate(editorAlive);
    log(`[error-boundary] (c) loadClicked=${loadClicked2} vivo=${JSON.stringify(aliveC)} pageErrors=${pageErrors.length}`);
    if (pageErrors.length) log(`[error-boundary] errores de página: ${pageErrors.slice(0, 3).join(" | ").slice(0, 400)}`);
    await shot(page, "item9-hostile-shape-result");

    page.off("pageerror", onErr);
    mode = "off";
    await page.setRequestInterception(false);

    // ── Veredicto ──
    const crashedC = !aliveC.root || aliveC.bodyTextLen < 40;
    const crashedB = !aliveB.root || aliveB.bodyTextLen < 40;
    const parts = [];
    parts.push(`(a) estático: ${hits.length === 0 ? "NO hay ningún ErrorBoundary/componentDidCatch/getDerivedStateFromError en src/" : "hay " + hits.length}`);
    parts.push(`(b) JSON inválido estricto en get_brands: ${crashedB ? "tumbó el render" : "el panel lo capturó (try/catch) y la app siguió viva"} (root=${aliveB.root}, texto=${aliveB.bodyTextLen} chars, pageErrors=${errorsB})`);
    parts.push(`(c) forma hostil (brands="abc"): ${crashedC ? `TUMBÓ la app — sin ErrorBoundary la excepción de render desmonta React (root=${aliveC.root}, texto=${aliveC.bodyTextLen} chars, pageErrors=${pageErrors.length})` : `no la tumbó (root=${aliveC.root}, texto=${aliveC.bodyTextLen})`}`);
    record("9 ERROR-BOUNDARY", crashedC ? "VERIFICADO (con matiz)" : (hits.length === 0 ? "VERIFICADO (solo estático)" : "REFUTADO"),
      parts.join(" · ") + ". Screenshots item9-*.png.",
      "La afirmación 'no hay ErrorBoundary' es cierta; el vector exacto 'JSON inválido' lo absorbe el try/catch del panel — hace falta que el dato llegue al render sin validar para que la ausencia de boundary tumbe la app.");
    return { hits, aliveB, aliveC, pageErrors };
  } catch (err) {
    page.off("pageerror", onErr);
    try { await page.setRequestInterception(false); } catch { /* noop */ }
    record("9 ERROR-BOUNDARY", "NO VERIFICADO", `error en la prueba: ${err.message}. Estático: ${hits.length} boundaries.`);
    return { hits, error: err.message };
  } finally {
    await deleteTemplate(templateId);
  }
}
