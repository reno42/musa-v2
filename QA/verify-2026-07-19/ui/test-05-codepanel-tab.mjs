/**
 * Ítem 7 CODEPANEL-TAB — CodePanel (Ctrl+/), editar en tab HTML y cambiar de tab
 * en <200ms. Dos variantes:
 *  A (literal de la afirmación): escribir en HTML, cambiar a CSS SIN escribir,
 *    volver a HTML. El debounce compartido NO se cancela por cambiar de tab →
 *    el commit debería salir igualmente.
 *  B (mecanismo del debounceRef compartido): escribir en HTML, cambiar a CSS y
 *    ESCRIBIR allí (handleCssChange hace clearTimeout del MISMO debounceRef) →
 *    el commit HTML pendiente se cancela → el cambio HTML nunca llega al frame.
 *
 * Se comprueba el frame DOM (ground truth del commit) y el contenido visible del
 * editor Monaco (.view-lines).
 */
import {
  createVerifyTemplate, deleteTemplate,
  shot, record, log, sleep,
} from "./lib.mjs";

const HTML = '<div data-layer-id="box" data-layer-name="Box" style="position:absolute;left:100px;top:100px;width:300px;height:200px;background:#3B82F6;border-radius:12px;"></div>';

function frameHasText(fid, needle) {
  const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
  if (!wrapper) return null;
  const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
  if (!host) return null;
  return host.shadowRoot.getElementById("__df_content").innerHTML.includes(needle);
}

function monacoVisibleText() {
  try {
    if (typeof window.monaco !== "undefined") {
      const models = window.monaco.editor.getModels();
      return models.map(m => m.getValue().slice(0, 400)).join("\n---MODELO---\n");
    }
  } catch { /* noop */ }
  const ed = [...document.querySelectorAll(".monaco-editor")].find(e => e.offsetParent !== null);
  if (!ed) return null;
  const lines = ed.querySelector(".view-lines");
  return lines ? lines.textContent.slice(0, 300) : null;
}

function clickTab(name) {
  const btns = [...document.querySelectorAll("button")].filter(b => b.textContent.trim() === name);
  const tab = btns.find(b => {
    const sib = b.parentElement ? [...b.parentElement.querySelectorAll("button")].map(x => x.textContent.trim()) : [];
    return sib.includes("HTML") && sib.includes("CSS");
  });
  if (!tab) return false;
  tab.click();
  return true;
}

async function openCodePanel(harness) {
  await harness.qa("key", "keydown", "/", { ctrlKey: true });
  await harness.page.waitForFunction(() => document.querySelector(".monaco-editor"), { timeout: 25000 });
  await sleep(600); // monaco termina de montar ambos modelos
}

// Este Monaco usa EditContext (native-edit-context): hace falta un click REAL
// (CDP) para enfocar; los MouseEvent sintéticos no bastan.
async function clickIntoMonaco(page) {
  const pt = await page.evaluate(() => {
    const ed = [...document.querySelectorAll(".monaco-editor")].find(e => e.offsetParent !== null);
    if (!ed) return null;
    const r = ed.querySelector(".view-lines").getBoundingClientRect();
    return { x: r.left + 60, y: r.top + 12 };
  });
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y);
  await sleep(150);
  // cursor al final del documento para que el marker quede fuera de etiquetas
  await page.keyboard.down("Control");
  await page.keyboard.press("End");
  await page.keyboard.up("Control");
  await sleep(100);
  return true;
}

async function variant(harness, suffix, marker, typeInCss, tag) {
  const { templateId, frameId } = await createVerifyTemplate(suffix, { html: HTML });
  try {
    await harness.open(templateId, frameId);
    await harness.settle(200);
    await openCodePanel(harness);
    await clickIntoMonaco(harness.page);

    const t0 = Date.now();
    await harness.page.keyboard.type(marker, { delay: 8 });
    const typedAt = Date.now();
    // cambio de tab en <200ms desde el último keystroke
    const clickedCss = await harness.page.evaluate(clickTab, "CSS");
    let cssEditAt = null;
    if (typeInCss) {
      // Dispara onDidChangeModelContent del modelo CSS (→ handleCssChange →
      // clearTimeout del debounceRef COMPARTIDO) dentro de la ventana de 200ms.
      // Se hace por el canal de comando del editor (mismo path que teclear)
      // porque enfocar con click real + sleeps no cabe en la ventana.
      cssEditAt = await harness.page.evaluate(() => {
        const eds = window.monaco.editor.getEditors();
        const cssEd = eds.find(e => !e.getModel().getValue().includes("<div"));
        if (!cssEd) return null;
        cssEd.trigger("keyboard", "type", { text: "zzmark" });
        return Date.now();
      });
    }
    await sleep(60);
    const clickedHtml = await harness.page.evaluate(clickTab, "HTML");
    const switchMs = Date.now() - t0;
    const htmlToCssEditMs = cssEditAt ? cssEditAt - typedAt : null;
    log(`[codepanel-${tag}] tabs: css=${clickedCss} html=${clickedHtml} secuencia=${switchMs}ms · última tecla HTML → edición CSS: ${htmlToCssEditMs}ms`);
    await shot(harness.page, `item7-${tag}-right-after-tabs`);

    await sleep(800); // el debounce (200ms) tenía que haber disparado si no se canceló
    const bare = marker.trim();
    const inFrame = await harness.page.evaluate(frameHasText, frameId, bare);
    const editorText = await harness.page.evaluate(monacoVisibleText);
    log(`[codepanel-${tag}] marker "${bare}" en frame DOM: ${inFrame} · modelo Monaco contiene marker: ${editorText ? editorText.includes(bare) : "?"}`);

    // Persistencia real: cerrar y reabrir el panel → el modelo se recrea desde props
    await harness.qa("key", "keydown", "/", { ctrlKey: true });
    await sleep(400);
    await harness.qa("key", "keydown", "/", { ctrlKey: true });
    await harness.page.waitForFunction(() => document.querySelector(".monaco-editor"), { timeout: 25000 });
    await sleep(600);
    const editorText2 = await harness.page.evaluate(monacoVisibleText);
    const survivesReopen = editorText2 ? editorText2.includes(marker.trim()) : false;
    log(`[codepanel-${tag}] tras reabrir panel, editor contiene marker: ${survivesReopen}`);
    await shot(harness.page, `item7-${tag}-after-reopen`);

    return { inFrame, survivesReopen, switchMs, htmlToCssEditMs, tag };
  } finally {
    await deleteTemplate(templateId);
  }
}

export async function run(harness) {
  const A = await variant(harness, "codea", " QAAMARK ", false, "A-solo-cambio-tab");
  const B = await variant(harness, "codeb", " QABMARK ", true, "B-escribe-en-css");

  if (A.inFrame) {
    log("[codepanel] variante A: el commit HTML SALIÓ pese al cambio de tab (debounce no cancelado por tabs)");
  } else {
    log("[codepanel] variante A: el cambio HTML NO llegó al frame");
  }

  if (B.inFrame) {
    record("7 CODEPANEL-TAB", "REFUTADO",
      `ni siquiera editando CSS dentro de la ventana de 200ms se pierde el cambio HTML: B inFrame=true (html→css edit=${B.htmlToCssEditMs}ms). A inFrame=${A.inFrame}.`);
  } else if (!A.inFrame && !B.inFrame) {
    record("7 CODEPANEL-TAB", "VERIFICADO",
      `en AMBAS variantes el cambio HTML nunca llegó al frame. A: solo cambiar de tab en ${A.switchMs}ms; B: edición CSS a los ${B.htmlToCssEditMs}ms de la última tecla HTML. Tras reabrir: A=${A.survivesReopen}, B=${B.survivesReopen}. Screenshots item7-*.png.`);
  } else {
    // A commitea, B se pierde → la afirmación literal (solo cambiar de tab) se cae, pero el mecanismo (debounceRef compartido) existe y muerde al escribir en el otro tab.
    record("7 CODEPANEL-TAB", "VERIFICADO (con matiz)",
      `la afirmación LITERAL (solo cambiar de tab sin escribir) no reproduce: variante A commitó (marker en frame DOM, sobrevive reapertura=${A.survivesReopen}). ` +
      `PERO el mecanismo del debounceRef compartido SÍ pierde el cambio: variante B — edición CSS a los ${B.htmlToCssEditMs}ms de la última tecla HTML (<200ms) → el commit HTML se canceló: marker AUSENTE del frame DOM; en el editor queda texto fantasma hasta reabrir (survivesReopen=${B.survivesReopen}). Screenshots item7-*.png.`,
      "CodePanel.tsx:51,82-90 — un único debounceRef para handleHtmlChange y handleCssChange; escribir en el otro tab dentro de la ventana de 200ms cancela el commit pendiente. Cambiar de tab sin escribir NO lo cancela (los editores quedan montados con display:none).");
  }
  return { A, B };
}
