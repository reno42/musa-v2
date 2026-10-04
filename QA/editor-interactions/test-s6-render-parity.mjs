/**
 * S6 — REQ-035 RF-04: paridad player/export (Fase 1.2, "Sampler compartido").
 *
 * What we prove: for the SAME persisted template, the live player stage and
 * the export pipeline render matching rasters. The export side runs through
 * renderReelFrameAt (videoExport.ts) — the EXACT drawAt closure the encoders
 * drive — so any drift between the two render routes (DOM/CSS vs canvas) is
 * caught, per RF-04's checklist:
 *
 *   S6.1  toma 1 + capas animadas (keyframes) + media overlay (imagen)
 *   S6.2  texto (captions.ts) sobre la toma
 *   S6.3  transición fade a mitad del slot
 *   S6.4  toma 2 + per-take look filter (grayscale)
 *
 * Method: seek the player through the REAL ruler scrub (pointer click at the
 * proportional x), screenshot the stage box, render the same tSec through
 * renderReelFrameAt in-page, and block-diff (32px blocks, 2px subsample)
 * both rasters downscaled to a common size. Thresholds tolerate DOM-vs-
 * foreignObject antialiasing and JPEG-free PNG noise; they catch REAL drift
 * (lost sampler, divergent transition math, dropped filter).
 */
import { makeReport } from "./lib/assert.mjs";
import { createParityReelTemplate, deleteTemplate, getTemplate } from "./lib/mcp.mjs";
import { VITE_URL } from "./lib/servers.mjs";

/** Tolerances calibrated on the first green run: DOM text antialiasing and
 *  downscale resampling contribute a small constant; real drift (missing
 *  filter, wrong transition pose) blows past these by an order of magnitude. */
const MEAN_MAX = 12;  // mean abs diff (0..255) over the whole raster
const WORST_MAX = 48; // mean abs diff of the worst 32px block
const SEEK_TOL = 0.06; // landed playhead vs target (≈2 frames @30fps)

export async function run(harness) {
  const report = makeReport("S6 · RF-04 paridad player/export");
  const { templateId } = await createParityReelTemplate({ mediaUrl: `${VITE_URL}/og-agents.png` });
  try {
    await harness.open(templateId, "frame_qa_par_a");

    // Open video mode — same one-click path S5 guards (RF-01).
    await harness.page.evaluate(() => {
      const btn = [...document.querySelectorAll("button.editor-v2-topbar-icon-btn")]
        .find(b => (b.textContent || "").trim().includes("Video"));
      if (!btn) throw new Error("botón Video no encontrado en la top bar");
      btn.click();
    });
    await harness.settle(400);

    // The template row is the ONE source both sides consume.
    const tplRow = await getTemplate(templateId);
    if (!tplRow?.frames?.length) throw new Error("template fixture sin frames");

    /** Seek via the timeline ruler (real UI path) and return the landed time
     *  from the transport readout. Clicks at rect.left + t·pps — exact linear
     *  mapping (xToSec); scrolls the track into view when the ruler overflows. */
    const seekPlayer = async (t, total) => {
      let landed = null;
      for (let pass = 0; pass < 2 && landed === null; pass++) {
        const rect = await harness.page.evaluate(() => {
          const el = document.querySelector("[data-video-ruler]");
          if (!el) throw new Error("ruler no encontrado (data-video-ruler)");
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, width: r.width, height: r.height };
        });
        const pps = rect.width / total;
        let x = rect.left + t * pps;
        if (x < 8 || x > 1592) {
          // Overflow: nudge the scrollable ancestor so the target is on-screen.
          await harness.page.evaluate((t, total, want) => {
            const ruler = document.querySelector("[data-video-ruler]");
            const scroller = ruler.parentElement;
            let node = ruler;
            while (node && node.scrollWidth <= node.clientWidth) node = node.parentElement;
            if (node) node.scrollLeft += want;
          }, t, total, x < 8 ? x - 40 : x - 1560);
          await harness.settle(120);
          continue;
        }
        await harness.page.mouse.click(x, rect.top + rect.height / 2);
        await harness.settle(250);
        landed = await harness.page.evaluate(() => {
          // The transport readout is the monospace "X.XXs / Y.YYs" span.
          const hits = [...document.querySelectorAll("span")]
            .filter(s => /^\s*[\d.]+s \/ [\d.]+s\s*$/.test(s.textContent || ""))
            .filter(s => getComputedStyle(s).fontFamily.includes("monospace"));
          const hit = hits[0] || null;
          return hit ? parseFloat(hit.textContent.split("/")[0]) : null;
        });
      }
      return landed;
    };

    /** Export-side raster of the same instant through the REAL pipeline. */
    const exportAt = (tplRow, t) => harness.page.evaluate(async (row, tSec) => {
      const ve = await import("/src/lib/videoExport.ts");
      const vtd = await import("/src/lib/videoTimelineDoc.ts");
      const doc = vtd.normalizeVideoTimelineDoc(row.videoTimeline);
      const frames = (row.frames || []).map(f => ({
        id: f.id, html: f.html, css: f.css, width: f.width, height: f.height,
        background: f.background, animation: f.animation ?? null,
        filter: f.reelFilter || undefined, layout: f.reelLayout ?? null,
      }));
      const project = vtd.resolveProject(doc, frames);
      const mediaClips = doc.mediaClips.map(mc => ({
        kind: mc.kind, url: mc.url, startSec: mc.startSec, durationSec: mc.durationSec,
        trimInSec: mc.trimInSec, sourceDurationSec: mc.sourceDurationSec,
        volume: mc.volume, filter: mc.filter,
      }));
      const canvas = await ve.renderReelFrameAt({
        frames,
        project: { width: project.width, height: project.height, bg: project.bg },
        mediaClips: mediaClips.length ? mediaClips : undefined,
        texts: doc.textClips.length ? doc.textClips : undefined,
      }, tSec);
      return canvas.toDataURL("image/png");
    }, tplRow, t);

    /** Block diff of the two rasters, downscaled to a common size in-page. */
    const diffRasters = (aUrl, bUrl) => harness.page.evaluate(async (aUrl, bUrl) => {
      const load = url => new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error("raster no cargable"));
        im.src = url;
      });
      const [A, B] = await Promise.all([load(aUrl), load(bUrl)]);
      const W = Math.min(A.naturalWidth, B.naturalWidth);
      const H = Math.min(A.naturalHeight, B.naturalHeight);
      const grab = im => {
        const c = document.createElement("canvas");
        c.width = W; c.height = H;
        const x = c.getContext("2d", { willReadFrequently: true });
        x.imageSmoothingEnabled = true;
        x.imageSmoothingQuality = "high";
        x.drawImage(im, 0, 0, W, H);
        return x.getImageData(0, 0, W, H).data;
      };
      const da = grab(A), db = grab(B);
      let wsum = 0, wn = 0, worst = 0;
      const block = 32;
      for (let by = 0; by < H; by += block) {
        for (let bx = 0; bx < W; bx += block) {
          const ye = Math.min(by + block, H), xe = Math.min(bx + block, W);
          let bs = 0, bn = 0;
          for (let y = by; y < ye; y += 2) {
            for (let x = bx; x < xe; x += 2) {
              const i = (y * W + x) * 4;
              const d = (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2])) / 3;
              bs += d; bn++;
            }
          }
          const bm = bs / Math.max(1, bn);
          wsum += bs; wn += bn;
          if (bm > worst) worst = bm;
        }
      }
      return { mean: wsum / Math.max(1, wn), worst, w: W, h: H };
    }, aUrl, bUrl);

    // Checkpoints derive from the SAME buildReelTimeline the player uses —
    // computed in-page so an off-by-one in durations fails loudly here.
    const times = await harness.page.evaluate(async (row) => {
      const sp = await import("/src/lib/sequencePlayback.ts");
      const tl = sp.buildReelTimeline((row.frames || []).map(f => ({ id: f.id, animation: f.animation ?? null })));
      const slot = tl.slots[0];
      return {
        total: tl.totalDurationSec,
        take1: 0.9,                                  // S6.1 media+capas (media [0.5,2.5))
        texto: 2.2,                                  // S6.2 texto [1.0,2.6)
        transicion: slot ? slot.startSec + (slot.endSec - slot.startSec) / 2 : 3.4,
        take2: (tl.segments[1]?.startSec ?? 3.8) + 1.2, // S6.4 filtro de toma
      };
    }, tplRow);

    const checkpoints = [
      ["S6.1 toma 1: capas animadas + media overlay", times.take1],
      ["S6.2 texto (captions) sobre la toma", times.texto],
      ["S6.3 transición fade a mitad del slot", times.transicion],
      ["S6.4 toma 2 + per-take look filter", times.take2],
    ];

    for (const [name, t] of checkpoints) {
      const landed = await seekPlayer(t, times.total);
      report.ok(`${name}: seek determinista`, landed !== null && Math.abs(landed - t) <= SEEK_TOL,
        landed === null ? "transport sin lectura de tiempo" : `t=${t.toFixed(2)} landed=${landed?.toFixed(2)}`);

      const stage = await harness.page.$("[data-video-stage]");
      if (!stage) { report.ok(`${name}: stage`, false, "data-video-stage no encontrado"); continue; }
      // Hide stage-AREA siblings (floating context chip, banners) — they sit
      // ON TOP of the stage box and are player UI, not render output.
      await harness.page.evaluate(() => {
        const st = document.querySelector("[data-video-stage]");
        for (const el of st?.parentElement?.children || []) {
          if (el !== st) { el.dataset.qaPrevDisplay = el.style.display || ""; el.style.display = "none"; }
        }
      });
      const shot = await stage.screenshot({ encoding: "base64" });
      await harness.page.evaluate(() => {
        const st = document.querySelector("[data-video-stage]");
        for (const el of st?.parentElement?.children || []) {
          if (el.dataset.qaPrevDisplay !== undefined) {
            el.style.display = el.dataset.qaPrevDisplay;
            delete el.dataset.qaPrevDisplay;
          }
        }
      });
      const exportUrl = await exportAt(tplRow, t);
      const d = await diffRasters(`data:image/png;base64,${shot}`, exportUrl);
      const ok = d.mean <= MEAN_MAX && d.worst <= WORST_MAX;
      report.ok(name, ok, `mean=${d.mean.toFixed(2)} (≤${MEAN_MAX}) worst=${d.worst.toFixed(2)} (≤${WORST_MAX}) @${d.w}×${d.h}`);
    }

    return report;
  } finally {
    await deleteTemplate(templateId);
  }
}
