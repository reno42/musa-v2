/**
 * Ítem 10 VISUAL PASS —
 *  (a) click derecho sobre una capa → ¿menú contextual? (afirmación: no hay)
 *  (b) drag en área vacía dentro de un frame en modo select → ¿rubber-band/marquee?
 *      (afirmación: no hay)
 *  (c) texto en edición/selección → ¿mini-barra flotante de formato?
 *      (afirmación: no hay — pero DesignFrame.tsx:654-794 sugiere que SÍ existe)
 *  (e) pen tool: dibujar con clicks → ¿solo segmentos rectos? + drag-point → ¿bezier?
 *  (f) panel contextual → ¿controles de gradiente? (afirmación: no hay — pero
 *      HtmlContextualPanel.tsx:612 sugiere GradientBuilder)
 * (d) está cubierto en test-01 (item10d-*.png).
 */
import {
  createVerifyTemplate, deleteTemplate,
  shot, record, log, sleep, undoButtons,
} from "./lib.mjs";

const HTML = [
  '<div data-layer-id="rect" data-layer-name="Rect" style="position:absolute;left:80px;top:80px;width:280px;height:200px;background:#3B82F6;border-radius:12px;"></div>',
  '<div data-layer-id="title" data-layer-name="Title" data-layer-kind="text" style="position:absolute;left:80px;top:340px;width:500px;height:80px;color:#EDE8DC;">',
  '  <h1 style="margin:0;font-family:sans-serif;font-size:48px;">Titular visible</h1>',
  "</div>",
].join("\n");

function overlayState(fid) {
  const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
  if (!wrapper) return null;
  const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
  if (!host) return null;
  const overlay = host.shadowRoot.getElementById("__df_overlay");
  const kids = [...overlay.children].map(c => ({
    tag: c.tagName.toLowerCase(),
    id: c.id || null,
    z: c.style?.zIndex || null,
    hasButtons: c.querySelectorAll("button").length,
    border: c.style?.border || null,
  }));
  return { count: overlay.children.length, kids };
}

export async function run(harness) {
  const { templateId, frameId } = await createVerifyTemplate("visual", { html: HTML });
  const page = harness.page;
  try {
    await harness.open(templateId, frameId);
    await harness.settle(200);

    // ── (a) click derecho sobre la capa ──
    const bodyKidsBefore = await page.evaluate(() => document.body.children.length);
    await page.evaluate((fid) => {
      const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
      const el = host.shadowRoot.getElementById("__df_content").querySelector('[data-layer-id="rect"]');
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      for (const type of ["mousedown", "mouseup", "contextmenu"]) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, button: 2, clientX: x, clientY: y }));
      }
    }, frameId);
    await harness.settle(300);
    const menuProbe = await page.evaluate(() => {
      const menus = [...document.querySelectorAll('[role="menu"], [role="contextmenu"], .context-menu, .contextmenu, [class*="context-menu"]')];
      const fixedPopups = [...document.querySelectorAll("body > div")].filter(d => {
        const cs = d.ownerDocument.defaultView.getComputedStyle(d);
        return (cs.position === "fixed" || cs.position === "absolute") && +cs.zIndex > 100 && d.innerText.trim().length > 0 && d.offsetParent !== null;
      }).length;
      return { menus: menus.length, fixedPopups, bodyKids: document.body.children.length };
    });
    await shot(page, "item10a-right-click");
    log(`[10a] menús tras click derecho: ${JSON.stringify(menuProbe)} (body children antes: ${bodyKidsBefore})`);
    const noMenu = menuProbe.menus === 0 && menuProbe.bodyKids <= bodyKidsBefore;
    record("10a CONTEXT-MENU", noMenu ? "VERIFICADO" : "REFUTADO",
      noMenu
        ? `click derecho (mousedown/mouseup/contextmenu button=2) sobre la capa: 0 menús (role=menu/.context-menu), 0 popups nuevos, body children ${bodyKidsBefore}→${menuProbe.bodyKids}. Ausencia confirmada. Screenshot item10a-right-click.png.`
        : `apareció algo: ${JSON.stringify(menuProbe)}`);

    // ── (b) drag en área vacía dentro del frame (modo select) ──
    await page.evaluate((fid) => {
      const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
      const content = host.shadowRoot.getElementById("__df_content");
      const r = content.getBoundingClientRect();
      const zoom = host.getBoundingClientRect().width / (host.offsetWidth || 1);
      const sx = r.left + 700 * zoom, sy = r.top + 700 * zoom;
      content.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: sx, clientY: sy }));
      for (let i = 1; i <= 6; i++) {
        document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, composed: true, view: window, buttons: 1, clientX: sx + i * 25, clientY: sy + i * 18 }));
      }
      window.__qaMarqueeEnd = { x: sx + 150, y: sy + 108 };
    }, frameId);
    await sleep(250);
    await shot(page, "item10b-empty-drag-mid"); // screenshot CON el botón aún pulsado
    const marqueeProbe = await page.evaluate((fid) => {
      const ov = overlayStateLite(fid);
      const light = [...document.querySelectorAll("[class*='marquee'], [id*='marquee'], [class*='rubber']")].length;
      const dashed = [...document.querySelectorAll("body div")].filter(d => /dashed/.test(d.style?.border || "")).length;
      return { overlay: ov, lightMarquee: light, dashedDivs: dashed };
      function overlayStateLite(frameId) {
        const wrapper = document.querySelector(`[data-frame-id="${frameId}"]`);
        const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
        const overlay = host.shadowRoot.getElementById("__df_overlay");
        return { count: overlay.children.length, dashedInOverlay: [...overlay.querySelectorAll("div")].filter(d => /dashed/.test(d.style?.border || "")).length };
      }
    }, frameId);
    await page.evaluate(() => {
      const e = window.__qaMarqueeEnd || { x: 100, y: 100 };
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: e.x, clientY: e.y }));
    });
    await harness.settle(200);
    log(`[10b] marquee tras drag en vacío: ${JSON.stringify(marqueeProbe)}`);
    const noMarquee = marqueeProbe.lightMarquee === 0 && marqueeProbe.dashedDivs === 0 && marqueeProbe.overlay.dashedInOverlay === 0;
    record("10b MARQUEE", noMarquee ? "VERIFICADO" : "REFUTADO",
      noMarquee
        ? `drag de 150×108px en área vacía del frame (modo select): overlay children=${marqueeProbe.overlay.count}, divs dashed en overlay=${marqueeProbe.overlay.dashedInOverlay}, marquees en light DOM=${marqueeProbe.lightMarquee}, divs dashed en body=${marqueeProbe.dashedDivs}. Sin rubber-band. Screenshot item10b-empty-drag-mid.png (botón aún pulsado).`
        : `se detectó marquee: ${JSON.stringify(marqueeProbe)}`);

    // ── (c) mini-barra de formato en texto ──
    await harness.clickChild(frameId, '[data-layer-id="title"] h1');
    await harness.settle(300);
    const ov = await page.evaluate(overlayState, frameId);
    const miniBar = ov?.kids.find(k => k.hasButtons > 0 || k.z === "10001");
    await shot(page, "item10c-text-selected");
    log(`[10c] overlay tras seleccionar texto: ${JSON.stringify(ov)}`);
    record("10c TEXT-MINIBAR", miniBar ? "REFUTADO" : "VERIFICADO",
      miniBar
        ? `SÍ hay mini-barra flotante de formato: nodo en overlay con ${miniBar.hasButtons} botones (zIndex ${miniBar.z}). Se muestra al seleccionar texto. Screenshot item10c-text-selected.png.`
        : `no se encontró mini-barra en el overlay (${JSON.stringify(ov)})`,
      "DesignFrame.tsx:654-794 — Sprint 3.5: barra con fuente, tamaño, bold, tracking, line-height y swatches.");

    // ── (f) controles de gradiente en el panel contextual ──
    await harness.clickLayer(frameId, "rect");
    await harness.settle(300);
    // expandir la sección Fill si el texto Gradient no está visible
    const gradProbe1 = await page.evaluate(() => {
      const panel = document.querySelector(".html-contextual-panel");
      if (!panel) return { panel: false };
      const txt = panel.innerText;
      return { panel: true, hasGradient: /gradient/i.test(txt), hasApply: /apply gradient/i.test(txt) };
    });
    if (gradProbe1.panel && !gradProbe1.hasGradient) {
      await page.evaluate(() => {
        const panel = document.querySelector(".html-contextual-panel");
        const head = [...panel.querySelectorAll("div,button,span")].find(el => /fill/i.test(el.textContent || "") && el.children.length <= 3);
        if (head) head.click();
      });
      await sleep(300);
    }
    const gradProbe = await page.evaluate(() => {
      const panel = document.querySelector(".html-contextual-panel");
      if (!panel) return { panel: false };
      const txt = panel.innerText;
      return {
        panel: true,
        hasGradient: /gradient/i.test(txt),
        hasApply: /apply gradient/i.test(txt),
        snippet: (txt.match(/.{0,40}gradient.{0,60}/is) || [null])[0],
      };
    });
    await shot(page, "item10f-contextual-panel");
    log(`[10f] panel contextual: ${JSON.stringify(gradProbe)}`);
    record("10f GRADIENT-CONTROLS", gradProbe.hasGradient ? "REFUTADO" : "VERIFICADO",
      gradProbe.hasGradient
        ? `SÍ hay controles de gradiente en el panel contextual (Fill): ${JSON.stringify(gradProbe.snippet?.replace(/\s+/g, " "))} · botón Apply=${gradProbe.hasApply}. Screenshot item10f-contextual-panel.png.`
        : `no se encontraron controles de gradiente: ${JSON.stringify(gradProbe)}`,
      "HtmlContextualPanel.tsx:612-617,954-1072 — GradientBuilder con linear/radial/conic, ángulo y stops.");

    // ── (e) pen tool ──
    // Fase 1: clicks rectos (3 puntos + cierre cerca del primero)
    await harness.qa("key", "keydown", "p", {});
    await sleep(200);
    const penResult1 = await page.evaluate(async (fid) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
      const content = host.shadowRoot.getElementById("__df_content");
      const r = content.getBoundingClientRect();
      const zoom = host.getBoundingClientRect().width / (host.offsetWidth || 1);
      const fire = (target, type, cx, cy, extra = {}) =>
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: cx, clientY: cy, ...extra }));
      const clickAt = async (ux, uy) => {
        const x = r.left + ux * zoom, y = r.top + uy * zoom;
        fire(content, "mousedown", x, y);
        await sleep(30);
        fire(document, "mouseup", x, y);
        await sleep(60);
      };
      await clickAt(300, 600);
      await clickAt(520, 620);
      await clickAt(410, 780);
      await clickAt(302, 602); // cierre: <12px del primer punto
      return true;
    }, frameId);
    await harness.settle(500);
    await shot(page, "item10e-pen-straight");
    const dStraight = await page.evaluate((fid) => {
      const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
      const paths = [...host.shadowRoot.getElementById("__df_content").querySelectorAll('svg[data-layer-kind="bezier"] path')];
      return paths.map(p => p.getAttribute("d"));
    }, frameId);
    log(`[10e] path tras clicks rectos: ${JSON.stringify(dStraight)}`);

    // Fase 2: un punto con DRAG (debería crear bezier según el tooltip del toolbar)
    await harness.qa("key", "keydown", "p", {});
    await sleep(200);
    await page.evaluate(async (fid) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
      const content = host.shadowRoot.getElementById("__df_content");
      const r = content.getBoundingClientRect();
      const zoom = host.getBoundingClientRect().width / (host.offsetWidth || 1);
      const fire = (target, type, cx, cy, extra = {}) =>
        target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: cx, clientY: cy, ...extra }));
      const clickAt = async (ux, uy) => {
        const x = r.left + ux * zoom, y = r.top + uy * zoom;
        fire(content, "mousedown", x, y); await sleep(30); fire(document, "mouseup", x, y); await sleep(60);
      };
      // punto 1 (click simple)
      await clickAt(620, 600);
      // punto 2 con DRAG: mousedown, mover con botón, soltar lejos → smooth point
      {
        const x = r.left + 800 * zoom, y = r.top + 640 * zoom;
        fire(content, "mousedown", x, y);
        await sleep(30);
        for (let i = 1; i <= 6; i++) fire(document, "mousemove", x + i * 12 * zoom, y - i * 8 * zoom, { buttons: 1 });
        await sleep(30);
        fire(document, "mouseup", x + 72 * zoom, y - 48 * zoom);
        await sleep(80);
      }
      // punto 3 (click simple)
      await clickAt(700, 820);
      // cierre cerca del punto 1
      await clickAt(622, 602);
      return true;
    }, frameId);
    await harness.settle(500);
    await shot(page, "item10e-pen-bezier");
    const dAll = await page.evaluate((fid) => {
      const wrapper = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...wrapper.querySelectorAll("div")].find(el => el.shadowRoot && el.shadowRoot.getElementById("__df_content"));
      const paths = [...host.shadowRoot.getElementById("__df_content").querySelectorAll('svg[data-layer-kind="bezier"] path')];
      return paths.map(p => p.getAttribute("d"));
    }, frameId);
    log(`[10e] paths totales: ${JSON.stringify(dAll)}`);

    // ── (d) crop nítido de los botones Undo/Redo grises (tras ediciones válidas: 2 paths pen) ──
    const ub = await page.evaluate(undoButtons);
    log(`[10d] botones undo/redo tras edits pen: ${JSON.stringify(ub)}`);
    if (ub.undo?.rect) {
      const r = ub.undo.rect;
      await shot(page, "item10d-undo-grey-crop", {
        x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 70), width: 220, height: 160,
      });
    }

    const dBezier = dAll.find(d => d && !dStraight.includes(d)) || null;
    const straightOnlyClick = dStraight.length > 0 && dStraight.every(d => !/[CQSTcqst]/.test(d));
    const bezierProduced = !!dBezier && /[CQcq]/.test(dBezier);
    record("10e PEN-TOOL", bezierProduced ? "REFUTADO" : "VERIFICADO",
      `clicks rectos → path ${JSON.stringify(dStraight[0] || null)} (${straightOnlyClick ? "solo M/L/Z, recto" : "con curvas"}). ` +
      `punto con drag → path ${JSON.stringify(dBezier)} → ${bezierProduced ? "CONTIENE curvas cúbicas (C): el pen SÍ produce bezier arrastrando" : "sin curvas: solo segmentos rectos"}. Screenshots item10e-*.png.`,
      "FloatingToolbar.tsx:51 — tooltip propio del editor: 'Pen — click to add points, drag for bezier'; DesignFrame.tsx:1368-1397 createSmoothPoint.");

    return { penResult1 };
  } finally {
    await deleteTemplate(templateId);
  }
}
