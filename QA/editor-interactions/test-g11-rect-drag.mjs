/**
 * G11 — "El arrastre directo de la herramienta Rectángulo no crea nada"
 * (gap-analysis 2026-10-16, H7 de QA R5; el click desde el flyout SÍ crea).
 *
 * Repro en el editor REAL (seed desechable + gestos): el bug se manifestó en
 * prod y prod tiene el mismo código que local (diff 5998c0d..HEAD = 0 en los
 * 4 archivos del flujo), así que tiene que reproducir acá.
 *
 * Variantes (cada una aisla un tramo distinto de la cadena):
 *   G11.0  atajo "r" activa la herramienta (cursor crosshair en el frame).
 *   G11.1  drag SINTÉTICO (MouseEvent sobre #__df_content) — ejercita el
 *          handler de DesignFrame sin depender del hit-test real.
 *   G11.2  drag REAL (page.mouse / CDP, eventos trusted) — el pipeline
 *          completo del usuario: hit-test, pointer-events, burbujeo.
 *   G11.3  click de control en zona vacía — el camino que QA dice que SÍ
 *          funciona (coloca un rectángulo de 200×150).
 *   G11.4  lo creado por el drag persiste vía autosave (fila en templates).
 *
 * Hoy se espera ROJO en G11.1/G11.2 y VERDE en G11.0/G11.3 (repro asimétrica
 * = diagnóstico). Tras el fix todo verde y queda como guarda de regresión.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { makeReport } from "./lib/assert.mjs";
import { seedEditorFixture, injectSession, clearInjectedSession, fetchTemplateRow } from "./lib/seed.mjs";

/** Fixture layers (card/pill/dot) — zonas vacías del frame 1080×1080 elegidas
 *  para no pisarlas: drag (880,880)→(1005,985), click (930,690). */
const DRAG_FROM = { x: 880, y: 880 };
const DRAG_TO = { x: 1005, y: 985 };
const CLICK_AT = { x: 930, y: 690 };

/** frame-local → client coords usando el rect visual del content + zoom real. */
async function toClient(page, frameId, pt) {
  return page.evaluate((fid, p) => {
    const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
    const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
    const content = host.shadowRoot.getElementById("__df_content");
    const r = content.getBoundingClientRect();
    const zoom = r.width / (host.offsetWidth || 1080);
    return { x: r.left + p.x * zoom, y: r.top + p.y * zoom, zoom };
  }, frameId, pt);
}

/** Lista de capas {id, kind, w, h} del content — para detectar capas NUEVAS. */
async function layers(page, frameId) {
  return page.evaluate(fid => {
    const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
    const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
    const content = host.shadowRoot.getElementById("__df_content");
    return [...content.querySelectorAll("[data-layer-id]")].map(el => {
      const r = el.getBoundingClientRect();
      const cRect = content.getBoundingClientRect();
      const zoom = cRect.width / (host.offsetWidth || 1080);
      return {
        id: el.getAttribute("data-layer-id"),
        kind: el.getAttribute("data-layer-kind"),
        w: Math.round(r.width / zoom),
        h: Math.round(r.height / zoom),
      };
    });
  }, frameId);
}

async function pressR(page) {
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true, cancelable: true }));
  });
  await new Promise(r => page.evaluate(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)))).then(r).catch(() => r()));
  await sleep(150);
}

/** ¿El preview punteado del drag-to-draw está vivo en el content ahora? */
async function previewVisible(page, frameId) {
  return page.evaluate(fid => {
    const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
    const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
    const content = host.shadowRoot.getElementById("__df_content");
    const last = content.lastElementChild;
    return !!(last && (last.style.border || "").includes("dashed"));
  }, frameId);
}

export async function run(harness) {
  const report = makeReport("G11 · Rectángulo por arrastre crea la capa");
  const fx = await seedEditorFixture({ name: "QA — rect drag" });
  const newIds = [];
  try {
    const page = harness.page;
    await injectSession(page, fx.session);
    await harness.open(fx.templateId, fx.frameId);

    const before = await layers(page, fx.frameId);
    // ensureLayerIds asigna ids propios a los <h1>/<p> internos del card →
    // el baseline real es 5, no 3. Lo que importa: card/pill/dot presentes.
    const hasFixture = ["card", "pill", "dot"].every(id => before.some(l => l.id === id));
    report.ok(
      "G11.0a el fixture abre con sus capas (card/pill/dot)",
      hasFixture,
      `capas=${before.map(l => l.id).join(",")}`,
    );

    // ── G11.0: la herramienta se activa (cursor crosshair del HOST shadow) ──
    await pressR(page);
    const cursor = await page.evaluate(fid => {
      const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
      return getComputedStyle(host).cursor;
    }, fx.frameId);
    report.ok(
      "G11.0b el atajo R activa la herramienta (cursor crosshair)",
      cursor === "crosshair",
      `cursor=${cursor}`,
    );

    // ── G11.1: drag SINTÉTICO directo sobre #__df_content ──
    // (fiel al listener de DesignFrame; independiente del hit-test)
    const from1 = await toClient(page, fx.frameId, DRAG_FROM);
    const to1 = await toClient(page, fx.frameId, DRAG_TO);
    await page.evaluate((fid, a, b) => {
      const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
      const content = host.shadowRoot.getElementById("__df_content");
      const fire = (target, type, x, y, extra = {}) =>
        target.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, composed: true, view: window,
          button: 0, clientX: x, clientY: y, ...extra,
        }));
      fire(content, "mousedown", a.x, a.y);
      fire(document, "mousemove", a.x + (b.x - a.x) / 3, a.y + (b.y - a.y) / 3, { buttons: 1 });
      fire(document, "mousemove", a.x + 2 * (b.x - a.x) / 3, a.y + 2 * (b.y - a.y) / 3, { buttons: 1 });
      fire(document, "mousemove", b.x, b.y, { buttons: 1 });
      fire(document, "mouseup", b.x, b.y);
    }, fx.frameId, from1, to1);
    await harness.settle(300);
    const midCount = (await layers(page, fx.frameId)).length;
    report.ok(
      "G11.1 drag sintético crea una capa de shape",
      midCount === before.length + 1,
      `capas tras drag=${midCount} (antes ${before.length})`,
    );
    if (midCount > before.length) {
      const after = await layers(page, fx.frameId);
      newIds.push(after[after.length - 1].id);
    }

    // Reactivar la herramienta (todo creador de capas vuelve a "select")
    await pressR(page);

    // ── G11.2: drag REAL (CDP trusted events — el gesto exacto del usuario) ──
    const from2 = await toClient(page, fx.frameId, { x: 60, y: 880 });
    const to2 = await toClient(page, fx.frameId, { x: 190, y: 985 });
    const baseline2 = (await layers(page, fx.frameId)).length;
    let sawPreview = false;
    await page.mouse.move(from2.x, from2.y);
    await page.mouse.down();
    await page.mouse.move(from2.x + (to2.x - from2.x) / 2, from2.y + (to2.y - from2.y) / 2, { steps: 4 });
    sawPreview = await previewVisible(page, fx.frameId);
    await page.mouse.move(to2.x, to2.y, { steps: 4 });
    await page.mouse.up();
    await harness.settle(300);
    const after2 = await layers(page, fx.frameId);
    report.ok(
      "G11.2 drag real (trusted) crea una capa de shape",
      after2.length === baseline2 + 1,
      `capas=${after2.length} (antes ${baseline2}) · preview punteado visto=${sawPreview}`,
    );
    if (after2.length > baseline2) newIds.push(after2[after2.length - 1].id);

    // ── G11.3: click de control (el camino que QA reporta como funcionando) ──
    await pressR(page);
    const clickPt = await toClient(page, fx.frameId, CLICK_AT);
    const baseline3 = (await layers(page, fx.frameId)).length;
    await page.evaluate((fid, p) => {
      const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
      const content = host.shadowRoot.getElementById("__df_content");
      const fire = (target, type) =>
        target.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, composed: true, view: window,
          button: 0, clientX: p.x, clientY: p.y,
        }));
      fire(content, "mousedown");
      fire(document, "mouseup");
    }, fx.frameId, clickPt);
    await harness.settle(300);
    const after3 = await layers(page, fx.frameId);
    report.ok(
      "G11.3 click de control coloca un rectángulo (~200×150)",
      after3.length === baseline3 + 1,
      `capas=${after3.length} (antes ${baseline3}) — QA R5: este camino SÍ funciona`,
    );

    // ── G11.5: drag REAL sobre canvas vacío (fuera de todo frame) → huérfano ──
    // Es el otro candidato del repro de QA: "arrastrar en el canvas" puede ser
    // fuera del frame. Camino: viewport → onCreateOrphanFromTool. El punto debe
    // ser canvas REALMENTE vacío: elementFromPoint === viewport (las esquinas
    // del viewport pueden estar cubiertas por la toolbar flotante).
    await pressR(page);
    const emptyPt = await page.evaluate(() => {
      const vp = document.querySelector('[data-testid="editor-canvas-viewport"]');
      if (!vp) return null;
      const r = vp.getBoundingClientRect();
      for (let gx = 1; gx < 20; gx++) {
        for (let gy = 1; gy < 14; gy++) {
          const x = r.left + (r.width * gx) / 20;
          const y = r.top + (r.height * gy) / 14;
          if (document.elementFromPoint(x, y) === vp) return { x, y };
        }
      }
      return null;
    });
    const orphansBefore = await page.evaluate(() => document.querySelectorAll("[data-canvas-object-id]").length);
    if (!emptyPt) {
      report.ok(
        "G11.5 drag en canvas vacío crea un huérfano",
        false,
        "no se encontró un punto libre del viewport (frame cubre todo el canvas)",
      );
    } else {
      await page.mouse.move(emptyPt.x, emptyPt.y);
      await page.mouse.down();
      await page.mouse.move(emptyPt.x + 45, emptyPt.y + 35, { steps: 4 });
      await page.mouse.move(emptyPt.x + 90, emptyPt.y + 70, { steps: 4 });
      await page.mouse.up();
      await harness.settle(300);
      const orphansAfter = await page.evaluate(() => document.querySelectorAll("[data-canvas-object-id]").length);
      report.ok(
        "G11.5 drag en canvas vacío crea un huérfano",
        orphansAfter === orphansBefore + 1,
        `huérfanos=${orphansAfter} (antes ${orphansBefore}) · punto=(${Math.round(emptyPt.x)},${Math.round(emptyPt.y)})`,
      );
    }

    // ── G11.6: drag que EMPIEZA sobre el LABEL del frame ──
    // El label (data-frame-label-id) es light-DOM con pointer-events:auto y sin
    // guard de herramienta: con Rectángulo activo, el mousedown arrastra el
    // FRAME en vez de dibujar (repro R5 "el arrastre no crea nada" + corrimiento
    // accidental del diseño). Esperado tras el fix: el label es click-through
    // para herramientas de dibujo → el drag crea un huérfano y el frame NO se mueve.
    await pressR(page);
    const labelProbe = await page.evaluate(fid => {
      const label = document.querySelector(`[data-frame-label-id="${fid}"]`);
      if (!label) return null;
      const r = label.getBoundingClientRect();
      const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
      return {
        center: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
        frameLeft: parseFloat(wrapper.style.left) || 0,
        frameTop: parseFloat(wrapper.style.top) || 0,
      };
    }, fx.frameId);
    const orphansBeforeLabel = await page.evaluate(() => document.querySelectorAll("[data-canvas-object-id]").length);
    if (!labelProbe) {
      report.ok("G11.6 drag desde el label del frame dibuja (no mueve el frame)", false, "label del frame no encontrado");
    } else {
      const c = labelProbe.center;
      await page.mouse.move(c.x, c.y);
      await page.mouse.down();
      await page.mouse.move(c.x + 45, c.y + 35, { steps: 4 });
      await page.mouse.move(c.x + 90, c.y + 70, { steps: 4 });
      await page.mouse.up();
      await harness.settle(300);
      const afterLabel = await page.evaluate(fid => {
        const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
        return {
          orphans: document.querySelectorAll("[data-canvas-object-id]").length,
          frameLeft: parseFloat(wrapper.style.left) || 0,
          frameTop: parseFloat(wrapper.style.top) || 0,
        };
      }, fx.frameId);
      const created = afterLabel.orphans === orphansBeforeLabel + 1;
      const frameUnmoved = afterLabel.frameLeft === labelProbe.frameLeft && afterLabel.frameTop === labelProbe.frameTop;
      report.ok(
        "G11.6 drag desde el label del frame dibuja (no mueve el frame)",
        created && frameUnmoved,
        `huérfanos=${afterLabel.orphans} (antes ${orphansBeforeLabel}) · frame (${labelProbe.frameLeft},${labelProbe.frameTop})→(${afterLabel.frameLeft},${afterLabel.frameTop}) · inicio=(${Math.round(c.x)},${Math.round(c.y)})`,
      );
      // El huérfano NO entra a newIds: G11.4 busca data-layer-id en el html
      // del frame; los huérfanos persisten como canvas_objects, no como capas.
    }

    // ── G11.4: lo creado por drag persiste vía autosave (PUT + DB) ──
    let persisted = false;
    let detail = "sin capas nuevas que buscar";
    if (newIds.length > 0) {
      for (let i = 0; i < 10 && !persisted; i++) {
        await sleep(1000);
        try {
          const design = await fetchTemplateRow(fx.templateId);
          const frame = (design?.frames || []).find(f => f.id === fx.frameId);
          const html = frame?.html || "";
          persisted = newIds.every(id => html.includes(`data-layer-id="${id}"`));
          detail = `html contiene ${newIds.length}/${newIds.length} capas nuevas`;
        } catch (err) {
          detail = `fetchTemplateRow: ${err.message}`;
        }
      }
    }
    report.ok(
      "G11.4 las capas creadas por arrastre persisten (autosave)",
      persisted,
      persisted ? detail : `${detail} — patrón del bug reportado (no se crea nada)`,
    );

    return report;
  } finally {
    if (harness.page) await clearInjectedSession(harness.page);
    await fx.cleanup();
  }
}
