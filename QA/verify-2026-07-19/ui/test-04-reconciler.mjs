/**
 * Ítem 5 RECONCILER-ORDER / Ítem 6 RECONCILER-REPARENT — inyección vía REST PUT
 * REAL (update_template por MCP) recogida por el polling del editor.
 *
 * Detalle del transporte: el poll tiene una stale closure sobre lastRemoteUpdate
 * (EditorV2.tsx:518-553) — con un solo frame, la rama replaceAll es código
 * muerto. PERO el efecto se re-ejecuta si cambia selectedFrameId (está en las
 * deps), creando un closure fresco con el valor real de lastRemoteUpdate → el
 * siguiente poll sí aplica. Por eso las plantillas llevan DOS frames: el update
 * remoto toca el frame 1 y un click en el frame 2 "desatasca" la closure. Así el
 * HTML nuevo llega por la tubería auténtica REST→poll→replaceAll→reconcile.
 *
 * Afirmación 5: la capa nueva insertada en el MEDIO del HTML acaba con
 * appendChild al FINAL (z-order incorrecto).
 * Afirmación 6: la capa movida fuera de su contenedor DESAPARECE del DOM.
 */
import {
  mcp, createVerifyTemplate as _unused, deleteTemplate, remoteUpdateFrame as _ru,
  shot, record, log, domOrder, sleep,
} from "./lib.mjs";
import { mcp as mcpCall } from "./lib.mjs";

// ── plantilla de 2 frames ──
async function createTwoFrameTemplate(suffix, frame1Html, frame1Css = "") {
  const ws = await mcpCall("list_workspaces", {});
  const w = (ws.data || ws).find(x => x.name === "editor-qa");
  const c = await mcpCall("create_template", { workspaceId: w.id, name: `verify-a1-${suffix}`, width: 1080, height: 1080, engine: "html" });
  const templateId = (c.data || c).id;
  const frames = [
    { id: "frame_one", name: "F1", x: 0, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: frame1Html, css: frame1Css },
    { id: "frame_two", name: "F2", x: 1300, y: 0, width: 400, height: 400, background: "#111111", html: '<div data-layer-id="dummy" data-layer-name="D" style="position:absolute;left:20px;top:20px;width:100px;height:100px;background:#555;"></div>', css: "" },
  ];
  await mcpCall("update_template", { id: templateId, frames });
  return { templateId, frameId: "frame_one", frames };
}
async function remoteUpdateFrame1(templateId, frame1Html, frame1Css = "") {
  // reescribe ambos frames (frame 2 idéntico) — update_template reemplaza todo
  const frames = [
    { id: "frame_one", name: "F1", x: 0, y: 0, width: 1080, height: 1080, background: "#0E0D0B", html: frame1Html, css: frame1Css },
    { id: "frame_two", name: "F2", x: 1300, y: 0, width: 400, height: 400, background: "#111111", html: '<div data-layer-id="dummy" data-layer-name="D" style="position:absolute;left:20px;top:20px;width:100px;height:100px;background:#555;"></div>', css: "" },
  ];
  await mcpCall("update_template", { id: templateId, frames });
}

function clickFrame(page, frameId) {
  return page.evaluate((fid) => {
    const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
    if (!wrapper) return false;
    const r = wrapper.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    // mousedown directo sobre el wrapper: InfiniteHtmlCanvas.handleFrameMouseDown
    for (const type of ["mousedown", "mouseup"]) {
      wrapper.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: x, clientY: y }));
    }
    return true;
  }, frameId);
}

function selectedFrameLabel() {
  const bar = document.querySelector(".editor-v2-topbar");
  return bar ? bar.innerText.replace(/\s+/g, " ").slice(0, 120) : "";
}

function frameHtmlHas(frameId, needle) {
  const wrapper = document.querySelector(`[data-frame-id="${frameId}"]`);
  if (!wrapper) return null;
  const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
  if (!host) return null;
  return host.shadowRoot.getElementById("__df_content").innerHTML.includes(needle);
}

/** Espera (determinista) a que el poll del editor haga ≥1 GET del template. */
function waitForPoll(page, templateId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { page.off("response", onRes); resolve(false); }, timeoutMs);
    const onRes = (res) => {
      try {
        if (res.request().method() === "GET" && res.url().includes(`/api/templates/${templateId}`)) {
          clearTimeout(t);
          page.off("response", onRes);
          resolve(true);
        }
      } catch { /* noop */ }
    };
    page.on("response", onRes);
  });
}

// ── Ítem 5 ──
const ORDER_HTML = [
  '<div data-layer-id="la" data-layer-name="A" style="position:absolute;left:50px;top:50px;width:300px;height:300px;background:#EF4444;border-radius:12px;"></div>',
  '<div data-layer-id="lb" data-layer-name="B" style="position:absolute;left:200px;top:200px;width:300px;height:300px;background:#22C55E;border-radius:12px;"></div>',
  '<div data-layer-id="lc" data-layer-name="C" style="position:absolute;left:350px;top:350px;width:300px;height:300px;background:#3B82F6;border-radius:12px;"></div>',
].join("\n");
const NEW_LAYER = '<div data-layer-id="newmid" data-layer-name="NEW" style="position:absolute;left:220px;top:220px;width:300px;height:300px;background:#F97316;border-radius:12px;"></div>';
const ORDER_HTML_REMOTE = ORDER_HTML.replace('<div data-layer-id="lb"', NEW_LAYER + '\n<div data-layer-id="lb"');

// ── Ítem 6 ──
const MV = '<div data-layer-id="mv" data-layer-name="MV" style="position:absolute;left:60px;top:60px;width:150px;height:150px;background:#FACC15;border-radius:12px;"></div>';
const REPARENT_HTML = [
  '<div data-layer-id="panel" data-layer-name="Panel" style="position:absolute;left:80px;top:80px;width:420px;height:420px;background:#1E293B;border-radius:20px;">',
  "  " + MV,
  "</div>",
  '<div data-layer-id="sib" data-layer-name="Sib" style="position:absolute;left:600px;top:120px;width:200px;height:200px;background:#06B6D4;border-radius:12px;"></div>',
].join("\n");
const REPARENT_HTML_REMOTE = [
  MV,
  '<div data-layer-id="sib" data-layer-name="Sib" data-remote-marker="r1" style="position:absolute;left:600px;top:120px;width:200px;height:200px;background:#06B6D4;border-radius:12px;"></div>',
].join("\n");

export async function run(harness) {
  // ═══ Ítem 5 ═══
  const t5 = await createTwoFrameTemplate("order", ORDER_HTML);
  try {
    await harness.open(t5.templateId, t5.frameId);
    await harness.settle(200);
    const order0 = await harness.page.evaluate(domOrder, t5.frameId);
    await shot(harness.page, "item5-order-before");
    log(`[order] DOM inicial frame1: ${JSON.stringify(order0)}`);

    log("[order] esperando al primer poll del editor (GET /api/templates)…");
    const polled = await waitForPoll(harness.page, t5.templateId, 15000);
    log(`[order] primer poll observado: ${polled}. Enviando update REST (NEW entre A y B)…`);
    await remoteUpdateFrame1(t5.templateId, ORDER_HTML_REMOTE);
    await sleep(300);
    await clickFrame(harness.page, "frame_two");
    await harness.settle(400);
    log(`[order] topbar tras click frame2: ${JSON.stringify(await harness.page.evaluate(selectedFrameLabel))}`);

    let order1 = null;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const has = await harness.page.evaluate(frameHtmlHas, t5.frameId, "newmid");
      if (has) { order1 = await harness.page.evaluate(domOrder, t5.frameId); break; }
      await sleep(1000);
    }
    await shot(harness.page, "item5-order-after-sync");
    const stats5 = await harness.page.evaluate(() => window.futurariaAgent?.__lastReconcile || null);
    log(`[order] orden tras sync REST: ${JSON.stringify(order1)} reconcile=${JSON.stringify(stats5)}`);

    if (!order1) {
      record("5 RECONCILER-ORDER", "NO VERIFICADO", "el update REST nunca llegó al DOM del frame 1 (ni con el refresh de closure por cambio de frame)");
    } else {
      const expected = ["la", "newmid", "lb", "lc"];
      const buggy = ["la", "lb", "lc", "newmid"];
      if (JSON.stringify(order1) === JSON.stringify(buggy)) {
        record("5 RECONCILER-ORDER", "VERIFICADO",
          `orden DOM tras sync REST: ${JSON.stringify(order1)} — NEW insertada con appendChild AL FINAL en vez de entre A y B (${JSON.stringify(expected)}). ` +
          `reconcile stats: ${JSON.stringify(stats5)}. NEW (naranja) se pinta POR ENCIMA de B (verde) pese a ir antes en el HTML → z-order incorrecto. Screenshots item5-*.png.`,
          "frameReconciler.ts:104-108 — INSERT hace content.appendChild(clone) sin calcular la posición entre hermanos.");
      } else if (JSON.stringify(order1) === JSON.stringify(expected)) {
        record("5 RECONCILER-ORDER", "REFUTADO", `orden DOM correcto tras sync REST: ${JSON.stringify(order1)}`);
      } else {
        record("5 RECONCILER-ORDER", "NO VERIFICADO", `orden inesperado: ${JSON.stringify(order1)}`);
      }
    }
  } catch (err) {
    record("5 RECONCILER-ORDER", "NO VERIFICADO", `fallo: ${err.message}`);
  } finally {
    await deleteTemplate(t5.templateId);
  }

  // ═══ Ítem 6 ═══
  const t6 = await createTwoFrameTemplate("reparent", REPARENT_HTML);
  try {
    await harness.open(t6.templateId, t6.frameId);
    await harness.settle(200);
    const before = await harness.page.evaluate(domOrder, t6.frameId);
    await shot(harness.page, "item6-reparent-before");
    log(`[reparent] DOM inicial frame1: ${JSON.stringify(before)} (mv dentro de panel)`);

    log("[reparent] esperando al primer poll…");
    const polled6 = await waitForPoll(harness.page, t6.templateId, 15000);
    log(`[reparent] primer poll observado: ${polled6}. Enviando update REST (panel eliminado; mv a top-level mismo outerHTML; sib con data-remote-marker)…`);
    await remoteUpdateFrame1(t6.templateId, REPARENT_HTML_REMOTE);
    await sleep(300);
    await clickFrame(harness.page, "frame_two");
    await harness.settle(400);
    log(`[reparent] topbar tras click frame2: ${JSON.stringify(await harness.page.evaluate(selectedFrameLabel))}`);

    let synced = false;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const has = await harness.page.evaluate(frameHtmlHas, t6.frameId, "data-remote-marker");
      if (has) { synced = true; break; }
      await sleep(1000);
    }
    await harness.settle(300);
    await shot(harness.page, "item6-reparent-after-sync");
    const after = await harness.page.evaluate((fid) => {
      const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
      const content = host.shadowRoot.getElementById("__df_content");
      return {
        panelPresent: !!content.querySelector('[data-layer-id="panel"]'),
        mvPresent: !!content.querySelector('[data-layer-id="mv"]'),
        order: [...content.children].map(c => c.getAttribute("data-layer-id")),
        reconcile: window.futurariaAgent?.__lastReconcile || null,
      };
    }, t6.frameId);
    log(`[reparent] sync=${synced} estado tras update: ${JSON.stringify(after)}`);

    if (!synced) {
      record("6 RECONCILER-REPARENT", "NO VERIFICADO", "el update REST nunca llegó al DOM del frame 1");
    } else if (!after.panelPresent && !after.mvPresent) {
      record("6 RECONCILER-REPARENT", "VERIFICADO",
        `tras la sync REST, panel ya no está y mv DESAPARECIÓ del DOM: orden=${JSON.stringify(after.order)} (solo queda sib). ` +
        `reconcile stats: ${JSON.stringify(after.reconcile)} — el padre viejo se remove() con mv dentro y la entrada stale de mv en currentLayers casa por hash → SKIP → nunca se re-inserta. Screenshots item6-*.png.`,
        "frameReconciler.ts: DELETE recorre currentLayers antes de que el loop INSERT/SKIP note que el nodo ya no está en el DOM.");
    } else if (after.mvPresent) {
      record("6 RECONCILER-REPARENT", "REFUTADO", `mv sigue presente tras la sync: ${JSON.stringify(after)}`);
    } else {
      record("6 RECONCILER-REPARENT", "NO VERIFICADO", `estado inesperado: ${JSON.stringify(after)}`);
    }
  } catch (err) {
    record("6 RECONCILER-REPARENT", "NO VERIFICADO", `fallo: ${err.message}`);
  } finally {
    await deleteTemplate(t6.templateId);
  }
}
