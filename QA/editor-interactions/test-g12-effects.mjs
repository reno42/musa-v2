/**
 * G12 — "Los efectos no mostraban resultado y no explicaban a qué se
 * aplicaban" (B-05 / gap-analysis G12).
 *
 * Pre-fix reality (V3.6 inspector + Biblioteca V5):
 *   • applyLayerEffect sobre una capa SIN clip era un no-op silencioso — y la
 *     Biblioteca V5 toasteaba "Efecto aplicado" igual (éxito mentiroso).
 *   • Un frame SIN animación: seleccionás una capa en el escenario y el
 *     inspector quedaba mudo (el editor de objeto ni renderizaba).
 *   • La grilla Efectos (V3.6) solo existía si la capa YA tenía clip, y no
 *     declaraba el destino.
 *
 * Fix under test (espejo de set_layer_effect del MCP):
 *   G12.1  ?view=video abre el modo con la toma del fixture en el escenario.
 *   G12.2  click en una capa sin animación/sin clip → panel visible con
 *          grilla de efectos y explicación accionable (nunca mudo).
 *   G12.3  aplicar "Shake" → toast honesto ("animación creada + clip de toda
 *          la toma") y carril visible en el track V del timeline.
 *   G12.4  el schema creado persiste vía autosave (timeline 5s + clip dot).
 *   G12.5  segunda capa (schema ya existe, capa sin clip) → nota "sin clip —
 *          al aplicar se crea uno de toda la toma" → aplicar "Glow" → carril.
 *   G12.6  capa CON clip → aplicar otro efecto REEMPLAZA las props del efecto
 *          en su clip (merge, sin duplicar clips ni perder las demás props).
 *
 * Fixture: lib/seed.mjs (service-key seeding + JWT injection) — frame con
 * capas card/pill/dot y SIN animación (el peor caso del bug).
 */
import { setTimeout as sleep } from "node:timers/promises";
import { makeReport } from "./lib/assert.mjs";
import { seedEditorFixture, injectSession, clearInjectedSession, fetchTemplateRow } from "./lib/seed.mjs";
import { VITE_URL } from "./lib/servers.mjs";

/** Shadow-piercing search for a layer node inside the video stage (the take
 * plates are the reparented DesignFrame wrappers — layers live in their
 * shadow DOM, same as the animation engine binds them). */
async function findStageLayer(page, layerId) {
  return page.evaluate((lid) => {
    const stage = document.querySelector("[data-video-stage]");
    if (!stage) return null;
    const visit = (root) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.getAttribute && el.getAttribute("data-layer-id") === lid) return true;
        if (el.shadowRoot && visit(el.shadowRoot)) return true;
      }
      return false;
    };
    return visit(stage);
  }, layerId);
}

/** Click a layer node inside the stage (composed click bubbles out of the
 * shadow root to [data-video-stage], where onStageClick picks it). */
async function clickStageLayer(page, layerId) {
  const clicked = await page.evaluate((lid) => {
    const stage = document.querySelector("[data-video-stage]");
    if (!stage) return false;
    const visit = (root) => {
      for (const el of root.querySelectorAll("*")) {
        if (el.getAttribute && el.getAttribute("data-layer-id") === lid) return el;
        if (el.shadowRoot) { const hit = visit(el.shadowRoot); if (hit) return hit; }
      }
      return null;
    };
    const el = visit(stage);
    if (!el) return false;
    el.click();
    return true;
  }, layerId);
  await sleep(300);
  return clicked;
}

/** State of the inspector's layer-effects panel + its declared-target note. */
async function effectsPanel(page) {
  return page.evaluate(() => {
    const grid = document.querySelector("[data-video-layer-effects]");
    if (!grid) return { visible: false, note: "", buttons: 0 };
    const note = (grid.querySelector("span")?.textContent || "").trim();
    return { visible: true, note, buttons: grid.querySelectorAll("button").length };
  });
}

/** Click an effect button by exact label inside the effects grid. */
async function applyEffect(page, label) {
  return page.evaluate((lbl) => {
    const grid = document.querySelector("[data-video-layer-effects]");
    if (!grid) return false;
    const btn = [...grid.querySelectorAll("button")].find(b => (b.textContent || "").trim() === lbl);
    if (!btn) return false;
    btn.click();
    return true;
  }, label);
}

/** Poll for a toast substring (success toasts live 3s — check fast). */
async function toastSays(page, substring, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const found = await page.evaluate((s) => (document.body.textContent || "").includes(s), substring);
    if (found) return true;
    await sleep(200);
  }
  return false;
}

/** Timeline lane chip for a layer (title="layerId @ …") in the V track. */
async function hasLane(page, layerId) {
  return page.evaluate((lid) => !!document.querySelector(`[title^="${lid} @"]`), layerId);
}

export async function run(harness) {
  const report = makeReport("G12 · efectos de capa declaran destino o explican qué crean");
  const fx = await seedEditorFixture({ name: "QA — G12 efectos fantasma" });
  try {
    const page = harness.page;
    await injectSession(page, fx.session);
    await page.goto("about:blank", { waitUntil: "load", timeout: 15000 }).catch(() => {});
    await page.goto(`${VITE_URL}/?template=${fx.templateId}&v=2&view=video`, { waitUntil: "domcontentloaded", timeout: 45000 });

    // G12.1 — deep-link opens video mode with the fixture take on stage.
    let opened = false;
    for (let i = 0; i < 50 && !opened; i++) {
      opened = await page.evaluate(() =>
        !!document.querySelector("[data-video-stage]") && (document.body.textContent || "").includes("MODO VIDEO"));
      if (!opened) await sleep(400);
    }
    const dotOnStage = opened ? await findStageLayer(page, "dot") : false;
    report.ok(
      "G12.1 ?view=video abre el modo con la toma en el escenario",
      opened && dotOnStage,
      `overlay=${opened} capa dot visible=${dotOnStage}`,
    );
    if (!opened) return report;
    await sleep(400); // first paint — activeTakeRef needs a tick

    // G12.2 — clip-less layer, no animation: the panel must EXPLAIN, not stay
    // mute (pre-fix: whole Object editor returned null).
    await clickStageLayer(page, "dot");
    let panel = await effectsPanel(page);
    report.ok(
      "G12.2 capa sin animación → grilla de efectos visible + explicación",
      panel.visible && panel.buttons >= 12 && panel.note.includes("no tiene animación") && panel.note.includes("dot"),
      panel.visible
        ? `${panel.buttons} efectos · nota: «${panel.note.slice(0, 90)}…»`
        : "panel de efectos ausente (inspector mudo)",
    );
    if (!panel.visible) return report;

    // G12.3 — apply "Shake": honest toast (creation branch) + timeline lane.
    const applied = await applyEffect(page, "Shake");
    const honestToast = await toastSays(page, "animación creada");
    const lane = await hasLane(page, "dot");
    report.ok(
      "G12.3 Shake sobre capa sin clip → toast honesto + carril en el timeline",
      applied && honestToast && lane,
      `aplicado=${applied} toast "animación creada"=${honestToast} carril dot=${lane}`,
    );

    // G12.4 — the auto-created schema persists (autosave → DB).
    let persisted = null;
    let detail = "";
    for (let i = 0; i < 15 && !persisted; i++) {
      await sleep(1000);
      try {
        const design = await fetchTemplateRow(fx.templateId);
        const frame = (design?.frames || []).find(f => f.id === fx.frameId);
        const clip = (frame?.animation?.clips || []).find(c => c.layerId === "dot");
        const dur = frame?.animation?.timeline?.durationSec ?? 0;
        if (clip && (clip.tweens?.length || 0) > 0 && dur >= 4.9 && clip.startSec === 0 && clip.endSec >= 4.9) {
          persisted = { tweens: clip.tweens.length, dur };
        }
        detail = `clips=${(frame?.animation?.clips || []).length} dur=${dur}`;
      } catch (err) {
        detail = `fetchTemplateRow: ${err.message}`;
      }
    }
    report.ok(
      "G12.4 el schema creado persiste (timeline 5s + clip de toda la toma)",
      !!persisted,
      persisted ? `dot: ${persisted.tweens} tween(s) · timeline ${persisted.dur}s` : `no persistió (${detail})`,
    );

    // G12.5 — second layer: schema exists, layer has NO clip → the note must
    // say so, and applying must create the full-take clip (pre-fix: no-op).
    await clickStageLayer(page, "pill");
    panel = await effectsPanel(page);
    const pillNoteOk = panel.visible && panel.note.includes("sin clip");
    const glowOk = pillNoteOk ? await applyEffect(page, "Glow") : false;
    const pillLane = glowOk ? await hasLane(page, "pill") : false;
    report.ok(
      "G12.5 capa sin clip (con animación) → nota 'sin clip' + Glow crea carril",
      pillNoteOk && glowOk && pillLane,
      `nota ok=${pillNoteOk} glow aplicado=${glowOk} carril pill=${pillLane}`,
    );

    // G12.6 — layer WITH a clip: another effect REPLACES its props in the
    // same clip (merge semantics — no duplicate clips, other props survive).
    await clickStageLayer(page, "dot");
    panel = await effectsPanel(page);
    const replaceNoteOk = panel.visible && panel.note.includes("reemplazan");
    const glow2 = replaceNoteOk ? await applyEffect(page, "Glow") : false;
    let merged = null;
    let mergeDetail = "";
    if (glow2) {
      for (let i = 0; i < 15 && !merged; i++) {
        await sleep(1000);
        try {
          const design = await fetchTemplateRow(fx.templateId);
          const frame = (design?.frames || []).find(f => f.id === fx.frameId);
          const clips = (frame?.animation?.clips || []).filter(c => c.layerId === "dot");
          if (clips.length > 0) {
            const props = new Set(clips.flatMap(c => (c.tweens || []).map(t => String(t.prop))));
            // shake = transform, glow = filter → the merged clip keeps BOTH.
            merged = clips.length === 1 && props.has("transform") && props.has("filter") ? { props: [...props] } : null;
            mergeDetail = `dotClips=${clips.length} props=${[...props].join(",")}`;
            // keep polling only while nothing has arrived yet
            if (clips.length === 1 && !props.has("filter")) merged = null;
          }
        } catch (err) {
          mergeDetail = `fetchTemplateRow: ${err.message}`;
        }
      }
    }
    report.ok(
      "G12.6 capa con clip → otro efecto reemplaza sus props (merge, 1 clip)",
      !!merged,
      merged ? `dot: ${merged.props.join(" + ")}` : `merge no verificado (${replaceNoteOk ? "" : "nota mal, "}${mergeDetail || "sin datos"})`,
    );

    return report;
  } finally {
    // The injected session belongs to a user that cleanup() deletes — leaving
    // it would 401 every API call of later suites (GoTrue: user_not_found).
    if (harness.page) await clearInjectedSession(harness.page);
    await fx.cleanup();
  }
}
