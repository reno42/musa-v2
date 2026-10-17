/**
 * S4 — "Aplicar un preset de animación congela todo el editor (UI)."
 *
 * Bug report 17-sep-2026 (P1): click any entry preset in the Animation panel →
 * the preview starts → the whole tab freezes permanently (renderer at 100% CPU,
 * no console error, CDP evaluate never answers). Only via the UI: MCP
 * set_animation writes the schema without calling playFrame, so it never froze.
 *
 * Root cause: animationEngine.tick() set `rafId = 0` at entry, then
 * publishFrameTime → emit re-entered the engine's own playback subscription →
 * syncState(playing) saw `!rafId` and scheduled a SECOND rAF; tick's tail then
 * scheduled a third. Every tick doubled the chain (2^n callbacks) → tab death.
 * Secondary: an unbuffered MutationObserver rebuilt ALL WAAPI animations
 * synchronously per DOM mutation inside the frame content.
 *
 * Fix under test: tick() is the only scheduler (rafId stays truthy while the
 * callback runs); the observer coalesces rebuilds to one per rAF.
 *
 * G18 (oct-2026) guard folded in: "Play del canvas no reproduce" — applyPreset
 * defers playFrame one rAF (after the commit's update() tears `running` down at
 * paused-0), and syncState(playing) never rebound, so the clock ticked over
 * ZERO WAAPI animations. Fix under test: syncState self-heals (rebuilds when
 * running is empty and playing/seeking). S4.6 samples the layer's live style.
 *
 * Fixture: lib/seed.mjs (service-key seeding + JWT injection) — the MCP
 * fixture path 401s against apis that enforce MCP_ADMIN_KEY.
 *
 * Guards (GREEN — regression guard, like S2):
 *   S4.1  the page stays responsive (evaluate answers) while the preset preview runs.
 *   S4.2  the rAF rate stays at display rate during playback — never doubling.
 *   S4.3  a DOM mutation inside the frame DURING playback (the observer's path)
 *         neither storms the engine nor drops the running animations.
 *   S4.4  Stop (■) halts playback and the transport returns to "▶ Play".
 *   S4.5  the applied preset persists to the template via autosave.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { makeReport } from "./lib/assert.mjs";
import { seedEditorFixture, injectSession, clearInjectedSession, fetchTemplateRow } from "./lib/seed.mjs";

/** Puppeteer evaluate that reports "frozen" instead of hanging forever. */
async function responsive(page, ms = 2500) {
  let timer;
  const watchdog = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("frozen")), ms); });
  try {
    await Promise.race([page.evaluate(() => 1 + 1), watchdog]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function run(harness) {
  const report = makeReport("S4 · preset de animación no congela el editor");
  const fx = await seedEditorFixture();
  try {
    const page = harness.page;
    await injectSession(page, fx.session);
    await harness.open(fx.templateId, fx.frameId);

    // Select the "pill" layer → contextual panel opens on Properties.
    await harness.clickLayer(fx.frameId, "pill");
    const selected = await harness.selectedLayerId(fx.frameId);
    report.ok(
      "S4.0 la capa queda seleccionada",
      selected === "pill",
      `selectedLayerId=${selected}`,
    );

    // Switch the contextual panel to the Animation tab (button text is the
    // raw tab id: "properties" | "code" | "animation"). Retry: selection may
    // need a beat to mount the right-panel tab strip; if the panel is still
    // closed, poke the "Props" topbar button first.
    let animTab = false;
    for (let i = 0; i < 6 && !animTab; i++) {
      animTab = await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find(b => b.textContent.trim() === "animation");
        if (!btn) {
          document.querySelector("button[title='Propiedades de lo seleccionado']")?.click();
          return false;
        }
        btn.click();
        return true;
      });
      if (!animTab) await sleep(400);
    }
    await harness.settle();
    // Preset cards carry `title="${label} — ${about}"` (P2.6); anchor on the
    // library's search input — the old `button[title^='Aplicar']` finds 0.
    const presetButtons = await page.evaluate(() => {
      const input = document.querySelector("input[placeholder^='Buscar preset']");
      if (!input) return 0;
      return [...input.parentElement.querySelectorAll("button")]
        .filter(b => / — /.test(b.getAttribute("title") || "")).length;
    });
    report.ok(
      "S4.0b el panel Animation muestra presets",
      animTab && presetButtons > 0,
      `tab=${animTab} presets=${presetButtons}`,
    );
    if (!animTab || presetButtons === 0) return report;

    // Instrument the rAF rate BEFORE playing. If the double-scheduling bug
    // returns, this counter explodes (2^n callbacks) and evaluate stops answering.
    await page.evaluate(() => {
      window.__s4 = { frames: 0 };
      const loop = () => { window.__s4.frames++; requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    });

    // ── Apply the first preset ("Fade in") — the exact repro of the bug report.
    await page.evaluate(() => {
      const input = document.querySelector("input[placeholder^='Buscar preset']");
      const btn = [...(input?.parentElement?.querySelectorAll("button") || [])]
        .find(b => / — /.test(b.getAttribute("title") || ""));
      btn?.click();
    });
    await sleep(250);
    const f1 = await page.evaluate(() => window.__s4.frames);
    const aliveWhilePlaying = await responsive(page);

    // S4.3 — mutate the observed subtree WHILE playing (observer path): append
    // a throwaway node inside the preview window. The "Fade in" preset's clip
    // spans [0, 1.2s] and the normalized "once" timeline auto-stops right
    // after, so this MUST run before ~1.2s or there is nothing playing to test.
    await page.evaluate((fid) => {
      const dom = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...dom.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
      const content = host.shadowRoot.getElementById("__df_content");
      const temp = document.createElement("div");
      temp.setAttribute("data-layer-id", "qa-s4-temp");
      temp.style.cssText = "position:absolute;left:12px;top:12px;width:24px;height:24px;background:#fff;border-radius:4px;";
      content.appendChild(temp);
    }, fx.frameId);
    await sleep(450);
    const afterMutation = await responsive(page);
    const mutDiag = await page.evaluate((fid) => {
      const dom = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...dom.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
      const content = host.shadowRoot.getElementById("__df_content");
      const pill = content.querySelector("[data-layer-id='pill']");
      return {
        // subtree: true — Element.getAnimations() without it only returns
        // animations ON the content element; the engine binds tweens to the
        // layers inside it.
        anims: content.getAnimations({ subtree: true }).length,
        tempSurvived: !!content.querySelector("[data-layer-id='qa-s4-temp']"),
        stillPlaying: [...document.querySelectorAll("button")].some(b => b.textContent.includes("Pausa")),
        // G18: mid-Fade-in (clip [0, 1.2s]) the pill's live opacity must be
        // in transit — frozen "1" means the clock ticks over nothing.
        pillOpacity: pill ? Number(getComputedStyle(pill).opacity) : null,
      };
    }, fx.frameId);
    // Cleanup the throwaway node (its removal is itself another coalesced rebuild).
    await page.evaluate((fid) => {
      const dom = document.querySelector(`[data-frame-id="${fid}"]`);
      const host = [...dom.querySelectorAll("div")].find(el => el.shadowRoot?.getElementById("__df_content"));
      host.shadowRoot.getElementById("__df_content").querySelector("[data-layer-id='qa-s4-temp']")?.remove();
    }, fx.frameId);
    report.ok(
      "S4.3 mutación DOM durante playback no derriba el motor",
      afterMutation && mutDiag.anims > 0,
      `alive=${afterMutation} animaciones=${mutDiag.anims} playing=${mutDiag.stillPlaying} temp=${mutDiag.tempSurvived}`,
    );
    report.ok(
      "S4.6 Play anima la capa de verdad (G18: reloj sin animaciones)",
      mutDiag.pillOpacity !== null && mutDiag.pillOpacity > 0 && mutDiag.pillOpacity < 1,
      `opacidad pill en pleno Fade-in=${mutDiag.pillOpacity} (esperada en (0,1); pre-fix: congelada en 1)`,
    );

    await sleep(450);
    const f2 = await page.evaluate(() => window.__s4.frames);
    const aliveLater = await responsive(page);

    // S4.1 — the page must answer DURING playback (pre-fix: frozen tab).
    report.ok(
      "S4.1 la página responde mientras la preview corre",
      aliveWhilePlaying && aliveLater,
      `alive@0.25s=${aliveWhilePlaying} alive@1.3s=${aliveLater}`,
    );

    // S4.2 — rAF rate over the ~1s window must be display-rate, not exponential.
    const ratePerSec = (f2 - f1) / 1.0;
    report.ok(
      "S4.2 el reloj rAF no se multiplica (tasa normal)",
      ratePerSec >= 5 && ratePerSec <= 240,
      `~${Math.round(ratePerSec)} rAF/s en 1s de playback (pre-fix: miles o página muerta)`,
    );

    // S4.4 — Stop (■) must halt playback and reset the transport.
    await page.evaluate(() => {
      const stop = document.querySelector("button[title='Stop y rebobinar']");
      stop.click();
    });
    await harness.settle();
    const backToPlay = await page.evaluate(() => {
      const play = [...document.querySelectorAll("button")].find(b => b.textContent.includes("▶ Play"));
      return !!play;
    });
    const aliveAfterStop = await responsive(page);
    report.ok(
      "S4.4 Stop detiene la preview y la UI sigue viva",
      backToPlay && aliveAfterStop,
      `transporte=${backToPlay ? "▶ Play" : "no reseteado"} alive=${aliveAfterStop}`,
    );

    // S4.5 — the preset persists through autosave (poll: debounce + PUT + echo).
    let persisted = false;
    let detail = "";
    for (let i = 0; i < 12 && !persisted; i++) {
      await sleep(1000);
      try {
        const design = await fetchTemplateRow(fx.templateId);
        const frame = (design?.frames || []).find(f => f.id === fx.frameId);
        const clips = frame?.animation?.clips || [];
        persisted = clips.some(c => c.layerId === "pill" && (c.tweens?.length || 0) > 0);
        detail = `clips=${clips.length}`;
      } catch (err) {
        detail = `fetchTemplateRow: ${err.message}`;
      }
    }
    report.ok(
      "S4.5 el preset aplicado persiste (autosave)",
      persisted,
      persisted ? `frame.animation con clip en pill (${detail})` : `no persistió tras 12s (${detail})`,
    );

    return report;
  } finally {
    // The injected session belongs to a user that cleanup() deletes — leaving
    // it in localStorage would 401 every API call of later suites (GoTrue:
    // user_not_found). Neutral state → their login-wall flow signs in again.
    if (harness.page) await clearInjectedSession(harness.page);
    await fx.cleanup();
  }
}
